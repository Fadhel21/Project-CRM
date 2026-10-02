// Fungsi bantu format tampilan (tanpa SQL)
const dayjs = require('dayjs');

const PETA_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => PETA_HTML[c]);
}

/** Format rupiah dari string NUMERIC tanpa melewati float: "1234567.50" -> "Rp 1.234.567,50" */
function rupiah(nilai) {
  const s = String(nilai ?? '0');
  const negatif = s.startsWith('-');
  const [bulat, pecahan = '00'] = s.replace('-', '').split('.');
  const ribuan = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negatif ? '-' : ''}Rp ${ribuan},${pecahan.padEnd(2, '0').slice(0, 2)}`;
}

function tanggal(t, pola = 'DD/MM/YYYY') {
  return t ? dayjs(t).format(pola) : '-';
}

function tanggalJam(t) {
  return tanggal(t, 'DD/MM/YYYY HH:mm');
}

module.exports = { escapeHtml, rupiah, tanggal, tanggalJam };
