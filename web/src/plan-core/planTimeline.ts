// planTimeline.ts — 時間軸的鏈結串列資料層,純函式、不依賴 React。
//
// 背景:原本 AIPlanTimelinePage.tsx 的 steps 是一個普通陣列,新增節點
// (見 attractionTools.ts 的 add_attraction)一律 append 到陣列尾端,
// 不管呼叫端傳的 time 是幾點——導致「先加下午 3 點的站、後來想在前面
// 補一個早上 9 點的站」時,新卡片仍然排在最後面,時間軸畫面上出現
// 時間忽前忽後的錯亂順序(見這裡之前的討論)。
//
// 這裡改用真正的鏈結串列表達順序,而非「陣列本身的排列 + 額外一份
// prevId/nextId 兩份資料各自表達順序、卻沒有機制保證兩者一致」的
// 偽鏈結串列——PlanTimeline 只儲存 Map<id, PlanNode>(每個節點各自的
// prev/next 指標)與 headId,陣列從來不是被儲存的東西,渲染前一律呼叫
// toRenderList() 沿著鏈結重新走訪一次現算出來,順序的唯一事實來源
// (single source of truth)只有鏈結本身,不會有「陣列順序」跟「鏈結
// 順序」兩者漂移不一致的問題。
//
// insertAfter 是這裡唯一的寫入路徑,由「行程安排元件」(呼叫端
// AIPlanTimelinePage.tsx)提供給 attractionTools.ts 的 add_attraction
// 工具呼叫——工具本身不再自己組陣列 append,必須指定一個錨點(anchorId,
// null 代表插在最前面)並帶新節點的 time,由這裡統一驗證時間是否落在
// 合理範圍、決定實際插入位置、回傳明確的成功或錯誤結果。

// PlanNodeType — 對齊 AIPlanTimelinePage.tsx 既有的 PlanStepType,
// 這裡不 import 那邊的型別(避免循環依賴,理由同 attractionTools.ts
// 對 PlanStepLike 的說明),改宣告一個結構相容的版本。
//
// 2026-09 重構:'note' 不再是獨立節點型別——比照 TransitInfo 併入
// stop 節點(見該介面的完整說明)的同一個理由,備註改成掛在它所屬的
// 節點自己身上的 note 欄位(見 NoteInfo 的完整說明),不再是鏈結串列裡
// 跟 stop 平等的獨立節點。
//
// 'message'——2026-09 新增,跟上面 note 的收斂方向相反:這是 LLM 跟
// 使用者的對話訊息,本質上就是「對話」,不是附屬在某個景點上的引言或
// 備註。曾經一度嘗試把它做成掛在 stop 節點身上的欄位(AgentMessageInfo,
// 見該介面早期版本的說明),但使用者明確指出「他不是引言,是對話」——
// 真實情境裡 LLM 常常先說一句話、使用者看完才決定要不要加入這個景點,
// 這時候根本還沒有任何 stop 節點可以依附,證明「掛在某個 stop 身上」
// 這個資料模型本身的前提就不成立。改成跟 section/stop 平行的獨立節點
// 型別,依它被送出的時間順序插入時間軸,不需要跟任何特定的 stop 綁定
// 關係——這樣「先出現一句話、後面才出現景點卡」是這個資料結構下的
// 自然結果,不需要任何「等景點卡出現後再合併」的特殊處理。
export type PlanNodeType = 'section' | 'stop' | 'message'

// TransitInfo — 掛在 stop 節點自己身上的「這一站跟前一站之間的交通
// 資訊」,取代原本獨立的 'transit' 節點型別。
//
// 2026-09 重構動機:原本 transit 是鏈結串列裡跟 stop 平等的獨立節點,
// 靠「鏈結位置上緊接在某個 stop 前面」這個隱含關係表達「這張交通卡屬於
// 哪兩站」。使用者實際操作(移除中間站)會暴露這個設計的缺陷:removeNode
// 只做「前後節點互相銜接」的純鏈結摘除,完全不知道「transit 節點」這種
// 語意,移除 站A→交通卡AB→站B→交通卡BC→站C 中的站B後,會變成
// 站A→交通卡AB→交通卡BC→站C——兩張交通卡黏在一起,且都是基於已經
// 不存在的站B算出來的舊資料,沒有一張代表「站A→站C」。
//
// 改成資料直接掛在「到達站」(即後面那個 stop)身上後:
//   - 移除一個 stop 節點時,交通資料跟著它一起消失,不會有「兩張交通卡
//     黏在一起」這種不合法狀態——removeNode 完全不需要知道交通卡的存在。
//   - 「這張交通卡屬於哪兩站」變成顯式的:就是這個 stop 節點與它目前的
//     prevId 那一站,不再需要靠鏈結位置猜測、也不會有第三種節點類型
//     混在 stop 之間打亂鏈結的單純性。
//   - 任何造成「這個 stop 的前一站」改變的操作(插入新站、移除站、前一站
//     座標更新)都對應到明確的「這個 stop 的 transitFromPrev 需要重新
//     計算」時機,見 AIPlanTimelinePage.tsx 的 refreshTransitForStop。
export interface TransitInfo {
  loading?: boolean
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
}

