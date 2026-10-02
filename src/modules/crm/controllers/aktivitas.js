// Controller aktivitas, linimasa, dan daftar tugas
const aktivitasService = require('../services/aktivitas');
const penggunaService = require('../services/pengguna');

const KONTEKS = { kontak: 'kontakId', deal: 'dealId', lead: 'leadId' };
const URL_KONTEKS = { kontak: '/kontak/', deal: '/deal/', lead: '/leads/' };

/** Data untuk partial linimasa (dipakai juga oleh halaman detail kontak, deal, dan lead). */
async function dataLinimasa(pengguna, konteks, konteksId) {
  const [linimasa, pemilik] = await Promise.all([
    aktivitasService.linimasa(pengguna, { [KONTEKS[konteks]]: konteksId }),
    penggunaService.daftarPemilikTersedia(pengguna),
  ]);
  return { linimasa, pemilikTugas: pemilik, konteks, konteksId, JENIS: aktivitasService.JENIS };
}

function konteksDari(body) {
  const konteks = KONTEKS[body.konteks] ? body.konteks : null;
  const konteksId = konteks ? body[`${konteks}_id`] : null;
  return { konteks, konteksId };
}

async function buat(req, res, next) {
  try {
    await aktivitasService.buat(req.body, req.pengguna);
    const { konteks, konteksId } = konteksDari(req.body);
    if (req.get('HX-Request') && konteks) {
      return res.render('partials/linimasa', await dataLinimasa(req.pengguna, konteks, konteksId));
    }
    res.redirect(konteks ? `${URL_KONTEKS[konteks]}${konteksId}` : '/tugas');
  } catch (err) {
    next(err);
  }
}

async function tandaiSelesai(req, res, next) {
  try {
    const item = await aktivitasService.tandaiSelesai(req.params.id, req.body.selesai === '1', req.pengguna);
    if (req.get('HX-Request')) {
      return res.render('partials/item-linimasa', { item, JENIS: aktivitasService.JENIS, tampilKonteks: req.body.tampil_konteks === '1' });
    }
    res.redirect(req.get('Referer') || '/tugas');
  } catch (err) {
    next(err);
  }
}

async function hapus(req, res, next) {
  try {
    await aktivitasService.hapus(req.params.id, req.pengguna);
    if (req.get('HX-Request')) return res.send('');
    res.redirect(req.get('Referer') || '/tugas');
  } catch (err) {
    next(err);
  }
}

const LABEL_FILTER = { terlambat: 'Terlambat', hari_ini: 'Hari ini', mendatang: 'Mendatang', terbuka: 'Semua terbuka', selesai: 'Selesai' };

async function daftarTugas(req, res, next) {
  try {
    const filter = LABEL_FILTER[req.query.filter] ? req.query.filter : 'terbuka';
    const pemilikId = req.query.pemilik || '';
    const [tugas, pemilik] = await Promise.all([
      aktivitasService.daftarTugas(req.pengguna, { filter, pemilikId }),
      penggunaService.daftarPemilikTersedia(req.pengguna),
    ]);
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/aktivitas/tabel' : 'crm/aktivitas/tugas';
    res.render(tampilan, {
      judul: 'Tugas & Jadwal', tugas, filter, pemilikId, pemilik, LABEL_FILTER, JENIS: aktivitasService.JENIS });
  } catch (err) {
    next(err);
  }
}

module.exports = { dataLinimasa, buat, tandaiSelesai, hapus, daftarTugas };
