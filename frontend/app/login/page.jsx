"use client";

// Login page — posts to /api/auth/login, stores the JWT, then goes to /dashboard.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import api, { getToken, setToken } from "@/lib/api";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Already signed in? Straight to the dashboard.
  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.post("/api/auth/login", { email, password });
      setToken(data.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail("demo@adpulse.io");
    setPassword("demo1234");
    setError("");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b0b0c] px-4 py-10">
      <div
        className="pointer-events-none fixed -top-32 left-1/2 h-96 w-[640px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #2a78d6, #7c3aed 60%, transparent)" }}
        aria-hidden="true"
      />
      <Link href="/" className="relative mb-8" aria-label="AdPulse — beranda">
        <Logo dark />
      </Link>

      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur sm:p-8">
        <h1 className="text-xl font-bold text-white">Masuk ke AdPulse</h1>
        <p className="mt-1 text-sm text-gray-400">
          Lihat performa semua iklan Anda dalam satu dashboard.
        </p>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@perusahaan.com"
              className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/30"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/30"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2a78d6] to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="h-4 w-4" aria-hidden="true" />
            )}
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>

        <button
          type="button"
          onClick={fillDemo}
          className="mt-4 w-full rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-2.5 text-left text-xs text-gray-400 transition hover:border-[#2a78d6]/50 hover:text-gray-300"
        >
          <span className="font-semibold text-gray-300">Akun demo:</span> demo@adpulse.io /
          demo1234 — klik untuk mengisi otomatis.
        </button>

        <p className="mt-5 text-center text-sm text-gray-400">
          Belum punya akun?{" "}
          <Link href="/register" className="font-semibold text-[#4a94e8] transition hover:text-white">
            Daftar sekarang
          </Link>
        </p>
      </div>
    </div>
  );
}
