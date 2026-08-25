// Server entrypoint: boots the HTTP server, checks the DB connection,
// starts the cron scheduler and handles graceful shutdown.
// Sentry di-init di sini (hanya jika SENTRY_DSN terisi) sebelum app dimuat.
const config = require("./config");
const logger = require("./utils/logger");
const sentry = require("./utils/sentry");

sentry.initSentry();

const app = require("./app");
const pool = require("./db/pool");
const { startScheduler, stopScheduler } = require("./jobs/scheduler");

async function checkDatabase() {
  try {
    await pool.query("SELECT 1");
    logger.info("[db] koneksi PostgreSQL OK.");
  } catch (err) {
    // The server stays alive so /api/health keeps responding — but make the
    // problem loud and actionable.
    logger.warn(
      "==================================================================\n" +
        "[db] PERINGATAN: tidak bisa terhubung ke PostgreSQL!\n" +
        `[db] DATABASE_URL: ${config.databaseUrl}\n` +
        `[db] Error: ${err.message}\n` +
        "[db] Endpoint /api/health tetap hidup; endpoint lain akan gagal\n" +
        "[db] sampai database tersedia. Cek service PostgreSQL & .env.\n" +
        "=================================================================="
    );
  }
}

// Production default bind loopback (nginx yang menghadap internet — :4000
// tidak boleh terekspos langsung, lihat config.bindHost / BIND_HOST).
const server = app.listen(config.port, config.bindHost, () => {
  logger.info(
    `[server] AdPulse backend berjalan di http://${config.bindHost}:${config.port}`
  );
  logger.info(`[server] mode: ${config.nodeEnv} | MOCK_ADS: ${config.mockAds}`);
});

checkDatabase();
startScheduler();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] menerima ${signal} — shutdown graceful...`);
  stopScheduler();
  server.close(() => {
    pool
      .end()
      .catch(() => {})
      .finally(() => {
        logger.info("[server] selesai. Sampai jumpa!");
        process.exit(0);
      });
  });
  // Hard exit if something hangs (open sockets, long queries).
  setTimeout(() => {
    logger.warn("[server] shutdown paksa setelah 10 detik.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
