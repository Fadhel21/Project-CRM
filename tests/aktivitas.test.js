// Tes aktivitas, tugas, dan linimasa: tautan ke kontak/deal, urutan waktu, hak akses, zona waktu
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
  u.admin = await buatPengguna({ nama: 'Admin', peran: 'admin' });
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
const HX = { 'HX-Request': 'true' };

async function siapkanKontakDeal(k, nama) {
  const kontakId = idDari((await k.post('/kontak', { nama, abaikan_duplikat: 'ya' })).lokasi);
  const dealId = idDari((await k.post('/deal', {
    judul: `Deal ${nama}`, nilai: '1000', kontak_id: kontakId, tahap_id: tahap.Kualifikasi })).lokasi);
  return { kontakId, dealId };
}

test('linimasa kontak menggabungkan catatan, telepon, aktivitas deal, dan perubahan tahap, terurut waktu', async () => {
  const s1 = await sebagai(u.s1);
  const { kontakId, dealId } = await siapkanKontakDeal(s1, 'Andi Linimasa');

  const r = await s1.post('/aktivitas', { konteks: 'kontak', kontak_id: kontakId, jenis: 'catatan', isi: 'Suka dihubungi pagi' }, HX);
  assert.equal(r.status, 200);
  assert.match(r.teks, /id="linimasa"/);
  assert.match(r.teks, /Suka dihubungi pagi/);
  assert.doesNotMatch(r.teks, /<html/);

  await s1.post('/aktivitas', {
    konteks: 'kontak', kontak_id: kontakId, jenis: 'telepon', judul: 'Telepon perkenalan', jadwal_at: '2026-01-10T10:00' }, HX);
  // Aktivitas dibuat di deal -> otomatis tertaut ke kontak deal
  await s1.post('/aktivitas', { konteks: 'deal', deal_id: dealId, jenis: 'email', judul: 'Kirim brosur' }, HX);
  const akt = (await pool.query(`SELECT kontak_id FROM aktivitas WHERE judul = 'Kirim brosur'`)).rows[0];
  assert.equal(String(akt.kontak_id), kontakId);
  await s1.post(`/deal/${dealId}/tahap`, { tahap_id: tahap.Negosiasi });

  const halaman = (await s1.get(`/kontak/${kontakId}`)).teks;
  const posisi = ['Kirim brosur', 'Kualifikasi → Negosiasi', 'Suka dihubungi pagi', 'Telepon perkenalan'].map((t) => halaman.indexOf(t));
  assert.ok(posisi.every((p) => p > 0), `semua item tampil: ${posisi}`);
  // Telepon dijadwalkan Januari 2026 -> paling bawah; sisanya baru saja
  assert.ok(posisi[3] > Math.max(posisi[0], posisi[1], posisi[2]), 'urutan terbaru di atas');

  const halDeal = (await s1.get(`/deal/${dealId}`)).teks;
  assert.match(halDeal, /Kirim brosur/);
  assert.match(halDeal, /Kualifikasi → Negosiasi/);
  assert.doesNotMatch(halDeal, /Suka dihubungi pagi/, 'catatan kontak tidak muncul di linimasa deal');
});

test('hak akses aktivitas: tidak bisa menautkan ke data orang lain atau mengubah tugas orang lain', async () => {
  const s1 = await sebagai(u.s1);
  const { kontakId, dealId } = await siapkanKontakDeal(s1, 'Milik A1');
  const s2 = await sebagai(u.s2);
  const milikS2 = await siapkanKontakDeal(s2, 'Milik B');
  const sebelum = Number((await pool.query('SELECT count(*) FROM aktivitas')).rows[0].count);

  for (const body of [
    { konteks: 'kontak', kontak_id: kontakId, jenis: 'catatan', isi: 'Menyusup' },
    { konteks: 'deal', deal_id: dealId, jenis: 'catatan', isi: 'Menyusup' },
    { konteks: 'deal', deal_id: milikS2.dealId, kontak_id: kontakId, jenis: 'catatan', isi: 'Menyusup via deal sendiri' },
  ]) {
    const r = await s2.post('/aktivitas', body, HX);
    assert.equal(r.status, 422, JSON.stringify(body));
  }
  assert.equal(Number((await pool.query('SELECT count(*) FROM aktivitas')).rows[0].count), sebelum);

  await s1.post('/aktivitas', { konteks: 'kontak', kontak_id: kontakId, jenis: 'tugas', judul: 'Tugas A1', jadwal_at: '2026-12-01T09:00' }, HX);
  const tugasId = (await pool.query(`SELECT id FROM aktivitas WHERE judul = 'Tugas A1'`)).rows[0].id;
  assert.equal((await s2.post(`/aktivitas/${tugasId}/selesai`, { selesai: '1' }, HX)).status, 404);
  assert.equal((await s2.post(`/aktivitas/${tugasId}/hapus`, {}, HX)).status, 404);
  const t = (await pool.query('SELECT selesai_at, deleted_at FROM aktivitas WHERE id = $1', [tugasId])).rows[0];
  assert.equal(t.selesai_at, null);
  assert.equal(t.deleted_at, null);
  assert.doesNotMatch((await s2.get('/tugas')).teks, /Tugas A1/);
});

