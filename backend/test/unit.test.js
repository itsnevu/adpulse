// Unit suite (tanpa DB): crypto AES-256-GCM (roundtrip + tamper → throw),
// mock generator deterministik, parser JSON output Claude (3 tahap).
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
// Env test (TOKEN_ENCRYPTION_KEY dkk.) di-set oleh helper SEBELUM src dimuat.
require("./helpers/setup");
const {
  encryptToken,
  decryptToken,
  sha256Hex,
  hasKey,
} = require("../src/utils/crypto");
const mock = require("../src/services/mock");
const { parseInsightText, buildFallbackInsight } = require("../src/services/claude");
const { eachDateStr } = require("../src/utils/dates");

// Ganti satu karakter base64 pada posisi idx supaya nilainya pasti berubah.
function flipChar(str, idx) {
  const replacement = str[idx] === "A" ? "B" : "A";
  return str.slice(0, idx) + replacement + str.slice(idx + 1);
}

describe("crypto (AES-256-GCM)", () => {
  it("roundtrip: encrypt → format enc:v1: → decrypt kembali sama", () => {
    assert.equal(hasKey(), true);
    const plaintext = "token-rahasia-google-ads-1234567890";
    const enc = encryptToken(plaintext);
    assert.ok(enc.startsWith("enc:v1:"), "ciphertext harus berprefix enc:v1:");
    assert.notEqual(enc, plaintext);
    assert.ok(!enc.includes(plaintext), "plaintext tidak boleh terbaca");
    const parts = enc.slice("enc:v1:".length).split(":");
    assert.equal(parts.length, 3, "format enc:v1:<iv>:<tag>:<ct>");
    assert.equal(Buffer.from(parts[0], "base64").length, 12, "iv 12 byte");
    assert.equal(Buffer.from(parts[1], "base64").length, 16, "tag GCM 16 byte");
    assert.equal(decryptToken(enc), plaintext);
  });

  it("IV acak: dua enkripsi menghasilkan ciphertext berbeda", () => {
    const plaintext = "token-yang-sama";
    const enc1 = encryptToken(plaintext);
    const enc2 = encryptToken(plaintext);
    assert.notEqual(enc1, enc2);
    assert.equal(decryptToken(enc1), plaintext);
    assert.equal(decryptToken(enc2), plaintext);
  });

  it("tamper auth tag → throw", () => {
    const enc = encryptToken("token-anti-tamper-99887766");
    const [iv, tag, ct] = enc.slice("enc:v1:".length).split(":");
    const tampered = `enc:v1:${iv}:${flipChar(tag, 2)}:${ct}`;
    assert.notEqual(tampered, enc);
    assert.throws(() => decryptToken(tampered));
  });

  it("tamper ciphertext → throw", () => {
    const enc = encryptToken("token-anti-tamper-11223344");
    const [iv, tag, ct] = enc.slice("enc:v1:".length).split(":");
    const tampered = `enc:v1:${iv}:${tag}:${flipChar(ct, 2)}`;
    assert.notEqual(tampered, enc);
    assert.throws(() => decryptToken(tampered));
  });

  it("format enc:v1: rusak → throw", () => {
    assert.throws(() => decryptToken("enc:v1:cuma-satu-bagian"));
  });

  it("passthrough: nilai kosong & plaintext lama", () => {
    assert.equal(encryptToken(""), "");
    assert.equal(encryptToken(null), null);
    assert.equal(encryptToken(undefined), undefined);
    assert.equal(decryptToken(""), "");
    assert.equal(decryptToken(null), null);
    // String tanpa prefix = data lama plaintext — dikembalikan apa adanya.
    assert.equal(decryptToken("token-lama-plaintext"), "token-lama-plaintext");
  });

  it("sha256Hex: hash dikenal", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("mock generator deterministik", () => {
  it("dua panggilan generateDailyMetrics identik persis", () => {
    const a = mock.generateDailyMetrics("g-2001", "2025-06-01", "google");
    const b = mock.generateDailyMetrics("g-2001", "2025-06-01", "google");
    assert.deepEqual(a, b);
    assert.equal(typeof a.impressions, "number");
    assert.equal(typeof a.clicks, "number");
    assert.equal(typeof a.spend, "number");
    assert.equal(typeof a.conversions, "number");
    assert.ok(a.impressions > 0);
    assert.ok(a.clicks <= a.impressions);
  });

  it("seri 30 hari untuk seluruh katalog: dua run sama persis", () => {
    const dates = eachDateStr("2025-05-01", "2025-05-30");
    function fullRun() {
      const out = [];
      for (const platform of ["google", "meta", "linkedin"]) {
        for (const campaign of mock.generateCampaigns(platform)) {
          for (const date of dates) {
            out.push({
              campaign: campaign.external_id,
              date,
              ...mock.generateDailyMetrics(campaign.external_id, date, platform),
            });
          }
        }
      }
      return out;
    }
    const run1 = fullRun();
    const run2 = fullRun();
    assert.equal(run1.length, 10 * 30); // 4 google + 4 meta + 2 linkedin
    assert.deepEqual(run1, run2);
  });

  it("input berbeda → output berbeda (tanggal & campaign)", () => {
    const base = mock.generateDailyMetrics("g-2001", "2025-06-01", "google");
    const otherDate = mock.generateDailyMetrics("g-2001", "2025-06-02", "google");
    const otherCampaign = mock.generateDailyMetrics("g-2002", "2025-06-01", "google");
    assert.notDeepEqual(base, otherDate);
    assert.notDeepEqual(base, otherCampaign);
  });

  it("generateCampaigns: deterministik + mengembalikan salinan", () => {
    const first = mock.generateCampaigns("google");
    assert.equal(first.length, 4);
    first[0].name = "DIUBAH-OLEH-CALLER";
    const second = mock.generateCampaigns("google");
    assert.notEqual(second[0].name, "DIUBAH-OLEH-CALLER");
    assert.deepEqual(mock.generateCampaigns("meta"), mock.generateCampaigns("meta"));
    assert.deepEqual(mock.generateCampaigns("tidak-ada"), []);
  });
});

describe("parser output Claude (3 tahap)", () => {
  const valid = {
    summary: "Performa iklan minggu ini stabil dengan CTR naik.",
    recommendations: [
      { title: "Naikkan budget", detail: "Campaign A berkinerja baik.", impact: "high" },
      { title: "Pause campaign B", detail: "CTR di bawah 1%.", impact: "low" },
    ],
  };

  it("tahap 1: JSON bersih", () => {
    const parsed = parseInsightText(JSON.stringify(valid));
    assert.deepEqual(parsed, valid);
  });

  it("tahap 2: JSON dibungkus teks", () => {
    const text =
      "Tentu! Berikut hasil analisisnya.\n" +
      JSON.stringify(valid) +
      "\nSemoga membantu ya.";
    const parsed = parseInsightText(text);
    assert.deepEqual(parsed, valid);
  });

  it("tahap 3: teks non-JSON → summary = teks, recommendations kosong", () => {
    const text = "  Performa iklan bagus minggu ini tanpa anomali berarti.  ";
    const parsed = parseInsightText(text);
    assert.equal(parsed.summary, text.trim());
    assert.deepEqual(parsed.recommendations, []);
  });

  it("impact tak dikenal dinormalisasi ke medium; rekomendasi kosong dibuang", () => {
    const messy = JSON.stringify({
      summary: "Ringkas.",
      recommendations: [
        { title: "A", detail: "B", impact: "EXTREME" },
        { title: "", detail: "", impact: "high" },
        "bukan-objek",
      ],
    });
    const parsed = parseInsightText(messy);
    assert.deepEqual(parsed.recommendations, [
      { title: "A", detail: "B", impact: "medium" },
    ]);
  });

  it("fallback insight: summary + 3 rekomendasi valid", () => {
    const fallback = buildFallbackInsight({
      summary: { spend: 100, impressions: 5000, clicks: 100, ctr: 2, conversions: 10 },
    });
    assert.equal(typeof fallback.summary, "string");
    assert.ok(fallback.summary.length > 20);
    assert.equal(fallback.recommendations.length, 3);
    for (const rec of fallback.recommendations) {
      assert.ok(["high", "medium", "low"].includes(rec.impact));
    }
  });
});
