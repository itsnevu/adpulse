// Deterministic mock data generator for ads platforms.
//
// Everything is derived from seeded PRNGs (mulberry32 seeded with a string
// hash), so the same campaign + date always produces the same metrics —
// across seed runs, mock syncs and restarts. This keeps demo dashboards
// stable while still looking like real, noisy ad data:
//   - CTR stays in the 1–5% range
//   - weekday/weekend rhythm plus a slow weekly up/down trend
//   - Google campaigns spend clearly more than Meta (higher CPC + CTR)

// --- Seeded PRNG -----------------------------------------------------------

// 32-bit string hash (xmur3-style finalizer) used to seed the PRNG.
function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// mulberry32: tiny, fast, good-quality 32-bit seeded PRNG. Returns [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randBetween(rng, min, max) {
  return min + rng() * (max - min);
}

// --- Mock campaign catalogs ------------------------------------------------

const MOCK_CAMPAIGNS = {
  google: [
    { external_id: "g-2001", name: "Brand Awareness Q3", status: "active", objective: "AWARENESS" },
    { external_id: "g-2002", name: "Search - Sepatu Lari Indonesia", status: "active", objective: "SEARCH" },
    { external_id: "g-2003", name: "Performance Max - Katalog Produk", status: "active", objective: "PERFORMANCE_MAX" },
    { external_id: "g-2004", name: "Display Retargeting - Pengunjung Blog", status: "paused", objective: "DISPLAY" },
  ],
  meta: [
    { external_id: "m-3001", name: "Retargeting - Checkout", status: "active", objective: "OUTCOME_SALES" },
    { external_id: "m-3002", name: "Prospecting - Lookalike 1%", status: "active", objective: "OUTCOME_SALES" },
    { external_id: "m-3003", name: "Traffic - Promo Akhir Bulan", status: "active", objective: "OUTCOME_TRAFFIC" },
    { external_id: "m-3004", name: "Engagement - Konten UGC", status: "paused", objective: "OUTCOME_ENGAGEMENT" },
  ],
  linkedin: [
    // Phase 2 — kept here so the generator already supports it.
    { external_id: "l-4001", name: "Lead Gen - Whitepaper B2B", status: "active", objective: "LEAD_GENERATION" },
    { external_id: "l-4002", name: "Brand - Thought Leadership", status: "active", objective: "BRAND_AWARENESS" },
  ],
};

// Platform economics: Google spends more than Meta (higher CPC, higher CTR),
// LinkedIn is expensive but low volume. CTR ranges keep overall CTR 1–5%.
const PLATFORM_PROFILE = {
  google: { impressions: [9000, 26000], ctr: [0.02, 0.05], cpc: [1.2, 2.6], cvr: [0.03, 0.08] },
  meta: { impressions: [8000, 20000], ctr: [0.01, 0.035], cpc: [0.35, 0.9], cvr: [0.02, 0.06] },
  linkedin: { impressions: [1500, 6000], ctr: [0.01, 0.025], cpc: [3.0, 6.5], cvr: [0.02, 0.05] },
};

// Weekday rhythm (index 0 = Sunday): weekends dip, midweek peaks.
const WEEKDAY_FACTOR = [0.8, 1.0, 1.06, 1.1, 1.08, 1.0, 0.85];

// --- Public API ------------------------------------------------------------

// List the mock campaigns for a platform (used by seed and mock sync).
function generateCampaigns(platform) {
  const list = MOCK_CAMPAIGNS[platform] || [];
  // Return copies so callers can't mutate the catalog.
  return list.map((c) => ({ ...c }));
}

// Deterministic daily metrics for one campaign on one date.
// campaignExternalId + dateStr fully determine the output.
function generateDailyMetrics(campaignExternalId, dateStr, platform) {
  const profile = PLATFORM_PROFILE[platform] || PLATFORM_PROFILE.google;

  // Stable campaign "personality": base volume / CTR / CPC per campaign,
  // independent of the date.
  const baseRng = mulberry32(hashStringToSeed(`base:${campaignExternalId}`));
  const baseImpressions = randBetween(baseRng, profile.impressions[0], profile.impressions[1]);
  const baseCtr = randBetween(baseRng, profile.ctr[0], profile.ctr[1]);
  const baseCpc = randBetween(baseRng, profile.cpc[0], profile.cpc[1]);
  const baseCvr = randBetween(baseRng, profile.cvr[0], profile.cvr[1]);
  const trendPhase = baseRng() * Math.PI * 2;

  // Daily noise seeded by campaignId + date (the requested determinism key).
  const dayRng = mulberry32(hashStringToSeed(`${campaignExternalId}:${dateStr}`));

  const date = new Date(`${dateStr}T00:00:00Z`);
  const weekdayFactor = WEEKDAY_FACTOR[date.getUTCDay()];

  // Slow up-and-down weekly trend (~5 week cycle), phase-shifted per campaign.
  const weekIndex = Math.floor(date.getTime() / 86400000 / 7);
  const trendFactor = 1 + 0.18 * Math.sin((weekIndex / 5) * Math.PI * 2 + trendPhase);

  const noise = randBetween(dayRng, 0.85, 1.15);

  const impressions = Math.max(
    0,
    Math.round(baseImpressions * weekdayFactor * trendFactor * noise)
  );

  // CTR jitters around the campaign base but is clamped to the 1–5% band.
  const ctr = Math.min(0.05, Math.max(0.01, baseCtr * randBetween(dayRng, 0.85, 1.15)));
  const clicks = Math.round(impressions * ctr);

  const cpc = baseCpc * randBetween(dayRng, 0.9, 1.1);
  const spend = Math.round(clicks * cpc * 100) / 100;

  const cvr = baseCvr * randBetween(dayRng, 0.8, 1.2);
  const conversions = Math.round(clicks * cvr * 100) / 100;

  return { impressions, clicks, spend, conversions };
}

module.exports = {
  generateCampaigns,
  generateDailyMetrics,
  // Exposed for reuse/testing.
  hashStringToSeed,
  mulberry32,
};
