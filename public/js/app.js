// Skrip klien kecil: konfirmasi formulir, notifikasi otomatis hilang, seret-lepas kanban
(function () {
  function tokenCsrf() {
    try {
      return JSON.parse(document.body.getAttribute('hx-headers') || '{}')['X-CSRF-Token'] || '';
    } catch (e) {
      return '';
    }
  }

  // ---- Komponen Alpine: baris item penawaran (tambah/hapus baris) ----
  // Total TIDAK dihitung di sini; setiap perubahan memicu pratinjau HTMX yang dihitung di SQL.
  document.addEventListener('alpine:init', function () {
    window.Alpine.data('formPenawaran', function (awal) {
      var kosong = function () { return { nama: '', deskripsi: '', qty: '1', satuan: '', harga: '', diskon: '0' }; };
      var n = 0;
      var beriKunci = function (b) { b.kunci = n; n += 1; return b; };
      return {
        baris: (awal && awal.length ? awal : [kosong()]).map(beriKunci),
        tambah: function () {
          this.baris.push(beriKunci(kosong()));
          var self = this;
          this.$nextTick(function () { self.$dispatch('ubah-baris'); });
        },
        hapus: function (i) {
          if (this.baris.length <= 1) return;
          this.baris.splice(i, 1);
          var self = this;
          this.$nextTick(function () { self.$dispatch('ubah-baris'); });
        },
      };
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    // Formulir dengan atribut data-konfirmasi meminta konfirmasi sebelum dikirim
    document.addEventListener('submit', function (e) {
      var pesan = e.target.getAttribute && e.target.getAttribute('data-konfirmasi');
      if (pesan && !window.confirm(pesan)) e.preventDefault();
    }, true);

    // Pesan dari HTMX di area notifikasi hilang sendiri setelah 5 detik
    document.body.addEventListener('htmx:afterSwap', function (e) {
      if (e.detail.target.id === 'notifikasi') {
        setTimeout(function () { e.detail.target.innerHTML = ''; }, 5000);
      }
    });

    // ---- Kanban: drag and drop bawaan HTML5, perpindahan dikirim lewat HTMX ----
    // Event didelegasikan ke document agar tetap berlaku setelah papan diganti HTMX.
    var dealDiseret = null;

    document.addEventListener('dragstart', function (e) {
      var kartu = e.target.closest && e.target.closest('.kartu-deal');
      if (!kartu) return;
      dealDiseret = { id: kartu.dataset.dealId, asal: kartu.closest('.kolom-kanban').dataset.tahapId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', kartu.dataset.dealId);
      kartu.classList.add('diseret');
    });

    document.addEventListener('dragend', function (e) {
      var kartu = e.target.closest && e.target.closest('.kartu-deal');
      if (kartu) kartu.classList.remove('diseret');
      document.querySelectorAll('.kolom-kanban.sasaran').forEach(function (k) { k.classList.remove('sasaran'); });
    });

    document.addEventListener('dragover', function (e) {
      var kolom = e.target.closest && e.target.closest('.kolom-kanban');
      if (!kolom || !dealDiseret) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      kolom.classList.add('sasaran');
    });

    document.addEventListener('dragleave', function (e) {
      var kolom = e.target.closest && e.target.closest('.kolom-kanban');
      if (kolom && !kolom.contains(e.relatedTarget)) kolom.classList.remove('sasaran');
    });

    document.addEventListener('drop', function (e) {
      var kolom = e.target.closest && e.target.closest('.kolom-kanban');
      if (!kolom || !dealDiseret) return;
      e.preventDefault();
      kolom.classList.remove('sasaran');
      var deal = dealDiseret;
      dealDiseret = null;
      if (deal.asal === kolom.dataset.tahapId) return;

      var alasan = '';
      if (kolom.dataset.jenis === 'kalah') {
        alasan = window.prompt('Alasan deal kalah (wajib):', '');
        if (alasan === null || !alasan.trim()) return;
      }
      var pemilik = new URLSearchParams(window.location.search).get('pemilik') || '';
      window.htmx.ajax('POST', '/deal/' + deal.id + '/tahap', {
        target: '#kanban',
        swap: 'innerHTML',
        values: { tahap_id: kolom.dataset.tahapId, alasan_kalah: alasan, pemilik: pemilik },
        headers: { 'X-CSRF-Token': tokenCsrf() },
      });
    });
  });
})();
