# Leads CRM — Dashboard

A complete CRM dashboard for managing leads, audiences, email/WA blasts, image library, and tasks. Built as a single self-contained HTML file (no build step) with Tailwind CSS, Chart.js, and Supabase integration.

## Stack

- **Frontend**: Single HTML file (`dashboard.html`), Tailwind CSS via CDN, Chart.js
- **Backend**: Supabase (Postgres + Auth + Storage)
- **Hosting**: Vercel (static site)
- **Repo**: GitHub

## Features

- 📊 Dashboard with KPI cards + status funnel chart (with date range filter)
- 👥 Leads / Companies tables (CRM data)
- ✅ Tasks (with overdue indicator) and Activities
- 📅 Calendar view
- 📨 Email Blast and 💬 WhatsApp Blast (with WYSIWYG drag-and-drop block editor)
- 📂 Image Library (asset manager)
- 👥 Audiences (saved recipient segments)

## Project Structure

```
.
├── dashboard.html              # Entire app — single file
├── supabase/
│   ├── schema.sql              # Tables, RLS, seed data
│   ├── config.example.js       # Example Supabase config
│   └── README.md               # Supabase setup instructions
├── vercel.json                  # Vercel static deployment config
├── README.md                   # This file
├── .gitignore
└── docs/
    └── API.md                  # (optional) Supabase API docs
```

## Setup (3 steps)

### 1. Supabase (Backend)

1. Create a new Supabase project at https://supabase.com
2. Go to SQL Editor → paste contents of `supabase/schema.sql` → run
3. Copy your project URL and anon key from Project Settings → API
4. Open `dashboard.html` and replace the config values:

```html
<script>
  window.SUPABASE_CONFIG = {
    url: 'https://YOUR-PROJECT.supabase.co',
    anonKey: 'YOUR-ANON-KEY'
  };
</script>
```

(Or use environment variables / a build step in production.)

### 2. Deploy to Vercel

```bash
# Install Vercel CLI (optional)
npm i -g vercel

# From the project root
vercel --prod
```

Or connect your GitHub repo in Vercel dashboard → it auto-detects static site.

### 3. Push to GitHub

```bash
# Authenticate
gh auth login

# Create repo (public)
gh repo create leads-crm-dashboard --public --source=. --remote=origin --push
```

## Local Development

Just open `dashboard.html` in a browser. With Supabase configured it persists to the cloud; without it, data falls back to `localStorage` (offline-friendly).

## Demo Data

`schema.sql` seeds 20 sample leads (mix of Companies + Contacts across all 6 statuses), 12 tasks (mix of overdue/due today/completed), 11 activity records, 20 audiences, and 5 image assets. Useful for screenshots and demos.

## Tech notes

- Dashboard HTML is **one big file** — easy to deploy, easy to grep, but weighs ~120KB. Acceptable for an internal CRM.
- Tailwind via CDN — no build step.
- All data mutations go through `localStorage` first, then sync to Supabase when online.
- Auth (planned) — single-user mode by default, multi-org if you add Supabase auth.

## License

Private / internal.
