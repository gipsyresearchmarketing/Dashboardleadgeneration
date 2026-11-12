-- =====================================================
-- FITUR LANJUTAN (Tim + Balasan Cepat WhatsApp)
-- Jalankan di Supabase SQL Editor (https://supabase.com/dashboard)
--
-- Kenapa perlu:
--  Halaman Profile > "TIM — GIPSY RESEARCH" nampilin
--  "Fitur belum aktif" karena RPC brand_member_list BELUM ADA
--  di database, dan tabel brand_invites belum ada.
--  Halaman WhatsApp > "Balasan cepat" butuh tabel wa_quick_replies.
--
-- AMAN DIJALANKAN ULANG (idempotent).
--
-- Isi:
--  1. Helper is_brand_owner()          -> HARUS pertama (dipakai policy)
--  2. Tabel brand_invites              (undang anggota tim)
--  3. Tabel wa_quick_replies           (balasan cepat /nama)
--  4. RPC brand_member_list            -> daftar anggota + email + tandai "kamu"
--  5. RPC remove_brand_member          -> keluarkan anggota
--  6. RPC accept_my_invites            -> auto-terima undangan saat login
--
-- CATATAN TIPE:
--  Kolom brand_members.user_id / brand_id di database bisa bertipe
--  uuid ATAU text. Semua perbandingan di file ini pakai ::text biar
--  aman untuk keduanya.
-- =====================================================


-- =====================================================
-- BAGIAN 1 — Helper: apakah user ini owner sebuah brand?
-- (Dibuat DULUAN karena policy di Bagian 2 memakainya)
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_brand_owner(bid text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM brand_members m
    WHERE m.brand_id::text = bid
      AND m.user_id::text = auth.uid()::text
      AND m.role::text = 'owner'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_brand_owner(text) TO authenticated, anon;


-- =====================================================
-- BAGIAN 2 — Tabel brand_invites (undang anggota tim)
--
-- PENTING: brand_id harus TEXT (bukan uuid)!
-- Id brand di app dibuat dari uid('B') -> "B-XXXXXX" (TEKS),
-- sama seperti brands.id dan brand_members.brand_id.
-- Kalau brand_id dibuat uuid, INSERT '.'B-GIPSY' error:
--   invalid input syntax for type uuid
-- =====================================================
CREATE TABLE IF NOT EXISTS brand_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     text NOT NULL,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'member',
  invited_by   uuid,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Perbaiki kalau tabelnya sudah pernah dibuat dengan brand_id uuid.
-- CATATAN: kolom brand_id dipakai di policy RLS -> Postgres TOLAK ALTER selama
-- policy masih ada ("cannot alter type of a column used in a policy definition").
-- Jadi policy harus DIBUANG DULU, baru ALTER. Policy-nya dibuat ulang di bawah.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_invites'
      AND column_name = 'brand_id' AND data_type = 'uuid'
  ) THEN
    DROP POLICY IF EXISTS "brand_invites_read"   ON brand_invites;
    DROP POLICY IF EXISTS "brand_invites_insert" ON brand_invites;
    DROP POLICY IF EXISTS "brand_invites_update" ON brand_invites;
    DROP POLICY IF EXISTS "brand_invites_delete" ON brand_invites;
    ALTER TABLE brand_invites ALTER COLUMN brand_id TYPE text USING brand_id::text;
    RAISE NOTICE 'brand_invites.brand_id diubah uuid -> text (policy dibuat ulang di bawah)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS brand_invites_brand_idx ON brand_invites (brand_id);
CREATE INDEX IF NOT EXISTS brand_invites_email_idx ON brand_invites (lower(email));
CREATE INDEX IF NOT EXISTS brand_invites_open_idx  ON brand_invites (brand_id) WHERE accepted_at IS NULL;

ALTER TABLE brand_invites ENABLE ROW LEVEL SECURITY;

-- Owner brand boleh kelola undangan; yg diundang boleh lihat undistannya sendiri.
DROP POLICY IF EXISTS "brand_invites_read" ON brand_invites;
CREATE POLICY "brand_invites_read" ON brand_invites FOR SELECT TO authenticated
  USING (
    public.is_brand_owner(brand_id::text)
    OR lower(email) = lower((SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()))
  );

DROP POLICY IF EXISTS "brand_invites_insert" ON brand_invites;
CREATE POLICY "brand_invites_insert" ON brand_invites FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_owner(brand_id::text));

DROP POLICY IF EXISTS "brand_invites_update" ON brand_invites;
CREATE POLICY "brand_invites_update" ON brand_invites FOR UPDATE TO authenticated
  USING (public.is_brand_owner(brand_id::text))
  WITH CHECK (public.is_brand_owner(brand_id::text));

DROP POLICY IF EXISTS "brand_invites_delete" ON brand_invites;
CREATE POLICY "brand_invites_delete" ON brand_invites FOR DELETE TO authenticated
  USING (public.is_brand_owner(brand_id::text));


-- =====================================================
-- BAGIAN 3 — Tabel wa_quick_replies (balasan cepat WhatsApp)
-- CATATAN: fitur WA Blast sudah dihapus dari dashboard (2026-11-11).
-- Tabel ini dibikin aja supaya tidak error; boleh di-drop kalau ga dipakai.
-- brand_id TEXT, sama seperti brand_members.brand_id.
-- =====================================================
CREATE TABLE IF NOT EXISTS wa_quick_replies (
  id         text PRIMARY KEY,
  brand_id   text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Perbaiki kalau tabelnya sudah pernah dibuat dengan brand_id uuid
-- (policy harus dibuang dulu — Postgres tidak bisa ALTER kolom yang dipakai policy)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wa_quick_replies'
      AND column_name = 'brand_id' AND data_type = 'uuid'
  ) THEN
    DROP POLICY IF EXISTS "wa_quick_replies_all" ON wa_quick_replies;
    ALTER TABLE wa_quick_replies ALTER COLUMN brand_id TYPE text USING brand_id::text;
    RAISE NOTICE 'wa_quick_replies.brand_id diubah uuid -> text (policy dibuat ulang di bawah)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS wa_quick_replies_brand_idx ON wa_quick_replies (brand_id, title);

