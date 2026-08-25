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
  // onSelect:下方 marker 建立 effect 的依賴陣列不含這個值(見該 effect
  // 的說明,只依 resultsKey 判斷是否重建),故呼叫端必須傳入參照穩定的
  // 函式(用 useStableCallback 包過,見 web/src/hooks/useStableCallback.ts)
  // ——若傳一般函式,每次呼叫端重渲染都會拿到「新的最後一次點擊當下的
  // 版本」,雖然行為正確,但這裡的設計前提是「onSelect 不該是判斷要不要
  // 重建 marker 的依據」,呼叫端仍應維持穩定參照,避免其他消費這個
  // callback 的地方(例如 useEffect 依賴陣列)重新引入同類問題。
  onSelect?: (result: GeoSearchResult) => void
}) {
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  // markerStateRef:每顆 marker 目前 DOM 上實際套用的 selected/candidate
  // 狀態快取,供下方同步 effect 判斷「這顆 marker 真的需要重繪嗎」——
  // hoverKey 每次滑鼠移到清單項目上/移開都會觸發這個 effect,但實際上
  // 通常只有 1-2 顆 marker 的狀態真的改變(移入的那顆變 true、移出的
  // 那顆變回 false),其餘全部不變。原本沒有這層比對,effect 觸發時
  // 對 results 裡每一顆都無條件重新呼叫 searchResultMarkerContent
  // 產生新的 SVG DOM 並整顆重新指派 marker.content,即使該顆狀態根本
  // 沒變——這是實際發生過的 bug:滑鼠移到搜尋清單任一項目時,地圖上
  // 所有圖標(不只被 hover 的那個)都會閃動一次,因為全部都被重繪了。
  const markerStateRef = useRef<{ selected: boolean; candidate: boolean }[]>([])

  // resultsKey:results 的內容摘要,供下面兩個 effect 依賴——理由同原本
  // 三個獨立 hook 各自的 xxxKey(visibleHotelsKey/placesKey/
  // geocodeCandidatesKey)。kind 也納入摘要——同座標同名稱但不同 kind
  // (理論上不該發生,但保守起見)仍視為不同結果,避免誤判成「沒變」。
  const resultsKey = results.map((r) => `${r.kind}|${r.name}|${r.lat}|${r.lng}`).join(',')
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''

  // geocode 候選的編號(1-based)只在同一批 geocode 結果內連續計算,不
  // 受混在同一個陣列裡的 hotel/place 結果影響——理由同
  // mapMarkers.ts searchResultMarkerContent 的編號語意(第幾筆搜尋
  // 結果),不是這個陣列裡的第幾筆。
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
    markerStateRef.current = []
    markersRef.current = results.map((r, i) => {
      const key = geoItemKey(r.kind, r)
      const selected = isMarkerSelected(key, selectedKey, hoverKey)
      const candidate = isMarkerCandidate(key, candidateKeys)
      markerStateRef.current[i] = { selected, candidate }
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: r.lat, lng: r.lng },
        map: mapRef.current!,
        title: r.name,
        content: searchResultMarkerContent(
          r,
          selected,
          candidate,
          r.kind === 'geocode' ? geocodeIndex(i) : undefined,
        ),
        zIndex: selected ? 999 : r.kind === 'geocode' ? 998 : null,
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
  }, [mapReady, resultsKey])

  // 同步 marker 的選取/候選籃樣式:只對「狀態真的改變」的那幾顆重設
  // content,其餘 marker 完全不動,不重建、不閃爍、不重新 fitBounds——
  // 理由同原本三個獨立 hook 各自的同名 effect。這個 effect 的依賴陣列
  // 含 hoverKey,滑鼠移到清單任一項目上/移開都會觸發整個 results.forEach
  // 跑一輪,若不比對 markerStateRef 就無條件重新指派 marker.content,
  // 等同每次 hover 都把畫面上所有 marker(不只被 hover 的那顆)重繪一次
  // ——這是實際發生過的 bug(滑鼠移到搜尋清單時地圖上所有圖標一起
  // 閃動),故這裡先比對這顆 marker 的 selected/candidate 是否真的跟
  // 上次不同,沒變就整個跳過、不重新產生 SVG DOM。
  useEffect(() => {
    results.forEach((r, i) => {
      const marker = markersRef.current[i]
      if (!marker) return
      const key = geoItemKey(r.kind, r)
      const selected = isMarkerSelected(key, selectedKey, hoverKey)
      const candidate = isMarkerCandidate(key, candidateKeys)
      const prev = markerStateRef.current[i]
      if (prev && prev.selected === selected && prev.candidate === candidate) return
      markerStateRef.current[i] = { selected, candidate }
      marker.content = searchResultMarkerContent(r, selected, candidate, r.kind === 'geocode' ? geocodeIndex(i) : undefined)
      marker.zIndex = selected ? 999 : r.kind === 'geocode' ? 998 : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, resultsKey, candidateKeysToken])
}
