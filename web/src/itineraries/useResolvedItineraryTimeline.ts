import { useEffect, useMemo, useState } from 'react'
import { BASE_URL } from '../AppCommon'
import { getPlanAiPublicDataSource } from '../home/plan-ai-sim/planAiPublicDataSource'
import { requirePhotoAssets } from '../home/plan-ai-sim/planAiDataSource'
import { toRenderList, type PlanTimeline } from '../plan-core/planTimeline'
import { resolveAttractionForStep } from '../plan-core/resolveAttractionForStep'
import { toPlanTimeline } from './catalog'
import type { SampleItinerary } from './types'

// publicDataSource——讀取地點資料是訪客動作,不需要使用者自己的 JWT:用訪客版資料存取層實例(理由同
// AiItineraryDetailPage.tsx 的訪客設定)。
const publicDataSource = getPlanAiPublicDataSource(BASE_URL)

// useResolvedItineraryTimeline——行程詳情頁的時間軸資料。
//
// 起點是 toPlanTimeline(itinerary):站點座標先用行程檔案寫的值(查詢前、查詢失敗時的備用,地圖與時間軸立刻有東西)。
// 帶 placeId 的站點,再經資料存取層(placeDetails)解析:座標、照片寫回節點——與 /ai-plan、登入後同一個函式
// plan-core/resolveAttractionForStep,站點座標的取得路徑只有一條。keepContent:名稱與說明維持行程作者寫的。
// 同一個 placeId 出現在多站(例如連住同一個園區)由資料存取層去重,只打一次後端。
//
// 回傳 steps(攤平成渲染清單,含跨天分隔)。換成另一份行程(itinerary.id 變動)時重新建立並重新解析。
export function useResolvedItineraryTimeline(itinerary: SampleItinerary) {
  const [timeline, setTimeline] = useState<PlanTimeline>(() => toPlanTimeline(itinerary).timeline)

  useEffect(() => {
    const initial = toPlanTimeline(itinerary).timeline
    setTimeline(initial)
    let cancelled = false
    for (const node of initial.nodes.values()) {
      if (node.type !== 'stop' || !node.placeId) continue
      resolveAttractionForStep(
        node.id,
        node.placeId,
        (placeId) => publicDataSource.placeDetails(placeId),
        setTimeline,
        () => cancelled,
        () => {},
        false,
        (placeId) => requirePhotoAssets(publicDataSource, placeId),
        true,
      )
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itinerary.id])

  return useMemo(() => toRenderList(timeline), [timeline])
}
