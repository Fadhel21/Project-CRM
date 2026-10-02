// Titik masuk server web
const env = require('./config/env');
const { buatApp } = require('./app');

// Jaring pengaman: error async yang lolos tetap tercatat, server tidak diam-diam menggantung
process.on('unhandledRejection', (err) => {
  console.error('[error] Promise tidak tertangani:', err);
});

buatApp().listen(env.port, () => {
  console.log(`CRM berjalan di http://localhost:${env.port}`);
});
