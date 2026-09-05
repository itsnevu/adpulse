"use client";

// Satu UI untuk semua tool: chat agent yang bisa membaca Meta Ads, Google Ads,
// scraping web, dan tool MCP eksternal (slot WhatsApp) lewat satu kotak input.
//
// Dua keputusan tampilan yang penting, bukan kosmetik:
//
// 1. JEJAK TOOL SELALU BISA DIBUKA. Setiap jawaban menyimpan tool apa yang
//    dipakai untuk menghasilkannya. Tanpa itu "AI bilang spend naik 30%" tidak
//    bisa ditelusuri, dan angka yang tidak bisa ditelusuri tidak layak dipakai
//    mengambil keputusan budget.
// 2. STATUS ARMADA DITAMPILKAN APA ADANYA. Kalau server MCP mati, user harus
//    tahu jawabannya dibuat tanpa tool itu — bukan mengira semuanya lengkap.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  Plug,
  Send,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import api from "@/lib/api";
import { Card, ErrorState } from "@/components/ui";
import Markdown from "@/components/Markdown";

const SUGGESTIONS = [
  "Gimana performa iklan 30 hari terakhir?",
  "Platform mana yang paling efisien buat konversi?",
  "Campaign mana yang paling boros tapi CTR-nya jelek?",
  "Cek riwayat sync — ada yang gagal?",
];

// Warna + label status armada MCP. Identitas tidak pernah dibawa warna saja:
// selalu ada teksnya, supaya terbaca juga tanpa membedakan warna.
const MCP_STATE = {
  up: { label: "MCP aktif", color: "#1baf7a" },
  empty: { label: "MCP kosong", color: "#9ca3af" },
  cold: { label: "MCP belum dinyalakan", color: "#9ca3af" },
  down: { label: "MCP mati", color: "#dc2626" },
};

function StatusChip({ health }) {
  if (!health) return null;
  const engine = health.engine || {};
  const mcp = MCP_STATE[health.mcp?.state] || MCP_STATE.cold;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-700">
        <Sparkles className="h-3 w-3 text-violet-500" aria-hidden="true" />
        {engine.configured ? `${engine.provider} · ${engine.model}` : "Engine belum diatur"}
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-700"
        title={health.mcp?.error || undefined}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: mcp.color }}
          aria-hidden="true"
        />
        {mcp.label}
        {health.mcp?.tools ? ` · ${health.mcp.tools} tool` : ""}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-700">
        <Wrench className="h-3 w-3 text-gray-400" aria-hidden="true" />
        {health.firstPartyTools} tool AdPulse
      </span>
    </div>
  );
}

