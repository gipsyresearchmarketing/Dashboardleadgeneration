/**
 * Vercel Serverless Function — tombol "Hubungkan Gmail" (Google OAuth) per brand.
 *
 * Alurnya:
 *  1. Dashboard  POST {action:"start", brand_id}          -> { url }  (link login Google)
 *  2. Google     GET  /api/google-oauth?code=..&state=..  -> redirect balik ke dashboard  /#gmail_code=..&gmail_state=..
 *  3. Dashboard  POST {action:"finish", code, state}      -> simpan refresh token (terenkripsi) ke brand_settings
 *     Dashboard  POST {action:"disconnect", brand_id}     -> cabut akses & hapus dari brand_settings
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" untuk semua POST. Hanya OWNER brand.
 * Env  : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SECRETS_KEY
 *        APP_URL (opsional, contoh https://dashboard-kamu.vercel.app — kalau domain dideteksi salah)
 *        GMAIL_READ_INBOX=0 (opsional) -> hanya minta izin kirim, fitur Inbox tidak aktif
 */
const {
  authBrand, encrypt, decrypt, sign, unsign, loadSettings, saveSettings,
  googleClient, oauthRedirectUri, GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE,
} = require('./_lib/brand');

const STATE_TTL_MS = 15 * 60 * 1000;

function scopes() {
  const s = ['openid', 'email', GMAIL_SEND_SCOPE];
  if (process.env.GMAIL_READ_INBOX !== '0') s.push(GMAIL_READ_SCOPE);
  return s;
}

function redirectBack(res, params) {
  const hash = new URLSearchParams(params).toString();
  res.setHeader('Location', '/#' + hash);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(302).end();
}

module.exports = async (req, res) => {
  // ---- (2) Callback dari Google ----
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.error) return redirectBack(res, { gmail_error: String(q.error).slice(0, 80) });
    if (!q.code || !q.state) return redirectBack(res, { gmail_error: 'missing_code' });
    return redirectBack(res, { gmail_code: String(q.code), gmail_state: String(q.state) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });
  const action = String(body.action || '');

  try {
    // ---- (1) Mulai: bikin link login Google ----
    if (action === 'start') {
      const a = await authBrand(req, body.brand_id);
      if (a.error) return res.status(a.status).json({ error: a.error });
      if (a.role !== 'owner') return res.status(403).json({ error: 'Hanya owner brand yang bisa menghubungkan Gmail.' });
      const g = googleClient();
      const state = sign({ b: a.brandId, u: a.user.id, exp: Date.now() + STATE_TTL_MS, n: Math.random().toString(36).slice(2) });
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: g.id,
        redirect_uri: oauthRedirectUri(req),
        response_type: 'code',
        scope: scopes().join(' '),
        access_type: 'offline',
        prompt: 'consent select_account',
        include_granted_scopes: 'false',
        state,
      }).toString();
      return res.status(200).json({ url });
    }

    // ---- (3) Selesai: tukar code jadi token & simpan ----
    if (action === 'finish') {
      const st = unsign(body.state);
      if (!st || !st.b || !st.u) return res.status(400).json({ error: 'Link Google tidak valid. Ulangi klik "Hubungkan Gmail".' });
      if (Date.now() > Number(st.exp || 0)) return res.status(400).json({ error: 'Link Google kadaluarsa (lebih dari 15 menit). Ulangi klik "Hubungkan Gmail".' });
      const a = await authBrand(req, st.b);
      if (a.error) return res.status(a.status).json({ error: a.error });
      if (a.user.id !== st.u) return res.status(403).json({ error: 'Akun yang login berbeda dengan yang memulai koneksi Gmail.' });
      if (a.role !== 'owner') return res.status(403).json({ error: 'Hanya owner brand yang bisa menghubungkan Gmail.' });

      const g = googleClient();
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(body.code || ''), client_id: g.id, client_secret: g.secret, redirect_uri: oauthRedirectUri(req), grant_type: 'authorization_code' }),
      });
      const tok = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.access_token) {
        let why = tok.error_description || tok.error || ('HTTP ' + tr.status);
        if (tok.error === 'redirect_uri_mismatch') why = 'Redirect URI belum didaftarkan di Google Cloud. Tambahkan persis: ' + oauthRedirectUri(req);
        if (tok.error === 'invalid_grant') why = 'Kode dari Google sudah terpakai / kadaluarsa. Ulangi klik "Hubungkan Gmail".';
        return res.status(400).json({ error: why });
      }
      const granted = String(tok.scope || '');
      if (granted.indexOf(GMAIL_SEND_SCOPE) < 0) {
        return res.status(400).json({ error: 'Izin "Kirim email atas nama kamu" tidak dicentang di halaman Google. Ulangi dan centang semua izin.' });
      }
      if (!tok.refresh_token) {
        return res.status(400).json({ error: 'Google tidak memberi akses jangka panjang. Buka myaccount.google.com/permissions, hapus akses app ini, lalu hubungkan lagi.' });
      }
      const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const info = await ui.json().catch(() => ({}));
      const email = String(info.email || '').toLowerCase();
      if (!email) return res.status(400).json({ error: 'Tidak bisa membaca alamat Gmail dari Google.' });

      await saveSettings(a.token, a.brandId, {
        gmail_email: email,
        gmail_refresh_token_enc: encrypt(tok.refresh_token),
        gmail_scopes: granted,
        gmail_connected_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, brand_id: a.brandId, email, can_read_inbox: granted.indexOf(GMAIL_READ_SCOPE) >= 0 });
    }

    // ---- Putuskan koneksi ----
    if (action === 'disconnect') {
      const a = await authBrand(req, body.brand_id);
      if (a.error) return res.status(a.status).json({ error: a.error });
      if (a.role !== 'owner') return res.status(403).json({ error: 'Hanya owner brand yang bisa memutus Gmail.' });
      const cfg = await loadSettings(a.token, a.brandId);
      if (cfg && cfg.gmail_refresh_token_enc) {
        try {
          const rt = decrypt(cfg.gmail_refresh_token_enc);
          await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt }) });
        } catch (e) { /* tetap hapus dari database walau revoke gagal */ }
      }
      await saveSettings(a.token, a.brandId, { gmail_email: null, gmail_refresh_token_enc: null, gmail_scopes: null, gmail_connected_at: null });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[google-oauth]', e);
    return res.status((e && e.status) || 500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
