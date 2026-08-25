# AdPulse — Panduan Deploy ke VPS (Ubuntu 22.04)

Panduan langkah demi langkah men-deploy AdPulse dari nol sampai live dengan
HTTPS, cron otomatis, backup harian, dan monitoring.

Arsitektur produksi:

```
Internet ──HTTPS──> Nginx ──/api──> Express backend (PM2, :4000) ──> PostgreSQL (VPS)
                      └────/─────> Next.js frontend (PM2, :3000)
```

> Semua perintah di bawah dijalankan di VPS sebagai root (atau via `sudo`),
> kecuali disebutkan lain.

---

## 1. Sewa VPS

Spesifikasi minimum yang disarankan:

| Komponen | Minimum | Catatan |
|---|---|---|
| CPU | 2 vCPU | Next.js build butuh CPU |
| RAM | 4 GB | 2 GB bisa, tapi build frontend bisa gagal |
| Disk | 40 GB SSD | DB metrik tumbuh pelan (harian per campaign) |
| OS | Ubuntu 22.04 LTS | Script setup ditulis untuk versi ini |

Penyedia populer: DigitalOcean, Vultr, Hetzner, Contabo, IDCloudHost / Biznet
(lokal Indonesia). Pilih region terdekat dengan pengguna.

Setelah VPS aktif, catat **alamat IP publik**-nya dan pastikan bisa SSH:

```bash
ssh root@IP_VPS_KAMU
```

## 2. Arahkan DNS

Di panel domain kamu (Cloudflare, Niagahoster, dsb.), buat **A record**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | IP VPS kamu | Auto/300 |
| A | `www` | IP VPS kamu | Auto/300 |

Tunggu propagasi (biasanya < 15 menit). Cek dengan:

```bash
dig +short domain-kamu.com
```

Harus mengembalikan IP VPS. **Certbot (langkah 8) butuh DNS sudah mengarah.**

## 3. Jalankan setup-vps.sh

Salin script setup ke VPS lalu jalankan:

```bash
# dari laptop kamu
scp deploy/setup-vps.sh root@IP_VPS_KAMU:/root/

# di VPS
sudo bash /root/setup-vps.sh
```

Script ini meng-install Nginx, PostgreSQL, Node.js 20, PM2, Certbot, membuat
role + database `adpulse`, dan folder `/home/app`. Aman dijalankan ulang.

> **PENTING:** password database default adalah `adpulse`. Ganti untuk produksi:
>
> ```bash
> sudo -u postgres psql -c "ALTER ROLE adpulse WITH PASSWORD 'password-kuat-baru';"
> ```
>
> lalu sesuaikan `DATABASE_URL` di `.env` (langkah 5).

## 4. Clone repo

```bash
cd /home/app
git clone <URL_REPO_KAMU> adpulse
```

## 5. Isi .env dari .env.example

```bash
cp /home/app/adpulse/.env.example /home/app/adpulse/backend/.env
nano /home/app/adpulse/backend/.env
```

Nilai yang **wajib** diubah untuk produksi:

| Variabel | Isi |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://domain-kamu.com` |
| `JWT_SECRET` | string acak panjang — generate: `openssl rand -hex 32` |
| `DATABASE_URL` | `postgres://adpulse:PASSWORD_BARU@localhost:5432/adpulse` |
| `MOCK_ADS` | `false` kalau kredensial ads asli sudah ada; `true` untuk demo |

### Cara mendapatkan tiap kredensial

