// Express application: middleware, /api routes, 404 + error envelope.
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const config = require("./config");
const apiRouter = require("./routes");

const app = express();

// CORS: allow the deployed frontend (APP_URL) and local Next.js dev server.
const allowedOrigins = Array.from(
  new Set([config.appUrl, "http://localhost:3000"].filter(Boolean))
);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));

app.use("/api", apiRouter);

// 404 — anything not matched above.
app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint tidak ditemukan." } });
});

// Central error handler → {error:{message}} envelope.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error("[error]", err);
  }
  const message =
    status >= 500 && config.nodeEnv === "production"
      ? "Terjadi kesalahan pada server."
      : err.message || "Terjadi kesalahan pada server.";
  res.status(status).json({ error: { message } });
});

module.exports = app;
