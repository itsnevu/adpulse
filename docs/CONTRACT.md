# AdPulse — Shared Contract (semua komponen WAJIB ikut ini)

## Konvensi umum
- Backend: Node.js 20, plain JavaScript (CommonJS), Express, port **4000**, base path `/api`.
- Frontend: Next.js (App Router, JS/JSX, bukan TypeScript), Tailwind CSS v3, port **3000**.
- DB: PostgreSQL 15, schema di `database/schema.sql` (source of truth — jangan diubah tanpa update file itu).
- Tanggal: string `YYYY-MM-DD`. Uang: numeric decimal, currency ikut kolom `ad_accounts.currency`.
- Response envelope: sukses `{ "data": ... }`, gagal `{ "error": { "message": "..." } }` + status 4xx/5xx.
- Auth: JWT Bearer di header `Authorization: Bearer <token>`, expiry 7 hari.
- MOCK MODE: jika `MOCK_ADS=true`, service Google/Meta menghasilkan data sample deterministik (tanpa API key asli) supaya demo end-to-end jalan.

## Endpoints (backend menyediakan, frontend memakai — persis path ini)
- `GET  /api/health` → `{ data: { status: 'ok' } }`
- `POST /api/auth/register` `{name,email,password}` → `{ data: { token, user } }`
- `POST /api/auth/login` `{email,password}` → `{ data: { token, user } }`
- `GET  /api/auth/me` → `{ data: { user } }`
- `GET  /api/accounts` → daftar ad_accounts user
- `POST /api/accounts` `{platform, external_id, name, currency?}`
- `GET  /api/campaigns?platform=&status=&search=` → campaigns + agregat metrik 30 hari (spend, impressions, clicks, conversions, ctr, cpc)
- `GET  /api/metrics/summary?from=&to=&platform=` → `{ data: { spend, impressions, clicks, conversions, ctr, cpc, cpm, deltas: {spend,impressions,clicks,conversions} } }` (deltas = % vs periode sebelumnya dengan panjang sama)
- `GET  /api/metrics/timeseries?from=&to=&platform=&metric=spend|impressions|clicks|conversions` → `{ data: [ {date, google, meta, linkedin, total} ] }`
- `GET  /api/metrics/by-platform?from=&to=` → `{ data: [ {platform, spend, impressions, clicks, conversions} ] }`
- `GET  /api/insights` → daftar insight terbaru
- `POST /api/insights/generate` `{from, to}` → insight baru (Claude AI; fallback canned jika ANTHROPIC_API_KEY kosong)
- `POST /api/sync/:platform` (google|meta) → jalankan sync sekarang → `{ data: sync_log }`
- `GET  /api/sync/logs` → 50 log terakhir

Semua endpoint selain /health dan /auth/register|login butuh JWT.

## Env (lihat .env.example di root — pakai nama persis)
Frontend hanya memakai `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

## Akun demo (dibuat oleh seed)
email: `demo@adpulse.io` — password: `demo1234`

## Deploy target (referensi untuk deploy kit)
VPS Ubuntu 22.04, app di `/home/app/adpulse`, Nginx reverse proxy (`/api` → :4000, `/` → :3000), PM2 untuk proses, certbot SSL.
