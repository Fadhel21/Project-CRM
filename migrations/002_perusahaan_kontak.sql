-- 002: perusahaan dan kontak, masing-masing punya pemilik

CREATE TABLE perusahaan (
  id              BIGSERIAL PRIMARY KEY,
  nama            TEXT NOT NULL,
  industri        TEXT,
  email           TEXT,
  telepon         TEXT,
  telepon_normal  TEXT,
  situs           TEXT,
  alamat          TEXT,
  pemilik_id      BIGINT NOT NULL REFERENCES pengguna(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX perusahaan_pemilik_idx ON perusahaan (pemilik_id) WHERE deleted_at IS NULL;
CREATE INDEX perusahaan_nama_idx ON perusahaan (lower(nama));
CREATE TRIGGER perusahaan_updated BEFORE UPDATE ON perusahaan FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE kontak (
  id              BIGSERIAL PRIMARY KEY,
  nama            TEXT NOT NULL,
  jabatan         TEXT,
  email           TEXT,
  telepon         TEXT,
  telepon_normal  TEXT,
  perusahaan_id   BIGINT REFERENCES perusahaan(id),
  catatan         TEXT,
  pemilik_id      BIGINT NOT NULL REFERENCES pengguna(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX kontak_pemilik_idx ON kontak (pemilik_id) WHERE deleted_at IS NULL;
CREATE INDEX kontak_perusahaan_idx ON kontak (perusahaan_id);
CREATE INDEX kontak_email_idx ON kontak (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX kontak_telepon_idx ON kontak (telepon_normal) WHERE deleted_at IS NULL;
CREATE TRIGGER kontak_updated BEFORE UPDATE ON kontak FOR EACH ROW EXECUTE FUNCTION set_updated_at();
