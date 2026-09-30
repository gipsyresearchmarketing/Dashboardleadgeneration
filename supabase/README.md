# Supabase setup

## Steps

1. Create a new project at https://supabase.com
2. Go to **SQL Editor**
3. Open `schema.sql` from this folder, paste the entire contents, click **Run**
4. That creates all tables + RLS policies + seeds 20 leads / 12 tasks / 11 activities / 2 audiences / 3 image assets
5. Go to **Project Settings → API**:
 - Copy the **Project URL** (e.g. `https://abcdefg.supabase.co`)
 - Copy the **anon public** key (long JWT-looking string)
6. Open `dashboard.html` and replace these two lines near the top of the script:

```js
window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'eyJhbGciOi...PASTE_HERE...',
};
```

7. Save and reload. The app will:
 - Load data from Supabase if the URL/key are valid AND online
 - Fall back to `localStorage` if Supabase is offline or unreachable
 - Persist every write to BOTH (Supabase first, localStorage as cache)

## Why localStorage fallback?

- Dev mode: works offline, no backend needed
- Demo / screenshots: instant load
- Production: Supabase is source of truth, localStorage = cache

## Schema notes

- `leads.id`, `audiences.id`, etc. are TEXT (not auto-increment) because the app generates IDs like `L-0001`, `A-001` etc. — keeps the existing mock IDs.
- `tags` is a TEXT[] array (Postgres array) — app joins with comma when loading.
- `blast_drafts.blocks` and `blast_drafts.files` are JSONB — stores the array of block objects + file objects literally.
- RLS is permissive (`USING (true)`) so anon can read+write all data — fine for single-user / internal CRM.
- When you add real auth later, replace the policies with `auth.uid() = user_id` checks.

## Future: add auth

To enable per-user auth:

1. Enable Email/Password auth in Supabase → Authentication → Providers
2. Add `user_id uuid references auth.users(id)` column to each table
3. Replace RLS policies:
 ```sql
 CREATE POLICY "owner_only" ON leads FOR ALL TO authenticated
 USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
 ```
4. Add login UI to dashboard.html (a modal with email/password fields)

That's out of scope for the initial deploy but trivial to add later.
