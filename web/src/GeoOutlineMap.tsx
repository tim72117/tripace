import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import type { ClientConfig, GeoDistrict, GeoHotel, GeoPlace, GeoPlaceDetails, GeoTripEntry } from './api'
import { fetchGeoDistrictsNearby, fetchGeoPlaceDetails, fetchGeoPlacesNearby } from './api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
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
  // 除錯用:暫時全開 poi,排查 poi.attraction 這條較具體的規則沒生效
  // 是規則寫法問題、還是這個地圖實例本來就不會畫任何 POI 圖標(例如
  // 誤用了 vector map/mapId,inline styles 陣列在 vector map 模式下會被
  // 忽略——若全開後仍然什麼都沒有,問題就出在後者,不是 poi.attraction
  // 這條規則本身)。排查完成後要改回只開 poi.attraction。
  { featureType: 'poi', stylers: [{ visibility: 'on' }] },
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
type DistrictOverlayInstance = google.maps.OverlayView & { setSelected: (selected: boolean) => void }
let DistrictOverlayClass:
  | (new (
      district: GeoDistrict,
      position: google.maps.LatLng,
      selected: boolean,
      onClick: (district: GeoDistrict) => void,
    ) => DistrictOverlayInstance)
  | null = null

function getDistrictOverlayClass() {
  if (DistrictOverlayClass) return DistrictOverlayClass

  class DistrictOverlay extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null
    private position: google.maps.LatLng
    private selected: boolean

    constructor(
      private district: GeoDistrict,
      position: google.maps.LatLng,
      selected: boolean,
      private onClick: (district: GeoDistrict) => void,
    ) {
      super()
      this.position = position
      this.selected = selected
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
      div.className = `geo-district-overlay${this.selected ? ' geo-district-overlay-selected' : ''}`
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

      // 只在圓形地標圖/佔位圓本身綁點擊(見 module.css 的
      // pointer-events: auto 覆寫),不是整個 overlay 容器——光暈與標籤
      // 文字仍不可點擊,維持「只召喚不強加」,只有具體可辨識的地標本身
      // 才是可互動元素。點下去回報這個分區資料,由外層決定怎麼放大
      // (見 GeoOutlineMap.tsx 的 onDistrictClick)。
      const clickTarget = div.querySelector('.geo-district-landmark-photo, .geo-district-landmark-placeholder')
      if (clickTarget) {
        clickTarget.addEventListener('click', () => this.onClick(this.district))
        // preventMapHitsAndGesturesFrom:讓地圖的拖曳/縮放手勢判斷邏輯
        // 知道「這個元素上的事件是給它自己的,不是給地圖拖曳用的」——
        // overlayMouseTarget pane 本身雖然會把原生 DOM 事件傳給子元素,
        // 但沒有這行的話,Maps 內部的拖曳偵測仍可能在滑鼠按下/放開之間
        // 判斷成一次(即使是原地不動的)拖曳手勢而吃掉 click,導致單純
        // 用 addEventListener('click', ...) 註冊的監聽器不會被觸發。
        // 這是 Google 官方文件建議讓自訂 OverlayView 內元素能可靠接收
        // 點擊的做法,addEventListener 本身要保留(不是被取代)。
        google.maps.OverlayView.preventMapHitsAndGesturesFrom(clickTarget as HTMLElement)
      }
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

    // setSelected:選取狀態變動時只切換 class,不整個重建 overlay(避免
    // DOM 節點重新掛載造成光暈/照片的 fadeIn 動畫重播、閃爍)。
    setSelected(selected: boolean) {
      this.selected = selected
      if (!this.div) return
      this.div.classList.toggle('geo-district-overlay-selected', selected)
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

// hotelMarkerIcon:飯店 marker 的圖示,依選取狀態回傳不同樣式——拆成
// 模組層級的純函式(而非寫在 render 裡的閉包),讓建立飯店 marker(全量
// 重畫)與切換選取樣式(setIcon)兩個 effect 共用同一份定義,不重複維護
// 兩份圖示邏輯。
//
// 選中態用完整 SVG data URI 圖示,畫「同色實心圓 + 白色間隙環 + 同色
// 外環」三層同心圓——google.maps.Marker 內建的 Symbol path API
// (SymbolPath.CIRCLE 那組)整個 icon 只能設一種 fillColor,疊多層 path
// 只能做出「透空環」(透出底下地圖),做不出中間隔一圈實心白色的靶心
// 效果;改用完整 SVG 字串當 icon.url,才能讓三層圓各自指定自己的填色。
// 未選中維持內建的 CIRCLE symbol(單色圓點已足夠,沒必要也走 SVG data URI)。
function hotelMarkerIcon(selected: boolean): google.maps.Icon | google.maps.Symbol {
  if (selected) {
    return {
      url:
        'data:image/svg+xml;charset=UTF-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
            '<circle cx="10" cy="10" r="9" fill="#5A8A6A"/>' +
            '<circle cx="10" cy="10" r="6.5" fill="#FDFCFA"/>' +
            '<circle cx="10" cy="10" r="4" fill="#5A8A6A"/>' +
            '</svg>',
        ),
      scaledSize: new google.maps.Size(20, 20),
      anchor: new google.maps.Point(10, 10),
    }
  }
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 5,
    fillColor: '#5A8A6A',
    fillOpacity: 1,
    strokeColor: '#FDFCFA',
    strokeWeight: 1.5,
  }
}

// placeMarkerIcon:附近推薦地點(見 handleDistrictClick 觸發的
// fetchGeoPlacesNearby)的 marker 圖示——用一顆小小的相機圖示(而非
// hotelMarkerIcon 那種純色圓點),讓使用者一眼認出這是「拍照打卡的
// 推薦景點」語意,跟分區光暈、飯店圓點的抽象色塊區隔開來。底色維持
// 靛藍(區分於分區的暖沙棕、飯店的森綠),相機圖案本身用白色線條,
// 尺寸刻意壓小(未選中 22px、選中 28px)——這是輔助辨識用的小圖標,
// 不搶過分區光暈與地標照片的視覺份量。選中態只放大 + 加一圈白色描邊
// 光暈(而非飯店那種三層同心圓靶心)——相機圖形本身已經有清楚的形狀
// 語意,不需要再疊靶心結構,加大加亮已足夠表達「這是選中的那個」。
function placeMarkerIcon(selected: boolean): google.maps.Icon {
  const size = selected ? 28 : 22
  const cameraSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
    (selected
      ? '<circle cx="12" cy="12" r="11.5" fill="#5A7A9E" stroke="#FDFCFA" stroke-width="2"/>'
      : '<circle cx="12" cy="12" r="11.5" fill="#5A7A9E"/>') +
    // 相機造型:機身矩形 + 鏡頭圓圈 + 頂部觀景窗小突起,線條走白色,
    // 尺寸與座標配合 24x24 viewBox 手繪比例,足夠在 22-28px 的小尺寸下
    // 仍清楚辨識出「這是一台相機」的輪廓。
    '<path d="M8.5 8.2h1.1l.7-1.1a.8.8 0 01.7-.4h2a.8.8 0 01.7.4l.7 1.1h1.1a1.6 1.6 0 011.6 1.6v5.4a1.6 1.6 0 01-1.6 1.6H8.5a1.6 1.6 0 01-1.6-1.6V9.8a1.6 1.6 0 011.6-1.6z" fill="none" stroke="#FDFCFA" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="12.6" r="2.1" fill="none" stroke="#FDFCFA" stroke-width="1.3"/>' +
    '</svg>'
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(cameraSvg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  }
}

// tripEntryMarkerIcon:行程本身已有座標的 entry(見 tripEntries prop)
// 的 marker 圖示——用全案主色 accent(暖橘,對齊 --color-accent)搭配
// 一枚小旗子造型,語意是「這裡已經排進行程」,跟分區光暈的暖沙棕、
// 飯店的森綠、推薦地點的靛藍相機都不同,一眼就能認出「這是我已經
// 決定要去的點」而非還在探索/推薦階段的候選。尺寸比其餘三種圖層
// 稍大一階(未選中 24px、選中 30px),因為這是這批圖層裡「已確定」
// 的內容,理當比還在探索的候選更顯眼一些。
function tripEntryMarkerIcon(selected: boolean): google.maps.Icon {
  const size = selected ? 30 : 24
  const flagSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
    (selected
      ? '<circle cx="12" cy="12" r="11.5" fill="#C4956A" stroke="#FDFCFA" stroke-width="2"/>'
      : '<circle cx="12" cy="12" r="11.5" fill="#C4956A"/>') +
    // 小旗子造型:一根直立旗桿 + 三角形旗面,線條走白色,座標配合
    // 24x24 viewBox,足夠在 24-30px 的小尺寸下清楚辨識。
    '<path d="M9 7v11" stroke="#FDFCFA" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M9 7.3l6.5 2.2-6.5 2.2z" fill="#FDFCFA"/>' +
    '</svg>'
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(flagSvg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  }
}

// sameDistrictsContent/sameHotelsContent:比對兩批查詢結果的內容是否
// 完全相同(依名稱+座標組成的字串逐筆比對,足以判斷「這就是同一批
// 資料」),供依可視範圍查詢完成時判斷要不要真的替換 state——見該處
// useEffect 的說明,避免地圖移動一下又移回來、或新舊查詢半徑重疊涵蓋
// 同一批資料時,內容明明相同卻無條件換新陣列參照,讓分區光暈/飯店
// marker 不必要地整批重建、閃爍。
function sameDistrictsContent(a: GeoDistrict[], b: GeoDistrict[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d, i) => d.name === b[i].name && d.lat === b[i].lat && d.lng === b[i].lng)
}
function sameHotelsContent(a: GeoHotel[], b: GeoHotel[]): boolean {
  if (a.length !== b.length) return false
  return a.every((h, i) => h.name === b[i].name && h.lat === b[i].lat && h.lng === b[i].lng)
}

