// storage.ts(planning/timeline)— 規劃時間軸(PlanTimeline,見 model.ts)的
// 前端持久化層。獨立成這個檔案而非塞進 model.ts,是為了讓「資料結構
// 與操作」跟「怎麼存」兩件事各自獨立:model.ts 維持純函式、不碰任何
// 瀏覽器 API(測試不需要 mock localStorage),這裡只負責序列化與讀寫。
//
// 2026-10 新增,使用者明確要求「將 ai plan 規劃的內容寫到前端持久化,持久化
// 的原件要獨立可以共用,然後對話內的規劃內容也用相同的原件持久化」——
// /app/plan-ai(planning/panel/TripPlanPage.tsx)與地圖規劃的對話視窗
// (chat/ChatScreen.tsx)共用這同一個元件、也共用同一份資料(使用者確認
// 「共用同一份,兩處看到一樣的內容」),在任一處規劃的結果,另一處打開就
// 看得到。
//
// 不跟 trip 綁定(使用者明確要求「不要跟 trip 有關聯」)——storage key 是
// 固定字串,不帶 tripId,切換行程不會換掉這條時間軸。這跟 trip_entry_*
// 那套寫進資料庫、依行程分別儲存的正式行程資料是兩種不同性質的東西:
// 這裡存的是「對話規劃過程中的時間軸」,是跨行程的單一草稿。
//
// 為什麼需要自訂序列化與解析:寫入時帶版本號與版次(rev),讀回時做完整的形狀檢查、
// 把舊格式(版本 1 鏈結串列、舊欄位、舊型別節點)轉成現在的形狀,解析失敗時備份原始內容——
// 呼叫端不需要各自記得處理。(版本 1 時 PlanTimeline.nodes 是 Map,JSON.stringify 對 Map 會輸出 {},
// 當時要轉成 [key, value] 陣列再存;2026-10-24 改成依天分組的陣列後,days 可以直接序列化。)

import type { PlanDay, PlanLodging, PlanNode, PlanTimeline } from './model'
import { createEmptyTimeline } from './model'

// STORAGE_KEY 沿用專案既有的 tripace.* 前綴慣例(見 assistLang.ts 的
// ASSIST_LANG_KEY、hooks/useAppState.ts 的 AUTH_* 系列)。
export const PLAN_TIMELINE_STORAGE_KEY = 'tripace.planTimeline'

// STORAGE_VERSION — 寫入時一併存進去,讀取時不符就整份丟棄、回到空時間軸。
// PlanNodeData 的欄位會隨功能演進增減(見該介面的完整說明,光是 2026-09~10
// 就加過 day/note/transitFromPrev 等欄位),舊版殘留在
// localStorage 的資料結構對不上新版程式碼時,與其讓畫面渲染出半殘的節點
// (例如缺 type 欄位導致 PlanTimelineView 的分支判斷全部落空),不如直接
// 當成沒有資料。版本號只在「結構不相容」時才需要進位,純粹新增選填欄位
// 不需要動它(舊資料少那個欄位,讀回來是 undefined,跟沒設定過一樣)。2026-10 把 loading/failed/removing/
// googlePhotoUrls 搬出節點也沒有進位:新格式只是「少欄位」,舊草稿多出來的那幾個欄位在載入時丟掉
// (見 dropLegacyRuntimeFields),不需要整份作廢。
const STORAGE_VERSION = 2
// 版本 1(鏈結串列:headId + nodes entries,節點帶 prevId/nextId/day)讀進來時轉成現在的依天分組格式(見 migrateV1),
// 寫出一律是版本 2——使用者已存的草稿不會因為結構改版而消失。
const LEGACY_LINKED_LIST_VERSION = 1

