// Insight routes: list + generate (Claude AI, with mock fallback).
const express = require("express");
const { z } = require("zod");
const pool = require("../db/pool");
const insightEngine = require("../services/insightEngine");
const { validateBody } = require("../middleware/validate");
const { dateStr, fromLteTo } = require("../utils/zfields");
const { asyncHandler } = require("../utils/errors");
const { todayStr, addDaysStr } = require("../utils/dates");

const router = express.Router();

const generateSchema = z
  .object({
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .superRefine(fromLteTo);

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
  validateBody(generateSchema),
  asyncHandler(async (req, res) => {
    const to = req.body.to || todayStr();
    const from = req.body.from || addDaysStr(to, -6);

    const insight = await insightEngine.generateInsight(req.user.id, from, to);
    res.status(201).json({ data: insight });
  })
);

module.exports = router;
