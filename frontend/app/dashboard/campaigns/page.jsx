"use client";

// Campaigns: full table with server-side platform/status filters and search.
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import api from "@/lib/api";
import { fmtCompact, fmtCpc, fmtCtr, fmtMoney } from "@/lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PlatformBadge,
  Skeleton,
  StatusBadge,
} from "@/components/ui";

const PLATFORM_OPTIONS = [
  { value: "", label: "Semua platform" },
  { value: "google", label: "Google Ads" },
  { value: "meta", label: "Meta Ads" },
  { value: "linkedin", label: "LinkedIn Ads" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "active", label: "Aktif" },
  { value: "paused", label: "Dijeda" },
  { value: "ended", label: "Selesai" },
];

const selectCls =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/20";

export default function CampaignsPage() {
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (status) params.set("status", status);
    if (debounced) params.set("search", debounced);
    const qs = params.toString();
    try {
      const data = await api.get(`/api/campaigns${qs ? `?${qs}` : ""}`);
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [platform, status, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Filter row — one row above the table */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama kampanye..."
            aria-label="Cari kampanye"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/20"
          />
        </div>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Filter platform"
          className={selectCls}
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter status"
          className={selectCls}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader
          title="Semua Kampanye"
          subtitle={loading ? "Memuat..." : `${campaigns.length} kampanye · agregat metrik 30 hari terakhir`}
        />
        {error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={load} />
          </div>
        ) : loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="Tidak ada kampanye yang cocok"
            hint="Coba ubah filter atau kata kunci pencarian. Jika belum ada data sama sekali, jalankan sync di halaman Settings."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-3 font-medium">Nama</th>
                  <th className="px-5 py-3 font-medium">Platform</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Spend</th>
                  <th className="px-5 py-3 text-right font-medium">Impressions</th>
                  <th className="px-5 py-3 text-right font-medium">Clicks</th>
                  <th className="px-5 py-3 text-right font-medium">Conversions</th>
                  <th className="px-5 py-3 text-right font-medium">CTR</th>
                  <th className="px-5 py-3 text-right font-medium">CPC</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 transition hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3.5"><PlatformBadge platform={c.platform} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtMoney(c.spend)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCompact(c.impressions)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCompact(c.clicks)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCompact(c.conversions)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCtr(c.ctr)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCpc(c.cpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
