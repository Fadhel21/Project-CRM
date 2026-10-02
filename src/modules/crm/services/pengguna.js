// Service pengguna: login dan pemuatan sesi
const bcrypt = require('bcryptjs');
const { query } = require('../../../config/db');

const KOLOM = 'id, nama, email, peran, tim_id, aktif';

async function cariAktifById(id) {
  const { rows } = await query(
    `SELECT ${KOLOM} FROM pengguna WHERE id = $1 AND aktif AND deleted_at IS NULL`, [id]);
  return rows[0] || null;
}

/** Mengembalikan pengguna bila email & password cocok, selain itu null. */
async function verifikasiLogin(email, password) {
  const { rows } = await query(
    `SELECT ${KOLOM}, password_hash FROM pengguna
     WHERE lower(email) = lower($1) AND aktif AND deleted_at IS NULL`, [email]);
  const p = rows[0];
  // Tetap jalankan bcrypt walau email tidak ada, agar waktu respons tidak membocorkan email
  const cocok = await bcrypt.compare(password || '', p ? p.password_hash : '$2a$10$abcdefghijklmnopqrstuuJ2Gn8Nq3eX2uU1fJ5c4Gm1x8Kq9O0Wi');
  if (!p || !cocok) return null;
  delete p.password_hash;
  return p;
}

module.exports = { cariAktifById, verifikasiLogin };
