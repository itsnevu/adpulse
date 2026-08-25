// Claude AI service — turns aggregated ads data into an Indonesian-language
// insight ({summary, recommendations}).
//
// When ANTHROPIC_API_KEY is empty the service returns a canned fallback
// insight (model: "mock") so the demo keeps working end-to-end.
const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config"); // ensures dotenv is loaded before SDK use

const SYSTEM_PROMPT = [
  "Kamu adalah analis performa iklan digital senior untuk platform AdPulse.",
  "Analisis data performa iklan (Google Ads, Meta Ads) yang diberikan dan jawab SELALU dalam Bahasa Indonesia.",
  "WAJIB: keluarkan HANYA JSON valid tanpa markdown, tanpa teks lain, dengan bentuk persis:",
  '{"summary": "...", "recommendations": [{"title": "...", "detail": "...", "impact": "high"}]}',
  'Field "impact" harus salah satu dari "high", "medium", atau "low".',
  '"summary" berisi 2-4 kalimat ringkasan performa periode tersebut (tren spend, CTR, konversi, perbandingan platform).',
  '"recommendations" berisi 3-5 rekomendasi konkret dan spesifik terhadap data (sebut nama campaign bila relevan).',
].join(" ");

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

// Parse the model output into {summary, recommendations}. Tries strict JSON
// first, then the first {...} block, then falls back to raw text as summary.
function parseInsightText(text) {
  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) {
      // fall through to the next strategy
    }
    return null;
  };

  let parsed = tryParse(text);
  if (!parsed) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      parsed = tryParse(text.slice(start, end + 1));
    }
  }
  if (!parsed) {
    return { summary: text.trim(), recommendations: [] };
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : text.trim();
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          title: String(r.title || "").trim(),
          detail: String(r.detail || "").trim(),
          impact: ["high", "medium", "low"].includes(r.impact) ? r.impact : "medium",
        }))
        .filter((r) => r.title || r.detail)
    : [];
  return { summary, recommendations };
}

// Canned fallback so demos work without an API key. Uses the aggregated
// stats (when provided) to keep the text grounded in real numbers.
function buildFallbackInsight(stats) {
  const s = stats && stats.summary ? stats.summary : {};
  const fmt = (n) =>
    Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const summary =
    `Selama periode ini total belanja iklan mencapai ${fmt(s.spend)} dengan ` +
    `${fmt(s.impressions)} impresi, ${fmt(s.clicks)} klik (CTR ${fmt(s.ctr)}%), ` +
    `dan ${fmt(s.conversions)} konversi. Google Ads menyumbang porsi belanja terbesar, ` +
    `sementara Meta Ads memberikan biaya per klik yang lebih rendah. ` +
    `Performa harian menunjukkan pola mingguan yang stabil dengan penurunan di akhir pekan.`;
  return {
    summary,
    recommendations: [
      {
        title: "Realokasi budget ke campaign dengan CTR tertinggi",
        detail:
          "Pindahkan sebagian budget dari campaign dengan CTR di bawah rata-rata akun ke campaign dengan CTR dan tingkat konversi tertinggi untuk menaikkan return per rupiah belanja.",
        impact: "high",
      },
      {
        title: "Perkuat retargeting di Meta Ads",
        detail:
          "CPC Meta lebih rendah dibanding Google — perluas audiens retargeting (add-to-cart & checkout abandoner) selagi biaya akuisisi masih murah.",
        impact: "medium",
      },
      {
        title: "Turunkan bid di akhir pekan",
        detail:
          "Volume dan CTR cenderung turun pada Sabtu-Minggu. Terapkan ad scheduling / seasonality adjustment untuk mengurangi belanja pada jam-jam berkinerja rendah.",
        impact: "low",
      },
    ],
  };
}

// Generate an insight from a prepared prompt.
// Returns { summary, recommendations, model, tokensUsed }.
async function generateInsight(prompt, stats) {
  if (!config.anthropicApiKey) {
    console.log("[claude] ANTHROPIC_API_KEY kosong — memakai insight fallback (mock).");
    return { ...buildFallbackInsight(stats), model: "mock", tokensUsed: null };
  }

  try {
    const response = await getClient().messages.create({
      model: config.claudeModel,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseInsightText(text);
    const tokensUsed = response.usage
      ? (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
      : null;
    return { ...parsed, model: response.model || config.claudeModel, tokensUsed };
  } catch (err) {
    // Keep the product usable even when the AI call fails (rate limit,
    // network, etc.) — log loudly and fall back to the canned insight.
    console.error("[claude] panggilan API gagal, memakai fallback:", err.message);
    return { ...buildFallbackInsight(stats), model: "mock", tokensUsed: null };
  }
}

module.exports = { generateInsight, parseInsightText, buildFallbackInsight };
