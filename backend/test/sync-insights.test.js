// Sync + insights suite: sync mock google mengisi campaigns/metrics dengan
// sync_logs success; insight fallback (tanpa ANTHROPIC_API_KEY) tersimpan;
// periode tanpa data → 422.
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const setup = require("./helpers/setup");
const { todayStr, addDaysStr } = require("../src/utils/dates");

describe("sync & insights", () => {
  let app;
  let pool;
  let token;
  let userId;
  let insightId;

  before(async () => {
    await setup.setupDatabase();
    app = setup.getApp();
    pool = setup.getPool();
    await setup.truncateAll();

    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Sync Owner", email: "sync@test.io", password: "password123" });
    token = reg.body.data.token;
    userId = reg.body.data.user.id;

    const acc = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform: "google", external_id: "g-sync-acc", name: "Google Sync" });
    assert.equal(acc.status, 201);
  });

  after(async () => {
    await setup.closeAll();
  });

  it("POST /api/sync/google (mock): sync_logs success + metrics terisi", async () => {
    const res = await request(app)
      .post("/api/sync/google")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    const log = res.body.data;
    assert.equal(log.platform, "google");
    assert.equal(log.status, "success");
    assert.equal(log.error, null);
    assert.ok(log.finished_at, "finished_at harus terisi");
    // Mock google: 4 campaign + 4 x 30 hari metrik = 124 record.
    assert.equal(log.records_synced, 124);

    const { rows: campRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM campaigns c
       JOIN ad_accounts a ON a.id = c.ad_account_id
       WHERE a.platform = 'google'`
    );
    assert.equal(campRows[0].n, 4);

    const { rows: metricRows } = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(impressions), 0)::bigint AS imp,
              COALESCE(SUM(spend), 0) AS spend
       FROM metrics_daily`
    );
    assert.equal(metricRows[0].n, 120); // 4 campaign x 30 hari
    assert.ok(Number(metricRows[0].imp) > 0, "impressions harus terisi");
    assert.ok(Number(metricRows[0].spend) > 0, "spend harus terisi");
  });

  it("sync ulang idempotent: upsert, tidak menduplikasi baris", async () => {
    const res = await request(app)
      .post("/api/sync/google")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "success");
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM campaigns`
    );
    assert.equal(rows[0].n, 4);
    const { rows: m } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT campaign_id, date FROM metrics_daily
         GROUP BY campaign_id, date HAVING COUNT(*) > 1
       ) dup`
    );
    assert.equal(m[0].n, 0, "tidak boleh ada (campaign, date) ganda");
  });

  it("sync platform tanpa akun aktif → log error (bukan crash)", async () => {
    const res = await request(app)
      .post("/api/sync/meta")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "error");
    assert.match(res.body.data.error, /meta/i);
  });

  it("sync platform tidak dikenal → 422", async () => {
    const res = await request(app)
      .post("/api/sync/linkedin")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.message, "Validasi gagal");
  });

  it("GET /api/sync/logs: berisi log terbaru (desc)", async () => {
    const res = await request(app)
      .get("/api/sync/logs")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 3); // 2 sukses google + 1 error meta
    const statuses = res.body.data.map((l) => `${l.platform}:${l.status}`);
    assert.ok(statuses.includes("google:success"));
    assert.ok(statuses.includes("meta:error"));
  });

  it("POST /api/insights/generate: fallback tanpa API key → row tersimpan", async () => {
    // ANTHROPIC_API_KEY kosong (di-set helpers/setup) → model "mock".
    const res = await request(app)
      .post("/api/insights/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 201);
    const insight = res.body.data;
    insightId = insight.id;
    assert.equal(insight.model, "mock");
    assert.equal(typeof insight.summary, "string");
    assert.ok(insight.summary.length > 20);
    assert.ok(Array.isArray(insight.recommendations));
    assert.ok(insight.recommendations.length >= 1);
    for (const rec of insight.recommendations) {
      assert.equal(typeof rec.title, "string");
      assert.equal(typeof rec.detail, "string");
      assert.ok(["high", "medium", "low"].includes(rec.impact));
    }
    // Default periode: 7 hari terakhir.
    assert.equal(insight.period_end, todayStr());
    assert.equal(insight.period_start, addDaysStr(todayStr(), -6));

    // Row benar-benar tersimpan di DB untuk user ini.
    const { rows } = await pool.query(
      `SELECT user_id, model FROM insights WHERE id = $1`,
      [insight.id]
    );
    assert.equal(Number(rows[0].user_id), Number(userId));
    assert.equal(rows[0].model, "mock");
  });

  it("GET /api/insights: memuat insight yang baru dibuat", async () => {
    const res = await request(app)
      .get("/api/insights")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((i) => i.id === insightId));
  });

  it("generate pada periode tanpa data → 422", async () => {
    const res = await request(app)
      .post("/api/insights/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ from: "2019-01-01", to: "2019-01-07" });
    assert.equal(res.status, 422);
    assert.equal(typeof res.body.error.message, "string");
  });

  it("generate dengan from > to → 422", async () => {
    const res = await request(app)
      .post("/api/insights/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ from: "2025-06-10", to: "2025-06-01" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.message, "Validasi gagal");
  });

  it("insight user lain terisolasi", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Tanpa Data", email: "kosong@test.io", password: "password123" });
    const otherToken = reg.body.data.token;

    const list = await request(app)
      .get("/api/insights")
      .set("Authorization", `Bearer ${otherToken}`);
    assert.deepEqual(list.body.data, []);

    // User tanpa metrik sama sekali → generate 422.
    const gen = await request(app)
      .post("/api/insights/generate")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({});
    assert.equal(gen.status, 422);
  });
});
