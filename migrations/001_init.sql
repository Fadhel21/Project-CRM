-- 001: tim, pengguna, pengaturan, jejak audit

-- Mengisi updated_at otomatis setiap baris diubah
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE tim (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TRIGGER tim_updated BEFORE UPDATE ON tim FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pengguna (
  id             BIGSERIAL PRIMARY KEY,
  nama           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  peran          TEXT NOT NULL CHECK (peran IN ('admin', 'manajer', 'sales')),
  tim_id         BIGINT REFERENCES tim(id),
  aktif          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX pengguna_email_unik ON pengguna (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX pengguna_tim_idx ON pengguna (tim_id);
CREATE TRIGGER pengguna_updated BEFORE UPDATE ON pengguna FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pengaturan kunci-nilai (tarif pajak, batas diskon, dll)
CREATE TABLE pengaturan (
  id          BIGSERIAL PRIMARY KEY,
  kunci       TEXT NOT NULL UNIQUE,
  nilai       TEXT NOT NULL,
  keterangan  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TRIGGER pengaturan_updated BEFORE UPDATE ON pengaturan FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('pajak_persen', '11', 'Tarif PPN penawaran (%)'),
  ('diskon_maks_persen', '20', 'Batas diskon per item dan per dokumen (%)'),
  ('nama_perusahaan', 'Perusahaan Saya', 'Nama di kop penawaran'),
  ('pengingat_menit_sebelum', '60', 'Pengingat dikirim sekian menit sebelum jatuh tempo');

-- Jejak audit: siapa, kapan, apa. Hanya nama kolom yang berubah, bukan isi data pribadi.
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  pengguna_id  BIGINT REFERENCES pengguna(id),
  entitas      TEXT NOT NULL,
  entitas_id   BIGINT NOT NULL,
  aksi         TEXT NOT NULL,
  kolom        TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX audit_entitas_idx ON audit_log (entitas, entitas_id);