ALTER TABLE wa_quick_replies ENABLE ROW LEVEL SECURITY;

-- Hanya anggota brand yg boleh pakai balasan cepatnya.
DROP POLICY IF EXISTS "wa_quick_replies_all" ON wa_quick_replies;
CREATE POLICY "wa_quick_replies_all" ON wa_quick_replies FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM brand_members m
            WHERE m.brand_id::text = wa_quick_replies.brand_id::text
              AND m.user_id::text = auth.uid()::text)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM brand_members m
            WHERE m.brand_id::text = wa_quick_replies.brand_id::text
              AND m.user_id::text = auth.uid()::text)
  );


-- =====================================================
-- BAGIAN 4 — RPC: daftar anggota tim
-- Return: user_id, email, role, is_me
-- =====================================================
CREATE OR REPLACE FUNCTION public.brand_member_list(bid text)
RETURNS TABLE (user_id text, email text, role text, is_me boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.user_id::text AS user_id,
         COALESCE(u.email::text, '') AS email,
         m.role::text AS role,
         (m.user_id::text = auth.uid()::text) AS is_me
  FROM brand_members m
  LEFT JOIN auth.users u ON u.id::text = m.user_id::text
  WHERE m.brand_id::text = bid
  ORDER BY (m.role::text = 'owner') DESC, u.email::text;
$$;

GRANT EXECUTE ON FUNCTION public.brand_member_list(text) TO authenticated, anon;


-- =====================================================
-- BAGIAN 5 — RPC: keluarkan anggota tim
-- =====================================================
CREATE OR REPLACE FUNCTION public.remove_brand_member(bid text, uid text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_brand_owner(bid) THEN
    RETURN false;
  END IF;

  -- Owner terakhir gak boleh dikeluarkan sendiri.
  IF (SELECT count(*) FROM brand_members m
       WHERE m.brand_id::text = bid AND m.role::text = 'owner'
         AND m.user_id::text = uid) > 0
     AND (SELECT count(*) FROM brand_members m
       WHERE m.brand_id::text = bid AND m.role::text = 'owner') <= 1 THEN
    RETURN false;
  END IF;

  DELETE FROM brand_members
  WHERE brand_id::text = bid AND user_id::text = uid;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_brand_member(text, text) TO authenticated, anon;


-- =====================================================
-- BAGIAN 6 — RPC: auto-terima undangan saat login
-- Return: jumlah brand yg baru dimasuki
--
-- Pakai EXECUTE (dynamic SQL) karena kolom brand_members.user_id /
-- brand_id bisa bertipe uuid atau text — tipe dicek saat runtime.
-- =====================================================
CREATE OR REPLACE FUNCTION public.accept_my_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me_email text;
  n        integer := 0;
  uid_expr text;
  bid_expr text;
BEGIN
  SELECT u.email::text INTO me_email FROM auth.users u WHERE u.id::text = auth.uid()::text;
  IF me_email IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(
           (SELECT CASE WHEN pg_typeof(user_id)::text = 'uuid'
                        THEN 'auth.uid()::text::uuid' ELSE 'auth.uid()::text' END
              FROM brand_members LIMIT 1),
           'auth.uid()::text::uuid'),
         COALESCE(
           (SELECT CASE WHEN pg_typeof(brand_id)::text = 'uuid'
                        THEN 'i.brand_id' ELSE 'i.brand_id::text' END
              FROM brand_members LIMIT 1),
           'i.brand_id')
    INTO uid_expr, bid_expr;

  EXECUTE format($q$
    INSERT INTO brand_members (brand_id, user_id, role, created_at)
    SELECT %s, %s, i.role::text, now()
    FROM brand_invites i
    WHERE lower(i.email) = lower($1)
      AND i.accepted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM brand_members m
        WHERE m.brand_id::text = i.brand_id::text
          AND m.user_id::text = %s::text
      )
  $q$, bid_expr, uid_expr, uid_expr)
  USING me_email;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE brand_invites
  SET accepted_at = now()
  WHERE lower(email) = lower(me_email) AND accepted_at IS NULL;

  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_my_invites() TO authenticated, anon;


-- =====================================================
-- BAGIAN 7 — Verifikasi (jalankan sendiri)
-- =====================================================
SELECT 'tabel brand_invites'   AS objek, count(*)::text AS detail FROM brand_invites
UNION ALL SELECT 'tabel wa_quick_replies', count(*)::text FROM wa_quick_replies
UNION ALL SELECT 'fn brand_member_list',  count(*)::text FROM pg_proc WHERE proname = 'brand_member_list'
UNION ALL SELECT 'fn remove_brand_member',count(*)::text FROM pg_proc WHERE proname = 'remove_brand_member'
UNION ALL SELECT 'fn accept_my_invites',  count(*)::text FROM pg_proc WHERE proname = 'accept_my_invites'
UNION ALL SELECT 'fn is_brand_owner',     count(*)::text FROM pg_proc WHERE proname = 'is_brand_owner';
