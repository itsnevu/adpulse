// Campaign routes: list with 30-day aggregated metrics.
const express = require("express");
const pool = require("../db/pool");
const { httpError, asyncHandler } = require("../utils/errors");

const router = express.Router();

const PLATFORMS = ["google", "meta", "linkedin"];
const STATUSES = ["active", "paused", "ended"];

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;

// GET /api/campaigns?platform=&status=&search=
// Campaigns of the authenticated user + aggregated metrics for the last
// 30 days (spend, impressions, clicks, conversions, ctr, cpc).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { platform, status, search } = req.query;
    if (platform && !PLATFORMS.includes(platform)) {
      throw httpError(400, `Platform harus salah satu dari: ${PLATFORMS.join(", ")}.`);
    }
    if (status && !STATUSES.includes(status)) {
      throw httpError(400, `Status harus salah satu dari: ${STATUSES.join(", ")}.`);
    }

    const params = [req.user.id];
    const where = ["a.user_id = $1"];
    if (platform) {
      params.push(platform);
      where.push(`a.platform = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      where.push(`c.name ILIKE $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT c.id, c.external_id, c.name, c.status, c.objective,
              c.created_at, c.updated_at,
              a.platform, a.currency, a.name AS account_name,
              COALESCE(m.spend, 0)       AS spend,
              COALESCE(m.impressions, 0) AS impressions,
              COALESCE(m.clicks, 0)      AS clicks,
              COALESCE(m.conversions, 0) AS conversions
       FROM campaigns c
       JOIN ad_accounts a ON a.id = c.ad_account_id
       LEFT JOIN (
         SELECT campaign_id,
                SUM(spend)       AS spend,
                SUM(impressions) AS impressions,
                SUM(clicks)      AS clicks,
                SUM(conversions) AS conversions
         FROM metrics_daily
         WHERE date >= CURRENT_DATE - 29
         GROUP BY campaign_id
       ) m ON m.campaign_id = c.id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(m.spend, 0) DESC, c.name ASC`,
      params
    );

    const data = rows.map((r) => {
      const impressions = num(r.impressions);
      const clicks = num(r.clicks);
      const spend = num(r.spend);
      return {
        id: r.id,
        external_id: r.external_id,
        name: r.name,
        status: r.status,
        objective: r.objective,
        platform: r.platform,
        currency: r.currency,
        account_name: r.account_name,
        created_at: r.created_at,
        updated_at: r.updated_at,
        spend: round2(spend),
        impressions,
        clicks,
        conversions: round2(r.conversions),
        ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
        cpc: clicks > 0 ? round2(spend / clicks) : 0,
      };
    });

    res.json({ data });
  })
);

module.exports = router;
