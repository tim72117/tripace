import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClientConfig, GeoAttraction } from '../api'
import { fetchPublicGeoAttractions, fetchPublicGeoPlaceDetails } from '../api'
import { NativeMapBase, type MapHandle } from '../geo-planning/NativeMapBase'
import { useAttractionOverlays } from '../geo-planning/useAttractionOverlays'
import { AttractionInfoPanel } from '../geo-planning/AttractionInfoPanel'
import { GeoOutlinePhoneInfoSheet } from '../geo-planning/GeoOutlinePhoneInfoSheet'
import { PlacePanel } from '../geo-planning/PlacePanel'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { stackedInfoCardRightPx } from '../geo-planning/DesktopInfoCard'
import { useThemeAttractionSelection } from '../geo-planning/useThemeAttractionSelection'
import { curatedCategoryOf } from '../geo-planning/geoCuratedCategoryStub'
import { computeNearbyAttractions } from '../geo-planning/geoNearbyAttractions'
import { ThemeToggle } from '../user/ThemeToggle'
import type { Theme } from '../theme'
import { BASE_URL } from '../AppCommon'
import { trackEvent } from '../analytics'
import styles from './InteractiveExploreMap.module.css'

// GUEST_CFG:這個頁面是登入前的公開展示頁,沒有使用者自己的 JWT
// ——token 傳 null(走訪客,見 api.ts ClientConfig 的完整說明)。baseURL
// 沿用 AppCommon.tsx 的 BASE_URL(建置時 VITE_API_BASE,或退回目前頁面
// origin)——這個頁面會真的發 API 請求(見下方 fetchPublicGeoAttractions/
// AttractionInfoPanel 的 usePublicPlaceDetails),空字串會被 request()
// 解讀成相對路徑,在本機開發(Vite dev server 跟後端 API server 通常
// 不同 port)下打不到正確的後端,必須改用正確的 baseURL。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// LANDING_MAP_ID:這個展示頁專用的 Cloud Style Map ID——正式規劃功能
// (ExploreMap.tsx/GeoOutlinePhoneView.tsx 等)沒有傳 mapId 給
// NativeMapBase,沿用預設的 VITE_GOOGLE_MAPS_MAP_ID;這個展示頁改用
// VITE_GOOGLE_MAPS_LANDING_MAP_ID,對應不顯示餐廳/旅宿 POI 的樣式(見
// docs/map-style/*-no-food-lodging.json 的樣式快照,原理是 pointOfInterest
// 父層整批關閉標籤、只重新開啟 landmark/recreation/entertainment 三個
// 子分類,不逐一命中餐廳/旅宿各自的 id)——這個城市介紹頁只想呈現地標/
// 景點,不需要 Google 原生底圖的商家圖標干擾視覺焦點。環境變數未設定
// 時 LANDING_MAP_ID 是 undefined,NativeMapBase 的 mapId prop 會自動
// 退回 VITE_GOOGLE_MAPS_MAP_ID(見該檔案 mapId 的說明),不會讓地圖建立
// 失敗。
const LANDING_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_LANDING_MAP_ID as string | undefined

// FALLBACK_CENTER:資料尚未從 API 載入完成前的暫定地圖中心——只在第一次
// 渲染、attractions 還是空陣列時短暫使用,資料載入完成後 INITIAL_CENTER
// 會改用真正查到的主題點座標重新計算(見下方 useEffect)。刻意留一個粗略
// 常數而非留 undefined,是因為 NativeMapBase 在 center 為 undefined 時
// 不會建圖(見該檔案的說明),但這個展示頁在資料真正載入前仍需要顯示
// 地圖容器本身(讀取中的空地圖背景),不能整個空白。這個座標對齊原本
// 唯一呼叫端(京都清水寺/八坂神社)的粗略中點——city prop 改成其他城市
// (例如九份)時仍會短暫套用這個京都附近的預設值,但只在資料載入完成前
// 那一瞬間可見,實測影響可忽略,不特地為每個城市各自維護一個 fallback
// 中心。
const FALLBACK_CENTER = { lat: 35.0007, lng: 135.7798 }

// COMBINED_RESTRICT_RADIUS_KM:以兩個主題點的中點為圓心,東西南北四邊
// 各 2km 的正方形範圍——理由同先前寫死版本的說明(兩主題點實際距離約
// 1148m,各自離中點約 574m,落在這個範圍內;原本半徑 1km,使用者要求
// 改為 2km,讓可拖曳範圍更大)。座標改成資料庫查來的動態值(見
// computeRestrictBounds),不再是模組層級的寫死常數。
const COMBINED_RESTRICT_RADIUS_KM = 2
const KM_PER_DEG_LAT = 111

