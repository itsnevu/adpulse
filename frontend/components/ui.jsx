// Shared presentational pieces for the dashboard (light theme).
// Identity is never carried by color alone: badges pair a colored dot with a text label.

import { AlertCircle, Inbox } from "lucide-react";
import { PLATFORMS } from "@/lib/format";

export function Card({ className = "", children }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function PlatformBadge({ platform }) {
  const p = PLATFORMS[platform] || { label: platform || "–", color: "#6b7280" };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-900">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: p.color }}
        aria-hidden="true"
      />
      {p.label}
    </span>
  );
}

const STATUS_MAP = {
  active: { label: "Aktif", cls: "border-green-200 bg-green-50 text-green-700" },
  paused: { label: "Dijeda", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  ended: { label: "Selesai", cls: "border-gray-200 bg-gray-100 text-gray-600" },
  error: { label: "Error", cls: "border-red-200 bg-red-50 text-red-700" },
  success: { label: "Sukses", cls: "border-green-200 bg-green-50 text-green-700" },
  running: { label: "Berjalan", cls: "border-blue-200 bg-blue-50 text-blue-700" },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || {
    label: status || "–",
    cls: "border-gray-200 bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

const IMPACT_MAP = {
  high: { label: "Dampak tinggi", cls: "border-red-200 bg-red-50 text-red-700" },
  medium: { label: "Dampak sedang", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  low: { label: "Dampak rendah", cls: "border-gray-200 bg-gray-100 text-gray-600" },
};

export function ImpactBadge({ impact }) {
  const key = String(impact || "").toLowerCase();
  const s = IMPACT_MAP[key] || IMPACT_MAP.low;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-md bg-gray-200/70 ${className}`} aria-hidden="true" />;
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center">
      <AlertCircle className="h-6 w-6 text-red-500" aria-hidden="true" />
      <p className="text-sm font-medium text-red-700">{message || "Terjadi kesalahan."}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Inbox className="h-7 w-7 text-gray-300" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
