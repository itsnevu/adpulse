// Formatting helpers + platform constants from the AdPulse design system.
// Series colors FOLLOW THE ENTITY and are permanent — never re-assigned
// when filters change: Google blue, Meta orange, LinkedIn aqua.

export const PLATFORMS = {
  google: { label: "Google Ads", short: "Google", color: "#2a78d6" },
  meta: { label: "Meta Ads", short: "Meta", color: "#eb6834" },
  linkedin: { label: "LinkedIn Ads", short: "LinkedIn", color: "#1baf7a" },
};

export const PLATFORM_ORDER = ["google", "meta", "linkedin"];

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Large counts: compact notation (12.4K, 1.2M)
export function fmtCompact(n) {
  const v = Number(n);
  if (n === null || n === undefined || Number.isNaN(v)) return "–";
  return compactFmt.format(v);
}

// Spend: "$" prefix + compact notation
export function fmtMoney(n) {
  const v = Number(n);
  if (n === null || n === undefined || Number.isNaN(v)) return "–";
  return `$${compactFmt.format(v)}`;
}

// CTR: two decimals + "%" suffix
export function fmtCtr(n) {
  const v = Number(n);
  if (n === null || n === undefined || Number.isNaN(v)) return "–";
  return `${v.toFixed(2)}%`;
}

// CPC: "$" prefix + two decimals
export function fmtCpc(n) {
  const v = Number(n);
  if (n === null || n === undefined || Number.isNaN(v)) return "–";
  return `$${v.toFixed(2)}`;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Inclusive date range ending today, e.g. rangeDays(7) => last 7 days
export function rangeDays(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: toISODate(from), to: toISODate(to) };
}

function safeDate(iso) {
  if (!iso) return null;
  const s = String(iso);
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "25 Agu" — axis ticks and tooltips
export function fmtDateShort(iso) {
  const d = safeDate(iso);
  if (!d) return String(iso || "–");
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(d);
}

// "25 Agustus 2026" — insight periods
export function fmtDateLong(iso) {
  const d = safeDate(iso);
  if (!d) return String(iso || "–");
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// "25 Agu, 14.05" — sync log timestamps
export function fmtDateTime(iso) {
  const d = safeDate(iso);
  if (!d) return "–";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
