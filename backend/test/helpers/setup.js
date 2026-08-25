// Test setup helper.
//
// - Set env test SEBELUM src/config dimuat (config membekukan env saat
//   require pertama).
// - setupDatabase(): konek sebagai superuser ke db admin (adpulse), ambil
//   advisory lock (node --test menjalankan file test paralel — lock ini
//   menserialkan akses ke adpulse_test antar-proses), CREATE DATABASE
//   adpulse_test bila belum ada, lalu jalankan migrasi (database/schema.sql)
//   ke DATABASE_URL_TEST.
// - getApp()/getPool(): instance utama src/app + pool (di-memo).
// - truncateAll(): kosongkan semua tabel antar-suite.
// - createIsolatedApp(overrides): app instance segar dengan env berbeda
//   (mis. AUTH_RATE_LIMIT_MAX=3) — require cache src/ dibersihkan dulu.
// - closeAll(): tutup semua pool + lepas advisory lock (tidak ada koneksi
//   nyangkut setelah test selesai).
"use strict";

const path = require("path");
const fs = require("fs");

// ===== Env test — WAJIB sebelum require modul src apa pun =====
process.env.NODE_ENV = "test";
process.env.DISABLE_CRON = "true";
process.env.MOCK_ADS = "true";
process.env.JWT_SECRET = "test-jwt-secret-adpulse";
// Dummy 64-hex key (32 byte) utk AES-256-GCM token ads.
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
process.env.ANTHROPIC_API_KEY = ""; // paksa fallback insight (model: mock)
process.env.SMTP_HOST = ""; // mailer tidak pernah kirim email sungguhan
process.env.SENTRY_DSN = "";
process.env.LOG_LEVEL = "silent";
// Limit longgar utk app utama — test rate-limit memakai createIsolatedApp.
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.API_RATE_LIMIT_MAX = "100000";
process.env.DATABASE_URL_TEST =
  process.env.DATABASE_URL_TEST ||
  "postgres://adpulse:adpulse@localhost:5432/adpulse_test";

const { Client } = require("pg");

const ADMIN_URL = "postgres://adpulse:adpulse@localhost:5432/adpulse";
const TEST_DB_NAME = "adpulse_test";
// Kunci advisory lock bersama semua file test (di db admin "adpulse").
const LOCK_KEY = 727272;
const SRC_DIR = path.resolve(__dirname, "..", "..", "src");
const SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "database",
  "schema.sql"
);

// Urutan tidak penting (CASCADE), tapi lengkap semua tabel schema.
const ALL_TABLES = [
  "password_reset_tokens",
  "refresh_tokens",
  "email_logs",
  "sync_logs",
  "insights",
  "metrics_daily",
  "campaigns",
  "ad_accounts",
  "users",
];

let adminClient = null;
let mainApp = null;
let mainPool = null;
const extraPools = [];

// Buat adpulse_test bila belum ada + jalankan migrasi schema.sql ke sana.
// Advisory lock dipegang sampai closeAll() — file test lain menunggu.
async function setupDatabase() {
  if (!adminClient) {
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  }

  const { rows } = await adminClient.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [TEST_DB_NAME]
  );
  if (rows.length === 0) {
    try {
      await adminClient.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    } catch (err) {
      // 42P04 = duplicate_database (race dengan proses lain) — aman.
      if (err.code !== "42P04") throw err;
    }
  }

  // Migrate: jalankan database/schema.sql (idempotent) ke DATABASE_URL_TEST.
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  const migrateClient = new Client({
    connectionString: process.env.DATABASE_URL_TEST,
  });
  await migrateClient.connect();
  try {
    await migrateClient.query(sql);
  } finally {
    await migrateClient.end();
  }
}

// Instance utama app Express (env test di atas). Di-memo supaya pool-nya
// satu dan bisa ditutup di closeAll().
function getApp() {
  if (!mainApp) {
    mainApp = require("../../src/app");
    mainPool = require("../../src/db/pool");
  }
  return mainApp;
}

function getPool() {
  if (!mainPool) {
    getApp();
  }
  return mainPool;
}

// Kosongkan semua tabel (dipakai antar-suite supaya tiap file test mulai
// dari keadaan bersih).
async function truncateAll() {
  await getPool().query(
    `TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`
  );
}

function clearSrcCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
}

// App instance segar dengan env override (mis. { AUTH_RATE_LIMIT_MAX: "3" }).
// Pool barunya dicatat dan ditutup oleh closeAll(). Panggil setelah app
// utama dipakai (module cache src/ dibersihkan untuk membangun ulang config).
function createIsolatedApp(overrides) {
  getApp(); // pastikan instance utama sudah ter-memo dulu
  const saved = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  clearSrcCache();
  const app = require("../../src/app");
  const pool = require("../../src/db/pool");
  extraPools.push(pool);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return { app, pool };
}

// Tutup semua koneksi: pool utama, pool isolated, dan advisory lock admin.
async function closeAll() {
  for (const p of extraPools.splice(0)) {
    try {
      await p.end();
    } catch (err) {
      /* sudah tertutup */
    }
  }
  if (mainPool) {
    try {
      await mainPool.end();
    } catch (err) {
      /* sudah tertutup */
    }
    mainPool = null;
    mainApp = null;
  }
  if (adminClient) {
    try {
      await adminClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch (err) {
      /* koneksi sudah putus */
    }
    try {
      await adminClient.end();
    } catch (err) {
      /* sudah tertutup */
    }
    adminClient = null;
  }
}

module.exports = {
  setupDatabase,
  getApp,
  getPool,
  truncateAll,
  createIsolatedApp,
  closeAll,
};
