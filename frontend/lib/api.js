// Fetch wrapper for the AdPulse backend API (v1.1 hardening).
// - Base URL from NEXT_PUBLIC_API_URL (default http://localhost:4000)
// - Adds Authorization: Bearer <token> from localStorage ("adpulse_token")
// - /api/auth/* requests are sent with credentials:"include" so the httpOnly
//   refresh cookie (adpulse_rt) travels along
// - Unwraps the { data } / { error: { message } } envelope
// - Throws Error(message) on failure
// - 401 interceptor: for refresh-eligible requests it calls POST /api/auth/refresh
//   ONCE (concurrent 401s share a single in-flight refresh), stores the new access
//   token and replays the original request. If the refresh fails the token is
//   cleared and the browser is redirected to /login.

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "adpulse_token";

// Auth mutation endpoints that must NEVER trigger the refresh flow themselves
// (a 401 here means "wrong credentials" / "invalid token", not "access token expired").
const NO_REFRESH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/forgot",
  "/api/auth/reset",
]);

function isAuthEndpoint(path) {
  return path.startsWith("/api/auth/");
}

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
  return (
    p.startsWith("/login") ||
    p.startsWith("/register") ||
    p.startsWith("/forgot-password") ||
    p.startsWith("/reset-password")
  );
}

function handleSessionExpired() {
  clearToken();
  if (typeof window !== "undefined" && !isAuthPage()) {
    window.location.href = "/login";
  }
}

// Shared in-flight refresh: if several requests hit 401 at the same time they all
// await the SAME refresh call (the refresh token is single-use — parallel refreshes
// would revoke each other). Resolves true on success, false on failure.
let refreshPromise = null;

function refreshAccessToken() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        let json = null;
        try {
          json = await res.json();
        } catch {
          return false;
        }
        const token = json && json.data && json.data.token;
        if (!token) return false;
        setToken(token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, { method = "GET", body, _retried = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      // Auth endpoints carry the httpOnly refresh cookie.
      credentials: isAuthEndpoint(path) ? "include" : "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Tidak dapat terhubung ke server. Pastikan backend AdPulse berjalan.");
  }

  // 401 interceptor — only for requests that are allowed to be refreshed.
  if (res.status === 401 && !NO_REFRESH_PATHS.has(path)) {
    if (!_retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Replay the original request exactly once (per-request flag stops loops).
        return request(path, { method, body, _retried: true });
      }
    }
    handleSessionExpired();
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
