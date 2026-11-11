/**
 * Vercel Serverless Function — jalankan broadcast WhatsApp TERJADWAL (tabel wa_scheduled).
 *
 * Dipanggil tiap menit oleh Supabase (pg_cron + pg_net, lihat supabase-wa-fitur-lanjutan.sql):
 *   POST /api/wa-cron   header  x-cron-secret: <CRON_SECRET>      -> proses jadwal semua brand yang sudah jatuh tempo
 * Cadangan: dashboard yang sedang terbuka juga memanggil endpoint ini (pakai login user) -> hanya brand itu.
 *   POST /api/wa-cron   header  Authorization: Bearer <Supabase access token>, body { brand_id }
 *
 * Env: CRON_SECRET (string acak bebas, sama dengan yang ditulis di SQL), SUPABASE_SERVICE_ROLE_KEY, SECRETS_KEY
 */
const crypto = require('crypto');
const { authBrand } = require('./_lib/brand');
const { sendOne, parseSendBody, svc, waConfigSvc } = require('./_lib/wa');

const TIME_BUDGET_MS = 45000;

function secretOk(req) {
  const want = String(process.env.CRON_SECRET || '');
  if (want.length < 12) return false;
  const got = String(req.headers['x-cron-secret'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '');
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function claim(job) {
  const stale = new Date(Date.now() - 3 * 60000).toISOString();
  const filter = `id=eq.${encodeURIComponent(job.id)}&or=(status.eq.scheduled,and(status.eq.sending,locked_at.lt.${stale}))`;
  const r = await svc(`wa_scheduled?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sending', locked_at: new Date().toISOString() }) });
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

async function runJob(job, deadline) {
  const p = job.payload || {};
  const wc = await waConfigSvc(job.brand_id);
  const result = Object.assign({ sent: 0, failed: 0, errors: [], ok_leads: [] }, job.result || {});
  if (!wc) {
    await svc(`wa_scheduled?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: 'WhatsApp brand belum dihubungkan', locked_at: null }) });
    return { id: job.id, status: 'failed' };
  }
  const parsed = parseSendBody(p);
  if (parsed.error) {
    await svc(`wa_scheduled?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: parsed.error, locked_at: null }) });
    return { id: job.id, status: 'failed' };
  }
  const ctx = Object.assign(parsed.ctx, { token: wc.token, phoneId: wc.phoneId, version: wc.version });
  const list = Array.isArray(p.recipients) ? p.recipients : [];
  let i = Number(job.progress || 0);
  while (i < list.length && Date.now() < deadline) {
    const batch = list.slice(i, i + 5);
    const out = await Promise.all(batch.map((r) => sendOne(ctx, r || {})));
    const now = new Date().toISOString();
    const rows = [];
    out.forEach((o, k) => {
      const r = batch[k] || {};
      if (o.ok) {
        result.sent++; if (r.lead_id) result.ok_leads.push(r.lead_id);
        rows.push({ id: o.wa_message_id, brand_id: job.brand_id, direction: 'out', contact_phone: o.phone, contact_name: r.name || null,
          msg_type: ctx.mode === 'media' ? ctx.media.type : ctx.mode, body: String(r.body || r.text || '').slice(0, 4096),
          media: p.media_log || null, status: 'sent', read_by_agent: true, blast_id: job.id, sent_at: now });
      } else {
        result.failed++;
        if (result.errors.length < 25) result.errors.push((r.name || o.phone) + ' — ' + o.error);
        rows.push({ id: 'fail-' + job.id + '-' + (i + k), brand_id: job.brand_id, direction: 'out', contact_phone: o.phone || String(r.phone || ''), contact_name: r.name || null,
          msg_type: ctx.mode === 'media' ? ctx.media.type : ctx.mode, body: String(r.body || r.text || '').slice(0, 4096), media: p.media_log || null,
          status: 'failed', error: String(o.error || '').slice(0, 300), read_by_agent: true, blast_id: job.id, sent_at: now });
      }
    });
    if (rows.length) await svc('wa_messages?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    i += batch.length;
    await svc(`wa_scheduled?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify({ progress: i, result, locked_at: new Date().toISOString() }) });
  }
  if (i < list.length) return { id: job.id, status: 'sending', progress: i };   // lanjut di panggilan berikutnya

  const done = new Date().toISOString();
  const status = result.sent ? 'sent' : 'failed';
  await svc(`wa_scheduled?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify({ status, sent_at: done, locked_at: null, result, error: result.sent ? null : (result.errors[0] || 'Semua gagal') }) });
  // Riwayat broadcast di dashboard (baris dibuat dashboard saat menjadwalkan, di sini ditandai terkirim)
  await svc(`blast_history?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify({ status: status === 'sent' ? 'sent' : 'failed', sent_at: done, recipients: result.ok_leads.map((id) => ({ lead_id: id })) }) });
  return { id: job.id, status, sent: result.sent, failed: result.failed };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const t0 = Date.now();
  try {
    let brandFilter = '';
    if (!secretOk(req)) {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const a = await authBrand(req, body && body.brand_id);
      if (a.error) return res.status(a.status).json({ error: a.error });
      brandFilter = `&brand_id=eq.${encodeURIComponent(a.brandId)}`;
    }
    const nowIso = new Date().toISOString();
    const q = await svc(`wa_scheduled?select=*&status=in.(scheduled,sending)&run_at=lte.${nowIso}${brandFilter}&order=run_at.asc&limit=5`);
    if (!q.ok) {
      const msg = JSON.stringify(q.data || '').slice(0, 200);
      return res.status(500).json({ error: /does not exist|schema cache/i.test(msg) ? 'Tabel wa_scheduled belum dibuat — jalankan supabase-wa-fitur-lanjutan.sql' : 'Gagal membaca jadwal: ' + msg });
    }
    const done = [];
    for (const row of q.data || []) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      const job = await claim(row);
      if (!job) continue;
      done.push(await runJob(job, t0 + TIME_BUDGET_MS));
    }
    return res.status(200).json({ ok: true, processed: done });
  } catch (e) {
    console.error('[wa-cron]', e);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.config = { maxDuration: 60 };
