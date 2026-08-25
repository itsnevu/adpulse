// Auth suite (v1.1): register, login, me, refresh rotation + reuse
// detection, logout, forgot/reset password, rate limit login.
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const setup = require("./helpers/setup");
// Modul src di-require SETELAH setup (env test sudah ter-set di atas).
const { sha256Hex } = require("../src/utils/crypto");
const mailer = require("../src/services/mailer");

const REFRESH_COOKIE = "adpulse_rt";

function refreshCookie(res) {
  const cookies = res.headers["set-cookie"] || [];
  return cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`)) || null;
}

function cookieValue(cookieStr) {
  return cookieStr.split(";")[0].split("=")[1];
}

describe("auth", () => {
  let app;
  let pool;

  before(async () => {
    await setup.setupDatabase();
    app = setup.getApp();
    pool = setup.getPool();
    await setup.truncateAll();
  });

  after(async () => {
    await setup.closeAll();
  });

  async function register(name, email, password) {
    return request(app)
      .post("/api/auth/register")
      .send({ name, email, password });
  }

  it("register: 201 + token + user + cookie refresh", async () => {
    const res = await register("User Satu", "satu@test.io", "password123");
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.data.token, "string");
    assert.ok(res.body.data.token.length > 20);
    assert.equal(res.body.data.user.email, "satu@test.io");
    assert.equal(res.body.data.user.name, "User Satu");
    assert.equal(res.body.data.user.role, "admin");
    assert.ok(!("password_hash" in res.body.data.user));

    const cookie = refreshCookie(res);
    assert.ok(cookie, "cookie adpulse_rt harus di-set");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\/api\/auth/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /Secure/i); // bukan production
    assert.ok(cookieValue(cookie).length >= 64);
  });

  it("register duplikat email → 409", async () => {
    const res = await register("User Kembar", "satu@test.io", "password123");
    assert.equal(res.status, 409);
    assert.equal(typeof res.body.error.message, "string");
    assert.ok(!("data" in res.body));
  });

  it("register password < 8 karakter → 422 + details", async () => {
    const res = await register("User Pendek", "pendek@test.io", "abc123");
    assert.equal(res.status, 422);
    assert.equal(res.body.error.message, "Validasi gagal");
    assert.ok(Array.isArray(res.body.error.details));
    assert.ok(
      res.body.error.details.some((d) => d.path === "password"),
      "details harus menyebut field password"
    );
  });

  it("login benar → 200 token + user + cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "satu@test.io", password: "password123" });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.token, "string");
    assert.equal(res.body.data.user.email, "satu@test.io");
    assert.ok(refreshCookie(res));
  });

  it("login password salah → 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "satu@test.io", password: "password-salah" });
    assert.equal(res.status, 401);
    assert.equal(typeof res.body.error.message, "string");
  });

  it("login email tidak terdaftar → 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@test.io", password: "password123" });
    assert.equal(res.status, 401);
  });

  it("me dengan token valid → 200 user", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "satu@test.io", password: "password123" });
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.data.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, "satu@test.io");
  });

  it("me tanpa token → 401; token ngawur → 401", async () => {
    const noToken = await request(app).get("/api/auth/me");
    assert.equal(noToken.status, 401);
    const badToken = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer bukan.jwt.valid");
    assert.equal(badToken.status, 401);
  });

  it("refresh: rotasi single-use + reuse-detection revoke semua", async () => {
    const reg = await register("User Rotasi", "rotasi@test.io", "password123");
    const userId = reg.body.data.user.id;
    const c1 = refreshCookie(reg);

    // Rotasi 1: c1 → c2 (cookie baru, nilai beda, token akses baru valid).
    const r1 = await request(app).post("/api/auth/refresh").set("Cookie", c1);
    assert.equal(r1.status, 200);
    assert.equal(typeof r1.body.data.token, "string");
    assert.equal(r1.body.data.user.email, "rotasi@test.io");
    const c2 = refreshCookie(r1);
    assert.ok(c2);
    assert.notEqual(cookieValue(c2), cookieValue(c1));
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${r1.body.data.token}`);
    assert.equal(me.status, 200);

    // Rotasi 2 dengan cookie baru → tetap jalan (c2 → c3).
    const r2 = await request(app).post("/api/auth/refresh").set("Cookie", c2);
    assert.equal(r2.status, 200);
    const c3 = refreshCookie(r2);
    assert.notEqual(cookieValue(c3), cookieValue(c2));

    // DB: token lama tercatat revoked + replaced_by terisi.
    const { rows: oldRows } = await pool.query(
      `SELECT revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1`,
      [sha256Hex(cookieValue(c2))]
    );
    assert.ok(oldRows[0].revoked_at, "token lama harus revoked");
    assert.ok(oldRows[0].replaced_by, "replaced_by harus menunjuk token baru");

    // Reuse c2 (sudah dirotasi) → 401 + SEMUA refresh token user direvoke.
    const reuse = await request(app).post("/api/auth/refresh").set("Cookie", c2);
    assert.equal(reuse.status, 401);
    const { rows: aliveRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    assert.equal(aliveRows[0].n, 0, "semua refresh token user harus revoked");

    // c3 (tadinya masih valid) sekarang ikut mati.
    const r3 = await request(app).post("/api/auth/refresh").set("Cookie", c3);
    assert.equal(r3.status, 401);
  });

  it("refresh tanpa cookie → 401; cookie tak dikenal → 401", async () => {
    const none = await request(app).post("/api/auth/refresh");
    assert.equal(none.status, 401);
    const unknown = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE}=${"ab".repeat(32)}`);
    assert.equal(unknown.status, 401);
  });

  it("refresh dengan token expired → 401", async () => {
    const reg = await register("User Expired", "expired@test.io", "password123");
    const cookie = refreshCookie(reg);
    await pool.query(
      `UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'
       WHERE token_hash = $1`,
      [sha256Hex(cookieValue(cookie))]
    );
    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    assert.equal(res.status, 401);
  });

  it("logout: revoke cookie + clear; refresh sesudahnya 401", async () => {
    const reg = await register("User Logout", "logout@test.io", "password123");
    const cookie = refreshCookie(reg);

    const res = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { ok: true } });
    const cleared = refreshCookie(res);
    assert.ok(cleared, "logout harus mengirim Set-Cookie penghapus");
    assert.equal(cookieValue(cleared), ""); // cookie dikosongkan

    const refreshAfter = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);
    assert.equal(refreshAfter.status, 401);

    // Logout tanpa cookie tetap ok:true (idempotent).
    const noCookie = await request(app).post("/api/auth/logout");
    assert.equal(noCookie.status, 200);
    assert.deepEqual(noCookie.body, { data: { ok: true } });
  });

  it("forgot: selalu ok:true walau email tidak terdaftar", async () => {
    const res = await request(app)
      .post("/api/auth/forgot")
      .send({ email: "tidak-ada@test.io" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: { ok: true } });
    // Tidak boleh ada token reset yang dibuat untuk email tak dikenal.
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM password_reset_tokens`
    );
    assert.equal(rows[0].n, 0);
  });

  it("forgot → reset: ganti password + revoke semua refresh + single-use", async () => {
    const reg = await register("User Reset", "reset@test.io", "originalpass1");
    const oldCookie = refreshCookie(reg);

    // Tangkap link reset lewat stub mailer (SMTP kosong → hanya log).
    const captured = [];
    const original = mailer.sendPasswordResetEmail;
    mailer.sendPasswordResetEmail = async (user, resetUrl) => {
      captured.push({ email: user.email, resetUrl });
      return { skipped: true };
    };
    let token;
    try {
      const forgot = await request(app)
        .post("/api/auth/forgot")
        .send({ email: "reset@test.io" });
      assert.equal(forgot.status, 200);
      assert.deepEqual(forgot.body, { data: { ok: true } });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].email, "reset@test.io");
      token = new URL(captured[0].resetUrl).searchParams.get("token");
      assert.ok(token && token.length === 64, "token reset 32 byte hex");
    } finally {
      mailer.sendPasswordResetEmail = original;
    }

    const reset = await request(app)
      .post("/api/auth/reset")
      .send({ token, password: "passwordbaru9" });
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body, { data: { ok: true } });

    // Password lama tidak berlaku, password baru berlaku.
    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@test.io", password: "originalpass1" });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@test.io", password: "passwordbaru9" });
    assert.equal(newLogin.status, 200);

    // Semua refresh token lama direvoke.
    const refreshOld = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", oldCookie);
    assert.equal(refreshOld.status, 401);

    // Single-use: token yang sama tidak bisa dipakai lagi.
    const again = await request(app)
      .post("/api/auth/reset")
      .send({ token, password: "passwordlain8" });
    assert.equal(again.status, 400);
  });

  it("reset dengan token expired → 400", async () => {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email = 'reset@test.io'`
    );
    const rawToken = "cd".repeat(32);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 minute')`,
      [rows[0].id, sha256Hex(rawToken)]
    );
    const res = await request(app)
      .post("/api/auth/reset")
      .send({ token: rawToken, password: "passwordbaru9" });
    assert.equal(res.status, 400);
  });

  it("reset dengan password pendek → 422", async () => {
    const res = await request(app)
      .post("/api/auth/reset")
      .send({ token: "ef".repeat(32), password: "cebol" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.message, "Validasi gagal");
  });

  it("rate limit login: AUTH_RATE_LIMIT_MAX=3 → percobaan ke-4 429", async () => {
    const { app: limitedApp } = setup.createIsolatedApp({
      AUTH_RATE_LIMIT_MAX: "3",
    });
    for (let i = 1; i <= 3; i += 1) {
      const res = await request(limitedApp)
        .post("/api/auth/login")
        .send({ email: "ghost@test.io", password: "password123" });
      assert.equal(res.status, 401, `percobaan ke-${i} belum kena limit`);
    }
    const limited = await request(limitedApp)
      .post("/api/auth/login")
      .send({ email: "ghost@test.io", password: "password123" });
    assert.equal(limited.status, 429);
    assert.equal(typeof limited.body.error.message, "string");
    assert.ok(!("data" in limited.body));
  });
});