// Jejak tool satu jawaban — tertutup secara default supaya tidak menutupi
// jawabannya sendiri, tapi selalu satu klik dari terbuka.
function ToolTrace({ calls }) {
  const [open, setOpen] = useState(false);
  if (!calls || !calls.length) return null;

  const failed = calls.filter((c) => c.failed).length;

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50"
      >
        <Wrench className="h-3 w-3" aria-hidden="true" />
        {calls.length} tool dipakai
        {failed ? ` · ${failed} gagal` : ""}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <ul className="mt-2 space-y-1">
          {calls.map((call, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs"
            >
              <code className="font-mono text-gray-800">{call.name}</code>
              <span className="text-gray-400">{call.source === "mcp" ? "MCP" : "AdPulse"}</span>
              {call.ms != null ? <span className="text-gray-400">{call.ms}ms</span> : null}
              {call.failed ? (
                <span className="font-medium text-red-600">gagal</span>
              ) : null}
              {call.args && Object.keys(call.args).length ? (
                <code className="w-full truncate font-mono text-[11px] text-gray-500">
                  {JSON.stringify(call.args)}
                </code>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Bubble({ message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#2a78d6] px-4 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3">
        {message.degraded ? (
          <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Dijawab saat sebagian tool eksternal sedang mati — jawaban ini mungkin tidak lengkap.
          </p>
        ) : null}
        <Markdown text={message.content} />
        <ToolTrace calls={message.tool_calls} />
      </div>
    </div>
  );
}

export default function AgentPage() {
  const [health, setHealth] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.get("/api/agent/conversations"));
    } catch {
      // Daftar percakapan gagal dimuat bukan alasan memblokir chat baru.
    }
  }, []);

  useEffect(() => {
    api
      .get("/api/agent/health")
      .then(setHealth)
      .catch(() => setHealth(null));
    loadConversations();
  }, [loadConversations]);

  // Gulir ke bawah setiap ada pesan baru — termasuk saat jawaban baru tiba.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function openConversation(id) {
    setActiveId(id);
    setLoadingThread(true);
    setError("");
    try {
      const data = await api.get(`/api/agent/conversations/${id}`);
      setMessages(data.messages || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingThread(false);
    }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setError("");
    inputRef.current?.focus();
  }

  async function removeConversation(id, event) {
    event.stopPropagation();
    try {
      await api.del(`/api/agent/conversations/${id}`);
      setConversations((list) => list.filter((c) => c.id !== id));
      if (activeId === id) newConversation();
    } catch (err) {
      setError(err.message);
    }
  }

  async function send(text) {
    const message = String(text ?? input).trim();
    if (!message || sending) return;

    setError("");
    setInput("");
    // Pesan user muncul langsung — menunggu roundtrip hanya untuk menampilkan
    // apa yang barusan diketik membuat UI terasa mati.
    const optimistic = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((list) => [...list, optimistic]);
    setSending(true);

    try {
      const data = await api.post("/api/agent/chat", {
        message,
        ...(activeId ? { conversation_id: activeId } : {}),
      });
      setMessages((list) => [
        ...list.filter((m) => m.id !== optimistic.id),
        data.user_message,
        data.message,
      ]);
      if (!activeId) {
        setActiveId(data.conversation_id);
        loadConversations();
      }
    } catch (err) {
      // Pertanyaannya dikembalikan ke kotak input supaya tidak hilang
      // hanya karena satu giliran gagal.
      setMessages((list) => list.filter((m) => m.id !== optimistic.id));
      setInput(message);
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event) {
    // Enter mengirim, Shift+Enter baris baru — kebiasaan yang sudah dipegang
    // orang dari aplikasi chat lain.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const engineOff = health && health.engine && !health.engine.configured;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI Assistant</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tanya apa saja soal performa iklanmu. Agent membaca data AdPulse, Google Ads,
            Meta Ads, dan halaman web lewat tool — bukan dari ingatan.
          </p>
        </div>
        <StatusChip health={health} />
      </header>

      {engineOff ? (
        <Card className="border-amber-200 bg-amber-50 px-5 py-4">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Engine AI belum dikonfigurasi. Isi <code className="font-mono">ANTHROPIC_API_KEY</code>,
              atau <code className="font-mono">AGENT_ENGINE_URL</code> +{" "}
              <code className="font-mono">AGENT_ENGINE_KEY</code> +{" "}
              <code className="font-mono">AGENT_ENGINE_MODEL</code> untuk memakai endpoint
              OpenAI-compatible seperti OpenRouter.
            </span>
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Daftar percakapan */}
        <Card className="hidden h-fit lg:block">
          <div className="border-b border-gray-100 p-3">
            <button
              type="button"
              onClick={newConversation}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2a78d6] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#2569bb]"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              Percakapan baru
            </button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <li className="px-2 py-3 text-xs text-gray-400">Belum ada percakapan.</li>
            ) : (
              conversations.map((conversation) => (
                // Tombol hapus adalah SAUDARA tombol percakapan, bukan anaknya:
                // elemen interaktif bersarang itu HTML tidak sah, tidak bisa
                // dicapai keyboard dengan benar, dan satu klik bisa memicu dua
                // aksi sekaligus (buka + hapus).
                <li
                  key={conversation.id}
                  className={`group flex items-center gap-1 rounded-lg transition ${
                    activeId === conversation.id ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    aria-current={activeId === conversation.id ? "true" : undefined}
                    className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-xs transition ${
                      activeId === conversation.id ? "text-[#1f5ea8]" : "text-gray-600"
                    }`}
                  >
                    {conversation.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus percakapan ${conversation.title}`}
                    onClick={(e) => removeConversation(conversation.id, e)}
                    className="mr-1 shrink-0 rounded p-1 text-gray-300 opacity-0 transition hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#2a78d6]/30 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </Card>

        {/* Area chat */}
        <Card className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
            {loadingThread ? (
              <p className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Memuat percakapan...
              </p>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Plug className="h-8 w-8 text-gray-300" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Mulai dari sini</p>
                  <p className="mt-1 max-w-sm text-xs text-gray-500">
                    Agent akan memanggil tool untuk menjawab, dan tool apa yang dipakai
                    selalu bisa kamu lihat di bawah tiap jawaban.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:border-[#2a78d6] hover:text-[#2a78d6]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => <Bubble key={message.id} message={message} />)
            )}

            {sending ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Memanggil tool dan menyusun jawaban...
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="border-t border-gray-100 px-4 py-2">
              <ErrorState message={error} />
            </div>
          ) : null}

          <div className="border-t border-gray-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={8000}
                placeholder="Tanya soal performa iklan, minta sync, atau kirim URL untuk dibaca..."
                aria-label="Pesan untuk AI Assistant"
                className="min-h-[44px] flex-1 resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/20"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={sending || !input.trim()}
                className="flex h-[44px] items-center gap-2 rounded-lg bg-[#2a78d6] px-4 text-sm font-medium text-white transition hover:bg-[#2569bb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Kirim
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              Enter kirim · Shift+Enter baris baru
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
