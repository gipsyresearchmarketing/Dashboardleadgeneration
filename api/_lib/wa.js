/**
 * Helper WhatsApp bersama (file berawalan "_" tidak dijadikan endpoint oleh Vercel).
 * - normalisasi nomor, terjemahan error Meta
 * - susun & kirim pesan: teks, template (termasuk header gambar/dokumen/video), media (gambar/dokumen/video/audio)
 * - akses Supabase pakai kunci server (service role / sb_secret_) untuk webhook & jadwal
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY (kunci server, JANGAN dipakai di browser), SUPABASE_URL (opsional), SECRETS_KEY
 */
const { decrypt, SUPABASE_URL } = require('./brand');

/** 0812-345 / +62 812 / 62812 -> 62812345... (khusus Indonesia kalau diawali 0 atau 8). */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^\d{9,15}$/.test(d) ? d : '';
}

/** Terjemahkan error Meta ke pesan yang bisa dimengerti. */
function friendlyError(err) {
  const code = err && err.code;
  const msg = String((err && (err.error_data && err.error_data.details || err.message)) || 'Error tidak diketahui');
  const map = {
    190: 'Access token kadaluarsa/tidak valid — buat token baru (System User) lalu tempel di Profile → WhatsApp → Cara manual.',
    131030: 'Nomor penerima belum terdaftar di daftar penerima uji (nomor test Meta hanya bisa kirim ke nomor yang sudah ditambahkan).',
    131042: 'Masalah pembayaran — tambahkan kartu di Billing Hub (business.facebook.com/billing_hub) untuk akun WhatsApp ini.',
    131047: 'Di luar jendela 24 jam — kontak ini belum chat dalam 24 jam terakhir, gunakan Template.',
    131051: 'Jenis pesan ini tidak didukung.',
    131052: 'Media tidak bisa diunduh dari WhatsApp.',
    131053: 'Media gagal diunggah / formatnya tidak didukung WhatsApp.',
    131026: 'Pesan tidak bisa dikirim ke nomor ini (tidak punya WhatsApp / nomor salah).',
    131049: 'Meta membatasi pengiriman ke nomor ini (kualitas/frekuensi pesan marketing).',
    131056: 'Terlalu banyak pesan ke nomor yang sama dalam waktu singkat, coba lagi nanti.',
    132000: 'Jumlah variabel tidak sama dengan template ({{1}}, {{2}}, ...).',
    132001: 'Template tidak ditemukan / tidak boleh dipakai nomor ini (hello_world hanya untuk nomor test Meta) — cek nama template & bahasa, dan statusnya Approved.',
    132005: 'Hasil terjemahan template terlalu panjang.',
    132007: 'Isi template melanggar kebijakan WhatsApp.',
    132012: 'Format variabel / header tidak cocok dengan template (template dengan header gambar wajib diberi gambar).',
    132015: 'Template di-pause karena kualitas rendah.',
    132016: 'Template dinonaktifkan karena kualitas rendah.',
    133010: 'Nomor pengirim belum terdaftar/aktif di WhatsApp Cloud API.',
  };
  return (map[code] ? map[code] + ' ' : '') + `(${code || 'err'}) ${msg}`.slice(0, 260);
}

const MEDIA_TYPES = ['image', 'document', 'video', 'audio'];
/** {type, id|link, filename?} -> objek media untuk API Meta */
function mediaObj(m) {
  const o = {};
  if (m.id) o.id = String(m.id); else if (m.link) o.link = String(m.link);
  if (m.type === 'document' && m.filename) o.filename = String(m.filename).slice(0, 240);
  return o;
}

