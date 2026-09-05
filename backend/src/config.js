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

  // ===== Agent AI + MCP (v1.2) =====
  // Engine LLM adalah SLOT, bukan vendor. Lihat services/agent/engine.js:
  // "auto" memilih endpoint OpenAI-compatible bila AGENT_ENGINE_* terisi
  // lengkap (mengisi tiga env eksplisit = pilihan sadar), kalau tidak jatuh ke
  // Anthropic memakai ANTHROPIC_API_KEY yang memang sudah ada untuk insight.
  agent: {
    provider: (process.env.AGENT_PROVIDER || "auto").toLowerCase(),
    // Slot OpenAI-compatible — OpenRouter, Groq, Together, vLLM lokal, dst.
    // Contoh OpenRouter: URL https://openrouter.ai/api/v1, MODEL anthropic/claude-sonnet-4.5
    engineUrl: process.env.AGENT_ENGINE_URL || "",
    engineKey: process.env.AGENT_ENGINE_KEY || "",
    engineModel: process.env.AGENT_ENGINE_MODEL || "",
    // Berapa putaran tool yang boleh dipakai satu pertanyaan sebelum agent
    // dipaksa menjawab dari apa yang sudah terkumpul.
    maxIterations: int(process.env.AGENT_MAX_ITERATIONS, 6),
    maxTokens: int(process.env.AGENT_MAX_TOKENS, 2000),
    timeoutMs: int(process.env.AGENT_TIMEOUT_MS, 90000),
    // Hasil tool dikirim ULANG ke model tiap iterasi berikutnya, jadi hasil
    // tanpa batas ditagih berkali-kali dan biaya satu percakapan tumbuh
    // kuadratik. Dua batas ini yang menjaganya tetap linear.
    maxToolChars: int(process.env.AGENT_MAX_TOOL_CHARS, 4000),
    maxToolCharsTotal: int(process.env.AGENT_MAX_TOOL_CHARS_TOTAL, 24000),
    // Riwayat percakapan yang ikut dikirim ke model tiap giliran.
    historyLimit: int(process.env.AGENT_HISTORY_LIMIT, 20),
  },

  // Armada MCP eksternal (backend/mcp.json). Slot WhatsApp diisi di sini.
  mcp: {
    configPath: process.env.MCP_CONFIG_PATH || "",
    connectTimeoutMs: int(process.env.MCP_CONNECT_TIMEOUT_MS, 8000),
    toolTimeoutMs: int(process.env.MCP_TOOL_TIMEOUT_MS, 15000),
    disabled: bool(process.env.MCP_DISABLED, false),
  },

  // Tool scraping first-party.
  scrape: {
    maxBytes: int(process.env.SCRAPE_MAX_BYTES, 2000000),
    timeoutMs: int(process.env.SCRAPE_TIMEOUT_MS, 15000),
    // Buka HANYA untuk dev yang memang perlu mengambil dari localhost.
    // Di production ini adalah pintu SSRF — biarkan false.
    allowPrivateHosts: bool(process.env.SCRAPE_ALLOW_PRIVATE_HOSTS, false),
  },
});

module.exports = config;