// NoteInfo — 掛在某個節點(目前只有 stop 會用到)自己身上的一則備註,
// 說明「為什麼這樣安排」這類考量或建議。
//
// 2026-09 重構動機:原本 note 是鏈結串列裡跟 stop 平等的獨立節點,靠
// 「鏈結位置緊接在某個 stop 旁邊」這個隱含關係表達「這則備註是在講
// 哪一站」——但這個關係從未被顯式驗證或維護過,使用者明確要求「備註寫
// 在景點的節點上」,改成資料直接掛在該景點節點身上後:
//   - 備註跟它所描述的景點是同一筆資料的一部分,不會有「這則備註原本
//     在講哪一站」需要靠鏈結位置猜測的問題(對稱 TransitInfo 從獨立
//     'transit' 節點併入 stop.transitFromPrev 的同一個理由,見該介面的
//     完整說明)。
//   - 移除一個 stop 節點時,它的備註跟著一起消失,不會有「備註留在鏈結
//     裡但已經沒有對應的景點卡片」這種孤兒資料——removeNode 完全不需要
//     知道備註的存在,理由同 TransitInfo 的完整說明。
//   - 一個節點目前只掛一則備註(不是陣列)——使用者明確要求單則,若同一
//     景點需要不同時間點各自留一句話,那是之後才需要考慮的情境,目前
//     不先做那層彈性。
export interface NoteInfo {
  text: string
  category?: string
}


// PlanNodeData — 節點除了鏈結指標(prevId/nextId)以外的實際內容,涵蓋
// AIPlanTimelinePage.tsx 原本 PlanStep 的全部展示欄位(含 loading/
// removing/googlePhotoUrls 這類只在 stop 節點上有意義的 UI 呈現/非同步
// 查詢狀態欄位)——不同節點型別各自只用到欄位的子集,不需要為了「純資料 vs
// UI 狀態」這條界線另外拆一層泛型,那樣只會讓 insertAfter/updateNode/
// toRenderList 都要重新宣告泛型參數,徒增複雜度卻沒有實質收益。
export interface PlanNodeData {
  type: PlanNodeType
  // section
  label?: string
  // message——見 PlanNodeType 的完整說明,LLM/使用者的對話訊息本身。
  // text 是訊息內容;stale 見下方完整說明。這兩個欄位只有 message 節點
  // 會用到,跟 stop 節點的 desc/name 等欄位各自獨立,不共用。
  //
  // stale——使用者明確要求「新增景點後要淡化(不是合併進卡片,只是
  // 視覺上退場)」:這則訊息只在「話題還在它身上」時完整顯示,一旦有
  // 新的 stop 節點插入(代表話題已經推進、可能對應到另一句更新的
  // message),舊的這一則就該被標記為 stale、渲染成收合/淡化的樣子,
  // 而不是一直佔著原本的版面、也不是被刪除或併入任何 stop 卡片——它
  // 依然是時間軸上自己獨立的一個節點,只是視覺上不再搶眼。由呼叫端
  // (AIPlanTimelinePage.tsx)決定何時把 stale 從 false 翻成 true,這裡
  // 只負責承載這個狀態,不內建計時器或自動判斷邏輯。
  text?: string
  stale?: boolean
  // stop
  time?: string
  // day——這個 stop 屬於行程的第幾天,1-based,省略時視為第 1 天(對齊
  // 既有單日行程的呼叫端,不需要因為加了這個欄位就強制所有呼叫端補上
  // day: 1)。2026-09 新增,理由:原本這個資料層只有一條扁平時間軸,
  // time 是唯一的排序依據,且驗證邏輯要求整條時間軸嚴格遞增(見下方
  // insertAfter 的完整說明)——多天行程若延續同一套邏輯,第二天只能從
  // 「比前一天最後一站更晚」的時刻開始接續(例如前一天到 23:00,第二天
  // 只能從 23:01 起跳),沒辦法讓每天各自從清晨重新開始,使用者明確
  // 要求「排程元件加入日的概念」來解決這個限制。時間驗證(nearestStopNode)
  // 改成只在同一個 day 範圍內找邊界、比較 time 先後,不同 day 之間不
  // 比較時間值,讓每天都能各自用合理的一天時刻表(例如都從早上開始)。
  // 節點在鏈結串列裡的先後順序仍然是唯一的顯示順序依據(day 並不是
  // 另一層獨立的分組結構,只是這個 stop 節點自己的一個屬性)——同一天
  // 的所有節點在鏈結上必須彼此相鄰,不支援「day 1 的兩段中間穿插一段
  // day 2」這種交錯排列,呼叫端(attractionTools.ts/模擬腳本)自己保證
  // 依日期順序插入,這裡不做額外校驗。
  day?: number
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  // placeId:Google Place ID——search_attraction/add_attraction 這條路徑
  // (見 attractionTools.ts 檔頭「第四/五/六次重構」的完整說明)只知道
  // 這個 id 時會有值,用來在插入節點之後背景觸發
  // fetchPlanAiPlaceDetailsAny 單段查詢真實地點資料(name/summary/
  // googlePhotoUrls/lat/lng),見 AIPlanTimelinePage.tsx
  // resolveAttractionForStep 的完整說明。該端點內部會優先查一次資料庫
  // attraction(查得到就優先用資料庫資料,查不到才 fallback 查
  // Google),故不需要這個檔案自己判斷「資料庫 vs Google」兩種來源、也
  // 不需要為 Google 補的候選另外發明一種臨時 id 機制——不論候選來自
  // 資料庫還是 Google,一律用同一個 placeId 當識別碼。模擬 WS 腳本路徑
  // (planActionToInsert)也用同一個欄位承接模擬 WS 腳本(plan-ai-sim
  // 分支)送出的 placeId,兩條路徑共用同一套查詢邏輯。
  placeId?: string
  // loading:表示這個 stop 帶了 placeId、正在查詢真實地點資料中(縮圖/
  // 敘事文字先用假資料佔位);查完後 googlePhotoUrls/desc 會被真實資料
  // 覆蓋,loading 轉 false。沒有 placeId 的 stop 這個欄位固定是 false,
  // 直接顯示假資料。
  loading?: boolean
  // googlePhotoUrls:比照地圖版景點介紹卡的多圖瀏覽需求(見
  // PhotoCarousel.tsx)。UI 縮圖固定只顯示第一張,Lightbox 放大瀏覽時
  // 才看得到完整清單。
  googlePhotoUrls?: string[]
  // removing:這一筆已收到移除指示,正在播放淡出動畫、還沒真的從鏈結
  // 摘除(見 removeNode 的完整說明)——渲染時套用淡出 CSS class,動畫
  // 結束後由呼叫端延遲真正呼叫 removeNode,不是收到指示就立刻讓 DOM
  // 節點瞬間消失。
  removing?: boolean
  // lat/lng:右上角固定小地圖用——點擊這張卡片時 panTo 到這個座標。
  lat?: number
  lng?: number
  // transitFromPrev:這個 stop 跟它目前的 prevId 那一站之間的交通資訊
  // (見 TransitInfo 的完整說明)——只有 stop 節點會用到,沒有前一站
  // (時間軸第一站)或前一站不是帶座標的 stop 時維持 undefined,不渲染
  // 任何交通卡。
  transitFromPrev?: TransitInfo
  // note:這個節點自己的備註(見 NoteInfo 的完整說明)——undefined 代表
  // 沒有備註,不是空字串這種「有欄位但沒內容」的表達方式。
  note?: NoteInfo
}

