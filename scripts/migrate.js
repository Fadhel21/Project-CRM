// Menjalankan file SQL di /migrations berurutan, masing-masing dalam satu transaksi.
// Migrasi yang sudah tercatat di tabel skema_migrasi tidak dijalankan ulang.
const fs = require('fs');
const path = require('path');
const { pool, transaksi } = require('../src/config/db');

async function migrasi({ diam = false } = {}) {
  const folder = path.join(__dirname, '..', 'migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS skema_migrasi (
    nama TEXT PRIMARY KEY, dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const sudah = new Set((await pool.query('SELECT nama FROM skema_migrasi')).rows.map((r) => r.nama));
  const berkas = fs.readdirSync(folder).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  for (const nama of berkas) {
    if (sudah.has(nama)) continue;
    const sql = fs.readFileSync(path.join(folder, nama), 'utf8');
    await transaksi(async (k) => {
      await k.query(sql);
      await k.query('INSERT INTO skema_migrasi (nama) VALUES ($1)', [nama]);
    });
    if (!diam) console.log(`Migrasi dijalankan: ${nama}`);
  }
  if (!diam) console.log('Migrasi selesai.');
}

module.exports = { migrasi };

if (require.main === module) {
  migrasi()
    .catch((err) => { console.error('Migrasi gagal:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
