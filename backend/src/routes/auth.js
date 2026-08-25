// Auth routes (v1.1): register, login, me, refresh (rotation + deteksi
// reuse), logout, forgot & reset password.
//
// - Access token: JWT Bearer, TTL JWT_ACCESS_TTL (default 1h).
// - Refresh token: httpOnly cookie `adpulse_rt` (path /api/auth, SameSite=Lax,
//   Secure saat production, maxAge REFRESH_TOKEN_TTL_DAYS hari). Di DB hanya
//   disimpan hash sha256 (tabel refresh_tokens), single-use rotation.
//   Reuse token yang sudah direvoke = indikasi pencurian → revoke SEMUA
//   refresh token milik user tsb.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodeCrypto = require("crypto");
const { z } = require("zod");
const pool = require("../db/pool");
const config = require("../config");
const logger = require("../utils/logger");
const requireAuth = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { authLimiter } = require("../middleware/rateLimit");
const { sha256Hex } = require("../utils/crypto");
const { httpError, asyncHandler } = require("../utils/errors");
const mailer = require("../services/mailer");

const router = express.Router();

const BCRYPT_COST = 12;
const REFRESH_COOKIE = "adpulse_rt";
const RESET_TOKEN_TTL_MINUTES = 60;
// Hash bcrypt (cost 12) dari string acak yang tidak dipakai user mana pun.
// Login dengan email tak terdaftar tetap menjalankan bcrypt.compare terhadap
// hash ini supaya durasi respons tidak membocorkan keberadaan akun.
const DUMMY_PASSWORD_HASH =
  "$2a$12$s6i6OU9LpzdK.40WN/bGYuErazOPjDX5mLwCc9ErSvWA8quIJtSty";

// ===== Schemas (zod) =====
const emailField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ message: "Email tidak valid" })
);
const passwordField = z
  .string({ message: "Password wajib diisi" })
  .min(8, { message: "Password minimal 8 karakter" });

const registerSchema = z.object({
  name: z
    .string({ message: "Nama wajib diisi" })
    .trim()
    .min(1, { message: "Nama wajib diisi" }),
  email: emailField,
  password: passwordField,
});

const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ message: "Password wajib diisi" })
    .min(1, { message: "Password wajib diisi" }),
});

const forgotSchema = z.object({ email: emailField });

const resetSchema = z.object({
  token: z
    .string({ message: "Token wajib diisi" })
    .trim()
    .min(1, { message: "Token wajib diisi" }),
  password: passwordField,
});

// ===== Helpers =====
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtAccessTtl }
  );
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    path: "/api/auth",
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  };
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

// Terbitkan refresh token baru: nilai acak 32 byte (hex) — hanya hash
// sha256-nya yang disimpan di DB.
// db opsional: client transaksi (default pool) — dipakai /refresh supaya
// INSERT token baru + set replaced_by berada dalam satu transaksi.
async function issueRefreshToken(userId, db = pool) {
  const token = nodeCrypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
  );
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, sha256Hex(token), expiresAt.toISOString()]
  );
  return { id: rows[0].id, token };
}

async function revokeAllRefreshTokens(userId) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// ===== Routes =====

// POST /api/auth/register
router.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    let row;
    try {
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name, email, passwordHash]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        throw httpError(409, "Email sudah terdaftar.");
      }
      throw err;
    }

    const user = publicUser(row);
    const refresh = await issueRefreshToken(user.id);
    setRefreshCookie(res, refresh.token);
    res.status(201).json({ data: { token: signAccessToken(user), user } });
  })
);

// POST /api/auth/login
router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [
      email,
    ]);
    const row = rows[0];
    // Selalu jalankan bcrypt.compare (hash dummy bila email tak dikenal)
    // supaya waktu respons tidak membedakan email terdaftar vs tidak.
    const match = await bcrypt.compare(
      password,
      row ? row.password_hash : DUMMY_PASSWORD_HASH
    );
    const valid = Boolean(row) && match;
    if (!valid) {
      throw httpError(401, "Email atau password salah.");
    }

    const user = publicUser(row);
    const refresh = await issueRefreshToken(user.id);
    setRefreshCookie(res, refresh.token);
    res.json({ data: { token: signAccessToken(user), user } });
  })
);