export interface PlanNode extends PlanNodeData {
  id: string
  prevId: string | null
  nextId: string | null
}

export interface PlanTimeline {
  nodes: Map<string, PlanNode>
  headId: string | null
}

export function createEmptyTimeline(): PlanTimeline {
  return { nodes: new Map(), headId: null }
}

// DAY_DIVIDER_ID_PREFIX — toRenderList 自動插入的跨天分隔線虛擬節點
// id 前綴(見該函式的完整說明)。呼叫端(AIPlanTimelinePage.tsx/
// TripPlanPage.tsx 的渲染邏輯)可以用這個前綴判斷某個節點是不是這種
// 虛擬分隔線,而不是真的鏈結節點——例如點擊卡片、拖曳排序這類只該對
// 真實節點生效的互動,不該誤把分隔線當成一般節點處理。
export const DAY_DIVIDER_ID_PREFIX = 'day-divider-'

// toRenderList — 沿著鏈結從 headId 走訪到底,產出供 JSX .map() 使用的
// 陣列。這是唯一把鏈結「攤平」成陣列的地方,渲染層不該自己走訪 Map。
// 孤兒節點(存在於 nodes 但走訪不到,理論上不該發生,insertAfter/
// removeNode 都會維持鏈結完整性)不會出現在結果裡——防禦性地忽略,
// 不是靜默吃掉真正的 bug:若鏈結真的斷裂,問題該在寫入路徑(insertAfter/
// removeNode)本身被發現,不是在渲染這裡才表現成「某個節點憑空消失」。
//
// 2026-09 新增:自動插入跨天分隔線(使用者明確要求「跨天不用插入
// section,排程元件自動新增分隔線」)——完全取代原本靠呼叫端手動送
// 'section' 節點表達「上午/中午/下午」這種子分段的做法。走訪過程中,
// 只要遇到下一個 stop 節點的 day(見 PlanNodeData.day 的完整說明,
// 省略視為第 1 天)跟目前追蹤的「目前這天」不同,就在它前面插入一個
// 虛擬分隔線節點,再把「目前這天」更新成它的 day——不只判斷「比較大」
// (day 遞增),因為 insertAfter 並不保證鏈結上的 day 一定沿路遞增(見
// insertAfter/nearestStopNode 的完整說明:day 不同時不比較 time 先後,
// 不會擋下「day 1 的站接在 day 2 站之後」這種寫入),若只在遞增時插入
// 分隔線,day 不遞增的那一站會被靜默併入前一段、完全沒有分隔線標示,
// 且之後的追蹤狀態也不會修正回來——這是實際發現過的 bug,故改成只要
// 不同就插入,涵蓋遞增與非遞增兩種情況。這個分隔線節點不存在於
// timeline.nodes(不是真的鏈結節點,insertAfter/removeNode/updateNode
// 完全不需要知道它的存在),只在這次 toRenderList 呼叫的回傳陣列裡
// 產生,每次呼叫都重新計算,不會被快取或誤當成需要維護鏈結完整性的
// 對象。id 用 `${DAY_DIVIDER_ID_PREFIX}${day}` 而非隨機值——同一個
// day 邊界每次重新計算都得到同一個 id,呼叫端拿 id 當 React key 時
// 不會因為每次都換一個新 id 而誤判成「舊分隔線移除、新分隔線插入」
// 觸發不必要的重新掛載/進場動畫。只在遇到 stop 節點時比較 day——
// section/message 節點沒有時間先後的概念,不影響「目前這天」的追蹤
// (也不會被跳過插入分隔線,只是它們本身的 day 不列入比較)。
export function toRenderList(timeline: PlanTimeline): PlanNode[] {
  const result: PlanNode[] = []
  let cursor = timeline.headId
  const visited = new Set<string>()
  let currentDay = 1
  while (cursor !== null) {
    if (visited.has(cursor)) break // 防禦性:避免鏈結若不慎成環造成無限迴圈
    visited.add(cursor)
    const node = timeline.nodes.get(cursor)
    if (!node) break
    if (node.type === 'stop') {
      const nodeDay = normalizedDay(node.day)
      if (nodeDay !== currentDay) {
        result.push({
          type: 'section',
          label: `Day ${nodeDay}`,
          id: `${DAY_DIVIDER_ID_PREFIX}${nodeDay}`,
          prevId: null,
          nextId: null,
        })
        currentDay = nodeDay
      }
    }
    result.push(node)
    cursor = node.nextId
  }
  return result
}

