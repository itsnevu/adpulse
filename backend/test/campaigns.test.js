// Campaigns suite: filter platform/status/search + agregat metrik 30 hari.
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const setup = require("./helpers/setup");
const { todayStr, addDaysStr } = require("../src/utils/dates");

describe("campaigns", () => {
  let app;
  let pool;
  let token;
  let tokenOther;

  // Tanggal relatif hari ini: aman dari selisih timezone DB vs JS
  // (jauh di dalam jendela 30 hari / jauh di luar).
  const dIn1 = addDaysStr(todayStr(), -2);
  const dIn2 = addDaysStr(todayStr(), -3);
  const dOut = addDaysStr(todayStr(), -45); // di luar jendela 30 hari

  async function insertMetric(campaignId, date, imp, clicks, spend, conv) {
    await pool.query(
      `INSERT INTO metrics_daily
         (campaign_id, date, impressions, clicks, spend, conversions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [campaignId, date, imp, clicks, spend, conv]
    );
  }

  before(async () => {
    await setup.setupDatabase();
    app = setup.getApp();
    pool = setup.getPool();
    await setup.truncateAll();

    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Camp Owner", email: "camp@test.io", password: "password123" });
    token = reg.body.data.token;
    const userId = reg.body.data.user.id;

    const regOther = await request(app)
      .post("/api/auth/register")
      .send({ name: "Other", email: "other@test.io", password: "password123" });
    tokenOther = regOther.body.data.token;

    const { rows: gRows } = await pool.query(
      `INSERT INTO ad_accounts (user_id, platform, external_id, name, currency)
       VALUES ($1, 'google', 'g-camp-acc', 'Google Acc', 'USD') RETURNING id`,
      [userId]
    );
    const { rows: mRows } = await pool.query(
      `INSERT INTO ad_accounts (user_id, platform, external_id, name, currency)
       VALUES ($1, 'meta', 'm-camp-acc', 'Meta Acc', 'IDR') RETURNING id`,
      [userId]
    );
    const gAcc = gRows[0].id;
    const mAcc = mRows[0].id;

    async function insertCampaign(accId, extId, name, status, objective) {
      const { rows } = await pool.query(
        `INSERT INTO campaigns (ad_account_id, external_id, name, status, objective)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [accId, extId, name, status, objective]
      );
      return rows[0].id;
    }

    const summerSale = await insertCampaign(gAcc, "c-1", "Summer Sale", "active", "SEARCH");
    await insertCampaign(gAcc, "c-2", "Winter Promo", "paused", "DISPLAY");
    const summerMeta = await insertCampaign(mAcc, "c-3", "Summer Meta Push", "active", "OUTCOME_SALES");
    await insertCampaign(mAcc, "c-4", "Archived Ended", "ended", "OUTCOME_TRAFFIC");

    // Summer Sale (30 hari): 2 x (1000 imp, 100 klik, 250 spend, 10 conv)
    // → spend 500, imp 2000, klik 200, conv 20, ctr 10%, cpc 2.5
    await insertMetric(summerSale, dIn1, 1000, 100, 250.0, 10);
    await insertMetric(summerSale, dIn2, 1000, 100, 250.0, 10);
    // Baris lama (45 hari lalu) TIDAK boleh ikut agregat 30 hari.
    await insertMetric(summerSale, dOut, 5000, 500, 999.0, 99);
    // Summer Meta Push: 1 hari (400 imp, 20 klik, 60 spend, 4 conv).
    await insertMetric(summerMeta, dIn1, 400, 20, 60.0, 4);
  });

  after(async () => {
    await setup.closeAll();
  });

  function list(query, useToken = token) {
    return request(app)
      .get(`/api/campaigns${query}`)
      .set("Authorization", `Bearer ${useToken}`);
  }

  it("tanpa filter: semua campaign + agregat 30 hari benar", async () => {
    const res = await list("");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 4);

    // Urut spend desc → Summer Sale pertama.
    const top = res.body.data[0];
    assert.equal(top.name, "Summer Sale");
    assert.equal(top.platform, "google");
    assert.equal(top.currency, "USD");
    assert.equal(top.account_name, "Google Acc");
    assert.equal(top.status, "active");
    assert.equal(top.objective, "SEARCH");
    // Baris 45 hari lalu (spend 999) TIDAK ikut — hanya 2 hari terakhir.
    assert.equal(top.spend, 500);
    assert.equal(top.impressions, 2000);
    assert.equal(top.clicks, 200);
    assert.equal(top.conversions, 20);
    assert.equal(top.ctr, 10);
    assert.equal(top.cpc, 2.5);

    const meta = res.body.data.find((c) => c.name === "Summer Meta Push");
    assert.equal(meta.spend, 60);
    assert.equal(meta.impressions, 400);
    assert.equal(meta.clicks, 20);
    assert.equal(meta.conversions, 4);
    assert.equal(meta.ctr, 5);
    assert.equal(meta.cpc, 3);
    assert.equal(meta.currency, "IDR");

    // Campaign tanpa metrik → nol semua, ctr/cpc 0 (tanpa NaN/null).
    const winter = res.body.data.find((c) => c.name === "Winter Promo");
    assert.equal(winter.spend, 0);
    assert.equal(winter.impressions, 0);
    assert.equal(winter.clicks, 0);
    assert.equal(winter.conversions, 0);
    assert.equal(winter.ctr, 0);
    assert.equal(winter.cpc, 0);
  });

  it("filter platform", async () => {
    const google = await list("?platform=google");
    assert.equal(google.status, 200);
    assert.deepEqual(
      google.body.data.map((c) => c.name).sort(),
      ["Summer Sale", "Winter Promo"]
    );

    const meta = await list("?platform=meta");
    assert.deepEqual(
      meta.body.data.map((c) => c.name).sort(),
      ["Archived Ended", "Summer Meta Push"]
    );
  });

  it("filter status", async () => {
    const active = await list("?status=active");
    assert.deepEqual(
      active.body.data.map((c) => c.name).sort(),
      ["Summer Meta Push", "Summer Sale"]
    );

    const ended = await list("?status=ended");
    assert.deepEqual(
      ended.body.data.map((c) => c.name),
      ["Archived Ended"]
    );
  });

  it("filter search: ILIKE case-insensitive + trim", async () => {
    const summer = await list("?search=summer");
    assert.deepEqual(
      summer.body.data.map((c) => c.name).sort(),
      ["Summer Meta Push", "Summer Sale"]
    );

    const upper = await list(`?search=${encodeURIComponent("  SUMMER ")}`);
    assert.equal(upper.body.data.length, 2);

    const winter = await list("?search=winter");
    assert.deepEqual(
      winter.body.data.map((c) => c.name),
      ["Winter Promo"]
    );

    const none = await list("?search=tidak-ada-yang-cocok");
    assert.deepEqual(none.body.data, []);
  });

  it("kombinasi filter platform + status", async () => {
    const res = await list("?platform=google&status=paused");
    assert.deepEqual(
      res.body.data.map((c) => c.name),
      ["Winter Promo"]
    );
  });

  it("filter tidak valid → 422", async () => {
    const badPlatform = await list("?platform=tiktok");
    assert.equal(badPlatform.status, 422);
    assert.equal(badPlatform.body.error.message, "Validasi gagal");

    const badStatus = await list("?status=zombie");
    assert.equal(badStatus.status, 422);
  });

  it("string kosong pada filter diperlakukan seperti tanpa filter", async () => {
    const res = await list("?platform=&status=&search=");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 4);
  });

  it("isolasi antar-user: user lain melihat daftar kosong", async () => {
    const res = await list("", tokenOther);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  it("tanpa token → 401", async () => {
    const res = await request(app).get("/api/campaigns");
    assert.equal(res.status, 401);
  });
});
