// Skrip klien kecil: konfirmasi, notifikasi otomatis hilang
document.addEventListener('DOMContentLoaded', function () {
  // Pesan sukses/galat dari HTMX hilang sendiri setelah 5 detik
  document.body.addEventListener('htmx:afterSwap', function (e) {
    if (e.detail.target.id === 'notifikasi') {
      setTimeout(function () { e.detail.target.innerHTML = ''; }, 5000);
    }
  });
});
