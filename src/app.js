// Menyusun aplikasi Express (tanpa listen, agar bisa dipakai tes)
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const format = require('./modules/crm/services/format');
const { csrf } = require('./middleware/csrf');
const { tidakDitemukan, penanganError } = require('./middleware/error');
const routesCrm = require('./modules/crm/routes');

function buatApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Alpine.js (build standar) mengevaluasi ekspresi atribut, sehingga butuh 'unsafe-eval'
        scriptSrc: ["'self'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        upgradeInsecureRequests: env.produksi ? [] : null,
      },
    },
  }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.produksi ? '7d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(env.cookieSecret));
  app.use(csrf);

  app.use((req, res, next) => {
    res.locals.f = format;
    res.locals.jalur = req.path;
    res.locals.pengguna = null;
    next();
  });

  app.use(routesCrm);
  app.use(tidakDitemukan);
  app.use(penanganError);
  return app;
}

module.exports = { buatApp };
