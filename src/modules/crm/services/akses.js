// Aturan kepemilikan data, dipakai oleh semua service:
//   admin   -> semua data
//   manajer -> data milik anggota timnya (termasuk dirinya)
//   sales   -> hanya data miliknya sendiri

/**
 * Menghasilkan potongan SQL WHERE untuk kolom pemilik.
 * params adalah array parameter query; nilai baru ditambahkan ke sana.
 */
function filterPemilik(pengguna, kolom, params) {
  if (pengguna.peran === 'admin') return 'TRUE';
  if (pengguna.peran === 'manajer' && pengguna.tim_id) {
    params.push(pengguna.tim_id, pengguna.id);
    return `(${kolom} IN (SELECT id FROM pengguna WHERE tim_id = $${params.length - 1}) OR ${kolom} = $${params.length})`;
  }
  params.push(pengguna.id);
  return `${kolom} = $${params.length}`;
}

/** Apakah pengguna boleh memberikan data kepada pemilik baru (penugasan). */
async function bolehTugaskanKe(pengguna, pemilikId, klien) {
  if (String(pemilikId) === String(pengguna.id)) return true;
  if (pengguna.peran === 'admin') return true;
  if (pengguna.peran !== 'manajer' || !pengguna.tim_id) return false;
  const { rowCount } = await klien.query(
    'SELECT 1 FROM pengguna WHERE id = $1 AND tim_id = $2 AND deleted_at IS NULL AND aktif',
    [pemilikId, pengguna.tim_id],
  );
  return rowCount > 0;
}

module.exports = { filterPemilik, bolehTugaskanKe };
