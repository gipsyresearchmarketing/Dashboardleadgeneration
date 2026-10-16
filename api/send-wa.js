/**
 * Vercel Serverless Function — kirim WhatsApp blast lewat WhatsApp Cloud API (Meta, resmi).
 *
 * Auth   : header "Authorization: Bearer <Supabase access token>" (user harus login & member brand).
 * Env    : WA_ACCESS_TOKEN       (permanent token dari System User di Meta Business)
 *          WA_PHONE_NUMBER_ID    (Phone number ID dari WhatsApp > API Setup)
 *          WA_API_VERSION        (opsional, default v25.0)
 * Mode   : "template" -> pesan template yang sudah di-approve Meta (wajib untuk kontak yang belum chat dalam 24 jam)
 *          "text"     -> teks bebas (HANYA bisa untuk kontak yang membalas/chat ke nomor kamu dalam 24 jam terakhir)
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_JTxgxH__IgjcJhGkncaIkQ_erJNnZDG';
const MAX_RECIPIENTS = 100;

/** 0812-345 / +62 812 / 62812 -> 62812345... (khusus Indonesia kalau diawali 0 atau 8). */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^\d{9,15}$/.test(d) ? d : '';
}

async function verifyUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

async function isBrandMember(token, brandId, userId) {
  const url = `${SUPABASE_URL}/rest/v1/brand_members?select=brand_id&brand_id=eq.${encodeURIComponent(brandId)}&user_id=eq.${encodeURIComponent(userId)}`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

/** Terjemahkan error Meta ke pesan yang bisa dimengerti. */
function friendlyError(err) {
  const code = err && err.code;
  const msg = String((err && (err.error_data && err.error_data.details || err.message)) || 'Error tidak diketahui');
  const map = {
    190: 'Access token kadaluarsa/tidak valid — buat token baru lalu update WA_ACCESS_TOKEN di Vercel.',
    131030: 'Nomor penerima belum terdaftar di daftar penerima uji (nomor test Meta hanya bisa kirim ke nomor yang sudah ditambahkan).',
    131047: 'Di luar jendela 24 jam — kontak ini belum chat dalam 24 jam terakhir, gunakan mode Template.',
    131026: 'Pesan tidak bisa dikirim ke nomor ini (tidak punya WhatsApp / belum menerima undangan / nomor salah).',
    131049: 'Meta membatasi pengiriman ke nomor ini (kualitas/frekuensi pesan marketing).',
    131056: 'Terlalu banyak pesan ke nomor yang sama dalam waktu singkat, coba lagi nanti.',
    132000: 'Jumlah variabel tidak sama dengan template ({{1}}, {{2}}, ...).',
    132001: 'Template tidak ditemukan — cek nama template & kode bahasa (harus persis sama dengan di Meta, dan statusnya Approved).',
    132005: 'Hasil terjemahan template terlalu panjang.',
    132007: 'Isi template melanggar kebijakan WhatsApp.',
    132012: 'Format variabel tidak cocok dengan template.',
    132015: 'Template di-pause karena kualitas rendah.',
    132016: 'Template dinonaktifkan karena kualitas rendah.',
    133010: 'Nomor pengirim belum terdaftar/aktif di WhatsApp Cloud API.',
  };
  return (map[code] ? map[code] + ' ' : '') + `(${code || 'err'}) ${msg}`.slice(0, 260);
}

async function sendOne(ctx, r) {
  const to = normalizePhone(r && r.phone);
  if (!to) return { lead_id: r && r.lead_id, phone: String((r && r.phone) || ''), ok: false, error: 'Nomor tidak valid' };
  const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (ctx.mode === 'template') {
    const params = (Array.isArray(r.params) ? r.params : []).map((p) => String(p == null ? '' : p).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 1000) || '-');
    payload.type = 'template';
    payload.template = { name: ctx.template.name, language: { code: ctx.template.language } };
    if (params.length) payload.template.components = [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t })) }];
  } else {
    payload.type = 'text';
    payload.text = { preview_url: true, body: String(r.text || ctx.text).slice(0, 4096) };
  }
  try {
    const resp = await fetch(`https://graph.facebook.com/${ctx.version}/${ctx.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (resp.ok && data && data.messages && data.messages[0]) {
      return { lead_id: r.lead_id, phone: to, ok: true, wa_message_id: data.messages[0].id };
    }
    return { lead_id: r.lead_id, phone: to, ok: false, error: friendlyError(data && data.error ? data.error : { message: `HTTP ${resp.status}` }) };
  } catch (e) {
    return { lead_id: r.lead_id, phone: to, ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Belum login' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });

  try {
    const user = await verifyUser(token);
    if (!user) return res.status(401).json({ error: 'Session tidak valid, coba login ulang' });
    const brandId = String(body.brand_id || '');
    if (!brandId || !(await isBrandMember(token, brandId, user.id))) return res.status(403).json({ error: 'Kamu bukan member brand ini' });

    const waToken = process.env.WA_ACCESS_TOKEN;
    const phoneId = process.env.WA_PHONE_NUMBER_ID;
    if (!waToken || !phoneId) return res.status(500).json({ error: 'WhatsApp belum dikonfigurasi di Vercel (isi WA_ACCESS_TOKEN dan WA_PHONE_NUMBER_ID)' });

    const mode = body.mode === 'text' ? 'text' : 'template';
    const ctx = { mode, token: waToken, phoneId, version: process.env.WA_API_VERSION || 'v25.0', template: null, text: '' };
    if (mode === 'template') {
      const name = String((body.template && body.template.name) || '').trim();
      const language = String((body.template && body.template.language) || 'id').trim();
      if (!/^[a-z0-9_]{1,512}$/.test(name)) return res.status(400).json({ error: 'Nama template tidak valid (huruf kecil, angka, underscore)' });
      if (!/^[a-z]{2,3}(_[A-Za-z]{2})?$/.test(language)) return res.status(400).json({ error: 'Kode bahasa template tidak valid (contoh: id, en, en_US)' });
      ctx.template = { name, language };
    } else {
      ctx.text = String(body.text || '').trim();
      if (!ctx.text) return res.status(400).json({ error: 'Isi pesan kosong' });
    }

    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!recipients.length) return res.status(400).json({ error: 'Tidak ada penerima' });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Maksimal ${MAX_RECIPIENTS} penerima per request` });

    const results = [];
    for (let i = 0; i < recipients.length; i += 5) {
      const out = await Promise.all(recipients.slice(i, i + 5).map((r) => sendOne(ctx, r || {})));
      results.push(...out);
    }
    return res.status(200).json({ results });
  } catch (e) {
    console.error('[send-wa]', e);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.normalizePhone = normalizePhone;
