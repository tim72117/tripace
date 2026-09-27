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

// One row of the "Google photo target=0 check" (GET /admin/api/
// photo-target-zero-check). Mirrors store.PlaceDetailsZeroPhotoTarget on
// the backend (server/internal/store/geocache.go) — every place_details_
// cache row where google_photo_target_count is exactly 0 right now. This
// value is ambiguous on its own: it's the legitimate steady state for "we
// confirmed with Google and this place genuinely has no photos", but it's
// also exactly what a since-fixed deadlock bug (see
// shouldAddGooglePlacePhoto on the backend) used to leave behind for
// places that were NEVER actually confirmed. There's no way to tell the
// two apart from the stored value alone — this list exists so an operator
// can spot-check entries (e.g. look the place up on Google Maps) and, if a
// row turns out to be a stale pre-fix artifact, fix it by hand (the admin
// console doesn't expose a "reset" action here on purpose — see the
// GeoPhotoTargetZeroCheckTab component comment).
export interface PlaceDetailsZeroPhotoTarget {
  placeId: string
  name: string
  clickCount: number
  // googlePhotoTargetCount: this list is already filtered to rows where
  // this value is exactly 0 (see the backend query), so it's redundant
  // information in principle — included anyway so the table shows exactly
  // what the database currently holds rather than requiring the reader to
  // infer it from "why this row is on this list" (2026-09 added).
  googlePhotoTargetCount: number
  fetchedAt: string
}

export interface PhotoTargetZeroCheckResponse {
  places: PlaceDetailsZeroPhotoTarget[]
}

// One row of the "attractions missing Google Place ID" check (GET
// /admin/api/attraction-missing-place-id-check). Mirrors
// adminconsole.attractionMissingPlaceIDRow on the backend — every
// attractions row where place_id is NULL or empty. photo_url is no longer
// a valid photo source for the theme card (the fallback was explicitly
// removed — see AttractionInfoPanel.tsx), so every row here shows a
// placeholder on the theme card regardless of hasStalePhotoUrl. That field
// only tells the operator whether the row still carries a stale, unused
// snapshot in the database (true) or nothing at all (false) — it is not a
// signal that the row is "fine as-is". The fix for any row here is adding
// the correct Google Place ID, not restoring the photo_url fallback.
export interface AttractionMissingPlaceID {
  id: string
  name: string
  cityName: string
  isTheme: boolean
  hasStalePhotoUrl: boolean
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

  // Pure read of place_details_cache — no external call, safe to call on
  // page load / manual refresh.
  photoTargetZeroCheck: (): Promise<PhotoTargetZeroCheckResponse> =>
    request('GET', '/admin/api/photo-target-zero-check').then((r) => r.json()),

  // Resets one place's google_photo_target_count back to the -1 sentinel
  // (see the backend handler's doc comment) — only meant to be called
  // after an operator has manually confirmed a row on the target=0 list
  // is a stale pre-fix artifact, not something to automate from the list
  // alone.
  resetPhotoTarget: (placeId: string): Promise<{ ok: boolean }> =>
    request('POST', '/admin/api/photo-target-zero-check/reset', { placeId }).then((r) => r.json()),

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
}
