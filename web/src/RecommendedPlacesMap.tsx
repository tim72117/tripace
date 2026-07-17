import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import type { RecommendedPlace } from './RecommendedPlaces'

// 推薦景點地圖(UI 試做用):用 Maps JavaScript API 載入極簡風格底圖,
// 把傳入的景點清單各自標一個 marker。
//
// 極簡風格參數對齊之前用 Static Maps API 測試過的效果(隱藏 POI/大眾運輸/
// 行政區標籤,道路只留線條不留文字,配色貼近專案的暖色調色盤)。
// JS API 的 styles 是物件陣列,語意跟 Static Maps 的 style= 參數相同,
// 只是格式從「url 參數字串」換成「JSON 結構」。
const MINIMAL_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', stylers: [{ color: '#F5F2ED' }] },
  { featureType: 'water', stylers: [{ color: '#F5F2ED' }] },
  { featureType: 'road', stylers: [{ color: '#C9C2B8' }] },
  { featureType: 'road.highway', stylers: [{ color: '#B0A896' }] },
]

// @googlemaps/js-api-loader 的 functional API(setOptions + importLibrary)取代
// 已 deprecated 的 Loader class,正確處理新版 SDK 的異步載入機制(單純注入
// <script src> 不會有 google.maps.importLibrary,那是官方 bootstrap loader
// 自己掛上去的)。setOptions 只需呼叫一次,重複呼叫 importLibrary 會共用同一份
// 載入結果,不會重複載入 SDK。
let optionsSet = false
function ensureOptionsSet(apiKey: string) {
  if (optionsSet) return
  optionsSet = true
  setOptions({ key: apiKey, v: 'weekly' })
}

export function RecommendedPlacesMap({ places }: { places: RecommendedPlace[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const [err, setErr] = useState<string | null>(null)
  // mapReady:地圖初始化完成後翻成 true,觸發下方畫 marker 的 effect。
  // 不能只靠 mapRef(ref 變化不會觸發 re-render,marker effect 會永遠讀到初始的
  // mapRef.current===null 而跳過,一次都不會畫)。
  const [mapReady, setMapReady] = useState(false)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY(見 web/.env.development.local)')
      return
    }
    if (!containerRef.current) return
    let cancelled = false

    ensureOptionsSet(apiKey)
    importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return
        // 中心點取有效座標的第一筆景點,查無則退回一個安全預設值(避免地圖空白)。
        const first = places.find((p) => p.lat && p.lng)
        const center = first ? { lat: first.lat, lng: first.lng } : { lat: 35.0, lng: 135.76 }
        mapRef.current = new Map(containerRef.current, {
          center,
          zoom: 14,
          styles: MINIMAL_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        setMapReady(true)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  // 地圖就緒或景點清單變動時重新畫 marker(先清掉舊的,避免殘留)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = places
      .filter((p) => p.lat && p.lng)
      .map(
        (p) =>
          new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map: mapRef.current!,
            title: p.name,
          }),
      )
  }, [mapReady, places])

  if (err) {
    return (
      <div className="rp-map-error">
        <span>地圖載入失敗</span>
        <span className="rp-map-error-detail">{err}</span>
      </div>
    )
  }

  return <div ref={containerRef} className="rp-map" />
}
