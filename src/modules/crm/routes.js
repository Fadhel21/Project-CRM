// Daftar route modul CRM
const express = require('express');
const { wajibLogin } = require('../../middleware/auth');
const pengguna = require('./controllers/pengguna');
const laporan = require('./controllers/laporan');

const r = express.Router();

// Publik
r.get('/login', pengguna.formLogin);
r.post('/login', pengguna.login);
r.post('/logout', pengguna.logout);

// Semua route di bawah ini wajib login
r.use(wajibLogin);
r.get('/', laporan.beranda);

module.exports = r;
