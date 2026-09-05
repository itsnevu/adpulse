// Engine LLM untuk agent — SLOT, bukan vendor.
//
// AdPulse tidak boleh terkunci ke satu penyedia model. File ini menyediakan
// satu antarmuka netral dan dua driver di belakangnya:
//
//   - "anthropic"  : @anthropic-ai/sdk (sudah jadi dependency AdPulse untuk
//                    insight harian) memakai ANTHROPIC_API_KEY.
//   - "openai"     : endpoint apa pun yang OpenAI-compatible — OpenRouter,
//                    Groq, Together, vLLM lokal — lewat AGENT_ENGINE_URL /
//                    AGENT_ENGINE_KEY / AGENT_ENGINE_MODEL.
//
// Pemilihan driver (AGENT_PROVIDER):
//   auto (default) → pakai slot OpenAI-compatible bila ketiga env-nya terisi,
//                    kalau tidak jatuh ke Anthropic, kalau tidak ada dua-duanya
//                    agent mati (dan bilang mati — bukan mengarang jawaban).
//   anthropic|openai → paksa satu driver.
//
// Kenapa slot OpenAI-compatible menang di mode auto: kalau seseorang repot
// mengisi tiga env eksplisit, itu pilihan sadar; ANTHROPIC_API_KEY sudah ada
// di .env untuk fitur lain, jadi keberadaannya bukan sinyal pilihan.
//
// ===== FORMAT NETRAL (yang dipakai runner.js) =====
// Pesan:
//   { role: "user"      , content: "..." }
//   { role: "assistant" , content: "...", toolCalls?: [{ id, name, args }] }
//   { role: "tool"      , toolCallId, name, content: "..." }
// Tool:
//   { name, description, parameters }   // parameters = JSON Schema
// Balasan complete():
//   { text, toolCalls: [{id,name,args}], usage: {input,output}, model }
const config = require("../../config");
const logger = require("../../utils/logger");

const OPENAI_PROVIDER = "openai";
const ANTHROPIC_PROVIDER = "anthropic";

// Konfigurasi driver yang benar-benar bisa dipakai, atau null.
function resolveProvider() {
  const { provider, engineUrl, engineKey, engineModel } = config.agent;
  const openaiReady = Boolean(engineUrl && engineKey && engineModel);
  const anthropicReady = Boolean(config.anthropicApiKey);

  if (provider === OPENAI_PROVIDER) {
    return openaiReady
      ? { id: OPENAI_PROVIDER, model: engineModel }
      : null;
  }
  if (provider === ANTHROPIC_PROVIDER) {
    return anthropicReady
      ? { id: ANTHROPIC_PROVIDER, model: config.claudeModel }
      : null;
  }
  // auto
  if (openaiReady) return { id: OPENAI_PROVIDER, model: engineModel };
  if (anthropicReady) return { id: ANTHROPIC_PROVIDER, model: config.claudeModel };
  return null;
}

// Apakah agent punya engine sama sekali. Route memakai ini untuk menjawab
// "AI belum dikonfigurasi" dengan jujur alih-alih 500.
function engineConfigured() {
  return resolveProvider() !== null;
}

function engineInfo() {
  const resolved = resolveProvider();
  if (!resolved) return { configured: false, provider: null, model: null };
  return {
    configured: true,
    provider: resolved.id,
    model: resolved.model,
    // Base URL ikut dilaporkan supaya operator tahu trafiknya ke mana —
    // key TIDAK PERNAH ikut.
    baseUrl: resolved.id === OPENAI_PROVIDER ? config.agent.engineUrl : "https://api.anthropic.com",
  };
}

// ===== Driver Anthropic =====
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1 });
  }
  return anthropicClient;
}

// Transkrip netral → format Anthropic.
//
// Bedanya dengan OpenAI bukan kosmetik: hasil tool di Anthropic adalah blok
// `tool_result` di dalam pesan ber-role "user", dan SEMUA hasil dari satu
// putaran tool harus berada dalam SATU pesan. Memecahnya jadi beberapa pesan
// user membuat API menolak transkrip. Jadi hasil tool yang berurutan
// dikelompokkan di sini.
function toAnthropicMessages(messages) {
  const out = [];
  let pendingToolResults = null;

  const flush = () => {
    if (pendingToolResults && pendingToolResults.length) {
      out.push({ role: "user", content: pendingToolResults });
    }
    pendingToolResults = null;
  };

  for (const message of messages) {
    if (message.role === "tool") {
      if (!pendingToolResults) pendingToolResults = [];
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: String(message.content ?? ""),
      });
      continue;
    }

    flush();

    if (message.role === "assistant") {
      const blocks = [];
      if (message.content) blocks.push({ type: "text", text: String(message.content) });
      for (const call of message.toolCalls || []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args || {} });
      }
      // Pesan assistant kosong ditolak API — lewati saja.
      if (blocks.length) out.push({ role: "assistant", content: blocks });
      continue;
    }

    out.push({ role: "user", content: String(message.content ?? "") });
  }

  flush();
  return out;
}

