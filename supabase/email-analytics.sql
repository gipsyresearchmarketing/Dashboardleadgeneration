-- =====================================================
-- Analisa email blast: open rate, click rate, reply
-- Jalankan di Supabase SQL Editor
-- =====================================================

-- 1 row per penerima per blast (catatan pengiriman + status)
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
  -- Daftar URL link yg dilacak (index = c di URL tracking).
  -- Disimpan di server, JANGAN pernah ditaruh di URL publik.
  links            jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS email_track_blast_idx ON email_track (blast_id);
CREATE INDEX IF NOT EXISTS email_track_brand_idx ON email_track (brand_id);

-- 1 row per kejadian (open / click)
CREATE TABLE IF NOT EXISTS email_events (
  id               text PRIMARY KEY,
  brand_id         text,
  blast_id         text,
  token            text,
  recipient_email  text,
  type             text NOT NULL CHECK (type IN ('open','click')),
  url              text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_events_blast_idx ON email_events (blast_id, type);
CREATE INDEX IF NOT EXISTS email_events_token_idx ON email_events (token);
CREATE INDEX IF NOT EXISTS email_events_brand_idx ON email_events (brand_id);

-- Reply tracking: kolom blast_id di inbound_emails dipakai untuk menandai balasan dari blast mana
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS tracked_reply boolean NOT NULL DEFAULT false;

-- Verifikasi
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('email_track','email_events')
ORDER BY table_name, ordinal_position;
