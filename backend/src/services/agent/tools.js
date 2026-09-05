// Tool first-party AdPulse — yang SELALU tersedia untuk agent.
//
// Kenapa tidak semuanya lewat MCP saja? Karena armada MCP adalah paket npm
// pihak ketiga dan server remote: salah satunya bisa mati kapan saja. Janji
// inti produk ini — "tanya apa pun soal performa iklanmu" — tidak boleh
// bergantung pada itu. Tool di file ini membaca PostgreSQL AdPulse dan API ads
// langsung, jadi tetap hidup di turn ketika seluruh armada MCP gagal boot.
//
// KONTRAK KEAMANAN: setiap tool menerima ctx = { userId } dan WAJIB memakainya.
// Model tidak pernah memilih user id — angka itu datang dari JWT, bukan dari
// argumen tool. Tanpa aturan ini, satu prompt "lihat data user 2" jadi
// kebocoran lintas-tenant.
const pool = require("../../db/pool");
const adsQuery = require("../adsQuery");
const syncService = require("../syncService");
const googleAds = require("../googleAds");
const metaAds = require("../metaAds");
const { todayStr, addDaysStr } = require("../../utils/dates");
const webScrape = require("./webScrape");

const DATE_ARG = {
  type: "string",
  description: "Tanggal YYYY-MM-DD.",
};

const PLATFORM_ARG = {
  type: "string",
  enum: ["google", "meta", "linkedin"],
  description: "Filter platform iklan. Kosongkan untuk semua platform.",
};

// Hasil tool dikirim ulang ke model di SETIAP iterasi berikutnya, jadi hasil
// tanpa batas ditagih berkali-kali. JSON ringkas, bukan dump mentah.
const json = (value) => JSON.stringify(value);

// Rentang default 30 hari terakhir, dipakai beberapa tool.
function defaultRange(args) {
  const to = args?.to || todayStr();
  const from = args?.from || addDaysStr(to, -29);
  return { from, to };
}

// Ad account milik user LENGKAP dengan token (untuk tool yang menembak API ads
// langsung). Sengaja terpisah dari adsQuery.accounts() yang tidak pernah
// menyentuh kolom token.
async function accountsWithTokens(userId, platform) {
  const { rows } = await pool.query(
    `SELECT id, platform, external_id, name, currency, status,
            access_token, refresh_token
     FROM ad_accounts
     WHERE user_id = $1 AND platform = $2 AND status = 'active'
     ORDER BY created_at ASC`,
    [userId, platform]
  );
  return rows;
}

