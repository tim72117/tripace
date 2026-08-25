import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoHotel, GeoPlace, GeoPlaceDetails, GeoSearchResult, GeoTripEntry } from '../api'
import { fetchGeoAttractionsNearby, fetchGeoAttractionsOnlyNearby, fetchGeoPlaceDetails, fetchGeoPlacesNearby, geocodeCandidateToSearchResult, hotelToSearchResult, placeToSearchResult } from '../api'
import { Compass, Hotel, Loader2, MapPin, Search, Sparkles, UtensilsCrossed } from 'lucide-react'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import { isSubmitEnter } from '../AppCommon'
import { initialAreaSearchState, reduceAreaSearchState } from './geoAreaSearchState'
import { minZoomForLevel } from './geoAttractionOverlay'
import { useAttractionOverlays } from './useAttractionOverlays'
import { useSearchResultMarkers } from './useSearchResultMarkers'
import { useTripEntryMarkers } from './useTripEntryMarkers'
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

// CATEGORY_TAGS:地圖上方類別標籤列的定義,type 值必須跟後端
// handleGeoPlacesNearby 的 allowedPlaceTypes 白名單一致(見
// server/internal/api/geo_outline.go)——這裡沒有另外定義一份型別檢查,
// 純粹靠兩邊維護時保持同步,不一致頂多讓後端回 400,不是安全風險。
const CATEGORY_TAGS: { type: string; label: string; Icon: typeof Hotel }[] = [
  { type: 'tourist_attraction', label: '景點', Icon: MapPin },
  { type: 'lodging', label: '飯店', Icon: Hotel },
  { type: 'restaurant', label: '餐廳', Icon: UtensilsCrossed },
]

// SEARCH_BOX_CATEGORY_LABELS:哪些類別標籤按下時不查 fetchGeoPlacesNearby
// (Nearby Search),改成觸發城市搜尋框搜尋對應文字(走 Text Search,見
// handleCategoryClick 的完整說明)——目前是使用者明確要求的「飯店」
// 「餐廳」兩個,key 對齊 CATEGORY_TAGS 的 type、value 是要填進搜尋框的
// 文字(直接沿用 CATEGORY_TAGS 的 label,理由是標籤文字本身就是最直覺
// 的搜尋關鍵字,不需要另外維護一份對照)。「景點」(tourist_attraction)
// 不在這裡,維持原本的 Nearby Search 行為。
const SEARCH_BOX_CATEGORY_LABELS: Record<string, string> = {
  lodging: '飯店',
  restaurant: '餐廳',
}

// EXPLORE_CATEGORY:「探索」標籤的識別值,跟 CATEGORY_TAGS 用同一顆
// activeCategory state 判斷選取態、共用同一套「點下去查、再點一次取消」
// 互動語意(見 handleCategoryClick/handleExploreClick 的說明),但不放進
// CATEGORY_TAGS 陣列本身——CATEGORY_TAGS 的 type 值必須對齊後端
// allowedPlaceTypes 白名單(給 fetchGeoPlacesNearby 用),探索標籤查的是
// 完全不同的資料來源(自建景點區域 attraction,見 fetchGeoAttractionsOnlyNearby,
// 免費、查自家資料庫),混進同一個陣列會誤導成「這也是傳給後端的 place
// type」。使用者明確要求:attraction 光暈圖層原本是進畫面就自動顯示、
// 拖曳縮放自動刷新的常駐圖層,改成跟飯店/景點/餐廳一致的「標籤控制」
// 模式——預設不顯示,只有點探索才查詢並顯示,顯示後也不再自動跟拖曳/
// 縮放刷新(除非再次點探索或按「搜尋這個區域」),見下方 attractionsQueryTrigger
// 相關 effect 的改動。
const EXPLORE_CATEGORY = 'attraction'

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

