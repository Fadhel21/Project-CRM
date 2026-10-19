// Tes pengaturan: hanya admin, validasi nilai, tahap pipeline (tambah/geser/nonaktif), sumber lead
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');

let server;
let dasar;
const u = {};
let tahapAwal;
let sumberAwal;
let nilaiAwal;

async function sebagai(p) {
  const k = klien(dasar);
  await k.masuk(p.email);
  return k;
}
const tahapBernama = async (nama) => (await pool.query('SELECT * FROM tahap_pipeline WHERE nama = $1', [nama])).rows[0];

before(async () => {
  await resetDb();
  tahapAwal = (await pool.query('SELECT id, nama, urutan, peluang_persen, aktif FROM tahap_pipeline')).rows;
  sumberAwal = (await pool.query('SELECT id, nama, aktif FROM sumber_lead')).rows;
  nilaiAwal = (await pool.query('SELECT kunci, nilai FROM pengaturan')).rows;
  u.admin = await buatPengguna({ nama: 'Admin', peran: 'admin' });
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: await buatTim('Tim A') });
  server = await jalankanServer();
  dasar = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Kembalikan data master seperti semula agar tes lain tidak terpengaruh
  await pool.query(`DELETE FROM tahap_pipeline WHERE id <> ALL($1::bigint[])`, [tahapAwal.map((t) => t.id)]);
  for (const t of tahapAwal) {
    await pool.query('UPDATE tahap_pipeline SET nama = $1, urutan = $2, peluang_persen = $3, aktif = $4 WHERE id = $5',
      [t.nama, t.urutan, t.peluang_persen, t.aktif, t.id]);
  }
  await pool.query('UPDATE lead SET sumber_id = NULL WHERE sumber_id <> ALL($1::bigint[])', [sumberAwal.map((s) => s.id)]);
  await pool.query(`DELETE FROM sumber_lead WHERE id <> ALL($1::bigint[])`, [sumberAwal.map((s) => s.id)]);
  for (const s of sumberAwal) await pool.query('UPDATE sumber_lead SET nama = $1, aktif = $2 WHERE id = $3', [s.nama, s.aktif, s.id]);
  for (const n of nilaiAwal) await pool.query('UPDATE pengaturan SET nilai = $1 WHERE kunci = $2', [n.nilai, n.kunci]);
  server.close();
  await pool.end();
});

test('hanya admin yang bisa membuka dan mengubah pengaturan', async () => {
  const s1 = await sebagai(u.s1);
  assert.equal((await s1.get('/pengaturan')).status, 403);
  assert.equal((await s1.post('/pengaturan', { pajak_persen: '50' })).status, 403);
  assert.equal((await s1.post('/pengaturan/tahap', { nama: 'Susupan', peluang_persen: '5' })).status, 403);
  assert.equal((await pool.query(`SELECT nilai FROM pengaturan WHERE kunci = 'pajak_persen'`)).rows[0].nilai, '11');
  assert.equal(await tahapBernama('Susupan'), undefined);
  const admin = await sebagai(u.admin);
  const hal = await admin.get('/pengaturan');
  assert.equal(hal.status, 200);
  assert.match(hal.teks, /Tahap pipeline/);
});