// PersistedTimeline — 實際寫進 localStorage 的形狀:版本 2 是 days(依天分組)+ lodgings + rev;
// headId/nodes(Map 轉成的 entries 陣列)是版本 1 的欄位,只在讀舊草稿時出現。
interface PersistedTimeline {
  version: number
  days?: { id: string; nodes: PlanNode[] }[]
  // 住宿(2026-10-24 起獨立存放,見 PlanTimeline.lodgings);舊草稿沒有這個欄位。
  lodgings?: PlanLodging[]
  // 版本 1 的欄位(只讀,見 migrateV1)。
  headId?: string | null
  nodes?: [string, PlanNode & { prevId?: string | null; nextId?: string | null }][]
  // rev — 每次寫入遞增的版次。用來讓「同時掛載的多份 TripPlanPage」
  // (地圖規劃面板常駐掛載 + /app/plan-ai 全頁,切到該分頁時兩份同時
  // 存在)判斷「我手上這份是不是已經被另一份覆寫過了」。
  //
  // 沒有這個欄位時曾經是真實的資料遺失路徑:兩份各自在掛載當下讀一次
  // localStorage 後就不再重讀,在全頁版規劃完切回地圖,規劃面板那份仍是
  // 掛載時的舊內容(常是空的),它下一次寫入就把剛規劃好的全部蓋掉。
  rev?: number
}

// readRevForKey/loadTimelineWithRevForKey/saveTimelineForKey——2026-10
// 新增(見 planning/timeline/drafts.ts 的完整背景說明):把原本寫死
// PLAN_TIMELINE_STORAGE_KEY 的 readRev/loadTimelineWithRev/saveTimeline
// 三個函式參數化成「可以指定任意 localStorage key」的版本,序列化格式/
// 版本檢查/rev 機制完全不變,只是多一個 key 參數——讓「多份行程草稿」
// (每份各自存在獨立 key 底下)能重用同一套既有邏輯,不需要重新發明一套
// 存檔格式。下方既有的 readRev/loadTimelineWithRev/saveTimeline(固定用
// PLAN_TIMELINE_STORAGE_KEY)全部改成呼叫這幾個 ForKey 版本、傳入固定
// key——這是純粹的內部重構,這三個既有函式自己的簽名/行為/呼叫端完全
// 不受影響。
export function readRevForKey(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const p = JSON.parse(raw) as Partial<PersistedTimeline>
    return typeof p?.rev === 'number' ? p.rev : 0
  } catch {
    return 0
  }
}

// readRev — 只讀版次,不解析整份內容(寫入前的比對用,避免每次寫入都
// 付出完整反序列化與形狀驗證的成本)。讀不到/格式不符一律當 0,呼叫端
// 據此判定為「沒有更新的版本」。
export function readRev(): number {
  return readRevForKey(PLAN_TIMELINE_STORAGE_KEY)
}

// dropLegacyRuntimeFields——舊草稿的節點可能帶「執行狀態與查詢結果」欄位,載入時一律丟掉:
//   loading/removing  只在當次畫面有意義(查詢與淡出計時器隨頁面關閉消失),照舊存回會變成永遠轉圈、永遠淡出不掉的節點;
//   failed            改由獨立的節點狀態表(status.ts,不持久化)表達。重整後的「失敗」由資料本身判斷:
//                     有 placeId 但沒座標(stopLookupFailed),載入後的掛載重試會重查,不需要存「失敗」這個結果;
//   googlePhotoUrls   照片一律是執行時經資料存取層查回來的結果(Google 照片網址有時效,存下來的拷貝可能已失效),
//                     站點照片由 planning/data/store.ts(React 端 useResolvedRefs)以 placeId 解析,不放在節點上。
// 存檔時不需要再特地剝(型別已經沒有這些欄位,節點上不會有),所以只在載入這一側處理。
// 沒有這些欄位時原樣回傳同一個物件。
const LEGACY_RUNTIME_FIELDS = ['loading', 'failed', 'removing', 'googlePhotoUrls'] as const
function dropLegacyRuntimeFields(node: PlanNode): PlanNode {
  if (!LEGACY_RUNTIME_FIELDS.some((k) => k in node)) return node
  const rest = { ...node } as Record<string, unknown>
  for (const k of LEGACY_RUNTIME_FIELDS) delete rest[k]
  return rest as unknown as PlanNode
}

