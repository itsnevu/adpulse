// Armada MCP — koneksi ke server MCP eksternal (WhatsApp, scraping, apa pun).
//
// Diadaptasi dari engine MCP Bugglo, disesuaikan ke backend Express AdPulse
// yang CommonJS. Prinsip yang dibawa utuh, karena semuanya lahir dari kegagalan
// nyata di produksi:
//
// 1. SERVER MATI BUKAN ENDPOINT MATI. Satu server MCP yang down tidak boleh
//    menjatuhkan chat. Yang gagal dicatat "unavailable" lalu hilang dari armada.
// 2. SEMUA DIBATASI WAKTU. Connect menggantung bukan sekadar lambat — itu
//    outage permanen: request-nya parkir selamanya dan tidak pernah dilepas.
// 3. CONNECT PARALEL. Sembilan server dengan cap 8 detik = 8 detik, bukan 72.
// 4. ENV ANAK DISARING. Server MCP adalah proses anak yang outputnya tidak
//    dipercaya — jangan pernah wariskan seluruh process.env (ada JWT_SECRET,
//    TOKEN_ENCRYPTION_KEY, kredensial ads di sana). Hanya var yang dideklarasikan.
// 5. NAMA TOOL DI-ALIAS. Wire format cuma menerima [A-Za-z0-9_-]{1,64},
//    sedangkan MCP bebas pakai titik/slash, dan dua server bisa sama-sama
//    punya "search". Registry memetakan alias → (client, nama asli).
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const logger = require("../../utils/logger");

// Nama tool yang implikasinya mengubah keadaan. Agent AdPulse defaultnya
// pembaca: server eksternal harus opt-in lewat "allowedTools" di mcp.json
// kalau memang ingin mengekspos tool yang menulis/mengirim. Ini yang mencegah
// server WhatsApp diam-diam memberi model kemampuan mengirim pesan.
const MUTATING_TOOL =
  /(^|[._-])(send|post|write|delete|remove|create|update|transfer|sign|approve|execute|deploy|publish|reply)/i;

// Path mcp.json: env MCP_CONFIG_PATH, atau backend/mcp.json.
function configPath() {
  return config.mcp.configPath || path.resolve(__dirname, "..", "..", "..", "mcp.json");
}

function withTimeout(promise, ms, label) {
  let timer;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

// Env untuk proses anak: default aman bawaan SDK + hanya var yang diminta.
function childEnv(getDefaultEnvironment, names = [], literals = {}) {
  const env = { ...getDefaultEnvironment() };
  for (const name of names) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...literals };
}

function filterExternalTools(tools, allowedTools) {
  if (Array.isArray(allowedTools)) {
    const allow = new Set(allowedTools);
    return tools.filter((tool) => allow.has(tool.name));
  }
  return tools.filter((tool) => !MUTATING_TOOL.test(tool.name));
}

// Alias tool yang aman untuk wire format + unik lintas server.
function registerTool(registry, mcpName, serverName, client, schema) {
  const base = mcpName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "tool";
  let alias = base;
  let n = 2;
  while (registry.has(alias)) {
    const suffix = `_${n}`;
    alias = base.slice(0, 64 - suffix.length) + suffix;
    n += 1;
  }
  registry.set(alias, { client, mcpName, server: serverName });
  return {
    name: alias,
    description: schema.description || `Tool MCP ${mcpName} dari server ${serverName}`,
    parameters: schema.inputSchema || { type: "object", properties: {} },
  };
}

