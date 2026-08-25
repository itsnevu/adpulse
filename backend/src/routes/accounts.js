// Ad account routes: list + connect.
const express = require("express");
const pool = require("../db/pool");
const { httpError, asyncHandler } = require("../utils/errors");

const router = express.Router();

const PLATFORMS = ["google", "meta", "linkedin"];

// GET /api/accounts — the authenticated user's ad accounts.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, platform, external_id, name, currency, status, created_at
       FROM ad_accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json({ data: rows });
  })
);

// POST /api/accounts — connect a new ad account.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { platform, external_id: externalId, name, currency } = req.body || {};
    if (!PLATFORMS.includes(platform)) {
      throw httpError(400, `Platform harus salah satu dari: ${PLATFORMS.join(", ")}.`);
    }
    if (!externalId || !String(externalId).trim()) {
      throw httpError(400, "external_id wajib diisi.");
    }
    if (!name || !String(name).trim()) {
      throw httpError(400, "Nama akun wajib diisi.");
    }

    let row;
    try {
      const result = await pool.query(
        `INSERT INTO ad_accounts (user_id, platform, external_id, name, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, platform, external_id, name, currency, status, created_at`,
        [
          req.user.id,
          platform,
          String(externalId).trim(),
          String(name).trim(),
          (currency && String(currency).trim().toUpperCase()) || "USD",
        ]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        throw httpError(409, "Akun iklan tersebut sudah terhubung.");
      }
      throw err;
    }

    res.status(201).json({ data: row });
  })
);

module.exports = router;
