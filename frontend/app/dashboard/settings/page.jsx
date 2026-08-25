"use client";

// Settings: connected ad accounts, add-account form, automation schedule info,
// per-platform manual sync, and the sync history table.
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import { PLATFORMS, fmtCompact, fmtDateTime } from "@/lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PlatformBadge,
  Skeleton,
  StatusBadge,
} from "@/components/ui";

const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/20";

const SYNCABLE_PLATFORMS = ["google", "meta"];

export default function SettingsPage() {
  // Connected accounts
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");

  // Add-account form
  const [form, setForm] = useState({ platform: "google", external_id: "", name: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  // Sync
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState("");
  const [syncing, setSyncing] = useState(null); // platform currently syncing
  const [syncMessage, setSyncMessage] = useState(null); // { type: "ok"|"error", text }

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const data = await api.get("/api/accounts");
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      setAccountsError(err.message);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const data = await api.get("/api/sync/logs");
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setLogsError(err.message);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadLogs();
  }, [loadAccounts, loadLogs]);

  async function submitAccount(e) {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    setSaving(true);
    try {
      await api.post("/api/accounts", {
        platform: form.platform,
        external_id: form.external_id.trim(),
        name: form.name.trim(),
      });
      setFormSuccess("Akun iklan berhasil ditambahkan.");
      setForm({ platform: "google", external_id: "", name: "" });
      await loadAccounts();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function syncNow(platform) {
    setSyncing(platform);
    setSyncMessage(null);
    try {
      const log = await api.post(`/api/sync/${platform}`);
      const n = log && log.records_synced !== undefined ? log.records_synced : 0;
      setSyncMessage({
        type: "ok",
        text: `Sync ${PLATFORMS[platform].label} selesai — ${fmtCompact(n)} record diproses.`,
      });
      await loadLogs();
      await loadAccounts();
    } catch (err) {
      setSyncMessage({ type: "error", text: err.message });
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Connected accounts */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Akun Iklan Terhubung"
            subtitle="Sumber data yang disinkronkan ke AdPulse"
          />
          {accountsError ? (
            <div className="p-5">
              <ErrorState message={accountsError} onRetry={loadAccounts} />
            </div>
          ) : accountsLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <EmptyState
              title="Belum ada akun terhubung"
              hint="Tambahkan akun Google Ads atau Meta Ads melalui form di samping untuk mulai menarik data."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {accounts.map((acc) => (
                <li key={acc.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{acc.name}</p>
                    <p className="text-xs text-gray-500">
                      ID: {acc.external_id} · {acc.currency || "USD"}
                    </p>
                  </div>
                  <PlatformBadge platform={acc.platform} />
                  <StatusBadge status={acc.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Add account */}
        <Card>
          <CardHeader title="Tambah Akun" subtitle="Hubungkan akun iklan baru" />
          <form onSubmit={submitAccount} className="space-y-4 p-5">
            {formError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {formError}
              </div>
            ) : null}
            {formSuccess ? (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700" role="status">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {formSuccess}
              </div>
            ) : null}
            <div>
              <label htmlFor="acc-platform" className="mb-1.5 block text-sm font-medium text-gray-700">
                Platform
              </label>
              <select
                id="acc-platform"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className={inputCls}
              >
                <option value="google">Google Ads</option>
                <option value="meta">Meta Ads</option>
              </select>
            </div>
            <div>
              <label htmlFor="acc-external" className="mb-1.5 block text-sm font-medium text-gray-700">
                ID Akun (external ID)
              </label>
              <input
                id="acc-external"
                type="text"
                required
                value={form.external_id}
                onChange={(e) => setForm({ ...form, external_id: e.target.value })}
                placeholder={form.platform === "google" ? "123-456-7890" : "act_1234567890"}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="acc-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                Nama akun
              </label>
              <input
                id="acc-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mis. Brand Utama — Google"
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2a78d6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2265b8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Menyimpan..." : "Tambah Akun"}
            </button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Automation schedule */}
        <Card>
          <CardHeader title="Jadwal Otomatis" subtitle="Berjalan di server tanpa campur tangan" />
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2a78d6]/10 text-[#2a78d6]">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Sync data setiap 4 jam</p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                  Metrik kampanye ditarik otomatis dari semua akun terhubung — Anda juga bisa
                  memicu sync manual di bawah.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                <Mail className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Email insight setiap 12:00</p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                  Ringkasan + rekomendasi AI dari data terbaru dikirim ke email Anda setiap
                  siang.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3">
              <p className="flex items-center gap-2 text-xs text-gray-500">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Semua jadwal mengikuti zona waktu server.
              </p>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="mb-3 text-sm font-medium text-gray-900">Sync Sekarang</p>
              {syncMessage ? (
                <div
                  className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                    syncMessage.type === "ok"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}
                  role="status"
                >
                  {syncMessage.type === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  {syncMessage.text}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                {SYNCABLE_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => syncNow(p)}
                    disabled={syncing !== null}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm transition hover:border-[#2a78d6]/60 hover:text-[#2a78d6] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {syncing === p ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PLATFORMS[p].color }}
                      aria-hidden="true"
                    />
                    {syncing === p ? `Sync ${PLATFORMS[p].label}...` : `Sync ${PLATFORMS[p].label}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Sync history */}
        <Card className="xl:col-span-2">
          <CardHeader title="Riwayat Sync" subtitle="50 proses sinkronisasi terakhir" />
          {logsError ? (
            <div className="p-5">
              <ErrorState message={logsError} onRetry={loadLogs} />
            </div>
          ) : logsLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title="Belum ada riwayat sync"
              hint='Klik "Sync Sekarang" untuk menjalankan sinkronisasi pertama.'
            />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-5 py-3 font-medium">Platform</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Records</th>
                    <th className="px-5 py-3 font-medium">Mulai</th>
                    <th className="px-5 py-3 font-medium">Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 transition hover:bg-gray-50/60">
                      <td className="px-5 py-3"><PlatformBadge platform={log.platform} /></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={log.status} />
                          {log.error ? (
                            <span className="max-w-[220px] truncate text-xs text-red-600" title={log.error}>
                              {log.error}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-900 tabular-nums">
                        {fmtCompact(log.records_synced)}
                      </td>
                      <td className="px-5 py-3 text-gray-500">{fmtDateTime(log.started_at)}</td>
                      <td className="px-5 py-3 text-gray-500">{fmtDateTime(log.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