// Transport mana yang dipakai bukan hal yang boleh ditebak: server
// Streamable-HTTP menjawab handshake SSE dengan 405, dan server SSE tidak punya
// endpoint POST untuk inisialisasi Streamable HTTP. Deklarasi di mcp.json
// ("type"/"transport") bersifat otoritatif; kalau diam, coba Streamable HTTP
// dulu lalu SSE — urutan yang diminta spec MCP, karena SSE yang deprecated.
function connectorsFor(serverConfig, sdk) {
  const { StdioClientTransport, getDefaultEnvironment, SSEClientTransport, StreamableHTTPClientTransport } = sdk;

  if (serverConfig.command) {
    return [
      [
        "stdio",
        (client) =>
          client.connect(
            new StdioClientTransport({
              command: serverConfig.command,
              args: serverConfig.args || [],
              env: childEnv(getDefaultEnvironment, serverConfig.envFrom, serverConfig.env),
            })
          ),
      ],
    ];
  }

  if (!serverConfig.url) return [];

  // headersFrom memetakan nama header → NAMA ENV VAR pemegang nilainya, tidak
  // pernah nilainya langsung: mcp.json ikut ter-commit, dan token di file yang
  // ter-commit adalah token yang bocor. Var yang kosong di-drop, bukan dikirim
  // kosong, supaya gagalnya terbaca 401 alih-alih 400 yang membingungkan.
  const headers = { ...(serverConfig.headers || {}) };
  for (const [header, envName] of Object.entries(serverConfig.headersFrom || {})) {
    const value = process.env[envName];
    if (value) headers[header] = value;
  }
  const options = Object.keys(headers).length ? { requestInit: { headers } } : undefined;

  const streamable = [
    "streamable-http",
    (client) => client.connect(new StreamableHTTPClientTransport(new URL(serverConfig.url), options)),
  ];
  const sse = [
    "sse",
    (client) => client.connect(new SSEClientTransport(new URL(serverConfig.url), options)),
  ];

  switch (String(serverConfig.transport || serverConfig.type || "").toLowerCase()) {
    case "sse":
      return [sse];
    case "http":
    case "streamable-http":
    case "streamablehttp":
      return [streamable];
    default:
      return [streamable, sse];
  }
}

// Sambungkan satu server lalu daftar tool-nya, atau menyerah dalam anggaran
// waktu. TIDAK PERNAH melempar — server yang mati adalah server yang kita
// lewati, bukan endpoint chat yang ikut mati.
//
// Semua percobaan transport + listTools berbagi SATU deadline, jadi mencoba
// transport kedua tidak memperpanjang cold start server yang mati.
async function connectServer(name, serverConfig, sdk) {
  const connectors = connectorsFor(serverConfig, sdk);
  if (!connectors.length) {
    logger.warn(`[mcp] ${name}: tidak ada transport yang bisa dipakai (butuh "command" atau "url").`);
    return null;
  }

  const deadline = Date.now() + config.mcp.connectTimeoutMs * 2;
  const left = () => Math.max(deadline - Date.now(), 0);
  let lastError = new Error("tidak ada transport yang berhasil");

  for (const [label, connect] of connectors) {
    if (left() === 0) break;
    const client = new sdk.Client({ name: `adpulse-${name}`, version: "1.2.0" });
    try {
      await withTimeout(connect(client), left(), `MCP ${name} connect via ${label}`);
      const listed = await withTimeout(client.listTools(), left(), `MCP ${name} listTools`);
      const picked = filterExternalTools(listed.tools || [], serverConfig.allowedTools);
      // Tutup juga di jalur kosong: client yang semua tool-nya tersaring habis
      // tetap memegang soket — atau, lewat stdio, proses anak hidup yang tidak
      // akan pernah ada yang menguburkan.
      if (!picked.length) {
        logger.warn(`[mcp] ${name}: terhubung tapi tidak ada tool yang lolos filter — ditutup.`);
        await client.close().catch(() => {});
        return null;
      }
      return { name, client, picked, transport: label };
    } catch (err) {
      lastError = err;
      await client.close().catch(() => {});
    }
  }

  logger.warn(`[mcp] ${name}: tidak tersedia — ${lastError?.message || lastError}`);
  return null;
}

function readServerConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.mcpServers || {};
  } catch (err) {
    logger.error({ err }, `[mcp] gagal membaca ${file} — armada MCP dilewati.`);
    return {};
  }
}

