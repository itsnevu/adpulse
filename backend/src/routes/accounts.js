// Ad account routes: list + connect.
// Token ads (access_token/refresh_token) dienkripsi AES-256-GCM sebelum
// disimpan dan TIDAK PERNAH dikembalikan oleh API.
const express = require("express");
const { z } = require("zod");
const pool = require("../db/pool");
const { validateBody } = require("../middleware/validate");
const { encryptToken } = require("../utils/crypto");
const { httpError, asyncHandler } = require("../utils/errors");

const router = express.Router();

const PLATFORMS = ["google", "meta", "linkedin"];

const createAccountSchema = z.object({
  platform: z.enum(PLATFORMS, {
    message: `Platform harus salah satu dari: ${PLATFORMS.join(", ")}`,
  }),
  external_id: z
    .string({ message: "external_id wajib diisi" })
    .trim()
    .min(1, { message: "external_id wajib diisi" }),
  name: z
    .string({ message: "Nama akun wajib diisi" })
    .trim()
    .min(1, { message: "Nama akun wajib diisi" }),
  currency: z
    .string({ message: "currency harus string" })
    .trim()
    .min(1, { message: "currency tidak boleh kosong" })
    .transform((v) => v.toUpperCase())
    .optional(),
  access_token: z.string({ message: "access_token harus string" }).optional(),
  refresh_token: z.string({ message: "refresh_token harus string" }).optional(),
});

// GET /api/accounts — the authenticated user's ad accounts.
// Kolom token sengaja tidak pernah di-SELECT.
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
  validateBody(createAccountSchema),
  asyncHandler(async (req, res) => {
    const {
      platform,
      external_id: externalId,
      name,
      currency,
      access_token: accessToken,
      refresh_token: refreshToken,
    } = req.body;

    let row;
    try {
      const result = await pool.query(
        `INSERT INTO ad_accounts
           (user_id, platform, external_id, name, currency,
            access_token, refresh_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, platform, external_id, name, currency, status, created_at`,
        [
          req.user.id,
          platform,
          externalId,
          name,
          currency || "USD",
          accessToken ? encryptToken(accessToken) : null,
          refreshToken ? encryptToken(refreshToken) : null,
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
