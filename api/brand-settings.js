/**
 * Vercel Serverless Function — pengaturan pengirim EMAIL PER BRAND.
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" (harus member brand; yang boleh MENYIMPAN hanya owner via RLS).
 * Env  : SECRETS_KEY  (string acak >= 32 karakter, untuk mengenkripsi password/token di database)
 * Body : { brand_id, action: "get" | "save" | "verify", ... }
 *   get    -> status konfigurasi (tanpa pernah mengembalikan password/token)
 *   save   -> { email: {smtp_user, smtp_pass, smtp_host, smtp_port, from_name, reply_to},
 *               clear: ["email"] }
 *             field kosong pada smtp_pass = pertahankan yang lama
 *   verify -> { what: "email" | "both" } cek koneksi dengan kredensial yang tersimpan
 */
const { authBrand, encrypt, loadSettings, saveSettings, getMailConfig, createMailer, GMAIL_READ_SCOPE } = require('./_lib/brand');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicView(cfg) {
  const c = cfg || {};
  return {
    email: {
      configured: !!((c.smtp_user && c.smtp_pass_enc) || (c.gmail_email && c.gmail_refresh_token_enc)),
      gmail_connected: !!(c.gmail_email && c.gmail_refresh_token_enc),
      gmail_email: c.gmail_email || '',
      gmail_can_read: String(c.gmail_scopes || '').indexOf(GMAIL_READ_SCOPE) >= 0,
      gmail_connected_at: c.gmail_connected_at || null,
      smtp_configured: !!(c.smtp_user && c.smtp_pass_enc),
      smtp_user: c.smtp_user || '', has_password: !!c.smtp_pass_enc,
      smtp_host: c.smtp_host || '', smtp_port: c.smtp_port || '',
      from_name: c.from_name || '', reply_to: c.reply_to || '',
      email_header_enabled: !!c.email_header_enabled,
      email_header_config: c.email_header_config || null,
    },
  };
}

function bad(res, msg) { return res.status(400).json({ error: msg }); }

async function verifyEmail(a) {
  let mc;
  try { mc = await getMailConfig(a.token, a.brandId); } catch (e) { return { ok: false, message: e.message }; }
  if (!mc) return { ok: false, message: 'Gmail belum dihubungkan untuk brand ini.' };
  try {
    const m = await createMailer(mc);
    await m.verify();
    return { ok: true, message: (mc.type === 'gmail' ? 'Gmail terhubung: ' : 'Login SMTP berhasil sebagai ') + mc.user + '.' };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (mc.type === 'smtp' && /535|Invalid login|BadCredentials|EAUTH/i.test(msg + (e && e.code))) return { ok: false, message: 'Login ditolak. Pastikan App Password 16 karakter benar dan 2-Step Verification aktif — atau pakai tombol "Hubungkan Gmail" saja.' };
    return { ok: false, message: msg.slice(0, 200) };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return bad(res, 'Body tidak valid');

  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });
    const action = String(body.action || 'get');

    if (action === 'get') {
      return res.status(200).json(publicView(await loadSettings(a.token, a.brandId)));
    }

    if (action === 'save') {
      const patch = {};
      const clear = Array.isArray(body.clear) ? body.clear : [];
      if (clear.indexOf('email') >= 0) Object.assign(patch, { smtp_user: null, smtp_pass_enc: null, smtp_host: null, smtp_port: null, from_name: null, reply_to: null });

      const e = body.email;
      if (e && typeof e === 'object') {
        if (e.smtp_user !== undefined) {
          const u = String(e.smtp_user || '').trim().toLowerCase();
          if (u && !EMAIL_RE.test(u)) return bad(res, 'Alamat email pengirim tidak valid');
          patch.smtp_user = u || null;
        }
        const pass = String(e.smtp_pass || '').replace(/\s+/g, '');
        if (pass) { if (pass.length < 8) return bad(res, 'Password email terlalu pendek (App Password Gmail 16 karakter)'); patch.smtp_pass_enc = encrypt(pass); }
        if (e.smtp_host !== undefined) {
          const h = String(e.smtp_host || '').trim();
          if (h && !/^[a-z0-9.-]{3,100}$/i.test(h)) return bad(res, 'SMTP host tidak valid');
          patch.smtp_host = h || null;
        }
        if (e.smtp_port !== undefined) {
          const p = parseInt(e.smtp_port, 10);
          if (e.smtp_port !== '' && !(p > 0 && p < 65536)) return bad(res, 'SMTP port tidak valid');
          patch.smtp_port = e.smtp_port === '' ? null : p;
        }
        if (e.from_name !== undefined) patch.from_name = String(e.from_name || '').replace(/["\r\n<>]/g, '').trim().slice(0, 80) || null;
        if (e.email_header_enabled !== undefined) patch.email_header_enabled = !!e.email_header_enabled;
        if (e.email_header_config !== undefined) {
          const hc = e.email_header_config;
          if (hc === null || hc === '') { patch.email_header_config = null; }
          else if (typeof hc === 'object') {
            const socials = Array.isArray(hc.socials) ? hc.socials.slice(0, 8).map(s => ({
              i: String(s.i || '').replace(/["\r\n<>]/g, '').trim().slice(0, 500),
              l: String(s.l || '').replace(/["\r\n<>]/g, '').trim().slice(0, 60),
              u: String(s.u || '').replace(/["\r\n<>]/g, '').trim().slice(0, 300),
              p: String(s.p || '').replace(/[^a-z0-9]/gi, '').slice(0, 20),
            })).filter(s => s.l || s.u) : [];
            patch.email_header_config = {
              logo: String(hc.logo || '').replace(/["\r\n<>]/g, '').trim().slice(0, 500),
              logoSize: ['sm', 'md', 'lg', 'full'].indexOf(String(hc.logoSize || '')) >= 0 ? String(hc.logoSize) : 'md',
              name: String(hc.name || '').replace(/["\r\n<>]/g, '').trim().slice(0, 80),
              tagline: String(hc.tagline || '').replace(/["\r\n<>]/g, '').trim().slice(0, 120),
              footerEnabled: !!hc.footerEnabled,
              socials: socials,
              footerText: String(hc.footerText || '').replace(/["\r\n<>]/g, '').trim().slice(0, 200),
            };
          } else { return bad(res, 'Konfigurasi header/footer tidak valid'); }
        }
        if (e.reply_to !== undefined) {
          const r = String(e.reply_to || '').trim();
          if (r && !EMAIL_RE.test(r)) return bad(res, 'Reply-To tidak valid');
          patch.reply_to = r || null;
        }
      }
      if (!Object.keys(patch).length) return bad(res, 'Tidak ada perubahan untuk disimpan');
      await saveSettings(a.token, a.brandId, patch);
      return res.status(200).json(Object.assign({ ok: true }, publicView(await loadSettings(a.token, a.brandId))));
    }

    if (action === 'verify') {
      const what = String(body.what || 'both');
      const out = {};
      if (what === 'email' || what === 'both') out.email = await verifyEmail(a);
      return res.status(200).json(out);
    }

    return bad(res, 'Action tidak dikenal');
  } catch (e) {
    console.error('[brand-settings]', e);
    return res.status((e && e.status) || 500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
