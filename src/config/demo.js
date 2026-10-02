// Daftar akun demo. Hanya ditampilkan di halaman login bila DEMO_LOGIN=1 dan bukan produksi.
const env = require('./env');

const PASSWORD_DEMO = 'demo12345';
const AKUN_DEMO = [
  { email: 'admin@demo.local', nama: 'Admin Demo', label: 'Admin', peran: 'admin', ket: 'Melihat & mengatur semua data' },
  { email: 'manajer@demo.local', nama: 'Manajer Demo', label: 'Manajer', peran: 'manajer', ket: 'Melihat data seluruh Tim Demo' },
  { email: 'sales1@demo.local', nama: 'Sales Demo 1', label: 'Sales 1', peran: 'sales', ket: 'Hanya data miliknya sendiri' },
  { email: 'sales2@demo.local', nama: 'Sales Demo 2', label: 'Sales 2', peran: 'sales', ket: 'Hanya data miliknya sendiri' },
];

function akunDemoTampil() {
  return env.demoLogin ? AKUN_DEMO.map((a) => ({ ...a, password: PASSWORD_DEMO })) : [];
}

module.exports = { AKUN_DEMO, PASSWORD_DEMO, akunDemoTampil };
