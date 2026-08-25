// Sentry opsional — hanya aktif jika SENTRY_DSN terisi.
// initSentry() dipanggil dari server.js saat boot; captureException dipakai
// oleh central error handler (app.js) untuk error 5xx.
const config = require("../config");
const logger = require("./logger");

let Sentry = null;
let initialized = false;

function initSentry() {
  if (!config.sentryDsn || initialized) return initialized;
  // Require di sini supaya SDK tidak ikut dimuat saat DSN kosong.
  // eslint-disable-next-line global-require
  Sentry = require("@sentry/node");
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: 0,
  });
  initialized = true;
  logger.info("[sentry] aktif (SENTRY_DSN terisi).");
  return initialized;
}

function isInitialized() {
  return initialized;
}

function captureException(err, context) {
  if (!initialized || !Sentry) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (captureErr) {
    logger.warn({ err: captureErr }, "[sentry] gagal capture exception");
  }
}

module.exports = { initSentry, isInitialized, captureException };
