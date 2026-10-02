// Service aktivitas (telepon, rapat, email, tugas, catatan) dan linimasa gabungan
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const kontakService = require('./kontak');
const dealService = require('./deal');
const leadService = require('./lead');
const { GalatValidasi, teks, teksAtauNull, idAtauNull } = require('./validasi');
const { galat404, tentukanPemilik } = require('./umum');

const JENIS = { telepon: 'Telepon', rapat: 'Rapat', email: 'Email', tugas: 'Tugas', catatan: 'Catatan' };
const POLA_WAKTU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validasi(input) {
  const data = {
    jenis: teks(input.jenis),
    judul: teks(input.judul),
    isi: teksAtauNull(input.isi),
    jadwal_at: teksAtauNull(input.jadwal_at),
    kontak_id: idAtauNull(input.kontak_id),
    deal_id: idAtauNull(input.deal_id),
    lead_id: idAtauNull(input.lead_id),
  };
  const galat = [];
  if (!JENIS[data.jenis]) galat.push('Jenis aktivitas tidak valid.');
  if (data.jenis === 'catatan') {
    if (!data.isi) galat.push('Isi catatan wajib diisi.');
    if (!data.judul) data.judul = 'Catatan';
  } else if (!data.judul) {
    galat.push('Judul aktivitas wajib diisi.');
  }
  if (data.jadwal_at && !POLA_WAKTU.test(data.jadwal_at)) galat.push('Format waktu tidak valid.');
  if (data.jenis === 'tugas' && !data.jadwal_at) galat.push('Tugas wajib punya tenggat.');
  if (!data.kontak_id && !data.deal_id && !data.lead_id) galat.push('Aktivitas harus terhubung ke kontak, deal, atau lead.');
  if (galat.length) throw new GalatValidasi(galat);
  return data;
}

/**
 * Membuat aktivitas. Kontak/deal/lead yang ditautkan harus boleh dilihat pengguna.
 * Aktivitas pada deal otomatis ikut tertaut ke kontak deal tersebut agar tampil di linimasa kontak.
 * Penanggung jawab tugas boleh ditugaskan (aturan sama dengan kepemilikan data); jenis lain milik pembuat.
 */
async function buat(input, pengguna) {
  const data = validasi(input);
  return transaksi(async (k) => {
    // Kontak yang dikirim pengguna selalu diperiksa haknya
    if (data.kontak_id && !(await kontakService.ambil(data.kontak_id, pengguna, k))) {
      throw new GalatValidasi(['Kontak tidak ditemukan atau bukan hak Anda.']);
    }
    if (data.deal_id) {
      const deal = await dealService.ambil(data.deal_id, pengguna, k);
      if (!deal) throw new GalatValidasi(['Deal tidak ditemukan atau bukan hak Anda.']);
      // Kontak milik deal ikut ditautkan (berasal dari data deal, bukan dari input)
      if (!data.kontak_id && deal.kontak_id) data.kontak_id = String(deal.kontak_id);
    }
    if (data.lead_id && !(await leadService.ambil(data.lead_id, pengguna, k))) {
      throw new GalatValidasi(['Lead tidak ditemukan atau bukan hak Anda.']);
    }
    const pemilikId = data.jenis === 'tugas'
      ? await tentukanPemilik(k, pengguna, input.pemilik_id, null)
      : String(pengguna.id);
    // Telepon/rapat/email/catatan tanpa waktu dianggap sudah terjadi sekarang
    const selesai = data.jenis !== 'tugas' && data.jenis !== 'rapat';
    const { rows } = await k.query(
      `INSERT INTO aktivitas (jenis, judul, isi, jadwal_at, selesai_at, kontak_id, deal_id, lead_id, pemilik_id, dibuat_oleh)
       VALUES ($1, $2, $3, $4::timestamptz, CASE WHEN $5 THEN COALESCE($4::timestamptz, now()) END, $6, $7, $8, $9, $10)
       RETURNING id`,
      [data.jenis, data.judul, data.isi, data.jadwal_at, selesai, data.kontak_id, data.deal_id, data.lead_id,
        pemilikId, pengguna.id]);
    return rows[0].id;
  });
}

