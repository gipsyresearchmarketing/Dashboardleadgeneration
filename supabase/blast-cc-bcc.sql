-- =====================================================
-- Simpan Cc / Bcc di riwayat blast & draft
-- Jalankan di Supabase SQL Editor
-- =====================================================
ALTER TABLE blast_history ADD COLUMN IF NOT EXISTS cc   text[] DEFAULT '{}';
ALTER TABLE blast_history ADD COLUMN IF NOT EXISTS bcc  text[] DEFAULT '{}';
ALTER TABLE blast_drafts  ADD COLUMN IF NOT EXISTS cc   text[] DEFAULT '{}';
ALTER TABLE blast_drafts  ADD COLUMN IF NOT EXISTS bcc  text[] DEFAULT '{}';

-- Verifikasi
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('blast_history','blast_drafts') AND column_name IN ('cc','bcc');
