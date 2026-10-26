/**
 * Helper bersama untuk semua fungsi API (file berawalan "_" tidak dijadikan endpoint oleh Vercel).
 * - verifikasi user & keanggotaan brand (Supabase)
 * - baca/simpan pengaturan pengirim PER BRAND (tabel brand_settings)
 * - enkripsi password/token (AES-256-GCM) memakai env SECRETS_KEY
 * - kirim email lewat Gmail milik brand: cara utama "Hubungkan Gmail" (OAuth Google, tanpa App Password),
 *   cadangan SMTP + App Password (untuk email non-Gmail)
 *
 * Env: SECRETS_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_JTxgxH__IgjcJhGkncaIkQ_erJNnZDG';

const hdr = (token, extra) => Object.assign({ apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, extra || {});

async function verifyUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: hdr(token) });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

/** Role user di brand ('owner', 'member', ...) atau null kalau bukan member. */
async function memberRole(token, brandId, userId) {
  const url = `${SUPABASE_URL}/rest/v1/brand_members?select=role&brand_id=eq.${encodeURIComponent(brandId)}&user_id=eq.${encodeURIComponent(userId)}`;
  const r = await fetch(url, { headers: hdr(token) });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? String(rows[0].role || 'member') : null;
}
async function isBrandMember(token, brandId, userId) { return !!(await memberRole(token, brandId, userId)); }

/** Verifikasi token + member brand sekaligus. Return { token, user, brandId, role } atau { status, error }. */
async function authBrand(req, brandIdRaw) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { status: 401, error: 'Belum login' };
  const user = await verifyUser(token);
  if (!user) return { status: 401, error: 'Session tidak valid, coba login ulang' };
  const brandId = String(brandIdRaw || '');
  const role = brandId ? await memberRole(token, brandId, user.id) : null;
  if (!role) return { status: 403, error: 'Kamu bukan member brand ini' };
  return { token, user, brandId, role };
}

/* ---------- enkripsi ---------- */
function secretKey() {
  const k = process.env.SECRETS_KEY;
  if (!k || k.length < 16) return null;
  const b = /^[A-Za-z0-9+/=]{43,}$/.test(k) ? Buffer.from(k, 'base64') : null;
  return b && b.length === 32 ? b : crypto.createHash('sha256').update(k).digest();
}
function encrypt(plain) {
  const key = secretKey();
  if (!key) throw new Error('SECRETS_KEY belum diisi di Vercel (string acak minimal 32 karakter).');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(enc) {
  const key = secretKey();
  if (!key) throw new Error('SECRETS_KEY belum diisi di Vercel (string acak minimal 32 karakter).');
  if (!enc || !String(enc).startsWith('v1:')) throw new Error('Format rahasia tidak dikenali, simpan ulang pengaturan di Profile.');
  const raw = Buffer.from(String(enc).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (e) {
    throw new Error('Rahasia tidak bisa dibuka (SECRETS_KEY berubah?). Hubungkan ulang Gmail / simpan ulang pengaturan di Profile.');
  }
}

/** Tanda tangan HMAC (untuk parameter `state` OAuth supaya tidak bisa dipalsukan). */
function sign(payloadObj) {
  const key = secretKey();
  if (!key) throw new Error('SECRETS_KEY belum diisi di Vercel (string acak minimal 32 karakter).');
  const body = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const mac = crypto.createHmac('sha256', key).update('oauth:' + body).digest('base64url');
  return body + '.' + mac;
}
function unsign(str) {
  const key = secretKey();
  const [body, mac] = String(str || '').split('.');
  if (!key || !body || !mac) return null;
  const good = crypto.createHmac('sha256', key).update('oauth:' + body).digest('base64url');
  if (good.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(mac))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
}

/* ---------- brand_settings ---------- */
async function loadSettings(token, brandId) {
  const url = `${SUPABASE_URL}/rest/v1/brand_settings?select=*&brand_id=eq.${encodeURIComponent(brandId)}`;
  const r = await fetch(url, { headers: hdr(token) });
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
    const err = new Error(/relation .* does not exist|schema cache/i.test(msg)
      ? 'Tabel brand_settings belum dibuat di Supabase (jalankan file supabase-brand-settings.sql).'
      : 'Gagal membaca pengaturan brand (' + r.status + ') ' + msg.slice(0, 120));
    err.status = 500; throw err;
  }
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function saveSettings(token, brandId, patch) {
  const row = Object.assign({ brand_id: brandId, updated_at: new Date().toISOString() }, patch);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/brand_settings?on_conflict=brand_id`, {
    method: 'POST',
    headers: hdr(token, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
    if (r.status === 401 || r.status === 403 || /row-level security/i.test(msg)) { const e = new Error('Hanya owner brand yang boleh mengubah pengaturan pengiriman.'); e.status = 403; throw e; }
    if (/gmail_/i.test(msg) && /column/i.test(msg)) { const e = new Error('Kolom Gmail belum ada di tabel brand_settings — jalankan file supabase-gmail-oauth.sql di Supabase SQL Editor.'); e.status = 500; throw e; }
    if (/email_header_/i.test(msg) && /column/i.test(msg)) { const e = new Error('Kolom header/footer email belum ada di tabel brand_settings — jalankan: ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS email_header_enabled boolean NOT NULL DEFAULT false; ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS email_header_config jsonb;'); e.status = 500; throw e; }
    const e = new Error(/relation .* does not exist|schema cache/i.test(msg) ? 'Tabel brand_settings belum dibuat di Supabase (jalankan file supabase-brand-settings.sql).' : 'Gagal menyimpan (' + r.status + ') ' + msg.slice(0, 120));
    e.status = 500; throw e;
  }
}

async function loadBrandName(token, brandId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/brands?select=name&id=eq.${encodeURIComponent(brandId)}`, { headers: hdr(token) });
    const rows = await r.json();
    return (rows && rows[0] && rows[0].name) || '';
  } catch (e) { return ''; }
}

