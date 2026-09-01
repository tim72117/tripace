import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoPlaceDetails, GeoSearchResult, GeoTripEntry } from '../api'
import { fetchGeoAttractionsOnlyNearby, fetchGeoGeocode, fetchGeoPlaceDetails, geocodeCandidateToSearchResult } from '../api'
import { Compass, Hotel, Loader2, MapPin, Search, Sparkles, UtensilsCrossed } from 'lucide-react'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import { isSubmitEnter } from '../AppCommon'
import type { Theme } from '../theme'
import { initialAreaSearchState, reduceAreaSearchState } from './geoAreaSearchState'
import { minZoomForLevel } from './geoAttractionOverlay'
import { useAttractionOverlays } from './useAttractionOverlays'
import { useSearchResultMarkers } from './useSearchResultMarkers'
import { useTripEntryMarkers } from './useTripEntryMarkers'
import styles from './GeoOutlineMap.module.css'

// 地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)——桌面版。
//
// 空旅程、任何候選點出現之前,地圖先浮現一層純定向的地理輪廓:重心光暈
// 搭配白話地名標籤,暗示城市大致分成幾個有名字的區塊,區塊間用延遲淡入
// 的極淡連線帶出分鐘制的相對方位與距離(此處先用約略公里數,分鐘制估算
// 留待接上真實路網資料再補)。
//
// 嚴守構想 6 定案的文案界線:只回答「這城市長什麼樣」,不做排序、不帶
// 推薦語氣——每個光暈只有地名標籤與(可選的)圓形地標縮圖,不顯示評分、
// 不排名次。
//
// 底圖繪製方式:自訂 Cloud-based Map Style(見下方 mapId)的極簡 Google
// 地圖上,用 google.maps.OverlayView 疊 HTML(光暈 div + 地標圓形圖 +
// 標籤),而非 google.maps.marker.AdvancedMarkerElement——構想 6 要的是
// 「一團光暈+白話標籤」的複合視覺,不是單點 icon,OverlayView 能自由疊放
// 任意 DOM 結構並跟著地圖縮放/平移自動重新定位。
//
// 地圖外觀樣式原本用行內 MINIMAL_MAP_STYLE(google.maps.MapTypeStyle[])
// 設定,改用 AdvancedMarkerElement(見 mapMarkers.ts 的 searchResultMarkerContent
// 等函式)之後已改走 Cloud-based Map Style(GCP Console → Maps Platform → Map
// Management 建立,mapId 見下方 ensureOptionsSet 呼叫處)——Google 官方
// 規定:地圖一旦帶 mapId,行內 styles 陣列會被完全忽略且不會報錯,故
// MINIMAL_MAP_STYLE 已移除,不再是「兩份樣式各自維護卻只有一份生效」的
// 潛在陷阱。原本 12 條規則(POI/行政邊界/地貌配色等)已原樣搬進 Console
// 的 Map Style,設計意圖不變:見本檔案開頭「構想 6」的說明,地圖只回答
// 「這城市長什麼樣」,低飽和度暖色系,不搶過光暈與標籤的視覺焦點。

// CATEGORY_TAGS:地圖上方類別標籤列的定義——type 值同時是
// GeoGeocodeCandidate.category 的值域(景點/飯店/餐廳,見該欄位的完整
// 說明,決定 marker 圖示)。
const CATEGORY_TAGS: { type: string; label: string; Icon: typeof Hotel }[] = [
  { type: 'tourist_attraction', label: '景點', Icon: MapPin },
  { type: 'lodging', label: '飯店', Icon: Hotel },
  { type: 'restaurant', label: '餐廳', Icon: UtensilsCrossed },
]

// SEARCH_BOX_CATEGORY_LABELS:CATEGORY_TAGS 的 type 對應到要填進搜尋框
// 的查詢文字——三顆標籤(景點/飯店/餐廳)統一改成「標籤文字當查詢詞、
// 寫入搜尋框、觸發搜尋」的行為(見 handleCategoryClick 的完整說明),不
// 再有 fetchGeoPlacesNearby(Nearby Search)那條路徑,也不再有「再點一次
// 取消選取」的機制——直接沿用 CATEGORY_TAGS 的 label,理由是標籤文字
// 本身就是最直覺的搜尋關鍵字,不需要另外維護一份對照。
const SEARCH_BOX_CATEGORY_LABELS: Record<string, string> = {
  tourist_attraction: '景點',
  lodging: '飯店',
  restaurant: '餐廳',
}

// EXPLORE_CATEGORY:「探索」標籤的識別值,跟 CATEGORY_TAGS 共用同一顆
// activeCategory state 判斷選取態、共用同一套「點下去查、再點一次取消」
// 互動語意(見 handleCategoryClick/handleExploreClick 的說明),但不放進
// CATEGORY_TAGS 陣列本身——探索標籤查的是完全不同的資料來源(自建景點
// 區域 attraction,見 fetchGeoAttractionsOnlyNearby,免費、查自家
// 資料庫),CATEGORY_TAGS 三顆標籤現在統一觸發城市搜尋框查詢(見
// SEARCH_BOX_CATEGORY_LABELS 的說明),兩者互動語意已經分道揚鑣,活躍態
// 判斷式(activeCategory === EXPLORE_CATEGORY)之後只服務探索標籤本身。
const EXPLORE_CATEGORY = 'attraction'

// themeToColorScheme:把這個 App 自己的三態主題偏好(theme.ts 的 Theme,
// 見該檔案說明)轉成 Google Maps JS API 的 colorScheme 建圖選項——官方
// 文件明確規定 colorScheme 只能在 new google.maps.Map(...) 當下設定,
// 建圖之後再改完全無效("setting this option after the map is created
// will have no effect"),故這個轉換結果只會被下方建圖 effect 讀取一次,
// 不是能動態套用的選項。
//
// null(這個 App 的「跟隨系統」)在 Google 這邊沒有「跟隨這個 App 自己的
// CSS media query 邏輯」這個選項可選,只有 LIGHT/DARK/FOLLOW_SYSTEM
// (跟隨瀏覽器/OS 層級偏好)三選一——這裡選 FOLLOW_SYSTEM 是合理的退化
// 方案:這個 App 的「跟隨系統」本身也是透過瀏覽器 prefers-color-scheme
// media query 實現(見 theme.ts 開頭說明,null 時不寫 data-theme 屬性,
// 交給 CSS 判斷),語意上跟 Google Maps 的 FOLLOW_SYSTEM(同樣讀瀏覽器/
// OS 層級偏好)一致,不會出現「App 本體跟著系統走,地圖卻沒有」的不
// 同步情況。
function themeToColorScheme(theme: Theme): 'LIGHT' | 'DARK' | 'FOLLOW_SYSTEM' {
  if (theme === 'dark') return 'DARK'
  if (theme === 'light') return 'LIGHT'
  return 'FOLLOW_SYSTEM'
}

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

// sameAttractionsContent:比對兩批查詢結果的內容是否完全相同(依名稱+
// 座標組成的字串逐筆比對,足以判斷「這就是同一批資料」),供依可視範圍
// 查詢完成時判斷要不要真的替換 state——見該處 useEffect 的說明,避免地圖
// 移動一下又移回來、或新舊查詢半徑重疊涵蓋同一批資料時,內容明明相同卻
// 無條件換新陣列參照,讓景點區域光暈不必要地整批重建、閃爍。
function sameAttractionsContent(a: GeoAttraction[], b: GeoAttraction[]): boolean {
  if (a.length !== b.length) return false
  return a.every((d, i) => d.name === b[i].name && d.lat === b[i].lat && d.lng === b[i].lng)
}

