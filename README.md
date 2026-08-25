# AdPulse

**AdPulse** adalah platform analitik iklan yang menyatukan performa **Google Ads**
dan **Meta Ads** (LinkedIn Ads menyusul di Phase 2) ke dalam satu dashboard,
lengkap dengan **AI insight** bertenaga Claude API dan **email ringkasan harian**
— sehingga tim marketing bisa melihat spend, CTR, CPC, dan konversi lintas
platform tanpa membuka banyak tab, plus rekomendasi optimasi otomatis.

## Arsitektur

```
 ┌────────────┐   ┌────────────┐
 │ Google Ads │   │  Meta Ads  │        (LinkedIn Ads — Phase 2)
 │    API     │   │    API     │
 └─────┬──────┘   └─────┬──────┘
       │                │
       ▼                ▼
 ┌─────────────────────────────┐
 │  Sync jobs (node-cron di    │  MOCK_ADS=true → data sample
 │  dalam backend, per 4 jam)  │  deterministik tanpa API key
 └─────────────┬───────────────┘
               ▼
 ┌─────────────────────────────┐      ┌──────────────────┐
 │        PostgreSQL 15        │─────▶│  Insight engine  │
 │ (accounts, campaigns,       │      │   + Claude API   │
 │  metrics_daily, insights)   │      └────────┬─────────┘
 └─────────────┬───────────────┘               │
               ▼                               ▼
 ┌─────────────────────────────┐      ┌──────────────────┐
 │   Express API (:4000/api)   │      │  Email harian    │
 └─────────────┬───────────────┘      │  (SMTP, cron)    │
               ▼                      └──────────────────┘
 ┌─────────────────────────────┐
 │ Next.js dashboard (:3000)   │
 └─────────────────────────────┘
```

## Fitur

- **Dashboard terpadu** — spend, impressions, clicks, conversions, CTR, CPC, CPM
  lintas platform dengan perbandingan periode (delta %).
- **Timeseries & breakdown per platform** — grafik harian per metrik,
  filter tanggal dan platform.
- **Manajemen campaign** — daftar campaign dengan agregat metrik 30 hari,
  filter status/platform/pencarian.
- **Sync otomatis** — tarik data Google Ads & Meta Ads terjadwal (per 4 jam,
  bisa diubah via `SYNC_CRON`) + sync manual per platform, lengkap dengan log.
- **AI Insight (Claude)** — ringkasan performa + rekomendasi optimasi
  `[{title, detail, impact}]`; fallback teks canned bila API key kosong.
- **Email insight harian** — dikirim via SMTP terjadwal (`INSIGHT_EMAIL_CRON`),
  tercatat di `email_logs`.
- **Mock mode** — `MOCK_ADS=true` menghasilkan data sample deterministik agar
  demo end-to-end jalan tanpa kredensial ads asli.
- **Auth JWT** — register/login, token expiry 7 hari.

## Struktur folder

```
adpulse/
├── backend/            # Express API (Node 20, CommonJS) — port 4000
├── frontend/           # Next.js App Router (JS/JSX) + Tailwind — port 3000
├── database/
│   └── schema.sql      # Source of truth skema PostgreSQL
├── deploy/
│   ├── nginx.conf            # Reverse proxy (/api → 4000, / → 3000)
│   ├── ecosystem.config.js   # PM2 (backend + frontend)
│   ├── setup-vps.sh          # Setup VPS Ubuntu 22.04 dari nol
│   └── DEPLOYMENT.md         # Panduan deploy lengkap
├── docs/
│   └── CONTRACT.md     # Kontrak endpoint/env/konvensi antar komponen
├── docker-compose.yml  # PostgreSQL untuk dev lokal
└── .env.example        # Template semua environment variable
```

## Quickstart lokal

Prasyarat: Node.js 20+, Docker (untuk PostgreSQL).

```bash
# a. Jalankan database
docker compose up -d db

# b. Backend (terminal 1)
cd backend
npm install
npm run migrate
npm run seed
npm run dev          # http://localhost:4000

# c. Frontend (terminal 2)
cd frontend
npm install
npm run dev          # http://localhost:3000
```

d. Buka **http://localhost:3000** dan login dengan akun demo:

> email: `demo@adpulse.io` — password: `demo1234`

**Catatan:** default `MOCK_ADS=true`, artinya data sync berasal dari generator
sample deterministik — **tidak perlu API key** Google/Meta untuk mencoba semua
fitur, termasuk sync dan insight (insight AI butuh `ANTHROPIC_API_KEY`;
tanpa itu dipakai teks fallback).

## Environment penting

Salin `.env.example` → `backend/.env`, lalu isi. Ringkasan variabel utama:

| Variabel | Fungsi | Wajib? |
|---|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL | Ya |
| `JWT_SECRET` | Signing token auth | Ya (ganti default!) |
| `PORT` | Port backend (default 4000) | Ya |
| `MOCK_ADS` | `true` = data sample tanpa API key | Ya (default `true`) |
| `ANTHROPIC_API_KEY` | AI insight via Claude | Opsional (fallback canned) |
| `CLAUDE_MODEL` | Model Claude yang dipakai | Opsional |
| `GOOGLE_ADS_*` | Kredensial Google Ads API | Hanya jika `MOCK_ADS=false` |
| `META_*` | Kredensial Meta Marketing API | Hanya jika `MOCK_ADS=false` |
| `SMTP_*`, `EMAIL_FROM` | Email insight harian | Opsional (skip jika kosong) |
| `SYNC_CRON` | Jadwal sync ads (default per 4 jam) | Opsional |
| `INSIGHT_EMAIL_CRON` | Jadwal email insight (default 12:00) | Opsional |
| `NEXT_PUBLIC_API_URL` | Base URL API untuk frontend | Ya (default `http://localhost:4000`) |

Daftar lengkap + nilai default ada di [`.env.example`](.env.example)
(khusus `NEXT_PUBLIC_API_URL` untuk frontend: salin
[`frontend/.env.local.example`](frontend/.env.local.example) → `frontend/.env.local`).

## Dokumentasi

- **Kontrak API & konvensi antar komponen:** [`docs/CONTRACT.md`](docs/CONTRACT.md)
- **Panduan deploy produksi (VPS, Nginx, PM2, SSL, backup):**
  [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md)

## Roadmap — Phase 2

- **LinkedIn Ads** — platform ketiga (skema DB sudah menyiapkannya).
- **OAuth self-service** — client menghubungkan akun ads sendiri tanpa
  copy-paste token manual.
- **Multi-tenant** — satu instance melayani banyak organisasi/agency
  dengan isolasi data.
- **Clustering ML** — pengelompokan campaign otomatis berdasarkan pola
  performa untuk insight yang lebih tajam.