// migrateLegacyNode——載入時套在每個節點上的舊資料轉換:子景點 children 轉 id、丟掉執行狀態欄位。
function migrateLegacyNode(node: PlanNode): PlanNode {
  return dropStaleTransitLoading(dropLegacyRuntimeFields(migrateLegacyChildren(node)))
}

// dropStaleTransitLoading——節點的 transitFromPrev.loading === true 是「交通資訊查詢中」的暫時狀態(見 TransitInfo.loading):
// 查詢是記憶體裡的非同步動作,若查詢途中就關掉頁面,存下來的 loading:true 永遠沒有人把它翻回來,重開後交通膠囊會一直轉圈。
// 載入時把 loading 為 true 的 transitFromPrev 整個清掉(沒有任何查詢結果可保留,等同「從沒查過」,
// 之後該站的前一站有變動或使用者操作時會重新查詢);loading 為 false/沒有的(已有結果)原樣保留。
function dropStaleTransitLoading(node: PlanNode): PlanNode {
  if (node.transitFromPrev?.loading !== true) return node
  const { transitFromPrev: _transit, ...rest } = node
  void _transit
  return rest as PlanNode
}

// migrateLegacyChildren——舊草稿的節點可能帶 children(內嵌名稱、座標、照片、縮圖樣式的子景點
// 物件陣列,現已移除,節點改存 id 的 attractions/places,見 PlanNodeData)。讀進來時:
//   - 有 placeId 的子景點,placeId 收進 places(與節點既有 places 合併去重),
//   - 標了 farFromNext 的子景點,其 placeId 收進節點的 farFromNext id 清單(保留候選卡的警示徽章),
//   - 其餘內嵌資料(名稱、座標、照片、縮圖)丟掉,執行時由資料存取層用 id 重查,
//   - children 欄位本身移除。
// 沒有 placeId 的子景點無從查詢,直接丟掉。形狀不對(children 不是陣列、項目不是物件)一律當作沒有,
// 不丟例外——舊資料的毛病不該讓整份草稿載入失敗。
function migrateLegacyChildren(node: PlanNode): PlanNode {
  if (!('children' in node)) return node
  const { children, ...rest } = node as PlanNode & { children?: unknown }
  const places = [...(Array.isArray(rest.places) ? rest.places : [])]
  const far = [...(Array.isArray(rest.farFromNext) ? rest.farFromNext : [])]
  if (Array.isArray(children)) {
    for (const c of children) {
      if (!c || typeof c !== 'object') continue
      const { placeId, farFromNext } = c as { placeId?: unknown; farFromNext?: unknown }
      if (typeof placeId !== 'string' || placeId === '') continue
      if (!places.includes(placeId)) places.push(placeId)
      if (farFromNext === true && !far.includes(placeId)) far.push(placeId)
    }
  }
  const out: PlanNode = { ...rest }
  if (places.length > 0) out.places = places
  if (far.length > 0) out.farFromNext = far
  return out
}

