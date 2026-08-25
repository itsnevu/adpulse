// Google Ads service.
//
// Mock mode (MOCK_ADS=true or incomplete credentials) uses the deterministic
// generator in mock.js so the whole demo works without real API access.
//
// Real mode calls the Google Ads REST API (googleAds:searchStream over
// HTTPS) using an OAuth2 refresh-token flow. Node 20's built-in fetch is
// used — no extra HTTP dependency.
//
// ONBOARDING NOTES (verify with the client before go-live):
// - GOOGLE_ADS_DEVELOPER_TOKEN must have at least Basic access (test tokens
//   only reach test accounts).
// - API_VERSION below must match a currently supported Google Ads API
//   version (they deprecate roughly every 12 months).
// - login-customer-id: required when accessing a client account through an
//   MCC/manager account — verify the client's account structure.
// - metrics.conversions counts the account's default conversion actions —
//   confirm which conversion actions the client wants included.
const config = require("../config");
const mock = require("./mock");
const { decryptToken } = require("../utils/crypto");
const { eachDateStr, isValidDateStr } = require("../utils/dates");

// VERIFY AT ONBOARDING: keep in sync with supported Google Ads API versions.
const API_VERSION = "v18";
const ADS_HOST = "https://googleads.googleapis.com";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

function hasCredentials() {
  const g = config.google;
  return Boolean(
    g.clientId && g.clientSecret && g.developerToken && g.refreshToken && g.customerId
  );
}

function useMock() {
  return config.mockAds || !hasCredentials();
}

// Exchange the long-lived refresh token for a short-lived access token.
// Refresh token per akun (ad_accounts.refresh_token, terenkripsi AES-256-GCM
// di DB → didekripsi di sini) lebih diprioritaskan daripada env global.
async function getAccessToken(account) {
  const g = config.google;
  const storedRefreshToken =
    account && account.refresh_token ? decryptToken(account.refresh_token) : null;
  const body = new URLSearchParams({
    client_id: g.clientId,
    client_secret: g.clientSecret,
    refresh_token: storedRefreshToken || g.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token exchange failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.access_token;
}

// Run a GAQL query through googleAds:searchStream and return all result rows.
async function searchStream(customerId, query, account) {
  const accessToken = await getAccessToken(account);
  const url = `${ADS_HOST}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": config.google.developerToken,
      // VERIFY AT ONBOARDING: add "login-customer-id" header (manager/MCC
      // customer id, digits only) if the account is accessed via a manager.
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads searchStream failed (${res.status}): ${text}`);
  }
  // searchStream returns an array of response chunks, each with .results.
  const chunks = await res.json();
  const rows = [];
  for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
    if (Array.isArray(chunk.results)) rows.push(...chunk.results);
  }
  return rows;
}

// Map Google campaign status enum → schema status (active|paused|ended).
function mapStatus(googleStatus) {
  switch (googleStatus) {
    case "ENABLED":
      return "active";
    case "PAUSED":
      return "paused";
    case "REMOVED":
      return "ended";
    default:
      return "paused";
  }
}

// Fetch campaigns for one ad account.
// Returns: [{ external_id, name, status, objective }]
async function fetchCampaigns(account) {
  if (useMock()) {
    return mock.generateCampaigns("google");
  }
  // account.external_id holds the Google customer id (digits, no dashes).
  const customerId = String(account.external_id).replace(/-/g, "");
  const rows = await searchStream(
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type
     FROM campaign
     ORDER BY campaign.id`,
    account
  );
  return rows.map((row) => ({
    external_id: String(row.campaign.id),
    name: row.campaign.name,
    status: mapStatus(row.campaign.status),
    objective: row.campaign.advertisingChannelType || null,
  }));
}

// Fetch daily metrics for all campaigns of one account between two dates
// (inclusive, YYYY-MM-DD).
// Returns: [{ campaign_external_id, date, impressions, clicks, spend, conversions, raw }]
async function fetchDailyMetrics(account, fromDate, toDate) {
  if (useMock()) {
    const out = [];
    for (const campaign of mock.generateCampaigns("google")) {
      for (const date of eachDateStr(fromDate, toDate)) {
        const m = mock.generateDailyMetrics(campaign.external_id, date, "google");
        out.push({ campaign_external_id: campaign.external_id, date, ...m, raw: null });
      }
    }
    return out;
  }

  // Tanggal diinterpolasi ke string GAQL — validasi ketat YYYY-MM-DD dulu
  // supaya nilai apa pun selain tanggal murni tidak pernah masuk query.
  if (!isValidDateStr(fromDate) || !isValidDateStr(toDate)) {
    throw new Error(
      `Rentang tanggal sync tidak valid: ${fromDate} s/d ${toDate} (harus YYYY-MM-DD).`
    );
  }
  const customerId = String(account.external_id).replace(/-/g, "");
  const rows = await searchStream(
    customerId,
    `SELECT campaign.id, segments.date,
            metrics.impressions, metrics.clicks,
            metrics.cost_micros, metrics.conversions
     FROM campaign
     WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
     ORDER BY segments.date`,
    account
  );
  return rows.map((row) => ({
    campaign_external_id: String(row.campaign.id),
    date: row.segments.date,
    impressions: Number(row.metrics.impressions || 0),
    clicks: Number(row.metrics.clicks || 0),
    // cost_micros is in millionths of the account currency.
    spend: Math.round((Number(row.metrics.costMicros || 0) / 1e6) * 100) / 100,
    // VERIFY AT ONBOARDING: metrics.conversions uses the account's default
    // "include in Conversions" setting — confirm with the client.
    conversions: Number(row.metrics.conversions || 0),
    raw: row,
  }));
}

module.exports = { fetchCampaigns, fetchDailyMetrics, useMock, hasCredentials };