// PLAN_TIME_PATTERN — 固定 "HH:MM" 24 小時制格式,對齊 attractionPool.ts/
// 模擬腳本既有資料("08:30"、"15:00" 這類),不支援其他寫法
// (如 "9:30am")——不合法格式直接視為驗證失敗,不嘗試寬鬆解析。
const PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTimeFormat(time: string): boolean {
  return PLAN_TIME_PATTERN.test(time)
}

// timeToMinutes — "HH:MM" 轉成當日分鐘數,供直接數值比較,不需要建立
// Date 物件(不涉及日期,行程只在單一天的時間軸內比較先後)。呼叫前
// 已經過 isValidTimeFormat 檢查,這裡不重複驗證格式。
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// minutesToTime — timeToMinutes 的反向轉換,把當日分鐘數轉回 "HH:MM"
// 字串。對齊 PLAN_TIME_PATTERN 的既有格式(24 小時制、固定兩位數補零)。
// export 給 PlanTimelineView.tsx 的拖拉互動用(見 getTimeDragBounds/
// anchorDot 拖拉的完整說明):拖拉手勢算出的中間值是分鐘數,寫回節點的
// time 欄位前要轉回字串。minutes 由呼叫端保證落在 0~1439(拖拉互動
// clamp 過,不會超出一天範圍),這裡不另外做邊界檢查。
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// InsertAfterError — insertAfter 失敗時的結構化錯誤,呼叫端(attractionTools.ts
// 的 add_attraction)用 code 判斷要組成什麼樣的訊息丟給 LLM,不需要
// 自己 parse 一段人類可讀字串猜測失敗原因。
export type InsertAfterErrorCode =
  | 'anchor_not_found'
  | 'invalid_time_format'
  | 'time_out_of_range'

export interface InsertAfterError {
  code: InsertAfterErrorCode
  message: string
}

export type InsertAfterResult =
  | { ok: true; timeline: PlanTimeline; insertedId: string }
  | { ok: false; error: InsertAfterError }

// nearestStopTime — 從某個節點開始,沿著指定方向(prevId 或 nextId)
// 走訪,找到第一個有 time 值的 stop 節點。跳過沒有時間概念的
// section——這種節點沒有 time 欄位,不能拿來當時間範圍比對的邊界,
// 必須繼續往下一個找,直到遇到有時間的 stop 或鏈結到底為止。回傳完整節點(而非只回傳分鐘數)——使用者明確要求「有錯誤的
// 時候要給明確的指引跟必要資訊,不能晚於/早於都要給予目前的值」,
// 呼叫端(insertAfter 的錯誤訊息)需要節點的 id/name/time 才能組出
// 「請用 XX(id)當錨點,它的時間是 YY」這種可操作的具體指引,只有分鐘數
// 無法組出這樣的訊息。
// day 比較:省略視為第 1 天(見 PlanNodeData.day 的完整說明)。
function normalizedDay(day: number | undefined): number {
  return day ?? 1
}

