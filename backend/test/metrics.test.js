// Metrics suite: summary (angka + deltas dihitung manual), timeseries
// (zero-fill + whitelist metric), by-platform, isolasi antar-user.
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const setup = require("./helpers/setup");

// Periode uji deterministik (tidak tergantung tanggal hari ini):
// current = 2025-06-08..2025-06-14 (7 hari), previous = 2025-06-01..2025-06-07.
const FROM = "2025-06-08";
const TO = "2025-06-14";

describe("metrics", () => {
  let app;
  let pool;
  let tokenA;
  let tokenB;

  async function registerUser(name, email) {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name, email, password: "password123" });
    assert.equal(res.status, 201);
    return { id: res.body.data.user.id, token: res.body.data.token };
  }

  async function insertAccount(userId, platform, externalId, name) {
    const { rows } = await pool.query(
      `INSERT INTO ad_accounts (user_id, platform, external_id, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, platform, externalId, name]
    );
    return rows[0].id;
  }

  async function insertCampaign(adAccountId, externalId, name) {
    const { rows } = await pool.query(
      `INSERT INTO campaigns (ad_account_id, external_id, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [adAccountId, externalId, name]
    );
    return rows[0].id;
  }

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

    const userA = await registerUser("User A", "a@test.io");
    const userB = await registerUser("User B", "b@test.io");
    tokenA = userA.token;
    tokenB = userB.token;

    // === Data user A ===
    const gAccA = await insertAccount(userA.id, "google", "g-acc-a", "Google A");
    const mAccA = await insertAccount(userA.id, "meta", "m-acc-a", "Meta A");
    const gCampA = await insertCampaign(gAccA, "gc-1", "Google Campaign A");
    const mCampA = await insertCampaign(mAccA, "mc-1", "Meta Campaign A");

    // Periode current (2025-06-08..14):
    //   google : 06-08 (1000, 50, 100, 10) + 06-10 (2000, 100, 200, 20)
    //   meta   : 06-10 (500, 25, 50, 5)
    // Total current: imp 3500, clicks 175, spend 350, conv 35
    //   → ctr 5%, cpc 2, cpm 100
    await insertMetric(gCampA, "2025-06-08", 1000, 50, 100.0, 10);
    await insertMetric(gCampA, "2025-06-10", 2000, 100, 200.0, 20);
    await insertMetric(mCampA, "2025-06-10", 500, 25, 50.0, 5);

    // Periode previous (2025-06-01..07): google 06-03 (1750, 70, 175, 14)
    // Deltas: spend (350-175)/175 = +100%, imp +100%,
    //         clicks (175-70)/70 = +150%, conv (35-14)/14 = +150%
    await insertMetric(gCampA, "2025-06-03", 1750, 70, 175.0, 14);

    // === Data user B (harus tak terlihat oleh A dan sebaliknya) ===
    const gAccB = await insertAccount(userB.id, "google", "g-acc-b", "Google B");
    const gCampB = await insertCampaign(gAccB, "gc-b1", "Google Campaign B");
    await insertMetric(gCampB, "2025-06-10", 100, 10, 5.0, 1);
  });

  after(async () => {
    await setup.closeAll();
  });

  it("summary: angka & deltas sesuai hitungan manual", async () => {
    const res = await request(app)
      .get(`/api/metrics/summary?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, {
      spend: 350,
      impressions: 3500,
      clicks: 175,
      conversions: 35,
      ctr: 5,
      cpc: 2,
      cpm: 100,
      deltas: { spend: 100, impressions: 100, clicks: 150, conversions: 150 },
    });
  });

  it("summary dengan filter platform=google", async () => {
    const res = await request(app)
      .get(`/api/metrics/summary?from=${FROM}&to=${TO}&platform=google`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    // Current google: imp 3000, clicks 150, spend 300, conv 30.
    // Prev google: imp 1750, clicks 70, spend 175, conv 14.
    assert.deepEqual(res.body.data, {
      spend: 300,
      impressions: 3000,
      clicks: 150,
      conversions: 30,
      ctr: 5,
      cpc: 2,
      cpm: 100,
      deltas: {
        spend: 71.4, // (300-175)/175 = 71.428... → round 1 desimal
        impressions: 71.4,
        clicks: 114.3, // (150-70)/70 = 114.285...
        conversions: 114.3,
      },
    });
  });

  it("summary: platform aneh → 422", async () => {
    const res = await request(app)
      .get(`/api/metrics/summary?from=${FROM}&to=${TO}&platform=tiktok`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.message, "Validasi gagal");
  });

  it("summary: from > to → 422", async () => {
    const res = await request(app)
      .get(`/api/metrics/summary?from=${TO}&to=${FROM}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 422);
  });

  it("timeseries spend: zero-fill tanggal kosong + nilai per platform", async () => {
    const res = await request(app)
      .get(`/api/metrics/timeseries?from=${FROM}&to=${TO}&metric=spend`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    const series = res.body.data;
    assert.equal(series.length, 7); // 7 hari kontinu
    assert.deepEqual(
      series.map((p) => p.date),
      [
        "2025-06-08",
        "2025-06-09",
        "2025-06-10",
        "2025-06-11",
        "2025-06-12",
        "2025-06-13",
        "2025-06-14",
      ]
    );
    assert.deepEqual(series[0], {
      date: "2025-06-08",
      google: 100,
      meta: 0,
      linkedin: 0,
      total: 100,
    });
    // Tanggal tanpa data → semua nol (zero-fill).
    assert.deepEqual(series[1], {
      date: "2025-06-09",
      google: 0,
      meta: 0,
      linkedin: 0,
      total: 0,
    });
    assert.deepEqual(series[2], {
      date: "2025-06-10",
      google: 200,
      meta: 50,
      linkedin: 0,
      total: 250,
    });
    for (const p of series.slice(3)) {
      assert.deepEqual(
        { google: p.google, meta: p.meta, linkedin: p.linkedin, total: p.total },
        { google: 0, meta: 0, linkedin: 0, total: 0 }
      );
    }
  });

  it("timeseries metric=conversions & default metric=spend", async () => {
    const conv = await request(app)
      .get(`/api/metrics/timeseries?from=${FROM}&to=${TO}&metric=conversions`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(conv.status, 200);
    const day10 = conv.body.data.find((p) => p.date === "2025-06-10");
    assert.deepEqual(day10, {
      date: "2025-06-10",
      google: 20,
      meta: 5,
      linkedin: 0,
      total: 25,
    });

    // Tanpa ?metric= → default spend.
    const def = await request(app)
      .get(`/api/metrics/timeseries?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(def.status, 200);
    assert.equal(def.body.data.find((p) => p.date === "2025-06-10").total, 250);
  });

  it("timeseries: metric di luar whitelist → 422", async () => {
    for (const bad of ["cpm", "spend; DROP TABLE users", "weird"]) {
      const res = await request(app)
        .get(
          `/api/metrics/timeseries?from=${FROM}&to=${TO}&metric=${encodeURIComponent(bad)}`
        )
        .set("Authorization", `Bearer ${tokenA}`);
      assert.equal(res.status, 422, `metric "${bad}" harus 422`);
      assert.equal(res.body.error.message, "Validasi gagal");
    }
  });

  it("timeseries dengan filter platform=meta", async () => {
    const res = await request(app)
      .get(`/api/metrics/timeseries?from=${FROM}&to=${TO}&platform=meta`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    const day10 = res.body.data.find((p) => p.date === "2025-06-10");
    assert.deepEqual(day10, {
      date: "2025-06-10",
      google: 0,
      meta: 50,
      linkedin: 0,
      total: 50,
    });
  });

  it("by-platform: agregat per platform urut spend desc", async () => {
    const res = await request(app)
      .get(`/api/metrics/by-platform?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, [
      {
        platform: "google",
        spend: 300,
        impressions: 3000,
        clicks: 150,
        conversions: 30,
      },
      {
        platform: "meta",
        spend: 50,
        impressions: 500,
        clicks: 25,
        conversions: 5,
      },
    ]);
  });

  it("isolasi antar-user: B hanya melihat datanya sendiri", async () => {
    const summary = await request(app)
      .get(`/api/metrics/summary?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenB}`);
    assert.equal(summary.status, 200);
    // Hanya baris milik B: imp 100, clicks 10, spend 5, conv 1.
    assert.deepEqual(summary.body.data, {
      spend: 5,
      impressions: 100,
      clicks: 10,
      conversions: 1,
      ctr: 10,
      cpc: 0.5,
      cpm: 50,
      deltas: { spend: 100, impressions: 100, clicks: 100, conversions: 100 },
    });

    const byPlatform = await request(app)
      .get(`/api/metrics/by-platform?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenB}`);
    assert.deepEqual(byPlatform.body.data, [
      { platform: "google", spend: 5, impressions: 100, clicks: 10, conversions: 1 },
    ]);

    const series = await request(app)
      .get(`/api/metrics/timeseries?from=${FROM}&to=${TO}`)
      .set("Authorization", `Bearer ${tokenB}`);
    const day10 = series.body.data.find((p) => p.date === "2025-06-10");
    assert.deepEqual(day10, {
      date: "2025-06-10",
      google: 5,
      meta: 0,
      linkedin: 0,
      total: 5,
    });
    // Data A (06-08) tidak muncul untuk B.
    const day8 = series.body.data.find((p) => p.date === "2025-06-08");
    assert.equal(day8.total, 0);
  });

  it("metrics tanpa token → 401", async () => {
    const res = await request(app).get(
      `/api/metrics/summary?from=${FROM}&to=${TO}`
    );
    assert.equal(res.status, 401);
  });
});
