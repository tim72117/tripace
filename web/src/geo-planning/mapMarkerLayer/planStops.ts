// planStops.ts——行程站點圓點的資料模型(2026-10 由 mapMarkerLayer 的 types.ts、reducer.ts、planStopsToPoints.ts 合併):
//   1. 型別:MapMarkerPoint 等,統一的「點」描述(站點、主題點、子景點、精選點),供站點圓點功能層使用。
//   2. resolveExpandedThemeId:選中的點是哪個,該展開哪個主題點——純函式,由選取與點清單算出的衍生值,不是 state。
//   3. planStopsToPoints:把規劃面板(TripPlanPage)回報的站點轉成上述的點。
// 使用端:mapDrawLayer/useSharedDrawLayer.ts、featureLayers/planStopLayer.ts、plan-core/usePlanStopsState.ts、planMapShared.ts。
//
// 設計原則(沿用原本的說明):選取與 hover 完全由外部持有(受控,同 <input value onChange>),這裡只根據目前的
// selectedId/hoverId 算出每個點該長什麼樣子;使用者點擊或 hover 時只回報意圖,不回報結果,所以不會形成
// 「受控 prop 進→內部改→通知出→呼叫端寫回」的環(那曾造成 "Maximum update depth exceeded")。
import type { PlanStopMarker } from '../usePlanStopMarkers'

// ===== 型別 =====

/** MapPointKind——統一的點類型軸,取代原本 mapMarkers.ts
 *  searchResultMarkerContent 用 kind: 'hotel'|'place'|'geocode' 分流、
 *  但 usePlanStopMarkers 的 PlanStopMarker 完全沒有 kind 概念(靠逐點
 *  附加 glyph/size 客製,AiItineraryDetailPageMapView.tsx 把「美食點」
 *  跟「一般站點」混在同一個陣列裡的不一致做法)。
 *
 *  - 'attraction':一般站點/景點,三態(base/hover/selected)。
 *  - 'theme':主題點/聚合點——選中時展開範圍圓圈+children 顯示
 *    (取代原本 useThemeRadiusCircle 需要外部另外算 expandedThemeNode
 *    再傳 center/children 進來的做法,這裡只要點本身帶 children,內部
 *    用 selectedId 衍生判斷要不要展開)。
 *  - 'themeChild':主題點展開後的子景點——純展示小點,無法獨立被選取/
 *    hover(對齊 useThemeRadiusCircle 原本「子景點小點完全是純展示用
 *    途,沒有 onClick」的既有限制,這裡延續而非擴大範圍)。
 *  - 'featured':精選點(itineraries/AiItineraryDetailPageMapView.tsx
 *    美食清單點的語意延伸,跟一般站點共用選取焦點但可能需要視覺區分)。
 *  - 'custom':保留給未來擴充、這份型別還沒預先命名的點類型,搭配
 *    glyph/size 客製化,不需要為每個新用途都先修改這份列舉。
 */
export type MapPointKind = 'attraction' | 'theme' | 'themeChild' | 'featured' | 'custom'

/** MapMarkerPoint——單一個點的完整資料。children 只在 kind:'theme' 時
 *  有意義,驅動範圍圓圈+子景點小點(取代 useThemeRadiusCircle.ts
 *  ThemeChildPoint 的獨立型別,子景點直接巢狀在父點底下,不需要外部
 *  另外維護一份「目前展開到哪個主題點」的狀態去關聯兩者)。 */
export interface MapMarkerPoint {
  id: string
  lat: number
  lng: number
  name?: string
  kind: MapPointKind
  /** 疊在圓點正中央的 SVG fragment(食物 icon 等用途)——對齊
   *  usePlanStopMarkers.ts PlanStopMarker.glyph 的既有用法。 */
  glyph?: string
  /** 整顆圓點渲染尺寸,預設 14px——對齊 PlanStopMarker.size 的既有用法。 */
  size?: number
  /** 只在 kind:'theme' 時有意義。選中這個點時,若 children 非空,
   *  expandedThemeId 這個衍生值會指向這個點(見 resolveExpandedThemeId 的完整
   *  說明,取代 useThemeRadiusCircle.ts THEME_RADIUS_METERS 固定半徑
   *  的既有設計,這裡延續)。 */
  children?: MapMarkerChildPoint[]
}

