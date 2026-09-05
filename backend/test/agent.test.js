// Unit suite agent MCP (tanpa DB): konversi transkrip antar vendor, guard SSRF
// scraping, filter tool MCP, dan alias tool.
//
// Tiga bagian ini yang paling mudah salah dan paling mahal kalau salah:
// transkrip yang salah bentuk ditolak API (fitur mati total), guard SSRF yang
// bocor mengubah chatbot jadi pintu ke jaringan internal, dan filter tool yang
// bocor memberi model kemampuan menulis yang tidak pernah diniatkan.
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
// Env test di-set oleh helper SEBELUM src dimuat (config membekukan env).
require("./helpers/setup");

const { toAnthropicMessages, toOpenAiMessages } = require("../src/services/agent/engine");
const { isBlockedIp, htmlToText, assertSafeUrl } = require("../src/services/agent/webScrape");
const {
  filterExternalTools,
  registerTool,
  connectorsFor,
  MUTATING_TOOL,
} = require("../src/services/agent/mcpFleet");
const firstParty = require("../src/services/agent/tools");

// Transkrip contoh: user bertanya, model memanggil DUA tool sekaligus, hasilnya
// kembali, model menjawab. Ini bentuk yang benar-benar terjadi tiap giliran.
const TRANSCRIPT = [
  { role: "user", content: "spend minggu ini berapa?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "call_1", name: "adpulse_metrics_summary", args: { from: "2026-09-01" } },
      { id: "call_2", name: "adpulse_by_platform", args: {} },
    ],
  },
  { role: "tool", toolCallId: "call_1", name: "adpulse_metrics_summary", content: '{"spend":120}' },
  { role: "tool", toolCallId: "call_2", name: "adpulse_by_platform", content: "[]" },
];

describe("engine — konversi transkrip ke format Anthropic", () => {
  it("mengelompokkan SEMUA hasil tool satu putaran ke dalam satu pesan user", () => {
    const out = toAnthropicMessages(TRANSCRIPT);
    // user → assistant(tool_use) → user(tool_result x2). Memecah hasil tool
    // jadi dua pesan user membuat API menolak seluruh transkrip.
    assert.equal(out.length, 3);
    assert.equal(out[2].role, "user");
    assert.equal(out[2].content.length, 2);
    assert.equal(out[2].content[0].type, "tool_result");
    assert.equal(out[2].content[0].tool_use_id, "call_1");
    assert.equal(out[2].content[1].tool_use_id, "call_2");
  });

  it("memetakan toolCalls jadi blok tool_use dengan id dan input utuh", () => {
    const out = toAnthropicMessages(TRANSCRIPT);
    const blocks = out[1].content;
    assert.equal(out[1].role, "assistant");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, "tool_use");
    assert.equal(blocks[0].id, "call_1");
    assert.equal(blocks[0].name, "adpulse_metrics_summary");
    assert.deepEqual(blocks[0].input, { from: "2026-09-01" });
  });

  it("membuang pesan assistant yang benar-benar kosong (ditolak API)", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "halo" },
      { role: "assistant", content: "", toolCalls: [] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "user");
  });

  it("menyertakan teks assistant bersama tool_use bila dua-duanya ada", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "cek" },
      {
        role: "assistant",
        content: "Saya cek dulu.",
        toolCalls: [{ id: "c1", name: "adpulse_accounts", args: {} }],
      },
    ]);
    assert.equal(out[1].content[0].type, "text");
    assert.equal(out[1].content[0].text, "Saya cek dulu.");
    assert.equal(out[1].content[1].type, "tool_use");
  });
});

describe("engine — konversi transkrip ke format OpenAI-compatible", () => {
  it("menaruh system di depan dan tiap hasil tool sebagai pesan terpisah", () => {
    const out = toOpenAiMessages("SISTEM", TRANSCRIPT);
    assert.equal(out[0].role, "system");
    assert.equal(out[0].content, "SISTEM");
    // Kebalikan dari Anthropic: di sini tiap tool_result adalah pesannya sendiri.
    const toolMessages = out.filter((m) => m.role === "tool");
    assert.equal(toolMessages.length, 2);
    assert.equal(toolMessages[0].tool_call_id, "call_1");
  });

  it("menserialisasi argumen tool jadi string JSON (bukan objek)", () => {
    const out = toOpenAiMessages("S", TRANSCRIPT);
    const assistant = out.find((m) => m.role === "assistant");
    assert.equal(assistant.tool_calls[0].type, "function");
    assert.equal(typeof assistant.tool_calls[0].function.arguments, "string");
    assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), {
      from: "2026-09-01",
    });
  });
});

describe("webScrape — guard SSRF", () => {
  it("memblokir loopback, jaringan privat, link-local, dan CGNAT", () => {
    // 169.254.169.254 adalah endpoint metadata cloud: kalau ini lolos, satu
    // kalimat ke chatbot cukup untuk mengambil kredensial IAM.
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(isBlockedIp(ip), true, `${ip} seharusnya diblokir`);
    }
  });

  it("mengizinkan alamat publik", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:4700::1111"]) {
      assert.equal(isBlockedIp(ip), false, `${ip} seharusnya lolos`);
    }
  });

  it("menolak skema selain http/https", async () => {
    await assert.rejects(() => assertSafeUrl("file:///etc/passwd"), /tidak diizinkan/);
    await assert.rejects(() => assertSafeUrl("gopher://evil/"), /tidak diizinkan/);
  });

  it("menolak URL yang tidak bisa diparse", async () => {
    await assert.rejects(() => assertSafeUrl("bukan url"), /tidak valid/);
  });

  it("menolak IP internal yang ditulis langsung sebagai host", async () => {
    await assert.rejects(() => assertSafeUrl("http://127.0.0.1:5432/"), /internal/);
    await assert.rejects(() => assertSafeUrl("http://169.254.169.254/latest/meta-data/"), /internal/);
  });
});

