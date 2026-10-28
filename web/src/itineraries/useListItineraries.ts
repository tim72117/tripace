import { useEffect, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { fetchPublicItineraryPageList, type ClientConfig } from '../api'
import { SAMPLE_ITINERARIES } from './registry'
import { isSampleItineraryShape, mergeWithApiItineraries } from './catalog'
import type { SampleItinerary } from './types'

// GUEST_CFG——讀取已發布範例行程清單是公開頁面的訪客動作,理由同
// AiItineraryDetailPage.tsx 的 GUEST_CFG。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// SHOW_EXAMPLE_ITINERARIES_ENABLED——2026-10 新增,使用者明確要求「排
// 好的行程清單,用參數控制要不要顯示範例,預設關閉」:同 DesktopShared.tsx
// TIMELINE_ENABLED 那套編譯時 feature flag 機制(部署環境
// 變數,預設關閉,只在明確設為字串 "true" 時才啟用),不是另外發明一套
// ——只是放在 itineraries/ 而非 DesktopShared.tsx,因為那個檔案服務的是 /app
// 規劃 UI 的面板開關,跟這個獨立的範例行程展示頁(/itineraries)是不同
// 功能、不同關注點,放這裡保持就近維護。
//
// 只影響清單頁(AiItineraryListPage)要不要把 registry.ts 的靜態
// SAMPLE_ITINERARIES 併進清單——不影響詳細頁(AiItineraryDetailPage):
// 關閉這個旗標後,example/*.ts 裡的行程仍然可以透過直接網址
// (/itineraries/erziping-1day 這類)瀏覽,只是不會出現在清單頁讓訪客
// 隨意逛到,理由是這些仍是真實、完整、測試過的範例行程內容,只是「清單
// 預設只秀資料庫正式發布的行程」這個呈現策略改變,不是要把這些行程
// 整個下架。
const SHOW_EXAMPLE_ITINERARIES_ENABLED = import.meta.env.VITE_FEATURE_SHOW_EXAMPLE_ITINERARIES === 'true'

// LIST_ITINERARIES_TIMEOUT_MS——清單 API 最多等多久。API 卡住(連線不斷也不回)時
// loading 會永遠是 true;正式環境靜態清單是空的,清單頁就會停在無限骨架(改成骨架
// 之前會顯示空狀態)。逾時視同失敗收尾:loading 結束、退回純靜態清單(或空狀態)。
export const LIST_ITINERARIES_TIMEOUT_MS = 10_000

// useListItineraries——清單頁顯示的行程 = (視 SHOW_EXAMPLE_ITINERARIES_ENABLED
// 決定要不要併入)靜態 registry.ts + 已發布進資料庫的行程(見
// mergeWithApiItineraries 的完整說明)。2026-10 新增——清單頁原本只讀
// SAMPLE_ITINERARIES,從沒打過 fetchPublicItineraryPageList,導致透過
// CLI 發布的行程(例如 tainan-chikan-2day、jozankei-1day)雖然詳細頁能
// 看到,卻不會出現在 /itineraries 清單上(使用者回報「沒有看到」才發現
// 這個落差)。查詢失敗(網路層級問題、500 等)或逾時時直接退回純靜態清單
// (或空清單,視旗標而定),不讓清單頁整頁壞掉——清單頁本來就能在沒有任何
// API 行程的情況下正常運作。2026-10 從 AiItinerariesRoute.tsx 抽成獨立檔,方便測試。
//
// loading——API 清單還沒回來(成功、失敗、逾時都算結束)。清單頁在「沒有任何靜態
// 行程可先顯示」時用它畫同尺寸的骨架卡片,而不是先閃一次「還沒有範例行程」空狀態、
// 資料到了才整塊換成卡片牆。
//
// 逾時用 Promise 競賽的做法(計時器先到就收尾,之後晚到的結果一律忽略),不是
// AbortController:api.ts 的 request() 不收 signal,為了這一支呼叫改共用的
// request() 不划算。代價是逾時後請求本身仍在背景跑完,只是結果被丟掉。
// 晚到的結果刻意不採用:清單已經以空狀態/靜態清單呈現,過一陣子突然整塊換成
// 卡片牆反而是版面跳動。
export function useListItineraries(): { items: SampleItinerary[]; loading: boolean } {
  const [apiItems, setApiItems] = useState<SampleItinerary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // done:已經收尾(成功、失敗、逾時、卸載任一)——之後的結果都忽略。
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      console.warn(`[useListItineraries] fetchPublicItineraryPageList 超過 ${LIST_ITINERARIES_TIMEOUT_MS}ms 未回應,視同失敗`)
      setLoading(false)
    }, LIST_ITINERARIES_TIMEOUT_MS)

    fetchPublicItineraryPageList(GUEST_CFG)
      .then((res) => {
        if (done) return
        done = true
        clearTimeout(timer)
        const items = res.itineraryPages
          .map((p) => p.content)
          .filter(isSampleItineraryShape)
        setApiItems(items)
        setLoading(false)
      })
      .catch((err) => {
        if (done) return
        done = true
        clearTimeout(timer)
        console.error('[useListItineraries] fetchPublicItineraryPageList 失敗:', err)
        setLoading(false)
      })
    return () => {
      done = true
      clearTimeout(timer)
    }
  }, [])

  return { items: mergeWithApiItineraries(SHOW_EXAMPLE_ITINERARIES_ENABLED ? SAMPLE_ITINERARIES : [], apiItems), loading }
}
