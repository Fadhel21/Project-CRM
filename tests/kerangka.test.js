// Tes kerangka: format uang, filter kepemilikan, login & CSRF (tanpa database)
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { rupiah } = require('../src/modules/crm/services/format');
const { filterPemilik } = require('../src/modules/crm/services/akses');
const { buatApp } = require('../src/app');
const { pool } = require('../src/config/db');

after(() => pool.end());

test('rupiah memformat NUMERIC tanpa float', () => {
  assert.equal(rupiah('1234567.5'), 'Rp 1.234.567,50');
  assert.equal(rupiah('0.10'), 'Rp 0,10');
  assert.equal(rupiah('-2500.00'), '-Rp 2.500,00');
  assert.equal(rupiah('9999999999999.99'), 'Rp 9.999.999.999.999,99');
});

test('filterPemilik: admin semua, manajer timnya, sales miliknya', () => {
  let p = [];
  assert.equal(filterPemilik({ id: 1, peran: 'admin' }, 'x.pemilik_id', p), 'TRUE');
  assert.deepEqual(p, []);

  p = ['awal'];
  const m = filterPemilik({ id: 2, peran: 'manajer', tim_id: 7 }, 'x.pemilik_id', p);
  assert.match(m, /tim_id = \$2/);
  assert.match(m, /x\.pemilik_id = \$3/);
  assert.deepEqual(p, ['awal', 7, 2]);

  p = [];
  assert.equal(filterPemilik({ id: 3, peran: 'sales', tim_id: 7 }, 'x.pemilik_id', p), 'x.pemilik_id = $1');
  assert.deepEqual(p, [3]);

  p = [];
  assert.equal(filterPemilik({ id: 4, peran: 'manajer', tim_id: null }, 'k', p), 'k = $1', 'manajer tanpa tim = data sendiri');
});

function jalankanServer() {
  return new Promise((ok) => {
    const s = buatApp().listen(0, () => ok(s));
  });
}

test('halaman login tampil, beranda mengarah ke login, POST tanpa CSRF ditolak', async () => {
  const server = await jalankanServer();
  const dasar = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${dasar}/login`);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /Masuk ke CRM/);

    const beranda = await fetch(`${dasar}/`, { redirect: 'manual' });
    assert.equal(beranda.status, 302);
    assert.equal(beranda.headers.get('location'), '/login');

    const tanpaCsrf = await fetch(`${dasar}/login`, {
      method: 'POST', body: new URLSearchParams({ email: 'a@b.c', password: 'x' }) });
    assert.equal(tanpaCsrf.status, 403);
  } finally {
    server.close();
  }
});
