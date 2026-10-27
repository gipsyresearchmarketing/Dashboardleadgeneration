#!/bin/bash
# ============================================================
#  Deploy dashboard Leads CRM
#  Jalankan:  ./deploy.sh
#
#  Yang dilakukan:
#   1. Salin "index (37).html"  ->  index.html   (file yang dipakai Vercel)
#   2. Commit
#   3. Push ke GitHub
#   4. Vercel otomatis deploy
# ============================================================
set -e
cd "$(dirname "$0")"

SRC="index (37).html"
DST="index.html"

if [ ! -f "$SRC" ]; then
  echo "❌ File sumber '$SRC' tidak ditemukan di $(pwd)"
  echo "   Kalau lo edit langsung di GitHub, abaikan script ini."
  exit 1
fi

echo "→ Menyalin '$SRC' ke '$DST'..."
cp "$SRC" "$DST"

git add "$DST" "$SRC" 2>/dev/null || git add "$DST"

if git diff --cached --quiet; then
  echo "✅ Tidak ada perubahan — semua sudah sama dengan yang di GitHub."
  exit 0
fi

echo "→ Commit..."
git commit -q -m "Update dashboard: $(date '+%Y-%m-%d %H:%M')"

echo "→ Sync dengan GitHub..."
if ! git pull --rebase origin main; then
  echo ""
  echo "⚠️  Konflik. Pilih salah satu:"
  echo "   - Simpan perubahan lo : git rebase --continue  (lalu ketik pesan commit)"
  echo "   - Batalkan            : git rebase --abort"
  exit 1
fi

echo "→ Push..."
git push origin main

echo ""
echo "✅ Push selesai. Menunggu Vercel auto-deploy..."

# Tunggu deploy, lalu cek app-nya beneran load (tangkap error runtime)
SITE="https://dashboardleadgeneration.vercel.app"
for i in $(seq 1 15); do
  sleep 12
  if [ -x "./smoke-test.sh" ]; then
    OUT=$(./smoke-test.sh "$SITE" 2>/dev/null)
    case "$OUT" in
      *"✅"*) echo "✅ Deploy siap & app load dengan benar."; exit 0 ;;
      *"❌"*) echo "$OUT"; echo "   (deploy mungkin belum selesai — coba lagi beberapa saat)"; exit 1 ;;
    esac
  else
    echo "   … masih deploy (percobaan $i)"
  fi
done
echo "   Deploy belum terkonfirmasi. Cek manual: $SITE"
