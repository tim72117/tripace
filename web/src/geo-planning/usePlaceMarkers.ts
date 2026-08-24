import { useEffect, useRef } from 'react'
import type { GeoPlace } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { placeMarkerContent } from './mapMarkers'

// usePlaceMarkers——從 GeoOutlineMap.tsx 抽出來的附近推薦地點 marker
// 圖層。只讀 mapRef/mapReady/自己的資料(places)/selectedKey/hoverKey/
// candidateKeys,不寫入任何其他共享狀態,故獨立成 hook 不影響其餘查詢/
// 地圖生命週期邏輯。內部行為(含全部原有註解說明)原封不動搬過來,搬動
// 本身不改變任何行為。
export function usePlaceMarkers({
  mapRef,
  mapReady,
  places,
  selectedKey,
  hoverKey,
  candidateKeys,
  onPlaceSelect,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  places: GeoPlace[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onPlaceSelect?: (place: GeoPlace) => void
}) {
  const placeMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // placesKey:places 的內容摘要,供下面兩個 effect 依賴——理由同
  // useHotelMarkers 的 visibleHotelsKey。
  const placesKey = places.map((p) => `${p.name}|${p.lat}|${p.lng}`).join(',')
  // candidateKeysToken:見 useAttractionOverlays 的同名說明。
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''

  // 附近推薦地點圖層:points 變動時重畫,先清掉舊的。這批地點不像
  // attractions/hotels 依可視範圍(bounds)篩選——它們是點擊地圖上方
  // 類別標籤(handleCategoryClick)才觸發的一次性查詢結果,查詢中心是
  // 「目前地圖中心點」,理應都落在可視範圍內,不需要再疊一層篩選判斷
  // 增加複雜度。圖示用 placeMarkerContent(靛藍色系,見該函式的說明),
  // 讓使用者一眼分得出這是「查出來的推薦」而非常駐的景點區域/飯店資料。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    placeMarkersRef.current.forEach((m) => { m.map = null })
    placeMarkersRef.current = places.map((p) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current!,
        title: p.name,
        content: placeMarkerContent(false, candidateKeys?.has(geoItemKey('place', p)) ?? false, p.category),
      })
      // 點擊推薦地點 marker 往上回報選取,理由同飯店 marker 的 gmp-click
      // listener——單純回報選取,不觸發額外的地圖放大/查詢行為。
      marker.addListener('gmp-click', () => onPlaceSelect?.(p))
      return marker
    })
    return () => {
      placeMarkersRef.current.forEach((m) => { m.map = null })
      placeMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, placesKey, onPlaceSelect])

  // 同步附近推薦地點 marker 的選取/候選籃樣式,理由與做法同上方飯店那個
  // 獨立的 content 同步 effect。
  useEffect(() => {
    places.forEach((p, i) => {
      const marker = placeMarkersRef.current[i]
      if (!marker) return
      const key = geoItemKey('place', p)
      const selected = selectedKey === key || hoverKey === key
      const candidate = candidateKeys?.has(key) ?? false
      marker.content = placeMarkerContent(selected, candidate, p.category)
      marker.zIndex = selected ? 999 : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, placesKey, candidateKeysToken])
}
