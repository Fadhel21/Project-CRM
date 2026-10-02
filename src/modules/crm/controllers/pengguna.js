// Controller login/logout dan pengelolaan pengguna
const penggunaService = require('../services/pengguna');
const { buatSesi, hapusSesi } = require('../../../middleware/auth');
const { akunDemoTampil } = require('../../../config/demo');

// Pembatas percobaan login sederhana di memori: maks 10 gagal per 15 menit per IP+email
const percobaan = new Map();
const JENDELA_MS = 15 * 60 * 1000;
const MAKS_GAGAL = 10;

function kunciPercobaan(req) {
  return `${req.ip}|${String(req.body.email || '').toLowerCase()}`;
}

function terkunci(kunci) {
  const c = percobaan.get(kunci);
  if (!c) return false;
  if (Date.now() - c.mulai > JENDELA_MS) {
    percobaan.delete(kunci);
    return false;
  }
  return c.jumlah >= MAKS_GAGAL;
}

function catatGagal(kunci) {
  const c = percobaan.get(kunci);
  if (!c || Date.now() - c.mulai > JENDELA_MS) percobaan.set(kunci, { mulai: Date.now(), jumlah: 1 });
  else c.jumlah += 1;
}

function formLogin(req, res) {
  res.render('login', { akunDemo: akunDemoTampil(), judul: 'Masuk', galat: null, email: '' });
}

async function login(req, res, next) {
  try {
    const { email = '', password = '' } = req.body;
    const kunci = kunciPercobaan(req);
    if (terkunci(kunci)) {
      return res.status(429).render('login', { akunDemo: akunDemoTampil(),
        judul: 'Masuk', email, galat: 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.' });
    }
    const pengguna = await penggunaService.verifikasiLogin(email.trim(), password);
    if (!pengguna) {
      catatGagal(kunci);
      return res.status(401).render('login', { akunDemo: akunDemoTampil(), judul: 'Masuk', email, galat: 'Email atau password salah.' });
    }
    percobaan.delete(kunci);
    buatSesi(res, pengguna);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  hapusSesi(res);
  res.redirect('/login');
}

// ---- Pengelolaan pengguna & tim (khusus admin) ----

async function halamanDaftar(req, res, next) {
  try {
    const [daftar, tim] = await Promise.all([penggunaService.daftar(), penggunaService.daftarTim()]);
    res.render('crm/pengguna/daftar', { judul: 'Pengguna & Tim', daftar, tim, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function tampilForm(res, { data, galat = [], status = 200 }) {
  const tim = await penggunaService.daftarTim();
  res.status(status).render('crm/pengguna/form', {
    judul: data.id ? 'Ubah Pengguna' : 'Pengguna Baru', data, tim, peran: penggunaService.PERAN, galat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(res, { data: { peran: 'sales', aktif: true } });
  } catch (err) {
    next(err);
  }
}

async function formUbah(req, res, next) {
  try {
    const data = await penggunaService.ambil(req.params.id);
    if (!data) return next(Object.assign(new Error('Pengguna tidak ditemukan.'), { status: 404 }));
    await tampilForm(res, { data });
  } catch (err) {
    next(err);
  }
}

async function simpan(req, res, next) {
  const id = req.params.id || null;
  try {
    if (id) await penggunaService.ubah(id, req.body, req.pengguna.id);
    else await penggunaService.buat(req.body, req.pengguna.id);
    res.redirect(`/pengguna?pesan=${encodeURIComponent('Pengguna tersimpan.')}`);
  } catch (err) {
    if (err.status !== 422) return next(err);
    try {
      const data = { ...req.body, id, aktif: req.body.aktif === 'on' };
      await tampilForm(res, { data, galat: err.daftar, status: 422 });
    } catch (e) {
      next(e);
    }
  }
}

async function simpanTim(req, res, next) {
  try {
    await penggunaService.simpanTim(req.params.id || null, req.body, req.pengguna.id);
    res.redirect(`/pengguna?pesan=${encodeURIComponent('Tim tersimpan.')}`);
  } catch (err) {
    if (err.status === 422) return res.redirect(`/pengguna?pesan=${encodeURIComponent(err.message)}`);
    next(err);
  }
}

module.exports = { formLogin, login, logout, halamanDaftar, formBaru, formUbah, simpan, simpanTim };
