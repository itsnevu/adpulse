"use client";

// AI Insights: generate a new insight for the last 7 days, list existing insights
// with their summaries and impact-tagged recommendations.
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import api from "@/lib/api";
import { fmtDateLong, fmtDateTime, rangeDays } from "@/lib/format";
import {
  Card,
  EmptyState,
  ErrorState,
  ImpactBadge,
  Skeleton,
} from "@/components/ui";

// recommendations is JSONB [{title, detail, impact}] — be tolerant of a string payload.
function parseRecommendations(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function InsightCard({ insight }) {
  const recs = parseRecommendations(insight.recommendations);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">
          Periode {fmtDateLong(insight.period_start)} – {fmtDateLong(insight.period_end)}
        </p>
        <p className="text-xs text-gray-500">
          Dibuat {fmtDateTime(insight.created_at)}
          {insight.model ? ` · ${insight.model}` : ""}
        </p>
      </div>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-700">
        {insight.summary}
      </p>
      {recs.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Rekomendasi
          </p>
          {recs.map((rec, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-gray-50/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{rec.title}</p>
                <ImpactBadge impact={rec.impact} />
              </div>
              {rec.detail ? (
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{rec.detail}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export default function InsightsPage() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/insights");
      setInsights(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setGenError("");
    try {
      const { from, to } = rangeDays(7);
      await api.post("/api/insights/generate", { from, to });
      await load();
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            Analisis performa iklan oleh AI — otomatis setiap hari pukul 12:00, atau buat
            sekarang untuk 7 hari terakhir.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2a78d6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2265b8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          )}
          {generating ? "Menganalisis data..." : "Generate Insight Sekarang"}
        </button>
      </div>

      {genError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {genError}
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Card key={i} className="p-6">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="mt-3 h-16 w-full" />
              <Skeleton className="mt-3 h-20 w-full" />
            </Card>
          ))}
        </div>
      ) : insights.length === 0 ? (
        <Card>
          <EmptyState
            title="Belum ada insight"
            hint='Klik "Generate Insight Sekarang" untuk membuat analisis AI pertama dari data 7 hari terakhir Anda.'
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {insights.map((ins) => (
            <InsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      )}
    </div>
  );
}