// targetDay——只在跟新插入節點「同一天」的範圍內找邊界節點,跨天的
// stop 不當作時間比較的邊界(見 PlanNodeData.day 的完整說明:day 不同
// 時不比較 time 先後,讓每天可以各自從清晨重新開始)。走訪順序不變,
// 只是多一個 day 是否相符的判斷——一旦走到不同天的節點就代表已經跨出
// 「這一天」的範圍,直接視為找不到邊界(return null),不繼續往更遠的
// 節點找(更遠的節點屬於別的天,不該被跨天拿來當邊界)。
function nearestStopNode(
  timeline: PlanTimeline,
  startId: string | null,
  direction: 'prevId' | 'nextId',
  targetDay: number,
): PlanNode | null {
  let cursor = startId
  while (cursor !== null) {
    const node = timeline.nodes.get(cursor)
    if (!node) return null
    if (node.type === 'stop' && node.time && isValidTimeFormat(node.time)) {
      if (normalizedDay(node.day) !== targetDay) return null
      return node
    }
    cursor = node[direction]
  }
  return null
}

// buildOutOfRangeMessage — 組出 time_out_of_range 的錯誤訊息,給明確、
// 可直接照做的指引與必要資訊(使用者明確要求:「有錯誤的時候要給明確的
// 指引跟必要資訊,像是不能晚於/早於都要給予目前的值」)——不能只說「太
// 早/太晚」,要把下界/上界節點的具體 id 與時間都列出來,讓呼叫端(LLM)
// 不需要再猜測或盲目重試就能算出下一次呼叫該用哪個 id/時間。
//
// 額外處理一個實際發生過的失敗模式(見這個功能上線後第一批真實 log:
// LLM 連續 4 次呼叫都失敗在同一個原因):anchorId 為 null、但時間軸已經
// 非空且新時間晚於現有的第一站——這代表 LLM 很可能誤以為「不帶
// anchorId」等於「接在時間軸最後面」,但實際語意是「插在最前面」(見
// insertAfter 開頭的說明)。這種情況下額外附加一句提示,明確點出
// anchorId 目前是 null、且告知該傳哪個 id 才能達成「接在某站之後」的
// 意圖,不是讓呼叫端自己從「晚於範圍上界」這個抽象描述反推出「原來我
// 該傳 anchorId」這個結論。
function buildOutOfRangeMessage(
  anchorId: string | null,
  attemptedTime: string,
  direction: 'early' | 'late',
  lowerNode: PlanNode | null,
  upperNode: PlanNode | null,
): string {
  const parts: string[] = []
  if (direction === 'early') {
    parts.push(
      `時間 "${attemptedTime}" 早於錨點前一站「${lowerNode!.name ?? lowerNode!.id}」(id: "${lowerNode!.id}")的時間 "${lowerNode!.time}",不能插在這個位置。`,
    )
  } else {
    parts.push(
      `時間 "${attemptedTime}" 晚於錨點後一站「${upperNode!.name ?? upperNode!.id}」(id: "${upperNode!.id}")的時間 "${upperNode!.time}",不能插在這個位置。`,
    )
  }
  // 明確列出這個插入位置目前允許的時間範圍(即使其中一端不存在邊界,也
  // 用「不限」表達清楚,不留呼叫端自己猜測「另一端是不是也有限制」)。
  const lowerText = lowerNode ? `"${lowerNode.time}"(${lowerNode.name ?? lowerNode.id})` : '不限'
  const upperText = upperNode ? `"${upperNode.time}"(${upperNode.name ?? upperNode.id})` : '不限'
  parts.push(`這個位置允許的時間範圍是 ${lowerText} 到 ${upperText} 之間。`)

  if (anchorId === null && direction === 'late' && upperNode) {
    parts.push(
      `目前 anchorId 是 null(插在時間軸最前面),不是「接在最後面」的意思——若想讓這一站排在「${upperNode.name ?? upperNode.id}」之後,請改帶 anchorId: "${upperNode.id}"。`,
    )
  } else {
    parts.push('請改用符合這個時間範圍的錨點(anchorId),或調整這個時間。')
  }

  return parts.join('')
}

// buildAnchorNotFoundMessage — anchor_not_found 錯誤的訊息組裝,供
// insertAfter 使用。2026-09 真實踩坑記錄:LLM 呼叫 add_attraction 時,
// 曾經連續把 attractionId(search_attraction 查到的景點候選 id,例如
// "lmk_c78a4800ebd2")誤當成 anchorId(必須是時間軸上既有節點的 id,
// 由先前呼叫 add_attraction 成功後回傳)傳入,重試時又換了另一個
// attractionId 再犯同樣的錯——因為原本「找不到 id 為 "..." 的節點」
// 這句訊息沒有指出「你傳的可能根本是另一種 id」這個真正的問題所在,
// LLM 只會覺得「這個 id 打錯了」,而不是「這個欄位不該填 attraction
// id」。這裡明確列出時間軸上目前實際存在、可以當 anchorId 的節點 id
// 清單(含名稱方便對照),讓 LLM 能一眼比對出自己傳的值格式對不上任何
// 一個(例如清單裡全是 "agent-..." 開頭,傳的卻是 "lmk_..."),進而
// 意識到自己搞混了兩種 id 的用途,而不是繼續在同一種錯誤模式裡重試。
function buildAnchorNotFoundMessage(timeline: PlanTimeline, anchorId: string): string {
  const parts: string[] = [`找不到 id 為 "${anchorId}" 的節點,無法插入在它後面。`]

  const rendered = toRenderList(timeline)
  if (rendered.length === 0) {
    parts.push('目前行程時間軸是空的,還沒有任何節點可以當 anchorId——若這是第一站,請省略 anchorId 或傳 null。')
  } else {
    const list = rendered
      .filter((node) => node.type === 'stop')
      .map((node) => `"${node.id}"(${node.name ?? '未命名'}）`)
      .join('、')
    parts.push(
      `目前時間軸上可以當 anchorId 的節點 id 有:${list || '(無 stop 節點)'}。` +
        ' anchorId 必須是這個清單裡的其中一個 id(某次 add_attraction 呼叫成功後回傳的 id),' +
        ' 不是 search_attraction 回傳的 attractionId(attraction 候選 id),兩者是不同種類的 id,不能互相替代。',
    )
  }

  return parts.join('')
}

