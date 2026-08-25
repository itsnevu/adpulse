// Server entrypoint: boots the HTTP server, checks the DB connection,
// starts the cron scheduler and handles graceful shutdown.
const config = require("./config");
const app = require("./app");
const pool = require("./db/pool");
const { startScheduler, stopScheduler } = require("./jobs/scheduler");

async function checkDatabase() {
  try {
    await pool.query("SELECT 1");
    console.log("[db] koneksi PostgreSQL OK.");
  } catch (err) {
    // The server stays alive so /api/health keeps responding — but make the
    // problem loud and actionable.
    console.warn(
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

const server = app.listen(config.port, () => {
  console.log(`[server] AdPulse backend berjalan di http://localhost:${config.port}`);
  console.log(`[server] mode: ${config.nodeEnv} | MOCK_ADS: ${config.mockAds}`);
});

checkDatabase();
startScheduler();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] menerima ${signal} — shutdown graceful...`);
  stopScheduler();
  server.close(() => {
    pool
      .end()
      .catch(() => {})
      .finally(() => {
        console.log("[server] selesai. Sampai jumpa!");
        process.exit(0);
      });
  });
  // Hard exit if something hangs (open sockets, long queries).
  setTimeout(() => {
    console.warn("[server] shutdown paksa setelah 10 detik.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