// saveTimeline 把時間軸寫進 localStorage。
//
// 寫入失敗(localStorage 被停用、無痕模式配額、QuotaExceededError 等)
// 一律靜默忽略——持久化是加值功能,失敗時這次 session 仍然完全可用
// (時間軸本來就活在記憶體裡),不該讓一次存檔失敗把正在進行的規劃流程
// 整個中斷掉。理由同專案既有「照片是輔助欄位,查詢失敗就略過」的降級
// 慣例。
// 回傳這次寫入後的版次(見 PersistedTimeline.rev),呼叫端記著它,下次
// 寫入前比對 readRev() 就能知道中途有沒有別的實例寫過。
//
// 回傳 null 代表這次寫入失敗(localStorage 被停用、無痕模式配額、
// QuotaExceededError 等)——刻意跟成功的版次區分開,不是回傳 baseRev
// 當作「沒有前進」。那樣呼叫端無法分辨兩者,而這個差別在多實例情境下
// 很要緊:若失敗時把 revRef 推到 baseRev,而記憶體 state 已經套用了這次
// 異動,版次就會宣稱「我跟磁碟一致」,實際上記憶體多了一筆沒存到的內容;
// 更糟的是 revRef 一旦膨脹到高於磁碟 rev,「我是否過期」的判斷從此永遠
// 為 false,這份實例再也不會察覺別人寫過,rev 機制對它完全失效。
export function saveTimelineForKey(key: string, timeline: PlanTimeline, baseRev = 0): number | null {
  const nextRev = baseRev + 1
  try {
    // 時間軸裡只剩 stop 節點(2026-10-24 起對話訊息獨立成 PlanConversation,
    // 只存在記憶體、不持久化,見 usePlanConversation.ts),這裡只存行程。
    const payload: PersistedTimeline = {
      version: STORAGE_VERSION,
      days: timeline.days.map((d) => ({ id: d.id, nodes: d.nodes })),
      rev: nextRev,
    }
    const lodgings = timeline.lodgings
    if (lodgings && lodgings.length > 0) payload.lodgings = lodgings
    localStorage.setItem(key, JSON.stringify(payload))
    return nextRev
  } catch {
    // 見上方說明:呼叫端據 null 判斷,不自行推進版次。
    return null
  }
}

export function saveTimeline(timeline: PlanTimeline, baseRev = 0): number | null {
  return saveTimelineForKey(PLAN_TIMELINE_STORAGE_KEY, timeline, baseRev)
}

// loadTimeline 讀回時間軸;沒有存過、資料損毀、或版本不符時一律回傳空
// 時間軸(createEmptyTimeline),呼叫端不需要處理 null。
//
// 這裡刻意做完整的形狀檢查(而非只 try/catch 一個 JSON.parse):
// localStorage 的內容可能被使用者手動改過、被舊版程式碼寫入、或被其他
// 分頁寫入非預期格式,任何一個欄位對不上就整份丟棄——半殘的時間軸比沒有
// 時間軸更糟(渲染層會拿到 type 為 undefined 的節點,分支判斷全部落空,
// 畫面出現空白卡片而且沒有任何錯誤訊息)。
// parseTimeline — 把一份已經讀出來的 raw 字串解析成 PlanTimeline。
// 抽出來讓 loadTimeline 與 loadTimelineWithRev 共用同一次 getItem 的
// 結果(見後者的說明),驗證邏輯只有這一份。
// migrateV1——版本 1(鏈結串列)轉成依天分組:沿 headId 走訪,stop 依自己的 day 決定放進哪一天(省略視為第 1 天),
// day 欄位不再存進節點。天數不連續時補空的天。
// 舊草稿裡 type 為 'section'(已移除的「分段標題」型別)的節點直接丟掉,不放進任何一天。
// isLegacySection——舊版的 'section' 節點(PlanNodeType 已不含這個型別,所以用字串比對)。
function isLegacySection(node: { type: string }): boolean {
  return node.type === 'section'
}

