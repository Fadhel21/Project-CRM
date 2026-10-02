// Service dashboard & laporan. Semua agregat (jumlah, nilai, persentase) dihitung di SQL.
// Hak akses: setiap query memakai filterPemilik, jadi angka yang tampil hanya dari data yang boleh dilihat.
const dayjs = require('dayjs');
const { query } = require('../../../config/db');
const { filterPemilik } = require('./akses');
const { idAtauNull } = require('./validasi');

const PERIODE = {
  bulan_ini: 'Bulan ini',
  bulan_lalu: 'Bulan lalu',
  kuartal_ini: 'Kuartal ini',
  tahun_ini: 'Tahun ini',
  '90_hari': '90 hari terakhir',
  kustom: 'Rentang tanggal',
};
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Rentang tanggal periode (inklusif), dihitung di zona waktu aplikasi. */
function rentang(periode, dariInput, sampaiInput) {
  const kini = dayjs();
  const kunci = PERIODE[periode] ? periode : 'bulan_ini';
  let dari;
  let sampai;
  if (kunci === 'bulan_lalu') {
    dari = kini.subtract(1, 'month').startOf('month');
    sampai = dari.endOf('month');
  } else if (kunci === 'kuartal_ini') {
    const bulanAwal = Math.floor(kini.month() / 3) * 3;
    dari = kini.month(bulanAwal).startOf('month');
    sampai = dari.add(2, 'month').endOf('month');
  } else if (kunci === 'tahun_ini') {
    dari = kini.startOf('year');
    sampai = kini.endOf('year');
  } else if (kunci === '90_hari') {
    dari = kini.subtract(89, 'day');
    sampai = kini;
  } else if (kunci === 'kustom' && POLA_TANGGAL.test(dariInput || '') && POLA_TANGGAL.test(sampaiInput || '')) {
    dari = dayjs(dariInput);
    sampai = dayjs(sampaiInput);
    if (sampai.isBefore(dari)) [dari, sampai] = [sampai, dari];
  } else {
    dari = kini.startOf('month');
    sampai = kini.endOf('month');
  }
  return {
    periode: kunci === 'kustom' && !POLA_TANGGAL.test(dariInput || '') ? 'bulan_ini' : kunci,
    dari: dari.format('YYYY-MM-DD'),
    sampai: sampai.format('YYYY-MM-DD'),
  };
}

/** Potongan WHERE lingkup data deal/lead/penawaran: hak akses + filter pemilik opsional. */
function lingkup(pengguna, kolom, params, pemilikId) {
  let sql = filterPemilik(pengguna, kolom, params);
  if (idAtauNull(pemilikId)) {
    params.push(pemilikId);
    sql += ` AND ${kolom} = $${params.length}`;
  }
  return sql;
}

// Rentang waktu: [dari 00:00, sampai+1 00:00) di zona waktu sesi DB (WIB)
const DALAM = (kolom, a, b) => `${kolom} >= $${a}::date AND ${kolom} < $${b}::date + 1`;

async function ringkasan(pengguna, { dari, sampai, pemilikId }) {
  const p1 = [dari, sampai];
  const deal = (await query(
    `SELECT
       COALESCE(sum(d.nilai) FILTER (WHERE t.jenis = 'terbuka'), 0) AS pipeline_nilai,
       count(*) FILTER (WHERE t.jenis = 'terbuka') AS pipeline_jumlah,
       COALESCE(round(sum(d.nilai * t.peluang_persen / 100.0) FILTER (WHERE t.jenis = 'terbuka'), 2), 0) AS pipeline_tertimbang,
       COALESCE(sum(d.nilai) FILTER (WHERE t.jenis = 'menang' AND ${DALAM('d.ditutup_at', 1, 2)}), 0) AS menang_nilai,
       count(*) FILTER (WHERE t.jenis = 'menang' AND ${DALAM('d.ditutup_at', 1, 2)}) AS menang_jumlah,
       count(*) FILTER (WHERE t.jenis = 'kalah' AND ${DALAM('d.ditutup_at', 1, 2)}) AS kalah_jumlah
     FROM deal d JOIN tahap_pipeline t ON t.id = d.tahap_id
     WHERE d.deleted_at IS NULL AND ${lingkup(pengguna, 'd.pemilik_id', p1, pemilikId)}`, p1)).rows[0];

  const p2 = [dari, sampai];
  const lead = (await query(
    `SELECT count(*) AS masuk, count(*) FILTER (WHERE l.konversi_at IS NOT NULL) AS dikonversi
     FROM lead l WHERE l.deleted_at IS NULL AND ${DALAM('l.created_at', 1, 2)}
       AND ${lingkup(pengguna, 'l.pemilik_id', p2, pemilikId)}`, p2)).rows[0];

  const p3 = [dari, sampai];
  const penawaran = (await query(
    `SELECT count(*) AS jumlah, COALESCE(sum(p.total), 0) AS nilai
     FROM penawaran p WHERE p.deleted_at IS NULL AND p.dikirim_at IS NOT NULL AND ${DALAM('p.dikirim_at', 1, 2)}
       AND ${lingkup(pengguna, 'p.pemilik_id', p3, pemilikId)}`, p3)).rows[0];

  const { rows: [persen] } = await query(
    `SELECT round(100.0 * $1::int / NULLIF($1::int + $2::int, 0), 1) AS win_rate,
            round(100.0 * $4::int / NULLIF($3::int, 0), 1) AS konversi`,
    [deal.menang_jumlah, deal.kalah_jumlah, lead.masuk, lead.dikonversi]);

  return { deal, lead, penawaran, winRate: persen.win_rate, konversi: persen.konversi };
}

