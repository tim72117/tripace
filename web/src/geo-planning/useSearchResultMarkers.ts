import { useEffect, useRef } from 'react'
import type { GeoSearchResult } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { isMarkerCandidate, isMarkerSelected } from './geoMarkerSelection'
import { searchResultMarkerContent } from './mapMarkers'

// useSearchResultMarkers——取代原本各自獨立的 useHotelMarkers/
// usePlaceMarkers/useGeocodeCandidateMarkers 三個 marker 圖層 hook,飯店/
// 推薦地點/搜尋結果三種來源統一成單一的 GeoSearchResult 陣列與單一 marker
// 圖層(見 api.ts GeoSearchResult 的完整說明)——使用者要求這三者「同一份
// 清單、同一套邏輯」,不要在地圖層還繼續分裝三套平行的 state/marker
// 陣列。視覺差異(森綠飯店點/靛藍地點圖示/紫色候選編號金牌)保留,改用
// searchResultMarkerContent 內部依 kind 的條件判斷處理,不是三份各自
// 維護的繪圖函式。
//
// geocode 類型維持原本 useGeocodeCandidateMarkers 的 fitBounds 行為
// (查到多筆候選時縮放到能同時看見全部)——這是它獨有的、跟飯店/地點
// 不同的既有行為(候選是「這次搜尋」的暫時圖層,查到多筆時需要一次讓
// 使用者看清楚全部選項;飯店/地點不需要,查到的結果理應已經在目前
// 可視範圍附近)。用 results 裡是否存在 geocode 類型、且是新一批查詢
// (results 內容變動)來判斷要不要觸發——多次觸發 fitBounds 只有在真正
// 換了一批新結果時才有意義,不是每次選取變動都要重新縮放(見下方
// content 同步 effect 的說明,只換 content 不重新 fitBounds)。
export function useSearchResultMarkers({
  mapRef,
  mapReady,
  results,
  selectedKey,
  hoverKey,
  candidateKeys,
  onSelect,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  results: GeoSearchResult[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onSelect?: (result: GeoSearchResult) => void
}) {
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // resultsKey:results 的內容摘要,供下面兩個 effect 依賴——理由同原本
  // 三個獨立 hook 各自的 xxxKey(visibleHotelsKey/placesKey/
  // geocodeCandidatesKey)。kind 也納入摘要——同座標同名稱但不同 kind
  // (理論上不該發生,但保守起見)仍視為不同結果,避免誤判成「沒變」。
  const resultsKey = results.map((r) => `${r.kind}|${r.name}|${r.lat}|${r.lng}`).join(',')
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''

  // geocode 候選的編號(1-based)只在同一批 geocode 結果內連續計算,不
  // 受混在同一個陣列裡的 hotel/place 結果影響——理由同原本
  // geocodeCandidateMarkerContent 的編號語意(第幾筆搜尋結果),不是這個
  // 陣列裡的第幾筆。
  function geocodeIndex(i: number): number {
    let n = 0
    for (let j = 0; j <= i; j++) {
      if (results[j].kind === 'geocode') n++
    }
    return n
  }

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    markersRef.current.forEach((m) => { m.map = null })
    markersRef.current = results.map((r, i) => {
      const key = geoItemKey(r.kind, r)
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: r.lat, lng: r.lng },
        map: mapRef.current!,
        title: r.name,
        content: searchResultMarkerContent(
          r,
          isMarkerSelected(key, selectedKey, hoverKey),
          isMarkerCandidate(key, candidateKeys),
          r.kind === 'geocode' ? geocodeIndex(i) : undefined,
        ),
        zIndex: isMarkerSelected(key, selectedKey, hoverKey) ? 999 : r.kind === 'geocode' ? 998 : null,
      })
      marker.addListener('gmp-click', () => onSelect?.(r))
      return marker
    })
    // geocode 結果存在時 fitBounds 到能同時看見全部——理由見上方元件
    // 說明,對齊原本 useGeocodeCandidateMarkers 只在新一批候選時觸發、
    // 不受選取狀態變動影響的既有行為。
    const geocodeResults = results.filter((r) => r.kind === 'geocode')
    if (geocodeResults.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      geocodeResults.forEach((r) => bounds.extend({ lat: r.lat, lng: r.lng }))
      mapRef.current.fitBounds(bounds, 64)
    }
    return () => {
      markersRef.current.forEach((m) => { m.map = null })
      markersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, resultsKey, onSelect])

  // 同步 marker 的選取/候選籃樣式:只對「狀態真的改變」的那幾顆重設
  // content,其餘 marker 完全不動,不重建、不閃爍、不重新 fitBounds——
  // 理由同原本三個獨立 hook 各自的同名 effect。
  useEffect(() => {
    results.forEach((r, i) => {
      const marker = markersRef.current[i]
      if (!marker) return
      const key = geoItemKey(r.kind, r)
      const selected = isMarkerSelected(key, selectedKey, hoverKey)
      const candidate = isMarkerCandidate(key, candidateKeys)
      marker.content = searchResultMarkerContent(r, selected, candidate, r.kind === 'geocode' ? geocodeIndex(i) : undefined)
      marker.zIndex = selected ? 999 : r.kind === 'geocode' ? 998 : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, resultsKey, candidateKeysToken])
}
