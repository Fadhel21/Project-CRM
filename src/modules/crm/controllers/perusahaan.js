// Controller perusahaan
const perusahaanService = require('../services/perusahaan');
const kontakService = require('../services/kontak');
const penggunaService = require('../services/pengguna');
const audit = require('../services/audit');
const dealService = require('../services/deal');

async function daftar(req, res, next) {
  try {
    const q = req.query.q || '';
    const hasil = await perusahaanService.daftar(req.pengguna, { q, halaman: req.query.halaman });
    // Pencarian HTMX hanya mengganti isi tabel
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/perusahaan/tabel' : 'crm/perusahaan/daftar';
    res.render(tampilan, { judul: 'Perusahaan', hasil, q, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const [kontak, riwayat, deal] = await Promise.all([
      kontakService.daftar(req.pengguna, { perusahaanId: req.data.id, halaman: 1 }),
      audit.riwayat('perusahaan', req.data.id),
      dealService.untuk(req.pengguna, { perusahaanId: req.data.id }),
    ]);
    res.render('crm/perusahaan/detail', {
      judul: req.data.nama, data: req.data, kontak, riwayat, deal, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function tampilForm(req, res, { data, galat = [], status = 200 }) {
  const pemilik = await penggunaService.daftarPemilikTersedia(req.pengguna);
  res.status(status).render('crm/perusahaan/form', {
    judul: data.id ? 'Ubah Perusahaan' : 'Perusahaan Baru', data, pemilik, galat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, { data: { pemilik_id: req.pengguna.id } });
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
    const hasilId = await perusahaanService.simpan(id, req.body, req.pengguna);
    res.redirect(`/perusahaan/${hasilId}?pesan=${encodeURIComponent('Perusahaan tersimpan.')}`);
  } catch (err) {
    if (err.status !== 422) return next(err);
    tampilForm(req, res, { data: { ...req.body, id }, galat: err.daftar, status: 422 }).catch(next);
  }
}

async function hapus(req, res, next) {
  try {
    await perusahaanService.hapus(req.params.id, req.pengguna);
    res.redirect(`/perusahaan?pesan=${encodeURIComponent('Perusahaan dihapus.')}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { daftar, detail, formBaru, formUbah, simpan, hapus };
