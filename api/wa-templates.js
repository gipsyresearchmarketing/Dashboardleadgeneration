/**
 * Vercel Serverless Function — daftar template WhatsApp yang sudah APPROVED milik brand.
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" (member brand).
 * Body : { brand_id }
 * Butuh WhatsApp Business Account ID (WABA ID) brand: otomatis dari "Hubungkan WhatsApp",
 * atau diisi manual di Profile → WhatsApp → Cara manual.
 * Return: { templates: [{ name, language, category, body, header, footer, buttons, params, supported, reason }] }
 */
const { authBrand, getWaConfig, loadSettings } = require('./_lib/brand');

function simplify(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY') || {};
  const header = comps.find((c) => c.type === 'HEADER') || null;
  const footer = comps.find((c) => c.type === 'FOOTER') || null;
  const btnComp = comps.find((c) => c.type === 'BUTTONS') || {};
  const buttons = (btnComp.buttons || []).map((b) => ({ type: b.type, text: b.text, url: b.url || null }));
  const nums = (String(body.text || '').match(/\{\{(\d+)\}\}/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
  const params = nums.length ? Math.max.apply(null, nums) : 0;
  let supported = true, reason = '';
  if (/\{\{\s*[a-z_]/i.test(String(body.text || ''))) { supported = false; reason = 'Template memakai variabel bernama ({{nama}}), belum didukung — pakai {{1}}, {{2}}.'; }
  if (header && header.format && header.format !== 'TEXT') { supported = false; reason = 'Header ' + header.format.toLowerCase() + ' belum didukung dashboard.'; }
  if (header && header.format === 'TEXT' && /\{\{\d+\}\}/.test(header.text || '')) { supported = false; reason = 'Header dengan variabel belum didukung.'; }
  if (buttons.some((b) => b.url && /\{\{\d+\}\}/.test(b.url))) { supported = false; reason = 'Tombol link dinamis belum didukung.'; }
  return {
    name: t.name, language: t.language, category: t.category, status: t.status,
    body: body.text || '', header: header && header.format === 'TEXT' ? header.text : null, footer: footer ? footer.text : null,
    buttons, params, supported, reason,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });
  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });
    const wc = await getWaConfig(a.token, a.brandId);
    if (!wc) return res.status(400).json({ error: 'WhatsApp brand ini belum dihubungkan (Profile → WhatsApp).' });
    const cfg = await loadSettings(a.token, a.brandId);
    const waba = cfg && cfg.wa_waba_id;
    if (!waba) return res.status(400).json({ error: 'WABA ID belum diisi. Buka Profile → WhatsApp → Cara manual, isi "WhatsApp Business Account ID".' });
    let all = [];
    let url = `https://graph.facebook.com/${wc.version}/${encodeURIComponent(waba)}/message_templates?fields=name,language,category,status,components&limit=100`;
    for (let i = 0; i < 5 && url; i++) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${wc.token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
        return res.status(400).json({ error: 'Meta menolak: ' + msg + (j.error && j.error.code === 100 ? ' (cek WABA ID benar & token punya akses ke akun itu)' : '') });
      }
      all = all.concat(j.data || []);
      url = j.paging && j.paging.next ? j.paging.next : null;
    }
    const templates = all.filter((t) => t.status === 'APPROVED').map(simplify)
      .sort((x, y) => (y.supported - x.supported) || x.name.localeCompare(y.name));
    return res.status(200).json({ templates });
  } catch (e) {
    console.error('[wa-templates]', e);
    return res.status((e && e.status) || 500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
