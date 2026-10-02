// Tes penawaran: hitung total/diskon/pajak di SQL, nomor urut tanpa ganda, revisi, terima/tolak, email+PDF, hak akses
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');
const penawaranService = require('../src/modules/crm/services/penawaran');
const { kotakKeluarUji } = require('../src/modules/crm/services/email');

let server;
let dasar;
const u = {};
const tahap = {};

before(async () => {
  await resetDb();
  await pool.query(`UPDATE pengaturan SET nilai = '11' WHERE kunci = 'pajak_persen'`);
  await pool.query(`UPDATE pengaturan SET nilai = '20' WHERE kunci = 'diskon_maks_persen'`);
  const timA = await buatTim('Tim A');
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: timA });
  u.s2 = await buatPengguna({ nama: 'Sales B', timId: await buatTim('Tim B') });
  for (const r of (await pool.query('SELECT id, nama FROM tahap_pipeline')).rows) tahap[r.nama] = String(r.id);
  server = await jalankanServer();
  dasar = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await pool.query(`UPDATE pengaturan SET nilai = '11' WHERE kunci = 'pajak_persen'`);
  server.close();
  await pool.end();
});

async function sebagai(p) {
  const k = klien(dasar);
  await k.masuk(p.email);
  return k;
}

const idDari = (lokasi) => lokasi.match(/\/(\d+)\?/)[1];
const ambilP = async (id) => (await pool.query('SELECT * FROM penawaran WHERE id = $1', [id])).rows[0];

async function siapkanDeal(k, nama = 'Deal Uji') {
  const kontakId = idDari((await k.post('/kontak', { nama: `Kontak ${nama}`, email: `${nama.replace(/\W/g, '').toLowerCase()}@pelanggan.id`, abaikan_duplikat: 'ya' })).lokasi);
  return idDari((await k.post('/deal', { judul: nama, nilai: '0', kontak_id: kontakId, tahap_id: tahap.Penawaran })).lokasi);
}

/** Item contoh: total akhir harus 2.848.204,49 (lihat perhitungan di tes pertama). */
const ITEM_CONTOH = {
  item_nama: ['Laptop', 'Kabel'], item_deskripsi: ['14 inci', ''], item_qty: ['2', '3'], item_satuan: ['unit', 'pcs'],
  item_harga: ['1.500.000', '333,33'], item_diskon: ['10', '0'],
};

async function buatPenawaran(k, dealId, tambahan = {}) {
  const r = await k.post('/penawaran', { deal_id: dealId, judul: 'Pengadaan perangkat', diskon_persen: '5', ...ITEM_CONTOH, ...tambahan });
  assert.equal(r.status, 302, r.teks.slice(0, 600));
  return idDari(r.lokasi);
}

test('total, diskon baris & dokumen, dan PPN dihitung tepat di SQL', async () => {
  // Baris 1: 2 x 1.500.000 = 3.000.000; diskon 10% = 300.000 -> 2.700.000,00
  // Baris 2: 3 x 333,33 = 999,99 -> 999,99
  // Subtotal 2.700.999,99; diskon dokumen 5% = 135.049,9995 -> 135.050,00; DPP 2.565.949,99
  // PPN 11% = 282.254,4989 -> 282.254,50; Total 2.848.204,49
  const s1 = await sebagai(u.s1);
  const id = await buatPenawaran(s1, await siapkanDeal(s1, 'Deal Hitung'));
  const p = await ambilP(id);
  assert.deepEqual(
    [p.subtotal, p.diskon_nilai, p.dpp, p.pajak_persen, p.pajak_nilai, p.total],
    ['2700999.99', '135050.00', '2565949.99', '11.00', '282254.50', '2848204.49']);
  const item = (await pool.query('SELECT subtotal, diskon_nilai, total FROM penawaran_item WHERE penawaran_id = $1 ORDER BY urutan', [id])).rows;
  assert.deepEqual(item, [
    { subtotal: '3000000.00', diskon_nilai: '300000.00', total: '2700000.00' },
    { subtotal: '999.99', diskon_nilai: '0.00', total: '999.99' },
  ]);
  const detail = await s1.get(`/penawaran/${id}`);
  assert.match(detail.teks, /Rp 2\.848\.204,49/);

  // Pratinjau HTMX memakai hitungan yang sama
  const pr = await s1.post('/penawaran/pratinjau', { ...ITEM_CONTOH, diskon_persen: '5', pajak_persen: '11' }, { 'HX-Request': 'true' });
  assert.equal(pr.status, 200);
  assert.match(pr.teks, /Rp 2\.848\.204,49/);
});

