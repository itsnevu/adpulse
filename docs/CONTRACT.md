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

---

# v1.1 — Hardening Update (2026-08-25)

## Auth (rework)
- Access token JWT: TTL dari env `JWT_ACCESS_TTL` (default 1h) — tetap Bearer `Authorization`.
- Refresh token: httpOnly cookie **`adpulse_rt`** (path `/api/auth`, SameSite=Lax, Secure saat production, maxAge `REFRESH_TOKEN_TTL_DAYS` hari). Disimpan di DB sebagai hash sha256 (tabel `refresh_tokens`), **single-use rotation**: tiap refresh menerbitkan token baru + revoke yang lama (`replaced_by`). Reuse token yang sudah revoked = revoke SEMUA refresh token user tsb (deteksi pencurian).
- `POST /api/auth/login` | `/register` → `{data:{token,user}}` + set cookie `adpulse_rt`.
- `POST /api/auth/refresh` → pakai cookie (tanpa Bearer) → `{data:{token,user}}` + cookie baru. 401 jika revoked/expired/unknown.
- `POST /api/auth/logout` → pakai cookie → revoke + clear cookie → `{data:{ok:true}}`.
- `POST /api/auth/forgot` `{email}` → SELALU `{data:{ok:true}}` (anti user-enumeration). Kirim email link `APP_URL/reset-password?token=...`; jika SMTP kosong → log link ke console. Token acak 32 byte, hash sha256 di `password_reset_tokens`, expiry 60 menit, single-use.
- `POST /api/auth/reset` `{token,password}` → `{data:{ok:true}}` + revoke semua refresh token user.

## Validasi
- Semua body & query divalidasi **zod**. Gagal → **422** `{error:{message:"Validasi gagal", details:[{path,message}]}}`. Password min 8 char.

## Rate limiting (429 dengan envelope error)
- `/api/auth/login|register|forgot|reset`: max `AUTH_RATE_LIMIT_MAX` (default 10) per 15 menit per IP.
- Seluruh `/api`: max `API_RATE_LIMIT_MAX` (default 300) per menit per IP.
- `app.set('trust proxy', 1)` — backend di belakang nginx.

## Keamanan lain
- `helmet` aktif; CORS `credentials:true`, origin APP_URL + localhost:3000.
- Token ads (`ad_accounts.access_token/refresh_token`) dienkripsi **AES-256-GCM** pakai `TOKEN_ENCRYPTION_KEY` (64 hex). Format ciphertext `enc:v1:<iv>:<tag>:<ct>` (base64). Key kosong: dev = plaintext + warning keras; NODE_ENV=production = tolak boot. Field token TIDAK PERNAH dikembalikan API.
- Logging **pino** (`LOG_LEVEL`) + pino-http; Sentry opsional via `SENTRY_DSN` (init hanya kalau diisi).

## Frontend
- `lib/api.js`: endpoint auth pakai `credentials:"include"`; saat 401 non-auth → coba `POST /api/auth/refresh` SEKALI → ulangi request; tetap gagal → hapus token + redirect /login. Logout memanggil `POST /api/auth/logout`.
- Halaman baru: `/forgot-password`, `/reset-password` (baca `?token=` via useSearchParams DI DALAM `<Suspense>` — wajib utk next build). Link "Lupa password?" di /login.

## Testing & CI
- backend: `npm test` = `node --test test/` (node:test + supertest), pakai `DATABASE_URL_TEST` (buat db `adpulse_test` bila belum ada — role adpulse superuser di container).
- CI `.github/workflows/ci.yml`: job backend (service postgres:15, npm ci, migrate, test) + job frontend (npm ci, build). Node 20.

---

# v1.2 — Agent AI + MCP (2026-09-06)

Satu UI chat yang bisa membaca Meta Ads, Google Ads, scraping web, dan tool MCP
eksternal (slot WhatsApp). Halaman landing dihapus — `/` sekarang redirect
(ada token → `/dashboard`, tidak ada → `/login`); file lamanya diarsipkan di
`_archive/landing/page.jsx`.

