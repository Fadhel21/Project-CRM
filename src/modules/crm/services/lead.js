// Service lead: daftar, simpan, hapus (soft), dan konversi ke kontak/perusahaan/deal
const { query, transaksi } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const audit = require('./audit');
const duplikatService = require('./duplikat');
const kontakService = require('./kontak');
const perusahaanService = require('./perusahaan');
const dealService = require('./deal');
const { GalatValidasi, teks, teksAtauNull, emailValid, normalTelepon, idAtauNull } = require('./validasi');
const { UKURAN_HALAMAN, galat404, nomorHalaman, tentukanPemilik, polaCari } = require('./umum');

const STATUS = { baru: 'Baru', dihubungi: 'Dihubungi', kualifikasi: 'Kualifikasi', tidak_layak: 'Tidak layak' };
const KOLOM_UBAH = ['nama', 'nama_perusahaan', 'jabatan', 'email', 'telepon', 'sumber_id', 'status', 'catatan', 'pemilik_id'];

async function daftarSumber(klien) {
  const { rows } = await query(
    'SELECT id, nama FROM sumber_lead WHERE aktif AND deleted_at IS NULL ORDER BY urutan, nama', [], klien);
  return rows;
}

/** filter.status: kosong = semua yang belum dikonversi; 'dikonversi' = yang sudah dikonversi. */
async function daftar(pengguna, { q = '', status = '', sumber = '', halaman = 1 } = {}) {
  const params = [];
  let where = `l.deleted_at IS NULL AND ${filterPemilik(pengguna, 'l.pemilik_id', params)}`;
  if (status === 'dikonversi') where += ' AND l.konversi_at IS NOT NULL';
  else {
    where += ' AND l.konversi_at IS NULL';
    if (STATUS[status]) {
      params.push(status);
      where += ` AND l.status = $${params.length}`;
    }
  }
  if (idAtauNull(sumber)) {
    params.push(sumber);
    where += ` AND l.sumber_id = $${params.length}`;
  }
  if (teks(q)) {
    params.push(polaCari(teks(q)));
    const n = params.length;
    where += ` AND (l.nama ILIKE $${n} OR l.nama_perusahaan ILIKE $${n} OR l.email ILIKE $${n} OR l.telepon ILIKE $${n})`;
  }
  const hal = nomorHalaman(halaman);
  const total = Number((await query(`SELECT count(*) FROM lead l WHERE ${where}`, params)).rows[0].count);
  params.push(UKURAN_HALAMAN, (hal - 1) * UKURAN_HALAMAN);
  const { rows } = await query(
    `SELECT l.id, l.nama, l.nama_perusahaan, l.email, l.telepon, l.status, l.konversi_at, l.created_at,
       s.nama AS sumber, u.nama AS pemilik
     FROM lead l LEFT JOIN sumber_lead s ON s.id = l.sumber_id JOIN pengguna u ON u.id = l.pemilik_id
     WHERE ${where} ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { baris: rows, total, halaman: hal, jumlahHalaman: Math.max(1, Math.ceil(total / UKURAN_HALAMAN)) };
}

async function ambil(id, pengguna, klien) {
  const params = [id];
  const { rows } = await query(
    `SELECT l.*, s.nama AS sumber, u.nama AS pemilik, uk.nama AS dikonversi_oleh
     FROM lead l
     LEFT JOIN sumber_lead s ON s.id = l.sumber_id
     JOIN pengguna u ON u.id = l.pemilik_id
     LEFT JOIN pengguna uk ON uk.id = l.konversi_oleh
     WHERE l.id = $1 AND l.deleted_at IS NULL AND ${filterPemilik(pengguna, 'l.pemilik_id', params)}
     ${klien ? 'FOR UPDATE OF l' : ''}`, params, klien);
  return rows[0] || null;
}

function validasi(input) {
  const data = {
    nama: teks(input.nama),
    nama_perusahaan: teksAtauNull(input.nama_perusahaan),
    jabatan: teksAtauNull(input.jabatan),
    email: teksAtauNull(input.email)?.toLowerCase() ?? null,
    telepon: teksAtauNull(input.telepon),
    sumber_id: idAtauNull(input.sumber_id),
    status: teks(input.status) || 'baru',
    catatan: teksAtauNull(input.catatan),
  };
  const galat = [];
  if (!data.nama) galat.push('Nama lead wajib diisi.');
  if (data.email && !emailValid(data.email)) galat.push('Format email tidak valid.');
  if (!STATUS[data.status]) galat.push('Status lead tidak valid.');
  if (galat.length) throw new GalatValidasi(galat);
  return data;
}

async function simpan(id, input, pengguna, klienLuar) {
  const data = validasi(input);
  const kerja = async (k) => {
    let lama = null;
    if (id) {
      lama = await ambil(id, pengguna, k);
      if (!lama) throw galat404('Lead tidak ditemukan.');
      if (lama.konversi_at) throw new GalatValidasi(['Lead yang sudah dikonversi tidak bisa diubah.']);
    }
    if (data.sumber_id && !(await daftarSumber(k)).some((s) => String(s.id) === String(data.sumber_id))) {
      throw new GalatValidasi(['Sumber lead tidak valid.']);
    }
    const kontakBerubah = !lama || data.email !== lama.email || normalTelepon(data.telepon) !== lama.telepon_normal;
    if (kontakBerubah && input.abaikan_duplikat !== 'ya') {
      const duplikat = await duplikatService.cari({ email: data.email, telepon: data.telepon, kecualiLeadId: id }, k);
      if (duplikat.length) throw duplikatService.galatDuplikat(duplikat);
    }
    data.pemilik_id = await tentukanPemilik(k, pengguna, input.pemilik_id, lama && String(lama.pemilik_id));
    const nilai = [data.nama, data.nama_perusahaan, data.jabatan, data.email, data.telepon, normalTelepon(data.telepon),
      data.sumber_id, data.status, data.catatan, data.pemilik_id];
    if (id) {
      await k.query(
        `UPDATE lead SET nama=$1, nama_perusahaan=$2, jabatan=$3, email=$4, telepon=$5, telepon_normal=$6,
           sumber_id=$7, status=$8, catatan=$9, pemilik_id=$10 WHERE id=$11`, [...nilai, id]);
      const kolom = audit.kolomBerubah(lama, data).filter((c) => KOLOM_UBAH.includes(c));
      if (kolom.length) await audit.catat(k, { penggunaId: pengguna.id, entitas: 'lead', entitasId: id, aksi: 'ubah', kolom });
      return id;
    }
    const baruId = (await k.query(
      `INSERT INTO lead (nama, nama_perusahaan, jabatan, email, telepon, telepon_normal, sumber_id, status, catatan, pemilik_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, nilai)).rows[0].id;
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'lead', entitasId: baruId, aksi: 'buat' });
    return baruId;
  };
  return klienLuar ? kerja(klienLuar) : transaksi(kerja);
}

