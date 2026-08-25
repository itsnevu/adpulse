"use client";

// Overview: date-range filter, 4 stat cards with delta chips, spend-per-platform
// line chart, spend-distribution donut, and the top campaigns table.
// Chart rules (design system): colors follow the entity permanently, a single Y
// axis, thin lines (2px) with no permanent dots, recessive horizontal grid only,
// neutral text colors, formatted tooltips, legend whenever >1 series.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import api from "@/lib/api";
import {
  PLATFORMS,
  PLATFORM_ORDER,
  fmtCompact,
  fmtCpc,
  fmtCtr,
  fmtMoney,
  fmtDateShort,
  rangeDays,
} from "@/lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PlatformBadge,
  Skeleton,
  StatusBadge,
} from "@/components/ui";

const RANGES = [
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
];

function DeltaChip({ value }) {
  const v = Number(value);
  if (value === null || value === undefined || !Number.isFinite(v)) return null;
  const up = v > 0;
  const down = v < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const color = up ? "#008300" : down ? "#e34948" : "#6b7280";
  const bg = up ? "bg-green-50" : down ? "bg-red-50" : "bg-gray-100";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${bg}`}
      style={{ color }}
      title="Perubahan vs periode sebelumnya"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      {`${up ? "+" : ""}${v.toFixed(1)}%`}
      <span className="sr-only">{up ? "naik" : down ? "turun" : "tetap"} dibanding periode sebelumnya</span>
    </span>
  );
}

function StatCard({ label, value, delta }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <p className="text-2xl font-bold text-gray-900 tabular-nums sm:text-3xl">{value}</p>
        <DeltaChip value={delta} />
      </div>
    </Card>
  );
}

// Formatted tooltip; all text stays in neutral ink, the dot carries the identity.
function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="mb-1.5 text-xs font-medium text-gray-500">{fmtDateShort(label)}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 py-0.5 text-sm">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span className="text-gray-500">{entry.name}</span>
          <span className="ml-auto pl-4 font-medium text-gray-900 tabular-nums">
            {money ? fmtMoney(entry.value) : fmtCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <div className="flex items-center gap-2 text-sm">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: entry.payload.fill }}
          aria-hidden="true"
        />
        <span className="text-gray-500">{entry.name}</span>
        <span className="ml-auto pl-4 font-medium text-gray-900 tabular-nums">
          {fmtMoney(entry.value)}
        </span>
      </div>
    </div>
  );
}

// Percent labels outside the donut, in neutral ink (never the series color).
const RADIAN = Math.PI / 180;
function renderDonutLabel({ cx, cy, midAngle, outerRadius, percent }) {
  if (!percent || percent < 0.02) return null;
  const r = outerRadius + 16;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#6b7280"
      fontSize={12}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

const legendText = (value) => (
  <span className="text-xs text-gray-500">{value}</span>
);

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState([]);
  const [byPlatform, setByPlatform] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { from, to } = rangeDays(days);
    const q = `from=${from}&to=${to}`;
    try {
      const [s, ts, bp, cs] = await Promise.all([
        api.get(`/api/metrics/summary?${q}`),
        api.get(`/api/metrics/timeseries?${q}&metric=spend`),
        api.get(`/api/metrics/by-platform?${q}`),
        api.get(`/api/campaigns`),
      ]);
      setSummary(s || null);
      setSeries(Array.isArray(ts) ? ts : []);
      setByPlatform(Array.isArray(bp) ? bp : []);
      setCampaigns(Array.isArray(cs) ? cs : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // Platforms that actually have spend in the period. Colors are NOT re-assigned:
  // each platform keeps its permanent hue regardless of which series are visible.
  const activePlatforms = useMemo(() => {
    const active = PLATFORM_ORDER.filter((p) =>
      series.some((row) => Number(row[p]) > 0)
    );
    return active.length > 0 ? active : PLATFORM_ORDER;
  }, [series]);

  const donutData = useMemo(
    () =>
      PLATFORM_ORDER.map((key) => {
        const row = byPlatform.find((r) => r.platform === key);
        return row
          ? { key, name: PLATFORMS[key].label, value: Number(row.spend) || 0 }
          : null;
      }).filter((r) => r && r.value > 0),
    [byPlatform]
  );

  const totalSpend = useMemo(
    () => donutData.reduce((acc, r) => acc + r.value, 0),
    [donutData]
  );

  const topCampaigns = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
        .slice(0, 5),
    [campaigns]
  );

  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      {/* Filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Performa iklan {days} hari terakhir vs periode sebelumnya.
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm" role="group" aria-label="Rentang tanggal">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                days === r.days
                  ? "bg-[#2a78d6] text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-32" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Spend"
            value={fmtMoney(summary && summary.spend)}
            delta={summary && summary.deltas ? summary.deltas.spend : null}
          />
          <StatCard
            label="Impressions"
            value={fmtCompact(summary && summary.impressions)}
            delta={summary && summary.deltas ? summary.deltas.impressions : null}
          />
          <StatCard
            label="Clicks"
            value={fmtCompact(summary && summary.clicks)}
            delta={summary && summary.deltas ? summary.deltas.clicks : null}
          />
          <StatCard
            label="Conversions"
            value={fmtCompact(summary && summary.conversions)}
            delta={summary && summary.deltas ? summary.deltas.conversions : null}
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Spend per Platform" subtitle="Pengeluaran harian per platform iklan" />
          <div className="px-4 py-4 sm:px-5">
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : series.length === 0 ? (
              <EmptyState
                title="Belum ada data metrik"
                hint="Jalankan sync di halaman Settings untuk menarik data dari platform iklan Anda."
              />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e7e5e0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDateShort}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtMoney(v)}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip content={<ChartTooltip money />} />
                  {activePlatforms.length > 1 ? (
                    <Legend formatter={legendText} iconType="circle" iconSize={8} />
                  ) : null}
                  {activePlatforms.map((p) => (
                    <Line
                      key={p}
                      type="monotone"
                      dataKey={p}
                      name={PLATFORMS[p].label}
                      stroke={PLATFORMS[p].color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Distribusi Spend" subtitle="Porsi pengeluaran per platform" />
          <div className="relative px-4 py-4 sm:px-5">
            {loading ? (
              <Skeleton className="mx-auto h-[300px] w-full" />
            ) : donutData.length === 0 ? (
              <EmptyState
                title="Belum ada spend tercatat"
                hint="Distribusi akan muncul setelah data metrik tersinkron."
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="46%"
                      innerRadius={58}
                      outerRadius={88}
                      stroke="#ffffff"
                      strokeWidth={2}
                      label={renderDonutLabel}
                      labelLine={false}
                      isAnimationActive={false}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.key} fill={PLATFORMS[entry.key].color} />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                    <Legend formatter={legendText} iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-x-0 top-[124px] text-center">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-lg font-bold text-gray-900 tabular-nums">
                    {fmtMoney(totalSpend)}
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Top campaigns */}
      <Card>
        <CardHeader
          title="Kampanye Teratas"
          subtitle="5 kampanye dengan spend tertinggi (agregat 30 hari)"
        />
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : topCampaigns.length === 0 ? (
          <EmptyState
            title="Belum ada kampanye"
            hint="Hubungkan akun iklan lalu jalankan sync untuk melihat kampanye di sini."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-3 font-medium">Nama</th>
                  <th className="px-5 py-3 font-medium">Platform</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Spend</th>
                  <th className="px-5 py-3 text-right font-medium">Clicks</th>
                  <th className="px-5 py-3 text-right font-medium">CTR</th>
                  <th className="px-5 py-3 text-right font-medium">CPC</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 transition hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-3.5"><PlatformBadge platform={c.platform} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtMoney(c.spend)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-900 tabular-nums">{fmtCompact(c.clicks)}</td>
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
