import { useRef } from 'react'
import type { GeoAttraction, GeoPlaceDetails } from '../api'
import { requireGeoPlaceDetails, requirePhotoAssets, type PlanAiDataSource } from '../home/plan-ai-sim/planAiDataSource'
import { fetchPlaceDetailsWithPhotoRetry } from '../photoRetry'
import { useStableCallback } from '../hooks/useStableCallback'

// useAttractionClickRouting——「點到地點之後要走哪條路」的處理,從 PlanMap 原樣抽出(2026-10)。
// 回傳兩個身分穩定的 handler:
//   - handleAttractionClick:點景點區域光暈。主題點直接交給 onAttractionSelect;有 placeId 就
//     查地點詳情(帶照片重試);沒有 placeId 或查詢失敗就走「沒有 Google 資料」的路徑。
//   - handlePoiClick:點底圖上 Google 原生 POI 圖標(placeId 已由 onPoiClick 或
//     NativeMapBase 的 onPoiClick 辨識出來),查詳情後回報。查詢失敗不特別處理錯誤提示,維持
//     地圖仍可正常瀏覽,不彈錯誤訊息打斷使用者。
//
// 優先呼叫 onAttractionOpenPlaceDetails(沒有提供才退回 onPoiSelect)——使用者明確要求「點地圖上的
// place 或小的 attraction 都不要關閉已開啟的 attraction」,AttractionInfoPanel(主題卡)永遠置右
// 最優先,地點卡要走並存路徑,不能透過 geo.selectPoi(互斥狀態機)把已開啟的主題卡關掉。手機版沒有
// 並存版面,不傳這個回呼,退回 onPoiSelect。
//
// handleAttractionClick 的身分必須穩定:它傳給 useSharedDrawLayer 的 attractionGlow 輸入,身分每次渲染都變會讓畫光暈的
// effect 不必要地整批重畫。所以回呼用 ref 存最新版本。
export function useAttractionClickRouting({
  dataSource,
  onPoiSelect,
  onAttractionSelect,
  onAttractionOpenPlaceDetails,
  onAttractionOpenPlaceWithoutGoogle,
}: {
  // dataSource:資料存取層實例,查地點詳情與照片補圖(端點由實例決定)。
  dataSource: PlanAiDataSource
  onPoiSelect?: (details: GeoPlaceDetails) => void
  onAttractionSelect?: (attraction: GeoAttraction) => void
  onAttractionOpenPlaceDetails?: (details: GeoPlaceDetails, attraction?: GeoAttraction) => void
  onAttractionOpenPlaceWithoutGoogle?: (attraction: GeoAttraction) => void
}) {
  const onPoiSelectRef = useRef(onPoiSelect)
  onPoiSelectRef.current = onPoiSelect
  const onAttractionSelectRef = useRef(onAttractionSelect)
  onAttractionSelectRef.current = onAttractionSelect
  const onOpenDetailsRef = useRef(onAttractionOpenPlaceDetails)
  onOpenDetailsRef.current = onAttractionOpenPlaceDetails
  const onWithoutGoogleRef = useRef(onAttractionOpenPlaceWithoutGoogle)
  onWithoutGoogleRef.current = onAttractionOpenPlaceWithoutGoogle

  const handlePoiClick = useStableCallback((placeId: string) => {
    fetchPlaceDetailsWithPhotoRetry(
      placeId,
      (id) => requireGeoPlaceDetails(dataSource, id),
      (details) => {
        if (onOpenDetailsRef.current) {
          onOpenDetailsRef.current(details)
        } else {
          onPoiSelectRef.current?.(details)
        }
      },
      (id) => requirePhotoAssets(dataSource, id),
    ).catch(() => {})
  })

  const handleAttractionClick = useStableCallback((d: GeoAttraction) => {
    if (d.isTheme) {
      onAttractionSelectRef.current?.(d)
      return
    }
    if (d.placeId) {
      fetchPlaceDetailsWithPhotoRetry(
        d.placeId,
        (id) => requireGeoPlaceDetails(dataSource, id),
        (details) => {
          if (onOpenDetailsRef.current) {
            onOpenDetailsRef.current(details, d)
          } else {
            onPoiSelectRef.current?.(details)
          }
        },
        (id) => requirePhotoAssets(dataSource, id),
      ).catch(() => {
        if (onWithoutGoogleRef.current) {
          onWithoutGoogleRef.current(d)
        } else {
          onAttractionSelectRef.current?.(d)
        }
      })
      return
    }
    if (onWithoutGoogleRef.current) {
      onWithoutGoogleRef.current(d)
    } else {
      onAttractionSelectRef.current?.(d)
    }
  })

  return { handleAttractionClick, handlePoiClick }
}
