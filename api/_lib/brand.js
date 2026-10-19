/**
 * Helper bersama untuk semua fungsi API (file berawalan "_" tidak dijadikan endpoint oleh Vercel).
 * - verifikasi user & keanggotaan brand (Supabase)
 * - baca/simpan pengaturan pengirim PER BRAND (tabel brand_settings)
 * - enkripsi password/token (AES-256-GCM) memakai env SECRETS_KEY
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

async function isBrandMember(token, brandId, userId) {
  const url = `${SUPABASE_URL}/rest/v1/brand_members?select=brand_id&brand_id=eq.${encodeURIComponent(brandId)}&user_id=eq.${encodeURIComponent(userId)}`;
  const r = await fetch(url, { headers: hdr(token) });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

/** Verifikasi token + member brand sekaligus. Return { user } atau { status, error }. */
async function authBrand(req, brandIdRaw) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { status: 401, error: 'Belum login' };
  const user = await verifyUser(token);
  if (!user) return { status: 401, error: 'Session tidak valid, coba login ulang' };
  const brandId = String(brandIdRaw || '');
  if (!brandId || !(await isBrandMember(token, brandId, user.id))) return { status: 403, error: 'Kamu bukan member brand ini' };
  return { token, user, brandId };
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
    throw new Error('Rahasia tidak bisa dibuka (SECRETS_KEY berubah?). Simpan ulang password/token di Profile.');
  }
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

/** Konfigurasi email brand (dengan password terdekripsi), atau null kalau belum diatur. */
async function getMailConfig(token, brandId) {
  const cfg = await loadSettings(token, brandId);
  if (!cfg || !cfg.smtp_user || !cfg.smtp_pass_enc) return null;
  const brandName = await loadBrandName(token, brandId);
  return {
    user: cfg.smtp_user, pass: decrypt(cfg.smtp_pass_enc),
    host: cfg.smtp_host || 'smtp.gmail.com', port: Number(cfg.smtp_port) || 465,
    fromName: String(cfg.from_name || brandName || cfg.smtp_user).replace(/["\r\n<>]/g, '').slice(0, 80),
    replyTo: cfg.reply_to || undefined,
  };
}

/** Konfigurasi WhatsApp brand (token terdekripsi), atau null kalau belum diatur. */
async function getWaConfig(token, brandId) {
  const cfg = await loadSettings(token, brandId);
  if (!cfg || !cfg.wa_phone_number_id || !cfg.wa_token_enc) return null;
  return { phoneId: cfg.wa_phone_number_id, token: decrypt(cfg.wa_token_enc), version: cfg.wa_api_version || process.env.WA_API_VERSION || 'v25.0', waba: cfg.wa_waba_id || null };
}

module.exports = { authBrand, verifyUser, isBrandMember, encrypt, decrypt, loadSettings, saveSettings, loadBrandName, getMailConfig, getWaConfig, SUPABASE_URL, SUPABASE_KEY };
