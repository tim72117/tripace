import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Play, Square, Compass } from 'lucide-react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import styles from './PaceRouteMap.module.css'
import chartStyles from './PaceChartDemo.module.css'

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

// 沿路節點的顯示名稱,依序對應 ORIGIN -> WAYPOINTS[0..2] -> DESTINATION,
// 跟下方從 legs[].startLocation/endLocation 推導出的座標順序一一對應
// (見路線 effect 內的說明)。
const STOP_NAMES = ['光復橋', '大農大富平地森林園區', '七彩釣竿橋', '大富火車站', '富興客棧']

// 路線初始 center/zoom:花蓮光復鄉附近的合理預設值,路線算出來後會
// fitBounds 到實際路線範圍,這裡不需要精確。
const INITIAL_CENTER = { lat: 23.67, lng: 121.42 }
const INITIAL_ZOOM = 13

// computeRoutes 回應裡實際會用到的欄位(其餘一律不回傳,field mask 只列
// 這裡用得到的,避免多要不必要的欄位徒增延遲/成本,見 Google 官方建議)。
// legs[].startLocation/endLocation:每一段(origin->第1中繼點、中繼點之間、
// 最後中繼點->destination)的起訖座標——用這個組出沿路 5 個節點各自的座標,
// 不用另外呼叫 geocoding。
interface ComputeRoutesResponse {
  routes?: {
    polyline?: { encodedPolyline?: string }
    legs?: {
      startLocation?: { latLng?: { latitude: number; longitude: number } }
      endLocation?: { latLng?: { latitude: number; longitude: number } }
    }[]
  }[]
}

// RouteCache:存進 localStorage 的形狀,只留下畫路線真正需要的最小資料
// (encodedPolyline 字串 + 每段 leg 的起訖座標),不是整包 API 回應——避免
// 存了一堆用不到的欄位佔空間。ORIGIN/WAYPOINTS/DESTINATION 是寫死常數,
// 不會在執行期變動,故用固定 key、不需要依賴這幾個值算 cache key;如果
// 之後改了這幾個地點,记得同步把 ROUTE_CACHE_KEY 的版本號往上加一,否則
// 使用者本機會繼續讀到舊地點的快取路線。
const ROUTE_CACHE_KEY = 'tripace.paceRouteMap.route.v1'
interface RouteCache {
  encoded: string
  legs: { startLocation?: { latLng?: { latitude: number; longitude: number } }; endLocation?: { latLng?: { latitude: number; longitude: number } } }[]
}