async function hapus(id, pengguna) {
  return transaksi(async (k) => {
    const lama = await ambil(id, pengguna, k);
    if (!lama) throw galat404('Lead tidak ditemukan.');
    if (lama.konversi_at) throw new GalatValidasi(['Lead yang sudah dikonversi tidak bisa dihapus.']);
    await k.query('UPDATE lead SET deleted_at = now() WHERE id = $1', [id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'lead', entitasId: id, aksi: 'hapus' });
  });
}

/**
 * Konversi lead dalam SATU transaksi: perusahaan (baru/pilih/tanpa), kontak (baru/pilih),
 * dan deal (opsional). Semua hasil dimiliki oleh pemilik lead. Lead tidak dihapus,
 * hanya ditandai konversi_at dan ditautkan ke hasilnya. Bila satu langkah gagal, semua dibatalkan.
 */
async function konversi(id, input, pengguna) {
  return transaksi(async (k) => {
    const lead = await ambil(id, pengguna, k);
    if (!lead) throw galat404('Lead tidak ditemukan.');
    if (lead.konversi_at) throw Object.assign(new Error('Lead ini sudah dikonversi.'), { status: 409 });
    if (lead.status === 'tidak_layak') throw new GalatValidasi(['Lead berstatus "Tidak layak" tidak bisa dikonversi.']);
    const pemilik_id = String(lead.pemilik_id);

    let perusahaanId = null;
    const modePerusahaan = input.perusahaan_mode || 'tidak';
    if (modePerusahaan === 'baru') {
      perusahaanId = await perusahaanService.simpan(null, {
        nama: teks(input.perusahaan_nama) || lead.nama_perusahaan, pemilik_id }, pengguna, k);
    } else if (modePerusahaan === 'ada') {
      perusahaanId = idAtauNull(input.perusahaan_id);
      if (!perusahaanId || !(await perusahaanService.ambil(perusahaanId, pengguna, k))) {
        throw new GalatValidasi(['Pilih perusahaan yang valid.']);
      }
    }

    let kontakId;
    if (input.kontak_mode === 'ada') {
      kontakId = idAtauNull(input.kontak_id);
      if (!kontakId || !(await kontakService.ambil(kontakId, pengguna, k))) {
        throw new GalatValidasi(['Pilih kontak yang valid.']);
      }
    } else {
      // Duplikat sudah ditampilkan di formulir konversi; pengguna memilih membuat kontak baru
      kontakId = await kontakService.simpan(null, {
        nama: lead.nama, jabatan: lead.jabatan, email: lead.email, telepon: lead.telepon,
        perusahaan_id: perusahaanId, catatan: lead.catatan, pemilik_id, abaikan_duplikat: 'ya' }, pengguna, k);
    }

    let dealId = null;
    if (input.buat_deal === 'ya') {
      dealId = await dealService.buat({
        judul: input.deal_judul, nilai: input.deal_nilai, target_tutup: input.deal_target_tutup,
        kontak_id: kontakId, perusahaan_id: perusahaanId, pemilik_id }, pengguna, k, { lead_id: id });
    }

    await k.query(
      `UPDATE lead SET konversi_at = now(), konversi_oleh = $1, kontak_id = $2, perusahaan_id = $3, deal_id = $4,
         status = 'kualifikasi' WHERE id = $5`, [pengguna.id, kontakId, perusahaanId, dealId, id]);
    await audit.catat(k, { penggunaId: pengguna.id, entitas: 'lead', entitasId: id, aksi: 'konversi' });
    return { kontakId, perusahaanId, dealId };
  });
}

module.exports = { STATUS, daftarSumber, daftar, ambil, simpan, hapus, konversi };
