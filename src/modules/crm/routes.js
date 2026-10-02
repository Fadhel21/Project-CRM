// Daftar route modul CRM
const express = require('express');
const { wajibLogin } = require('../../middleware/auth');
const { butuhPeran, pastikanAkses } = require('../../middleware/akses');
const pengguna = require('./controllers/pengguna');
const laporan = require('./controllers/laporan');
const perusahaan = require('./controllers/perusahaan');
const kontak = require('./controllers/kontak');
const perusahaanService = require('./services/perusahaan');
const kontakService = require('./services/kontak');
const lead = require('./controllers/lead');
const leadService = require('./services/lead');
const deal = require('./controllers/deal');
const dealService = require('./services/deal');

const r = express.Router();
const admin = butuhPeran('admin');

// Publik
r.get('/login', pengguna.formLogin);
r.post('/login', pengguna.login);
r.post('/logout', pengguna.logout);

// Semua route di bawah ini wajib login
r.use(wajibLogin);
r.get('/', laporan.beranda);

// Pengguna & tim (admin)
r.get('/pengguna', admin, pengguna.halamanDaftar);
r.get('/pengguna/baru', admin, pengguna.formBaru);
r.post('/pengguna', admin, pengguna.simpan);
r.get('/pengguna/:id(\\d+)/ubah', admin, pengguna.formUbah);
r.post('/pengguna/:id(\\d+)', admin, pengguna.simpan);
r.post('/tim', admin, pengguna.simpanTim);
r.post('/tim/:id(\\d+)', admin, pengguna.simpanTim);

// Perusahaan & kontak (akses per baris diperiksa oleh pastikanAkses + filter di service)
const aksesPerusahaan = pastikanAkses(perusahaanService.ambil);
r.get('/perusahaan', perusahaan.daftar);
r.get('/perusahaan/baru', perusahaan.formBaru);
r.post('/perusahaan', perusahaan.simpan);
r.get('/perusahaan/:id(\\d+)', aksesPerusahaan, perusahaan.detail);
r.get('/perusahaan/:id(\\d+)/ubah', aksesPerusahaan, perusahaan.formUbah);
r.post('/perusahaan/:id(\\d+)', aksesPerusahaan, perusahaan.simpan);
r.post('/perusahaan/:id(\\d+)/hapus', aksesPerusahaan, perusahaan.hapus);

const aksesKontak = pastikanAkses(kontakService.ambil);
r.get('/kontak', kontak.daftar);
r.get('/kontak/baru', kontak.formBaru);
r.post('/kontak', kontak.simpan);
r.get('/kontak/:id(\\d+)', aksesKontak, kontak.detail);
r.get('/kontak/:id(\\d+)/ubah', aksesKontak, kontak.formUbah);
r.post('/kontak/:id(\\d+)', aksesKontak, kontak.simpan);
r.post('/kontak/:id(\\d+)/hapus', aksesKontak, kontak.hapus);

// Leads
const aksesLead = pastikanAkses(leadService.ambil);
r.get('/leads', lead.daftar);
r.get('/leads/baru', lead.formBaru);
r.post('/leads', lead.simpan);
r.get('/leads/:id(\\d+)', aksesLead, lead.detail);
r.get('/leads/:id(\\d+)/ubah', aksesLead, lead.formUbah);
r.post('/leads/:id(\\d+)', aksesLead, lead.simpan);
r.post('/leads/:id(\\d+)/hapus', aksesLead, lead.hapus);
r.get('/leads/:id(\\d+)/konversi', aksesLead, lead.formKonversi);
r.post('/leads/:id(\\d+)/konversi', aksesLead, lead.konversi);

// Deal & pipeline
const aksesDeal = pastikanAkses(dealService.ambil);
r.get('/pipeline', deal.kanban);
r.get('/deal', deal.daftar);
r.get('/deal/baru', deal.formBaru);
r.post('/deal', deal.simpan);
r.get('/deal/:id(\\d+)', aksesDeal, deal.detail);
r.get('/deal/:id(\\d+)/ubah', aksesDeal, deal.formUbah);
r.post('/deal/:id(\\d+)', aksesDeal, deal.simpan);
r.post('/deal/:id(\\d+)/tahap', aksesDeal, deal.pindahTahap);
r.post('/deal/:id(\\d+)/hapus', aksesDeal, deal.hapus);

module.exports = r;
