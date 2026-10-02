// Service deal & pipeline. Nilai uang selalu string NUMERIC, tidak pernah float.
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const kontakService = require('./kontak');
const perusahaanService = require('./perusahaan');
const { GalatValidasi, teks, teksAtauNull, uang, idAtauNull } = require('./validasi');
const { galat404, tentukanPemilik } = require('./umum');

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
    await cekTautan(k, pengguna, data);
    const pemilikId = await tentukanPemilik(k, pengguna, input.pemilik_id, null);
    const { rows } = await k.query(
      `INSERT INTO deal (judul, nilai, tahap_id, kontak_id, perusahaan_id, lead_id, pemilik_id, target_tutup, catatan, ditutup_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10 = 'terbuka' THEN NULL ELSE now() END) RETURNING id`,
      [data.judul, data.nilai, t.id, data.kontak_id, data.perusahaan_id, extra.lead_id || null, pemilikId,
        data.target_tutup, data.catatan, t.jenis]);
    const id = rows[0].id;
    await k.query(
      'INSERT INTO riwayat_tahap (deal_id, dari_tahap_id, ke_tahap_id, pengguna_id) VALUES ($1, NULL, $2, $3)',
      [id, t.id, pengguna.id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'deal', entitasId: id, aksi: 'buat' });
    return id;
  };
  return klienLuar ? kerja(klienLuar) : transaksi(kerja);
}

module.exports = { daftarTahap, ambil, validasi, cekTautan, buat };
