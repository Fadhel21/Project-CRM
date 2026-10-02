// Controller login/logout dan pengelolaan pengguna
const penggunaService = require('../services/pengguna');
const { buatSesi, hapusSesi } = require('../../../middleware/auth');

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
  res.render('login', { judul: 'Masuk', galat: null, email: '' });
}

async function login(req, res, next) {
  try {
    const { email = '', password = '' } = req.body;
    const kunci = kunciPercobaan(req);
    if (terkunci(kunci)) {
      return res.status(429).render('login', {
        judul: 'Masuk', email, galat: 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.' });
    }
    const pengguna = await penggunaService.verifikasiLogin(email.trim(), password);
    if (!pengguna) {
      catatGagal(kunci);
      return res.status(401).render('login', { judul: 'Masuk', email, galat: 'Email atau password salah.' });
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

module.exports = { formLogin, login, logout };
