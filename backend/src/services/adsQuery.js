// Lapisan query data iklan — SATU sumber kebenaran untuk angka AdPulse.
//
// Dulu SQL agregat hidup di dalam handler route. Sejak agent MCP (v1.2) ikut
// membaca angka yang sama, salinan kedua SQL berarti dashboard dan AI bisa
// menjawab beda untuk pertanyaan yang sama — bug yang paling mahal di produk
// analitik, karena tidak terlihat sampai ada yang membandingkan. Jadi route
// DAN tool agent sama-sama memanggil fungsi di file ini.
//
// Semua fungsi di-scope per user (a.user_id) — tidak ada jalan untuk membaca
// data user lain, termasuk lewat tool yang dipanggil model.
const pool = require("../db/pool");
const { httpError } = require("../utils/errors");
const {
  isValidDateStr,
  todayStr,
  addDaysStr,
  diffDays,
  eachDateStr,
} = require("../utils/dates");

const PLATFORMS = ["google", "meta", "linkedin"];
const METRICS = ["spend", "impressions", "clicks", "conversions"];
const STATUSES = ["active", "paused", "ended"];

const num = (v) => Number(v || 0);
const round1 = (v) => Math.round(num(v) * 10) / 10;
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Resolusi + validasi rentang tanggal (default: 30 hari terakhir).
function resolveRange(query = {}) {
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

// Total agregat satu user dalam [from, to], opsional difilter platform.
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

// Perubahan persen vs nilai sebelumnya (1 desimal).
function pctDelta(current, previous) {
  if (previous > 0) return round1(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

// Ringkasan performa + delta vs periode sebelumnya dengan panjang sama.
async function summary(userId, query = {}) {
  const { from, to, platform } = resolveRange(query);

  const lengthDays = diffDays(from, to) + 1;
  const prevTo = addDaysStr(from, -1);
  const prevFrom = addDaysStr(prevTo, -(lengthDays - 1));

  const [cur, prev] = await Promise.all([
    totalsFor(userId, from, to, platform),
    totalsFor(userId, prevFrom, prevTo, platform),
  ]);

  return {
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
  };
}

// Deret harian per platform, zero-filled supaya grafik tidak berlubang.
async function timeseries(userId, query = {}) {
  const { from, to, platform } = resolveRange(query);
  const metric = query.metric || "spend";
  if (!METRICS.includes(metric)) {
    throw httpError(400, `Metric harus salah satu dari: ${METRICS.join(", ")}.`);
  }

  const params = [userId, from, to];
  let platformFilter = "";
  if (platform) {
    params.push(platform);
    platformFilter = `AND a.platform = $${params.length}`;
  }
  // `metric` sudah dicek terhadap whitelist METRICS di atas, jadi
  // menginterpolasi nama kolom di sini aman dari injeksi.
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

  return Array.from(byDate.values());
}

// Breakdown total per platform, terbesar dulu.
async function byPlatform(userId, query = {}) {
  const { from, to } = resolveRange(query);
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
    [userId, from, to]
  );

  return rows.map((r) => ({
    platform: r.platform,
    spend: round2(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: round2(r.conversions),
  }));
}

// Daftar campaign + agregat metrik 30 hari terakhir.
async function campaigns(userId, query = {}) {
  const { platform, status, search } = query;
  if (platform && !PLATFORMS.includes(platform)) {
    throw httpError(400, `Platform harus salah satu dari: ${PLATFORMS.join(", ")}.`);
  }
  if (status && !STATUSES.includes(status)) {
    throw httpError(400, `Status harus salah satu dari: ${STATUSES.join(", ")}.`);
  }

  const params = [userId];
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

  return rows.map((r) => {
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
}

// Ad account milik user. Kolom token sengaja TIDAK pernah di-SELECT.
async function accounts(userId) {
  const { rows } = await pool.query(
    `SELECT id, platform, external_id, name, currency, status, created_at
     FROM ad_accounts
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

// Riwayat sync milik user.
async function syncLogs(userId, limit = 50) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT id, platform, status, records_synced, error, started_at, finished_at
     FROM sync_logs
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [userId, capped]
  );
  return rows;
}

module.exports = {
  PLATFORMS,
  METRICS,
  STATUSES,
  resolveRange,
  summary,
  timeseries,
  byPlatform,
  campaigns,
  accounts,
  syncLogs,
};
