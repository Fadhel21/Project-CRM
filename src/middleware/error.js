// Penanganan halaman tidak ditemukan dan error umum
const { escapeHtml } = require('../modules/crm/services/format');

function tidakDitemukan(req, res, next) {
  const err = new Error('Halaman tidak ditemukan.');
  err.status = 404;
  next(err);
}

// Express mengenali penangan error dari jumlah argumennya (4)
// eslint-disable-next-line no-unused-vars
function penanganError(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  const pesan = status >= 500 ? 'Terjadi kesalahan pada server. Silakan coba lagi.' : err.message;
  res.status(status);
  if (req.get('HX-Request')) {
    // Pesan error ditampilkan di area notifikasi
    res.set('HX-Retarget', '#notifikasi').set('HX-Reswap', 'innerHTML');
    return res.send(`<div class="notif notif-galat" role="alert">${escapeHtml(pesan)}</div>`);
  }
  res.render('error', { judul: `Error ${status}`, status, pesan });
}

module.exports = { tidakDitemukan, penanganError };
