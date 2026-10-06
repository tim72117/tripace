import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientConfig, GeoAttraction } from '../api'
import { fetchPublicGeoAttractions, fetchPublicGeoPlaceDetails, fetchPublicGeoPlacePhotoAssets } from '../api'
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
// VITE_GOOGLE_MAPS_LANDING_MAP_ID,對應完全不顯示任何 Google 原生 POI
// 標籤的樣式(見 docs/map-style/*-simple.json 的樣式快照)——
// 2026-10 使用者明確要求「所有的 POI 都關閉」,pointOfInterest 父層
// 關閉標籤後不再重新開啟任何子分類(原本還留著 landmark/recreation/
// entertainment 三類標籤,現已一併移除)。這個城市介紹頁只想呈現我們
// 自建的主題點光暈,不需要 Google 原生底圖的任何商家/地標圖標干擾
// 視覺焦點。
//
// 這份 JSON 只是 Google Cloud Console → Maps Platform → Map Management
// 後台設定的快照記錄,repo 裡改這個檔案本身不會讓地圖實際變化——要讓
// 新設定真正生效,需要登入 Console 找到 VITE_GOOGLE_MAPS_LANDING_MAP_ID
// 對應的 Map Style,手動移除 pointOfInterest.landmark/recreation/
// entertainment 這三條重新開啟標籤的規則,讓它們維持 pointOfInterest
// 父層的 label.visible:false。
//
// 環境變數未設定時 LANDING_MAP_ID 是 undefined,NativeMapBase 的 mapId
// prop 會自動退回 VITE_GOOGLE_MAPS_MAP_ID(見該檔案 mapId 的說明),不會
// 讓地圖建立失敗。
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
// 各 4km 的正方形範圍——理由同先前寫死版本的說明(兩主題點實際距離約
// 1148m,各自離中點約 574m,落在這個範圍內;原本半徑 1km,先改為 2km,
// 2026-10 使用者要求再放大一倍改為 4km,讓可拖曳範圍更大)。座標改成
// 資料庫查來的動態值(見 computeRestrictBounds),不再是模組層級的
// 寫死常數。這是全域共用設定,會同時影響所有使用這個元件的頁面
// (九份/京都/台南安平/赤崁等),不是單一頁面的局部調整。
const COMBINED_RESTRICT_RADIUS_KM = 4
const KM_PER_DEG_LAT = 111

