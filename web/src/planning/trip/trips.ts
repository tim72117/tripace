// trips.ts(planning/trip)——前端的「整趟行程(Trip)」概念,2026-10 新增(使用者明確要求「前端加入 Trip 概念,不一定要跟後端
// 一樣,之後再做整合」)。
//
// 一個 Trip 是比時間軸(PlanTimeline:天、站點、住宿)更大一層的容器:有自己的 id、名稱、建立/最後編輯時間,底下掛一份時間軸。
// 之後要掛更多東西(對話、成員、日期範圍、分享設定)都加在 Trip 上,不用再動時間軸本身。
//
// 刻意與後端 model.Trip 不同、也不接後端(之後整合時再決定對應方式):
//   - 後端 Trip 是團隊協作旅程(成員數、多人訊息、平面的 Entry 事項),前端 Trip 是「一份規劃」(天加站點加住宿)的容器;
//   - 前端 Trip 全部存在 localStorage,訪客也能用。
//
// 儲存:不搬動既有資料,沿用既有 key,所以第一次讀取時從舊結構「播種」,不改寫舊資料:
//   - 索引:TRIPS_INDEX_KEY(版本號加 activeTripId 加 trips 陣列);
//   - 時間軸:id 為 LEGACY_TRIP_ID 的 Trip 用原本固定的 PLAN_TIMELINE_STORAGE_KEY(/app 現在的那一份行程),其餘用草稿的
//     draftTimelineKey(id),所以既有草稿(drafts.ts)原封不動變成 Trip;
//   - 第一次讀到沒有索引時:把 drafts.ts 的草稿索引轉成 Trip,若固定 key 那份行程有內容再補一筆 legacy Trip,一次寫入索引。
// 時間軸的實際讀寫、版次(rev)與多實例同步完全沿用 storage.ts,這裡只管索引。
import { isTimelineEmpty, listNodes, type PlanTimeline } from '../timeline/model'
import {
  PLAN_TIMELINE_STORAGE_KEY,
  loadTimelineWithRevForKey,
  readRevForKey,
  saveTimelineForKey,
  type PlanTimelineStore,
} from '../timeline/storage'
import { LEGACY_DRAFT_ID, deriveDraftTitle, draftTimelineKey, readDraftsIndex } from '../timeline/drafts'

export const TRIPS_INDEX_KEY = 'tripace.planTrips'
export const LEGACY_TRIP_ID = LEGACY_DRAFT_ID
export const TRIPS_CHANGED_EVENT = 'tripace:planTripsChanged'
const TRIPS_INDEX_VERSION = 1
const FALLBACK_TRIP_TITLE = '新行程'
// TOUCH_INTERVAL_MS——touchTrip 在標題沒變時,最多每隔這麼久才更新一次最後編輯時間。
export const TOUCH_INTERVAL_MS = 30_000

// PlanTrip——一趟行程的索引資料(不含時間軸內容)。
//   name   使用者自己取的名稱;沒取就是 undefined,顯示時退回 title。
//   title  從時間軸內容自動推導的標題(每次存檔更新,見 deriveDraftTitle),不是使用者輸入。
export interface PlanTrip {
  id: string
  name?: string
  title: string
  createdAt: number
  updatedAt: number
}

interface TripsIndex {
  version: number
  activeTripId: string | null
  trips: PlanTrip[]
}

export function tripTimelineKey(tripId: string): string {
  return tripId === LEGACY_TRIP_ID ? PLAN_TIMELINE_STORAGE_KEY : draftTimelineKey(tripId)
}

// tripDisplayName——畫面上顯示的名稱:使用者取的名稱優先,否則自動標題。
export function tripDisplayName(trip: Pick<PlanTrip, 'name' | 'title'>): string {
  const name = trip.name?.trim()
  return name ? name : trip.title
}

export function sortTripsByRecent(trips: PlanTrip[]): PlanTrip[] {
  return [...trips].sort((a, b) => b.updatedAt - a.updatedAt)
}

function emitChanged(): void {
  try {
    window.dispatchEvent(new Event(TRIPS_CHANGED_EVENT))
  } catch {
    // 非瀏覽器環境沒有 window,忽略。
  }
}

