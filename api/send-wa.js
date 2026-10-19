/**
 * Vercel Serverless Function — kirim WhatsApp lewat WhatsApp Cloud API (Meta, resmi).
 *
 * Auth   : header "Authorization: Bearer <Supabase access token>" (user harus login & member brand).
 * Pengirim: Phone Number ID + token WhatsApp MILIK BRAND (tabel brand_settings, token terenkripsi).
 * Env    : SECRETS_KEY (membuka token yang tersimpan), WA_API_VERSION (opsional, default v25.0)
 * Mode   : "template" -> pesan template yang sudah di-approve Meta (wajib untuk kontak yang belum chat dalam 24 jam)
 *                        template.header = { type: 'image'|'document'|'video', id | link } kalau template punya header media
 *          "text"     -> teks bebas (HANYA untuk kontak yang chat ke nomor kamu dalam 24 jam terakhir)
 *          "media"    -> gambar / dokumen / video / audio (aturan 24 jam sama dengan teks). media = { type, id | link, caption, filename }
 */
const { authBrand, getWaConfig } = require('./_lib/brand');
const { sendOne, parseSendBody, normalizePhone } = require('./_lib/wa');
const MAX_RECIPIENTS = 100;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });

  try {
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });

    const wc = await getWaConfig(a.token, a.brandId);
    if (!wc) return res.status(400).json({ error: 'WhatsApp brand ini belum diatur. Buka Profile → WhatsApp, isi Phone Number ID dan Access Token.' });

    const p = parseSendBody(body);
    if (p.error) return res.status(400).json({ error: p.error });
    const ctx = Object.assign(p.ctx, { token: wc.token, phoneId: wc.phoneId, waba: wc.waba, version: wc.version });

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
