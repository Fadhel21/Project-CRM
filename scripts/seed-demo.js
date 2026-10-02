// Membuat / memperbarui akun demo (admin, manajer, 2 sales) untuk mencoba hak akses per peran.
// Aman dijalankan berulang. Ditolak bila NODE_ENV=production.
// Pemakaian: node scripts/seed-demo.js
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { pool, transaksi } = require('../src/config/db');
const { AKUN_DEMO, PASSWORD_DEMO } = require('../src/config/demo');

async function main() {
  if (env.produksi) {
    console.error('Akun demo tidak boleh dibuat di lingkungan produksi.');
    process.exitCode = 1;
    return;
  }
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);
  await transaksi(async (k) => {
    let timId = (await k.query(`SELECT id FROM tim WHERE nama = 'Tim Demo' AND deleted_at IS NULL`)).rows[0]?.id;
    if (!timId) timId = (await k.query(`INSERT INTO tim (nama) VALUES ('Tim Demo') RETURNING id`)).rows[0].id;
    for (const a of AKUN_DEMO) {
      const tim = a.peran === 'admin' ? null : timId;
      const ada = (await k.query('SELECT id FROM pengguna WHERE lower(email) = $1 AND deleted_at IS NULL', [a.email])).rows[0];
      if (ada) {
        await k.query('UPDATE pengguna SET nama = $1, peran = $2, tim_id = $3, aktif = true, password_hash = $4 WHERE id = $5',
          [a.nama, a.peran, tim, hash, ada.id]);
      } else {
        await k.query('INSERT INTO pengguna (nama, email, password_hash, peran, tim_id) VALUES ($1, $2, $3, $4, $5)',
          [a.nama, a.email, hash, a.peran, tim]);
      }
      console.log(`Akun demo siap: ${a.email} (${a.peran})`);
    }
  });
  console.log(`Password semua akun demo: ${PASSWORD_DEMO}`);
}

main()
  .catch((err) => { console.error('Gagal membuat akun demo:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
