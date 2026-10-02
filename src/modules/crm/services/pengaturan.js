// Service pengaturan kunci-nilai (tarif pajak, batas diskon, dll)
const { query } = require('../../../config/db');

async function semua(klien) {
  const { rows } = await query(
    'SELECT kunci, nilai, keterangan FROM pengaturan WHERE deleted_at IS NULL ORDER BY kunci', [], klien);
  return Object.fromEntries(rows.map((r) => [r.kunci, r.nilai]));
}

async function ambil(kunci, klien) {
  const { rows } = await query('SELECT nilai FROM pengaturan WHERE kunci = $1 AND deleted_at IS NULL', [kunci], klien);
  if (!rows[0]) throw new Error(`Pengaturan "${kunci}" belum ada.`);
  return rows[0].nilai;
}

module.exports = { semua, ambil };