// parseCache——最後一次解析的索引原始字串與結果。useTrips 的 getSnapshot 每次渲染都會讀索引,字串沒變就不重新解析。
// 回傳的索引物件被當唯讀使用(寫入時一律建新物件),共用同一份是安全的。
let parseCache: { raw: string; index: TripsIndex } | null = null

function parseIndex(raw: string | null): TripsIndex | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TripsIndex> | null
    if (!parsed || typeof parsed !== 'object' || parsed.version !== TRIPS_INDEX_VERSION || !Array.isArray(parsed.trips)) return null
    const trips: PlanTrip[] = []
    for (const t of parsed.trips as Partial<PlanTrip>[]) {
      if (!t || typeof t.id !== 'string' || typeof t.createdAt !== 'number') continue
      trips.push({
        id: t.id,
        name: typeof t.name === 'string' && t.name.trim() !== '' ? t.name : undefined,
        title: typeof t.title === 'string' && t.title.trim() !== '' ? t.title : FALLBACK_TRIP_TITLE,
        createdAt: t.createdAt,
        updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : t.createdAt,
      })
    }
    const activeTripId = typeof parsed.activeTripId === 'string' ? parsed.activeTripId : null
    return { version: TRIPS_INDEX_VERSION, activeTripId, trips }
  } catch {
    return null
  }
}

function writeIndex(index: TripsIndex): void {
  try {
    const raw = JSON.stringify(index)
    localStorage.setItem(TRIPS_INDEX_KEY, raw)
    parseCache = { raw, index }
  } catch {
    // 配額滿或隱私模式:索引寫不進去不影響時間軸本身,下次讀取會重新播種。
  }
  emitChanged()
}

// seedIndex——第一次沒有索引時,從舊結構(草稿索引加固定 key 那份行程)組出索引。不刪、不改舊資料。
function seedIndex(): TripsIndex {
  const trips: PlanTrip[] = readDraftsIndex().map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt }))
  if (!trips.some((t) => t.id === LEGACY_TRIP_ID)) {
    const { timeline } = loadTimelineWithRevForKey(PLAN_TIMELINE_STORAGE_KEY)
    if (!isTimelineEmpty(timeline)) {
      const now = Date.now()
      trips.push({ id: LEGACY_TRIP_ID, title: deriveDraftTitle(timeline), createdAt: now, updatedAt: now })
    }
  }
  const recent = sortTripsByRecent(trips)[0]
  return { version: TRIPS_INDEX_VERSION, activeTripId: recent?.id ?? null, trips }
}

function readIndex(): TripsIndex {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(TRIPS_INDEX_KEY)
  } catch {
    // 讀不到當作沒有索引。
  }
  if (raw && parseCache?.raw === raw) return parseCache.index
  const existing = parseIndex(raw)
  if (existing) {
    if (raw) parseCache = { raw, index: existing }
    return existing
  }
  const seeded = seedIndex()
  writeIndex(seeded)
  return seeded
}

export function listTrips(): PlanTrip[] {
  return sortTripsByRecent(readIndex().trips)
}

export function getTrip(tripId: string): PlanTrip | undefined {
  return readIndex().trips.find((t) => t.id === tripId)
}

// getActiveTripId——目前使用中的 Trip;索引裡沒有這一筆(被刪掉等)就退回最近編輯的,都沒有回 null(還沒有任何行程)。
export function getActiveTripId(): string | null {
  const index = readIndex()
  if (index.activeTripId && index.trips.some((t) => t.id === index.activeTripId)) return index.activeTripId
  return sortTripsByRecent(index.trips)[0]?.id ?? null
}

export function setActiveTrip(tripId: string): boolean {
  const index = readIndex()
  if (!index.trips.some((t) => t.id === tripId)) return false
  writeIndex({ ...index, activeTripId: tripId })
  return true
}

