-- 004: aktivitas (telepon, rapat, email, tugas, catatan) yang terhubung ke kontak/deal/lead

CREATE TABLE aktivitas (
  id                     BIGSERIAL PRIMARY KEY,
  jenis                  TEXT NOT NULL CHECK (jenis IN ('telepon', 'rapat', 'email', 'tugas', 'catatan')),
  judul                  TEXT NOT NULL,
  isi                    TEXT,
  -- Waktu kegiatan (telepon/rapat/email) atau tenggat (tugas)
  jadwal_at              TIMESTAMPTZ,
  selesai_at             TIMESTAMPTZ,
  kontak_id              BIGINT REFERENCES kontak(id),
  deal_id                BIGINT REFERENCES deal(id),
  lead_id                BIGINT REFERENCES lead(id),
  -- Penanggung jawab (untuk tugas) / pemilik aktivitas
  pemilik_id             BIGINT NOT NULL REFERENCES pengguna(id),
  dibuat_oleh            BIGINT NOT NULL REFERENCES pengguna(id),
  -- Diisi worker setelah pengingat terkirim, agar tidak terkirim dua kali
  pengingat_terkirim_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  CHECK (kontak_id IS NOT NULL OR deal_id IS NOT NULL OR lead_id IS NOT NULL)
);
CREATE INDEX aktivitas_kontak_idx ON aktivitas (kontak_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX aktivitas_deal_idx ON aktivitas (deal_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX aktivitas_lead_idx ON aktivitas (lead_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX aktivitas_tugas_idx ON aktivitas (pemilik_id, jadwal_at) WHERE deleted_at IS NULL AND selesai_at IS NULL;
-- Dipakai worker pengingat: tugas terbuka yang pengingatnya belum terkirim
CREATE INDEX aktivitas_pengingat_idx ON aktivitas (jadwal_at)
  WHERE deleted_at IS NULL AND selesai_at IS NULL AND pengingat_terkirim_at IS NULL AND jenis = 'tugas';
CREATE TRIGGER aktivitas_updated BEFORE UPDATE ON aktivitas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
