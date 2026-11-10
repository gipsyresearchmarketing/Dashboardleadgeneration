-- =====================================================
-- Analisa email blast: open rate, click rate, reply
-- Jalankan di Supabase SQL Editor (https://supabase.com/dashboard)
--
-- PENTING:
--  - Tabel `email_events` SUDAH ADA (dipakai view `campaign_report`).
--    JANGAN di-drop — cukup tambah kolom yg kurang.
--  - `email_track` = tabel baru (mapping token -> penerima).
-- =====================================================

-- 1) Tambah kolom yg dibutuhkan ke email_events (view campaign_report tetap utuh)
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS brand_id        text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS blast_id        text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS token           text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS recipient_email text;

-- 2) Tabel mapping token -> penerima (baru, tanpa dependensi apa pun)
CREATE TABLE IF NOT EXISTS email_track (
  token            text PRIMARY KEY,
  brand_id         text,
  blast_id         text,
  lead_id          text,
  recipient_email  text NOT NULL DEFAULT '',
  subject          text,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  bounced          boolean NOT NULL DEFAULT false,
  error            text,
  links            jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS email_track_blast_idx ON email_track (blast_id);
CREATE INDEX IF NOT EXISTS email_track_brand_idx ON email_track (brand_id);
CREATE INDEX IF NOT EXISTS email_track_email_idx ON email_track (recipient_email);

-- 3) RLS: email_track hanya boleh diakses server (service role)
ALTER TABLE email_track ENABLE ROW LEVEL SECURITY;

-- 4) Verifikasi
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('email_track','email_events')
ORDER BY table_name, ordinal_position;
