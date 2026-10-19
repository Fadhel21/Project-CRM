// Service penawaran (quotation).
// Aturan:
//  - Nomor QUO/YYYY/MM/NNNN berurutan per tahun, diambil di dalam transaksi dengan SELECT ... FOR UPDATE.
//  - Semua angka dihitung di SQL dari baris item (bukan diketik, bukan float JavaScript).
//    Urutan: subtotal baris - diskon baris -> jumlah - diskon dokumen = DPP -> + PPN dari DPP.
//    Pembulatan 2 desimal di setiap langkah.
//  - Tarif PPN & batas diskon diambil dari tabel pengaturan.
//  - Hanya draf yang boleh diubah. Penawaran terkirim diubah lewat revisi baru (-R1, -R2, ...).
//  - Diterima -> deal otomatis pindah ke tahap Menang, dalam transaksi yang sama.
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const dealService = require('./deal');
const pengaturanService = require('./pengaturan');
const emailService = require('./email');
const pdfPenawaran = require('./pdf-penawaran');
const { tanggal, rupiah } = require('./format');
const { GalatValidasi, teks, teksAtauNull, uang, desimal, idAtauNull, emailValid } = require('./validasi');
const { UKURAN_HALAMAN, galat404, nomorHalaman, polaCari } = require('./umum');

const STATUS = {
  draf: 'Draf', terkirim: 'Terkirim', diterima: 'Diterima', ditolak: 'Ditolak', direvisi: 'Direvisi', kedaluwarsa: 'Kedaluwarsa',
};
const MAKS_ITEM = 200;
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
// Status tampilan: terkirim yang lewat masa berlaku dianggap kedaluwarsa
const STATUS_TAMPIL = `CASE WHEN p.status = 'terkirim' AND p.berlaku_sampai < current_date THEN 'kedaluwarsa' ELSE p.status END`;

function galatKeadaan(pesan) {
  return new GalatValidasi([pesan]);
}

// ---------- Validasi & hitung ----------

