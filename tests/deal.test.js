// Tes deal & pipeline: nilai uang, perpindahan tahap + riwayat, kanban HTMX, hak akses
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');

let server;
let dasar;
const u = {};
const tahap = {};

before(async () => {
  await resetDb();
  const timA = await buatTim('Tim A');
  u.manajer = await buatPengguna({ nama: 'Manajer A', peran: 'manajer', timId: timA });
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: timA });
  u.s2 = await buatPengguna({ nama: 'Sales B', timId: await buatTim('Tim B') });
  for (const r of (await pool.query('SELECT id, nama FROM tahap_pipeline')).rows) tahap[r.nama] = String(r.id);
  server = await jalankanServer();
  dasar = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

async function sebagai(p) {
  const k = klien(dasar);
  await k.masuk(p.email);
  return k;
}

const idDari = (lokasi) => lokasi.match(/\/(\d+)\?/)[1];
const ambilDeal = async (id) => (await pool.query('SELECT * FROM deal WHERE id = $1', [id])).rows[0];

async function buatDeal(k, data) {
  const r = await k.post('/deal', { tahap_id: tahap.Kualifikasi, ...data });
  assert.equal(r.status, 302, r.teks.slice(0, 400));
  return idDari(r.lokasi);
}

test('nilai deal disimpan tepat sebagai NUMERIC; input tidak valid ditolak', async () => {
  const s1 = await sebagai(u.s1);
  const a = await buatDeal(s1, { judul: 'Format Indonesia', nilai: '1.234.567,89' });
  assert.equal((await ambilDeal(a)).nilai, '1234567.89');
  const b = await buatDeal(s1, { judul: 'Angka biasa', nilai: '2500000.5' });
  assert.equal((await ambilDeal(b)).nilai, '2500000.50');
  const maks = await buatDeal(s1, { judul: 'Maksimum', nilai: '9999999999999.99' });
  assert.equal((await ambilDeal(maks)).nilai, '9999999999999.99');

  const ribuan = await buatDeal(s1, { judul: 'Ribuan', nilai: 'Rp 1.500.000' });
  assert.equal((await ambilDeal(ribuan)).nilai, '1500000.00');

  for (const salah of ['-5000', 'abc', '1,234', '12.5.5', '1.2.3', '10000000000000', '1.5,5', '12.345.67']) {
    const r = await s1.post('/deal', { judul: 'Salah', nilai: salah, tahap_id: tahap.Kualifikasi });
    assert.equal(r.status, 422, `nilai "${salah}" harus ditolak`);
  }
  const r = await s1.post('/deal', { judul: 'Langsung menang', nilai: '1', tahap_id: tahap.Menang });
  assert.equal(r.status, 422, 'deal baru tidak boleh langsung di tahap tertutup');
});

test('total nilai dihitung di SQL tanpa galat float (0,10 + 0,20 = 0,30)', async () => {
  const s2 = await sebagai(u.s2);
  await buatDeal(s2, { judul: 'Sepuluh sen', nilai: '0,10' });
  await buatDeal(s2, { judul: 'Dua puluh sen', nilai: '0,20' });
  const daftar = await s2.get('/deal');
  assert.match(daftar.teks, /Rp 0,30/);
  assert.doesNotMatch(daftar.teks, /0,30000000000000004/);
  const papan = await s2.get('/pipeline');
  assert.match(papan.teks, /Rp 0,30/);
});

test('perpindahan tahap tercatat di riwayat; menang/kalah menutup deal; kalah wajib alasan', async () => {
  const s1 = await sebagai(u.s1);
  const id = await buatDeal(s1, { judul: 'Perjalanan Deal', nilai: '50000000' });
  const riwayat = async () => (await pool.query(
    `SELECT dari_tahap_id, ke_tahap_id, pengguna_id FROM riwayat_tahap WHERE deal_id = $1 ORDER BY id`, [id])).rows;

  assert.equal((await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Negosiasi })).status, 302);
  let r = await riwayat();
  assert.equal(r.length, 2);
  assert.deepEqual([String(r[1].dari_tahap_id), String(r[1].ke_tahap_id), String(r[1].pengguna_id)],
    [tahap.Kualifikasi, tahap.Negosiasi, String(u.s1.id)]);

  // Pindah ke tahap yang sama tidak menambah riwayat
  await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Negosiasi });
  assert.equal((await riwayat()).length, 2);

  const tanpaAlasan = await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Kalah });
  assert.equal(tanpaAlasan.status, 422);
  assert.equal(String((await ambilDeal(id)).tahap_id), tahap.Negosiasi, 'tahap tidak berubah');
  assert.equal((await riwayat()).length, 2);

  await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Kalah, alasan_kalah: 'Harga kompetitor lebih murah' });
  let d = await ambilDeal(id);
  assert.ok(d.ditutup_at);
  assert.equal(d.alasan_kalah, 'Harga kompetitor lebih murah');

  // Dibuka kembali lalu menang
  await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Penawaran });
  d = await ambilDeal(id);
  assert.equal(d.ditutup_at, null);
  assert.equal(d.alasan_kalah, null);
  await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Menang });
  d = await ambilDeal(id);
  assert.ok(d.ditutup_at);

  r = await riwayat();
  assert.deepEqual(r.map((x) => String(x.ke_tahap_id)),
    [tahap.Kualifikasi, tahap.Negosiasi, tahap.Kalah, tahap.Penawaran, tahap.Menang]);
  const detail = await s1.get(`/deal/${id}`);
  assert.match(detail.teks, /Kalah → Penawaran/);
});

