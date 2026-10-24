import { useMemo } from 'react'
import { BASE_URL } from '../AppCommon'
import { getPlanAiPublicDataSource } from '../home/plan-ai-sim/planAiPublicDataSource'
import { createEmptyTimeline, listNodes, lodgingsOf, type PlanTimeline } from '../plan-core/planTimeline'
import { useResolvedRefs } from '../plan-core/PlanDataProvider'
import { toPlanTimeline } from './catalog'
import type { SampleItinerary } from './types'

// publicDataSource——行程詳情頁的資料存取層(AiItineraryDetailPage 在根部用它建 PlanDataProvider):讀取地點資料是訪客動作,
// 不需要使用者自己的 JWT,用訪客版資料存取層實例(理由同 AiItineraryDetailPage.tsx 的訪客設定)。
export const publicDataSource = getPlanAiPublicDataSource(BASE_URL)

// useResolvedItineraryTimeline——行程詳情頁「唯一一份」時間軸資料(2026-10 重構:原本座標由
// resolveAttractionForStep 寫回節點、頁面另有一份沒解析的時間軸,現在只留一份、座標從共用的 planDataStore 取)。
//
// 起點是 toPlanTimeline(itinerary):站點座標先用行程檔案寫的值(查詢前、查詢失敗時的備用,地圖與時間軸立刻有東西)。
// 帶 placeId 的站點,store 查到座標就以 store 為準(資料存取層是權威)並蓋在節點上;名稱與說明維持行程作者寫的
// (例如「古城漫步」對應到的地點叫 Tha Phae Gate,地點資料只負責位置,所以不蓋名稱)。查不到(found:false、拋例外)
// 維持行程檔案的內容、不標任何失敗(卡片是唯讀的)。照片不寫進節點,視圖用 placeId 向 store 取。
// 同一個 placeId 出現在多站(例如連住同一個園區)與頁面上其他消費者(時間軸視圖、地圖旅館圓點)共用 store 的同一筆,只查一次。
//
// itinerary 為 undefined(還在載入、找不到)時回空時間軸,讓呼叫端不必為了 hook 順序拆元件。
// 回傳 PlanTimeline(依天分組,視圖自己依天畫標題;要查節點用 listNodes)。行程物件一換(換成另一份行程,或同一份行程的內容換版——
// 例如先用靜態版掛載、API 回來後換成資料庫版,兩者 id 相同)就重新建立;解析結果是衍生值,不會有舊結果回寫到新內容的競態。
// 需在 PlanDataProvider 底下使用。
export function useResolvedItineraryTimeline(itinerary: SampleItinerary | undefined): PlanTimeline {
  const base = useMemo(() => (itinerary ? toPlanTimeline(itinerary).timeline : createEmptyTimeline()), [itinerary])
  const resolved = useResolvedRefs(useMemo(() => listNodes(base), [base]), lodgingsOf(base))

  // 座標覆蓋:只有 store 查到座標的站才有。用內容字串當 memo 依賴——store 快照任何一筆變動(含無關的 id)都會換參照,
  // 內容沒變就不該換出新的時間軸(下游的地圖標記、連線段都以它為依賴)。
  const overrides = new Map<string, { lat: number; lng: number }>()
  for (const day of base.days) {
    for (const n of day.nodes) {
      if (n.type !== 'stop' || !n.placeId) continue
      const hit = resolved.get(n.placeId)
      if (hit?.lat != null && hit.lng != null) overrides.set(n.id, { lat: hit.lat, lng: hit.lng })
    }
  }
  const overridesKey = [...overrides].map(([id, c]) => `${id}:${c.lat},${c.lng}`).join('|')
  return useMemo(() => {
    if (overrides.size === 0) return base
    return {
      ...base,
      days: base.days.map((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (overrides.has(n.id) ? { ...n, ...overrides.get(n.id)! } : n)),
      })),
    }
    // overrides 是每次 render 重算的衍生值,依賴以 overridesKey 代表內容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, overridesKey])
}
