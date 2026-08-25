// API client。
// 每次呼叫都產生一筆 ApiCall 交易紀錄(含原始 request/response、狀態碼、耗時),
// 無論成功或失敗都會記錄,供 debug panel 顯示,方便排查問題。

import type { Entry } from './types'
import type { Trip } from './trip/types'
import type { AuthResponse, TripRole, Me, Member } from './user/types'
import type { TripEntry } from './clienttools/tripEntryTools'

// 後端統一錯誤格式:{ "error": { "code", "message" } }——純 API 層錯誤
// 格式,不是業務型別,不放 types.ts(理由同該檔案開頭的說明)。
export interface APIErrorBody {
  error: {
    code: string
    message: string
  }
}

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
  tripID: string | null
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
    tripID: typeof raw.tripID === 'string' ? raw.tripID : null,
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

export function fetchTrips(cfg: ClientConfig) {
  return request<{ trips: Trip[] }>(cfg, 'GET', '/v1/trips').then(
    (r) => r.trips,
  )
}

export function createTrip(cfg: ClientConfig, name: string) {
  return request<Trip>(cfg, 'POST', '/v1/trips', { name })
}

// 原話(message)已移至裝置端 DB(IndexedDB/sql.js),後端不再提供 messages 端點。
// owner 記事走 assist(),member 查詢走 semanticQuery()。

export function fetchMembers(cfg: ClientConfig, tripID: string) {
  return request<{ members: Member[] }>(
    cfg,
    'GET',
    `/v1/trips/${encodeURIComponent(tripID)}/members`,
  ).then((r) => r.members)
}

// 以 email 邀請使用者加入行程;role 預設 viewer(僅 owner 能加)。
export function addMember(
  cfg: ClientConfig,
  tripID: string,
  email: string,
  role: TripRole = 'viewer',
) {
  return request<{ members: Member[] }>(
    cfg,
    'POST',
    `/v1/trips/${encodeURIComponent(tripID)}/members`,
    { email, role },
  ).then((r) => r.members)
}

