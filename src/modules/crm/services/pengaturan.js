// Service pengaturan: nilai kunci-nilai (tarif pajak, batas diskon, dll), tahap pipeline, dan sumber lead.
// Hanya admin yang boleh mengubah (diperiksa di route); setiap perubahan dicatat di audit.
const { query, transaksi } = require('../../../config/db');
const audit = require('./audit');
const { GalatValidasi, teks, desimal, idAtauNull } = require('./validasi');
const { galat404 } = require('./umum');

async function semua(klien) {
  const { rows } = await query(
    'SELECT kunci, nilai, keterangan FROM pengaturan WHERE deleted_at IS NULL ORDER BY kunci', [], klien);
  return Object.fromEntries(rows.map((r) => [r.kunci, r.nilai]));
}

async function ambil(kunci, klien) {
  const { rows } = await query('SELECT nilai FROM pengaturan WHERE kunci = $1 AND deleted_at IS NULL', [kunci], klien);
  if (!rows[0]) throw new Error(`Pengaturan "${kunci}" belum ada.`);
  return rows[0].nilai;
}

// ---------- Nilai umum ----------

function bilanganBulat(v, min, maks) {
  const t = teks(v);
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= maks ? String(n) : null;
}

function persen(v) {
  const d = desimal(v, 3);
  return d !== null && Number(d) <= 100 ? d : null;
}

/** Daftar kunci yang boleh diubah lewat formulir, beserta validatornya. */
const ATURAN_NILAI = {
  nama_perusahaan: { label: 'Nama perusahaan', cek: (v) => (teks(v) && teks(v).length <= 120 ? teks(v) : null) },
  pajak_persen: { label: 'Tarif PPN (%)', cek: persen },
  diskon_maks_persen: { label: 'Batas diskon (%)', cek: persen },
  penawaran_berlaku_hari: { label: 'Masa berlaku penawaran (hari)', cek: (v) => bilanganBulat(v, 1, 365) },
  penawaran_syarat: { label: 'Syarat & ketentuan default', cek: (v) => (teks(v).length <= 2000 ? teks(v) : null) },
  pengingat_menit_sebelum: { label: 'Pengingat tugas (menit sebelum tenggat)', cek: (v) => bilanganBulat(v, 0, 10080) },
};

async function simpanNilai(input, pengguna) {
  const galat = [];
  const baru = {};
  for (const [kunci, a] of Object.entries(ATURAN_NILAI)) {
    if (input[kunci] === undefined) continue;
    const v = a.cek(input[kunci]);
    if (v === null) galat.push(`${a.label} tidak valid.`);
    else baru[kunci] = v;
  }
  if (galat.length) throw new GalatValidasi(galat);
  return transaksi(async (k) => {
    const lama = await semua(k);
    const berubah = Object.keys(baru).filter((kunci) => lama[kunci] !== baru[kunci]);
    for (const kunci of berubah) {
      await k.query(
        `INSERT INTO pengaturan (kunci, nilai) VALUES ($1, $2)
         ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, deleted_at = NULL`, [kunci, baru[kunci]]);
    }
    if (berubah.length) await audit.catat(k, { penggunaId: pengguna.id, entitas: 'pengaturan', entitasId: 0, aksi: 'ubah', kolom: berubah });
    return berubah;
  });
}

// ---------- Tahap pipeline ----------

async function daftarTahapSemua() {
  const { rows } = await query(
    `SELECT t.id, t.nama, t.urutan, t.jenis, t.peluang_persen, t.aktif,
       (SELECT count(*) FROM deal d WHERE d.tahap_id = t.id AND d.deleted_at IS NULL) AS jumlah_deal
     FROM tahap_pipeline t WHERE t.deleted_at IS NULL ORDER BY t.urutan, t.id`);
  return rows;
}

