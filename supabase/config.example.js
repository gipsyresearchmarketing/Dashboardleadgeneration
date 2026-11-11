// Copy to dashboard.html (paste inside <script> at top) and replace placeholders with your Supabase project values.
// Or load via fetch + dynamic injection if you prefer.

// Example: include this at the top of dashboard.html (or load it before the main app script)

window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-ID.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.YOUR-ANON-KEY-HERE',
  options: {
    auth: {
      persistSession: false,         // we don't run auth in this build — single-user mode
      autoRefreshToken: false,
    },
  },
};