## Endpoints baru (semua butuh JWT)
- `GET    /api/agent/health?probe=1` → `{ data: { engine: {configured, provider, model, baseUrl}, mcp: {state, tools, servers, error}, firstPartyTools } }`. `state` = `cold|up|empty|down`. `?probe=1` memaksa armada MCP boot supaya jawabannya "benar-benar hidup?" bukan "env-nya terisi?".
- `GET    /api/agent/tools` → `{ data: { tools: [{name, description, source: "adpulse"|"mcp", server?, mutating}], mcp } }`
- `GET    /api/agent/conversations?limit=` → daftar percakapan user (terbaru dulu) + `message_count`
- `GET    /api/agent/conversations/:id` → `{ data: { conversation, messages } }`
- `DELETE /api/agent/conversations/:id` → `{ data: { ok: true } }`
- `POST   /api/agent/chat` `{message, conversation_id?}` → `{ data: { conversation_id, user_message, message, degraded, usage, provider } }`. Tanpa `conversation_id` percakapan baru dibuat (judul = 60 karakter pertama pesan). Pesan maksimal 8000 karakter (422 bila lewat).

## Engine LLM = SLOT, bukan vendor
`AGENT_PROVIDER`: `auto` (default) | `anthropic` | `openai`.
- `auto` memakai endpoint OpenAI-compatible bila `AGENT_ENGINE_URL` + `AGENT_ENGINE_KEY` + `AGENT_ENGINE_MODEL` terisi lengkap, kalau tidak jatuh ke `ANTHROPIC_API_KEY`. Alasannya: mengisi tiga env eksplisit adalah pilihan sadar, sedangkan `ANTHROPIC_API_KEY` sudah ada untuk insight harian sehingga keberadaannya bukan sinyal pilihan.
- OpenRouter cukup diisi lewat env: `AGENT_ENGINE_URL=https://openrouter.ai/api/v1`, `AGENT_ENGINE_MODEL=anthropic/claude-sonnet-4.5`.
- Tanpa keduanya, endpoint chat menjawab **503** dengan pesan yang menyebut env apa yang kurang — bukan 500.

## Tool first-party (selalu ada, termasuk saat armada MCP mati)
`adpulse_metrics_summary`, `adpulse_by_platform`, `adpulse_timeseries`,
`adpulse_campaigns`, `adpulse_accounts`, `adpulse_sync_logs`,
`google_ads_live_metrics`, `meta_ads_live_metrics`, `adpulse_run_sync` (satu-satunya yang menulis),
`web_scrape`.

Semua di-scope lewat `ctx.userId` yang berasal dari JWT — model tidak pernah
memilih user id, jadi tidak ada jalan menanyakan data user lain. Angka dibaca
dari `services/adsQuery.js`, sumber SQL yang sama dengan endpoint dashboard.

## Armada MCP (`backend/mcp.json`)
- Format sama dengan mcp.json pada umumnya: `command`+`args`+`envFrom` (stdio) atau `url`+`type`+`headersFrom` (HTTP).
- **Token tidak pernah ditulis di mcp.json** (file ini ter-commit): `envFrom` dan `headersFrom` menunjuk NAMA env var.
- Slot bawaan: `whatsapp` dan `scraper`, dua-duanya `"disabled": true` sampai diisi.
- Tool yang namanya terlihat menulis (`send`/`delete`/`create`/...) disaring keluar kecuali server mencantumkan `allowedTools` — ini yang mencegah server WhatsApp diam-diam memberi model kemampuan mengirim pesan.
- Server yang gagal connect **tidak** mematikan chat: giliran itu jalan dengan tool first-party saja, respons diberi `degraded: true`, dan system prompt diberi tahu tool apa yang sedang hilang supaya model tidak mengarang isinya.
- `MCP_DISABLED=true` mematikan seluruh armada.

## Tabel baru
- `agent_conversations` (id, user_id, title, created_at, updated_at)
- `agent_messages` (id, conversation_id, role `user|assistant`, content, `tool_calls` JSONB, model, degraded, created_at)

`tool_calls` merekam `[{name, args, ms, failed, source}]` per jawaban — tanpa
jejak itu "AI bilang spend naik 30%" tidak bisa ditelusuri ke sumbernya.

## Batas biaya
Hasil tool dikirim ULANG ke model di setiap iterasi berikutnya, jadi hasil tanpa
batas ditagih berkali-kali dan biaya satu pertanyaan tumbuh kuadratik terhadap
jumlah putaran. `AGENT_MAX_TOOL_CHARS` (per tool) dan `AGENT_MAX_TOOL_CHARS_TOTAL`
(per request) yang menahannya linear; `AGENT_MAX_ITERATIONS` membatasi jumlah
putaran, dan bila habis dilakukan satu pass terakhir TANPA tool supaya user tetap
dapat kesimpulan, bukan layar kosong.
