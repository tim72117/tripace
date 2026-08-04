import { useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import type { GeoDistrict, GeoHotel } from './api'
import styles from './GeoOutlineMap.module.css'

// 地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)——桌面版。
//
// 空行程、任何候選點出現之前,地圖先浮現一層純定向的地理輪廓:重心光暈
// 搭配白話地名標籤,暗示城市大致分成幾個有名字的區塊,區塊間用延遲淡入
// 的極淡連線帶出分鐘制的相對方位與距離(此處先用約略公里數,分鐘制估算
// 留待接上真實路網資料再補)。
//
// 嚴守構想 6 定案的文案界線:只回答「這城市長什麼樣」,不做排序、不帶
// 推薦語氣——每個光暈只有地名標籤與(可選的)圓形地標縮圖,不顯示評分、
// 不排名次。
//
// 底圖繪製方式:MINIMAL_MAP_STYLE 的極簡 Google 地圖上,用
// google.maps.OverlayView 疊 HTML(光暈 div + 地標圓形圖 + 標籤),而非
// google.maps.Marker——構想 6 要的是「一團光暈+白話標籤」的複合視覺,
// 不是單點 icon,OverlayView 能自由疊放任意 DOM 結構並跟著地圖縮放/平移
// 自動重新定位。

const MINIMAL_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  // transit(大眾運輸線路+站點)恢復 Google 預設完全開啟,不下任何
  // visibility/顏色規則——鐵路/地鐵路網本身是「這城市怎麼串起來」的
  // 重要地景資訊,呼應構想 6「這城市長什麼樣」,跟純裝飾性的 poi(商家/
  // 景點小圖標)刻意保持不同待遇,那類雜訊才是關閉的對象。
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // administrative 的邊界線(elementType: 'geometry.stroke')預設是隱藏的,
  // 這裡明確開啟——locality(城市/行政區級)與 neighborhood(次分區級,
  // 對應後端 SearchDistricts 用的 sublocality/locality 分類,見
  // server/internal/geo/places.go 的 districtComponentTypes)這兩層級的
  // 邊界線,能讓地圖暗示「這裡有一條實際的區界」,呼應光暈+標籤標示的
  // 分區。線條刻意用極細、低飽和度的暖灰,只是隱約的輔助線索,不會
  // 蓋過光暈與標籤才是主角的視覺層級。country/province 這兩層級刻意
  // 不開(顆粒度太粗,對城市內部規劃沒有意義,徒增雜訊)。
  {
    featureType: 'administrative.locality',
    elementType: 'geometry.stroke',
    stylers: [{ visibility: 'on' }, { color: '#C9C2B8' }, { weight: 1 }],
  },
  {
    featureType: 'administrative.neighborhood',
    elementType: 'geometry.stroke',
    stylers: [{ visibility: 'on' }, { color: '#D6D0C7' }, { weight: 0.5 }],
  },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', stylers: [{ color: '#F5F2ED' }] },
  // landscape.natural(森林/荒地等自然地貌)比上面廣泛的 landscape 規則
  // 更具體,Google Maps 樣式規則採「更具體者覆蓋更廣泛者」,故這裡能
  // 單獨把自然地貌改成柔綠色,建成區域仍維持上面的暖米色——讓地圖能
  // 暗示「這裡是山林/荒地」的地景輪廓,呼應構想 6「這城市長什麼樣」
  // 的定位,但刻意選低飽和度的柔綠(而非鮮豔的地圖預設綠),避免搶過
  // 光暈與白話標籤的視覺焦點。
  { featureType: 'landscape.natural', stylers: [{ color: '#DCE0C8' }] },
  // landscape.man_made(建物密集區/建成區域)同理獨立出來,跟上面的
  // landscape.natural 對照:一個柔綠、一個比底色略深的暖棕米,兩者都
  // 從中性的 landscape 底色(#F5F2ED)分裂出來、彼此有可辨識的對比,
  // 但都刻意壓低飽和度——讓「這裡是建成區、那裡是山林」這組地景資訊
  // 能被隱約讀出來,而不是用色塊互相搶戲。
  { featureType: 'landscape.man_made', stylers: [{ color: '#EDE6DA' }] },
  { featureType: 'water', stylers: [{ color: '#F5F2ED' }] },
  { featureType: 'road', stylers: [{ color: '#C9C2B8' }] },
  { featureType: 'road.highway', stylers: [{ color: '#B0A896' }] },
]

