# AdPulse Backend

API Express (Node 20, CommonJS) untuk platform analitik iklan AdPulse — port **4000**, base path `/api`. Kontrak lengkap ada di `docs/CONTRACT.md`.

## Persiapan

1. Pastikan PostgreSQL 15 berjalan dan buat database sesuai `DATABASE_URL`.
2. Salin env: `cp ../.env.example ../.env` (atau buat `backend/.env` — file itu diprioritaskan).
3. Install dependensi:

   ```bash
   cd backend
   npm install
   ```

## Migrate & Seed

```bash
npm run migrate   # eksekusi database/schema.sql (idempotent)
npm run seed      # user demo + 2 akun iklan + 8 campaigns + metrik 90 hari (idempotent)
```

Akun demo: `demo@adpulse.io` / `demo1234`.

## Menjalankan

```bash
npm run dev       # development (auto-reload)
npm start         # production
```

Cek: `curl http://localhost:4000/api/health` → `{"data":{"status":"ok"}}`.

## Keamanan (v1.1)

### Enkripsi token ads (`TOKEN_ENCRYPTION_KEY`)

Token akun iklan (`ad_accounts.access_token` / `refresh_token`) dienkripsi
**AES-256-GCM** sebelum disimpan ke database, format `enc:v1:<iv>:<tag>:<ct>`
(base64, IV 12 byte acak per enkripsi). Generate key (64 hex char):

```bash
openssl rand -hex 32
# hasilnya → TOKEN_ENCRYPTION_KEY di .env
```

- Key kosong di development → server boot dengan **peringatan keras** dan token
  tersimpan plaintext.
- Key kosong saat `NODE_ENV=production` → server **menolak boot**.
- Data lama yang belum terenkripsi (tanpa prefix `enc:v1:`) tetap terbaca
  (passthrough saat dekripsi).
- Kolom token **tidak pernah** dikembalikan oleh API.

### Alur refresh token

- Login/register mengembalikan **access token JWT** (TTL `JWT_ACCESS_TTL`,
  default 1h; dipakai sebagai `Authorization: Bearer <token>`) dan men-set
  **refresh token** di cookie httpOnly **`adpulse_rt`** (path `/api/auth`,
  SameSite=Lax, Secure saat production, umur `REFRESH_TOKEN_TTL_DAYS` hari).
- Di database hanya tersimpan **hash sha256** refresh token
  (tabel `refresh_tokens`).
- `POST /api/auth/refresh` (pakai cookie, tanpa Bearer) menerbitkan access
  token + refresh token baru — **single-use rotation**: token lama langsung
  direvoke dan ditautkan ke penggantinya (`replaced_by`).
- **Deteksi reuse**: kalau ada yang memakai refresh token yang sudah direvoke,
  SEMUA refresh token milik user tersebut direvoke (indikasi token dicuri) dan
  request dijawab 401.
- `POST /api/auth/logout` merevoke token di cookie + menghapus cookie.
- Lupa password: `POST /api/auth/forgot {email}` selalu menjawab
  `{data:{ok:true}}` (anti user-enumeration) dan mengirim link
  `APP_URL/reset-password?token=...` (SMTP kosong → link muncul di log).
  Token reset berlaku 60 menit, sekali pakai; `POST /api/auth/reset` mengganti
  password (bcrypt cost 12) dan merevoke semua refresh token user.

### Rate limiting

| Cakupan | Limit | Window | Env |
| --- | --- | --- | --- |
| `/api/auth/login\|register\|forgot\|reset` | 10 request / IP | 15 menit | `AUTH_RATE_LIMIT_MAX` |
| Seluruh `/api` | 300 request / IP | 1 menit | `API_RATE_LIMIT_MAX` |

Lewat limit → **429** `{"error":{"message":"..."}}`. Backend memakai
`app.set("trust proxy", 1)` supaya IP asli terbaca di belakang nginx.

### Lain-lain

- `helmet` aktif; CORS `credentials:true` untuk `APP_URL` + `http://localhost:3000`.
- Semua body/query divalidasi **zod** — gagal → **422**
  `{"error":{"message":"Validasi gagal","details":[{"path","message"}]}}`.
- Logging **pino** (`LOG_LEVEL`), header `authorization`/`cookie` diredaksi;
  error tracking Sentry opsional (`SENTRY_DSN` terisi → aktif).

## Catatan

- `MOCK_ADS=true` (default) → sync Google/Meta memakai data sample deterministik, tanpa API key asli.
- `ANTHROPIC_API_KEY` kosong → insight memakai fallback (model `mock`) supaya demo tetap jalan.
- `SMTP_HOST` kosong → email insight dilewati (hanya log).
- `DISABLE_CRON=true` → scheduler (sync berkala + email insight) tidak dijalankan.