// sameAttractionsContent/sameHotelsContent:比對兩批查詢結果的內容是否
// 完全相同(依名稱+座標組成的字串逐筆比對,足以判斷「這就是同一批
// 資料」),供依可視範圍查詢完成時判斷要不要真的替換 state——見該處
// useEffect 的說明,避免地圖移動一下又移回來、或新舊查詢半徑重疊涵蓋
// 同一批資料時,內容明明相同卻無條件換新陣列參照,讓景點區域光暈/飯店
// marker 不必要地整批重建、閃爍。
function sameAttractionsContent(a: GeoAttraction[], b: GeoAttraction[]): boolean {
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
  city,
  onCityChange,
  onSearch,
  searching,
  searchError,
  onOpenChat,
  showZoomControl = true,
  searchRightSlot,
  onAttractionsChange,
  onSearchResultsChange,
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
}: {
  cfg: ClientConfig
  // initialCenter:地圖第一次建立時該用的中心點——undefined 代表呼叫端
  // 還在查詢「這個行程有沒有既有地點可以當初始中心」(見
  // GeoOutlinePanel.tsx 的 tripCenterPanTarget),此時地圖建立要等待,
  // 不能先用預設值建起來、查完才用 panTarget 再移動一次過去:那樣會
  // 白白查一次「移動前那個位置」的資料(見下方查詢 effect 的說明),
  // 移動後那次查詢又可能因為 panTarget 的 suppressQuery 被抑制,導致
  // 使用者進頁面時地圖上什麼資料都沒有,要等他自己動一下地圖才觸發
  // 查詢。null 代表已確定查無可用的初始中心(沒有行程、或行程沒有帶
  // 座標的既有地點),這時退回寫死的預設值。物件代表確定要用這組座標
  // 當初始中心,直接建圖在那裡,一步到位、只查一次正確範圍的資料。
  initialCenter?: { lat: number; lng: number } | null
  // tripEntries:目前行程本身已有座標的 entry(見 GeoOutlinePanel.tsx 查詢
  // tripCenter 時一併保留的完整清單)——這批點要顯示在地圖上(見下方
  // 畫 marker 的 effect),讓使用者看得到「這趟行程已經排進候選籃/日
  // 層架的地點跟這座城市其他景點的相對位置關係」,不只是拿來算初始
  // 定位而已。跟 hotels/places 不同,這批資料不是「以地圖範圍為準」
  // 查詢的結果,是行程本身固定的內容,換行程才會變。
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
  // onSearchResultsChange:飯店(「搜尋這個區域」按鈕觸發)/推薦地點
  // (點類別標籤觸發)兩種來源合併後的搜尋結果清單——原本分別用
  // onVisibleHotelsChange/onPlacesNearby 兩個 callback 往上回報,使用者
  // 要求這兩者(連同搜尋結果)都收斂成同一份清單、同一套邏輯(見 api.ts
  // GeoSearchResult 的完整說明),故合併成單一 callback。查詢觸發時機
  // 本身仍分開(飯店按鈕觸發且付費、地點點類別標籤觸發,見下方
  // handleSearchThisArea/handleCategoryClick),只有「往上回報結果」這一
  // 端收斂成一份。搜尋結果(geocodeCandidates prop)不透過這個 callback
  // 回報——它是 GeoOutlinePanel.tsx 自己持有並傳入的暫時圖層,不是這個
  // 元件內部查詢管理的結果,見該 prop 的完整說明。
  onSearchResultsChange?: (results: GeoSearchResult[]) => void
  // onActiveCategoryChange:上方類別標籤列(飯店/景點/餐廳,見
  // handleCategoryClick)目前選中的類別往上回報,null 代表沒有任何類別
  // 標籤被選取。側欄「附近推薦」分頁標題/空狀態文字要能反映「目前顯示
  // 的是哪個類別的結果」(例如選了餐廳標籤時顯示「餐廳」而非籠統的
  // 「附近推薦」),這個回報讓側欄不必自己猜測 places 陣列內容屬於哪個
  // 類別。
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
  // 結果,而非全球知名度最高的結果。跟 attractionsQueryTrigger 共用同一個
  // idle 事件,不需要另外掛一個監聽器。
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
  // 移動(側欄點擊、行程初始定位),資料範圍通常沒有實質改變,不該冒出
  // 按鈕暗示「這裡有新範圍待查詢」;false(或不帶,預設當 false)用於
  // 「使用者明確想換一個地方看」的移動(搜尋城市),該讓按鈕冒出來提示
  // 使用者可以查詢這個新範圍——這正是由呼叫端決定該不該抑制,而不是
  // 這裡憑空猜測,因為只有呼叫端知道這次移動背後的使用者意圖是什麼。
  //
  // radiusMeters:GeoInfoPanel/AttractionInfoPanel「探索周邊」按鈕觸發時
  // 帶入(見 DesktopLayout.tsx 的 handleExploreAttraction,呼叫
  // planAttractionClick 決策後直接把最終半徑帶過來,不在這個元件內部
  // 重新呼叫該決策函式)。有值時用 fitBounds 縮放到剛好 framing 這個
  // 半徑的範圍,取代原本的 panTo+setZoom(level)行為;level 若同時存在
  // 會被忽略,因為 fitBounds 本身就是更精確的縮放依據。點擊地圖上的
  // 地標圖示本身(useAttractionOverlays.ts 的 handleAttractionClick)
  // 不再觸發任何地圖移動,只開介紹卡,見該函式的說明。
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
  // 附近推薦),行程本身已有座標的 entry(tripEntries)雖然也會自動併入
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
  // geocodeCandidates:GeoOutlinePanel 的城市搜尋框(GeoCandidateSidebar
  // 那個自訂輸入框,見該元件的說明)查到多筆候選時(fetchGeoGeocode 現在
  // 改回傳候選陣列,見 api.ts 的 GeoGeocodeCandidate)傳入,畫成可點擊的
  // 候選 marker 並 fitBounds 到能同時看見所有候選的範圍——空陣列
  // (預設)代表沒有待確認的候選,不畫任何東西。
  geocodeCandidates?: GeoGeocodeCandidate[]
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
  // attractions/hotels:改成這個元件內部管理(不再是外部傳入的完整清單再
  // 篩選),由下方「依可視範圍查詢」的 effect 寫入——景點區域與飯店都是
  // 「以地圖可視範圍為準」查詢的結果,查詢責任收在地圖元件自己身上
  // (只有它知道當下的 bounds),搜尋框(GeoOutlinePanel.tsx)只負責把
  // 座標查出來、透過 panTarget 移動地圖,不再自己查一份完整清單。
  //
  // hotels 這批「即時查 Google Places」的資料刻意不跟著 attractions 一起
  // 自動查——見下方 handleSearchThisArea 的說明,只有掛載時的第一次
  // 查詢與使用者明確按下「搜尋這個區域」時才會更新,拖曳/縮放本身不再
  // 觸發它,理由同該函式的說明。
  const [attractions, setAttractions] = useState<GeoAttraction[]>([])
  const [hotels, setHotels] = useState<GeoHotel[]>([])
  // places:點擊地圖上方類別標籤(handleCategoryClick)時查到的附近推薦
  // 地點,跟 attractions/hotels 不同的是這不是「依可視範圍持續查詢」的
  // 常駐圖層,是「點了某個類別才會有內容」的一次性查詢結果——換一個
  // 類別點擊會直接覆蓋掉整批(不累加),理由同 onSearchResultsChange 回報
  // 邏輯本身。
  const [places, setPlaces] = useState<GeoPlace[]>([])
  // searchResults:hotels/places/geocodeCandidatesProp 三種來源統一轉成
  // GeoSearchResult 後合併的單一陣列——供下方 useSearchResultMarkers 畫
  // 單一 marker 圖層,也是往上回報給 onSearchResultsChange 的內容(見
  // api.ts GeoSearchResult 的完整說明)。三者查詢時機/state 仍各自獨立
  // (理由見各自 state 宣告處),只有「對外呈現」這一層收斂成一份,故用
  // useMemo 衍生而非另外開一個 state 手動同步三邊。
  const searchResults = useMemo<GeoSearchResult[]>(
    () => [
      ...(geocodeCandidatesProp ?? []).map(geocodeCandidateToSearchResult),
      ...hotels.map(hotelToSearchResult),
      ...places.map(placeToSearchResult),
    ],
    [geocodeCandidatesProp, hotels, places],
  )
  // queryTrigger:每次「該重新查詢景點區域」時遞增一次,驅動下方「依可視
  // 範圍查詢」的 effect 重新執行——用遞增計數器而非直接把查詢邏輯寫進
  // 觸發來源的 callback 內,是為了讓查詢邏輯留在 useEffect 裡統一處理
  // cancelled/競態問題(見下方該 effect 的說明)。掛載後第一次(這個值
  // 還是初始值 0)會執行一次,查詢初始中心點周邊的景點區域,讓使用者
  // 不用任何互動就能看到內容;之後只有使用者明確按下「搜尋這個區域」
  // (見 handleSearchThisArea)才會再次遞增——地圖拖曳本身不再直接驅動
  // 這個 effect,理由見 idle 監聽器與 areaSearch 的說明。
  const [queryTrigger, setQueryTrigger] = useState(0)
  // attractionsQueryTrigger:每次「該重新查詢景點區域」時遞增一次,驅動
  // 下方「景點區域自動查詢」的 effect——跟 queryTrigger 分開是因為景點
  // 區域(免費、查自家資料庫,見 fetchGeoAttractionsOnlyNearby)跟飯店
  // (付費、即時查 Google Places,見 queryTrigger 那個 effect)現在是兩條
  // 獨立的觸發時機:景點區域單純依地圖可視範圍/縮放自動觸發(idle 事件,
  // 見下方 idle 監聽器),不需要使用者按「搜尋這個區域」;飯店仍收在
  // 按鈕之後,理由同 queryTrigger 的說明。初始值 0,mapReady 剛變 true 時
  // 這個 effect 會執行一次,查詢初始中心點周邊的景點區域。
  const [attractionsQueryTrigger, setAttractionsQueryTrigger] = useState(0)
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
  // activeCategoryRef:idle 監聽器註冊在只執行一次的建圖 effect 裡(見
  // 下方),不能直接讀 activeCategory state(會拿到建圖當下的舊值,
  // stale closure)——用 ref 讀取最新值,判斷探索標籤(EXPLORE_CATEGORY)
  // 是否選中,決定要不要在這次 idle 時重新查詢景點區域(見下方 idle
  // 監聽器的說明:探索標籤選中後才跟拖曳/縮放自動刷新,未選中或選中
  // 其他標籤時完全不查)。理由同 onPoiSelectRef/onCenterChangeRef。
  const activeCategoryRef = useRef<string | null>(null)
  // buildingRef:見下方地圖建立 effect 裡的完整說明——擋住
  // importLibrary('maps') resolve 之前,effect 因 initialCenter 從
  // undefined 解析成確定值而重新執行時,誤判成「還沒建過圖」而重複
  // 建圖、重複掛監聽器的非同步競態。
  const buildingRef = useRef(false)
  // lastAttractionsQueryKeyRef:見下方景點區域查詢 effect 裡的完整說明——
  // 記住上一次真正送出查詢的座標+半徑,idle 事件在初始載入階段連續
  // 觸發但位置沒變時用來去重,不再重複發送請求。
  const lastAttractionsQueryKeyRef = useRef<string | null>(null)

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
    //
    // 這個判斷本身無法擋住非同步競態:mapRef.current 要等
    // importLibrary('maps').then() 真正 resolve 才會被賦值,若 effect 在
    // 那之前又因為 initialCenter 從 undefined 解析成 null/物件而重新
    // 執行(常發生在沒有行程既有地點、tripCenter 幾乎同步就決議成 null
    // 的情況),第二次執行當下 mapRef.current 仍是 null,一樣會通過這個
    // 判斷、再呼叫一次 importLibrary('maps').then(),建出第二個地圖
    // 實例、掛上第二組 idle/bounds_changed/zoom_changed 監聽器——兩個
    // 實例都停在同一個預設中心,使用者完全感覺不出來地圖被建了兩次,但
    // 之後只要觸發一次 idle,兩組監聽器就會各自遞增
    // attractionsQueryTrigger、各打一次 fetchGeoAttractionsOnlyNearby,
    // 且每多重執行一次這個 effect(例如初始資料陸續回來、上層連鎖重渲染)
    // 就再疊一組監聽器,才會出現「進頁面後短時間內連發幾十筆」的爆量
    // 現象。用 buildingRef 在呼叫 importLibrary 之前就同步標記「這次
    // effect 執行已經在建圖了」,擋住後續執行在 mapRef.current 賦值前
    // 搶著再建一次。
    if (mapRef.current || buildingRef.current) return
    // initialCenter 為 undefined 代表呼叫端還在查「這個行程有沒有既有
    // 地點可以當初始中心」,地圖建立要等待——見這個 prop 的完整說明。
    if (initialCenter === undefined) return
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
        // 初始中心點:優先用 initialCenter(行程既有地點的中心,若已確定
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
          disableDefaultUI: true,
          zoomControl: showZoomControl,
          // gestureHandling 明確設為 'greedy':預設值 'auto' 在
          // panTo/fitBounds(搜尋觸發,見下方 panTarget effect)之後,
          // SDK 內部可能重新判定為 cooperative 模式,導致單指平移失效、
          // 變成要雙指才能拖動地圖。'greedy' 讓單指平移永遠可用,不受
          // 程式化移動地圖影響。
          gestureHandling: 'greedy',
        })
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
        // bounds_changed 拖曳過程中會連續觸發)。分成兩件事處理:
        //
        // 1. 景點區域(attractions)只有「探索」標籤選中時才遞增
        //    attractionsQueryTrigger、驅動下方的自動查詢 effect 以新範圍
        //    重查——使用者明確要求跟飯店/景點/餐廳三個標籤統一互動語意:
        //    預設不顯示,點探索才查詢並顯示,顯示後才跟拖曳/縮放自動刷新
        //    (原本是不論選了哪個標籤都無條件自動刷新的常駐圖層,這是
        //    改版前的既有行為,這次改掉)。用 activeCategoryRef 判斷(見
        //    該 ref 的說明,idle 監聽器读不到 state 最新值)。這支查詢
        //    本身免費(只查自家資料庫,見 fetchGeoAttractionsOnlyNearby),
        //    故探索標籤選中時仍不受 suppressNextIdleQueryRef 影響(即使
        //    是 panTarget 造成的移動,只要探索已選中就該立刻反映新範圍,
        //    沒有「稍後才查」的必要)。
        // 2. 飯店(hotels)與地圖上方類別標籤查到的地點不在這裡自動觸發
        //    ——這兩者都是即時查 Google Places、直接計費,仍收在使用者
        //    明確按下「搜尋這個區域」按鈕之後才觸發(見 queryTrigger 那個
        //    effect 與 handleSearchThisArea)。地圖移動本身只標記「這個
        //    範圍還沒查過」(dispatch 'map-idle',見 geoAreaSearchState.ts
        //    的說明),在地圖上方冒出按鈕,等使用者按下才真的發請求——
        //    若沿用「拖曳就查」會讓每次小幅拖曳都觸發一次計費查詢,改成
        //    「按下才查」讓使用者對何時會產生查詢有明確控制。
        //    suppressNextIdleQueryRef 為 true 時跳過這一半的觸發並消耗掉
        //    旗標:這代表這次 idle 是 panTarget 的 panTo 造成的(側欄點擊/
        //    搜尋),不是使用者主動拖曳探索新範圍,不該冒出搜尋按鈕。
        mapRef.current.addListener('idle', () => {
          if (activeCategoryRef.current === EXPLORE_CATEGORY) {
            setAttractionsQueryTrigger((n) => n + 1)
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, initialCenter])

  // 依地圖可視範圍自動查詢景點區域:attractionsQueryTrigger 遞增時
  // (mapReady 剛變 true 的掛載當下、以及之後每次地圖 idle,見上方 idle
  // 監聽器的說明),以地圖目前中心座標+半徑呼叫
  // fetchGeoAttractionsOnlyNearby(GET /internal/geo/attractions/nearby-only)
  // ——這支端點只查自家資料庫(免費、無外部 API 成本),故可以放心讓它
  // 單純跟著地圖可視範圍/縮放自動觸發,不需要使用者按「搜尋這個區域」
  // 才查,呼應構想 6「不待召喚即先給出地理輪廓」的精神。
  //
  // 半徑依 zoom 反推(zoom 越小代表可視範圍越大,需要的查詢半徑也越大)
  // ——沒有查詢 Google Maps 官方公式反推可視範圍公里數的必要,這裡只是
  // 抓一個「大致夠涵蓋畫面」的粗略估計,查詢範圍比實際可視範圍稍大一些
  // 沒有壞處(下方 filteredAttractions 還會再依實際 zoom 精確篩選一次,
  // 詳見對應的說明)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    // activeCategory !== EXPLORE_CATEGORY:使用者明確要求探索標籤預設
    // 不顯示——這個 effect 依賴陣列含 mapReady,地圖剛建好、mapReady
    // 從 false 變 true 時本來就會執行一次(不需要 attractionsQueryTrigger
    // 遞增),若不擋掉,即使沒點過探索標籤,進畫面還是會自動查一次景點
    // 區域,等同沒有真正做到「預設不顯示」。
    if (activeCategory !== EXPLORE_CATEGORY) return
    const center = mapRef.current.getCenter()
    if (!center) return
    const radiusMeters = Math.min(50000, 20000 * Math.pow(2, 12 - zoom))
    // Google Maps 在初始載入階段(tiles 陸續載入完成、zoom/bounds/center
    // 各自 settle)常常會連續觸發不只一次 idle 事件,即使地圖實際上完全
    // 沒有移動——每次 idle 都會讓 attractionsQueryTrigger 遞增、驅動這個
    // effect 重新執行一次,若不去重,同一個座標+半徑會在極短時間內被
    // 重複查詢好幾次,浪費請求(即使回應內容相同、不會觸發多餘渲染,
    // 見下方 sameAttractionsContent 的比對,但請求本身已經送出去了)。
    // 用座標(取到小數點後 4 位,約 11 公尺誤差,足夠判斷「這是同一個
    // 位置」)+半徑組字串跟上一次真正查詢的參數比對,完全相同就跳過,
    // 不再送出重複請求。
    const queryKey = `${center.lat().toFixed(4)},${center.lng().toFixed(4)},${radiusMeters}`
    if (lastAttractionsQueryKeyRef.current === queryKey) return
    lastAttractionsQueryKeyRef.current = queryKey
    let cancelled = false
    fetchGeoAttractionsOnlyNearby(cfg, center.lat(), center.lng(), radiusMeters)
      .then((result) => {
        if (cancelled) return
        // 用函式式更新比對內容摘要(名稱+座標組成的字串),完全相同就回傳
        // 舊陣列參照、不觸發 re-render——地圖移動一下又移回來、或新舊
        // 查詢半徑重疊涵蓋同一批資料時很常見,若每次查詢完成都無條件
        // 換新陣列參照,即使內容一模一樣,依賴 attractions 的
        // filteredAttractions(見下方 useMemo)也會被判定成「變了」,讓
        // 景點區域光暈整批不必要地重建、閃爍(理由同該 useMemo 已有的
        // 說明)。
        setAttractions((prev) => (sameAttractionsContent(prev, result.attractions) ? prev : result.attractions))
        onAttractionsChange?.(result.attractions)
      })
      .catch(() => {
        // 查詢失敗(網路錯誤/伺服器錯誤)不視為致命錯誤——地圖本身仍可
        // 正常瀏覽,只是這次移動沒能刷新資料,維持上一次查到的內容即可,
        // 不清空、不彈錯誤訊息打斷瀏覽。
      })
    return () => {
      cancelled = true
      // 這次執行在請求完成前就被取消(常見於 React StrictMode 開發模式
      // 的「執行→cleanup→再執行一次」雙重呼叫,或 attractionsQueryTrigger
      // 在請求完成前又變動)——若不釋放 lastAttractionsQueryKeyRef,留下來
      // 那次真正該生效的執行會看到 ref 已經被這次「注定作廢」的執行佔走
      // 同一個 queryKey,誤判成「已經查過」而直接跳過,導致這個位置永遠
      // 查不到任何結果(實際發生過的 bug:地圖上完全沒有景點區域出現)。
      // 只有在 ref 仍然是「這次執行設定的值」時才清空,避免不小心清掉
      // 後來另一次執行(不同 queryKey)已經合法設定的值。
      if (lastAttractionsQueryKeyRef.current === queryKey) {
        lastAttractionsQueryKeyRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, attractionsQueryTrigger])

  // 依使用者按下「搜尋這個區域」查詢飯店:queryTrigger 從 0(尚未觸發過)
  // 遞增時才查——跟上面景點區域的 effect 不同,這支端點(GET
  // /internal/geo/attractions/nearby,雖然一併回傳 attractions,但這裡
  // 刻意只採用 result.hotels、忽略 attractions 欄位,景點區域已交給上面
  // 那個免費的 effect 負責)即時查 Google Places、直接計費,不能自動跟著
  // 地圖移動觸發,必須收在使用者明確按下「搜尋這個區域」按鈕之後——見
  // handleSearchThisArea 與該按鈕的顯示條件(僅在已選類別標籤時出現)。
  useEffect(() => {
    if (!mapReady || !mapRef.current || queryTrigger === 0) return
    const center = mapRef.current.getCenter()
    if (!center) return
    let cancelled = false
    const radiusMeters = Math.min(50000, 20000 * Math.pow(2, 12 - zoom))
    fetchGeoAttractionsNearby(cfg, center.lat(), center.lng(), radiusMeters)
      .then((result) => {
        if (cancelled) return
        setHotels((prev) => (sameHotelsContent(prev, result.hotels) ? prev : result.hotels))
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-succeeded' }))
      })
      .catch(() => {
        // 查詢失敗(網路錯誤/伺服器錯誤)不視為致命錯誤——地圖本身仍可
        // 正常瀏覽,只是這次沒能刷新飯店資料,維持上一次查到的內容即可,
        // 讓按鈕重新出現提供重試入口。
        setAreaSearch((s) => reduceAreaSearchState(s, { type: 'query-failed' }))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, queryTrigger])

  // categoryQueryRadiusMeters:類別標籤列(飯店/景點/餐廳)查詢用的固定
  // 半徑——查詢中心是「目前地圖中心點」,沒有天然的範圍可以依據,故用
  // 一個固定的中等半徑,對齊後端 handleGeoPlacesNearby 的預設值
  // (1500m),不特別放大或縮小。
  const categoryQueryRadiusMeters = 1500

  // activeCategory:目前選中的類別標籤(飯店/景點/餐廳),null 代表沒有
  // 任何標籤被選取。再點一次目前已選中的標籤會取消選取、清空 places
  // 圖層(理由同下方 handleCategoryClick 的說明)——這是「切換」而非
  // 「只能疊加」的互動,標籤有明確的選取態需要在畫面上反映(見下方標籤列
  // UI 的 aria-pressed)。
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // runCategoryQuery:以目前地圖中心點為中心,查詢指定類別附近的地點(見
  // fetchGeoPlacesNearby 的 type 參數,對齊後端 handleGeoPlacesNearby 的
  // 白名單)。查詢結果寫進既有的 places state(驅動下方畫 marker 的
  // effect 與「附近推薦」側欄分頁),同時透過 onPlacesNearby 往上回報。
  // 抽成獨立函式,供 handleCategoryClick(第一次選取該類別)與
  // handleSearchThisArea(類別選取後,地圖移動到新範圍要重新查詢)共用同
  // 一份查詢邏輯,不重複維護。
  const runCategoryQuery = useCallback((type: string) => {
    if (!mapRef.current) return
    const center = mapRef.current.getCenter()
    if (!center) return
    fetchGeoPlacesNearby(cfg, center.lat(), center.lng(), categoryQueryRadiusMeters, type)
      .then((result) => {
        setPlaces(result.places)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,不彈錯誤
        // 訊息打斷瀏覽,理由同這個檔案其餘查詢失敗處理的一貫慣例。
      })
  }, [cfg])

  // runExploreQuery:探索標籤專用的查詢函式——跟 runCategoryQuery 平行
  // (兩者都以目前地圖中心點為圓心查附近資料),但資料來源完全不同:這裡
  // 查自建景點區域(attraction,fetchGeoAttractionsOnlyNearby,免費、
  // 查自家資料庫),不是 fetchGeoPlacesNearby(即時查 Google Places、
  // 計費)。半徑沿用原本 attractionsQueryTrigger 那個 effect 的既有公式
  // (依 zoom 反推),不是 categoryQueryRadiusMeters 那個固定 1500m——
  // 探索標籤查的是「一整個城市層級的景點分區」,天然需要比飯店/景點/
  // 餐廳附近推薦更大的涵蓋範圍。查詢結果寫進 attractions state,結果
  // 透過 onAttractionsChange 往上回報,理由同 attractionsQueryTrigger
  // 那個 effect 原本的既有邏輯。
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
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,理由同
        // runCategoryQuery 的既有處理方式。
      })
  }, [cfg, zoom, onAttractionsChange])

  // handleCategoryClick:點擊地圖上方的類別標籤(飯店/景點/餐廳/探索)時
  // 觸發第一次查詢——再點一次目前已選中的類別會清空對應圖層並取消
  // 選取,這是使用者想「不看這批結果了」的自然操作,不需要額外的關閉
  // 按鈕。探索標籤(EXPLORE_CATEGORY)走 runExploreQuery/attractions,
  // 「景點」「飯店」走 runCategoryQuery/places,兩條分支共用同一顆
  // activeCategory state 判斷選取態,但清空/查詢的目標圖層不同。
  //
  // 「飯店」「餐廳」是使用者明確要求的例外(見 SEARCH_BOX_CATEGORY_LABELS
  // 的說明)——不查 fetchGeoPlacesNearby、不進入 activeCategory 選取態,
  // 改成把城市搜尋框的輸入值設成對應文字並觸發一次搜尋(走 Text Search,
  // 見 onCityChange/onSearch prop 的完整說明),等同使用者自己在搜尋框
  // 打這段文字按下 Enter。這裡不做「再點一次取消」的判斷(那套邏輯依賴
  // activeCategory,這兩顆標籤根本不使用它),按下即觸發,行為對齊一般
  // 的搜尋框操作。選取樣式(見下方 render 區的 aria-pressed)改跟隨 city
  // 是否等於對應文字判斷,不是 activeCategory——使用者之後手動改搜尋框
  // 內容會讓按鈕自然失去選取樣式,不需要另外維護一個獨立 state 手動同步。
  const handleCategoryClick = useCallback((type: string) => {
    if (!mapRef.current) return
    const searchBoxLabel = SEARCH_BOX_CATEGORY_LABELS[type]
    if (searchBoxLabel) {
      onCityChange?.(searchBoxLabel)
      onSearch?.()
      return
    }
    if (activeCategory === type) {
      setActiveCategory(null)
      activeCategoryRef.current = null
      onActiveCategoryChange?.(null)
      if (type === EXPLORE_CATEGORY) {
        setAttractions([])
        onAttractionsChange?.([])
      } else {
        setPlaces([])
      }
      return
    }
    setActiveCategory(type)
    activeCategoryRef.current = type
    onActiveCategoryChange?.(type)
    if (type === EXPLORE_CATEGORY) {
      runExploreQuery()
    } else {
      runCategoryQuery(type)
    }
  }, [activeCategory, onActiveCategoryChange, runCategoryQuery, runExploreQuery, onAttractionsChange, onCityChange, onSearch])

  // searchResults 變動(hotels/places/geocodeCandidatesProp 任一來源變動)
  // 時統一往上回報一次——取代原本 setHotels/setPlaces 各自呼叫
  // onVisibleHotelsChange/onPlacesNearby 的寫法,理由見 onSearchResultsChange
  // 的完整說明:三個來源合併成一份清單後,不該再各自負責回報自己那一份,
  // 改由這裡統一監看合併後的結果變動。
  useEffect(() => {
    onSearchResultsChange?.(searchResults)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults])

  // handleSearchThisArea:「搜尋這個區域」按鈕的點擊處理——進入查詢中
  // 狀態、收起按鈕(見 geoAreaSearchState.ts 的 search-pressed 轉換)。
  // 這顆按鈕現在只在 activeCategory 有值時才會顯示(見下方 render 區的
  // 條件),按下時依目前選中的標籤分流重新查詢:探索標籤(EXPLORE_CATEGORY)
  // 呼叫 runExploreQuery(景點區域,免費、查自家資料庫,不遞增 queryTrigger
  // ——那是飯店查詢專用的觸發器,理由見該 state 的說明);其餘三個標籤
  // 遞增 queryTrigger 觸發飯店查詢 effect,並呼叫 runCategoryQuery 以新
  // 的地圖中心重新查詢該類別,否則使用者移動地圖後點下這顆按鈕,畫面上
  // 的類別地點清單會停留在舊範圍、看起來像沒反應。
  const handleSearchThisArea = useCallback(() => {
    setAreaSearch((s) => reduceAreaSearchState(s, { type: 'search-pressed' }))
    if (activeCategory === EXPLORE_CATEGORY) {
      runExploreQuery()
      return
    }
    setQueryTrigger((n) => n + 1)
    if (activeCategory) runCategoryQuery(activeCategory)
  }, [activeCategory, runCategoryQuery, runExploreQuery])

  // 以下三個圖層(景點區域光暈、搜尋結果、行程 entry)各自獨立成 hook
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
      {/* 類別標籤列(飯店/景點/餐廳):固定疊在地圖左上角,跟置中的「搜尋
          這個區域」按鈕分開排版、不互相重疊。「景點」點下去以目前地圖
          中心點查詢該類別附近地點(見 handleCategoryClick),再點一次
          同一個標籤取消選取並清空結果;「飯店」「餐廳」改觸發城市搜尋
          框搜尋對應文字(見 SEARCH_BOX_CATEGORY_LABELS 的完整說明),不
          走這套查詢/取消邏輯。err 存在時不顯示,理由同「搜尋這個區域」
          按鈕。 */}
      {!err && (
        <div className={styles.categoryTags}>
          {CATEGORY_TAGS.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              className={styles.categoryTag}
              // 「飯店」「餐廳」不進 activeCategory(見 handleCategoryClick
              // 的說明,它們現在觸發的是城市搜尋框,不是查詢圖層),選取
              // 樣式改跟隨搜尋框目前的輸入值是否就是對應文字——使用者
              // 之後手動改搜尋框內容或清空,這顆按鈕會自然失去選取樣式,
              // 不需要另外維護一個獨立 state 手動同步兩者。
              aria-pressed={
                SEARCH_BOX_CATEGORY_LABELS[type]
                  ? city === SEARCH_BOX_CATEGORY_LABELS[type]
                  : activeCategory === type
              }
              onClick={() => handleCategoryClick(type)}
              title={label}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
          {/* 探索標籤:跟其餘三個類別標籤同一排、共用同一套「點下去查、
              再點一次取消」互動語意與 activeCategory 選取態,但查的是
              自建景點區域(attraction,見 EXPLORE_CATEGORY/runExploreQuery
              的完整說明),不是 fetchGeoPlacesNearby 的 place type,故不
              放進 CATEGORY_TAGS 陣列、獨立渲染這顆按鈕。 */}
          <button
            type="button"
            className={styles.categoryTag}
            aria-pressed={activeCategory === EXPLORE_CATEGORY}
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
          定案的 iOS header 風格)。額外要求 activeCategory 有值(使用者
          已經選了一個類別標籤)才顯示——這顆按鈕存在的意義是「重新查詢
          目前選中的類別」,沒有選類別時按下去沒有東西可重新整理,顯示
          出來只會讓人誤以為要做什麼卻沒反應。按下後呼叫
          handleSearchThisArea,查詢中(searching)把 lucide 的 Search
          圖示換成 Loader2(疊加 CSS 自轉動畫,lucide 本身不含動畫),
          不改按鈕文字或停用互動——查詢通常很快,不需要額外 disable 按鈕
          製造等待感。err 存在時不顯示(地圖本身都載入失敗了,顯示這顆
          按鈕沒有意義)。 */}
      {!err && areaSearch.areaDirty && activeCategory != null && (
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