let optionsSet = false
function ensureOptionsSet(apiKey: string) {
  if (optionsSet) return
  optionsSet = true
  // language 未指定時,Google Maps SDK 會依 IP 位置等隱含訊號自動判斷
  // 底圖語言(實測搜尋清邁時整個底圖變成泰文)——這裡明確鎖定繁中,
  // 理由同後端 Places API 呼叫固定 languageCode: zh-TW(見
  // server/internal/geo/places.go),專案介面語言只有繁中。
  setOptions({ key: apiKey, v: 'weekly', language: 'zh-TW' })
}

// 兩點間距離(公里,Haversine 公式)——用來在延遲淡入的連線標籤上顯示
// 約略距離。構想 6 定案要求分鐘制優先、公里數為次要,但目前專案還沒有
// 「城市內步行/轉乘估算分鐘數」的既有換算依據(PaceRouteMap.tsx 的
// bearingBetween 只算方位角,不算距離換算時間),先用公里數如實呈現,
// 避免編造未經驗證的分鐘數字。
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// DistrictOverlay:單一分區的複合 DOM 疊層(光暈 + 圓形地標圖 + 白話標籤),
// 用 google.maps.OverlayView 子類別實作,讓它跟著地圖投影自動換算像素位置。
//
// 這個 class 不能在模組頂層直接 `extends google.maps.OverlayView`——
// extends 子句在 class 宣告當下就會被求值,而 google.maps SDK 是透過
// importLibrary('maps')異步載入的(見下方 GeoOutlineMap 的 useEffect),
// 模組載入的當下 google 這個全域變數還不存在,會直接拋出
// ReferenceError: google is not defined。改用 getDistrictOverlayClass()
// 延後到 SDK 確定載入完成後才定義並快取這個 class(單例,只建一次)。
type DistrictOverlayInstance = google.maps.OverlayView
let DistrictOverlayClass:
  | (new (district: GeoDistrict, position: google.maps.LatLng) => DistrictOverlayInstance)
  | null = null

function getDistrictOverlayClass() {
  if (DistrictOverlayClass) return DistrictOverlayClass

  class DistrictOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null
    private position: google.maps.LatLng

    constructor(
      private district: GeoDistrict,
      position: google.maps.LatLng,
    ) {
      super()
      this.position = position
    }

    onAdd() {
      const div = document.createElement('div')
      // 這裡刻意用固定字串(而非 styles.xxx)當 class 名稱:這些 class 是
      // 透過 innerHTML 字串動態組裝出來的 DOM,不是 JSX 裡直接寫
      // className={styles.xxx} 的元素,CSS Modules 只會把「有被 JS 實際
      // 引用到的 local class」雜湊改名並匯出成 styles 物件屬性——但
      // :global()包裹的規則本來就不會被匯出(這正是 :global 的用途:定義
      // 不受雜湊影響的固定 class 名),若誤用 styles.xxx 取值會拿到
      // undefined,等於完全沒套用到任何 class、CSS 規則(尤其是關鍵的
      // position: absolute)整個失效。故這裡與 GeoOutlineMap.module.css
      // 的 :global(.xxx) 選擇器一致,直接寫死字串。
      div.className = 'geo-district-overlay'
      div.innerHTML = `
        <div class="geo-district-glow"></div>
        ${
          this.district.landmarkPhotoUrl
            ? `<img class="geo-district-landmark-photo" src="${this.district.landmarkPhotoUrl}" alt="${escapeHtml(this.district.landmarkName ?? this.district.name)}" loading="lazy" />`
            : `<div class="geo-district-landmark-placeholder"></div>`
        }
        <span class="geo-district-label">${escapeHtml(this.district.name)}</span>
      `
      this.div = div
      const panes = this.getPanes()
      panes?.overlayMouseTarget.appendChild(div)
    }

    draw() {
      if (!this.div) return
      const projection = this.getProjection()
      if (!projection) return
      const point = projection.fromLatLngToDivPixel(this.position)
      if (!point) return
      this.div.style.left = `${point.x}px`
      this.div.style.top = `${point.y}px`
    }

    onRemove() {
      this.div?.remove()
      this.div = null
    }
  }

  DistrictOverlayClass = DistrictOverlay
  return DistrictOverlayClass
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// maxLevelForZoom:Google Maps zoom 值(數字越大越接近地面)累加式對應到
// 知名度分級(model.Landmark.Level,1=國際~5=在地,見後端型別說明)的
// 顯示上限——縮得越小只顯示越知名的地標,拉近才逐步冒出更細粒度的
// 在地資訊,不會一次全部消失/出現。level 未設定的地標(即時查 Google
// Places、非人工建檔的結果)不受這個篩選影響,見呼叫端的判斷。
function maxLevelForZoom(zoom: number): number {
  if (zoom <= 10) return 1
  if (zoom <= 11) return 2
  if (zoom <= 13) return 3
  if (zoom <= 14) return 4
  return 5
}

