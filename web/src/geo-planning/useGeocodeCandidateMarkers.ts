import { useEffect, useRef } from 'react'
import type { GeoGeocodeCandidate } from '../api'
import { geocodeCandidateMarkerContent } from './mapMarkers'

// useGeocodeCandidateMarkers——從 GeoOutlineMap.tsx 抽出來的搜尋候選
// marker 圖層。只讀 mapRef/mapReady/自己的資料(geocodeCandidates)/
// selectedGeocodeCandidateKey,不寫入任何其他共享狀態,故獨立成 hook
// 不影響其餘查詢/地圖生命週期邏輯。內部行為(含全部原有註解說明)原封
// 不動搬過來,搬動本身不改變任何行為。
export function useGeocodeCandidateMarkers({
  mapRef,
  mapReady,
  geocodeCandidates,
  selectedGeocodeCandidateKey,
  onGeocodeCandidateSelect,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  geocodeCandidates: GeoGeocodeCandidate[]
  selectedGeocodeCandidateKey?: string | null
  onGeocodeCandidateSelect?: (candidate: GeoGeocodeCandidate) => void
}) {
  const geocodeCandidateMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // geocodeCandidatesKey:見 useHotelMarkers 的 visibleHotelsKey 說明。
  const geocodeCandidatesKey = geocodeCandidates.map((c) => `${c.name}|${c.lat}|${c.lng}`).join(',')

  // geocodeCandidates 圖層:搜尋查到多筆候選時(見該 prop 的說明)畫成
  // 可點擊的候選 marker,並 fitBounds 到能同時看見所有候選的範圍——
  // 跟其餘圖層不同,這批點不是「常駐顯示、跟著地圖範圍/行程變動」,而是
  // 「這次搜尋」的暫時圖層,只有 geocodeCandidates 變成空陣列(觸發新
  // 一次搜尋、換掉舊候選,見 GeoOutlinePanel.tsx 的 searchTrigger effect)
  // 時 marker 才會清空——使用者點擊確認選定後(見下方 gmp-click)其餘
  // 候選仍留在地圖上,不會因為選了一個就整批消失,讓使用者能隨時回頭
  // 比較/改選別的候選。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    geocodeCandidateMarkersRef.current.forEach((m) => { m.map = null })
    if (geocodeCandidates.length === 0) {
      geocodeCandidateMarkersRef.current = []
      return
    }
    geocodeCandidateMarkersRef.current = geocodeCandidates.map((c, i) => {
      const key = `${c.name}|${c.lat}|${c.lng}`
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: c.lat, lng: c.lng },
        map: mapRef.current!,
        title: c.name,
        content: geocodeCandidateMarkerContent(i + 1, key === selectedGeocodeCandidateKey),
        zIndex: key === selectedGeocodeCandidateKey ? 999 : 998,
      })
      marker.addListener('gmp-click', () => onGeocodeCandidateSelect?.(c))
      return marker
    })
    // fitBounds 包住所有候選點,讓使用者一次看見全部候選的相對位置再
    // 決定要點哪一個——只有一筆候選時 GeoOutlinePanel 已經直接走原本的
    // panRequest 流程(見該元件 searchTrigger 的 effect),不會走到這裡,
    // 故這裡不需要額外處理「只有一個點,fitBounds 反而過度拉近」的
    // 邊界情況。這個 effect 只在 geocodeCandidatesKey 變動(新一批候選)
    // 時重畫,不依賴 selectedGeocodeCandidateKey——否則每次選定/改選都會
    // 整批重建 marker、重新 fitBounds,把使用者手動調整過的地圖範圍
    // 蓋掉(見下方獨立的選取樣式同步 effect,只換 content 不重建)。
    const bounds = new google.maps.LatLngBounds()
    geocodeCandidates.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }))
    mapRef.current.fitBounds(bounds, 64)
    return () => {
      geocodeCandidateMarkersRef.current.forEach((m) => { m.map = null })
      geocodeCandidateMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, geocodeCandidatesKey])

  // 同步候選 marker 的選取樣式:selectedGeocodeCandidateKey 變動時(使用者
  // 點了另一個候選)只切換對應 marker 的 content/zIndex,不重建整批
  // marker、不重新 fitBounds——理由同上方 effect 的說明,做法對齊
  // 飯店/推薦地點/行程 entry 三個既有圖層各自獨立的 content 同步 effect。
  useEffect(() => {
    geocodeCandidates.forEach((c, i) => {
      const marker = geocodeCandidateMarkersRef.current[i]
      if (!marker) return
      const key = `${c.name}|${c.lat}|${c.lng}`
      const selected = key === selectedGeocodeCandidateKey
      marker.content = geocodeCandidateMarkerContent(i + 1, selected)
      marker.zIndex = selected ? 999 : 998
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGeocodeCandidateKey, geocodeCandidatesKey])
}
