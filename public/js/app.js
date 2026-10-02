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
  // ---- Komponen Alpine: grup sub menu sidebar (status buka/tutup diingat per browser) ----
  document.addEventListener('alpine:init', function () {
    window.Alpine.data('grupMenu', function (id, berisiAktif) {
      var kunci = 'crm-menu-' + id;
      var tersimpan = null;
      try { tersimpan = window.localStorage.getItem(kunci); } catch (e) { tersimpan = null; }
      return {
        // Grup yang berisi halaman aktif selalu terbuka; lainnya mengikuti pilihan terakhir pengguna
        buka: berisiAktif || tersimpan === '1',
        ubah: function () {
          this.buka = !this.buka;
          try { window.localStorage.setItem(kunci, this.buka ? '1' : '0'); } catch (e) { /* abaikan */ }
        },
      };
    });
  });

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

  // ---- Grafik dashboard (Chart.js). Data sudah diagregasi di server; di sini hanya digambar. ----
  var WARNA = { menang: '#0369a1', kalah: '#eb6834', teks: '#475569', grid: '#e2e8f0' };
  var formatRupiah = function (v) {
    return 'Rp ' + Number(v).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  };
  var formatRingkas = function (v) {
    var n = Number(v);
    if (n >= 1e12) return (n / 1e12).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' T';
    if (n >= 1e9) return (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    return n.toLocaleString('id-ID');
  };

  function gambarGrafik(akar) {
    if (!window.Chart) return;
    var kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    window.Chart.defaults.color = WARNA.teks;
    (akar || document).querySelectorAll('canvas[data-grafik]').forEach(function (kanvas) {
      if (window.Chart.getChart(kanvas)) return;
      var d = JSON.parse(kanvas.dataset.grafik);
      var umum = {
        responsive: true, maintainAspectRatio: false, animation: kurangiGerak ? false : { duration: 400 },
        interaction: { mode: 'index', intersect: false },
      };
      if (d.jenis === 'tahap') {
        new window.Chart(kanvas, {
          type: 'bar',
          data: { labels: d.label, datasets: [{ label: 'Nilai pipeline', data: d.nilai, backgroundColor: WARNA.menang,
            borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
          options: Object.assign({}, umum, {
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function (c) { return formatRupiah(c.raw) + ' · ' + d.jumlah[c.dataIndex] + ' deal'; } } },
            },
            scales: {
              x: { beginAtZero: true, grid: { color: WARNA.grid }, border: { display: false }, ticks: { callback: formatRingkas } },
              y: { grid: { display: false }, border: { display: false } },
            },
          }),
        });
      } else if (d.jenis === 'tren') {
        new window.Chart(kanvas, {
          type: 'bar',
          data: { labels: d.label, datasets: [
            { label: 'Menang', data: d.menang, backgroundColor: WARNA.menang, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
            { label: 'Kalah', data: d.kalah, backgroundColor: WARNA.kalah, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
          ] },
          options: Object.assign({}, umum, {
            datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
            plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } } },
            scales: {
              y: { beginAtZero: true, grid: { color: WARNA.grid }, border: { display: false }, ticks: { precision: 0 } },
              x: { grid: { display: false }, border: { display: false } },
            },
          }),
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    gambarGrafik(document);
    document.body.addEventListener('htmx:beforeSwap', function (e) {
      // Bersihkan instance grafik lama sebelum isinya diganti
      if (!window.Chart) return;
      e.detail.target.querySelectorAll('canvas[data-grafik]').forEach(function (k) {
        var c = window.Chart.getChart(k);
        if (c) c.destroy();
      });
    });
    document.body.addEventListener('htmx:afterSwap', function (e) { gambarGrafik(e.detail.target); });

    // Saat HTMX mengganti URL (mis. filter tugas), sorotan sub menu sidebar ikut diperbarui
    document.body.addEventListener('htmx:pushedIntoHistory', function () {
      var kini = new URL(window.location.href);
      var item = document.querySelectorAll('.item-sub');
      var cocok = null;
      item.forEach(function (a) {
        var u = new URL(a.getAttribute('href'), window.location.origin);
        if (u.pathname !== kini.pathname) return;
        var sama = true;
        u.searchParams.forEach(function (v, k) { if (kini.searchParams.get(k) !== v) sama = false; });
        // Tautan tanpa query hanya cocok bila filter halaman kosong / bawaan
        if (!u.search && kini.searchParams.get('filter') && kini.searchParams.get('filter') !== 'terbuka') sama = false;
        if (sama && (!cocok || u.search.length > new URL(cocok.href).search.length)) cocok = a;
      });
      if (!cocok) return;
      item.forEach(function (a) { a.classList.remove('aktif'); a.removeAttribute('aria-current'); });
      cocok.classList.add('aktif');
      cocok.setAttribute('aria-current', 'page');
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
