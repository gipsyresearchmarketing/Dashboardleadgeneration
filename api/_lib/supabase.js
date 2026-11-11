/**
 * Helper Supabase dengan kunci server (service role).
 *
 * Dipisah dari _lib/wa.js supaya modul EMAIL (send-email.js, email-track.js)
 * tidak bergantung pada file WhatsApp — WA sudah dihapus dari dashboard.
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY (kunci server, JANGAN dipakai di browser), SUPABASE_URL (opsional)
 */
const { SUPABASE_URL } = require('./brand');

/** Header untuk panggil REST API Supabase pakai kunci server. */
function svcHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel');
  // Kunci baru "sb_secret_..." bukan JWT: cukup di header apikey. Kunci legacy service_role (eyJ...) dipakai di dua header.
  const h = /^sb_secret_/.test(k) ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
  return Object.assign(h, { 'Content-Type': 'application/json' }, extra || {});
}

/** GET/POST/PATCH ke REST API Supabase. Return { ok, status, data }. */
async function svc(path, opts) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, opts || {}, { headers: svcHeaders((opts && opts.headers) || {}) }));
  let data = null;
  const txt = await r.text();
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data };
}

module.exports = { svcHeaders, svc };
