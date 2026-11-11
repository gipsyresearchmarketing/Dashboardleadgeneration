#!/usr/bin/env osascript
// ============================================================
//  Validasi syntax JS dashboard pake JavaScriptCore (engine JS beneran).
//  Dipakai buat ngecek file还没 di-push / catch error sebelum deploy.
//
//  Pakai:  node tidak perlu — cukup:  ./validate-js.js
//  Output: ✅ SYNTAX VALID  /  ❌ pesan error
//
//  Catatan: ini tool BANGUNAN LOKAL. Nggak影响 aplikasi yang jalan di production.
// ============================================================
ObjC.import('Foundation');

function readFile(p){ return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }

// Path relatif ke lokasi file ini
var here = $.NSString.stringWithString($.NSProcessInfo.processInfo.environment.objectForKey('PWD')).js;
var base = $.NSString.stringWithString(readFile('/dev/stdin') || '').js;

function dirname(p){ var i = p.lastIndexOf('/'); return i < 0 ? '.' : p.slice(0, i); }

// Cari root project (ada folder 'api' di dalamnya)
function findRoot(start){
  var dir = start, tries = 0;
  while (tries < 6) {
    var ap = dir + '/api';
    if ($.NSFileManager.defaultManager.fileExistsAtPathIsDirectory($(ap).js, true)) return dir;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent; tries++;
  }
  return start;
}

var root = findRoot(here);

function check(rel, extractAppSrc){
  var file = root + '/' + rel;
  if (!$.NSFileManager.defaultManager.fileExistsAtPathIsDirectory($(file).js, true)) {
    console.log('⏭  ' + rel + ' (tidak ada, dilewati)');
    return;
  }
  var src = readFile(file);
  if (extractAppSrc) {
    var m = src.match(/<script type="text\/plain" id="app-src">([\s\S]*?)<\/script>/);
    if (!m) { console.log('❌ ' + rel + ': app-src tidak ditemukan'); return; }
    src = m[1];
  }
  try { new Function(src); console.log('✅ ' + rel + ' — SYNTAX VALID'); }
  catch (e) { console.log('❌ ' + rel + ' — ' + e); }
}

globalThis.process = { env: {} };
globalThis.Buffer = { from: function(){ return {}; } };
globalThis.fetch = async function(){ return { json: async function(){ return []; } }; };
globalThis.module = { exports: {} };
globalThis.require = function(){ return {}; };

console.log('Root project: ' + root + '\n');
['api/img.js','api/brand-settings.js','api/send-email.js','api/send-wa.js','api/email-track.js',
 'api/_lib/wa.js','api/_lib/brand.js','index (37).html','index.html'
].forEach(function(f){ check(f, /\.html$/.test(f)); });
