// Idempotent seed: demo user, 2 ad accounts (google + meta), 4 campaigns per
// account and 90 days of deterministic mock metrics per campaign.
// Uses the exact same generator as the mock sync services, so seeded data
// and mock-synced data are identical (ON CONFLICT upserts keep it stable).
const bcrypt = require("bcryptjs");
const pool = require("./pool");
const mock = require("../services/mock");
const { todayStr, addDaysStr, eachDateStr } = require("../utils/dates");

const DEMO_USER = {
  name: "Demo User",
  email: "demo@adpulse.io",
  password: "demo1234",
};

const DEMO_ACCOUNTS = [
  {
    platform: "google",
    external_id: "123-456-7890",
    name: "AdPulse Demo — Google Ads",
    currency: "USD",
  },
  {
    platform: "meta",
    external_id: "act_1029384756",
    name: "AdPulse Demo — Meta Ads",
    currency: "USD",
  },
];

const METRIC_DAYS = 90;

async function upsertUser() {
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [DEMO_USER.name, DEMO_USER.email, passwordHash]
  );
  return rows[0];
}

async function upsertAccount(userId, account) {
  const { rows } = await pool.query(
    `INSERT INTO ad_accounts (user_id, platform, external_id, name, currency)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (platform, external_id)
     DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency
     RETURNING id, platform`,
    [userId, account.platform, account.external_id, account.name, account.currency]
  );
  return rows[0];
}

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
    [adAccountId, campaign.external_id, campaign.name, campaign.status, campaign.objective]
  );
  return rows[0].id;
}

// Batched upsert of one campaign's daily metrics (90 rows in one statement).
async function upsertCampaignMetrics(campaignId, externalId, platform, dates) {
  const values = [];
  const params = [];
  dates.forEach((date, idx) => {
    const m = mock.generateDailyMetrics(externalId, date, platform);
    const base = idx * 6;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
    );
    params.push(campaignId, date, m.impressions, m.clicks, m.spend, m.conversions);
  });
  await pool.query(
    `INSERT INTO metrics_daily (campaign_id, date, impressions, clicks, spend, conversions)
     VALUES ${values.join(", ")}
     ON CONFLICT (campaign_id, date)
     DO UPDATE SET impressions = EXCLUDED.impressions,
                   clicks = EXCLUDED.clicks,
                   spend = EXCLUDED.spend,
                   conversions = EXCLUDED.conversions`,
    params
  );
  return dates.length;
}

async function seed() {
  console.log("[seed] mulai seeding (idempotent)...");

  const user = await upsertUser();
  console.log(`[seed] user demo siap: ${user.email} (password: ${DEMO_USER.password})`);

  const to = todayStr();
  const from = addDaysStr(to, -(METRIC_DAYS - 1));
  const dates = eachDateStr(from, to);

  let totalMetricRows = 0;
  for (const accountDef of DEMO_ACCOUNTS) {
    const account = await upsertAccount(user.id, accountDef);
    const campaigns = mock.generateCampaigns(account.platform);
    for (const campaign of campaigns) {
      const campaignId = await upsertCampaign(account.id, campaign);
      totalMetricRows += await upsertCampaignMetrics(
        campaignId,
        campaign.external_id,
        account.platform,
        dates
      );
    }
    console.log(
      `[seed] akun ${account.platform}: ${campaigns.length} campaigns + metrik ${METRIC_DAYS} hari.`
    );
  }

  console.log(`[seed] selesai — total ${totalMetricRows} baris metrics_daily di-upsert.`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] gagal:", err.message);
    pool.end().finally(() => process.exit(1));
  });
