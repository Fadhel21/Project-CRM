// Controller lead
const leadService = require('../services/lead');
const kontakService = require('../services/kontak');
const perusahaanService = require('../services/perusahaan');
const penggunaService = require('../services/pengguna');
const duplikatService = require('../services/duplikat');
const audit = require('../services/audit');

async function daftar(req, res, next) {
  try {
    const filter = { q: req.query.q || '', status: req.query.status || '', sumber: req.query.sumber || '' };
    const [hasil, sumber] = await Promise.all([
      leadService.daftar(req.pengguna, { ...filter, halaman: req.query.halaman }),
      leadService.daftarSumber(),
    ]);
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/lead/tabel' : 'crm/lead/daftar';
    res.render(tampilan, {
      judul: 'Leads', hasil, filter, q: filter.q, sumber, STATUS: leadService.STATUS, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const riwayat = await audit.riwayat('lead', req.data.id);
    res.render('crm/lead/detail', {
      judul: req.data.nama, data: req.data, riwayat, STATUS: leadService.STATUS, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function tampilForm(req, res, { data, galat = [], duplikat = [], status = 200 }) {
  const [pemilik, sumber] = await Promise.all([
    penggunaService.daftarPemilikTersedia(req.pengguna),
    leadService.daftarSumber(),
  ]);
  res.status(status).render('crm/lead/form', {
    judul: data.id ? 'Ubah Lead' : 'Lead Baru', data, pemilik, sumber, STATUS: leadService.STATUS, galat, duplikat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, { data: { pemilik_id: req.pengguna.id, status: 'baru' } });
  } catch (err) {
    next(err);
  }
}

async function formUbah(req, res, next) {
  try {
    if (req.data.konversi_at) return res.redirect(`/leads/${req.data.id}`);
    await tampilForm(req, res, { data: req.data });
  } catch (err) {
    next(err);
  }
}

async function simpan(req, res, next) {
  const id = req.params.id || null;
  try {
    const hasilId = await leadService.simpan(id, req.body, req.pengguna);
    res.redirect(`/leads/${hasilId}?pesan=${encodeURIComponent('Lead tersimpan.')}`);
  } catch (err) {
    if (err.status !== 422 && err.status !== 409) return next(err);
    const data = { ...req.body, id };
    tampilForm(req, res, { data, galat: err.daftar || [], duplikat: err.duplikat || [], status: err.status }).catch(next);
  }
}

async function hapus(req, res, next) {
  try {
    await leadService.hapus(req.params.id, req.pengguna);
    res.redirect(`/leads?pesan=${encodeURIComponent('Lead dihapus.')}`);
  } catch (err) {
    next(err);
  }
}

async function tampilKonversi(req, res, { input = {}, galat = [], status = 200 }) {
  const lead = req.data;
  const [perusahaan, kontak, duplikat] = await Promise.all([
    perusahaanService.pilihan(req.pengguna),
    kontakService.pilihan(req.pengguna),
    duplikatService.cari({ email: lead.email, telepon: lead.telepon, kecualiLeadId: lead.id }),
  ]);
  const nilaiAwal = {
    perusahaan_mode: lead.nama_perusahaan ? 'baru' : 'tidak',
    perusahaan_nama: lead.nama_perusahaan || '',
    kontak_mode: 'baru',
    buat_deal: 'ya',
    deal_judul: lead.nama_perusahaan ? `Deal ${lead.nama_perusahaan}` : `Deal ${lead.nama}`,
    deal_nilai: '0',
  };
  const gabung = { ...nilaiAwal, ...input };
  // Nilai mode dipakai di ekspresi Alpine, jadi hanya nilai yang dikenal yang boleh lewat
  if (!['baru', 'ada', 'tidak'].includes(gabung.perusahaan_mode)) gabung.perusahaan_mode = 'tidak';
  if (!['baru', 'ada'].includes(gabung.kontak_mode)) gabung.kontak_mode = 'baru';
  if (input.perusahaan_mode && input.buat_deal !== 'ya') gabung.buat_deal = '';
  res.status(status).render('crm/lead/konversi', {
    judul: `Konversi: ${lead.nama}`, lead, input: gabung, perusahaan, kontak, duplikat, galat });
}

async function formKonversi(req, res, next) {
  try {
    if (req.data.konversi_at) return res.redirect(`/leads/${req.data.id}`);
    await tampilKonversi(req, res, {});
  } catch (err) {
    next(err);
  }
}

async function konversi(req, res, next) {
  try {
    await leadService.konversi(req.params.id, req.body, req.pengguna);
    // Halaman detail lead menampilkan tautan ke kontak, perusahaan, dan deal hasil konversi
    res.redirect(`/leads/${req.params.id}?pesan=${encodeURIComponent('Lead berhasil dikonversi.')}`);
  } catch (err) {
    if (err.status === 409) return res.redirect(`/leads/${req.params.id}?pesan=${encodeURIComponent(err.message)}`);
    if (err.status !== 422) return next(err);
    tampilKonversi(req, res, { input: req.body, galat: err.daftar, status: 422 }).catch(next);
  }
}

module.exports = { daftar, detail, formBaru, formUbah, simpan, hapus, formKonversi, konversi };