// 變更成員角色(editor/viewer);僅 owner 能改。
export function setMemberRole(
  cfg: ClientConfig,
  tripID: string,
  userID: string,
  role: TripRole,
) {
  return request<{ members: Member[] }>(
    cfg,
    'PATCH',
    `/v1/trips/${encodeURIComponent(tripID)}/members/${encodeURIComponent(userID)}`,
    { role },
  ).then((r) => r.members)
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

// 取行程的 Entry 條目(LLM record_entry 工具處理後的結果)。
export function fetchEntries(cfg: ClientConfig, tripID: string) {
  return request<{ entries: Entry[] }>(
    cfg,
    'GET',
    `/v1/trips/${encodeURIComponent(tripID)}/entries`,
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

// 地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)用:
// 對齊 server 的 GET /internal/geo/attractions(handleGeoAttractions)。
// landmarkPhotoUrl 若有值,是後端已編碼好的 data: URI(base64,含 MIME
// type),圖片資料直接內嵌在回應裡,可以直接當 <img src> 用,不需要
// 額外拼接網址或發第二次請求。
export interface GeoAttraction {
  name: string
  lat: number
  lng: number
  // placeCount:只有走即時查 Google Places 的路徑(SearchDistricts/
  // SearchKnownDistricts)才會有值——後端該欄位帶 json 的 omitempty,
  // 走資料庫路徑(人工建檔的 model.Attraction)組回應時完全不設這個
  // 欄位,JSON 回應裡不會出現這個 key,故這裡不能宣告成必定存在的
  // number,否則型別與實際執行期契約不符。
  placeCount?: number
  landmarkPhotoUrl?: string
  landmarkName?: string
  // radiusMeters:只有走後端手動整理的觀光慣稱分區資料(如清邁的
  // 古城區/尼曼區,見 server/internal/geo/district_aliases.go)才會有
  // 值,泛用的 addressComponents 分組沒有實際邊界資料,固定不帶這個
  // 欄位——前端據此判斷要不要在地圖上畫範圍圓圈。
  radiusMeters?: number
  // summary:該區代表性地標的 Google editorialSummary,當這區的白話
  // 簡介用(不是 LLM 生成)。地標沒有這欄位資料時為 undefined。
  summary?: string
  // level:知名度分級,1(國際)~5(在地),只有走後端資料庫路徑
  // (server/internal/api/geo_outline.go 的 store.ListAttractionsByCity)
  // 才會有值——即時查 Google Places 的結果沒有分級資訊,固定不帶這個
  // 欄位。前端依此決定隨縮放層級顯示哪些粒度,見 GeoOutlineMap.tsx。
  level?: number
}

// GeoHotel:地理輪廓底圖上疊加的飯店圖層單筆結果,對齊後端
// geo.NearbyPlace(server/internal/geo/places.go)——固定用泛用的
// lodging 類型查詢(不細分 hotel/hostel/inn 等子類),見
// handleGeoAttractions 的說明。
export interface GeoHotel {
  name: string
  address: string
  lat: number
  lng: number
  primaryType: string
  // photoUrl:後端已編碼好的 data: URI,理由同 GeoAttraction.landmarkPhotoUrl。
  // 部分飯店在 Google 端沒有照片、或下載失敗時為 undefined。
  photoUrl?: string
}

export function fetchGeoAttractions(cfg: ClientConfig, city: string) {
  return request<{ city: string; attractions: GeoAttraction[]; hotels: GeoHotel[] }>(
    cfg,
    'GET',
    `/internal/geo/attractions?city=${encodeURIComponent(city)}`,
  )
}

// GeoGeocodeCandidate:fetchGeoGeocode 單筆候選地點——對齊後端
// handleGeoGeocode 的回應形狀(見該函式的說明)。搜尋本身只查免費的
// Essentials 級欄位(不含照片/評分/簡介,理由見後端 geo.Client.Search
// 的 fieldMask 說明),placeId 供使用者點選候選後另外呼叫
// fetchGeoPlaceDetails 補查完整資訊(含照片,Pexels-first + GCS 落地,
// 跟點地圖上原生 POI 走同一套流程)——選填,理論上 Text Search 每筆
// 結果都會有,查無則省略。
export interface GeoGeocodeCandidate {
  name: string
  address: string
  lat: number
  lng: number
  placeId?: string
}

// 對齊 server 的 GET /internal/geo/geocode(handleGeoGeocode)——把輸入
// 字串解析成一組候選地點清單(座標),不查詢景點區域/飯店資料。地理
// 輪廓底圖的城市搜尋框用這支端點,回傳多筆候選(改走 Places API Text
// Search,對城市/觀光區這類口語化地名支援較差的 Geocoding API 已不再
// 使用,見後端該函式的完整說明)供地圖標出來讓使用者自己點選確認,不再
// 像過去只回一組座標、猜錯了無法挑選——查完選定其中一筆後,畫面上該
// 顯示什麼資料交給 fetchGeoAttractionsNearby 依地圖當時的可視範圍另外
// 查詢。這支端點原本設計給城市/地標名稱這類定位用途,但實際使用上也會
// 直接輸入「甜點」這類泛用關鍵字——bias(選填,通常是目前地圖中心座標)
// 讓這類查詢優先偏向該區域附近的結果(見後端 handleGeoGeocode 的
// locationBias 完整說明),對「京都」這類文字意圖已經很明確的地名查詢
// 幾乎不影響。不傳 bias 時退回純文字查詢,不套用任何位置偏向。
export function fetchGeoGeocode(cfg: ClientConfig, query: string, bias?: { lat: number; lng: number }) {
  const biasParams = bias ? `&biasLat=${bias.lat}&biasLng=${bias.lng}` : ''
  return request<{ query: string; candidates: GeoGeocodeCandidate[] }>(
    cfg,
    'GET',
    `/internal/geo/geocode?query=${encodeURIComponent(query)}${biasParams}`,
  )
}

// 對齊 server 的 GET /internal/geo/attractions/nearby
// (handleGeoAttractionsNearby)——依座標 bounding box 查詢,不依賴城市名稱
// 字串比對。供地圖平移/縮放時「地圖移動到哪就查哪」使用,不需要使用者
// 先輸入城市名稱、按查看鈕才看得到資料。只查自建資料庫(model.Attraction),
// 不像 fetchGeoAttractions 那樣有即時查 Google Places 的 fallback——理由
// 見後端該支 handler 的說明(避免地圖高頻移動時產生大量非預期的第三方
// API 呼叫成本)。
export function fetchGeoAttractionsNearby(cfg: ClientConfig, lat: number, lng: number, radiusMeters?: number) {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  if (radiusMeters != null) params.set('radius', String(radiusMeters))
  return request<{ attractions: GeoAttraction[]; hotels: GeoHotel[] }>(
    cfg,
    'GET',
    `/internal/geo/attractions/nearby?${params.toString()}`,
  )
}

// 對齊 server 的 GET /internal/geo/attractions/nearby-only
// (handleGeoAttractionsOnlyNearby)——跟 fetchGeoAttractionsNearby 查同一份
// 景點區域資料,但不附帶 hotels(即時查 Google Places、直接計費)。這支
// 端點查詢本身免費,故 GeoOutlineMap.tsx 用它做地圖 idle(拖曳/縮放停止)
// 時的自動查詢,不需要像飯店那樣收在使用者明確按下「搜尋這個區域」
// 按鈕之後才觸發。
export function fetchGeoAttractionsOnlyNearby(cfg: ClientConfig, lat: number, lng: number, radiusMeters?: number) {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  if (radiusMeters != null) params.set('radius', String(radiusMeters))
  return request<{ attractions: GeoAttraction[] }>(
    cfg,
    'GET',
    `/internal/geo/attractions/nearby-only?${params.toString()}`,
  )
}

// GeoPlace:不限類型的附近推薦地點(景點/餐廳/商店等),對齊後端
// placeResponse(server/internal/api/geo_outline.go 的 handleGeoPlacesNearby)。
// 形狀與 GeoHotel 相同,但語意上是「點擊地標查詢附近推薦」而非「地圖
// 上常駐的飯店圖層」,故另外命名,不共用 GeoHotel 型別。
export interface GeoPlace {
  name: string
  address: string
  lat: number
  lng: number
  primaryType: string
  // category:後端把 primaryType(Google 原始細分類型,如 "hotel"/
  // "japanese_restaurant")封裝過的自訂分類,值域固定是
  // 'lodging'/'tourist_attraction'/'restaurant' 其中之一(對齊地圖上方
  // 類別標籤,見 GeoOutlineMap.tsx 的 CATEGORY_TAGS),查無對應分類時為
  // 空字串/undefined。前端分類判斷(圖示、entry kind 推導等)一律讀這個
  // 欄位,不要自己再解讀 primaryType——直接拿 primaryType 跟這三個查詢用
  // 的類型字面值比對幾乎必定失敗(Google 回傳的是更精確的細分類型,不是
  // 查詢用的類型本身),這是實際發生過的 bug。primaryType 保留純供
  // 除錯/未來需要更細分類時使用。
  category?: string
  photoUrl?: string
}

// GeoTripEntry:行程本身已有座標的 entry,轉成地理輪廓底圖圖層通用的
// name/lat/lng 形狀,供 GeoOutlineMap 畫 marker、GeoCandidateSidebar
// 顯示用——欄位命名對齊 GeoHotel/GeoPlace(而非直接重用 Entry,因為
// Entry 的欄位是 title/location,語意上屬於行程資料,不是地理圖層資料,
// 混用會讓兩套型別的職責模糊)。id 保留供候選籃移除比對用(entry 有
// 穩定 id,不像飯店/推薦地點只能用名稱+座標當識別鍵)。
export interface GeoTripEntry {
  id: string
  name: string
  lat: number
  lng: number
  location?: string | null
  kind?: string | null
  // start/startTime:對齊 Entry 的同名欄位,供 GeoCandidateSidebar 的
  // 「已排入行程」分組依日期歸類、仿構想 5 原型日層架的呈現方式(見該
  // 元件說明)——沒有 start 的 entry(尚未排定日期)歸進「未排定日期」
  // 分組,理由同 Timeline.tsx 對無日期 entry 的處理。
  start?: string | null
  startTime?: string | null
}

// 對齊 server 的 GET /internal/geo/places/nearby(handleGeoPlacesNearby)——
// 即時查 Google Places Nearby Search,供兩種情境使用:地圖上點擊地標
// (不帶 type,不限類型,見 GeoOutlineMap.tsx 點擊地標的說明)、或地圖
// 上方的類別標籤列(帶 type,限定單一類別,見該檔案的說明)。這是使用者
// 明確點擊觸發的低頻動作,不像 fetchGeoAttractionsNearby 那樣顧慮地圖
// 高頻移動的 API 呼叫成本,故直接即時查 Places API。
//
// type 只接受後端白名單認可的值(見 geo_outline.go 的
// allowedPlaceTypes):'lodging'(飯店)/'tourist_attraction'(景點)/
// 'restaurant'(餐廳),帶不支援的值會被後端拒絕(400)。
export function fetchGeoPlacesNearby(
  cfg: ClientConfig,
  lat: number,
  lng: number,
  radiusMeters?: number,
  type?: string,
) {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  if (radiusMeters != null) params.set('radius', String(radiusMeters))
  if (type) params.set('type', type)
  return request<{ places: GeoPlace[] }>(cfg, 'GET', `/internal/geo/places/nearby?${params.toString()}`)
}

// GeoPlaceDetails:對齊 server 的 GET /internal/geo/place-details
// (handleGeoPlaceDetails)——單一地點的詳細資訊,供「使用者點擊地圖上
// Google 原生 POI 圖標」情境使用。原生 POI 點擊只會拿到一個 placeId,
// 沒有附帶任何名稱/地址/介紹等資料(見 GeoOutlineMap.tsx 攔截
// IconMouseEvent 的說明),必須再打這支端點查詳細內容。
export interface GeoPlaceDetails {
  name: string
  address: string
  lat: number
  lng: number
  rating?: number
  summary?: string
  photoUrl?: string
}

export function fetchGeoPlaceDetails(cfg: ClientConfig, placeId: string) {
  return request<GeoPlaceDetails>(cfg, 'GET', `/internal/geo/place-details?placeId=${encodeURIComponent(placeId)}`)
}

// fetchGeoPlacePhoto:GET /internal/geo/place-details 的 photoOnly=1 模式
// (見後端 handleGeoPlaceDetails 的說明)——只查/回傳照片,不含 name/
// address/rating/summary,供 GeoHotelSidebar.tsx 搜尋結果清單的延遲載入
// 使用(GeocodeCandidateItem,項目捲進可視範圍才觸發)。跟一般的
// fetchGeoPlaceDetails 是同一支後端端點、同一套快取,只是這個模式下
// 快取未命中時只試 Pexels、不 fallback 較貴的 Google GetPlaceDetails/
// Photo Media(理由見後端說明),成本上限比完整查詢低很多——一次搜尋
// 清單最多 20 筆,適合逐一延遲觸發。name 是清單本身已經有的候選名稱
// (來自 fetchGeoGeocode 的 Text Search 結果),快取未命中時後端拿去查
// Pexels,不需要為了拿名稱多打一次 Google Details。
export function fetchGeoPlacePhoto(cfg: ClientConfig, placeId: string, name: string) {
  return request<{ photoUrl?: string }>(
    cfg,
    'GET',
    `/internal/geo/place-details?placeId=${encodeURIComponent(placeId)}&photoOnly=1&name=${encodeURIComponent(name)}`,
  )
}

// GeoPlaceText:fetchGeoPlaceText 的回應形狀——GeoPlaceDetails 扣掉
// photoUrl,理由見該函式的說明。
export type GeoPlaceText = Omit<GeoPlaceDetails, 'photoUrl'>

// fetchGeoPlaceText:GET /internal/geo/place-details 的 textOnly=1 模式
// (見後端 handleGeoPlaceDetails 的說明)——只查/回傳文字資訊(名稱/
// 地址/評分/簡介),不含照片,供 GeoOutlinePanel.tsx 的
// handleGeocodeCandidateSelect 使用:使用者點選候選後,先打這支立即
// 拿到文字資訊開啟資訊卡(此時沒有 photoUrl,前端顯示佔位圖),不必
// 等照片查完才有畫面反應;照片另外並行呼叫 fetchGeoPlacePhoto 取得,
// 查到後再補上實際圖片——兩支請求平行發出,不互相等待。跟 photoOnly
// 對稱:快取未命中時完全跳過照片查詢,成本比完整查詢低。
export function fetchGeoPlaceText(cfg: ClientConfig, placeId: string) {
  return request<GeoPlaceText>(
    cfg,
    'GET',
    `/internal/geo/place-details?placeId=${encodeURIComponent(placeId)}&textOnly=1`,
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

// recordEntryInput/recordEntry:對齊後端 POST /internal/trips/{id}/entries
// (handleInternalRecord)——新增一筆帶 title/start/location 的 entry,回傳
// 新條目的 id。跟上面 createTripEntry(POST /v1/trips/{id}/entries)是完全
// 不同的兩支端點:createTripEntry 對齊「旅程清單」表格功能(TripEntry 形狀,
// title/date/time/note,無座標概念);這支對齊 model.Entry(跟
// updateEntry/fetchEntries 同一份資料),供 GeoCandidateSidebar 把候選籃
// 項目(飯店/景點/推薦地點)拖進日層架、真正寫成一筆行程 entry 時使用——
// 這支端點本身不接受 lat/lng,寫完後要另外呼叫 setEntryLatLng 補上座標。
export interface RecordEntryInput {
  title: string
  start?: string
  startTime?: string
  end?: string
  endTime?: string
  location?: string
  // kind:條目類型("stay"|"flight"|"activity"|"note"|"car"|"restaurant"|
  // "ticket",對齊 model.Entry.Kind)——GeoCandidateSidebar.tsx 把候選籃
  // 項目(飯店/景點/推薦地點)拖進日層架時,帶入該候選原本的分類,讓新
  // entry 保留分類資訊(不帶則後端建立時不分類,沿用既有行為)。
  kind?: string
}

export function recordEntry(cfg: ClientConfig, tripID: string, input: RecordEntryInput) {
  return request<{ entryID: string }>(
    cfg,
    'POST',
    `/internal/trips/${encodeURIComponent(tripID)}/entries`,
    input,
  )
}

// 對齊後端 PATCH /internal/entries/{id}/latlng(handleInternalSetLatLng)
// ——recordEntry 建立的 entry 預設沒有座標,候選籃項目(飯店/景點/推薦
// 地點)本身已經有查詢到的 lat/lng,建立後這裡補一次座標,讓新條目跟其餘
// 「已排入行程」的項目一樣能畫在地理輪廓底圖上。
export function setEntryLatLng(cfg: ClientConfig, entryID: string, lat: number, lng: number) {
  return request<{ updated: string }>(
    cfg,
    'PATCH',
    `/internal/entries/${encodeURIComponent(entryID)}/latlng`,
    { lat, lng },
  )
}

// 對齊後端 DELETE /internal/entries/{id}(handleInternalDeleteEntry)——刪除
// 單一 model.Entry(跟 recordEntry/setEntryLatLng/updateEntry 同一份資料,
// 不是 TripEntry「旅程清單」表格的 deleteTripEntry)。供 GeoCandidateSidebar
// 「返回候選」按鈕使用:已排入行程的項目(kind==='entry')退回候選籃時,
// 該筆 entry 已經是真正的資料庫記錄,只從前端候選籃 state 移除不夠(見
// onRemove 既有行為,重新整理頁面/onTripEntriesChange 重新查詢時又會出現)
// ——必須真的呼叫刪除,才能讓它不再是「已排入行程」。
export function deleteEntry(cfg: ClientConfig, entryID: string) {
  return request<{ deleted: string }>(
    cfg,
    'DELETE',
    `/internal/entries/${encodeURIComponent(entryID)}`,
  )
}

// 重置:清空行程的所有條目(開發/測試用,限 owner)。
export function resetTripData(cfg: ClientConfig, tripID: string) {
  return request<{ status: string }>(
    cfg,
    'DELETE',
    `/v1/trips/${encodeURIComponent(tripID)}/entries`,
  )
}

// ---- 旅程清單「儲存」按鈕專用的逐筆 upsert API(見 ChatScreen.tsx 的儲存邏輯)。
// 對齊後端 server/internal/api/api.go 新增的 handleCreateTripEntry/
// handleUpdateTripEntry/handleDeleteTripEntry,body/回應形狀直接沿用
// TripEntry 的欄位命名(title/date/time/note),不像 updateEntry() 那樣需要
// start/startTime 這種對齊 model.Entry 的命名轉換。

// 新增一筆旅程清單項目(不含 id,由後端產生)。對齊 POST /v1/trips/{id}/entries。
export function createTripEntry(
  cfg: ClientConfig,
  tripID: string,
  input: Omit<TripEntry, 'id'>,
) {
  return request<TripEntry>(
    cfg,
    'POST',
    `/v1/trips/${encodeURIComponent(tripID)}/entries`,
    input,
  )
}

// 修改既有一筆旅程清單項目。對齊 PUT /v1/trips/{id}/entries/{entryID}。
export function updateTripEntry(
  cfg: ClientConfig,
  tripID: string,
  entryID: string,
  input: Omit<TripEntry, 'id'>,
) {
  return request<{ updated: string }>(
    cfg,
    'PUT',
    `/v1/trips/${encodeURIComponent(tripID)}/entries/${encodeURIComponent(entryID)}`,
    input,
  )
}

// 刪除既有一筆旅程清單項目。對齊 DELETE /v1/trips/{id}/entries/{entryID}。
export function deleteTripEntry(cfg: ClientConfig, tripID: string, entryID: string) {
  return request<{ deleted: string }>(
    cfg,
    'DELETE',
    `/v1/trips/${encodeURIComponent(tripID)}/entries/${encodeURIComponent(entryID)}`,
  )
}

// PublicLinkViewMode:公開分享頁要顯示「時間軸」還是「配速表」，對齊
// server/internal/store 的 view_mode 欄位（"pace" 以外一律視為 "timeline"）。
export type PublicLinkViewMode = 'timeline' | 'pace'

// 建立（或取得已有）行程公開連結。viewMode 不傳時後端預設為 'timeline'。
export function createPublicLink(cfg: ClientConfig, tripID: string, editable: boolean, viewMode?: PublicLinkViewMode) {
  return request<{ linkToken: string; editable: boolean; viewMode: PublicLinkViewMode }>(
    cfg,
    'POST',
    `/v1/trips/${encodeURIComponent(tripID)}/public-link`,
    { editable, viewMode },
  )
}

// 取得行程公開連結資訊。
export function getPublicLink(cfg: ClientConfig, tripID: string) {
  return request<{ linkToken: string; editable: boolean; viewMode: PublicLinkViewMode }>(
    cfg,
    'GET',
    `/v1/trips/${encodeURIComponent(tripID)}/public-link`,
  )
}

// 刪除行程公開連結。
export function deletePublicLink(cfg: ClientConfig, tripID: string) {
  return request<{ status: string }>(
    cfg,
    'DELETE',
    `/v1/trips/${encodeURIComponent(tripID)}/public-link`,
  )
}

// 存取公開分享連結（無需登入）。
export function fetchPublicView(baseURL: string, token: string) {
  return fetch(`${baseURL}/v1/public/${encodeURIComponent(token)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{ tripID: string; tripName: string; editable: boolean; viewMode: PublicLinkViewMode; entries: Entry[] }>
    })
}

