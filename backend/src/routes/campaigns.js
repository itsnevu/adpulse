// Campaign routes: list with 30-day aggregated metrics.
//
// SQL-nya ada di services/adsQuery.js supaya tool agent AI dan endpoint ini
// membaca dari satu sumber yang sama.
const express = require("express");
const { z } = require("zod");
const adsQuery = require("../services/adsQuery");
const { validateQuery } = require("../middleware/validate");
const { emptyToUndef } = require("../utils/zfields");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();

const { PLATFORMS, STATUSES } = adsQuery;

const listQuerySchema = z.object({
  platform: emptyToUndef(
    z
      .enum(PLATFORMS, {
        message: `Platform harus salah satu dari: ${PLATFORMS.join(", ")}`,
      })
      .optional()
  ),
  status: emptyToUndef(
    z
      .enum(STATUSES, {
        message: `Status harus salah satu dari: ${STATUSES.join(", ")}`,
      })
      .optional()
  ),
  search: emptyToUndef(z.string().optional()),
});

// GET /api/campaigns?platform=&status=&search=
// Campaigns of the authenticated user + aggregated metrics for the last
// 30 days (spend, impressions, clicks, conversions, ctr, cpc).
router.get(
  "/",
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await adsQuery.campaigns(req.user.id, req.query) });
  })
);

module.exports = router;
