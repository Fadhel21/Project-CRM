// Tes leads: duplikat, hak akses, dan konversi lead dalam satu transaksi
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien } = require('./bantu');
const leadService = require('../src/modules/crm/services/lead');

let server;
let dasar;
const u = {};

before(async () => {
  await resetDb();
  const timA = await buatTim('Tim A');
  u.manajer = await buatPengguna({ nama: 'Manajer A', peran: 'manajer', timId: timA });
  u.s1 = await buatPengguna({ nama: 'Sales A1', timId: timA });
  u.s2 = await buatPengguna({ nama: 'Sales B', timId: await buatTim('Tim B') });
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
const hitung = async (tabel) => Number((await pool.query(`SELECT count(*) FROM ${tabel}`)).rows[0].count);

async function buatLead(k, data) {
  const r = await k.post('/leads', data);
  assert.equal(r.status, 302, r.teks.slice(0, 300));
  return idDari(r.lokasi);
}

test('lead baru dicek duplikat terhadap kontak dan lead lain', async () => {
  const s1 = await sebagai(u.s1);
  await s1.post('/kontak', { nama: 'Kontak Lama', email: 'lama@contoh.id' });
  const r = await s1.post('/leads', { nama: 'Lead Mirip', email: 'LAMA@contoh.id' });
  assert.equal(r.status, 409);
  assert.match(r.teks, /Kontak Lama/);

  await buatLead(s1, { nama: 'Lead Pertama', telepon: '0813-0000-1111' });
  const s2 = await sebagai(u.s2);
  const r2 = await s2.post('/leads', { nama: 'Lead Kedua', telepon: '+62 813 0000 1111' });
  assert.equal(r2.status, 409);
  assert.match(r2.teks, /lead: <strong>Lead Pertama/);
});

test('konversi lengkap: perusahaan + kontak + deal dalam satu transaksi, lead hanya ditandai', async () => {
  const s1 = await sebagai(u.s1);
  const leadId = await buatLead(s1, {
    nama: 'Rina Wijaya', nama_perusahaan: 'CV Sinar Abadi', jabatan: 'Pembelian', email: 'rina@sinar.id', status: 'dihubungi' });

  const r = await s1.post(`/leads/${leadId}/konversi`, {
    perusahaan_mode: 'baru', perusahaan_nama: 'CV Sinar Abadi', kontak_mode: 'baru',
    buat_deal: 'ya', deal_judul: 'Pengadaan Q4', deal_nilai: '15.000.000,50', deal_target_tutup: '2026-12-31' });
  assert.equal(r.status, 302);

  const lead = (await pool.query('SELECT * FROM lead WHERE id = $1', [leadId])).rows[0];
  assert.ok(lead.konversi_at, 'lead ditandai dikonversi');
  assert.equal(lead.deleted_at, null, 'lead tidak dihapus');
  assert.ok(lead.kontak_id && lead.perusahaan_id && lead.deal_id, 'lead tertaut ke semua hasil');

  const kontak = (await pool.query('SELECT * FROM kontak WHERE id = $1', [lead.kontak_id])).rows[0];
  assert.equal(kontak.nama, 'Rina Wijaya');
  assert.equal(kontak.jabatan, 'Pembelian');
  assert.equal(String(kontak.perusahaan_id), String(lead.perusahaan_id));
  assert.equal(String(kontak.pemilik_id), String(u.s1.id));

  const deal = (await pool.query(
    `SELECT d.*, t.nama AS tahap FROM deal d JOIN tahap_pipeline t ON t.id = d.tahap_id WHERE d.id = $1`, [lead.deal_id])).rows[0];
  assert.equal(deal.nilai, '15000000.50', 'nilai tersimpan tepat tanpa float');
  assert.equal(deal.tahap, 'Kualifikasi');
  assert.equal(String(deal.lead_id), String(leadId));
  assert.equal(String(deal.kontak_id), String(lead.kontak_id));

  const riwayat = (await pool.query('SELECT * FROM riwayat_tahap WHERE deal_id = $1', [deal.id])).rows;
  assert.equal(riwayat.length, 1);
  assert.equal(riwayat[0].dari_tahap_id, null);

  const detail = await s1.get(`/leads/${leadId}`);
  assert.match(detail.teks, /Dikonversi oleh/);
  assert.equal((await s1.post(`/leads/${leadId}`, { nama: 'Ubah' })).status, 422, 'lead terkonversi tidak bisa diubah');
  assert.equal((await s1.post(`/leads/${leadId}/hapus`, {})).status, 422, 'lead terkonversi tidak bisa dihapus');
});

test('konversi gagal di tengah membatalkan semuanya (rollback)', async () => {
  const s1 = await sebagai(u.s1);
  const leadId = await buatLead(s1, { nama: 'Gagal Tengah', nama_perusahaan: 'PT Batal', email: 'batal@pt.id' });
  const sebelum = { p: await hitung('perusahaan'), k: await hitung('kontak'), d: await hitung('deal') };

  // Perusahaan & kontak dibuat dulu, lalu deal gagal validasi -> semua harus batal
  const r = await s1.post(`/leads/${leadId}/konversi`, {
    perusahaan_mode: 'baru', perusahaan_nama: 'PT Batal', kontak_mode: 'baru',
    buat_deal: 'ya', deal_judul: 'Deal', deal_nilai: 'seratus ribu' });
  assert.equal(r.status, 422);
  assert.match(r.teks, /Nilai deal tidak valid/);

  assert.deepEqual({ p: await hitung('perusahaan'), k: await hitung('kontak'), d: await hitung('deal') }, sebelum);
  const lead = (await pool.query('SELECT konversi_at FROM lead WHERE id = $1', [leadId])).rows[0];
  assert.equal(lead.konversi_at, null);
});

test('konversi ganda bersamaan: hanya satu yang berhasil', async () => {
  const s1 = await sebagai(u.s1);
  const leadId = await buatLead(s1, { nama: 'Dobel Klik', email: 'dobel@contoh.id' });
  const sebelum = await hitung('kontak');
  const pengguna = { ...u.s1 };
  const input = { kontak_mode: 'baru', perusahaan_mode: 'tidak' };

  const hasil = await Promise.allSettled([
    leadService.konversi(leadId, input, pengguna),
    leadService.konversi(leadId, input, pengguna),
  ]);
  assert.equal(hasil.filter((h) => h.status === 'fulfilled').length, 1);
  assert.equal(hasil.find((h) => h.status === 'rejected').reason.status, 409);
  assert.equal(await hitung('kontak'), sebelum + 1, 'hanya satu kontak dibuat');
});

test('hak akses konversi: sales lain ditolak, manajer boleh dan hasil tetap milik sales', async () => {
  const s1 = await sebagai(u.s1);
  const leadId = await buatLead(s1, { nama: 'Milik A1', nama_perusahaan: 'PT A1' });

  const s2 = await sebagai(u.s2);
  assert.equal((await s2.get(`/leads/${leadId}`)).status, 404);
  assert.equal((await s2.post(`/leads/${leadId}/konversi`, { kontak_mode: 'baru' })).status, 404);
  assert.equal((await pool.query('SELECT konversi_at FROM lead WHERE id = $1', [leadId])).rows[0].konversi_at, null);

  const m = await sebagai(u.manajer);
  const r = await m.post(`/leads/${leadId}/konversi`, {
    perusahaan_mode: 'baru', perusahaan_nama: 'PT A1', kontak_mode: 'baru', buat_deal: 'ya', deal_judul: 'Deal A1', deal_nilai: '1000' });
  assert.equal(r.status, 302);
  const lead = (await pool.query('SELECT * FROM lead WHERE id = $1', [leadId])).rows[0];
  assert.equal(String(lead.konversi_oleh), String(u.manajer.id));
  for (const [tabel, id] of [['kontak', lead.kontak_id], ['perusahaan', lead.perusahaan_id], ['deal', lead.deal_id]]) {
    const { rows } = await pool.query(`SELECT pemilik_id FROM ${tabel} WHERE id = $1`, [id]);
    assert.equal(String(rows[0].pemilik_id), String(u.s1.id), `${tabel} dimiliki pemilik lead`);
  }
});

test('konversi ke kontak yang sudah ada tidak membuat kontak baru; lead tidak layak ditolak', async () => {
  const s1 = await sebagai(u.s1);
  const kontakId = idDari((await s1.post('/kontak', { nama: 'Sudah Ada', email: 'ada@contoh.id' })).lokasi);
  const leadId = await buatLead(s1, { nama: 'Sudah Ada', email: 'ada@contoh.id', abaikan_duplikat: 'ya' });
  const sebelum = await hitung('kontak');
  const r = await s1.post(`/leads/${leadId}/konversi`, { perusahaan_mode: 'tidak', kontak_mode: 'ada', kontak_id: kontakId });
  assert.equal(r.status, 302);
  assert.equal(await hitung('kontak'), sebelum);
  assert.equal(String((await pool.query('SELECT kontak_id FROM lead WHERE id = $1', [leadId])).rows[0].kontak_id), kontakId);

  const tl = await buatLead(s1, { nama: 'Tidak Layak', status: 'tidak_layak' });
  assert.equal((await s1.post(`/leads/${tl}/konversi`, { kontak_mode: 'baru' })).status, 422);
});

test('halaman daftar lead, filter HTMX, dan formulir konversi tampil', async () => {
  const s1 = await sebagai(u.s1);
  const leadId = await buatLead(s1, { nama: 'Tampil Saja', nama_perusahaan: 'PT Tampil', status: 'baru', abaikan_duplikat: 'ya' });
  const daftar = await s1.get('/leads');
  assert.equal(daftar.status, 200);
  assert.match(daftar.teks, /Tampil Saja/);
  assert.doesNotMatch(daftar.teks, /Rina Wijaya/, 'lead terkonversi tidak muncul di daftar default');

  const terkonversi = await s1.get('/leads?status=dikonversi', { 'HX-Request': 'true', 'HX-Target': 'hasil' });
  assert.match(terkonversi.teks, /Rina Wijaya/);
  assert.doesNotMatch(terkonversi.teks, /Tampil Saja|<html/);

  const form = await s1.get(`/leads/${leadId}/konversi`);
  assert.equal(form.status, 200);
  assert.match(form.teks, /Konversi sekarang/);
  assert.match(form.teks, /value="PT Tampil"/);
});
