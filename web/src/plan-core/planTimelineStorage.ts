// planTimelineStorage.ts — 規劃時間軸(PlanTimeline,見 planTimeline.ts)的
// 前端持久化層。獨立成這個檔案而非塞進 planTimeline.ts,是為了讓「資料結構
// 與操作」跟「怎麼存」兩件事各自獨立:planTimeline.ts 維持純函式、不碰任何
// 瀏覽器 API(測試不需要 mock localStorage),這裡只負責序列化與讀寫。
//
// 2026-10 新增,使用者明確要求「將 ai plan 規劃的內容寫到前端持久化,持久化
// 的原件要獨立可以共用,然後對話內的規劃內容也用相同的原件持久化」——
// /app/plan-ai(trip-plan/TripPlanPage.tsx)與地圖規劃的對話視窗
// (chat/ChatScreen.tsx)共用這同一個元件、也共用同一份資料(使用者確認
// 「共用同一份,兩處看到一樣的內容」),在任一處規劃的結果,另一處打開就
// 看得到。
//
// 不跟 trip 綁定(使用者明確要求「不要跟 trip 有關聯」)——storage key 是
// 固定字串,不帶 tripId,切換行程不會換掉這條時間軸。這跟 trip_entry_*
// 那套寫進資料庫、依行程分別儲存的正式行程資料是兩種不同性質的東西:
// 這裡存的是「對話規劃過程中的時間軸」,是跨行程的單一草稿。
//
// 為什麼需要自訂序列化:PlanTimeline.nodes 是 Map<string, PlanNode>,
// JSON.stringify 對 Map 會輸出 {}(Map 的內容不是自有可列舉屬性),直接
// 存會整份資料遺失、而且不會報錯。這裡轉成 [key, value] 陣列再存,讀回來
// 重建成 Map——這正是這個元件存在的核心價值,呼叫端不需要各自記得處理。

import type { PlanNode, PlanTimeline } from './planTimeline'
import { createEmptyTimeline } from './planTimeline'

// STORAGE_KEY 沿用專案既有的 tripace.* 前綴慣例(見 assistLang.ts 的
// ASSIST_LANG_KEY、hooks/useAppState.ts 的 AUTH_* 系列)。
export const PLAN_TIMELINE_STORAGE_KEY = 'tripace.planTimeline'

// STORAGE_VERSION — 寫入時一併存進去,讀取時不符就整份丟棄、回到空時間軸。
// PlanNodeData 的欄位會隨功能演進增減(見該介面的完整說明,光是 2026-09~10
// 就加過 day/googlePhotoUrls/note/transitFromPrev 等欄位),舊版殘留在
// localStorage 的資料結構對不上新版程式碼時,與其讓畫面渲染出半殘的節點
// (例如缺 type 欄位導致 PlanTimelineView 的分支判斷全部落空),不如直接
// 當成沒有資料。版本號只在「結構不相容」時才需要進位,純粹新增選填欄位
// 不需要動它(舊資料少那個欄位,讀回來是 undefined,跟沒設定過一樣)。
const STORAGE_VERSION = 1

// PersistedTimeline — 實際寫進 localStorage 的形狀。nodes 從 Map 轉成
// entries 陣列(見檔頭說明),其餘欄位原樣。
interface PersistedTimeline {
  version: number
  headId: string | null
  nodes: [string, PlanNode][]
  // rev — 每次寫入遞增的版次。用來讓「同時掛載的多份 TripPlanPage」
  // (地圖對話小匡常駐掛載 + /app/plan-ai 全頁,切到該分頁時兩份同時
  // 存在)判斷「我手上這份是不是已經被另一份覆寫過了」。
  //
  // 沒有這個欄位時曾經是真實的資料遺失路徑:兩份各自在掛載當下讀一次
  // localStorage 後就不再重讀,在全頁版規劃完切回地圖,小匡那份仍是
  // 掛載時的舊內容(常是空的),它下一次寫入就把剛規劃好的全部蓋掉。
  rev?: number
}

// readRevForKey/loadTimelineWithRevForKey/saveTimelineForKey——2026-10
// 新增(見 plan-core/planTimelineDrafts.ts 的完整背景說明):把原本寫死
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

