// Memuat dan memvalidasi variabel lingkungan dari file .env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const uji = process.env.NODE_ENV === 'test';

function wajib(nama) {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Variabel lingkungan ${nama} belum diisi di .env`);
  return nilai;
}

module.exports = {
  uji,
  produksi: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: uji ? wajib('DATABASE_URL_TEST') : wajib('DATABASE_URL'),
  jwtSecret: wajib('JWT_SECRET'),
  cookieSecret: wajib('COOKIE_SECRET'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'CRM <crm@contoh.local>',
  },
  uploadMaxByte: Number(process.env.UPLOAD_MAX_MB || 5) * 1024 * 1024,
  folderUpload: path.join(__dirname, '..', '..', 'uploads'),
  folderLog: path.join(__dirname, '..', '..', 'logs'),
};
