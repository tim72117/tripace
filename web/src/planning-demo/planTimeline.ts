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
export type PlanNodeType = 'section' | 'stop' | 'transit' | 'note'

// PlanNodeData — 節點除了鏈結指標(prevId/nextId)以外的實際內容,涵蓋
// AIPlanTimelinePage.tsx 原本 PlanStep 的全部展示欄位(含 loading/
// removing/photoUrl 這類只在 stop 節點上有意義的 UI 呈現/非同步查詢
// 狀態欄位)——這些欄位跟 icon/mode 只在 transit 節點上有意義是同一種
// 性質(不同節點型別各自只用到欄位的子集),不需要為了「純資料 vs UI
// 狀態」這條界線另外拆一層泛型,那樣只會讓 insertAfter/updateNode/
// toRenderList 都要重新宣告泛型參數,徒增複雜度卻沒有實質收益。
export interface PlanNodeData {
  type: PlanNodeType
  // section
  label?: string
  // stop
  time?: string
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  // placeId:Google Place ID,只有查詢/新增流程知道真實地點時才會有值
  // (search_attraction/add_attraction 這條路徑,見 attractionTools.ts
  // 的完整說明)——用來在插入節點之後,背景觸發
  // fetchPublicGeoPlaceDetailsAny 補上完整資料(見
  // AIPlanTimelinePage.tsx insertAttractionAfter 的完整說明)。模擬 WS
  // 腳本路徑(planActionToInsert)也有一份同樣用途的 placeId 概念,見該處
  // 的完整說明。
  placeId?: string
  // stop 的即時查詢狀態——loading 表示這筆帶了 placeId、正在查詢真實
  // 地點資料中(縮圖/敘事文字先用假資料佔位);查完後 photoUrl/desc 會
  // 被真實資料覆蓋,loading 轉 false。沒有 placeId 的 stop 這個欄位固定
  // 是 false,直接顯示假資料。
  loading?: boolean
  photoUrl?: string
  // removing:這一筆已收到移除指示,正在播放淡出動畫、還沒真的從鏈結
  // 摘除(見 removeNode 的完整說明)——渲染時套用淡出 CSS class,動畫
  // 結束後由呼叫端延遲真正呼叫 removeNode,不是收到指示就立刻讓 DOM
  // 節點瞬間消失。
  removing?: boolean
  // lat/lng:右上角固定小地圖用——點擊這張卡片時 panTo 到這個座標。
  lat?: number
  lng?: number
  // transit
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
  // note
  color?: string
  noteIcon?: string
  text?: string
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

// toRenderList — 沿著鏈結從 headId 走訪到底,產出供 JSX .map() 使用的
// 陣列。這是唯一把鏈結「攤平」成陣列的地方,渲染層不該自己走訪 Map。
// 孤兒節點(存在於 nodes 但走訪不到,理論上不該發生,insertAfter/
// removeNode 都會維持鏈結完整性)不會出現在結果裡——防禦性地忽略,
// 不是靜默吃掉真正的 bug:若鏈結真的斷裂,問題該在寫入路徑(insertAfter/
// removeNode)本身被發現,不是在渲染這裡才表現成「某個節點憑空消失」。
export function toRenderList(timeline: PlanTimeline): PlanNode[] {
  const result: PlanNode[] = []
  let cursor = timeline.headId
  const visited = new Set<string>()
  while (cursor !== null) {
    if (visited.has(cursor)) break // 防禦性:避免鏈結若不慎成環造成無限迴圈
    visited.add(cursor)
    const node = timeline.nodes.get(cursor)
    if (!node) break
    result.push(node)
    cursor = node.nextId
  }
  return result
}

// PLAN_TIME_PATTERN — 固定 "HH:MM" 24 小時制格式,對齊 attractionPool.ts/
// plan_sim_ws.go 既有資料("08:30"、"15:00" 這類),不支援其他寫法
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
// section/transit/note——這些節點沒有 time 欄位,不能拿來當時間範圍
// 比對的邊界,必須繼續往下一個找,直到遇到有時間的 stop 或鏈結到底
// 為止。回傳完整節點(而非只回傳分鐘數)——使用者明確要求「有錯誤的
// 時候要給明確的指引跟必要資訊,不能晚於/早於都要給予目前的值」,
// 呼叫端(insertAfter 的錯誤訊息)需要節點的 id/name/time 才能組出
// 「請用 XX(id)當錨點,它的時間是 YY」這種可操作的具體指引,只有分鐘數
// 無法組出這樣的訊息。
function nearestStopNode(
  timeline: PlanTimeline,
  startId: string | null,
  direction: 'prevId' | 'nextId',
): PlanNode | null {
  let cursor = startId
  while (cursor !== null) {
    const node = timeline.nodes.get(cursor)
    if (!node) return null
    if (node.type === 'stop' && node.time && isValidTimeFormat(node.time)) {
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

// insertAfter — 在 anchorId 指定的節點後面插入一個新節點,anchorId 為
// null 時插在整條時間軸最前面(成為新的 head)。
//
// 時間驗證(只在新節點是 stop 且帶了 time 時才驗證——section/transit/note
// 沒有時間先後的概念,stop 沒填 time 則代表「還沒決定幾點」,同樣不驗證,
// 對齊 attractionTools.ts 原本 time 為選填欄位的既有設計):新節點的
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
    return { ok: false, error: { code: 'anchor_not_found', message: `找不到 id 為 "${anchorId}" 的節點,無法插入在它後面。` } }
  }

  if (data.type === 'stop' && data.time) {
    if (!isValidTimeFormat(data.time)) {
      return { ok: false, error: { code: 'invalid_time_format', message: `時間 "${data.time}" 格式不正確,必須是 "HH:MM"(24 小時制)。` } }
    }
    const newMinutes = timeToMinutes(data.time)
    // 下界節點:錨點本身(若是帶時間的 stop)或往前找到的最近一個 stop。
    const lowerNode = anchorId === null ? null : nearestStopNode(timeline, anchorId, 'prevId')
    // 上界節點:錨點的下一個節點開始往後找到的最近一個 stop。
    const anchorNextId = anchorId === null ? timeline.headId : (timeline.nodes.get(anchorId)?.nextId ?? null)
    const upperNode = nearestStopNode(timeline, anchorNextId, 'nextId')
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
    if (nextNode) nodes.set(nextId, { ...nextNode, prevId: newId })
  }

  const headId = prevId === null ? newId : timeline.headId

  return { ok: true, timeline: { nodes, headId }, insertedId: newId }
}

// removeNode — 把某個節點從鏈結中摘除,前後節點直接互相銜接。找不到
// 對應 id 時原樣返回(理由同既有 pruneRemoved/updateStepById 的一貫
// 處理方式,呼叫端已經在別處判斷過節點是否存在,這裡不重複拋錯)。
export function removeNode(timeline: PlanTimeline, id: string): PlanTimeline {
  const node = timeline.nodes.get(id)
  if (!node) return timeline

  const nodes = new Map(timeline.nodes)
  nodes.delete(id)

  if (node.prevId !== null) {
    const prevNode = nodes.get(node.prevId)
    if (prevNode) nodes.set(node.prevId, { ...prevNode, nextId: node.nextId })
  }
  if (node.nextId !== null) {
    const nextNode = nodes.get(node.nextId)
    if (nextNode) nodes.set(node.nextId, { ...nextNode, prevId: node.prevId })
  }

  const headId = timeline.headId === id ? node.nextId : timeline.headId

  return { nodes, headId }
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