test('batas diskon dan tarif pajak diambil dari pengaturan; dokumen lama tidak ikut berubah', async () => {
  const s1 = await sebagai(u.s1);
  const dealId = await siapkanDeal(s1, 'Deal Aturan');
  const itemTerlaluBesar = await s1.post('/penawaran', { deal_id: dealId, judul: 'X', diskon_persen: '0', ...ITEM_CONTOH, item_diskon: ['21', '0'] });
  assert.equal(itemTerlaluBesar.status, 422);
  assert.match(itemTerlaluBesar.teks, /Item 1: diskon maksimal 20%/);
  const dokTerlaluBesar = await s1.post('/penawaran', { deal_id: dealId, judul: 'X', ...ITEM_CONTOH, diskon_persen: '25' });
  assert.equal(dokTerlaluBesar.status, 422);
  const tanpaItem = await s1.post('/penawaran', { deal_id: dealId, judul: 'Kosong', diskon_persen: '0', item_nama: [''], item_harga: [''] });
  assert.equal(tanpaItem.status, 302, 'draf boleh tanpa item');

  const lama = await buatPenawaran(s1, dealId);
  await pool.query(`UPDATE pengaturan SET nilai = '12' WHERE kunci = 'pajak_persen'`);
  const baru = await buatPenawaran(s1, dealId);
  assert.equal((await ambilP(baru)).pajak_persen, '12.00');
  assert.equal((await ambilP(lama)).pajak_persen, '11.00', 'tarif lama tersimpan di dokumennya');
  await pool.query(`UPDATE pengaturan SET nilai = '11' WHERE kunci = 'pajak_persen'`);

  const besar = await s1.post('/penawaran', { deal_id: dealId, judul: 'Besar', diskon_persen: '0',
    item_nama: ['Mahal'], item_qty: ['9999999999'], item_harga: ['9999999999999'], item_diskon: ['0'] });
  assert.equal(besar.status, 422, 'melebihi batas -> pesan validasi, bukan error 500');
  assert.match(besar.teks, /melebihi batas/);
});

test('nomor penawaran berurutan QUO/YYYY/MM/NNNN dan tidak ganda walau dibuat bersamaan', async () => {
  const s1 = await sebagai(u.s1);
  const dealId = await siapkanDeal(s1, 'Deal Nomor');
  await pool.query(`DELETE FROM penghitung WHERE kunci = 'penawaran:2031'`);
  const pengguna = { ...u.s1 };
  const input = { deal_id: dealId, judul: 'Serentak', tanggal: '2031-03-15', diskon_persen: '0', ...ITEM_CONTOH };
  const hasil = await Promise.all(Array.from({ length: 12 }, () => penawaranService.simpanDraf(null, input, pengguna)));
  const nomor = (await pool.query('SELECT nomor FROM penawaran WHERE id = ANY($1) ORDER BY nomor', [hasil])).rows.map((r) => r.nomor);
  assert.equal(new Set(nomor).size, 12, 'semua nomor unik');
  assert.deepEqual(nomor, Array.from({ length: 12 }, (_, i) => `QUO/2031/03/${String(i + 1).padStart(4, '0')}`));

  // Tahun berbeda -> penghitung mulai dari 1 lagi
  await pool.query(`DELETE FROM penghitung WHERE kunci = 'penawaran:2032'`);
  const id = await penawaranService.simpanDraf(null, { ...input, tanggal: '2032-01-02' }, pengguna);
  assert.equal((await ambilP(id)).nomor, 'QUO/2032/01/0001');
});

test('kirim mengunci penawaran, mengirim PDF via email, dan tercatat di linimasa', async () => {
  const s1 = await sebagai(u.s1);
  const dealId = await siapkanDeal(s1, 'Deal Kirim');
  const id = await buatPenawaran(s1, dealId);
  const sebelum = kotakKeluarUji.length;

  const r = await s1.post(`/penawaran/${id}/kirim`, { email: 'Pembeli@Pelanggan.id' });
  assert.equal(r.status, 302);
  const p = await ambilP(id);
  assert.equal(p.status, 'terkirim');
  assert.equal(p.dikirim_ke, 'pembeli@pelanggan.id');
  assert.equal(kotakKeluarUji.length, sebelum + 1);
  const surat = kotakKeluarUji.at(-1);
  assert.match(surat.subjek, /QUO\/\d{4}\/\d{2}\/\d{4}/);
  assert.equal(surat.lampiran[0].content.subarray(0, 5).toString(), '%PDF-');

  // Tidak bisa diubah setelah dikirim; data tetap
  const ubah = await s1.post(`/penawaran/${id}`, { judul: 'Diubah diam-diam', diskon_persen: '0', ...ITEM_CONTOH });
  assert.equal(ubah.status, 422);
  assert.equal((await ambilP(id)).judul, 'Pengadaan perangkat');
  assert.equal((await ambilP(id)).total, '2848204.49');

  const akt = (await pool.query(`SELECT jenis FROM aktivitas WHERE deal_id = $1 AND judul LIKE 'Penawaran % dikirim'`, [dealId])).rows;
  assert.equal(akt.length, 1);
  assert.equal(akt[0].jenis, 'email');

  const unduh = await s1.get(`/penawaran/${id}/pdf`);
  assert.equal(unduh.status, 200);
  assert.equal(unduh.header.get('content-type'), 'application/pdf');
});