/** Susun payload Meta untuk satu penerima. ctx = { mode, template, text, media }, r = { phone, params, text, caption } */
function buildPayload(ctx, r, to) {
  const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (ctx.mode === 'template') {
    const params = (Array.isArray(r.params) ? r.params : []).map((p) => String(p == null ? '' : p).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 1000) || '-');
    payload.type = 'template';
    payload.template = { name: ctx.template.name, language: { code: ctx.template.language } };
    const comps = [];
    const h = ctx.template.header;
    if (h && MEDIA_TYPES.indexOf(h.type) >= 0 && (h.id || h.link)) {
      comps.push({ type: 'header', parameters: [{ type: h.type, [h.type]: mediaObj(h) }] });
    }
    if (params.length) comps.push({ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t })) });
    if (comps.length) payload.template.components = comps;
  } else if (ctx.mode === 'media') {
    const m = ctx.media || {};
    payload.type = m.type;
    const obj = mediaObj(m);
    const cap = String(r.caption != null ? r.caption : (m.caption || '')).trim();
    if (cap && m.type !== 'audio') obj.caption = cap.slice(0, 1024);
    payload[m.type] = obj;
  } else {
    payload.type = 'text';
    payload.text = { preview_url: true, body: String(r.text || ctx.text).slice(0, 4096) };
  }
  return payload;
}

/** Kirim satu pesan. ctx juga berisi { token, phoneId, version }. */
async function sendOne(ctx, r) {
  const to = normalizePhone(r && r.phone);
  if (!to) return { lead_id: r && r.lead_id, phone: String((r && r.phone) || ''), ok: false, error: 'Nomor tidak valid' };
  const payload = buildPayload(ctx, r || {}, to);
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

/** Validasi konteks kiriman dari body request. Return { ctx } atau { error }. */
function parseSendBody(body) {
  const mode = ['text', 'template', 'media'].indexOf(body.mode) >= 0 ? body.mode : 'template';
  const ctx = { mode, template: null, text: '', media: null };
  if (mode === 'template') {
    const t = body.template || {};
    const name = String(t.name || '').trim();
    const language = String(t.language || 'id').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return { error: 'Nama template tidak valid (huruf kecil, angka, underscore)' };
    if (!/^[a-z]{2,3}(_[A-Za-z]{2})?$/.test(language)) return { error: 'Kode bahasa template tidak valid (contoh: id, en, en_US)' };
    ctx.template = { name, language, header: null };
    const h = t.header;
    if (h && MEDIA_TYPES.indexOf(h.type) >= 0) {
      if (!h.id && !/^https:\/\/\S+$/i.test(String(h.link || ''))) return { error: 'Template ini butuh gambar/dokumen header: unggah file atau isi link https://' };
      ctx.template.header = { type: h.type, id: h.id || null, link: h.link || null, filename: h.filename || null };
    }
  } else if (mode === 'media') {
    const m = body.media || {};
    if (MEDIA_TYPES.indexOf(m.type) < 0) return { error: 'Jenis media tidak valid' };
    if (!m.id && !/^https:\/\/\S+$/i.test(String(m.link || ''))) return { error: 'Media kosong: unggah file atau isi link https://' };
    ctx.media = { type: m.type, id: m.id || null, link: m.link || null, filename: m.filename || null, caption: String(m.caption || '') };
  } else {
    ctx.text = String(body.text || '').trim();
    if (!ctx.text) return { error: 'Isi pesan kosong' };
  }
  return { ctx };
}

/* ---------- Supabase dengan kunci server (untuk webhook & jadwal) ---------- */
function svcHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel');
  // Kunci baru "sb_secret_..." bukan JWT: cukup di header apikey. Kunci legacy service_role (eyJ...) dipakai di dua header.
  const h = /^sb_secret_/.test(k) ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
  return Object.assign(h, { 'Content-Type': 'application/json' }, extra || {});
}
async function svc(path, opts) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, opts || {}, { headers: svcHeaders((opts && opts.headers) || {}) }));
  let data = null;
  const txt = await r.text();
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data };
}

/** Konfigurasi WA brand dibaca pakai kunci server (tanpa login user). */
async function waConfigSvc(brandId) {
  const r = await svc(`brand_settings?select=wa_phone_number_id,wa_token_enc,wa_api_version,wa_waba_id&brand_id=eq.${encodeURIComponent(brandId)}`);
  const c = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!c || !c.wa_phone_number_id || !c.wa_token_enc) return null;
  return { phoneId: c.wa_phone_number_id, token: decrypt(c.wa_token_enc), version: c.wa_api_version || process.env.WA_API_VERSION || 'v25.0', waba: c.wa_waba_id || null };
}

module.exports = { normalizePhone, friendlyError, buildPayload, sendOne, parseSendBody, svcHeaders, svc, waConfigSvc, MEDIA_TYPES };