**Google Ads** (`GOOGLE_ADS_*`)
1. Buat project di [Google Cloud Console](https://console.cloud.google.com) →
   aktifkan **Google Ads API** → buat OAuth Client (type: Web/Desktop) →
   dapat `GOOGLE_ADS_CLIENT_ID` dan `GOOGLE_ADS_CLIENT_SECRET`.
2. Login ke akun **Google Ads Manager (MCC)** → Tools & Settings →
   **API Center** → ajukan **Developer Token** (`GOOGLE_ADS_DEVELOPER_TOKEN`).
   Token baru berstatus *test* — ajukan *basic access* agar bisa membaca akun
   produksi (review Google 1–3 hari kerja).
3. Lakukan OAuth consent sekali (mis. via [OAuth Playground](https://developers.google.com/oauthplayground)
   dengan scope `https://www.googleapis.com/auth/adwords`) untuk mendapatkan
   `GOOGLE_ADS_REFRESH_TOKEN`.
4. `GOOGLE_ADS_CUSTOMER_ID` = ID akun Google Ads client (10 digit, tanpa tanda minus).

**Meta Ads** (`META_*`)
1. Buat app tipe **Business** di [developers.facebook.com](https://developers.facebook.com)
   → dapat `META_APP_ID` dan `META_APP_SECRET`.
2. Tambahkan produk **Marketing API** ke app.
3. Buat **System User** di Meta Business Suite → assign ke ad account dengan
   permission `ads_read` → generate token **long-lived** → `META_ACCESS_TOKEN`.
4. `META_AD_ACCOUNT_ID` = ID ad account dengan prefix `act_` (contoh: `act_1234567890`).

**Claude AI** (`ANTHROPIC_API_KEY`)
1. Daftar di [console.anthropic.com](https://console.anthropic.com) →
   menu **API Keys** → Create Key → salin ke `ANTHROPIC_API_KEY`.
2. Biarkan `CLAUDE_MODEL` sesuai default di `.env.example`.
3. Kalau dikosongkan, fitur insight tetap jalan dengan teks fallback (tanpa AI).

**SMTP** (`SMTP_*`, `EMAIL_FROM`) — untuk email insight harian
- Opsi mudah: [Brevo](https://www.brevo.com) / [Mailgun](https://www.mailgun.com) /
  [Resend](https://resend.com) — gratis untuk volume kecil. Ambil host, port
  (587), username, dan password SMTP dari dashboard masing-masing.
- Opsi Gmail: aktifkan 2FA → buat **App Password** → `SMTP_HOST=smtp.gmail.com`,
  `SMTP_PORT=587`, `SMTP_USER=email kamu`, `SMTP_PASS=app password`.
- `EMAIL_FROM` = alamat pengirim, mis. `insights@domain-kamu.com`.
- Kalau SMTP kosong, pengiriman email dilewati (dicatat di `email_logs`).

## 6. Migrate + seed database

```bash
cd /home/app/adpulse/backend
npm install
npm run migrate     # membuat tabel dari database/schema.sql
npm run seed        # akun demo demo@adpulse.io / demo1234 + data sample
```

Lalu build frontend:

```bash
cd /home/app/adpulse/frontend
npm install
npm run build
```

> Frontend memakai `NEXT_PUBLIC_API_URL`. Di produksi dengan Nginx satu domain,
> set ke `https://domain-kamu.com` (buat `frontend/.env.local` berisi
> `NEXT_PUBLIC_API_URL=https://domain-kamu.com` **sebelum** `npm run build`).

## 7. Start dengan PM2

```bash
pm2 start /home/app/adpulse/deploy/ecosystem.config.js
pm2 save                 # simpan daftar proses
pm2 startup              # jalankan perintah yang dicetak agar auto-start saat reboot
pm2 status               # keduanya harus "online"
```

Catatan: **cron sync & email berjalan di dalam proses backend** (node-cron,
env `SYNC_CRON` dan `INSIGHT_EMAIL_CRON`) — tidak ada proses cron terpisah.

## 8. Nginx + SSL (certbot)

```bash
cp /home/app/adpulse/deploy/nginx.conf /etc/nginx/sites-available/adpulse
nano /etc/nginx/sites-available/adpulse   # ganti semua "ganti-domain.com"
ln -sf /etc/nginx/sites-available/adpulse /etc/nginx/sites-enabled/adpulse
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# SSL gratis Let's Encrypt (auto-renew via systemd timer)
certbot --nginx -d domain-kamu.com -d www.domain-kamu.com
```

Buka `https://domain-kamu.com` — halaman login AdPulse harus muncul.

## 9. Verifikasi

```bash
# API sehat?
curl -s https://domain-kamu.com/api/health
# → {"data":{"status":"ok"}}

# Proses jalan?
pm2 status

# Cron sync jalan? (lihat log backend saat jadwal SYNC_CRON tiba,
# atau paksa sync sekarang dari dashboard / API)
pm2 logs adpulse-backend --lines 100
```

Login dengan akun demo (`demo@adpulse.io` / `demo1234`), buka menu **Sync**,
jalankan sync manual, dan pastikan muncul di **Sync Logs**.

## 10. Backup harian database

Buat script + jadwal crontab (sebagai root):

```bash
mkdir -p /home/app/backups
crontab -e
```

Tambahkan baris ini (backup tiap jam 02:00, simpan 14 hari terakhir):

```cron
0 2 * * * sudo -u postgres pg_dump adpulse | gzip > /home/app/backups/adpulse-$(date +\%F).sql.gz && find /home/app/backups -name 'adpulse-*.sql.gz' -mtime +14 -delete
```

Restore kalau dibutuhkan:

```bash
gunzip -c /home/app/backups/adpulse-2026-08-25.sql.gz | sudo -u postgres psql adpulse
```

> Saran: sinkronkan folder `/home/app/backups` ke object storage
> (S3/Backblaze/Spaces) via `rclone` agar backup tidak ikut hilang bila VPS rusak.

## 11. Monitoring (UptimeRobot)

1. Daftar gratis di [uptimerobot.com](https://uptimerobot.com).
2. Add New Monitor → type **HTTP(s)** →
   URL: `https://domain-kamu.com/api/health` → interval 5 menit.
3. Tambahkan alert contact (email/Telegram) agar diberi tahu saat down.

## 12. Update aplikasi (rilis baru)

```bash
cd /home/app/adpulse
git pull
cd backend && npm install && npm run migrate
cd ../frontend && npm install && npm run build
pm2 restart adpulse-backend adpulse-frontend
```

---

## Troubleshooting umum

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `502 Bad Gateway` | Backend/frontend mati | `pm2 status`, lalu `pm2 logs <nama-app>` untuk lihat error |
| `/api/health` gagal tapi `pm2 status` online | Port bentrok / backend listen di port lain | Pastikan `PORT=4000` di `.env`, cek `ss -tlnp \| grep 4000` |
| Login gagal / token invalid setelah deploy ulang | `JWT_SECRET` berubah | Wajar — semua user login ulang. Jangan ganti-ganti `JWT_SECRET` |
| `password authentication failed for user "adpulse"` | `DATABASE_URL` tidak cocok dengan password role | Samakan password: `ALTER ROLE adpulse WITH PASSWORD '...'` |
| Sync error `MOCK_ADS=false` tapi kredensial kosong | Kredensial ads belum diisi | Isi env Google/Meta, atau set `MOCK_ADS=true` untuk demo |
| Email insight tidak terkirim | SMTP kosong / salah | Cek tabel `email_logs` (kolom `error`), tes kredensial SMTP |
| Certbot gagal `NXDOMAIN` / challenge failed | DNS belum propagasi / A record salah | Tunggu propagasi, cek `dig +short domain-kamu.com` |
| Frontend build gagal `JavaScript heap out of memory` | RAM kurang | Tambah swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| Backend restart terus (PM2 `restarting`) | Error saat start (env kurang, DB down) | `pm2 logs adpulse-backend`, perbaiki `.env`, `pm2 restart` |
| Disk penuh | Log PM2 / backup menumpuk | `pm2 install pm2-logrotate`; pastikan `find ... -delete` di cron backup jalan |

Kalau masih buntu: `pm2 logs` + `journalctl -u nginx -n 50` biasanya cukup
untuk menemukan akar masalah.
