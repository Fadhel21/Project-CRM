// Pengiriman email. Bila SMTP belum diatur, email hanya dicatat ringkas di konsol
// (alamat penerima disamarkan; isi & lampiran tidak ditulis ke log).
const nodemailer = require('nodemailer');
const env = require('../../../config/env');

let transport = null;
// Untuk tes: email yang "terkirim" ditampung di sini, bukan dikirim
const kotakKeluarUji = [];

function samarkan(email) {
  const [nama, domain] = String(email).split('@');
  return `${(nama || '').slice(0, 1)}***@${domain || '?'}`;
}

function ambilTransport() {
  if (!env.smtp.host) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transport;
}

/** lampiran: [{ filename, content: Buffer, contentType }] */
async function kirim({ ke, subjek, teks, html, lampiran = [] }) {
  if (env.uji) {
    kotakKeluarUji.push({ ke, subjek, teks, lampiran });
    return { mode: 'uji' };
  }
  const t = ambilTransport();
  if (!t) {
    console.log(`[email-konsol] ke=${samarkan(ke)} subjek="${subjek}" lampiran=${lampiran.length} (SMTP belum diatur)`);
    return { mode: 'konsol' };
  }
  await t.sendMail({ from: env.smtp.from, to: ke, subject: subjek, text: teks, html, attachments: lampiran });
  return { mode: 'smtp' };
}

module.exports = { kirim, samarkan, kotakKeluarUji };
