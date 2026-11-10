-- =====================================================
-- Analisa email blast: open rate, click rate, reply
-- Jalankan di Supabase SQL Editor (https://supabase.com/dashboard)
-- Script ini AMAN diulang (idempotent).
-- =====================================================

-- 1) Tabel: 1 baris per penerima per blast
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

-- 2) Tabel: 1 baris per kejadian (open / click)
CREATE TABLE IF NOT EXISTS email_events (
  id               text PRIMARY KEY,
  brand_id         text,
  blast_id         text,
  token            text,
  recipient_email  text,
  type             text NOT NULL,
  url              text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 3) Tambah kolom yg mungkin kurang (kalau tabelnya udah ada dari percobaan sebelumnya)
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS brand_id        text;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS blast_id        text;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS lead_id         text;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS recipient_email text NOT NULL DEFAULT '';
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS subject         text;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS delivered_at    timestamptz;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS bounced         boolean NOT NULL DEFAULT false;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS error           text;
ALTER TABLE email_track  ADD COLUMN IF NOT EXISTS links           jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE email_events ADD COLUMN IF NOT EXISTS brand_id        text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS blast_id        text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS token           text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS recipient_email text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS type             text NOT NULL DEFAULT 'open';
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS url              text;
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();

-- 4) Index
CREATE INDEX IF NOT EXISTS email_track_blast_idx  ON email_track (blast_id);
CREATE INDEX IF NOT EXISTS email_track_brand_idx  ON email_track (brand_id);
CREATE INDEX IF NOT EXISTS email_track_email_idx  ON email_track (recipient_email);
CREATE INDEX IF NOT EXISTS email_events_blast_idx ON email_events (blast_id, type);
CREATE INDEX IF NOT EXISTS email_events_token_idx ON email_events (token);
CREATE INDEX IF NOT EXISTS email_events_brand_idx ON email_events (brand_id);

-- 5) RLS: tabel ini HANYA boleh diakses server (service role).
--    Service role bypass RLS; anon/authenticated tidak dapat apa-apa.
ALTER TABLE email_track  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

-- 6) Verifikasi
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('email_track','email_events')
ORDER BY table_name, ordinal_position;
