"use client";

// Reset-password page — reads ?token= from the URL and posts the new password to
// /api/auth/reset. useSearchParams MUST live in a child component wrapped in
// <Suspense>, otherwise `next build` fails prerendering this route.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Lock } from "lucide-react";
import api from "@/lib/api";
import Logo from "@/components/Logo";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/30";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/reset", { token, password });
      setDone(true);
      // Give the user a beat to read the success message, then off to /login.
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <>
        <div
          className="mt-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Tautan reset tidak valid atau tidak lengkap. Silakan minta tautan baru melalui halaman
            lupa password.
          </p>
        </div>
        <p className="mt-5 text-center text-sm text-gray-400">
          <Link
            href="/forgot-password"
            className="font-semibold text-[#4a94e8] transition hover:text-white"
          >
            Minta tautan reset baru
          </Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <div
        className="mt-5 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-300"
        role="status"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Password berhasil diubah. Anda akan diarahkan ke halaman masuk…{" "}
          <Link href="/login" className="font-semibold underline transition hover:text-white">
            Masuk sekarang
          </Link>
        </p>
      </div>
    );
  }

  return (
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
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-300">
            Password baru
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-gray-300">
            Konfirmasi password baru
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Ulangi password baru"
            className={inputClass}
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
            <Lock className="h-4 w-4" aria-hidden="true" />
          )}
          {loading ? "Menyimpan..." : "Simpan password baru"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-gray-400">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-[#4a94e8] transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Kembali ke halaman masuk
        </Link>
      </p>
    </>
  );
}

function FormFallback() {
  return (
    <div className="mt-8 flex items-center justify-center py-6" aria-label="Memuat">
      <Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-hidden="true" />
    </div>
  );
}

export default function ResetPasswordPage() {
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
        <h1 className="text-xl font-bold text-white">Atur ulang password</h1>
        <p className="mt-1 text-sm text-gray-400">
          Buat password baru untuk akun AdPulse Anda.
        </p>

        <Suspense fallback={<FormFallback />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
