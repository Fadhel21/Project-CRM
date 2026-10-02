// Pemeriksaan hak akses di tingkat route.
// Aturan kepemilikan baris data ada di services/akses.js dan diterapkan di setiap query service.

function galat(status, pesan) {
  const err = new Error(pesan);
  err.status = status;
  return err;
}

/** Hanya peran tertentu yang boleh mengakses route. */
function butuhPeran(...peran) {
  return (req, res, next) => {
    if (!req.pengguna || !peran.includes(req.pengguna.peran)) {
      return next(galat(403, 'Anda tidak punya hak akses ke halaman ini.'));
    }
    next();
  };
}

/**
 * Memuat satu data lewat fungsi service yang sudah menerapkan filter pemilik.
 * Bila tidak ditemukan / bukan hak pengguna -> 404 (tidak membocorkan keberadaan data).
 * Hasil disimpan di req.data.
 */
function pastikanAkses(muat) {
  return async (req, res, next) => {
    try {
      const data = await muat(req.params.id, req.pengguna);
      if (!data) return next(galat(404, 'Data tidak ditemukan.'));
      req.data = data;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { butuhPeran, pastikanAkses, galat };
