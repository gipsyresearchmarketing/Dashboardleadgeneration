-- =====================================================
-- HAPUS SEMUA SISA FITUR WA BLAST (2026-11-12)
-- Jalankan di Supabase SQL Editor (https://supabase.com/dashboard)
--
-- Konteks: tim Gipsy Research berhenti pakai WhatsApp Cloud API.
-- Sekarang pakai WhatsApp Business (WAB) app biasa, chatting manual
-- (maks 4 device per akun). Jadi semua sisa WA BLAST dibersihkan.
--
-- YANG TIDAK IKUT DIHAPUS (penting!):
--   - Email / Gmail blast  -> utuh
--   - leads.follow_ups     -> tetap (flag 'wa'/'email'/'call' buat kanban
--                            follow-up manual, termasuk "Followed Up (WhatsApp)")
--   - blast_drafts / blast_history -> tetap (dipakai email blast);
--     baris channel='wa' di dalamnya = 0, jadi ga ada data yg perlu dihapus
--
-- AMAN DIJALANKAN ULANG (idempotent).
-- =====================================================


-- =====================================================
-- BAGIAN 1 — Tabel WA blast
-- =====================================================
-- Riwayat chat WA (isi dari webhook, sekarang webhook-nya sudah dihapus)
DROP TABLE IF EXISTS wa_messages;

-- Jadwal kirim WA blast
DROP TABLE IF EXISTS wa_scheduled;

-- Balasan cepat WA blast
DROP TABLE IF EXISTS wa_quick_replies;


-- =====================================================
-- BAGIAN 2 — Kolom WA di brand_settings
--
-- Termasuk wa_token_enc (token Meta yang terenkripsi) — tidak dipakai
-- lagi sama sekali, mending dibuang biar tidak tertinggal di database.
--
-- CATATAN: kalau ada policy RLS di brand_settings yang memakai kolom wa_*,
-- Postgres akan menolak: "cannot alter type of a column used in a policy
-- definition". Karena itu policy yang relevan dibuang lebih dulu (dibuat
-- otomatis di bawah).
-- =====================================================
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'brand_settings'
      AND (coalesce(qual, '')       LIKE '%wa\_%'
        OR coalesce(with_check, '')  LIKE '%wa\_%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON brand_settings', p.policyname);
    RAISE NOTICE 'policy brand_settings.% dibuang (menggunakan kolom wa_*)', p.policyname;
  END LOOP;
END $$;

ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_phone_number_id;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_token_enc;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_api_version;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_waba_id;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_display_phone;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_coexistence;
ALTER TABLE brand_settings DROP COLUMN IF EXISTS wa_connected_at;


-- =====================================================
-- BAGIAN 3 — Data WA blast yang mungkin nyisa di tabel bersama
-- (blast_drafts & blast_history dipakai email blast juga, jadi tabelnya
--  TETAP. Yang dihapus hanya barisnya yang channel='wa'.)
-- =====================================================
DELETE FROM blast_drafts  WHERE channel = 'wa';
DELETE FROM blast_history WHERE channel = 'wa';


-- =====================================================
-- BAGIAN 4 — Verifikasi (jalankan sendiri)
-- =====================================================
SELECT 'sisa tabel wa_*' AS objek, count(*)::text AS jumlah
  FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wa\_%'
UNION ALL
SELECT 'sisa kolom wa_* di brand_settings', count(*)::text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='brand_settings' AND column_name LIKE 'wa\_%'
UNION ALL
SELECT 'baris channel=wa di blast_drafts', count(*)::text FROM blast_drafts  WHERE channel='wa'
UNION ALL
SELECT 'baris channel=wa di blast_history', count(*)::text FROM blast_history WHERE channel='wa'
UNION ALL
SELECT 'leads.follow_ups (harus tetap ada)', count(*)::text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='leads' AND column_name='follow_ups'
UNION ALL
SELECT 'email_header_config (harus tetap ada)', count(*)::text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='brand_settings' AND column_name='email_header_config';
