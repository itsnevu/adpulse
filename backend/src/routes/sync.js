// Sync routes: trigger a platform sync + read the sync history.
const express = require("express");
const pool = require("../db/pool");
const syncService = require("../services/syncService");
const { httpError, asyncHandler } = require("../utils/errors");

const router = express.Router();

const SYNCABLE = ["google", "meta"];

// POST /api/sync/:platform — run a sync right now, returns the sync_log row.
router.post(
  "/:platform",
  asyncHandler(async (req, res) => {
    const { platform } = req.params;
    if (!SYNCABLE.includes(platform)) {
      throw httpError(
        400,
        `Platform harus "google" atau "meta" (linkedin menyusul di phase 2).`
      );
    }
    const log = await syncService.runSync(platform);
    res.json({ data: log });
  })
);

// GET /api/sync/logs — the 50 most recent sync logs.
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, platform, status, records_synced, error, started_at, finished_at
       FROM sync_logs
       ORDER BY started_at DESC
       LIMIT 50`
    );
    res.json({ data: rows });
  })
);

module.exports = router;
