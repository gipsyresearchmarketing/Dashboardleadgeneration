/**
 * Vercel Serverless Function — tarik balasan customer dari Gmail (IMAP) untuk Inbox dashboard.
 *
 * Auth   : header "Authorization: Bearer <Supabase access token>" (user harus login & member brand).
 * Env    : SMTP_USER, SMTP_PASS  (App Password Gmail yang sama dengan pengiriman email)
 *          IMAP_HOST (opsional, default imap.gmail.com), IMAP_USER / IMAP_PASS (opsional, default = SMTP_USER / SMTP_PASS)
 * Body   : { brand_id, emails: ["customer@x.com", ...], since_days: 14, max: 40 }
 *          Hanya email dari alamat yang ada di `emails` (daftar lead) yang diambil — email lain di Gmail diabaikan.
 * Return : { messages: [{ message_id, from_email, from_name, to_email, subject, body, snippet, received_at, has_attachments, attachments }], partial }
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_JTxgxH__IgjcJhGkncaIkQ_erJNnZDG';
const MAX_ALLOWLIST = 1000;
const DEADLINE_MS = 8500;

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

/** Buang kutipan email lama ("On ... wrote:", "Pada ... menulis:", baris yang diawali ">"). */
function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const two = (l + ' ' + (lines[i + 1] || '').trim()).trim();
    if (/^(On|Pada)\s.+(wrote|menulis):?$/i.test(l) || /^(On|Pada)\s.+(wrote|menulis):?$/i.test(two) && /^(On|Pada)\s/i.test(l)) { cut = i; break; }
    if (/^-{2,}\s*(Original Message|Pesan Asli|Forwarded message)/i.test(l)) { cut = i; break; }
    if (/^_{5,}$/.test(l) && /^(From|Dari):/i.test((lines[i + 1] || '').trim())) { cut = i; break; }
    if (l.startsWith('>')) { cut = i; break; }
  }
  const out = lines.slice(0, cut).join('\n').trim();
  return out;
}

function friendlyImapError(e) {
  const msg = String((e && (e.responseText || e.message)) || e);
  if (e && (e.authenticationFailed || /auth|credential|invalid/i.test(msg))) {
    return 'Login IMAP Gmail ditolak. Pastikan SMTP_USER dan SMTP_PASS (App Password 16 karakter) di Vercel benar dan IMAP aktif di Gmail. (' + msg.slice(0, 120) + ')';
  }
  return 'Gagal membaca Gmail: ' + msg.slice(0, 200);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Belum login' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Body tidak valid' });

  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (e) {
    return res.status(500).json({ error: 'Paket imapflow / mailparser belum terinstall — tambahkan ke dependencies di package.json lalu deploy ulang.' });
  }

  const started = Date.now();
  let client = null;
  try {
    const user = await verifyUser(token);
    if (!user) return res.status(401).json({ error: 'Session tidak valid, coba login ulang' });
    const brandId = String(body.brand_id || '');
    if (!brandId || !(await isBrandMember(token, brandId, user.id))) return res.status(403).json({ error: 'Kamu bukan member brand ini' });

    const imapUser = process.env.IMAP_USER || process.env.SMTP_USER;
    const imapPass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    if (!imapUser || !imapPass) return res.status(500).json({ error: 'Gmail belum dikonfigurasi di Vercel (isi SMTP_USER dan SMTP_PASS)' });

    const allow = new Set((Array.isArray(body.emails) ? body.emails : []).slice(0, MAX_ALLOWLIST).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
    if (!allow.size) return res.status(200).json({ messages: [], partial: false });
    const days = Math.max(1, Math.min(30, parseInt(body.since_days, 10) || 14));
    const maxMsgs = Math.max(1, Math.min(60, parseInt(body.max, 10) || 40));
    const self = String(imapUser).toLowerCase();

    client = new ImapFlow({
      host: process.env.IMAP_HOST || 'imap.gmail.com', port: 993, secure: true,
      auth: { user: imapUser, pass: imapPass }, logger: false,
    });
    client.on('error', () => {});
    try { await client.connect(); } catch (e) { return res.status(502).json({ error: friendlyImapError(e) }); }

    const messages = [];
    let partial = false;
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - days * 86400000);
      let uids = await client.search({ since }, { uid: true });
      uids = Array.isArray(uids) ? uids.slice(-400) : [];
      const wanted = [];
      if (uids.length) {
        for await (const m of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          if (Date.now() - started > DEADLINE_MS - 3000) { partial = true; break; }
          const f = m.envelope && m.envelope.from && m.envelope.from[0];
          const from = f && f.address ? String(f.address).toLowerCase() : '';
          if (from && from !== self && allow.has(from)) wanted.push(m.uid);
        }
      }
      const picks = wanted.slice(-maxMsgs);
      if (picks.length) {
        for await (const m of client.fetch(picks, { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (Date.now() - started > DEADLINE_MS) { partial = true; break; }
          try {
            const p = await simpleParser(m.source);
            const from = p.from && p.from.value && p.from.value[0] || {};
            const to = p.to && p.to.value && p.to.value[0] || {};
            const full = String(p.text || '').trim();
            const reply = stripQuoted(full) || full;
            const atts = (p.attachments || []).filter((a) => !a.related).map((a) => ({ name: a.filename || 'file', size: a.size ? Math.max(1, Math.round(a.size / 1024)) + ' KB' : '' }));
            messages.push({
              message_id: String(p.messageId || `uid-${m.uid}`),
              from_email: String(from.address || '').toLowerCase(),
              from_name: String(from.name || ''),
              to_email: String(to.address || imapUser),
              subject: String(p.subject || '').slice(0, 300),
              body: reply.slice(0, 20000),
              snippet: reply.replace(/\s+/g, ' ').slice(0, 160),
              received_at: (p.date || m.internalDate || new Date()).toISOString(),
              has_attachments: atts.length > 0,
              attachments: atts,
            });
          } catch (e) { /* lewati email yang gagal diparse */ }
        }
      }
    } finally {
      lock.release();
    }
    try { await client.logout(); } catch (e) {}
    client = null;
    return res.status(200).json({ messages, partial });
  } catch (e) {
    console.error('[sync-inbox]', e);
    return res.status(500).json({ error: friendlyImapError(e) });
  } finally {
    if (client) { try { client.close(); } catch (e) {} }
  }
};

module.exports.stripQuoted = stripQuoted;