// 兩點之間的方位角(bearing,0-360 度,0=正北、順時針),標準大圓航向公式。
// 「模擬沿路線移動」沒有真實裝置的 GPS heading 可用,拿相鄰兩個路徑點算出
// 前進方向,餵給「導航模式」的地圖旋轉——真實 GPS 則直接讀
// GeolocationCoordinates.heading,不需要這個計算(見 watchPosition 那段)。
function bearingBetween(a: google.maps.LatLng, b: google.maps.LatLng): number {
  const lat1 = (a.lat() * Math.PI) / 180
  const lat2 = (b.lat() * Math.PI) / 180
  const dLng = ((b.lng() - a.lng()) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function PaceRouteMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const meMarkerRef = useRef<google.maps.Marker | null>(null)
  // 沿路節點 marker 點擊後彈出的資訊卡——共用同一個 InfoWindow 實例,點哪個
  // marker 就換內容/位置重開,不是每個 marker 各自建一個(這是 Maps JS API
  // 官方建議的標準用法,避免同時開一堆視窗)。
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  // 沿路 5 個節點(起點/3 個中繼點/終點)的 marker,從 legs[].startLocation/
  // endLocation 推導座標畫出來(見路線 effect)。
  const stopMarkersRef = useRef<google.maps.Marker[]>([])
  // 路線算出來後解碼的座標陣列,存進 ref 供「模擬沿路線移動」使用(見下方
  // simulating 相關 effect)——只有存取用途,不影響畫面,不需要 state。
  const routePathRef = useRef<google.maps.LatLng[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // meErr 跟 err 分開:定位失敗只代表「現在位置」這個附加標記顯示不出來,
  // 路線本身照常算、照常畫,不該讓整個地圖跳成 .rp-map-error 錯誤畫面
  // (那個畫面目前是設計成「地圖整個沒得用」的情境)。
  const [meErr, setMeErr] = useState<string | null>(null)
  // mePos 用 state(不只是 ref)是因為「回到目前位置」按鈕要不要顯示/能不能按
  // 得跟著定位到手了沒重新 render,單純存在 ref 裡不會觸發畫面更新。
  const [mePos, setMePos] = useState<{ lat: number; lng: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // simulating:「模擬沿路線移動」開關,測試/demo 用——瀏覽器開發者工具的
  // 定位覆寫功能只能設一個固定假座標,沒辦法模擬移動過程,故在元件內建這個
  // 模擬,重用已經算出來的真實路線座標,每隔一段時間往前挪一個點。開啟時
  // 真實的 watchPosition 會暫停(見下方 effect 的依賴),避免兩邊互搶更新
  // 同一個 marker。
  const [simulating, setSimulating] = useState(false)
  // headingUp:「導航模式」開關——開啟時地圖會跟著目前位置的行進方向旋轉
  // (heading-up,像真的導航 App 那樣),關閉時維持固定正北朝上。
  const [headingUp, setHeadingUp] = useState(false)

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
          // 「導航模式」要旋轉地圖朝向(setHeading)——Raster 模式(預設)下
          // setHeading 官方文件明講只對空照圖生效,一般地圖圖磚基本無視覺
          // 效果。改用 Vector 渲染才能真的旋轉,查證過不需要另外去 GCP
          // Console 設定 mapId。
          renderingType: google.maps.RenderingType.VECTOR,
        })
        infoWindowRef.current = new google.maps.InfoWindow()
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

    // 這 5 個地點是寫死不變的常數,路線結果理論上永遠一樣——先看
    // localStorage 有沒有存過,有的話直接用,不重打一次 computeRoutes(這是
    // 按次計費的 REST API,每次掛載都重算是白花錢也是白花時間)。存取失敗
    // (無痕模式、額度滿了)都只是視同沒快取,不讓快取本身的問題擋住地圖
    // 正常運作。
    let cached: RouteCache | null = null
    try {
      const raw = localStorage.getItem(ROUTE_CACHE_KEY)
      if (raw) cached = JSON.parse(raw) as RouteCache
    } catch {
      cached = null
    }

    const source: Promise<RouteCache> = cached
      ? Promise.resolve(cached)
      : fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
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
            const route = data.routes?.[0]
            const encoded = route?.polyline?.encodedPolyline
            if (!encoded) throw new Error('computeRoutes 回應沒有可用的路線(routes 是空的)')
            const result: RouteCache = { encoded, legs: route.legs ?? [] }
            try {
              localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(result))
            } catch {
              // 存不進去(額度滿了/無痕模式)不影響這次渲染,下次一樣會重打
              // API,不是致命錯誤,不需要跳錯誤畫面。
            }
            return result
          })

    source
      .then((result) => {
        if (cancelled) return null
        return importLibrary('geometry').then(({ encoding }) => ({ encoding, encoded: result.encoded, legs: result.legs }))
      })
      .then((decoded) => {
        if (cancelled || !decoded || !mapRef.current) return
        const path = decoded.encoding.decodePath(decoded.encoded)
        routePathRef.current = path
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

        // 沿路節點:每段 leg 的起點接續下一段,故座標序列是「第一段的起點,
        // 然後每一段各自的終點」——這樣剛好對到 ORIGIN -> 中繼點1..3 ->
        // DESTINATION 這 5 個節點,順序與 STOP_NAMES 一致。
        stopMarkersRef.current.forEach((m) => m.setMap(null))
        const stopPositions = decoded.legs.length > 0
          ? [decoded.legs[0].startLocation, ...decoded.legs.map((l) => l.endLocation)]
          : []
        stopMarkersRef.current = stopPositions.flatMap((loc, i) => {
          const latLng = loc?.latLng
          if (!latLng || !mapRef.current) return []
          const name = STOP_NAMES[i] ?? `節點 ${i + 1}`
          const marker = new google.maps.Marker({
            position: { lat: latLng.latitude, lng: latLng.longitude },
            map: mapRef.current,
            title: name,
          })
          marker.addListener('click', () => {
            if (!infoWindowRef.current || !mapRef.current) return
            infoWindowRef.current.setContent(
              `<div class="pace-route-map-infowindow"><b>${name}</b></div>`,
            )
            infoWindowRef.current.open({ map: mapRef.current, anchor: marker })
          })
          return [marker]
        })
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [mapReady, apiKey])

  // 「現在位置」marker 的建立/更新邏輯——真實 GPS(下面的 effect)跟模擬移動
  // (再下面的 effect)共用同一份,避免兩處各寫一次、之後改一邊忘了改另一邊。
  // heading 是選填的行進方向(0-360 度,null 表示這次沒有可用的方向資料):
  // 真實 GPS 靜止不動、或裝置沒有羅盤時,GeolocationCoordinates.heading
  // 本身就會是 null,這時維持地圖現有朝向不動,不強行轉成 0 度。
  function updateMePosition(position: { lat: number; lng: number }, heading: number | null) {
    if (!mapRef.current) return
    setMePos(position)
    if (meMarkerRef.current) {
      meMarkerRef.current.setPosition(position)
    } else {
      meMarkerRef.current = new google.maps.Marker({
        position,
        map: mapRef.current,
        title: '目前位置',
        zIndex: 999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      })
    }
    if (headingUp && heading !== null) {
      mapRef.current.setHeading(heading)
    }
  }

  // 現在位置(瀏覽器標準 Geolocation API,跟 Google 完全無關,任何地圖庫都能
  // 配):watchPosition 持續回報,裝置移動時同一個 marker 跟著更新位置,不是
  // 只定位一次的快照——對應真實使用情境(騎車時看自己現在在路線上哪裡)。
  // 需要 HTTPS + 使用者授權彈窗;拒絕/沒有 GPS 硬體(常見於桌面電腦)都只是
  // 不顯示這個點,不影響路線本身的顯示。simulating 開啟時整段跳過,不去搶
  // 模擬 effect 正在更新的同一個 marker。
  useEffect(() => {
    if (!mapReady || !mapRef.current || simulating) return
    if (!navigator.geolocation) {
      setMeErr('此瀏覽器不支援定位')
      return
    }

    const watchID = navigator.geolocation.watchPosition(
      (pos) => updateMePosition(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        pos.coords.heading,
      ),
      (e) => setMeErr(e.message),
      { enableHighAccuracy: true },
    )

    return () => {
      navigator.geolocation.clearWatch(watchID)
      meMarkerRef.current?.setMap(null)
      meMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, simulating])

  // 模擬沿路線移動(測試/demo 用,見上方 simulating 宣告處的說明):每 800ms
  // 往路線座標陣列前進一步,到底就折返繼續跑(來回而非瞬間跳回起點,動畫
  // 比較自然),重用跟真實 GPS 同一個 updateMePosition。routePathRef 在路線
  // 算出來前是 null,這種情況直接不啟動、也不報錯(路線可能還在載入中)。
  useEffect(() => {
    if (!simulating || !routePathRef.current || routePathRef.current.length === 0) return
    const path = routePathRef.current
    let i = 0
    let dir = 1
    const tick = () => {
      const p = path[i]
      // 用「下一步要走去的點」算行進方向(不是用上一步算,那樣方向會晚一拍
      // 才轉);到底點/回起點折返時沒有下一步,heading 傳 null,維持地圖
      // 現有朝向不動,不硬算一個沒意義的方向。
      const next = path[i + dir]
      const heading = next ? bearingBetween(p, next) : null
      updateMePosition({ lat: p.lat(), lng: p.lng() }, heading)
      if (i === path.length - 1) dir = -1
      else if (i === 0) dir = 1
      i += dir
    }
    tick()
    const intervalID = window.setInterval(tick, 800)
    return () => window.clearInterval(intervalID)
  }, [simulating])

  if (err) {
    return (
      <div className="rp-map-error">
        <span>地圖載入失敗</span>
        <span className="rp-map-error-detail">{err}</span>
      </div>
    )
  }

  return (
    <div className="pace-route-map-wrap">
      <div className={styles.frame}>
        <div ref={containerRef} className="rp-map" />
        {/* 效果試做:固定疊 3 張檢查點卡片在地圖左上角,垂直微錯開做出堆疊感
            (見 PaceRouteMap.module.css 的 .cardStack1/2/3),卡片外觀直接
            沿用 PaceChartDemo.module.css 的 .stop 系列 class(import 該
            module、組合 className,不是跨檔案 CSS 選擇器)——先看這個方向的
            視覺效果如何,還沒接點擊 marker 切換內容的互動,里程/時刻皆為
            示範用固定值,非即時資料。 */}
        <div className={`${styles.card} ${styles.cardStack1}`}>
          <div className={`${chartStyles.stop} ${styles.cardStopOverride}`}>
            <div className={chartStyles.stopLeft}>
              <div className={chartStyles.startBadge}>🚩 起點</div>
              <div className={chartStyles.locName}>光復橋</div>
              <div className={chartStyles.locMeta}>
                <span className={`${chartStyles.kmVal} ${chartStyles.mono}`}>0.0 km</span>
              </div>
            </div>
            <div className={chartStyles.stopRight}>
              <div className={chartStyles.depLabel}>出發</div>
              <div className={`${chartStyles.depVal} ${chartStyles.mono}`}>09:00</div>
            </div>
          </div>
        </div>
        <div className={`${styles.card} ${styles.cardStack2}`}>
          <div className={`${chartStyles.stop} ${styles.cardStopOverride}`}>
            <div className={chartStyles.stopLeft}>
              <div className={chartStyles.locName}>大農大富平地森林園區</div>
              <div className={chartStyles.locMeta}>
                <span className={`${chartStyles.kmVal} ${chartStyles.mono}`}>10.5 km</span>
              </div>
            </div>
            <div className={chartStyles.stopRight}>
              <div className={chartStyles.depLabel}>離站</div>
              <div className={`${chartStyles.depVal} ${chartStyles.mono}`}>10:55</div>
            </div>
          </div>
        </div>
        <div className={`${styles.card} ${styles.cardStack3}`}>
          <div className={`${chartStyles.stop} ${styles.cardStopOverride}`}>
            <div className={chartStyles.stopLeft}>
              <div className={chartStyles.locName}>大富火車站</div>
              <div className={chartStyles.locMeta}>
                <span className={`${chartStyles.kmVal} ${chartStyles.mono}`}>17.0 km</span>
              </div>
            </div>
            <div className={chartStyles.stopRight}>
              <div className={chartStyles.depLabel}>離站</div>
              <div className={`${chartStyles.depVal} ${chartStyles.mono}`}>12:00</div>
            </div>
          </div>
        </div>
        {mePos && (
          <button
            type="button"
            className={styles.recenter}
            title="回到目前位置"
            onClick={() => {
              mapRef.current?.panTo(mePos)
              mapRef.current?.setZoom(16)
            }}
          >
            <LocateFixed size={18} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          className={simulating ? `${styles.simulate} ${styles.active}` : styles.simulate}
          title={simulating ? '停止模擬移動' : '模擬沿路線移動(測試用)'}
          onClick={() => setSimulating((v) => !v)}
        >
          {simulating ? <Square size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
          {simulating ? '停止模擬' : '模擬移動'}
        </button>
        <button
          type="button"
          className={headingUp ? `${styles.heading} ${styles.active}` : styles.heading}
          title={headingUp ? '關閉導航模式(改回正北朝上)' : '開啟導航模式(地圖跟著行進方向旋轉)'}
          onClick={() => {
            setHeadingUp((v) => {
              const next = !v
              // 關閉時重設回正北朝上,不留在切換當下最後一次旋轉到的角度。
              if (!next) mapRef.current?.setHeading(0)
              return next
            })
          }}
        >
          <Compass size={16} strokeWidth={2} />
          導航模式
        </button>
      </div>
      {meErr && <div className={styles.meErr}>無法取得目前位置:{meErr}</div>}
    </div>
  )
}