describe("webScrape — HTML ke teks", () => {
  it("membuang isi script dan style, bukan cuma tag-nya", () => {
    const text = htmlToText(
      "<html><head><style>.a{color:red}</style></head><body><script>var x=1</script><p>Halo dunia</p></body></html>"
    );
    assert.ok(text.includes("Halo dunia"));
    assert.ok(!text.includes("var x"), "isi <script> tidak boleh ikut");
    assert.ok(!text.includes("color:red"), "isi <style> tidak boleh ikut");
  });

  it("menerjemahkan entity HTML dasar", () => {
    assert.equal(htmlToText("<p>A &amp; B &lt;C&gt;</p>"), "A & B <C>");
  });
});

describe("mcpFleet — filter tool eksternal", () => {
  const TOOLS = [
    { name: "read_messages" },
    { name: "send_message" },
    { name: "list_chats" },
    { name: "delete_chat" },
    { name: "search" },
  ];

  it("menyaring keluar tool yang namanya terlihat menulis", () => {
    const kept = filterExternalTools(TOOLS).map((t) => t.name);
    assert.deepEqual(kept, ["read_messages", "list_chats", "search"]);
  });

  it("allowedTools bersifat opt-in eksplisit dan menang atas filter", () => {
    const kept = filterExternalTools(TOOLS, ["send_message"]).map((t) => t.name);
    assert.deepEqual(kept, ["send_message"]);
  });

  it("pola mutasi mengenali awalan maupun pemisah di tengah nama", () => {
    assert.equal(MUTATING_TOOL.test("send_message"), true);
    assert.equal(MUTATING_TOOL.test("whatsapp.send"), true);
    assert.equal(MUTATING_TOOL.test("chat-delete"), true);
    assert.equal(MUTATING_TOOL.test("get_sender_info"), false, "'sender' bukan 'send'");
  });
});

describe("mcpFleet — alias tool", () => {
  it("membersihkan karakter yang tidak sah di wire format", () => {
    const registry = new Map();
    const schema = registerTool(registry, "whatsapp.read/messages", "wa", {}, {});
    assert.match(schema.name, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(registry.get(schema.name).mcpName, "whatsapp.read/messages");
    assert.equal(registry.get(schema.name).server, "wa");
  });

  it("menghindari tabrakan nama antar server", () => {
    const registry = new Map();
    const a = registerTool(registry, "search", "server-a", {}, {});
    const b = registerTool(registry, "search", "server-b", {}, {});
    assert.notEqual(a.name, b.name);
    assert.equal(a.name, "search");
    assert.equal(b.name, "search_2");
    assert.equal(registry.get(b.name).server, "server-b");
  });
});

describe("mcpFleet — pemilihan transport", () => {
  const sdk = {
    Client: class {},
    StdioClientTransport: class {},
    SSEClientTransport: class {},
    StreamableHTTPClientTransport: class {},
    getDefaultEnvironment: () => ({}),
  };

  it("server berbasis command hanya memakai stdio", () => {
    const list = connectorsFor({ command: "npx", args: ["x"] }, sdk).map(([label]) => label);
    assert.deepEqual(list, ["stdio"]);
  });

  it("transport yang dideklarasikan bersifat otoritatif", () => {
    assert.deepEqual(
      connectorsFor({ url: "https://x/mcp", type: "sse" }, sdk).map(([l]) => l),
      ["sse"]
    );
    assert.deepEqual(
      connectorsFor({ url: "https://x/mcp", type: "http" }, sdk).map(([l]) => l),
      ["streamable-http"]
    );
  });

  it("tanpa deklarasi: coba streamable-http dulu lalu SSE (urutan spec MCP)", () => {
    assert.deepEqual(
      connectorsFor({ url: "https://x/mcp" }, sdk).map(([l]) => l),
      ["streamable-http", "sse"]
    );
  });

  it("konfigurasi tanpa command maupun url tidak menghasilkan connector", () => {
    assert.deepEqual(connectorsFor({}, sdk), []);
  });
});

describe("tools first-party", () => {
  it("setiap tool punya nama, deskripsi, skema, dan run()", () => {
    for (const tool of firstParty.TOOLS) {
      assert.match(tool.name, /^[a-z0-9_]+$/, `nama tool tidak sah: ${tool.name}`);
      assert.ok(tool.description && tool.description.length > 40, `deskripsi ${tool.name} terlalu pendek`);
      assert.equal(tool.parameters.type, "object", `skema ${tool.name} harus object`);
      assert.equal(typeof tool.run, "function");
    }
  });

  it("nama tool unik", () => {
    const names = firstParty.TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });

  it("hanya adpulse_run_sync yang ditandai menulis", () => {
    assert.deepEqual([...firstParty.MUTATING], ["adpulse_run_sync"]);
  });

  it("schemas() tidak membocorkan fungsi run ke model", () => {
    for (const schema of firstParty.schemas()) {
      assert.equal(schema.run, undefined);
      assert.ok(schema.name && schema.description && schema.parameters);
    }
  });
});
