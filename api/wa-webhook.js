/**
 * Vercel Serverless Function — Webhook WhatsApp (Meta).
 * Isi di Meta → WhatsApp → Configuration / Production setup → Configure Webhooks:
 *   Callback URL : https://<domain-dashboard>/api/wa-webhook
 *   Verify token : sama dengan env WA_WEBHOOK_VERIFY_TOKEN
 *
 * Saat ini webhook hanya mengonfirmasi (verifikasi + balas 200) supaya Meta tidak menganggap endpoint mati.
 * Isi pesan masuk belum disimpan ke dashboard — itu fitur lanjutan.
 *
 * Env: WA_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET (untuk cek tanda tangan)
 */
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const q = req.query || {};
    const expected = String(process.env.WA_WEBHOOK_VERIFY_TOKEN || '');
    if (q['hub.mode'] === 'subscribe' && expected && q['hub.verify_token'] === expected) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(q['hub.challenge'] || ''));
    }
    return res.status(403).send('Verify token salah');
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }

  // Cek tanda tangan Meta (kalau META_APP_SECRET diisi)
  const secret = process.env.META_APP_SECRET;
  const sig = String(req.headers['x-hub-signature-256'] || '');
  if (secret && sig) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const good = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) {
      console.warn('[wa-webhook] tanda tangan tidak cocok (bisa karena body sudah di-parse ulang)');
    }
  }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const fields = [];
    (b.entry || []).forEach((en) => (en.changes || []).forEach((c) => fields.push(c.field)));
    console.log('[wa-webhook]', fields.join(',') || 'event');
  } catch (e) {}
  return res.status(200).json({ ok: true });
};
