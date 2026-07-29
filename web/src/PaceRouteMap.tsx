import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Play, Square, Compass, MapPin, Check } from 'lucide-react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import styles from './PaceRouteMap.module.css'
import { BASE_URL } from './AppCommon'
import type { Checkpoint } from './PaceChart'

// SelectedEntry:使用者點擊某張檢查站卡片後選取的 entry,驅動地圖平移+
// 中心選點圖釘+儲存座標這套互動(見下方 PaceRouteMap 的 selectedEntry/
// onSelectedEntryDone props)。定義在這裡(而非呼叫端的頁面元件)是因為
// 這個型別描述的是 PaceRouteMap 的 props 形狀,由這個元件的擁有者決定,
// 兩個呼叫端(DesktopLayout.tsx 的正式介面、以及後續若有其他頁面)都從
// 這裡 import,不是各自為政各自定義一份。
export interface SelectedEntry {
  id: string
  lat: number | null
  lng: number | null
}

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
// computeRoutes 改由後端代呼叫,前端的 VITE_GOOGLE_MAPS_API_KEY 只負責
// Maps JavaScript API 的地圖渲染,計算類 REST API(Routes API)由後端用
// 專用的 GOOGLE_PLACES_API_KEY 呼叫,不需要讓瀏覽器端的 key 承擔額外的 API
// 限制範圍——跟 RecommendedPlacesMap.tsx 仍直接呼叫 Places API (New) 的
// places:searchText 不同,那是刻意保留的既有模式,這裡是特意搬到後端。
//
// 目前打的是 POST /internal/entries/compute-route(見
// server/internal/api/entry_geocode.go 的 handleComputeRouteFromEntries),
// entryIDs 改由 checkpoints prop 動態決定(見下方 props 說明)——不再寫死
// 特定頻道的 entry。這支端點掛在 /internal/*,需要帶有效的自家 JWT(見
// middleware.go 的 internalAuth),故底下改用帶 Authorization header 的
// POST 呼叫,不再是原本 GET /v1/demo/pace-route 那種不需登入的公開呼叫。
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

// 路線初始 center/zoom:找不到任何 checkpoint 座標可用時的 fallback 值
// (地圖仍需要一個起始中心點才能建立)——路線算出來後會 fitBounds 到實際
// 路線範圍,這裡不需要精確,純粹避免地圖建立時 center 是 undefined。
const INITIAL_CENTER = { lat: 23.64, lng: 121.42 }
const INITIAL_ZOOM = 14