test('linimasa kontak tidak membocorkan perubahan tahap deal milik orang lain', async () => {
  const s1 = await sebagai(u.s1);
  const kontakId = idDari((await s1.post('/kontak', { nama: 'Kontak Bersama', abaikan_duplikat: 'ya' })).lokasi);
  const admin = await sebagai(u.admin);
  const r = await admin.post('/deal', { judul: 'Deal Rahasia Admin', nilai: '5', kontak_id: kontakId, tahap_id: tahap.Kualifikasi });
  const dealAdmin = idDari(r.lokasi);
  await admin.post(`/deal/${dealAdmin}/tahap`, { tahap_id: tahap.Penawaran });

  assert.match((await admin.get(`/kontak/${kontakId}`)).teks, /Deal Rahasia Admin/);
  assert.doesNotMatch((await s1.get(`/kontak/${kontakId}`)).teks, /Deal Rahasia Admin/);
});

test('tugas: tenggat wajib, penugasan oleh manajer, filter terlambat, tandai selesai', async () => {
  const m = await sebagai(u.manajer);
  const s1 = await sebagai(u.s1);
  const { kontakId } = await siapkanKontakDeal(s1, 'Kontak Tugas');

  const tanpaTenggat = await s1.post('/aktivitas', { konteks: 'kontak', kontak_id: kontakId, jenis: 'tugas', judul: 'Tanpa tenggat' }, HX);
  assert.equal(tanpaTenggat.status, 422);
  assert.match(tanpaTenggat.teks, /wajib punya tenggat/);

  const r = await m.post('/aktivitas', {
    konteks: 'kontak', kontak_id: kontakId, jenis: 'tugas', judul: 'Follow-up penawaran', jadwal_at: '2020-01-01T09:00', pemilik_id: u.s1.id }, HX);
  assert.equal(r.status, 200);
  const tugas = (await pool.query(`SELECT * FROM aktivitas WHERE judul = 'Follow-up penawaran'`)).rows[0];
  assert.equal(String(tugas.pemilik_id), String(u.s1.id));
  assert.equal(String(tugas.dibuat_oleh), String(u.manajer.id));
  assert.equal(tugas.selesai_at, null);

  const keLuar = await m.post('/aktivitas', {
    konteks: 'kontak', kontak_id: kontakId, jenis: 'tugas', judul: 'Ke tim lain', jadwal_at: '2026-12-01T09:00', pemilik_id: u.s2.id }, HX);
  assert.equal(keLuar.status, 422);

  const terlambat = await s1.get('/tugas?filter=terlambat');
  assert.match(terlambat.teks, /Follow-up penawaran/);
  assert.match(terlambat.teks, /Terlambat/);

  const selesai = await s1.post(`/aktivitas/${tugas.id}/selesai`, { selesai: '1', tampil_konteks: '1' }, HX);
  assert.equal(selesai.status, 200);
  assert.match(selesai.teks, /Buka lagi/);
  assert.match(selesai.teks, /Kontak Tugas/, 'nama kontak tetap tampil setelah ditandai selesai');
  assert.ok((await pool.query('SELECT selesai_at FROM aktivitas WHERE id = $1', [tugas.id])).rows[0].selesai_at);
  assert.doesNotMatch((await s1.get('/tugas?filter=terlambat')).teks, /Follow-up penawaran/);
  assert.match((await s1.get('/tugas?filter=selesai')).teks, /Follow-up penawaran/);
});

test('waktu input dibaca sebagai WIB dan ditampilkan kembali sama', async () => {
  const s1 = await sebagai(u.s1);
  const { kontakId } = await siapkanKontakDeal(s1, 'Kontak Zona');
  await s1.post('/aktivitas', { konteks: 'kontak', kontak_id: kontakId, jenis: 'rapat', judul: 'Rapat zona', jadwal_at: '2026-10-05T09:00' }, HX);
  const { rows } = await pool.query(
    `SELECT to_char(jadwal_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc FROM aktivitas WHERE judul = 'Rapat zona'`);
  assert.equal(rows[0].utc, '2026-10-05 02:00');
  assert.match((await s1.get(`/kontak/${kontakId}`)).teks, /05\/10\/2026 09:00/);
});
