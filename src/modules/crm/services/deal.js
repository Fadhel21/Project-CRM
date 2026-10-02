// Service deal & pipeline. Nilai uang selalu string NUMERIC, tidak pernah float.
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const kontakService = require('./kontak');
const perusahaanService = require('./perusahaan');
const { GalatValidasi, teks, teksAtauNull, uang, idAtauNull } = require('./validasi');
const { UKURAN_HALAMAN, galat404, nomorHalaman, tentukanPemilik, polaCari } = require('./umum');

const KOLOM_UBAH = ['judul', 'nilai', 'kontak_id', 'perusahaan_id', 'target_tutup', 'catatan', 'pemilik_id'];
// Kolom Menang/Kalah di kanban hanya menampilkan deal yang ditutup dalam sekian hari terakhir
const HARI_TUTUP_DI_KANBAN = 30;

async function daftarTahap(klien) {
  const { rows } = await query(
    `SELECT id, nama, urutan, jenis, peluang_persen FROM tahap_pipeline
     WHERE aktif AND deleted_at IS NULL ORDER BY urutan, id`, [], klien);
  return rows;
}

async function ambil(id, pengguna, klien) {
  const params = [id];
  const { rows } = await query(
    `SELECT d.*, t.nama AS tahap, t.jenis AS jenis_tahap, k.nama AS kontak, p.nama AS perusahaan, u.nama AS pemilik
     FROM deal d
     JOIN tahap_pipeline t ON t.id = d.tahap_id
     LEFT JOIN kontak k ON k.id = d.kontak_id AND k.deleted_at IS NULL
     LEFT JOIN perusahaan p ON p.id = d.perusahaan_id AND p.deleted_at IS NULL
     JOIN pengguna u ON u.id = d.pemilik_id
     WHERE d.id = $1 AND d.deleted_at IS NULL AND ${filterPemilik(pengguna, 'd.pemilik_id', params)}
     ${klien ? 'FOR UPDATE OF d' : ''}`, params, klien);
  return rows[0] || null;
}

function validasi(input) {
  const data = {
    judul: teks(input.judul),
    nilai: uang(input.nilai),
    tahap_id: idAtauNull(input.tahap_id),
    kontak_id: idAtauNull(input.kontak_id),
    perusahaan_id: idAtauNull(input.perusahaan_id),
    target_tutup: teksAtauNull(input.target_tutup),
    catatan: teksAtauNull(input.catatan),
  };
  const galat = [];
  if (!data.judul) galat.push('Judul deal wajib diisi.');
  if (data.nilai === null) galat.push('Nilai deal tidak valid (angka, maks. 2 desimal, tidak negatif).');
  if (data.target_tutup && !/^\d{4}-\d{2}-\d{2}$/.test(data.target_tutup)) galat.push('Tanggal target tutup tidak valid.');
  if (galat.length) throw new GalatValidasi(galat);
  return data;
}

/** Memastikan kontak/perusahaan yang ditautkan boleh dilihat pengguna. */
async function cekTautan(k, pengguna, data, lama) {
  if (data.kontak_id && String(data.kontak_id) !== String(lama?.kontak_id ?? '')
      && !(await kontakService.ambil(data.kontak_id, pengguna, k))) {
    throw new GalatValidasi(['Kontak tidak ditemukan atau bukan hak Anda.']);
  }
  if (data.perusahaan_id && String(data.perusahaan_id) !== String(lama?.perusahaan_id ?? '')
      && !(await perusahaanService.ambil(data.perusahaan_id, pengguna, k))) {
    throw new GalatValidasi(['Perusahaan tidak ditemukan atau bukan hak Anda.']);
  }
}

/**
 * Membuat deal baru. Tahap default = tahap terbuka pertama. Riwayat tahap awal dicatat.
 * extra.lead_id dipakai saat konversi lead.
 */
async function buat(input, pengguna, klienLuar, extra = {}) {
  const data = validasi(input);
  const kerja = async (k) => {
    const tahap = await daftarTahap(k);
    const tahapId = data.tahap_id || tahap.find((t) => t.jenis === 'terbuka')?.id;
    const t = tahap.find((x) => String(x.id) === String(tahapId));
    if (!t) throw new GalatValidasi(['Tahap pipeline tidak valid.']);
    if (t.jenis !== 'terbuka') throw new GalatValidasi(['Deal baru harus berada di tahap yang masih terbuka.']);
    await cekTautan(k, pengguna, data);
    const pemilikId = await tentukanPemilik(k, pengguna, input.pemilik_id, null);
    const { rows } = await k.query(
      `INSERT INTO deal (judul, nilai, tahap_id, kontak_id, perusahaan_id, lead_id, pemilik_id, target_tutup, catatan, ditutup_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL) RETURNING id`,
      [data.judul, data.nilai, t.id, data.kontak_id, data.perusahaan_id, extra.lead_id || null, pemilikId,
        data.target_tutup, data.catatan]);
    const id = rows[0].id;
    await k.query(
      'INSERT INTO riwayat_tahap (deal_id, dari_tahap_id, ke_tahap_id, pengguna_id) VALUES ($1, NULL, $2, $3)',
      [id, t.id, pengguna.id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'deal', entitasId: id, aksi: 'buat' });
    return id;
  };
  return klienLuar ? kerja(klienLuar) : transaksi(kerja);
}

