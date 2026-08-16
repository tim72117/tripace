import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import type { ApiCall, WsEvent } from './api'
import { onApiCall, onWsEvent } from './api'
import { ChatScreen } from './chat/ChatScreen'
import type { DesktopTimelineMirror } from './chat/ChatScreen'
import { MultiTrackTimeline, type TaskPlaceholder } from './timeline/Timeline'
import { PaceChart } from './pace/PaceChart'
import { DemoPanel } from './DemoPanel'
import { GeoHotelSidebar, geoItemKey, type GeoSelectedKey, type Tab as GeoTab } from './geo-planning/GeoHotelSidebar'
import { GeoInfoPanel, type GeoInfoContent } from './geo-planning/GeoInfoPanel'
import { AttractionInfoPanel } from './geo-planning/AttractionInfoPanel'
import { GeoCandidateSidebar, type GeoCandidate, createEntryFromCandidate } from './geo-planning/GeoCandidateSidebar'
import { AddFromCandidateSidebar, dayGroupLabel } from './geo-planning/AddFromCandidateSidebar'
import { GeoOutlinePanel } from './geo-planning/GeoOutlinePanel'
import { placesQueryRadiusMeters } from './geo-planning/geoAttractionClick'
import type { GeoAttraction, GeoGeocodeCandidate, GeoHotel, GeoPlace, GeoPlaceDetails } from './api'
import { type ContentProps } from './AppCommon'
import { type PanelMode, isPanelMode, DemoPanelContent, DEBUG_PANEL_ENABLED, PANEL_REGISTRY } from './DesktopShared'
import { RouteEditor } from './RouteEditor'
import { DesktopRail } from './DesktopRail'
import { DesktopTripList } from './DesktopTripList'
import { SettingsDialog } from './SettingsDialog'
import { TripManageModal } from './trip/TripManageModal'
import type { Trip } from './types'
import './styles-desktop.css'
import './desktop-layout-shell.css'
import styles from './DesktopLayout.module.css'

// DesktopLayout:桌面版(寬度 >= 768px)專屬佈局元件——左側邊欄(行程列表 +
// 使用者選單)+ 右側 ChatScreen 主要區塊,類似 Slack/Discord 的行程側欄
// 模式。PanelMode/DemoPanelContent/LangSelect/TokenDisplay/useTripsState
// 這些「桌面/手機共用」的部分不在這裡,分別在 DesktopShared.tsx/
// AppCommon.tsx——避免這裡跟手機版檔案(PhoneContent.tsx/PhoneNavDrawer.tsx/
// PhoneScreens.tsx)互相 import 對方造成循環依賴。

// 時間軸鏡像資料的初始值(尚未收到 ChatScreen 鏡像前,或未選擇行程時使用)。
const EMPTY_TIMELINE_MIRROR: DesktopTimelineMirror = {
  entries: [],
  updatingEntryIDs: new Set<string>(),
  taskPlaceholders: [] as TaskPlaceholder[],
  refetchEntries: () => {},
}

// hotelInfoContent/placeInfoContent/poiInfoContent/candidateInfoContent:
// 把各種點擊來源(側欄飯店/推薦地點清單、地圖上 Google 原生 POI 圖標、
// 候選籃項目)統一轉成 GeoInfoPanel 需要的 GeoInfoContent 形狀,含
// candidate 欄位(見 GeoInfoPanel.tsx 的說明)——抽成獨立函式而非寫在各個
// onClick 內聯,是因為「地圖上點擊/側欄點擊/候選籃點擊同一個地點」三種
// 觸發來源现在都要組出一樣的卡片內容,重複三次內聯邏輯容易在其中一處
// 修改欄位後忘記同步另外兩處。
//
// attraction(人工建檔的景點區域)不再走這套 GeoInfoContent/GeoInfoPanel
// 流程——改用獨立的 AttractionInfoPanel(見該檔案的說明),直接吃原始
// GeoAttraction 物件,不需要轉換成 GeoInfoContent 形狀,也不需要
// candidate 欄位的 undefined 判斷(attraction 本來就不接受加入候選籃/
// 行程)。

function hotelInfoContent(h: GeoHotel): GeoInfoContent {
  return {
    name: h.name,
    photoUrl: h.photoUrl,
    subtitle: h.address,
    badges: [],
    candidate: { kind: 'hotel', ...h },
  }
}

function placeInfoContent(p: GeoPlace): GeoInfoContent {
  return {
    name: p.name,
    photoUrl: p.photoUrl,
    subtitle: p.address,
    badges: [],
    candidate: { kind: 'place', ...p },
  }
}

// poiInfoContent:點擊地圖上 Google 原生 POI 圖標查回的 GeoPlaceDetails——
// 沒有 primaryType 欄位(GeoPlace 候選籃形狀需要,但 Places Details API
// 這支查詢沒有回傳分類),補空字串,理由同 GeoHotelSidebar 卡片「+」的
// 既有慣例(這裡的候選籃資料本來就只拿 name/address/lat/lng/photoUrl
// 顯示,primaryType 目前沒有任何顯示邏輯依賴它)。
function poiInfoContent(details: GeoPlaceDetails): GeoInfoContent {
  return {
    name: details.name,
    photoUrl: details.photoUrl,
    subtitle: details.address,
    summary: details.summary,
    badges: details.rating != null ? [`評分 ${details.rating.toFixed(1)}`] : [],
    candidate: {
      kind: 'place',
      name: details.name,
      address: details.address,
      lat: details.lat,
      lng: details.lng,
      primaryType: '',
      photoUrl: details.photoUrl,
    },
  }
}

// geocodeCandidateInfoContent:點擊地圖上的搜尋候選 marker(見
// GeoOutlineMap.tsx 的 geocodeCandidates/onGeocodeCandidateSelect)開
// 資訊欄——GeoGeocodeCandidate 跟 GeoPlaceDetails 一樣沒有 primaryType/
// summary/rating,補法同 poiInfoContent 的既有慣例(primaryType 補空
// 字串,badges 固定空陣列)。
function geocodeCandidateInfoContent(c: GeoGeocodeCandidate): GeoInfoContent {
  return {
    name: c.name,
    subtitle: c.address,
    badges: [],
    candidate: {
      kind: 'place',
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      primaryType: '',
    },
  }
}

