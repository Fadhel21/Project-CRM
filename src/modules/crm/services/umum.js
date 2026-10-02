// Fungsi bersama untuk service data CRM (kepemilikan, paginasi, error)
const { bolehTugaskanKe } = require('./akses');
const { GalatValidasi, idAtauNull } = require('./validasi');

const UKURAN_HALAMAN = 25;

function galat404(pesan = 'Data tidak ditemukan.') {
  return Object.assign(new Error(pesan), { status: 404 });
}

function nomorHalaman(v) {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Menentukan pemilik data yang disimpan. Sales selalu dirinya sendiri;
 * manajer hanya ke anggota timnya; admin bebas. Pemilik lama dipertahankan bila input kosong.
 */
async function tentukanPemilik(klien, pengguna, inputPemilikId, pemilikLama) {
  const diminta = idAtauNull(inputPemilikId) || pemilikLama || String(pengguna.id);
  if (pengguna.peran === 'sales') return pemilikLama || String(pengguna.id);
  if (String(diminta) === String(pemilikLama)) return diminta;
  if (!(await bolehTugaskanKe(pengguna, diminta, klien))) {
    throw new GalatValidasi(['Anda tidak boleh menugaskan data ke pengguna tersebut.']);
  }
  return diminta;
}

/** Pola pencarian ILIKE yang aman (karakter % dan _ di-escape). */
function polaCari(q) {
  return `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = { UKURAN_HALAMAN, galat404, nomorHalaman, tentukanPemilik, polaCari };
