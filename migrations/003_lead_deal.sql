-- 003: sumber lead, lead, tahap pipeline, deal, dan riwayat perpindahan tahap

CREATE TABLE sumber_lead (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  urutan      INT NOT NULL DEFAULT 0,
  aktif       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TRIGGER sumber_lead_updated BEFORE UPDATE ON sumber_lead FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO sumber_lead (nama, urutan) VALUES
  ('Website', 1), ('Referensi', 2), ('Pameran', 3), ('Telepon masuk', 4), ('Media sosial', 5), ('Lainnya', 99);

-- Tahap pipeline disimpan sebagai data pengaturan, bukan ditulis mati di kode
CREATE TABLE tahap_pipeline (
  id              BIGSERIAL PRIMARY KEY,
  nama            TEXT NOT NULL,
  urutan          INT NOT NULL,
  jenis           TEXT NOT NULL DEFAULT 'terbuka' CHECK (jenis IN ('terbuka', 'menang', 'kalah')),
  peluang_persen  INT NOT NULL DEFAULT 0 CHECK (peluang_persen BETWEEN 0 AND 100),
  aktif           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE TRIGGER tahap_pipeline_updated BEFORE UPDATE ON tahap_pipeline FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO tahap_pipeline (nama, urutan, jenis, peluang_persen) VALUES
  ('Kualifikasi', 1, 'terbuka', 10),
  ('Kebutuhan', 2, 'terbuka', 30),
  ('Penawaran', 3, 'terbuka', 50),
  ('Negosiasi', 4, 'terbuka', 75),
  ('Menang', 5, 'menang', 100),
  ('Kalah', 6, 'kalah', 0);

CREATE TABLE lead (
  id               BIGSERIAL PRIMARY KEY,
  nama             TEXT NOT NULL,
  nama_perusahaan  TEXT,
  jabatan          TEXT,
  email            TEXT,
  telepon          TEXT,
  telepon_normal   TEXT,
  sumber_id        BIGINT REFERENCES sumber_lead(id),
  status           TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'dihubungi', 'kualifikasi', 'tidak_layak')),
  catatan          TEXT,
  pemilik_id       BIGINT NOT NULL REFERENCES pengguna(id),
  -- Hasil konversi: lead tidak dihapus, hanya ditandai dan ditautkan
  konversi_at      TIMESTAMPTZ,
  konversi_oleh    BIGINT REFERENCES pengguna(id),
  kontak_id        BIGINT REFERENCES kontak(id),
  perusahaan_id    BIGINT REFERENCES perusahaan(id),
  deal_id          BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX lead_pemilik_idx ON lead (pemilik_id) WHERE deleted_at IS NULL;
CREATE INDEX lead_email_idx ON lead (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX lead_telepon_idx ON lead (telepon_normal) WHERE deleted_at IS NULL;
CREATE TRIGGER lead_updated BEFORE UPDATE ON lead FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE deal (
  id                    BIGSERIAL PRIMARY KEY,
  judul                 TEXT NOT NULL,
  nilai                 NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (nilai >= 0),
  tahap_id              BIGINT NOT NULL REFERENCES tahap_pipeline(id),
  kontak_id             BIGINT REFERENCES kontak(id),
  perusahaan_id         BIGINT REFERENCES perusahaan(id),
  lead_id               BIGINT REFERENCES lead(id),
  pemilik_id            BIGINT NOT NULL REFERENCES pengguna(id),
  target_tutup          DATE,
  ditutup_at            TIMESTAMPTZ,
  alasan_kalah          TEXT,
  catatan               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX deal_pemilik_idx ON deal (pemilik_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_tahap_idx ON deal (tahap_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_kontak_idx ON deal (kontak_id);
CREATE INDEX deal_perusahaan_idx ON deal (perusahaan_id);
CREATE TRIGGER deal_updated BEFORE UPDATE ON deal FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lead ADD CONSTRAINT lead_deal_fk FOREIGN KEY (deal_id) REFERENCES deal(id);

-- Setiap perpindahan tahap deal: siapa, kapan, dari tahap apa ke tahap apa
CREATE TABLE riwayat_tahap (
  id             BIGSERIAL PRIMARY KEY,
  deal_id        BIGINT NOT NULL REFERENCES deal(id),
  dari_tahap_id  BIGINT REFERENCES tahap_pipeline(id),
  ke_tahap_id    BIGINT NOT NULL REFERENCES tahap_pipeline(id),
  pengguna_id    BIGINT REFERENCES pengguna(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX riwayat_tahap_deal_idx ON riwayat_tahap (deal_id, created_at);
