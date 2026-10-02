// Alat bantu tes: reset database tes, buat pengguna, dan klien HTTP yang menyimpan cookie
process.env.NODE_ENV = 'test';
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const { migrasi } = require('../scripts/migrate');
const { buatApp } = require('../src/app');

const PASSWORD = 'rahasia123';
let hashPassword;

/** Migrasi lalu kosongkan semua tabel data (kecuali pengaturan & skema_migrasi). */
async function resetDb() {
  await migrasi({ diam: true });
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
     AND tablename NOT IN ('skema_migrasi', 'pengaturan', 'tahap_pipeline', 'sumber_lead')`);
  if (rows.length) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

async function buatPengguna({ nama, peran = 'sales', timId = null, email }) {
  hashPassword = hashPassword || (await bcrypt.hash(PASSWORD, 4));
  const { rows } = await pool.query(
    `INSERT INTO pengguna (nama, email, password_hash, peran, tim_id) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nama, email, peran, tim_id`,
    [nama, email || `${nama.toLowerCase().replace(/\s/g, '')}@tes.local`, hashPassword, peran, timId]);
  return rows[0];
}

async function buatTim(nama) {
  return (await pool.query('INSERT INTO tim (nama) VALUES ($1) RETURNING id', [nama])).rows[0].id;
}

function jalankanServer() {
  return new Promise((ok) => {
    const server = buatApp().listen(0, () => ok(server));
  });
}

/** Klien HTTP sederhana: menyimpan cookie dan otomatis mengirim token CSRF. */
function klien(dasar) {
  const cookie = new Map();
  let csrf = null;

  async function minta(jalur, opsi = {}) {
    const header = { ...(opsi.headers || {}) };
    if (cookie.size) header.cookie = [...cookie].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf) header['x-csrf-token'] = csrf;
    let body = opsi.body;
    if (body && !(body instanceof URLSearchParams) && !(body instanceof FormData) && typeof body === 'object') {
      body = new URLSearchParams(body);
    }
    const res = await fetch(dasar + jalur, { ...opsi, headers: header, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pasangan] = c.split(';');
      const i = pasangan.indexOf('=');
      cookie.set(pasangan.slice(0, i), pasangan.slice(i + 1));
    }
    const teks = await res.text();
    const m = teks.match(/name="_csrf" value="([^"]+)"/) || teks.match(/"X-CSRF-Token": "([^"]+)"/);
    if (m) csrf = m[1];
    return { status: res.status, lokasi: res.headers.get('location'), teks, header: res.headers };
  }

  return {
    get: (j, headers) => minta(j, { headers }),
    post: (j, body) => minta(j, { method: 'POST', body }),
    async masuk(email) {
      await minta('/login');
      const r = await minta('/login', { method: 'POST', body: { email, password: PASSWORD } });
      if (r.status !== 302) throw new Error(`Login gagal untuk ${email}: ${r.status}`);
      await minta('/');
      return r;
    },
  };
}

module.exports = { pool, resetDb, buatPengguna, buatTim, jalankanServer, klien, PASSWORD };
