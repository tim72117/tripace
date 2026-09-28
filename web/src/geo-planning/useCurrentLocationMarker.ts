import { useEffect, useRef } from 'react'
import { currentLocationMarkerContent } from './mapMarkers'

// useCurrentLocationMarker:2026-09 新增,畫一顆藍色圓點標示使用者目前
// 位置——只有 useGeoOutlineMapState.ts 的 tryGetCurrentPosition 定位
// 成功時才會有值(旅程已經有既有座標、或使用者拒絕/瀏覽器不支援定位時
// currentPosition 是 null,不畫任何東西),故這顆點只在「地圖用使用者
// 目前位置當初始中心」這個情境下才出現,不是所有進入規劃地圖的畫面都會
// 看到。
//
// 拆成獨立 hook 而非塞進既有的 useTripEntryMarkers.ts——理由同該檔案
// 開頭的既有拆分慣例(只讀 mapRef/mapReady/自己的資料,不寫入任何其他
// 共享狀態):這顆點的資料來源(currentPosition,單一固定座標)、生命週期
// (只在座標第一次確定時畫一次,不像 tripEntries 那樣隨旅程切換整批
// 重畫)都跟行程 entry marker 不同,硬塞進同一個 hook 只會讓兩種完全
// 不相關的圖層邏輯互相糾纏。
//
// 這顆點刻意不可點選、不跟 selectedKey/hoverKey 那套選取機制掛鉤——
// 使用者位置只是「告訴你現在看到的地圖範圍跟你人在哪裡的關係」這個
// 純資訊性用途,不是可以加入行程的候選項目,不需要支援點擊開資訊卡。
export function useCurrentLocationMarker({
  mapRef,
  mapReady,
  currentPosition,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  currentPosition: { lat: number; lng: number } | null
}) {
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)

  useEffect(() => {
    if (!mapReady || !mapRef.current || !currentPosition) return
    markerRef.current = new google.maps.marker.AdvancedMarkerElement({
      position: currentPosition,
      map: mapRef.current,
      title: '目前位置',
      content: currentLocationMarkerContent(),
      // zIndex 固定在偏低的位置——這顆點是背景資訊,不該蓋過使用者主動
      // 查詢/選中的行程 entry 或搜尋結果 marker。
      zIndex: 1,
    })
    return () => {
      if (markerRef.current) {
        markerRef.current.map = null
        markerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, currentPosition?.lat, currentPosition?.lng])
}
