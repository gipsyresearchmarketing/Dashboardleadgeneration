// Validasi syntax JS file2 dashboard pake JavaScriptCore (engine JS beneran, bukan parser karangan).
ObjC.import('Foundation');
function readFile(p){ return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
function check(file, extractAppSrc) {
  var src = readFile(file);
  if (extractAppSrc) {
    var m = src.match(/<script type="text\/plain" id="app-src">([\s\S]*?)<\/script>/);
    if (!m) { console.log('❌ ' + file + ': app-src tidak ditemukan'); return; }
    src = m[1];
  }
  try { new Function(src); console.log('✅ ' + file + ' — SYNTAX VALID'); }
  catch (e) { console.log('❌ ' + file + ' — ' + e); }
}
var base = '/Users/bagas/Documents/Dashboard leads generation/';
globalThis.process = { env: {} };
globalThis.Buffer = { from: function(){ return {}; } };
globalThis.fetch = async function(){ return { json: async function(){ return []; } }; };
globalThis.module = { exports: {} };
globalThis.require = function(){ return {}; };
check(base + 'api/img.js', false);
check(base + 'api/brand-settings.js', false);
check(base + 'api/send-email.js', false);
check(base + 'api/_lib/wa.js', false);
check(base + 'api/_lib/brand.js', false);
check(base + 'index (37).html', true);