/** Nilai & jumlah deal terbuka per tahap (tahap kosong tetap tampil). */
async function perTahap(pengguna, { pemilikId }) {
  const params = [];
  const syarat = lingkup(pengguna, 'd.pemilik_id', params, pemilikId);
  const { rows } = await query(
    `SELECT t.id, t.nama, t.peluang_persen, count(d.id) AS jumlah, COALESCE(sum(d.nilai), 0) AS nilai
     FROM tahap_pipeline t
     LEFT JOIN deal d ON d.tahap_id = t.id AND d.deleted_at IS NULL AND ${syarat}
     WHERE t.jenis = 'terbuka' AND t.aktif AND t.deleted_at IS NULL
     GROUP BY t.id ORDER BY t.urutan, t.id`, params);
  return rows;
}

/** Jumlah & nilai deal menang/kalah per bulan, 6 bulan sampai akhir periode. */
async function tren(pengguna, { sampai, pemilikId }) {
  const params = [sampai];
  const syarat = lingkup(pengguna, 'd.pemilik_id', params, pemilikId);
  const { rows } = await query(
    `WITH bulan AS (
       SELECT generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') AS awal
     )
     SELECT to_char(b.awal, 'YYYY-MM') AS bulan,
       count(d.id) FILTER (WHERE t.jenis = 'menang') AS menang,
       count(d.id) FILTER (WHERE t.jenis = 'kalah') AS kalah,
       COALESCE(sum(d.nilai) FILTER (WHERE t.jenis = 'menang'), 0) AS nilai_menang
     FROM bulan b
     LEFT JOIN deal d ON d.deleted_at IS NULL AND d.ditutup_at >= b.awal AND d.ditutup_at < b.awal + interval '1 month' AND ${syarat}
     LEFT JOIN tahap_pipeline t ON t.id = d.tahap_id
     GROUP BY b.awal ORDER BY b.awal`, params);
  return rows;
}

/** Kinerja per sales dalam periode, hanya pengguna yang boleh dilihat. */
async function kinerja(pengguna, { dari, sampai, pemilikId }) {
  const params = [dari, sampai];
  const syaratPengguna = lingkup(pengguna, 'u.id', params, pemilikId);
  const { rows } = await query(
    `WITH d AS (
       SELECT d.pemilik_id,
         count(*) FILTER (WHERE t.jenis = 'menang' AND ${DALAM('d.ditutup_at', 1, 2)}) AS menang,
         COALESCE(sum(d.nilai) FILTER (WHERE t.jenis = 'menang' AND ${DALAM('d.ditutup_at', 1, 2)}), 0) AS nilai_menang,
         count(*) FILTER (WHERE t.jenis = 'kalah' AND ${DALAM('d.ditutup_at', 1, 2)}) AS kalah,
         COALESCE(sum(d.nilai) FILTER (WHERE t.jenis = 'terbuka'), 0) AS pipeline
       FROM deal d JOIN tahap_pipeline t ON t.id = d.tahap_id WHERE d.deleted_at IS NULL GROUP BY d.pemilik_id
     ), l AS (
       SELECT pemilik_id, count(*) AS lead_masuk, count(*) FILTER (WHERE konversi_at IS NOT NULL) AS lead_konversi
       FROM lead WHERE deleted_at IS NULL AND ${DALAM('created_at', 1, 2)} GROUP BY pemilik_id
     ), q AS (
       SELECT pemilik_id, count(*) AS penawaran, COALESCE(sum(total), 0) AS nilai_penawaran
       FROM penawaran WHERE deleted_at IS NULL AND dikirim_at IS NOT NULL AND ${DALAM('dikirim_at', 1, 2)} GROUP BY pemilik_id
     ), a AS (
       SELECT pemilik_id, count(*) AS aktivitas FROM aktivitas
       WHERE deleted_at IS NULL AND jenis <> 'catatan' AND ${DALAM('COALESCE(selesai_at, jadwal_at, created_at)', 1, 2)}
       GROUP BY pemilik_id
     )
     SELECT u.id, u.nama, u.peran,
       COALESCE(l.lead_masuk, 0) AS lead_masuk, COALESCE(l.lead_konversi, 0) AS lead_konversi,
       COALESCE(d.menang, 0) AS menang, COALESCE(d.nilai_menang, 0) AS nilai_menang, COALESCE(d.kalah, 0) AS kalah,
       round(100.0 * COALESCE(d.menang, 0) / NULLIF(COALESCE(d.menang, 0) + COALESCE(d.kalah, 0), 0), 1) AS win_rate,
       COALESCE(d.pipeline, 0) AS pipeline,
       COALESCE(q.penawaran, 0) AS penawaran, COALESCE(a.aktivitas, 0) AS aktivitas
     FROM pengguna u
     LEFT JOIN d ON d.pemilik_id = u.id LEFT JOIN l ON l.pemilik_id = u.id
     LEFT JOIN q ON q.pemilik_id = u.id LEFT JOIN a ON a.pemilik_id = u.id
     WHERE u.deleted_at IS NULL AND (u.aktif OR d.pemilik_id IS NOT NULL) AND ${syaratPengguna}
     ORDER BY COALESCE(d.nilai_menang, 0) DESC, u.nama`, params);
  return rows;
}

async function dasbor(pengguna, filter) {
  const r = rentang(filter.periode, filter.dari, filter.sampai);
  const opsi = { ...r, pemilikId: filter.pemilik };
  const [ring, tahap, trenBulan, perSales] = await Promise.all([
    ringkasan(pengguna, opsi), perTahap(pengguna, opsi), tren(pengguna, opsi), kinerja(pengguna, opsi),
  ]);
  return { rentang: r, ringkasan: ring, perTahap: tahap, tren: trenBulan, kinerja: perSales };
}

module.exports = { PERIODE, rentang, ringkasan, perTahap, tren, kinerja, dasbor };
