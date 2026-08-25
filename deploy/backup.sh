#!/usr/bin/env bash
# ==========================================================================
# AdPulse — backup harian PostgreSQL (pg_dump | gzip) + rotasi otomatis.
#
# Output : /home/app/backups/adpulse-YYYY-MM-DD.sql.gz
# Rotasi : hapus file backup lebih tua dari 14 hari.
#
# Contoh crontab (jam 03:00 tiap hari, sebagai root — `crontab -e`):
#
#   0 3 * * * /home/app/adpulse/deploy/backup.sh >> /home/app/backups/backup.log 2>&1
#
# Konfigurasi via environment (semua opsional):
#   BACKUP_DIR      folder tujuan          (default /home/app/backups)
#   DB_NAME         nama database          (default adpulse)
#   RETENTION_DAYS  umur maksimum backup   (default 14)
#   DATABASE_URL    bila di-set, dipakai langsung oleh pg_dump — berguna
#                   untuk DB remote / Docker. Bila kosong dan script jalan
#                   sebagai root, dump lewat `sudo -u postgres` (peer auth).
#
# Restore:
#   gunzip -c /home/app/backups/adpulse-2026-08-26.sql.gz | sudo -u postgres psql adpulse
# ==========================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/app/backups}"
DB_NAME="${DB_NAME:-adpulse}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

STAMP="$(date +%F)"
OUTFILE="${BACKUP_DIR}/adpulse-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] $(date '+%F %T') mulai — database '${DB_NAME}' → ${OUTFILE}"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Koneksi eksplisit (remote / Docker / password auth).
  pg_dump "$DATABASE_URL" | gzip > "$OUTFILE"
elif [[ "$(id -u)" -eq 0 ]] && id postgres >/dev/null 2>&1; then
  # Jalan sebagai root di VPS: pakai peer auth user postgres.
  sudo -u postgres pg_dump "$DB_NAME" | gzip > "$OUTFILE"
else
  # Fallback: user saat ini punya akses langsung ke database.
  pg_dump "$DB_NAME" | gzip > "$OUTFILE"
fi

echo "[backup] tersimpan: ${OUTFILE} ($(du -h "$OUTFILE" | cut -f1))"

# Rotasi: hapus backup lebih tua dari RETENTION_DAYS hari.
DELETED="$(find "$BACKUP_DIR" -name 'adpulse-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
echo "[backup] rotasi: ${DELETED} file lama (>${RETENTION_DAYS} hari) dihapus."
echo "[backup] $(date '+%F %T') selesai."
