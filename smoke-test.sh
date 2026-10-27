#!/bin/bash
# Smoke test dashboard: buka halaman di Chrome headless, tunggu JS jalan,
# lalu cek apakah app load tanpa error runtime.
#
# Pakai:  ./smoke-test.sh [url]
# Default: https://dashboardleadgeneration.vercel.app
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="${1:-https://dashboardleadgeneration.vercel.app}"
OUT="$(mktemp)"

"$CHROME" --headless --disable-gpu --virtual-time-budget=8000 \
  --user-data-dir="$(mktemp -d)" \
  --dump-dom "$URL" > "$OUT" 2>/dev/null

# Buang isi <script>...</script> supaya string di source code tidak dianggap error.
python3 - "$OUT" << 'PY'
import re, sys
h = open(sys.argv[1], encoding='utf-8', errors='replace').read()
body = re.sub(r'(?is)<script\b.*?</script>', ' ', h)
if 'App failed to load' in body:
    m = re.search(r'(?is)App failed to load.*?<pre[^>]*>(.*?)</pre>', body)
    err = re.sub(r'<[^>]+>', ' ', m.group(1)) if m else '(pesan tidak terbaca)'
    print('❌ APP GAGAL LOAD:', ' '.join(err.split())[:300])
elif 'Leads CRM' in body:
    print('✅ APP LOAD OK — tidak ada error load')
else:
    print('⚠️  Halaman ter-load tapi app belum render (cek login/network)')
PY

rm -f "$OUT"