test('seret-lepas kanban: POST HTMX mengembalikan papan baru dengan total diperbarui', async () => {
  const s1 = await sebagai(u.s1);
  const id = await buatDeal(s1, { judul: 'Kartu Kanban', nilai: '7000000' });
  const r = await s1.post(`/deal/${id}/tahap`, { tahap_id: tahap.Kebutuhan });
  assert.equal(r.status, 302);

  const papan = await kirimHtmx(s1, `/deal/${id}/tahap`, { tahap_id: tahap.Negosiasi });
  assert.equal(papan.status, 200);
  assert.match(papan.teks, /papan-kanban/);
  assert.doesNotMatch(papan.teks, /<html/);
  assert.match(papan.teks, /Kartu Kanban/);
  assert.equal(String((await ambilDeal(id)).tahap_id), tahap.Negosiasi);

  // Error dari kanban (kalah tanpa alasan) dikembalikan ke area notifikasi
  const galat = await kirimHtmx(s1, `/deal/${id}/tahap`, { tahap_id: tahap.Kalah });
  assert.equal(galat.status, 422);
  assert.equal(galat.header.get('hx-retarget'), '#notifikasi');
  assert.match(galat.teks, /Alasan kalah wajib diisi/);
});

test('hak akses deal: sales lain tidak bisa melihat atau memindahkan, manajer tim bisa', async () => {
  const s1 = await sebagai(u.s1);
  const id = await buatDeal(s1, { judul: 'Rahasia A1', nilai: '1000' });

  const s2 = await sebagai(u.s2);
  assert.equal((await s2.get(`/deal/${id}`)).status, 404);
  assert.equal((await s2.post(`/deal/${id}/tahap`, { tahap_id: tahap.Menang })).status, 404);
  assert.equal((await s2.post(`/deal/${id}`, { judul: 'Diubah', nilai: '1' })).status, 404);
  assert.doesNotMatch((await s2.get('/pipeline')).teks, /Rahasia A1/);
  assert.equal(String((await ambilDeal(id)).tahap_id), tahap.Kualifikasi);

  const m = await sebagai(u.manajer);
  assert.match((await m.get('/pipeline')).teks, /Rahasia A1/);
  assert.equal((await m.post(`/deal/${id}/tahap`, { tahap_id: tahap.Kebutuhan })).status, 302);

  // Tidak boleh menautkan kontak milik orang lain
  const kontakS2 = idDari((await s2.post('/kontak', { nama: 'Kontak B' })).lokasi);
  const r = await s1.post('/deal', { judul: 'Curang', nilai: '1', kontak_id: kontakS2, tahap_id: tahap.Kualifikasi });
  assert.equal(r.status, 422);
});

test('ubah deal mencatat audit hanya untuk kolom yang benar-benar berubah', async () => {
  const s1 = await sebagai(u.s1);
  const id = await buatDeal(s1, { judul: 'Audit Nilai', nilai: '100' });
  await s1.post(`/deal/${id}`, { judul: 'Audit Nilai', nilai: '100,00' });
  await s1.post(`/deal/${id}`, { judul: 'Audit Nilai Baru', nilai: '250' });
  const { rows } = await pool.query(
    `SELECT aksi, kolom FROM audit_log WHERE entitas = 'deal' AND entitas_id = $1 ORDER BY id`, [id]);
  assert.deepEqual(rows.map((x) => [x.aksi, [...x.kolom].sort()]), [['buat', []], ['ubah', ['judul', 'nilai']]]);
});

/** Mengirim POST bergaya HTMX (target #kanban) memakai cookie & CSRF milik klien tes. */
async function kirimHtmx(k, jalur, body) {
  return k.post(jalur, body, { 'HX-Request': 'true', 'HX-Target': 'kanban' });
}
