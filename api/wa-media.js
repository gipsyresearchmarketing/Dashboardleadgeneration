/**
 * Vercel Serverless Function — media WhatsApp (gambar / dokumen / video / audio).
 *
 * Auth : header "Authorization: Bearer <Supabase access token>" (member brand).
 * Body (JSON):
 *   { brand_id, action: 'upload', filename, mime, data }        -> unggah file (base64) ke WhatsApp, return { id, type }
 *                                                                 id dipakai untuk kirim di chat / broadcast (berlaku ±30 hari)
 *   { brand_id, action: 'get', media_id }                       -> unduh media (pesan masuk/keluar) -> isi file (binary)
 *   { brand_id, action: 'header-handle', filename, mime, data } -> unggah contoh header untuk MEMBUAT template ber-header gambar
 * Batas ukuran file lewat dashboard: ±3 MB (batas request Vercel 4.5 MB).
 */
const { authBrand, getWaConfig } = require('./_lib/brand');

const MAX_BYTES = 3.2 * 1024 * 1024;
const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/amr'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv'],
};
function typeOf(mime) { for (const k of Object.keys(ALLOWED)) if (ALLOWED[k].indexOf(mime) >= 0) return k; return null; }
function bad(res, msg, code) { return res.status(code || 400).json({ error: msg }); }

function decodeFile(body) {
  const mime = String(body.mime || '').toLowerCase().split(';')[0].trim();
  const type = typeOf(mime);
  if (!type) return { error: 'Format file tidak didukung WhatsApp (' + (mime || 'tidak diketahui') + '). Pakai JPG/PNG, PDF/Word/Excel, MP4, atau MP3.' };
  let b64 = String(body.data || '');
  const comma = b64.indexOf(','); if (b64.startsWith('data:') && comma > 0) b64 = b64.slice(comma + 1);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'File kosong' };
  if (buf.length > MAX_BYTES) return { error: 'File terlalu besar (maks ±3 MB lewat dashboard). Kecilkan dulu, atau kirim lewat link.' };
  if (type === 'image' && buf.length > 5 * 1024 * 1024) return { error: 'Gambar maksimal 5 MB' };
  const filename = String(body.filename || ('file.' + (mime.split('/')[1] || 'bin'))).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return { buf, mime, type, filename };
}
async function metaJson(r) { try { return await r.json(); } catch (e) { return {}; } }
function metaMsg(j, status) { const e = (j && j.error) || {}; return 'Meta: ' + (e.error_user_msg || e.message || ('HTTP ' + status)); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return bad(res, 'Method not allowed', 405); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return bad(res, 'Body tidak valid (file mungkin terlalu besar)');
  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return bad(res, a.error, a.status);
    const wc = await getWaConfig(a.token, a.brandId);
    if (!wc) return bad(res, 'WhatsApp brand ini belum dihubungkan (Profile → WhatsApp).');
    const G = `https://graph.facebook.com/${wc.version}`;

    if (body.action === 'upload') {
      const f = decodeFile(body); if (f.error) return bad(res, f.error);
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('type', f.mime);
      fd.append('file', new Blob([f.buf], { type: f.mime }), f.filename);
      const r = await fetch(`${G}/${wc.phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${wc.token}` }, body: fd });
      const j = await metaJson(r);
      if (!r.ok || !j.id) return bad(res, metaMsg(j, r.status));
      return res.status(200).json({ id: j.id, type: f.type, mime: f.mime, filename: f.filename, size: f.buf.length });
    }

    if (body.action === 'get') {
      const id = String(body.media_id || '');
      if (!/^\d{5,30}$/.test(id)) return bad(res, 'ID media tidak valid');
      const r1 = await fetch(`${G}/${id}`, { headers: { Authorization: `Bearer ${wc.token}` } });
      const j1 = await metaJson(r1);
      if (!r1.ok || !j1.url) return bad(res, r1.status === 404 || (j1.error && j1.error.code === 100) ? 'Media sudah kedaluwarsa di WhatsApp (disimpan Meta ±30 hari).' : metaMsg(j1, r1.status));
      if (j1.file_size && j1.file_size > 4.2 * 1024 * 1024) return bad(res, 'File terlalu besar untuk ditampilkan di dashboard (' + Math.round(j1.file_size / 1048576) + ' MB). Buka di aplikasi WhatsApp Business.');
      const r2 = await fetch(j1.url, { headers: { Authorization: `Bearer ${wc.token}` } });
      if (!r2.ok) return bad(res, 'Gagal mengunduh media (' + r2.status + ')');
      const buf = Buffer.from(await r2.arrayBuffer());
      res.setHeader('Content-Type', j1.mime_type || r2.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).send(buf);
    }

    if (body.action === 'header-handle') {
      const f = decodeFile(body); if (f.error) return bad(res, f.error);
      // App ID diambil dari token (token System User terikat ke satu app)
      const ra = await fetch(`${G}/app`, { headers: { Authorization: `Bearer ${wc.token}` } });
      const ja = await metaJson(ra);
      const appId = (ja && ja.id) || process.env.META_APP_ID;
      if (!appId) return bad(res, 'Tidak bisa membaca App ID dari token. Isi env META_APP_ID di Vercel.');
      const q = new URLSearchParams({ file_name: f.filename, file_length: String(f.buf.length), file_type: f.mime });
      const r1 = await fetch(`${G}/${appId}/uploads?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${wc.token}` } });
      const j1 = await metaJson(r1);
      if (!r1.ok || !j1.id) return bad(res, metaMsg(j1, r1.status));
      const r2 = await fetch(`${G}/${j1.id}`, { method: 'POST', headers: { Authorization: `OAuth ${wc.token}`, file_offset: '0' }, body: f.buf });
      const j2 = await metaJson(r2);
      if (!r2.ok || !j2.h) return bad(res, metaMsg(j2, r2.status));
      return res.status(200).json({ handle: j2.h, type: f.type });
    }

    return bad(res, 'Aksi tidak dikenal');
  } catch (e) {
    console.error('[wa-media]', e);
    return bad(res, String((e && e.message) || e).slice(0, 300), (e && e.status) || 500);
  }
};

