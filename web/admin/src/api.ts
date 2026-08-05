// Client for the backend's /admin/api/* endpoints (server/internal/
// adminconsole). Auth is a SEPARATE session cookie from the regular user
// system (server/internal/adminauth, cookie "admin_session"): every call
// sends credentials: 'include', and the backend's CORS layer echoes the
// request Origin for /admin/* (cmd/server/main.go withAdminCORS) so a
// credentialed cross-origin response is accepted. A 401 means the admin
// session is missing/expired; callers drop back to the login screen.

export interface AdminUser {
  email: string
}

// One row of the user table. Mirrors model.AdminUserSummary on the backend.
// Plan/quota/usage are intentionally out of scope for this admin console —
// the backend only exposes basic identity fields.
export interface UserSummary {
  id: string
  email: string
  name: string
  avatarColor: string
}

export interface UsersResponse {
  total: number
  users: UserSummary[]
}

// One row of the external-service health check. Mirrors
// adminconsole.ExternalServiceStatus on the backend (server/internal/
// adminconsole/health.go). status is "ok" | "error" | "skipped" — skipped
// means the corresponding env var isn't set on this deployment (e.g. no
// GOOGLE_API_KEY in local dev), not a failure.
export interface ExternalServiceStatus {
  name: string
  kind: string
  status: 'ok' | 'error' | 'skipped'
  latencyMs: number
  detail: string
}

// One row of the per-endpoint request stats table. Mirrors
// store.PathRequestStats on the backend (server/internal/store/geocache.go).
export interface PathRequestStats {
  method: string
  path: string
  count: number
  avgDurationMs: number
  errorCount: number
}

// One point of a request-volume-over-time chart. Mirrors
// store.TimelineBucket on the backend — bucketStart is the hour this
// point covers (ISO 8601 string, hour-truncated UTC), count/errorCount
// are how many requests/errors fell in that hour. Hours with zero
// requests are simply absent from the array (the backend only emits
// buckets that have data).
export interface TimelineBucket {
  bucketStart: string
  count: number
  errorCount: number
}

export interface RequestStatsResponse {
  sinceHours: number
  total: number
  errorCount: number
  paths: PathRequestStats[]
  timeline: TimelineBucket[]
}

// One row of the outbound Google Places/Geocoding API call stats table.
// Mirrors store.GeoAPICallStats on the backend (server/internal/store/
// geocache.go) — the counterpart to PathRequestStats above: that one is
// inbound (someone calling into our server), this one is outbound (our
// server calling Google). endpoint is a fixed logical name inside the geo
// package (e.g. "places.searchNearby", "geocode"), caller is the code
// location that triggered it (e.g. "handleGeoDistrictsNearby"), and path
// is the REST route that triggered it (empty for LLM tool calls with no
// single corresponding route).
export interface GeoAPICallStats {
  endpoint: string
  caller: string
  path: string
  count: number
  avgDurationMs: number
  errorCount: number
}

export interface GeoAPIStatsResponse {
  sinceHours: number
  calls: GeoAPICallStats[]
  timeline: TimelineBucket[]
}

// Same resolution strategy as the main web app's api.ts BASE: an explicit
// VITE_ADMIN_API_URL for local dev against a separately-running backend,
// falling back to the serving origin (correct in production, where the
// admin SPA is embedded same-origin under /admin).
export const BASE: string = import.meta.env.VITE_ADMIN_API_URL ?? window.location.origin

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${BASE}. Is it running?`)
  }
  if (!res.ok) {
    const text = (await res.text()).trim()
    throw new ApiError(res.status, text || res.statusText)
  }
  return res
}

export const api = {
  login: (email: string, password: string): Promise<AdminUser> =>
    request('POST', '/admin/api/login', { email, password }).then((r) => r.json()),

  logout: (): Promise<void> => request('POST', '/admin/api/logout').then(() => undefined),

  me: (): Promise<AdminUser> => request('GET', '/admin/api/me').then((r) => r.json()),

  listUsers: (): Promise<UsersResponse> => request('GET', '/admin/api/users').then((r) => r.json()),

  // Triggers a fresh round of checks server-side each call (no caching) —
  // only call this on explicit user action (page load / "recheck" click),
  // never on a timer: some checks (Places API) incur a small real cost.
  checkExternalHealth: (): Promise<ExternalServiceStatus[]> =>
    request('GET', '/admin/api/health/external').then((r) => r.json()),

  // Reads from api_request_logs (server/internal/api/middleware.go's
  // requestLogging writes one row per request, no external calls here) —
  // safe to call on page load / manual refresh, no real-world cost.
  requestStats: (hours: number): Promise<RequestStatsResponse> =>
    request('GET', `/admin/api/request-stats?hours=${hours}`).then((r) => r.json()),

  // Reads from geo_api_call_logs (server/internal/apigateway's CallLogger
  // writes one row per outbound Google Places/Geocoding call) — like
  // requestStats, this is a pure read of already-logged data, no new
  // outbound call is triggered by viewing this page.
  geoAPIStats: (hours: number): Promise<GeoAPIStatsResponse> =>
    request('GET', `/admin/api/geo-api-stats?hours=${hours}`).then((r) => r.json()),
}
