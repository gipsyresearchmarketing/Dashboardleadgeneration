/**
 * Vercel Serverless Function — kirim email blast dari dashboard.
 *
 * Auth   : butuh header "Authorization: Bearer <Supabase access token>" (user harus login & member brand).
 * Provider: Gmail API milik brand (lewat "Hubungkan Gmail" di Profile — Google OAuth, tanpa App Password).
 *   Fallback kalau brand belum hubungkan Gmail: Resend (RESEND_API_KEY, EMAIL_FROM)
 *   atau SMTP (SMTP_USER, SMTP_PASS + opsional SMTP_HOST/SMTP_PORT/EMAIL_FROM/EMAIL_FROM_NAME).
 * Opsional : REPLY_TO, SUPABASE_URL, SUPABASE_ANON_KEY, SECRETS_KEY
 */
const { getMailConfig, createMailer } = require('./_lib/brand');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_JTxgxH__IgjcJhGkncaIkQ_erJNnZDG';
const MAX_RECIPIENTS = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

const MAX_FILES = 10;
const MAX_TOTAL_B64 = 4000000; // batas aman body Vercel (~4.5MB)

/** Ubah <img src="data:image/..."> jadi cid: supaya gambar tampil di Gmail/Outlook. */
function extractInlineImages(html) {
  const atts = [];
  const seen = {};
  const out = String(html || '').replace(/src=(["'])data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+\/=\s]+?)\1/gi, (m, q, ext, b64) => {
    const clean = b64.replace(/\s+/g, '');
    let cid = seen[clean];
    if (!cid) {
      cid = `img${atts.length + 1}@leadscrm`;
      seen[clean] = cid;
      const e = ext.toLowerCase().replace('jpeg', 'jpg');
      atts.push({ filename: `image${atts.length + 1}.${e}`, content: clean, contentType: `image/${e === 'jpg' ? 'jpeg' : e}`, cid });
    }
    return `src=${q}cid:${cid}${q}`;
  });
  return { html: out, inline: atts };
}

function parseFiles(v) {
  const arr = Array.isArray(v) ? v.slice(0, MAX_FILES) : [];
  return arr
    .map((f) => ({
      filename: String((f && f.name) || 'file').replace(/[\\/\r\n"]/g, '_').slice(0, 120),
      content: String((f && f.data) || '').replace(/\s+/g, ''),
      contentType: String((f && f.type) || 'application/octet-stream').slice(0, 100),
    }))
    .filter((f) => /^[A-Za-z0-9+\/=]+$/.test(f.content) && f.content.length > 0);
}

function parseEmails(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return arr.map((s) => String(s).trim()).filter((s) => EMAIL_RE.test(s));
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

/** Return async function send(msg) sesuai provider yang dikonfigurasi, atau null kalau belum diset. */
function getSender() {
  const replyTo = process.env.REPLY_TO || undefined;
  if (process.env.RESEND_API_KEY) {
    const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    return async (m) => {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, cc: m.cc, bcc: m.bcc, reply_to: replyTo, attachments: (m.attachments || []).length ? m.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType, ...(a.cid ? { content_id: a.cid } : {}) })) : undefined }),
      });
      if (!r.ok) {
        let msg = `Resend HTTP ${r.status}`;
        try { const j = await r.json(); msg = j.message || j.error || msg; } catch (e) {}
        throw new Error(msg);
      }
    };
  }
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const from = process.env.EMAIL_FROM || `"${process.env.EMAIL_FROM_NAME || 'Leads CRM'}" <${process.env.SMTP_USER}>`;
    return async (m) => {
      await transporter.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, cc: m.cc, bcc: m.bcc, replyTo, attachments: (m.attachments || []).map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType, ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' } : {}) })) });
    };
  }
  return null;
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

    const subject = String(body.subject || '').trim().slice(0, 200);
    const extracted = extractInlineImages(String(body.html || ''));
    const html = extracted.html;
    const files = parseFiles(body.files);
    const attachments = [...extracted.inline, ...files];
    const totalB64 = attachments.reduce((n, a) => n + a.content.length, 0);
    if (totalB64 > MAX_TOTAL_B64) return res.status(413).json({ error: 'Total ukuran gambar/lampiran terlalu besar (maks ~3 MB). Kecilkan atau kurangi file.' });
    if (!subject) return res.status(400).json({ error: 'Subject wajib diisi' });
    if (!html.trim()) return res.status(400).json({ error: 'Isi email kosong' });
    if (html.length > 500000) return res.status(400).json({ error: 'Isi email terlalu besar' });

    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!recipients.length) return res.status(400).json({ error: 'Tidak ada penerima' });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Maksimal ${MAX_RECIPIENTS} penerima per request` });

    /* Pengirim: pakai Gmail API milik brand (dari "Hubungkan Gmail").
       Fallback ke Resend/SMTP env kalau brand belum hubungkan Gmail. */
    let send = null;
    let mc = null;
    try { mc = await getMailConfig(token, brandId); } catch (e) {}
    if (mc) {
      const mailer = await createMailer(mc);
      const from = `"${mc.fromName}" <${mc.user}>`;
      send = async (m) => {
        await mailer.send({
          from, to: m.to, subject: m.subject, html: m.html, text: m.text, cc: m.cc, bcc: m.bcc, replyTo: mc.replyTo,
          attachments: (m.attachments || []).map((x) => ({ filename: x.filename, content: x.content, encoding: 'base64', contentType: x.contentType, ...(x.cid ? { cid: x.cid, contentDisposition: 'inline' } : {}) })),
        });
      };
    } else {
      send = getSender();
      if (!send) return res.status(400).json({ error: 'Gmail brand ini belum dihubungkan. Buka Profile -> Pengaturan Pengiriman -> klik "Hubungkan Gmail".' });
    }

    const text = htmlToText(html);
    const cc = parseEmails(body.cc);
    const bcc = parseEmails(body.bcc);
    const results = [];
    // 5 email paralel; cc/bcc hanya dilampirkan di email pertama supaya tidak dobel-dobel
    for (let i = 0; i < recipients.length; i += 5) {
      const slice = recipients.slice(i, i + 5);
      const out = await Promise.all(slice.map(async (r, j) => {
        const email = String((r && r.email) || '').trim();
        if (!EMAIL_RE.test(email)) return { lead_id: r && r.lead_id, email, ok: false, error: 'Email tidak valid' };
        try {
          const first = i === 0 && j === 0;
          await send({ to: email, subject, html, text, attachments, cc: first && cc.length ? cc : undefined, bcc: first && bcc.length ? bcc : undefined });
          return { lead_id: r.lead_id, email, ok: true };
        } catch (e) {
          return { lead_id: r.lead_id, email, ok: false, error: String((e && e.message) || e).slice(0, 300) };
        }
      }));
      results.push(...out);
    }
    return res.status(200).json({ results });
  } catch (e) {
    console.error('[send-email]', e);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
