// Client for the backend's /admin/api/* endpoints (server/internal/
// adminconsole). Auth is no longer a separate admin session system — it
// consumes the SAME JWT as the regular user system (signed by the one
// internal/auth.Signer shared with /v1, /internal), gated by an email
// allowlist (ADMIN_BOOTSTRAP_EMAIL) checked server-side. This client stores
// that JWT in localStorage (TOKEN_STORAGE_KEY below) and sends it as
// `Authorization: Bearer <token>` on every call — no cookies, no
// credentials: 'include'. A 401 means the token is missing/expired/invalid,
// or the signed-in user's email isn't on the allowlist; callers drop back
// to the login screen either way (this client can't tell those apart, by
// design — see the backend's withAdmin fail-closed behavior).

const TOKEN_STORAGE_KEY = 'tripace_admin_token'

// getToken/setToken/clearToken wrap localStorage access in try/catch —
// some environments (private browsing, blocked site data) can throw on
// access, and this is a per-browser convenience store, not a reliable one;
// a missing/unreadable token just means "show the login screen".
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // Best-effort — if storage is unavailable, the user will just be asked
    // to log in again on next load.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // no-op, see setToken's comment
  }
}

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

// One table's struct-vs-database comparison. Mirrors store.SchemaCheck on
// the backend (server/internal/store/schema_check.go). GORM's AutoMigrate
// only ever adds missing columns — it never renames or drops a column, and
// never changes an existing table's primary key. So a field rename in a Go
// struct (e.g. photoRef -> placeID) leaves the database with BOTH the old
// and new column, and the primary key still pointing at the old one. This
// check surfaces that drift instead of leaving it to be found by accident.
export interface SchemaCheck {
  table: string
  missingColumns?: string[]
  extraColumns?: string[]
  primaryKeyMismatch?: { expected: string[]; actual: string[] }
  ok: boolean
}

export interface SchemaCheckResponse {
  ok: boolean
  tables: SchemaCheck[]
  // Tables that exist in the database but have no matching Go struct
  // (store.OrphanTables) — e.g. a table whose struct was deleted but whose
  // DROP TABLE never ran. AutoMigrate only creates tables, never drops
  // them, and the per-table check above starts from the structs, so these
  // can't show up there.
  orphanTables: string[]
}

// One row of the Google Places API rate limit config. Mirrors
// store.GeoRateLimit on the backend (server/internal/store/
// geo_rate_limits.go) — one row per endpoint key ("places.get" /
// "places.photoMedia"). windowSec/maxCalls are the rejecting rate limiter's
// fixed window (server/internal/apigateway/ratelimiter.go); dailyMax is a
// separate DB-backed atomic counter that's shared across every server
// instance (0 means unlimited). usedToday/usedDay reflect today's usage so
// far — read-only, not editable from this form.
export interface GeoRateLimit {
  endpoint: string
  windowSec: number
  maxCalls: number
  dailyMax: number
  usedToday: number
  usedDay: string
}

export interface GeoRateLimitsResponse {
  limits: GeoRateLimit[]
}

// One row of the "attractions missing Google Place ID" check (GET
// /admin/api/attraction-missing-place-id-check). Mirrors
// adminconsole.attractionMissingPlaceIDRow on the backend — every
// attractions row where place_id is NULL or empty. Every row here shows a
// placeholder on the theme card (2026-10: the attractions.photo_url
// compat field — and the database column itself — has been fully removed,
// see cmd/migrate-drop-photo-url). The fix for any row here is adding the
// correct Google Place ID.
export interface AttractionMissingPlaceID {
  id: string
  name: string
  cityName: string
  isTheme: boolean
}

export interface AttractionMissingPlaceIDResponse {
  attractions: AttractionMissingPlaceID[]
}

// Response of POST /admin/api/attraction-missing-place-id-check/refetch.
// Mirrors adminconsole.refetchAttractionPlaceIDResponse — matchedName/
// matchedAddress are what Google actually returned for the first search
// candidate, not this attraction's own name/cityName from the database.
// The operator should eyeball these against the row before trusting the
// write — this endpoint does no name/address similarity check itself.
export interface RefetchAttractionPlaceIDResponse {
  id: string
  placeId: string
  matchedName: string
  matchedAddress: string
}

// One row of the AI 規劃對話訊息記錄(GET /admin/api/plan-ai-chat-logs)。
// Mirrors adminconsole.planAiChatLogEntry on the backend (server/internal/
// adminconsole/plan_ai_chat_logs.go) — every message across every user's
// /trip-plan AI 規劃對話, newest first. userEmail is looked up server-side
// via Store.ListUsers() and may be an empty string if the user account no
// longer exists; the UI falls back to showing userID in that case.
export interface PlanAiChatLogEntry {
  id: number
  userID: string
  userEmail: string
  conversationID: string
  role: 'user' | 'assistant' | string
  content: string
  createdAt: string
}

