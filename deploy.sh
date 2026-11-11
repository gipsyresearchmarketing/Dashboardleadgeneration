#!/bin/bash
# ============================================================
#  Deploy dashboard Leads CRM
#  Jalankan:  ./deploy.sh
#
#  Yang dilakukan:
#   1. Bersihkan .git/index.lock stale (kalau ada proses git jalan, dibatalkan)
#   2. Salin "index (37).html"  ->  index.html   (file yang dipakai Vercel)
#   3. Stage SEMUA perubahan (git add -A) — index disinkronkan dengan isi disk
#   4. GUARD: pastikan file kritis (api/, package.json) MASIH ADA
#   5. Commit + Push -> Vercel auto-deploy
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

# --- 0. Bersihkan .git/index.lock yang nyangkut -----------------------------
# Kalau script sebelumnya ke-kill di tengah, .git/index.lock tertinggal dan
# deploy berikutnya gagal. Hapus HANYA kalau tidak ada proses git yang jalan.
if [ -f .git/index.lock ]; then
  if pgrep -x git >/dev/null 2>&1; then
    echo "❌ Ada proses git yang jalan — tunggu selesai dulu, jangan dihapus lock-nya."
    exit 1
  fi
  echo "→ Membersihkan .git/index.lock (stale, tidak ada proses git)"
  rm -f .git/index.lock
fi

# --- 1. Copy source -> index.html --------------------------------------------
echo "→ Menyalin '$SRC' ke '$DST'..."
cp "$SRC" "$DST"

# --- 2. Stage SEMUA perubahan ------------------------------------------------
# PENTING: script ini DULU cuma `git add` 2 file HTML. Kalau index git kesenggolan
# rusak (mis. sisa `git pull --rebase` yang ke-interrupt), `git commit` tetap
# ng-commit apa pun yang ada di index -> file penting (api/, package.json) HILANG
# dari repo & Vercel -> semua endpoint jadi 404.
# `git add -A` menyinkronkan index dengan isi disk, jadi file yang hilang dari
# index otomatis balik, dan file yang memang dihapus ikut terhapus.
git add -A

# --- 3. GUARD: file kritis harus masih ada di index --------------------------
CRITICAL="api/send-email.js api/brand-settings.js api/email-track.js api/_lib/brand.js package.json vercel.json .gitignore"
MISSING=""
for f in $CRITICAL; do
  git cat-file -e ":$f" 2>/dev/null || MISSING="$MISSING $f"
done
if [ -n "$MISSING" ]; then
  echo "❌ BAHAYA: file ini hilang dari index — commit akan menghapus dari repo:"
  echo "   $MISSING"
  echo "   Restore dulu:  git checkout 01ca7b4 -- <file>"
  exit 1
fi

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

# --- 4. Verifikasi file kritis MASIH ADA di repo -----------------------------
for f in api/send-email.js api/brand-settings.js api/email-track.js package.json vercel.json; do
  if ! git cat-file -e "origin/main:$f" 2>/dev/null; then
    echo "❌ '$f' HILANG dari origin/main setelah push — restore & ulangi!"
    exit 1
  fi
done
echo "✅ File kritis masih lengkap di repo (api/, package.json, vercel.json)"

echo ""
echo "✅ Push selesai. Menunggu Vercel auto-deploy..."

# --- 5. Tunggu deploy + cek app load + cek endpoint API bukan 404 -----------
SITE="https://dashboardleadgeneration.vercel.app"
for i in $(seq 1 15); do
  sleep 12
  if [ -x "./smoke-test.sh" ]; then
    OUT=$(./smoke-test.sh "$SITE" 2>/dev/null)
    case "$OUT" in
      *"❌"*) echo "$OUT"; echo "   (deploy mungkin belum selesai — coba lagi beberapa saat)"; exit 1 ;;
    esac
    # Endpoint API wajib ada (bukan 404) — kalau 404 berarti folder api/ hilang
    API_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$SITE/api/brand-settings" -H 'Content-Type: application/json' -d '{}' || echo 000)
    if [ "$API_CODE" = "404" ]; then
      echo "❌ /api/brand-settings masih 404 — folder api/ belum ter-deploy."
      echo "   Cek di Vercel: Settings > Git > watch build log."
      exit 1
    fi
    echo "✅ Deploy siap & app load dengan benar."
    echo "✅ /api/brand-settings → HTTP $API_CODE (bukan 404)"
    exit 0
  else
    echo "   … masih deploy (percobaan $i)"
  fi
done
echo "   Deploy belum terkonfirmasi. Cek manual: $SITE"