async function createFleet() {
  if (config.mcp.disabled) {
    return { clients: [], tools: [], registry: new Map(), servers: [] };
  }

  const servers = readServerConfig();
  const enabled = Object.entries(servers).filter(([, cfg]) => !cfg.disabled);
  if (!enabled.length) {
    return { clients: [], tools: [], registry: new Map(), servers: [] };
  }

  // SDK di-require malas: satu-satunya alasan file ini menyentuhnya adalah
  // ketika ada server yang benar-benar mau disambungkan.
  const sdk = {
    ...require("@modelcontextprotocol/sdk/client/index.js"),
    ...require("@modelcontextprotocol/sdk/client/stdio.js"),
    ...require("@modelcontextprotocol/sdk/client/sse.js"),
    ...require("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  };

  // Paralel, bukan berurutan.
  const connected = (
    await Promise.all(enabled.map(([name, cfg]) => connectServer(name, cfg, sdk)))
  ).filter(Boolean);

  const clients = [];
  const tools = [];
  const registry = new Map();
  const summary = [];

  // Urutan stabil, supaya alias sebuah tool tidak berubah antar boot hanya
  // karena jaringan sedang berbeda.
  for (const server of connected.sort((a, b) => a.name.localeCompare(b.name))) {
    for (const tool of server.picked) {
      tools.push(registerTool(registry, tool.name, server.name, server.client, tool));
    }
    clients.push(server.client);
    summary.push({ name: server.name, transport: server.transport, tools: server.picked.length });
    logger.info(
      `[mcp] server "${server.name}" via ${server.transport} — ${server.picked.length} tool.`
    );
  }

  return { clients, tools, registry, servers: summary };
}

// Cache malas + snapshot status. Status dicatat dari hasil NYATA, bukan dari
// "apakah env-nya terisi" — health endpoint yang menebak adalah health
// endpoint yang berbohong di saat paling genting.
let fleetPromise = null;
let status = { state: "cold", tools: 0, servers: [], error: null, at: 0 };

function snapshot() {
  return { ...status, servers: status.servers.map((s) => ({ ...s })) };
}

async function getFleet() {
  if (!fleetPromise) {
    fleetPromise = createFleet()
      .then((fleet) => {
        status = {
          state: fleet.tools.length ? "up" : "empty",
          tools: fleet.tools.length,
          servers: fleet.servers,
          error: null,
          at: Date.now(),
        };
        return fleet;
      })
      .catch((err) => {
        status = {
          state: "down",
          tools: 0,
          servers: [],
          error: String(err?.message || err).slice(0, 200),
          at: Date.now(),
        };
        fleetPromise = null;
        throw err;
      });
  }
  return fleetPromise;
}

// Boot armada tanpa perlu ada chat. TIDAK PERNAH melempar.
async function probe() {
  try {
    await getFleet();
  } catch {
    // status sudah mencatat kegagalannya; snapshot di bawah adalah jawabannya.
  }
  return snapshot();
}

// Panggil satu tool MCP. Dibatasi dua kali dengan sengaja: opsi SDK yang
// benar-benar membatalkan request in-flight, withTimeout sebagai jaring
// pengaman untuk transport yang mengabaikannya.
async function callTool(entry, args, signal) {
  const result = await withTimeout(
    entry.client.callTool(
      { name: entry.mcpName, arguments: args },
      undefined,
      { timeout: config.mcp.toolTimeoutMs, signal }
    ),
    config.mcp.toolTimeoutMs + 1000,
    `tool ${entry.mcpName}`
  );
  const text = (result?.content || [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || JSON.stringify(result?.structuredContent ?? result ?? {});
}

async function shutdown() {
  if (!fleetPromise) return;
  const fleet = await fleetPromise.catch(() => null);
  fleetPromise = null;
  status = { state: "cold", tools: 0, servers: [], error: null, at: Date.now() };
  if (!fleet) return;
  await Promise.all(fleet.clients.map((client) => client.close().catch(() => {})));
}

module.exports = {
  getFleet,
  snapshot,
  probe,
  callTool,
  shutdown,
  // diekspor untuk test
  connectorsFor,
  filterExternalTools,
  registerTool,
  withTimeout,
  MUTATING_TOOL,
};
