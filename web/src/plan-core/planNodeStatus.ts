// planNodeStatus.ts — 時間軸節點的「執行狀態」,純型別與純函式,不依賴 React。
//
// 為什麼獨立成一份狀態表:PlanNodeData 只該放要存檔的「行程資料」(名稱、時間、座標、placeId、備註…)。
// 下面這三個旗標只在「這次畫面」有意義,頁面一關閉就失去對應的非同步動作:
//   loading   正在向資料存取層查這一站的真實地點資料(查詢隨頁面關閉就結束,沒有人會把它翻回 false);
//   failed    這一站的地點資料查詢失敗(畫面顯示錯誤與「重試」);
//   removing  已收到移除指示、正在播淡出動畫(真正的摘除由呼叫端在動畫結束後做,計時器隨頁面關閉消失)。
// 原本它們混在節點上,存檔要靠 sanitizeNode 特地剝掉,視圖與領域函式也都得讀節點上的旗標。現在改成
// 「以節點 id 為 key 的獨立狀態表」(概念同查詢快取:持久資料與非同步/執行時狀態分離):節點只留行程資料,
// 狀態表不持久化、重整就是空的,由查詢流程(resolveAttractionForStep)與兩階段移除寫入、視圖讀取。
//
// 所有寫入函式都回傳新的 Map、不改動傳入的那一份;沒有實際變動時回傳同一個參照(方便 React 當 state 時
// 不做無謂的重渲染)。表裡只存「為 true 的旗標」:全部旗標都沒了的節點直接不在表裡,所以
// 「查詢完成」與「從沒查過」在表裡是同一種樣子。

export interface NodeStatus {
  loading?: boolean
  failed?: boolean
  removing?: boolean
}

export type NodeStatusMap = ReadonlyMap<string, NodeStatus>

export const EMPTY_NODE_STATUS: NodeStatusMap = new Map()
const NO_STATUS: NodeStatus = Object.freeze({})

// nodeStatusOf——取某節點的狀態,沒有就回一個共用的空物件(不必到處判斷 undefined)。
export function nodeStatusOf(map: NodeStatusMap | undefined, id: string): NodeStatus {
  return map?.get(id) ?? NO_STATUS
}

// normalize——只留為 true 的旗標;全部沒有回 undefined(代表該節點不需要佔表裡一筆)。
function normalize(s: NodeStatus): NodeStatus | undefined {
  const out: NodeStatus = {}
  if (s.loading) out.loading = true
  if (s.failed) out.failed = true
  if (s.removing) out.removing = true
  return out.loading || out.failed || out.removing ? out : undefined
}

function sameStatus(a: NodeStatus | undefined, b: NodeStatus | undefined): boolean {
  return !!a?.loading === !!b?.loading && !!a?.failed === !!b?.failed && !!a?.removing === !!b?.removing
}

// setNodeStatus——把 patch 合併進某節點的狀態(patch 裡的 false/undefined 代表「清掉這個旗標」,沒寫到的旗標不動)。
// 例如重試一站是 { loading: true, failed: false }:標成查詢中並清掉上次的失敗。結果沒有任何旗標就移除該節點的紀錄;
// 與原本相同則回傳同一個參照。
export function setNodeStatus(map: NodeStatusMap, id: string, patch: NodeStatus): NodeStatusMap {
  const prev = map.get(id)
  const merged: NodeStatus = { ...prev }
  for (const key of ['loading', 'failed', 'removing'] as const) {
    if (key in patch) merged[key] = patch[key]
  }
  const next = normalize(merged)
  if (sameStatus(prev, next)) return map
  const out = new Map(map)
  if (next) out.set(id, next)
  else out.delete(id)
  return out
}

// clearNodeStatus——整筆清掉某節點的狀態;本來就沒有則回傳同一個參照。
export function clearNodeStatus(map: NodeStatusMap, id: string): NodeStatusMap {
  if (!map.has(id)) return map
  const out = new Map(map)
  out.delete(id)
  return out
}

// pruneNodeStatus——只保留還存在的節點的狀態(節點被移除、時間軸被清空或換成別份內容時,對應的狀態一併丟掉,
// 不會有「節點沒了、狀態還在」的殘留,也不會讓新節點意外繼承到舊 id 的狀態)。沒有需要丟的就回傳同一個參照。
export function pruneNodeStatus(map: NodeStatusMap, existingIds: ReadonlySet<string>): NodeStatusMap {
  let out: Map<string, NodeStatus> | null = null
  for (const id of map.keys()) {
    if (existingIds.has(id)) continue
    if (!out) out = new Map(map)
    out.delete(id)
  }
  return out ?? map
}
