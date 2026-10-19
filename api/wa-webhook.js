/**
 * Vercel Serverless Function — Webhook WhatsApp (Meta).
 * Isi di Meta → WhatsApp → Production setup → Configure Webhooks:
 *   Callback URL : https://<domain-dashboard>/api/wa-webhook
 *   Verify token : sama dengan env WA_WEBHOOK_VERIFY_TOKEN
 *
 * Yang dilakukan:
 *  - pesan masuk dari customer  -> disimpan ke tabel wa_messages (direction 'in') milik brand yang punya nomor itu
 *  - status pesan keluar        -> update status (sent / delivered / read / failed)
 *  - status template (Approved / Ditolak / di-pause) -> tabel wa_template_events (dashboard langsung dapat notifikasi)
 * Brand ditentukan dari phone_number_id penerima (kolom brand_settings.wa_phone_number_id),
 * atau dari WABA ID untuk event template (kolom brand_settings.wa_waba_id).
 * Di Meta → Webhooks centang field: messages  DAN  message_template_status_update
 *
 * Env: WA_WEBHOOK_VERIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY (kunci server, JANGAN dipakai di browser),
 *      SUPABASE_URL (opsional)
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

function svc() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel');
  // Kunci baru "sb_secret_..." bukan JWT: cukup di header apikey. Kunci legacy service_role (eyJ...) dipakai di dua header.
  if (/^sb_secret_/.test(k)) return { apikey: k, 'Content-Type': 'application/json' };
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
}

async function brandForWaba(waba, cache) {
  const k = 'waba:' + waba;
  if (cache[k] !== undefined) return cache[k];
  const r = await fetch(`${SUPABASE_URL}/rest/v1/brand_settings?select=brand_id&wa_waba_id=eq.${encodeURIComponent(waba)}`, { headers: svc() });
  const rows = r.ok ? await r.json() : [];
  cache[k] = rows && rows[0] ? rows[0].brand_id : null;
  return cache[k];
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
  if (t === 'contacts') {
    const c = (m.contacts || [])[0] || {};
    const nm = (c.name && (c.name.formatted_name || c.name.first_name)) || 'Kontak';
    const ph = (c.phones || [])[0];
    return { body: '👤 Kontak: ' + nm + (ph ? ' · ' + (ph.phone || ph.wa_id || '') : ''), media: null };
  }
  if (t === 'system') return { body: 'ℹ️ ' + ((m.system && m.system.body) || 'Pesan sistem'), media: null };
  if (t === 'order') return { body: '🛒 Pesanan dari katalog (' + (((m.order && m.order.product_items) || []).length) + ' produk)', media: null };
  if (t === 'unsupported' || t === 'unknown') {
    const e = (m.errors || [])[0] || {};
    const det = (e.error_data && e.error_data.details) || e.title || '';
    return { body: '⚠️ Pesan ini tidak bisa dibaca lewat WhatsApp API' + (det ? ' (' + det + ')' : '') + '. Biasanya: kode verifikasi/OTP, polling, pesan sekali lihat, atau pesan yang sudah dihapus. Minta pengirim memakai SMS/telepon atau kirim ulang sebagai teks biasa.', media: null };
  }
  return { body: '[Pesan ' + t + ' belum didukung]', media: null };
}

/**
 * Terapkan satu status pesan keluar ke tabel wa_messages.
 *  - naik saja: sent -> delivered -> read (tidak pernah turun); failed selalu menang
 *  - TIDAK bergantung pada status awal baris (apa pun nilainya, mis. 'queued' / 'accepted' / kosong)
 *  - kalau baris pesannya belum tersimpan (event Meta bisa datang lebih cepat dari penyimpanan), coba lagi sekali
 *  - kalau tetap tidak ketemu atau gagal update, tulis ke log (dulu: diam-diam hilang)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyStatus(brandId, s) {
  const st = String(s.status || '');
  if (!STATUS_RANK[st] || !s.id) return;
  const e0 = s.errors && s.errors[0];
  const err = e0 ? ((e0.code ? '(' + e0.code + ') ' : '') + String(e0.title || e0.message || '')).slice(0, 300) : null;
  const base = `id=eq.${encodeURIComponent(s.id)}&brand_id=eq.${encodeURIComponent(brandId)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = await fetch(`${SUPABASE_URL}/rest/v1/wa_messages?select=status&${base}`, { headers: svc() });
    const rows = g.ok ? await g.json() : [];
    if (rows && rows[0]) {
      const cur = rows[0].status;
      if (st === 'failed' ? cur === 'failed' : (STATUS_RANK[cur] || 0) >= STATUS_RANK[st]) return; // sudah sama / lebih tinggi
      const p = await fetch(`${SUPABASE_URL}/rest/v1/wa_messages?${base}`, {
        method: 'PATCH', headers: Object.assign(svc(), { Prefer: 'return=minimal' }),
        body: JSON.stringify(Object.assign({ status: st }, err ? { error: err } : {})),
      });
      if (!p.ok) console.error('[wa-webhook] gagal update status', st, s.id, p.status, (await p.text()).slice(0, 200));
      return;
    }
    if (!g.ok) console.error('[wa-webhook] gagal baca pesan untuk status', st, s.id, g.status);
    if (attempt === 0) await sleep(1500);
  }
  console.warn('[wa-webhook] status', st, 'untuk', s.id, 'tidak menemukan pesan di wa_messages (brand', brandId + '). Cek: kolom id pesan keluar harus sama dengan wamid dari Meta.');
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
        if (ch.field === 'message_template_status_update' || ch.field === 'template_category_update') {
          const v = ch.value || {};
          const brandT = await brandForWaba(String(en.id || ''), cache);
          if (!brandT) { console.warn('[wa-webhook] WABA', en.id, 'tidak terhubung ke brand mana pun'); continue; }
          const ev = {
            brand_id: brandT, waba_id: String(en.id || ''), template_id: String(v.message_template_id || ''),
            name: String(v.message_template_name || ''), language: String(v.message_template_language || ''),
            event: ch.field === 'template_category_update' ? 'CATEGORY_' + String(v.new_category || '') : String(v.event || ''),
            reason: v.reason && v.reason !== 'NONE' ? String(v.reason) : (v.other_info && v.other_info.title ? String(v.other_info.title) : null),
          };
          const r = await fetch(`${SUPABASE_URL}/rest/v1/wa_template_events`, { method: 'POST', headers: Object.assign(svc(), { Prefer: 'return=minimal' }), body: JSON.stringify(ev) });
          if (!r.ok) console.error('[wa-webhook] gagal simpan event template', r.status, (await r.text()).slice(0, 200));
          continue;
        }
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

        // Status pesan keluar (sent / delivered / read / failed)
        const sts = v.statuses || [];
        if (sts.length || (v.messages || []).length) console.log('[wa-webhook] nomor', phoneId, '| pesan masuk:', (v.messages || []).length, '| status:', sts.map((x) => x.status).join(',') || '-');
        await Promise.all(sts.map((x) => applyStatus(brandId, x).catch((e) => console.error('[wa-webhook] status', x && x.id, e && e.message || e))));
      }
    }
  } catch (e) {
    console.error('[wa-webhook]', e && e.message || e);
  }
  // Selalu balas 200 supaya Meta tidak mengulang-ulang kiriman
  return res.status(200).json({ ok: true });
};
