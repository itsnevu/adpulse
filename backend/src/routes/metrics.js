// Metrics routes: summary (with deltas), timeseries, by-platform.
const express = require("express");
const pool = require("../db/pool");
const { httpError, asyncHandler } = require("../utils/errors");
const {
  isValidDateStr,
  todayStr,
  addDaysStr,
  diffDays,
  eachDateStr,
} = require("../utils/dates");

const router = express.Router();

const PLATFORMS = ["google", "meta", "linkedin"];
const METRICS = ["spend", "impressions", "clicks", "conversions"];

const num = (v) => Number(v || 0);
const round1 = (v) => Math.round(num(v) * 10) / 10;
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Resolve and validate ?from=&to=&platform= (default: last 30 days).
function parseRange(query) {
  const to = query.to || todayStr();
  const from = query.from || addDaysStr(to, -29);
  if (!isValidDateStr(from) || !isValidDateStr(to)) {
    throw httpError(400, "Parameter from/to harus format YYYY-MM-DD.");
  }
  if (from > to) {
    throw httpError(400, "Parameter from harus <= to.");
  }
  const platform = query.platform || null;
  if (platform && !PLATFORMS.includes(platform)) {
    throw httpError(400, `Platform harus salah satu dari: ${PLATFORMS.join(", ")}.`);
  }
  return { from, to, platform };
}

// Aggregate totals for a user within [from, to], optionally per platform.
async function totalsFor(userId, from, to, platform) {
  const params = [userId, from, to];
  let platformFilter = "";
  if (platform) {
    params.push(platform);
    platformFilter = `AND a.platform = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(m.spend), 0)       AS spend,
            COALESCE(SUM(m.impressions), 0) AS impressions,
            COALESCE(SUM(m.clicks), 0)      AS clicks,
            COALESCE(SUM(m.conversions), 0) AS conversions
     FROM metrics_daily m
     JOIN campaigns c   ON c.id = m.campaign_id
     JOIN ad_accounts a ON a.id = c.ad_account_id
     WHERE a.user_id = $1 AND m.date BETWEEN $2 AND $3 ${platformFilter}`,
    params
  );
  const t = rows[0];
  return {
    spend: num(t.spend),
    impressions: num(t.impressions),
    clicks: num(t.clicks),
    conversions: num(t.conversions),
  };
}

// Percentage change vs the previous value (1 decimal).
function pctDelta(current, previous) {
  if (previous > 0) return round1(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

// GET /api/metrics/summary?from=&to=&platform=
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { from, to, platform } = parseRange(req.query);

    // Previous period: same length, immediately before the current one.
    const lengthDays = diffDays(from, to) + 1;
    const prevTo = addDaysStr(from, -1);
    const prevFrom = addDaysStr(prevTo, -(lengthDays - 1));

    const [cur, prev] = await Promise.all([
      totalsFor(req.user.id, from, to, platform),
      totalsFor(req.user.id, prevFrom, prevTo, platform),
    ]);

    res.json({
      data: {
        spend: round2(cur.spend),
        impressions: cur.impressions,
        clicks: cur.clicks,
        conversions: round2(cur.conversions),
        ctr: cur.impressions > 0 ? round2((cur.clicks / cur.impressions) * 100) : 0,
        cpc: cur.clicks > 0 ? round2(cur.spend / cur.clicks) : 0,
        cpm: cur.impressions > 0 ? round2((cur.spend / cur.impressions) * 1000) : 0,
        deltas: {
          spend: pctDelta(cur.spend, prev.spend),
          impressions: pctDelta(cur.impressions, prev.impressions),
          clicks: pctDelta(cur.clicks, prev.clicks),
          conversions: pctDelta(cur.conversions, prev.conversions),
        },
      },
    });
  })
);

// GET /api/metrics/timeseries?from=&to=&platform=&metric=
router.get(
  "/timeseries",
  asyncHandler(async (req, res) => {
    const { from, to, platform } = parseRange(req.query);
    const metric = req.query.metric || "spend";
    if (!METRICS.includes(metric)) {
      throw httpError(400, `Metric harus salah satu dari: ${METRICS.join(", ")}.`);
    }

    const params = [req.user.id, from, to];
    let platformFilter = "";
    if (platform) {
      params.push(platform);
      platformFilter = `AND a.platform = $${params.length}`;
    }
    // "metric" is validated against the whitelist above, so interpolating
    // the column name here is safe.
    const { rows } = await pool.query(
      `SELECT m.date, a.platform, COALESCE(SUM(m.${metric}), 0) AS value
       FROM metrics_daily m
       JOIN campaigns c   ON c.id = m.campaign_id
       JOIN ad_accounts a ON a.id = c.ad_account_id
       WHERE a.user_id = $1 AND m.date BETWEEN $2 AND $3 ${platformFilter}
       GROUP BY m.date, a.platform
       ORDER BY m.date ASC`,
      params
    );

    // Zero-filled continuous series so charts have no gaps.
    const byDate = new Map();
    for (const date of eachDateStr(from, to)) {
      byDate.set(date, { date, google: 0, meta: 0, linkedin: 0, total: 0 });
    }
    for (const row of rows) {
      const point = byDate.get(row.date);
      if (!point) continue;
      const value = round2(row.value);
      point[row.platform] = value;
      point.total = round2(point.total + value);
    }

    res.json({ data: Array.from(byDate.values()) });
  })
);

// GET /api/metrics/by-platform?from=&to=
router.get(
  "/by-platform",
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query(
      `SELECT a.platform,
              COALESCE(SUM(m.spend), 0)       AS spend,
              COALESCE(SUM(m.impressions), 0) AS impressions,
              COALESCE(SUM(m.clicks), 0)      AS clicks,
              COALESCE(SUM(m.conversions), 0) AS conversions
       FROM metrics_daily m
       JOIN campaigns c   ON c.id = m.campaign_id
       JOIN ad_accounts a ON a.id = c.ad_account_id
       WHERE a.user_id = $1 AND m.date BETWEEN $2 AND $3
       GROUP BY a.platform
       ORDER BY spend DESC`,
      [req.user.id, from, to]
    );

    res.json({
      data: rows.map((r) => ({
        platform: r.platform,
        spend: round2(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: round2(r.conversions),
      })),
    });
  })
);

module.exports = router;