const TOOLS = [
  {
    name: "adpulse_metrics_summary",
    description:
      "Ringkasan performa iklan tersimpan di AdPulse: spend, impressions, clicks, conversions, CTR, CPC, CPM, plus delta persen vs periode sebelumnya dengan panjang yang sama. INI TOOL PERTAMA untuk pertanyaan umum seperti 'gimana performa iklan minggu ini', 'spend naik atau turun', 'platform mana yang lebih efisien'. Membaca data hasil sync, bukan memanggil API Google/Meta — cepat dan tidak kena rate limit. Default rentang 30 hari terakhir.",
    parameters: {
      type: "object",
      properties: {
        from: { ...DATE_ARG, description: "Awal rentang (YYYY-MM-DD). Default 29 hari sebelum `to`." },
        to: { ...DATE_ARG, description: "Akhir rentang (YYYY-MM-DD). Default hari ini." },
        platform: PLATFORM_ARG,
      },
    },
    run: (args, ctx) => adsQuery.summary(ctx.userId, args).then(json),
  },

  {
    name: "adpulse_by_platform",
    description:
      "Perbandingan total antar platform (Google vs Meta vs LinkedIn) dalam satu rentang: spend, impressions, clicks, conversions per platform, terbesar dulu. Pakai ini untuk pertanyaan alokasi budget — 'platform mana yang paling banyak makan budget', 'di mana konversi paling murah'.",
    parameters: {
      type: "object",
      properties: {
        from: { ...DATE_ARG, description: "Awal rentang. Default 29 hari sebelum `to`." },
        to: { ...DATE_ARG, description: "Akhir rentang. Default hari ini." },
      },
    },
    run: (args, ctx) => adsQuery.byPlatform(ctx.userId, args).then(json),
  },

  {
    name: "adpulse_timeseries",
    description:
      "Deret harian satu metrik, dipecah per platform dan sudah zero-filled (hari tanpa data bernilai 0, bukan hilang). Pakai untuk pertanyaan tren — 'kapan spend melonjak', 'apakah CTR turun konsisten', 'ada anomali harian tidak'. Perhatikan: rentang panjang menghasilkan banyak baris, persempit tanggalnya kalau hanya butuh tren kasar.",
    parameters: {
      type: "object",
      properties: {
        from: { ...DATE_ARG, description: "Awal rentang. Default 29 hari sebelum `to`." },
        to: { ...DATE_ARG, description: "Akhir rentang. Default hari ini." },
        platform: PLATFORM_ARG,
        metric: {
          type: "string",
          enum: ["spend", "impressions", "clicks", "conversions"],
          description: "Metrik yang dideretkan. Default spend.",
        },
      },
    },
    run: (args, ctx) => adsQuery.timeseries(ctx.userId, args).then(json),
  },

  {
    name: "adpulse_campaigns",
    description:
      "Daftar campaign milik user dengan agregat metrik 30 hari terakhir (spend, impressions, clicks, conversions, CTR, CPC), diurutkan spend terbesar. Pakai untuk pertanyaan tingkat campaign — 'campaign mana yang paling boros', 'mana yang CTR-nya jelek', 'campaign apa saja yang masih aktif'. Bisa difilter platform, status, dan pencarian nama.",
    parameters: {
      type: "object",
      properties: {
        platform: PLATFORM_ARG,
        status: {
          type: "string",
          enum: ["active", "paused", "ended"],
          description: "Filter status campaign.",
        },
        search: {
          type: "string",
          description: "Cari sebagian nama campaign (case-insensitive).",
        },
      },
    },
    run: (args, ctx) => adsQuery.campaigns(ctx.userId, args).then(json),
  },

  {
    name: "adpulse_accounts",
    description:
      "Akun iklan yang sudah terhubung ke AdPulse milik user ini (platform, id eksternal, nama, mata uang, status). Pakai untuk menjawab 'akun apa saja yang tersambung' dan untuk mengecek APAKAH data kosong karena memang belum ada akun terhubung — bedakan itu dari 'akun ada tapi metriknya nol'. Token akses TIDAK PERNAH dikembalikan.",
    parameters: { type: "object", properties: {} },
    run: (args, ctx) => adsQuery.accounts(ctx.userId).then(json),
  },

  {
    name: "adpulse_sync_logs",
    description:
      "Riwayat sync data iklan (platform, status, jumlah record, pesan error, waktu mulai/selesai). Pakai ini SEBELUM menyimpulkan data hilang atau aneh: data yang bolong hampir selalu berarti sync terakhir gagal, bukan performa iklan yang anjlok. Selalu cek di sini kalau angka terlihat mencurigakan.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Jumlah log terakhir yang diambil (1-200). Default 20.",
        },
      },
    },
    run: (args, ctx) => adsQuery.syncLogs(ctx.userId, args?.limit || 20).then(json),
  },

  {
    name: "google_ads_live_metrics",
    description:
      "Tarik metrik harian LANGSUNG dari Google Ads API untuk akun Google user ini, tanpa lewat database AdPulse. Pakai HANYA kalau user secara eksplisit minta angka paling baru/real-time, atau kalau adpulse_sync_logs menunjukkan sync terakhir gagal sehingga data tersimpan basi. Untuk pertanyaan biasa pakai adpulse_metrics_summary — jauh lebih cepat dan tidak memakan kuota API. Kalau MOCK_ADS=true atau kredensial belum lengkap, yang kembali adalah data sample deterministik: katakan itu apa adanya, jangan sajikan sebagai angka asli.",
    parameters: {
      type: "object",
      properties: {
        from: { ...DATE_ARG, description: "Awal rentang. Default 6 hari sebelum `to`." },
        to: { ...DATE_ARG, description: "Akhir rentang. Default hari ini." },
      },
    },
    run: async (args, ctx) => {
      const to = args?.to || todayStr();
      const from = args?.from || addDaysStr(to, -6);
      const accounts = await accountsWithTokens(ctx.userId, "google");
      if (!accounts.length) {
        return json({ error: "Belum ada akun Google Ads aktif yang terhubung untuk user ini." });
      }
      const out = [];
      for (const account of accounts) {
        try {
          const rows = await googleAds.fetchDailyMetrics(account, from, to);
          out.push({
            account: account.name,
            external_id: account.external_id,
            mock: googleAds.useMock(),
            rows: rows.length,
            // `raw` dibuang: payload mentah API adalah sampah token termahal
            // yang bisa masuk ke context, dan tidak ada pertanyaan user yang
            // membutuhkannya.
            metrics: rows.map(({ raw, ...rest }) => rest),
          });
        } catch (err) {
          out.push({ account: account.name, error: String(err.message).slice(0, 300) });
        }
      }
      return json({ from, to, accounts: out });
    },
  },

  {
    name: "meta_ads_live_metrics",
    description:
      "Tarik metrik harian LANGSUNG dari Meta Marketing API (Facebook/Instagram Ads) untuk akun Meta user ini, tanpa lewat database AdPulse. Aturan pakainya sama dengan google_ads_live_metrics: hanya untuk permintaan angka real-time atau saat sync terakhir gagal. Kalau MOCK_ADS=true atau kredensial belum lengkap, hasilnya data sample deterministik — sebutkan itu, jangan diklaim angka asli.",
    parameters: {
      type: "object",
      properties: {
        from: { ...DATE_ARG, description: "Awal rentang. Default 6 hari sebelum `to`." },
        to: { ...DATE_ARG, description: "Akhir rentang. Default hari ini." },
      },
    },
    run: async (args, ctx) => {
      const to = args?.to || todayStr();
      const from = args?.from || addDaysStr(to, -6);
      const accounts = await accountsWithTokens(ctx.userId, "meta");
      if (!accounts.length) {
        return json({ error: "Belum ada akun Meta Ads aktif yang terhubung untuk user ini." });
      }
      const out = [];
      for (const account of accounts) {
        try {
          const rows = await metaAds.fetchDailyMetrics(account, from, to);
          out.push({
            account: account.name,
            external_id: account.external_id,
            mock: metaAds.useMock(),
            rows: rows.length,
            metrics: rows.map(({ raw, ...rest }) => rest),
          });
        } catch (err) {
          out.push({ account: account.name, error: String(err.message).slice(0, 300) });
        }
      }
      return json({ from, to, accounts: out });
    },
  },

  {
    name: "adpulse_run_sync",
    description:
      "Jalankan sync sekarang untuk satu platform (google atau meta): tarik campaign + metrik dari API ads lalu simpan ke database AdPulse. INI SATU-SATUNYA TOOL YANG MENULIS DATA. Jalankan hanya kalau user memang memintanya ('sync dong', 'tarik data terbaru', 'refresh'), atau setelah kamu menemukan sync terakhir gagal DAN user setuju mengulang. Jangan pernah dipanggil hanya untuk 'berjaga-jaga' — sync memakan kuota API dan bisa berjalan lama.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["google", "meta"],
          description: "Platform yang disync. LinkedIn belum didukung (phase 2).",
        },
      },
      required: ["platform"],
    },
    run: async (args, ctx) => {
      const platform = String(args?.platform || "");
      if (!["google", "meta"].includes(platform)) {
        return json({ error: 'Platform harus "google" atau "meta".' });
      }
      const log = await syncService.runSync(platform, ctx.userId);
      return json(log);
    },
  },

  {
    name: "web_scrape",
    description:
      "Ambil isi satu halaman web dan kembalikan sebagai teks bersih. Pakai untuk riset di luar data iklan: membaca landing page yang dipakai campaign, mengecek halaman produk/harga kompetitor, membaca artikel atau dokumentasi yang disebut user. Hanya http/https, tidak merender JavaScript (halaman yang isinya dibangun JS bisa kembali hampir kosong — katakan begitu, jangan mengarang isinya). Alamat jaringan internal diblokir. Field `truncated` menandakan isi terpotong.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL lengkap termasuk http:// atau https://." },
        max_chars: {
          type: "integer",
          description: "Batas jumlah karakter teks yang dikembalikan (200-20000). Default 6000.",
        },
      },
      required: ["url"],
    },
    run: async (args) => json(await webScrape.scrape(args?.url, { maxChars: args?.max_chars })),
  },
];

// Nama tool yang menulis — dipakai runner untuk logging dan (nanti) konfirmasi.
const MUTATING = new Set(["adpulse_run_sync"]);

function schemas() {
  return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

function registry() {
  const map = new Map();
  for (const tool of TOOLS) map.set(tool.name, tool);
  return map;
}

module.exports = { TOOLS, MUTATING, schemas, registry };
