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

## Catatan

- `MOCK_ADS=true` (default) → sync Google/Meta memakai data sample deterministik, tanpa API key asli.
- `ANTHROPIC_API_KEY` kosong → insight memakai fallback (model `mock`) supaya demo tetap jalan.
- `SMTP_HOST` kosong → email insight dilewati (hanya log).
- `DISABLE_CRON=true` → scheduler (sync berkala + email insight) tidak dijalankan.
