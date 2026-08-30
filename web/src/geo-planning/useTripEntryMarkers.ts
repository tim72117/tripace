import { useEffect, useRef } from 'react'
import type { GeoTripEntry } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { isMarkerSelected } from './geoMarkerSelection'
import { tripEntryMarkerContent } from './mapMarkers'

// useTripEntryMarkers——從 GeoOutlineMap.tsx 抽出來的行程 entry marker
// 圖層。只讀 mapRef/mapReady/自己的資料(tripEntries)/selectedKey/
// hoverKey,不寫入任何其他共享狀態,故獨立成 hook 不影響其餘查詢/地圖
// 生命週期邏輯。內部行為(含全部原有註解說明)原封不動搬過來,搬動本身
// 不改變任何行為。這批點不吃 candidateKeys(不論行程 entry 是否也在
// 候選籃資料結構裡,理由見 GeoOutlineMap 原本 candidateKeys prop 的
// 說明:tripEntry 已經有自己的旗子圖示語意,不需要疊加候選籃徽章)。
export function useTripEntryMarkers({
  mapRef,
  mapReady,
  tripEntries,
  selectedKey,
  hoverKey,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  tripEntries: GeoTripEntry[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
}) {
  const tripEntryMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // tripEntriesKey:tripEntries 的內容摘要,供下面兩個 effect 依賴——
  // 理由同 useHotelMarkers 的 visibleHotelsKey/usePlaceMarkers 的
  // placesKey。
  const tripEntriesKey = tripEntries.map((e) => `${e.name}|${e.lat}|${e.lng}`).join(',')

  // 行程本身已有座標的 entry 圖層:tripEntries 變動(換旅程)時重畫,
  // 先清掉舊的——這批點不受地圖可視範圍篩選(理由同附近推薦地點:
  // 是行程固定的內容,不是依範圍查詢的圖層,全部顯示讓使用者看到完整
  // 的行程分布)。圖示用 tripEntryMarkerContent(暖橘旗子,見該函式的
  // 說明),一眼分得出「這是已經排進行程的點」——顏色改成執行期讀取
  // --color-accent(見 mapMarkers.ts 對 color 參數的完整說明),讀取
  // 目標是地圖容器本身的 DOM(mapRef.current.getDiv()),理由同
  // useAttractionOverlays.ts 對 --ios-sand 的讀取方式:這個
  // token 掛在 App.tsx 的 .app-theme-root(.webApp 容器 div)上,不是
  // <html>/<body>,必須讀 .app-theme-root 子孫節點的 computed style
  // 才能拿到正確覆寫後的深/淺色版本。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'
    tripEntryMarkersRef.current.forEach((m) => { m.map = null })
    tripEntryMarkersRef.current = tripEntries.map(
      (e) =>
        new google.maps.marker.AdvancedMarkerElement({
          position: { lat: e.lat, lng: e.lng },
          map: mapRef.current!,
          title: e.name,
          content: tripEntryMarkerContent(false, accentColor),
        }),
    )
    return () => {
      tripEntryMarkersRef.current.forEach((m) => { m.map = null })
      tripEntryMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, tripEntriesKey])

  // 同步行程 entry marker 的選取樣式,理由與做法同上方飯店/推薦地點
  // 那兩個獨立的 content 同步 effect。
  useEffect(() => {
    if (!mapRef.current) return
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'
    tripEntries.forEach((e, i) => {
      const marker = tripEntryMarkersRef.current[i]
      if (!marker) return
      const key = geoItemKey('entry', e)
      const selected = isMarkerSelected(key, selectedKey, hoverKey)
      marker.content = tripEntryMarkerContent(selected, accentColor)
      marker.zIndex = selected ? 999 : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, tripEntriesKey])
}
