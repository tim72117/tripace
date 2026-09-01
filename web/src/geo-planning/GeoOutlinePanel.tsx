import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoPlaceDetails, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../api'
import { fetchEntries, fetchGeoGeocode, fetchGeoPlacePhoto, fetchGeoPlaceText, geocodeCandidateToSearchResult } from '../api'
import { useStableCallback } from '../hooks/useStableCallback'
import type { Theme } from '../theme'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import styles from './GeoOutlinePanel.module.css'

// mapLocatedTripEntries:把 fetchEntries 查回的完整 Entry 清單篩出有座標的
// 那批、轉成 GeoTripEntry 形狀——供下方「換旅程」與「補上日期後刷新」
// 兩個 effect 共用同一份映射邏輯,避免其中一處修改欄位後忘記同步另一處。
function mapLocatedTripEntries(entries: Awaited<ReturnType<typeof fetchEntries>>): GeoTripEntry[] {
  const located = entries.filter(
    (e): e is typeof e & { lat: number; lng: number } => e.lat != null && e.lng != null,
  )
  return located.map((e) => ({
    id: e.id,
    name: e.title,
    lat: e.lat,
    lng: e.lng,
    location: e.location,
    kind: e.kind,
    start: e.start,
    startTime: e.startTime,
  }))
}

