-- =====================================================
-- KUNCI DATABASE: hanya user yang sudah login yang boleh akses
-- Jalankan SETELAH login di dashboard terbukti berhasil.
-- =====================================================

-- 1) Hapus semua policy lama (termasuk policy "anon" terbuka)
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2) Buat policy baru: hanya role "authenticated" (sudah login)
do $$
declare t text;
begin
  foreach t in array array['leads','tasks','activities','audiences','assets','blast_drafts','blast_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "hanya_user_login" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 3) Cabut akses role anon (pengunjung tanpa login), beri akses ke authenticated
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
