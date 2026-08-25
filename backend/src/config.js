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

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 4000,
  appUrl: process.env.APP_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET || "dev-only-insecure-secret-change-me",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://adpulse:adpulse@localhost:5432/adpulse",

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
});

module.exports = config;