// GeoOutlinePanel:地理輪廓底圖(構想 6)的桌面版試做承載元件——目前 Trip
// 型別沒有目的地城市欄位(見 types.ts),故用一個暫時的城市搜尋讓使用者
// 手動觸發查詢,驗證視覺與互動是否對齊設計討論的定案,之後 Trip 補上目的地
// 城市欄位時,這裡可以直接換成從 Trip 帶出、不需要使用者手動輸入。
//
// 城市搜尋的輸入框/按鈕 UI 本身渲染在 GeoCandidateSidebar(左側候選籃
// 側欄最上方,見 DesktopLayout.tsx 的接線),不是這個元件的 JSX——但
// 查詢邏輯(呼叫 fetchGeoGeocode、算 panTarget)留在這裡,透過
// onCitySearched 這個 callback 讓外部(DesktopLayout.tsx)觸發查詢、
// 這裡才是唯一持有 cfg、知道怎麼呼叫 API 的地方。這個切分理由同
// onSearchResultsChange 等既有 callback 模式:UI 呈現與資料查詢分別
// 交給「離使用者比較近」與「離 API 比較近」的元件負責。
//
// 這個元件本身不再查詢景點/飯店資料:輸入內容後只呼叫 fetchGeoGeocode
// (GET /internal/geo/geocode)拿到一組候選座標,轉成 panTarget 讓
// GeoOutlineMap 把地圖平移過去;地圖到了新位置後,會依它當時的可視範圍
// 自己向 GET /internal/geo/attractions/nearby 查詢該顯示什麼景點/飯店
// (見 GeoOutlineMap.tsx 的說明),查詢責任完全收在地圖元件內部,這裡
// 不再重複維護一份 attractions/hotels state。
//
// 這個搜尋框最初的設計是「輸入城市/地標名稱,把地圖移過去」的純定位
// 用途,但實際使用上已經不只如此——使用者也會直接輸入「甜點」「拉麵」
// 這類泛用關鍵字,期待查到目前地圖所在區域附近的結果。fetchGeoGeocode
// 底層的 Text Search 目前不知道地圖當下在哪裡(純文字查詢,沒有座標
// 概念),這種關鍵字查詢會依 Google 全球相關性排序回傳結果,不會偏向
// 地圖目前的可視範圍——查到離目前位置很遠的地點是預期中的既有限制,
// 見後端 handleGeoGeocode 的完整說明。
//
// onSearchResultsChange/onAttractionsChange 原封不動轉傳給 GeoOutlineMap
// ——飯店/推薦地點/搜尋結果合併清單改由 DesktopLayout.tsx 在「整個桌面版
// 介面最外側」渲染(比照 DemoPanel debug 面板的固定寬度側欄模式,跟
// .desktop-main 平行,而非塞在 main 內部),兩者是分開掛載的 sibling,
// 只能靠這兩個 callback 往上回報。
//
// externalPanTarget:使用者在 GeoHotelSidebar/GeoCandidateSidebar 點擊某個
// 飯店/地點/已排入行程項目時要移動地圖到的座標,由 DesktopLayout.tsx
// 往下傳——跟這裡搜尋查到的座標共用同一個 panRequest state,「誰最後
// 觸發就用誰」,見下方 panRequest 的完整說明。
// selectedKey:由 DesktopLayout.tsx 往下傳,原封不動轉傳給 GeoOutlineMap,
// 讓地圖上的地標/飯店圖示能標記出目前選中的是哪一個。
// tripID:目前選中的旅程 ID——切到規劃分頁、或切換旅程時,若這個旅程底下
// 已經有帶座標的 entry(如老手回來繼續規劃、或搬過去用等機制搬進來的
// 候選點),應該優先以這些點的中心當地圖初始位置,而不是固定顯示東京。
// 見下方 tripCenter 的查詢。
// onTripEntriesChange:同 onSearchResultsChange 等,把旅程本身已有座標的
// entry(見下方查詢 tripCenter 的同一個 useEffect,順便保留完整清單而不
// 只是平均座標)往上回報,供 DesktopLayout.tsx 在整個桌面版介面最外側
// 渲染(地圖上畫 marker、候選籃自動帶入)——理由同
// onSearchResultsChange/onAttractionsChange。
export function GeoOutlinePanel({
  cfg,
  tripID,
  city,
  onCityChange,
  onSearch,
  onOpenChat,
  showZoomControl,
  searchRightSlot,
  onAttractionsChange,
  revealedAttractionNames,
  hoveredCuratedName,
  onSearchResultsChange,
  onSearchStart,
  hideCategoryTags,
  onActiveCategoryChange,
  onTripEntriesChange,
  onAttractionSelect,
  onSearchResultSelect,
  onPoiSelect,
  onGeocodeCandidateText,
  onGeocodeCandidatePhoto,
  externalGeocodeCandidateSelect,
  panTarget: externalPanTarget,
  selectedKey,
  candidateKeys,
  hoverKey,
  searchTrigger,
  refetchTripEntriesTrigger,
  theme,
  geocodeCandidates,
  setGeocodeCandidates,
  selectedCandidate,
  setSelectedCandidate,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // city:目前城市搜尋框的輸入值,由 DesktopLayout.tsx 中介(UI 渲染在
  // GeoCandidateSidebar,見上方元件註解)——這個元件用它觸發
  // fetchGeoGeocode 查詢,查詢時機由 searchTrigger 遞增驅動(見下方
  // useEffect),不是每次 city 變動就查(那樣會在使用者打字打到一半時
  // 就發送請求)。
  city: string
  // onCityChange/onSearch:原封不動轉傳給 GeoOutlineMap,渲染在地圖上方
  // (類別標籤旁)的城市搜尋框——DesktopLayout.tsx 的 geoSearchCity state
  // 是唯一持有這份輸入值的地方。查詢中/錯誤狀態(searching/error)直接
  // 由下方的 loading/err state 轉給 GeoOutlineMap 顯示,不需要另外往上
  // 層回報,搜尋按鈕本身觸發查詢的方式是遞增 searchTrigger prop(見
  // 下方)。
  onCityChange?: (city: string) => void
  onSearch?: () => void
  // onSearchStart:原封不動轉傳給 GeoOutlineMap——見該元件對這個 prop
  // 的完整說明,類別標籤/「搜尋這個區域」按鈕觸發查詢時通知呼叫端。跟
  // onSearch 是兩個獨立的「查詢開始」訊號:onSearch 只有城市搜尋框會
  // 呼叫,onSearchStart 只有類別標籤/搜尋這個區域會呼叫(見
  // GeoOutlineMap.tsx runPlacesQuery 的說明),呼叫端
  // (GeoOutlinePhoneView.tsx)需要同時接兩個才能涵蓋全部三個入口。
  onSearchStart?: () => void
  // hideCategoryTags:原封不動轉傳給 GeoOutlineMap——見該元件對這個 prop
  // 的完整說明,手機版專用。
  hideCategoryTags?: boolean
  // onOpenChat:原封不動轉傳給 GeoOutlineMap——搜尋框膠囊左側的 AI
  // 按鈕,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  onOpenChat?: () => void
  // showZoomControl:原封不動轉傳給 GeoOutlineMap——地圖右下角縮放按鈕
  // 開關,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  showZoomControl?: boolean
  // searchRightSlot:原封不動轉傳給 GeoOutlineMap——搜尋框膠囊最右側的
  // 額外內容(手機版放使用者頭像),見 GeoOutlineMap.tsx 對這個 prop 的
  // 完整說明。
  searchRightSlot?: ReactNode
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  // revealedAttractionNames:原封不動轉傳給 GeoOutlineMap——目前應該在
  // 地圖上顯示的精選點名稱集合,由呼叫端(DesktopLayout.tsx)依「使用者
  // 是否已開啟某個主題點」算好傳入,見該處 revealedAttractionNames 的
  // 完整說明。null 代表目前沒有開啟任何主題,精選點一律不顯示。
  revealedAttractionNames?: Set<string> | null
  // hoveredCuratedName:原封不動轉傳給 GeoOutlineMap——見該處與
  // useAttractionOverlays.ts 對這個 prop 的完整說明。
  hoveredCuratedName?: string | null
  // onSearchResultsChange:飯店/推薦地點/搜尋結果三種來源統一轉成
  // GeoSearchResult 合併後的搜尋結果清單,原封不動轉傳自 GeoOutlineMap
  // 的同名 callback(見該元件的完整說明)——使用者要求這三者「同一份
  // 清單、同一套邏輯」,原本的 onHotelsChange/onPlacesNearby/
  // onGeocodeCandidatesChange 三個 callback 已收斂成這一個。
  onSearchResultsChange?: (results: GeoSearchResult[]) => void
  // onActiveCategoryChange:原封不動轉傳給 GeoOutlineMap——理由同
  // onSearchResultsChange,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  onActiveCategoryChange?: (category: string | null) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  // onAttractionSelect/onPoiSelect:原封不動轉傳給 GeoOutlineMap——理由同
  // onSearchResultsChange 等既有 callback,見 GeoOutlineMap.tsx 對這幾個
  // prop 的說明。
  onAttractionSelect?: (attraction: GeoAttraction) => void
  onPoiSelect?: (details: GeoPlaceDetails) => void
  // onSearchResultSelect:使用者點擊地圖上的飯店/推薦地點/搜尋結果
  // marker(或側欄清單裡的對應項目)時觸發——原本是 onHotelSelect/
  // onPlaceSelect/onGeocodeCandidateSelect 三個各自獨立的 callback,理由
  // 同 onSearchResultsChange,收斂成單一 callback。geocode 類型的點擊
  // 這個元件內部會先攔截走 handleGeocodeCandidateSelect(見下方
  // GeoOutlineMap 呼叫處),確保跟側欄清單點候選(externalGeocodeCandidateSelect)
  // 走同一套完整流程(含 suppressQuery:false 重新查詢新範圍),不會漏接
  // 這個中介步驟。
  onSearchResultSelect?: (result: GeoSearchResult) => void
  // onGeocodeCandidateText/onGeocodeCandidatePhoto:候選有 placeId 時,
  // 選定後這個元件會平行呼叫 fetchGeoPlaceText(文字:名稱/地址/評分/
  // 簡介)與 fetchGeoPlacePhoto(照片,Pexels-first + GCS 落地),兩支
  // 請求互不等待——文字通常先回來,讓呼叫端能立刻把資訊卡升級成完整
  // 文字版本(此時 photoUrl 仍未知,畫面顯示佔位圖,使用者不需要等
  // 照片查完才看到名稱/地址/簡介這些內容,見下方
  // handleGeocodeCandidateSelect 的說明);照片查到後再單獨補上,不影響
  // 已經顯示的文字內容。這樣拆分後就不能再直接沿用 onPoiSelect 那樣
  // 「一次拿到完整 GeoPlaceDetails 才觸發」的既有慣例,呼叫端需要自行
  // 用 useState 或類似機制,把文字/照片兩次回呼的結果合併成同一張
  // 資訊卡(見 DesktopLayout.tsx 的接線)。查詢失敗、或候選沒有 placeId
  // (理論上不該發生,見該型別的說明)時不會觸發,不視為錯誤。
  onGeocodeCandidateText?: (placeId: string, text: GeoPlaceText) => void
  onGeocodeCandidatePhoto?: (placeId: string, photoUrl: string | null) => void
  // externalGeocodeCandidateSelect:GeoHotelSidebar 合併清單裡的飯店/地點/
  // 搜尋結果項目被點擊時,由 DesktopLayout.tsx 傳入同一個 GeoSearchResult
  // 物件——不能直接沿用 externalPanTarget(那個機制固定
  // suppressQuery:true,是刻意給「只是想對齊看清楚一個已知項目」的候選籃/
  // 探索周邊用的,見該 prop 的完整說明),清單點擊的使用者意圖是「移動並
  // 查詢新範圍」,必須走跟地圖上點 marker 完全相同的
  // handleGeocodeCandidateSelect(suppressQuery:false),兩種入口(地圖
  // marker/側欄清單)才會有一致的行為,不會出現「清單點候選,地圖有移動
  // 但景點/飯店清單卻沒有跟著更新」的落差(這是實際發生過的 bug)。名稱
  // 沿用「GeocodeCandidate」是歷史命名(原本只處理搜尋結果,見
  // useGeoPlanningState.ts「onSelectGeocodeCandidate 的統一決策」的完整
  // 說明,現在飯店/地點/搜尋結果三者都走這條路徑,不重新命名 prop 是
  // 避免無謂的破壞性變更)。用物件參照(而非純座標)當 useEffect 依賴,
  // 理由同下方 handleGeocodeCandidateSelect 的呼叫時機——每次點擊呼叫端
  // 都會建立新物件參照,即使連續點同一筆候選也能觸發。
  externalGeocodeCandidateSelect?: GeoSearchResult | null
  panTarget?: { lat: number; lng: number; level?: number; radiusMeters?: number; onlyIfOutOfView?: boolean } | null
  selectedKey?: GeoSelectedKey
  // candidateKeys/hoverKey:原封不動轉傳給 GeoOutlineMap——理由同
  // selectedKey,見 GeoOutlineMap.tsx 對這兩個 prop 的完整說明。
  candidateKeys?: Set<string>
  hoverKey?: GeoSelectedKey
  // searchTrigger:每次遞增時觸發一次城市搜尋(用目前的 city prop 值)
  // ——用遞增計數器而非直接暴露一個「查詢」函式給外部呼叫,是因為這個
  // 元件本身沒有 ref,外部(GeoCandidateSidebar 的搜尋按鈕)無法直接呼叫
  // 內部方法,改用「外部改變一個 prop 值 → 這裡的 useEffect 偵測到變化
  // 才查詢」的單向資料流,對齊這個檔案其餘 panTarget/tripID 等 prop 的
  // 既有慣例(見下方 useEffect 的依賴陣列)。
  searchTrigger?: number
  // refetchTripEntriesTrigger:每次遞增時重新查一次目前旅程的 entries、
  // 更新 tripEntries/onTripEntriesChange,但不動 tripCenter(不重新判斷
  // 地圖初始中心、也不讓 GeoOutlineMap 重新等待)——供
  // GeoCandidateSidebar 幫「未排定日期」的候選補上日期後,通知這裡刷新
  // 一份新的 tripEntries,好讓該候選從「未排定日期」分組移到正確的日期
  // 分組。跟 searchTrigger 是同一種「外部改變一個 prop 值 → 這裡的
  // useEffect 偵測到變化才動作」模式,理由同該 prop 的說明。0(初始值)
  // 不觸發。
  refetchTripEntriesTrigger?: number
  // theme:這個 App 的深色/淺色模式偏好(useAppState() 的 theme,見
  // theme.ts),原封不動轉傳給 GeoOutlineMap 決定建圖時的 colorScheme
  // ——見 GeoOutlineMap.tsx 對這個 prop 的完整說明。這個元件本身不消費
  // theme,純轉傳。
  theme?: Theme
  // geocodeCandidates/setGeocodeCandidates:2026-08 起這份 state 的擁有權
  // 從這個元件搬到 useGeoPlanningState.ts(桌面版/手機版共用的狀態層),
  // 這個元件改為受控,只負責讀寫傳入的 props——搬遷理由:「關閉搜尋清單
  // 時連動清空地圖 marker」這個需求的觸發點(GeoOutlinePhoneView.tsx 的
  // GeoOutlinePhoneListDrawer.onClose)活在比這個元件更外層,原本的私有
  // useState 碰不到,只有搬到兩邊呼叫端共用的那一層,外層才能直接呼叫
  // setter 清空它。型別/語意跟原本的私有 state 完全相同,見下方讀取處
  // (城市搜尋框查詢完成、onGeocodeCandidatesChange、搜尋框文字清空時
  // 連動清空)——這幾處原本呼叫 setGeocodeCandidates(內部 setState)的
  // 地方,現在呼叫的是這個 prop(呼叫端傳入的 setter),行為不變。
  geocodeCandidates: GeoGeocodeCandidate[]
  setGeocodeCandidates: (candidates: GeoGeocodeCandidate[]) => void
  // selectedCandidate/setSelectedCandidate:同上,一併搬遷——驅動下方
  // 補查文字/照片的 useEffect(依賴陣列用 selectedCandidate?.placeId,
  // 這個既有的坑見該 effect 的完整說明,搬遷後維持不變)。
  selectedCandidate: GeoSearchResult | null
  setSelectedCandidate: (candidate: GeoSearchResult | null) => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // mapCenter:GeoOutlineMap 每次 idle 回報的目前地圖中心座標(見該元件
  // onCenterChange prop 的說明)——供下方 searchTrigger 的 effect 當
  // locationBias 使用,讓「甜點」「apple」這類沒有明確指向單一地點的
  // 泛用關鍵字查詢優先偏向目前地圖所在區域(見 handleGeoGeocode 的完整
  // 說明)。初始值 null 代表地圖尚未 idle 過一次(理論上進入這個分頁、
  // 地圖建立完成後很快就會有第一次 idle),此時查詢不帶位置偏向,不視為
  // 錯誤。
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  // panRequest:目前要移動地圖到的目標,兩個獨立來源(搜尋框查到的座標/
  // externalPanTarget 側欄點擊)共用同一個 state,誰最後觸發就用誰——
  // 取代原本「搜尋 > 側欄點擊」寫死優先序的舊寫法(見下方 effectivePanTarget
  // 的說明,那個寫法有實際發生過的 bug:searchPanTarget 只有查詢成功時
  // 會設值,從來不會被清空,一旦使用者用過一次城市搜尋,之後所有側欄
  // 點擊——包含候選籃「已排入行程」項目點擊要移動地圖到該點——都會被
  // 這個過時的搜尋座標永久蓋掉,地圖只會不斷被拉回最後一次搜尋的地方,
  // 使用者會觀察到「資訊欄有正確顯示點擊的項目,但地圖完全不會動」)。
  // 每次設值都建立新物件參照,即使連續觸發同一個座標也能讓 GeoOutlineMap
  // 偵測到「這是一次新的移動請求」(理由同 GeoOutlineMap.tsx 對 panTarget
  // 的說明)。
  const [panRequest, setPanRequest] = useState<{ lat: number; lng: number; level?: number; radiusMeters?: number; suppressQuery: boolean; onlyIfOutOfView?: boolean } | null>(null)
  // geocodeCandidates/selectedCandidate:2026-08 起改由 props 傳入(見上方
  // 型別區塊對這兩個 prop 的完整說明),這個元件不再持有私有 useState。
  // 保留在這裡的原因說明(唯一資料來源、三個查詢入口共用、點擊確認後
  // 不清空、與 selectedCandidate 的關聯)完整內容見
  // useGeoPlanningState.ts 對應宣告處與下方各處讀寫的說明,不重複貼一份
  // 在這裡——這個元件現在只負責「什麼時候該讀/寫」,不再是「資料實際
  // 放在哪裡」的擁有者。
  // tripCenter:目前旅程底下已有座標的 entry 算出來的中心點,見下方
  // useEffect,傳給 GeoOutlineMap 當地圖第一次建立時的初始中心(見該
  // 元件 initialCenter prop 的完整說明)——三態:undefined 代表「還在
  // 查、尚未確定」(初始值,地圖建立要等待這個狀態解除);null 代表
  // 「已確定查無可用資料」(沒有 tripID、或旅程沒有帶座標的既有地點、
  // 或查詢失敗),退回地圖內建的預設起點;物件代表確定要用這組座標。
  // 每次 tripID 變動就重新設回 undefined、重新查一次——換旅程後舊旅程
  // 的中心點不該繼續生效。
  const [tripCenter, setTripCenter] = useState<{ lat: number; lng: number } | null | undefined>(undefined)
  // tripEntries:同 tripCenter 查詢流程一併算出的完整帶座標 entry 清單
  // ——這個元件自己也要留一份(不只是往外 callback),才能傳給
  // GeoOutlineMap 畫 marker(見下方 <GeoOutlineMap tripEntries={...}>)。
  const [tripEntries, setTripEntries] = useState<GeoTripEntry[]>([])

  // 每次 searchTrigger 遞增(GeoCandidateSidebar 的搜尋按鈕/Enter 觸發,
  // 見 DesktopLayout.tsx 的接線)就查一次目前的 city 值——用 effect 而非
  // 直接在按鈕 onClick 裡呼叫這個元件的方法,因為 UI 在另一個元件裡(見
  // 上方元件註解),這是唯一能讓外部觸發這裡查詢邏輯的方式。0(初始值)
  // 不觸發查詢,只有真的遞增過至少一次才查。
  useEffect(() => {
    if (!searchTrigger) return
    const trimmed = city.trim()
    if (!trimmed) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    // 不在這裡先 setGeocodeCandidates([])清空——這個清空動作若走舊版
    // level-triggered 設計(觀察 state 變化間接觸發 onSearchResultsChange)
    // 會被誤判成「查詢完成」提前結束 loading(使用者實測回報過這個
    // bug)。2026-08 起改成 edge-triggered:onSearchResultsChange 只在
    // 下方查詢真正完成的位置直接呼叫,不再依賴觀察 state 變化,故這裡
    // 即使不清空也不會有這個問題——但依然不清空,理由不變:loading 為
    // true 期間清單抽屜/資訊卡本來就已經用轉圈動畫蓋住整個 body(見
    // GeoOutlinePhoneListDrawer.tsx 轉傳給 PhoneBottomSheet 的 loading
    // prop),不需要另外搶先清空候選來避免舊資料殘留。
    fetchGeoGeocode(cfg, trimmed, mapCenter ?? undefined)
      .then((result) => {
        if (cancelled) return
        // 只有一筆候選時不需要使用者再點一次確認——直接沿用原本
        // 「查完就 pan 過去」的行為;多筆候選才交給地圖標出來讓使用者
        // 自己選(見下方 geocodeCandidates 的完整說明與
        // handleGeocodeCandidateSelect)。使用者明確要求:即使只有一筆
        // 也要自動顯示這個地點的資訊卡(理由同 handleGeocodeCandidateSelect
        // 對多筆候選點選後的既有行為)——原本這裡只 setPanRequest、不呼叫
        // onSearchResultSelect,搜尋整座城市這類唯一解查詢時地圖會
        // 移動過去,但完全沒有任何資訊卡跳出來,使用者容易誤以為搜尋沒有
        // 生效。setGeocodeCandidates 這裡仍然要呼叫(即使只有一筆),讓
        // geocodeCandidates 完整反映這次查詢結果;下方統一呼叫
        // onSearchResultsChange 通知清單抽屜(edge-triggered,見該呼叫處
        // 的說明)。
        if (result.candidates.length === 1) {
          const only = result.candidates[0]
          setPanRequest({ lat: only.lat, lng: only.lng, suppressQuery: false })
          const onlyResult = geocodeCandidateToSearchResult(only)
          onSearchResultSelect?.(onlyResult)
          // 文字/照片補查交給下方統一的 selectedCandidate effect,不在
          // 這裡重複發請求——理由見該 state 的說明。
          setSelectedCandidate(onlyResult)
          setGeocodeCandidates(result.candidates)
        } else {
          setGeocodeCandidates(result.candidates)
        }
        // 查詢真正完成的這一刻直接呼叫 onSearchResultsChange(edge-
        // triggered),不再依賴 GeoOutlineMap.tsx 觀察 geocodeCandidates
        // 衍生出的 searchResults state 變化去間接觸發(level-triggered)
        // ——後者是「任何寫入 geocodeCandidates 的地方都會被誤判成查詢
        // 完成」這類 bug 的結構性根因(已修過兩次同類問題:清空候選被
        // 誤判成查詢完成、元件掛載時 useEffect 必定執行一次被誤判)。
        // 這裡直接在唯一真正代表「查詢完成」的語意位置呼叫,不管
        // geocodeCandidates 之後有沒有動、為什麼動,都不會再意外觸發。
        onSearchResultsChange?.(result.candidates.map(geocodeCandidateToSearchResult))
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger])

  // 搜尋框文字清空時,連動清空地圖上的搜尋結果——使用者清空輸入框是
  // 明確的「不想再看這批結果了」訊號(對齊探索標籤再點一次取消選取、
  // 清空 attractions 圖層的既有互動語意,見 GeoOutlineMap.tsx 該處的
  // 說明),不清掉的話,候選 marker/籃還會停留在地圖上,跟使用者「已經
  // 清空搜尋」的預期不符。這條規則以前沒辦法乾淨地寫,是因為地圖結果
  // 分裂成 geocodeCandidates(這裡)與 GeoOutlineMap.tsx 內部的 places
  // 兩份 state,後者沒有直接存取 city 的必要性——合併成這裡唯一一份
  // geocodeCandidates 之後,只需要這一處。
  useEffect(() => {
    if (city.trim() === '') setGeocodeCandidates([])
  }, [city])

  // handleGeocodeCandidateSelect:使用者在地圖上點擊某個候選 marker、或
  // 在 GeoHotelSidebar 合併清單裡點候選項目確認選定——不再清空候選圖層
  // (先前版本會清空,但這樣使用者選錯後沒辦法直接點另一個候選重選,得
  // 重新搜尋一次;改成其餘候選繼續留在地圖上,選取樣式現在跟飯店/地點
  // 共用同一套 selectedKey/hoverKey 機制,見 GeoOutlineMap.tsx 對
  // useSearchResultMarkers 的說明,不需要再另外維護一個獨立的
  // selectedGeocodeCandidateKey)。把完整候選資料轉成 GeoSearchResult
  // 往上回報(見 onSearchResultSelect)讓呼叫端開啟 GeoInfoPanel 顯示這個
  // 候選的資訊,同時移動地圖——使用者要求搜尋結果、飯店、推薦地點三種
  // 來源既然合併成同一份清單顯示,點擊行為也該一致,故這裡改用跟
  // onSelectHotel/onSelectPlace 相同的 onlyIfOutOfView 規則(目前不在
  // 可視範圍內才移動,見該欄位的完整說明),不再是完全不移動。
  // suppressQuery 固定 false(而非 externalPanTarget 那套固定 true 的
  // 機制)——候選是使用者剛主動搜尋、意圖是「移動並查詢新範圍」,理由同
  // externalGeocodeCandidateSelect prop 的完整說明,移動後仍要重新查詢
  // 新範圍的景點/飯店資料。
  // useStableCallback:這個 handler 會被傳進 GeoOutlineMap →
  // useSearchResultMarkers 的 onSelect,後者的 marker 建立 useEffect 把
  // onSelect 放進依賴陣列(見該檔案的說明)——若這裡是一般函式,每次
  // GeoOutlinePanel 重渲染(例如使用者拖曳地圖觸發 bounds/zoom 狀態
  // 更新連帶父層重渲染)都會產生新的函式參照,讓那個 effect 誤判成
  // 「有新一批搜尋結果」而重新執行,若清單裡含 geocode 結果還會重新
  // fitBounds、把地圖拉回搜尋結果範圍(這是實際發生過的 bug:拖曳地圖
  // 會自動彈回原位)。用 useStableCallback 讓這個 handler 天生擁有穩定
  // 參照,消費端不需要再各自寫 ref 包裝防禦這件事。
  const handleGeocodeCandidateSelect = useStableCallback((r: GeoSearchResult) => {
    onSearchResultSelect?.(r)
    setPanRequest({ lat: r.lat, lng: r.lng, suppressQuery: false, onlyIfOutOfView: true })
    // 文字/照片補查交給下方統一的 selectedCandidate effect,不在這裡
    // 重複發請求——理由見該 state 的說明。使用者短時間內連續切換候選
    // 是可能的(見上方「其餘候選繼續留在地圖上」的說明),effect 的
    // cancelled flag 會讓切換當下還沒回來的舊請求結果被正確捨棄。只有
    // geocode 類型會有 placeId(見 GeoSearchResult 的說明),hotel/place
    // 沒有 placeId,下方 effect 會自然 no-op,不需要在這裡先過濾。
    setSelectedCandidate(r)
  })

  // selectedCandidate 變動時(見該 state 的說明)平行查文字/照片——文字
  // (fetchGeoPlaceText)通常先回來,能讓資訊卡提早顯示完整名稱/地址/
  // 簡介,不必等照片查完才有反應,照片還沒到之前畫面顯示佔位圖(見
  // onGeocodeCandidatePhoto 的說明)。兩支請求彼此獨立、不互相等待,也
  // 各自的 .catch 靜默放棄失敗——理由同這支端點其餘呼叫端「照片/詳細
  // 資訊是加值,查不到不算整體失敗」的既有慣例。cancelled 是這個 effect
  // 自己的區域變數,每次 selectedCandidate 變動(切換到另一個候選)都會
  // 先跑清理函式把上一輪設成 true,讓舊請求回來時不會呼叫
  // onGeocodeCandidateText/onGeocodeCandidatePhoto 更新到已經不對應的
  // 候選上——不需要呼叫端(DesktopLayout.tsx)另外維護一個變數手動比對
  // 「這次回來的結果是不是還對應目前顯示的卡片」,那種做法容易誤踩
  // stale closure(見 git 歷史這裡曾經修過的實際 bug)。沒有 placeId 時
  // 不查(理論上 Text Search 每筆結果都會有,見 GeoGeocodeCandidate 型別
  // 的說明;沒有就維持只顯示輕量版內容,不視為錯誤)。
  //
  // 依賴陣列刻意用 selectedCandidate?.placeId(字串),不是 selectedCandidate
  // 本身(物件參照)——這是實際發生過的 bug:地圖上連續點同一顆 marker
  // 兩次,useSearchResultMarkers.ts 的 gmp-click handler 是在 marker 建立
  // 當下就把 GeoSearchResult 物件封進 closure,同一顆 marker 兩次點擊傳的
  // 是完全相同的物件參照,setSelectedCandidate(r) 沒有換掉參照,若依賴
  // 陣列比對的是物件本身,React 會判定「沒有變化」而不重新執行這個
  // effect,導致 handleGeocodeCandidateSelect 已經把卡片內容重置成輕量版
  // (見該函式呼叫的 onSearchResultSelect),卻沒有觸發任何補查請求,評分/
  // 簡介/「加入行程」按鈕永久消失、不會補回來(側欄清單點擊不會出現這個
  // 問題,是因為 selectSearchResultFromList 每次都用 {...r} 建立新物件)。
  // 改成比對 placeId 這個穩定字串後,不管呼叫端傳的是不是新物件參照,只要
  // 選定的地點沒變就不重查、變了就一定重查,兩種入口行為一致。
  useEffect(() => {
    const placeId = selectedCandidate?.placeId
    if (!placeId) return
    const name = selectedCandidate.name
    let cancelled = false
    fetchGeoPlaceText(cfg, placeId)
      .then((text) => {
        if (cancelled) return
        onGeocodeCandidateText?.(placeId, text)
      })
      .catch(() => {})
    fetchGeoPlacePhoto(cfg, placeId, name)
      .then((result) => {
        if (cancelled) return
        onGeocodeCandidatePhoto?.(placeId, result.photoUrl ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidate?.placeId])

  // externalGeocodeCandidateSelect(GeoHotelSidebar 合併清單裡的候選項目
  // 被點擊,見該 prop 的說明)變動時,直接呼叫跟地圖上點 candidate
  // marker 完全相同的 handleGeocodeCandidateSelect——兩種入口共用同一份
  // 邏輯,不重新實作一份跳過 suppressQuery:false 的簡化版。
  // handleGeocodeCandidateSelect 現在用 useStableCallback 包過(見該處
  // 說明),參照永遠不變,可以放心放進依賴陣列,不需要 eslint-disable
  // 跳過檢查。
  useEffect(() => {
    if (!externalGeocodeCandidateSelect) return
    handleGeocodeCandidateSelect(externalGeocodeCandidateSelect)
  }, [externalGeocodeCandidateSelect, handleGeocodeCandidateSelect])

  // 切到這個分頁或換旅程時,若旅程底下已有帶座標的 entry,算出這些點的
  // 平均座標當地圖初始中心——只在 tripID 變動時查一次,不是每次都重查:
  // 這裡只負責「一開始該看哪裡」,之後使用者搜尋/拖曳地圖的移動不該被
  // 這份初始定位持續蓋過。重設回 undefined(而非直接設 null)是關鍵:
  // 讓 GeoOutlineMap 知道「還在查、地圖建立要等」,查完(不論有沒有查到
  // 可用資料)才轉成確定的 null 或物件,避免地圖搶先用預設值建好、之後
  // 才發現其實該建在別的地方,造成先查一次沒用的資料。
  useEffect(() => {
    setTripCenter(undefined)
    setTripEntries([])
    onTripEntriesChange?.([])
    if (!tripID) {
      setTripCenter(null)
      return
    }
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        // 順便把完整的帶座標 entry 清單(不只是算完就丟的平均座標)存下來
        // 並往上回報——這批點要畫在地圖上(見下方 <GeoOutlineMap
        // tripEntries={...}>)、也要自動帶進候選籃(見 DesktopLayout.tsx),
        // 不是只用來算初始定位。
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
        if (mapped.length === 0) {
          setTripCenter(null)
          return
        }
        const latSum = mapped.reduce((sum, e) => sum + e.lat, 0)
        const lngSum = mapped.reduce((sum, e) => sum + e.lng, 0)
        setTripCenter({ lat: latSum / mapped.length, lng: lngSum / mapped.length })
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤,但仍要轉成確定的 null——讓地圖不再
        // 繼續等待,退回預設起點,而不是永遠卡在 undefined 不建圖。
        if (!cancelled) setTripCenter(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID])

  // 補上日期後刷新 tripEntries:refetchTripEntriesTrigger 遞增時重新查一次
  // entries、更新 tripEntries/onTripEntriesChange,但不動 tripCenter——見
  // 該 prop 的說明。0(初始值)不觸發,避免掛載當下跟上面那個 effect
  // 重複查一次。
  useEffect(() => {
    if (!refetchTripEntriesTrigger || !tripID) return
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,不彈錯誤
        // 訊息打斷瀏覽,理由同其餘查詢失敗處理方式。
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTripEntriesTrigger])

  // externalPanTarget(側欄點擊,含候選籃「已排入行程」項目)變動時,
  // 更新成新的 panRequest——跟上面 searchTrigger 成功時直接 setPanRequest
  // 是同一份 state,「誰最後觸發就用誰」,不再有寫死的來源優先序(理由見
  // panRequest 宣告處的說明)。suppressQuery 固定為 true:側欄點擊只是想
  // 對齊看清楚一個已知項目,範圍通常沒有實質改變,該抑制以避免所有點
  // 清空重畫(對比搜尋框查到的座標,使用者明確按下「查看」要換一個地方
  // 看,移動後必須查詢新範圍的資料,不能抑制,見 setPanRequest 呼叫處)。
  // 依實際座標值(而非物件參照)當依賴,避免呼叫端每次重渲染都產生新的
  // externalPanTarget 物件參照時,這裡跟著誤判成「有新的移動要執行」。
  const externalLat = externalPanTarget?.lat
  const externalLng = externalPanTarget?.lng
  const externalLevel = externalPanTarget?.level
  const externalRadiusMeters = externalPanTarget?.radiusMeters
  const externalOnlyIfOutOfView = externalPanTarget?.onlyIfOutOfView
  useEffect(() => {
    if (externalLat == null || externalLng == null) return
    setPanRequest({
      lat: externalLat,
      lng: externalLng,
      level: externalLevel,
      radiusMeters: externalRadiusMeters,
      suppressQuery: true,
      onlyIfOutOfView: externalOnlyIfOutOfView,
    })
  }, [externalLat, externalLng, externalLevel, externalRadiusMeters, externalOnlyIfOutOfView])

  return (
    <div className={styles.wrap}>
      <div className={styles.mapArea}>
        <GeoOutlineMap
          cfg={cfg}
          initialCenter={tripCenter}
          tripEntries={tripEntries}
          city={city}
          onCityChange={onCityChange}
          onSearch={onSearch}
          onOpenChat={onOpenChat}
          showZoomControl={showZoomControl}
          searchRightSlot={searchRightSlot}
          searching={loading}
          searchError={err}
          onAttractionsChange={onAttractionsChange}
          revealedAttractionNames={revealedAttractionNames}
          hoveredCuratedName={hoveredCuratedName}
          onSearchStart={onSearchStart}
          hideCategoryTags={hideCategoryTags}
          // onGeocodeCandidatesChange:類別標籤/「搜尋這個區域」按鈕觸發
          // 的查詢完成時,GeoOutlineMap.tsx 透過這個 callback 通知這裡
          // 更新 geocodeCandidates(理由見該 state 宣告處的完整說明)——
          // 這個元件是 geocodeCandidates 唯一的資料來源,GeoOutlineMap
          // 本身不再自己持有一份平行的 state。同時在這個查詢真正完成的
          // 位置直接呼叫 onSearchResultsChange(edge-triggered)——理由
          // 同上方城市搜尋框 fetchGeoGeocode.then() 裡的說明,不再依賴
          // GeoOutlineMap.tsx 內部觀察 state 變化間接觸發(該檔案那個
          // useEffect 已移除,見其說明)。
          onGeocodeCandidatesChange={(candidates) => {
            setGeocodeCandidates(candidates)
            onSearchResultsChange?.(candidates.map(geocodeCandidateToSearchResult))
          }}
          onActiveCategoryChange={onActiveCategoryChange}
          onAttractionSelect={onAttractionSelect}
          // 統一走 handleGeocodeCandidateSelect(含補查文字/照片、
          // onlyIfOutOfView 移動地圖)——理由見該函式的完整說明:飯店/
          // 地點/搜尋結果三種來源既然合併成同一份清單顯示,「地圖上直接
          // 點 marker」跟「側欄清單點擊」(externalGeocodeCandidateSelect)
          // 兩種入口的行為也該一致,不再讓 hotel/place 走另一條不移動
          // 地圖的簡化路徑。
          onSearchResultSelect={handleGeocodeCandidateSelect}
          onPoiSelect={onPoiSelect}
          onCenterChange={setMapCenter}
          panTarget={panRequest}
          selectedKey={selectedKey}
          candidateKeys={candidateKeys}
          hoverKey={hoverKey}
          geocodeCandidates={geocodeCandidates}
          theme={theme}
        />
      </div>
    </div>
  )
}
