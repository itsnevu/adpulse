#!/usr/bin/env bash
# ==========================================================================
# AdPulse — Setup VPS baru (Ubuntu 22.04)
#
# Menyiapkan: Nginx, PostgreSQL, Node.js 20, PM2, Certbot,
# role + database PostgreSQL "adpulse", dan folder /home/app.
#
# Jalankan sebagai root (atau user dengan sudo):
#   sudo bash setup-vps.sh
#
# Script ini idempotent: aman dijalankan ulang — langkah yang sudah
# selesai akan dilewati.
# ==========================================================================
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Jalankan script ini sebagai root: sudo bash setup-vps.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> [1/7] Update paket & install dependensi dasar..."
apt-get update -y
apt-get install -y curl git nginx postgresql postgresql-contrib \
  certbot python3-certbot-nginx

echo "==> [2/7] Install Node.js 20 (NodeSource)..."
if command -v node >/dev/null 2>&1 && node --version | grep -q '^v20\.'; then
  echo "    Node.js 20 sudah terpasang ($(node --version)) — lewati."
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    node: $(node --version) | npm: $(npm --version)"

echo "==> [3/7] Install PM2 (global)..."
if command -v pm2 >/dev/null 2>&1; then
  echo "    PM2 sudah terpasang ($(pm2 --version)) — lewati."
else
  npm install -g pm2
fi

echo "==> [4/7] Pastikan PostgreSQL berjalan..."
systemctl enable --now postgresql

echo "==> [5/7] Buat role & database PostgreSQL 'adpulse' (skip jika sudah ada)..."
# Password default 'adpulse' — WAJIB diganti untuk produksi:
#   sudo -u postgres psql -c "ALTER ROLE adpulse WITH PASSWORD 'password-baru';"
# lalu samakan DATABASE_URL di backend/.env.
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='adpulse'" | grep -q 1; then
  echo "    Role 'adpulse' sudah ada — lewati."
else
  sudo -u postgres psql -c "CREATE ROLE adpulse WITH LOGIN PASSWORD 'adpulse';"
fi
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='adpulse'" | grep -q 1; then
  echo "    Database 'adpulse' sudah ada — lewati."
else
  sudo -u postgres createdb -O adpulse adpulse
fi

echo "==> [6/7] Siapkan folder aplikasi /home/app..."
mkdir -p /home/app

echo "==> [7/7] Selesai! Langkah selanjutnya (manual):"
cat <<'NEXT'

  ================= LANGKAH SELANJUTNYA =================
  1. Clone repo:
       cd /home/app && git clone <URL_REPO_KAMU> adpulse
  2. Konfigurasi env backend:
       cp /home/app/adpulse/.env.example /home/app/adpulse/backend/.env
       nano /home/app/adpulse/backend/.env
       (set NODE_ENV=production, JWT_SECRET acak, DATABASE_URL,
        ANTHROPIC_API_KEY, kredensial ads, SMTP — lihat deploy/DEPLOYMENT.md)
  3. Install, migrate, seed:
       cd /home/app/adpulse/backend && npm install && npm run migrate && npm run seed
       cd /home/app/adpulse/frontend && npm install && npm run build
  4. Start proses via PM2:
       pm2 start /home/app/adpulse/deploy/ecosystem.config.js
       pm2 save && pm2 startup
  5. Pasang Nginx:
       cp /home/app/adpulse/deploy/nginx.conf /etc/nginx/sites-available/adpulse
       (edit: ganti "ganti-domain.com" dengan domain asli)
       ln -sf /etc/nginx/sites-available/adpulse /etc/nginx/sites-enabled/adpulse
       nginx -t && systemctl reload nginx
  6. SSL gratis via certbot:
       certbot --nginx -d domain-kamu.com -d www.domain-kamu.com
  7. GANTI password DB default 'adpulse' (lihat komentar di script ini).
  =======================================================

NEXT