async function simpanTahap(id, input, pengguna) {
  const nama = teks(input.nama);
  const peluang = bilanganBulat(input.peluang_persen, 0, 100);
  const galat = [];
  if (!nama || nama.length > 60) galat.push('Nama tahap wajib diisi (maks. 60 karakter).');
  if (peluang === null) galat.push('Peluang harus angka 0-100.');
  if (galat.length) throw new GalatValidasi(galat);
  const tahapBaru = !id;
  return transaksi(async (k) => {
    // Kunci tabel tahap agar urutan & validasi konsisten
    await k.query('SELECT id FROM tahap_pipeline FOR UPDATE');
    const ganda = await k.query(
      'SELECT 1 FROM tahap_pipeline WHERE lower(nama) = lower($1) AND deleted_at IS NULL AND id <> COALESCE($2::bigint, 0)', [nama, id]);
    if (ganda.rowCount) throw new GalatValidasi(['Nama tahap sudah dipakai.']);
    if (id) {
      const r = await k.query('UPDATE tahap_pipeline SET nama = $1, peluang_persen = $2 WHERE id = $3 AND deleted_at IS NULL', [nama, peluang, id]);
      if (!r.rowCount) throw galat404('Tahap tidak ditemukan.');
    } else {
      // Tahap baru selalu jenis "terbuka", disisipkan sebelum tahap Menang/Kalah
      const { rows: [m] } = await k.query(
        `SELECT COALESCE(max(urutan), 0) AS maks FROM tahap_pipeline WHERE jenis = 'terbuka' AND deleted_at IS NULL`);
      await k.query(`UPDATE tahap_pipeline SET urutan = urutan + 1 WHERE jenis <> 'terbuka' AND deleted_at IS NULL`);
      const baru = await k.query(
        `INSERT INTO tahap_pipeline (nama, urutan, jenis, peluang_persen) VALUES ($1, $2, 'terbuka', $3) RETURNING id`,
        [nama, Number(m.maks) + 1, peluang]);
      id = baru.rows[0].id;
    }
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'tahap_pipeline', entitasId: id, aksi: tahapBaru ? 'buat' : 'ubah', kolom: ['nama', 'peluang_persen'] });
    return id;
  });
}

/** Geser tahap terbuka ke atas/bawah (tukar urutan dengan tetangga). Menang/Kalah tetap di akhir. */
async function geserTahap(id, arah, pengguna) {
  return transaksi(async (k) => {
    await k.query('SELECT id FROM tahap_pipeline FOR UPDATE');
    const { rows } = await k.query(
      `SELECT id, urutan FROM tahap_pipeline WHERE jenis = 'terbuka' AND deleted_at IS NULL ORDER BY urutan, id`);
    const i = rows.findIndex((r) => String(r.id) === String(id));
    if (i < 0) throw new GalatValidasi(['Hanya tahap terbuka yang bisa digeser.']);
    const j = arah === 'atas' ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    // Normalisasi urutan 1..n lalu tukar dua posisi
    const susunan = rows.map((r) => r.id);
    [susunan[i], susunan[j]] = [susunan[j], susunan[i]];
    for (let n = 0; n < susunan.length; n += 1) {
      await k.query('UPDATE tahap_pipeline SET urutan = $1 WHERE id = $2', [n + 1, susunan[n]]);
    }
    const { rows: [jml] } = await k.query(`SELECT count(*) AS n FROM tahap_pipeline WHERE jenis = 'terbuka' AND deleted_at IS NULL`);
    await k.query(
      `UPDATE tahap_pipeline SET urutan = $1 + CASE WHEN jenis = 'menang' THEN 1 ELSE 2 END WHERE jenis <> 'terbuka' AND deleted_at IS NULL`,
      [Number(jml.n)]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'tahap_pipeline', entitasId: id, aksi: 'ubah', kolom: ['urutan'] });
  });
}

/**
 * Aktif/nonaktifkan tahap. Tahap Menang/Kalah tidak bisa dinonaktifkan; tahap yang masih berisi deal
 * tidak bisa dinonaktifkan; minimal satu tahap terbuka harus tetap aktif.
 */
