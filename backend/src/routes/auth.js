// Auth routes: register, login, me.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const config = require("../config");
const requireAuth = require("../middleware/auth");
const { httpError, asyncHandler } = require("../utils/errors");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}

// POST /api/auth/register
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError(400, "Nama wajib diisi.");
    }
    if (!email || !EMAIL_RE.test(String(email))) {
      throw httpError(400, "Email tidak valid.");
    }
    if (!password || String(password).length < 8) {
      throw httpError(400, "Password minimal 8 karakter.");
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = await bcrypt.hash(String(password), 10);

    let row;
    try {
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name.trim(), normalizedEmail, passwordHash]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        throw httpError(409, "Email sudah terdaftar.");
      }
      throw err;
    }

    const user = publicUser(row);
    res.status(201).json({ data: { token: signToken(user), user } });
  })
);

// POST /api/auth/login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw httpError(400, "Email dan password wajib diisi.");
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [
      String(email).trim().toLowerCase(),
    ]);
    const row = rows[0];
    const valid = row && (await bcrypt.compare(String(password), row.password_hash));
    if (!valid) {
      throw httpError(401, "Email atau password salah.");
    }

    const user = publicUser(row);
    res.json({ data: { token: signToken(user), user } });
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
