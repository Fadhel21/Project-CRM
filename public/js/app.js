// Skrip klien kecil: konfirmasi formulir, notifikasi otomatis hilang
document.addEventListener('DOMContentLoaded', function () {
  // Formulir dengan atribut data-konfirmasi meminta konfirmasi sebelum dikirim
  document.addEventListener('submit', function (e) {
    var pesan = e.target.getAttribute && e.target.getAttribute('data-konfirmasi');
    if (pesan && !window.confirm(pesan)) e.preventDefault();
  }, true);

  // Pesan sukses/galat dari HTMX hilang sendiri setelah 5 detik
  document.body.addEventListener('htmx:afterSwap', function (e) {
    if (e.detail.target.id === 'notifikasi') {
      setTimeout(function () { e.detail.target.innerHTML = ''; }, 5000);
    }
  });
});
