// Controller dashboard dan laporan
function beranda(req, res) {
  res.render('crm/beranda', { judul: 'Beranda' });
}

module.exports = { beranda };
