// catalog.ts — 範例行程清單的純函式:排序、篩選、從資料算出篩選選項、轉成時間軸。
// 全部是不碰 React/不碰全域狀態的純函式,可以單獨測試;registry.ts 負責把
// itineraries/*.ts 收進來,這裡只吃陣列。
import { createEmptyTimeline, insertAfter, type PlanTimeline } from '../plan-core/planTimeline'
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
    typeof obj.days === 'number' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.categories) &&
    Array.isArray(obj.stops)
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

// coverPhotoOf——封面:明確指定的優先,否則取第一個有照片的站的第一張,都沒有就 null。
export function coverPhotoOf(it: SampleItinerary): string | null {
  return it.coverPhoto ?? it.stops.find((s) => s.photos && s.photos.length > 0)?.photos?.[0] ?? null
}

// toPlanTimeline——把範例行程轉成時間軸元件(plan-core/PlanTimelineView)吃的
// PlanTimeline:依序把每一站接在最後。跨天的分隔線由 toRenderList 依 day 自動
// 產生,這裡不用插。
//
// 插入失敗(時間格式錯、同一天時間沒有遞增)時跳過那一站而不是整份壞掉,並回報
// 在 skipped 裡——畫面仍能顯示其餘站點;資料本身的正確性由 itineraries.test.ts
// 對所有已登錄行程的驗證保證,正常情況 skipped 一定是空的。
export function toPlanTimeline(it: SampleItinerary): { timeline: PlanTimeline; skipped: string[] } {
  let timeline = createEmptyTimeline()
  let anchorId: string | null = null
  const skipped: string[] = []
  it.stops.forEach((stop, i) => {
    const id = `${it.id}-s${i}`
    const result = insertAfter(
      timeline,
      anchorId,
      {
        type: 'stop',
        day: stop.day ?? 1,
        time: stop.time,
        name: stop.name,
        kind: stop.kind,
        duration: stop.duration,
        desc: stop.desc,
        googlePhotoUrls: stop.photos,
        lat: stop.lat,
        lng: stop.lng,
        // 沒有照片時卡片縮圖的備用樣式(見 PlanTimelineView 的縮圖渲染)。
        thumbBg: 'var(--ios-active)',
        thumbIcon: '📍',
      },
      id,
    )
    if (result.ok) {
      timeline = result.timeline
      anchorId = id
    } else {
      skipped.push(`${stop.name}(${result.error.code})`)
    }
  })
  return { timeline, skipped }
}
