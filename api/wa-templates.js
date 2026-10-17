/**
 * Vercel Serverless Function — kelola template WhatsApp milik brand langsung dari dashboard.
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" (member brand).
 * Body :
 *   { brand_id }                          -> template APPROVED saja (dipakai Broadcast)
 *   { brand_id, action: 'all' }           -> SEMUA template + status Meta (Approved / In review / Rejected + alasannya)
 *   { brand_id, action: 'create', template: { name, category, language, header, body, footer, examples: [], buttons: [{type,text,url,phone}] } }
 *   { brand_id, action: 'delete', name }  -> hapus template (semua bahasa dengan nama itu)
 * Butuh WABA ID brand (Profile → WhatsApp → Cara manual) dan token dengan izin whatsapp_business_management.
 */
const { authBrand, getWaConfig, loadSettings } = require('./_lib/brand');

const STATUS_LABEL = {
  APPROVED: 'Approved', PENDING: 'Sedang direview', REJECTED: 'Ditolak', PAUSED: 'Di-pause',
  DISABLED: 'Dinonaktifkan', IN_APPEAL: 'Banding', PENDING_DELETION: 'Sedang dihapus', DELETED: 'Dihapus',
  LIMIT_EXCEEDED: 'Batas terlampaui', ARCHIVED: 'Diarsipkan',
};
const REJECT_LABEL = {
  ABUSIVE_CONTENT: 'Isi dianggap melanggar / kasar',
  INVALID_FORMAT: 'Format tidak valid (cek variabel {{1}}, contoh isi, panjang teks)',
  PROMOTIONAL: 'Isinya promosi — pilih kategori Marketing',
  TAG_CONTENT_MISMATCH: 'Kategori tidak cocok dengan isi pesan',
  SCAM: 'Dianggap penipuan / mencurigakan',
  INCORRECT_CATEGORY: 'Kategori salah',
  NONE: '',
};

