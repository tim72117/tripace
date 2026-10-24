import { minimalChild, type PlanDataRefKind, type ResolvedNodeRefs } from './planDataStore'
import type { PlanLodging, PlanNode, PlanThemeChild } from './planTimeline'

// useResolvedNodeRefs.ts(plan-core)——節點上的 id(PlanNodeData.attractions / places / 站點 placeId / 旅館 placeId,
// 見該欄位的完整說明)解析結果的「純函式取用端」:把 id → PlanThemeChild 的表(ResolvedNodeRefs)轉成各處要用的形狀。
//
// 2026-10 重構:解析本身(查詢、快取、失敗與重試、照片補查)搬到 planDataStore.ts(一個資料來源實例一個 store、
// 全應用共用),React 端的消費 hook 是 PlanDataProvider.tsx 的 useResolvedRefs。這個檔案原本的模組層 promise 快取、
// failedChildren WeakSet 與 hook 實例 state 都已移除,只留下不依賴 React 的 helper(檔名沿用以免大範圍改 import)。
//
// 節點只存 id(使用者定案的資料規格),名稱、座標、摘要、照片一律用 id 查詢,查到的結果「只存在執行時」——
// 不寫進節點、不寫進 localStorage 草稿。模擬態(假資料來源)與推論態(真資料來源)走同一條「用 id 查」的路徑。
// 站點卡片的照片也是這樣取(重整後由 store 依 placeId 自動補查,照片取得的重試在 store 內)。
// 查詢失敗(拋例外、found:false、資料來源沒實作 attractionByID)一律退回只有 id 的最小項目,絕不丟例外。

// ResolvedNodeRefs——型別定義在 planDataStore.ts,這裡重新匯出讓既有 import 不必改。
export type { ResolvedNodeRefs }

type RefKind = PlanDataRefKind

// nodeRefEntries——節點底下包含的 id(attractions 在前、places 在後,同一 id 只算一次)。
export function nodeRefEntries(node: Pick<PlanNode, 'attractions' | 'places'>): { id: string; kind: RefKind }[] {
  const out: { id: string; kind: RefKind }[] = []
  const seen = new Set<string>()
  for (const id of node.attractions ?? []) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push({ id, kind: 'attraction' })
    }
  }
  for (const id of node.places ?? []) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push({ id, kind: 'place' })
    }
  }
  return out
}

// nodeOwnPlaceId——站點自己的 placeId(要解析來取照片;跟 nodeRefEntries 的 places 是兩回事:
// 後者是「主題點底下的子景點」,不能把站點本身混進去,否則會被畫成自己的子景點)。
export function nodeOwnPlaceId(node: Pick<PlanNode, 'type' | 'placeId'>): string | undefined {
  return node.type === 'stop' && node.placeId ? node.placeId : undefined
}

// resolveNodeRefChildren——節點底下的子景點清單(依 nodeRefEntries 的順序),每個 id 取 resolved 裡的
// 解析結果,沒有就用最小項目;再把節點的 farFromNext 清單蓋成各項目的 farFromNext 旗標。
// 純函式,沒有節點用到 id 時回空陣列。
export function resolveNodeRefChildren(
  node: Pick<PlanNode, 'attractions' | 'places' | 'farFromNext'>,
  resolved: ResolvedNodeRefs,
): PlanThemeChild[] {
  const far = node.farFromNext
  return nodeRefEntries(node).map(({ id, kind }) => {
    const child = resolved.get(id) ?? minimalChild(id, kind)
    return far?.includes(id) ? { ...child, farFromNext: true } : child
  })
}

// resolveMapChildren——地圖主題點展開用的子景點小點(PlanStopMarker.children 的形狀):
// 只收已經查到座標的項目,理由同 PlanStopMarker.children 的說明(沒座標畫不出來,
// 查詢完成前主題點先當一般站點,查到後 stops 換參照才展開)。
export function resolveMapChildren(
  node: Pick<PlanNode, 'attractions' | 'places' | 'farFromNext'>,
  resolved: ResolvedNodeRefs,
): { id: string; lat: number; lng: number; name?: string }[] {
  return resolveNodeRefChildren(node, resolved)
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, name: c.name }))
}

// ───────────── 住宿(PlanTimeline.lodgings)─────────────
// 旅館只存 placeId,名稱、座標、照片與主題點底下的 places 同一條路徑:resolveRef(kind 'place')、同一份快取、同一張
// ResolvedNodeRefs 表(key 是 placeId)。所以 useResolvedNodeRefs 多收一個 lodgings 參數,同一個 hook 一併查,
// 視圖與地圖用 resolveLodging / lodgingMapMarkers 從表裡取。

// LodgingView——旅館執行時的顯示資料。name 依序取:placeId 查到的名稱、作者寫的 name、(都沒有)undefined,
// 呼叫端顯示時再退回「住宿」;座標只有查到才有。
export interface LodgingView {
  name?: string
  lat?: number
  lng?: number
  googlePhotoUrls?: string[]
}

export const LODGING_FALLBACK_NAME = '住宿'

export function resolveLodging(lodging: Pick<PlanLodging, 'placeId' | 'name'>, resolved: ResolvedNodeRefs): LodgingView {
  const hit = lodging.placeId ? resolved.get(lodging.placeId) : undefined
  return {
    name: hit?.name || lodging.name || undefined,
    lat: hit?.lat,
    lng: hit?.lng,
    googlePhotoUrls: hit?.googlePhotoUrls,
  }
}

// LODGING_MARKER_GLYPH/LODGING_MARKER_SIZE——地圖上旅館圓點的圖示(床)與尺寸:同美食清單點的做法
// (PlanStopMarker.glyph / size,畫在 14x14 畫布、圓心 (7,7) 的白色線條),尺寸略大於站點圓點,一眼分辨是旅館。
export const LODGING_MARKER_GLYPH =
  '<g stroke="#FDFCFA" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
  '<path d="M3.2 9.6V4.4"/><path d="M3.2 8.4h7.6v1.2"/><path d="M3.2 6.9h4.4a2 2 0 0 1 2 2"/>' +
  '</g>'
export const LODGING_MARKER_SIZE = 20

// lodgingMapMarkers——旅館的地圖圓點(PlanStopMarker 形狀,lodging: true 讓路線線段略過它):
// 只收已經查到座標的旅館(沒座標畫不出來,查到後 resolved 換參照才出現),id 是旅館自己的 id。
export function lodgingMapMarkers(
  lodgings: readonly PlanLodging[],
  resolved: ResolvedNodeRefs,
): { id: string; lat: number; lng: number; name?: string; glyph: string; size: number; lodging: true }[] {
  const out: { id: string; lat: number; lng: number; name?: string; glyph: string; size: number; lodging: true }[] = []
  for (const l of lodgings) {
    const v = resolveLodging(l, resolved)
    if (v.lat == null || v.lng == null) continue
    out.push({ id: l.id, lat: v.lat, lng: v.lng, name: v.name, glyph: LODGING_MARKER_GLYPH, size: LODGING_MARKER_SIZE, lodging: true })
  }
  return out
}