/** Nilai form bisa string (1 baris) atau array (banyak baris). */
function sebagaiDaftar(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function validasiItem(input, batasDiskon) {
  const nama = sebagaiDaftar(input.item_nama);
  const galat = [];
  const item = [];
  nama.forEach((n, i) => {
    const baris = {
      nama: teks(n),
      deskripsi: teksAtauNull(sebagaiDaftar(input.item_deskripsi)[i]),
      qty: desimal(sebagaiDaftar(input.item_qty)[i], 10),
      satuan: teksAtauNull(sebagaiDaftar(input.item_satuan)[i]),
      harga: uang(sebagaiDaftar(input.item_harga)[i]),
      diskon_persen: desimal(sebagaiDaftar(input.item_diskon)[i], 3),
    };
    // Baris yang benar-benar kosong diabaikan
    const kosong = !baris.nama && !teks(sebagaiDaftar(input.item_harga)[i]) && !baris.deskripsi;
    if (kosong) return;
    const no = item.length + 1;
    if (!baris.nama) galat.push(`Item ${no}: nama wajib diisi.`);
    if (baris.qty === null || Number(baris.qty) <= 0) galat.push(`Item ${no}: jumlah (qty) harus lebih dari 0.`);
    if (baris.harga === null) galat.push(`Item ${no}: harga tidak valid.`);
    if (baris.diskon_persen === null) galat.push(`Item ${no}: diskon tidak valid.`);
    else if (Number(baris.diskon_persen) > Number(batasDiskon)) {
      galat.push(`Item ${no}: diskon maksimal ${batasDiskon}%.`);
    }
    item.push(baris);
  });
  if (item.length > MAKS_ITEM) galat.push(`Maksimal ${MAKS_ITEM} item per penawaran.`);
  return { item, galat };
}

function validasi(input, { batasDiskon, butuhDeal }) {
  const data = {
    judul: teks(input.judul),
    deal_id: idAtauNull(input.deal_id),
    tanggal: teksAtauNull(input.tanggal),
    berlaku_sampai: teksAtauNull(input.berlaku_sampai),
    catatan: teksAtauNull(input.catatan),
    syarat: teksAtauNull(input.syarat),
    diskon_persen: desimal(input.diskon_persen, 3),
  };
  const galat = [];
  if (!data.judul) galat.push('Perihal penawaran wajib diisi.');
  if (butuhDeal && !data.deal_id) galat.push('Pilih deal untuk penawaran ini.');
  if (data.tanggal && !POLA_TANGGAL.test(data.tanggal)) galat.push('Tanggal tidak valid.');
  if (data.berlaku_sampai && !POLA_TANGGAL.test(data.berlaku_sampai)) galat.push('Tanggal berlaku tidak valid.');
  if (data.tanggal && data.berlaku_sampai && data.berlaku_sampai < data.tanggal) {
    galat.push('Tanggal berlaku tidak boleh sebelum tanggal penawaran.');
  }
  if (data.diskon_persen === null) galat.push('Diskon dokumen tidak valid.');
  else if (Number(data.diskon_persen) > Number(batasDiskon)) galat.push(`Diskon dokumen maksimal ${batasDiskon}%.`);
  const hasilItem = validasiItem(input, batasDiskon);
  galat.push(...hasilItem.galat);
  if (galat.length) throw new GalatValidasi(galat);
  return { data, item: hasilItem.item };
}

/**
 * Menghitung semua angka di SQL. Dipakai untuk menyimpan DAN untuk pratinjau, agar hasilnya identik.
 * Mengembalikan { baris: [{subtotal, diskon_nilai, total}], ringkas: {subtotal, diskon_nilai, dpp, pajak_nilai, total} }.
 */
async function hitung(item, diskonPersen, pajakPersen, klien) {
  const { rows: baris } = await query(
    `SELECT round(qty * harga, 2) AS subtotal,
            round(round(qty * harga, 2) * diskon / 100, 2) AS diskon_nilai,
            round(qty * harga, 2) - round(round(qty * harga, 2) * diskon / 100, 2) AS total
     FROM unnest($1::numeric[], $2::numeric[], $3::numeric[]) WITH ORDINALITY AS t(qty, harga, diskon, urutan)
     ORDER BY urutan`,
    [item.map((i) => i.qty), item.map((i) => i.harga), item.map((i) => i.diskon_persen)], klien);
  const { rows: [r] } = await query(
    `WITH s AS (SELECT COALESCE(sum(x), 0)::numeric AS subtotal FROM unnest($1::numeric[]) AS x),
          d AS (SELECT subtotal, round(subtotal * $2::numeric / 100, 2) AS diskon_nilai FROM s),
          p AS (SELECT subtotal, diskon_nilai, subtotal - diskon_nilai AS dpp FROM d)
     SELECT subtotal, diskon_nilai, dpp, round(dpp * $3::numeric / 100, 2) AS pajak_nilai,
            dpp + round(dpp * $3::numeric / 100, 2) AS total,
            (dpp + round(dpp * $3::numeric / 100, 2) >= 10000000000000 OR subtotal >= 10000000000000) AS terlalu_besar
     FROM p`,
    [baris.map((b) => b.total), diskonPersen, pajakPersen], klien);
  if (r.terlalu_besar || baris.some((b) => b.subtotal.replace('.', '').length > 15)) {
    throw galatKeadaan('Total penawaran melebihi batas maksimum (Rp 9.999.999.999.999,99).');
  }
  return { baris, ringkas: { subtotal: r.subtotal, diskon_nilai: r.diskon_nilai, dpp: r.dpp, pajak_nilai: r.pajak_nilai, total: r.total } };
}

/** Pratinjau total untuk formulir (HTMX), memakai hitung() yang sama dengan penyimpanan. */
async function pratinjau(input) {
  const peng = await pengaturanService.semua();
  const batas = peng.diskon_maks_persen;
  const { item, galat } = validasiItem(input, batas);
  const diskon = desimal(input.diskon_persen, 3);
  if (diskon === null) galat.push('Diskon dokumen tidak valid.');
  else if (Number(diskon) > Number(batas)) galat.push(`Diskon dokumen maksimal ${batas}%.`);
  const pajak = desimal(input.pajak_persen, 3) ?? peng.pajak_persen;
  if (galat.length) return { galat, hasil: null, pajak };
  try {
    return { galat: [], hasil: await hitung(item, diskon, pajak), pajak, diskon };
  } catch (err) {
    if (err.status === 422) return { galat: err.daftar, hasil: null, pajak };
    throw err;
  }
}

// ---------- Nomor urut ----------

/** Nomor baru QUO/YYYY/MM/NNNN. Penghitung per tahun dikunci FOR UPDATE agar tidak pernah ganda. */
async function nomorBaru(k, tanggalIso) {
  const [tahun, bulan] = tanggalIso.split('-');
  const kunci = `penawaran:${tahun}`;
  await k.query('INSERT INTO penghitung (kunci, nilai) VALUES ($1, 0) ON CONFLICT (kunci) DO NOTHING', [kunci]);
  await k.query('SELECT nilai FROM penghitung WHERE kunci = $1 FOR UPDATE', [kunci]);
  const { rows } = await k.query('UPDATE penghitung SET nilai = nilai + 1 WHERE kunci = $1 RETURNING nilai', [kunci]);
  return `QUO/${tahun}/${bulan}/${String(rows[0].nilai).padStart(4, '0')}`;
}

function nomorRevisi(dasar, revisi) {
  return revisi > 0 ? `${dasar}-R${revisi}` : dasar;
}

// ---------- Baca ----------

const KOLOM = `p.*, ${STATUS_TAMPIL} AS status_tampil, d.judul AS deal, k.nama AS kontak, k.email AS kontak_email,
  pr.nama AS perusahaan, u.nama AS pemilik`;
const DARI = `FROM penawaran p
  JOIN deal d ON d.id = p.deal_id
  LEFT JOIN kontak k ON k.id = p.kontak_id
  LEFT JOIN perusahaan pr ON pr.id = p.perusahaan_id
  JOIN pengguna u ON u.id = p.pemilik_id`;

async function ambil(id, pengguna, klien) {
  const params = [id];
  const { rows } = await query(
    `SELECT ${KOLOM} ${DARI}
     WHERE p.id = $1 AND p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}
     ${klien ? 'FOR UPDATE OF p' : ''}`, params, klien);
  return rows[0] || null;
}

async function daftarItem(penawaranId, klien) {
  const { rows } = await query(
    `SELECT nama, deskripsi, qty, satuan, harga, diskon_persen, subtotal, diskon_nilai, total
     FROM penawaran_item WHERE penawaran_id = $1 AND deleted_at IS NULL ORDER BY urutan`, [penawaranId], klien);
  return rows;
}

async function daftar(pengguna, { q = '', status = '', halaman = 1 } = {}) {
  const params = [];
  let where = `p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}`;
  if (STATUS[status]) {
    params.push(status);
    where += ` AND ${STATUS_TAMPIL} = $${params.length}`;
  }
  if (teks(q)) {
    params.push(polaCari(teks(q)));
    const n = params.length;
    where += ` AND (p.nomor ILIKE $${n} OR p.judul ILIKE $${n} OR k.nama ILIKE $${n} OR pr.nama ILIKE $${n})`;
  }
  const ringkas = (await query(
    `SELECT count(*) AS total, COALESCE(sum(p.total), 0) AS jumlah_nilai ${DARI} WHERE ${where}`, params)).rows[0];
  const hal = nomorHalaman(halaman);
  params.push(UKURAN_HALAMAN, (hal - 1) * UKURAN_HALAMAN);
  const { rows } = await query(
    `SELECT ${KOLOM} ${DARI} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const total = Number(ringkas.total);
  return {
    baris: rows, total, jumlahNilai: ringkas.jumlah_nilai, halaman: hal,
    jumlahHalaman: Math.max(1, Math.ceil(total / UKURAN_HALAMAN)),
  };
}

async function untukDeal(dealId, pengguna) {
  const params = [dealId];
  const { rows } = await query(
    `SELECT ${KOLOM} ${DARI} WHERE p.deal_id = $1 AND p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}
     ORDER BY p.nomor_dasar, p.revisi`, params);
  return rows;
}

/** Riwayat revisi: semua penawaran dengan nomor dasar yang sama. */
async function riwayatRevisi(nomorDasar, pengguna) {
  const params = [nomorDasar];
  const { rows } = await query(
    `SELECT p.id, p.nomor, p.revisi, p.total, ${STATUS_TAMPIL} AS status_tampil, p.created_at
     FROM penawaran p WHERE p.nomor_dasar = $1 AND p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}
     ORDER BY p.revisi`, params);
  return rows;
}

// ---------- Tulis ----------

async function tulisItem(k, penawaranId, item, hasil) {
  // Draf diedit: item lama ditandai terhapus (soft delete), lalu item baru ditulis
  await k.query('UPDATE penawaran_item SET deleted_at = now() WHERE penawaran_id = $1 AND deleted_at IS NULL', [penawaranId]);
  for (let i = 0; i < item.length; i += 1) {
    const it = item[i];
    const b = hasil.baris[i];
    await k.query(
      `INSERT INTO penawaran_item (penawaran_id, urutan, nama, deskripsi, qty, satuan, harga, diskon_persen, subtotal, diskon_nilai, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [penawaranId, i + 1, it.nama, it.deskripsi, it.qty, it.satuan, it.harga, it.diskon_persen, b.subtotal, b.diskon_nilai, b.total]);
  }
}

