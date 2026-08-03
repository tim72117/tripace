// API client。
// 每次呼叫都產生一筆 ApiCall 交易紀錄(含原始 request/response、狀態碼、耗時),
// 無論成功或失敗都會記錄,供 debug panel 顯示,方便排查問題。

import type {
  AuthResponse,
  Channel,
  ChannelRole,
  Entry,
  Me,
  Member,
  SearchAnswer,
  APIErrorBody,
} from './types'
import { getAssistLang } from './assistLang'
import type { TripEntry } from './clienttools/tripEntryTools'

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

// 一筆後端主動推送的 WebSocket 事件紀錄(entries_updated/ask_user/task_created/
// recommended_places 等,見 server/internal/api/ws.go 的各個 Notify* 方法)。
// 跟 ApiCall 分開記錄:WS 是伺服器主動推播,沒有 method/status/duration 這類
// request/response 概念,只有事件名稱 + payload + 收到的時間點。
export interface WsEvent {
  id: number
  event: string
  channelID: string | null
  payload: unknown
  receivedAt: string // ISO8601
}

let wsEventSeq = 0
type WsListener = (evt: WsEvent) => void
const wsListeners = new Set<WsListener>()

export function onWsEvent(fn: WsListener): () => void {
  wsListeners.add(fn)
  return () => wsListeners.delete(fn)
}

