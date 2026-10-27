// Client for the backend's /partner/api/* endpoints (server/internal/
// partnerconsole). Auth is the SAME pattern as web/admin/src/api.ts —
// this console consumes the SAME JWT as the regular user system (signed
// by the one internal/auth.Signer shared with /v1, /admin, /partner),
// gated by a database relation (partnerRow.UserID) checked server-side.
// This client stores that JWT in localStorage (TOKEN_STORAGE_KEY below)
// and sends it as `Authorization: Bearer <token>` on every call — no
// cookies. A 401 means the token is missing/expired/invalid, or the
// signed-in user has no partner record; callers drop back to the login
// screen either way (this client can't tell those apart, by design —
// see partnerconsole's withPartner fail-closed behavior).

const TOKEN_STORAGE_KEY = 'tripace_partner_token'

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
    // Best-effort — see admin console's api.ts for the same pattern.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // no-op
  }
}

export interface Partner {
  id: string
  userID: string
  name: string
  status: string
  createdAt: string
}

export interface Campaign {
  id: string
  name: string
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'ended' | string
  placement?: string
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
}

export interface Placement {
  value: string
  label: string
}

export interface AdPlan {
  id: string
  campaignID: string
  category: string
  title: string
  status: 'draft' | 'published' | string
  detail: string
  createdAt: string
  updatedAt: string
}

// Same resolution strategy as web/admin/src/api.ts BASE — an explicit
// VITE_PARTNER_API_URL for local dev against a separately-running
// backend, falling back to the serving origin (correct in production,
// where this SPA is embedded same-origin under /partner).
export const BASE: string = import.meta.env.VITE_PARTNER_API_URL ?? window.location.origin

// MAIN_BASE — where POST /v1/auth/login lives. In production this is the
// SAME origin as BASE (partnerserver and the main server both sit behind
// the same domain's routing, or more precisely: login always happens on
// the main site first, and this console just consumes the resulting
// JWT — see api.login's doc comment). Locally, though, cmd/server and
// cmd/partnerserver are two separate processes on two different ports
// (8080 vs 8082), and only cmd/server exposes /v1/auth/login — BASE
// alone can't be used for both the login call and the /partner/api/*
// calls in local dev. VITE_MAIN_API_URL lets local dev point login at
// the main server while BASE keeps pointing /partner/api/* calls at
// partnerserver; it falls back to BASE itself (correct in production,
// and correct for anyone running a single combined local backend).
const MAIN_BASE: string = import.meta.env.VITE_MAIN_API_URL ?? BASE

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request(method: string, path: string, body?: unknown, base: string = BASE): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${base}. Is it running?`)
  }
  if (!res.ok) {
    const text = (await res.text()).trim()
    let message = text || res.statusText
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } }
        if (parsed?.error?.message) {
          message = parsed.error.message
        }
      } catch {
        // Not JSON — keep the raw text (see admin console's same comment).
      }
    }
    throw new ApiError(res.status, message)
  }
  return res
}

// loginResponse mirrors the relevant subset of the main app's POST
// /v1/auth/login JSON shape (server/internal/api/auth.go handleLogin ->
// issueToken) — { token, user, profile, isNewUser }. This console only
// needs the token (to store); it doesn't need user/profile fields since
// /partner/api/me returns the partner-specific identity instead.
interface loginResponse {
  token: string
}

export const api = {
  // Logs in through the SAME general-user endpoint as the main app and
  // the admin console (POST /v1/auth/login, not a partner-specific one
  // — there is no partner-specific login). Any registered Tripace user
  // can authenticate this way; whether they can actually use this
  // console afterwards is decided server-side per call, by whether a
  // partnerRow exists for that user (see partnerconsole.withPartner) —
  // a successful /v1/auth/login does not by itself mean partner access.
  //
  // If the subsequent me() call 401s (valid Tripace account, but no
  // partner record), the token is already stored from the successful
  // login — clear it before rethrowing so the caller doesn't end up
  // holding a token for an account it then shows a login screen for
  // (a stored-but-unusable token would otherwise silently skip the
  // login screen on next reload, per App.tsx's checkingSession flow,
  // and fail the same way again with no visible reason).
  login: async (email: string, password: string): Promise<Partner> => {
    const res = await request('POST', '/v1/auth/login', { email, password }, MAIN_BASE)
    const body: loginResponse = await res.json()
    setToken(body.token)
    try {
      return await api.me()
    } catch (err) {
      clearToken()
      if (err instanceof ApiError && err.status === 401) {
        throw new ApiError(401, '這個帳號沒有業主權限，請確認使用正確的帳號，或聯絡內部窗口申請開通')
      }
      throw err
    }
  },

  logout: (): void => {
    clearToken()
  },

  me: (): Promise<Partner> => request('GET', '/partner/api/me').then((r) => r.json()),

  listPlacements: (): Promise<{ placements: Placement[] }> =>
    request('GET', '/partner/api/placements').then((r) => r.json()),

  listCampaigns: (): Promise<{ campaigns: Campaign[] }> =>
    request('GET', '/partner/api/campaigns').then((r) => r.json()),

  createCampaign: (input: { name: string; placement?: string; startDate: string; endDate: string }): Promise<Campaign> =>
    request('POST', '/partner/api/campaigns', input).then((r) => r.json()),

  updateCampaign: (
    id: string,
    input: { name: string; placement?: string; startDate: string; endDate: string },
  ): Promise<Campaign> => request('PUT', `/partner/api/campaigns/${id}`, input).then((r) => r.json()),

  setCampaignStatus: (id: string, status: string): Promise<Campaign> =>
    request('PUT', `/partner/api/campaigns/${id}/status`, { status }).then((r) => r.json()),

  deleteCampaign: (id: string): Promise<void> =>
    request('DELETE', `/partner/api/campaigns/${id}`).then(() => undefined),

  listAdPlans: (campaignID: string): Promise<{ plans: AdPlan[] }> =>
    request('GET', `/partner/api/campaigns/${campaignID}/plans`).then((r) => r.json()),

  createAdPlan: (
    campaignID: string,
    input: { category: string; title: string; detail: string },
  ): Promise<AdPlan> =>
    request('POST', `/partner/api/campaigns/${campaignID}/plans`, input).then((r) => r.json()),

  updateAdPlan: (
    id: string,
    input: { category: string; title: string; detail: string },
  ): Promise<void> => request('PUT', `/partner/api/plans/${id}`, input).then(() => undefined),

  setAdPlanStatus: (id: string, status: string): Promise<AdPlan> =>
    request('PUT', `/partner/api/plans/${id}/status`, { status }).then((r) => r.json()),

  deleteAdPlan: (id: string): Promise<void> =>
    request('DELETE', `/partner/api/plans/${id}`).then(() => undefined),
}