// TimeDragBounds — getTimeDragBounds 的回傳值,拖拉互動(見
// PlanTimelineView.tsx anchorDot 的完整說明:使用者明確要求「時間軸的
// 小圓點可以拖拉,上下拉動時調整時間」)用這組上下限把拖拉即時 clamp 在
// 合法範圍內,不需要每次拖拉都呼叫一次驗證再處理失敗——跟 insertAfter
// 的時間驗證共用同一份「錨點前一個/後一個有時間的 stop」判斷邏輯
// (nearestStopNode),確保拖拉能到達的範圍跟其他時間驗證路徑(新增
// 景點時的 time_out_of_range)語意一致,不會出現「拖拉允許的範圍」跟
// 「其他地方驗證的範圍」兩套標準互相矛盾的情況。
//
// minMinutes/maxMinutes 是當日分鐘數(0~1439,見 timeToMinutes 的完整
// 說明),null 代表那一端沒有限制(該方向走到鏈結底/頭都沒找到同一天
// 的其他 stop)。呼叫端拖拉時應該把 minMinutes/maxMinutes 轉回
// "HH:MM" 字串寫回節點,不要直接把分鐘數存進 PlanNodeData.time
// (那個欄位的既有格式是字串,見 PLAN_TIME_PATTERN 的完整說明)。
export interface TimeDragBounds {
  minMinutes: number | null
  maxMinutes: number | null
}

// getTimeDragBounds — 算出 stopId 這個節點拖拉調整時間時合法的範圍。
// 下界:這個節點往前找到的最近一個同一天 stop 的時間;上界:往後找到
// 的最近一個同一天 stop 的時間——跟 insertAfter 用 nearestStopNode 算
// lowerNode/upperNode 是同一套邏輯,差別只在這裡是「對既有節點自己」
// 算範圍(排除自己,從 prevId/nextId 開始找),insertAfter 是「對準備
// 插入的新錨點位置」算範圍(從 anchorId 本身/anchorId 的 nextId 開始
// 找)。
//
// 找不到這個 id(理論上不該發生,呼叫端只會對畫面上正在渲染的既有
// 節點啟動拖拉)或這個節點不是 stop 時,回傳兩端都是 null(不限制)
// ——這不是一個會被呈現給使用者的錯誤情況,單純是防禦性的保守預設值,
// 不值得為了這種邊界情況設計結構化錯誤回傳。
export function getTimeDragBounds(timeline: PlanTimeline, stopId: string): TimeDragBounds {
  const node = timeline.nodes.get(stopId)
  if (!node || node.type !== 'stop') return { minMinutes: null, maxMinutes: null }
  const targetDay = normalizedDay(node.day)
  const lowerNode = nearestStopNode(timeline, node.prevId, 'prevId', targetDay)
  const upperNode = nearestStopNode(timeline, node.nextId, 'nextId', targetDay)
  return {
    minMinutes: lowerNode ? timeToMinutes(lowerNode.time!) : null,
    maxMinutes: upperNode ? timeToMinutes(upperNode.time!) : null,
  }
}

