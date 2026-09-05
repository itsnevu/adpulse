// Loop agent: pertanyaan user → (panggil tool → baca hasil)* → jawaban.
//
// Independen dari vendor model (lihat engine.js) dan tahan terhadap armada MCP
// yang mati (lihat mcpFleet.js). Yang dijaga file ini:
//
// - ANGGARAN OUTPUT TOOL. Hasil tool dikirim ULANG ke model di setiap iterasi
//   berikutnya. Hasil tanpa batas berarti satu dump 50 ribu karakter ditagih
//   lagi dan lagi — biaya satu pertanyaan tumbuh kuadratik terhadap jumlah
//   putaran. Dua batas (per tool dan total per request) yang menahannya linear.
// - TOOL GAGAL DIKEMBALIKAN SEBAGAI TEKS, BUKAN DILEMPAR. Agent yang diberi
//   tahu "tool ini error" bisa mencoba rute lain; exception membakar seluruh
//   request dan user tidak dapat apa-apa.
// - SELALU ADA JAWABAN. Kalau iterasi habis sementara model masih memanggil
//   tool, satu panggilan terakhir dilakukan TANPA tool supaya user menerima
//   kesimpulan terbaik dari data yang sudah terkumpul.
const config = require("../../config");
const logger = require("../../utils/logger");
const engine = require("./engine");
const mcpFleet = require("./mcpFleet");
const firstParty = require("./tools");
const { SYSTEM_PROMPT, DEGRADED_NOTICE } = require("./prompt");

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[dipotong ${text.length - max} karakter — persempit rentang atau filter kalau butuh sisanya]`;
}

// Jalankan satu tool dengan batas waktu + anggaran output.
async function runTool(entry, args, budget, signal) {
  const started = Date.now();
  try {
    const payload = entry.firstParty
      ? await mcpFleet.withTimeout(
          Promise.resolve(entry.tool.run(args, entry.ctx)),
          config.mcp.toolTimeoutMs,
          `tool ${entry.name}`
        )
      : await mcpFleet.callTool(entry.mcp, args, signal);

    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    const room = Math.max(0, Math.min(config.agent.maxToolChars, budget.remaining));
    if (room === 0) {
      return { content: "error: anggaran output tool untuk request ini sudah habis", ms: Date.now() - started };
    }
    budget.remaining -= Math.min(text.length, room);
    return { content: truncate(text, room), ms: Date.now() - started };
  } catch (err) {
    // Dikembalikan sebagai teks, bukan dilempar — biar model bisa cari jalan lain.
    return {
      content: `error: tool gagal — ${String(err?.message || err).slice(0, 300)}`,
      ms: Date.now() - started,
      failed: true,
    };
  }
}

// Susun daftar tool untuk satu giliran: first-party DULU, lalu MCP.
//
// Urutannya disengaja. Model membaca daftar dari atas, dan tool AdPulse-lah
// yang benar tentang data user ini. Registry dibuat baru tiap giliran supaya
// tidak pernah memutasi state MCP yang di-cache dan dipakai bersama request lain.
async function buildToolset(ctx) {
  const registry = new Map();
  const schemas = [];

  for (const tool of firstParty.TOOLS) {
    registry.set(tool.name, { name: tool.name, firstParty: true, tool, ctx });
    schemas.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
  }

  let degraded = false;
  try {
    const fleet = await mcpFleet.getFleet();
    for (const schema of fleet.tools) {
      // Tool MCP tidak boleh menimpa tool first-party yang senama.
      if (registry.has(schema.name)) continue;
      registry.set(schema.name, {
        name: schema.name,
        firstParty: false,
        mcp: fleet.registry.get(schema.name),
      });
      schemas.push(schema);
    }
  } catch (err) {
    // Armada mati BUKAN alasan mematikan agent — degradasi, jangan berbohong.
    degraded = true;
    logger.warn(
      { err },
      "[agent] armada MCP tidak bisa dijalankan — lanjut dengan tool first-party saja."
    );
  }

  return { registry, schemas, degraded };
}

// Jawab satu giliran percakapan.
//
// history: [{ role: "user"|"assistant", content }] — giliran sebelumnya.
// Mengembalikan { text, toolCalls: [...], degraded, usage, model, provider }.
async function reply({ userId, message, history = [], signal }) {
  if (!engine.engineConfigured()) {
    const err = new Error(
      "Agent AI belum dikonfigurasi. Isi ANTHROPIC_API_KEY, atau AGENT_ENGINE_URL + " +
        "AGENT_ENGINE_KEY + AGENT_ENGINE_MODEL untuk memakai endpoint OpenAI-compatible " +
        "seperti OpenRouter."
    );
    err.status = 503;
    throw err;
  }

  const { registry, schemas, degraded } = await buildToolset({ userId });
  const info = engine.engineInfo();

  const system = degraded ? SYSTEM_PROMPT + DEGRADED_NOTICE : SYSTEM_PROMPT;
  const messages = [
    ...history
      .slice(-config.agent.historyLimit)
      .map((item) => ({ role: item.role, content: String(item.content ?? "") })),
    { role: "user", content: message },
  ];

  const budget = { remaining: config.agent.maxToolCharsTotal };
  const usage = { input: 0, output: 0 };
  const trace = []; // apa yang dipanggil — dikirim ke UI supaya jawabannya bisa diaudit

  // Batas waktu seluruh giliran, digabung dengan sinyal abort dari klien
  // (user menutup tab tidak boleh meninggalkan request yang jalan terus).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.agent.timeoutMs);
  timer.unref?.();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    let text = "";

    for (let i = 0; i < config.agent.maxIterations; i += 1) {
      const response = await engine.complete({
        system,
        messages,
        tools: schemas,
        maxTokens: config.agent.maxTokens,
        signal: controller.signal,
      });

      usage.input += response.usage.input;
      usage.output += response.usage.output;

      if (!response.toolCalls.length) {
        text = response.text;
        break;
      }

      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      // Panggilan tool dalam satu putaran independen menurut konstruksi —
      // jalankan bersamaan. Menjalankannya berurutan mengalikan waktu tunggu
      // user dengan jumlah tool yang diminta.
      const results = await Promise.all(
        response.toolCalls.map(async (call) => {
          const entry = registry.get(call.name);
          if (!entry) {
            return {
              call,
              result: { content: `error: tool "${call.name}" tidak ada`, ms: 0, failed: true },
            };
          }
          const result = await runTool(entry, call.args || {}, budget, controller.signal);
          return { call, result };
        })
      );

      for (const { call, result } of results) {
        trace.push({
          name: call.name,
          args: call.args,
          ms: result.ms,
          failed: Boolean(result.failed),
          source: registry.get(call.name)?.firstParty === false ? "mcp" : "adpulse",
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: result.content,
        });
      }
    }

    // Iterasi habis tapi model masih memanggil tool: satu pass terakhir tanpa
    // tool, supaya user dapat kesimpulan terbaik dari yang sudah terkumpul
    // alih-alih tidak dapat apa-apa.
    if (!text) {
      const response = await engine.complete({
        system,
        messages,
        tools: null,
        maxTokens: config.agent.maxTokens,
        signal: controller.signal,
      });
      usage.input += response.usage.input;
      usage.output += response.usage.output;
      text = response.text;
    }

    if (!text) throw new Error("Engine tidak mengembalikan teks jawaban.");

    return {
      text,
      toolCalls: trace,
      degraded,
      usage,
      model: info.model,
      provider: info.provider,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Status agent untuk endpoint health/UI: engine apa yang aktif dan armada MCP
// dalam keadaan apa. `probe` memaksa armada boot supaya jawabannya "benar-benar
// hidup?" bukan "env-nya terisi?".
async function health({ probe = false } = {}) {
  const mcp = probe ? await mcpFleet.probe() : mcpFleet.snapshot();
  return {
    engine: engine.engineInfo(),
    mcp: {
      state: mcp.state, // cold | up | empty | down
      tools: mcp.tools,
      servers: mcp.servers,
      error: mcp.error,
    },
    firstPartyTools: firstParty.TOOLS.length,
  };
}

module.exports = { reply, health };
