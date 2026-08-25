"use client";

// Forgot-password page — posts the email to /api/auth/forgot and always shows a
// neutral success message (the backend never reveals whether the email exists).
import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, KeyRound, Loader2, MailCheck } from "lucide-react";
import api from "@/lib/api";
import Logo from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/api/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
        <h1 className="text-xl font-bold text-white">Lupa password</h1>
        <p className="mt-1 text-sm text-gray-400">
          Masukkan email akun Anda. Kami akan mengirim tautan untuk mengatur ulang password.
        </p>

        {sent ? (
          <div
            className="mt-5 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-300"
            role="status"
          >
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Jika email tersebut terdaftar, tautan reset password sudah dikirim. Silakan periksa
              kotak masuk (dan folder spam) Anda. Tautan berlaku selama 60 menit.
            </p>
          </div>
        ) : (
          <>
            {error ? (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
                role="alert"
              >
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
              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2a78d6] to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                )}
                {loading ? "Mengirim..." : "Kirim tautan reset"}
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-center text-sm text-gray-400">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-semibold text-[#4a94e8] transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Kembali ke halaman masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
