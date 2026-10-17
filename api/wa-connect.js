/**
 * Vercel Serverless Function — tombol "Hubungkan WhatsApp" (Meta Embedded Signup) per brand.
 * Mendukung nomor yang sudah dipakai di aplikasi WhatsApp Business di HP (coexistence).
 *
 * Alurnya:
 *  1. Dashboard  POST {action:"config", brand_id}                      -> { app_id, config_id, version, extras }
 *  2. Dashboard  buka popup Facebook (FB.login) -> dapat `code` + waba_id/phone_number_id
 *  3. Dashboard  POST {action:"finish", brand_id, code, waba_id, phone_number_id, coexistence}
 *                -> tukar code jadi token bisnis, langganan webhook WABA, simpan ke brand_settings (terenkripsi)
 *     Dashboard  POST {action:"disconnect", brand_id}
 *
 * Auth : header "Authorization: Bearer <Supabase access token>", hanya OWNER brand.
 * Env  : META_APP_ID, META_APP_SECRET, WA_ES_CONFIG_ID (Configuration ID dari Facebook Login for Business),
 *        SECRETS_KEY, WA_API_VERSION (opsional, default v25.0),
 *        WA_ES_FEATURE (opsional, default "whatsapp_business_app_onboarding"; isi "none" untuk alur biasa)
 */
const { authBrand, encrypt, decrypt, loadSettings, saveSettings } = require('./_lib/brand');

const VERSION = process.env.WA_API_VERSION || 'v25.0';
const G = (path) => `https://graph.facebook.com/${VERSION}/${path}`;

function metaApp() {
  const id = String(process.env.META_APP_ID || '').trim();
  const secret = String(process.env.META_APP_SECRET || '').trim();
  const config = String(process.env.WA_ES_CONFIG_ID || '').trim();
  if (!id || !secret || !config) {
    const e = new Error('META_APP_ID / META_APP_SECRET / WA_ES_CONFIG_ID belum diisi di Vercel, lalu redeploy.');
    e.status = 500; throw e;
  }
  return { id, secret, config };
}

async function gget(path, token) {
  const r = await fetch(G(path), { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });
  const action = String(body.action || '');

  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });

    if (action === 'config') {
      const m = metaApp();
      const feature = process.env.WA_ES_FEATURE === undefined ? 'whatsapp_business_app_onboarding' : String(process.env.WA_ES_FEATURE);
      const extras = { setup: {} };
      if (feature && feature !== 'none') extras.featureType = feature;
      return res.status(200).json({ app_id: m.id, config_id: m.config, version: VERSION, extras });
    }

    if (a.role !== 'owner') return res.status(403).json({ error: 'Hanya owner brand yang bisa menghubungkan WhatsApp.' });

    if (action === 'finish') {
      const m = metaApp();
      const code = String(body.code || '');
      if (!code) return res.status(400).json({ error: 'Kode dari Facebook kosong. Ulangi klik "Hubungkan WhatsApp".' });

      // 1) Tukar code (berlaku ±30 detik) jadi token bisnis
      const tr = await fetch(G('oauth/access_token') + '?' + new URLSearchParams({ client_id: m.id, client_secret: m.secret, code }));
      const tok = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.access_token) {
        const msg = (tok.error && tok.error.message) || ('HTTP ' + tr.status);
        return res.status(400).json({ error: 'Gagal menukar kode Facebook (kode berlaku 30 detik — ulangi). ' + msg });
      }
      const token = tok.access_token;

      // 2) Cari WABA & nomor kalau tidak dikirim popup
      let wabaId = String(body.waba_id || '').trim();
      let phoneId = String(body.phone_number_id || '').trim();
      if (!wabaId) {
        try {
          const dbg = await fetch(G('debug_token') + '?' + new URLSearchParams({ input_token: token, access_token: `${m.id}|${m.secret}` })).then((r) => r.json());
          const gs = ((dbg.data && dbg.data.granular_scopes) || []).find((s) => s.scope === 'whatsapp_business_management');
          wabaId = gs && gs.target_ids && gs.target_ids[0] ? String(gs.target_ids[0]) : '';
        } catch (e) {}
      }
      if (!wabaId) return res.status(400).json({ error: 'Akun WhatsApp Business tidak ditemukan dari Facebook. Ulangi dan pastikan memilih akun & nomor.' });
      let display = '';
      try {
        const pn = await gget(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
        const list = pn.data || [];
        const hit = phoneId ? list.find((p) => p.id === phoneId) : list[0];
        if (hit) { phoneId = hit.id; display = (hit.display_phone_number || '') + (hit.verified_name ? ' (' + hit.verified_name + ')' : ''); }
      } catch (e) {}
      if (!phoneId) return res.status(400).json({ error: 'Nomor WhatsApp tidak ditemukan di akun yang dipilih.' });

      // 3) Hubungkan app ke WABA (supaya webhook & pengiriman aktif)
      try {
        await fetch(G(`${wabaId}/subscribed_apps`), { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) { /* tidak fatal untuk kirim pesan */ }

      // Catatan: nomor coexistence (aplikasi WA Business di HP) TIDAK boleh di-/register.
      await saveSettings(a.token, a.brandId, {
        wa_phone_number_id: phoneId,
        wa_token_enc: encrypt(token),
        wa_api_version: null,
        wa_waba_id: wabaId,
        wa_display_phone: display || null,
        wa_coexistence: !!body.coexistence,
        wa_connected_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, phone_number_id: phoneId, waba_id: wabaId, display, coexistence: !!body.coexistence });
    }

    if (action === 'disconnect') {
      const cfg = await loadSettings(a.token, a.brandId);
      if (cfg && cfg.wa_waba_id && cfg.wa_token_enc) {
        try { await fetch(G(`${cfg.wa_waba_id}/subscribed_apps`), { method: 'DELETE', headers: { Authorization: `Bearer ${decrypt(cfg.wa_token_enc)}` } }); } catch (e) {}
      }
      await saveSettings(a.token, a.brandId, {
        wa_phone_number_id: null, wa_token_enc: null, wa_api_version: null,
        wa_waba_id: null, wa_display_phone: null, wa_coexistence: null, wa_connected_at: null,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[wa-connect]', e);
    let msg = String((e && e.message) || e);
    if (/wa_waba_id|wa_display_phone|wa_coexistence|wa_connected_at/.test(msg)) msg = 'Kolom WhatsApp baru belum ada — jalankan supabase-wa-connect.sql di Supabase.';
    return res.status((e && e.status) || 500).json({ error: msg.slice(0, 300) });
  }
};
