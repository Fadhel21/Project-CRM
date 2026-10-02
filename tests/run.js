// Menjalankan semua tes (*.test.js) memakai node:test bawaan, terhadap database DATABASE_URL_TEST
const path = require('path');
const fs = require('fs');
const { run } = require('node:test');
const { spec } = require('node:test/reporters');

process.env.NODE_ENV = 'test';
const berkas = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).map((f) => path.join(__dirname, f));

run({ files: berkas, concurrency: 1, timeout: 30000, env: { ...process.env, NODE_ENV: 'test' } })
  .on('test:fail', () => { process.exitCode = 1; })
  .compose(spec)
  .pipe(process.stdout);
