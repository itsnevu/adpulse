// Insight routes: list + generate (Claude AI, with mock fallback).
const express = require("express");
const pool = require("../db/pool");
const insightEngine = require("../services/insightEngine");
const { httpError, asyncHandler } = require("../utils/errors");
const { isValidDateStr, todayStr, addDaysStr } = require("../utils/dates");

const router = express.Router();

// GET /api/insights — latest insights for the authenticated user.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, period_start, period_end, summary, recommendations,
              model, tokens_used, created_at
       FROM insights
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ data: rows });
  })
);

// POST /api/insights/generate {from, to} — defaults to the last 7 days.
router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const to = body.to || todayStr();
    const from = body.from || addDaysStr(to, -6);
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      throw httpError(400, "Parameter from/to harus format YYYY-MM-DD.");
    }
    if (from > to) {
      throw httpError(400, "Parameter from harus <= to.");
    }

    const insight = await insightEngine.generateInsight(req.user.id, from, to);
    res.status(201).json({ data: insight });
  })
);

module.exports = router;
