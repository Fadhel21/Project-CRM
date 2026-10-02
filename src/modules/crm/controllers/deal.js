// Controller deal & pipeline (daftar, kanban, detail, form, pindah tahap)
const dealService = require('../services/deal');
const kontakService = require('../services/kontak');
const perusahaanService = require('../services/perusahaan');
const penggunaService = require('../services/pengguna');
const audit = require('../services/audit');
const { dataLinimasa } = require('./aktivitas');
const penawaranService = require('../services/penawaran');

async function daftar(req, res, next) {
  try {
    const filter = {
      q: req.query.q || '', status: req.query.status ?? 'terbuka', tahap: req.query.tahap || '', pemilikId: req.query.pemilik || '' };
    const [hasil, tahap, pemilik] = await Promise.all([
      dealService.daftar(req.pengguna, { ...filter, halaman: req.query.halaman }),
      dealService.daftarTahap(),
      penggunaService.daftarPemilikTersedia(req.pengguna),
    ]);
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/deal/tabel' : 'crm/deal/daftar';
    res.render(tampilan, { judul: 'Deal', hasil, filter, q: filter.q, tahap, pemilik, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function renderKanban(req, res, { status = 200 } = {}) {
  const pemilikId = req.query.pemilik || req.body?.pemilik || '';
  const [kolom, pemilik] = await Promise.all([
    dealService.kanban(req.pengguna, { pemilikId }),
    penggunaService.daftarPemilikTersedia(req.pengguna),
  ]);
  const hanyaPapan = req.get('HX-Request') && req.get('HX-Target') === 'kanban';
  res.status(status).render(hanyaPapan ? 'crm/deal/papan' : 'crm/deal/kanban', {
    judul: 'Pipeline', kolom, pemilik, pemilikId });
}

async function kanban(req, res, next) {
  try {
    await renderKanban(req, res);
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const [tahap, riwayat, lm, penawaran] = await Promise.all([
      dealService.daftarTahap(),
      audit.riwayat('deal', req.data.id),
      dataLinimasa(req.pengguna, 'deal', req.data.id),
      penawaranService.untukDeal(req.data.id, req.pengguna),
    ]);
    res.render('crm/deal/detail', {
      judul: req.data.judul, data: req.data, tahap, riwayat, ...lm, penawaran, galat: [], pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function tampilForm(req, res, { data, galat = [], status = 200 }) {
  const [pemilik, kontak, perusahaan, tahap] = await Promise.all([
    penggunaService.daftarPemilikTersedia(req.pengguna),
    kontakService.pilihan(req.pengguna),
    perusahaanService.pilihan(req.pengguna),
    dealService.daftarTahap(),
  ]);
  res.status(status).render('crm/deal/form', {
    judul: data.id ? 'Ubah Deal' : 'Deal Baru', data, pemilik, kontak, perusahaan,
    tahap: tahap.filter((t) => t.jenis === 'terbuka'), galat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, {
      data: { pemilik_id: req.pengguna.id, nilai: '0', kontak_id: req.query.kontak_id, perusahaan_id: req.query.perusahaan_id } });
  } catch (err) {
    next(err);
  }
}

async function formUbah(req, res, next) {
  try {
    await tampilForm(req, res, { data: req.data });
  } catch (err) {
    next(err);
  }
}

async function simpan(req, res, next) {
  const id = req.params.id || null;
  try {
    const hasilId = id ? (await dealService.ubah(id, req.body, req.pengguna), id) : await dealService.buat(req.body, req.pengguna);
    res.redirect(`/deal/${hasilId}?pesan=${encodeURIComponent('Deal tersimpan.')}`);
  } catch (err) {
    if (err.status !== 422) return next(err);
    tampilForm(req, res, { data: { ...req.body, id }, galat: err.daftar, status: 422 }).catch(next);
  }
}

/** Pindah tahap dari kanban (HTMX, balasan = papan kanban baru) atau dari halaman detail (redirect). */
async function pindahTahap(req, res, next) {
  try {
    await dealService.pindahTahap(req.params.id, req.body.tahap_id, req.pengguna, { alasanKalah: req.body.alasan_kalah });
    if (req.get('HX-Target') === 'kanban') {
      await renderKanban(req, res);
      return;
    }
    res.redirect(`/deal/${req.params.id}?pesan=${encodeURIComponent('Tahap deal diperbarui.')}`);
  } catch (err) {
    next(err);
  }
}

async function hapus(req, res, next) {
  try {
    await dealService.hapus(req.params.id, req.pengguna);
    res.redirect(`/deal?pesan=${encodeURIComponent('Deal dihapus.')}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { daftar, kanban, detail, formBaru, formUbah, simpan, pindahTahap, hapus };
