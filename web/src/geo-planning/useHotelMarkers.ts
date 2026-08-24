import { useEffect, useMemo, useRef } from 'react'
import type { GeoHotel } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { hotelMarkerContent } from './mapMarkers'

// useHotelMarkers——從 GeoOutlineMap.tsx 抽出來的飯店 marker 圖層。只讀
// mapRef/mapReady/自己的資料(hotels)/bounds/selectedKey/hoverKey/
// candidateKeys,不寫入任何其他共享狀態,故獨立成 hook 不影響其餘查詢/
// 地圖生命週期邏輯。內部行為(含全部原有註解說明)原封不動搬過來,搬動
// 本身不改變任何行為。
export function useHotelMarkers({
  mapRef,
  mapReady,
  hotels,
  bounds,
  selectedKey,
  hoverKey,
  candidateKeys,
  onHotelSelect,
  onVisibleHotelsChange,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  hotels: GeoHotel[]
  bounds: google.maps.LatLngBounds | null
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onHotelSelect?: (hotel: GeoHotel) => void
  onVisibleHotelsChange?: (hotels: GeoHotel[]) => void
}) {
  const hotelMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  // visibleHotels:只保留落在目前地圖可視範圍(bounds)內的飯店——
  // bounds 為 null(地圖剛掛載、還沒收到第一次 bounds_changed)時顯示
  // 全部,避免開頭一瞬間地圖/側欄清單是空的。用 useMemo 快取,避免每次
  // render 都建立新陣列參照——filter 的結果若每次都是新參照,下面依賴
  // visibleHotels 的 useEffect 會被判定成「每次都變了」而重複觸發,
  // 呼叫 onVisibleHotelsChange 進而讓外層 DesktopLayout 的 setGeoHotels
  // 觸發重新渲染、這個元件又跟著重新渲染、又產生新的 visibleHotels
  // 參照——形成不必要的重渲染迴圈,曾經導致飯店 marker 在畫面上閃爍/
  // 消失。bounds 是 google.maps.LatLngBounds 物件參照,只有真的呼叫
  // setBounds 時才會變,不會每次 render 換新,可以安全放進依賴陣列。
  const visibleHotels = useMemo(
    () =>
      bounds == null
        ? hotels
        : hotels.filter((h) => bounds.contains({ lat: h.lat, lng: h.lng })),
    [bounds, hotels],
  )

  // visibleHotelsKey:visibleHotels 的內容摘要(座標字串),供下面的
  // useEffect 依賴——即使 useMemo 已經避免多數不必要的重算,穩妥起見
  // 再用內容而非陣列參照本身判斷「真的變了」才觸發 onVisibleHotelsChange/
  // 重畫 marker,双重保險避免依賴陣列比對出現參照不穩定的問題。
  const visibleHotelsKey = visibleHotels.map((h) => `${h.name}|${h.lat}|${h.lng}`).join(',')

  // candidateKeysToken:見 useAttractionOverlays 的同名說明。
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''

  // 每當 visibleHotels 內容變動,往上回報給 onVisibleHotelsChange——飯店
  // 側欄(GeoHotelSidebar)渲染在這個元件之外,只能靠這個 callback
  // 同步「目前地圖範圍內有哪些飯店」。
  useEffect(() => {
    onVisibleHotelsChange?.(visibleHotels)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleHotelsKey])

  // 飯店圖層:地圖就緒或 visibleHotels(範圍/清單本身)變動時重畫,先清掉
  // 舊的。用 google.maps.marker.AdvancedMarkerElement(非 OverlayView)
  // ——飯店只需要單點圖示,不像分區光暈需要複合 DOM 結構,圖示用森綠色
  // 圓點區分於分區光暈的暖沙棕色系,讓使用者一眼分得出「這是分區重心」
  // 還是「這是可以住的地方」。
  //
  // 這個 effect 刻意不依賴 selectedKey——選取狀態變動時只切換對應那顆
  // marker 的 content(見下方獨立的 effect),不重建整批 marker。理由同
  // 下方那個 effect 的說明:選中/取消選中只是側欄點擊,不代表地圖範圍
  // 或飯店清單本身有變化,若整批重畫,畫面上其他沒被點的飯店 marker
  // 也會跟著經歷一次 map=null→重新 new AdvancedMarkerElement() 的閃爍,
  // 是不必要的。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    hotelMarkersRef.current.forEach((m) => { m.map = null })
    hotelMarkersRef.current = visibleHotels.map((h) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: h.lat, lng: h.lng },
        map: mapRef.current!,
        title: h.name,
        content: hotelMarkerContent(false, candidateKeys?.has(geoItemKey('hotel', h)) ?? false),
      })
      // 點擊飯店 marker 往上回報選取(見 onHotelSelect 的說明),讓側欄
      // 能同步標記選取狀態並切到「飯店」分頁顯示介紹——跟地標圖示不同,
      // 飯店 marker 本身沒有需要額外放大範圍/查附近推薦的行為,單純
      // 回報選取即可。AdvancedMarkerElement 用 gmp-click(而非
      // google.maps.Marker 的 'click'),沿用官方遷移指南的事件名稱。
      marker.addListener('gmp-click', () => onHotelSelect?.(h))
      return marker
    })
    return () => {
      hotelMarkersRef.current.forEach((m) => { m.map = null })
      hotelMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleHotelsKey, onHotelSelect])

  // 同步飯店 marker 的選取/候選籃樣式:只對「狀態真的改變」的那幾顆重設
  // content,其餘 marker 完全不動,不重建、不閃爍。visibleHotels 與
  // hotelMarkersRef.current 依 map() 建立時保證同順序,故直接用陣列
  // 索引配對,不需要另外存一份 marker↔hotel 的對照表。
  useEffect(() => {
    visibleHotels.forEach((h, i) => {
      const marker = hotelMarkersRef.current[i]
      if (!marker) return
      const key = geoItemKey('hotel', h)
      const selected = selectedKey === key || hoverKey === key
      const candidate = candidateKeys?.has(key) ?? false
      marker.content = hotelMarkerContent(selected, candidate)
      marker.zIndex = selected ? 999 : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, visibleHotelsKey, candidateKeysToken])
}
