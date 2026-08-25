// Sync service — pulls campaigns + daily metrics from an ads platform into
// the database for every ad_account of that platform, with a sync_logs
// audit trail (running -> success | error).
const pool = require("../db/pool");
const googleAds = require("./googleAds");
const metaAds = require("./metaAds");
const { todayStr, addDaysStr } = require("../utils/dates");
const { httpError } = require("../utils/errors");

const PLATFORM_SERVICES = {
  google: googleAds,
  meta: metaAds,
  // linkedin: phase 2
};

// How far back each sync refreshes daily metrics.
const SYNC_WINDOW_DAYS = 30;

// Upsert one campaign, returns the internal campaign id.
async function upsertCampaign(adAccountId, campaign) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (ad_account_id, external_id, name, status, objective)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ad_account_id, external_id)
     DO UPDATE SET name = EXCLUDED.name,
                   status = EXCLUDED.status,
                   objective = EXCLUDED.objective,
                   updated_at = now()
     RETURNING id`,
    [
      adAccountId,
      campaign.external_id,
      campaign.name,
      campaign.status || "active",
      campaign.objective || null,
    ]
  );
  return rows[0].id;
}

// Upsert daily metric rows in batches. Returns the number of rows written.
async function upsertMetrics(rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, idx) => {
      const base = idx * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
      );
      params.push(
        r.campaignId,
        r.date,
        r.impressions,
        r.clicks,
        r.spend,
        r.conversions,
        r.raw ? JSON.stringify(r.raw) : null
      );
    });
    await pool.query(
      `INSERT INTO metrics_daily
         (campaign_id, date, impressions, clicks, spend, conversions, raw)
       VALUES ${values.join(", ")}
       ON CONFLICT (campaign_id, date)
       DO UPDATE SET impressions = EXCLUDED.impressions,
                     clicks = EXCLUDED.clicks,
                     spend = EXCLUDED.spend,
                     conversions = EXCLUDED.conversions,
                     raw = EXCLUDED.raw`,
      params
    );
    written += chunk.length;
  }
  return written;
}

// Run a full sync for one platform across every ad_account of that platform.
// Returns the finished sync_logs row.
async function runSync(platform) {
  const service = PLATFORM_SERVICES[platform];
  if (!service) {
    throw httpError(
      400,
      `Platform tidak didukung: ${platform}. Gunakan "google" atau "meta".`
    );
  }

  const { rows: logRows } = await pool.query(
    `INSERT INTO sync_logs (platform, status) VALUES ($1, 'running') RETURNING id`,
    [platform]
  );
  const logId = logRows[0].id;

  try {
    const { rows: accounts } = await pool.query(
      `SELECT * FROM ad_accounts WHERE platform = $1 AND status = 'active'`,
      [platform]
    );
    if (accounts.length === 0) {
      throw new Error(
        `Tidak ada ad_account aktif untuk platform ${platform}. Tambahkan akun dulu.`
      );
    }

    const to = todayStr();
    const from = addDaysStr(to, -(SYNC_WINDOW_DAYS - 1));
    let recordsSynced = 0;

    for (const account of accounts) {
      // 1. Campaigns — upsert and remember external_id -> internal id.
      const campaigns = await service.fetchCampaigns(account);
      const idByExternal = new Map();
      for (const campaign of campaigns) {
        const id = await upsertCampaign(account.id, campaign);
        idByExternal.set(String(campaign.external_id), id);
        recordsSynced += 1;
      }

      // 2. Daily metrics for the sync window.
      const metricRows = await service.fetchDailyMetrics(account, from, to);
      const mapped = [];
      for (const row of metricRows) {
        const campaignId = idByExternal.get(String(row.campaign_external_id));
        // Metrics may reference a campaign not returned by fetchCampaigns
        // (e.g. removed campaigns) — skip those rows safely.
        if (!campaignId) continue;
        mapped.push({
          campaignId,
          date: row.date,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          conversions: row.conversions,
          raw: row.raw,
        });
      }
      recordsSynced += await upsertMetrics(mapped);
    }

    const { rows: doneRows } = await pool.query(
      `UPDATE sync_logs
       SET status = 'success', records_synced = $2, finished_at = now()
       WHERE id = $1
       RETURNING *`,
      [logId, recordsSynced]
    );
    return doneRows[0];
  } catch (err) {
    const { rows: failRows } = await pool.query(
      `UPDATE sync_logs
       SET status = 'error', error = $2, finished_at = now()
       WHERE id = $1
       RETURNING *`,
      [logId, err.message]
    );
    console.error(`[sync] ${platform} gagal:`, err.message);
    return failRows[0];
  }
}

module.exports = { runSync };
