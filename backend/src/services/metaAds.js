// Meta (Facebook/Instagram) Ads service.
//
// Mock mode (MOCK_ADS=true or incomplete credentials) uses the deterministic
// generator in mock.js.
//
// Real mode calls the Meta Marketing API (Graph API) with a long-lived
// access token. Node 20's built-in fetch is used.
//
// ONBOARDING NOTES (verify with the client before go-live):
// - GRAPH_VERSION below must be a currently supported Graph API version.
// - META_ACCESS_TOKEN should be a System User token with ads_read scope so
//   it does not expire with a personal session.
// - META_AD_ACCOUNT_ID must include the "act_" prefix (e.g. act_1234567890).
// - Conversion counting: the insights "actions" array contains many action
//   types — confirm which action type the client counts as a conversion
//   (see CONVERSION_ACTION_TYPES below).
const config = require("../config");
const mock = require("./mock");
const { decryptToken } = require("../utils/crypto");
const { eachDateStr } = require("../utils/dates");

// VERIFY AT ONBOARDING: keep in sync with supported Graph API versions.
const GRAPH_VERSION = "v21.0";
const GRAPH_HOST = "https://graph.facebook.com";

// VERIFY AT ONBOARDING: which Meta action types count as a "conversion" for
// this client. Common choices: purchases, leads, or app installs.
const CONVERSION_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
];

function hasCredentials() {
  const m = config.meta;
  return Boolean(m.accessToken && m.adAccountId);
}

function useMock() {
  return config.mockAds || !hasCredentials();
}

// Access token per akun (ad_accounts.access_token, terenkripsi AES-256-GCM
// di DB → didekripsi di sini) lebih diprioritaskan daripada env global.
function resolveAccessToken(account) {
  const stored =
    account && account.access_token ? decryptToken(account.access_token) : null;
  return stored || config.meta.accessToken;
}

async function graphGet(pathname, params, account) {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", resolveAccessToken(account));
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta Graph API failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Follow Graph API cursor pagination until exhausted.
async function graphGetAll(pathname, params, account) {
  const out = [];
  let page = await graphGet(pathname, params, account);
  for (;;) {
    if (Array.isArray(page.data)) out.push(...page.data);
    const nextUrl = page.paging && page.paging.next;
    if (!nextUrl) break;
    const res = await fetch(nextUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta Graph API pagination failed (${res.status}): ${text}`);
    }
    page = await res.json();
  }
  return out;
}

// Map Meta effective_status → schema status (active|paused|ended).
function mapStatus(metaStatus) {
  switch (metaStatus) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
      return "paused";
    case "ARCHIVED":
    case "DELETED":
    case "COMPLETED":
      return "ended";
    default:
      return "paused";
  }
}

// Sum the conversion-like actions out of the insights "actions" array.
function extractConversions(actions) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const action of actions) {
    if (CONVERSION_ACTION_TYPES.includes(action.action_type)) {
      total += Number(action.value || 0);
    }
  }
  return Math.round(total * 100) / 100;
}

// Fetch campaigns for one ad account.
// Returns: [{ external_id, name, status, objective }]
async function fetchCampaigns(account) {
  if (useMock()) {
    return mock.generateCampaigns("meta");
  }
  // account.external_id holds the Meta ad account id ("act_..." prefix).
  const data = await graphGetAll(
    `${account.external_id}/campaigns`,
    {
      fields: "id,name,effective_status,objective",
      limit: "100",
    },
    account
  );
  return data.map((c) => ({
    external_id: String(c.id),
    name: c.name,
    status: mapStatus(c.effective_status),
    objective: c.objective || null,
  }));
}

// Fetch daily metrics per campaign between two dates (inclusive, YYYY-MM-DD).
// Returns: [{ campaign_external_id, date, impressions, clicks, spend, conversions, raw }]
async function fetchDailyMetrics(account, fromDate, toDate) {
  if (useMock()) {
    const out = [];
    for (const campaign of mock.generateCampaigns("meta")) {
      for (const date of eachDateStr(fromDate, toDate)) {
        const m = mock.generateDailyMetrics(campaign.external_id, date, "meta");
        out.push({ campaign_external_id: campaign.external_id, date, ...m, raw: null });
      }
    }
    return out;
  }

  const data = await graphGetAll(
    `${account.external_id}/insights`,
    {
      level: "campaign",
      fields: "campaign_id,date_start,impressions,clicks,spend,actions",
      time_range: JSON.stringify({ since: fromDate, until: toDate }),
      time_increment: "1", // one row per campaign per day
      limit: "500",
    },
    account
  );
  return data.map((row) => ({
    campaign_external_id: String(row.campaign_id),
    date: row.date_start,
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    spend: Math.round(Number(row.spend || 0) * 100) / 100,
    conversions: extractConversions(row.actions),
    raw: row,
  }));
}

module.exports = { fetchCampaigns, fetchDailyMetrics, useMock, hasCredentials };
