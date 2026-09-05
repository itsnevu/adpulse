# AdPulse

[![CI](https://github.com/itsnevu/adpulse/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/itsnevu/adpulse/actions/workflows/ci.yml)

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
- **AI Assistant (agent MCP)** — satu kotak chat yang bisa membaca data AdPulse,
  menarik metrik live Google/Meta Ads, membaca halaman web, dan memanggil tool
  MCP eksternal (slot WhatsApp). Setiap jawaban menyimpan jejak tool apa yang
  dipakai, jadi angkanya bisa ditelusuri.
- **Auth JWT + refresh token** — register/login/logout, lupa & reset password;
  access token berumur pendek (`JWT_ACCESS_TTL`, default 1 jam) + refresh token
  httpOnly cookie dengan single-use rotation (lihat [Keamanan](#keamanan-v11)).

## Struktur folder

```
adpulse/
├── .github/
│   └── workflows/
│       └── ci.yml      # CI: test backend + build frontend + syntax check
├── backend/            # Express API (Node 20, CommonJS) — port 4000
│   ├── mcp.json        # Server MCP eksternal (slot WhatsApp & scraper)
│   └── Dockerfile      # Image backend (profile "full")
├── frontend/           # Next.js App Router (JS/JSX) + Tailwind — port 3000
│   └── Dockerfile      # Image frontend multi-stage (profile "full")
├── database/
│   └── schema.sql      # Source of truth skema PostgreSQL
├── deploy/
│   ├── nginx.conf            # Reverse proxy (/api → 4000, / → 3000)
│   ├── ecosystem.config.js   # PM2 (backend + frontend)
│   ├── setup-vps.sh          # Setup VPS Ubuntu 22.04 dari nol
│   ├── backup.sh             # Backup harian pg_dump + rotasi 14 hari
│   └── DEPLOYMENT.md         # Panduan deploy lengkap
├── docs/
│   └── CONTRACT.md     # Kontrak endpoint/env/konvensi antar komponen
├── docker-compose.yml  # PostgreSQL untuk dev lokal (+ profile "full")
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

### Alternatif: seluruh stack via Docker (profile `full`)

Tidak mau menjalankan `npm run dev` manual? Seluruh stack (db + backend +
frontend) bisa jalan dalam Docker:

```bash
cp .env.example .env                          # sekali, isi minimal JWT_SECRET
docker compose --profile full up -d --build
docker compose exec backend npm run migrate   # sekali (buat tabel)
docker compose exec backend npm run seed      # sekali (akun demo + data sample)
```

Frontend di **http://localhost:3000**, API di **http://localhost:4000**.
Perintah default `docker compose up -d db` tetap hanya menjalankan PostgreSQL
seperti sebelumnya. Matikan semuanya: `docker compose --profile full down`.

## Environment penting

Salin `.env.example` → `backend/.env`, lalu isi. Ringkasan variabel utama:

| Variabel | Fungsi | Wajib? |
|---|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL | Ya |
| `JWT_SECRET` | Signing token auth | Ya (ganti default!) |
| `TOKEN_ENCRYPTION_KEY` | Enkripsi AES-256-GCM token ads di DB (64 hex) | Wajib di production — `openssl rand -hex 32` |
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
| `AGENT_PROVIDER` | Engine agent: `auto`/`anthropic`/`openai` | Opsional (default `auto`) |
| `AGENT_ENGINE_URL/_KEY/_MODEL` | Slot endpoint OpenAI-compatible (mis. OpenRouter) | Opsional |
| `MCP_DISABLED` | Matikan seluruh armada MCP eksternal | Opsional (default `false`) |

Daftar lengkap + nilai default ada di [`.env.example`](.env.example)
(khusus `NEXT_PUBLIC_API_URL` untuk frontend: salin
[`frontend/.env.local.example`](frontend/.env.local.example) → `frontend/.env.local`).

## Keamanan (v1.1)

Hardening update v1.1 menambahkan (detail lengkap di
[`docs/CONTRACT.md`](docs/CONTRACT.md) section *v1.1 — Hardening Update*):

- **Refresh token rotation** — access token JWT berumur pendek
  (`JWT_ACCESS_TTL`, default 1 jam); refresh token di httpOnly cookie
  `adpulse_rt` (hash sha256 di DB), **single-use**: tiap refresh menerbitkan
  token baru dan me-revoke yang lama. Reuse token yang sudah di-revoke =
  indikasi pencurian → semua refresh token user langsung di-revoke.
- **Lupa / reset password** — `POST /api/auth/forgot` + `/reset`; respons
  selalu sama (anti user-enumeration), token single-use berumur 60 menit,
  link dikirim via email (atau di-log ke console bila SMTP kosong).
- **Validasi zod** — semua body & query divalidasi; gagal → **422** dengan
  `details: [{path, message}]`. Password minimal 8 karakter.
- **Rate limiting** — endpoint auth max `AUTH_RATE_LIMIT_MAX` (default 10)
  per 15 menit per IP; seluruh `/api` max `API_RATE_LIMIT_MAX` (default 300)
  per menit per IP → **429**.
- **Enkripsi token ads** — `access_token`/`refresh_token` akun ads dienkripsi
  **AES-256-GCM** dengan `TOKEN_ENCRYPTION_KEY` (64 hex, generate:
  `openssl rand -hex 32`; wajib saat `NODE_ENV=production`). Field token
  tidak pernah dikembalikan oleh API.
- **helmet + CORS ketat** — security headers aktif; CORS hanya untuk
  `APP_URL` + `localhost:3000` dengan `credentials: true`.
- **Logging terstruktur** — pino + pino-http (`LOG_LEVEL`); Sentry opsional
  via `SENTRY_DSN`.

## Testing & CI

**Test backend** (node:test + supertest) memakai database terpisah
`adpulse_test` via `DATABASE_URL_TEST` — dibuat otomatis bila belum ada:

```bash
docker compose up -d db   # PostgreSQL harus jalan
cd backend
npm test
```

**CI (GitHub Actions)** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
jalan otomatis di tiap push & pull request ke `main`, tiga job paralel:

| Job | Isi |
|---|---|
| `backend` | service PostgreSQL 15 → `npm ci` → `npm run migrate` → `npm test` |
| `frontend` | `npm ci` → `next build` |
| `syntax` | `node --check` untuk semua file `backend/src/**/*.js` |

Status terlihat di badge atas README dan tab **Actions** di GitHub.

## Dokumentasi

- **Kontrak API & konvensi antar komponen:** [`docs/CONTRACT.md`](docs/CONTRACT.md)
- **Panduan deploy produksi (VPS, Nginx, PM2, SSL, backup):**
  [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md)

## Roadmap — Phase 2

- **Isi slot WhatsApp** — `backend/mcp.json` sudah menyediakan slotnya
  (`"disabled": true`); tinggal tunjuk ke server MCP WhatsApp dan isi token
  lewat env. Arsitekturnya tidak perlu berubah.
- **LinkedIn Ads** — platform ketiga (skema DB sudah menyiapkannya).
- **OAuth self-service** — client menghubungkan akun ads sendiri tanpa
  copy-paste token manual.
- **Multi-tenant** — satu instance melayani banyak organisasi/agency
  dengan isolasi data.
- **Clustering ML** — pengelompokan campaign otomatis berdasarkan pola
  performa untuk insight yang lebih tajam.
