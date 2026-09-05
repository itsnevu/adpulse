// Tool scraping first-party: ambil URL → teks bersih.
//
// "First-party" di sini artinya SELALU ADA: tidak butuh API key, tidak butuh
// layanan luar, dan tidak ikut mati kalau armada MCP gagal boot. Server MCP
// scraping berbayar (Firecrawl dsb.) tetap bisa dicolok lewat mcp.json untuk
// hal yang butuh render JS — ini lantai, bukan plafon.
//
// ===== KENAPA GUARD SSRF-NYA SEPANJANG INI =====
// URL-nya datang dari model, dan model membacanya dari halaman web, hasil tool,
// atau ketikan user. Artinya URL di sini adalah input yang tidak dipercaya yang
// dieksekusi oleh server yang duduk di dalam jaringan internal. Tanpa guard,
// "tolong buka http://169.254.169.254/latest/meta-data/iam/security-credentials/"
// adalah exfiltrasi kredensial IAM lewat chatbot — satu kalimat, tanpa exploit.
//
// Maka: hostname di-resolve DULU, tiap IP hasil resolusi dicek terhadap daftar
// blok, dan redirect diikuti MANUAL supaya host publik tidak bisa membelokkan
// kita ke 127.0.0.1 setelah lolos pemeriksaan pertama (TOCTOU klasik).
const dns = require("dns").promises;
const net = require("net");
const config = require("../../config");

const MAX_REDIRECTS = 3;

// Rentang yang tidak boleh dijangkau dari tool: loopback, jaringan privat,
// link-local (termasuk 169.254.169.254 milik cloud metadata), CGNAT, dan
// padanannya di IPv6.
function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // privat
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // privat
    if (a === 192 && b === 168) return true;        // privat
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                      // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;     // unspecified + loopback
    if (v.startsWith("fe80")) return true;          // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    // IPv4 yang dibungkus IPv6 (::ffff:127.0.0.1) — cek isi v4-nya.
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // bukan IP yang dikenali → tolak
}

// Validasi satu URL + resolusi DNS-nya. Melempar Error yang layak dibaca model.
async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL tidak valid: ${String(rawUrl).slice(0, 120)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Protokol ${url.protocol} tidak diizinkan — hanya http/https.`);
  }
  if (config.scrape.allowPrivateHosts) return url;

  // Host yang SUDAH berupa IP tidak perlu DNS, tapi tetap harus dicek.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error(`Alamat ${host} ada di jaringan internal — diblokir demi keamanan.`);
    }
    return url;
  }

  let resolved;
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new Error(`Tidak bisa me-resolve host ${host}: ${err.message}`);
  }
  // SEMUA hasil resolusi harus lolos, bukan cuma yang pertama: satu host bisa
  // punya beberapa A record dan hanya perlu satu yang mengarah ke dalam.
  for (const entry of resolved) {
    if (isBlockedIp(entry.address)) {
      throw new Error(
        `Host ${host} me-resolve ke alamat internal (${entry.address}) — diblokir demi keamanan.`
      );
    }
  }
  return url;
}

// HTML → teks yang layak dibaca model. Sengaja tanpa dependency: script, style,
// dan noscript dibuang isinya (bukan cuma tag-nya, karena isi <script> adalah
// sampah token paling mahal di halaman mana pun), sisanya di-strip lalu
// dirapikan spasinya.
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]).slice(0, 300) : "";
}

// Baca body dengan batas ukuran yang ditegakkan saat streaming, bukan setelah
// selesai: Content-Length itu petunjuk, bukan janji — bisa absen (chunked) atau
// sekadar bohong. Yang benar-benar membatasi adalah penghitung di bawah ini.
async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Halaman terlalu besar (${declared} byte, batas ${maxBytes}).`);
  }
  if (!response.body) return "";

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) break; // cukup — sisanya tidak akan terpakai
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Ambil satu halaman. Redirect diikuti manual supaya tiap hop dicek ulang.
async function scrape(rawUrl, { maxChars } = {}) {
  const limitChars = Math.min(Math.max(Number(maxChars) || 6000, 200), 20000);
  let target = await assertSafeUrl(rawUrl);
  const chain = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.scrape.timeoutMs);
    timer.unref?.();

    let response;
    try {
      response = await fetch(target, {
        redirect: "manual", // TOCTOU: tiap hop wajib lewat assertSafeUrl lagi
        signal: controller.signal,
        headers: {
          "User-Agent": "AdPulseBot/1.2 (+https://github.com/itsnevu/adpulse)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
      });
    } catch (err) {
      throw new Error(
        err?.name === "AbortError"
          ? `Timeout setelah ${config.scrape.timeoutMs}ms saat membuka ${target.href}`
          : `Gagal membuka ${target.href}: ${err.message}`
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} tanpa header Location.`);
      chain.push(target.href);
      target = await assertSafeUrl(new URL(location, target).href);
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} dari ${target.href}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await readBounded(response, config.scrape.maxBytes);
    const isHtml = contentType.includes("html") || /^\s*<(!doctype|html)/i.test(body);
    const text = isHtml ? htmlToText(body) : body.trim();

    return {
      url: target.href,
      redirects: chain,
      status: response.status,
      content_type: contentType || "unknown",
      title: isHtml ? extractTitle(body) : "",
      // Selalu laporkan pemotongan — model yang mengira sudah membaca seluruh
      // halaman akan menyimpulkan dari potongan tanpa bilang begitu.
      truncated: text.length > limitChars,
      chars: Math.min(text.length, limitChars),
      text: text.slice(0, limitChars),
    };
  }

  throw new Error(`Terlalu banyak redirect (>${MAX_REDIRECTS}) mulai dari ${rawUrl}.`);
}

module.exports = { scrape, assertSafeUrl, isBlockedIp, htmlToText };
