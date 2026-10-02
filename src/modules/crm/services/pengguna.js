// Service pengguna & tim: login, pemuatan sesi, dan pengelolaan oleh admin
const bcrypt = require('bcryptjs');
const { query, transaksi } = require('../../../config/db');
const audit = require('./audit');
const { GalatValidasi, teks, idAtauNull, emailValid } = require('./validasi');

const KOLOM = 'id, nama, email, peran, tim_id, aktif';
const PERAN = ['admin', 'manajer', 'sales'];
// Hash pembanding asli, dipakai bila email tidak ditemukan
const HASH_PALSU = bcrypt.hashSync('tidak-ada-pengguna', 10);

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
  const cocok = await bcrypt.compare(password || '', p ? p.password_hash : HASH_PALSU);
  if (!p || !cocok) return null;
  delete p.password_hash;
  return p;
}

async function daftar() {
  const { rows } = await query(
    `SELECT p.id, p.nama, p.email, p.peran, p.tim_id, p.aktif, t.nama AS tim
     FROM pengguna p LEFT JOIN tim t ON t.id = p.tim_id
     WHERE p.deleted_at IS NULL ORDER BY p.aktif DESC, p.nama`);
  return rows;
}

async function ambil(id) {
  const { rows } = await query(`SELECT ${KOLOM} FROM pengguna WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] || null;
}

/** Pengguna aktif yang boleh dijadikan pemilik data oleh pengguna ini (untuk dropdown penugasan). */
async function daftarPemilikTersedia(pengguna) {
  let sql = `SELECT id, nama FROM pengguna WHERE aktif AND deleted_at IS NULL`;
  const params = [];
  if (pengguna.peran === 'manajer' && pengguna.tim_id) {
    params.push(pengguna.tim_id, pengguna.id);
    sql += ' AND (tim_id = $1 OR id = $2)';
  } else if (pengguna.peran !== 'admin') {
    params.push(pengguna.id);
    sql += ' AND id = $1';
  }
  const { rows } = await query(`${sql} ORDER BY nama`, params);
  return rows;
}

function validasiPengguna(input, { baru }) {
  const data = {
    nama: teks(input.nama),
    email: teks(input.email).toLowerCase(),
    peran: teks(input.peran),
    tim_id: idAtauNull(input.tim_id),
    aktif: baru ? true : input.aktif === 'on' || input.aktif === true || input.aktif === 'true',
  };
  const galat = [];
  if (!data.nama) galat.push('Nama wajib diisi.');
  if (!emailValid(data.email)) galat.push('Format email tidak valid.');
  if (!PERAN.includes(data.peran)) galat.push('Peran tidak valid.');
  if (data.peran === 'manajer' && !data.tim_id) galat.push('Manajer wajib punya tim.');
  const password = String(input.password || '');
  if (baru && password.length < 8) galat.push('Password minimal 8 karakter.');
  if (!baru && password && password.length < 8) galat.push('Password baru minimal 8 karakter.');
  if (galat.length) throw new GalatValidasi(galat);
  return { data, password };
}

async function emailDipakai(klien, email, kecualiId) {
  const { rowCount } = await klien.query(
    `SELECT 1 FROM pengguna WHERE lower(email) = $1 AND deleted_at IS NULL AND id <> COALESCE($2, 0)`,
    [email, kecualiId || null]);
  return rowCount > 0;
}

async function buat(input, olehId) {
  const { data, password } = validasiPengguna(input, { baru: true });
  const hash = await bcrypt.hash(password, 10);
  return transaksi(async (k) => {
    if (await emailDipakai(k, data.email)) throw new GalatValidasi(['Email sudah dipakai pengguna lain.']);
    const { rows } = await k.query(
      `INSERT INTO pengguna (nama, email, password_hash, peran, tim_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.nama, data.email, hash, data.peran, data.tim_id]);
    await audit.catat(k, { penggunaId: olehId, entitas: 'pengguna', entitasId: rows[0].id, aksi: 'buat' });
    return rows[0].id;
  });
}

async function ubah(id, input, olehId) {
  const { data, password } = validasiPengguna(input, { baru: false });
  if (String(id) === String(olehId) && (data.peran !== 'admin' || !data.aktif)) {
    throw new GalatValidasi(['Anda tidak bisa menurunkan peran atau menonaktifkan akun sendiri.']);
  }
  const hash = password ? await bcrypt.hash(password, 10) : null;
  return transaksi(async (k) => {
    const { rows } = await k.query(`SELECT ${KOLOM} FROM pengguna WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    const lama = rows[0];
    if (!lama) throw Object.assign(new Error('Pengguna tidak ditemukan.'), { status: 404 });
    if (await emailDipakai(k, data.email, id)) throw new GalatValidasi(['Email sudah dipakai pengguna lain.']);
    await k.query(
      `UPDATE pengguna SET nama = $1, email = $2, peran = $3, tim_id = $4, aktif = $5,
         password_hash = COALESCE($6, password_hash) WHERE id = $7`,
      [data.nama, data.email, data.peran, data.tim_id, data.aktif, hash, id]);
    const kolom = audit.kolomBerubah(lama, data);
    if (hash) kolom.push('password');
    if (kolom.length) await audit.catat(k, { penggunaId: olehId, entitas: 'pengguna', entitasId: id, aksi: 'ubah', kolom });
  });
}

async function daftarTim() {
  const { rows } = await query(
    `SELECT t.id, t.nama, count(p.id) FILTER (WHERE p.aktif AND p.deleted_at IS NULL) AS jumlah_anggota
     FROM tim t LEFT JOIN pengguna p ON p.tim_id = t.id
     WHERE t.deleted_at IS NULL GROUP BY t.id ORDER BY t.nama`);
  return rows;
}

async function simpanTim(id, input, olehId) {
  const nama = teks(input.nama);
  if (!nama) throw new GalatValidasi(['Nama tim wajib diisi.']);
  return transaksi(async (k) => {
    let timId = id;
    if (id) {
      const r = await k.query('UPDATE tim SET nama = $1 WHERE id = $2 AND deleted_at IS NULL', [nama, id]);
      if (!r.rowCount) throw Object.assign(new Error('Tim tidak ditemukan.'), { status: 404 });
    } else {
      timId = (await k.query('INSERT INTO tim (nama) VALUES ($1) RETURNING id', [nama])).rows[0].id;
    }
    await audit.catat(k, { penggunaId: olehId, entitas: 'tim', entitasId: timId, aksi: id ? 'ubah' : 'buat', kolom: ['nama'] });
    return timId;
  });
}

module.exports = {
  PERAN, cariAktifById, verifikasiLogin, daftar, ambil, daftarPemilikTersedia, buat, ubah, daftarTim, simpanTim,
};
