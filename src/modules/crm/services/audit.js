// Jejak audit: siapa, kapan, aksi apa, dan kolom mana yang berubah.
// Nilai kolom sengaja TIDAK disimpan agar data pribadi pelanggan tidak masuk log.
const { query } = require('../../../config/db');

async function catat(klien, { penggunaId, entitas, entitasId, aksi, kolom = [] }) {
  await klien.query(
    `INSERT INTO audit_log (pengguna_id, entitas, entitas_id, aksi, kolom) VALUES ($1, $2, $3, $4, $5)`,
    [penggunaId, entitas, entitasId, aksi, kolom],
  );
}

/** Daftar nama kolom yang nilainya berbeda antara data lama dan data baru. */
function kolomBerubah(lama, baru) {
  return Object.keys(baru).filter((k) => String(lama[k] ?? '') !== String(baru[k] ?? ''));
}

async function riwayat(entitas, entitasId) {
  const { rows } = await query(
    `SELECT a.aksi, a.kolom, a.created_at, p.nama AS pengguna
     FROM audit_log a LEFT JOIN pengguna p ON p.id = a.pengguna_id
     WHERE a.entitas = $1 AND a.entitas_id = $2 ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
    [entitas, entitasId],
  );
  return rows;
}

module.exports = { catat, kolomBerubah, riwayat };
