import { useEffect, useRef, useState } from 'react'
import { useResolvedTheme } from '../../../hooks/useResolvedTheme'
import { Helmet } from 'react-helmet-async'
import { Compass, ListPlus, Sparkles } from 'lucide-react'
import { useTripEntriesMirror } from '../../../hooks/useTripEntriesMirror'
import { type ContentProps } from '../../../AppCommon'
import { useIsDesktop } from '../../../hooks/useIsDesktop'
import { useTripsState } from '../../../hooks/useTripsState'
import { LoginForm, LoginCard } from '../../../home/LoginForm'
import { TIMELINE_ENABLED, ROUTE_LINE_ENABLED } from '../../../DesktopShared'
import { Content as DesktopContent } from '../desktop/Content'
import { SettingsScreen } from '../../../user/SettingsScreen'
import { TripManageDialog } from '../../../trip/TripManageDialog'
import { PlanPhoneView } from '../../map/phone/PlanPhoneView'
import { TripList as PhoneTripList } from '../../../trip/phone/TripList'
import { PhoneTimelineDrawer } from '../../../timeline/PhoneTimelineDrawer'
import { StandaloneSheet, SheetBody, SheetHead } from '../../../components/PhoneBottomSheet'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { PlanLayout } from './PlanLayout'
import { maskPlanStopsView, usePlanStopsState } from '../../timeline/usePlanStopsState'
import { Z_LAYERS } from '../../../components/zLayers'
import { useElementHeight } from '../../../hooks/useElementHeight'
import { Nav as PhoneNav } from '../../../phone/Nav'
import { LivePlanLayer } from './LivePlanLayer'
import { PlanDataProvider } from '../../data/PlanDataProvider'
import { getPlanAiApiDataSource } from '../../data/api'
import type { Trip } from '../../../trip/types'

// 設定頁 bottom sheet 面板頂部離定位祖先頂端的距離(px)——見
// components/PhoneBottomSheet.tsx 的說明,定位數值(bottom/z-index)見
// 下方 PhoneBottomSheet 呼叫處的說明。
// 2026-10 從 60 改成 12(使用者明確要求「所有有最高段的都剛好把搜尋匡
// 蓋住」「我要改成要蓋住」「貼齊搜尋匡上緣」):規劃地圖的搜尋框
// (planning/map/phone/PlanPhoneView.module.css 的 .citySearch,top:12px、
// height:48px,範圍是離頂部 12px~60px)原本整個留在 60px 這個展開高度
// 的上方,使用者這次要求最大展開段要整個蓋過搜尋框,改成貼齊它的上緣
// (12px),不再只貼齊下緣。
const SETTINGS_SHEET_TOP = 12
// SETTINGS_SHEET_MIN_HEIGHT:設定頁收合段的固定高度(px)——2026-10 新增
// (使用者明確要求「除了選單類的，其他都加入最小段」),。
const SETTINGS_SHEET_MIN_HEIGHT = 100