// createTrip——建立一趟新的(空白)行程並設為使用中。空白行程立刻進索引:使用者明確「建立」的東西不能因為還沒內容就消失
// (與 drafts.ts 的「空白草稿不進清單」不同,那是自動歸檔)。
export function createTrip(name?: string): PlanTrip {
  const index = readIndex()
  const now = Date.now()
  const trip: PlanTrip = { id: crypto.randomUUID(), name: name?.trim() || undefined, title: FALLBACK_TRIP_TITLE, createdAt: now, updatedAt: now }
  writeIndex({ ...index, activeTripId: trip.id, trips: [...index.trips, trip] })
  return trip
}

// renameTrip——改名;傳空字串清掉使用者名稱(退回自動標題)。找不到回 false。
export function renameTrip(tripId: string, name: string): boolean {
  const index = readIndex()
  if (!index.trips.some((t) => t.id === tripId)) return false
  const trimmed = name.trim()
  writeIndex({ ...index, trips: index.trips.map((t) => (t.id === tripId ? { ...t, name: trimmed || undefined } : t)) })
  return true
}

// deleteTrip——刪除一趟行程:索引項目與它的時間軸一併移除(legacy 那份也會清掉固定 key)。刪的是使用中的就改選最近編輯的。
export function deleteTrip(tripId: string): boolean {
  const index = readIndex()
  if (!index.trips.some((t) => t.id === tripId)) return false
  try {
    localStorage.removeItem(tripTimelineKey(tripId))
  } catch {
    // 移除失敗不阻擋索引更新。
  }
  const trips = index.trips.filter((t) => t.id !== tripId)
  const activeTripId =
    index.activeTripId === tripId || !trips.some((t) => t.id === index.activeTripId) ? sortTripsByRecent(trips)[0]?.id ?? null : index.activeTripId
  writeIndex({ ...index, activeTripId, trips })
  return true
}

// touchTrip——時間軸存檔後呼叫:更新自動標題與最後編輯時間。索引裡沒有這一筆就補上(例如 legacy 行程在播種之後才有內容);
// 空時間軸不補(同 drafts.ts:空的東西不該憑空長出清單項目),但已存在的仍更新時間。
export function touchTrip(tripId: string, timeline: PlanTimeline): void {
  const index = readIndex()
  const existing = index.trips.find((t) => t.id === tripId)
  if (!existing && isTimelineEmpty(timeline)) return
  const now = Date.now()
  const title = isTimelineEmpty(timeline) ? existing?.title ?? FALLBACK_TRIP_TITLE : deriveTripTitle(timeline)
  // 節流:標題沒變、且距離上次記錄的編輯時間不到 TOUCH_INTERVAL_MS 就不寫索引也不通知——時間軸每次存檔都會走到這裡,
  // 每次都寫 localStorage 並讓訂閱者(useTrips)重繪不值得;「最後編輯時間」最多落後這個區間。
  if (existing && existing.title === title && now - existing.updatedAt < TOUCH_INTERVAL_MS) return
  const next: PlanTrip = existing ? { ...existing, title, updatedAt: now } : { id: tripId, title, createdAt: now, updatedAt: now }
  writeIndex({
    ...index,
    activeTripId: index.activeTripId ?? tripId,
    trips: existing ? index.trips.map((t) => (t.id === tripId ? next : t)) : [...index.trips, next],
  })
}

export function deriveTripTitle(timeline: PlanTimeline): string {
  return listNodes(timeline).length === 0 ? FALLBACK_TRIP_TITLE : deriveDraftTitle(timeline)
}

// createTripTimelineStore——某一趟行程的時間軸 store(符合 PlanTimelineStore,餵給 TripPlanPage 的 store prop)。
// 讀寫與版次沿用 storage.ts;存檔成功後 touchTrip 更新索引。
export function createTripTimelineStore(tripId: string): PlanTimelineStore {
  const key = tripTimelineKey(tripId)
  return {
    readRev: () => readRevForKey(key),
    loadTimelineWithRev: () => loadTimelineWithRevForKey(key),
    saveTimeline: (timeline, baseRev) => {
      const newRev = saveTimelineForKey(key, timeline, baseRev)
      if (newRev !== null) touchTrip(tripId, timeline)
      return newRev
    },
  }
}