async function aturAktifTahap(id, aktif, pengguna) {
  return transaksi(async (k) => {
    await k.query('SELECT id FROM tahap_pipeline FOR UPDATE');
    const { rows: [t] } = await k.query('SELECT * FROM tahap_pipeline WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!t) throw galat404('Tahap tidak ditemukan.');
    if (!aktif) {
      if (t.jenis !== 'terbuka') throw new GalatValidasi(['Tahap Menang/Kalah tidak bisa dinonaktifkan.']);
      const { rows: [d] } = await k.query('SELECT count(*) AS n FROM deal WHERE tahap_id = $1 AND deleted_at IS NULL', [id]);
      if (Number(d.n) > 0) throw new GalatValidasi([`Tahap "${t.nama}" masih berisi ${d.n} deal. Pindahkan dulu deal-nya.`]);
      const { rows: [s] } = await k.query(
        `SELECT count(*) AS n FROM tahap_pipeline WHERE jenis = 'terbuka' AND aktif AND deleted_at IS NULL AND id <> $1`, [id]);
      if (Number(s.n) === 0) throw new GalatValidasi(['Minimal harus ada satu tahap terbuka yang aktif.']);
    }
    await k.query('UPDATE tahap_pipeline SET aktif = $1 WHERE id = $2', [aktif, id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'tahap_pipeline', entitasId: id, aksi: aktif ? 'aktifkan' : 'nonaktifkan', kolom: ['aktif'] });
  });
}

// ---------- Sumber lead ----------

async function daftarSumberSemua() {
  const { rows } = await query(
    `SELECT s.id, s.nama, s.urutan, s.aktif,
       (SELECT count(*) FROM lead l WHERE l.sumber_id = s.id AND l.deleted_at IS NULL) AS jumlah_lead
     FROM sumber_lead s WHERE s.deleted_at IS NULL ORDER BY s.urutan, s.nama`);
  return rows;
}

async function simpanSumber(id, input, pengguna) {
  const nama = teks(input.nama);
  if (!nama || nama.length > 60) throw new GalatValidasi(['Nama sumber wajib diisi (maks. 60 karakter).']);
  return transaksi(async (k) => {
    const ganda = await k.query(
      'SELECT 1 FROM sumber_lead WHERE lower(nama) = lower($1) AND deleted_at IS NULL AND id <> COALESCE($2::bigint, 0)', [nama, id]);
    if (ganda.rowCount) throw new GalatValidasi(['Nama sumber sudah dipakai.']);
    let sumberId = id;
    if (id) {
      const r = await k.query('UPDATE sumber_lead SET nama = $1 WHERE id = $2 AND deleted_at IS NULL', [nama, id]);
      if (!r.rowCount) throw galat404('Sumber lead tidak ditemukan.');
    } else {
      sumberId = (await k.query(
        `INSERT INTO sumber_lead (nama, urutan) VALUES ($1, (SELECT COALESCE(max(urutan), 0) + 1 FROM sumber_lead WHERE urutan < 99))
         RETURNING id`, [nama])).rows[0].id;
    }
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'sumber_lead', entitasId: sumberId, aksi: id ? 'ubah' : 'buat', kolom: ['nama'] });
    return sumberId;
  });
}

async function aturAktifSumber(id, aktif, pengguna) {
  return transaksi(async (k) => {
    const r = await k.query('UPDATE sumber_lead SET aktif = $1 WHERE id = $2 AND deleted_at IS NULL', [aktif, idAtauNull(id)]);
    if (!r.rowCount) throw galat404('Sumber lead tidak ditemukan.');
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'sumber_lead', entitasId: id, aksi: aktif ? 'aktifkan' : 'nonaktifkan', kolom: ['aktif'] });
  });
}

module.exports = {
  ATURAN_NILAI, semua, ambil, simpanNilai,
  daftarTahapSemua, simpanTahap, geserTahap, aturAktifTahap,
  daftarSumberSemua, simpanSumber, aturAktifSumber,
};
