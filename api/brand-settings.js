/**
 * Vercel Serverless Function — pengaturan pengirim (email & WhatsApp) PER BRAND.
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" (harus member brand; yang boleh MENYIMPAN hanya owner via RLS).
 * Env  : SECRETS_KEY  (string acak >= 32 karakter, untuk mengenkripsi password/token di database)
 * Body : { brand_id, action: "get" | "save" | "verify", ... }
 *   get    -> status konfigurasi (tanpa pernah mengembalikan password/token)
 *   save   -> { email: {smtp_user, smtp_pass, smtp_host, smtp_port, from_name, reply_to},
 *               wa: {wa_phone_number_id, wa_token, wa_api_version}, clear: ["email","wa"] }
 *             field kosong pada smtp_pass / wa_token = pertahankan yang lama
 *   verify -> { what: "email" | "wa" | "both" } cek koneksi dengan kredensial yang tersimpan
 */
const { authBrand, encrypt, loadSettings, saveSettings, getMailConfig, createMailer, getWaConfig, GMAIL_READ_SCOPE } = require('./_lib/brand');

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
    wa: {
      configured: !!(c.wa_phone_number_id && c.wa_token_enc),
      connected_via_meta: !!c.wa_waba_id,
      display_phone: c.wa_display_phone || '',
      coexistence: !!c.wa_coexistence,
      embedded_signup_ready: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WA_ES_CONFIG_ID),
      wa_phone_number_id: c.wa_phone_number_id || '', wa_waba_id: c.wa_waba_id || '', has_token: !!c.wa_token_enc,
      wa_api_version: c.wa_api_version || '',
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

async function verifyWa(a) {
  const wc = await getWaConfig(a.token, a.brandId);
  if (!wc) return { ok: false, message: 'WhatsApp belum diatur untuk brand ini.' };
  try {
    const r = await fetch(`https://graph.facebook.com/${wc.version}/${encodeURIComponent(wc.phoneId)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${wc.token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j && (j.display_phone_number || j.id)) {
      return { ok: true, message: 'Tersambung: ' + (j.display_phone_number || wc.phoneId) + (j.verified_name ? ' (' + j.verified_name + ')' : '') + (j.quality_rating ? ' · kualitas ' + j.quality_rating : '') + '.' };
    }
    const err = (j && j.error) || {};
    if (err.code === 190) return { ok: false, message: 'Access token tidak valid atau kadaluarsa. Buat token permanen baru di Meta (System User) lalu simpan lagi.' };
    if (err.code === 100) return { ok: false, message: 'Phone number ID tidak ditemukan atau tokennya tidak punya akses ke nomor itu.' };
    return { ok: false, message: 'Meta menolak: ' + String(err.message || ('HTTP ' + r.status)).slice(0, 180) };
  } catch (e) {
    return { ok: false, message: 'Gagal menghubungi Meta: ' + String((e && e.message) || e).slice(0, 120) };
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
      if (clear.indexOf('wa') >= 0) Object.assign(patch, { wa_phone_number_id: null, wa_token_enc: null, wa_api_version: null, wa_waba_id: null, wa_display_phone: null, wa_coexistence: null, wa_connected_at: null });

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
      const w = body.wa;
      if (w && typeof w === 'object') {
        if (w.wa_phone_number_id !== undefined) {
          const id = String(w.wa_phone_number_id || '').trim();
          if (id && !/^\d{5,25}$/.test(id)) return bad(res, 'Phone number ID harus angka saja');
          patch.wa_phone_number_id = id || null;
        }
        if (w.wa_waba_id !== undefined) {
          const wb = String(w.wa_waba_id || '').trim();
          if (wb && !/^\d{5,25}$/.test(wb)) return bad(res, 'WABA ID harus angka saja');
          patch.wa_waba_id = wb || null;
        }
        const tok = String(w.wa_token || '').replace(/\s+/g, '');
        if (tok) { if (tok.length < 30) return bad(res, 'Access token terlalu pendek, pastikan token permanen disalin utuh'); patch.wa_token_enc = encrypt(tok); }
        if (w.wa_api_version !== undefined) {
          const v = String(w.wa_api_version || '').trim();
          if (v && !/^v\d{1,2}\.\d$/.test(v)) return bad(res, 'Versi API tidak valid (contoh: v25.0)');
          patch.wa_api_version = v || null;
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
      if (what === 'wa' || what === 'both') out.wa = await verifyWa(a);
      return res.status(200).json(out);
    }

    return bad(res, 'Action tidak dikenal');
  } catch (e) {
    console.error('[brand-settings]', e);
    return res.status((e && e.status) || 500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
