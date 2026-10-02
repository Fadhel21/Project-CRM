// Koneksi PostgreSQL dan helper transaksi. Semua service memakai modul ini.
const { Pool, types } = require('pg');
const env = require('./env');

// NUMERIC (1700) dan BIGINT (20) dibiarkan string agar tidak kehilangan presisi
types.setTypeParser(1700, (v) => v);
types.setTypeParser(20, (v) => v);

const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

function query(sql, params, klien) {
  return (klien || pool).query(sql, params);
}

/**
 * Menjalankan fn(klien) di dalam satu BEGIN ... COMMIT.
 * Bila fn melempar error, transaksi di-ROLLBACK lalu error diteruskan.
 */
async function transaksi(fn) {
  const klien = await pool.connect();
  try {
    await klien.query('BEGIN');
    const hasil = await fn(klien);
    await klien.query('COMMIT');
    return hasil;
  } catch (err) {
    await klien.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    klien.release();
  }
}

module.exports = { pool, query, transaksi };
