// Tes dashboard: angka KPI, per tahap, tren, kinerja, dan bahwa angka mengikuti hak akses
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');
const laporan = require('../src/modules/crm/services/laporan');

let server;
let dasar;
const u = {};
const tahap = {};

async function sebagai(p) {
  const k = klien(dasar);
  await k.masuk(p.email);
  return k;
}
const idDari = (lokasi) => lokasi.match(/\/(\d+)\?/)[1];

async function deal(k, judul, nilai, namaTahap) {
  const id = idDari((await k.post('/deal', { judul, nilai, tahap_id: tahap.Kualifikasi })).lokasi);
  if (namaTahap !== 'Kualifikasi') {
    const r = await k.post(`/deal/${id}/tahap`, { tahap_id: tahap[namaTahap], alasan_kalah: 'Harga' });
    assert.equal(r.status, 302);
  }
  return id;
}

before(async () => {
  await resetDb();
  u.admin = await buatPengguna({ nama: 'Admin', peran: 'admin' });
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: await buatTim('Tim A') });
  u.s2 = await buatPengguna({ nama: 'Sales B', timId: await buatTim('Tim B') });
  for (const r of (await pool.query('SELECT id, nama FROM tahap_pipeline')).rows) tahap[r.nama] = String(r.id);
  server = await jalankanServer();
  dasar = `http://127.0.0.1:${server.address().port}`;

  const s1 = await sebagai(u.s1);
  await deal(s1, 'Terbuka kecil', '1.000.000', 'Kualifikasi');       // peluang 10%
  await deal(s1, 'Terbuka besar', '3000000.50', 'Negosiasi');         // peluang 75%
  await deal(s1, 'Menang bulan ini', '5.000.000', 'Menang');
  await deal(s1, 'Kalah bulan ini', '700.000', 'Kalah');
  const lama = await deal(s1, 'Menang dua bulan lalu', '2.000.000', 'Menang');
  await pool.query(`UPDATE deal SET ditutup_at = date_trunc('month', now()) - interval '2 months' + interval '3 days' WHERE id = $1`, [lama]);
  for (let i = 1; i <= 4; i += 1) await s1.post('/leads', { nama: `Lead ${i}`, abaikan_duplikat: 'ya' });
  const leadId = (await pool.query(`SELECT id FROM lead WHERE nama = 'Lead 1'`)).rows[0].id;
  await s1.post(`/leads/${leadId}/konversi`, { perusahaan_mode: 'tidak', kontak_mode: 'baru' });

  const s2 = await sebagai(u.s2);
  await deal(s2, 'Menang milik B', '9.999', 'Menang');
});

after(async () => {
  server.close();
  await pool.end();
});

test('KPI dihitung di SQL dan hanya dari data milik pengguna', async () => {
  const r = laporan.rentang('bulan_ini');
  const ring = await laporan.ringkasan({ ...u.s1 }, r);
  assert.equal(ring.deal.pipeline_nilai, '4000000.50');
  assert.equal(ring.deal.pipeline_jumlah, '2');
  // 1.000.000 x 10% + 3.000.000,50 x 75% = 100.000 + 2.250.000,375 -> 2.350.000,38
  assert.equal(ring.deal.pipeline_tertimbang, '2350000.38');
  assert.equal(ring.deal.menang_nilai, '5000000.00', 'menang 2 bulan lalu & milik B tidak ikut');
  assert.equal(ring.deal.menang_jumlah, '1');
  assert.equal(ring.deal.kalah_jumlah, '1');
  assert.equal(ring.winRate, '50.0');
  assert.equal(ring.lead.masuk, '4');
  assert.equal(ring.lead.dikonversi, '1');
  assert.equal(ring.konversi, '25.0');

  const admin = await laporan.ringkasan({ ...u.admin }, r);
  assert.equal(admin.deal.menang_nilai, '5009999.00', 'admin melihat semua');
  const filterB = await laporan.ringkasan({ ...u.admin }, { ...r, pemilikId: u.s2.id });
  assert.equal(filterB.deal.menang_nilai, '9999.00');
  assert.equal(filterB.winRate, '100.0');
});

test('per tahap menampilkan semua tahap terbuka (termasuk yang kosong) dan tren 6 bulan', async () => {
  const tahapRows = await laporan.perTahap({ ...u.s1 }, {});
  assert.deepEqual(tahapRows.map((t) => [t.nama, t.jumlah, t.nilai]), [
    ['Kualifikasi', '1', '1000000.00'], ['Kebutuhan', '0', '0'], ['Penawaran', '0', '0'], ['Negosiasi', '1', '3000000.50'],
  ]);
  const r = laporan.rentang('bulan_ini');
  const t = await laporan.tren({ ...u.s1 }, r);
  assert.equal(t.length, 6);
  assert.deepEqual([t[5].menang, t[5].kalah, t[5].nilai_menang], ['1', '1', '5000000.00']);
  assert.deepEqual([t[3].menang, t[3].nilai_menang], ['1', '2000000.00'], 'dua bulan lalu');
});

test('kinerja per sales mengikuti hak akses; periode kuartal/tahun menghitung ulang', async () => {
  const r = laporan.rentang('bulan_ini');
  const milikS1 = await laporan.kinerja({ ...u.s1 }, r);
  assert.deepEqual(milikS1.map((k) => k.nama), ['Sales A1']);
  assert.deepEqual([milikS1[0].menang, milikS1[0].kalah, milikS1[0].win_rate, milikS1[0].lead_masuk, milikS1[0].lead_konversi],
    ['1', '1', '50.0', '4', '1']);
  const semua = await laporan.kinerja({ ...u.admin }, r);
  assert.deepEqual(semua.map((k) => k.nama), ['Sales A1', 'Sales B', 'Admin']);

  const tahun = await laporan.ringkasan({ ...u.s1 }, laporan.rentang('tahun_ini'));
  const duaBulanLaluTahunIni = new Date().getMonth() >= 2;
  assert.equal(tahun.deal.menang_nilai, duaBulanLaluTahunIni ? '7000000.00' : '5000000.00');
  const kustom = laporan.rentang('kustom', '2026-12-31', '2026-01-01');
  assert.deepEqual([kustom.dari, kustom.sampai], ['2026-01-01', '2026-12-31'], 'rentang terbalik dirapikan');
});

test('halaman dashboard tampil, filter HTMX mengganti isi saja, sales tidak melihat filter pemilik', async () => {
  const s1 = await sebagai(u.s1);
  const hal = await s1.get('/');
  assert.equal(hal.status, 200);
  assert.match(hal.teks, /Rp 4\.000\.000,50/);
  assert.match(hal.teks, /50,0%/);
  assert.match(hal.teks, /data-grafik=/);
  assert.doesNotMatch(hal.teks, /Menang milik B/);
  assert.doesNotMatch(hal.teks, /name="pemilik"/);

  const admin = await sebagai(u.admin);
  const sebagian = await admin.get(`/?periode=bulan_ini&pemilik=${u.s2.id}`, { 'HX-Request': 'true', 'HX-Target': 'dasbor' });
  assert.equal(sebagian.status, 200);
  assert.doesNotMatch(sebagian.teks, /<html/);
  assert.match(sebagian.teks, /Rp 9\.999/);
  assert.match((await admin.get('/')).teks, /name="pemilik"/);
});
