// Membuat akun admin pertama bila belum ada pengguna sama sekali.
// Pemakaian: node scripts/seed.js admin@contoh.local "Nama Admin" passwordRahasia
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function main() {
  const [email, nama, password] = process.argv.slice(2);
  if (!email || !nama || !password || password.length < 8) {
    console.error('Pemakaian: node scripts/seed.js <email> "<nama>" <password min. 8 karakter>');
    process.exitCode = 1;
    return;
  }
  const ada = await pool.query('SELECT 1 FROM pengguna LIMIT 1');
  if (ada.rowCount) {
    console.log('Sudah ada pengguna; seed dilewati.');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO pengguna (nama, email, password_hash, peran) VALUES ($1, lower($2), $3, 'admin')`,
    [nama, email, hash],
  );
  console.log(`Admin dibuat: ${email}`);
}

main()
  .catch((err) => { console.error('Seed gagal:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
