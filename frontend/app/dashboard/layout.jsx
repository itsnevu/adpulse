"use client";

// Dashboard shell: auth guard, sidebar navigation, and topbar with the signed-in user.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import api, { clearToken, getToken } from "@/lib/api";
import Logo from "@/components/Logo";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/insights", label: "AI Insights", icon: Sparkles },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auth guard: no token → back to /login.
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
    api
      .get("/api/auth/me")
      .then((data) => setUser(data && data.user ? data.user : null))
      .catch(() => {
        // A 401 here is already handled by lib/api (token cleared + redirect).
      });
  }, [router]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#2a78d6]" aria-label="Memuat" />
      </div>
    );
  }

  const current = NAV.find((n) => n.href === pathname);

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center justify-between border-b border-gray-200 px-5">
        <Link href="/dashboard" aria-label="AdPulse — overview">
          <Logo />
        </Link>
        <button
          type="button"
          className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Tutup menu"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Menu utama">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-[#2a78d6]/10 text-[#2a78d6]"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      {/* Static sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-gray-200 bg-white lg:flex">
        {sidebarContent}
      </aside>

      {/* Drawer sidebar (mobile) */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-gray-200 bg-white shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <h1 className="text-base font-semibold text-gray-900">
              {current ? current.label : "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-gray-900">
                {user ? user.name : "…"}
              </p>
              <p className="text-xs text-gray-500">{user ? user.email : ""}</p>
            </div>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2a78d6] to-violet-600 text-sm font-semibold text-white"
              aria-hidden="true"
            >
              {user && user.name ? user.name.charAt(0).toUpperCase() : "•"}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
