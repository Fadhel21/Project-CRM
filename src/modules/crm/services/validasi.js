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

/** Validasi string uang (maks 2 desimal, 13 digit bulat). Mengembalikan string, bukan float. */
function uang(v) {
  const t = teks(v).replace(/\./g, '').replace(',', '.');
  if (t === '') return '0';
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  return t;
}

function idAtauNull(v) {
  const t = teks(v);
  return /^\d+$/.test(t) ? t : null;
}

module.exports = { GalatValidasi, teks, teksAtauNull, emailValid, normalTelepon, uang, idAtauNull };