// minZoomForLevel:maxLevelForZoom 的反函式——給定一個知名度分級,回傳
// 「至少要縮放到多少 zoom 才看得到它」的最小 zoom 值。供側欄點擊地點
// 時使用:點一個 5 級(在地級,如「永康商圈」)的地點,若目前 zoom 只有
// 12(對應 maxLevel=3),該點根本不會被畫出來(見 filteredDistricts 的
// 篩選),必須先把 zoom 拉到 15 以上才看得到,單純 panTo 平移過去只會
// 移到一個空地圖。數字取自 maxLevelForZoom 每個門檻的下一格,兩者需要
// 保持同步——調整 maxLevelForZoom 的門檻時記得一併更新這裡。
function minZoomForLevel(level: number): number {
  if (level <= 1) return 0
  if (level === 2) return 11
  if (level === 3) return 12
  if (level === 4) return 14
  return 15
}

export function GeoOutlineMap({
  districts,
  hotels = [],
  onVisibleHotelsChange,
  panTarget,
}: {
  districts: GeoDistrict[]
  hotels?: GeoHotel[]
  // onVisibleHotelsChange:每當地圖可視範圍(bounds)或 hotels 本身變動
  // 時,回報「目前落在地圖可視範圍內」的飯店子集合——飯店側欄
  // (GeoHotelSidebar,見 DesktopLayout.tsx)渲染在整個桌面版介面最
  // 外側、不是這個地圖元件的子節點,清單要跟著地圖範圍同步,只能靠
  // 這個 callback 往上回報,而不是側欄自己重新算一次(bounds 只有
  // 地圖實例本身知道)。
  onVisibleHotelsChange?: (hotels: GeoHotel[]) => void
  // panTarget:使用者在 GeoHotelSidebar 點擊某個飯店/地點項目時要移動
  // 地圖到的座標——每次點擊(即使連續點同一個項目)DesktopLayout 都會
  // 建立新的物件參照,故這裡直接把整個物件放進 useEffect 依賴陣列即可
  // 正確偵測到「這是一次新的移動請求」,不需要額外的序號/時間戳欄位。
  // level 只有點擊「地點」(GeoDistrict)才會帶,飯店(GeoHotel)沒有
  // level 概念,固定不帶——見下方 useEffect,只有帶 level 時才會額外
  // 呼叫 setZoom 把縮放層級拉到能顯示該地點的最小尺度(minZoomForLevel),
  // 純平移(panTo)本身不會改變 zoom,若目前 zoom 太小、該地點根本沒被
  // 畫出來(見 filteredDistricts 的篩選),不強制調整 zoom 只會移動到
  // 一個看起來空空如也的地圖。
  panTarget?: { lat: number; lng: number; level?: number } | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<DistrictOverlayInstance[]>([])
  const hotelMarkersRef = useRef<google.maps.Marker[]>([])
  const radiusCirclesRef = useRef<google.maps.Circle[]>([])
  const linesRef = useRef<google.maps.Polyline[]>([])
  const lineLabelsRef = useRef<google.maps.OverlayView[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // linesVisible:區塊間連線延遲淡入的開關,對齊構想 6「使用者明顯停留
  // 1-2 秒才出現」的節奏——手比眼快的人根本等不到這條線畫上去。
  const [linesVisible, setLinesVisible] = useState(false)
  // zoom:即時反映地圖目前縮放層級,驅動下方 filteredDistricts 依
  // maxLevelForZoom 篩選要顯示哪些知名度分級的地標。初始值對齊
  // Map 建構時的 zoom: 12(見下方 useEffect)。
  const [zoom, setZoom] = useState(12)
  // bounds:即時反映地圖目前可視範圍,驅動 visibleHotels 只顯示範圍內的
  // 飯店(地圖拖曳/縮放後,原本查到但已經滑出畫面的飯店不該繼續佔用
  // marker/側欄清單的版面)。初始 null——地圖剛掛載、還沒收到第一次
  // bounds_changed 前,visibleHotels 直接顯示全部(見下方判斷),避免
  // 開頭一瞬間清單/地圖是空的。
  const [bounds, setBounds] = useState<google.maps.LatLngBounds | null>(null)

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
        const first = districts[0]
        const center = first ? { lat: first.lat, lng: first.lng } : { lat: 35.0, lng: 135.76 }
        mapRef.current = new Map(containerRef.current, {
          center,
          zoom: 12,
          styles: MINIMAL_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        // zoom_changed 監聽器:即時反映使用者拖曳滾輪/點擊縮放控制項
        // 造成的縮放層級變化,驅動下方 filteredDistricts 重新計算。
        // fitBounds(見下方另一個 useEffect)也會觸發這個事件,故換城市
        // 查詢後自動平移縮放時,篩選結果會跟著同步更新,不需要另外處理。
        mapRef.current.addListener('zoom_changed', () => {
          setZoom(mapRef.current?.getZoom() ?? 12)
        })
        // bounds_changed 監聽器:拖曳平移或縮放都會觸發,驅動下方
        // visibleHotels 只顯示目前可視範圍內的飯店。比 idle 更即時
        // (idle 只在使用者放開滑鼠、動畫結束後才觸發一次),但兩者
        // 對這裡的篩選用途沒有實質差異,選 bounds_changed 是因為它
        // 是官方文件建議取得目前可視範圍的標準事件。
        mapRef.current.addListener('bounds_changed', () => {
          setBounds(mapRef.current?.getBounds() ?? null)
        })
        setMapReady(true)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  // filteredDistricts:依目前 zoom 對應的知名度分級上限篩選——只篩選
  // 「有 level 資訊」的分區(人工建檔的資料,見 model.Landmark);沒有
  // level 的分區(即時查 Google Places 的結果)一律顯示,不受縮放層級
  // 篩選影響(這批資料沒有分級可言,無從篩起)。用 useMemo 快取,理由
  // 同 visibleHotels(見下方):.filter() 若每次 render 都重算,會產生
  // 新陣列參照,讓依賴它的 useEffect(畫分區光暈/範圍圓圈/farPairs)
  // 誤判成「內容變了」而重複清除重畫——即使這裡本身不會形成無限迴圈
  // (filteredDistricts 沒有驅動任何 setState),但仍會在 sibling
  // state(如 visibleHotels 變動連鎖傳回的新 hotels/districts prop)
  // 造成這個元件重渲染時,讓光暈/圓圈/連線動畫不必要地重播、閃爍。
  const maxLevel = maxLevelForZoom(zoom)
  const filteredDistricts = useMemo(
    () => districts.filter((d) => d.level == null || d.level <= maxLevel),
    [districts, maxLevel],
  )

  // 畫分區光暈疊層:地圖就緒或 filteredDistricts 變動時重畫,先清掉舊的。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    overlaysRef.current.forEach((o) => o.setMap(null))
    const OverlayClass = getDistrictOverlayClass()
    overlaysRef.current = filteredDistricts.map((d) => {
      const overlay = new OverlayClass(d, new google.maps.LatLng(d.lat, d.lng))
      overlay.setMap(mapRef.current!)
      return overlay
    })
    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null))
      overlaysRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filteredDistricts])

  // 範圍圓圈:只有帶 radiusMeters 的分區(手動整理的觀光慣稱分區,如
  // 清邁的古城區/尼曼區,見 server/internal/geo/district_aliases.go)
  // 才畫——這類分區沒有官方邊界資料,圓圈只是「大概這一帶」的粗略
  // 示意,故用低透明度填色+淡邊框,刻意不搶過光暈與標籤的視覺焦點。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    radiusCirclesRef.current.forEach((c) => c.setMap(null))
    radiusCirclesRef.current = filteredDistricts
      .filter((d) => d.radiusMeters && d.radiusMeters > 0)
      .map(
        (d) =>
          new google.maps.Circle({
            center: { lat: d.lat, lng: d.lng },
            radius: d.radiusMeters,
            map: mapRef.current!,
            fillColor: '#C4956A',
            fillOpacity: 0.08,
            strokeColor: '#C4956A',
            strokeOpacity: 0.35,
            strokeWeight: 1,
            clickable: false,
          }),
      )
    return () => {
      radiusCirclesRef.current.forEach((c) => c.setMap(null))
      radiusCirclesRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filteredDistricts])

  // visibleHotels:只保留落在目前地圖可視範圍(bounds)內的飯店——
  // bounds 為 null(地圖剛掛載、還沒收到第一次 bounds_changed)時顯示
  // 全部,避免開頭一瞬間地圖/側欄清單是空的。用 useMemo 快取,避免每次
  // render 都建立新陣列參照——filter 的結果若每次都是新參照,下面依賴
  // visibleHotels 的 useEffect 會被判定成「每次都變了」而重複觸發,
  // 呼叫 onVisibleHotelsChange 進而讓外層 DesktopLayout 的 setGeoHotels
  // 觸發重新渲染、這個元件又跟著重新渲染、又產生新的 visibleHotels
  // 參照——形成不必要的重渲染迴圈,曾經導致飯店 marker 在畫面上閃爍/
  // 消失。bounds 是 google.maps.LatLngBounds 物件參照,只有真的呼叫
  // setBounds 時才會變(見 bounds_changed 監聽器),不會每次 render 換新,
  // 可以安全放進依賴陣列。
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

  // 每當 visibleHotels 內容變動,往上回報給 onVisibleHotelsChange——飯店
  // 側欄(GeoHotelSidebar)渲染在這個元件之外,只能靠這個 callback
  // 同步「目前地圖範圍內有哪些飯店」。
  useEffect(() => {
    onVisibleHotelsChange?.(visibleHotels)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleHotelsKey])

  // 飯店圖層:地圖就緒或 visibleHotels 變動時重畫,先清掉舊的。用一般
  // google.maps.Marker(非 OverlayView)——飯店只需要單點圖示,不像
  // 分區光暈需要複合 DOM 結構,SVG icon 直接用森綠色圓點區分於分區
  // 光暈的暖沙棕色系(見 MINIMAL_MAP_STYLE 的整體暖色調),讓使用者
  // 一眼分得出「這是分區重心」還是「這是可以住的地方」。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    hotelMarkersRef.current.forEach((m) => m.setMap(null))
    hotelMarkersRef.current = visibleHotels.map(
      (h) =>
        new google.maps.Marker({
          position: { lat: h.lat, lng: h.lng },
          map: mapRef.current!,
          title: h.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: '#5A8A6A',
            fillOpacity: 1,
            strokeColor: '#FDFCFA',
            strokeWeight: 1.5,
          },
        }),
    )
    return () => {
      hotelMarkersRef.current.forEach((m) => m.setMap(null))
      hotelMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleHotelsKey])

  // 換城市查詢後自動把視野移到新的分區範圍——地圖只在掛載時初始化一次
  // (見上面 [apiKey] 那個 effect),中心點只是「第一次載入時」的初始值,
  // 之後 districts 變動不會自動帶動地圖跟著移動,需要這裡額外用
  // LatLngBounds 涵蓋所有分區座標後 fitBounds,讓查詢新城市時能自動
  // 縮放平移到看得見所有分區的視野,不需要使用者自己手動拖找。
  //
  // 這裡刻意也把 hotels 座標一併納入 bounds——若只涵蓋分區座標,
  // fitBounds 算出的視野可能比飯店實際分佈範圍小(例如機場周邊的
  // 飯店離市中心分區較遠),縮小後的 bounds 會讓 visibleHotels(見下方
  // 依 bounds 篩選飯店的邏輯)把所有飯店都判定成「不在範圍內」而濾掉,
  // 造成地圖上一個飯店 marker 都不顯示的問題。
  useEffect(() => {
    if (!mapReady || !mapRef.current || (districts.length === 0 && hotels.length === 0)) return
    const bounds = new google.maps.LatLngBounds()
    districts.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }))
    hotels.forEach((h) => bounds.extend({ lat: h.lat, lng: h.lng }))
    mapRef.current.fitBounds(bounds, 64)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, districts, hotels])

  // 點擊飯店/地點側欄(GeoHotelSidebar,渲染在整個介面最外側)的項目時,
  // 把地圖移動到該座標。panTo 一律執行(平移);只有點擊「地點」帶了
  // level(飯店沒有 level 概念)、且目前 zoom 太小、看不到該分級的地點
  // 時,才額外把 zoom 拉到 minZoomForLevel(level)——用 setZoom 而非
  // fitBounds/zoomTo 之類的動畫方法,是因為只需要跳到剛好能顯示的
  // 最小尺度,不需要動畫過場;若目前 zoom 已經足夠(使用者已經拉近在
  // 瀏覽細節),不動 zoom、只平移,尊重使用者當下的瀏覽尺度。
  // panTarget 為 null(尚未點過、或元件卸載重置)時不做任何事。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !panTarget) return
    mapRef.current.panTo(panTarget)
    if (panTarget.level != null) {
      const needed = minZoomForLevel(panTarget.level)
      if (zoom < needed) {
        mapRef.current.setZoom(needed)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, panTarget])

  // farPairs:「距離較遠的項目間」連線示意——只在大範圍區域級尺度
  // (maxLevel<=2,對應 zoom<=12,見 maxLevelForZoom)才有意義,拉近到
  // 城市/在地級尺度後,分區彼此距離通常只有幾百公尺到幾公里,連線
  // 示意的「這幾塊大致隔多遠」已經沒有資訊量,故用 filteredDistricts
  // (而非全部 districts)當母體,兩層篩選都通過才畫:
  //  1. 目前縮放層級允許畫連線(maxLevel<=2)
  //  2. 該配對距離超過所有配對的平均值(只挑「較遠的」,不畫全部
  //     兩兩配對——分區一多,全連線會變成蜘蛛網,失去示意的意義)
  const showLines = maxLevel <= 2
  // farPairs 同樣用 useMemo 快取,理由同 filteredDistricts——避免每次
  // render 都建立新陣列參照,讓下方依賴它的 useEffect(延遲淡入計時器、
  // 畫連線)誤判成內容變了而重新觸發,造成已淡入的連線在地圖拖曳時
  // 反覆消失、重新等待、再淡入。
  const farPairs = useMemo(() => {
    if (!showLines || filteredDistricts.length < 2) return []
    const pairs: { a: GeoDistrict; b: GeoDistrict; km: number }[] = []
    for (let i = 0; i < filteredDistricts.length; i++) {
      for (let j = i + 1; j < filteredDistricts.length; j++) {
        const a = filteredDistricts[i]
        const b = filteredDistricts[j]
        pairs.push({ a, b, km: distanceKm(a, b) })
      }
    }
    const avgKm = pairs.reduce((sum, p) => sum + p.km, 0) / pairs.length
    return pairs.filter((p) => p.km > avgKm)
  }, [showLines, filteredDistricts])

  // 延遲淡入計時器:每次 farPairs 變動(換城市/縮放層級跨越 showLines
  // 門檻)重新起算停留時間。
  useEffect(() => {
    setLinesVisible(false)
    if (farPairs.length === 0) return
    const t = setTimeout(() => setLinesVisible(true), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farPairs])

  // 畫區塊間連線:只在 linesVisible 為 true 時畫,退場(換城市/清空)時清掉。
  // 用極淡描邊(對齊構想 6「極淡連線」定案),不畫箭頭、不做路網貼合,
  // 純粹是「這幾塊大致隔多遠」的示意直線。
  useEffect(() => {
    linesRef.current.forEach((l) => l.setMap(null))
    linesRef.current = []
    lineLabelsRef.current.forEach((l) => l.setMap(null))
    lineLabelsRef.current = []
    if (!linesVisible || !mapReady || !mapRef.current) return

    farPairs.forEach(({ a, b }) => {
      const line = new google.maps.Polyline({
        path: [
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng },
        ],
        strokeColor: '#C4956A',
        strokeOpacity: 0.28,
        strokeWeight: 1.5,
        map: mapRef.current,
      })
      linesRef.current.push(line)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesVisible, mapReady, farPairs])

  // 地圖容器(<div ref={containerRef}>)必須無條件渲染,不能像先前那樣
  // 依 err/districts 狀態切換成完全不同的 JSX 分支——地圖初始化的
  // useEffect 依賴是 [apiKey](地圖只需要建立一次),若元件第一次掛載時
  // districts 還是空陣列、走的是「空狀態」分支(不含這個 div),
  // containerRef.current 當下會是 null,初始化直接被跳過且不會重試
  // (因為 apiKey 沒變、effect 不會重新執行)。改成地圖容器永遠在,
  // 只在它上面疊加錯誤/空狀態提示,才能確保 containerRef 在 effect
  // 執行當下一定存在。
  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />
      {err && (
        <div className={styles.mapError}>
          <span>地圖載入失敗</span>
          <span className={styles.mapErrorDetail}>{err}</span>
        </div>
      )}
      {!err && districts.length === 0 && (
        <div className={styles.empty}>
          <span>還沒有城市資料——輸入目的地城市,先看看這座城市長什麼樣。</span>
        </div>
      )}
      {linesVisible && farPairs.length > 0 && (
        <div className={styles.distanceLegend}>
          {farPairs.map(({ a, b, km }) => (
            <span key={`${a.name}-${b.name}`} className={styles.distanceItem}>
              {a.name}—{b.name} 約 {km.toFixed(1)} 公里
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
