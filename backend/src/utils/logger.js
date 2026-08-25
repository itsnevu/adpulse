// Logger terpusat (pino). Level dari LOG_LEVEL; header sensitif
// (authorization, cookie, set-cookie) selalu diredaksi.
const pino = require("pino");
const config = require("../config");

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  base: undefined, // tanpa pid/hostname — log lebih ringkas
});

module.exports = logger;
