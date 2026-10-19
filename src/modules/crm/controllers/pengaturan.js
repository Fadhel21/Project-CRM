// Controller pengaturan (khusus admin)
const pengaturanService = require('../services/pengaturan');

const kembali = (res, param, pesan, tab) => res.redirect(`/pengaturan?${param}=${encodeURIComponent(pesan)}${tab ? `#${tab}` : ''}`);

async function halaman(req, res, next) {
  try {
    const [nilai, tahap, sumber] = await Promise.all([
      pengaturanService.semua(), pengaturanService.daftarTahapSemua(), pengaturanService.daftarSumberSemua(),
    ]);
    res.render('crm/pengaturan', {
      judul: 'Pengaturan', nilai, tahap, sumber, ATURAN: pengaturanService.ATURAN_NILAI,
      pesan: req.query.pesan || null, galat: req.query.galat ? [req.query.galat] : [] });
  } catch (err) {
    next(err);
  }
}

/** Membungkus aksi: sukses -> pesan hijau, galat validasi -> pesan merah, lainnya -> error handler. */
function aksi(fn, pesanSukses, tab) {
  return async (req, res, next) => {
    try {
      await fn(req);
      kembali(res, 'pesan', pesanSukses, tab);
    } catch (err) {
      if (err.status === 422 || err.status === 404) return kembali(res, 'galat', err.message, tab);
      next(err);
    }
  };
}

module.exports = {
  halaman,
  simpanNilai: aksi((req) => pengaturanService.simpanNilai(req.body, req.pengguna), 'Pengaturan umum tersimpan.', 'umum'),
  simpanTahap: aksi((req) => pengaturanService.simpanTahap(req.params.id || null, req.body, req.pengguna), 'Tahap pipeline tersimpan.', 'tahap'),
  geserTahap: aksi((req) => pengaturanService.geserTahap(req.params.id, req.body.arah, req.pengguna), 'Urutan tahap diperbarui.', 'tahap'),
  aktifTahap: aksi((req) => pengaturanService.aturAktifTahap(req.params.id, req.body.aktif === '1', req.pengguna), 'Status tahap diperbarui.', 'tahap'),
  simpanSumber: aksi((req) => pengaturanService.simpanSumber(req.params.id || null, req.body, req.pengguna), 'Sumber lead tersimpan.', 'sumber'),
  aktifSumber: aksi((req) => pengaturanService.aturAktifSumber(req.params.id, req.body.aktif === '1', req.pengguna), 'Status sumber lead diperbarui.', 'sumber'),
};
