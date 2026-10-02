// Service perusahaan. Semua query menerapkan filter pemilik sesuai peran pengguna.
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const { GalatValidasi, teks, teksAtauNull, emailValid, normalTelepon } = require('./validasi');
const { UKURAN_HALAMAN, galat404, nomorHalaman, tentukanPemilik, polaCari } = require('./umum');

const KOLOM_UBAH = ['nama', 'industri', 'email', 'telepon', 'situs', 'alamat', 'pemilik_id'];

async function daftar(pengguna, { q = '', halaman = 1 } = {}) {
  const params = [];
  let where = `p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}`;
  if (teks(q)) {
    params.push(polaCari(teks(q)));
    where += ` AND (p.nama ILIKE $${params.length} OR p.industri ILIKE $${params.length})`;
  }
  const hal = nomorHalaman(halaman);
  const total = Number((await query(`SELECT count(*) FROM perusahaan p WHERE ${where}`, params)).rows[0].count);
  params.push(UKURAN_HALAMAN, (hal - 1) * UKURAN_HALAMAN);
  const { rows } = await query(
    `SELECT p.id, p.nama, p.industri, p.telepon, u.nama AS pemilik,
       (SELECT count(*) FROM kontak k WHERE k.perusahaan_id = p.id AND k.deleted_at IS NULL) AS jumlah_kontak
     FROM perusahaan p JOIN pengguna u ON u.id = p.pemilik_id
     WHERE ${where} ORDER BY p.nama LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { baris: rows, total, halaman: hal, jumlahHalaman: Math.max(1, Math.ceil(total / UKURAN_HALAMAN)) };
}

/** Satu perusahaan bila pengguna berhak melihatnya, selain itu null. */
async function ambil(id, pengguna, klien) {
  const params = [id];
  const { rows } = await query(
    `SELECT p.*, u.nama AS pemilik FROM perusahaan p JOIN pengguna u ON u.id = p.pemilik_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}
     ${klien ? 'FOR UPDATE OF p' : ''}`, params, klien);
  return rows[0] || null;
}

/** Pilihan perusahaan untuk dropdown (yang boleh dilihat pengguna). */
async function pilihan(pengguna) {
  const params = [];
  const { rows } = await query(
    `SELECT id, nama FROM perusahaan p WHERE deleted_at IS NULL AND ${filterPemilik(pengguna, 'p.pemilik_id', params)}
     ORDER BY nama LIMIT 1000`, params);
  return rows;
}

function validasi(input) {
  const data = {
    nama: teks(input.nama),
    industri: teksAtauNull(input.industri),
    email: teksAtauNull(input.email)?.toLowerCase() ?? null,
    telepon: teksAtauNull(input.telepon),
    situs: teksAtauNull(input.situs),
    alamat: teksAtauNull(input.alamat),
  };
  const galat = [];
  if (!data.nama) galat.push('Nama perusahaan wajib diisi.');
  if (data.email && !emailValid(data.email)) galat.push('Format email tidak valid.');
  if (galat.length) throw new GalatValidasi(galat);
  return data;
}

/** Buat (id kosong) atau ubah perusahaan. Mengembalikan id. */
async function simpan(id, input, pengguna, klienLuar) {
  const data = validasi(input);
  const kerja = async (k) => {
    let lama = null;
    if (id) {
      lama = await ambil(id, pengguna, k);
      if (!lama) throw galat404('Perusahaan tidak ditemukan.');
    }
    data.pemilik_id = await tentukanPemilik(k, pengguna, input.pemilik_id, lama && String(lama.pemilik_id));
    const nilai = [data.nama, data.industri, data.email, data.telepon, normalTelepon(data.telepon),
      data.situs, data.alamat, data.pemilik_id];
    let hasilId = id;
    if (id) {
      await k.query(
        `UPDATE perusahaan SET nama=$1, industri=$2, email=$3, telepon=$4, telepon_normal=$5, situs=$6,
           alamat=$7, pemilik_id=$8 WHERE id=$9`, [...nilai, id]);
      const kolom = audit.kolomBerubah(lama, data).filter((c) => KOLOM_UBAH.includes(c));
      if (kolom.length) await audit.catat(k, { penggunaId: pengguna.id, entitas: 'perusahaan', entitasId: id, aksi: 'ubah', kolom });
    } else {
      hasilId = (await k.query(
        `INSERT INTO perusahaan (nama, industri, email, telepon, telepon_normal, situs, alamat, pemilik_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, nilai)).rows[0].id;
      await audit.catat(k, { penggunaId: pengguna.id, entitas: 'perusahaan', entitasId: hasilId, aksi: 'buat' });
    }
    return hasilId;
  };
  return klienLuar ? kerja(klienLuar) : transaksi(kerja);
}

/** Soft delete. Kontak yang tertaut tidak diubah; tautannya disembunyikan di tampilan. */
async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    if (!(await ambil(id, pengguna, k))) throw galat404('Perusahaan tidak ditemukan.');
    await k.query('UPDATE perusahaan SET deleted_at = now() WHERE id = $1', [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'perusahaan', entitasId: id, aksi: 'hapus' });
  });
}

module.exports = { daftar, ambil, pilihan, simpan, hapus };