// 回傳 null 代表資料損毀(呼叫端據此備份原始內容再回空時間軸);headId 為空的合法空草稿回空時間軸而不是 null。
function migrateV1(p: PersistedTimeline): PlanTimeline | null {
  if (!Array.isArray(p.nodes)) return null
  if (p.headId !== null && typeof p.headId !== 'string') return null
  type Legacy = PlanNode & { prevId?: string | null; nextId?: string | null }
  const nodes = new Map<string, Legacy>()
  for (const entry of p.nodes) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [id, node] = entry
    if (typeof id !== 'string' || !node || typeof node !== 'object') return null
    if (typeof node.id !== 'string' || typeof node.type !== 'string') return null
    if (node.prevId != null && typeof node.prevId !== 'string') return null
    if (node.nextId != null && typeof node.nextId !== 'string') return null
    nodes.set(id, node)
  }
  if (p.headId == null) return createEmptyTimeline()
  if (!nodes.has(p.headId)) return null

  const buckets: PlanNode[][] = []
  let currentDay = 1
  let cursor: string | null | undefined = p.headId
  const visited = new Set<string>()
  while (cursor != null) {
    if (visited.has(cursor)) break
    visited.add(cursor)
    const legacy = nodes.get(cursor)
    if (!legacy) break
    const { prevId: _prev, nextId: _next, day, ...rest } = legacy
    void _prev
    void _next
    if (legacy.type === 'stop') currentDay = day ?? 1
    if (isLegacySection(legacy)) {
      cursor = legacy.nextId
      continue
    }
    const dayIdx = Math.max(0, currentDay - 1)
    while (buckets.length <= dayIdx) buckets.push([])
    buckets[dayIdx].push(migrateLegacyNode(rest as PlanNode))
    cursor = legacy.nextId
  }
  return liftLegacyLodgings(buckets.map((ns, i) => ({ id: `d_legacy${i + 1}`, nodes: ns })), [])
}

// liftLegacyLodgings——舊草稿裡 kind 為「住宿」的 stop(住宿尚未獨立成 PlanTimeline.lodgings 之前的形式)轉成住宿記錄:
// placeId/name/note 帶過去,id 沿用節點 id,dayIds 是該節點所在天到 checkOutDay(舊資料是「第幾天」的數字,含頭含尾,
// 沒填或不合理只住當天)對應的天 id;轉完從該天的 nodes 移除。沒有舊式住宿站時原樣回傳(days 參照不變)。
// 讀出來的節點型別已不含 checkOutDay,這裡用結構斷言取舊欄位。
function liftLegacyLodgings(days: PlanDay[], lodgings: PlanLodging[]): PlanTimeline {
  const lifted: PlanLodging[] = []
  const nextDays = days.map((d, dayIdx) => {
    if (!d.nodes.some((n) => n.type === 'stop' && n.kind === '住宿')) return d
    const nodes: PlanNode[] = []
    for (const n of d.nodes) {
      if (n.type !== 'stop' || n.kind !== '住宿') {
        nodes.push(n)
        continue
      }
      const checkOut = (n as { checkOutDay?: unknown }).checkOutDay
      const last = typeof checkOut === 'number' && Number.isInteger(checkOut) && checkOut > dayIdx + 1 ? Math.min(checkOut, days.length) : dayIdx + 1
      const lodging: PlanLodging = { id: n.id, dayIds: days.slice(dayIdx, last).map((x) => x.id) }
      if (n.placeId) lodging.placeId = n.placeId
      if (n.name) lodging.name = n.name
      if (n.note) lodging.note = n.note
      lifted.push(lodging)
    }
    return { ...d, nodes }
  })
  const all = [...lodgings, ...lifted]
  return all.length > 0 ? { days: nextDays, lodgings: all } : { days: nextDays }
}

// parseLodgings——讀回住宿清單:單筆形狀不對就丟掉那一筆(不像節點那樣整份作廢,住宿只是附屬資料);
// dayIds 只留存在於 days 的天,留不下任何一天的整筆丟掉,避免指向不存在天的孤兒資料。
function parseLodgings(raw: unknown, days: PlanDay[]): PlanLodging[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(days.map((d) => d.id))
  const seen = new Set<string>()
  const out: PlanLodging[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const l = item as Partial<PlanLodging>
    if (typeof l.id !== 'string' || seen.has(l.id) || !Array.isArray(l.dayIds)) continue
    const dayIds = l.dayIds.filter((x): x is string => typeof x === 'string' && known.has(x))
    if (dayIds.length === 0) continue
    seen.add(l.id)
    const lodging: PlanLodging = { id: l.id, dayIds }
    if (typeof l.placeId === 'string') lodging.placeId = l.placeId
    if (typeof l.name === 'string') lodging.name = l.name
    if (l.note && typeof l.note === 'object' && typeof l.note.text === 'string') lodging.note = l.note
    out.push(lodging)
  }
  return out
}

