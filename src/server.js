// Titik masuk server web
const env = require('./config/env');
const { buatApp } = require('./app');

buatApp().listen(env.port, () => {
  console.log(`CRM berjalan di http://localhost:${env.port}`);
});
