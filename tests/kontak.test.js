// Tes perusahaan & kontak: kepemilikan data per peran, duplikat, soft delete
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');

let server;
let dasar;
const u = {};

before(async () => {
  await resetDb();
  const timA = await buatTim('Tim A');
  const timB = await buatTim('Tim B');
  u.admin = await buatPengguna({ nama: 'Admin', peran: 'admin' });
  u.manajer = await buatPengguna({ nama: 'Manajer A', peran: 'manajer', timId: timA });
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: timA });
  u.s2 = await buatPengguna({ nama: 'Sales A2', timId: timA });
  u.s3 = await buatPengguna({ nama: 'Sales B1', timId: timB });
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

test('kontak milik sales hanya terlihat oleh dirinya, manajer timnya, dan admin', async () => {
  const s1 = await sebagai(u.s1);
  // Sales mencoba menetapkan pemilik lain: diabaikan, tetap dirinya sendiri
  const r = await s1.post('/kontak', { nama: 'Budi Pelanggan', email: 'budi@pelanggan.id', telepon: '+62 812-1111-2222', pemilik_id: u.s3.id });
  assert.equal(r.status, 302);
  const id = idDari(r.lokasi);
  const row = (await pool.query('SELECT pemilik_id, telepon_normal FROM kontak WHERE id = $1', [id])).rows[0];
  assert.equal(String(row.pemilik_id), String(u.s1.id));
  assert.equal(row.telepon_normal, '081211112222');

  for (const [p, boleh] of [[u.s1, true], [u.manajer, true], [u.admin, true], [u.s2, false], [u.s3, false]]) {
    const k = await sebagai(p);
    const detail = await k.get(`/kontak/${id}`);
    assert.equal(detail.status, boleh ? 200 : 404, `${p.nama} membuka detail`);
    const daftar = await k.get('/kontak');
    assert.equal(daftar.teks.includes('Budi Pelanggan'), boleh, `${p.nama} melihat di daftar`);
    if (!boleh) {
      const ubah = await k.post(`/kontak/${id}`, { nama: 'Diretas' });
      assert.equal(ubah.status, 404, `${p.nama} tidak bisa mengubah`);
      const hapus = await k.post(`/kontak/${id}/hapus`, {});
      assert.equal(hapus.status, 404, `${p.nama} tidak bisa menghapus`);
    }
  }
  const akhir = (await pool.query('SELECT nama, deleted_at FROM kontak WHERE id = $1', [id])).rows[0];
  assert.equal(akhir.nama, 'Budi Pelanggan');
  assert.equal(akhir.deleted_at, null);
});

test('manajer hanya boleh menugaskan ke anggota timnya', async () => {
  const m = await sebagai(u.manajer);
  const keTim = await m.post('/kontak', { nama: 'Untuk A2', pemilik_id: u.s2.id });
  assert.equal(keTim.status, 302);
  const pemilik = (await pool.query('SELECT pemilik_id FROM kontak WHERE id = $1', [idDari(keTim.lokasi)])).rows[0].pemilik_id;
  assert.equal(String(pemilik), String(u.s2.id));

  const keLuar = await m.post('/kontak', { nama: 'Untuk B1', pemilik_id: u.s3.id });
  assert.equal(keLuar.status, 422);
  assert.match(keLuar.teks, /tidak boleh menugaskan/);
});

test('duplikat email/telepon diperingatkan, tidak digabung, bisa tetap disimpan', async () => {
  const s3 = await sebagai(u.s3);
  const sebelum = Number((await pool.query('SELECT count(*) FROM kontak')).rows[0].count);

  const ganda = await s3.post('/kontak', { nama: 'Budi Lain', email: 'BUDI@pelanggan.id' });
  assert.equal(ganda.status, 409);
  assert.match(ganda.teks, /Kemungkinan data ganda/);
  assert.match(ganda.teks, /Budi Pelanggan/);
  const teleponSama = await s3.post('/kontak', { nama: 'Budi Tlp', telepon: '0812 1111 2222' });
  assert.equal(teleponSama.status, 409);
  assert.equal(Number((await pool.query('SELECT count(*) FROM kontak')).rows[0].count), sebelum, 'belum ada yang tersimpan');

  const tetap = await s3.post('/kontak', { nama: 'Budi Lain', email: 'budi@pelanggan.id', abaikan_duplikat: 'ya' });
  assert.equal(tetap.status, 302);
  const { rows } = await pool.query(`SELECT pemilik_id FROM kontak WHERE lower(email) = 'budi@pelanggan.id' ORDER BY id`);
  assert.equal(rows.length, 2, 'dua data terpisah, tidak digabung');
  assert.equal(String(rows[0].pemilik_id), String(u.s1.id), 'pemilik data lama tidak berubah');
});

test('kontak tidak boleh ditautkan ke perusahaan milik orang lain', async () => {
  const s1 = await sebagai(u.s1);
  const p = await s1.post('/perusahaan', { nama: 'PT Maju Jaya', industri: 'Manufaktur' });
  assert.equal(p.status, 302);
  const perusahaanId = idDari(p.lokasi);

  const s3 = await sebagai(u.s3);
  assert.equal((await s3.get(`/perusahaan/${perusahaanId}`)).status, 404);
  const r = await s3.post('/kontak', { nama: 'Penyusup', perusahaan_id: perusahaanId });
  assert.equal(r.status, 422);

  const ok = await s1.post('/kontak', { nama: 'Sari', perusahaan_id: perusahaanId });
  assert.equal(ok.status, 302);
  assert.match((await s1.get(`/perusahaan/${perusahaanId}`)).teks, /Sari/);
});

test('hapus adalah soft delete dan tercatat di audit; pencarian HTMX mengembalikan tabel saja', async () => {
  const s1 = await sebagai(u.s1);
  const r = await s1.post('/kontak', { nama: 'Akan Dihapus' });
  const id = idDari(r.lokasi);
  assert.equal((await s1.post(`/kontak/${id}/hapus`, {})).status, 302);

  const row = (await pool.query('SELECT deleted_at FROM kontak WHERE id = $1', [id])).rows[0];
  assert.ok(row.deleted_at, 'baris masih ada dengan deleted_at terisi');
  assert.equal((await s1.get(`/kontak/${id}`)).status, 404);
  const aksi = (await pool.query(`SELECT aksi FROM audit_log WHERE entitas = 'kontak' AND entitas_id = $1 ORDER BY id`, [id])).rows;
  assert.deepEqual(aksi.map((a) => a.aksi), ['buat', 'hapus']);

  const cari = await s1.get('/kontak?q=Sari', { 'HX-Request': 'true', 'HX-Target': 'hasil' });
  assert.equal(cari.status, 200);
  assert.match(cari.teks, /Sari/);
  assert.doesNotMatch(cari.teks, /<html|Budi/, 'hanya potongan tabel hasil pencarian');

  const anon = await fetch(`${dasar}/kontak?q=Sari`, { headers: { 'HX-Request': 'true' }, redirect: 'manual' });
  assert.equal(anon.status, 401, 'tanpa login ditolak');
  assert.equal(anon.headers.get('hx-redirect'), '/login');
});
