import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { ExternalServiceStatus, UserSummary } from './api'

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

type Tab = 'users' | 'external'

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
      </nav>

      {tab === 'users' && <UsersTab onLoggedOut={onLoggedOut} />}
      {tab === 'external' && <ExternalServicesTab onLoggedOut={onLoggedOut} />}
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