// tryParseTimeline——解析一份 raw:成功回 PlanTimeline(沒有存過/合法的空草稿是空時間軸),
// 回 null 代表「有內容但解析失敗」(JSON 壞掉、形狀對不上、版本不認得、id 重複)——呼叫端要把這份 raw 備份起來再回空時間軸。
function tryParseTimeline(raw: string | null): PlanTimeline | null {
  try {
    if (!raw) return createEmptyTimeline()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Partial<PersistedTimeline>
    if (p.version === LEGACY_LINKED_LIST_VERSION) return migrateV1(p as PersistedTimeline)
    if (p.version !== STORAGE_VERSION) return null
    if (!Array.isArray(p.days)) return null

    const days: PlanTimeline['days'] = []
    const seenIds = new Set<string>()
    const seenDayIds = new Set<string>()
    for (const d of p.days) {
      if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !Array.isArray(d.nodes)) return null
      // 天的 id 必須唯一:住宿(dayIds)與視圖都靠天 id 對應,重複的 id 會讓兩天被當成同一天,代表資料損毀。
      if (seenDayIds.has(d.id)) return null
      seenDayIds.add(d.id)
      const dayNodes: PlanNode[] = []
      for (const node of d.nodes) {
        if (!node || typeof node !== 'object') return null
        const n = node as Partial<PlanNode>
        if (typeof n.id !== 'string' || typeof n.type !== 'string') return null
        if (isLegacySection(n as { type: string })) continue // 舊草稿的 section 節點直接丟掉
        if (seenIds.has(n.id)) return null // 節點 id 必須唯一,重複代表資料損毀
        seenIds.add(n.id)
        dayNodes.push(migrateLegacyNode(node as PlanNode))
      }
      days.push({ id: d.id, nodes: dayNodes })
    }
    return liftLegacyLodgings(days, parseLodgings(p.lodgings, days))
  } catch {
    return null
  }
}

// backupKeyOf——解析失敗時原始內容的備份位置。
export function backupKeyOf(key: string): string {
  return `${key}.backup`
}

// parseTimeline — 把一份已經讀出來的 raw 字串解析成 PlanTimeline(loadTimeline 與 loadTimelineWithRev 共用同一次 getItem 的結果)。
// 解析失敗(整份丟棄、回空時間軸)之前,先把原始 raw 備份到 `<key>.backup` 並 console.warn:
// 否則下一次寫入(新的空草稿)會把壞掉的原始資料蓋掉,使用者手上若還有救回的可能(例如只是新版程式碼讀不懂舊格式)就永遠沒了。
// 備份寫入失敗(配額/停用)不丟例外——備份是盡力而為,不能讓載入流程因此中斷。
function parseTimeline(raw: string | null, key: string): PlanTimeline {
  const parsed = tryParseTimeline(raw)
  if (parsed) return parsed
  console.warn(`[planTimelineStorage] ${key} 的內容無法解析,已丟棄並回到空時間軸;原始內容備份在 ${backupKeyOf(key)}`)
  try {
    if (raw) localStorage.setItem(backupKeyOf(key), raw)
  } catch {
    // 見上方說明:備份失敗靜默忽略。
  }
  return createEmptyTimeline()
}

export function loadTimelineForKey(key: string): PlanTimeline {
  try {
    return parseTimeline(localStorage.getItem(key), key)
  } catch {
    return createEmptyTimeline()
  }
}

export function loadTimeline(): PlanTimeline {
  return loadTimelineForKey(PLAN_TIMELINE_STORAGE_KEY)
}

