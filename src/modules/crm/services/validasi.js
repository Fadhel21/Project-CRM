// Validasi input sederhana tanpa library. Melempar error status 422 berisi daftar pesan.

class GalatValidasi extends Error {
  constructor(pesan) {
    super(pesan.join(' '));
    this.status = 422;
    this.daftar = pesan;
  }
}

function teks(v) {
  return String(v ?? '').trim();
}

function teksAtauNull(v) {
  const t = teks(v);
  return t === '' ? null : t;
}

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailValid(v) {
  return POLA_EMAIL.test(v);
}

/** Normalisasi nomor telepon untuk cek duplikat: hanya angka, awalan 62 -> 0. */
function normalTelepon(v) {
  let t = teks(v).replace(/\D/g, '');
  if (t.startsWith('62')) t = `0${t.slice(2)}`;
  return t || null;
}

/**
 * Validasi string uang (maks 2 desimal, 13 digit bulat). Mengembalikan string, bukan float.
 * Format yang diterima:
 *   "1.234.567,89" / "1234567,89"  -> koma = desimal, titik = pemisah ribuan
 *   "1.500.000"                    -> titik berpola ribuan = pemisah ribuan
 *   "2500000.5" / "2500000.50"     -> satu titik diikuti 1-2 angka = desimal
 * Format lain (mis. "1,234", "1.2.3") ditolak, bukan ditebak.
 */
function uang(v) {
  let t = teks(v).replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
  if (t === '') return '0';
  if (t.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(t)) return null;
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  } else if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    return null;
  }
  t = t.replace(/^0+(?=\d)/, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  return t;
}

function idAtauNull(v) {
  const t = teks(v);
  return /^\d+$/.test(t) ? t : null;
}

module.exports = { GalatValidasi, teks, teksAtauNull, emailValid, normalTelepon, uang, idAtauNull };