/** Aktivitas yang boleh diubah: penanggung jawabnya dalam lingkup pengguna, atau pengguna pembuatnya. */
async function ambil(id, pengguna, klien) {
  const params = [id, pengguna.id];
  const { rows } = await query(
    `SELECT a.*, u.nama AS pemilik FROM aktivitas a JOIN pengguna u ON u.id = a.pemilik_id
     WHERE a.id = $1 AND a.deleted_at IS NULL
       AND (a.dibuat_oleh = $2 OR ${filterPemilik(pengguna, 'a.pemilik_id', params)})
     ${klien ? 'FOR UPDATE OF a' : ''}`, params, klien);
  return rows[0] || null;
}

async function tandaiSelesai(id, selesai, pengguna) {
  return transaksi(async (k) => {
    if (!(await ambil(id, pengguna, k))) throw galat404('Aktivitas tidak ditemukan.');
    await k.query('UPDATE aktivitas SET selesai_at = CASE WHEN $1 THEN now() END WHERE id = $2', [selesai, id]);
    return ambilUntukTampil(id, k);
  });
}

async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    if (!(await ambil(id, pengguna, k))) throw galat404('Aktivitas tidak ditemukan.');
    await k.query('UPDATE aktivitas SET deleted_at = now() WHERE id = $1', [id]);
  });
}

const KOLOM_TAMPIL = `'aktivitas' AS sumber, a.id, a.jenis, a.judul, a.isi, a.jadwal_at, a.selesai_at,
  a.kontak_id, a.deal_id, a.lead_id, u.nama AS pemilik, ub.nama AS pembuat,
  COALESCE(a.jadwal_at, a.created_at) AS waktu, NULL AS dari, NULL AS ke`;

async function ambilUntukTampil(id, klien) {
  const { rows } = await query(
    `SELECT ${KOLOM_TAMPIL}, k.nama AS kontak, d.judul AS deal, l.nama AS lead
     FROM aktivitas a JOIN pengguna u ON u.id = a.pemilik_id JOIN pengguna ub ON ub.id = a.dibuat_oleh
     LEFT JOIN kontak k ON k.id = a.kontak_id LEFT JOIN deal d ON d.id = a.deal_id LEFT JOIN lead l ON l.id = a.lead_id
     WHERE a.id = $1`, [id], klien);
  return rows[0];
}

/**
 * Linimasa gabungan untuk satu kontak, deal, atau lead: aktivitas, tugas, catatan, email,
 * dan perubahan tahap deal, diurutkan menurut waktu (terbaru di atas).
 * Hak akses ke entitas induk sudah diperiksa middleware; perubahan tahap pada linimasa kontak
 * tetap disaring hanya untuk deal yang boleh dilihat pengguna.
 */
