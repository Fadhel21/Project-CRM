// Memuat dan memvalidasi variabel lingkungan dari file .env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const uji = process.env.NODE_ENV === 'test';

// Zona waktu aplikasi (tampilan tanggal di Node dan sesi PostgreSQL)
const zonaWaktu = process.env.ZONA_WAKTU || 'Asia/Jakarta';
if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(zonaWaktu)) throw new Error('ZONA_WAKTU di .env tidak valid');
process.env.TZ = zonaWaktu;

function wajib(nama) {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Variabel lingkungan ${nama} belum diisi di .env`);
  return nilai;
}

module.exports = {
  uji,
  produksi: process.env.NODE_ENV === 'production',
  // Panel akun demo di halaman login: hanya bila DEMO_LOGIN=1 DAN bukan produksi
  demoLogin: process.env.DEMO_LOGIN === '1' && process.env.NODE_ENV !== 'production',
  zonaWaktu,
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
