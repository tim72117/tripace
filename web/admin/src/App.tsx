import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { ExternalServiceStatus, GeoAPICallStats, GeoRateLimit, PathRequestStats, PlaceDetailsZeroPhotoTarget, SchemaCheck, TimelineBucket, UserSummary } from './api'
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

type Tab = 'users' | 'external' | 'requests' | 'geo-api' | 'geo-rate-limits' | 'photo-target-check' | 'schema'

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
        <button className={tab === 'photo-target-check' ? 'tab active' : 'tab'} onClick={() => setTab('photo-target-check')}>
          Photo target=0 check
        </button>
        <button className={tab === 'schema' ? 'tab active' : 'tab'} onClick={() => setTab('schema')}>
          Schema check
        </button>
      </nav>

      {tab === 'users' && <UsersTab onLoggedOut={onLoggedOut} />}
      {tab === 'external' && <ExternalServicesTab onLoggedOut={onLoggedOut} />}
      {tab === 'requests' && <RequestStatsTab onLoggedOut={onLoggedOut} />}
      {tab === 'geo-api' && <GeoAPIStatsTab onLoggedOut={onLoggedOut} />}
      {tab === 'geo-rate-limits' && <GeoRateLimitsTab onLoggedOut={onLoggedOut} />}
      {tab === 'photo-target-check' && <PhotoTargetZeroCheckTab onLoggedOut={onLoggedOut} />}
      {tab === 'schema' && <SchemaCheckTab onLoggedOut={onLoggedOut} />}
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

// GeoRateLimitsTab: edits the "places.get" / "places.photoMedia" rows of
// server/internal/store/geo_rate_limits.go. An endpoint with no row yet
// (nothing saved through this form, or a fresh deployment before
// cmd/server's startup seed runs) shows a blank editable row seeded from
// DEFAULT_ENDPOINTS below rather than nothing — the admin shouldn't need to
// already know the endpoint's exact string to create its first row.
//
// Saved edits don't apply instantly: cmd/server reads this table on a
// background timer (~45s, see geoRateLimitRefreshInterval in
// server/cmd/server/geo_rate_limit.go), not on every request — this tab
// says so next to the save button rather than implying an immediate effect.
const DEFAULT_ENDPOINTS = ['places.get', 'places.photoMedia']

// EditableRow mirrors GeoRateLimit's editable fields as strings (so a
// partially-typed number field, including empty, is representable while
// the user is still typing) plus the two read-only usage fields pulled
// straight from the last successful load/save.
interface EditableRow {
  endpoint: string
  windowSec: string
  maxCalls: string
  dailyMax: string
  usedToday: number
  usedDay: string
}

function toEditableRow(limit: GeoRateLimit): EditableRow {
  return {
    endpoint: limit.endpoint,
    windowSec: String(limit.windowSec),
    maxCalls: String(limit.maxCalls),
    dailyMax: String(limit.dailyMax),
    usedToday: limit.usedToday,
    usedDay: limit.usedDay,
  }
}

function blankEditableRow(endpoint: string): EditableRow {
  return { endpoint, windowSec: '', maxCalls: '', dailyMax: '0', usedToday: 0, usedDay: '' }
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

  const updateField = (endpoint: string, field: 'windowSec' | 'maxCalls' | 'dailyMax', value: string) => {
    setRows((prev) => (prev ?? []).map((r) => (r.endpoint === endpoint ? { ...r, [field]: value } : r)))
  }

  const save = async (row: EditableRow) => {
    setRowError(null)
    const windowSec = Number(row.windowSec)
    const maxCalls = Number(row.maxCalls)
    const dailyMax = Number(row.dailyMax)
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
      setRowError({ endpoint: row.endpoint, message: 'Window (sec) must be a positive number' })
      return
    }
    if (!Number.isFinite(maxCalls) || maxCalls <= 0) {
      setRowError({ endpoint: row.endpoint, message: 'Max calls must be a positive number' })
      return
    }
    if (!Number.isFinite(dailyMax) || dailyMax < 0) {
      setRowError({ endpoint: row.endpoint, message: 'Daily max must be 0 or a positive number' })
      return
    }
    setSavingEndpoint(row.endpoint)
    try {
      const res = await api.updateGeoRateLimit({ endpoint: row.endpoint, windowSec, maxCalls, dailyMax })
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
          table on a background timer rather than applying every save immediately.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Window (sec)</th>
                <th>Max calls / window</th>
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
                      value={r.windowSec}
                      onChange={(e) => updateField(r.endpoint, 'windowSec', e.target.value)}
                      style={{ width: '6rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={r.maxCalls}
                      onChange={(e) => updateField(r.endpoint, 'maxCalls', e.target.value)}
                      style={{ width: '6rem' }}
                    />
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

// PhotoTargetZeroCheckTab: lists every place_details_cache row where
// google_photo_target_count is exactly 0 right now. That value is
// ambiguous by itself (see PlaceDetailsZeroPhotoTarget's doc comment in
// api.ts): it's the legitimate steady state for "confirmed with Google,
// genuinely no photos", but it's also exactly what a since-fixed deadlock
// bug used to leave for places that were never actually confirmed. This
// tab intentionally has no "fix" button — telling those two cases apart
// requires an actual judgment call (e.g. looking the place up on Google
// Maps), not something safe to automate from this list alone. An operator
// who confirms a row is a stale pre-fix artifact fixes it by hand (reset
// google_photo_target_count back to -1 directly in the database, or wait
// for it to be reached by whatever cleanup script eventually runs) — this
// page is purely a read-only worklist for that manual triage.
function PhotoTargetZeroCheckTab({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [places, setPlaces] = useState<PlaceDetailsZeroPhotoTarget[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.photoTargetZeroCheck()
      setPlaces(res.places)
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
          <h2>Photo target=0 check</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <p className="muted">
          Every place below has google_photo_target_count = 0 right now. That's the legitimate value for "confirmed —
          this place genuinely has no Google photos", but it's also what a since-fixed bug used to leave behind for
          places that were never actually confirmed. Spot-check a row (e.g. on Google Maps) before assuming it's
          correct — this list is a worklist, not a report of problems.
        </p>
        {places !== null && <p className="muted">{places.length} place(s) currently at target=0.</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Place ID</th>
                <th>Name</th>
                <th>Click count</th>
                <th>Last confirmed</th>
              </tr>
            </thead>
            <tbody>
              {(places ?? []).map((p) => (
                <tr key={p.placeId}>
                  <td>{p.placeId}</td>
                  <td>{p.name}</td>
                  <td>{p.clickCount}</td>
                  <td>{new Date(p.fetchedAt).toLocaleString()}</td>
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
