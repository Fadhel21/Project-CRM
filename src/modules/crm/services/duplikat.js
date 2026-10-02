// Cek duplikat email/telepon di kontak dan lead (belum dikonversi), di SEMUA pemilik.
// Hanya jenis, nama, dan pemilik yang dikembalikan. Tidak pernah menggabungkan data.
const { query } = require('../../../config/db');
const { teksAtauNull, normalTelepon } = require('./validasi');

async function cari({ email, telepon, kecualiKontakId = null, kecualiLeadId = null }, klien) {
  const em = teksAtauNull(email)?.toLowerCase() ?? null;
  const tel = normalTelepon(telepon);
  if (!em && !tel) return [];
  const { rows } = await query(
    `SELECT 'kontak' AS jenis, k.id, k.nama, u.nama AS pemilik,
       (lower(k.email) = $1) AS email_sama, (k.telepon_normal = $2) AS telepon_sama
     FROM kontak k JOIN pengguna u ON u.id = k.pemilik_id
     WHERE k.deleted_at IS NULL AND k.id <> COALESCE($3::bigint, 0)
       AND (lower(k.email) = $1 OR k.telepon_normal = $2)
     UNION ALL
     SELECT 'lead', l.id, l.nama, u.nama, (lower(l.email) = $1), (l.telepon_normal = $2)
     FROM lead l JOIN pengguna u ON u.id = l.pemilik_id
     WHERE l.deleted_at IS NULL AND l.konversi_at IS NULL AND l.id <> COALESCE($4::bigint, 0)
       AND (lower(l.email) = $1 OR l.telepon_normal = $2)
     LIMIT 20`, [em, tel, kecualiKontakId, kecualiLeadId], klien);
  return rows;
}

/** Error 409 berisi daftar duplikat, untuk ditampilkan sebagai peringatan di formulir. */
function galatDuplikat(duplikat) {
  return Object.assign(new Error('Ditemukan data dengan email/telepon sama.'), { status: 409, duplikat });
}

module.exports = { cari, galatDuplikat };