// computeRestrictBounds:換算公式同 kiyomizuDemoFixture.ts/
// yasakaDemoFixture.ts 原本 RESTRICT_BOUNDS 的簡化經緯度換算(緯度 1 度
// 約 111km,經度在這個緯度約 111km*cos(緯度)),精度對這種城市尺度的
// 固定展示範圍已經足夠。
function computeRestrictBounds(center: { lat: number; lng: number }): google.maps.LatLngBoundsLiteral {
  const kmPerDegLng = 111 * Math.cos((center.lat * Math.PI) / 180)
  return {
    north: center.lat + COMBINED_RESTRICT_RADIUS_KM / KM_PER_DEG_LAT,
    south: center.lat - COMBINED_RESTRICT_RADIUS_KM / KM_PER_DEG_LAT,
    east: center.lng + COMBINED_RESTRICT_RADIUS_KM / kmPerDegLng,
    west: center.lng - COMBINED_RESTRICT_RADIUS_KM / kmPerDegLng,
  }
}

// zoomToFitBounds:剛好能框住傳入範圍的縮放層級——NativeMapBase 的
// restrictBounds 刻意設 strictBounds:false(見該檔案說明,範圍限制不鎖
// 縮放),縮放下限因此要另外算好傳入 minZoom,否則使用者可以縮到看見
// 範圍外一大片空白。用 Web Mercator 標準公式(Google Maps 官方文件記載:
// 256px 圖磚在 zoom 0 時橫跨整個地球經度,每加一級 zoom 寬度乘以 2)
// 反推「這個經緯度跨距,配合 .stage 容器實際像素寬高,剛好能完整顯示的
// 最大 zoom」——取經度/緯度兩個方向算出來的較小值,確保兩個方向都不會
// 超出容器,無條件捨去避免無條件進位導致邊界超出一點點誤差就被裁切。
// 容器尺寸抓 InteractiveExploreMap.module.css 的 .stage 目前固定寫死的 680px
// 高、寬度用該檔案 max-width 1920px 估算的可視寬度上限概算,不做即時
// 量測。
const MAP_WIDTH_PX_ESTIMATE = 960
const MAP_HEIGHT_PX_ESTIMATE = 680
const TILE_SIZE_PX = 256
function zoomToFitBounds(
  bounds: google.maps.LatLngBoundsLiteral,
  widthPx: number,
  heightPx: number,
): number {
  const lngSpan = bounds.east - bounds.west
  const latSpan = bounds.north - bounds.south
  const zoomForLng = Math.log2((widthPx / TILE_SIZE_PX) * (360 / lngSpan))
  const zoomForLat = Math.log2((heightPx / TILE_SIZE_PX) * (180 / latSpan))
  return Math.floor(Math.min(zoomForLng, zoomForLat))
}

// INITIAL_ZOOM:寫死的固定數字,不再依 COMBINED_RESTRICT_BOUNDS 動態計算
// ——先前用「MIN_ZOOM + 1」表示,結果範圍(COMBINED_RESTRICT_RADIUS_KM)
// 一改動,初始縮放跟著意外連動變化,使用者無法只調整其中一個。與範圍
// 大小互相獨立,各自可以單獨調整,不會再互相牽動。
const INITIAL_ZOOM = 15