async function completeAnthropic({ system, messages, tools, toolChoice, maxTokens, model, signal }) {
  const client = getAnthropicClient();
  const response = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      temperature: 0.3,
      system,
      messages: toAnthropicMessages(messages),
      // Definisi tool tetap dikirim meski giliran ini dilarang memakai tool.
      // Transkrip yang memuat blok tool_use/tool_result TIDAK valid tanpa
      // daftar tool-nya — menghilangkan `tools` di pass terakhir justru
      // membuat jaring pengaman terakhir itu yang gagal. Larangannya
      // disampaikan lewat tool_choice, bukan dengan menghapus definisinya.
      ...(tools && tools.length
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters || { type: "object", properties: {} },
            })),
            tool_choice: { type: toolChoice === "none" ? "none" : "auto" },
          }
        : {}),
    },
    { signal }
  );

  const text = (response.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const toolCalls = (response.content || [])
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, args: block.input || {} }));

  return {
    text,
    toolCalls,
    model: response.model || model,
    usage: {
      input: Number(response.usage?.input_tokens || 0),
      output: Number(response.usage?.output_tokens || 0),
    },
  };
}

// ===== Driver OpenAI-compatible (OpenRouter dll.) =====
let openaiClient = null;
function getOpenAiClient() {
  if (!openaiClient) {
    const OpenAI = require("openai");
    const Ctor = OpenAI.default || OpenAI;
    openaiClient = new Ctor({
      apiKey: config.agent.engineKey,
      baseURL: config.agent.engineUrl,
      maxRetries: 1, // retry = tagihan kedua; runner sudah menangani kegagalan
    });
  }
  return openaiClient;
}

function toOpenAiMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: String(message.content ?? ""),
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length) {
      out.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
        })),
      });
      continue;
    }
    out.push({ role: message.role, content: String(message.content ?? "") });
  }
  return out;
}

async function completeOpenAi({ system, messages, tools, toolChoice, maxTokens, model, signal }) {
  const client = getOpenAiClient();
  const response = await client.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: toOpenAiMessages(system, messages),
      // `tools: []` ditolak sebagian gateway — kirim field-nya hanya bila ada isi.
      ...(tools && tools.length
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters || { type: "object", properties: {} },
              },
            })),
            // Sama seperti driver Anthropic: pesan bertipe tool tetap butuh
            // definisi tool-nya ada, jadi yang dimatikan adalah pilihannya.
            tool_choice: toolChoice === "none" ? "none" : "auto",
          }
        : {}),
    },
    { signal }
  );

  const choice = response?.choices?.[0]?.message;
  if (!choice) throw new Error("Engine tidak mengembalikan pesan apa pun.");

  const toolCalls = (choice.tool_calls || []).map((call) => {
    let args = {};
    try {
      args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (err) {
      // Argumen JSON rusak bukan alasan mematikan turn — runner akan
      // mengembalikannya ke model sebagai error tool supaya bisa dicoba ulang.
      args = { __parse_error: String(call.function?.arguments || "").slice(0, 500) };
    }
    return { id: call.id, name: call.function?.name, args };
  });

  return {
    text: typeof choice.content === "string" ? choice.content.trim() : "",
    toolCalls,
    model: response.model || model,
    usage: {
      input: Number(response.usage?.prompt_tokens || 0),
      output: Number(response.usage?.completion_tokens || 0),
    },
  };
}

// Satu panggilan ke model, driver apa pun. Melempar bila engine tidak ada —
// pemanggil wajib cek engineConfigured() lebih dulu.
async function complete({ system, messages, tools, toolChoice, maxTokens, signal }) {
  const resolved = resolveProvider();
  if (!resolved) {
    throw new Error(
      "Engine AI belum dikonfigurasi. Isi ANTHROPIC_API_KEY, atau AGENT_ENGINE_URL + " +
        "AGENT_ENGINE_KEY + AGENT_ENGINE_MODEL untuk endpoint OpenAI-compatible (mis. OpenRouter)."
    );
  }

  const args = {
    system,
    messages,
    tools,
    toolChoice: toolChoice || "auto",
    maxTokens: maxTokens || config.agent.maxTokens,
    model: resolved.model,
    signal,
  };

  logger.debug(
    { provider: resolved.id, model: resolved.model, tools: tools ? tools.length : 0 },
    "[agent] panggil engine"
  );

  return resolved.id === OPENAI_PROVIDER ? completeOpenAi(args) : completeAnthropic(args);
}

module.exports = {
  complete,
  engineConfigured,
  engineInfo,
  // diekspor untuk test — konversi transkrip adalah bagian yang paling mudah salah
  toAnthropicMessages,
  toOpenAiMessages,
};
