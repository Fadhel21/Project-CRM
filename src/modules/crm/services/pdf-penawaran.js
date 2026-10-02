// Membuat PDF penawaran di memori (tidak disimpan ke disk) memakai font standar bawaan pdfmake.
const pdfmake = require('pdfmake');
const { rupiah, tanggal } = require('./format');

const FONT_STANDAR = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);
pdfmake.setFonts({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});
// Tidak boleh membaca file atau URL apa pun selain font standar
pdfmake.setLocalAccessPolicy((jalur) => FONT_STANDAR.has(jalur));
pdfmake.setUrlAccessPolicy(() => false);

/** Angka tanpa "Rp" untuk kolom tabel: "1500000.00" -> "1.500.000,00" */
function angka(nilai) {
  return rupiah(nilai).replace('Rp ', '');
}

function persen(v) {
  return `${String(v).replace(/\.00$/, '').replace('.', ',')}%`;
}

/**
 * @param p   penawaran (dengan nama kontak/perusahaan/pemilik)
 * @param item baris item
 * @param namaPerusahaan nama perusahaan penjual (dari pengaturan)
 * @returns Promise<Buffer>
 */
function buat(p, item, namaPerusahaan) {
  const adaDiskonBaris = item.some((i) => Number(i.diskon_persen) > 0);
  const kepala = ['No', 'Item', 'Qty', 'Harga', ...(adaDiskonBaris ? ['Disk.'] : []), 'Jumlah']
    .map((t, i) => ({ text: t, style: 'kepalaTabel', alignment: i >= 2 ? 'right' : 'left' }));
  const baris = item.map((i, n) => [
    String(n + 1),
    { stack: [{ text: i.nama, bold: true }, ...(i.deskripsi ? [{ text: i.deskripsi, color: '#475569', fontSize: 8 }] : [])] },
    { text: `${String(i.qty).replace(/\.00$/, '').replace('.', ',')} ${i.satuan || ''}`.trim(), alignment: 'right' },
    { text: angka(i.harga), alignment: 'right' },
    ...(adaDiskonBaris ? [{ text: Number(i.diskon_persen) > 0 ? persen(i.diskon_persen) : '-', alignment: 'right' }] : []),
    { text: angka(i.total), alignment: 'right' },
  ]);
  const ringkas = [
    ['Subtotal', angka(p.subtotal)],
    ...(Number(p.diskon_persen) > 0 ? [[`Diskon ${persen(p.diskon_persen)}`, `-${angka(p.diskon_nilai)}`]] : []),
    ['Dasar pengenaan pajak', angka(p.dpp)],
    [`PPN ${persen(p.pajak_persen)}`, angka(p.pajak_nilai)],
  ];

  const dokumen = {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 60],
    info: { title: `Penawaran ${p.nomor}`, author: namaPerusahaan },
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: '#0f172a', lineHeight: 1.2 },
    styles: {
      judul: { fontSize: 20, bold: true, color: '#0369a1' },
      kepalaTabel: { bold: true, color: '#ffffff', fillColor: '#0f172a', fontSize: 9 },
      label: { color: '#475569', fontSize: 8.5 },
    },
    footer: (hal, total) => ({
      columns: [
        { text: `${p.nomor}`, style: 'label' },
        { text: `Halaman ${hal} dari ${total}`, style: 'label', alignment: 'right' },
      ],
      margin: [40, 20, 40, 0],
    }),
    content: [
      {
        columns: [
          { stack: [{ text: namaPerusahaan, bold: true, fontSize: 13 }, { text: `Disiapkan oleh: ${p.pemilik}`, style: 'label' }] },
          { stack: [{ text: 'PENAWARAN HARGA', style: 'judul', alignment: 'right' }, { text: p.nomor, alignment: 'right', bold: true }] },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 10, x2: 515, y2: 10, lineWidth: 1, lineColor: '#e2e8f0' }], margin: [0, 0, 0, 12] },
      {
        columns: [
          { stack: [
            { text: 'Kepada', style: 'label' },
            { text: p.perusahaan || p.kontak || '-', bold: true },
            ...(p.perusahaan && p.kontak ? [{ text: `u.p. ${p.kontak}` }] : []),
          ] },
          { width: 200, table: { widths: ['auto', '*'], body: [
            [{ text: 'Tanggal', style: 'label' }, tanggal(p.tanggal)],
            [{ text: 'Berlaku sampai', style: 'label' }, tanggal(p.berlaku_sampai)],
            [{ text: 'Perihal', style: 'label' }, p.judul],
          ] }, layout: 'noBorders' },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: [18, '*', 50, 75, ...(adaDiskonBaris ? [35] : []), 85],
          body: [kepala, ...baris],
        },
        layout: {
          hLineColor: () => '#e2e8f0', vLineWidth: () => 0,
          paddingTop: () => 5, paddingBottom: () => 5,
          fillColor: (r) => (r > 0 && r % 2 === 0 ? '#f8fafc' : null),
        },
      },
      {
        columns: [
          { width: '*', text: '' },
          { width: 230, margin: [0, 10, 0, 0], table: { widths: ['*', 'auto'], body: [
            ...ringkas.map(([a, b]) => [a, { text: b, alignment: 'right' }]),
            [{ text: 'TOTAL', bold: true, fontSize: 11 }, { text: rupiah(p.total), bold: true, fontSize: 11, alignment: 'right', color: '#0369a1' }],
          ] }, layout: { hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 1 : 0), vLineWidth: () => 0, hLineColor: () => '#0f172a' } },
        ],
      },
      ...(p.catatan ? [{ text: 'Catatan', style: 'label', margin: [0, 18, 0, 2] }, { text: p.catatan }] : []),
      ...(p.syarat ? [{ text: 'Syarat & ketentuan', style: 'label', margin: [0, 12, 0, 2] }, { text: p.syarat }] : []),
    ],
  };
  return pdfmake.createPdf(dokumen).getBuffer();
}

module.exports = { buat };