// sanitizeNode — 把「暫態 UI 狀態」欄位清掉再存。
//
// loading:表示「正在向後端查詢這個地點的真實資料」(見 PlanNodeData 的
// 完整說明),那次查詢隨著頁面關閉就結束了,重整後沒有任何進行中的請求會
// 把它翻回 false——若原樣存回,使用者會看到一張永遠轉圈、永遠不會變成
// 真實內容的佔位卡。
//
// removing:表示「已收到移除指示,正在播放淡出動畫」,真正的摘除由呼叫端
// 在動畫結束後延遲執行(見 removeNode 的完整說明)。頁面關閉時那個
// setTimeout 一起消失,重整後這個節點會永遠停在「淡出中」的視覺狀態、
// 卻再也不會被摘除。
//
// 兩者都是「只在這次 session 內有意義」的狀態,不屬於該被持久化的規劃
// 內容本身,故存檔時一律丟棄,讀回來就是一般的已完成節點。
function sanitizeNode(node: PlanNode): PlanNode {
  const { loading: _loading, removing: _removing, ...rest } = node
  return rest
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
    const payload: PersistedTimeline = {
      version: STORAGE_VERSION,
      headId: timeline.headId,
      nodes: [...timeline.nodes.entries()].map(([id, node]) => [id, sanitizeNode(node)]),
      rev: nextRev,
    }
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
function parseTimeline(raw: string | null): PlanTimeline {
  try {
    if (!raw) return createEmptyTimeline()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return createEmptyTimeline()
    const p = parsed as Partial<PersistedTimeline>
    if (p.version !== STORAGE_VERSION) return createEmptyTimeline()
    if (!Array.isArray(p.nodes)) return createEmptyTimeline()
    if (p.headId !== null && typeof p.headId !== 'string') return createEmptyTimeline()

    const nodes = new Map<string, PlanNode>()
    for (const entry of p.nodes) {
      if (!Array.isArray(entry) || entry.length !== 2) return createEmptyTimeline()
      const [id, node] = entry
      // 逐筆檢查節點本身最低限度的必要欄位——id/type 缺一不可(渲染層
      // 的分支判斷、鏈結走訪都依賴它們),prevId/nextId 必須是 string 或
      // null(toRenderList 沿著 nextId 走訪,型別不對會無限迴圈或中斷)。
      if (typeof id !== 'string' || !node || typeof node !== 'object') return createEmptyTimeline()
      const n = node as Partial<PlanNode>
      if (typeof n.id !== 'string' || typeof n.type !== 'string') return createEmptyTimeline()
      if (n.prevId !== null && typeof n.prevId !== 'string') return createEmptyTimeline()
      if (n.nextId !== null && typeof n.nextId !== 'string') return createEmptyTimeline()
      nodes.set(id, node as PlanNode)
    }

    // headId 指向的節點必須真的存在——不一致代表資料損毀(例如存檔過程
    // 中途失敗),整份丟棄比渲染一條走訪不到任何節點的空時間軸清楚。
    if (p.headId !== null && !nodes.has(p.headId)) return createEmptyTimeline()

    return { nodes, headId: p.headId }
  } catch {
    return createEmptyTimeline()
  }
}

export function loadTimelineForKey(key: string): PlanTimeline {
  try {
    return parseTimeline(localStorage.getItem(key))
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
// 呼叫端(useTripPlanTimeline 的初始化)若分別呼叫 loadTimeline() 與
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
  return { timeline: parseTimeline(raw), rev }
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
// useTripPlanTimeline 直接 import 這個檔案三個函式(readRev/
// loadTimelineWithRev/saveTimeline)呼叫的寫法。
//
// 存在的理由(2026-10,/ai-plan 展示頁交接給真實 TripPlanPage 之後):
// 那個展示入口(LivePlanLayer.tsx)複用正式功能的 TripPlanPage,但不該
// 寫進使用者真正的 localStorage 草稿——訪客在展示頁試玩的內容,不該
// 跟著使用者下次打開 /app 時殘留的規劃內容混在一起。原本考慮用一個
// `persist: boolean` 開關,但那樣 useTripPlanTimeline 內部每個讀寫點都要
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

// noopPlanTimelineStore — 完全不碰 localStorage 的 store:讀永遠回空
// 時間軸、寫永遠回傳 null(saveTimeline 既有的「存檔失敗」語意——呼叫端
// 本來就不會在這個情況下推進 revRef 或做任何特殊處理,見
// useTripPlanTimeline.commitTimeline 的完整說明),不需要額外改動呼叫端
// 的判斷邏輯。2026-10:/ai-plan 展示頁的 LivePlanLayer 第一輪曾經傳這個
// store 讓交接後不持久化,第二輪使用者明確要求改回跟 /app 共用同一份
// localStorage 草稿,該呼叫端現在不傳這個 prop(退回 TripPlanPage 的
// 預設值)。這個 store 目前沒有任何呼叫端在用,保留著是因為未來若有其他
// 情境需要「完全不持久化」的 TripPlanPage 實例,這裡已經有現成可用的
// 實作,不需要重新發明。
export const noopPlanTimelineStore: PlanTimelineStore = {
  readRev: () => 0,
  loadTimelineWithRev: () => ({ timeline: createEmptyTimeline(), rev: 0 }),
  saveTimeline: () => null,
}
