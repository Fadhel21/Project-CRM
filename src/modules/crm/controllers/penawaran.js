// Controller penawaran (quotation)
const penawaranService = require('../services/penawaran');
const dealService = require('../services/deal');
const pengaturanService = require('../services/pengaturan');
const audit = require('../services/audit');

const pesanUrl = (p) => `?pesan=${encodeURIComponent(p)}`;
const galatUrl = (p) => `?galat=${encodeURIComponent(p)}`;

async function daftar(req, res, next) {
  try {
    const filter = { q: req.query.q || '', status: req.query.status || '' };
    const hasil = await penawaranService.daftar(req.pengguna, { ...filter, halaman: req.query.halaman });
    const tampilan = req.get('HX-Target') === 'hasil' ? 'crm/penawaran/tabel' : 'crm/penawaran/daftar';
    res.render(tampilan, { judul: 'Penawaran', hasil, filter, q: filter.q, STATUS: penawaranService.STATUS, pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const p = req.data;
    const [item, revisi, riwayat] = await Promise.all([
      penawaranService.daftarItem(p.id),
      penawaranService.riwayatRevisi(p.nomor_dasar, req.pengguna),
      audit.riwayat('penawaran', p.id),
    ]);
    res.render('crm/penawaran/detail', {
      judul: `Penawaran ${p.nomor}`, data: p, item, revisi, riwayat, STATUS: penawaranService.STATUS,
      galat: req.query.galat ? [req.query.galat] : [], pesan: req.query.pesan || null });
  } catch (err) {
    next(err);
  }
}

/** Mengubah item dari database / input form menjadi baris untuk komponen Alpine. */
function barisForm(sumber) {
  if (Array.isArray(sumber)) {
    return sumber.map((i) => ({
      nama: i.nama || '', deskripsi: i.deskripsi || '', qty: String(i.qty ?? '1'), satuan: i.satuan || '',
      harga: String(i.harga ?? ''), diskon: String(i.diskon_persen ?? '0') }));
  }
  const ambil = (k) => [].concat(sumber[k] ?? []);
  return ambil('item_nama').map((n, i) => ({
    nama: n, deskripsi: ambil('item_deskripsi')[i] || '', qty: ambil('item_qty')[i] || '', satuan: ambil('item_satuan')[i] || '',
    harga: ambil('item_harga')[i] || '', diskon: ambil('item_diskon')[i] || '0' }));
}

async function tampilForm(req, res, { data, baris, galat = [], status = 200 }) {
  const [deal, peng] = await Promise.all([dealService.pilihanTerbuka(req.pengguna), pengaturanService.semua()]);
  const pratinjau = await penawaranService.pratinjau({
    ...Object.fromEntries(['nama', 'deskripsi', 'qty', 'satuan', 'harga'].map((k) => [`item_${k}`, baris.map((b) => b[k])])),
    item_diskon: baris.map((b) => b.diskon),
    diskon_persen: data.diskon_persen ?? '0',
    pajak_persen: data.pajak_persen,
  });
  res.status(status).render('crm/penawaran/form', {
    judul: data.id ? `Ubah ${data.nomor || 'Penawaran'}` : 'Penawaran Baru',
    data, baris: baris.length ? baris : [{ nama: '', deskripsi: '', qty: '1', satuan: '', harga: '', diskon: '0' }],
    deal, peng, pratinjau, galat });
}

async function formBaru(req, res, next) {
  try {
    await tampilForm(req, res, { data: { deal_id: req.query.deal_id, diskon_persen: '0' }, baris: [] });
  } catch (err) {
    next(err);
  }
}

async function formUbah(req, res, next) {
  try {
    if (req.data.status !== 'draf') return res.redirect(`/penawaran/${req.data.id}${galatUrl('Penawaran yang sudah dikirim tidak bisa diubah. Buat revisi baru.')}`);
    const item = await penawaranService.daftarItem(req.data.id);
    await tampilForm(req, res, { data: req.data, baris: barisForm(item) });
  } catch (err) {
    next(err);
  }
}

async function simpan(req, res, next) {
  const id = req.params.id || null;
  try {
    const hasilId = await penawaranService.simpanDraf(id, req.body, req.pengguna);
    res.redirect(`/penawaran/${hasilId}${pesanUrl('Penawaran tersimpan sebagai draf.')}`);
  } catch (err) {
    if (err.status !== 422) return next(err);
    const data = { ...(req.data || {}), ...req.body, id };
    tampilForm(req, res, { data, baris: barisForm(req.body), galat: err.daftar, status: 422 }).catch(next);
  }
}

/** HTMX: pratinjau total saat formulir diketik (dihitung di SQL). */
async function pratinjau(req, res, next) {
  try {
    res.render('crm/penawaran/ringkasan', { pratinjau: await penawaranService.pratinjau(req.body) });
  } catch (err) {
    next(err);
  }
}

async function pdf(req, res, next) {
  try {
    const { buffer, namaFile } = await penawaranService.buatPdf(req.params.id, req.pengguna);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.unduh ? 'attachment' : 'inline'}; filename="${namaFile}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/** Menjalankan aksi status lalu kembali ke detail; error validasi ditampilkan sebagai pesan. */
function aksi(fn, pesanSukses) {
  return async (req, res, next) => {
    try {
      const hasil = await fn(req);
      const tujuan = typeof hasil === 'string' || typeof hasil === 'number' ? hasil : req.params.id;
      res.redirect(`/penawaran/${tujuan}${pesanUrl(pesanSukses)}`);
    } catch (err) {
      if (err.status === 422) return res.redirect(`/penawaran/${req.params.id}${galatUrl(err.message)}`);
      next(err);
    }
  };
}

const kirim = aksi((req) => penawaranService.kirim(req.params.id, req.body, req.pengguna), 'Penawaran terkirim.');
const terima = aksi((req) => penawaranService.putuskan(req.params.id, 'diterima', '', req.pengguna),
  'Penawaran diterima. Deal dipindahkan ke tahap Menang.');
const tolak = aksi((req) => penawaranService.putuskan(req.params.id, 'ditolak', req.body.alasan, req.pengguna), 'Penawaran ditandai ditolak.');
const revisi = aksi((req) => penawaranService.revisi(req.params.id, req.pengguna), 'Revisi baru dibuat sebagai draf.');

async function hapus(req, res, next) {
  try {
    await penawaranService.hapus(req.params.id, req.pengguna);
    res.redirect(`/penawaran${pesanUrl('Draf penawaran dihapus.')}`);
  } catch (err) {
    if (err.status === 422) return res.redirect(`/penawaran/${req.params.id}${galatUrl(err.message)}`);
    next(err);
  }
}

module.exports = { daftar, detail, formBaru, formUbah, simpan, pratinjau, pdf, kirim, terima, tolak, revisi, hapus };
