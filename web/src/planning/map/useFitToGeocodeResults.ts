import { useEffect } from 'react'
import type { GeoSearchResult } from '../../api'

// useFitToGeocodeResults——有定位(geocode)搜尋結果時,把地圖鏡頭調到能同時看見全部(fitBounds,四周
// 留 64px)。搜尋結果標記遷進統一繪製層(draw/layers/searchResultLayer.ts)時拆出來:鏡頭動作不是繪製,統一繪製層的功能層是純資料、
// 拿不到地圖,所以這個動作留在地圖元件(PlanMap)用 hook 掛。
//
// 行為與舊 hook 一致:只算 geocode 結果(飯店、地點不納入範圍),沒有 geocode 結果就不動鏡頭;
// 地圖就緒或結果內容改變時才調整。用內容摘要(種類、名稱、座標)判斷「改變」,不是陣列身分:呼叫端
// 常常每次渲染都換新陣列,否則使用者拖曳地圖後會被拉回去。
export function useFitToGeocodeResults({
  mapRef,
  mapReady,
  results,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  results: GeoSearchResult[]
}) {
  const resultsKey = results.map((r) => `${r.kind}|${r.name}|${r.lat}|${r.lng}`).join(',')

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const geocodeResults = results.filter((r) => r.kind === 'geocode')
    if (geocodeResults.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    geocodeResults.forEach((r) => bounds.extend({ lat: r.lat, lng: r.lng }))
    mapRef.current.fitBounds(bounds, 64)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, resultsKey])
}
