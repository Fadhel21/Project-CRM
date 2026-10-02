// Tes login, hak akses halaman admin, dan pengelolaan pengguna & tim
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');

let server;
let dasar;
let admin;
let sales;

before(async () => {
  await resetDb();
  admin = await buatPengguna({ nama: 'Admin', peran: 'admin' });
  sales = await buatPengguna({ nama: 'Sales Satu' });
  server = await jalankanServer();
  dasar = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('login salah ditolak, login benar masuk ke beranda', async () => {
  const k = klien(dasar);
  await k.get('/login');
  const salah = await k.post('/login', { email: admin.email, password: 'salah-sekali' });
  assert.equal(salah.status, 401);
  assert.match(salah.teks, /Email atau password salah/);

  await k.masuk(admin.email);
  const beranda = await k.get('/');
  assert.equal(beranda.status, 200);
  assert.match(beranda.teks, /class="baris-kpi"/);
});

test('sales tidak bisa membuka atau mengubah data pengguna', async () => {
  const k = klien(dasar);
  await k.masuk(sales.email);
  assert.equal((await k.get('/pengguna')).status, 403);
  const r = await k.post(`/pengguna/${sales.id}`, { nama: 'x', email: sales.email, peran: 'admin' });
  assert.equal(r.status, 403);
  const { rows } = await pool.query('SELECT peran FROM pengguna WHERE id = $1', [sales.id]);
  assert.equal(rows[0].peran, 'sales', 'peran tidak boleh berubah');
});

test('admin membuat tim dan pengguna; email ganda ditolak; audit tercatat', async () => {
  const k = klien(dasar);
  await k.masuk(admin.email);

  assert.equal((await k.post('/tim', { nama: 'Tim Jakarta' })).status, 302);
  const timId = (await pool.query(`SELECT id FROM tim WHERE nama = 'Tim Jakarta'`)).rows[0].id;

  const buat = await k.post('/pengguna', {
    nama: 'Manajer Baru', email: 'Manajer@Tes.Local', peran: 'manajer', tim_id: timId, password: 'password123' });
  assert.equal(buat.status, 302);
  const baru = (await pool.query(`SELECT * FROM pengguna WHERE email = 'manajer@tes.local'`)).rows[0];
  assert.ok(baru, 'email disimpan huruf kecil');
  assert.equal(baru.peran, 'manajer');

  const ganda = await k.post('/pengguna', {
    nama: 'Lain', email: 'manajer@tes.local', peran: 'sales', password: 'password123' });
  assert.equal(ganda.status, 422);
  assert.match(ganda.teks, /Email sudah dipakai/);

  const tanpaTim = await k.post('/pengguna', {
    nama: 'Manajer X', email: 'mx@tes.local', peran: 'manajer', password: 'password123' });
  assert.equal(tanpaTim.status, 422);

  const audit = await pool.query(`SELECT aksi FROM audit_log WHERE entitas = 'pengguna' AND entitas_id = $1`, [baru.id]);
  assert.deepEqual(audit.rows.map((r) => r.aksi), ['buat']);
});

test('admin tidak bisa menonaktifkan diri sendiri; pengguna nonaktif tidak bisa login', async () => {
  const k = klien(dasar);
  await k.masuk(admin.email);
  const diri = await k.post(`/pengguna/${admin.id}`, { nama: 'Admin', email: admin.email, peran: 'admin' });
  assert.equal(diri.status, 422);

  const timId = await buatTim('Tim Lepas');
  const korban = await buatPengguna({ nama: 'Akan Nonaktif', timId });
  const sk = klien(dasar);
  await sk.masuk(korban.email);
  assert.equal((await sk.get('/')).status, 200);

  const r = await k.post(`/pengguna/${korban.id}`, { nama: korban.nama, email: korban.email, peran: 'sales', tim_id: timId });
  assert.equal(r.status, 302);
  const setelah = await sk.get('/');
  assert.equal(setelah.status, 302, 'sesi lama langsung tidak berlaku');
  assert.equal(setelah.lokasi, '/login');
});
