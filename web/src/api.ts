// API client — 測試台的心臟。
// 每次呼叫都產生一筆 ApiCall 交易紀錄(含原始 request/response、狀態碼、耗時),
// 無論成功或失敗都會記錄,供 debug panel 顯示。這是「開發時測試後端」的核心價值。

import type {
  AuthResponse,
  Channel,
  Entry,
  Me,
  Message,
  SearchAnswer,
  User,
  APIErrorBody,
} from './types'

// 一筆 API 交易的完整紀錄,debug panel 與 console log 都靠它。
export interface ApiCall {
  id: number
  method: string
  url: string
  requestBody: unknown | null
  status: number | null // null 表示連線層級就失敗(CORS、server 沒開、網路)
  ok: boolean
  durationMs: number
  responseBody: unknown | null
  responseText: string // 原始回應字串(JSON 解析失敗時也看得到)
  error: string | null // 連線/解析層級的錯誤訊息
  startedAt: string // ISO8601(由前端產生,純顯示用)
}

// 當後端回非 2xx 時拋出,夾帶該次交易紀錄。
export class ApiError extends Error {
  call: ApiCall
  constructor(message: string, call: ApiCall) {
    super(message)
    this.name = 'ApiError'
    this.call = call
  }
}

export interface ClientConfig {
  baseURL: string // 例:http://localhost:8080
  token: string | null // Bearer token,可空(走訪客)
}

// 每筆 ApiCall 遞增 id;訂閱者(App)收到每次交易以累積 log。
let callSeq = 0
type Listener = (call: ApiCall) => void
const listeners = new Set<Listener>()

export function onApiCall(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(call: ApiCall) {
  for (const fn of listeners) fn(call)
}

// 因為 scripts 環境不允許 Date.now(),但這是瀏覽器執行的 app(非 workflow script),
// performance.now() 與 new Date() 都可用,用來計時與標時間。
function nowISO(): string {
  return new Date().toISOString()
}

async function request<T>(
  cfg: ClientConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = cfg.baseURL.replace(/\/+$/, '') + path
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`

  const startedAt = nowISO()
  const t0 = performance.now()

  const call: ApiCall = {
    id: ++callSeq,
    method,
    url,
    requestBody: body ?? null,
    status: null,
    ok: false,
    durationMs: 0,
    responseBody: null,
    responseText: '',
    error: null,
    startedAt,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    // 連線層級失敗:server 沒開、CORS、網路。這是測後端最常見的第一道錯。
    call.durationMs = Math.round(performance.now() - t0)
    call.error =
      e instanceof Error ? e.message : '連線失敗(server 未啟動或 CORS?)'
    emit(call)
    throw new ApiError(call.error, call)
  }

  call.status = res.status
  call.ok = res.ok
  call.durationMs = Math.round(performance.now() - t0)
  call.responseText = await res.text()

  // 嘗試解析 JSON;失敗也保留原始文字,方便除錯。
  if (call.responseText) {
    try {
      call.responseBody = JSON.parse(call.responseText)
    } catch {
      call.responseBody = null
    }
  }

  emit(call)

  if (!res.ok) {
    const errBody = call.responseBody as APIErrorBody | null
    const msg =
      errBody?.error?.message ?? `HTTP ${res.status}`
    throw new ApiError(msg, call)
  }

  return call.responseBody as T
}

// ---- 對齊 server 路由的各端點。命名與 BackendService.swift 一致,方便對照。 ----

export function health(cfg: ClientConfig) {
  return request<{ status: string }>(cfg, 'GET', '/health')
}

export function me(cfg: ClientConfig) {
  return request<Me>(cfg, 'GET', '/v1/me')
}

export function signInWithApple(
  cfg: ClientConfig,
  identityToken: string,
  fullName?: string,
) {
  return request<AuthResponse>(cfg, 'POST', '/v1/auth/apple', {
    identityToken,
    fullName: fullName ?? '',
  })
}

// 帳密登入:回傳 { token, user }。
export function login(cfg: ClientConfig, email: string, password: string) {
  return request<AuthResponse>(cfg, 'POST', '/v1/auth/login', { email, password })
}

// 註冊(註冊即登入):回傳 { token, user }。
export function register(
  cfg: ClientConfig,
  email: string,
  password: string,
  name: string,
) {
  return request<AuthResponse>(cfg, 'POST', '/v1/auth/register', {
    email,
    password,
    name,
  })
}

export function fetchChannels(cfg: ClientConfig) {
  return request<{ channels: Channel[] }>(cfg, 'GET', '/v1/channels').then(
    (r) => r.channels,
  )
}

export function createChannel(cfg: ClientConfig, name: string) {
  return request<Channel>(cfg, 'POST', '/v1/channels', { name })
}

export function fetchMessages(cfg: ClientConfig, channelID: string) {
  return request<{ messages: Message[] }>(
    cfg,
    'GET',
    `/v1/channels/${encodeURIComponent(channelID)}/messages`,
  ).then((r) => r.messages)
}

export function postMessage(cfg: ClientConfig, channelID: string, text: string) {
  return request<Message>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/messages`,
    { text },
  )
}

export function fetchMembers(cfg: ClientConfig, channelID: string) {
  return request<{ members: User[] }>(
    cfg,
    'GET',
    `/v1/channels/${encodeURIComponent(channelID)}/members`,
  ).then((r) => r.members)
}

// 以 email 邀請使用者加入頻道(對齊 iOS App;後端依 email 查出使用者)。
export function addMember(cfg: ClientConfig, channelID: string, email: string) {
  return request<{ members: User[] }>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/members`,
    { email },
  ).then((r) => r.members)
}

export function semanticQuery(
  cfg: ClientConfig,
  channelID: string,
  question: string,
) {
  return request<SearchAnswer>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/query`,
    { question },
  )
}

// present_entries 工具輸出、要展示給使用者的條目(不含 id/messageID)。
export interface PresentedEntry {
  item: string
  start: string
  end: string
  allDay: boolean
}

// owner 統一輸入:LLM 自主判斷記錄事項或回答提問。
// 回 { kind:"recorded", message } 或 { kind:"answer", answer, entries }。
// answer 的 entries 是 agent 用 present_entries 輸出的條目(可空),前端用列表元件顯示。
export type AssistResult =
  | { kind: 'recorded'; message: Message }
  | { kind: 'answer'; answer: string; entries: PresentedEntry[] }

export function assist(cfg: ClientConfig, channelID: string, text: string) {
  return request<AssistResult>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/assist`,
    { text },
  )
}

// 取頻道的 Entry 條目(LLM record_entry 工具處理後的結果)。
export function fetchEntries(cfg: ClientConfig, channelID: string) {
  return request<{ entries: Entry[] }>(
    cfg,
    'GET',
    `/v1/channels/${encodeURIComponent(channelID)}/entries`,
  ).then((r) => r.entries)
}