// candidateInfoContent:候選籃項目本體被點擊時開資訊欄——candidate 欄位
// 刻意不帶(undefined),因為這個項目已經在候選籃裡,GeoInfoPanel 不需要再
// 顯示一次「加入候選」按鈕(理由同 GeoInfoPanel.tsx candidate 欄位的
// optional 設計,呼叫端可以視情境不組出這個欄位)。候選籃不會出現
// kind==='attraction' 的項目(attraction 沒有任何入口能被加入候選籃,見
// 上方說明),故這裡不需要處理該分支。entry 種類(行程本身已有座標的
// 既有內容)用 location 當 subtitle,其餘兩種沿用 address。
function candidateInfoContent(c: Exclude<GeoCandidate, { kind: 'attraction' }>): GeoInfoContent {
  if (c.kind === 'entry') {
    return { name: c.name, subtitle: c.location ?? undefined, badges: [] }
  }
  return { name: c.name, photoUrl: c.photoUrl, subtitle: c.address, badges: [] }
}

export function DesktopContent(props: ContentProps) {
  const { cfg, activeTrip, setActiveTrip } = props
  // settingsOpen 獨立於 DesktopUserMenu 內部的 popover 開關狀態:選單裡點「設定」
  // 時會同時關閉 popover(DesktopUserMenu 內部 state)並開啟這裡的 dialog。
  // dialog 提升到這一層(而非渲染在 DesktopUserMenu/側欄內部)渲染,是因為
  // .desktop-layout 設有 overflow: hidden,side bar 寬度也只有 272px——
  // 若 dialog 渲染在側欄內部,置中/覆蓋全畫面的彈窗會被側欄裁切或擠壓變形。
  // 提升到這裡、和 .desktop-layout 同層,搭配 CSS 的 position: fixed 疊加,
  // 才能保證 dialog 蓋住整個桌面版佈局(含側欄)最上層。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // manageTrip:行程管理彈窗(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)——原本分成 shareTrip/membersTrip 兩個獨立彈窗,
  // 現在合併成一個彈窗、一個觸發來源(行程列表每一筆項目的「管理」按鈕,
  // 見 DesktopTripList.tsx 的 onManage)。存「哪個行程」而非布林值,因為
  // 觸發來源是清單裡任一筆,不一定是 activeTrip。跟 settingsOpen 一樣
  // 提升到這一層渲染(理由同上方 settingsOpen 的說明:避免被 272px 寬的
  // 浮動卡片裁切)。
  const [manageTrip, setManageTrip] = useState<Trip | null>(null)
  // panelMode:rail/side panel 的狀態改由網址驅動(/app/:panelMode,見 App.tsx),
  // 不再是這一層自己的 useState——這樣瀏覽器上一頁/下一頁、重新整理、分享連結
  // 都能還原到對應的 side panel/main 畫面。navigate 的部分見下方 setPanelMode。
  //
  // 「收合」(panelMode === null)現在直接對應 /app 無參數本身,不再需要
  // 獨立的路徑片段(先前用過 /app/none)——側欄收合時主顯示區改直接呈現
  // 規劃地圖(見下方 activeTrip 分支的說明),不再是空畫面,所以「一進 App
  // 預設落地的網址」跟「側欄收合」可以是同一個狀態,不需要分開表示法。
  // 網址帶了不合法的 panelMode 字串(不在 PanelMode 列表)時,同樣視為
  // 收合——理由同上,收合狀態本身已經有明確畫面可看(地圖),不需要再
  // fallback 到行程列表當「看得懂的畫面」。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  const panelMode: PanelMode =
    panelModeParam == null ? null : isPanelMode(panelModeParam) ? panelModeParam : null
  const navigate = useNavigate()
  // setPanelMode:取代原本的 useState setter,改成 navigate 到對應路徑。
  // 再點一次目前啟用中的圖示會收合 panel,導向 /app(無參數,見上方
  // panelMode 的說明)。
  const setPanelMode = useCallback((mode: Exclude<PanelMode, null>) => {
    navigate(panelMode === mode ? '/app' : `/app/${mode}`)
  }, [navigate, panelMode])
  // chatPopoverOpen:地圖右上角城市搜尋框旁 AI 按鈕觸發的對話浮動小匡
  // 開關——沒有常駐對話欄,ChatScreen 只在這個小匡開啟時才掛載(見下方
  // render 邏輯),這是使用者存取對話功能的唯一入口。
  const [chatPopoverOpen, setChatPopoverOpen] = useState(false)
  // geoHotels:地理輪廓底圖(構想 6 試做,demo-geo-outline)查詢到的飯店
  // 清單,由 GeoOutlinePanel(main 區塊內部)透過 onHotelsChange 回報,
  // 這裡的 state 供下方渲染的 GeoHotelSidebar(整個桌面版介面最外側,
  // 跟 .desktop-main 平行)使用——兩個分開掛載的 sibling 需要這層 state
  // 中介資料。
  const [geoHotels, setGeoHotels] = useState<GeoHotel[]>([])
  // geoPlaces:點擊地圖上的地標圖示時即時查詢到的附近推薦地點(見
  // GeoOutlineMap.tsx 的 handleAttractionClick、GeoHotelSidebar 的「附近
  // 推薦」分頁),由 GeoOutlinePanel 透過 onPlacesNearby 回報——理由同
  // geoHotels/geoAttractions。跟那兩者不同的是這不是常駐跟著地圖範圍
  // 更新的圖層,是「點了某個地標才會有內容」的一次性查詢結果,換行程/
  // 切換分頁時不特別清空(下一次點擊地標會自然覆蓋掉舊結果)。
  const [geoPlaces, setGeoPlaces] = useState<GeoPlace[]>([])
  // geoActiveCategory:地圖上方類別標籤列(飯店/景點/餐廳)目前選中的類別
  // (見 GeoOutlineMap.tsx 的 onActiveCategoryChange 說明),null 代表
  // geoPlaces 目前的內容不屬於任何特定類別(來自點擊地標查附近推薦,或
  // 沒有查詢過)。供 GeoHotelSidebar「附近推薦」分頁的標題/空狀態文字
  // 顯示目前實際查的是哪個類別,理由同 geoPlaces 本身。
  const [geoActiveCategory, setGeoActiveCategory] = useState<string | null>(null)
  // geoSelectedKey:目前被選中的飯店/地點識別鍵(見 GeoHotelSidebar.tsx
  // 的 geoItemKey)——側欄(GeoHotelSidebar)與地圖(GeoOutlineMap)是分開
  // 掛載的 sibling,「哪一項被選中」的狀態只能靠這層 state 中介,才能讓
  // 側欄的選取標記與地圖上的選取樣式同步。GeoHotelSidebar 清單/地圖上
  // 點擊只開 GeoInfoPanel 資訊卡,不觸發 panTo;候選籃(GeoCandidateSidebar)
  // 點擊則額外會移動地圖(見下方 geoPanTarget 的說明),這是使用者明確
  // 要求的例外。
  const [geoSelectedKey, setGeoSelectedKey] = useState<GeoSelectedKey>(null)
  // geoPanTarget:候選籃(GeoCandidateSidebar)裡任何一項被點擊、或
  // AttractionInfoPanel「探索周邊」按鈕(見下方 handleExploreAttraction)
  // 觸發時,要移動地圖到的目標——候選籃/AttractionInfoPanel(在
  // DesktopLayout 最外側)跟地圖(在 main 內部的 GeoOutlinePanel 裡)是
  // 分開掛載的 sibling,只能靠這層 state 中介。其餘來源(GeoHotelSidebar
  // 清單/地圖上點擊)點擊都只開資訊欄、不移動地圖,故只有這兩處會設值
  // ——每次設值都建立新物件參照(即使連續觸發同一個目標),讓
  // GeoOutlineMap 能偵測到「這是一次新的移動請求」而重新 panTo/fitBounds
  // (理由同 GeoOutlinePanel.tsx 對這個 prop 的既有說明)。radiusMeters
  // 只有「探索周邊」會帶(見該 handler 的說明),候選籃點擊沿用原本純
  // 平移的行為,不帶這個欄位。
  const [geoPanTarget, setGeoPanTarget] = useState<{ lat: number; lng: number; radiusMeters?: number } | null>(null)
  // handleExploreAttraction:AttractionInfoPanel「探索周邊」按鈕觸發——
  // 複用 GeoOutlineMap.tsx handleAttractionClick 已有的
  // placesQueryRadiusMeters 決策邏輯算出縮放半徑(優先用該景點區域自己的
  // radiusMeters,單點地標退回 PLACES_QUERY_DEFAULT_RADIUS_METERS),透過
  // geoPanTarget 中介讓地圖 fitBounds 到這個範圍(見 GeoOutlineMap.tsx
  // panTarget.radiusMeters 分支的說明)。跟直接點地圖上的地標
  // (handleAttractionClick)不同的是這裡固定走 fit-bounds,不區分
  // pan-and-zoom——「探索周邊」的使用者意圖本來就是「讓我看看這一整個
  // 區域多大」,即使是沒有 radiusMeters 的單點地標,用預設查詢半徑框出的
  // 範圍也已經是合理的「周邊」大小,不需要再依 level 判斷是否要動 zoom。
  const handleExploreAttraction = useCallback((attraction: GeoAttraction) => {
    setGeoPanTarget({
      lat: attraction.lat,
      lng: attraction.lng,
      radiusMeters: placesQueryRadiusMeters(attraction),
    })
  }, [])
  // geoHoverKey:滑鼠移到側欄(GeoHotelSidebar/GeoCandidateSidebar)項目上時
  // 的臨時識別鍵,獨立於 geoSelectedKey 之外(見 GeoOutlineMap.tsx 的
  // hoverKey prop 說明,兩者在地圖端用 || 合併判斷選取樣式)——滑鼠移開時
  // 只清空這個 state,不影響 geoSelectedKey 記得的「上一次點擊選中的
  // 項目」。
  const [geoHoverKey, setGeoHoverKey] = useState<GeoSelectedKey>(null)
  // geoActiveTab:GeoHotelSidebar 目前顯示哪個分頁(飯店/附近推薦)——原本
  // 是該元件的內部 state,提到這裡中介的理由是地圖上直接點擊飯店/推薦
  // 地點的 marker(見下方 onHotelSelect 等)時,要能自動切到對應分頁,
  // 使用者才看得到剛點的項目介紹,不會停留在原本選取的分頁而看起來像沒
  // 反應。地標(attraction)點擊不影響這個分頁狀態——地標介紹改走
  // AttractionInfoPanel(獨立元件,見該檔案的說明),不屬於這個側欄的
  // 分頁範圍。
  const [geoActiveTab, setGeoActiveTab] = useState<GeoTab>('hotels')
  // geoInfoContent:目前要在浮動資訊卡(GeoInfoPanel)顯示的內容,觸發來源
  // 是側欄飯店/推薦地點清單點擊項目本體、或點擊地圖上 Google 原生 POI
  // 圖標(轉自 GeoOutlineMap.tsx onPoiSelect 回報的 GeoPlaceDetails)——
  // 兩種來源欄位形狀不同,統一轉成 GeoInfoContent 後才存進這個 state,
  // GeoInfoPanel 本身不需要分辨來源。attraction 不使用這個 state,見下方
  // geoAttractionContent 的說明。
  const [geoInfoContent, setGeoInfoContent] = useState<GeoInfoContent | null>(null)
  // geoAttractionContent:目前要在 AttractionInfoPanel 顯示的 attraction——
  // 獨立於 geoInfoContent 之外(見 AttractionInfoPanel.tsx 的說明,
  // attraction 的操作集合跟 GeoInfoPanel 完全不同,不共用同一個 state/
  // 同一份轉換函式)。觸發來源是側欄「地點」分頁點擊項目本體、或點擊
  // 地圖上自訂地標圖示(GeoOutlineMap.tsx 的 onAttractionSelect),兩者
  // 都直接回報原始 GeoAttraction,不需要轉換。
  const [geoAttractionContent, setGeoAttractionContent] = useState<GeoAttraction | null>(null)
  // geoCandidates:候選籃(構想 1,見
  // docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)目前收集的候選清單——純
  // 前端試做,只存在這份記憶體 state,重新整理頁面會消失,尚未接上任何
  // 持久化(見 GeoCandidateSidebar.tsx 的說明)。加入來源是
  // GeoHotelSidebar 每張卡片的「+」按鈕。
  const [geoCandidates, setGeoCandidates] = useState<GeoCandidate[]>([])
  // geoCandidateKeys:geoCandidates 轉成地圖端要的識別鍵集合(見
  // GeoOutlineMap.tsx 的 candidateKeys prop 說明),只涵蓋使用者手動加入的
  // 三種(hotel/attraction/place)——entry 種類是行程本身已有座標的既有
  // 內容,地圖上該類 marker 已有旗標圖示語意,不需要再疊加「已加入候選」
  // 徽章(理由同 GeoOutlineMap.tsx candidateKeys 的完整說明)。用 useMemo
  // 而非每次渲染重建 Set,避免傳給 GeoOutlineMap 的參照每次都變動觸發
  // 不必要的 marker 同步。
  const geoCandidateKeys = useMemo(
    () =>
      new Set(
        geoCandidates
          .filter((c): c is Extract<GeoCandidate, { kind: 'hotel' | 'attraction' | 'place' }> => c.kind !== 'entry')
          .map((c) => geoItemKey(c.kind, c)),
      ),
    [geoCandidates],
  )
  // addGeoCandidate:候選籃的加入邏輯集中在這裡,GeoHotelSidebar 卡片「+」
  // 按鈕與 GeoInfoPanel「加入候選」按鈕共用同一份比對去重規則(kind+name+
  // lat+lng),避免兩處各自維護一份邏輯後來跑歪。
  const addGeoCandidate = useCallback((c: GeoCandidate) => {
    setGeoCandidates((prev) =>
      prev.some((p) => p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)
        ? prev
        : [...prev, c],
    )
  }, [])
  // geoCandidateFlashTrigger:候選籃浮動卡片(GeoCandidateSidebar,見下方
  // panelSpec.slot === 'float' 的 'geo-outline' 分支)「剛加入東西了」的
  // 視覺提示觸發器——每次遞增觸發一次短暫的 highlight 動畫(見
  // GeoCandidateSidebar.module.css 的 .panelFlash)。之所以需要這個,而不是
  // 直接「展開/收合」卡片:GeoInfoPanel 複合按鈕只在 panelMode ===
  // 'geo-outline' 底下能被按到,而 GeoCandidateSidebar 在同一個條件下已經
  // 展開顯示,沒有獨立的「收合/展開」開關能在這個情境下額外觸發——用
  // 遞增計數器(而非 boolean)是因為使用者可能連續加入好幾個候選,即使
  // 卡片的 flash 動畫還沒播完,遞增值仍能保證每次都是新的 useEffect
  // 依賴值、重新觸發一次動畫(boolean 在連續兩次都設成 true 時不會變動,
  // 不會重新觸發)。
  const [geoCandidateFlashTrigger, setGeoCandidateFlashTrigger] = useState(0)
  // addGeoCandidateAndReveal:GeoInfoPanel 複合按鈕右半邊(PanelLeft icon)
  // 觸發——跟左半邊 addGeoCandidate 一樣單純加入候選籃(同一份去重邏輯,
  // 不涉及日期選擇),額外多做的事只有讓候選籃側欄短暫 highlight 一下,
  // 提示使用者「加進去了,去左邊看」(側欄本身在這個情境下必然已經展開,
  // 詳見 geoCandidateFlashTrigger 的說明)。
  const addGeoCandidateAndReveal = useCallback((c: GeoCandidate) => {
    addGeoCandidate(c)
    setGeoCandidateFlashTrigger((n) => n + 1)
  }, [addGeoCandidate])
  // geoSearchCity/geoSearchTrigger:城市搜尋欄的狀態,UI 渲染在
  // GeoOutlineMap.tsx(地圖左上角類別標籤列旁),查詢邏輯留在
  // GeoOutlinePanel.tsx(見該檔案的說明)——兩者是分開掛載的 sibling,
  // 只能靠這層 state 中介。geoSearchTrigger 每次遞增觸發一次查詢(見
  // GeoOutlinePanel 的 searchTrigger prop 說明)。查詢中/錯誤狀態
  // (searching/error)由 GeoOutlinePanel 內部直接轉給 GeoOutlineMap
  // 顯示,不需要再往上層回報,故這裡不持有對應 state。
  const [geoSearchCity, setGeoSearchCity] = useState('')
  const [geoSearchTrigger, setGeoSearchTrigger] = useState(0)
  // geoRefetchTripEntriesTrigger:同 geoSearchTrigger 的中介模式,但驅動的
  // 是 GeoOutlinePanel 的 refetchTripEntriesTrigger prop——GeoCandidateSidebar
  // 幫「未排定日期」的候選補上日期(PATCH 成功)後透過 onDatesAssigned
  // 遞增這個值,通知 GeoOutlinePanel 重新查一次 tripEntries,讓補了日期的
  // 項目在下一次渲染自然移到正確的日期分組(見 GeoOutlinePanel.tsx 該
  // prop 的完整說明)。
  const [geoRefetchTripEntriesTrigger, setGeoRefetchTripEntriesTrigger] = useState(0)
  // pickingDayKey:「從候選加入」第二張浮動卡片(AddFromCandidateSidebar,
  // 見該檔案的說明)目前是為哪一天開啟的——null 代表收合、不渲染這張卡片。
  // 由 GeoCandidateSidebar 的 onPickFromCandidate 回報使用者按了哪一天
  // 的按鈕,狀態提升到這裡是因為這張卡片是跟 panelMode 浮動卡片同一個
  // .left 位置的獨立浮層(見 DesktopLayout.module.css 的
  // .panel),不是候選籃元件內部的浮層,只能由共同的父層中介
  // 才能同時控制兩者(見下方 render 邏輯裡兩者互斥的判斷)。
  const [pickingDayKey, setPickingDayKey] = useState<string | null>(null)
  // onlyGeoCandidate:候選中(非「已排入行程」)的候選——AddFromCandidateSidebar
  // 要挑選的清單,篩選規則跟 GeoCandidateSidebar.tsx 內部的 onlyCandidate
  // 完全一致(kind !== 'entry',或 kind === 'entry' 但 inTrip !== true),
  // 這裡獨立算一份是因為第二側欄現在是分開掛載的 sibling,拿不到
  // GeoCandidateSidebar 元件內部的那份計算結果。
  const onlyGeoCandidate = useMemo(
    () => geoCandidates.filter((c) => !(c.kind === 'entry' && c.inTrip)),
    [geoCandidates],
  )
  // geoScheduledDates:行程本身目前已排定的日期清單(去重、升冪排序)——
  // 從 geoCandidates 裡 kind === 'entry' && inTrip 且 start 非空的項目
  // 取出,分組規則跟 GeoCandidateSidebar.tsx 的「已排入行程」dayGroupKey/
  // NO_DATE_GROUP 邏輯一致(未排定日期的 entry 不算數)。傳給
  // GeoInfoPanel 的 scheduledDates,見該元件的 prop 說明——按下「加入
  // {tripName}」時,候選沒有自己的日期但行程已有這些既有日期可選,先跳
  // 下拉選單而不是直接展開日曆。
  const geoScheduledDates = useMemo(
    () =>
      Array.from(
        new Set(
          geoCandidates
            .filter((c): c is GeoCandidate & { kind: 'entry'; inTrip: true } => c.kind === 'entry' && c.inTrip && !!c.start)
            .map((c) => c.start as string),
        ),
      ).sort(),
    [geoCandidates],
  )
  // handlePickFromCandidate:第二側欄點選一項候選——直接呼叫
  // createEntryFromCandidate 建立成 pickingDayKey 這天的 entry,成功後
  // 側欄保持開啟(使用者明確要求可以連續加入多項),並觸發
  // geoRefetchTripEntriesTrigger 讓「已排入行程」重新查詢、把新條目帶入
  // 正確的日期分組。失敗只印 console 不關閉側欄,讓使用者可以重試或改選
  // 別項(理由同候選籃內其餘拖曳/建立失敗的既有處理方式)。
  const handlePickFromCandidate = useCallback(async (c: GeoCandidate) => {
    if (!pickingDayKey || !activeTrip?.id) return
    try {
      await createEntryFromCandidate(cfg, activeTrip.id, c, pickingDayKey)
      setGeoCandidates((prev) =>
        prev.filter((p) => !(p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)),
      )
      setGeoRefetchTripEntriesTrigger((n) => n + 1)
    } catch (err) {
      console.error('[DesktopLayout] 從候選加入失敗:', err)
    }
  }, [pickingDayKey, activeTrip?.id, cfg])
  // handleScheduleCandidate:GeoInfoPanel「加入 {tripName}」按鈕在候選
  // 沒有排定日期時,展開日期選擇 UI、選好日期按確定觸發(見
  // GeoInfoPanel.tsx 的 onSchedule 說明)——跟 handlePickFromCandidate
  // 是同一種「候選 + 日期 → 真正的行程 entry」的動作,共用同一支
  // createEntryFromCandidate,只是觸發來源(第二側欄點選 vs. 地點介紹卡
  // 按鈕)跟已經知道的日期來源(pickingDayKey 這個外部 state vs. 這裡直接
  // 收到的 date 參數)不同,故不合併成同一個 callback。失敗只印 console、
  // 不特別處理,理由同 handlePickFromCandidate。
  const handleScheduleCandidate = useCallback(async (c: GeoCandidate, date: string) => {
    if (!activeTrip?.id) return
    try {
      await createEntryFromCandidate(cfg, activeTrip.id, c, date)
      setGeoRefetchTripEntriesTrigger((n) => n + 1)
    } catch (err) {
      console.error('[DesktopLayout] 加入行程(選定日期)失敗:', err)
    }
  }, [activeTrip?.id, cfg])
  // removeGeoCandidate/selectGeoCandidate:候選籃(GeoCandidateSidebar)與
  // 第二側欄(AddFromCandidateSidebar)共用同一份「移除候選」/「點選候選」
  // 行為——候選中清單原本只在候選籃側欄渲染,搬到第二側欄後,兩個分開
  // 掛載的元件都需要一模一樣的處理邏輯,抽成具名函式而非各自的元件內聯
  // callback,避免兩處各寫一份、之後改一邊忘了改另一邊。
  const removeGeoCandidate = useCallback((c: GeoCandidate) => {
    setGeoCandidates((prev) =>
      prev.filter((p) => !(p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)),
    )
  }, [])
  const selectGeoCandidate = useCallback((c: GeoCandidate) => {
    if (c.kind === 'attraction') return
    setGeoSelectedKey(c.kind === 'entry' ? null : geoItemKey(c.kind, c))
    setGeoAttractionContent(null)
    setGeoInfoContent(candidateInfoContent(c))
    // 候選籃/第二側欄裡任何一項被點擊,都移動地圖到該點為中心——使用者
    // 明確要求候選相關清單點擊要跟「已排入行程」項目一樣有這個行為。
    // 其餘來源(GeoHotelSidebar 清單/地圖上點擊)維持只開資訊欄、不移動
    // 地圖(見 geoPanTarget 宣告處的完整說明)。
    setGeoPanTarget({ lat: c.lat, lng: c.lng })
  }, [])
  // draggingCandidate:目前正在拖曳的候選卡片——候選中清單搬到第二側欄
  // 後,拖曳會跨元件(起點在 AddFromCandidateSidebar 的候選卡片,放開
  // 目標是 GeoCandidateSidebar 底下的日期分組 .dayBody),兩個分開掛載的
  // sibling 只能靠這層 state 中介(見 GeoCandidateSidebar.tsx 對這個 prop
  // 的完整說明)。
  const [draggingCandidate, setDraggingCandidate] = useState<GeoCandidate | null>(null)
  // timelineMirror:ChatScreen 透過 desktopChat.onTimelineData 鏡像過來的時間軸資料
  // (entries/updatingEntryIDs/taskPlaceholders/refetchEntries)。ChatScreen 是這份
  // 資料唯一的擁有者(它的 WS 連線即時維護這些 state),這裡只是接住鏡像後轉交給
  // side panel 的 MultiTrackTimeline,不可以自己另外 fetch 或開第二條 WS。
  const [timelineMirror, setTimelineMirror] = useState<DesktopTimelineMirror>(EMPTY_TIMELINE_MIRROR)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // showDebugPanel/calls/wsEvents:原本 DebugApp.tsx(?debug 獨立工作台)裡的
  // API/WS 狀態面板,併入正式 App 後改成只在 DEBUG_PANEL_ENABLED 開啟時、由
  // rail 上一顆獨立按鈕切換顯示的附加面板(不佔用 panelMode 的三態切換,
  // 因為它要能疊加顯示、不取代 side panel 或 .desktop-main 的內容——見下方
  // 渲染邏輯)。
  // onApiCall/onWsEvent 訂閱本身沒有開銷(見 api.ts),即使面板收合也持續
  // 累積,收合後重新展開不會漏掉收合期間發生的紀錄。
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [debugCalls, setDebugCalls] = useState<ApiCall[]>([])
  const [debugWsEvents, setDebugWsEvents] = useState<WsEvent[]>([])
  useEffect(() => onApiCall((c) => setDebugCalls((prev) => [c, ...prev].slice(0, 100))), [])
  useEffect(() => onWsEvent((e) => setDebugWsEvents((prev) => [e, ...prev].slice(0, 100))), [])
  // panelSpec:目前 panelMode 對應的版面設定(見 DesktopShared.tsx 的
  // PANEL_REGISTRY)——null(收合)或 undefined(理論上不會發生,panelMode
  // 已經過 isPanelMode 驗證)時視為沒有 spec。這裡集中算一次,下方 rail/
  // main 區/浮動卡片渲染都從這個值分支,不再各自重複 panelMode === 'x'
  // 字串比對。
  const panelSpec = panelMode ? PANEL_REGISTRY[panelMode] : undefined

  // 切換行程時,先清空鏡像資料,避免新行程的 ChatScreen 還沒送出第一次鏡像前,
  // side panel 短暫顯示上一個行程的時間軸內容。
  useEffect(() => {
    setTimelineMirror(EMPTY_TIMELINE_MIRROR)
  }, [activeTrip?.id])

  // 離開規劃分頁或切換行程時收起第二側欄——pickingDayKey 記的是「已排入
  // 行程」某一天的日期字串,離開 geo-outline 或換了行程後,這個日期分組
  // 可能已經不存在(或屬於別的行程),繼續開著會讓使用者選到的候選建立
  // 到一個已經看不到脈絡的日期,故一併清空。
  useEffect(() => {
    setPickingDayKey(null)
  }, [panelMode, activeTrip?.id])

  const onTimelineData = useCallback((data: DesktopTimelineMirror) => {
    setTimelineMirror(data)
  }, [])
  // desktopChat:傳給 ChatScreen 的物件必須記憶化(useMemo),不能直接在 JSX
  // 寫 desktopChat={{ onTimelineData }} 物件字面量——那樣每次 DesktopContent
  // 重新渲染都會建立一個新參照,即使 onTimelineData 本身(已用 useCallback
  // 包過)沒變。ChatScreen 內鏡像時間軸資料的 useEffect 依賴陣列裡有整個
  // desktopChat 物件,參照每次都不同會讓該 effect 每次渲染都重新執行 →
  // 呼叫 onTimelineData → setTimelineMirror → 觸發本元件重新渲染 → 產生新的
  // desktopChat 物件 → 無窮迴圈(實測會直接跳出 React 的
  // "Maximum update depth exceeded" 警告)。用 useMemo 讓這個物件只在
  // onTimelineData 真的變動時才換參照,打斷這個迴圈。
  const desktopChat = useMemo(() => ({ onTimelineData }), [onTimelineData])

  // geoHotelSidebarVisible:跟下方 GeoHotelSidebar 實際渲染的條件完全
  // 一致——GeoInfoPanel/AttractionInfoPanel 都定位在 .desktop-main 右緣
  // (見 GeoInfoPanel.module.css/AttractionInfoPanel.module.css 的
  // .panel),GeoHotelSidebar 有內容時會漂浮在同一個位置(見
  // DesktopLayout.module.css 的 .right),兩張卡片需要知道
  // 要不要往左避讓(見兩者的 shiftBy prop 說明)。抽成一個變數,避免
  // 下方兩處 JSX 各自重複同一段條件判斷式、之後改其中一處忘了同步另一處。
  const geoHotelSidebarVisible = panelMode === 'geo-outline' && (geoHotels.length > 0 || geoPlaces.length > 0)
  // infoPanelShiftBy:GeoInfoPanel/AttractionInfoPanel 右緣可能同時要
  // 避開兩種東西——GeoHotelSidebar(飯店清單,.right)
  // 與對話浮動小匡(.chat-popover,見 chatPopoverOpen)。對話小匡更寬
  // (340px vs GeoHotelSidebar 的 280px),兩者都存在時優先避開較寬的
  // 那個,不是疊加兩者的偏移量——資訊卡只需要跟「當下右緣實際佔用最多
  // 寬度的東西」錯開,不需要真的把兩個偏移量加總(那樣會把卡片推到不
  // 必要的更左邊)。'none' 代表右緣沒有東西需要避開,維持貼齊 16px。
  const infoPanelShiftBy: 'none' | 'hotel' | 'chat' =
    chatPopoverOpen ? 'chat' : geoHotelSidebarVisible ? 'hotel' : 'none'

  return (
    <>
      <div className="desktop-layout">
        <DesktopRail
          panelMode={panelMode}
          onSelect={setPanelMode}
          activeTrip={!!activeTrip}
          user={props.user}
          isGuest={props.isGuest}
          cfg={cfg}
          onAuthed={props.onAuthed}
          onLogout={props.onLogout}
          onOpenSettings={() => setSettingsOpen(true)}
          showDebugPanel={showDebugPanel}
          onToggleDebugPanel={() => setShowDebugPanel((v) => !v)}
        />
        <main className="desktop-main">
          {pickingDayKey && (
            <div className={`${styles.panel} ${styles.left}`} style={{ width: 272 }}>
              <AddFromCandidateSidebar
                dayLabel={dayGroupLabel(pickingDayKey)}
                candidates={onlyGeoCandidate}
                onRemove={removeGeoCandidate}
                onPick={handlePickFromCandidate}
                onHover={setGeoHoverKey}
                onDragStart={setDraggingCandidate}
                onDragEnd={() => setDraggingCandidate(null)}
                onClose={() => setPickingDayKey(null)}
              />
            </div>
          )}
          {panelSpec?.slot === 'main-replace' ? (
            panelMode === 'demo-route-editor' ? (
              // demo-route-editor 不透過 DemoPanelContent(見該常數在
              // DesktopShared.tsx 的說明——只做桌面版,手機版 PhoneNavDrawer
              // 不提供對應分頁),直接在這裡渲染。
              <RouteEditor />
            ) : (
              <DemoPanelContent mode={panelMode as Exclude<PanelMode, 'trips' | 'timeline' | 'pace' | 'geo-outline' | 'demo-route-editor' | null>} />
            )
          ) : (
            // main-replace 以外的所有情況(含 panelMode === null、'trips'/
            // 'timeline'/'pace'/'geo-outline'):主顯示固定是規劃地圖——
            // 這四種正式功能現在改成浮動卡片疊加在地圖上(見下方
            // DesktopLayout.module.css 的 .panel),不再取代主顯示,故這裡不需要再檢查
            // activeTrip/panelMode 的組合,地圖永遠掛載。
            <>
              <GeoOutlinePanel
                cfg={cfg}
                tripID={activeTrip?.id ?? null}
                city={geoSearchCity}
                onCityChange={setGeoSearchCity}
                onSearch={() => setGeoSearchTrigger((n) => n + 1)}
                onOpenChat={() => setChatPopoverOpen(true)}
                searchTrigger={geoSearchTrigger}
                refetchTripEntriesTrigger={geoRefetchTripEntriesTrigger}
                onHotelsChange={setGeoHotels}
                onPlacesNearby={(places) => {
                  // places 分頁的結果不只來自逐一點擊 marker(onPlaceSelect,
                  // 已有切分頁邏輯),也來自地圖上方類別標籤(飯店/景點/餐廳,
                  // 見 GeoOutlineMap.tsx 的 handleCategoryClick)與點擊地標
                  // 查附近推薦(handleAttractionClick)——這三種來源查完都
                  // 該讓側欄自動切到「附近推薦」分頁,使用者才看得到剛查到
                  // 的結果,不會停留在原本的分頁而看起來像沒反應(理由同
                  // onAttractionSelect/onHotelSelect/onPlaceSelect 的說明)。
                  setGeoPlaces(places)
                  setGeoActiveTab('places')
                }}
                onActiveCategoryChange={setGeoActiveCategory}
                onTripEntriesChange={(entries) => {
                  // 行程本身已有座標的 entry 自動併入候選籃——跟手動用
                  // 「+」加入的來源(飯店/地點/推薦地點)共用同一份
                  // geoCandidates,用 id 比對避免換行程/重新查詢時重複加入。
                  // 舊行程遺留的「真的已排入行程」候選(kind==='entry' 且
                  // inTrip===true,但不在這次新清單裡)一併移除,避免換行程
                  // 後候選籃留著上一趟的行程內容;使用者手動加入的其他三種
                  // 候選、以及按過「返回候選」的項目(kind==='entry' 但
                  // inTrip===false,見 DayEntryCard 的說明)不受影響——後者
                  // 本來就不在後端 entries 查詢結果裡,不該被這次查詢結果
                  // 清掉。
                  //
                  // 這批新的 entries 一律直接覆蓋掉同 id 的舊候選(而非只在
                  // id 不存在時才新增)——GeoCandidateSidebar 補上「未排定
                  // 日期」項目的日期後(見 handleAssignDate),會透過
                  // onDatesAssigned 觸發這裡重新查詢,拿到的是帶新 start 的
                  // 新資料;若沿用舊寫法(id 存在就跳過、只保留 prev 裡的
                  // 舊物件),畫面會繼續顯示舊的 start,補日期後看起來像
                  // 沒生效,直到下次整個換行程才會被覆蓋——這正是實際發生
                  // 過的 bug,不是預防性寫法。
                  setGeoCandidates((prev) => {
                    const keptCandidates = prev.filter((p) => !(p.kind === 'entry' && p.inTrip))
                    // entryKind(entry 本身的分類,如 "stay"/"activity")跟
                    // GeoCandidate 判別欄位 kind('entry' 字面值)分開存放,
                    // 理由見 GeoCandidate 型別定義處的完整說明——e.kind 是
                    // GeoTripEntry 原本的分類欄位,必須先讀出來存進
                    // entryKind,才展開 ...e(此時 e 物件上已經不含 kind,
                    // 見 GeoTripEntry 的型別,不會有覆蓋問題)。
                    const freshEntries = entries.map((e): GeoCandidate => ({
                      ...e,
                      kind: 'entry',
                      inTrip: true,
                      entryKind: e.kind,
                    }))
                    return [...keptCandidates, ...freshEntries]
                  })
                }}
                onAttractionSelect={(d) => {
                  setGeoSelectedKey(geoItemKey('attraction', d))
                  setGeoInfoContent(null)
                  setGeoAttractionContent(d)
                }}
                onHotelSelect={(h) => {
                  setGeoSelectedKey(geoItemKey('hotel', h))
                  setGeoActiveTab('hotels')
                  setGeoAttractionContent(null)
                  setGeoInfoContent(hotelInfoContent(h))
                }}
                onPlaceSelect={(p) => {
                  setGeoSelectedKey(geoItemKey('place', p))
                  setGeoActiveTab('places')
                  setGeoAttractionContent(null)
                  setGeoInfoContent(placeInfoContent(p))
                }}
                onPoiSelect={(details) => {
                  // 點擊 Google 原生 POI 圖標查回的詳細資訊——沒有知名度
                  // 分級/景點數量/範圍半徑這些只有自建 attraction 資料才有的
                  // 欄位,改顯示 Google 評分當 badge。
                  setGeoAttractionContent(null)
                  setGeoInfoContent(poiInfoContent(details))
                }}
                onGeocodeCandidateSelect={(c) => {
                  // 點擊搜尋候選 marker——理由同 onPlaceSelect 等既有選取
                  // 來源,開 GeoInfoPanel 顯示這個候選的名稱/地址。不設
                  // geoSelectedKey(候選 marker 的選取樣式由 GeoOutlinePanel
                  // 自己的 selectedGeocodeCandidateKey 獨立管理,見該元件
                  // 的說明,不共用 geoSelectedKey 這套機制——候選圖層是
                  // 暫時的搜尋結果,跟飯店/景點/推薦地點這些「常駐可選取」
                  // 的圖層性質不同)。
                  setGeoAttractionContent(null)
                  setGeoInfoContent(geocodeCandidateInfoContent(c))
                }}
                selectedKey={geoSelectedKey}
                candidateKeys={geoCandidateKeys}
                hoverKey={geoHoverKey}
                panTarget={geoPanTarget}
              />
              <GeoInfoPanel
                content={geoInfoContent}
                onClose={() => setGeoInfoContent(null)}
                onAddCandidate={addGeoCandidate}
                onAddAndReveal={addGeoCandidateAndReveal}
                onSchedule={handleScheduleCandidate}
                tripName={activeTrip?.name ?? '行程'}
                scheduledDates={geoScheduledDates}
                shiftBy={infoPanelShiftBy}
              />
              <AttractionInfoPanel
                attraction={geoAttractionContent}
                onClose={() => setGeoAttractionContent(null)}
                onExplore={handleExploreAttraction}
                shiftBy={infoPanelShiftBy}
              />
            </>
          )}
          {/* panelMode 浮動卡片:trips/timeline/pace/geo-outline 這四種正式
              功能的內容(見 PANEL_REGISTRY 的 slot: 'float'),疊在地圖左緣
              上方,不佔用 flex 版面空間、不推擠地圖——沿用跟
              AddFromCandidateSidebar/GeoHotelSidebar 一致的 .panel
              視覺語言(見 DesktopLayout.module.css)。pickingDayKey 有值時優先顯示上面的
              「從候選加入」卡片(同屬左緣候選清單性質,避免疊在一起),
              故這裡额外排除 pickingDayKey 有值的情況。右上角疊加共用的
              .close 關閉按鈕(見 DesktopLayout.module.css)——
              四種內容元件(DesktopTripList/MultiTrackTimeline/PaceChart/
              GeoCandidateSidebar)各自 header 排版不同,不逐一加專屬關閉
              按鈕,統一在這裡放一顆,導回 /app 收起卡片(同再點一次 rail
              圖示的行為)。 */}
          {panelSpec?.slot === 'float' && !pickingDayKey && (
            <div className={`${styles.panel} ${styles.left}`} style={{ width: panelSpec.width }}>
              <button
                type="button"
                className={styles.close}
                onClick={() => navigate('/app')}
                title="關閉"
              >
                <X size={16} strokeWidth={2} />
              </button>
              {panelMode === 'trips' ? (
                <DesktopTripList
                  cfg={cfg}
                  activeTripID={activeTrip?.id ?? null}
                  onOpen={(t) => {
                    setActiveTrip(t)
                    // 選定行程後浮動卡片自動收起,回到「地圖滿版、左欄
                    // 顯示對話」的預設狀態。
                    navigate('/app')
                  }}
                  onManage={setManageTrip}
                />
              ) : panelMode === 'timeline' ? (
                <div className={styles.timelinePanel}>
                  <div className="desktop-sidebar-head">
                    <span className="desktop-sidebar-title">時間軸</span>
                  </div>
                  <div className="desktop-timeline-scroll">
                    {!activeTrip ? (
                      <div className="empty">選擇一個行程後顯示時間軸。</div>
                    ) : timelineMirror.entries.length === 0 ? (
                      <div className="empty">尚無行程內容。</div>
                    ) : (
                      <MultiTrackTimeline
                        entries={timelineMirror.entries}
                        todayRef={todayRef}
                        updatingIDs={timelineMirror.updatingEntryIDs}
                        taskPlaceholders={timelineMirror.taskPlaceholders}
                        cfg={activeTrip.ownerID === props.user.id ? cfg : undefined}
                        onEntryUpdated={timelineMirror.refetchEntries}
                      />
                    )}
                  </div>
                </div>
              ) : panelMode === 'pace' ? (
                <div className="desktop-sidepanel-pace">
                  <PaceChart cfg={cfg} tripID={activeTrip?.id} />
                </div>
              ) : panelMode === 'geo-outline' ? (
                <GeoCandidateSidebar
                  cfg={cfg}
                  tripID={activeTrip?.id}
                  candidates={geoCandidates}
                  onRemove={removeGeoCandidate}
                  onSelect={selectGeoCandidate}
                  onHover={setGeoHoverKey}
                  onDatesAssigned={() => setGeoRefetchTripEntriesTrigger((n) => n + 1)}
                  onReturnToCandidate={(c) =>
                    setGeoCandidates((prev) =>
                      prev.map((p) => (p.kind === 'entry' && p.id === c.id ? { ...p, inTrip: false } : p)),
                    )
                  }
                  draggingCandidate={draggingCandidate}
                  onDraggingCandidateChange={setDraggingCandidate}
                  onPickFromCandidate={setPickingDayKey}
                  flashTrigger={geoCandidateFlashTrigger}
                />
              ) : null}
            </div>
          )}
          {/* GeoHotelSidebar(飯店/附近推薦)只在使用者實際觸發過查詢後才
              顯示——geoHotels 只有按下「搜尋這個區域」才會有內容
              (GeoOutlineMap.tsx 的 queryTrigger === 0 guard,地圖掛載/拖曳
              本身不會查),geoPlaces 只有點類別標籤/地標才會有內容(見
              onPlacesNearby 的說明);兩者都還是空的代表使用者進到規劃分頁
              後還沒做過任何查詢動作,這時不顯示。使用者明確要求不要壓縮
              主顯示的可用寬度,改成絕對定位疊在 .desktop-main(已有
              position: relative)右緣之上,不佔用 flex 版面空間——理由/
              寫法同左緣的 .left(見 DesktopLayout.module.css)。 */}
          {panelMode === 'geo-outline' && (geoHotels.length > 0 || geoPlaces.length > 0) && (
            <div className={`${styles.panel} ${styles.right}`} style={{ width: 280 }}>
              <GeoHotelSidebar
                cfg={cfg}
                tripID={activeTrip?.id}
                hotels={geoHotels}
                places={geoPlaces}
                placesCategory={geoActiveCategory}
                selectedKey={geoSelectedKey}
                onHover={setGeoHoverKey}
                activeTab={geoActiveTab}
                onTabChange={setGeoActiveTab}
                onSelectHotel={(h) => {
                  setGeoSelectedKey(geoItemKey('hotel', h))
                  setGeoAttractionContent(null)
                  setGeoInfoContent(hotelInfoContent(h))
                }}
                onSelectPlace={(p) => {
                  setGeoSelectedKey(geoItemKey('place', p))
                  setGeoAttractionContent(null)
                  setGeoInfoContent(placeInfoContent(p))
                }}
                onAddCandidate={addGeoCandidate}
                onCandidateCreated={() => setGeoRefetchTripEntriesTrigger((n) => n + 1)}
              />
            </div>
          )}
          {/* chat-popover:對話浮動小匡,由地圖右上角城市搜尋框旁的 AI
              按鈕觸發(見 GeoOutlineMap.tsx 的 onOpenChat),疊在搜尋框
              正下方——沒有常駐對話欄,這是使用者存取 ChatScreen 的唯一
              入口(見 chatPopoverOpen 宣告處的說明)。沒有 activeTrip 時
              仍掛載 ChatScreen(trip 不傳,見該元件 trip prop 的說明)——
              使用者不需要先選/建立行程就能開始對話,不再顯示空狀態擋板。
              key 用 activeTrip?.id ?? 'no-trip',確保「無行程對話」跟
              「某個行程的對話」是各自獨立的掛載週期(避免沿用前一個行程
              殘留的 WebSocket/訊息 state)。 */}
          {chatPopoverOpen && (
            <div className="chat-popover">
              <button
                type="button"
                className={styles.close}
                onClick={() => setChatPopoverOpen(false)}
                title="關閉"
              >
                <X size={16} strokeWidth={2} />
              </button>
              <ChatScreen
                key={activeTrip?.id ?? 'no-trip'}
                cfg={cfg}
                trip={activeTrip ?? undefined}
                user={props.user}
                onBack={() => setActiveTrip(null)}
                desktopChat={desktopChat}
              />
            </div>
          )}
        </main>
        {DEBUG_PANEL_ENABLED && showDebugPanel && (
          <DemoPanel
            calls={debugCalls}
            onClear={() => setDebugCalls([])}
            wsEvents={debugWsEvents}
            onClearWsEvents={() => setDebugWsEvents([])}
            cfg={cfg}
            trip={activeTrip}
            style={{ flex: '0 0 360px', height: '100%' }}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsDialog
          cfg={cfg}
          user={props.user}
          email={props.email}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {/* manageTrip:行程管理彈窗(分享連結/成員/開啟時自動進入),原本掛在
          ChatScreen navbar 的三個分散入口(TripMenu/分享按鈕/成員按鈕)
          合併成這一個,搬到行程列表觸發——用 base-ui.css 既有的
          .rp-modal*(置中卡片彈窗骨架,跟 SettingsDialog 同一套)包住,
          TripManageModal 本身用 .rp-modal-head/.rp-modal-body 渲染內容
          (見該檔案的說明)。提升到這一層渲染,理由同上方 settingsOpen
          的說明。 */}
      {manageTrip && (
        <div className="rp-modal-backdrop" onClick={() => setManageTrip(null)}>
          <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
            <TripManageModal
              cfg={cfg}
              trip={manageTrip}
              isOwner={manageTrip.ownerID === props.user.id}
              onClose={() => setManageTrip(null)}
            />
          </div>
        </div>
      )}
    </>
  )
}