function simplify(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === 'BODY') || {};
  const header = comps.find((c) => c.type === 'HEADER') || null;
  const footer = comps.find((c) => c.type === 'FOOTER') || null;
  const btnComp = comps.find((c) => c.type === 'BUTTONS') || {};
  const buttons = (btnComp.buttons || []).map((b) => ({ type: b.type, text: b.text, url: b.url || null, phone: b.phone_number || null }));
  const nums = (String(body.text || '').match(/\{\{(\d+)\}\}/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
  const params = nums.length ? Math.max.apply(null, nums) : 0;
  let supported = true, reason = '';
  if (/\{\{\s*[a-z_]/i.test(String(body.text || ''))) { supported = false; reason = 'Template memakai variabel bernama ({{nama}}), belum didukung — pakai {{1}}, {{2}}.'; }
  if (header && header.format && header.format !== 'TEXT') { supported = false; reason = 'Header ' + header.format.toLowerCase() + ' belum didukung dashboard.'; }
  if (header && header.format === 'TEXT' && /\{\{\d+\}\}/.test(header.text || '')) { supported = false; reason = 'Header dengan variabel belum didukung.'; }
  if (buttons.some((b) => b.url && /\{\{\d+\}\}/.test(b.url))) { supported = false; reason = 'Tombol link dinamis belum didukung.'; }
  if (t.name === 'hello_world') { supported = false; reason = 'Template contoh Meta — hanya bisa dikirim dari nomor test.'; }
  const rej = t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : '';
  return {
    id: t.id, name: t.name, language: t.language, category: t.category, status: t.status,
    status_label: STATUS_LABEL[t.status] || t.status,
    rejected_reason: rej, rejected_label: rej ? (REJECT_LABEL[rej] || rej) : '',
    quality: t.quality_score && t.quality_score.score ? t.quality_score.score : null,
    sample: /^hello_world$/.test(t.name),
    body: body.text || '', header: header && header.format === 'TEXT' ? header.text : null, footer: footer ? footer.text : null,
    buttons, params, supported, reason,
  };
}

function bad(res, msg) { return res.status(400).json({ error: msg }); }

/** Validasi + susun payload Meta. Return { error } atau { payload }. */
function buildTemplate(t) {
  t = t || {};
  const name = String(t.name || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) return { error: 'Nama template hanya boleh huruf kecil, angka, dan garis bawah (contoh: promo_gipsy_ai).' };
  const category = String(t.category || 'MARKETING').toUpperCase();
  if (['MARKETING', 'UTILITY'].indexOf(category) < 0) return { error: 'Kategori harus Marketing atau Utility.' };
  const language = String(t.language || 'id').trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return { error: 'Kode bahasa tidak valid (contoh: id, en_US).' };

  const body = String(t.body || '').trim();
  if (!body) return { error: 'Isi pesan (body) wajib diisi.' };
  if (body.length > 1024) return { error: 'Isi pesan maksimal 1024 karakter.' };
  if (/\{\{\s*[^\d\s}]/.test(body)) return { error: 'Variabel harus berupa angka: {{1}}, {{2}}, dst.' };
  const nums = (body.match(/\{\{(\d+)\}\}/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
  const max = nums.length ? Math.max.apply(null, nums) : 0;
  for (let i = 1; i <= max; i++) if (nums.indexOf(i) < 0) return { error: 'Variabel harus berurutan mulai {{1}} (tidak boleh loncat ke {{' + max + '}}).' };
  if (/^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}[\s.!?]*$/.test(body)) return { error: 'Meta menolak pesan yang diawali atau diakhiri variabel. Tambahkan teks sebelum/sesudah {{…}}.' };
  const examples = (Array.isArray(t.examples) ? t.examples : []).map((x) => String(x || '').trim());
  for (let i = 0; i < max; i++) if (!examples[i]) return { error: 'Isi contoh untuk {{' + (i + 1) + '}} (wajib untuk review Meta).' };

  const components = [];
  const header = String(t.header || '').trim();
  if (header) {
    if (header.length > 60) return { error: 'Header maksimal 60 karakter.' };
    if (/\{\{/.test(header)) return { error: 'Header tidak boleh berisi variabel.' };
    components.push({ type: 'HEADER', format: 'TEXT', text: header });
  }
  const bodyComp = { type: 'BODY', text: body };
  if (max) bodyComp.example = { body_text: [examples.slice(0, max)] };
  components.push(bodyComp);
  const footer = String(t.footer || '').trim();
  if (footer) {
    if (footer.length > 60) return { error: 'Footer maksimal 60 karakter.' };
    components.push({ type: 'FOOTER', text: footer });
  }

  const btns = [];
  for (const b of (Array.isArray(t.buttons) ? t.buttons : [])) {
    const text = String(b.text || '').trim();
    if (!text) continue;
    if (text.length > 25) return { error: 'Teks tombol "' + text + '" maksimal 25 karakter.' };
    if (b.type === 'URL') {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return { error: 'Link tombol "' + text + '" harus diawali https://' };
      if (/\{\{/.test(url)) return { error: 'Link dinamis belum didukung — pakai link tetap.' };
      btns.push({ type: 'URL', text, url });
    } else if (b.type === 'PHONE_NUMBER') {
      let ph = String(b.phone || '').replace(/[^\d+]/g, '');
      if (/^0/.test(ph)) ph = '+62' + ph.slice(1);
      if (!/^\+?\d{8,15}$/.test(ph)) return { error: 'Nomor telepon tombol "' + text + '" tidak valid.' };
      btns.push({ type: 'PHONE_NUMBER', text, phone_number: ph.startsWith('+') ? ph : '+' + ph });
    } else btns.push({ type: 'QUICK_REPLY', text });
  }
  if (btns.length > 10) return { error: 'Maksimal 10 tombol.' };
  if (btns.filter((b) => b.type === 'URL').length > 2) return { error: 'Maksimal 2 tombol link.' };
  if (btns.filter((b) => b.type === 'PHONE_NUMBER').length > 1) return { error: 'Maksimal 1 tombol telepon.' };
  // Meta mewajibkan tombol sejenis dikelompokkan: semua "balas cepat" dulu, lalu link/telepon
  btns.sort((x, y) => (x.type === 'QUICK_REPLY' ? 0 : 1) - (y.type === 'QUICK_REPLY' ? 0 : 1));
  if (btns.length) components.push({ type: 'BUTTONS', buttons: btns });

  return { payload: { name, language, category, components } };
}

async function graph(wc, url, opts) {
  const r = await fetch(url, Object.assign({}, opts || {}, { headers: Object.assign({ Authorization: `Bearer ${wc.token}` }, (opts && opts.headers) || {}) }));
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
function metaErr(j, status) {
  const e = (j && j.error) || {};
  let msg = e.error_user_msg || e.message || ('HTTP ' + status);
  if (e.error_user_title) msg = e.error_user_title + ' — ' + msg;
  if (e.code === 100 && /name/i.test(msg) && /exist/i.test(msg)) msg = 'Nama template sudah dipakai. Ganti nama lain.';
  if (e.code === 190) msg = 'Token WhatsApp tidak valid / kadaluarsa — perbarui di Profile → WhatsApp.';
  if (e.code === 200 || e.code === 10) msg = 'Token tidak punya izin whatsapp_business_management. Generate ulang token System User dengan izin itu.';
  return 'Meta: ' + msg;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return bad(res, 'Body tidak valid');
  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });
    const wc = await getWaConfig(a.token, a.brandId);
    if (!wc) return bad(res, 'WhatsApp brand ini belum dihubungkan (Profile → WhatsApp).');
    const cfg = await loadSettings(a.token, a.brandId);
    const waba = cfg && cfg.wa_waba_id;
    if (!waba) return bad(res, 'WABA ID belum diisi. Buka Profile → WhatsApp → Cara manual, isi "WhatsApp Business Account ID".');
    const base = `https://graph.facebook.com/${wc.version}/${encodeURIComponent(waba)}/message_templates`;
    const action = body.action || 'approved';

    if (action === 'create') {
      const built = buildTemplate(body.template);
      if (built.error) return bad(res, built.error);
      const r = await graph(wc, base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(built.payload) });
      if (!r.ok) return bad(res, metaErr(r.j, r.status));
      return res.status(200).json({ ok: true, id: r.j.id, status: r.j.status || 'PENDING', category: r.j.category || built.payload.category, name: built.payload.name });
    }

    if (action === 'delete') {
      const name = String(body.name || '').trim();
      if (!/^[a-z0-9_]{1,512}$/.test(name)) return bad(res, 'Nama template tidak valid');
      if (name === 'hello_world') return bad(res, 'Template contoh Meta (hello_world) tidak bisa dihapus.');
      const r = await graph(wc, base + '?name=' + encodeURIComponent(name), { method: 'DELETE' });
      if (!r.ok) return bad(res, metaErr(r.j, r.status));
      return res.status(200).json({ ok: true });
    }

    // list
    let all = [];
    let url = base + '?fields=id,name,language,category,status,components,rejected_reason,quality_score&limit=100';
    for (let i = 0; i < 5 && url; i++) {
      const r = await graph(wc, url);
      if (!r.ok) {
        const m = metaErr(r.j, r.status);
        return bad(res, m + (r.j.error && r.j.error.code === 100 ? ' (cek WABA ID benar & token punya akses ke akun itu)' : ''));
      }
      all = all.concat(r.j.data || []);
      url = r.j.paging && r.j.paging.next ? r.j.paging.next : null;
    }
    let list = all.map(simplify);
    if (action !== 'all') list = list.filter((t) => t.status === 'APPROVED');
    list.sort((x, y) => (action === 'all' ? 0 : (y.supported - x.supported)) || x.name.localeCompare(y.name));
    return res.status(200).json({ templates: list });
  } catch (e) {
    console.error('[wa-templates]', e);
    return res.status((e && e.status) || 500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
