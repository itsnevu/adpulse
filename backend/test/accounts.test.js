// Accounts suite: token ads tidak pernah keluar lewat API dan tersimpan
// terenkripsi (enc:v1:) di DB saat TOKEN_ENCRYPTION_KEY di-set.
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const setup = require("./helpers/setup");
const { decryptToken, hasKey } = require("../src/utils/crypto");

const ACCESS_TOKEN = "rahasia-access-token-123";
const REFRESH_TOKEN = "rahasia-refresh-token-456";

describe("accounts", () => {
  let app;
  let pool;
  let token;

  before(async () => {
    await setup.setupDatabase();
    app = setup.getApp();
    pool = setup.getPool();
    await setup.truncateAll();

    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: "Acc Owner", email: "acc@test.io", password: "password123" });
    token = reg.body.data.token;
  });

  after(async () => {
    await setup.closeAll();
  });

  it("POST: 201, token TIDAK ikut di response", async () => {
    assert.equal(hasKey(), true, "TOKEN_ENCRYPTION_KEY harus ter-set di test");
    const res = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        platform: "google",
        external_id: "acc-123",
        name: "Akun Google Utama",
        currency: "usd",
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
      });
    assert.equal(res.status, 201);
    const data = res.body.data;
    assert.equal(data.platform, "google");
    assert.equal(data.external_id, "acc-123");
    assert.equal(data.name, "Akun Google Utama");
    assert.equal(data.currency, "USD"); // dinormalisasi uppercase
    assert.equal(data.status, "active");
    assert.ok(!("access_token" in data), "access_token tidak boleh di response");
    assert.ok(!("refresh_token" in data), "refresh_token tidak boleh di response");
    // Nilai token tidak boleh bocor di mana pun dalam body.
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes(ACCESS_TOKEN));
    assert.ok(!raw.includes(REFRESH_TOKEN));
  });

  it("GET: daftar akun tanpa field token", async () => {
    const res = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    const row = res.body.data[0];
    assert.deepEqual(
      Object.keys(row).sort(),
      ["created_at", "currency", "external_id", "id", "name", "platform", "status"]
    );
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes(ACCESS_TOKEN));
    assert.ok(!raw.includes(REFRESH_TOKEN));
  });

  it("DB: token tersimpan terenkripsi enc:v1: dan bisa didekripsi balik", async () => {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token FROM ad_accounts
       WHERE external_id = 'acc-123'`
    );
    const row = rows[0];
    assert.ok(row.access_token.startsWith("enc:v1:"), "access_token harus enc:v1:");
    assert.ok(row.refresh_token.startsWith("enc:v1:"), "refresh_token harus enc:v1:");
    // Plaintext tidak boleh muncul di ciphertext.
    assert.ok(!row.access_token.includes(ACCESS_TOKEN));
    assert.ok(!row.refresh_token.includes(REFRESH_TOKEN));
    // Roundtrip: dekripsi mengembalikan nilai asli.
    assert.equal(decryptToken(row.access_token), ACCESS_TOKEN);
    assert.equal(decryptToken(row.refresh_token), REFRESH_TOKEN);
  });

  it("POST tanpa token ads: kolom token NULL di DB", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform: "meta", external_id: "act_777", name: "Meta Tanpa Token" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.currency, "USD"); // default
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token FROM ad_accounts
       WHERE external_id = 'act_777'`
    );
    assert.equal(rows[0].access_token, null);
    assert.equal(rows[0].refresh_token, null);
  });

  it("POST duplikat (platform, external_id) → 409", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform: "google", external_id: "acc-123", name: "Duplikat" });
    assert.equal(res.status, 409);
    assert.equal(typeof res.body.error.message, "string");
  });

  it("POST platform tidak valid / field kurang → 422", async () => {
    const badPlatform = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform: "tiktok", external_id: "x", name: "X" });
    assert.equal(badPlatform.status, 422);
    assert.equal(badPlatform.body.error.message, "Validasi gagal");

    const missing = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ platform: "google" });
    assert.equal(missing.status, 422);
  });

  it("tanpa JWT → 401", async () => {
    const res = await request(app).get("/api/accounts");
    assert.equal(res.status, 401);
  });
});