// InteractiveExploreMap:landing page(登入前)的試做展示頁——非滿版地圖,
// 共用登入後畫面在用的同一批元件(ExploreMap/AttractionInfoPanel),不是
// 重新刻一份簡化版——這樣之後正式功能有任何視覺/互動調整,這個展示頁
// 會自動跟著更新,不需要另外維護一份重複邏輯。原檔名/元件名沿用
// 「KiyomizuDemoPage」是歷史命名(最初只做京都清水寺一個城市,且定位是
// 「demo」),city prop 加入後這個元件早已不只服務京都、也不只是 demo
// 性質(首頁/JiufenPage.tsx/KyotoPage.tsx 三個正式頁面共用同一份實作),
// 2026-09 改名成現在這個中性名稱,不再暗示綁定單一城市或暫時性質。
// city prop 讓這個元件跟任何特定城市完全解耦,只要資料庫有對應資料、
// 且已加進後端
// publicAttractionsCityAllowlist/publicPlaceDetailsAllowlist(見兩者的
// 完整說明)都能直接沿用——JiufenPage.tsx 傳 city="九份" 就是第一個
// 非京都的呼叫端,沒有另外新建一份重複元件。
//
// 2026-09:從「固定顯示單一主題點」改成「N 個主題點並存,點哪個顯示
// 哪個」——見上方 THEME_POINTS/openThemeName 的說明,這是為了回答
// 「八坂神社是否適合獨立成一個主題點」這個編輯判斷,需要直接看兩者
// 放在同一張地圖上的實際效果,而非各自孤立展示。這個機制天生支援任意
// 數量的主題點(themePoints 直接從 attractions.filter(isTheme) 算出),
// 京都是 2 個、九份目前是 1 個,不需要為了單一主題點的城市另外分支
// 處理。
//
// 版面:外層 .stage 是這個展示頁自己的容器,固定高度、position:relative
// ——ExploreMap/AttractionInfoPanel 內部的浮動卡片都是 position:absolute
// 疊在最近的 relative 祖先上,沒有這層容器,卡片會直接疊到整個瀏覽器
// 視窗,而不是「非滿版」的這個區塊裡。
//
// initialCenter 刻意不在第一次渲染就給定值,改用 useState+useEffect
// 延後一輪才賦值(對齊 GeoOutlinePanel.tsx 正式流程「查詢中先傳
// undefined,查完才給值」的既有模式)——這是繞開 ExploreMap.tsx 建圖
// effect 在 React.StrictMode 下的一個已知競態,完整原因見本檔案先前
// 版本的說明,這裡維持同一套迴避手法。這個延後現在跟「等 attractions
// 真的從 API 查回來」是同一件事的兩個面向,不需要分開處理:center 改成
// 依 attractions 是否已載入完成動態計算(見下方 initialCenter),
// attractions 為空陣列時仍未設定 center,天然延續原本的迴避手法。
export function InteractiveExploreMap({
  // showThemeToggle:要不要顯示這個元件自己內建的日夜切換按鈕——預設
  // true,對齊獨立路由 /demo/kiyomizu(見 App.tsx)原本的行為,那裡這個
  // 元件是整頁唯一內容,需要自己的切換入口。HomePage.tsx 把這個元件嵌入
  // 首頁(見該檔案的完整說明)後改傳 false:首頁本身已經有自己的日夜
  // 切換按鈕(HomePage.tsx 的 .theme-toggle),同一個頁面上出現兩顆功能
  // 重複的切換鈕會讓使用者困惑「這兩個是不是控制不同範圍」——地圖
  // colorScheme 跟 data-theme 屬性只是不再由「使用者按這顆按鈕」驅動,
  // 改成掛載時讀一次系統的 prefers-color-scheme(見下方 useState 初始值
  // 的說明),theme state 本身、地圖跟隨 theme 建圖的邏輯都不受影響,
  // 只是拿掉那顆按鈕跟它所在的 .toggleRow。
  showThemeToggle = true,
  // city:這個展示頁固定查詢的城市——對應後端 publicAttractionsCityAllowlist
  // 白名單裡的其中一個值(見該常數的完整說明),查詢白名單外的城市會被
  // 後端拒絕。原本是模組層級的寫死常數 DEMO_CITY(固定「京都」),
  // JiufenPage.tsx 需要同一套元件展示「九份」而參數化成 prop——預設值
  // 維持「京都」,對齊原本唯一呼叫端(HomePage.tsx)不需要改動呼叫方式
  // 就能繼續運作。
  city = '京都',
  // externalTheme:外部(呼叫端)控制的日夜模式——原本 showThemeToggle
  // 為 false 時,這個元件假設「呼叫端沒有自己的切換鈕,只需要跟系統設定
  // 走一次」(見下方 theme useState 初始值的說明),這個假設在
  // HomePage.tsx 成立(它嵌入這個元件時本身也還沒有獨立的日夜切換鈕),
  // 但 JiufenPage.tsx 有自己的 .jiufen-theme-toggle 手動切換鈕,使用者
  // 切換時卻發現地圖底圖沒有跟著換(2026-09 實測回報「不會即時換」)
  // ——根因是這個元件內部的 theme state 是獨立自管的,跟外部完全脫鉤,
  // 只在掛載當下讀一次系統偏好,之後不論外部發生什麼變化都不會再更新。
  // 新增這個 optional prop,有值時優先於內部 theme state,讓有自己
  // 切換鈕的呼叫端(JiufenPage.tsx)可以把目前的 theme 直接傳進來讓
  // 地圖跟著即時重建;未傳(undefined,HomePage.tsx 沿用原行為)時完全
  // 不受影響,退回原本「掛載時讀一次系統設定」的邏輯。
  externalTheme,
  // defaultOpenTheme:attractions 從 API 查回來後,自動打開的主題點
  // 名稱——未傳(undefined,HomePage.tsx 沿用原行為)時維持「掛載時
  // 不預先開任何一張卡片,使用者要先點地圖上的主題點才會顯示」的既有
  // 行為(見下方 openThemeName 的說明);傳值時,一旦 attractions 載入
  // 完成且找得到對應名稱的主題點,就自動設定成打開狀態,不需要使用者
  // 自己點擊。JiufenPage.tsx 傳「九份老街」——這個頁面只有一個主題點,
  // 使用者一進頁面就先看到地圖是空的、要點一下才看得到內容,體驗上
  // 不如直接開好給他看;HomePage.tsx 京都有兩個主題點(清水寺/八坂
  // 神社)平等並存,預先選定其中一個反而暗示了優先順序(見
  // openThemeName 說明的既有理由),故不套用這個行為,繼續維持
  // undefined。
  defaultOpenTheme,
  // initialZoom:地圖初始縮放層級——未傳(undefined)時退回模組層級的
  // INITIAL_ZOOM(15,見該常數完整說明),對齊原本唯一呼叫端(HomePage.tsx)
  // 不需要改動呼叫方式就能繼續運作。JiufenPage.tsx 傳更大的值(見該檔案
  // 呼叫處說明)——九份聚落腹地小、景點分布密集,15 這個對京都(景點
  // 分布較開闊)校準過的縮放層級在九份地圖上顯得過遠,拉近能讓使用者
  // 一進頁面就看清楚老街周邊的密集標記,不需要自己手動放大。
  initialZoom,
  // centerNorthOffsetKm:初始中心點往北偏移的公里數——未傳(undefined)
  // 時退回下方 INITIAL_CENTER_NORTH_OFFSET_KM 預設值(0.1km,對齊原本
  // 唯一呼叫端 HomePage.tsx 不需要改動呼叫方式就能繼續運作,見該常數
  // 完整說明)。JiufenPage.tsx 傳負值(見該檔案呼叫處說明)——這個北偏
  // 量原本是針對京都兩個主題點的中點校準出來的初始畫面調整,九份只有
  // 一個主題點(九份老街),不需要這個「不偏袒任一邊」的置中考量,使用者
  // 額外要求「中心點往下(南)100 公尺」,故傳 -0.1 抵消掉共用的預設北偏,
  // 讓九份的初始中心落回九份老街本身(未偏移的原始座標)。
  centerNorthOffsetKm,
}: {
  showThemeToggle?: boolean
  city?: string
  externalTheme?: Theme
  defaultOpenTheme?: string
  initialZoom?: number
  centerNorthOffsetKm?: number
} = {}) {
  // theme 初始值:showThemeToggle 為 false(嵌入首頁,沒有按鈕可以手動
  // 切換)時,直接讀一次系統的 prefers-color-scheme 決定初始深淺色,
  // 讓地圖 colorScheme/data-theme 至少能跟系統設定一致,不會永遠停在
  // null(NativeMapBase 對 theme=null 的預設處理,見該檔案的說明)。
  // showThemeToggle 為 true(獨立展示頁,原本行為)時維持 null,由使用者
  // 按下 ThemeToggle 才決定明確值,不搶先讀系統設定——理由同該按鈕原本
  // 的既有慣例(見下方 ThemeToggle 呼叫處)。
  const [internalTheme, setTheme] = useState<Theme>(() => (
    showThemeToggle ? null : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  ))
  // theme:externalTheme 有值時優先採用(見該 prop 的完整說明),否則退回
  // 內部自管的 internalTheme——兩種模式不會同時發生:showThemeToggle
  // 為 true 的呼叫端不會傳 externalTheme(自己的切換鈕要能運作,見下方
  // <ThemeToggle onChange={setTheme}>),為 false 的呼叫端要嘛完全不傳
  // (HomePage.tsx,退回讀系統設定一次的原行為)要嘛傳 externalTheme
  // (JiufenPage.tsx,即時反映外部切換)。
  const theme = externalTheme !== undefined ? externalTheme : internalTheme
  // isDesktop:寬度 >= 768px(見 useIsDesktop.ts 的完整說明,跟正式功能
  // 桌面/手機版分流用的同一個斷點跟同一支 hook)——決定主題卡要用桌面版
  // 的 AttractionInfoPanel(絕對定位疊在地圖右緣的浮動卡片)還是手機版
  // 的 GeoOutlinePhoneInfoSheet(從畫面下方滑入的 bottom sheet)。這個
  // 展示頁先前固定只用桌面版卡片,手機瀏覽器開啟時版面/觸控體驗跟正式
  // 功能手機版不一致,現在跟 DesktopLayout.tsx/GeoOutlinePhoneView.tsx
  // 一樣依螢幕寬度切換,兩邊共用同一套 useThemeAttractionSelection 狀態
  // (見下方),只是渲染成哪個元件不同。GeoOutlinePhoneInfoSheet 已支援
  // nearby/onSelectNearby/categoryFilter(見該元件的完整說明),手機版
  // 現在也接上「附近景點」清單,跟正式功能手機版行為一致——兩者掛入的
  // 是同一個元件,差別只在呼叫端傳不傳這幾個 prop,不是各自維護一份
  // 不同的清單邏輯。
  const isDesktop = useIsDesktop()

  // attractions:這個展示頁固定城市(city prop)裡人工建檔的全部景點區域
  // ——取代原本 kiyomizuDemoFixture.ts/yasakaDemoFixture.ts 兩份寫死的
  // fixture,改成掛載時真的呼叫 fetchPublicGeoAttractions(免登入公開
  // 端點,見該函式與後端 handlePublicGeoAttractions/
  // publicAttractionsCityAllowlist 的完整說明)查詢。載入中/查詢失敗都
  // 維持空陣列,不特別顯示錯誤訊息——這是試做展示頁,查詢失敗時讓地圖
  // 顯示成「空的,沒有任何主題點/精選點」即可,不需要額外的錯誤 UI。
  // city 加進依賴陣列:JiufenPage.tsx 這類非首次掛載就決定 city 的
  // 呼叫端理論上不會動態切換這個 prop(掛載後固定),但保持依賴陣列
  // 誠實對應 effect 內實際讀取的值,是比較安全的既有慣例。
  const [attractions, setAttractions] = useState<GeoAttraction[]>([])
  useEffect(() => {
    let cancelled = false
    fetchPublicGeoAttractions(GUEST_CFG, city)
      .then((res) => {
        if (!cancelled) setAttractions(res.attractions)
      })
      .catch(() => {
        // 查詢失敗維持空陣列,見上方欄位說明。
      })
    return () => {
      cancelled = true
    }
  }, [city])

  // themePoints:依 attractions 動態分組——主題點(isTheme)各自搭配「同一
  // 城市底下其餘所有非主題點」當它的精選點清單。這個展示頁目前只有清水寺
  // 跟八坂神社兩個主題點共用同一個城市查詢結果,兩者的精選點集合彼此
  // 互斥(資料庫裡每個非主題點只屬於其中一個主題點周邊,不會重複出現在
  // 兩份清單),故這裡直接把「不是主題點的全部項目」都算進每個主題點的
  // nearby,不需要額外的歸屬欄位/距離篩選——理由同原本 kiyomizuDemoFixture.ts/
  // yasakaDemoFixture.ts 兩份 fixture 手動切分好的既有假設,資料庫內容
  // 延續同一種資料形狀。
  const themePoints = useMemo(() => {
    const themes = attractions.filter((a) => a.isTheme)
    const nearby = attractions.filter((a) => !a.isTheme)
    return themes.map((attraction) => ({ attraction, nearby }))
  }, [attractions])

  // initialCenter:兩個主題點的中點,不偏袒任一邊——attractions 尚未載入
  // 完成(themePoints 為空)時回傳 undefined,對齊上方「center 延後一輪
  // 才賦值」的既有迴避手法;只有一個主題點時直接用該點座標,不強行算
  // 「中點」。算出中點後再往北(緯度增加)偏移
  // INITIAL_CENTER_NORTH_OFFSET_KM,是使用者明確要求的初始畫面調整——
  // 純中點置中時畫面感覺不如預期,北移一點讓初始視野的重心往上挪一些。
  // restrictBounds/minZoom(見下方)也是拿這個已經偏移過的 initialCenter
  // 去算,連帶一起往北挪了一點點——由於偏移量(0.1km)遠小於
  // COMBINED_RESTRICT_RADIUS_KM(2km),兩個主題點仍完全落在偏移後的
  // 可拖曳範圍內,不影響「兩個主題點都在可探索範圍內」這個既有前提,
  // 只是整個範圍的中心跟著初始畫面一起微幅北移。 */
  const DEFAULT_CENTER_NORTH_OFFSET_KM = 0.1
  const effectiveNorthOffsetKm = centerNorthOffsetKm ?? DEFAULT_CENTER_NORTH_OFFSET_KM
  const initialCenter = useMemo(() => {
    if (themePoints.length === 0) return undefined
    const lat = themePoints.reduce((sum, t) => sum + t.attraction.lat, 0) / themePoints.length
    const lng = themePoints.reduce((sum, t) => sum + t.attraction.lng, 0) / themePoints.length
    return { lat: lat + effectiveNorthOffsetKm / KM_PER_DEG_LAT, lng }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePoints, effectiveNorthOffsetKm])

  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined)
  useEffect(() => {
    if (initialCenter) setCenter(initialCenter)
  }, [initialCenter])

  // restrictBounds/minZoom:對齊先前寫死版本的計算方式(見
  // computeRestrictBounds/zoomToFitBounds 的完整說明),改成依真正查到的
  // initialCenter 動態算——initialCenter 尚未確定時退回 FALLBACK_CENTER,
  // 只影響地圖容器完全空白時的暫定範圍,不影響資料載入完成後的最終效果。
  const restrictBounds = useMemo(
    () => computeRestrictBounds(initialCenter ?? FALLBACK_CENTER),
    [initialCenter],
  )
  const minZoom = useMemo(
    () => zoomToFitBounds(restrictBounds, MAP_WIDTH_PX_ESTIMATE, MAP_HEIGHT_PX_ESTIMATE),
    [restrictBounds],
  )

  // openThemeName:目前顯示哪個主題點的介紹卡——用名稱而非索引/物件參照
  // 當 key,跟 ExploreMap 的 onAttractionSelect 回呼(見下方)拿到的
  // GeoAttraction.name 直接比對,不需要額外維護一份 id 對照表。初始值
  // null:掛載時不預先開任何一張卡片,使用者要先點地圖上的主題點才會
  // 顯示——2026-09 起改掉原本「固定先顯示清水寺」的預設行為,理由是兩個
  // 主題點現在平等並存(見上方 themePoints 的說明),預先選定其中一個
  // 反而暗示了優先順序。
  const [openThemeName, setOpenThemeName] = useState<string | null>(null)
  const openTheme = themePoints.find((t) => t.attraction.name === openThemeName)

  // defaultOpenTheme 自動打開——見該 prop 的完整說明。用 useEffect(而非
  // 直接當 useState 初始值)是因為 attractions 是非同步從 API 查回來的
  // (見上方 fetchPublicGeoAttractions 的 useEffect),掛載當下
  // themePoints 必然是空陣列,useState 初始值算不出正確結果;改成等
  // themePoints 有內容後才判斷要不要自動打開。只在 openThemeName 還是
  // 初始值 null 時才設定(見下方判斷式)——避免使用者手動點擊切換到
  // 另一個主題點或關閉卡片後,attractions 陣列若因故重新觸發這個
  // effect(理論上不會,city 不會變動,純粹防禦性寫法),又把使用者
  // 已經離開的預設主題點強制設回來。
  useEffect(() => {
    if (!defaultOpenTheme) return
    if (openThemeName !== null) return
    if (themePoints.some((t) => t.attraction.name === defaultOpenTheme)) {
      setOpenThemeName(defaultOpenTheme)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpenTheme, themePoints])

  // useThemeAttractionSelection:主題卡開著時跟它並存/附掛的一組狀態
  // (poiContent/hoveredAttraction/categoryFilter)與對應的 reset/
  // infoCardStack 登記邏輯,抽成跟 DesktopLayout.tsx 共用的 hook(見該
  // 檔案的完整說明)——原本這裡是四份各自獨立手寫的 state,兩邊容易
  // 各自漏寫其中一個 reset effect(2026-09 實測踩過:展示頁漏了
  // hoveredCuratedName/activeNearbyCategoryFilter 的 reset,導致切換
  // 主題點時殘留舊狀態),抽出來後兩邊不可能再各自漏掉。fetchPlaceDetails
  // 傳 fetchPublicGeoPlaceDetails(訪客模式改用免登入公開端點,見該函式與
  // 後端 handlePublicGeoPlaceDetails 白名單的完整說明,這個展示頁固定
  // 城市的 placeId 都在白名單內)。
  const {
    poiContent,
    setPoiContent,
    openPoiContent,
    hoveredAttraction,
    setHoveredAttraction,
    categoryFilter: activeNearbyCategoryFilter,
    setCategoryFilter: setActiveNearbyCategoryFilter,
    infoCardStack,
  } = useThemeAttractionSelection(
    openThemeName,
    useCallback((placeId: string) => fetchPublicGeoPlaceDetails(GUEST_CFG, placeId), []),
  )

  // handleAttractionSelect:地圖上點擊任一地標時觸發(見 ExploreMap.tsx 的
  // onAttractionSelect prop 對這個角色的完整說明——useAttractionOverlays
  // 對主題點/非主題點一視同仁都會呼叫這個 callback,分流判斷要由呼叫端
  // 自己做)。isTheme 為 true(這兩個主題點之一)時切換 openThemeName;
  // 其餘(精選點)時開/換並存的 poiContent,對稱
  // DesktopLayout.tsx handleAttractionOpenPlaceDetails/
  // handleAttractionOpenPlaceWithoutGoogle 的並存行為,只是這裡固定不查
  // Google、無需依「主題卡是否已開」分岔互斥/並存路徑——這個展示頁的
  // AttractionInfoPanel 一律可以有(使用者點過主題點)或没有(尚未點過)
  // 兩種狀態,精選點卡片都固定走並存渲染位置(見下方 JSX,PlacePanel 用
  // CSS 直接疊在主題卡預留位置,沒有主題卡開著時也不影響版面,理由見
  // InteractiveExploreMap.module.css 的說明)。
  // handleRequireAuth:公開展示頁「加入行程」的登入導轉(見 PlacePanel.tsx/
  // GeoOutlinePhoneInfoSheet.tsx requireAuth prop 的完整說明)——訪客沒有
  // 候選籃/行程可以真的寫入,原本這裡完全不傳 onAddCandidate/onSchedule,
  // 導致按鈕點下去展開日曆/選單、選完後整個操作靜默失效。改成導向 /app
  // (全站既有的登入/進入 App 路由,見 HomePage.tsx/JiufenPage.tsx/
  // KyotoPage.tsx 的「登入」按鈕同一個路由),讓使用者至少知道「要先登入
  // 才能真的把這個地點排進行程」,而不是點了沒反應。用 window.location.href
  // (整頁導航)而非 react-router 的 navigate——這個展示頁本身就是公開頁面
  // 樹的一部分,/app 是完全不同的登入後應用程式入口,不是同一個 SPA router
  // 底下的子路由。
  const handleRequireAuth = useCallback(() => {
    window.location.href = '/app'
  }, [])

  const handleAttractionSelect = useCallback((a: GeoAttraction) => {
    // trackEvent:landing page 地圖互動追蹤(見 web/src/analytics.ts 的
    // 完整說明)——這是唯一的地圖點擊進入點(主題點/精選點都會經過這裡,
    // 見上方 useAttractionOverlays 的 onAttractionSelect),不需要在
    // openPoiContent/setOpenThemeName 各自分開埋一次。
    trackEvent('landing_map_attraction_click', { attraction_name: a.name, is_theme: a.isTheme })
    if (a.isTheme) {
      setOpenThemeName(a.name)
      return
    }
    openPoiContent(a)
  }, [openPoiContent])

  const nearbyList = useMemo(
    () => (openTheme ? computeNearbyAttractions(openTheme.attraction, openTheme.nearby, Infinity) : []),
    [openTheme],
  )

  // revealedAttractionNames:對齊 DesktopLayout.tsx 的
  // revealedAttractionNames 行為(見該處與 useAttractionOverlays.ts 的
  // 說明)——只有目前打開的主題點底下的精選點才揭露,沒點開任何主題點
  // 時是空集合,地圖上不顯示任何精選點標記。先前這裡固定用兩組精選點
  // 名稱的聯集(ALL_REVEALED),一進頁面地圖上就會顯示全部精選點,跟正式
  // 功能「先點主題點才揭露」的行為不一致,已改成依 openTheme 動態計算。
  const revealedAttractionNames = useMemo(() => {
    if (!openTheme) return new Set<string>()
    if (!activeNearbyCategoryFilter) return new Set(openTheme.nearby.map((a) => a.name))
    return new Set(
      openTheme.nearby
        .filter((a) => curatedCategoryOf(a.category) === activeNearbyCategoryFilter)
        .map((a) => a.name),
    )
  }, [openTheme, activeNearbyCategoryFilter])

  // mapHandle:NativeMapBase 只做原生建圖(見該檔案開頭的完整說明),不
  // 內建任何 overlay/marker——這個展示頁需要的唯一附掛行為是主題/精選點
  // overlay(useAttractionOverlays),故在這裡自己接住 onHandleChange 交出
  // 的 MapHandle,再往下傳給 useAttractionOverlays。跟 ExploreMap.tsx 內部
  // 原本的 mapRef/mapReady 是元件自己的 state 不同,這裡是从子元件
  // (NativeMapBase)回報上來的。
  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])

  useAttractionOverlays({
    mapRef: mapHandle.mapRef,
    mapReady: mapHandle.mapReady,
    mapVersion: mapHandle.mapVersion,
    attractions,
    revealedAttractionNames,
    onAttractionSelect: handleAttractionSelect,
    hoveredCuratedName: hoveredAttraction?.name ?? null,
  })

  return (
    <div className={`${styles.page} app-theme-root`} data-theme={theme ?? undefined}>
      {showThemeToggle && (
        <div className={styles.toggleRow}>
          <ThemeToggle value={theme} onChange={setTheme} />
        </div>
      )}
      <div className={styles.stage}>
        <NativeMapBase
          center={center}
          zoom={initialZoom ?? INITIAL_ZOOM}
          minZoom={minZoom}
          restrictBounds={restrictBounds}
          // showZoomControl:手機版(!isDesktop)不顯示 Google Maps 內建的
          // +/- 縮放按鈕——這個展示頁在手機版本來就是雙指縮放/單指拖曳
          // 手勢優先(gestureHandling: 'greedy',見 NativeMapBase.tsx 建圖
          // options 的完整說明),縮放按鈕在小螢幕上會佔用寶貴的畫面空間
          // 又不是唯一的縮放手段,桌面版(isDesktop)保留是因為滑鼠使用者
          // 沒有觸控手勢可用,按鈕是主要的縮放入口。
          showZoomControl={isDesktop}
          // theme 跟隨上面的 ThemeToggle 選擇——NativeMapBase 的 theme prop
          // 決定 Google Maps 建圖時的 colorScheme(見該檔案 themeToColorScheme
          // 的完整說明),不跟著切換的話,使用者手動選了「夜間模式」但
          // 地圖底圖仍是淺色(或反過來),UI 跟地圖會對不起來。
          theme={theme}
          mapId={LANDING_MAP_ID}
          onHandleChange={handleMapHandleChange}
        >
          {/* AttractionInfoPanel/GeoOutlinePhoneInfoSheet(主題卡,依
              isDesktop 二選一)、PlacePanel(點「附近景點」開的地點卡,
              桌面版限定,見下方說明)都改用 children 掛入
              NativeMapBase——對齊 DesktopLayout.tsx/GeoOutlinePhoneView.tsx
              的組合方式(見兩者 ExploreMap 的 children 說明),這些卡片
              都不是掛在地圖元件上的東西(地圖建立方式跟卡片無關),但
              語意上統一表達成「這些是附掛在這個地圖上的浮動 UI」,三個
              平台(桌機/手機/展示頁)用同一種掛入慣例。 */}
          {isDesktop ? (
            <>
              {openTheme && (
                <AttractionInfoPanel
                  attraction={openTheme.attraction}
                  cfg={GUEST_CFG}
                  onClose={() => setOpenThemeName(null)}
                  nearby={nearbyList}
                  // onSelectNearby:點擊「附近景點」清單項目——跟地圖上
                  // 直接點擊精選點地標(見 handleAttractionSelect)是同一個
                  // 目的地(開並存的 PlacePanel),故直接重用
                  // openPoiContent,對稱 DesktopLayout.tsx
                  // handleSelectNearbyAttraction 的行為(理由同該函式
                  // 說明)。
                  onSelectNearby={openPoiContent}
                  onHoverNearby={setHoveredAttraction}
                  onCategoryFilterChange={setActiveNearbyCategoryFilter}
                  usePublicPlaceDetails
                />
              )}
              {poiContent && (
                <PlacePanel
                  content={poiContent}
                  onClose={() => setPoiContent(null)}
                  // shiftBy 不傳(維持預設,貼右緣)——這個展示頁沒有
                  // GeoHotelSidebar/對話小匡會佔用右緣,不需要
                  // DesktopLayout.tsx 那套動態判斷。style 用
                  // stackedInfoCardRightPx 搭配上方 infoCardStack 的
                  // presentOrders(跟 DesktopLayout.tsx 同一套掛入模式,見
                  // useInfoCardStack.ts 的完整說明)算出動態 right——不在
                  // 這裡另外重算一次「主題卡存不存在」的判斷式,直接讀
                  // infoCardStack 這個唯一的登記簿。主題卡沒開著時(理論上
                  // 不會發生,因為 poiContent 只會在點擊精選點時設值,而
                  // 精選點只有主題卡已渲染在畫面上才看得到)這張卡也會
                  // 自動排到順位 0 的貼右緣位置,不會停在假設主題卡存在的
                  // 空洞位置。
                  style={{ right: stackedInfoCardRightPx(1, infoCardStack.presentOrders) }}
                  requireAuth={handleRequireAuth}
                />
              )}
            </>
          ) : (
            <>
              {/* 手機版主題卡:改用 GeoOutlinePhoneInfoSheet(從畫面下方
                  滑入的 bottom sheet,見該元件開頭完整說明)——attraction
                  傳主題點本身,content 固定傳 null(這個展示頁沒有「附近
                  景點」以外的獨立地點卡來源,不像 GeoOutlinePhoneView.tsx
                  的 content 對應搜尋結果/推薦地點)。nearby/onSelectNearby/
                  categoryFilter 對齊 GeoOutlinePhoneView.tsx 的接線(見
                  該檔案的完整說明),跟桌面版 AttractionInfoPanel 共用同一批
                  資料(nearbyList/activeNearbyCategoryFilter,見上方
                  useThemeAttractionSelection 的說明),只是呈現成觸控版的
                  chip 列+清單。usePublicPlaceDetails 對稱桌面版的
                  AttractionInfoPanel 用法。 */}
              <GeoOutlinePhoneInfoSheet
                content={null}
                attraction={openTheme?.attraction ?? null}
                cfg={GUEST_CFG}
                onClose={() => setOpenThemeName(null)}
                usePublicPlaceDetails
                nearby={nearbyList}
                onSelectNearby={openPoiContent}
                categoryFilter={activeNearbyCategoryFilter}
                onCategoryFilterChange={setActiveNearbyCategoryFilter}
              />
              {/* 手機版精選點地點卡:點「附近景點」清單項目後開啟——重用
                  同一個 GeoOutlinePhoneInfoSheet 元件疊在主題卡上面(對齊
                  GeoOutlinePhoneView.tsx 'nearby-place' sheet 疊在 'info'
                  之上的模式,見該檔案 SheetEntry 的完整說明),content 傳
                  poiContent(useThemeAttractionSelection 已經查好/組裝完成
                  的 PlaceInfoContent,不需要元件內部再查一次)。這個展示頁
                  沒有 GeoOutlinePhoneView.tsx 那套 sheetStack 堆疊基礎設施,
                  改用「poiContent 是否有值」直接當渲染條件——效果等價:
                  兩者都是「有沒有東西可以顯示這張卡片」當唯一真相來源。 */}
              {poiContent && (
                <GeoOutlinePhoneInfoSheet
                  content={poiContent}
                  attraction={null}
                  cfg={GUEST_CFG}
                  onClose={() => setPoiContent(null)}
                  requireAuth={handleRequireAuth}
                />
              )}
            </>
          )}
        </NativeMapBase>
      </div>
    </div>
  )
}
