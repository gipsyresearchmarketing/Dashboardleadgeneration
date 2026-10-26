-- =====================================================
-- Header & Footer email blast (per brand)
-- Jalankan di Supabase SQL Editor
-- =====================================================
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS email_header_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS email_header_config jsonb;

-- Contoh isi email_header_config:
-- {
--   "logo": "https://.../logo.png",
--   "name": "Gipsy Research",
--   "tagline": "Bantu belajar & memahami riset",
--   "footerEnabled": true,
--   "socials": [
--     {"i": "🌐", "l": "gipsyresearch.id", "u": "https://gipsyresearch.id"},
--     {"i": "📸", "l": "@gipsyresearch", "u": "https://instagram.com/gipsyresearch"}
--   ],
--   "footerText": "Email ini dikirim oleh Gipsy Research."
-- }

-- Verifikasi
SELECT brand_id, email_header_enabled, email_header_config FROM brand_settings;