// planning/member/phone/Content:手機版(寬度 < 768px)主要應用狀態切換器——登入畫面/桌面版
// 導轉/聊天室/設定,見 App.tsx App() 的 /app 路由分支。
// 導覽:底部常駐 phone/Nav.tsx(旅程/時間軸/規劃),不需要先開抽屜才看得到分頁——取代
// 原本各自獨立的整頁 TripsScreen、原 ChatScreen 自己的右側時間軸抽屜(已移除),與
// PhoneNavDrawer 側滑抽屜的分頁列。旅程列表獨立成 trip/phone/TripList 抽屜
// (由底部列「旅程」按鈕開關),分享/成員/開啟時自動進入合併成
// TripManageModal,入口在該抽屜每筆旅程項目的「管理」按鈕,對齊桌面版
// trip/desktop/TripList.tsx 的 onManage 心智模型。
//
// 主顯示區:規劃地圖常駐為主畫面,對話/時間軸/設定等都是疊加層(見下方
// chatSheetOpen 的說明)。
export function Content(props: ContentProps) {
  // mapTheme:地圖只收明確的 'dark' | 'light'(日夜切換時重建),三態的 props.theme(null = 跟隨系統)先解析成明確值。
  const mapTheme = useResolvedTheme(props.theme)
  const { cfg, activeTrip, setActiveTrip } = props
  // tabBarRef/tabBarHeight——2026-10 新增(使用者明確要求「有辦法確保
  // bottom sheet 如果是在功能列後面,標頭不會被遮蔽,也不用功能列改動
  // 高度就要重新確認」「我要穩定根本的處理方式」):取代底下
  // trip/phone/TripList.tsx/PhoneTimelineDrawer.tsx/
  // PlanPhoneView.module.css 各自把 phone/Nav.module.css 的 .tab 高度
  // (64px)寫死複製貼上的做法——用 hooks/useElementHeight.ts 的
  // ResizeObserver 量出 phone/Nav 的真實高度,寫進 .container 的 CSS
  // 自訂屬性 --tab-bar-height(見下方 JSX 的 style),所有需要避開功能列
  // 的 CSS/inline style 改用 var(--tab-bar-height) 取代寫死的 64px——
  // 這個變數的值是瀏覽器量出來的事實,不是任何人手動維護的數字,
  // phone/Nav 之後不管怎麼改版面都不需要回頭檢查依賴它的程式碼。
  const tabBarRef = useRef<HTMLElement>(null)
  // safeAreaRef:疊加層的 safe-area 節點(沒被搜尋框與底部規劃面板蓋住的地圖),交給 PlanPhoneView 讓平移(首站、搜尋)避開面板。
  const safeAreaRef = useRef<HTMLDivElement>(null)
  const tabBarHeight = useElementHeight(tabBarRef)
  const [inSettings, setInSettings] = useState(false)
  // manageTrip:旅程管理彈窗(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)——對齊桌面版 planning/member/desktop/Content.tsx 的同名 state,
  // 原本手機版這幾個功能散落在 PhoneNavDrawer 抽屜(已隨底部常駐導覽列
  // 拿掉),現在跟桌面版一樣統一收到旅程列表每一筆項目的「管理」按鈕
  // (見 trip/phone/TripList.tsx 的 onManage)。
  const [manageTrip, setManageTrip] = useState<Trip | null>(null)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有旅程/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // tripsDrawerOpen:旅程列表獨立抽屜(trip/phone/TripList.tsx)開關——預設
  // 收合,使用者需要選旅程時自行點底部「行程」按鈕開啟,不再進 App 就
  // 強制彈出。原本還有 drawerOpen 控制 PhoneNavDrawer(分享/成員/頭像
  // 精簡版抽屜),隨分享/成員對齊桌面版搬到旅程項目、頭像改直接開設定,
  // 這個抽屜已無存在必要,整組移除(不再有任何畫面殘留「開抽屜」入口)。
  const [tripsDrawerOpen, setTripsDrawerOpen] = useState(false)
  // timelineDrawerOpen:時間軸 bottom sheet(timeline/PhoneTimelineDrawer.tsx)
  // 開關——由規劃地圖左下角「時間軸」按鈕觸發(見下方 PlanPhoneView
  // 的 onOpenTimeline),不經過路由導航,純粹是這個元件內部的疊加狀態
  // (使用者要求「時間軸不用獨立路由」)。
  const [timelineDrawerOpen, setTimelineDrawerOpen] = useState(false)
  // chatSheetOpen:對話改成疊加層開關,同
  // timelineDrawerOpen 同一套模式——使用者明確要求「規劃地圖常駐為主
  // 畫面,對話改成跟地點清單/設定頁一樣的 PhoneBottomSheet 疊加
  // 層」,不再是「分頁決定主顯示內容」的版型(舊版 drawerMode/
  // effectiveMainMode 整組邏輯隨這次調整移除,不再需要路徑參數驅動主畫面
  // 切換——規劃地圖是唯一常駐的主畫面,/app/:panelMode 這個路由現在只供
  // 桌面版使用,見 App.tsx)。
  const [chatSheetOpen, setChatSheetOpen] = useState(false)
  // controlsSlotEl:PlanOverlayLayout 挖出的「地圖控制項插槽」元素(用 state 才會在掛載後重新渲染),
  // 轉給 PlanPhoneView 的 controlsPortalTarget,讓搜尋框等 portal 進規劃疊加外殼的 UI 層。
  const [controlsSlotEl, setControlsSlotEl] = useState<HTMLDivElement | null>(null)
  // stops/selectedStopId/hoverStopId/hoverTransitPair:規劃面板裡
  // AI 規劃時間軸的站點,交給地圖顯示成站點圖層(2026-10,使用者明確要求
  // 「要加入地圖上的地點層,要共用同一套」)。做法對齊桌面版 planning/member/desktop/Content.tsx
  // 的同名 state:TripPlanPage 的 onStopsChange 等回調寫進來,再傳給
  // PlanPhoneView → PlanMap 統一繪製層的站點圓點功能層(map/draw/layers/planStopLayer)。
  // selectedStopId 是地圖與時間軸共用的唯一事實來源:點卡片與點地圖圓點
  // 都寫同一個 state,不會出現兩邊各自高亮不同站。
  // 狀態本身(站點、選取、hover、轉乘配對與 TripPlanPage 的四個回呼)在共用的 planning/timeline/usePlanStopsState,
  // 登入後桌面(planning/member/desktop/Content)同樣使用。
  const { stops, routeSegments, selectedStopId, hoverStopId, hoverTransitPair, setSelectedStopId, tripPlanProps } = usePlanStopsState()
  // exploreActive/exploreTrigger:2026-10「探索」標籤從疊在地圖左上角
  // 搬到底部常駐功能列(使用者明確要求),這兩個 state 是這個元件與
  // PlanPhoneView.tsx 之間的橋接——exploreActive 是 PlanMap.tsx
  // 內部 activeCategory 選取狀態的單向回報(是否等於 EXPLORE_CATEGORY,
  // 見 PlanPhoneView.tsx onActiveCategoryChange 轉接處的完整
  // 說明),只用來決定 phone/Nav 這顆按鈕的 active 視覺,這個元件
  // 不反過來指定它;exploreTrigger 是遞增計數器,每次按下按鈕就遞增,
  // 讓 PlanPhoneView → PlanMap 收到變化後觸發一次探索標籤的
  // 點擊(開啟或取消,邏輯仍在 PlanMap 內部的 handleCategoryClick,
  // 這裡只負責送出觸發訊號),對齊 PlanPhoneInfoSheet.tsx
  // addFlashTrigger 的既有設計慣例。
  const [exploreActive, setExploreActive] = useState(false)
  const [exploreTrigger, setExploreTrigger] = useState(0)
  // tripListDrawerOpen/tripListDrawerTrigger:2026-10「行程」按鈕從
  // 疊在地圖左下角的浮動按鈕群組搬到底部常駐功能列(使用者明確要求,
  // 跟「旅程」交換位置),這兩個 state 的橋接方式對齊上面
  // exploreActive/exploreTrigger 的既有模式——tripListDrawerOpen 是
  // PlanPhoneView.tsx 內部行程清單抽屜開關狀態的單向回報(那個元件
  // 內部還有「加入候選後自動打開抽屜」的既有邏輯,開關狀態本身不提升
  // 出來,只回報目前是否開啟,供這顆按鈕顯示 active 視覺);
  // tripListDrawerTrigger 是遞增計數器,按下按鈕就遞增,讓
  // PlanPhoneView.tsx 收到變化後打開抽屜。
  //
  // 2026-10 改名(使用者明確要求「候選的命名也要一起改」):這組 state
  // 原名 tripListDrawerOpen/tripListDrawerTrigger,對應的抽屜
  // (planning/place/phone/CandidateList.tsx,原檔名
  // GeoOutlinePhoneCandidateDrawer.tsx)已經不處理候選籃概念,改用
  // tripList 反映實際內容。
  const [tripListDrawerOpen, setTripListDrawerOpen] = useState(false)
  const [tripListDrawerTrigger, setTripListDrawerTrigger] = useState(0)
  // pendingRestoreTripsRef:2026-10 修正——原本「行程抽屜關閉時重新開啟
  // 清單」是無條件觸發(只要曾經開過行程抽屜,之後任何一次關閉都會
  // 彈回清單),code review 抓到這樣會導致使用者永遠無法單純關掉兩層
  // sheet 回到地圖(按 X 關行程→立刻被彈回清單→還要再關一次清單),
  // 體感像卡住。改成只在「這次打開行程抽屜是因為剛在清單裡選定了
  // 旅程」(見下方 selectTrip)這個情境,才在使用者關閉行程抽屜時回彈
  // 清單——其餘情況(使用者自己按行程按鈕打開、或行程內項目收合/復原
  // 的 activeSnapIndex 互動)關閉時單純回地圖,不自動開任何東西。用
  // ref 而非 state,因為這個值只在 tripListDrawerOpen 的 effect 裡
  // 讀取/消耗一次,不需要參與渲染。
  const pendingRestoreTripsRef = useRef(false)
  useEffect(() => {
    if (tripListDrawerOpen) return
    if (pendingRestoreTripsRef.current) {
      pendingRestoreTripsRef.current = false
      setTripsDrawerOpen(true)
    }
  }, [tripListDrawerOpen])
  // settingsSnapIndex:2026-10 新增(使用者明確要求「除了
  // 選單類的，其他都加入最小段」)——設定頁原本是單段模式(往下拖
  // 到底直接 onClose),改成跟對話疊加層同一套兩段式吸附(索引 0 是收合段
  // SETTINGS_SHEET_MIN_HEIGHT,索引 1 是展開段)。
  // 日期選單/日曆(PlanPhoneDatePickerSheet.tsx/PlanPhoneDateCalendarSheet.tsx)
  // 是選單性質,排除在這次調整範圍外,維持單段往下拖到底關閉。
  const [settingsSnapIndex, setSettingsSnapIndex] = useState(1)
  useEffect(() => {
    if (inSettings) setSettingsSnapIndex(1)
  }, [inSettings])
  // onOpenTrips:底部常駐列「旅程」按鈕——開啟獨立的旅程抽屜
  // (trip/phone/TripList.tsx),已開啟時再點一次視為收合(toggle)。
  const onOpenTrips = () => {
    setTripsDrawerOpen((v) => !v)
  }
  // selectTrip:切換使用中的旅程,並關閉獨立旅程抽屜。
  //
  // 2026-10 修正:使用者明確要求「選完清單後就開啟行程」——選定旅程後
  // 緊接著觸發 tripListDrawerTrigger 打開行程清單抽屜,不需要使用者
  // 再按一次「行程」按鈕;同時標記 pendingRestoreTripsRef(見上方該 ref
  // 的完整說明),這樣使用者之後關閉這次打開的行程抽屜時才會自動彈回
  // 清單,形成「選清單→開行程→關行程→回清單」的來回循環。
  //
  // code review 修正:原本不分 t 是否已經是目前的 activeTrip,一律觸發
  // tripListDrawerTrigger——使用者在清單裡重複點選同一個已選定的旅程
  // (例如單純想收起清單回地圖),也會被無條件導去重新打開行程抽屜。
  // 改成只有真的切換到不同旅程時才觸發這整套「打開行程+標記待回彈」的
  // 連動,重複點同一個旅程單純關閉清單,不節外生枝。
  const selectTrip = (t: Trip) => {
    const isSameTrip = t.id === activeTrip?.id
    setActiveTrip(t)
    setTripsDrawerOpen(false)
    if (isSameTrip) return
    pendingRestoreTripsRef.current = true
    setTripListDrawerTrigger((n) => n + 1)
  }

  // useTripsState 提升到這裡頂層常駐呼叫(不只在抽屜開啟時才掛載)——
  // 這個 hook 內建「若 localStorage 記錄過預設旅程,trips 載入後自動
  // onOpen() 跳進該旅程」的既有行為,必須從一開始就掛載才不會漏掉這個自動
  // 導覽,理由與桌面版 trip/desktop/TripList 掛載時機一致(桌面版預設就落在
  // 'trips' 分頁,同樣一開始就會掛載)。
  const {
    trips, err: tripsErr, loading: tripsLoading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useTripsState(cfg, selectTrip)

  // timelineMirror:時間軸抽屜(PhoneTimelineDrawer)需要的行程條目資料——
  // 改用 useTripEntriesMirror 自己撈,跟桌面版 planning/member/desktop/Content
  // 同一套(原本由隱藏掛載的 ChatScreen 透過 onTimelineData 鏡像過來,
  // 已移除)。isOwner 判斷同桌面版:非擁有者 api.fetchEntries 會失敗,不如不打。
  const timelineMirror = useTripEntriesMirror(
    cfg,
    activeTrip?.id ?? null,
    activeTrip ? activeTrip.ownerID === props.user.id : false,
  )

  // titleHelmet:2026-10 新增——/app 這個登入後正式功能頁原本沒有自己的
  // <title>,SPA 內部換頁(例如從其他頁面透過前端路由導到 /app)後瀏覽器
  // 分頁標題仍停留在 index.html 的靜態標題,仿照其餘城市頁(JiufenPage.tsx
  // 等)既有的 react-helmet-async 模式補上,用它直接覆寫 document.title。
  // 這次先固定寫死這個值,不跟著左側 Rail 切換的功能分頁(旅程列表/規劃/
  // 時間軸/路徑/AI 規劃)動態變化。
  // 下方三個 return 分支(訪客登入卡片/桌面版/手機版主畫面)都是這個元件
  // 真正會渲染畫面的路徑,但 <Helmet> 本身不依賴分支的其他內容,抽成這裡
  // 單一一份 JSX 常數,三處都直接引用同一份,不再各自重複宣告同樣的
  // <title> 標籤(2026-10 code review 抓到:原本三處各自複製貼上一份完全
  // 相同的區塊,日後要改標題邏輯得同步改三處,容易漏改)。
  const titleHelmet = (
    <Helmet>
      <title>Tripace | 規劃</title>
    </Helmet>
  )

  if (props.isGuest) {
    return (
      <>
        {titleHelmet}
        <LoginCard title="歡迎使用 Tripace" subtitle="請先登入或註冊帳號,才能查看與使用旅程功能。">
          <LoginForm baseURL={cfg.baseURL} onAuthed={props.onAuthed} pill />
        </LoginCard>
      </>
    )
  }

  if (isDesktop) {
    return (
      <>
        {titleHelmet}
        <DesktopContent {...props} />
      </>
    )
  }

  // bottomTabs:底部常駐列(phone/Nav.tsx)的項目清單——每個項目自帶 onClick,直接開啟
  // 對應的疊加層(使用者明確要求「規劃地圖常駐為主畫面,對話
  // 改成疊加層」,不再是切換分頁模式,見上方 chatSheetOpen
  // 的說明)。
  // 2026-10 修正:「行程」「旅程」兩顆按鈕合併成同一個群組功能,統一
  // 命名——整體概念叫「行程」,原本的「旅程」(切換/選擇不同旅程的清單,
  // trip/phone/TripList)在命名上改稱「行程的清單」,畫面上簡稱「清單」。
  // 底部功能列現在只顯示一顆「行程」按鈕,不再有獨立的「旅程」/「清單」
  // 入口——兩個 bottom sheet(候選籃/行程抽屜、trip/phone/TripList)都還在,
  // 只是互動方式改變:按下「行程」時,若使用者還沒選擇清單(activeTrip
  // 為空),先開啟清單讓使用者選;已經選了清單,才真正開啟行程抽屜本身
  // (候選籃/本次行程已排定的地點清單)。
  //
  // handleOpenTrip:activeTrip 為空代表還沒選擇清單,這時候開啟候選籃/
  // 行程抽屜沒有意義(沒有 tripID,PlanPhoneView.tsx 內部的
  // handleAddCandidate 等流程本來就會因為缺少 tripID 而無法真正寫入
  // entry),改成呼叫 onOpenTrips 開啟清單,引導使用者先選,比直接打開
  // 一個「看起來能操作、實際上沒有清單可以排入」的空抽屜更符合使用者
  // 預期。有 activeTrip 時才真正觸發候選籃/行程抽屜。
  const handleOpenTrip = () => {
    if (!activeTrip) {
      onOpenTrips()
      return
    }
    setTripListDrawerTrigger((n) => n + 1)
  }
  const bottomTabs: { key: string; icon: typeof Sparkles; title: string; active: boolean; onClick: () => void; beta?: boolean }[] = [
    // active:候選籃/行程抽屜、清單抽屜任一個開啟,這顆按鈕都顯示為
    // 啟用狀態——使用者只看到一顆「行程」入口,不需要分辨目前到底是哪
    // 一層 sheet 開著,只要「行程」這個概念相關的畫面正在顯示,按鈕就該
    // 亮著。
    { key: 'trip', icon: ListPlus, title: '行程', active: tripListDrawerOpen || tripsDrawerOpen, onClick: handleOpenTrip },
    { key: 'explore', icon: Compass, title: '探索', active: exploreActive, onClick: () => setExploreTrigger((n) => n + 1) },
    // onClick toggle:規劃面板改成沒有標頭關閉鈕的透明疊加層(見下方 planOverlay),
    // 關閉入口就是這顆 tab 再點一次。
    { key: 'plan-ai', icon: Sparkles, title: '規劃', active: chatSheetOpen, onClick: () => setChatSheetOpen((v) => !v), beta: true },
  ]
  // visibleStopsView:傳給地圖的站點檢視,規劃面板關閉時整組遮蔽(桌面、手機共用,見 maskPlanStopsView)。
  const visibleStopsView = maskPlanStopsView({ stops, selectedStopId, hoverStopId, hoverTransitPair }, chatSheetOpen)

  return (
    <>
      {titleHelmet}
      {/* 主顯示區容器:flex 屬性延續原本 .web-app 直接排列這些內容時的
          版面(撐滿剩餘高度、內部再各自 flex column 排 navbar/內容/
          輸入列)。
          --tab-bar-height——2026-10 新增,見上方 tabBarRef/tabBarHeight
          的完整說明。寫在這個容器(phone/Nav 跟所有需要避開它的
          bottom sheet 共用的定位祖先 .container)上,CSS 自訂屬性會
          沿著 DOM 樹往下繼承,子孫元素(含各個 .module.css 檔案跟
          inline style)都能直接 var(--tab-bar-height) 讀到同一份真實
          數值。初始量測結果是 0(ResizeObserver 要等第一次 layout 完成
          才會回報,見該 hook 的完整說明)——這極短暫的空窗期間所有依賴
          這個變數的元件會暫時算成「功能列不存在」,實務上只有一個
          frame 的落差,肉眼看不出來,不需要額外的 loading 態處理。 */}
      <PlanLayout tabBarHeight={tabBarHeight}>
        {/* 規劃地圖:唯一常駐的主畫面(使用者明確要求,見上方
            chatSheetOpen 的說明),不再隨分頁切換卸載重掛
            ——理由同對齊桌面版 PlanMap 永遠掛載的既有模式
            (planning/member/desktop/Content.tsx)。搜尋框/使用者頭像/候選籃按鈕由
            PlanPhoneView 自己疊在地圖上方。activeTrip 供候選籃
            「加入行程」判斷是否已選定旅程使用。 */}
        {/* 規劃(AI 規劃)疊加面板。2026-10(使用者明確要求「手機版的規劃對齊
            ai-plan」,確認「拆掉 bottom sheet,完全改成 /ai-plan 的疊加面板
            架構」「用一樣的模式,但是本來就要用不同的 layout 實體」):原本是
            PersistentSheet(三段式吸附、實心面板蓋住地圖、縱向時間軸在 sheet
            內捲動),現在改成 /app 自己的版面外殼 PlanOverlayLayout(模式
            對齊 /ai-plan 的 PlanOverlayPanel,見該元件的完整說明)——透明
            面板疊在滿版地圖上,橫向卡片時間軸貼底、composer 在最下方。
            TripPlanPage 的 transparentBackground/hideEmptyState/
            horizontalTimeline 由 PlanPanelContent 統一決定(與 /ai-plan 的
            LivePlanLayer 共用),這裡的 planning/member/phone/LivePlanLayer 不傳這三個 prop。
            地圖仍是 PlanPhoneView 的 PlanMap(綁了搜尋、頭像、候選籃,
            不換成 /ai-plan 的 NativeMapBase),它本來就在這個容器裡滿版鋪底,
            面板透明後自然透出。開關沿用 chatSheetOpen(底部「規劃」tab 切換)。
            initialAskPage={{ country: {} }}——使用者明確要求「一開始要從
            詢問視窗開啟」,跟 /ai-plan 的 LivePlanLayer 傳的值一致(空的
            AskPageCountryInput 表示顯示全部國家)。TripPlanPage 在掛載時、
            且沒有任何站點時才會開這個詢問頁,已經有行程就不開(見該 prop
            的完整說明);面板用 hidden 保持掛載,所以詢問頁在使用者第一次
            打開面板之前就已經準備好、打開時直接看到。 */}
        <PlanOverlayLayout
          open={chatSheetOpen}
          passThrough
          onControlsSlotChange={setControlsSlotEl}
          safeAreaRef={safeAreaRef}
          mapBackground={
            <PlanPhoneView
              cfg={cfg}
              tripID={activeTrip?.id ?? null}
              activeTrip={activeTrip}
              user={props.user}
              onOpenSettings={() => setInSettings(true)}
              onOpenTimeline={TIMELINE_ENABLED ? () => setTimelineDrawerOpen(true) : undefined}
              onOpenTrips={() => setTripsDrawerOpen(true)}
              theme={mapTheme}
              exploreTrigger={exploreTrigger}
              onExploreActiveChange={setExploreActive}
              tripListDrawerTrigger={tripListDrawerTrigger}
              onTripListDrawerActiveChange={setTripListDrawerOpen}
              // 站點檢視:規劃面板關閉時整組遮蔽,見 maskPlanStopsView(桌面、手機共用)。
              {...visibleStopsView}
              // 連線段:四個入口共用 ROUTE_LINE_ENABLED 控制(見 DesktopShared.tsx);手機沒有切換入口,flag 開啟就傳
              // (與站點檢視同樣只在面板開啟時傳,關閉時不畫線)。
              routeSegments={ROUTE_LINE_ENABLED && chatSheetOpen ? routeSegments : undefined}
              safeAreaRef={safeAreaRef}
              controlsPortalTarget={controlsSlotEl}
              onStopClick={setSelectedStopId}
            />
          }
        >
          {/* 資料存取層在入口根部決定一次:登入版(打 /internal),底下的時間軸、地圖投影與詢問頁共用同一個 store */}
          <PlanDataProvider dataSource={getPlanAiApiDataSource(cfg)}>
            <LivePlanLayer cfg={cfg} selectedStopId={selectedStopId} tripPlanProps={tripPlanProps} />
          </PlanDataProvider>
        </PlanOverlayLayout>
        {/* phone/Nav:底部常駐導覽列(行程/旅程/探索/AI 規劃),取代原本
            要開 PhoneNavDrawer 抽屜才看得到的分頁列,見該元件開頭說明。
            tripsDrawerOpen/onOpenTrips 現在是 bottomTabs 陣列裡的「旅程」
            項目(見上方該陣列的完整說明),不再是這個元件的獨立 prop。 */}
        <PhoneNav ref={tabBarRef} tabs={bottomTabs} />
        {/* 旅程列表獨立抽屜,由底部常駐列的「旅程」按鈕開關(onOpenTrips)。
            onManage 對齊桌面版 trip/desktop/TripList.tsx,開啟合併後的
            TripManageModal(分享連結/成員/開啟時自動進入),見下方渲染。
            渲染在 .container 內部(跟 phone/Nav 同一層,而非它的
            sibling)——trip/phone/TripList 的 .panel/.backdrop 用
            position: absolute 定位到「貼齊 phone/Nav 上緣」(bottom:
            calc(52px + safe-area)),定位基準要跟 phone/Nav 同一個
            position: relative 祖先(.container 本身),放在外面會找到
            錯的祖先容器計算高度,導致視覺上蓋住 phone/Nav(使用者
            回報「功能列被遮住了」的根因)。 */}
        <PhoneTripList
          open={tripsDrawerOpen}
          trips={trips}
          err={tripsErr}
          loading={tripsLoading}
          creating={creating}
          setCreating={setCreating}
          newName={newName}
          setNewName={setNewName}
          submitCreate={submitCreate}
          activeTripID={activeTrip?.id ?? null}
          onSelectTrip={selectTrip}
          onManage={setManageTrip}
          onClose={() => setTripsDrawerOpen(false)}
        />
        {/* 時間軸 bottom sheet,由規劃地圖左下角「時間軸」按鈕開關
            (timelineDrawerOpen,見上方說明)——同樣渲染在 .container 內部、
            跟 phone/Nav 同一層,理由同上方 trip/phone/TripList 的說明
            (定位基準要一致,才不會蓋住底部功能列)。timelineMirror 由
            useTripEntriesMirror 自己撈(見上方說明)。 */}
        <PhoneTimelineDrawer
          open={timelineDrawerOpen}
          onClose={() => setTimelineDrawerOpen(false)}
          tripName={activeTrip?.name ?? '時間軸'}
          timelineMirror={timelineMirror}
          editCfg={activeTrip && activeTrip.ownerID === props.user.id ? cfg : undefined}
        />
      </PlanLayout>
      {/* 設定頁:改用具名工廠元件 StandaloneSheet(2026-10,見
          components/PhoneBottomSheet.tsx 的完整說明)——獨立開關、不屬於
          任何堆疊,對齊 trip/phone/TripList.tsx 的既有用法(使用者明確
          要求改成一般高度、可下滑關閉的 bottom sheet,不再是滿版全螢幕
          滑入)。bottom: 0、zIndex 改引用 Z_LAYERS.ABOVE_TAB_BAR(2026-10,
          見 zLayers.ts 的完整說明,取代原本寫死的 36)——使用者明確要求
          開啟時不要被底部常駐導覽列 phone/Nav.tsx 蓋住,不是貼齊它的
          上緣讓開空間。showBackdrop={false}——使用者明確要求完全不要
          遮罩,點外部不關閉,只能靠 head 的關閉鈕或下滑手勢關閉。
          head 改用共用的 SheetHead(標題+關閉鈕標準樣式),不再自己拼
          navbar class,理由見該元件的說明。
          2026-10 新增 minHeightPx/activeSnapIndex/onSnapIndexChange
          (使用者明確要求「除了選單類的，其他都加入最小段」)——原本是
          單段模式(往下拖到底直接 onClose),改成跟對話疊加層同一套
          兩段式吸附,見上方 settingsSnapIndex 的完整說明。 */}
      <StandaloneSheet
        open={inSettings}
        onClose={() => setInSettings(false)}
        snapPoints={[SETTINGS_SHEET_TOP]}
        minHeightPx={SETTINGS_SHEET_MIN_HEIGHT}
        activeSnapIndex={settingsSnapIndex}
        onSnapIndexChange={setSettingsSnapIndex}
        panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: Z_LAYERS.ABOVE_TAB_BAR }}
        showBackdrop={false}
        head={<SheetHead title="設定" onClose={() => setInSettings(false)} />}
      >
        {/* SheetBody 包住——新增最小段後,收合時要讓內容正確隱藏(見該
            元件的完整說明:只有用 SheetBody 包住的內容才會在收合段隱藏,
            沒包住的普通內容會持續顯示),對齊其餘多段模式 sheet 的既有
            用法。SettingsScreen 本身內容不長,不需要捲動交接,但仍然要
            包這一層才能享有「收合時隱藏」這個行為。 */}
        <SheetBody>
          <SettingsScreen
            cfg={props.cfg}
            user={props.user}
            email={props.email}
            isGuest={props.isGuest}
            onAuthed={props.onAuthed}
            onLogout={() => { props.onLogout(); setInSettings(false) }}
            theme={props.theme}
            setTheme={props.setTheme}
          />
        </SheetBody>
      </StandaloneSheet>
      {/* manageTrip:旅程管理彈窗,對齊桌面版 planning/member/desktop/Content.tsx 的同名
          渲染邏輯——用 base-ui.css 既有的 .rp-modal*(置中卡片彈窗骨架)
          包住,TripManageModal 本身用 .rp-modal-head/.rp-modal-body
          渲染內容(見該檔案的說明)。分享/成員/開啟時自動進入原本散落在
          PhoneNavDrawer 抽屜(已隨底部常駐導覽列拿掉),現在統一收到這裡,
          跟桌面版同一套心智模型。 */}
      {manageTrip && (
        <TripManageDialog cfg={cfg} trip={manageTrip} userID={props.user.id} onClose={() => setManageTrip(null)} />
      )}
    </>
  )
}