// POST /api/auth/refresh — pakai cookie adpulse_rt (tanpa Bearer).
// Single-use rotation: token lama direvoke + diganti (replaced_by), token
// baru di-set sebagai cookie. Reuse token revoked → revoke semua (deteksi
// pencurian) → 401.
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const raw = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
    if (!raw) {
      throw httpError(401, "Refresh token tidak ditemukan.");
    }
    const tokenHash = sha256Hex(raw);

    // Konsumsi ATOMIK: revoke token hanya jika belum direvoke. Dua request
    // paralel dengan cookie sama → tepat satu yang berhasil; yang kalah
    // masuk jalur reuse-detection di bawah (race rotasi tertutup).
    const { rows: consumedRows } = await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING *`,
      [tokenHash]
    );
    const stored = consumedRows[0];
    if (!stored) {
      const { rows: knownRows } = await pool.query(
        `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      const known = knownRows[0];
      if (!known) {
        clearRefreshCookie(res);
        throw httpError(401, "Refresh token tidak dikenal.");
      }
      // Reuse token yang sudah dirotasi/direvoke = kemungkinan pencurian.
      await revokeAllRefreshTokens(known.user_id);
      logger.warn(
        { userId: known.user_id },
        "[auth] reuse refresh token terdeteksi — semua refresh token user direvoke"
      );
      clearRefreshCookie(res);
      throw httpError(401, "Refresh token sudah tidak berlaku.");
    }
    if (new Date(stored.expires_at) <= new Date()) {
      // Sudah direvoke oleh UPDATE atomik di atas.
      clearRefreshCookie(res);
      throw httpError(401, "Refresh token kedaluwarsa.");
    }

    const { rows: userRows } = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [stored.user_id]
    );
    if (userRows.length === 0) {
      clearRefreshCookie(res);
      throw httpError(401, "User tidak ditemukan.");
    }
    const user = publicUser(userRows[0]);

    // Rotasi: token baru + tautkan replaced_by dalam SATU transaksi
    // (revoked_at token lama sudah di-set oleh konsumsi atomik).
    const client = await pool.connect();
    let refresh;
    try {
      await client.query("BEGIN");
      refresh = await issueRefreshToken(user.id, client);
      await client.query(
        `UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1`,
        [stored.id, refresh.id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    setRefreshCookie(res, refresh.token);
    res.json({ data: { token: signAccessToken(user), user } });
  })
);

// POST /api/auth/logout — revoke refresh token dari cookie + clear cookie.
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const raw = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
    if (raw) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [sha256Hex(raw)]
      );
    }
    clearRefreshCookie(res);
    res.json({ data: { ok: true } });
  })
);

// POST /api/auth/forgot — SELALU {data:{ok:true}} (anti user-enumeration).
router.post(
  "/forgot",
  authLimiter,
  validateBody(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (user) {
      const token = nodeCrypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, sha256Hex(token), expiresAt.toISOString()]
      );
      const resetUrl = `${config.appUrl}/reset-password?token=${token}`;
      // Mailer: kirim email; kalau SMTP kosong → link di-log (lihat mailer.js).
      await mailer.sendPasswordResetEmail(user, resetUrl);
    }
    // Respons identik ada/tidaknya user — jangan bocorkan keberadaan email.
    res.json({ data: { ok: true } });
  })
);

// POST /api/auth/reset {token, password} — single-use, expiry 60 menit.
// Sukses: ganti password + revoke SEMUA refresh token user.
router.post(
  "/reset",
  authLimiter,
  validateBody(resetSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const { rows } = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256Hex(token)]
    );
    const stored = rows[0];
    if (!stored) {
      throw httpError(400, "Token reset tidak valid atau sudah kedaluwarsa.");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    // Hanguskan SEMUA reset token user yang masih outstanding — token dari
    // permintaan /forgot sebelumnya tidak boleh bisa me-reset ulang password.
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [stored.user_id]
    );
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      stored.user_id,
      passwordHash,
    ]);
    await revokeAllRefreshTokens(stored.user_id);
    logger.info(
      { userId: stored.user_id },
      "[auth] password direset — semua refresh token direvoke"
    );

    res.json({ data: { ok: true } });
  })
);

// GET /api/auth/me
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [
      req.user.id,
    ]);
    if (rows.length === 0) {
      throw httpError(401, "User tidak ditemukan.");
    }
    res.json({ data: { user: publicUser(rows[0]) } });
  })
);

module.exports = router;
