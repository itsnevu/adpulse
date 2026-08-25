// Sync routes: trigger a platform sync + read the sync history.
const express = require("express");
const { z } = require("zod");
const pool = require("../db/pool");
const syncService = require("../services/syncService");
const { validateParams } = require("../middleware/validate");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();

const SYNCABLE = ["google", "meta"];

const syncParamsSchema = z.object({
  platform: z.enum(SYNCABLE, {
    message: `Platform harus "google" atau "meta" (linkedin menyusul di phase 2)`,
  }),
});

// POST /api/sync/:platform — run a sync right now, returns the sync_log row.
router.post(
  "/:platform",
  validateParams(syncParamsSchema),
  asyncHandler(async (req, res) => {
    const { platform } = req.params;
    // v1.1: sync hanya untuk ad_accounts milik user yang terautentikasi.
    const log = await syncService.runSync(platform, req.user.id);
    res.json({ data: log });
  })
);

// GET /api/sync/logs — the user's 50 most recent sync logs (v1.1: log
// di-scope per user — kolom error bisa memuat pesan mentah API ads).
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, platform, status, records_synced, error, started_at, finished_at
       FROM sync_logs
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ data: rows });
  })
);

module.exports = router;
