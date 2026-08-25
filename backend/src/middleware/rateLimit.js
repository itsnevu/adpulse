// Rate limiter (express-rate-limit) — respons 429 memakai envelope error.
// Limit diambil dari config (env) supaya bisa diatur saat test.
const { rateLimit } = require("express-rate-limit");
const config = require("../config");

function envelope429(message) {
  return (req, res) => {
    res.status(429).json({ error: { message } });
  };
}

// /api/auth/login|register|forgot|reset — max AUTH_RATE_LIMIT_MAX / 15 menit / IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: envelope429(
    "Terlalu banyak percobaan. Coba lagi dalam 15 menit."
  ),
});

// Seluruh /api — max API_RATE_LIMIT_MAX / menit / IP.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: envelope429("Terlalu banyak permintaan. Coba lagi sebentar lagi."),
});

module.exports = { authLimiter, apiLimiter };