export function GeoOutlineMap({
  cfg,
  initialCenter,
  tripEntries = [],
  city,
  onCityChange,
  onSearch,
  searching,
  searchError,
  onOpenChat,
  showZoomControl = true,
  searchRightSlot,
  onAttractionsChange,
  revealedAttractionNames,
  hoveredCuratedName,
  onGeocodeCandidatesChange,
  onSearchStart,
  hideCategoryTags,
  onActiveCategoryChange,
  onAttractionSelect,
  onSearchResultSelect,
  onPoiSelect,
  onCenterChange,
  panTarget,
  selectedKey,
  candidateKeys,
  hoverKey,
  geocodeCandidates: geocodeCandidatesProp,
  theme,
}: {
  cfg: ClientConfig
  // initialCenter:地圖第一次建立時該用的中心點——undefined 代表呼叫端
  // 還在查詢「這個旅程有沒有既有地點可以當初始中心」(見
  // GeoOutlinePanel.tsx 的 tripCenterPanTarget),此時地圖建立要等待,
  // 不能先用預設值建起來、查完才用 panTarget 再移動一次過去:那樣會
  // 白白查一次「移動前那個位置」的資料(見下方查詢 effect 的說明),
  // 移動後那次查詢又可能因為 panTarget 的 suppressQuery 被抑制,導致
  // 使用者進頁面時地圖上什麼資料都沒有,要等他自己動一下地圖才觸發
  // 查詢。null 代表已確定查無可用的初始中心(沒有旅程、或旅程沒有帶
  // 座標的既有地點),這時退回寫死的預設值。物件代表確定要用這組座標
  // 當初始中心,直接建圖在那裡,一步到位、只查一次正確範圍的資料。
  initialCenter?: { lat: number; lng: number } | null
  // tripEntries:目前旅程本身已有座標的 entry(見 GeoOutlinePanel.tsx 查詢
  // tripCenter 時一併保留的完整清單)——這批點要顯示在地圖上(見下方
  // 畫 marker 的 effect),讓使用者看得到「這趟旅程已經排進候選籃/日
  // 層架的地點跟這座城市其他景點的相對位置關係」,不只是拿來算初始
  // 定位而已。跟 hotels/places 不同,這批資料不是「以地圖範圍為準」
  // 查詢的結果,是旅程本身固定的內容,換旅程才會變。
  tripEntries?: GeoTripEntry[]
  // city/onCityChange/onSearch/searching/searchError:城市搜尋框,顯示在
  // 地圖上方類別標籤列旁邊(見下方 JSX)——跟 GeoCandidateSidebar 側欄裡
  // 原本就有的同一組搜尋框(見該元件的 city/onCityChange/onSearch prop)
  // 共用同一份輸入值與查詢邏輯(GeoOutlinePanel.tsx 的 searchTrigger
  // effect,由 DesktopLayout.tsx 的 geoSearchCity state 中介),這裡只是
  // 多一個不需要先展開候選籃就能觸發搜尋的入口,不是獨立的第二套搜尋
  // 狀態。全部 optional——呼叫端(/demo/pace 等其他掛載 GeoOutlineMap 的
  // 情境,若未來出現)可以選擇不接這組 prop,此時不渲染搜尋框。
  city?: string
  onCityChange?: (city: string) => void
  onSearch?: () => void
  searching?: boolean
  searchError?: string | null
  // onOpenChat:搜尋框膠囊左側的 AI 按鈕觸發——不是獨立的對話 UI,而是
  // 常駐右側對話欄(DesktopLayout.tsx 的 .desktop-sidepanel)收合時的
  // 快捷展開入口,對應 DesktopRail 上 PanelLeft 圖示按鈕的同一個
  // chatCollapsed/onToggleChat 開關,只是多一個離地圖操作更近的入口。
  // optional——理由同 onCityChange 等搜尋框 props,呼叫端沒接就不顯示
  // 這顆按鈕。
  onOpenChat?: () => void
  // showZoomControl:地圖右下角放大/縮小按鈕,預設 true(桌面版沿用原本
  // 行為)。手機版可以傳 false 隱藏——手機本來就能雙指縮放,這顆按鈕在
  // 小螢幕上顯得多餘、佔用畫面空間(使用者要求「地圖可以隱藏縮放按鈕
  // 嗎」)。跟 mapId 等其他建圖參數一樣只在地圖第一次建立時讀取一次
  // (見下方 new Map 呼叫處),不在 useEffect 依賴陣列裡,執行期間改變
  // 這個 prop 不會觸發重新建圖。
  showZoomControl?: boolean
  // searchRightSlot:搜尋框膠囊最右側的額外內容(optional)——手機版拿來
  // 放使用者頭像(GeoOutlinePhoneView.tsx),讓頭像變成搜尋框自己的
  // flexbox 子元素,交給 .citySearch 既有的 display:flex; align-items:
  // center; gap 自動對齊,不需要另外用絕對定位疊加、手動計算座標猜位置
  // (之前的做法,見 GeoOutlinePhoneView.module.css 的歷史說明,實測數值
  // 一直對不準)。桌面版不傳這個 prop,渲染行為完全不受影響。 */
  searchRightSlot?: ReactNode
  // onAttractionsChange:每當地圖可視範圍(bounds)查詢有新結果時,回報
  // 目前地圖上實際顯示的景點區域清單——側欄(GeoHotelSidebar,見
  // DesktopLayout.tsx)渲染在整個桌面版介面最外側、不是這個地圖元件的
  // 子節點,清單要跟著地圖範圍同步,只能靠這個 callback 往上回報,而
  // 不是側欄自己重新查一次(bounds 只有地圖實例本身知道)。
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  // revealedAttractionNames:原封不動轉傳給 useAttractionOverlays——目前
  // 應該在地圖上顯示的精選點名稱集合,由呼叫端(DesktopLayout.tsx)算好
  // 傳入,見該處與 useAttractionOverlays.ts 的完整說明。
  revealedAttractionNames?: Set<string> | null
  // hoveredCuratedName:原封不動轉傳給 useAttractionOverlays——見該處對
  // 這個 prop 的完整說明。
  hoveredCuratedName?: string | null
  // onGeocodeCandidatesChange:地圖上方類別標籤(景點/飯店/餐廳)寫入
  // 搜尋框、觸發搜尋後,或「搜尋這個區域」按鈕按下後,runPlacesQuery
  // 查詢完成時觸發——這個元件原本自己用 useState 存一份 places,跟
  // GeoOutlinePanel.tsx 持有的 geocodeCandidates(城市搜尋框查到的候選)
  // 是兩份幾乎重複的 state(型別也曾經是兩個幾乎重複的 interface,見
  // api.ts GeoGeocodeCandidate 合併 GeoPlace 的完整說明),只是分別由
  // 不同觸發來源寫入。2026-08 起收斂成 GeoOutlinePanel.tsx 唯一持有的
  // 單一 geocodeCandidates state,這個元件改為受控——查詢完成後透過這個
  // callback 通知呼叫端更新它自己的 state,而不是自己再 setState 一份;
  // 這裡因此不再需要，也不能再持有一份平行的 places state。呼叫端據此
  // 才能乾淨地寫出「搜尋框文字清空時連動清空地圖結果」這條規則(見
  // GeoOutlinePanel.tsx 的說明)——先前這條規則沒辦法乾淨地寫,正是因為
  // 地圖結果分裂成兩份 state、其中一份活在這個元件裡,沒有直接存取
  // city 清空的必要性。
  onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
  // onSearchStart:runPlacesQuery 真正發出查詢請求前觸發——地圖上方
  // 類別標籤/「搜尋這個區域」按鈕都經由 runPlacesQuery 這個唯一匯合點
  // 觸發查詢(見該函式的說明),在函式最開頭呼叫這個 callback,兩個入口
  // 因此自動共用同一個「查詢開始」時機,不需要在 handleCategoryClick/
  // handleSearchThisArea 各自呼叫、容易漏掉(城市搜尋框走的是完全不同
  // 的路徑,見 GeoOutlinePanel.tsx 的 onSearch,不經過這個函式)。呼叫端
  // (GeoOutlinePhoneView.tsx)用這個時機把 listLoading 設 true、把
  // {type:'list'} push 進 sheetStack,讓地點清單抽屜在使用者按下查詢的
  // 當下就打開、顯示載入中,不用等查詢結果回來。
  onSearchStart?: () => void
  // hideCategoryTags:類別標籤列(景點/飯店/餐廳/探索)是否隱藏——手機版/
  // 桌面版共用同一個狀態機 geoCategoryTagsState.ts 算出來的
  // categoryTagsState.hidden(見該檔案的完整說明:search-started 立刻
  // 隱藏,不等結果回來;results-arrived 依結果是否為空決定要不要重新
  // 顯示;user-closed 重新顯示)——這個元件本身不知道也不需要知道上游
  // 是不是一個 reducer,單純吃一個布林值,呼叫端(GeoOutlinePhoneView.tsx/
  // DesktopLayout.tsx)各自 dispatch 同一個 reducer 後傳入。未傳這個
  // prop 時預設 undefined,標籤列一律顯示(理論上兩個呼叫端現在都會傳,
  // 保留這個預設值純粹是防呆)。
  hideCategoryTags?: boolean
  // onActiveCategoryChange:上方類別標籤列(飯店/景點/餐廳,見
  // handleCategoryClick)目前選中的類別往上回報,null 代表沒有任何類別
  // 標籤被選取。側欄「附近推薦」分頁標題/空狀態文字要能反映「目前顯示
  // 的是哪個類別的結果」(例如選了餐廳標籤時顯示「餐廳」而非籠統的
  // 「附近推薦」),這個回報讓側欄不必自己猜測 geocodeCandidates 陣列
  // 內容屬於哪個類別。
  onActiveCategoryChange?: (category: string | null) => void
  // onAttractionSelect:使用者直接點擊地圖上的地標圖示時觸發(而非透過
  // 側欄清單),把該項目往上回報——側欄(GeoHotelSidebar)要能同步標記
  // 選取狀態、切換到對應分頁並顯示該項目的介紹(見 DesktopLayout.tsx 的
  // 串接),但側欄跟這個地圖元件是分開掛載的 sibling,只能靠這個
  // callback 往上回報。從 useAttractionOverlays.ts 既有的
  // handleAttractionClick 點擊入口呼叫這個 callback,不是另外新增一個
  // 獨立的點擊處理路徑。
  onAttractionSelect?: (attraction: GeoAttraction) => void
  // onSearchResultSelect:使用者直接點擊地圖上的飯店/推薦地點/搜尋結果
  // marker 時觸發(而非透過側欄清單)——原本是 onHotelSelect/
  // onPlaceSelect/onGeocodeCandidateSelect 三個各自獨立的 callback,理由
  // 同 onSearchResultsChange,收斂成單一 callback,呼叫端依
  // GeoSearchResult.kind 判斷來源即可,不需要三套各自的處理函式。
  onSearchResultSelect?: (result: GeoSearchResult) => void
  // onPoiSelect:使用者點擊底圖上 Google 原生繪製的 POI 圖標(不是上面
  // 三個 callback 對應的自訂 marker/overlay)時觸發——地圖 click 事件
  // 本身只給得出一個 placeId,沒有名稱/地址/介紹等資料(見
  // IconMouseEvent 的說明),故在這個元件內部直接用 cfg 呼叫
  // fetchGeoPlaceDetails 查完整詳細資訊,才把查好的結果往上回報,而不是
  // 只傳一個 ID 讓外層自己決定何時查詢——這個元件本來就持有 cfg,沒有
  // 理由把查詢責任推給不見得拿得到 cfg 時機的呼叫端。
  onPoiSelect?: (details: GeoPlaceDetails) => void
  // onCenterChange:地圖 idle(拖曳/縮放動畫結束)時,把目前中心座標往上
  // 回報——供 GeoOutlinePanel.tsx 的城市搜尋框使用,讓「甜點」「apple」
  // 這類沒有明確指向單一地點的泛用關鍵字查詢,能帶上目前地圖中心當
  // locationBias(見 handleGeoGeocode 的完整說明),優先偏向這個區域的
  // 結果,而非全球知名度最高的結果。
  onCenterChange?: (center: { lat: number; lng: number }) => void
  // panTarget:使用者在搜尋框查到城市座標、或在 GeoHotelSidebar 點擊某個
  // 飯店/地點項目時要移動地圖到的座標——每次(即使連續觸發同一個目標)
  // DesktopLayout/GeoOutlinePanel 都會建立新的物件參照,故這裡直接把整個
  // 物件放進 useEffect 依賴陣列即可正確偵測到「這是一次新的移動請求」,
  // 不需要額外的序號/時間戳欄位。level 只有點擊「地點」(GeoAttraction)
  // 才會帶,飯店(GeoHotel)與城市搜尋定位都沒有 level 概念,固定不帶——
  // 見下方 useEffect,只有帶 level 時才會額外呼叫 setZoom 把縮放層級拉到
  // 能顯示該地點的最小尺度(minZoomForLevel),純平移(panTo)本身不會
  // 改變 zoom,若目前 zoom 太小、該地點根本沒被畫出來(見
  // filteredAttractions 的篩選),不強制調整 zoom 只會移動到一個看起來
  // 空空如也的地圖。
  //
  // suppressQuery:這次移動完成後,平移動畫結束觸發的 idle 事件要不要
  // 跳過「冒出搜尋這個區域按鈕」(見 areaSearch/geoAreaSearchState.ts 的
  // 說明)——true 用於「使用者只是想對齊看清楚/選中一個已知項目」的
  // 移動(側欄點擊、旅程初始定位),資料範圍通常沒有實質改變,不該冒出
  // 按鈕暗示「這裡有新範圍待查詢」;false(或不帶,預設當 false)用於
  // 「使用者明確想換一個地方看」的移動(搜尋城市),該讓按鈕冒出來提示
  // 使用者可以查詢這個新範圍——這正是由呼叫端決定該不該抑制,而不是
  // 這裡憑空猜測,因為只有呼叫端知道這次移動背後的使用者意圖是什麼。
  //
  // radiusMeters:呼叫端(DesktopLayout.tsx)算好最終半徑後帶入(呼叫
  // planAttractionClick 決策,不在這個元件內部重新呼叫該決策函式)。有值
  // 時用 fitBounds 縮放到剛好 framing 這個半徑的範圍,取代原本的
  // panTo+setZoom(level)行為;level 若同時存在會被忽略,因為 fitBounds
  // 本身就是更精確的縮放依據。點擊地圖上的地標圖示本身
  // (useAttractionOverlays.ts 的 handleAttractionClick)不再觸發任何
  // 地圖移動,只開介紹卡,見該函式的說明。2026-08:AttractionInfoPanel
  // 的「探索周邊」按鈕(這個分支原本唯一的呼叫來源)已移除,目前沒有
  // 呼叫端會傳入帶 radiusMeters 的 panTarget,這個分支保留給未來其他
  // 需要 fitBounds 的入口使用,不因暫時沒有呼叫端就刪除。
  //
  // onlyIfOutOfView:true 時,先用目前的 bounds.contains 檢查該座標是否
  // 已經在可視範圍內,在範圍內就完全跳過這次 panTo(維持地圖不動)——
  // 供 GeoHotelSidebar 側欄清單點擊項目本體使用(見 DesktopLayout.tsx
  // 的 onSelectHotel/onSelectPlace):清單項目本來就是目前地圖範圍查出來
  // 的結果,理論上多半已經在畫面上,只有極少數「範圍剛好在查詢完成後
  // 移動過」的邊界情況才需要真的移動;沒有帶這個欄位(或帶 false)的
  // 其餘來源(候選籃、探索周邊、搜尋城市)維持既有行為,一律無條件
  // panTo,不受這裡影響。bounds 為 null(地圖剛掛載、還沒收到第一次
  // bounds_changed)時視為「無法判斷是否在範圍內」,保守起見仍執行
  // panTo,不因為判斷不了就默默跳過移動。
  panTarget?: {
    lat: number
    lng: number
    level?: number
    radiusMeters?: number
    suppressQuery?: boolean
    onlyIfOutOfView?: boolean
  } | null
  // selectedKey:目前被選中的飯店/地點識別鍵(見 GeoHotelSidebar.tsx 的
  // geoItemKey)——由 DesktopLayout.tsx 中介,驅動下方地標/飯店圖示畫出
  // 對應的選取樣式(外圈 accent 描邊 + 放大),與側欄的選取標記同步。
  selectedKey?: GeoSelectedKey
  // candidateKeys:目前候選籃裡有哪些項目的識別鍵集合(同樣用
  // GeoHotelSidebar.tsx 的 geoItemKey 產生,由 DesktopLayout.tsx 中介)
  // ——只涵蓋使用者手動用「+」加入候選籃的三種來源(飯店/景點區域/
  // 附近推薦),旅程本身已有座標的 entry(tripEntries)雖然也會自動併入
  // 候選籃資料結構,但那批本來就有自己的旗子圖示語意(見
  // tripEntryMarkerContent 的說明——「已排進行程」跟「候選中」是不同概念),
  // 不需要再疊加候選籃徽章,故這裡刻意只給前三種圖層用,不比對
  // tripEntries。用 Set 而非陣列,是因為下方每個 marker/overlay 建立時
  // 都要做一次成員檢查,Set.has() 是 O(1),陣列 includes 在候選籃項目
  // 一多時會是重複的 O(n) 掃描。
  candidateKeys?: Set<string>
  // hoverKey:滑鼠移到側欄(GeoHotelSidebar/GeoCandidateSidebar)項目上時
  // 的臨時識別鍵,由 DesktopLayout.tsx 中介——跟 selectedKey 是兩個獨立
  // 狀態(見下方各處 selected 判斷式,兩者用 || 合併):selectedKey 是
  // 「使用者點擊確定要看哪一項」的持續狀態,hoverKey 是「滑鼠移過去暫時
  // 預覽」的臨時狀態,滑鼠移開後 hoverKey 應該回到 null、但不能連帶清掉
  // selectedKey(否則使用者原本點選的項目會在滑過其他項目後意外失去
  // 選取樣式)。命名/型別沿用 selectedKey 同一套 GeoSelectedKey(單一
  // 字串或 null),不需要另外定義型別。
  hoverKey?: GeoSelectedKey
  // geocodeCandidates:GeoOutlinePanel.tsx 唯一持有的搜尋結果 state——
  // 城市搜尋框(GeoCandidateSidebar 那個自訂輸入框,見該元件的說明)/
  // 地圖上方類別標籤/「搜尋這個區域」按鈕三個入口查到的候選統一收在這裡
  // (fetchGeoGeocode 回傳候選陣列,見 api.ts 的 GeoGeocodeCandidate),
  // 畫成可點擊的候選 marker 並 fitBounds 到能同時看見所有候選的範圍——
  // 空陣列(預設)代表沒有待確認的候選,不畫任何東西。這個元件本身是
  // 受控元件,不再自己持有一份平行的 state:類別標籤/「搜尋這個區域」
  // 觸發的查詢完成後,改透過 onGeocodeCandidatesChange 通知呼叫端更新
  // 這份 state(見該 callback 的完整說明)。
  geocodeCandidates?: GeoGeocodeCandidate[]
  // theme:這個 App 的深色/淺色模式偏好(見 theme.ts),決定建圖時傳給
  // Google Maps 的 colorScheme(見 themeToColorScheme 的完整說明)——
  // mapId 底下的 Cloud-based Map Style 現在同時綁定明暗兩份樣式,SDK 靠
  // colorScheme 決定套用哪一份。colorScheme 只能在建圖當下決定、事後無法
  // 動態改變(Google 官方文件明講),故這個 prop 變動時,下方建圖 effect
  // 必須整個重建地圖(銷毀舊實例、建立新實例),不是單純更新某個選項——
  // 見下方建圖 effect 對 builtColorSchemeRef 的說明,重建過程中會把
  // mapReady 先設回 false 再設回 true,讓 useAttractionOverlays/
  // useSearchResultMarkers/useTripEntryMarkers 與 panTarget effect(皆以
  // mapReady 為依賴項)重新綁定到新的地圖實例上。呼叫端
  // (GeoOutlinePanel.tsx/GeoOutlinePhoneView.tsx)一路從 useAppState() 的
  // theme 往下傳;公開分享頁(PaceRouteMap.tsx/PublicViewScreen.tsx 等)
  // 目前未引用這個元件,不需要處理「固定淺色」的情境,見呼叫端說明。
  // 預設 null(跟隨系統)——理由同其餘 optional props 給合理預設值的
  // 慣例,不強制每個呼叫端都要接這個 prop。
  theme?: Theme
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  // onPoiSelectRef:建立地圖的 effect 只在掛載時執行一次(依賴陣列見
  // 下方 [apiKey, initialCenter]),裡面註冊的 click listener 若直接閉包
  // 捕捉 onPoiSelect,呼叫端(DesktopLayout.tsx)每次重渲染傳入新的內聯
  // 函式參照時不會被那個 effect 感知到、永遠呼叫到掛載當下那一份舊值。
  // 用 ref 存最新版本,click listener 內透過 .current 讀取,不需要把
  // onPoiSelect 加進建圖 effect 的依賴陣列(那樣反而會導致地圖重建)。
  const onPoiSelectRef = useRef(onPoiSelect)
  onPoiSelectRef.current = onPoiSelect
  // onCenterChangeRef:理由同 onPoiSelectRef——idle listener 註冊在只
  // 執行一次的建圖 effect 裡,需要用 ref 讀取最新的 callback 參照。
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  const [err, setErr] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // zoom:即時反映地圖目前縮放層級,傳給 useAttractionOverlays 依
  // maxLevelForZoom 篩選要顯示哪些知名度分級的地標(見該 hook 的
  // filteredAttractions 說明)。初始值對齊 Map 建構時的 zoom: 12(見下方
  // useEffect)。
  const [zoom, setZoom] = useState(12)
  // bounds:即時反映地圖目前可視範圍,供下方 panTarget effect 的
  // onlyIfOutOfView 判斷使用(見該欄位的完整說明)。初始 null——地圖剛
  // 掛載、還沒收到第一次 bounds_changed 前視為「無法判斷是否在範圍
  // 內」。搜尋結果(飯店/地點/搜尋結果)不再用這份 bounds 即時篩選要
  // 顯示的清單/marker——理由見下方 searchResults 的說明,清單改回查詢
  // 完成時的靜態快照,拖曳地圖不會讓清單/marker 跟著瘦身,這是實際
  // 發生過的 bug(清單項目永遠已經在畫面內,清單點擊的移動地圖邏輯
  // 因此形同虛設)。
  const [bounds, setBounds] = useState<google.maps.LatLngBounds | null>(null)
  // attractions:改成這個元件內部管理(不再是外部傳入的完整清單再篩選),
  // 由下方「依可視範圍查詢」的 effect 寫入——景點區域是「以地圖可視範圍
  // 為準」查詢的結果,查詢責任收在地圖元件自己身上(只有它知道當下的
  // bounds),搜尋框(GeoOutlinePanel.tsx)只負責把座標查出來、透過
  // panTarget 移動地圖,不再自己查一份完整清單。
  const [attractions, setAttractions] = useState<GeoAttraction[]>([])
  // searchResults:geocodeCandidatesProp(城市搜尋框/類別標籤/「搜尋這個
  // 區域」按鈕查到的候選,由 GeoOutlinePanel.tsx 唯一持有並傳入,見該
  // prop 的完整說明)轉成 GeoSearchResult 後的陣列——供下方
  // useSearchResultMarkers 畫單一 marker 圖層,也是往上回報給
  // onSearchResultsChange 的內容(見 api.ts GeoSearchResult 的完整說明)。
  // 這個元件原本還自己持有一份 places state(類別標籤/「搜尋這個區域」
  // 觸發的查詢結果),跟 geocodeCandidatesProp 合併成這份陣列;2026-08
  // 起 places 收斂進 geocodeCandidatesProp 這唯一一份資料來源(查詢完成
  // 改透過 onGeocodeCandidatesChange 通知呼叫端更新,見該 callback 的
  // 完整說明),這裡不再需要合併兩個陣列,單純轉換型別即可,故用
  // useMemo 而非額外一個 state 手動同步。
  const searchResults = useMemo<GeoSearchResult[]>(
    () => (geocodeCandidatesProp ?? []).map(geocodeCandidateToSearchResult),
    [geocodeCandidatesProp],
  )
  // areaSearch:「搜尋這個區域」按鈕的顯示/查詢中狀態,轉換邏輯抽成純
  // reducer(見 geoAreaSearchState.ts,可獨立於 Google Maps SDK 單元測試)
  // ——areaDirty 為 true 時在地圖上方顯示該按鈕(見下方 render 區),
  // searching 為 true 時按鈕的放大鏡圖示換成載入圈圈。初始值兩者皆
  // false:掛載當下地圖還沒被使用者移動過,不該一開始就顯示「搜尋這個
  // 區域」(那時候還沒有「新範圍待查詢」這件事)。
  const [areaSearch, setAreaSearch] = useState(initialAreaSearchState)
  // suppressNextIdleQueryRef:panTarget 觸發的 panTo(側欄點擊、搜尋框
  // geocode)不該讓接下來那次 idle 把 areaDirty 設成 true、冒出「搜尋這個
  // 區域」按鈕——使用者只是想對齊看清楚/選中一個已知項目,不是主動探索
  // 新範圍(見下方處理 panTarget 的 useEffect 如何設這個旗標)。用 ref 而
  // 非 state,因為它只是單次事件間的旗標,不需要驅動任何渲染。
  const suppressNextIdleQueryRef = useRef(false)
  // buildingRef:見下方地圖建立 effect 裡的完整說明——擋住
  // importLibrary('maps') resolve 之前,effect 因 initialCenter 從
  // undefined 解析成確定值而重新執行時,誤判成「還沒建過圖」而重複
  // 建圖、重複掛監聽器的非同步競態。
  const buildingRef = useRef(false)
  // builtColorSchemeRef:記住目前 mapRef.current 這個地圖實例建立當下
  // 使用的 colorScheme——colorScheme 只能在建圖當下決定、事後無法動態
  // 改變(見 themeToColorScheme 的完整說明),故 theme prop 改變時,下方
  // 建圖 effect 不能只是「已經建過圖就跳過」,必須先判斷這次重新執行是
  // 不是因為 colorScheme 真的變了——是的話才需要銷毀舊實例、整個重建;
  // 不是的話(例如純粹因為別的依賴項變動而重新執行,理論上不會發生,
  // 但保守起見仍判斷)維持原本「已建過圖就跳過」的既有 guard。初始值
  // null 代表「尚未建過圖」,與任何合法的 colorScheme 字串都不同,確保
  // 第一次建圖一定會執行。
  const builtColorSchemeRef = useRef<string | null>(null)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  useEffect(() => {
    if (!apiKey) {
      setErr('未設定 VITE_GOOGLE_MAPS_API_KEY(見 web/.env.development.local)')
      return
    }
    if (!containerRef.current) return
    const colorScheme = themeToColorScheme(theme ?? null)
    // mapRef.current 已存在代表地圖已經建立過——這個 effect 依賴陣列
    // 包含 initialCenter(見下方),當它從 undefined 解析成確定的值(或
    // null)時會重新執行一次,這裡要擋掉重複建圖,只在第一次(尚未建立
    // 過)真正呼叫 new Map()。theme 改變(colorScheme 跟著變)是唯一的
    // 例外——colorScheme 只能在建圖當下決定、事後無法動態改變(見
    // themeToColorScheme 的完整說明),故這裡要先判斷這次重新執行是不是
    // 「已經建過圖,但 colorScheme 真的變了」,是的話銷毀舊實例、整個
    // 重建,不是的話才維持原本「已建過圖就跳過」的既有 guard。
    if (mapRef.current && builtColorSchemeRef.current === colorScheme) return
    if (buildingRef.current) return
    // 這個判斷本身無法擋住非同步競態:mapRef.current 要等
    // importLibrary('maps').then() 真正 resolve 才會被賦值,若 effect 在
    // 那之前又因為 initialCenter 從 undefined 解析成 null/物件而重新
    // 執行(常發生在沒有旅程既有地點、tripCenter 幾乎同步就決議成 null
    // 的情況),第二次執行當下 mapRef.current 仍是 null,一樣會通過這個
    // 判斷、再呼叫一次 importLibrary('maps').then(),建出第二個地圖
    // 實例、掛上第二組 idle/bounds_changed/zoom_changed 監聽器——兩個
    // 實例都停在同一個預設中心,使用者完全感覺不出來地圖被建了兩次,但
    // 之後只要觸發一次 idle,兩組監聽器就會各自重複執行 idle 監聽器裡的
    // 副作用(area-dirty 狀態、onCenterChange 回報等),
    // 且每多重執行一次這個 effect(例如初始資料陸續回來、上層連鎖重渲染)
    // 就再疊一組監聽器,才會出現「進頁面後短時間內連發幾十筆」的爆量
    // 現象。用 buildingRef 在呼叫 importLibrary 之前就同步標記「這次
    // effect 執行已經在建圖了」,擋住後續執行在 mapRef.current 賦值前
    // 搶著再建一次。
    // initialCenter 為 undefined 代表呼叫端還在查「這個旅程有沒有既有
    // 地點可以當初始中心」,地圖建立要等待——見這個 prop 的完整說明。
    if (initialCenter === undefined) return
    // 銷毀舊地圖實例(theme 改變觸發的重建,見上方 guard 判斷):清掉這個
    // effect 掛上去的全部監聽器(google.maps.event.clearInstanceListeners
    // 是官方文件提供的批次清除 API,不需要逐一保存 addListener 回傳的
    // MapsEventListener 再逐一 removeListener)。marker/overlay 圖層不在
    // 這裡清——它們各自的 hook(useAttractionOverlays/
    // useSearchResultMarkers/useTripEntryMarkers)與下方 panTarget effect
    // 都以 mapReady 為依賴項之一,下面把 mapReady 先設回 false 再等新
    // 地圖就緒時設回 true,會讓這些 hook 的清理函式(各自 marker.map =
    // null / overlaysRef 清空)與重新掛載邏輯自然重新跑一輪,不需要在這
    // 裡手動介入它們的 marker 陣列。這裡只負責這個 effect 自己掛的地圖
    // 層級監聽器與地圖實例本身。
    if (mapRef.current) {
      google.maps.event.clearInstanceListeners(mapRef.current)
      mapRef.current = null
    }
    setMapReady(false)
    buildingRef.current = true
    let cancelled = false

    ensureOptionsSet(apiKey)
    // 'marker' library 是 AdvancedMarkerElement 所在的模組,跟 'maps'
    // 分開載入(見官方文件的 importLibrary 分模組設計)——與 'maps' 一起
    // Promise.all 等待,兩者都就緒才真正建圖與畫 marker,不需要為此再拆
    // 一層巢狀 .then()。
    Promise.all([importLibrary('maps'), importLibrary('marker')])
      .then(([{ Map }]) => {
        if (cancelled || !containerRef.current) return
        // 初始中心點:優先用 initialCenter(旅程既有地點的中心,若已確定
        // 有值),查無可用資料(initialCenter 為 null)才退回寫死的東京
        // 預設起點——一步到位直接建圖在正確位置,不再需要「先建圖在
        // 東京、查一次沒用的資料、再 panTo 移動過去」這道多餘手續(那樣
        // 移動後那次查詢還可能因為 panTarget 的 suppressQuery 被抑制,
        // 導致使用者進頁面時地圖上什麼資料都沒有)。
        //
        // mapId:AdvancedMarkerElement 要求地圖必須帶 mapId 才能運作
        // (Google 官方遷移指南明講「Map ID is required for advanced
        // markers」),取代原本行內 styles(見本檔案開頭關於
        // MINIMAL_MAP_STYLE 移除的說明)——外觀改在 GCP Console 的 Map
        // Style 設定,渲染類型選光柵(Raster):AdvancedMarkerElement
        // 光柵、向量地圖皆支援,選光柵維持這裡的地圖渲染行為與改動前
        // 一致,不需要向量地圖才有的旋轉/傾斜能力(那是 PaceRouteMap.tsx
        // 為了導航模式才需要的獨立需求,與這個元件無關)。
        mapRef.current = new Map(containerRef.current, {
          center: initialCenter ?? { lat: 35.0, lng: 135.76 },
          zoom: 12,
          mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string,
          // colorScheme:決定 mapId 底下要套用明/暗哪一份 Cloud-based Map
          // Style(見 themeToColorScheme 的完整說明)——只在建圖當下讀取
          // 一次,事後改變這個選項無效,故 theme prop 改變時是靠上方的
          // 銷毀舊實例、重新執行這個 effect 建新地圖來套用新樣式,不是
          // 靠更新既有地圖實例的某個屬性。
          colorScheme,
          disableDefaultUI: true,
          zoomControl: showZoomControl,
          // gestureHandling 明確設為 'greedy':預設值 'auto' 在
          // panTo/fitBounds(搜尋觸發,見下方 panTarget effect)之後,
          // SDK 內部可能重新判定為 cooperative 模式,導致單指平移失效、
          // 變成要雙指才能拖動地圖。'greedy' 讓單指平移永遠可用,不受
          // 程式化移動地圖影響。
          gestureHandling: 'greedy',
        })
        builtColorSchemeRef.current = colorScheme
        // zoom_changed 監聽器:即時反映使用者拖曳滾輪/點擊縮放控制項
        // 造成的縮放層級變化,驅動 useAttractionOverlays 的
        // filteredAttractions 重新計算。
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
        // bounds_changed 拖曳過程中會連續觸發)。
        //
        // 景點區域(attractions,探索標籤)、地圖上方類別標籤(景點/飯店/
        // 餐廳)與「搜尋這個區域」按鈕查到的地點(見 onGeocodeCandidatesChange)
        // 三者現在統一都不在這裡自動觸發查詢(2026-08 改動前,景點區域
        // 曾經因為免費查自家資料庫而自動跟拖曳/縮放刷新,使用者實測後
        // 明確要求改掉——地圖移動時不該無論查詢種類是否計費都自動重打,
        // 一律統一成同一套「按下才查」的互動語意,不再有例外)。地圖移動
        // 本身只標記「這個範圍還沒查過」(dispatch 'map-idle',見
        // geoAreaSearchState.ts 的說明),在地圖上方冒出「搜尋這個區域」
        // 按鈕,等使用者按下才真的發請求(見 handleSearchThisArea,依
        // activeCategory 決定要重打 runExploreQuery 還是 runPlacesQuery,
        // 或兩者都打)。suppressNextIdleQueryRef 為 true 時跳過這次冒出
        // 按鈕的判斷並消耗掉旗標:這代表這次 idle 是 panTarget 的 panTo
        // 造成的(側欄點擊/搜尋),不是使用者主動拖曳探索新範圍,不該冒出
        // 搜尋按鈕。
        mapRef.current.addListener('idle', () => {
          const center = mapRef.current?.getCenter()
          if (center) onCenterChangeRef.current?.({ lat: center.lat(), lng: center.lng() })
          if (suppressNextIdleQueryRef.current) {
            suppressNextIdleQueryRef.current = false
            return
          }
          setAreaSearch((s) => reduceAreaSearchState(s, { type: 'map-idle' }))
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
        // 訊息打斷使用者,理由同下方 handleCategoryClick 查附近推薦失敗
        // 時的處理方式。
        mapRef.current.addListener('click', (event: google.maps.IconMouseEvent) => {
          if (!event.placeId) return
          event.stop()
          fetchGeoPlaceDetails(cfg, event.placeId)
            .then((details) => onPoiSelectRef.current?.(details))
            .catch(() => {})
        })
        setMapReady(true)
      })
      .catch((e) => {
        // 建圖失敗(模組載入失敗等)才解除 buildingRef——讓之後真的有
        // 機會重新整理/重新掛載時能再試一次,不會被卡死在「永遠不可能
        // 再建成功」的狀態。成功路徑(見上方 setMapReady(true) 之前)
        // 刻意不解除:mapRef.current 已經確定賦值,guard 本來就該一直
        // 擋住後續執行,不需要靠 buildingRef 額外把關。
        buildingRef.current = false
        setErr(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
    // theme 加入依賴陣列:theme prop 改變時要重新執行這個 effect 才能
    // 用新的 colorScheme 重建地圖(見上方 guard 判斷的完整說明)——colorScheme
    // 本身是從 theme 衍生的,不直接放 colorScheme 變數是因為它在每次
    // effect 執行時才計算,放進依賴陣列沒有意義,theme 才是真正驅動變化
    // 的來源值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, initialCenter, theme])

  // 2026-08:移除原本在這裡「依地圖可視範圍自動查詢景點區域」的 effect
  // (attractionsQueryTrigger 遞增驅動,跟拖曳/縮放的 idle 事件自動連動)
  // ——使用者明確要求縮放/移動地圖時不要自動重新查詢景點區域,一律改成
  // 跟地圖上方類別標籤(景點/飯店/餐廳)、Google Places 查詢一致的「按下
  // 搜尋這個區域才查」語意(見 runExploreQuery/handleSearchThisArea)。
  // 探索標籤第一次被點擊時仍會立即查一次目前範圍(runExploreQuery,見
  // handleCategoryClick),之後使用者拖曳/縮放地圖不會再自動觸發,只有
  // 再按一次「搜尋這個區域」才會用新範圍重新查詢。

  // categoryQueryRadiusMeters:類別標籤(景點/飯店/餐廳)與「搜尋這個
  // 區域」按鈕共用的 locationRestriction 矩形半徑——查詢中心是「目前地圖
  // 中心點」,沒有天然的範圍可以依據,故用一個固定的中等半徑,對齊後端
  // geoGeocodeDefaultRestrictRadiusMeters 的預設值(1500m),不特別放大或
  // 縮小。
  const categoryQueryRadiusMeters = 1500

  // runPlacesQuery:以目前地圖中心點為中心、指定查詢文字,呼叫
  // fetchGeoGeocode(mode=restrict,見該函式與後端 handleGeoGeocode 的完整
  // 說明)——地圖上方類別標籤(景點/飯店/餐廳)與「搜尋這個區域」按鈕
  // 統一走這條路徑。查到的候選(GeoGeocodeCandidate)補上呼叫端傳入的
  // category(標籤文字本身就代表類別;「搜尋這個區域」沿用目前搜尋框
  // 文字,不一定對應某個已知類別,此時傳 undefined,對應的 marker 退回
  // 泛用相機圖示,理由同 GeoGeocodeCandidate.category 查無對應分類時的
  // 既有處理)後,透過 onGeocodeCandidatesChange 往上回報——這個元件不再
  // 自己持有一份平行的 places state(見該 callback 的完整說明),改由
  // 呼叫端(GeoOutlinePanel.tsx)的 geocodeCandidates 承接,是這批候選
  // 唯一的資料來源。抽成獨立函式供 handleCategoryClick 與
  // handleSearchThisArea 共用同一份查詢邏輯,不重複維護。
  // placesQueryRequestIdRef:FE24 修法——runPlacesQuery 原本沒有任何機制
  // 標記「這是第幾次查詢」,連續點擊不同類別標籤(例如先點「飯店」、還沒
  // 回來又點「餐廳」)會併發兩支 fetchGeoGeocode 請求,若先發出的「飯店」
  // 比後發出的「餐廳」晚回來,會用舊結果覆蓋掉使用者最後一次點擊、理應
  // 顯示的「餐廳」結果——清單/marker 顯示的內容跟搜尋框當下的文字對不
  // 上,且若先回來的那批剛好只有 1 筆,還會提前把 results-arrived 收掉
  // loading、甚至直接 replace 成資訊卡(見 GeoOutlinePhoneView.tsx 的
  // sheetStack 說明),使用者會看到跟自己點擊順序不符的畫面。
  //
  // 每次呼叫 runPlacesQuery 就遞增這個 ref、記下「這次查詢的序號」,
  // .then()/.catch() 回來時比對序號是否還是目前最新的一次——不是的話代表
  // 呼叫端已經發起過更新的查詢,這批已經過期的結果直接捨棄,不寫入任何
  // state(含 onGeocodeCandidatesChange/setAreaSearch),讓最後一次點擊
  // 永遠贏,不論實際完成順序為何。用 ref(而非 state)是因為這個值只在
  // 事件處理常式與非同步回呼之間傳遞,不需要參與渲染。
  const placesQueryRequestIdRef = useRef(0)
  const runPlacesQuery = useCallback((query: string, category?: string) => {
    if (!mapRef.current || !query.trim()) return
    const center = mapRef.current.getCenter()
    if (!center) return
    onSearchStart?.()
    const requestId = ++placesQueryRequestIdRef.current
    fetchGeoGeocode(cfg, query, { lat: center.lat(), lng: center.lng() }, 'restrict', categoryQueryRadiusMeters)
      .then((result) => {
        if (requestId !== placesQueryRequestIdRef.current) return
        onGeocodeCandidatesChange?.(
          result.candidates.map((c) => ({
            name: c.name,
            address: c.address,
            lat: c.lat,
            lng: c.lng,
            category,
            placeId: c.placeId,
          })),
        )
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-succeeded' }))
      })
      .catch(() => {
        if (requestId !== placesQueryRequestIdRef.current) return
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,不彈錯誤
        // 訊息打斷瀏覽,理由同這個檔案其餘查詢失敗處理的一貫慣例。這裡
        // 額外重置 areaSearch 讓「搜尋這個區域」按鈕重新出現提供重試入口
        // (僅在這是由該按鈕觸發時有意義,由 handleSearchThisArea 決定要不
        // 要呼叫這支函式,這裡不需要另外分辨呼叫來源)。
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-failed' }))
      })
  }, [cfg, onGeocodeCandidatesChange, onSearchStart])

  // activeCategory:目前選中的類別標籤——2026-08 起只剩「探索」
  // (EXPLORE_CATEGORY)會進入這個選取態(見 EXPLORE_CATEGORY 的完整
  // 說明,景點/飯店/餐廳三顆標籤統一改成觸發城市搜尋框查詢,不再使用
  // activeCategory,見 handleCategoryClick 的說明)。null 代表探索未選取。
  // 再點一次探索標籤會取消選取、清空 attractions 圖層——這是使用者想
  // 「不看這批結果了」的自然操作,不需要額外的關閉按鈕。
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // runExploreQuery:探索標籤專用的查詢函式——查自建景點區域(attraction,
  // fetchGeoAttractionsOnlyNearby,免費、查自家資料庫)。半徑用依 zoom
  // 反推的公式——探索標籤查的是「一整個城市層級的景點分區」,天然需要比
  // 景點/飯店/餐廳附近推薦更大的涵蓋範圍。查詢結果寫進 attractions
  // state,並透過 onAttractionsChange 往上回報。由 handleCategoryClick
  // (第一次點選探索標籤)與 handleSearchThisArea(使用者按下「搜尋這個
  // 區域」)共用同一份查詢邏輯——2026-08 起地圖拖曳/縮放不再自動觸發這支
  // 查詢(見下方「搜尋這個區域」按鈕與 idle 監聽器的說明),只有這兩個
  // 明確的使用者動作才會呼叫。
  const runExploreQuery = useCallback(() => {
    if (!mapRef.current) return
    const center = mapRef.current.getCenter()
    if (!center) return
    const radiusMeters = Math.min(50000, 20000 * Math.pow(2, 12 - zoom))
    fetchGeoAttractionsOnlyNearby(cfg, center.lat(), center.lng(), radiusMeters)
      .then((result) => {
        setAttractions((prev) => (sameAttractionsContent(prev, result.attractions) ? prev : result.attractions))
        onAttractionsChange?.(result.attractions)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,理由同這個
        // 檔案其餘查詢失敗處理的一貫慣例。
      })
  }, [cfg, zoom, onAttractionsChange])

  // handleCategoryClick:點擊地圖上方的類別標籤(景點/飯店/餐廳/探索)時
  // 觸發查詢。景點/飯店/餐廳三顆標籤(見 SEARCH_BOX_CATEGORY_LABELS 的
  // 說明)統一改成:把城市搜尋框的輸入值設成標籤文字(onCityChange,比照
  // 這三顆標籤原本就有的既有慣例,讓畫面上的搜尋框內容跟目前查詢的類別
  // 保持一致、選取樣式也能跟隨這個值判斷,見下方 aria-pressed),同時
  // 直接呼叫 runPlacesQuery(mode=restrict,固定套用 locationRestriction,
  // 不需要兩階段、不需要 fallback,見該函式的完整說明)——不透過
  // onSearch()(那會經 DesktopLayout.tsx 的 geoSearchTrigger 流向
  // GeoOutlinePanel.tsx 的 fetchGeoGeocode 呼叫,固定走 bias 模式的兩階段
  // 查詢,不是這裡要的固定 restrict),避免誤觸發一次多餘的 bias 模式
  // 查詢。不再各自打 fetchGeoPlacesNearby(Nearby Search)、不進入
  // activeCategory 選取態、不做「再點一次取消」的判斷(那套邏輯依賴
  // activeCategory,這三顆標籤現在都不使用它),按下即觸發,行為對齊一般
  // 搜尋操作的即時回饋。
  //
  // 探索標籤(EXPLORE_CATEGORY)維持原本的 activeCategory 選取/取消機制,
  // 查的是完全不同的資料來源(自建景點區域,免費),不受這次改動影響。
  const handleCategoryClick = useCallback((type: string) => {
    if (!mapRef.current) return
    const searchBoxLabel = SEARCH_BOX_CATEGORY_LABELS[type]
    if (searchBoxLabel) {
      onCityChange?.(searchBoxLabel)
      runPlacesQuery(searchBoxLabel, type)
      return
    }
    if (activeCategory === type) {
      setActiveCategory(null)
      onActiveCategoryChange?.(null)
      setAttractions([])
      onAttractionsChange?.([])
      return
    }
    setActiveCategory(type)
    onActiveCategoryChange?.(type)
    runExploreQuery()
  }, [activeCategory, onActiveCategoryChange, runExploreQuery, runPlacesQuery, onAttractionsChange, onCityChange])

  // 2026-08:移除原本在這裡「觀察 searchResults 變動、統一往上回報
  // onSearchResultsChange」的 useEffect(含 searchResultsMountedRef 這個
  // 跳過掛載時第一次執行的補丁)——這是 level-triggered 設計,任何寫入
  // geocodeCandidatesProp(城市搜尋框/類別標籤/搜尋這個區域,三個入口
  // 唯一的上游 geocodeCandidates state,見 GeoOutlinePanel.tsx 的
  // 完整說明)的地方都會被誤判成「查詢完成」,已經連續造成過兩次真實
  // bug(元件掛載時被誤觸發、查詢開始前的清空動作被誤判成查詢完成)。
  // 改成 edge-triggered:onSearchResultsChange 現在直接在
  // GeoOutlinePanel.tsx 兩處查詢真正完成的位置呼叫(城市搜尋框的
  // fetchGeoGeocode.then()、onGeocodeCandidatesChange 的 wrapper),不
  // 再依賴這個元件觀察衍生 state 變化才知道要不要通知——這個元件因此
  // 不再需要持有/回報 onSearchResultsChange,searchResults 這個 useMemo
  // (見上方宣告)只留給 useSearchResultMarkers 畫圖層使用。

  // handleSearchThisArea:「搜尋這個區域」按鈕的點擊處理——進入查詢中
  // 狀態、收起按鈕(見 geoAreaSearchState.ts 的 search-pressed 轉換)。
  // 這顆按鈕現在的顯示條件是「搜尋框有文字」+「地圖被拖曳/縮放過」(見
  // 下方 render 區 areaSearch.areaDirty 的判斷式與該欄位的完整說明),不
  // 再依賴 activeCategory——景點/飯店/餐廳三顆標籤已經不進入
  // activeCategory 選取態(見 handleCategoryClick 的說明),原本「僅在已
  // 選類別標籤時顯示」的條件不再成立。
  //
  // 按下後沿用「搜尋框目前的文字」(city prop,這顆按鈕只在該文字非空時
  // 才會顯示,見下方顯示條件,故這裡不需要另外處理空字串情境)重新以
  // 目前地圖中心呼叫 runPlacesQuery(mode=restrict)。category 反查
  // SEARCH_BOX_CATEGORY_LABELS(搜尋框文字剛好等於某個類別標籤的文字時,
  // 例如使用者剛點過景點/飯店/餐廳標籤、還沒手動改過搜尋框內容),讓
  // marker 圖示維持該類別的專屬圖案(見 mapMarkers.ts 的
  // PLACE_CATEGORY_GLYPHS);查不到對應類別(使用者手動輸入「甜點」這類
  // 泛用關鍵字)則傳 undefined,退回泛用相機圖示,理由同 runPlacesQuery
  // 的說明。探索標籤選中時(EXPLORE_CATEGORY)額外呼叫 runExploreQuery
  // 一併刷新景點區域圖層,對齊改動前的既有行為——這條查詢免費,不因為
  // 新增了 places 查詢就跳過。
  const handleSearchThisArea = useCallback(() => {
    setAreaSearch((s) => reduceAreaSearchState(s, { type: 'search-pressed' }))
    if (activeCategory === EXPLORE_CATEGORY) {
      runExploreQuery()
    }
    const trimmedCity = (city ?? '').trim()
    const matchedCategory = Object.entries(SEARCH_BOX_CATEGORY_LABELS).find(
      ([, label]) => label === trimmedCity,
    )?.[0]
    runPlacesQuery(trimmedCity, matchedCategory)
  }, [activeCategory, runExploreQuery, runPlacesQuery, city])

  // 以下三個圖層(景點區域光暈、搜尋結果、旅程 entry)各自獨立成 hook
  // (見各檔案開頭說明)——每個只讀 mapRef/mapReady/自己的資料/
  // selectedKey/hoverKey/candidateKeys,不寫入任何其他共享狀態,故拆開
  // 不影響本檔案其餘查詢/地圖生命週期邏輯,呼叫順序本身也不重要(彼此
  // 不互相依賴)。飯店/推薦地點/搜尋結果原本各自獨立的三個 marker hook
  // (useHotelMarkers/usePlaceMarkers/useGeocodeCandidateMarkers)已合併成
  // 單一 useSearchResultMarkers(見 api.ts GeoSearchResult 的完整說明)。
  useAttractionOverlays({
    mapRef,
    mapReady,
    attractions,
    zoom,
    selectedKey,
    hoverKey,
    candidateKeys,
    onAttractionSelect,
    revealedAttractionNames,
    hoveredCuratedName,
  })
  useSearchResultMarkers({
    mapRef,
    mapReady,
    results: searchResults,
    selectedKey,
    hoverKey,
    candidateKeys,
    onSelect: onSearchResultSelect,
  })
  useTripEntryMarkers({
    mapRef,
    mapReady,
    tripEntries,
    selectedKey,
    hoverKey,
  })

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
  // 為新的移動請求」,前提是呼叫端(GeoOutlinePanel.tsx 的
  // effectivePanTarget)已用 useMemo 依實際座標值快取、確保座標沒變時
  // 不會產生新物件參照——否則任何造成這個元件重渲染的動作(例如查詢
  // 完成觸發 onAttractionsChange 連鎖讓上層重渲染)都會被誤判成新的移動
  // 請求,重新 panTo,曾經因此形成「渲染→panTo→idle→查詢→觸發渲染」的
  // 無限迴圈,即使地圖靜止不動也會持續發送查詢請求。
  useEffect(() => {
    if (!mapReady || !mapRef.current || !panTarget) return
    // onlyIfOutOfView:見該欄位的完整說明——bounds 為 null 時視為無法
    // 判斷,不跳過,保守起見仍執行後續的 panTo。
    if (panTarget.onlyIfOutOfView && bounds && bounds.contains({ lat: panTarget.lat, lng: panTarget.lng })) {
      return
    }
    if (panTarget.suppressQuery) {
      suppressNextIdleQueryRef.current = true
    }
    if (panTarget.radiusMeters != null && panTarget.radiusMeters > 0) {
      const circle = new google.maps.Circle({
        center: { lat: panTarget.lat, lng: panTarget.lng },
        radius: panTarget.radiusMeters,
      })
      // circleBounds:刻意不叫 bounds,避免跟外層同名的 bounds state
      // (見上方 onlyIfOutOfView 判斷式讀取的那個)混淆——兩者是完全不同
      // 的東西,這裡是暫時算出來、只為了這次 fitBounds 呼叫用的局部值。
      const circleBounds = circle.getBounds()
      if (circleBounds) {
        mapRef.current.fitBounds(circleBounds, 48)
        return
      }
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

  // 地圖容器(<div ref={containerRef}>)必須無條件渲染,不能像先前那樣
  // 依 err/attractions 狀態切換成完全不同的 JSX 分支——地圖初始化的
  // useEffect 依賴是 [apiKey](地圖只需要建立一次),若元件第一次掛載時
  // attractions 還是空陣列、走的是「空狀態」分支(不含這個 div),
  // containerRef.current 當下會是 null,初始化直接被跳過且不會重試
  // (因為 apiKey 沒變、effect 不會重新執行)。改成地圖容器永遠在,
  // 只在它上面疊加錯誤/空狀態提示,才能確保 containerRef 在 effect
  // 執行當下一定存在。
  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />
      {/* attractions.length === 0(目前地圖範圍內查無任何地標)刻意不
          顯示任何遮罩提示——在「依可視範圍查詢」的架構下(見上方查詢
          useEffect 的說明),查無資料是地圖拖曳/縮放到還沒建檔區域時的
          正常情況,不是搜尋失敗,不該用一片實色背景蓋住整個地圖。地圖
          本身(含飯店 marker,若該範圍剛好有查到)照常顯示,使用者只是
          單純看不到任何景點區域光暈而已,不需要額外文字說明。 */}
      {/* 類別標籤列(景點/飯店/餐廳):固定疊在地圖左上角,跟置中的「搜尋
          這個區域」按鈕分開排版、不互相重疊。三顆標籤點下去都會把標籤
          文字寫入搜尋框,並以目前地圖中心點查詢該類別附近地點(見
          handleCategoryClick/SEARCH_BOX_CATEGORY_LABELS 的完整說明),不再
          有選取/取消的切換機制,行為對齊一般的搜尋操作。err 存在時不
          顯示,理由同「搜尋這個區域」按鈕。hideCategoryTags 由呼叫端
          (手機版/桌面版共用同一個 geoCategoryTagsState.ts 狀態機,見該
          prop 的完整說明)算好傳入——查詢一開始(search-started)就隱藏,
          不等結果回來,對齊使用者要求的「開始搜尋就要隱藏」。 */}
      {!err && !(hideCategoryTags ?? false) && (
        <div className={styles.categoryTags}>
          {CATEGORY_TAGS.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              className={styles.categoryTag}
              onClick={() => handleCategoryClick(type)}
              title={label}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
          {/* 探索標籤:跟其餘三個類別標籤同一排,但互動語意不同——它是
              CATEGORY_TAGS 三顆標籤裡唯一還保留「點下去查、再點一次取消」
              activeCategory 選取態的標籤,查的是自建景點區域(attraction,
              見 EXPLORE_CATEGORY/runExploreQuery 的完整說明),不是
              fetchGeoGeocode 這條搜尋框查詢路徑,故不放進 CATEGORY_TAGS
              陣列、獨立渲染這顆按鈕。使用者明確要求標籤列不需要顯示已選取
              的視覺狀態(2026-08)——activeCategory 這個 state 本身及其
              開關/取消查詢的互動邏輯保留不動(見 handleCategoryClick),
              只是不再用 aria-pressed 呈現選取樣式。 */}
          <button
            type="button"
            className={styles.categoryTag}
            onClick={() => handleCategoryClick(EXPLORE_CATEGORY)}
            title="探索"
          >
            <Compass size={14} aria-hidden="true" />
            探索
          </button>
        </div>
      )}
      {/* 城市搜尋框:跟候選籃側欄(GeoCandidateSidebar)裡原本就有的同一個
          搜尋框共用輸入值/查詢邏輯(見上方 city/onCityChange/onSearch
          prop 的說明),獨立疊在地圖右上角(不跟類別標籤列同一個 flex
          row,理由是那排已經靠左貼齊、放右側需要獨立定位),固定貼齊
          最上緣(top:16px,見 GeoOutlineMap.module.css 的 .citySearch)
          ——讓使用者不需要先展開候選籃側欄就能直接在地圖上方搜尋城市。
          GeoInfoPanel/AttractionInfoPanel 改往下避開這個搜尋框(見這兩個
          元件的 .panel),而非反過來,因為搜尋框是常駐 UI。只有呼叫端
          有接這組 prop(目前只有 GeoOutlinePanel.tsx)才顯示。
          膠囊左側的 AI 按鈕(onOpenChat)是常駐右側對話欄收合時的快捷
          展開入口,見上方 prop 說明——只有呼叫端有接才顯示,不影響
          搜尋輸入本身。 */}
      {!err && onCityChange && onSearch && (
        <div className={styles.citySearch}>
          {onOpenChat && (
            <button
              type="button"
              className={styles.citySearchAiBtn}
              onClick={onOpenChat}
              title="開啟對話"
              aria-label="開啟對話"
            >
              <Sparkles size={16} aria-hidden="true" />
            </button>
          )}
          <input
            className={styles.citySearchInput}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            placeholder="輸入目的地城市,如「東京」"
            value={city ?? ''}
            onChange={(e) => onCityChange(e.target.value)}
            onKeyDown={(e) => { if (isSubmitEnter(e)) onSearch() }}
          />
          <button
            type="button"
            className={styles.citySearchBtn}
            onClick={onSearch}
            disabled={searching || !(city ?? '').trim()}
            title={searching ? '查詢中…' : '搜尋'}
            aria-label={searching ? '查詢中' : '搜尋'}
          >
            {searching ? (
              <Loader2 size={16} className={styles.citySearchBtnIconLoading} aria-hidden="true" />
            ) : (
              <Search size={16} aria-hidden="true" />
            )}
          </button>
          {searchRightSlot}
        </div>
      )}
      {!err && searchError && <div className={styles.citySearchError}>{searchError}</div>}
      {/* 「搜尋這個區域」按鈕:areaDirty 為 true(使用者拖曳/縮放過地圖
          但還沒查詢這個新範圍,見 areaSearch/geoAreaSearchState.ts 的
          說明)時顯示,疊在地圖上方置中,毛玻璃卡片視覺語言(對齊構想 1
          定案的 iOS header 風格)。顯示條件是「搜尋框目前有文字(city
          非空)」或「探索標籤選中(activeCategory === EXPLORE_CATEGORY)」
          兩者之一——這顆按鈕現在身兼兩種查詢的重新觸發入口:沿用搜尋框
          文字重查 Google Places(見 handleSearchThisArea 呼叫
          runPlacesQuery 的部分,city 是空字串時 runPlacesQuery 內部會
          自行 no-op,不需要在這裡特別擋)、或重查景點區域(見
          handleSearchThisArea 呼叫 runExploreQuery 的部分,不依賴 city
          文字,只依賴 activeCategory)。若只用 city 非空當條件,使用者
          選了探索標籤、搜尋框卻是空字串時,拖曳地圖後會完全沒有入口能
          重新查詢景點區域(2026-08 改動前景點區域是自動跟拖曳/縮放刷新,
          改成按下才查後才浮現這個缺口)。err 存在時不顯示(地圖本身都
          載入失敗了,顯示這顆按鈕沒有意義)。 */}
      {!err && areaSearch.areaDirty && (!!(city ?? '').trim() || activeCategory === EXPLORE_CATEGORY) && (
        <button
          type="button"
          className={styles.searchThisAreaButton}
          onClick={handleSearchThisArea}
          aria-busy={areaSearch.searching}
        >
          {areaSearch.searching ? (
            <Loader2 size={14} className={styles.searchThisAreaIconLoading} aria-hidden="true" />
          ) : (
            <Search size={14} aria-hidden="true" />
          )}
          搜尋這個區域
        </button>
      )}
      {err && (
        <div className={styles.mapError}>
          <span>地圖載入失敗</span>
          <span className={styles.mapErrorDetail}>{err}</span>
        </div>
      )}
    </div>
  )
}
