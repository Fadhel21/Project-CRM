// Controller dashboard (beranda)
const laporanService = require('../services/laporan');
const penggunaService = require('../services/pengguna');
const aktivitasService = require('../services/aktivitas');

async function beranda(req, res, next) {
  try {
    const filter = {
      periode: req.query.periode || 'bulan_ini', dari: req.query.dari, sampai: req.query.sampai, pemilik: req.query.pemilik || '' };
    const [data, pemilik, tugas] = await Promise.all([
      laporanService.dasbor(req.pengguna, filter),
      penggunaService.daftarPemilikTersedia(req.pengguna),
      aktivitasService.ringkasTugas(req.pengguna),
    ]);
    const tampilan = req.get('HX-Target') === 'dasbor' ? 'crm/dasbor-isi' : 'crm/beranda';
    res.render(tampilan, {
      judul: 'Dashboard', ...data, filter: { ...filter, ...data.rentang }, pemilik, tugas, PERIODE: laporanService.PERIODE });
  } catch (err) {
    next(err);
  }
}

module.exports = { beranda };
