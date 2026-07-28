import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

// 配速表路線地圖(UI 試做用):用固定寫死的 5 個花蓮地點,呼叫新版 Routes
// API(computeRoutes)算出一條真實路線(沿路網走,不是自己手動連 marker 畫
// 直線)並畫在極簡風格底圖上。地點文字/travelMode 皆為展示用固定資料,
// 元件不接受 props。
//
// 原本第一版用的是舊版 DirectionsService/DirectionsRenderer——實測發現這個
// 專案的 GCP 專案並未啟用舊版 Directions API(只啟用了 Places API (New)/
// Routes API 這些新版),實際呼叫會被 REQUEST_DENIED 拒絕,不是理論上的
// deprecated 風險,是當下就打不通。改成直接 fetch computeRoutes REST 端點
// (不經 JS SDK 的 DirectionsService 包裝,那個類別底層就是打舊版端點)。
//
// computeRoutes 沒有像舊版 DirectionsRenderer 那樣「內建繪製」的物件,回應
// 只有 encodedPolyline 字串,需要自己:(1) importLibrary('geometry') 拿
// decodePath 解碼成座標陣列 (2) 自己 new google.maps.Polyline 畫出來
// (3) 自己算 LatLngBounds 讓地圖自動縮放到看得到整條路線(舊版
// DirectionsRenderer 這幾件事都是自動做的)。
//
// 這把 API key 直接在瀏覽器端呼叫 REST 端點(不經後端),沿用專案既有的
// 「瀏覽器限制 HTTP referrer」安全模式——跟 RecommendedPlacesMap.tsx 呼叫
// Places API (New) 的 places:searchText 是同一種既有模式,不是新的作法。
//
// 地點文字前綴「花蓮」是刻意的地址消歧義(避免解析到同名的其他縣市地點),
// 照抄不要更動。
//
// MINIMAL_MAP_STYLE/ensureOptionsSet 是從 RecommendedPlacesMap.tsx 複製過來
// 的獨立副本,刻意不 import 共用——那個檔案目前另有進行中的修改,這裡先不
// 建立跨檔案依賴,避免這個元件被牽動對方尚未定案的變更。等對方穩定下來、
// 真的要 export 共用時,再回頭消掉這處重複。
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
// 載入結果,不會重複載入 SDK。這個模組層級的 optionsSet flag 只在這個檔案內
// 生效,跟 RecommendedPlacesMap.tsx 各自獨立的那份互不影響——兩邊各自呼叫
// 一次 setOptions({ key, v: 'weekly' }) 是安全的,SDK 本身會處理重複初始化。
let optionsSet = false
function ensureOptionsSet(apiKey: string) {
  if (optionsSet) return
  optionsSet = true
  setOptions({ key: apiKey, v: 'weekly' })
}

const ORIGIN = '花蓮 光復橋'
const WAYPOINTS = ['花蓮 大農大富平地森林園區', '花蓮 七彩釣竿橋', '花蓮 大富火車站']
const DESTINATION = '花蓮 富興客棧'

// 路線初始 center/zoom:花蓮光復鄉附近的合理預設值,路線算出來後
// DirectionsRenderer 會自動調整可視範圍,這裡不需要手動 fitBounds。
const INITIAL_CENTER = { lat: 23.67, lng: 121.42 }
const INITIAL_ZOOM = 13

// computeRoutes 回應裡實際會用到的欄位(其餘一律不回傳,field mask 只列
// 這裡用得到的,避免多要不必要的欄位徒增延遲/成本,見 Google 官方建議)。
interface ComputeRoutesResponse {
  routes?: { polyline?: { encodedPolyline?: string } }[]
}

export function PaceRouteMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const [err, setErr] = useState<string | null>(null)
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
        mapRef.current = new Map(containerRef.current, {
          center: INITIAL_CENTER,
          zoom: INITIAL_ZOOM,
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

  // 地圖就緒後才算路線:要有一個已存在的 map 物件才能畫 Polyline、才能
  // fitBounds。apiKey 這裡一定存在(mapReady 只可能在上面那個 effect 成功
  // 拿到 apiKey 並建好地圖後才會變 true)。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !apiKey) return
    let cancelled = false

    fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { address: ORIGIN },
        destination: { address: DESTINATION },
        intermediates: WAYPOINTS.map((address) => ({ address })),
        travelMode: 'DRIVE',
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`computeRoutes ${res.status}: ${text.slice(0, 300)}`)
        }
        return res.json() as Promise<ComputeRoutesResponse>
      })
      .then((data) => {
        if (cancelled) return null
        const encoded = data.routes?.[0]?.polyline?.encodedPolyline
        if (!encoded) throw new Error('computeRoutes 回應沒有可用的路線(routes 是空的)')
        return importLibrary('geometry').then(({ encoding }) => ({ encoding, encoded }))
      })
      .then((decoded) => {
        if (cancelled || !decoded || !mapRef.current) return
        const path = decoded.encoding.decodePath(decoded.encoded)
        polylineRef.current?.setMap(null)
        polylineRef.current = new google.maps.Polyline({
          path,
          map: mapRef.current,
          strokeColor: '#C4956A',
          strokeWeight: 4,
        })
        const bounds = new google.maps.LatLngBounds()
        path.forEach((p) => bounds.extend(p))
        mapRef.current.fitBounds(bounds, 32)
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [mapReady, apiKey])

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
