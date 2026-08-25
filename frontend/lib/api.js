// Fetch wrapper for the AdPulse backend API.
// - Base URL from NEXT_PUBLIC_API_URL (default http://localhost:4000)
// - Adds Authorization: Bearer <token> from localStorage ("adpulse_token")
// - Unwraps the { data } / { error: { message } } envelope
// - Throws Error(message) on failure
// - On 401 outside the auth pages: clears the token and redirects to /login

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "adpulse_token";

export function getToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode) — the session just won't persist.
  }
}

export function clearToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function isAuthPage() {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p.startsWith("/login") || p.startsWith("/register");
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Tidak dapat terhubung ke server. Pastikan backend AdPulse berjalan.");
  }

  if (res.status === 401 && !isAuthPage()) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Sesi berakhir. Silakan masuk kembali.");
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body — fall through to the status check below.
  }

  if (!res.ok) {
    const message =
      json && json.error && json.error.message
        ? json.error.message
        : `Permintaan gagal (HTTP ${res.status})`;
    throw new Error(message);
  }

  return json ? json.data : null;
}

const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
};

export default api;