/** Filter tambahan opsional: pemilik tertentu (tetap di dalam batas hak akses). */
function filterTambahan(params, pemilikId) {
  if (!idAtauNull(pemilikId)) return '';
  params.push(pemilikId);
  return ` AND d.pemilik_id = $${params.length}`;
}

const DARI_DEAL = `FROM deal d
  JOIN tahap_pipeline t ON t.id = d.tahap_id
  LEFT JOIN kontak k ON k.id = d.kontak_id AND k.deleted_at IS NULL
  LEFT JOIN perusahaan p ON p.id = d.perusahaan_id AND p.deleted_at IS NULL
  JOIN pengguna u ON u.id = d.pemilik_id`;

async function daftar(pengguna, { q = '', tahap = '', status = 'terbuka', pemilikId = '', halaman = 1 } = {}) {
  const params = [];
  let where = `d.deleted_at IS NULL AND ${filterPemilik(pengguna, 'd.pemilik_id', params)}${filterTambahan(params, pemilikId)}`;
  if (['terbuka', 'menang', 'kalah'].includes(status)) {
    params.push(status);
    where += ` AND t.jenis = $${params.length}`;
  }
  if (idAtauNull(tahap)) {
    params.push(tahap);
    where += ` AND d.tahap_id = $${params.length}`;
  }
  if (teks(q)) {
    params.push(polaCari(teks(q)));
    const n = params.length;
    where += ` AND (d.judul ILIKE $${n} OR k.nama ILIKE $${n} OR p.nama ILIKE $${n})`;
  }
  const ringkas = (await query(
    `SELECT count(*) AS total, round(COALESCE(sum(d.nilai), 0), 2) AS jumlah_nilai ${DARI_DEAL} WHERE ${where}`,
    params)).rows[0];
  const hal = nomorHalaman(halaman);
  params.push(UKURAN_HALAMAN, (hal - 1) * UKURAN_HALAMAN);
  const { rows } = await query(
    `SELECT d.id, d.judul, d.nilai, d.target_tutup, d.ditutup_at, t.nama AS tahap, t.jenis AS jenis_tahap,
       k.nama AS kontak, p.nama AS perusahaan, u.nama AS pemilik
     ${DARI_DEAL} WHERE ${where} ORDER BY t.urutan, d.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const total = Number(ringkas.total);
  return {
    baris: rows, total, jumlahNilai: ringkas.jumlah_nilai, halaman: hal,
    jumlahHalaman: Math.max(1, Math.ceil(total / UKURAN_HALAMAN)),
  };
}

/**
 * Data kanban: setiap tahap beserta deal-nya, jumlah, dan total nilai (dihitung di SQL).
 * Tahap Menang/Kalah hanya berisi deal yang ditutup dalam HARI_TUTUP_DI_KANBAN hari terakhir.
 */
async function kanban(pengguna, { pemilikId = '' } = {}) {
  const tahap = await daftarTahap();
  const params = [];
  const where = `d.deleted_at IS NULL AND ${filterPemilik(pengguna, 'd.pemilik_id', params)}${filterTambahan(params, pemilikId)}
    AND (t.jenis = 'terbuka' OR d.ditutup_at >= now() - make_interval(days => ${HARI_TUTUP_DI_KANBAN}))`;
  const { rows } = await query(
    `SELECT d.id, d.judul, d.nilai, d.tahap_id, d.target_tutup, k.nama AS kontak, p.nama AS perusahaan, u.nama AS pemilik
     ${DARI_DEAL} WHERE ${where} ORDER BY d.updated_at DESC LIMIT 1000`, params);
  const total = (await query(
    `SELECT d.tahap_id, count(*) AS jumlah, round(sum(d.nilai), 2) AS nilai
     ${DARI_DEAL} WHERE ${where} GROUP BY d.tahap_id`, params)).rows;
  return tahap.map((t) => {
    const tot = total.find((x) => String(x.tahap_id) === String(t.id));
    return {
      ...t,
      deal: rows.filter((d) => String(d.tahap_id) === String(t.id)),
      jumlah: tot ? Number(tot.jumlah) : 0,
      nilai: tot ? tot.nilai : '0.00',
    };
  });
}

/** Perbandingan nilai uang sebagai string desimal ("100" sama dengan "100.00"). */
function uangSama(a, b) {
  const n = (s) => {
    const [bulat, pecahan = ''] = String(s).split('.');
    return `${bulat.replace(/^0+(?=\d)/, '')}.${pecahan.padEnd(2, '0')}`;
  };
  return n(a) === n(b);
}

async function ubah(id, input, pengguna) {
  const data = validasi(input);
  return transaksi(async (k) => {
    const lama = await ambil(id, pengguna, k);
    if (!lama) throw galat404('Deal tidak ditemukan.');
    await cekTautan(k, pengguna, data, lama);
    data.pemilik_id = await tentukanPemilik(k, pengguna, input.pemilik_id, String(lama.pemilik_id));
    await k.query(
      `UPDATE deal SET judul=$1, nilai=$2, kontak_id=$3, perusahaan_id=$4, target_tutup=$5, catatan=$6, pemilik_id=$7
       WHERE id=$8`,
      [data.judul, data.nilai, data.kontak_id, data.perusahaan_id, data.target_tutup, data.catatan, data.pemilik_id, id]);
    const kolom = audit.kolomBerubah(lama, data)
      .filter((c) => KOLOM_UBAH.includes(c) && c !== 'nilai');
    if (!uangSama(lama.nilai, data.nilai)) kolom.push('nilai');
    if (kolom.length) await audit.catat(k, { penggunaId: pengguna.id, entitas: 'deal', entitasId: id, aksi: 'ubah', kolom });
  });
}

/**
 * Memindahkan deal ke tahap lain. Selalu dicatat di riwayat_tahap (siapa, kapan, dari, ke).
 * Tahap Kalah wajib disertai alasan. Pindah ke tahap terbuka membuka kembali deal (ditutup_at = NULL).
 * Mengembalikan false bila tahap tidak berubah.
 */
async function pindahTahap(id, keTahapId, pengguna, { alasanKalah = '' } = {}) {
  return transaksi(async (k) => {
    const deal = await ambil(id, pengguna, k);
    if (!deal) throw galat404('Deal tidak ditemukan.');
    const tahap = (await daftarTahap(k)).find((t) => String(t.id) === String(keTahapId));
    if (!tahap) throw new GalatValidasi(['Tahap pipeline tidak valid.']);
    if (String(deal.tahap_id) === String(tahap.id)) return false;
    const alasan = teks(alasanKalah);
    if (tahap.jenis === 'kalah' && !alasan) throw new GalatValidasi(['Alasan kalah wajib diisi.']);

    await k.query(
      `UPDATE deal SET tahap_id = $1,
         ditutup_at = CASE WHEN $2 = 'terbuka' THEN NULL ELSE now() END,
         alasan_kalah = CASE WHEN $2 = 'kalah' THEN $3 ELSE NULL END
       WHERE id = $4`, [tahap.id, tahap.jenis, alasan || null, id]);
    await k.query(
      'INSERT INTO riwayat_tahap (deal_id, dari_tahap_id, ke_tahap_id, pengguna_id) VALUES ($1, $2, $3, $4)',
      [id, deal.tahap_id, tahap.id, pengguna.id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'deal', entitasId: id, aksi: 'pindah_tahap', kolom: ['tahap_id'] });
    return true;
  });
}

async function riwayatTahap(dealId) {
  const { rows } = await query(
    `SELECT r.created_at, dari.nama AS dari, ke.nama AS ke, u.nama AS pengguna
     FROM riwayat_tahap r
     LEFT JOIN tahap_pipeline dari ON dari.id = r.dari_tahap_id
     JOIN tahap_pipeline ke ON ke.id = r.ke_tahap_id
     LEFT JOIN pengguna u ON u.id = r.pengguna_id
     WHERE r.deal_id = $1 ORDER BY r.created_at DESC, r.id DESC`, [dealId]);
  return rows;
}

async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    if (!(await ambil(id, pengguna, k))) throw galat404('Deal tidak ditemukan.');
    await k.query('UPDATE deal SET deleted_at = now() WHERE id = $1', [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'deal', entitasId: id, aksi: 'hapus' });
  });
}

/** Deal milik kontak/perusahaan tertentu (untuk halaman detail), tetap dengan filter pemilik. */
async function untuk(pengguna, { kontakId = null, perusahaanId = null }) {
  const params = [];
  let where = `d.deleted_at IS NULL AND ${filterPemilik(pengguna, 'd.pemilik_id', params)}`;
  if (kontakId) {
    params.push(kontakId);
    where += ` AND d.kontak_id = $${params.length}`;
  }
  if (perusahaanId) {
    params.push(perusahaanId);
    where += ` AND d.perusahaan_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT d.id, d.judul, d.nilai, t.nama AS tahap, t.jenis AS jenis_tahap
     FROM deal d JOIN tahap_pipeline t ON t.id = d.tahap_id WHERE ${where} ORDER BY d.created_at DESC LIMIT 100`, params);
  return rows;
}

module.exports = {
  daftarTahap, ambil, validasi, cekTautan, buat, daftar, kanban, ubah, pindahTahap, riwayatTahap, hapus, untuk,
};

