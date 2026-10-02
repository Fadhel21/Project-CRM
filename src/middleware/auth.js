// Autentikasi: JWT di dalam signed cookie "sesi"
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const penggunaService = require('../modules/crm/services/pengguna');

const NAMA_COOKIE = 'sesi';
const MASA_BERLAKU_JAM = 12;

function opsiCookie() {
  return { httpOnly: true, signed: true, sameSite: 'lax', secure: env.produksi, maxAge: MASA_BERLAKU_JAM * 3600 * 1000 };
}

function buatSesi(res, pengguna) {
  const token = jwt.sign({ sub: String(pengguna.id) }, env.jwtSecret, { expiresIn: `${MASA_BERLAKU_JAM}h` });
  res.cookie(NAMA_COOKIE, token, opsiCookie());
}

function hapusSesi(res) {
  res.clearCookie(NAMA_COOKIE, { ...opsiCookie(), maxAge: undefined });
}

function arahkanKeLogin(req, res) {
  if (req.get('HX-Request')) return res.set('HX-Redirect', '/login').status(401).end();
  return res.redirect('/login');
}

/** Wajib login. Pengguna dimuat ulang dari database tiap request agar status nonaktif langsung berlaku. */
async function wajibLogin(req, res, next) {
  try {
    const token = req.signedCookies[NAMA_COOKIE];
    if (!token) return arahkanKeLogin(req, res);
    let isi;
    try {
      isi = jwt.verify(token, env.jwtSecret);
    } catch {
      hapusSesi(res);
      return arahkanKeLogin(req, res);
    }
    const pengguna = await penggunaService.cariAktifById(isi.sub);
    if (!pengguna) {
      hapusSesi(res);
      return arahkanKeLogin(req, res);
    }
    req.pengguna = pengguna;
    res.locals.pengguna = pengguna;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { wajibLogin, buatSesi, hapusSesi };