/** MapMarkerChildPoint——主題點展開後的子景點,純展示用,見 MapPointKind
 *  'themeChild' 的完整說明。 */
export interface MapMarkerChildPoint {
  id: string
  lat: number
  lng: number
  name?: string
}

/** HoverTransitPair——交通膠囊 hover 時,兩端站點同時進入 hover 視覺的
 *  訊號(取代 usePlanStopMarkers.ts hoverTransitPair 參數的既有用法,
 *  見 isHoverViaTransitPair 的完整說明:兩者同時命中同一個 id 時最終
 *  呈現 selected 優先)。只在 supportsHover 為 true 時有意義——手機版
 *  (supportsHover:false)完全不支援這個訊號,見下方 props 的完整說明。 */
export interface HoverTransitPair {
  fromId: string
  toId: string
}

/** findPoint——在扁平 points 陣列裡依 id 找點。子景點(themeChild)本身
 *  不會獨立出現在這份陣列裡,而是巢狀在父主題點的 children 底下,所以
 *  若直接查無,再往每個 theme 點的 children 裡找一次——這是 2026-10
 *  修正:選中的 id 剛好是某個已展開子景點時,若只查 points 本身,一律
 *  查無此點,會被誤判成「選到不是主題點的一般點」而把 expandedThemeId
 *  收合,導致範圍圓圈/子景點小點選到一半自己消失,也讓
 *  站點圖層原本想處理「子景點 id」那段路徑永遠到不了。 */
function findPoint(points: MapMarkerPoint[], id: string): MapMarkerPoint | undefined {
  const direct = points.find((p) => p.id === id)
  if (direct) return direct
  for (const p of points) {
    if (p.kind === 'theme' && p.children?.some((c) => c.id === id)) return p
  }
  return undefined
}

/** resolveExpandedThemeId——目前選取的 id 之下,該展開哪個主題點(回傳
 *  null 代表不展開任何主題點)。
 *
 *  選中的點本身是 kind:'theme' 且 children 非空時展開(回傳該點 id);
 *  選中的點是某個主題點的子景點時,一併展開該父主題點(見 findPoint 的
 *  完整說明——否則子景點被選中時反而看不到自己所屬的範圍圓圈);選中
 *  其他任何點、或 id 是 null、或查無此點時收合(回傳 null)——對齊原本
 *  home/plan-ai-sim/Content.tsx expandedThemeId effect「選到其他站點或清空
 *  選取時收合」的既有行為。
 *
 *  2026-10 改版:這是純函式,直接依賴 selectedId+points 當下的值算出
 *  結果,不是 state——每次 render 用 useMemo 重算即可,不需要像舊版
 *  那樣額外處理「children 非同步晚到、selectedId 沒變但該不該重新展開」
 *  這類 state 同步時機問題,因為根本沒有需要同步的 state。 */
export function resolveExpandedThemeId(selectedId: string | null, points: MapMarkerPoint[]): string | null {
  if (selectedId == null) return null
  const point = findPoint(points, selectedId)
  if (!point) return null
  if (point.kind !== 'theme') return null
  if (!point.children || point.children.length === 0) return null
  return point.id
}

// planStopsToPoints——把 TripPlanPage 回報的站點(PlanStopMarker[])轉成站點圓點功能層要的點。
//
// 兩邊(/ai-plan 推論態、登入後 PlanMap)的站點資料來源相同,都是 TripPlanPage 的 mapStops;
// 唯一的規格差別是 MapMarkerPoint 多一個必填的 kind。kind 不需要資料另外帶,從 children 推導:
// 有子景點的是主題點('theme',選中時展開範圍圓圈與子景點小點),其餘是一般站點('attraction')。
// children 為空陣列視同沒有,不算主題點。glyph、size 有帶就保留。
export function planStopsToPoints(stops: PlanStopMarker[]): MapMarkerPoint[] {
  return stops.map((s) => {
    const base = {
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      name: s.name,
      ...(s.glyph !== undefined ? { glyph: s.glyph } : {}),
      ...(s.size !== undefined ? { size: s.size } : {}),
    }
    if (s.children && s.children.length > 0) {
      return { ...base, kind: 'theme' as const, children: s.children }
    }
    return { ...base, kind: 'attraction' as const }
  })
}