// loadTimelineWithRev — 一次 getItem 同時取得內容與版次,兩者保證來自
// 同一份快照。
//
// 呼叫端(usePlanTimelineCore 的初始化)若分別呼叫 loadTimeline() 與
// readRev(),那是兩次獨立的讀取:理論上另一個實例可以在兩次之間寫入,
// 於是讀到「舊 timeline + 新 rev」,這份實例會誤判自己是最新的、下次
// 寫入就覆蓋掉別人的內容。同分頁是單執行緒、兩行之間沒有 await/yield
// 點,實務上很難撞上——但那個不變量只靠「恰好沒有 yield」成立,這裡
// 讓它由結構保證。
export function loadTimelineWithRevForKey(key: string): { timeline: PlanTimeline; rev: number } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return { timeline: createEmptyTimeline(), rev: 0 }
  }
  let rev = 0
  try {
    const p = raw ? (JSON.parse(raw) as Partial<PersistedTimeline>) : null
    if (typeof p?.rev === 'number') rev = p.rev
  } catch {
    // 解析失敗時 rev 維持 0,parseTimeline 也會回空時間軸,兩者一致。
  }
  return { timeline: parseTimeline(raw, key), rev }
}

export function loadTimelineWithRev(): { timeline: PlanTimeline; rev: number } {
  return loadTimelineWithRevForKey(PLAN_TIMELINE_STORAGE_KEY)
}

// clearTimeline 清空已持久化的內容——供「重新開始規劃」這類明確的使用者
// 動作呼叫。不自動在任何地方被呼叫(例如登出時),避免誤刪使用者還想保留
// 的規劃草稿。
export function clearTimeline(): void {
  try {
    localStorage.removeItem(PLAN_TIMELINE_STORAGE_KEY)
  } catch {
    // 見 saveTimeline 的說明:靜默忽略。
  }
}

// PlanTimelineStore — 把「持久化怎麼做」抽成可替換的介面,取代原本
// usePlanTimelineCore 直接 import 這個檔案三個函式(readRev/
// loadTimelineWithRev/saveTimeline)呼叫的寫法。
//
// 存在的理由(2026-10,/ai-plan 展示頁交接給真實 TripPlanPage 之後):
// 那個展示入口(LivePlanLayer.tsx)複用正式功能的 TripPlanPage,但不該
// 寫進使用者真正的 localStorage 草稿——訪客在展示頁試玩的內容,不該
// 跟著使用者下次打開 /app 時殘留的規劃內容混在一起。原本考慮用一個
// `persist: boolean` 開關,但那樣 usePlanTimelineCore 內部每個讀寫點都要
// 多一層 if(persist) 判斷,且「不持久化」要做到什麼程度(讀到底要不要
// 回空、寫入要不要假裝成功)容易每個呼叫端各自詮釋不一致。改成介面:
// 呼叫端只決定「用哪一種 store」,讀寫邏輯本身(含現有的 rev 機制、
// 失敗時回傳 null 的語意)完全不變,呼叫端的判斷邏輯(見 saveTimeline
// 呼叫端對 null 回傳值的既有處理)也不需要跟著改。
export interface PlanTimelineStore {
  readRev(): number
  loadTimelineWithRev(): { timeline: PlanTimeline; rev: number }
  saveTimeline(timeline: PlanTimeline, baseRev: number): number | null
}

// localStoragePlanTimelineStore — 正式功能(/app 等)使用的預設 store,
// 原樣包一層本檔案既有的三個函式,不改變它們本身的行為或簽名(它們仍然
// 各自被保留、匯出,供既有呼叫端或測試直接使用)。
export const localStoragePlanTimelineStore: PlanTimelineStore = {
  readRev,
  loadTimelineWithRev,
  saveTimeline: (timeline, baseRev) => saveTimeline(timeline, baseRev),
}

// 沒有「不持久化」的 store:曾經有過 noopPlanTimelineStore(讀永遠回空、存檔永遠回 null),但它是個陷阱——
// 提交遇到 null 的語意是「存檔失敗,不推進記憶體 state」,拿它給時間軸會讓記憶體時間軸永遠不更新。2026-10 刪除,
// 要純記憶體的時間軸請不要傳 store 給 usePlanTimelineCore(它走完全不經過 store 的路徑)。
