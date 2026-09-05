"use client";

// Root route. Landing page dihapus (diarsipkan di _archive/landing/page.jsx) —
// AdPulse sekarang langsung masuk ke aplikasi: ada token → /dashboard,
// tidak ada → /login. Client component karena token disimpan di localStorage,
// jadi server tidak bisa tahu status login.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/dashboard" : "/login");
  }, [router]);

  // Layar transisi singkat — tanpa ini halaman berkedip putih sebelum redirect.
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c]">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#2a78d6]"
        role="status"
        aria-label="Memuat AdPulse"
      />
    </div>
  );
}
