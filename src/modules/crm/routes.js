// Daftar route modul CRM
const express = require('express');
const { wajibLogin } = require('../../middleware/auth');
const { butuhPeran } = require('../../middleware/akses');
const pengguna = require('./controllers/pengguna');
const laporan = require('./controllers/laporan');

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

module.exports = r;