// insertAfter — 在 anchorId 指定的節點後面插入一個新節點,anchorId 為
// null 時插在整條時間軸最前面(成為新的 head)。
//
// 時間驗證(只在新節點是 stop 且帶了 time 時才驗證——section 沒有時間
// 先後的概念,stop 沒填 time 則代表「還沒決定幾點」,同樣不驗證,對齊
// attractionTools.ts 原本 time 為選填欄位的既有設計):新節點的
// time 必須落在「錨點往前找到的最近一個 stop 時間」與「錨點往後找到
// 的最近一個 stop 時間」之間(含錨點自己,若錨點本身就是帶時間的
// stop),超出這個範圍視為使用者/LLM 指定了一個跟目前行程順序矛盾的
// 時間,回傳 time_out_of_range 錯誤,不會插入(不做「自動移到合理位置」
// 這種靜默糾正——插入位置本身就是呼叫端明確指定的 anchorId,時間跟
// 位置對不上該讓呼叫端知道並重新決定,而不是被這裡偷偷改成別的位置)。
export function insertAfter(
  timeline: PlanTimeline,
  anchorId: string | null,
  data: PlanNodeData,
  newId: string,
): InsertAfterResult {
  if (anchorId !== null && !timeline.nodes.has(anchorId)) {
    return { ok: false, error: { code: 'anchor_not_found', message: buildAnchorNotFoundMessage(timeline, anchorId) } }
  }

  if (data.type === 'stop' && data.time) {
    if (!isValidTimeFormat(data.time)) {
      return { ok: false, error: { code: 'invalid_time_format', message: `時間 "${data.time}" 格式不正確,必須是 "HH:MM"(24 小時制)。` } }
    }
    const newMinutes = timeToMinutes(data.time)
    const targetDay = normalizedDay(data.day)
    // 下界節點:錨點本身(若是帶時間的 stop)或往前找到的最近一個
    // 同一天 stop(見 nearestStopNode 的完整說明)。
    const lowerNode = anchorId === null ? null : nearestStopNode(timeline, anchorId, 'prevId', targetDay)
    // 上界節點:錨點的下一個節點開始往後找到的最近一個同一天 stop。
    const anchorNextId = anchorId === null ? timeline.headId : (timeline.nodes.get(anchorId)?.nextId ?? null)
    const upperNode = nearestStopNode(timeline, anchorNextId, 'nextId', targetDay)
    if (lowerNode !== null && newMinutes < timeToMinutes(lowerNode.time!)) {
      return {
        ok: false,
        error: {
          code: 'time_out_of_range',
          message: buildOutOfRangeMessage(anchorId, data.time, 'early', lowerNode, upperNode),
        },
      }
    }
    if (upperNode !== null && newMinutes > timeToMinutes(upperNode.time!)) {
      return {
        ok: false,
        error: {
          code: 'time_out_of_range',
          message: buildOutOfRangeMessage(anchorId, data.time, 'late', lowerNode, upperNode),
        },
      }
    }
  }

  const nodes = new Map(timeline.nodes)
  const prevId = anchorId
  const nextId = anchorId === null ? timeline.headId : (timeline.nodes.get(anchorId)?.nextId ?? null)

  const newNode: PlanNode = { ...data, id: newId, prevId, nextId }
  nodes.set(newId, newNode)

  if (prevId !== null) {
    const prevNode = nodes.get(prevId)
    if (prevNode) nodes.set(prevId, { ...prevNode, nextId: newId })
  }
  if (nextId !== null) {
    const nextNode = nodes.get(nextId)
    if (nextNode) {
      // nextNode 原本的 transitFromPrev(若有)是跟「插入前的 prevId」
      // 之間的交通資訊——插入這個新節點後它的前一站變成 newNode,舊資料
      // 不再對應正確的兩站,理由同 removeNode 對同一情境的處理(見該函式
      // 的完整說明),這裡同樣只清空、不觸發查詢。
      const clearedTransit = nextNode.type === 'stop' && newNode.type === 'stop' ? { transitFromPrev: undefined } : {}
      nodes.set(nextId, { ...nextNode, prevId: newId, ...clearedTransit })
    }
  }

  const headId = prevId === null ? newId : timeline.headId

  return { ok: true, timeline: { nodes, headId }, insertedId: newId }
}

// RemoveNodeResult — removeNode 的結構化回傳值,對齊 insertAfter 的既有
// 設計(InsertAfterResult):呼叫端(ctx.removeStep,見 TripPlanPage.tsx
// 的完整說明)不需要自己另外用 timeline.nodes.has(id) 猜測節點是否存在再
// 決定要不要呼叫——那樣的外部檢查看不到 removing:true 這種「存在但正在
// 淡出動畫、邏輯上已經視為移除中」的中間狀態,會讓同一個 id 在動畫播放
// 期間(見 removing 欄位/REMOVE_FADE_MS 的完整說明)被重複接受移除指令。
// 讓 removeNode 自己同時判斷「不存在」與「已經在移除中」兩種情況並回傳
// 結構化錯誤,這個判斷收斂回資料層本身,呼叫端只需要看回傳值。
export type RemoveNodeErrorCode = 'anchor_not_found' | 'already_removing'

export interface RemoveNodeError {
  code: RemoveNodeErrorCode
  message: string
}

export type RemoveNodeResult =
  | { ok: true; timeline: PlanTimeline }
  | { ok: false; error: RemoveNodeError }