// computeRestrictBounds:換算公式同 kiyomizuDemoFixture.ts/
// yasakaDemoFixture.ts 原本 RESTRICT_BOUNDS 的簡化經緯度換算(緯度 1 度
// 約 111km,經度在這個緯度約 111km*cos(緯度)),精度對這種城市尺度的
// 固定展示範圍已經足夠。radiusKm 參數化(2026-10,見下方 restrictRadiusKm
// prop 的完整說明)——未傳時退回 COMBINED_RESTRICT_RADIUS_KM 這個既有
// 全域預設值,呼叫端不需要逐一改傳參數。
function computeRestrictBounds(
  center: { lat: number; lng: number },
  radiusKm: number = COMBINED_RESTRICT_RADIUS_KM,
): google.maps.LatLngBoundsLiteral {
  const kmPerDegLng = 111 * Math.cos((center.lat * Math.PI) / 180)
  return {
    north: center.lat + radiusKm / KM_PER_DEG_LAT,
    south: center.lat - radiusKm / KM_PER_DEG_LAT,
    east: center.lng + radiusKm / kmPerDegLng,
    west: center.lng - radiusKm / kmPerDegLng,
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
// 哪個」——見上方 THEME_POINTS/openThemeId 的說明,這是為了回答
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
  // 行為(見下方 openThemeId 的說明);傳值時,一旦 attractions 載入
  // 完成且找得到對應名稱的主題點,就自動設定成打開狀態,不需要使用者
  // 自己點擊。JiufenPage.tsx 傳「九份老街」——這個頁面只有一個主題點,
  // 使用者一進頁面就先看到地圖是空的、要點一下才看得到內容,體驗上
  // 不如直接開好給他看;HomePage.tsx 京都有兩個主題點(清水寺/八坂
  // 神社)平等並存,預先選定其中一個反而暗示了優先順序(見
  // openThemeId 說明的既有理由),故不套用這個行為,繼續維持
  // undefined。這個 prop 本身維持是人類可讀名稱字串(呼叫端在原始碼裡
  // 寫死的常數,寫程式當下不會知道資料庫 id),內部找到對應的 attraction
  // 後才改記住它的 id(見下方 useEffect)。
  defaultOpenTheme,
  // focusedTheme:外部「受控」切換要聚焦哪個主題點的名稱——跟
  // defaultOpenTheme 不同,defaultOpenTheme 只在 attractions 剛載入、
  // openThemeId 還是初始值 null 時套用「一次」(見該 prop 完整說明,
  // 套用後的 useEffect guard 不會再反應後續變化);這個 prop 則是每次
  // 改成不同的名稱字串都會重新生效,切換 openThemeId 並把地圖中心
  // panTo 過去。用途:呼叫端(ScrollTimeline.tsx,見該檔案開頭
  // 完整說明)讓這個地圖元件從一開始就常駐掛載(只是用 CSS 隱藏,不是
  // 條件渲染卸載),使用者捲動/點選切換到不同地點時,不需要整個重新
  // mount 這個元件(重新建圖、重新打 API)就能把地圖「移」過去新的
  // 地點——未傳(undefined,其餘既有呼叫端沿用原行為)時完全不影響
  // 既有城市介紹頁,只有 defaultOpenTheme 的「一次性」自動展開行為
  // 繼續運作。
  focusedTheme,
  // focusedCenter:外部「受控」切換要聚焦的原始座標——跟 focusedTheme
  // 的差異是不經過主題點名稱比對,直接拿座標 panTo。2026-10 追加:這個
  // 座標若剛好對應到地圖上某個既有精選點,該精選點會改畫「素色小圓點」
  // 聚焦造型(見下方 focusedAttractionId 的完整說明),呼叫端不需要額外
  // 傳任何 prop。用途:
  // ScrollTimeline.tsx 的某些錨點對應的地點根本不是資料庫裡的主題點
  // (甚至不在資料庫裡,例如純文案提到的街區/住宿地點),這種情況下
  // focusedTheme 比對不到任何主題點、什麼都不會發生,呼叫端改傳這個
  // prop 直接指定座標。同一次渲染若 focusedTheme 剛好比對到真正的
  // 主題點,以 focusedTheme 優先(連帶的開卡/揭露附近景點效果只有真正
  // 主題點才有意義),focusedCenter 會被忽略,不會同時 panTo 兩個不同
  // 地方;只有 focusedTheme 沒有值、或比對不到任何主題點時,才會改用
  // focusedCenter。未傳(undefined,其餘既有呼叫端沿用原行為)時完全
  // 不影響既有城市介紹頁。
  focusedCenter,
  // openCardOnFocus:focusedTheme 受控切換時,除了把地圖中心 panTo 到
  // 該主題點之外,是否連帶打開它的主題點介紹卡(桌機 AttractionInfoPanel/
  // 手機 GeoOutlinePhoneInfoSheet,卡片裡才有「附近景點」清單)。未傳/
  // false 時只移動中心、不碰 openThemeId;true 時連帶 setOpenThemeId。
  // ScrollTimeline.tsx 的嵌入式小地圖面板開著時傳 true、關著時傳 false
  // (搭配下方 themeCardNearbyOnly 讓開出來的卡片只露出附近景點清單)。
  // 從 true 變回 false(面板關閉)時主動把卡片收起來,否則卡片會殘留在
  // 被 CSS 隱藏的面板裡,下次面板一露出就帶著上一次的卡片。只跟
  // focusedTheme 搭配使用,其餘既有呼叫端(JiufenPage.tsx 等)兩者都
  // 不傳,完全不受影響。
  openCardOnFocus,
  // themeCardNearbyOnly:true 時桌機版主題卡(AttractionInfoPanel)改用
  // 精簡模式,只顯示「附近景點」清單、不顯示照片/名稱/簡介(見該元件
  // nearbyOnly prop 的完整說明)——2026-10 使用者對 ScrollTimeline.tsx
  // 嵌入式小地圖的要求:「地圖移動到該主題點時,開啟主題點顯示附近景點,
  // 但是不要開啟主題點介紹卡」。這是「這個地圖實例的主題卡長什麼樣」的
  // 整體設定,不只作用在 focusedTheme 觸發的那一次開卡:使用者直接點
  // 地圖上的主題點時也一樣只看到精簡清單,260px 高的小面板本來就塞不下
  // 完整卡片,兩條開卡路徑長相一致比較不突兀。手機版
  // GeoOutlinePhoneInfoSheet 目前不支援精簡模式(它的 snap 段位/標頭
  // 結構跟名稱/照片綁得更緊),手機寬度下仍顯示完整 sheet——這個嵌入式
  // 面板以桌機瀏覽為主,先不處理。未傳/false 維持完整卡片,正式城市頁
  // 不受影響。
  themeCardNearbyOnly,
  // disableThemeCardOnMapClick:true 時,直接點擊地圖上的主題點圖標
  // (handleAttractionSelect 的 isTheme 分支)不會打開任何介紹卡,單純
  // 沒有反應。2026-10 使用者明確要求:ScrollTimeline.tsx 的嵌入式小地圖
  // 完全不要顯示主題點介紹卡——先前已經做到「focusedTheme 受控聚焦時
  // 不開卡」(見 openCardOnFocus 的完整說明),但那只管住「捲動/點擊
  // 時間軸錨點」這條路徑,使用者如果直接在 260px 小地圖上手動點主題點
  // 圖標本身,還是會走 handleAttractionSelect 這條獨立路徑開卡,沒被
  // 前面那些控制項管到。這個 prop 補上這個漏洞,讓「這個地圖實例完全
  // 不顯示主題卡」這個決定在所有觸發路徑上保持一致。未傳/false 維持
  // 既有行為,九份/京都/台南等正式城市頁(使用者仍然需要能點主題點看
  // 介紹卡)完全不受影響。
  disableThemeCardOnMapClick,
  // revealNearbyOnFocus:focusedTheme 聚焦的主題點,要不要連帶在地圖上
  // 揭露它的「附近景點」小圓點標記(即使 openCardOnFocus 是 false、卡片
  // 沒有打開)。2026-10 使用者明確要求:「地圖」模式(ScrollTimeline.tsx
  // 只移動中心、不開卡片的那顆按鈕)下,地圖本身的附近景點小點也要顯示
  // 出來——原本 revealedAttractionNames(見下方)只依 openTheme(卡片是否
  // 打開)決定要不要揭露,導致卡片沒開時地圖上完全看不到任何精選點標記。
  // 這個 prop 讓揭露邏輯改成「卡片開著就用卡片的主題點,否則(這個 prop
  // 為 true 時)改用 focusedTheme 比對到的主題點」,兩者互斥、不衝突
  // ——卡片開著時揭露範圍本來就該跟著卡片走,不受這個 prop 影響。未傳/
  // false 時完全不影響既有行為(九份/京都/台南等正式城市頁不傳這個
  // prop,維持「只有打開卡片才揭露精選點」的既有規則)。
  revealNearbyOnFocus,
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
  // restrictRadiusKm:可拖曳範圍的半徑(公里)——未傳(undefined)時退回
  // 模組層級的 COMBINED_RESTRICT_RADIUS_KM(4km,見該常數完整說明),
  // 九份/京都/台南等正式城市頁都不傳,行為完全不變。2026-10 新增,供
  // ScrollTimeline.tsx 這類呼叫端視情境調整——例如 TainanChikanPage.tsx
  // 這種同城市有兩個主題點但相距 5~6km 的情境,固定 4km 半徑配合「以
  // 目前錨點為中心」(見上方 initialCenter/focusedTheme 的完整說明)可能
  // 剛好能看到、也可能太緊繃,讓呼叫端自己視頁面景點分布決定要放寬還是
  // 收緊,不強制套用對齊京都(主題點相距約 1.1km)校準出來的固定值。
  restrictRadiusKm,
  // showZoomControl:要不要顯示 Google Maps 內建的 +/- 縮放按鈕——未傳
  // (undefined)時退回下方「桌機顯示、手機隱藏」的既有判斷(見
  // <NativeMapBase showZoomControl> 呼叫處的完整說明),九份/京都/台南等
  // 正式城市頁的滿版地圖都不傳,行為完全不變。ScrollTimeline.tsx 的嵌入式
  // 小地圖面板(260px 高)明確傳 false:那個面板的用途是「瞥一眼大概位置」,
  // 方形的原生縮放鈕組貼在右下角、又要跟右上角的關閉鈕共存,在這麼小的
  // 面板裡顯得擁擠突兀(2026-10 使用者截圖回報);滾輪/雙指縮放
  // (gestureHandling: 'greedy')仍然可用,關掉按鈕不等於關掉縮放。
  showZoomControl,
  // themePhotoOnlyWhenFocused:2026-10 新增的 opt-in 開關——主題點預設
  // 「不管有沒有被聚焦,恆顯示圓形照片光暈」(九份/京都/台南/首頁等所有
  // 既有呼叫端依賴的行為);true 時改成「只有 focusedTheme 比對到的那個
  // 主題點才顯示圓形照片,其餘主題點退化成跟一般精選點一樣的素色小圓點
  // (hover 仍可臨時升級成照片)」。使用者對 ScrollTimeline.tsx 嵌入式
  // 小地圖的要求:「主題點只有在主題點的苗點才顯示圓形圖,其他時候顯示
  // 小圓點」——捲到別的錨點時,沒人在看的主題點不該繼續用 56px 照片圓
  // 搶走目前錨點的視覺焦點。實作見 useAttractionOverlays.ts 的
  // themePhotoOnlyWhenFocused/focusedThemeId 與 geoAttractionOverlay.ts
  // 的 setThemePhotoCollapsed。未傳/false 時一字不變:下方傳給 hook 的
  // 開關為 false,hook 對每顆 overlay 的 setThemePhotoCollapsed(false)
  // 是 no-op,正式城市頁的主題點繼續恆顯示照片。
  themePhotoOnlyWhenFocused,
}: {
  showThemeToggle?: boolean
  city?: string
  externalTheme?: Theme
  defaultOpenTheme?: string
  focusedTheme?: string
  focusedCenter?: { lat: number; lng: number }
  openCardOnFocus?: boolean
  themeCardNearbyOnly?: boolean
  disableThemeCardOnMapClick?: boolean
  revealNearbyOnFocus?: boolean
  initialZoom?: number
  centerNorthOffsetKm?: number
  restrictRadiusKm?: number
  showZoomControl?: boolean
  themePhotoOnlyWhenFocused?: boolean
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

  // initialCenter:預設是「同一城市底下所有主題點的中點,不偏袒任一邊」
  // ——attractions 尚未載入完成(themePoints 為空)時回傳 undefined,對齊
  // 上方「center 延後一輪才賦值」的既有迴避手法;只有一個主題點時直接用
  // 該點座標,不強行算「中點」。這個「取中點」的假設是針對京都(清水寺/
  // 八坂神社相距約 1.1km,同屬一個緊湊的步行探索範圍)校準出來的,對
  // 距離較遠、彼此獨立的主題點組合(例如台南赤崁樓/安平古堡相距
  // 5~6km,是台南市內兩個各自獨立的觀光區域,不是同一個可拖曳範圍)
  // 完全不適用——2026-09 實測發現:TainanChikanPage.tsx 傳
  // defaultOpenTheme="赤崁樓" 讓卡片正確自動打開赤崁樓,但地圖本身仍
  // 用兩個主題點的中點置中,畫面顯示的是安平周邊,跟卡片內容完全脫節。
  // 修法:defaultOpenTheme 有指定、且能在 themePoints 裡找到對應主題點
  // 時,直接用那個主題點自己的座標當中心,不取平均——這對應「呼叫端已經
  // 明確表示這頁只關心哪一個主題點」的情境(對齊上方 defaultOpenTheme
  // 的完整說明:JiufenPage.tsx/TainanPage.tsx 單一主題點城市、以及像
  // TainanChikanPage.tsx 這種同城市有多主題點但頁面本身只聚焦其中一個
  // 的情境),取平均的邏輯只在沒有 defaultOpenTheme(例如 HomePage.tsx
  // 京都兩點平等並存)時才會用到。
  // 算出中心後再往北(緯度增加)偏移 INITIAL_CENTER_NORTH_OFFSET_KM,是
  // 使用者明確要求的初始畫面調整——純中點置中時畫面感覺不如預期,北移
  // 一點讓初始視野的重心往上挪一些;單一主題點時同樣套用這個偏移,維持
  // 跟中點模式一致的視覺習慣。restrictBounds/minZoom(見下方)也是拿這個
  // 已經偏移過的 initialCenter 去算,連帶一起往北挪了一點點——由於偏移量
  // (0.1km)遠小於 COMBINED_RESTRICT_RADIUS_KM(2km),不影響「主題點
  // 落在可探索範圍內」這個既有前提,只是整個範圍的中心跟著初始畫面一起
  // 微幅北移。 */
  const DEFAULT_CENTER_NORTH_OFFSET_KM = 0.1
  const effectiveNorthOffsetKm = centerNorthOffsetKm ?? DEFAULT_CENTER_NORTH_OFFSET_KM
  // 2026-10 使用者明確要求:「第一次開啟地圖時,要以目前苗點(錨點)為
  // 中心」——ScrollTimeline.tsx 這類呼叫端不傳 defaultOpenTheme(刻意
  // 避免觸發自動開卡,見該元件掛載處的完整說明),原本這裡找不到
  // defaultOpenTheme 對應的主題點,就會退回「同城市全部主題點的中點」
  // (見上方大段說明)——對 TainanChikanPage.tsx 這種同城市有兩個主題點
  // 但相距好幾公里的情境,使用者第一次點開地圖面板時,看到的會是兩個
  // 主題點之間的中點,不是他正在讀的那個錨點。改成優先用 focusedTheme
  // (目前捲動/點擊聚焦的主題點,見該 prop 完整說明)找對應主題點,找不到
  // (例如面板還沒開過、focusedTheme 是 undefined)才退回 defaultOpenTheme
  // 的既有邏輯——面板一開啟,focusedTheme 立刻有值,這裡會優先用它算出
  // 單點中心,不再取多點平均,「第一次開啟就以目前錨點為中心」因此成立。
  // 其餘既有呼叫端(JiufenPage.tsx 等)不傳 focusedTheme,這個新增的
  // 優先序完全不影響它們原本只看 defaultOpenTheme 的行為。
  // 2026-10 再補一層:focusedTheme 比對不到任何主題點(例如這個錨點根本
  // 不是主題點,見 focusedCenter prop 的完整說明)時,退而求其次直接用
  // focusedCenter 的原始座標當單點中心——理由同上,第一次開啟地圖也要
  // 以目前錨點(即使它不是主題點)為中心,不要退回多點平均。只有
  // focusedTheme/defaultOpenTheme 都比對不到、focusedCenter 也沒有值時,
  // 才真的走最後的多點平均邏輯。
  const initialCenter = useMemo(() => {
    if (themePoints.length === 0) return undefined
    const preferredThemeName = focusedTheme ?? defaultOpenTheme
    const defaultTheme = preferredThemeName
      ? themePoints.find((t) => t.attraction.name === preferredThemeName)
      : undefined
    const basePoint = defaultTheme
      ? { lat: defaultTheme.attraction.lat, lng: defaultTheme.attraction.lng }
      : focusedCenter
    if (basePoint) {
      return { lat: basePoint.lat + effectiveNorthOffsetKm / KM_PER_DEG_LAT, lng: basePoint.lng }
    }
    const lat = themePoints.reduce((sum, t) => sum + t.attraction.lat, 0) / themePoints.length
    const lng = themePoints.reduce((sum, t) => sum + t.attraction.lng, 0) / themePoints.length
    return { lat: lat + effectiveNorthOffsetKm / KM_PER_DEG_LAT, lng }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePoints, effectiveNorthOffsetKm, defaultOpenTheme, focusedTheme, focusedCenter])

  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined)
  useEffect(() => {
    if (initialCenter) setCenter(initialCenter)
  }, [initialCenter])

  // restrictBounds/minZoom:對齊先前寫死版本的計算方式(見
  // computeRestrictBounds/zoomToFitBounds 的完整說明),改成依真正查到的
  // initialCenter 動態算——initialCenter 尚未確定時退回 FALLBACK_CENTER,
  // 只影響地圖容器完全空白時的暫定範圍,不影響資料載入完成後的最終效果。
  const restrictBounds = useMemo(
    () => computeRestrictBounds(initialCenter ?? FALLBACK_CENTER, restrictRadiusKm),
    [initialCenter, restrictRadiusKm],
  )
  const minZoom = useMemo(
    () => zoomToFitBounds(restrictBounds, MAP_WIDTH_PX_ESTIMATE, MAP_HEIGHT_PX_ESTIMATE),
    [restrictBounds],
  )

  // openThemeId:目前顯示哪個主題點的介紹卡。
  // 2026-10 修正(使用者明確要求):原本用 name(人類可讀名稱)當 key,
  // 跟 ExploreMap 的 onAttractionSelect 回呼(見下方)拿到的
  // GeoAttraction.name 直接比對——但 name 不保證全域唯一(先前已知現有
  // 重複資料案例:資料庫裡同一個地點因為 sync 工具比對缺陷,出現過
  // 新舊兩筆同名但 id 不同的記錄,見 CHANGELOG 相關條目),用 name 當
  // 識別值有誤判「這是同一個主題點」的風險。改用 id(GeoAttraction.id,
  // 人工建檔景點恆有值,見該欄位完整說明)——這是資料庫主鍵,保證唯一,
  // 不會有同名誤判的疑慮。初始值 null:掛載時不預先開任何一張卡片,
  // 使用者要先點地圖上的主題點才會顯示——2026-09 起改掉原本「固定先
  // 顯示清水寺」的預設行為,理由是兩個主題點現在平等並存(見上方
  // themePoints 的說明),預先選定其中一個反而暗示了優先順序。
  const [openThemeId, setOpenThemeId] = useState<string | null>(null)
  const openTheme = themePoints.find((t) => t.attraction.id != null && t.attraction.id === openThemeId)

  // defaultOpenTheme 自動打開——見該 prop 的完整說明(prop 本身仍是人類
  // 可讀名稱字串,這裡找到對應的 attraction 後改記住它的 id)。用
  // useEffect(而非直接當 useState 初始值)是因為 attractions 是非同步
  // 從 API 查回來的(見上方 fetchPublicGeoAttractions 的 useEffect),
  // 掛載當下 themePoints 必然是空陣列,useState 初始值算不出正確結果;
  // 改成等 themePoints 有內容後才判斷要不要自動打開。只在 openThemeId
  // 還是初始值 null 時才設定(見下方判斷式)——避免使用者手動點擊切換到
  // 另一個主題點或關閉卡片後,attractions 陣列若因故重新觸發這個
  // effect(理論上不會,city 不會變動,純粹防禦性寫法),又把使用者
  // 已經離開的預設主題點強制設回來。
  useEffect(() => {
    if (!defaultOpenTheme) return
    if (openThemeId !== null) return
    const match = themePoints.find((t) => t.attraction.name === defaultOpenTheme)
    if (match?.attraction.id != null) {
      setOpenThemeId(match.attraction.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpenTheme, themePoints])

  // useThemeAttractionSelection:主題卡開著時跟它並存/附掛的一組狀態
  // (poiContent/hoveredAttraction/categoryFilter)與對應的 reset/
  // infoCardStack 登記邏輯,抽成跟 DesktopLayout.tsx 共用的 hook(見該
  // 檔案的完整說明)——原本這裡是四份各自獨立手寫的 state,兩邊容易
  // 各自漏寫其中一個 reset effect(2026-09 實測踩過:展示頁漏了
  // hoveredCuratedId/activeNearbyCategoryFilter 的 reset,導致切換
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
    openThemeId,
    useCallback((placeId: string) => fetchPublicGeoPlaceDetails(GUEST_CFG, placeId), []),
    useCallback((placeId: string) => fetchPublicGeoPlacePhotoAssets(GUEST_CFG, placeId), []),
  )

  // handleAttractionSelect:地圖上點擊任一地標時觸發(見 ExploreMap.tsx 的
  // onAttractionSelect prop 對這個角色的完整說明——useAttractionOverlays
  // 對主題點/非主題點一視同仁都會呼叫這個 callback,分流判斷要由呼叫端
  // 自己做)。isTheme 為 true(這兩個主題點之一)時切換 openThemeId;
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
    // openPoiContent/setOpenThemeId 各自分開埋一次。
    trackEvent('landing_map_attraction_click', { attraction_name: a.name, is_theme: a.isTheme })
    if (a.isTheme) {
      // disableThemeCardOnMapClick 時,直接點地圖上的主題點圖標完全沒有
      // 反應——見該 prop 完整說明,這是「這個地圖實例不顯示主題卡」這個
      // 決定在使用者手動點圖標這條路徑上的對應處理。
      if (disableThemeCardOnMapClick) return
      // a.id 理論上恆有值(主題點固定來自人工建檔資料,見 openThemeId
      // 宣告處的完整說明)——?? null 只是滿足型別(GeoAttraction.id 宣告
      // 成 optional),不是預期會真的落到這個分支。
      setOpenThemeId(a.id ?? null)
      return
    }
    openPoiContent(a)
  }, [openPoiContent, disableThemeCardOnMapClick])

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
  // 2026-10 使用者明確要求:ScrollTimeline.tsx 的嵌入式小地圖「不管苗點
  // (錨點)在哪,都要顯示附近景點的小點」——不想再侷限於「只有比對到
  // 某個主題點時才揭露那個主題點底下的精選點」這個規則,包括 center
  // 類型的錨點(完全比對不到任何主題點,見 focusedCenter prop 的完整
  // 說明)也要看到附近景點標記。這個城市目前的資料模型本來就是「全部
  // 非主題點通通算進每一個主題點的 nearby」(見 themePoints 的完整
  // 說明,同一份清單不管挑哪個主題點都一樣),故 revealNearbyOnFocus 為
  // true 時直接改用 attractions.filter(!isTheme) 取代原本「只有比對到
  // 某個 focusedThemePoint 才揭露」的邏輯——效果等價(同一份清單)但不再
  // 依賴比對是否成功,真正做到「不管苗點在哪都顯示」。openTheme(卡片
  // 開著)時仍優先用卡片自己的主題點+分類篩選,跟卡片顯示範圍保持一致;
  // 其餘既有呼叫端不傳 revealNearbyOnFocus,行為跟修改前完全一致。
  const revealedAttractionNames = useMemo(() => {
    if (openTheme) {
      if (!activeNearbyCategoryFilter) return new Set(openTheme.nearby.map((a) => a.name))
      return new Set(
        openTheme.nearby
          .filter((a) => curatedCategoryOf(a.category) === activeNearbyCategoryFilter)
          .map((a) => a.name),
      )
    }
    if (revealNearbyOnFocus) {
      return new Set(attractions.filter((a) => !a.isTheme).map((a) => a.name))
    }
    return new Set<string>()
  }, [openTheme, activeNearbyCategoryFilter, revealNearbyOnFocus, attractions])

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

  // handleHoverNearby:接在 setHoveredAttraction 前面的包裝——2026-10
  // 使用者明確要求「滑動到的點如果不在地圖可見範圍內,則移動到該點為
  // 中心」,橫滑清單(GeoOutlinePhoneInfoSheet.tsx 的 onHoverNearby)滑到
  // 地圖目前視角外的精選點時,使用者只看得到清單卡片、看不到地圖上同步
  // 升級成照片呈現的那個點(地圖畫面裡根本沒有它),這組視覺連動等於
  // 白做。用 google.maps.Map.getBounds().contains() 判斷該點座標是否在
  // 目前可視範圍內,不在才呼叫 panTo——範圍內時維持原樣不移動地圖,避免
  // 使用者滑動瀏覽清單時地圖毫無必要地跟著輕微漂移(只有真的需要才動,
  // 這是「移動到可見」而非「每次都置中」)。
  const handleHoverNearby = useCallback((a: GeoAttraction | null) => {
    setHoveredAttraction(a)
    if (!a) return
    const map = mapHandle.mapRef.current
    if (!map) return
    const bounds = map.getBounds()
    const position = { lat: a.lat, lng: a.lng }
    if (bounds && !bounds.contains(position)) {
      map.panTo(position)
    }
  }, [mapHandle.mapRef, setHoveredAttraction])

  // focusedTheme 受控切換——見該 prop 開頭的完整說明。用 ref 記住上一次
  // 真正處理過的名稱,而非只靠 useEffect 的 deps 陣列判斷「有沒有變」,
  // 是因為呼叫端可能重複傳入同一個名稱字串(例如使用者捲動離開又捲回
  // 同一個錨點)——這時地圖已經在那個主題點上,不需要重新 panTo 一次。
  // themePoints 尚未載入完成(attractions 還沒查到)時先不處理,等
  // themePoints 有內容的那次重新渲染會自然再跑一次這個 effect(deps
  // 包含 themePoints)。
  //
  // 開卡與否交給 openCardOnFocus 決定(見該 prop 說明):只在 true 時
  // setOpenThemeId,而且不受「名稱沒變」的 ref guard 限制——使用者可能
  // 關掉面板再重開同一個主題點(名稱沒變,但卡片已被下方的 true→false
  // effect 收掉),這時卡片要從沒開變成開。panTo 仍只在名稱真的變了才做。
  // focusedThemeMatched:這一輪 focusedTheme 是否真的比對到一個主題點
  // ——下面的 focusedCenter effect 需要知道這件事,才能正確判斷「要不要
  // 退而求其次改用 focusedCenter」(見該 prop 開頭完整說明:focusedTheme
  // 比對到主題點時優先,focusedCenter 要被忽略)。純衍生值,不是 hook,
  // 每次渲染重新算一次即可,不需要額外狀態。
  // focusedThemePoint:focusedTheme 比對到的主題點本身——focusedThemeMatched
  // 由它衍生(語意不變),2026-10 另外供 focusedThemeId(見下方
  // useAttractionOverlays 呼叫處)取 id 用,沿用同一個比對式、不重新發明。
  const focusedThemePoint = focusedTheme ? themePoints.find((t) => t.attraction.name === focusedTheme) : undefined
  const focusedThemeMatched = !!focusedThemePoint
  const lastFocusedThemeRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focusedTheme) return
    const match = themePoints.find((t) => t.attraction.name === focusedTheme)
    if (!match || match.attraction.id == null) return
    if (focusedTheme !== lastFocusedThemeRef.current) {
      lastFocusedThemeRef.current = focusedTheme
      const map = mapHandle.mapRef.current
      if (map) {
        map.panTo({ lat: match.attraction.lat, lng: match.attraction.lng })
      }
    }
    if (openCardOnFocus) {
      setOpenThemeId(match.attraction.id)
    }
  }, [focusedTheme, openCardOnFocus, themePoints, mapHandle.mapRef])

  // focusedCenter 受控切換——見該 prop 開頭的完整說明:只在 focusedTheme
  // 沒有值、或比對不到任何主題點時才生效(focusedThemeMatched 為
  // false),避免跟上面那個 effect 同時把地圖 panTo 到兩個不同的地方。
  // 用 ref 記住上一次真正處理過的座標(以 "lat,lng" 字串比對,座標是
  // 數字,直接放進 deps 陣列每次都是新的物件參照,useEffect 會誤判成
  // 每次都變動),理由同 lastFocusedThemeRef——避免呼叫端重複傳入同一個
  // 座標時重複 panTo。
  const lastFocusedCenterKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focusedCenter || focusedThemeMatched) return
    const key = `${focusedCenter.lat},${focusedCenter.lng}`
    if (key === lastFocusedCenterKeyRef.current) return
    lastFocusedCenterKeyRef.current = key
    const map = mapHandle.mapRef.current
    if (map) {
      map.panTo(focusedCenter)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCenter?.lat, focusedCenter?.lng, focusedThemeMatched, mapHandle.mapRef])

  // focusedAttractionId:2026-10 新增——focusedCenter 指定的座標若剛好
  // 跟地圖上某個「精選點」(isTheme===false)的座標相同,把那個精選點的
  // id 交給 useAttractionOverlays 的 focusedAttractionId(見該 prop 與
  // geoAttractionOverlay.ts 的 focused 欄位完整說明),讓它改畫「素色
  // 小圓點」造型,表達「這一顆就是時間軸正在講的那一站」。使用者需求:
  // 「苗點在精選點時,該點要變成(素色小圓點)圖標」——ScrollTimeline.tsx
  // 的錨點用 center prop 直接指定座標時(見該檔案 AnchorMeta.center 的
  // 說明),呼叫端寫的是從資料庫複製出來的同一組數字,這裡用座標反查
  // 就能對應回資料庫裡的那筆精選點,不需要呼叫端另外傳 id。
  //
  // 設計決定:不另開一個 flag prop,直接由 focusedCenter 有值就自動嘗試
  // 比對——focusedCenter 本身就是 2026-10 才為 ScrollTimeline 新增的
  // optional prop,九份/京都/台南等正式城市頁從不傳它,這裡恆為 null,
  // 既有呼叫端零影響;多一個 flag 只會讓 ScrollTimeline 必須記得同時傳
  // 兩個 prop,沒有降低任何風險。focusedTheme 已比對到主題點時跳過
  // (以 theme 優先,對齊 focusedCenter prop 的既有優先序;主題點本來就
  // 不走 focused 造型,setFocused 對 isTheme 是 no-op)。
  //
  // 比對寬容度:lat/lng 各自誤差 FOCUS_MATCH_EPSILON_DEG(0.0001 度,
  // 約 11 公尺)以內視為同一點,不用 === 直接比——座標是浮點數,呼叫端
  // 雖然是複製貼上同一組數字,但未來若有人手動改了小數末位、或 API
  // 回傳的數值經過序列化精度變化,嚴格相等會悄悄失效而沒有任何提示。
  // 同時命中多個(資料庫裡座標極接近的重複記錄,先前已知有這種案例)
  // 時取距離最近的那一個。只比對精選點,主題點直接略過。
  const FOCUS_MATCH_EPSILON_DEG = 0.0001
  const focusedAttractionId = useMemo(() => {
    if (!focusedCenter || focusedThemeMatched) return null
    let best: GeoAttraction | null = null
    let bestDist = Infinity
    for (const a of attractions) {
      if (a.isTheme || a.id == null) continue
      const dLat = Math.abs(a.lat - focusedCenter.lat)
      const dLng = Math.abs(a.lng - focusedCenter.lng)
      if (dLat > FOCUS_MATCH_EPSILON_DEG || dLng > FOCUS_MATCH_EPSILON_DEG) continue
      const dist = dLat * dLat + dLng * dLng
      if (dist < bestDist) {
        bestDist = dist
        best = a
      }
    }
    return best?.id ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCenter?.lat, focusedCenter?.lng, focusedThemeMatched, attractions])

  // openCardOnFocus 從 true 退回 false 時收掉卡片——理由見該 prop 說明。
  // 用 ref 比對「上一次的值」只在真正的 true→false 邊緣觸發,首次掛載
  // (undefined)或一直是 false 的既有呼叫端完全不會動到 openThemeId。
  const prevOpenCardOnFocusRef = useRef(openCardOnFocus)
  useEffect(() => {
    const wasOpen = prevOpenCardOnFocusRef.current
    prevOpenCardOnFocusRef.current = openCardOnFocus
    if (wasOpen && !openCardOnFocus) {
      setOpenThemeId(null)
    }
  }, [openCardOnFocus])

  useAttractionOverlays({
    mapRef: mapHandle.mapRef,
    mapReady: mapHandle.mapReady,
    mapVersion: mapHandle.mapVersion,
    attractions,
    revealedAttractionNames,
    onAttractionSelect: handleAttractionSelect,
    hoveredCuratedId: hoveredAttraction?.id ?? null,
    // GUEST_CFG/usePublicPlaceDetails=true——這是登入前的公開展示頁,
    // 打 fetchPublicGeoPlaceDetails(/public/geo/place-details),理由同
    // 這個檔案其餘呼叫端(AttractionInfoPanel/handleAttractionSelect
    // 附近的既有 fetchPublicGeoPlaceDetails 呼叫)一致的判斷邏輯。
    cfg: GUEST_CFG,
    usePublicPlaceDetails: true,
    // 手機版 bottom sheet 開啟期間隱藏地圖上對應主題點的 overlay(見
    // useAttractionOverlays.ts 的 hiddenAttractionId 完整說明)——桌面版
    // 走 AttractionInfoPanel 並存顯示,不受影響,固定傳 null。
    hiddenAttractionId: !isDesktop ? openThemeId : null,
    // focusedAttractionId:見上方推導處的完整說明——只有 focusedCenter
    // 有值(ScrollTimeline.tsx)且座標對應到既有精選點時才有值,其餘
    // 呼叫端恆為 null,useAttractionOverlays 對 null 的處理就是全部
    // setFocused(false),等同既有行為。
    focusedAttractionId,
    // themePhotoOnlyWhenFocused/focusedThemeId:見該 prop 開頭的完整說明
    // ——只有 ScrollTimeline.tsx 開啟;其餘呼叫端開關為 undefined,hook
    // 內部等同全部 setThemePhotoCollapsed(false)(no-op),主題點恆顯示
    // 照片的既有行為不變。focusedThemeId 直接沿用 focusedThemePoint(跟
    // focusedThemeMatched 同一個比對式),不另外發明一套「主題點是否被
    // 聚焦」的判斷;只在開關開著時才傳,關著時固定 null,避免既有呼叫端
    // 多一個會變動的依賴值觸發 hook 內部 effect(即使是 no-op)。
    themePhotoOnlyWhenFocused,
    focusedThemeId: themePhotoOnlyWhenFocused ? (focusedThemePoint?.attraction.id ?? null) : null,
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
          // 沒有觸控手勢可用,按鈕是主要的縮放入口。呼叫端明確傳了
          // showZoomControl 時以呼叫端為準(見該 prop 說明),未傳才套
          // 這個桌機/手機的預設判斷。
          showZoomControl={showZoomControl ?? isDesktop}
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
                  onClose={() => setOpenThemeId(null)}
                  nearby={nearbyList}
                  // onSelectNearby:點擊「附近景點」清單項目——跟地圖上
                  // 直接點擊精選點地標(見 handleAttractionSelect)是同一個
                  // 目的地(開並存的 PlacePanel),故直接重用
                  // openPoiContent,對稱 DesktopLayout.tsx
                  // handleSelectNearbyAttraction 的行為(理由同該函式
                  // 說明)。
                  onSelectNearby={openPoiContent}
                  onHoverNearby={handleHoverNearby}
                  onCategoryFilterChange={setActiveNearbyCategoryFilter}
                  usePublicPlaceDetails
                  nearbyOnly={themeCardNearbyOnly}
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
                onClose={() => setOpenThemeId(null)}
                usePublicPlaceDetails
                nearby={nearbyList}
                onSelectNearby={openPoiContent}
                onHoverNearby={handleHoverNearby}
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
