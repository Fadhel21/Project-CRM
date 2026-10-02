-- 005: penawaran (quotation), item, dan tabel penghitung nomor urut

-- Penghitung nomor urut. Baris dikunci dengan SELECT ... FOR UPDATE saat mengambil nomor baru.
CREATE TABLE penghitung (
  id          BIGSERIAL PRIMARY KEY,
  kunci       TEXT NOT NULL UNIQUE,
  nilai       BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TRIGGER penghitung_updated BEFORE UPDATE ON penghitung FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE penawaran (
  id                 BIGSERIAL PRIMARY KEY,
  -- Nomor dasar QUO/2026/10/0001; revisi ke-n menjadi QUO/2026/10/0001-Rn
  nomor_dasar        TEXT NOT NULL,
  revisi             INT NOT NULL DEFAULT 0 CHECK (revisi >= 0),
  nomor              TEXT NOT NULL UNIQUE,
  penawaran_asal_id  BIGINT REFERENCES penawaran(id),
  deal_id            BIGINT NOT NULL REFERENCES deal(id),
  kontak_id          BIGINT REFERENCES kontak(id),
  perusahaan_id      BIGINT REFERENCES perusahaan(id),
  pemilik_id         BIGINT NOT NULL REFERENCES pengguna(id),
  judul              TEXT NOT NULL,
  tanggal            DATE NOT NULL,
  berlaku_sampai     DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draf'
                     CHECK (status IN ('draf', 'terkirim', 'diterima', 'ditolak', 'direvisi')),
  catatan            TEXT,
  syarat             TEXT,
  -- Tarif & diskon disalin dari pengaturan saat dibuat, agar dokumen lama tidak berubah
  diskon_persen      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (diskon_persen BETWEEN 0 AND 100),
  pajak_persen       NUMERIC(5,2) NOT NULL CHECK (pajak_persen BETWEEN 0 AND 100),
  -- Hasil hitung dari baris item (tidak diketik manual)
  subtotal           NUMERIC(15,2) NOT NULL DEFAULT 0,
  diskon_nilai       NUMERIC(15,2) NOT NULL DEFAULT 0,
  dpp                NUMERIC(15,2) NOT NULL DEFAULT 0,
  pajak_nilai        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total              NUMERIC(15,2) NOT NULL DEFAULT 0,
  dikirim_at         TIMESTAMPTZ,
  dikirim_ke         TEXT,
  diputuskan_at      TIMESTAMPTZ,
  alasan_ditolak     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  UNIQUE (nomor_dasar, revisi),
  CHECK (berlaku_sampai >= tanggal)
);
CREATE INDEX penawaran_deal_idx ON penawaran (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX penawaran_pemilik_idx ON penawaran (pemilik_id) WHERE deleted_at IS NULL;
CREATE TRIGGER penawaran_updated BEFORE UPDATE ON penawaran FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE penawaran_item (
  id             BIGSERIAL PRIMARY KEY,
  penawaran_id   BIGINT NOT NULL REFERENCES penawaran(id),
  urutan         INT NOT NULL,
  nama           TEXT NOT NULL,
  deskripsi      TEXT,
  qty            NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  satuan         TEXT,
  harga          NUMERIC(15,2) NOT NULL CHECK (harga >= 0),
  diskon_persen  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (diskon_persen BETWEEN 0 AND 100),
  subtotal       NUMERIC(15,2) NOT NULL,
  diskon_nilai   NUMERIC(15,2) NOT NULL,
  total          NUMERIC(15,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX penawaran_item_induk_idx ON penawaran_item (penawaran_id, urutan);
CREATE TRIGGER penawaran_item_updated BEFORE UPDATE ON penawaran_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('penawaran_berlaku_hari', '30', 'Masa berlaku default penawaran (hari)'),
  ('penawaran_syarat', 'Harga belum termasuk ongkos kirim. Pembayaran 30 hari setelah faktur.', 'Syarat & ketentuan default di penawaran');
