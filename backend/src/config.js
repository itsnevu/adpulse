// Central configuration loader.
// Loads backend/.env when present, otherwise falls back to the repository
// root .env, then exposes a single frozen config object for the whole app.
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const BACKEND_ENV = path.resolve(__dirname, "..", ".env");
const ROOT_ENV = path.resolve(__dirname, "..", "..", ".env");

if (fs.existsSync(BACKEND_ENV)) {
  dotenv.config({ path: BACKEND_ENV });
} else if (fs.existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV });
} else {
  // No .env file — rely on process environment (e.g. PM2 / container env).
  dotenv.config();
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const nodeEnv = process.env.NODE_ENV || "development";

// ===== JWT_SECRET — fail-closed di production (pola sama dgn crypto.js) =====
// Default dev & placeholder .env.example TIDAK PERNAH boleh dipakai di
// production: siapa pun yang tahu nilainya bisa menandatangani access token
// untuk user id/role mana pun (bypass auth total).
const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me";
const JWT_SECRET_PLACEHOLDERS = new Set([
  DEV_JWT_SECRET,
  "ganti-dengan-string-acak-panjang", // placeholder .env.example
]);
const jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;
if (
  nodeEnv === "production" &&
  (JWT_SECRET_PLACEHOLDERS.has(jwtSecret) || jwtSecret.length < 32)
) {
  throw new Error(
    "JWT_SECRET wajib string acak minimal 32 karakter saat NODE_ENV=production " +
      "(bukan nilai default/placeholder). Generate dengan: openssl rand -hex 32, " +
      "lalu set di .env. Server menolak boot supaya token tidak bisa dipalsukan."
  );
}

// Saat NODE_ENV=test pakai DATABASE_URL_TEST (db adpulse_test) supaya test
// tidak menyentuh data development.
const databaseUrl =
  nodeEnv === "test"
    ? process.env.DATABASE_URL_TEST ||
      "postgres://adpulse:adpulse@localhost:5432/adpulse_test"
    : process.env.DATABASE_URL ||
      "postgres://adpulse:adpulse@localhost:5432/adpulse";

const config = Object.freeze({
  nodeEnv,
  port: parseInt(process.env.PORT, 10) || 4000,
  // Host bind HTTP server. Production default loopback (di belakang nginx —
  // jangan ekspos :4000 langsung ke internet); dev/container default semua
  // interface. Override via BIND_HOST bila perlu (mis. container production).
  bindHost:
    process.env.BIND_HOST || (nodeEnv === "production" ? "127.0.0.1" : "0.0.0.0"),
  appUrl: process.env.APP_URL || "http://localhost:3000",
  jwtSecret,
  databaseUrl,
  databaseUrlTest:
    process.env.DATABASE_URL_TEST ||
    "postgres://adpulse:adpulse@localhost:5432/adpulse_test",

  // AI (Claude)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-5",

  // Mock mode: when true the ads services generate deterministic sample data.
  mockAds: bool(process.env.MOCK_ADS, true),

  // Google Ads
  google: {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || "",
  },

  // Meta Ads
  meta: {
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    accessToken: process.env.META_ACCESS_TOKEN || "",
    adAccountId: process.env.META_AD_ACCOUNT_ID || "",
  },

  // LinkedIn Ads (phase 2 — credentials reserved, no sync implementation yet)
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
  },

  // Email (SMTP)
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "insights@adpulse.local",
  },

  // Scheduler
  syncCron: process.env.SYNC_CRON || "0 */4 * * *",
  insightEmailCron: process.env.INSIGHT_EMAIL_CRON || "0 12 * * *",
  disableCron: bool(process.env.DISABLE_CRON, false),

  // ===== Security & Hardening (v1.1) =====
  // TTL access token JWT (format ms/vercel: "1h", "15m", dst.)
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "1h",
  // Umur refresh token (hari) — cookie adpulse_rt + baris refresh_tokens.
  refreshTokenTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  // AES-256-GCM key (64 hex char) utk enkripsi token ads di DB.
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  // Rate limit: auth (per 15 menit / IP) & seluruh /api (per menit / IP).
  authRateLimitMax: int(process.env.AUTH_RATE_LIMIT_MAX, 10),
  apiRateLimitMax: int(process.env.API_RATE_LIMIT_MAX, 300),
  // Logging & error tracking
  logLevel: process.env.LOG_LEVEL || "info",
  sentryDsn: process.env.SENTRY_DSN || "",
});

module.exports = config;