// removeNode — 把某個節點從鏈結中摘除,前後節點直接互相銜接。
//
// 找不到對應 id,或該節點已經標記 removing(動畫播放中,還沒真的從鏈結
// 摘除,見 removing 欄位的完整說明)時回傳結構化錯誤而非原樣返回
// timeline——後者會讓呼叫端誤以為「移除成功了」(見上方 RemoveNodeResult
// 的完整說明),尤其是 onagent 工具呼叫這種「呼叫端需要明確知道成功與否
// 才能回報給 LLM」的情境,靜默原樣返回會讓同一個 id 的第二次移除指令
// 被誤判成功。
//
// 若被移除的節點是 stop,且它的 nextId 也是 stop,那個 nextId 節點的
// transitFromPrev(見 TransitInfo 的完整說明)這裡會被同步清空——它原本
// 記錄的是「跟被移除的這一站」之間的交通資訊,移除後前一站已經變了
// (變成被移除節點的 prevId,或沒有前一站),舊資料不再有效,不能留著
// 顯示錯誤的距離/時間。這裡只負責清空(同步、純資料操作,不涉及任何
// 網路查詢),要不要背景重新查一次新的交通資訊是呼叫端的職責(見
// AIPlanTimelinePage.tsx refreshTransitForStop 的完整說明)——這裡刻意
// 不觸發查詢,理由同 insertAfter 本身也不觸發交通查詢,鏈結資料層只管
// 資料結構正確,不碰網路 I/O。
//
// opts.allowRemoving——選填,預設 false。true 時跳過「已標記 removing
// 時回傳 already_removing」這項檢查,直接執行摘除。這是修正一個實際
// 發生過的 regression:useTripPlanTimeline 的 removeStep(見該函式的
// 完整說明)本身是兩段式設計——先用 removeNode 的唯讀檢查判斷「能不能
// 開始移除」,再標記 removing:true 觸發淡出動畫,320ms 後的 setTimeout
// 才呼叫 removeNode 做「真正的摘除」。這第二次呼叫看到的節點必然已經
// 是 removing:true(上一步剛標記的),若不加這個旗標,already_removing
// 檢查會誤判這次合法的「完成移除」呼叫為重複移除而拒絕,導致節點永遠
// 卡在 removing:true、淡出動畫播完後不會真的從鏈結摘除(卡片空間繼續
// 佔位,前後節點的軸線也接不起來,因為鏈結結構沒有真正更新)。外部呼叫
// (ctx.removeStep 的唯讀檢查、onagent 工具呼叫)必須維持不帶這個旗標
// (預設 false)的嚴格行為,否則會喪失「動畫播放期間擋下重複呼叫」這項
// 原本要修的正確性保護(見本型別/RemoveNodeResult 檔頭的完整說明)。
export function removeNode(
  timeline: PlanTimeline,
  id: string,
  opts?: { allowRemoving?: boolean },
): RemoveNodeResult {
  const node = timeline.nodes.get(id)
  if (!node) {
    return { ok: false, error: { code: 'anchor_not_found', message: `找不到 id 為 "${id}" 的節點,無法移除。` } }
  }
  if (node.removing && !opts?.allowRemoving) {
    return {
      ok: false,
      error: { code: 'already_removing', message: `id 為 "${id}" 的節點已經在移除中,不需要重複移除。` },
    }
  }

  const nodes = new Map(timeline.nodes)
  nodes.delete(id)

  if (node.prevId !== null) {
    const prevNode = nodes.get(node.prevId)
    if (prevNode) nodes.set(node.prevId, { ...prevNode, nextId: node.nextId })
  }
  if (node.nextId !== null) {
    const nextNode = nodes.get(node.nextId)
    if (nextNode) {
      const clearedTransit = nextNode.type === 'stop' && node.type === 'stop' ? { transitFromPrev: undefined } : {}
      nodes.set(node.nextId, { ...nextNode, prevId: node.prevId, ...clearedTransit })
    }
  }

  const headId = timeline.headId === id ? node.nextId : timeline.headId

  return { ok: true, timeline: { nodes, headId } }
}

// updateNode — 依 id 合併更新某個節點的資料欄位,不動它的鏈結位置
// (prevId/nextId 由呼叫端的 patch 物件決定要不要覆蓋,一般呼叫端只會
// 帶資料欄位,理由同既有 updateStepById 的用途:place_id 查詢完成後
// 補上真實資料)。找不到對應 id 時原樣返回。
export function updateNode(timeline: PlanTimeline, id: string, patch: Partial<PlanNodeData>): PlanTimeline {
  const node = timeline.nodes.get(id)
  if (!node) return timeline
  const nodes = new Map(timeline.nodes)
  nodes.set(id, { ...node, ...patch })
  return { nodes, headId: timeline.headId }
}

// staleOtherAgentMessages — 話題推進(插入一個新的 stop 節點)時,把
// 時間軸上其他所有還「新鮮」(stale 未設為 true)的 message 節點(見
// PlanNodeType 的完整說明——這是獨立的對話節點,不是掛在 stop 身上的
// 欄位)一併標記成 stale,讓它們在畫面上淡化退場,但不刪除、不併入
// 任何 stop——它們依然是時間軸上自己獨立的節點。呼叫時機是「插入一個
// 新的 stop 節點之後」(不論這個新節點本身有沒有跟在它後面的 message)
// ——使用者明確要求「新景點加入後要淡化(不是合併進卡片,只是視覺上
// 退場)」,新增這個動作本身就是「話題已經推進」的訊號。excludeId 是
// 剛插入的新節點 id,傳入只是為了維持跟既有呼叫端一致的介面(一個
// stop 節點本身不可能是 message,迴圈只會處理 message 型別的節點,
// 這個排除其實恆為 no-op,但保留參數讓呼叫端不需要跟著改)。
export function staleOtherAgentMessages(timeline: PlanTimeline, excludeId: string): PlanTimeline {
  const nodes = new Map(timeline.nodes)
  let changed = false
  for (const [id, node] of nodes) {
    if (id === excludeId) continue
    if (node.type === 'message' && !node.stale) {
      nodes.set(id, { ...node, stale: true })
      changed = true
    }
  }
  return changed ? { nodes, headId: timeline.headId } : timeline
}