test('revisi: nomor -R1/-R2, versi lama terkunci sebagai direvisi, item tersalin', async () => {
  const s1 = await sebagai(u.s1);
  const id = await buatPenawaran(s1, await siapkanDeal(s1, 'Deal Revisi'));
  assert.equal((await s1.post(`/penawaran/${id}/revisi`, {})).status, 302);
  assert.equal((await ambilP(id)).status, 'draf', 'draf tidak bisa direvisi');

  await s1.post(`/penawaran/${id}/kirim`, { email: 'a@b.id' });
  const r1 = await s1.post(`/penawaran/${id}/revisi`, {});
  const idR1 = idDari(r1.lokasi);
  const asal = await ambilP(id);
  const rev1 = await ambilP(idR1);
  assert.equal(asal.status, 'direvisi');
  assert.equal(rev1.nomor, `${asal.nomor}-R1`);
  assert.equal(rev1.status, 'draf');
  assert.equal(rev1.total, asal.total);
  const nItem = async (pid) => Number((await pool.query(
    'SELECT count(*) FROM penawaran_item WHERE penawaran_id = $1 AND deleted_at IS NULL', [pid])).rows[0].count);
  assert.equal(await nItem(idR1), await nItem(id));

  // Revisi boleh diedit, lalu dikirim dan direvisi lagi -> -R2
  await s1.post(`/penawaran/${idR1}`, { judul: 'Revisi harga', diskon_persen: '10', ...ITEM_CONTOH });
  assert.equal((await ambilP(idR1)).judul, 'Revisi harga');
  assert.equal((await ambilP(id)).judul, 'Pengadaan perangkat', 'versi lama tidak berubah');
  await s1.post(`/penawaran/${idR1}/kirim`, { email: 'a@b.id' });
  const idR2 = idDari((await s1.post(`/penawaran/${idR1}/revisi`, {})).lokasi);
  assert.equal((await ambilP(idR2)).nomor, `${asal.nomor}-R2`);
  assert.equal((await s1.post(`/penawaran/${id}/revisi`, {})).lokasi.includes('galat='), true, 'versi direvisi tidak bisa direvisi lagi');
});

test('diterima memindahkan deal ke Menang (dengan riwayat); ditolak wajib alasan', async () => {
  const s1 = await sebagai(u.s1);
  const dealId = await siapkanDeal(s1, 'Deal Terima');
  const id = await buatPenawaran(s1, dealId);
  await s1.post(`/penawaran/${id}/kirim`, { email: 'a@b.id' });
  await s1.post(`/penawaran/${id}/terima`, {});
  assert.equal((await ambilP(id)).status, 'diterima');
  const deal = (await pool.query('SELECT tahap_id, ditutup_at FROM deal WHERE id = $1', [dealId])).rows[0];
  assert.equal(String(deal.tahap_id), tahap.Menang);
  assert.ok(deal.ditutup_at);
  const rt = (await pool.query('SELECT ke_tahap_id FROM riwayat_tahap WHERE deal_id = $1 ORDER BY id DESC LIMIT 1', [dealId])).rows[0];
  assert.equal(String(rt.ke_tahap_id), tahap.Menang);

  const dealB = await siapkanDeal(s1, 'Deal Tolak');
  const idB = await buatPenawaran(s1, dealB);
  await s1.post(`/penawaran/${idB}/kirim`, { email: 'a@b.id' });
  const tanpa = await s1.post(`/penawaran/${idB}/tolak`, { alasan: '' });
  assert.match(tanpa.lokasi, /galat=/);
  assert.equal((await ambilP(idB)).status, 'terkirim');
  await s1.post(`/penawaran/${idB}/tolak`, { alasan: 'Anggaran ditunda' });
  const pb = await ambilP(idB);
  assert.equal(pb.status, 'ditolak');
  assert.equal(pb.alasan_ditolak, 'Anggaran ditunda');
  assert.equal(String((await pool.query('SELECT tahap_id FROM deal WHERE id = $1', [dealB])).rows[0].tahap_id), tahap.Penawaran,
    'ditolak tidak mengubah tahap deal otomatis');
});

test('hak akses: pengguna lain tidak bisa melihat, mengunduh, atau mengubah penawaran', async () => {
  const s1 = await sebagai(u.s1);
  const dealId = await siapkanDeal(s1, 'Deal Rahasia');
  const id = await buatPenawaran(s1, dealId);
  const s2 = await sebagai(u.s2);
  for (const jalur of [`/penawaran/${id}`, `/penawaran/${id}/pdf`, `/penawaran/${id}/ubah`]) {
    assert.equal((await s2.get(jalur)).status, 404, jalur);
  }
  for (const jalur of ['kirim', 'terima', 'tolak', 'revisi', 'hapus']) {
    assert.equal((await s2.post(`/penawaran/${id}/${jalur}`, { email: 'x@y.id', alasan: 'x' })).status, 404, jalur);
  }
  assert.equal((await ambilP(id)).status, 'draf');
  assert.doesNotMatch((await s2.get('/penawaran')).teks, /Deal Rahasia/);
  const curang = await s2.post('/penawaran', { deal_id: dealId, judul: 'Curang', diskon_persen: '0', ...ITEM_CONTOH });
  assert.equal(curang.status, 422);
});
