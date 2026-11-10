/**
 * Vercel Serverless Function — tracking & statistik email blast.
 *
 * ════════════════════════════════════════════════════════════
 *  PRIVASI: URL publik HANYA berisi token acak + index link.
 *  Email penerima, blast_id, dan URL target TIDAK PERNAH ada di URL.
 *  Semuanya disimpan di database dan dicari server-side pakai token.
 *  Token dibuat acak (crypto/random), mustahil ditebak.
 * ════════════════════════════════════════════════════════════
 *
 * PUBLIC (tanpa auth — email client/robot tidak bisa kirim header Authorization):
 *   GET ?t=<token>&type=open           -> catat event 'open', balas PNG 1x1 (tracking pixel)
 *   GET ?t=<token>&type=click&c=<idx>   -> catat event 'click', redirect 302 ke link tujuan
 *
 * AUTH (Bearer token Supabase + harus member brand):
 *   POST { action:'stats', brand_id, blast_id } -> statistik blast
 *
 * Catatan akurasi:
 *   - click rate akurat (link dibungkus URL tracking -> redirect).
 *   - open rate PERKIRAAN: Gmail/Apple Mail me-preload gambar, jadi satu email
 *     terbuka bisa tercatat beberapa kali. Anggap sebagai indikasi.
 */
const { authBrand } = require('./_lib/brand');
const { svc, svcHeaders } = require('./_lib/wa');

const PIXEL_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

function rid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* Catat 1 event (open / click). Gagal? jangan ganggu email penerima.
   CATATAN: kolom `id` di email_events bertipe UUID — harus uuid, bukan teks. */
async function recordEvent(tr, type, url) {
  try {
    await svc('email_events', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        id: require('crypto').randomUUID(),
        brand_id: tr.brand_id || null,
        blast_id: tr.blast_id || null,
        token: tr.token,
        recipient_email: tr.recipient_email || null,
        type: type,
        url: url || null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('[email-track] gagal catat event:', e && e.message);
  }
}

/* Cari track row berdasarkan token (server-side lookup). */
async function findTrack(token) {
  const r = await svc('email_track?select=*&limit=1&token=eq.' + encodeURIComponent(token));
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  return r.data[0];
}

module.exports = async (req, res) => {
  // ══════════ PUBLIC: tracking pixel / link ══════════
  if (req.method === 'GET') {
    const q = req.query || {};
    const token = String(q.t || '');
    const type = String(q.type || 'open');
    if (!token) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(400).send('Token tracking tidak ada');
    }
    let tr = null;
    try { tr = await findTrack(token); } catch (e) { /* tetap balas supaya email tidak rusak */ }

    if (type === 'click') {
      // URL tujuan diambil dari server (links[]), bukan dari parameter URL.
      const idx = parseInt(String(q.c || ''), 10);
      const links = (tr && Array.isArray(tr.links)) ? tr.links : [];
      const target = (idx >= 0 && idx < links.length) ? String(links[idx] || '') : '';
      if (tr && target) await recordEvent(tr, 'click', target);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(302).redirect(target || 'https://dashboardleadgeneration.vercel.app');
    }

    // open -> balas pixel 1x1
    if (tr) await recordEvent(tr, 'open');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.status(200).end(PIXEL_1x1);
  }

  // ══════════ AUTH: statistik blast ══════════
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });
    if (String(body.action || '') !== 'stats') return res.status(400).json({ error: 'Action tidak dikenal' });

    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });

    const brandId = a.brandId;
    const blastId = String(body.blast_id || '');
    if (!blastId) return res.status(400).json({ error: 'blast_id wajib diisi' });

    try {
      // Ringkasan per penerima
      const tr = await svc(
        'email_track?select=*&order=sent_at&blast_id=eq.' + encodeURIComponent(blastId) +
        '&brand_id=eq.' + encodeURIComponent(brandId)
      );
      const tracks = (tr.ok && Array.isArray(tr.data)) ? tr.data : [];

      const ev = await svc(
        'email_events?select=token,recipient_email,type,url,created_at&blast_id=eq.' + encodeURIComponent(blastId) +
        '&brand_id=eq.' + encodeURIComponent(brandId) + '&order=created_at'
      );
      const events = (ev.ok && Array.isArray(ev.data)) ? ev.data : [];

      // Reply: email masuk dari alamat penerima, setelah blast dikirim
      const rep = await svc(
        'inbound_emails?select=from_email,received_at&brand_id=eq.' + encodeURIComponent(brandId) +
        '&order=received_at&limit=500'
      );
      const inbox = (rep.ok && Array.isArray(rep.data)) ? rep.data : [];

      const byToken = {};
      tracks.forEach((t) => {
        byToken[t.token] = {
          token: t.token,
          email: t.recipient_email || '',
          lead_id: t.lead_id || null,
          sent_at: t.sent_at,
          delivered: !!t.delivered_at,
          bounced: !!t.bounced,
          error: t.error || null,
          opens: 0,
          clicks: 0,
          clickUrls: [],
          replied: false,
        };
      });
      const tokenSet = new Set(tracks.map((t) => t.token));
      events.forEach((e) => {
        if (!tokenSet.has(e.token)) return;
        const row = byToken[e.token];
        if (!row) return;
        if (e.type === 'open') row.opens++;
        else if (e.type === 'click') { row.clicks++; if (e.url) row.clickUrls.push(e.url); }
      });
      // reply: cocokkan from_email + waktu >= sent_at (dalam 30 hari)
      tracks.forEach((t) => {
        const em = String(t.recipient_email || '').toLowerCase();
        if (!em) return;
        const sentMs = new Date(t.sent_at || 0).getTime();
        const hit = inbox.find((i) =>
          String(i.from_email || '').toLowerCase() === em &&
          new Date(i.received_at || 0).getTime() >= sentMs &&
          new Date(i.received_at || 0).getTime() <= sentMs + 30 * 24 * 3600e3
        );
        if (hit) {
          const row = byToken[t.token];
          if (row) row.replied = true;
        }
      });

      const rows = tracks.map((t) => byToken[t.token]);
      const sent = rows.length;
      const delivered = rows.filter((r) => r.delivered).length;
      const bounced = rows.filter((r) => r.bounced).length;
      const opened = rows.filter((r) => r.opens > 0).length;
      const clicked = rows.filter((r) => r.clicks > 0).length;
      const replied = rows.filter((r) => r.replied).length;
      const totalClicks = rows.reduce((n, r) => n + r.clicks, 0);
      const pct = (n) => (sent ? Math.round((n / sent) * 1000) / 10 : 0);

      return res.status(200).json({
        ok: true,
        blast_id: blastId,
        summary: {
          sent: sent,
          delivered: delivered,
          bounced: bounced,
          failed: sent - delivered,
          opened: opened,
          clicked: clicked,
          replied: replied,
          total_clicks: totalClicks,
          open_rate: pct(opened),
          click_rate: pct(clicked),
          reply_rate: pct(replied),
        },
        recipients: rows.map((r) => ({
          token: r.token,
          email: r.email,
          lead_id: r.lead_id,
          sent_at: r.sent_at,
          delivered: r.delivered,
          bounced: r.bounced,
          error: r.error,
          opens: r.opens,
          clicks: r.clicks,
          click_urls: r.clickUrls.slice(0, 10),
          replied: r.replied,
        })),
      });
    } catch (e) {
      console.error('[email-track] stats error:', e);
      return res.status(500).json({ error: 'Gagal ambil statistik: ' + String((e && e.message) || e).slice(0, 200) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