async function linimasa(pengguna, { kontakId = null, dealId = null, leadId = null }) {
  const params = [];
  let whereAkt;
  let tahap = '';
  if (dealId) {
    params.push(dealId);
    whereAkt = 'a.deal_id = $1';
    tahap = `SELECT 'tahap', r.id, 'tahap', 'Perubahan tahap', NULL, NULL, NULL, NULL, r.deal_id, NULL,
               ur.nama, ur.nama, r.created_at, dari.nama, ke.nama
             FROM riwayat_tahap r JOIN tahap_pipeline ke ON ke.id = r.ke_tahap_id
             LEFT JOIN tahap_pipeline dari ON dari.id = r.dari_tahap_id LEFT JOIN pengguna ur ON ur.id = r.pengguna_id
             WHERE r.deal_id = $1`;
  } else if (kontakId) {
    params.push(kontakId);
    whereAkt = 'a.kontak_id = $1';
    const filterDeal = filterPemilik(pengguna, 'd.pemilik_id', params);
    tahap = `SELECT 'tahap', r.id, 'tahap', d.judul, NULL, NULL, NULL, NULL, r.deal_id, NULL,
               ur.nama, ur.nama, r.created_at, dari.nama, ke.nama
             FROM riwayat_tahap r JOIN deal d ON d.id = r.deal_id
             JOIN tahap_pipeline ke ON ke.id = r.ke_tahap_id
             LEFT JOIN tahap_pipeline dari ON dari.id = r.dari_tahap_id LEFT JOIN pengguna ur ON ur.id = r.pengguna_id
             WHERE d.kontak_id = $1 AND d.deleted_at IS NULL AND ${filterDeal}`;
  } else if (leadId) {
    params.push(leadId);
    whereAkt = 'a.lead_id = $1';
  } else {
    return [];
  }
  const { rows } = await query(
    `SELECT * FROM (
       SELECT ${KOLOM_TAMPIL}
       FROM aktivitas a JOIN pengguna u ON u.id = a.pemilik_id JOIN pengguna ub ON ub.id = a.dibuat_oleh
       WHERE a.deleted_at IS NULL AND ${whereAkt}
       ${tahap ? `UNION ALL ${tahap}` : ''}
     ) x ORDER BY waktu DESC, id DESC LIMIT 200`, params);
  return rows;
}

const FILTER_TUGAS = {
  terlambat: 'a.selesai_at IS NULL AND a.jadwal_at < now()',
  hari_ini: `a.selesai_at IS NULL AND a.jadwal_at >= date_trunc('day', now()) AND a.jadwal_at < date_trunc('day', now()) + interval '1 day'`,
  mendatang: `a.selesai_at IS NULL AND a.jadwal_at >= date_trunc('day', now()) + interval '1 day'`,
  terbuka: 'a.selesai_at IS NULL',
  selesai: 'a.selesai_at IS NOT NULL',
};

/** Daftar tugas & rapat dalam lingkup pengguna, dengan filter waktu. */
async function daftarTugas(pengguna, { filter = 'terbuka', pemilikId = '' } = {}) {
  const params = [];
  let where = `a.deleted_at IS NULL AND a.jenis IN ('tugas', 'rapat') AND ${filterPemilik(pengguna, 'a.pemilik_id', params)}
    AND ${FILTER_TUGAS[filter] || FILTER_TUGAS.terbuka}`;
  if (idAtauNull(pemilikId)) {
    params.push(pemilikId);
    where += ` AND a.pemilik_id = $${params.length}`;
  }
  const urut = filter === 'selesai' ? 'a.selesai_at DESC' : 'a.jadwal_at ASC';
  const { rows } = await query(
    `SELECT ${KOLOM_TAMPIL}, k.nama AS kontak, d.judul AS deal, l.nama AS lead
     FROM aktivitas a JOIN pengguna u ON u.id = a.pemilik_id JOIN pengguna ub ON ub.id = a.dibuat_oleh
     LEFT JOIN kontak k ON k.id = a.kontak_id LEFT JOIN deal d ON d.id = a.deal_id LEFT JOIN lead l ON l.id = a.lead_id
     WHERE ${where} ORDER BY ${urut} LIMIT 300`, params);
  return rows;
}

/** Jumlah tugas terlambat & hari ini milik pengguna (untuk lencana di menu). */
async function ringkasTugas(pengguna) {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE ${FILTER_TUGAS.terlambat}) AS terlambat,
            count(*) FILTER (WHERE ${FILTER_TUGAS.hari_ini}) AS hari_ini
     FROM aktivitas a WHERE a.deleted_at IS NULL AND a.jenis IN ('tugas', 'rapat') AND a.pemilik_id = $1`, [pengguna.id]);
  return { terlambat: Number(rows[0].terlambat), hariIni: Number(rows[0].hari_ini) };
}

module.exports = { JENIS, buat, ambil, tandaiSelesai, hapus, linimasa, daftarTugas, ringkasTugas, ambilUntukTampil };
