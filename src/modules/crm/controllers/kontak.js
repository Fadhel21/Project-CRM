// Controller kontak
const kontakService = require('../services/kontak');
const perusahaanService = require('../services/perusahaan');
const penggunaService = require('../services/pengguna');
const audit = require('../services/audit');
const dealService = require('../services/deal');

async function daftar(req, res, next) {
  try {
    const q = req.query.q || '';
    const hasil = await kontakService.daftar(req.pengguna, { q, halaman: req.query.halaman });
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/kontak/tabel' : 'crm/kontak/daftar';
    res.render(tampilan, { judul: 'Kontak', hasil, q, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const [riwayat, deal] = await Promise.all([
      audit.riwayat('kontak', req.data.id),
      dealService.untuk(req.pengguna, { kontakId: req.data.id }),
    ]);
    res.render('crm/kontak/detail', { judul: req.data.nama, data: req.data, riwayat, deal, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function tampilForm(req, res, { data, galat = [], duplikat = [], status = 200 }) {
  const [pemilik, perusahaan] = await Promise.all([
    penggunaService.daftarPemilikTersedia(req.pengguna),
    perusahaanService.pilihan(req.pengguna),
  ]);
  res.status(status).render('crm/kontak/form', {
    judul: data.id ? 'Ubah Kontak' : 'Kontak Baru', data, pemilik, perusahaan, galat, duplikat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, { data: { pemilik_id: req.pengguna.id, perusahaan_id: req.query.perusahaan_id } });
  } catch (err) {
    next(err);
  }
}

async function formUbah(req, res, next) {
  try {
    await tampilForm(req, res, { data: req.data });
  } catch (err) {
    next(err);
  }
}

async function simpan(req, res, next) {
  const id = req.params.id || null;
  try {
    const hasilId = await kontakService.simpan(id, req.body, req.pengguna);
    res.redirect(`/kontak/${hasilId}?pesan=${encodeURIComponent('Kontak tersimpan.')}`);
  } catch (err) {
    if (err.status !== 422 && err.status !== 409) return next(err);
    const data = { ...req.body, id };
    tampilForm(req, res, { data, galat: err.daftar || [], duplikat: err.duplikat || [], status: err.status }).catch(next);
  }
}

async function hapus(req, res, next) {
  try {
    await kontakService.hapus(req.params.id, req.pengguna);
    res.redirect(`/kontak?pesan=${encodeURIComponent('Kontak dihapus.')}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { daftar, detail, formBaru, formUbah, simpan, hapus };
