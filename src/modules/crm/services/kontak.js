// Service kontak. Semua query menerapkan filter pemilik sesuai peran pengguna.
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const perusahaanService = require('./perusahaan');
const duplikatService = require('./duplikat');
const { GalatValidasi, teks, teksAtauNull, emailValid, normalTelepon, idAtauNull } = require('./validasi');
const { UKURAN_HALAMAN, galat404, nomorHalaman, tentukanPemilik, polaCari } = require('./umum');

const KOLOM_UBAH = ['nama', 'jabatan', 'email', 'telepon', 'perusahaan_id', 'catatan', 'pemilik_id'];

async function daftar(pengguna, { q = '', halaman = 1, perusahaanId = null } = {}) {
  const params = [];
  let where = `k.deleted_at IS NULL AND ${filterPemilik(pengguna, 'k.pemilik_id', params)}`;
  if (teks(q)) {
    params.push(polaCari(teks(q)));
    const n = params.length;
    where += ` AND (k.nama ILIKE $${n} OR k.email ILIKE $${n} OR k.telepon ILIKE $${n} OR p.nama ILIKE $${n})`;
  }
  if (perusahaanId) {
    params.push(perusahaanId);
    where += ` AND k.perusahaan_id = $${params.length}`;
  }
  const dari = `FROM kontak k
    LEFT JOIN perusahaan p ON p.id = k.perusahaan_id AND p.deleted_at IS NULL
    JOIN pengguna u ON u.id = k.pemilik_id`;
  const hal = nomorHalaman(halaman);
  const total = Number((await query(`SELECT count(*) ${dari} WHERE ${where}`, params)).rows[0].count);
  params.push(UKURAN_HALAMAN, (hal - 1) * UKURAN_HALAMAN);
  const { rows } = await query(
    `SELECT k.id, k.nama, k.jabatan, k.email, k.telepon, k.perusahaan_id, p.nama AS perusahaan, u.nama AS pemilik
     ${dari} WHERE ${where} ORDER BY k.nama LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { baris: rows, total, halaman: hal, jumlahHalaman: Math.max(1, Math.ceil(total / UKURAN_HALAMAN)) };
}

async function ambil(id, pengguna, klien) {
  const params = [id];
  const { rows } = await query(
    `SELECT k.*, p.nama AS perusahaan, u.nama AS pemilik
     FROM kontak k
     LEFT JOIN perusahaan p ON p.id = k.perusahaan_id AND p.deleted_at IS NULL
     JOIN pengguna u ON u.id = k.pemilik_id
     WHERE k.id = $1 AND k.deleted_at IS NULL AND ${filterPemilik(pengguna, 'k.pemilik_id', params)}
     ${klien ? 'FOR UPDATE OF k' : ''}`, params, klien);
  return rows[0] || null;
}

function validasi(input) {
  const data = {
    nama: teks(input.nama),
    jabatan: teksAtauNull(input.jabatan),
    email: teksAtauNull(input.email)?.toLowerCase() ?? null,
    telepon: teksAtauNull(input.telepon),
    perusahaan_id: idAtauNull(input.perusahaan_id),
    catatan: teksAtauNull(input.catatan),
  };
  const galat = [];
  if (!data.nama) galat.push('Nama kontak wajib diisi.');
  if (data.email && !emailValid(data.email)) galat.push('Format email tidak valid.');
  if (galat.length) throw new GalatValidasi(galat);
  return data;
}

/**
 * Buat (id kosong) atau ubah kontak. Bila ada duplikat dan input.abaikan_duplikat bukan 'ya',
 * melempar error 409 berisi daftar duplikat (tidak ada penggabungan otomatis).
 */
async function simpan(id, input, pengguna, klienLuar) {
  const data = validasi(input);
  const kerja = async (k) => {
    let lama = null;
    if (id) {
      lama = await ambil(id, pengguna, k);
      if (!lama) throw galat404('Kontak tidak ditemukan.');
    }
    if (data.perusahaan_id && String(data.perusahaan_id) !== String(lama?.perusahaan_id ?? '')) {
      if (!(await perusahaanService.ambil(data.perusahaan_id, pengguna, k))) {
        throw new GalatValidasi(['Perusahaan tidak ditemukan atau bukan hak Anda.']);
      }
    }
    const emailBerubah = !lama || data.email !== lama.email || normalTelepon(data.telepon) !== lama.telepon_normal;
    if (emailBerubah && input.abaikan_duplikat !== 'ya') {
      const duplikat = await duplikatService.cari({ email: data.email, telepon: data.telepon, kecualiKontakId: id }, k);
      if (duplikat.length) throw duplikatService.galatDuplikat(duplikat);
    }
    data.pemilik_id = await tentukanPemilik(k, pengguna, input.pemilik_id, lama && String(lama.pemilik_id));
    const nilai = [data.nama, data.jabatan, data.email, data.telepon, normalTelepon(data.telepon),
      data.perusahaan_id, data.catatan, data.pemilik_id];
    if (id) {
      await k.query(
        `UPDATE kontak SET nama=$1, jabatan=$2, email=$3, telepon=$4, telepon_normal=$5, perusahaan_id=$6,
           catatan=$7, pemilik_id=$8 WHERE id=$9`, [...nilai, id]);
      const kolom = audit.kolomBerubah(lama, data).filter((c) => KOLOM_UBAH.includes(c));
      if (kolom.length) await audit.catat(k, { penggunaId: pengguna.id, entitas: 'kontak', entitasId: id, aksi: 'ubah', kolom });
      return id;
    }
    const baruId = (await k.query(
      `INSERT INTO kontak (nama, jabatan, email, telepon, telepon_normal, perusahaan_id, catatan, pemilik_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, nilai)).rows[0].id;
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'kontak', entitasId: baruId, aksi: 'buat' });
    return baruId;
  };
  return klienLuar ? kerja(klienLuar) : transaksi(kerja);
}

async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    if (!(await ambil(id, pengguna, k))) throw galat404('Kontak tidak ditemukan.');
    await k.query('UPDATE kontak SET deleted_at = now() WHERE id = $1', [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'kontak', entitasId: id, aksi: 'hapus' });
  });
}

/** Pilihan kontak untuk dropdown. */
async function pilihan(pengguna) {
  const params = [];
  const { rows } = await query(
    `SELECT id, nama FROM kontak k WHERE deleted_at IS NULL AND ${filterPemilik(pengguna, 'k.pemilik_id', params)}
     ORDER BY nama LIMIT 1000`, params);
  return rows;
}

module.exports = { daftar, ambil, simpan, hapus, pilihan };