/* ---------- Google OAuth (Hubungkan Gmail) ---------- */
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function googleClient() {
  const id = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!id || !secret) {
    const e = new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diisi di Vercel (Settings → Environment Variables), lalu redeploy.');
    e.status = 500; throw e;
  }
  return { id, secret };
}

/** Alamat callback OAuth, harus sama persis dengan yang didaftarkan di Google Cloud. */
function oauthRedirectUri(req) {
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/+$/, '') + '/api/google-oauth';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}/api/google-oauth`;
}

class GmailAuthError extends Error {}

/** Tukar refresh token jadi access token (berlaku ~1 jam). */
async function gmailAccessToken(refreshToken) {
  const g = googleClient();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.id, client_secret: g.secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') throw new GmailAuthError('Koneksi Gmail brand ini sudah kadaluarsa / dicabut. Buka Profile → klik "Hubungkan Gmail" lagi.');
    throw new Error('Gagal minta akses ke Google: ' + (j.error_description || j.error || ('HTTP ' + r.status)));
  }
  return j.access_token;
}

/**
 * Konfigurasi email brand, atau null kalau belum diatur.
 *   type 'gmail' -> lewat Gmail API (hasil "Hubungkan Gmail")
 *   type 'smtp'  -> SMTP + App Password (cadangan)
 */
async function getMailConfig(token, brandId) {
  const cfg = await loadSettings(token, brandId);
  if (!cfg) return null;
  const brandName = await loadBrandName(token, brandId);
  const clean = (s) => String(s || '').replace(/["\r\n<>]/g, '').slice(0, 80);
  if (cfg.gmail_email && cfg.gmail_refresh_token_enc) {
    return {
      type: 'gmail',
      user: cfg.gmail_email,
      refreshToken: decrypt(cfg.gmail_refresh_token_enc),
      canRead: String(cfg.gmail_scopes || '').indexOf(GMAIL_READ_SCOPE) >= 0,
      fromName: clean(cfg.from_name || brandName || cfg.gmail_email),
      replyTo: cfg.reply_to || undefined,
    };
  }
  if (cfg.smtp_user && cfg.smtp_pass_enc) {
    return {
      type: 'smtp',
      user: cfg.smtp_user, pass: decrypt(cfg.smtp_pass_enc),
      host: cfg.smtp_host || 'smtp.gmail.com', port: Number(cfg.smtp_port) || 465,
      fromName: clean(cfg.from_name || brandName || cfg.smtp_user),
      replyTo: cfg.reply_to || undefined,
    };
  }
  return null;
}

/** Pengirim email seragam untuk kedua jenis konfigurasi: { send(mailOptions), verify() }. */
async function createMailer(mc) {
  const nodemailer = require('nodemailer');
  if (mc.type === 'smtp') {
    const t = nodemailer.createTransport({ host: mc.host, port: mc.port, secure: mc.port === 465, auth: { user: mc.user, pass: mc.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
    return { send: (opts) => t.sendMail(opts), verify: () => t.verify() };
  }
  const MailComposer = require('nodemailer/lib/mail-composer');
  const accessToken = await gmailAccessToken(mc.refreshToken);
  const send = async (opts) => {
    const node = new MailComposer(opts).compile();
    node.keepBcc = true; // Gmail API membaca Bcc dari header lalu menghapusnya sendiri
    const raw = (await node.build()).toString('base64url');
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
      if (r.status === 403 && /insufficient|scope/i.test(msg)) throw new Error('Izin kirim Gmail belum diberikan. Hubungkan ulang Gmail dan centang izin "Send email".');
      if (r.status === 429 || /rate|quota|limit/i.test(msg)) throw new Error('Batas kirim harian Gmail tercapai, coba lagi besok. (' + msg + ')');
      throw new Error('Gmail menolak: ' + msg);
    }
    return r.json().catch(() => ({}));
  };
  const verify = async () => {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
    // Kalau scope hanya gmail.send, endpoint profile bisa 403 — tapi token valid berarti koneksi OK.
    if (!r.ok && r.status !== 403) throw new Error('Gmail API menolak (HTTP ' + r.status + ')');
    return true;
  };
  return { send, verify, accessToken };
}

/** Konfigurasi WhatsApp brand (token terdekripsi), atau null kalau belum diatur. */
async function getWaConfig(token, brandId) {
  const cfg = await loadSettings(token, brandId);
  if (!cfg || !cfg.wa_phone_number_id || !cfg.wa_token_enc) return null;
  return { phoneId: cfg.wa_phone_number_id, token: decrypt(cfg.wa_token_enc), version: cfg.wa_api_version || process.env.WA_API_VERSION || 'v25.0', waba: cfg.wa_waba_id || null };
}

module.exports = {
  authBrand, verifyUser, isBrandMember, memberRole, encrypt, decrypt, sign, unsign,
  loadSettings, saveSettings, loadBrandName, getMailConfig, createMailer, getWaConfig,
  googleClient, oauthRedirectUri, gmailAccessToken, GmailAuthError, GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE,
  SUPABASE_URL, SUPABASE_KEY,
};