// RouteCache:存進 localStorage 的快取形狀,只留下畫路線真正需要的最小
// 資料(encodedPolyline 字串 + 每段 leg 的起訖座標)——POST
// /internal/entries/compute-route 的回應形狀是 { entryIDs, titles, result:
// {encoded, legs} },這裡只快取 result 那一層,對齊這個扁平形狀。cache key
// 額外帶入 entryIDs 序列(見下方 routeCacheKey),同一組 checkpoint 才會
// 命中快取,換一段路線(不同 entryIDs)自然會重新打一次 API,不需要再手動
// 管理版本號。
const ROUTE_CACHE_KEY_PREFIX = 'tripace.paceRouteMap.route.v4.'
function routeCacheKey(entryIDs: string[]): string {
  return ROUTE_CACHE_KEY_PREFIX + entryIDs.join(',')
}
interface RouteLatLng {
  latitude: number
  longitude: number
}
interface RouteCache {
  encoded: string
  legs: { startLocation?: RouteLatLng; endLocation?: RouteLatLng }[]
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

export function PaceRouteMap({
  checkpoints,
  selectedEntry,
  onSelectedEntryDone,
}: {
  // checkpoints:目前選取的那一段路線(PaceChart 的 route.checkpoints,依
  // order 排序),由共同的父層(DesktopLayout.tsx/PhoneContent.tsx)透過
  // PaceChart 的 onRouteChange 鏡像過來——取代原本寫死的 4 筆 entry
  // 常數,改成真的跟著使用者目前選取的頻道/路段變動。第一筆/最後一筆當
  // origin/destination,中間的當 intermediates,直接對應後端
  // handleComputeRouteFromEntries 的 entryIDs 陣列語意(見該檔案說明)。
  // 少於 2 筆(該段還沒有 checkpoint,或還在載入中)時不計算路線,地圖
  // 仍正常顯示,只是沒有 Polyline 可畫。
  checkpoints: Checkpoint[]
  // selectedEntry:使用者在側欄點擊的檢查站(見 DesktopLayout.tsx 登入後
  // 正式介面的 pace 面板),非 null 時才顯示中央選點圖釘與「儲存座標」
  // 按鈕。可選是因為 PublicPaceDemoPage.tsx(/demo/pace 公開分享頁)刻意
  // 不接這套互動(寫入座標需要登入身分,不該出現在公開頁),掛載這個元件
  // 時完全不傳這兩個 props。
  selectedEntry?: SelectedEntry | null
  // onSelectedEntryDone:儲存成功後通知父層清掉 selectedEntry,收起圖釘與
  // 儲存按鈕——state 本身放在父層(DesktopLayout.tsx),這個元件不擅自持有。
  onSelectedEntryDone?: () => void
}) {
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
  // routeErr:路徑計算(compute-route)失敗時的錯誤訊息,跟上面的 err 分開——
  // err 代表「地圖本身建立失敗」(缺 API key、SDK 載入失敗),沒有地圖可看,
  // 才需要整頁換成 .rp-map-error 錯誤畫面;routeErr 只代表「地圖已經建好,
  // 但這次沒能算出路線/沒有 Polyline 可畫」,地圖仍然可以正常顯示、平移、
  // 縮放,不該因為路徑算不出來就讓整個地圖消失,只是不疊路徑線與沿路節點
  // marker(這批 checkpoint 有些是純轉彎指示、查無精確座標,compute-route
  // 可能因此回錯,見 server/internal/api/entry_geocode.go 的說明)。
  const [routeErr, setRouteErr] = useState<string | null>(null)
  // simulating:「模擬沿路線移動」開關,測試/demo 用——瀏覽器開發者工具的
  // 定位覆寫功能只能設一個固定假座標,沒辦法模擬移動過程,故在元件內建這個
  // 模擬,重用已經算出來的真實路線座標,每隔一段時間往前挪一個點。開啟時
  // 真實的 watchPosition 會暫停(見下方 effect 的依賴),避免兩邊互搶更新
  // 同一個 marker。
  const [simulating, setSimulating] = useState(false)
  // headingUp:「導航模式」開關——開啟時地圖會跟著目前位置的行進方向旋轉
  // (heading-up,像真的導航 App 那樣),關閉時維持固定正北朝上。
  const [headingUp, setHeadingUp] = useState(false)
  // pendingLatLng:選點圖釘目前指向的座標(畫面正中央對應的地圖經緯度),
  // 每次地圖 idle(平移/縮放結束)時從 map.getCenter() 重新讀取——只有
  // selectedEntry 非 null(使用者正在微調某個檢查站)時才需要追蹤,但 idle
  // 監聽器本身是掛在地圖上、跟 selectedEntry 是否存在無關,故這裡不特別
  // 依 selectedEntry 開關監聽器,只在按下「儲存座標」時才讀取這個值。
  const [pendingLatLng, setPendingLatLng] = useState<{ lat: number; lng: number } | null>(null)
  // saving/saveErr/saveOk:儲存座標(PATCH .../latlng)這個動作本身的狀態,
  // 跟 err/routeErr/meErr 一樣分開,各自代表獨立的失敗情境,互不影響彼此
  // 的顯示。saveOk 是短暫的成功提示,不需要計時器自動清除——選取關閉
  // (selectedEntry 變回 null)時整組儲存 UI 都會跟著收起,不會殘留。
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

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

  // entryIDs/stopNames:從 checkpoints prop 動態推導——第一筆/最後一筆是
  // origin/destination,中間的是 intermediates,直接對應後端 entryIDs 陣列
  // 語意(見上方 checkpoints prop 的說明)。少於 2 筆時不夠組出一條路線
  // (至少需要起訖點),整段路線計算直接跳過。
  const entryIDs = checkpoints.map((cp) => cp.id)
  const stopNames = checkpoints.map((cp) => cp.name)
  // entryIDsKey:給下方 effect 當依賴值——checkpoints 陣列參照在父層每次
  // 重渲染都可能改變(即使內容相同),用內容序列化成字串才能正確判斷「這批
  // checkpoint 是否真的變了」,避免路線在父層無關的重渲染時被重複打 API。
  const entryIDsKey = entryIDs.join(',')

  // 地圖就緒後才算路線:要有一個已存在的 map 物件才能畫 Polyline、才能
  // fitBounds。apiKey 這裡一定存在(mapReady 只可能在上面那個 effect 成功
  // 拿到 apiKey 並建好地圖後才會變 true)。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !apiKey) return
    if (entryIDs.length < 2) {
      // 不夠組出一條路線(該段還沒有 checkpoint,或還在載入中):清掉舊路線
      // /節點,地圖仍正常顯示,只是沒有 Polyline 可畫。
      polylineRef.current?.setMap(null)
      polylineRef.current = null
      stopMarkersRef.current.forEach((m) => m.setMap(null))
      stopMarkersRef.current = []
      routePathRef.current = null
      setRouteErr(null)
      return
    }
    let cancelled = false
    const cacheKey = routeCacheKey(entryIDs)

    // 同一組 checkpoint(entryIDs 序列相同)路線結果理論上永遠一樣——先看
    // localStorage 有沒有存過,有的話直接用,不重打一次 computeRoutes(這是
    // 按次計費的 REST API,每次掛載都重算是白花錢也是白花時間)。存取失敗
    // (無痕模式、額度滿了)都只是視同沒快取,不讓快取本身的問題擋住地圖
    // 正常運作。
    let cached: RouteCache | null = null
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) cached = JSON.parse(raw) as RouteCache
    } catch {
      cached = null
    }

    // POST /internal/entries/compute-route 掛在 internalAuth 之後,需要帶
    // 有效的自家 JWT——訪客(未登入)沒有這把 token,呼叫會被 401 拒絕。
    // AUTH_TOKEN_KEY 是 AppCommon.tsx 內部常數,這裡直接讀同一把
    // localStorage key(見該檔案 login/register 成功後寫入的位置),避免
    // 為了這次驗證改動 AppCommon 的匯出介面。
    const authToken = localStorage.getItem('tripace.auth.token')

    const source: Promise<RouteCache> = cached
      ? Promise.resolve(cached)
      : fetch(`${BASE_URL}/internal/entries/compute-route`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ entryIDs }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              throw new Error(`compute-route ${res.status}: ${text.slice(0, 300)}`)
            }
            const data = (await res.json()) as { result: RouteCache }
            return data.result
          })
          .then((result) => {
            if (!result.encoded) throw new Error('compute-route 回應沒有可用的路線')
            try {
              localStorage.setItem(cacheKey, JSON.stringify(result))
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
        // 然後每一段各自的終點」——這樣剛好對到 ORIGIN -> 中繼點1..N ->
        // DESTINATION 這幾個節點,順序與 stopNames 一致。注意:後端會跳過
        // 沒座標的中繼點(見 entry_geocode.go 的說明),故 legs 的節點數量
        // 可能少於 entryIDs 原始長度,stopNames[i] 對到的不一定是原始
        // checkpoints 裡同一個 index 的名稱——這裡仍是目前唯一可用的近似
        // 命名依據,查無對應名稱時 fallback 顯示「節點 N」。
        stopMarkersRef.current.forEach((m) => m.setMap(null))
        const stopPositions = decoded.legs.length > 0
          ? [decoded.legs[0].startLocation, ...decoded.legs.map((l) => l.endLocation)]
          : []
        stopMarkersRef.current = stopPositions.flatMap((loc, i) => {
          if (!loc || !mapRef.current) return []
          const name = stopNames[i] ?? `節點 ${i + 1}`
          const marker = new google.maps.Marker({
            position: { lat: loc.latitude, lng: loc.longitude },
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
        // 路徑算不出來不觸發整頁 .rp-map-error 畫面(那是給「地圖本身建不
        // 起來」用的),地圖仍正常顯示,只是沒有 Polyline/沿路節點可看。
        setRouteErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
    // stopNames 刻意不放進依賴陣列:它跟 entryIDsKey 是同一批 checkpoints
    // 衍生出來的另一份陣列(參照每次重渲染都變,但內容跟 entryIDsKey 同步
    // 變動),放進來只會造成重複觸發,不會多偵測到任何真正的變化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, apiKey, entryIDsKey])

  // selectedEntry 改變(使用者點了另一張檢查站卡片)時平移地圖過去——用
  // 'idle' 而非 'center_changed' 追蹤中心點(見下面那個 effect),兩者是
  // 分開的關注點:這裡只負責「跳去哪裡」,下面的 effect 只負責「持續讀出
  // 目前中心點在哪」,不論中心點是被 panTo 帶動還是使用者手動拖曳出來的。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedEntry) return
    // lat/lng 其中之一不是有限數字代表這筆 entry 還沒有座標(尚未
    // geocode)——維持地圖原本的中心不動即可,讓使用者自己從目前畫面找
    // 位置,不假裝有一個座標可以跳過去。用 typeof + isFinite 而非只判斷
    // === null:後端沒有座標時整個欄位直接省略(omitempty),經 JSON 解析
    // 後型別系統看不到的執行期值其實是 undefined,只檢查 null 會漏接,
    // 曾經真的把 undefined 一路傳進 google.maps panTo() 讓地圖直接 crash。
    if (typeof selectedEntry.lat !== 'number' || !Number.isFinite(selectedEntry.lat)) return
    if (typeof selectedEntry.lng !== 'number' || !Number.isFinite(selectedEntry.lng)) return
    mapRef.current.panTo({ lat: selectedEntry.lat, lng: selectedEntry.lng })
  }, [mapReady, selectedEntry])

  // 每次「選取新的一張」檢查站卡片,上一筆的儲存結果訊息就沒有意義了,
  // 清掉避免顯示到不相干的舊訊息。刻意只在 selectedEntry 變成非 null 時
  // 清除(不是任何變動就清),因為儲存成功後 saveLatLng 會呼叫
  // onSelectedEntryDone 把 selectedEntry 變回 null——那個當下 saveOk 才
  // 剛設成 true,若這裡連 selectedEntry 變 null 也觸發清除,成功提示會
  // 在使用者還沒看到之前就被自己洗掉。
  useEffect(() => {
    if (!selectedEntry) return
    setSaveErr(null)
    setSaveOk(false)
  }, [selectedEntry])

  // 持續追蹤地圖中心點座標,供選點圖釘(固定疊在畫面正中央的 UI 元素)與
  // 「儲存座標」按鈕使用——選 'idle'(平移/縮放動作結束後才觸發一次)而非
  // 'center_changed'(拖曳過程中每個 frame 都觸發),避免拖地圖時高頻
  // setState 拖慢畫面。這個監聽器本身不看 selectedEntry 是否存在,一直
  // 掛著即可,只是没有選取任何檢查站時 pendingLatLng 不會被讀取/顯示。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const listener = map.addListener('idle', () => {
      const center = map.getCenter()
      if (!center) return
      setPendingLatLng({ lat: center.lat(), lng: center.lng() })
    })
    return () => listener.remove()
  }, [mapReady])

  // 儲存選點圖釘目前指向的座標——PATCH /internal/entries/{id}/latlng 掛在
  // internalAuth 之後,需要帶自家 JWT,讀 token 的方式跟上面 compute-route
  // 那段一致(同一把 localStorage key)。成功後通知父層清掉 selectedEntry,
  // 圖釘與儲存按鈕會跟著收起;失敗只顯示錯誤訊息,不讓整頁崩潰,使用者可以
  // 再調整位置重試一次。
  async function saveLatLng() {
    if (!selectedEntry || !pendingLatLng) return
    setSaving(true)
    setSaveErr(null)
    try {
      const authToken = localStorage.getItem('tripace.auth.token')
      const res = await fetch(`${BASE_URL}/internal/entries/${selectedEntry.id}/latlng`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ lat: pendingLatLng.lat, lng: pendingLatLng.lng }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`儲存座標 ${res.status}: ${text.slice(0, 300)}`)
      }
      setSaveOk(true)
      onSelectedEntryDone?.()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

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
        {selectedEntry && (
          <>
            {/* 選點圖釘:刻意不是 google.maps.Marker(那種釘在地理座標上,
                地圖平移時它會跟著移動),而是純 CSS 疊在 .frame 容器正中央
                的元素,靠 transform: translate(-50%, -100%) 讓圖釘尖端
                (視覺上的下緣中點)對準畫面正中心點——地圖在圖釘底下自由
                平移/縮放,圖釘本身位置永遠不動,這是 Google Maps 官方
                「移動地圖選擇位置」的標準 UI 模式(Uber/Airbnb 那種拖地圖
                選地址的介面)。目前中心點座標由上面的 idle 監聽器持續寫進
                pendingLatLng,這裡的圖釘本身不需要知道座標數值。 */}
            <div className={styles.centerPin}>
              <MapPin size={36} strokeWidth={2} fill="#C4956A" color="#fff" />
            </div>
            <button
              type="button"
              className={styles.saveLatLng}
              title="儲存目前圖釘指向的座標"
              disabled={saving || !pendingLatLng}
              onClick={saveLatLng}
            >
              <Check size={16} strokeWidth={2} />
              {saving ? '儲存中…' : '儲存座標'}
            </button>
          </>
        )}
      </div>
      {meErr && <div className={styles.meErr}>無法取得目前位置:{meErr}</div>}
      {routeErr && <div className={styles.meErr}>路徑載入失敗:{routeErr}</div>}
      {saveErr && <div className={styles.meErr}>儲存座標失敗:{saveErr}</div>}
      {saveOk && <div className={styles.meErr}>已儲存座標。</div>}
    </div>
  )
}