test('nilai umum divalidasi dan perubahan tercatat di audit', async () => {
  const admin = await sebagai(u.admin);
  const salah = await admin.post('/pengaturan', { nama_perusahaan: 'PT Uji', pajak_persen: '150', diskon_maks_persen: '20',
    penawaran_berlaku_hari: '0', penawaran_syarat: '', pengingat_menit_sebelum: '60' });
  assert.match(decodeURIComponent(salah.lokasi), /Tarif PPN \(%\) tidak valid/);
  assert.equal((await pool.query(`SELECT nilai FROM pengaturan WHERE kunci = 'nama_perusahaan'`)).rows[0].nilai !== 'PT Uji', true,
    'tidak ada yang tersimpan bila ada yang salah');

  const ok = await admin.post('/pengaturan', { nama_perusahaan: 'PT Maju Bersama', pajak_persen: '12', diskon_maks_persen: '15',
    penawaran_berlaku_hari: '14', penawaran_syarat: 'Syarat baru', pengingat_menit_sebelum: '30' });
  assert.match(ok.lokasi, /pesan=/);
  const n = Object.fromEntries((await pool.query('SELECT kunci, nilai FROM pengaturan')).rows.map((r) => [r.kunci, r.nilai]));
  assert.deepEqual([n.nama_perusahaan, n.pajak_persen, n.diskon_maks_persen, n.penawaran_berlaku_hari, n.pengingat_menit_sebelum],
    ['PT Maju Bersama', '12', '15', '14', '30']);
  const a = (await pool.query(`SELECT kolom FROM audit_log WHERE entitas = 'pengaturan' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(a.kolom.includes('pajak_persen'));
});

test('tahap baru masuk sebelum Menang/Kalah, bisa digeser, dan tampil di kanban', async () => {
  const admin = await sebagai(u.admin);
  await admin.post('/pengaturan/tahap', { nama: 'Demo produk', peluang_persen: '40' });
  const urut = async () => (await pool.query(
    `SELECT nama FROM tahap_pipeline WHERE aktif AND deleted_at IS NULL ORDER BY urutan, id`)).rows.map((r) => r.nama);
  assert.deepEqual(await urut(), ['Kualifikasi', 'Kebutuhan', 'Penawaran', 'Negosiasi', 'Demo produk', 'Menang', 'Kalah']);

  const demo = await tahapBernama('Demo produk');
  await admin.post(`/pengaturan/tahap/${demo.id}/geser`, { arah: 'atas' });
  assert.deepEqual(await urut(), ['Kualifikasi', 'Kebutuhan', 'Penawaran', 'Demo produk', 'Negosiasi', 'Menang', 'Kalah']);
  assert.match((await admin.get('/pipeline')).teks, /Demo produk/);

  const ganda = await admin.post('/pengaturan/tahap', { nama: 'demo PRODUK', peluang_persen: '10' });
  assert.match(decodeURIComponent(ganda.lokasi), /sudah dipakai/);
  const peluangSalah = await admin.post(`/pengaturan/tahap/${demo.id}`, { nama: 'Demo produk', peluang_persen: '120' });
  assert.match(decodeURIComponent(peluangSalah.lokasi), /Peluang harus angka 0-100/);
});

test('aturan nonaktif tahap: tidak boleh bila berisi deal, Menang/Kalah, atau tahap terbuka terakhir', async () => {
  const admin = await sebagai(u.admin);
  const kebutuhan = await tahapBernama('Kebutuhan');
  const r = await admin.post('/deal', { judul: 'Deal di Kebutuhan', nilai: '1', tahap_id: kebutuhan.id });
  assert.equal(r.status, 302);
  const berisi = await admin.post(`/pengaturan/tahap/${kebutuhan.id}/aktif`, { aktif: '0' });
  assert.match(decodeURIComponent(berisi.lokasi), /masih berisi 1 deal/);
  assert.equal((await tahapBernama('Kebutuhan')).aktif, true);

  const menang = await tahapBernama('Menang');
  assert.match(decodeURIComponent((await admin.post(`/pengaturan/tahap/${menang.id}/aktif`, { aktif: '0' })).lokasi), /tidak bisa dinonaktifkan/);

  const demo = await tahapBernama('Demo produk');
  await admin.post(`/pengaturan/tahap/${demo.id}/aktif`, { aktif: '0' });
  assert.equal((await tahapBernama('Demo produk')).aktif, false);
  assert.doesNotMatch((await admin.get('/pipeline')).teks, /Demo produk/, 'tahap nonaktif hilang dari kanban');

  // Nonaktifkan semua tahap terbuka kosong; yang terakhir harus ditolak
  await pool.query(`UPDATE deal SET deleted_at = now() WHERE judul = 'Deal di Kebutuhan'`);
  const terbuka = (await pool.query(`SELECT id FROM tahap_pipeline WHERE jenis = 'terbuka' AND aktif ORDER BY urutan`)).rows;
  for (const t of terbuka.slice(0, -1)) await admin.post(`/pengaturan/tahap/${t.id}/aktif`, { aktif: '0' });
  const terakhir = await admin.post(`/pengaturan/tahap/${terbuka.at(-1).id}/aktif`, { aktif: '0' });
  assert.match(decodeURIComponent(terakhir.lokasi), /Minimal harus ada satu tahap terbuka/);
});

test('sumber lead: tambah, nama ganda ditolak, nonaktif hilang dari formulir lead', async () => {
  const admin = await sebagai(u.admin);
  await admin.post('/pengaturan/sumber', { nama: 'Iklan Google' });
  const s = (await pool.query(`SELECT * FROM sumber_lead WHERE nama = 'Iklan Google'`)).rows[0];
  assert.ok(s);
  assert.match(decodeURIComponent((await admin.post('/pengaturan/sumber', { nama: 'iklan google' })).lokasi), /sudah dipakai/);
  assert.match((await admin.get('/leads/baru')).teks, /Iklan Google/);
  await admin.post(`/pengaturan/sumber/${s.id}/aktif`, { aktif: '0' });
  assert.doesNotMatch((await admin.get('/leads/baru')).teks, /Iklan Google/);
});
