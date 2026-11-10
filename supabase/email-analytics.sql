-- =====================================================
-- Analisa email blast: open rate, click rate, reply
-- Jalankan di Supabase SQL Editor (https://supabase.com/dashboard)
--
-- PENTING:
--  - Tabel `email_events` SUDAH ADA (dipakai view `campaign_report`).
--    JANGAN di-drop — cukup tambah kolom yg kurang.
--  - `email_track` = tabel baru (mapping token -> penerima).
--
-- Jalankan per-bagian (satu blok = satu Run), jangan digabung.
-- =====================================================


-- =====================================================
-- BAGIAN 1 — Tambah kolom ke email_events
-- (aman diulang; view campaign_report tetap utuh)
-- =====================================================
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS brand_id text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS blast_id text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS recipient_email text;


-- =====================================================
-- BAGIAN 2 — Bikin tabel email_track
-- (JALANKAN SENDIRI, bukan digabung sama BAGIAN 1)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_track (
  "token"           text PRIMARY KEY,
  brand_id          text,
  blast_id          text,
  lead_id           text,
  recipient_email   text NOT NULL DEFAULT '',
  subject           text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz,
  bounced           boolean NOT NULL DEFAULT false,
  error             text,
  links             jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS email_track_blast_idx ON email_track (blast_id);
CREATE INDEX IF NOT EXISTS email_track_brand_idx ON email_track (brand_id);
CREATE INDEX IF NOT EXISTS email_track_email_idx ON email_track (recipient_email);

ALTER TABLE email_track ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- BAGIAN 2b — Kolom 'role' (to / cc / bcc)
-- =====================================================
ALTER TABLE email_track ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'to';


-- =====================================================
-- BAGIAN 3 — Verifikasi (jalankan sendiri)
-- =====================================================
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('email_track', 'email_events')
ORDER BY table_name, ordinal_position;


-- =====================================================
-- BAGIAN 4 — Kolom follow_ups di tabel leads
-- (daftar follow-up: wa / email / call — dipakai checkbox di rincian kontak)
-- =====================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_ups text[] NOT NULL DEFAULT '{}';
