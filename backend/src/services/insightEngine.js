// Insight engine — aggregates a user's ads data for a period, asks Claude
// for an analysis, stores the result in the insights table and returns it.
const pool = require("../db/pool");
const claude = require("./claude");
const { httpError } = require("../utils/errors");

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Aggregate everything Claude needs to reason about the period.
async function collectStats(userId, from, to) {
  const totalsQ = pool.query(
    `SELECT COALESCE(SUM(m.spend), 0)       AS spend,
            COALESCE(SUM(m.impressions), 0) AS impressions,
            COALESCE(SUM(m.clicks), 0)      AS clicks,
            COALESCE(SUM(m.conversions), 0) AS conversions
     FROM metrics_daily m
     JOIN campaigns c   ON c.id = m.campaign_id
     JOIN ad_accounts a ON a.id = c.ad_account_id
     WHERE a.user_id = $1 AND m.date BETWEEN $2 AND $3`,
    [userId, from, to]
  );

  const byPlatformQ = pool.query(
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
    [userId, from, to]
  );

  const perCampaignQ = pool.query(
    `SELECT c.name, a.platform,
            COALESCE(SUM(m.spend), 0)       AS spend,
            COALESCE(SUM(m.impressions), 0) AS impressions,
            COALESCE(SUM(m.clicks), 0)      AS clicks,
            COALESCE(SUM(m.conversions), 0) AS conversions
     FROM campaigns c
     JOIN ad_accounts a ON a.id = c.ad_account_id
     LEFT JOIN metrics_daily m
            ON m.campaign_id = c.id AND m.date BETWEEN $2 AND $3
     WHERE a.user_id = $1
     GROUP BY c.id, c.name, a.platform`,
    [userId, from, to]
  );

  const [totalsRes, byPlatformRes, perCampaignRes] = await Promise.all([
    totalsQ,
    byPlatformQ,
    perCampaignQ,
  ]);

  const t = totalsRes.rows[0];
  const impressions = num(t.impressions);
  const clicks = num(t.clicks);
  const spend = num(t.spend);

  const summary = {
    spend: round2(spend),
    impressions,
    clicks,
    conversions: round2(t.conversions),
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? round2(spend / clicks) : 0,
  };

  const byPlatform = byPlatformRes.rows.map((r) => ({
    platform: r.platform,
    spend: round2(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: round2(r.conversions),
    ctr: num(r.impressions) > 0 ? round2((num(r.clicks) / num(r.impressions)) * 100) : 0,
  }));

  const campaigns = perCampaignRes.rows.map((r) => ({
    name: r.name,
    platform: r.platform,
    spend: round2(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: round2(r.conversions),
    ctr: num(r.impressions) > 0 ? round2((num(r.clicks) / num(r.impressions)) * 100) : 0,
  }));

  const topBySpend = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5);
  // Bottom performers by CTR — only campaigns with enough impressions to be
  // statistically meaningful.
  const bottomByCtr = campaigns
    .filter((c) => c.impressions >= 500)
    .sort((a, b) => a.ctr - b.ctr)
    .slice(0, 5);

  return { summary, byPlatform, topBySpend, bottomByCtr };
}

function buildPrompt(from, to, stats) {
  return [
    `Analisis performa iklan untuk periode ${from} s/d ${to}.`,
    "Data agregat (mata uang mengikuti masing-masing akun iklan, mayoritas USD):",
    "",
    "RINGKASAN TOTAL:",
    JSON.stringify(stats.summary, null, 2),
    "",
    "PER PLATFORM:",
    JSON.stringify(stats.byPlatform, null, 2),
    "",
    "TOP 5 CAMPAIGN BERDASARKAN SPEND:",
    JSON.stringify(stats.topBySpend, null, 2),
    "",
    "5 CAMPAIGN DENGAN CTR TERENDAH (min. 500 impresi):",
    JSON.stringify(stats.bottomByCtr, null, 2),
    "",
    "Buat analisis dan rekomendasi sesuai format JSON yang diwajibkan.",
  ].join("\n");
}

// Generate + persist an insight for one user and period. Returns the row.
async function generateInsight(userId, from, to) {
  const stats = await collectStats(userId, from, to);
  if (stats.summary.impressions === 0 && stats.summary.spend === 0) {
    throw httpError(
      422,
      "Tidak ada data metrik pada periode tersebut. Jalankan sync terlebih dahulu."
    );
  }

  const prompt = buildPrompt(from, to, stats);
  const result = await claude.generateInsight(prompt, stats);

  const { rows } = await pool.query(
    `INSERT INTO insights
       (user_id, period_start, period_end, summary, recommendations, model, tokens_used)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      userId,
      from,
      to,
      result.summary,
      JSON.stringify(result.recommendations),
      result.model,
      result.tokensUsed,
    ]
  );
  return rows[0];
}

module.exports = { generateInsight, collectStats };
