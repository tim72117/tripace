// catalog.ts — 範例行程清單的純函式:排序、篩選、從資料算出篩選選項、轉成時間軸。
// 全部是不碰 React/不碰全域狀態的純函式,可以單獨測試;registry.ts 負責把
// itineraries/*.ts 收進來,這裡只吃陣列。
import { estimateTransit } from './estimateTransit'
import { countNodes, type PlanNode, type PlanTimeline } from '../planning/timeline/model'
import type { SampleItinerary } from './types'

// sortByNewest——依上架日期由新到舊;同一天的維持傳入順序(穩定排序),
// 不依賴檔名,避免「檔名排序」意外決定畫面順序。
export function sortByNewest(items: SampleItinerary[]): SampleItinerary[] {
  return [...items].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0))
}

// FilterOption——篩選列上的一個選項與它底下有幾份行程。
export interface FilterOption {
  value: string
  count: number
}

export interface Filters {
  regions: FilterOption[]
  categories: FilterOption[]
}

function countBy(values: string[]): FilterOption[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  // 份數多的在前;份數相同時依首次出現順序(Map 保持插入順序,sort 穩定)。
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}

// deriveFilters——篩選選項由資料自己算出來,新增行程帶了新的地區/分類,
// 篩選列就自動多一個選項,不需要改任何型別或清單。
export function deriveFilters(items: SampleItinerary[]): Filters {
  return {
    regions: countBy(items.map((it) => it.region)),
    categories: countBy(items.flatMap((it) => it.categories)),
  }
}

export interface FilterSelection {
  region: string | null
  category: string | null
}

// filterItineraries——兩個條件同時成立才留下(地區 AND 分類);null 代表不限。
export function filterItineraries(items: SampleItinerary[], sel: FilterSelection): SampleItinerary[] {
  return items.filter(
    (it) => (sel.region === null || it.region === sel.region) && (sel.category === null || it.categories.includes(sel.category)),
  )
}

export function findItinerary(items: SampleItinerary[], id: string): SampleItinerary | null {
  return items.find((it) => it.id === id) ?? null
}

// isSampleItineraryShape——API 回應的 content 是 unknown(見 api.ts
// fetchPublicItineraryPage/fetchPublicItineraryPageList 的完整說明,型別
// 不耦合這個模組),渲染前做最小形狀驗證,理由同 BlogArticlePage.tsx 的
// isThemePageContentShape:只檢查頂層必填欄位(title/stops 等),不逐一
// 驗證每個 stop 的內部欄位——那層驗證複雜度不值得放在渲染前的守門邏輯,
// 且發布時 CLI/後端已經存了什麼就是什麼,這裡只是避免 HTTP 200 但形狀
// 不對時直接對 undefined 操作而整頁壞掉。原本只在 AiItineraryDetailPage.tsx
// 內部定義,2026-10 搬到這裡共用——清單頁(AiItinerariesRoute.tsx)合併
// 資料庫行程時也需要同一層驗證,不是只有詳細頁需要。
export function isSampleItineraryShape(v: unknown): v is SampleItinerary {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.region === 'string' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.categories) &&
    typeof obj.timeline === 'object' &&
    obj.timeline !== null &&
    Array.isArray((obj.timeline as { days?: unknown }).days)
  )
}

// mergeWithApiItineraries——清單頁顯示的行程 = 靜態 registry.ts 清單 +
// 已發布進資料庫的行程(見 AiItinerariesRoute.tsx 的完整說明:清單頁
// 原本只讀 registry.ts,沒有打 fetchPublicItineraryPageList,導致透過
// CLI 發布的行程雖然詳細頁能看到、卻不會出現在清單上)。同一個 id 以
// API 回應為準(資料庫內容可能比靜態檔案新),靜態清單裡剩餘、API 沒有
// 回應的 id 原樣保留——API 清單只包含已發布進資料庫的行程,其餘十幾份
// 還是靜態檔案的行程不受影響。
export function mergeWithApiItineraries(staticItems: SampleItinerary[], apiItems: SampleItinerary[]): SampleItinerary[] {
  const apiIds = new Set(apiItems.map((it) => it.id))
  return sortByNewest([...apiItems, ...staticItems.filter((it) => !apiIds.has(it.id))])
}

// coverPhotoOf——封面:只用行程明確指定的 coverPhoto,沒有就 null(清單頁顯示預設圖示)。節點裡不存照片網址(照片經 placeId 由資料存取層
// 查,清單頁沒有這層查詢),所以不再退回「第一站的第一張照片」。
export function coverPhotoOf(it: SampleItinerary): string | null {
  return it.coverPhoto ?? null
}

// dayCountOf——行程總天數(時間軸的天數,不另外存欄位)。
export function dayCountOf(it: SampleItinerary): number {
  return it.timeline.days.length
}

// stopCountOf——行程的站數。時間軸的節點只剩 stop(PlanNodeType),直接用領域層的 countNodes。
export function stopCountOf(it: SampleItinerary): number {
  return countNodes(it.timeline)
}

// allNodesOf——行程裡依序的所有節點(跨天攤平),給只需要「有哪些站」的使用端(封面、初始地圖中心、景點光暈城市等)。
// 刻意不改用領域層的 listNodes:listNodes 會替每個節點補上衍生的 day,而 itineraries.test.ts 要驗「存下來的原始節點沒有 day 欄位」,
// 需要拿到未經加工的節點(這裡回傳的是資料本身)。
export function allNodesOf(it: SampleItinerary): PlanNode[] {
  return it.timeline.days.flatMap((d) => d.nodes)
}

// toPlanTimeline——行程的時間軸本身就是 PlanTimeline(資料規格與 /ai-plan、登入後一致,不需要轉換),這裡只做載入時的補值,
// 回傳新物件、不改動 registry 裡的原始資料:
//   - lodgings(住宿)原樣帶過去(旅館的名稱、座標、照片由視圖與地圖執行時經 placeId 查,不在這裡補值)。
//   - transitFromPrev:人工寫的優先;沒寫時,同一天內前一個 stop 與這一站都有座標,就用直線距離粗估(見 estimateTransit.ts,
//     同步、不打 API)。每天第一站、沒有座標的站不畫。
//   - thumbBg/thumbIcon:沒有照片時卡片縮圖的備用樣式(見 PlanTimelineView 的縮圖渲染);資料有寫就尊重資料。
// 時間格式、同一天時間遞增、id 唯一等資料正確性由 itineraries.test.ts 對所有已登錄行程的驗證保證。
export function toPlanTimeline(it: SampleItinerary): { timeline: PlanTimeline } {
  const days = it.timeline.days.map((day) => {
    let prevStop: PlanNode | undefined
    const nodes = day.nodes.map((node) => {
      if (node.type !== 'stop') return node
      const estimateFromPrev =
        prevStop && prevStop.lat != null && prevStop.lng != null && node.lat != null && node.lng != null
          ? estimateTransit({ lat: prevStop.lat, lng: prevStop.lng }, { lat: node.lat, lng: node.lng })
          : undefined
      prevStop = node
      return {
        ...node,
        transitFromPrev: node.transitFromPrev ?? estimateFromPrev,
        thumbBg: node.thumbBg ?? 'var(--ios-active)',
        thumbIcon: node.thumbIcon ?? '📍',
      }
    })
    return { ...day, nodes }
  })
  return { timeline: { ...it.timeline, days } }
}