export function GeoOutlineMap({
  cfg,
  initialCenter,
  tripEntries = [],
  onDistrictsChange,
  onVisibleHotelsChange,
  onPlacesNearby,
  onDistrictSelect,
  onHotelSelect,
  onPlaceSelect,
  onPoiSelect,
  panTarget,
  selectedKey,
}: {
  cfg: ClientConfig
  // initialCenter:地圖第一次建立時該用的中心點——undefined 代表呼叫端
  // 還在查詢「這個行程有沒有既有地點可以當初始中心」(見
  // GeoOutlineDemo.tsx 的 tripCenterPanTarget),此時地圖建立要等待,
  // 不能先用預設值建起來、查完才用 panTarget 再移動一次過去:那樣會
  // 白白查一次「移動前那個位置」的資料(見下方查詢 effect 的說明),
  // 移動後那次查詢又可能因為 panTarget 的 suppressQuery 被抑制,導致
  // 使用者進頁面時地圖上什麼資料都沒有,要等他自己動一下地圖才觸發
  // 查詢。null 代表已確定查無可用的初始中心(沒有行程、或行程沒有帶
  // 座標的既有地點),這時退回寫死的預設值。物件代表確定要用這組座標
  // 當初始中心,直接建圖在那裡,一步到位、只查一次正確範圍的資料。
  initialCenter?: { lat: number; lng: number } | null
  // tripEntries:目前行程本身已有座標的 entry(見 GeoOutlineDemo.tsx 查詢
  // tripCenter 時一併保留的完整清單)——這批點要顯示在地圖上(見下方
  // 畫 marker 的 effect),讓使用者看得到「這趟行程已經排進候選籃/日
  // 層架的地點跟這座城市其他景點的相對位置關係」,不只是拿來算初始
  // 定位而已。跟 hotels/places 不同,這批資料不是「以地圖範圍為準」
  // 查詢的結果,是行程本身固定的內容,換行程才會變。
  tripEntries?: GeoTripEntry[]
  // onDistrictsChange/onVisibleHotelsChange:每當地圖可視範圍(bounds)
  // 查詢有新結果時,回報目前地圖上實際顯示的分區/飯店清單——側欄
  // (GeoHotelSidebar,見 DesktopLayout.tsx)渲染在整個桌面版介面最
  // 外側、不是這個地圖元件的子節點,清單要跟著地圖範圍同步,只能靠
  // 這兩個 callback 往上回報,而不是側欄自己重新查一次(bounds 只有
  // 地圖實例本身知道)。景點與飯店都改成「以地圖可視範圍為準」查詢
  // (見下方 fetchNearby),不再依賴外部傳入完整清單後再篩選可視範圍。
  onDistrictsChange?: (districts: GeoDistrict[]) => void
  onVisibleHotelsChange?: (hotels: GeoHotel[]) => void
  // onPlacesNearby:點擊地圖上的地標圖示(見下方 handleDistrictClick)時,
  // 即時查詢該地標附近的推薦地點(不限類型,對齊 GET
  // /internal/geo/places/nearby),查詢完成後透過這個 callback 往上回報
  // ——理由同 onDistrictsChange/onVisibleHotelsChange,側欄
  // (GeoHotelSidebar 的「附近推薦」分頁)是分開掛載的 sibling。
  onPlacesNearby?: (places: GeoPlace[]) => void
  // onDistrictSelect/onHotelSelect/onPlaceSelect:使用者直接點擊地圖上的
  // 地標圖示/飯店 marker/推薦地點 marker 時觸發(而非透過側欄清單),把
  // 該項目往上回報——側欄(GeoHotelSidebar)要能同步標記選取狀態、切換
  // 到對應分頁並顯示該項目的介紹(見 DesktopLayout.tsx 的串接),但側欄
  // 跟這個地圖元件是分開掛載的 sibling,只能靠這三個 callback 往上回報,
  // 跟 onPlacesNearby 同一套「地圖是唯一知道使用者點了哪個 marker 的
  // 一方」的理由。district 的情形跟既有的 handleDistrictClick 共用同一個
  // 點擊入口(放大地圖+查附近推薦),故額外從那裡呼叫這個 callback,不是
  // 另外新增一個獨立的點擊處理路徑。
  onDistrictSelect?: (district: GeoDistrict) => void
  onHotelSelect?: (hotel: GeoHotel) => void
  onPlaceSelect?: (place: GeoPlace) => void
  // onPoiSelect:使用者點擊底圖上 Google 原生繪製的 POI 圖標(不是上面
  // 三個 callback 對應的自訂 marker/overlay)時觸發——地圖 click 事件
  // 本身只給得出一個 placeId,沒有名稱/地址/介紹等資料(見
  // IconMouseEvent 的說明),故沿用 handleDistrictClick 查附近推薦地點
  // 的既有慣例:在這個元件內部直接用 cfg 呼叫 fetchGeoPlaceDetails 查完
  // 整詳細資訊,才把查好的結果往上回報,而不是只傳一個 ID 讓外層自己
  // 決定何時查詢——這個元件本來就持有 cfg,沒有理由把查詢責任推給不見得
  // 拿得到 cfg 時機的呼叫端。
  onPoiSelect?: (details: GeoPlaceDetails) => void
  // panTarget:使用者在搜尋框查到城市座標、或在 GeoHotelSidebar 點擊某個
  // 飯店/地點項目時要移動地圖到的座標——每次(即使連續觸發同一個目標)
  // DesktopLayout/GeoOutlineDemo 都會建立新的物件參照,故這裡直接把整個
  // 物件放進 useEffect 依賴陣列即可正確偵測到「這是一次新的移動請求」,
  // 不需要額外的序號/時間戳欄位。level 只有點擊「地點」(GeoDistrict)
  // 才會帶,飯店(GeoHotel)與城市搜尋定位都沒有 level 概念,固定不帶——
  // 見下方 useEffect,只有帶 level 時才會額外呼叫 setZoom 把縮放層級拉到
  // 能顯示該地點的最小尺度(minZoomForLevel),純平移(panTo)本身不會
  // 改變 zoom,若目前 zoom 太小、該地點根本沒被畫出來(見 filteredDistricts
  // 的篩選),不強制調整 zoom 只會移動到一個看起來空空如也的地圖。
  //
  // suppressQuery:這次移動完成後,平移動畫結束觸發的 idle 事件要不要
  // 跳過「依可視範圍查詢景點/飯店」——true 用於「使用者只是想對齊看清楚
  // /選中一個已知項目」的移動(側欄點擊、行程初始定位),資料範圍通常
  // 沒有實質改變,不該清空重畫所有點;false(或不帶,預設當 false)用於
  // 「使用者明確想換一個地方看」的移動(搜尋城市),必須查詢新範圍的
  // 資料,否則會出現「移動地圖後沒有取得資料,要再手動縮放才觸發查詢」
  // 的問題——這正是由呼叫端決定該不該抑制查詢,而不是這裡憑空猜測,
  // 因為只有呼叫端知道這次移動背後的使用者意圖是什麼。
  panTarget?: { lat: number; lng: number; level?: number; suppressQuery?: boolean } | null
  // selectedKey:目前被選中的飯店/地點識別鍵(見 GeoHotelSidebar.tsx 的
  // geoItemKey)——由 DesktopLayout.tsx 中介,驅動下方地標/飯店圖示畫出
  // 對應的選取樣式(外圈 accent 描邊 + 放大),與側欄的選取標記同步。
  selectedKey?: GeoSelectedKey
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<DistrictOverlayInstance[]>([])
  const hotelMarkersRef = useRef<google.maps.Marker[]>([])
  const placeMarkersRef = useRef<google.maps.Marker[]>([])
  const tripEntryMarkersRef = useRef<google.maps.Marker[]>([])
  const radiusCirclesRef = useRef<google.maps.Circle[]>([])
  const linesRef = useRef<google.maps.Polyline[]>([])
  const lineLabelsRef = useRef<google.maps.OverlayView[]>([])
  // onPoiSelectRef:建立地圖的 effect 只在掛載時執行一次(依賴陣列見
  // 下方 [apiKey, initialCenter]),裡面註冊的 click listener 若直接閉包
  // 捕捉 onPoiSelect,呼叫端(DesktopLayout.tsx)每次重渲染傳入新的內聯
  // 函式參照時不會被那個 effect 感知到、永遠呼叫到掛載當下那一份舊值。
  // 用 ref 存最新版本,click listener 內透過 .current 讀取,不需要把
  // onPoiSelect 加進建圖 effect 的依賴陣列(那樣反而會導致地圖重建)。
  const onPoiSelectRef = useRef(onPoiSelect)
  onPoiSelectRef.current = onPoiSelect
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
  // districts/hotels:改成這個元件內部管理(不再是外部傳入的完整清單再
  // 篩選),由下方「依可視範圍查詢」的 effect 寫入——景點與飯店都是
  // 「以地圖可視範圍為準」查詢的結果,查詢責任收在地圖元件自己身上
  // (只有它知道當下的 bounds),搜尋框(GeoOutlineDemo.tsx)只負責把
  // 座標查出來、透過 panTarget 移動地圖,不再自己查一份完整清單。
  const [districts, setDistricts] = useState<GeoDistrict[]>([])
  const [hotels, setHotels] = useState<GeoHotel[]>([])
  // places:點擊地標(handleDistrictClick)時查到的附近推薦地點,跟
  // districts/hotels 不同的是這不是「依可視範圍持續查詢」的常駐圖層,
  // 是「點了某個地標才會有內容」的一次性查詢結果——換一個地標點擊會
  // 直接覆蓋掉整批(不累加),理由同 onPlacesNearby 回報邏輯本身。
  const [places, setPlaces] = useState<GeoPlace[]>([])
  // queryTrigger:每次 idle 事件遞增一次,驅動下方「依可視範圍查詢」的
  // effect 重新執行——用遞增計數器而非直接把查詢邏輯寫進 idle callback
  // 內,是為了讓查詢邏輯留在 useEffect 裡統一處理 cancelled/競態問題
  // (見下方該 effect 的說明),不在事件callback 裡直接發請求。
  const [queryTrigger, setQueryTrigger] = useState(0)
  // suppressNextIdleQueryRef:panTarget 觸發的 panTo(側欄點擊、搜尋框
  // geocode)不該讓接下來那次 idle 觸發重新查詢——使用者只是想對齊看清楚
  // /選中一個已知項目,不是主動探索新範圍,查回來的資料通常跟現有的一樣,
  // 卻會讓所有分區光暈與飯店 marker 清空重畫,造成「點一下所有點都閃一下」
  // 的視覺問題(見下方處理 panTarget 的 useEffect 如何設這個旗標)。用
  // ref 而非 state,因為它只是單次事件間的旗標,不需要驅動任何渲染。
  const suppressNextIdleQueryRef = useRef(false)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY(見 web/.env.development.local)')
      return
    }
    if (!containerRef.current) return
    // mapRef.current 已存在代表地圖已經建立過——這個 effect 依賴陣列
    // 包含 initialCenter(見下方),當它從 undefined 解析成確定的值(或
    // null)時會重新執行一次,這裡要擋掉重複建圖,只在第一次(尚未建立
    // 過)真正呼叫 new Map()。
    if (mapRef.current) return
    // initialCenter 為 undefined 代表呼叫端還在查「這個行程有沒有既有
    // 地點可以當初始中心」,地圖建立要等待——見這個 prop 的完整說明。
    if (initialCenter === undefined) return
    let cancelled = false

    ensureOptionsSet(apiKey)
    importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return
        // 初始中心點:優先用 initialCenter(行程既有地點的中心,若已確定
        // 有值),查無可用資料(initialCenter 為 null)才退回寫死的東京
        // 預設起點——一步到位直接建圖在正確位置,不再需要「先建圖在
        // 東京、查一次沒用的資料、再 panTo 移動過去」這道多餘手續(那樣
        // 移動後那次查詢還可能因為 panTarget 的 suppressQuery 被抑制,
        // 導致使用者進頁面時地圖上什麼資料都沒有)。
        mapRef.current = new Map(containerRef.current, {
          center: initialCenter ?? { lat: 35.0, lng: 135.76 },
          zoom: 12,
          styles: MINIMAL_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        // zoom_changed 監聽器:即時反映使用者拖曳滾輪/點擊縮放控制項
        // 造成的縮放層級變化,驅動下方 filteredDistricts 重新計算。
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
        // idle 監聽器:拖曳/縮放動畫「結束」時才觸發一次(不像
        // bounds_changed 拖曳過程中會連續觸發),驅動下方「依可視範圍
        // 查詢景點/飯店」的 effect——用獨立的 queryTrigger state(而非
        // 沿用 bounds state)避免拖曳過程中 bounds_changed 的高頻更新
        // 誤觸發查詢,查詢只該在使用者放開滑鼠、動畫結束後發生一次。
        //
        // suppressNextIdleQueryRef 為 true 時跳過這次觸發並消耗掉旗標:
        // 這代表這次 idle 是 panTarget 的 panTo 造成的(側欄點擊/搜尋),
        // 不是使用者主動拖曳探索新範圍,不該重新查詢、清空重畫所有點。
        mapRef.current.addListener('idle', () => {
          if (suppressNextIdleQueryRef.current) {
            suppressNextIdleQueryRef.current = false
            return
          }
          setQueryTrigger((n) => n + 1)
        })
        // click 監聽器:攔截點擊底圖上 Google 原生繪製的 POI 圖標(如
        // 餐廳、景點,見上方 MINIMAL_MAP_STYLE 開啟的 poi.attraction)。
        // 只有點到 POI 圖標時,event 才會多出 placeId 欄位(型別是
        // google.maps.IconMouseEvent,MapMouseEvent 的擴充)——點地圖空白
        // 處的一般點擊沒有這個欄位,用它來分辨這次點擊是不是點到 POI。
        // event.stop() 阻止 Google 預設彈出的小資訊卡(InfoWindow 樣式),
        // 讓使用者改看我們自己的 GeoInfoPanel(理由見 onPoiSelect 的
        // 說明)。查詢失敗(找不到該地點、額度用盡等)不特別處理錯誤
        // 提示,直接不觸發 onPoiSelect——維持地圖仍可正常瀏覽,不彈錯誤
        // 訊息打斷使用者,理由同 handleDistrictClick 查附近推薦失敗時的
        // 處理方式。
        mapRef.current.addListener('click', (event: google.maps.IconMouseEvent) => {
          if (!event.placeId) return
          event.stop()
          fetchGeoPlaceDetails(cfg, event.placeId)
            .then((details) => onPoiSelectRef.current?.(details))
            .catch(() => {})
        })
        setMapReady(true)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, initialCenter])

  // 依地圖可視範圍查詢景點/飯店:每次 idle(拖曳/縮放動畫結束)觸發
  // queryTrigger 遞增時,以地圖目前中心座標+半徑呼叫
  // fetchGeoDistrictsNearby(GET /internal/geo/districts/nearby),取代
  // 先前「先查城市名拿一整批資料、之後都不再變動」的模式——景點與飯店
  // 都變成跟著地圖移動即時更新。掛載後第一次(mapReady 剛變 true、
  // queryTrigger 還是 0)也會執行一次,查詢初始中心點(東京)周邊的資料,
  // 讓使用者不用任何互動就能看到內容,呼應構想 6「不待召喚即先給出
  // 地理輪廓」的精神。
  //
  // 半徑依 zoom 反推(zoom 越小代表可視範圍越大,需要的查詢半徑也越大)
  // ——沒有查詢 Google Maps 官方公式反推可視範圍公里數的必要,這裡只是
  // 抓一個「大致夠涵蓋畫面」的粗略估計,查詢範圍比實際可視範圍稍大一些
  // 沒有壞處(下方 filteredDistricts/visibleHotels 還會再依實際 bounds
  // 精確篩選一次,詳見對應的說明)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const center = mapRef.current.getCenter()
    if (!center) return
    let cancelled = false
    const radiusMeters = Math.min(50000, 20000 * Math.pow(2, 12 - zoom))
    fetchGeoDistrictsNearby(cfg, center.lat(), center.lng(), radiusMeters)
      .then((result) => {
        if (cancelled) return
        // 用函式式更新比對內容摘要(名稱+座標組成的字串),完全相同就回傳
        // 舊陣列參照、不觸發 re-render——地圖移動一下又移回來、或新舊
        // 查詢半徑重疊涵蓋同一批資料時很常見,若每次查詢完成都無條件
        // 換新陣列參照,即使內容一模一樣,依賴 districts/hotels 的
        // filteredDistricts/visibleHotels(見下方兩處 useMemo)也會被
        // 判定成「變了」,讓分區光暈與飯店 marker 整批不必要地重建、
        // 閃爍(理由同這兩處 useMemo 已有的說明)。
        setDistricts((prev) => (sameDistrictsContent(prev, result.districts) ? prev : result.districts))
        setHotels((prev) => (sameHotelsContent(prev, result.hotels) ? prev : result.hotels))
        onDistrictsChange?.(result.districts)
      })
      .catch(() => {
        // 查詢失敗(網路錯誤/伺服器錯誤)不視為致命錯誤——地圖本身仍可
        // 正常瀏覽,只是這次移動沒能刷新資料,維持上一次查到的內容即可,
        // 不清空、不彈錯誤訊息打斷瀏覽。
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, queryTrigger])

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

  // 點擊地標圖示(圓形照片/佔位圓,見 DistrictOverlay.onAdd 綁定的
  // click)時,把地圖放大到該分區對應的範圍——優先用 radiusMeters(手動
  // 整理的觀光慣稱分區才有,見 GeoDistrict.radiusMeters 的說明)算出剛好
  // 包住該範圍的 bounds 後 fitBounds;沒有 radiusMeters 的單點地標(如
  // 純座標地標,無實際範圍可言)則退回既有的 minZoomForLevel 邏輯,跟
  // 側欄點擊「地點」時(見下方處理 panTarget 的 useEffect)的放大幅度
  // 一致——這裡跟那裡是同一件事的兩種觸發入口,合理共用同一套判斷。
  // 這次移動也視為「對齊看清楚一個已知項目」,故一併設
  // suppressNextIdleQueryRef,不觸發不必要的重新查詢。
  //
  // 同時即時查詢該地標附近的推薦地點(GET /internal/geo/places/nearby,
  // 不限類型,對齊 internal/wanttools/recommend_nearby.go 那個 LLM 工具
  // 的行為)——這是使用者明確點擊觸發的動作,查詢半徑優先用該分區的
  // radiusMeters(範圍剛好對應查詢半徑),單點地標沒有範圍可言,退回
  // 1500m(同 recommend_nearby 工具的預設半徑)。查詢結果寫進 places
  // state(驅動下方畫 marker 的 effect,讓這批推薦地點也顯示在地圖上,
  // 不只是列在側欄),同時透過 onPlacesNearby 往上回報給側欄——不受
  // 地圖移動/放大動畫影響(兩者是獨立動作,不需要等 idle 才觸發)。
  const handleDistrictClick = useCallback((d: GeoDistrict) => {
    if (!mapRef.current) return
    onDistrictSelect?.(d)
    suppressNextIdleQueryRef.current = true
    const radiusForPlaces = d.radiusMeters && d.radiusMeters > 0 ? d.radiusMeters : 1500
    fetchGeoPlacesNearby(cfg, d.lat, d.lng, radiusForPlaces)
      .then((result) => {
        setPlaces(result.places)
        onPlacesNearby?.(result.places)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——地圖仍正常放大,只是這次沒能刷新
        // 附近推薦清單,維持上一次查到的內容即可,不彈錯誤訊息打斷瀏覽。
      })
    if (d.radiusMeters && d.radiusMeters > 0) {
      const center = { lat: d.lat, lng: d.lng }
      const circle = new google.maps.Circle({ center, radius: d.radiusMeters })
      const bounds = circle.getBounds()
      if (bounds) {
        mapRef.current.fitBounds(bounds, 48)
        return
      }
    }
    mapRef.current.panTo({ lat: d.lat, lng: d.lng })
    if (d.level != null) {
      const needed = minZoomForLevel(d.level)
      if (mapRef.current.getZoom() != null && mapRef.current.getZoom()! < needed) {
        mapRef.current.setZoom(needed)
      }
    } else {
      // 沒有分級資訊的即時查詢結果(見 GeoDistrict.level 的說明),沒有
      // minZoomForLevel 可用,退回一個明顯比一般瀏覽尺度更近的固定
      // zoom,確保點下去有感、看得出範圍被放大了。
      mapRef.current.setZoom(16)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, onDistrictSelect])

  // 畫分區光暈疊層:地圖就緒或 filteredDistricts 變動時重畫,先清掉舊的。
  // selected 初始值直接讀當下的 selectedKey(重畫當下若剛好是選中項目,
  // 一開始就該是選中樣式,不必等下面那個獨立的 setSelected effect 補上)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    overlaysRef.current.forEach((o) => o.setMap(null))
    const OverlayClass = getDistrictOverlayClass()
    overlaysRef.current = filteredDistricts.map((d) => {
      const overlay = new OverlayClass(
        d,
        new google.maps.LatLng(d.lat, d.lng),
        selectedKey === geoItemKey('district', d),
        handleDistrictClick,
      )
      overlay.setMap(mapRef.current!)
      return overlay
    })
    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null))
      overlaysRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filteredDistricts])

  // 同步選取狀態:只切換既有 overlay 的 class,不重建 DOM(重建會讓光暈/
  // 照片的 fadeIn 動畫重播,側欄點擊選取時地圖上的地標會不必要地閃一下)。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredDistricts[i]
      if (d) o.setSelected(selectedKey === geoItemKey('district', d))
    })
  }, [selectedKey, filteredDistricts])

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

  // 飯店圖層:地圖就緒或 visibleHotels(範圍/清單本身)變動時重畫,先清掉
  // 舊的。用一般 google.maps.Marker(非 OverlayView)——飯店只需要單點
  // 圖示,不像分區光暈需要複合 DOM 結構,圖示用森綠色圓點區分於分區
  // 光暈的暖沙棕色系(見 MINIMAL_MAP_STYLE 的整體暖色調),讓使用者
  // 一眼分得出「這是分區重心」還是「這是可以住的地方」。
  //
  // 這個 effect 刻意不依賴 selectedKey——選取狀態變動時只切換對應那顆
  // marker 的 icon(見下方獨立的 effect,呼叫 setIcon()),不重建整批
  // marker。理由同下方那個 effect 的說明:選中/取消選中只是側欄點擊,
  // 不代表地圖範圍或飯店清單本身有變化,若整批重畫,畫面上其他沒被
  // 點的飯店 marker 也會跟著經歷一次 setMap(null)→重新 new Marker() 的
  // 閃爍,是不必要的。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    hotelMarkersRef.current.forEach((m) => m.setMap(null))
    hotelMarkersRef.current = visibleHotels.map((h) => {
      const marker = new google.maps.Marker({
        position: { lat: h.lat, lng: h.lng },
        map: mapRef.current!,
        title: h.name,
        icon: hotelMarkerIcon(false),
      })
      // 點擊飯店 marker 往上回報選取(見 onHotelSelect 的說明),讓側欄
      // 能同步標記選取狀態並切到「飯店」分頁顯示介紹——跟地標圖示不同,
      // 飯店 marker 本身沒有需要額外放大範圍/查附近推薦的行為,單純
      // 回報選取即可。
      marker.addListener('click', () => onHotelSelect?.(h))
      return marker
    })
    return () => {
      hotelMarkersRef.current.forEach((m) => m.setMap(null))
      hotelMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, visibleHotelsKey, onHotelSelect])

  // 同步飯店 marker 的選取樣式:只對「選取狀態真的改變」的那顆(至多
  // 兩顆——舊選中的那顆要退回未選中、新選中的那顆要套上選中樣式)呼叫
  // setIcon(),其餘 marker 完全不動,不重建、不閃爍。visibleHotels 與
  // hotelMarkersRef.current 依 map() 建立時保證同順序,故直接用陣列
  // 索引配對,不需要另外存一份 marker↔hotel 的對照表。
  useEffect(() => {
    visibleHotels.forEach((h, i) => {
      const marker = hotelMarkersRef.current[i]
      if (!marker) return
      const selected = selectedKey === geoItemKey('hotel', h)
      marker.setIcon(hotelMarkerIcon(selected))
      marker.setZIndex(selected ? 999 : undefined)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, visibleHotelsKey])

  // placesKey:places 的內容摘要,供下面兩個 effect 依賴——理由同
  // visibleHotelsKey。
  const placesKey = places.map((p) => `${p.name}|${p.lat}|${p.lng}`).join(',')

  // 附近推薦地點圖層:points 變動時重畫,先清掉舊的。這批地點不像
  // districts/hotels 依可視範圍(bounds)篩選——它們是點擊某個地標才
  // 觸發的一次性查詢結果,查詢半徑本來就對應該地標的範圍,使用者點擊後
  // 地圖也會同步 fitBounds/放大到那個範圍(見 handleDistrictClick),
  // 這批地點理應都落在可視範圍內,不需要再疊一層篩選判斷增加複雜度。
  // 圖示用 placeMarkerIcon(靛藍色系,見該函式的說明),讓使用者一眼
  // 分得出這是「點擊地標查出來的推薦」而非常駐的分區/飯店資料。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    placeMarkersRef.current.forEach((m) => m.setMap(null))
    placeMarkersRef.current = places.map((p) => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current!,
        title: p.name,
        icon: placeMarkerIcon(false),
      })
      // 點擊推薦地點 marker 往上回報選取,理由同飯店 marker 的 click
      // listener——單純回報選取,不觸發額外的地圖放大/查詢行為。
      marker.addListener('click', () => onPlaceSelect?.(p))
      return marker
    })
    return () => {
      placeMarkersRef.current.forEach((m) => m.setMap(null))
      placeMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, placesKey, onPlaceSelect])

  // 同步附近推薦地點 marker 的選取樣式,理由與做法同上方飯店那個
  // 獨立的 setIcon effect。
  useEffect(() => {
    places.forEach((p, i) => {
      const marker = placeMarkersRef.current[i]
      if (!marker) return
      const selected = selectedKey === geoItemKey('place', p)
      marker.setIcon(placeMarkerIcon(selected))
      marker.setZIndex(selected ? 999 : undefined)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, placesKey])

  // tripEntriesKey:tripEntries 的內容摘要,供下面兩個 effect 依賴——
  // 理由同 visibleHotelsKey/placesKey。
  const tripEntriesKey = tripEntries.map((e) => `${e.name}|${e.lat}|${e.lng}`).join(',')

  // 行程本身已有座標的 entry 圖層:tripEntries 變動(換行程)時重畫,
  // 先清掉舊的——這批點不受地圖可視範圍篩選(理由同附近推薦地點:
  // 是行程固定的內容,不是依範圍查詢的圖層,全部顯示讓使用者看到完整
  // 的行程分布)。圖示用 tripEntryMarkerIcon(暖橘旗子,見該函式的
  // 說明),一眼分得出「這是已經排進行程的點」。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    tripEntryMarkersRef.current.forEach((m) => m.setMap(null))
    tripEntryMarkersRef.current = tripEntries.map(
      (e) =>
        new google.maps.Marker({
          position: { lat: e.lat, lng: e.lng },
          map: mapRef.current!,
          title: e.name,
          icon: tripEntryMarkerIcon(false),
        }),
    )
    return () => {
      tripEntryMarkersRef.current.forEach((m) => m.setMap(null))
      tripEntryMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, tripEntriesKey])

  // 同步行程 entry marker 的選取樣式,理由與做法同上方飯店/推薦地點
  // 那兩個獨立的 setIcon effect。
  useEffect(() => {
    tripEntries.forEach((e, i) => {
      const marker = tripEntryMarkersRef.current[i]
      if (!marker) return
      const selected = selectedKey === geoItemKey('entry', e)
      marker.setIcon(tripEntryMarkerIcon(selected))
      marker.setZIndex(selected ? 999 : undefined)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, tripEntriesKey])

  // 點擊飯店/地點側欄(GeoHotelSidebar,渲染在整個介面最外側)的項目時,
  // 把地圖移動到該座標。panTo 一律執行(平移);只有點擊「地點」帶了
  // level(飯店沒有 level 概念)、且目前 zoom 太小、看不到該分級的地點
  // 時,才額外把 zoom 拉到 minZoomForLevel(level)——用 setZoom 而非
  // fitBounds/zoomTo 之類的動畫方法,是因為只需要跳到剛好能顯示的
  // 最小尺度,不需要動畫過場;若目前 zoom 已經足夠(使用者已經拉近在
  // 瀏覽細節),不動 zoom、只平移,尊重使用者當下的瀏覽尺度。
  // panTarget 為 null(尚未點過、或元件卸載重置)時不做任何事。
  //
  // 觸發 panTo 前依 panTarget.suppressQuery 決定要不要設
  // suppressNextIdleQueryRef=true,讓平移動畫結束後的那次 idle 跳過重新
  // 查詢(見上方 idle 監聽器與 suppressQuery 欄位的說明)——這裡是唯一
  // 主動呼叫 panTo 的地方,由這裡負責設旗標最直接,不需要在 idle callback
  // 那端猜測「這次移動是不是由 panTarget 造成的」。
  //
  // 依賴陣列用整個 panTarget 物件參照(而非拆開比較 lat/lng)判斷「是否
  // 為新的移動請求」,前提是呼叫端(GeoOutlineDemo.tsx 的
  // effectivePanTarget)已用 useMemo 依實際座標值快取、確保座標沒變時
  // 不會產生新物件參照——否則任何造成這個元件重渲染的動作(例如查詢
  // 完成觸發 onDistrictsChange 連鎖讓上層重渲染)都會被誤判成新的移動
  // 請求,重新 panTo,曾經因此形成「渲染→panTo→idle→查詢→觸發渲染」的
  // 無限迴圈,即使地圖靜止不動也會持續發送查詢請求。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !panTarget) return
    if (panTarget.suppressQuery) {
      suppressNextIdleQueryRef.current = true
    }
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
      {/* districts.length === 0(目前地圖範圍內查無任何地標)刻意不顯示
          任何遮罩提示——在「依可視範圍查詢」的架構下(見上方查詢
          useEffect 的說明),查無資料是地圖拖曳/縮放到還沒建檔區域時的
          正常情況,不是搜尋失敗,不該用一片實色背景蓋住整個地圖。地圖
          本身(含飯店 marker,若該範圍剛好有查到)照常顯示,使用者只是
          單純看不到任何分區光暈而已,不需要額外文字說明。 */}
      {err && (
        <div className={styles.mapError}>
          <span>地圖載入失敗</span>
          <span className={styles.mapErrorDetail}>{err}</span>
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
