// Proteksi CSRF pola double-submit: token acak di signed cookie,
// lalu wajib dikirim ulang lewat field _csrf atau header X-CSRF-Token.
const crypto = require('crypto');
const env = require('../config/env');

const NAMA_COOKIE = 'csrf';
const METODE_AMAN = new Set(['GET', 'HEAD', 'OPTIONS']);

function samaAman(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function csrf(req, res, next) {
  let token = req.signedCookies[NAMA_COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(NAMA_COOKIE, token, { httpOnly: true, signed: true, sameSite: 'lax', secure: env.produksi });
  }
  res.locals.csrfToken = token;
  if (METODE_AMAN.has(req.method)) return next();

  const kiriman = req.get('X-CSRF-Token') || (req.body && req.body._csrf) || req.query._csrf;
  if (!kiriman || !samaAman(kiriman, token)) {
    const err = new Error('Sesi formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.');
    err.status = 403;
    return next(err);
  }
  next();
}

module.exports = { csrf };