async function tulisRingkas(k, id, r) {
  await k.query(
    'UPDATE penawaran SET subtotal = $1, diskon_nilai = $2, dpp = $3, pajak_nilai = $4, total = $5 WHERE id = $6',
    [r.subtotal, r.diskon_nilai, r.dpp, r.pajak_nilai, r.total, id]);
}

/** Buat (id kosong) atau ubah draf. Mengembalikan id. */
async function simpanDraf(id, input, pengguna) {
  return transaksi(async (k) => {
    const peng = await pengaturanService.semua(k);
    const { data, item } = validasi(input, { batasDiskon: peng.diskon_maks_persen, butuhDeal: !id });
    let penawaranId = id;
    let pajakPersen;

    if (id) {
      const lama = await ambil(id, pengguna, k);
      if (!lama) throw galat404('Penawaran tidak ditemukan.');
      if (lama.status !== 'draf') throw galatKeadaan('Penawaran yang sudah dikirim tidak bisa diubah. Buat revisi baru.');
      pajakPersen = lama.pajak_persen;
      const tanggal = data.tanggal || lama.tanggal;
      const berlaku = data.berlaku_sampai || lama.berlaku_sampai;
      if (berlaku < tanggal) throw galatKeadaan('Tanggal berlaku tidak boleh sebelum tanggal penawaran.');
      await k.query(
        `UPDATE penawaran SET judul = $1, tanggal = $2, berlaku_sampai = $3, catatan = $4, syarat = $5, diskon_persen = $6
         WHERE id = $7`, [data.judul, tanggal, berlaku, data.catatan, data.syarat, data.diskon_persen, id]);
      await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: id, aksi: 'ubah',
        kolom: ['judul', 'tanggal', 'berlaku_sampai', 'diskon_persen', 'item'] });
    } else {
      const deal = await dealService.ambil(data.deal_id, pengguna, k);
      if (!deal) throw galatKeadaan('Deal tidak ditemukan atau bukan hak Anda.');
      if (deal.jenis_tahap !== 'terbuka') throw galatKeadaan('Penawaran hanya bisa dibuat untuk deal yang masih terbuka.');
      pajakPersen = peng.pajak_persen;
      const { rows: [tgl] } = await k.query(
        `SELECT to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') AS tanggal,
                to_char(COALESCE($2::date, COALESCE($1::date, current_date) + $3::int), 'YYYY-MM-DD') AS berlaku`,
        [data.tanggal, data.berlaku_sampai, Number(peng.penawaran_berlaku_hari || 30)]);
      if (tgl.berlaku < tgl.tanggal) throw galatKeadaan('Tanggal berlaku tidak boleh sebelum tanggal penawaran.');
      const nomor = await nomorBaru(k, tgl.tanggal);
      const { rows } = await k.query(
        `INSERT INTO penawaran (nomor_dasar, revisi, nomor, deal_id, kontak_id, perusahaan_id, pemilik_id, judul, tanggal,
           berlaku_sampai, catatan, syarat, diskon_persen, pajak_persen)
         VALUES ($1, 0, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [nomor, deal.id, deal.kontak_id, deal.perusahaan_id, deal.pemilik_id, data.judul, tgl.tanggal, tgl.berlaku,
          data.catatan, data.syarat ?? peng.penawaran_syarat ?? null, data.diskon_persen, pajakPersen]);
      penawaranId = rows[0].id;
      await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: penawaranId, aksi: 'buat' });
    }

    const hasil = await hitung(item, data.diskon_persen, pajakPersen, k);
    await tulisItem(k, penawaranId, item, hasil);
    await tulisRingkas(k, penawaranId, hasil.ringkas);
    return penawaranId;
  });
}

/** PDF dibuat di memori saat diminta; tidak disimpan ke disk. */
async function buatPdf(id, pengguna, klien) {
  const p = await ambil(id, pengguna, klien);
  if (!p) throw galat404('Penawaran tidak ditemukan.');
  const [item, namaPerusahaan] = await Promise.all([
    daftarItem(id, klien),
    pengaturanService.ambil('nama_perusahaan', klien),
  ]);
  const buffer = await pdfPenawaran.buat(p, item, namaPerusahaan);
  return { buffer, namaFile: `${p.nomor.replace(/\//g, '-')}.pdf`, penawaran: p };
}

/** Draf -> terkirim. PDF dibuat dan dikirim lewat email sebelum COMMIT; bila email gagal, status tidak berubah. */
async function kirim(id, input, pengguna) {
  return transaksi(async (k) => {
    const p = await ambil(id, pengguna, k);
    if (!p) throw galat404('Penawaran tidak ditemukan.');
    if (p.status !== 'draf') throw galatKeadaan('Hanya penawaran berstatus draf yang bisa dikirim.');
    const { rows: [n] } = await k.query(
      'SELECT count(*) AS jumlah FROM penawaran_item WHERE penawaran_id = $1 AND deleted_at IS NULL', [id]);
    if (Number(n.jumlah) === 0) throw galatKeadaan('Penawaran belum punya item.');
    const ke = (teksAtauNull(input.email) || p.kontak_email || '').toLowerCase();
    if (!emailValid(ke)) throw galatKeadaan('Alamat email penerima wajib diisi dengan benar.');

    await k.query(`UPDATE penawaran SET status = 'terkirim', dikirim_at = now(), dikirim_ke = $1 WHERE id = $2`, [ke, id]);
    const { buffer, namaFile } = await buatPdf(id, pengguna, k);
    const namaPerusahaan = await pengaturanService.ambil('nama_perusahaan', k);
    await emailService.kirim({
      ke,
      subjek: `Penawaran ${p.nomor} - ${p.judul}`,
      teks: `Yth. ${p.kontak || 'Bapak/Ibu'},\n\nBersama email ini kami lampirkan penawaran ${p.nomor} untuk "${p.judul}", `
        + `berlaku sampai ${tanggal(p.berlaku_sampai)}.\n\nHormat kami,\n${p.pemilik}\n${namaPerusahaan}`,
      lampiran: [{ filename: namaFile, content: buffer, contentType: 'application/pdf' }],
    });
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: id, aksi: 'kirim', kolom: ['status'] });
    // Tercatat juga di linimasa deal & kontak sebagai aktivitas email
    await k.query(
      `INSERT INTO aktivitas (jenis, judul, isi, selesai_at, kontak_id, deal_id, pemilik_id, dibuat_oleh)
       VALUES ('email', $1, $2, now(), $3, $4, $5, $5)`,
      [`Penawaran ${p.nomor} dikirim`, `Total ${rupiah(p.total)}`, p.kontak_id, p.deal_id, pengguna.id]);
  });
}

/** Terkirim -> diterima (deal otomatis Menang) atau ditolak (wajib alasan). */
async function putuskan(id, keputusan, alasan, pengguna) {
  if (!['diterima', 'ditolak'].includes(keputusan)) throw galatKeadaan('Keputusan tidak valid.');
  return transaksi(async (k) => {
    const p = await ambil(id, pengguna, k);
    if (!p) throw galat404('Penawaran tidak ditemukan.');
    if (p.status !== 'terkirim') throw galatKeadaan('Hanya penawaran berstatus terkirim yang bisa diterima/ditolak.');
    const alasanBersih = teks(alasan);
    if (keputusan === 'ditolak' && !alasanBersih) throw galatKeadaan('Alasan penolakan wajib diisi.');
    await k.query(
      'UPDATE penawaran SET status = $1, diputuskan_at = now(), alasan_ditolak = $2 WHERE id = $3',
      [keputusan, keputusan === 'ditolak' ? alasanBersih : null, id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: id, aksi: keputusan, kolom: ['status'] });
    if (keputusan === 'diterima') {
      const menang = await dealService.tahapJenis('menang', k);
      if (!menang) throw galatKeadaan('Tahap "Menang" belum diatur di pipeline.');
      await dealService.pindahTahap(p.deal_id, menang.id, pengguna, {}, k);
    }
  });
}

/** Membuat revisi baru (draf) dari penawaran terkirim/ditolak. Yang lama menjadi "direvisi" dan terkunci. */
async function revisi(id, pengguna) {
  return transaksi(async (k) => {
    const p = await ambil(id, pengguna, k);
    if (!p) throw galat404('Penawaran tidak ditemukan.');
    if (!['terkirim', 'ditolak'].includes(p.status)) {
      throw galatKeadaan('Revisi hanya bisa dibuat dari penawaran yang terkirim atau ditolak.');
    }
    // Kunci seluruh rangkaian revisi agar dua revisi bersamaan tidak memakai nomor yang sama
    const { rows: [m] } = await k.query(
      `SELECT max(revisi) AS maks FROM (SELECT revisi FROM penawaran WHERE nomor_dasar = $1 FOR UPDATE) x`, [p.nomor_dasar]);
    const rev = Number(m.maks) + 1;
    const peng = await pengaturanService.semua(k);
    const { rows } = await k.query(
      `INSERT INTO penawaran (nomor_dasar, revisi, nomor, penawaran_asal_id, deal_id, kontak_id, perusahaan_id, pemilik_id, judul,
         tanggal, berlaku_sampai, catatan, syarat, diskon_persen, pajak_persen, subtotal, diskon_nilai, dpp, pajak_nilai, total)
       SELECT nomor_dasar, $2, $3, id, deal_id, kontak_id, perusahaan_id, pemilik_id, judul,
         current_date, current_date + $4::int, catatan, syarat, diskon_persen, pajak_persen, subtotal, diskon_nilai, dpp, pajak_nilai, total
       FROM penawaran WHERE id = $1 RETURNING id`,
      [id, rev, nomorRevisi(p.nomor_dasar, rev), Number(peng.penawaran_berlaku_hari || 30)]);
    const baruId = rows[0].id;
    await k.query(
      `INSERT INTO penawaran_item (penawaran_id, urutan, nama, deskripsi, qty, satuan, harga, diskon_persen, subtotal, diskon_nilai, total)
       SELECT $2, urutan, nama, deskripsi, qty, satuan, harga, diskon_persen, subtotal, diskon_nilai, total
       FROM penawaran_item WHERE penawaran_id = $1 AND deleted_at IS NULL`, [id, baruId]);
    await k.query(`UPDATE penawaran SET status = 'direvisi' WHERE id = $1`, [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: id, aksi: 'direvisi', kolom: ['status'] });
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: baruId, aksi: 'buat' });
    return baruId;
  });
}

/** Hanya draf yang boleh dihapus (soft delete). */
async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    const p = await ambil(id, pengguna, k);
    if (!p) throw galat404('Penawaran tidak ditemukan.');
    if (p.status !== 'draf') throw galatKeadaan('Hanya penawaran draf yang bisa dihapus.');
    await k.query('UPDATE penawaran SET deleted_at = now() WHERE id = $1', [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'penawaran', entitasId: id, aksi: 'hapus' });
  });
}

module.exports = {
  STATUS, hitung, pratinjau, nomorBaru, ambil, daftarItem, daftar, untukDeal, riwayatRevisi,
  simpanDraf, buatPdf, kirim, putuskan, revisi, hapus,
};
