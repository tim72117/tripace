import { useEffect, useState } from 'react'
import { useStableCallback } from '../../hooks/useStableCallback'

// useMapIdle——掛載式 hook:地圖拖曳/縮放動畫結束(idle 事件)時,把地圖中心交給
// onIdle。從 PlanMap 的建圖 effect 抽出來(2026-10),只轉發事件:
// 「回報中心」「這次 idle 是不是程式化平移造成的(suppressNextIdleQueryRef)」
// 「要不要冒出搜尋這個區域按鈕」都是呼叫端的業務判斷,不屬於這裡。
//
// onIdle 收到 null 代表當下取不到地圖中心——呼叫端仍要處理 idle 本身(例如抑制旗標
// 與搜尋按鈕的判斷不依賴中心座標)。
//
// onIdle 內部用穩定參照包起來:呼叫端每次渲染傳新的內聯函式,不會讓監聽器重新註冊,
// 事件來時呼叫的一定是最新的那個。
export function useMapIdle({
  mapRef,
  mapReady,
  mapVersion = 0,
  onIdle,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion?: number
  onIdle: (center: { lat: number; lng: number } | null) => void
}) {
  const handleIdle = useStableCallback(onIdle)

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const listener = map.addListener('idle', () => {
      const center = map.getCenter()
      handleIdle(center ? { lat: center.lat(), lng: center.lng() } : null)
    })
    return () => listener.remove()
  }, [mapRef, mapReady, mapVersion, handleIdle])
}

// useMapViewport——掛載式 hook:追蹤地圖目前的縮放層級與可視範圍。
// 從 PlanMap 的建圖 effect 抽出來(2026-10,見 NativeMapBase.tsx 檔頭「附掛行為
// 用掛載式 hook 組裝」的設計),行為原樣搬移:
//   - zoom_changed → zoom(取不到時退回 12,對齊 Map 建構時的 zoom: 12);
//     驅動光暈查詢半徑、panTarget 的 level 縮放判斷。
//   - bounds_changed → bounds(取不到時為 null);驅動 panTarget 的
//     onlyIfOutOfView 判斷。
// 初始值 zoom=12、bounds=null:地圖剛掛載、還沒收到第一次事件前的預設。
//
// 不放進 NativeMapBase 的理由:bounds_changed 在拖曳過程中連續觸發,每次都 setState 會
// 讓持有者重新渲染。/ai-plan 等不需要可視範圍的使用者不該承擔這個成本,所以做成需要
// 才掛的 hook。
//
// mapVersion:地圖被重建(新的 google.maps.Map 實例)時遞增,讓監聽器重新註冊到新實例
// 上。PlanMap 目前不重建地圖,不傳即可(預設 0)。
export function useMapViewport({
  mapRef,
  mapReady,
  mapVersion = 0,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion?: number
}) {
  const [zoom, setZoom] = useState(12)
  const [bounds, setBounds] = useState<google.maps.LatLngBounds | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    // 以地圖目前的實際值播種:建圖時帶入的 zoom 不會觸發 zoom_changed(監聽器是 mapReady 之後才掛),
    // 不播種的話 /ai-plan(zoom 14 建圖)按「探索」會拿預設的 12 換算半徑,範圍大四倍。
    setZoom(map.getZoom() ?? 12)
    setBounds(map.getBounds() ?? null)
    const zoomListener = map.addListener('zoom_changed', () => {
      setZoom(map.getZoom() ?? 12)
    })
    const boundsListener = map.addListener('bounds_changed', () => {
      setBounds(map.getBounds() ?? null)
    })
    return () => {
      zoomListener.remove()
      boundsListener.remove()
    }
  }, [mapRef, mapReady, mapVersion])

  return { zoom, bounds }
}