// emitWsEvent 供 ChatScreen 的 ws.onmessage 呼叫,把每則收到的原始訊息記一筆,
// 供 DebugPanel 顯示「後端主動發出的介面更新事件」。
export function emitWsEvent(raw: Record<string, unknown>) {
  const evt: WsEvent = {
    id: ++wsEventSeq,
    event: typeof raw.event === 'string' ? raw.event : '(unknown)',
    channelID: typeof raw.channelID === 'string' ? raw.channelID : null,
    payload: raw,
    receivedAt: nowISO(),
  }
  for (const fn of wsListeners) fn(evt)
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

// ---- CLI 瀏覽器登入(`tripace-cli login --web`)。start/exchange 由 CLI 自己
// 呼叫(見 server/cmd/cli/login.go),不經過這個前端 client;這裡只有網頁端
// 核准畫面(CliAuthPage.tsx)要用到的兩個端點。----

// 取得 id 對應的 CLI 顯示名稱,供核准頁面顯示「XXX 想要登入」。不需登入
// (id 本身就是這個查詢唯一需要的憑證),但沿用 request() 一律會在 cfg.token
// 存在時帶上 Authorization header,對這個端點無影響(server 端不檢查)。
export function getCliAuthName(cfg: ClientConfig, id: string) {
  return request<{ name: string }>(
    cfg,
    'GET',
    `/v1/cli-auth/${encodeURIComponent(id)}`,
  )
}

// 核准 id 對應的登入請求——呼叫端須已登入(cfg.token 有效),否則 401。
// 成功後回傳 CLI 本地伺服器的 redirectUri,呼叫端據此把瀏覽器導過去、帶上
// ?code={id},讓 CLI 換到剛核發的 token(見 CliAuthPage.tsx 的 approve())。
export function approveCliAuth(cfg: ClientConfig, id: string) {
  return request<{ redirectUri: string }>(
    cfg,
    'POST',
    `/v1/cli-auth/${encodeURIComponent(id)}/approve`,
  )
}

// ---- CLI device code 登入(`tripace-cli login --device`,OAuth 2.0 Device
// Authorization Grant / RFC 8628)。跟上面 loopback 回呼流程的差異見
// server/internal/store/cliauth.go 開頭的說明——這裡對應的是 /device
// 核准頁面(DeviceAuthPage.tsx)要用到的兩個端點,查詢鍵是使用者手動輸入的
// userCode,不是 CLI 自己持有的長 deviceCode。----

// 取得 userCode 對應的 CLI 顯示名稱,供核准頁面顯示「XXX 想要登入」。用法
// 同 getCliAuthName,差別只在查詢鍵。
export function getDeviceAuthName(cfg: ClientConfig, userCode: string) {
  return request<{ name: string }>(
    cfg,
    'GET',
    `/v1/cli-auth/device/${encodeURIComponent(userCode)}`,
  )
}

// 核准 userCode 對應的登入請求——呼叫端須已登入,否則 401。沒有 redirectUri
// 可回傳(device code 流程沒有瀏覽器導回這回事,CLI 自己輪詢 exchange 拿
// token,見 DeviceAuthPage.tsx 的 approve())。
export function approveDeviceAuth(cfg: ClientConfig, userCode: string) {
  return request<{ status: string }>(
    cfg,
    'POST',
    `/v1/cli-auth/device/${encodeURIComponent(userCode)}/approve`,
  )
}

export function fetchChannels(cfg: ClientConfig) {
  return request<{ channels: Channel[] }>(cfg, 'GET', '/v1/channels').then(
    (r) => r.channels,
  )
}

export function createChannel(cfg: ClientConfig, name: string) {
  return request<Channel>(cfg, 'POST', '/v1/channels', { name })
}

// 原話(message)已移至裝置端 DB(IndexedDB/sql.js),後端不再提供 messages 端點。
// owner 記事走 assist(),member 查詢走 semanticQuery()。

export function fetchMembers(cfg: ClientConfig, channelID: string) {
  return request<{ members: Member[] }>(
    cfg,
    'GET',
    `/v1/channels/${encodeURIComponent(channelID)}/members`,
  ).then((r) => r.members)
}

// 以 email 邀請使用者加入頻道;role 預設 viewer(僅 owner 能加)。
export function addMember(
  cfg: ClientConfig,
  channelID: string,
  email: string,
  role: ChannelRole = 'viewer',
) {
  return request<{ members: Member[] }>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/members`,
    { email, role },
  ).then((r) => r.members)
}

// 變更成員角色(editor/viewer);僅 owner 能改。
export function setMemberRole(
  cfg: ClientConfig,
  channelID: string,
  userID: string,
  role: ChannelRole,
) {
  return request<{ members: Member[] }>(
    cfg,
    'PATCH',
    `/v1/channels/${encodeURIComponent(channelID)}/members/${encodeURIComponent(userID)}`,
    { role },
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
    { question, lang: getAssistLang() },
  )
}

// present_entries 工具輸出、要展示給使用者的條目(不含 id/messageID)。
export interface PresentedEntry {
  title: string
  start: string
  startTime: string
  end: string
  endTime: string
}

// recommend_nearby 工具查到、要展示給使用者的一筆候選景點。
// 與後端 llm.AssistPlace/wanttools.RecommendedPlace 同形。
export interface AssistPlace {
  name: string
  address: string
  lat: number
  lng: number
  primaryType: string
}

// owner 統一輸入:LLM 自主判斷記錄事項或回答提問。
// recorded:原話不存後端,回 text(原話,前端存進裝置端 DB)+ entryIDs(新寫入條目);
//   前端據此重拉 entries 顯示,並把原話存入裝置 DB。
// answer:回 answer + entries(present_entries 輸出,可空)+ recommendedPlaces
//   (recommend_nearby 輸出,可空)——兩者都掛在觸發它們的那則答案訊息底下顯示,
//   而非全域彈出浮層(取代先前透過 WS recommended_places 事件的做法)。
export type AssistResult =
  | { kind: 'recorded'; text: string; entryIDs: string[] }
  | { kind: 'answer'; answer: string; entries: PresentedEntry[]; recommendedPlaces: AssistPlace[] }

// clientToolsSessionId:ChatScreen.tsx 另開的第二條 clienttools WS 連線
// (/internal/clienttools/ws)收到 ack 後拿到的 sessionId,讓後端的
// trip_entry_add/trip_entry_update 工具(取代 entry_add/entry_update,見
// server/internal/llm/assistant_agent.go)能透過這個 id 找到同一條 WS 連線、
// 把工具呼叫轉發回這個分頁執行(見 server/internal/clienttools/interaction.go)。
// undefined(第二條連線尚未連上)時後端仍會照常處理其餘工具,只有
// trip_entry_* 這幾個會失敗。
export function assist(cfg: ClientConfig, channelID: string, text: string, clientToolsSessionId?: string) {
  return request<AssistResult>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/assist`,
    { text, lang: getAssistLang(), clientToolsSessionId },
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

// geocodeEntry:對齊 server 的 POST /internal/entries/{id}/geocode
// (handleGeocodeEntry,見 entry_geocode.go)——用這筆 entry 現有的 title
// 當查詢字串,伺服器端呼叫 Geocoding API 查出座標後自動寫回 entry。用途:
// 配速表(PaceChart.tsx)點擊尚未有座標的檢查站卡片時,先呼叫這支端點
// 補上座標,成功後才把結果(lat/lng)交給地圖(PaceRouteMap.tsx)平移
// 過去——理由是「點卡片→地圖平移」這個既有互動假設 lat/lng 已知,沒座標
// 的卡片不能直接套用同一條路徑,得先補資料才有座標可以平移。
export function geocodeEntry(cfg: ClientConfig, entryID: string) {
  return request<{ entryID: string; query: string; address: string; lat: number; lng: number }>(
    cfg,
    'POST',
    `/internal/entries/${encodeURIComponent(entryID)}/geocode`,
    {},
  )
}

// 手動編輯條目(不經 AI),對齊 server 的 PATCH /v1/entries/{id}(handleUpdateEntry)。
// 只傳有要改的欄位:空字串/undefined 視為不改該欄位(見 store.UpdateEntry),
// 呼叫端不需帶齊 Entry 全部欄位,只需帶使用者在表單裡實際改過的值。
export interface UpdateEntryInput {
  title?: string
  start?: string
  startTime?: string
  end?: string
  endTime?: string
  location?: string
  note?: string
}

export function updateEntry(cfg: ClientConfig, entryID: string, input: UpdateEntryInput) {
  return request<{ updated: string }>(
    cfg,
    'PATCH',
    `/v1/entries/${encodeURIComponent(entryID)}`,
    input,
  )
}

// 重置:清空頻道的所有條目與行程(開發/測試用,限 owner)。
export function resetChannelData(cfg: ClientConfig, channelID: string) {
  return request<{ status: string }>(
    cfg,
    'DELETE',
    `/v1/channels/${encodeURIComponent(channelID)}/entries`,
  )
}

// ---- 旅程清單「儲存」按鈕專用的逐筆 upsert API(見 ChatScreen.tsx 的儲存邏輯)。
// 對齊後端 server/internal/api/api.go 新增的 handleCreateTripEntry/
// handleUpdateTripEntry/handleDeleteTripEntry,body/回應形狀直接沿用
// TripEntry 的欄位命名(title/date/time/note),不像 updateEntry() 那樣需要
// start/startTime 這種對齊 model.Entry 的命名轉換。

// 新增一筆旅程清單項目(不含 id,由後端產生)。對齊 POST /v1/channels/{id}/entries。
export function createTripEntry(
  cfg: ClientConfig,
  channelID: string,
  input: Omit<TripEntry, 'id'>,
) {
  return request<TripEntry>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/entries`,
    input,
  )
}

// 修改既有一筆旅程清單項目。對齊 PUT /v1/channels/{id}/entries/{entryID}。
export function updateTripEntry(
  cfg: ClientConfig,
  channelID: string,
  entryID: string,
  input: Omit<TripEntry, 'id'>,
) {
  return request<{ updated: string }>(
    cfg,
    'PUT',
    `/v1/channels/${encodeURIComponent(channelID)}/entries/${encodeURIComponent(entryID)}`,
    input,
  )
}

// 刪除既有一筆旅程清單項目。對齊 DELETE /v1/channels/{id}/entries/{entryID}。
export function deleteTripEntry(cfg: ClientConfig, channelID: string, entryID: string) {
  return request<{ deleted: string }>(
    cfg,
    'DELETE',
    `/v1/channels/${encodeURIComponent(channelID)}/entries/${encodeURIComponent(entryID)}`,
  )
}

// PublicLinkViewMode:公開分享頁要顯示「時間軸」還是「配速表」，對齊
// server/internal/store 的 view_mode 欄位（"pace" 以外一律視為 "timeline"）。
export type PublicLinkViewMode = 'timeline' | 'pace'

// 建立（或取得已有）頻道公開連結。viewMode 不傳時後端預設為 'timeline'。
export function createPublicLink(cfg: ClientConfig, channelID: string, editable: boolean, viewMode?: PublicLinkViewMode) {
  return request<{ linkToken: string; editable: boolean; viewMode: PublicLinkViewMode }>(
    cfg,
    'POST',
    `/v1/channels/${encodeURIComponent(channelID)}/public-link`,
    { editable, viewMode },
  )
}

// 取得頻道公開連結資訊。
export function getPublicLink(cfg: ClientConfig, channelID: string) {
  return request<{ linkToken: string; editable: boolean; viewMode: PublicLinkViewMode }>(
    cfg,
    'GET',
    `/v1/channels/${encodeURIComponent(channelID)}/public-link`,
  )
}

// 刪除頻道公開連結。
export function deletePublicLink(cfg: ClientConfig, channelID: string) {
  return request<{ status: string }>(
    cfg,
    'DELETE',
    `/v1/channels/${encodeURIComponent(channelID)}/public-link`,
  )
}

// 存取公開分享連結（無需登入）。
export function fetchPublicView(baseURL: string, token: string) {
  return fetch(`${baseURL}/v1/public/${encodeURIComponent(token)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{ channelID: string; channelName: string; editable: boolean; viewMode: PublicLinkViewMode; entries: Entry[] }>
    })
}

// 公開頁訪客送訊息（editable 連結專用）。
export function publicAssist(baseURL: string, token: string, text: string) {
  return fetch(`${baseURL}/v1/public/${encodeURIComponent(token)}/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: getAssistLang() }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })
}
