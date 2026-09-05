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
| `TOKEN_ENCRYPTION_KEY` | **WAJIB** — 64 hex char, lihat langkah 5a di bawah |
| `DATABASE_URL` | `postgres://adpulse:PASSWORD_BARU@localhost:5432/adpulse` |
| `MOCK_ADS` | `false` kalau kredensial ads asli sudah ada; `true` untuk demo |

Variabel hardening v1.1 lain (opsional, default sudah aman): `JWT_ACCESS_TTL`
(default `1h`), `REFRESH_TOKEN_TTL_DAYS` (default `30`), `AUTH_RATE_LIMIT_MAX`
(default `10`/15 menit), `API_RATE_LIMIT_MAX` (default `300`/menit),
`LOG_LEVEL` (default `info`), `SENTRY_DSN` (kosong = Sentry mati).

### 5a. LANGKAH WAJIB — generate `TOKEN_ENCRYPTION_KEY`

Token ads (`ad_accounts.access_token` / `refresh_token`) dienkripsi
**AES-256-GCM** di database. Kuncinya harus 64 karakter hex (32 byte).
**Backend menolak boot dengan `NODE_ENV=production` bila key ini kosong.**

```bash
openssl rand -hex 32
```

Salin hasilnya ke `backend/.env`:

```env
TOKEN_ENCRYPTION_KEY=<hasil openssl rand -hex 32>
```

> **Jangan pernah mengganti key ini setelah ada token tersimpan** — token
> lama tidak bisa didekripsi lagi (akun ads harus dihubungkan ulang).
> Simpan salinan key di password manager bersama backup database.

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

Gunakan script siap pakai [`deploy/backup.sh`](backup.sh): `pg_dump` → gzip ke
`/home/app/backups/adpulse-YYYY-MM-DD.sql.gz` + rotasi otomatis (hapus backup
lebih tua dari 14 hari). Tes manual dulu (sebagai root):

```bash
chmod +x /home/app/adpulse/deploy/backup.sh
/home/app/adpulse/deploy/backup.sh
ls -lh /home/app/backups/    # harus ada adpulse-<tanggal>.sql.gz
```

Lalu jadwalkan tiap jam **03:00** via crontab (sebagai root, `crontab -e`):

```cron
0 3 * * * /home/app/adpulse/deploy/backup.sh >> /home/app/backups/backup.log 2>&1
```

Folder tujuan, nama DB, dan retensi bisa diubah via env `BACKUP_DIR`,
`DB_NAME`, `RETENTION_DAYS` (lihat komentar di dalam script).

Restore kalau dibutuhkan:

```bash
gunzip -c /home/app/backups/adpulse-2026-08-26.sql.gz | sudo -u postgres psql adpulse
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

> **Catatan CI:** repo ini punya GitHub Actions
> ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) yang jalan
> otomatis di tiap push & pull request ke `main` — test backend terhadap
> PostgreSQL 15, build frontend, dan syntax check semua file backend.
> **Deploy hanya bila CI hijau** — cek tab *Actions* di GitHub sebelum
> `git pull` di VPS. (CI tidak men-deploy otomatis; deploy tetap manual
> seperti langkah di atas.)

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

---

## AI Assistant (agent MCP) — v1.2

### 1. Pilih engine LLM

Engine adalah **slot**, bukan vendor tetap. Cukup salah satu:

```bash
# Opsi A — Anthropic (pakai key yang sudah ada untuk insight harian)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-5

# Opsi B — endpoint OpenAI-compatible, mis. OpenRouter
AGENT_ENGINE_URL=https://openrouter.ai/api/v1
AGENT_ENGINE_KEY=sk-or-v1-...
AGENT_ENGINE_MODEL=anthropic/claude-sonnet-4.5
```

`AGENT_PROVIDER=auto` (default) memakai Opsi B bila ketiga env-nya terisi, kalau
tidak jatuh ke Opsi A. Tanpa keduanya, halaman AI Assistant tetap terbuka dan
menampilkan pesan bahwa engine belum diatur — bukan error 500.

### 2. Migrasi tabel baru

```bash
cd /home/app/adpulse/backend && npm run migrate
```

Menambah `agent_conversations` + `agent_messages` (idempoten — `CREATE TABLE IF
NOT EXISTS`, aman dijalankan ulang).

### 3. Server MCP eksternal (opsional)

Daftar servernya di `backend/mcp.json`. Slot `whatsapp` dan `scraper` sudah ada
tapi `"disabled": true` sampai diisi.

> **Jangan pernah menaruh token di `mcp.json`** — file itu ikut ter-commit.
> Pakai `envFrom` (server stdio) atau `headersFrom` (server HTTP) yang menunjuk
> NAMA env var, lalu isi nilainya di `.env`.

Untuk server stdio yang dijalankan lewat `npx`, pastikan node/npm tersedia untuk
user yang menjalankan PM2, dan ingat server MCP adalah **proses anak** — mereka
hanya mewarisi env var yang dideklarasikan di `envFrom`, bukan seluruh `.env`.

Matikan seluruh armada dengan `MCP_DISABLED=true`. Agent tetap jalan penuh
dengan tool AdPulse (data iklan + scraping first-party).

### 4. Verifikasi setelah deploy

```bash
# ?probe=1 memaksa armada MCP benar-benar boot, bukan sekadar membaca env
curl -s -H "Authorization: Bearer <token>" \
  'https://domain-kamu.com/api/agent/health?probe=1' | jq
```

Yang perlu dilihat:
- `engine.configured: true` dan `engine.provider` sesuai yang kamu pilih.
- `mcp.state`: `up` (server tersambung), `empty` (tidak ada server aktif — normal
  kalau semua slot masih disabled), `cold` (belum pernah dinyalakan), atau
  `down` disertai `mcp.error`.

### Troubleshooting

| Gejala | Kemungkinan sebab | Tindakan |
|---|---|---|
| Chat menjawab 503 "Engine AI belum dikonfigurasi" | Tidak ada `ANTHROPIC_API_KEY` maupun `AGENT_ENGINE_*` lengkap | Isi salah satu opsi di atas, restart PM2 |
| Jawaban selalu ditandai "sebagian tool eksternal mati" | Server MCP gagal connect | Cek `mcp.error` di `/api/agent/health?probe=1`; server yang mati tidak menghentikan chat |
| Tool MCP tertentu tidak muncul | Namanya terlihat menulis (`send`/`delete`/...) sehingga tersaring | Tambahkan `"allowedTools": ["nama_tool"]` di entri server tsb — opt-in eksplisit |
| `web_scrape` menolak sebuah URL | Host me-resolve ke alamat internal | Ini guard SSRF bekerja. Jangan set `SCRAPE_ALLOW_PRIVATE_HOSTS=true` di production |
| Jawaban terpotong / tool berhenti di tengah | `AGENT_MAX_ITERATIONS` atau anggaran output tool habis | Naikkan `AGENT_MAX_ITERATIONS` / `AGENT_MAX_TOOL_CHARS_TOTAL`, atau persempit pertanyaan |