export interface PlanAiChatLogsResponse {
  total: number
  messages: PlanAiChatLogEntry[]
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
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${BASE}. Is it running?`)
  }
  if (!res.ok) {
    // Error bodies are now structured JSON — { error: { code, message } } —
    // mirroring internal/api's writeErr shape (see server/internal/
    // adminconsole/adminconsole.go's own writeErr, added so this package's
    // error responses match internal/api's convention instead of the
    // plain-text http.Error bodies this used to send). Parse defensively:
    // fall back to raw text / statusText if the body isn't valid JSON or
    // doesn't have the expected shape, so a malformed/legacy error body
    // still surfaces *something* readable instead of throwing here.
    const text = (await res.text()).trim()
    let message = text || res.statusText
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } }
        if (parsed?.error?.message) {
          message = parsed.error.message
        }
      } catch {
        // Not JSON — keep the raw text as the message (e.g. an upstream
        // proxy error page, or a future endpoint that hasn't adopted the
        // structured shape yet).
      }
    }
    throw new ApiError(res.status, message)
  }
  return res
}

// loginResponse mirrors the relevant subset of model.Me's JSON shape
// returned by POST /v1/auth/login (server/internal/api/auth.go
// handleLogin -> issueToken) — { token, user, profile, isNewUser }. This
// admin console only needs the token (to store) and the profile's email
// (to display); it ignores the rest.
interface loginResponse {
  token: string
  profile: { email: string }
}

export const api = {
  // Logs in through the SAME general-user endpoint as the main app
  // (POST /v1/auth/login, not an admin-specific one — there is no admin-
  // specific login anymore). Any registered user can authenticate this
  // way; whether they can actually use the admin console afterwards is
  // decided server-side per call, by the ADMIN_BOOTSTRAP_EMAIL allowlist
  // check inside withAdmin — a successful login here does not by itself
  // mean admin access.
  login: async (email: string, password: string): Promise<AdminUser> => {
    const res = await request('POST', '/v1/auth/login', { email, password })
    const body: loginResponse = await res.json()
    setToken(body.token)
    return { email: body.profile.email }
  },

  logout: (): void => {
    clearToken()
  },

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

  // Read-only comparison query (information_schema / pragma table_info under
  // the hood via GORM's Migrator) — no schema is modified by calling this,
  // safe to call on page load / manual refresh.
  checkSchema: (): Promise<SchemaCheckResponse> =>
    request('GET', '/admin/api/schema-check').then((r) => r.json()),

  // Reads geo_rate_limits — whatever is currently stored, not necessarily
  // what's actively enforced this instant: cmd/server applies this table to
  // the in-memory rate limiter on a background refresh loop (~45s period,
  // see server/cmd/server/geo_rate_limit.go), so an edit here can take up
  // to that long to actually take effect server-side.
  geoRateLimits: (): Promise<GeoRateLimitsResponse> =>
    request('GET', '/admin/api/geo-rate-limits').then((r) => r.json()),

  // Upserts a single endpoint's rule. windowSec/maxCalls must be positive
  // integers (the backend rejects <=0 — see updateGeoRateLimit's comment on
  // the server: 0/negative there means "remove this limit", which this form
  // doesn't expose). dailyMax may be 0 (means "no daily cap"). Returns the
  // full updated list so the table can just replace its state with the
  // response instead of re-fetching.
  updateGeoRateLimit: (limit: { endpoint: string; windowSec: number; maxCalls: number; dailyMax: number }): Promise<GeoRateLimitsResponse> =>
    request('PUT', '/admin/api/geo-rate-limits', limit).then((r) => r.json()),

  // Pure read of the attractions table — no external call, safe to call on
  // page load / manual refresh.
  attractionMissingPlaceIDCheck: (): Promise<AttractionMissingPlaceIDResponse> =>
    request('GET', '/admin/api/attraction-missing-place-id-check').then((r) => r.json()),

  // Real external call — hits Google Places Text Search once per click,
  // then writes the first candidate's place_id straight to the database.
  // Only call this on explicit operator action (the "Refetch" button),
  // never automatically — see the backend handler's doc comment on why
  // there's no automatic name/address matching.
  refetchAttractionPlaceID: (id: string): Promise<RefetchAttractionPlaceIDResponse> =>
    request('POST', '/admin/api/attraction-missing-place-id-check/refetch', { id }).then((r) => r.json()),

  // Reads from plan_ai_chat_messages (server/internal/store/plan_ai_chat.go
  // writes one row per user/assistant message in /trip-plan's AI 規劃對話)
  // — pure read, no external call. limit defaults to the backend's own
  // default (200, see listPlanAiChatLogs's comment) when omitted.
  listPlanAiChatLogs: (limit?: number): Promise<PlanAiChatLogsResponse> =>
    request('GET', `/admin/api/plan-ai-chat-logs${limit ? `?limit=${limit}` : ''}`).then((r) => r.json()),
}
