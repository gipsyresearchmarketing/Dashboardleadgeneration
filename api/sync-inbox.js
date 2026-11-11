/**
 * Vercel Serverless Function — tarik balasan customer dari Gmail (IMAP) untuk Inbox dashboard.
 *
 * Auth   : header "Authorization: Bearer <Supabase access token>" (user harus login & member brand).
 * Akun   : Gmail MILIK BRAND — sama dengan yang dipakai kirim email.
 *          "Hubungkan Gmail" (OAuth) -> dibaca lewat Gmail API (izin gmail.readonly)
 *          SMTP + App Password       -> dibaca lewat IMAP
 * Env    : SECRETS_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * Body   : { brand_id, emails: ["customer@x.com", ...], since_days: 14, max: 40 }
 *          Hanya email dari alamat yang ada di `emails` (daftar lead) yang diambil — email lain di Gmail diabaikan.
 * Return : { messages: [{ message_id, from_email, from_name, to_email, subject, body, snippet, received_at, has_attachments, attachments }], partial }
 */
const { authBrand, getMailConfig, gmailAccessToken, GmailAuthError } = require('./_lib/brand');
const MAX_ALLOWLIST = 1000;
const DEADLINE_MS = 8500;

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

/** Ubah hasil simpleParser jadi objek pesan untuk dashboard. */
function toMessage(p, fallbackId, fallbackTo, internalDate) {
  const from = p.from && p.from.value && p.from.value[0] || {};
  const to = p.to && p.to.value && p.to.value[0] || {};
  const full = String(p.text || '').trim();
  const reply = stripQuoted(full) || full;
  const atts = (p.attachments || []).filter((a) => !a.related).map((a) => ({ name: a.filename || 'file', size: a.size ? Math.max(1, Math.round(a.size / 1024)) + ' KB' : '' }));
  return {
    message_id: String(p.messageId || fallbackId),
    from_email: String(from.address || '').toLowerCase(),
    from_name: String(from.name || ''),
    to_email: String(to.address || fallbackTo),
    subject: String(p.subject || '').slice(0, 300),
    body: reply.slice(0, 20000),
    snippet: reply.replace(/\s+/g, ' ').slice(0, 160),
    received_at: (p.date || internalDate || new Date()).toISOString(),
    has_attachments: atts.length > 0,
    attachments: atts,
  };
}

/** Baca balasan lewat Gmail API (untuk brand yang pakai "Hubungkan Gmail"). */
async function syncViaGmailApi(mc, allow, days, maxMsgs, started, simpleParser) {
  const at = await gmailAccessToken(mc.refreshToken);
  const api = async (path) => {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { Authorization: `Bearer ${at}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
      if (r.status === 403) throw new Error('Gmail belum memberi izin membaca inbox. Putuskan lalu Hubungkan Gmail lagi dan centang semua izin. (' + msg + ')');
      throw new Error('Gmail API: ' + msg);
    }
    return j;
  };
  const self = String(mc.user).toLowerCase();
  const after = Math.floor((Date.now() - days * 86400000) / 1000);
  const q = encodeURIComponent(`in:inbox after:${after} -from:me`);
  let ids = [], pageToken = '';
  for (let page = 0; page < 4; page++) {
    const j = await api(`messages?maxResults=100&q=${q}` + (pageToken ? '&pageToken=' + pageToken : ''));
    ids = ids.concat((j.messages || []).map((m) => m.id));
    pageToken = j.nextPageToken || '';
    if (!pageToken || Date.now() - started > DEADLINE_MS - 5000) break;
  }
  let partial = false;
  const wanted = [];
  for (let i = 0; i < ids.length; i += 20) {
    if (Date.now() - started > DEADLINE_MS - 3500) { partial = true; break; }
    const metas = await Promise.all(ids.slice(i, i + 20).map((id) => api(`messages/${id}?format=metadata&metadataHeaders=From`).catch(() => null)));
    metas.forEach((m) => {
      if (!m) return;
      const h = ((m.payload && m.payload.headers) || []).find((x) => /^from$/i.test(x.name));
      const mm = h && /<([^>]+)>/.exec(h.value);
      const addr = String(mm ? mm[1] : (h && h.value) || '').trim().toLowerCase();
      if (addr && addr !== self && allow.has(addr)) wanted.push(m.id);
    });
  }
  const messages = [];
  const picks = wanted.slice(0, maxMsgs);
  for (let i = 0; i < picks.length; i += 8) {
    if (Date.now() - started > DEADLINE_MS) { partial = true; break; }
    const raws = await Promise.all(picks.slice(i, i + 8).map((id) => api(`messages/${id}?format=raw`).catch(() => null)));
    for (const m of raws) {
      if (!m || !m.raw) continue;
      try {
        const p = await simpleParser(Buffer.from(m.raw, 'base64url'));
        messages.push(toMessage(p, 'gm-' + m.id, mc.user, m.internalDate ? new Date(Number(m.internalDate)) : null));
      } catch (e) { /* lewati */ }
    }
  }
  return { messages, partial };
}

function friendlyImapError(e) {
  const msg = String((e && (e.responseText || e.message)) || e);
  if (e && (e.authenticationFailed || /auth|credential|invalid/i.test(msg))) {
    return 'Login IMAP ditolak. Cek App Password di Profile -> Pengaturan Pengiriman, dan pastikan IMAP aktif. (' + msg.slice(0, 120) + ')';
  }
  return 'Gagal membaca Gmail: ' + msg.slice(0, 200);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

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
    const a = await authBrand(req, body.brand_id);
    if (a.error) return res.status(a.status).json({ error: a.error });
    const mc = await getMailConfig(a.token, a.brandId);
    if (!mc) return res.status(400).json({ error: 'Gmail brand ini belum dihubungkan. Buka Profile -> Pengaturan Pengiriman -> "Hubungkan Gmail".' });

    const allow = new Set((Array.isArray(body.emails) ? body.emails : []).slice(0, MAX_ALLOWLIST).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
    if (!allow.size) return res.status(200).json({ messages: [], partial: false });
    const days = Math.max(1, Math.min(30, parseInt(body.since_days, 10) || 14));
    const maxMsgs = Math.max(1, Math.min(60, parseInt(body.max, 10) || 40));

    if (mc.type === 'gmail') {
      if (!mc.canRead) return res.status(400).json({ error: 'Inbox belum aktif: Gmail brand ini hanya diberi izin kirim. Putuskan lalu Hubungkan Gmail lagi (izin baca inbox harus dicentang).' });
      try {
        return res.status(200).json(await syncViaGmailApi(mc, allow, days, maxMsgs, started, simpleParser));
      } catch (e) {
        return res.status(e instanceof GmailAuthError ? 401 : 502).json({ error: String(e.message || e).slice(0, 300) });
      }
    }

    const imapUser = mc.user;
    const imapPass = mc.pass;
    const imapHost = process.env.IMAP_HOST || (/^smtp\./i.test(mc.host) ? mc.host.replace(/^smtp\./i, 'imap.') : 'imap.gmail.com');

    const self = String(imapUser).toLowerCase();

    client = new ImapFlow({
      host: imapHost, port: 993, secure: true,
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
            messages.push(toMessage(p, `uid-${m.uid}`, imapUser, m.internalDate));
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
