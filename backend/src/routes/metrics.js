// Metrics routes: summary (with deltas), timeseries, by-platform.
//
// SQL agregatnya ada di services/adsQuery.js, bukan di sini — tool agent AI
// membaca angka yang sama, dan dua salinan SQL berarti dashboard dan AI bisa
// menjawab beda untuk pertanyaan yang sama.
const express = require("express");
const { z } = require("zod");
const adsQuery = require("../services/adsQuery");
const { validateQuery } = require("../middleware/validate");
const { emptyToUndef, dateStr, fromLteTo } = require("../utils/zfields");
const { asyncHandler } = require("../utils/errors");

const router = express.Router();

const { PLATFORMS, METRICS } = adsQuery;

// Query ?from=&to=&platform= (+ ?metric= utk timeseries). from/to opsional
// (default 30 hari terakhir) tapi WAJIB format YYYY-MM-DD dan from <= to.
const rangeShape = {
  from: emptyToUndef(dateStr.optional()),
  to: emptyToUndef(dateStr.optional()),
  platform: emptyToUndef(
    z
      .enum(PLATFORMS, {
        message: `Platform harus salah satu dari: ${PLATFORMS.join(", ")}`,
      })
      .optional()
  ),
};
const rangeQuerySchema = z.object(rangeShape).superRefine(fromLteTo);
const timeseriesQuerySchema = z
  .object({
    ...rangeShape,
    metric: emptyToUndef(
      z
        .enum(METRICS, {
          message: `Metric harus salah satu dari: ${METRICS.join(", ")}`,
        })
        .optional()
    ),
  })
  .superRefine(fromLteTo);

// GET /api/metrics/summary?from=&to=&platform=
router.get(
  "/summary",
  validateQuery(rangeQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await adsQuery.summary(req.user.id, req.query) });
  })
);

// GET /api/metrics/timeseries?from=&to=&platform=&metric=
router.get(
  "/timeseries",
  validateQuery(timeseriesQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await adsQuery.timeseries(req.user.id, req.query) });
  })
);

// GET /api/metrics/by-platform?from=&to=
router.get(
  "/by-platform",
  validateQuery(rangeQuerySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await adsQuery.byPlatform(req.user.id, req.query) });
  })
);

module.exports = router;
