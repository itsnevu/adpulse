// Express application: security middleware (helmet, rate limit), logging
// (pino-http), /api routes, 404 + error envelope.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const pinoHttp = require("pino-http");
const config = require("./config");
const logger = require("./utils/logger");
const sentry = require("./utils/sentry");
const { apiLimiter } = require("./middleware/rateLimit");
const apiRouter = require("./routes");

const app = express();

// Backend berjalan di belakang reverse proxy (nginx) — percayai 1 hop
// supaya req.ip (dipakai rate limiter) & secure cookie bekerja benar.
app.set("trust proxy", 1);

app.use(helmet());

// CORS: allow the deployed frontend (APP_URL); origin dev localhost:3000
// hanya di luar production — jangan lemahkan boundary CORS di production.
// credentials:true — cookie refresh token (adpulse_rt) ikut terkirim.
const allowedOrigins = Array.from(
  new Set(
    [
      config.appUrl,
      config.nodeEnv !== "production" ? "http://localhost:3000" : null,
    ].filter(Boolean)
  )
);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(
  pinoHttp({
    logger,
    // /api/health terlalu berisik di level info.
    autoLogging: { ignore: (req) => req.url === "/api/health" },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Rate limit seluruh /api (per menit / IP). Limiter khusus auth ada di
// routes/auth.js (login/register/forgot/reset).
app.use("/api", apiLimiter, apiRouter);

// 404 — anything not matched above.
app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint tidak ditemukan." } });
});

// Central error handler → {error:{message}} envelope.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error({ err, path: req.originalUrl }, "unhandled error");
    sentry.captureException(err, { path: req.originalUrl });
  }
  const message =
    status >= 500 && config.nodeEnv === "production"
      ? "Terjadi kesalahan pada server."
      : err.message || "Terjadi kesalahan pada server.";
  res.status(status).json({ error: { message } });
});

module.exports = app;
