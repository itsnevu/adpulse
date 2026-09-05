// Landing page — dark, elegant, pure SVG/CSS (no external images).
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  LayoutDashboard,
  Link2,
  Mail,
  PieChart,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Logo from "@/components/Logo";

const PLATFORM_BADGES = [
  { label: "Google Ads", color: "#2a78d6" },
  { label: "Meta Ads", color: "#eb6834" },
  { label: "LinkedIn Ads", color: "#1baf7a" },
];

const FEATURES = [
  {
    icon: RefreshCw,
    title: "Sync otomatis tiap 4 jam",
    desc: "Data kampanye ditarik langsung dari Google Ads dan Meta Ads secara terjadwal — tanpa export manual, tanpa spreadsheet.",
  },
  {
    icon: Sparkles,
    title: "Insight AI harian via email",
    desc: "Setiap hari pukul 12:00, AI menganalisis performa iklan Anda dan mengirim ringkasan + rekomendasi ke inbox. Powered by Claude.",
  },
  {
    icon: LayoutDashboard,
    title: "Dashboard real-time lintas platform",
    desc: "Spend, impresi, klik, dan konversi dari semua platform dalam satu tampilan — dengan tren, distribusi, dan kampanye teratas.",
  },
  {
    icon: PieChart,
    title: "Rekomendasi alokasi budget",
    desc: "AI membandingkan performa antar platform dan kampanye, lalu menyarankan ke mana budget sebaiknya dialihkan.",
  },
];

const STEPS = [
  {
    icon: Link2,
    title: "Hubungkan akun",
    desc: "Tambahkan akun Google Ads dan Meta Ads Anda dalam hitungan menit — cukup ID akun, tanpa konfigurasi rumit.",
  },
  {
    icon: RefreshCw,
    title: "Data tersinkron otomatis",
    desc: "AdPulse menarik metrik harian setiap 4 jam dan menyimpannya rapi per kampanye, siap dianalisis kapan saja.",
  },
  {
    icon: Brain,
    title: "AI menganalisis & mengirim insight",
    desc: "Claude membaca tren performa Anda, menyusun ringkasan, dan mengirim rekomendasi yang bisa langsung dieksekusi.",
  },
];

// Decorative mini dashboard preview (pure SVG/CSS)
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-blue-900/20 backdrop-blur sm:p-6">
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Spend", value: "$24.3K" },
          { label: "Impressions", value: "1.8M" },
          { label: "Clicks", value: "52.4K" },
          { label: "Conversions", value: "1.2K" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className="text-base font-semibold text-white sm:text-lg">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          {PLATFORM_BADGES.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
        <svg viewBox="0 0 400 120" className="h-28 w-full" role="img" aria-label="Ilustrasi grafik spend per platform">
          <g stroke="#ffffff" strokeOpacity="0.08">
            <line x1="0" y1="30" x2="400" y2="30" />
            <line x1="0" y1="60" x2="400" y2="60" />
            <line x1="0" y1="90" x2="400" y2="90" />
          </g>
          <polyline
            points="0,78 50,70 100,74 150,58 200,62 250,44 300,50 350,32 400,26"
            fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <polyline
            points="0,95 50,90 100,84 150,88 200,76 250,80 300,66 350,70 400,58"
            fill="none" stroke="#eb6834" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <polyline
            points="0,108 50,104 100,106 150,100 200,102 250,94 300,97 350,90 400,86"
            fill="none" stroke="#1baf7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="pointer-events-none absolute -right-3 -top-3 hidden items-center gap-1.5 rounded-full border border-white/10 bg-[#131316] px-3 py-1.5 text-xs font-medium text-gray-200 shadow-lg sm:inline-flex">
        <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
        Insight AI terkirim 12:00
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-gray-300">
      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0b0c]/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="AdPulse — beranda">
            <Logo dark />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition hover:text-white"
            >
              Masuk
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-gradient-to-r from-[#2a78d6] to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition hover:opacity-90"
            >
              Daftar
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
            style={{ background: "radial-gradient(closest-side, #2a78d6, #7c3aed 60%, transparent)" }}
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
            <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-gray-300">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
              Analitik iklan + AI dalam satu platform
            </p>
            <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
              Semua data iklan Google, Meta &amp; LinkedIn dalam{" "}
              <span className="bg-gradient-to-r from-[#4a94e8] to-violet-400 bg-clip-text text-transparent">
                satu dashboard
              </span>
              , plus insight AI harian
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
              Berhenti berpindah-pindah tab dan menyalin angka ke spreadsheet. AdPulse menyatukan
              performa semua platform iklan Anda, lalu AI merangkum apa yang penting — setiap hari,
              langsung ke email Anda.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2a78d6] to-violet-600 px-7 py-3.5 text-base font-semibold text-white shadow-xl shadow-blue-900/30 transition hover:opacity-90 sm:w-auto"
              >
                Mulai Sekarang
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 text-base font-semibold text-gray-200 transition hover:bg-white/[0.08] sm:w-auto"
              >
                Lihat Demo
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {PLATFORM_BADGES.map((p) => (
                <span
                  key={p.label}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm font-medium text-gray-200"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
                  {p.label}
                </span>
              ))}
            </div>
            <div className="mt-14">
              <HeroPreview />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Satu platform, semua yang Anda butuhkan
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-400 sm:text-base">
              Dibangun untuk tim marketing yang ingin mengambil keputusan berdasarkan data — bukan firasat.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-[#2a78d6]/50 hover:bg-white/[0.05]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#2a78d6]/20 to-violet-600/20 text-[#4a94e8]">
                  <f.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-white/5 bg-white/[0.02]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-white sm:text-3xl">Cara Kerja</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-gray-400 sm:text-base">
                Tiga langkah dari data mentah menjadi keputusan.
              </p>
            </div>
            <ol className="grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative text-center md:text-left">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#2a78d6]/40 bg-[#2a78d6]/10 text-[#4a94e8] md:mx-0">
                    <s.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#4a94e8]">
                    Langkah {i + 1}
                  </p>
                  <h3 className="mb-2 text-lg font-semibold text-white">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-400">{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#2a78d6]/15 via-transparent to-violet-600/15 px-6 py-14 text-center sm:px-12">
            <div
              className="pointer-events-none absolute -top-24 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
              style={{ background: "radial-gradient(closest-side, #2a78d6, transparent)" }}
              aria-hidden="true"
            />
            <BarChart3 className="mx-auto mb-5 h-9 w-9 text-[#4a94e8]" aria-hidden="true" />
            <h2 className="mx-auto max-w-2xl text-2xl font-bold text-white sm:text-3xl">
              Siap mengambil keputusan iklan lebih cepat dan lebih tepat?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-gray-400 sm:text-base">
              Daftar gratis, hubungkan akun iklan Anda, dan terima insight AI pertama Anda besok siang.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2a78d6] to-violet-600 px-7 py-3.5 text-base font-semibold text-white shadow-xl shadow-blue-900/30 transition hover:opacity-90"
              >
                Mulai Sekarang
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <span className="inline-flex items-center gap-2 text-sm text-gray-400">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Insight harian langsung ke inbox Anda
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Logo dark />
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} AdPulse. Analitik iklan lintas platform dengan insight AI.
          </p>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <Link href="/login" className="transition hover:text-white">Masuk</Link>
            <Link href="/register" className="transition hover:text-white">Daftar</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
