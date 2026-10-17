/**
 * Vercel Serverless Function — Webhook WhatsApp (Meta).
 * Isi di Meta → WhatsApp → Production setup → Configure Webhooks:
 *   Callback URL : https://<domain-dashboard>/api/wa-webhook
 *   Verify token : sama dengan env WA_WEBHOOK_VERIFY_TOKEN
 *
 * Yang dilakukan:
 *  - pesan masuk dari customer  -> disimpan ke tabel wa_messages (direction 'in') milik brand yang punya nomor itu
 *  - status pesan keluar        -> update status (sent / delivered / read / failed)
 * Brand ditentukan dari phone_number_id penerima (kolom brand_settings.wa_phone_number_id).
 *
 * Env: WA_WEBHOOK_VERIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY (kunci server, JANGAN dipakai di browser),
 *      SUPABASE_URL (opsional)
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

function svc() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel');
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
}

async function brandForPhoneId(phoneId, cache) {
  if (cache[phoneId] !== undefined) return cache[phoneId];
  const r = await fetch(`${SUPABASE_URL}/rest/v1/brand_settings?select=brand_id&wa_phone_number_id=eq.${encodeURIComponent(phoneId)}`, { headers: svc() });
  const rows = r.ok ? await r.json() : [];
  cache[phoneId] = rows && rows[0] ? rows[0].brand_id : null;
  return cache[phoneId];
}

/** Ringkas isi pesan apa pun jadi teks + info media. */
function describe(m) {
  const t = m.type;
  if (t === 'text') return { body: (m.text && m.text.body) || '', media: null };
  if (t === 'button') return { body: (m.button && m.button.text) || '', media: null };
  if (t === 'interactive') {
    const i = m.interactive || {};
    return { body: (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '[Interaktif]', media: null };
  }
  if (t === 'reaction') return { body: 'Reaksi ' + ((m.reaction && m.reaction.emoji) || ''), media: null };
  if (t === 'location') {
    const l = m.location || {};
    return { body: '📍 ' + (l.name || l.address || (l.latitude + ', ' + l.longitude)), media: null };
  }
  if (['image', 'video', 'audio', 'document', 'sticker'].indexOf(t) >= 0) {
    const md = m[t] || {};
    const label = { image: '🖼️ Gambar', video: '🎬 Video', audio: '🎤 Pesan suara', document: '📎 ' + (md.filename || 'Dokumen'), sticker: 'Stiker' }[t];
    return { body: md.caption ? label + ' · ' + md.caption : label, media: { type: t, id: md.id || null, mime: md.mime_type || null, filename: md.filename || null } };
  }
  return { body: '[Pesan ' + t + ' belum didukung]', media: null };
}

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

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const cache = {};
  try {
    for (const en of (b && b.entry) || []) {
      for (const ch of en.changes || []) {
        if (ch.field !== 'messages') continue;
        const v = ch.value || {};
        const phoneId = v.metadata && v.metadata.phone_number_id;
        if (!phoneId) continue;
        const brandId = await brandForPhoneId(phoneId, cache);
        if (!brandId) { console.warn('[wa-webhook] nomor', phoneId, 'tidak terhubung ke brand mana pun'); continue; }

        // Pesan masuk
        const names = {};
        (v.contacts || []).forEach((c) => { names[c.wa_id] = c.profile && c.profile.name; });
        const rows = (v.messages || []).map((m) => {
          const d = describe(m);
          return {
            id: m.id, brand_id: brandId, direction: 'in',
            contact_phone: String(m.from || ''), contact_name: names[m.from] || null,
            msg_type: m.type, body: String(d.body || '').slice(0, 4096), media: d.media,
            status: 'received', read_by_agent: false,
            sent_at: new Date(Number(m.timestamp || Date.now() / 1000) * 1000).toISOString(),
          };
        });
        if (rows.length) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/wa_messages?on_conflict=id`, {
            method: 'POST', headers: Object.assign(svc(), { Prefer: 'resolution=ignore-duplicates,return=minimal' }), body: JSON.stringify(rows),
          });
          if (!r.ok) console.error('[wa-webhook] gagal simpan pesan', r.status, (await r.text()).slice(0, 200));
        }

        // Status pesan keluar (hanya naik: sent -> delivered -> read; failed selalu menang)
        for (const s of v.statuses || []) {
          const st = String(s.status || '');
          if (!STATUS_RANK[st]) continue;
          const lower = Object.keys(STATUS_RANK).filter((k) => STATUS_RANK[k] < STATUS_RANK[st]);
          const err = s.errors && s.errors[0] ? String(s.errors[0].title || s.errors[0].message || s.errors[0].code) : null;
          const filter = `id=eq.${encodeURIComponent(s.id)}&brand_id=eq.${encodeURIComponent(brandId)}` + (st === 'failed' ? '' : `&status=in.(${lower.join(',')})`);
          await fetch(`${SUPABASE_URL}/rest/v1/wa_messages?${filter}`, {
            method: 'PATCH', headers: Object.assign(svc(), { Prefer: 'return=minimal' }),
            body: JSON.stringify(Object.assign({ status: st }, err ? { error: err.slice(0, 300) } : {})),
          });
        }
      }
    }
  } catch (e) {
    console.error('[wa-webhook]', e && e.message || e);
  }
  // Selalu balas 200 supaya Meta tidak mengulang-ulang kiriman
  return res.status(200).json({ ok: true });
};
