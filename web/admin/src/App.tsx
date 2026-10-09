import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { AttractionMissingPlaceID, ExternalServiceStatus, GeoAPICallStats, GeoRateLimit, PathRequestStats, PlanAiChatLogEntry, RefetchAttractionPlaceIDResponse, SchemaCheck, TimelineBucket, UserSummary } from './api'
import { TimelineChart } from './TimelineChart'

export default function App() {
  const [me, setMe] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // On load, see if an admin session cookie is already valid — skips the
  // login screen on refresh. A 401 just means "show login", not an error.
  useEffect(() => {
    api
      .me()
      .then((u) => setMe(u.email))
      .catch(() => setMe(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="center muted">Loading…</div>
  if (!me) return <Login onLoggedIn={setMe} />
  return <Dashboard adminEmail={me} onLoggedOut={() => setMe(null)} />
}

function Login({ onLoggedIn }: { onLoggedIn: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const u = await api.login(email, password)
      onLoggedIn(u.email)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Tripace admin</h1>
        <p className="muted">Operator sign-in. Separate from developer accounts.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

type Tab = 'users' | 'external' | 'requests' | 'geo-api' | 'geo-rate-limits' | 'attraction-missing-place-id' | 'schema' | 'plan-ai-chat-logs'

function Dashboard({ adminEmail, onLoggedOut }: { adminEmail: string; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('users')

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      onLoggedOut()
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Tripace admin</h1>
          <span className="muted">{adminEmail}</span>
        </div>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <nav className="tabs">
        <button className={tab === 'users' ? 'tab active' : 'tab'} onClick={() => setTab('users')}>
          Users
        </button>
        <button className={tab === 'external' ? 'tab active' : 'tab'} onClick={() => setTab('external')}>
          External services
        </button>
        <button className={tab === 'requests' ? 'tab active' : 'tab'} onClick={() => setTab('requests')}>
          Request stats
        </button>
        <button className={tab === 'geo-api' ? 'tab active' : 'tab'} onClick={() => setTab('geo-api')}>
          Google API calls
        </button>
        <button className={tab === 'geo-rate-limits' ? 'tab active' : 'tab'} onClick={() => setTab('geo-rate-limits')}>
          Google API rate limits
        </button>
        <button className={tab === 'attraction-missing-place-id' ? 'tab active' : 'tab'} onClick={() => setTab('attraction-missing-place-id')}>
          Attractions missing place_id
        </button>
        <button className={tab === 'schema' ? 'tab active' : 'tab'} onClick={() => setTab('schema')}>
          Schema check
        </button>
        <button className={tab === 'plan-ai-chat-logs' ? 'tab active' : 'tab'} onClick={() => setTab('plan-ai-chat-logs')}>
          AI 規劃對話
        </button>
      </nav>

      {tab === 'users' && <UsersTab onLoggedOut={onLoggedOut} />}
      {tab === 'external' && <ExternalServicesTab onLoggedOut={onLoggedOut} />}
      {tab === 'requests' && <RequestStatsTab onLoggedOut={onLoggedOut} />}
      {tab === 'geo-api' && <GeoAPIStatsTab onLoggedOut={onLoggedOut} />}
      {tab === 'geo-rate-limits' && <GeoRateLimitsTab onLoggedOut={onLoggedOut} />}
      {tab === 'attraction-missing-place-id' && <AttractionMissingPlaceIDTab onLoggedOut={onLoggedOut} />}
      {tab === 'schema' && <SchemaCheckTab onLoggedOut={onLoggedOut} />}
      {tab === 'plan-ai-chat-logs' && <PlanAiChatLogsTab onLoggedOut={onLoggedOut} />}
    </div>
  )
}

function UsersTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [total, setTotal] = useState<number | null>(null)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const usersRes = await api.listUsers()
      setTotal(usersRes.total)
      setUsers(usersRes.users)
    } catch (err) {
      // A 401 here means the session expired mid-session — bounce to login.
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <section className="stats">
        <div className="stat card">
          <div className="stat-num">{total ?? '—'}</div>
          <div className="stat-label">Total users</div>
        </div>
      </section>

      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>Users</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Email</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{u.id}</td>
                  <td>{u.email}</td>
                  <td>{u.name}</td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="muted center-cell">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// Status label shown per row. "skipped" is a distinct, non-error state
// (grey): the corresponding env var isn't configured on this deployment,
// e.g. no GOOGLE_API_KEY in local dev — see server/internal/adminconsole/
// health.go for exactly which var maps to which service.
const STATUS_LABEL: Record<ExternalServiceStatus['status'], string> = {
  ok: 'OK',
  error: 'Error',
  skipped: 'Skipped',
}

function ExternalServicesTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [services, setServices] = useState<ExternalServiceStatus[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Each call re-runs every check server-side (no caching/polling) — fine
  // for a manually-triggered admin diagnostic, but this must only fire on
  // page load and the explicit "Recheck" click below, never on a timer:
  // the Places API check spends a small amount of real quota per call
  // (see health.go's checkPlaces comment).
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.checkExternalHealth()
      setServices(res)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>External services</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Checking…' : 'Recheck'}
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(services ?? []).map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>
                    <span className={`status-dot status-${s.status}`} />
                    {STATUS_LABEL[s.status]}
                  </td>
                  <td className="muted">{s.status === 'skipped' ? '—' : `${s.latencyMs} ms`}</td>
                  <td className="muted">{s.detail || '—'}</td>
                </tr>
              ))}
              {(services === null || services.length === 0) && !loading && (
                <tr>
                  <td colSpan={4} className="muted center-cell">
                    No data yet.
                  </td>
                </tr>
              )}
              {loading && services === null && (
                <tr>
                  <td colSpan={4} className="muted center-cell">
                    Checking…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// GeoRateLimitsTab: edits the "places.get" / "places.photoMedia" /
// "places.searchText" / "places.searchNearby" / "geocode" rows of
// server/internal/store/geo_rate_limits.go. An endpoint with no row yet
// (nothing saved through this form, or a fresh deployment before
// cmd/server's startup seed runs) shows a blank editable row seeded from
// DEFAULT_ENDPOINTS below rather than nothing — the admin shouldn't need to
// already know the endpoint's exact string to create its first row.
//
// 2026-10: places.searchText/searchNearby added alongside the existing two
// — the user asked to remove the Gateway's queueing throttle
// (MaxConcurrency/MinInterval, see internal/apigateway.DefaultConfig) in
// favor of the reject-style RateLimiter carrying all rate protection, which
// means every Google Places endpoint needs a RateLimiter rule now, not just
// the two that already had one. Code review later caught that "geocode"
// (server/internal/geo/geocode.go) was missed by that same sweep — it used
// to be backstopped by the Gateway's queueing default too, and lost that
// protection the same way. Added here so this tab covers every endpoint
// that now depends solely on the RateLimiter, not just the four Places ones.
//
// Saved edits don't apply instantly: cmd/server reads this table on a
// background timer (~45s, see geoRateLimitRefreshInterval in
// server/cmd/server/geo_rate_limit.go), not on every request — this tab
// says so next to the save button rather than implying an immediate effect.
const DEFAULT_ENDPOINTS = ['places.get', 'places.photoMedia', 'places.searchText', 'places.searchNearby', 'geocode']

// RPM_WINDOW_SEC — 2026-10 the user asked for this form to express the
// window purely in "requests per minute" instead of separately editable
// window/maxCalls fields. The backend API (store.GeoRateLimit.windowSec)
// and the underlying apigateway.RateLimiter still support an arbitrary
// window length per the server's own design — this form just always saves
// a fixed 60-second window, since the server defaults (cmd/server/main.go)
// are now 60s for both endpoints anyway. windowSec itself is no longer an
// editable field; it's fixed to this constant on every save from this form.
const RPM_WINDOW_SEC = 60

// EditableRow mirrors GeoRateLimit's editable fields as strings (so a
// partially-typed number field, including empty, is representable while
// the user is still typing) plus the two read-only usage fields pulled
// straight from the last successful load/save.
//
// windowSec is kept (read-only, not rendered as an input) purely so the
// UI can warn when a loaded row's actual window isn't RPM_WINDOW_SEC —
// see the "non-60s window" notice in the table. Saving from this form
// always overwrites it to RPM_WINDOW_SEC regardless of what was loaded.
interface EditableRow {
  endpoint: string
  windowSec: number
  rpm: string
  dailyMax: string
  usedToday: number
  usedDay: string
}

function toEditableRow(limit: GeoRateLimit): EditableRow {
  return {
    endpoint: limit.endpoint,
    windowSec: limit.windowSec,
    rpm: String(limit.maxCalls),
    dailyMax: String(limit.dailyMax),
    usedToday: limit.usedToday,
    usedDay: limit.usedDay,
  }
}

function blankEditableRow(endpoint: string): EditableRow {
  return { endpoint, windowSec: RPM_WINDOW_SEC, rpm: '', dailyMax: '0', usedToday: 0, usedDay: '' }
}

function GeoRateLimitsTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [rows, setRows] = useState<EditableRow[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // savingEndpoint tracks which single row's Save button is mid-request —
  // rows are saved independently (one PUT per endpoint, see api.ts), so
  // only that row's button should show a busy state, not the whole tab.
  const [savingEndpoint, setSavingEndpoint] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ endpoint: string; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.geoRateLimits()
      const byEndpoint = new Map(res.limits.map((l) => [l.endpoint, toEditableRow(l)]))
      // Always show every DEFAULT_ENDPOINTS row, even if the backend has
      // no data for it yet — see the component comment above.
      const merged = DEFAULT_ENDPOINTS.map((ep) => byEndpoint.get(ep) ?? blankEditableRow(ep))
      // Any endpoint present in the backend response but not in
      // DEFAULT_ENDPOINTS (set through some other client, or a future
      // endpoint this admin build doesn't know about yet) is still shown,
      // appended after the known ones, so this form never silently hides
      // a row that actually exists.
      for (const l of res.limits) {
        if (!DEFAULT_ENDPOINTS.includes(l.endpoint)) merged.push(toEditableRow(l))
      }
      setRows(merged)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  const updateField = (endpoint: string, field: 'rpm' | 'dailyMax', value: string) => {
    setRows((prev) => (prev ?? []).map((r) => (r.endpoint === endpoint ? { ...r, [field]: value } : r)))
  }

  const save = async (row: EditableRow) => {
    setRowError(null)
    const rpm = Number(row.rpm)
    const dailyMax = Number(row.dailyMax)
    if (!Number.isFinite(rpm) || rpm <= 0) {
      setRowError({ endpoint: row.endpoint, message: 'Requests/min must be a positive number' })
      return
    }
    if (!Number.isFinite(dailyMax) || dailyMax < 0) {
      setRowError({ endpoint: row.endpoint, message: 'Daily max must be 0 or a positive number' })
      return
    }
    setSavingEndpoint(row.endpoint)
    try {
      // This form always saves a fixed 60-second window (RPM_WINDOW_SEC) —
      // see that constant's comment. rpm becomes maxCalls directly since
      // the window is exactly one minute.
      const res = await api.updateGeoRateLimit({ endpoint: row.endpoint, windowSec: RPM_WINDOW_SEC, maxCalls: rpm, dailyMax })
      const byEndpoint = new Map(res.limits.map((l) => [l.endpoint, toEditableRow(l)]))
      setRows((prev) => (prev ?? []).map((r) => byEndpoint.get(r.endpoint) ?? r))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setRowError({ endpoint: row.endpoint, message: err instanceof ApiError ? err.message : 'Save failed' })
    } finally {
      setSavingEndpoint(null)
    }
  }

  return (
    <>
      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>Google API rate limits</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <p className="muted">
          Edits are picked up by the server within about 45 seconds, not instantly — the running process re-reads this
          table on a background timer rather than applying every save immediately. Saving from this form always uses a
          fixed 60-second window (requests/min), matching the server's own defaults.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Requests/min (RPM)</th>
                <th>Daily max (0 = unlimited)</th>
                <th>Used today</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.endpoint}>
                  <td>{r.endpoint}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={r.rpm}
                      onChange={(e) => updateField(r.endpoint, 'rpm', e.target.value)}
                      style={{ width: '6rem' }}
                    />
                    {/* The loaded row's actual window might not be 60s yet
                        (e.g. a value set before this RPM-only form existed,
                        or set through some other client) — the rpm number
                        above would then misrepresent the real rate.
                        Surfacing the raw window here instead of silently
                        assuming 60s avoids the admin misjudging the actual
                        limit; saving from this form will still overwrite it
                        to a true 60s window regardless. */}
                    {r.windowSec !== RPM_WINDOW_SEC && (
                      <div className="muted" style={{ fontSize: '0.8em' }}>
                        actual window: {r.windowSec}s (not 60s — saving will fix this)
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.dailyMax}
                      onChange={(e) => updateField(r.endpoint, 'dailyMax', e.target.value)}
                      style={{ width: '6rem' }}
                    />
                  </td>
                  <td className="muted">
                    {r.usedDay ? `${r.usedToday} (as of ${r.usedDay})` : '—'}
                  </td>
                  <td className="row-actions">
                    <button onClick={() => void save(r)} disabled={savingEndpoint === r.endpoint}>
                      {savingEndpoint === r.endpoint ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rowError && <div className="error">{`${rowError.endpoint}: ${rowError.message}`}</div>}
      </section>
    </>
  )
}

// AttractionMissingPlaceIDTab: lists every attractions row where place_id
// is NULL or empty — every row here shows a placeholder on the theme card
// (2026-10: the attractions.photo_url compat field — and the database
// column itself — has been fully removed, see api.ts's doc comment on
// AttractionMissingPlaceID).
//
// "Refetch" (2026-09 added) is the admin-console equivalent of running
// `tripace-cli attraction set-place-id -id <id> -place "<name>"` by hand —
// it searches Google Places for cityName+name and writes back the first
// candidate's place_id automatically. It is NOT a "figure out which rows
// need fixing" automation (that judgment call is still this list's whole
// reason for existing) — it only collapses the "go look it up on Google
// Maps, then run a CLI command" busywork into one click, for rows where
// the operator already trusts a plain text search will find the right
// place. The result banner shows what Google actually matched (name +
// address) so the operator can sanity-check the write after the fact,
// since this endpoint does no similarity check itself — a bad match is a
// wrong place_id sitting in the database until someone re-corrects it by
// hand (e.g. with -place-id) or refetches the row again with a better
// match likely available.
function AttractionMissingPlaceIDTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [attractions, setAttractions] = useState<AttractionMissingPlaceID[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // refetchingId: which row's Refetch button is mid-request, if any —
  // disables just that row's button (not the whole table).
  const [refetchingId, setRefetchingId] = useState<string | null>(null)
  const [refetchError, setRefetchError] = useState('')
  const [refetchResult, setRefetchResult] = useState<RefetchAttractionPlaceIDResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.attractionMissingPlaceIDCheck()
      setAttractions(res.attractions)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefetch = useCallback(
    async (id: string) => {
      setRefetchError('')
      setRefetchResult(null)
      setRefetchingId(id)
      try {
        const res = await api.refetchAttractionPlaceID(id)
        setRefetchResult(res)
        // Reload rather than just removing the row locally — a successful
        // refetch moves place_id away from empty, so the row should
        // disappear from this list, and reloading from the server is the
        // simplest way to guarantee the displayed list matches what's
        // actually in the database now.
        await load()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onLoggedOut()
          return
        }
        setRefetchError(err instanceof ApiError ? err.message : 'Failed to refetch')
      } finally {
        setRefetchingId(null)
      }
    },
    [load, onLoggedOut],
  )

  return (
    <>
      {error && <div className="error banner">{error}</div>}
      {refetchError && <div className="error banner">{refetchError}</div>}
      {refetchResult && (
        <div className="info banner">
          Wrote place_id {refetchResult.placeId} for {refetchResult.id} — Google matched "{refetchResult.matchedName}"
          at {refetchResult.matchedAddress}. Double-check this is really the same place.
        </div>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Attractions missing place_id</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <p className="muted">
          Every attraction below has no Google Place ID on file — theme cards for these show a placeholder image.
          "Refetch" searches Google Places for this attraction's city+name and writes back the first match's
          place_id — it does not verify the match is correct, so check the result banner before trusting it.
        </p>
        {attractions !== null && <p className="muted">{attractions.length} attraction(s) currently missing place_id.</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>City</th>
                <th>Is theme</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(attractions ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.name}</td>
                  <td>{a.cityName}</td>
                  <td>{a.isTheme ? 'yes' : 'no'}</td>
                  <td>
                    <button
                      className="ghost"
                      onClick={() => void handleRefetch(a.id)}
                      disabled={refetchingId !== null && refetchingId !== a.id}
                    >
                      {refetchingId === a.id ? 'Refetching…' : 'Refetch'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// SchemaCheckTab: compares every GORM entity struct's expected columns/
// primary key against what's actually in the database. This exists because
// AutoMigrate only ever ADDs missing columns — it never renames or drops a
// column, and never changes an existing table's primary key. A Go-side
// field rename (photoRef -> placeID) silently leaves the old column AND
// the old primary key in place; AutoMigrate itself reports success the
// whole time. This is the only way to catch that kind of drift without
// manually inspecting information_schema per table.
function SchemaCheckTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tables, setTables] = useState<SchemaCheck[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.checkSchema()
      setTables(res.tables)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  const problemCount = (tables ?? []).filter((t) => !t.ok).length

  return (
    <>
      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>Schema check</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Checking…' : 'Recheck'}
          </button>
        </div>
        {tables !== null && (
          <p className="muted">
            {problemCount === 0
              ? `All ${tables.length} tables match their struct definitions.`
              : `${problemCount} of ${tables.length} tables have drifted from their struct definitions.`}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Status</th>
                <th>Missing columns</th>
                <th>Extra columns</th>
                <th>Primary key</th>
              </tr>
            </thead>
            <tbody>
              {(tables ?? []).map((t) => (
                <tr key={t.table}>
                  <td>{t.table}</td>
                  <td>
                    <span className={`status-dot ${t.ok ? 'status-ok' : 'status-error'}`} />
                    {t.ok ? 'OK' : 'Drifted'}
                  </td>
                  <td className={t.missingColumns?.length ? 'error-cell' : 'muted'}>
                    {t.missingColumns?.length ? t.missingColumns.join(', ') : '—'}
                  </td>
                  <td className={t.extraColumns?.length ? 'error-cell' : 'muted'}>
                    {t.extraColumns?.length ? t.extraColumns.join(', ') : '—'}
                  </td>
                  <td className={t.primaryKeyMismatch ? 'error-cell' : 'muted'}>
                    {t.primaryKeyMismatch
                      ? `expected (${t.primaryKeyMismatch.expected.join(', ')}), actual (${t.primaryKeyMismatch.actual.join(', ')})`
                      : '—'}
                  </td>
                </tr>
              ))}
              {(tables === null || tables.length === 0) && !loading && (
                <tr>
                  <td colSpan={5} className="muted center-cell">
                    No data yet.
                  </td>
                </tr>
              )}
              {loading && tables === null && (
                <tr>
                  <td colSpan={5} className="muted center-cell">
                    Checking…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// Fixed set of lookback windows — matches the backend's clamp (max 168h /
// 7 days, see server/internal/adminconsole/request_stats.go) so every
// option here is guaranteed to be valid, no need to validate client-side.
const HOURS_OPTIONS = [1, 24, 168] as const

function RequestStatsTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [hours, setHours] = useState<number>(24)
  const [stats, setStats] = useState<{
    total: number
    errorCount: number
    paths: PathRequestStats[]
    timeline: TimelineBucket[]
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.requestStats(hours)
      setStats({ total: res.total, errorCount: res.errorCount, paths: res.paths, timeline: res.timeline })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [hours, onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <section className="stats">
        <div className="stat card">
          <div className="stat-num">{stats?.total ?? '—'}</div>
          <div className="stat-label">Total requests</div>
        </div>
        <div className="stat card">
          <div className="stat-num">{stats?.errorCount ?? '—'}</div>
          <div className="stat-label">Errors (4xx/5xx)</div>
        </div>
      </section>

      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>Requests over time</h2>
        </div>
        <TimelineChart buckets={stats?.timeline ?? []} granularity="hour" />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Requests by endpoint</h2>
          <div className="row-actions">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOURS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  Last {h < 24 ? `${h}h` : `${h / 24}d`}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Count</th>
                <th>Avg duration</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.paths ?? []).map((p) => (
                <tr key={`${p.method} ${p.path}`}>
                  <td className="muted">{p.method}</td>
                  <td>{p.path}</td>
                  <td>{p.count}</td>
                  <td className="muted">{p.avgDurationMs.toFixed(0)} ms</td>
                  <td className={p.errorCount > 0 ? 'error-cell' : 'muted'}>{p.errorCount}</td>
                </tr>
              ))}
              {(stats === null || stats.paths.length === 0) && !loading && (
                <tr>
                  <td colSpan={5} className="muted center-cell">
                    No requests recorded in this window.
                  </td>
                </tr>
              )}
              {loading && stats === null && (
                <tr>
                  <td colSpan={5} className="muted center-cell">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// Outbound Google Places/Geocoding API call stats — counterpart to
// RequestStatsTab above (that one is inbound: someone calling into our
// server; this one is outbound: our server calling Google). Reads from
// already-logged data (geo_api_call_logs), so loading/refreshing this tab
// never triggers a real Google API call itself.
function GeoAPIStatsTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [hours, setHours] = useState<number>(24)
  const [calls, setCalls] = useState<GeoAPICallStats[] | null>(null)
  const [timeline, setTimeline] = useState<TimelineBucket[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.geoAPIStats(hours)
      setCalls(res.calls)
      setTimeline(res.timeline)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [hours, onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  const total = calls?.reduce((sum, c) => sum + c.count, 0) ?? null
  const errorCount = calls?.reduce((sum, c) => sum + c.errorCount, 0) ?? null

  return (
    <>
      <section className="stats">
        <div className="stat card">
          <div className="stat-num">{total ?? '—'}</div>
          <div className="stat-label">Total Google API calls</div>
        </div>
        <div className="stat card">
          <div className="stat-num">{errorCount ?? '—'}</div>
          <div className="stat-label">Errors</div>
        </div>
      </section>

      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>Calls over time</h2>
        </div>
        <TimelineChart buckets={timeline} granularity="minute" />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Calls by endpoint</h2>
          <div className="row-actions">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOURS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  Last {h < 24 ? `${h}h` : `${h / 24}d`}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Caller</th>
                <th>Path</th>
                <th>Count</th>
                <th>Avg duration</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {(calls ?? []).map((c) => (
                <tr key={`${c.endpoint} ${c.caller} ${c.path}`}>
                  <td>{c.endpoint}</td>
                  <td className="muted">{c.caller}</td>
                  <td className="muted">{c.path || '—'}</td>
                  <td>{c.count}</td>
                  <td className="muted">{c.avgDurationMs.toFixed(0)} ms</td>
                  <td className={c.errorCount > 0 ? 'error-cell' : 'muted'}>{c.errorCount}</td>
                </tr>
              ))}
              {(calls === null || calls.length === 0) && !loading && (
                <tr>
                  <td colSpan={6} className="muted center-cell">
                    No Google API calls recorded in this window.
                  </td>
                </tr>
              )}
              {loading && calls === null && (
                <tr>
                  <td colSpan={6} className="muted center-cell">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// AI 規劃對話訊息記錄(GET /admin/api/plan-ai-chat-logs)。顯示所有使用者的
// 所有 /trip-plan AI 規劃對話訊息,依時間降冪排序(最新在前)——是一張
// 列出全部訊息的表格(類似 log 瀏覽器),不是先選使用者才看單一對話。
//
// LIMIT_OPTIONS 比照 RequestStatsTab/GeoAPIStatsTab 的 HOURS_OPTIONS 做法:
// 固定選項,跟後端 listPlanAiChatLogs 的上限(1000)對齊,不需要前端自行
// 驗證輸入值。
const LIMIT_OPTIONS = [50, 200, 1000] as const

// ROLE_LABEL 讓 user/assistant 兩種角色用不同顏色的標籤區分——顏色本身沿用
// style.css 既有的 status-ok/status-error 色系(藍/綠語意不嚴格對應,這裡
// 只是借用已有的視覺樣式,不是在描述請求成功/失敗)。
const ROLE_LABEL: Record<string, string> = {
  user: '使用者',
  assistant: 'AI',
}

// CONTENT_PREVIEW_LENGTH:超過這個長度的訊息內容,表格裡只顯示截斷版本
// +「展開」按鈕——訊息內容可能是很長的一段規劃文字,不截斷會把表格撐爆
// 版面(尤其這張表沒有固定欄寬設計,長文字會讓其他欄位被擠到看不見)。
const CONTENT_PREVIEW_LENGTH = 120

function PlanAiChatLogsTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [limit, setLimit] = useState<number>(200)
  const [total, setTotal] = useState<number | null>(null)
  const [messages, setMessages] = useState<PlanAiChatLogEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // expandedIds: 哪些訊息目前顯示全文而非截斷版本(可能同時展開多筆)。
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listPlanAiChatLogs(limit)
      setTotal(res.total)
      setMessages(res.messages)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [limit, onLoggedOut])

  useEffect(() => {
    void load()
  }, [load])

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <>
      <section className="stats">
        <div className="stat card">
          <div className="stat-num">{total ?? '—'}</div>
          <div className="stat-label">目前顯示訊息數</div>
        </div>
      </section>

      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="section-head">
          <h2>AI 規劃對話訊息</h2>
          <div className="row-actions">
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  最近 {l} 筆
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <p className="muted">所有使用者的 AI 規劃對話訊息,依時間新到舊排序。內容過長時自動截斷,點擊「展開」看全文。</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>使用者</th>
                <th>角色</th>
                <th>內容</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const expanded = expandedIds.has(m.id)
                const isLong = m.content.length > CONTENT_PREVIEW_LENGTH
                const shown = expanded || !isLong ? m.content : `${m.content.slice(0, CONTENT_PREVIEW_LENGTH)}…`
                return (
                  <tr key={m.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="muted">{m.userEmail || m.userID}</td>
                    <td>
                      <span className={`status-dot ${m.role === 'assistant' ? 'status-ok' : 'status-skipped'}`} />
                      {ROLE_LABEL[m.role] ?? m.role}
                    </td>
                    <td style={{ whiteSpace: 'pre-wrap', maxWidth: '36rem' }}>
                      {shown}
                      {isLong && (
                        <>
                          {' '}
                          <button className="ghost" onClick={() => toggleExpanded(m.id)}>
                            {expanded ? '收合' : '展開'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {messages.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="muted center-cell">
                    尚無任何 AI 規劃對話訊息。
                  </td>
                </tr>
              )}
              {loading && messages.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted center-cell">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
