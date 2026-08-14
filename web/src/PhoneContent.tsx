import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlignLeft, Timeline, Route } from 'lucide-react'
import { ChatScreen, type DesktopTimelineMirror } from './ChatScreen'
import { MultiTrackTimeline } from './Timeline'
import {
  useIsDesktop, useTripsState,
  type ContentProps,
} from './AppCommon'
import { LoginForm, LoginCard } from './LoginForm'
import { isPanelMode } from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { SettingsScreen } from './SettingsScreen'
import { ShareModal } from './trip/ShareModal'
import { PaceRouteMap, type SelectedEntry } from './PaceRouteMap'
import type { Checkpoint } from './PaceChart'
import { PhoneNavDrawer, type DrawerMode } from './PhoneNavDrawer'
import { PhoneTripsDrawer } from './PhoneTripsDrawer'
import type { Trip, User } from './types'
import type { ClientConfig } from './api'
import styles from './PhoneContent.module.css'

// 時間軸鏡像資料的初始值(尚未收到 ChatScreen 鏡像前,或未選擇行程時使用)
// ——跟 DesktopLayout.tsx 的 EMPTY_TIMELINE_MIRROR 同一份形狀,手機版這裡
// 需要自己一份是因為抽屜欄的時間軸分頁(PhoneNavDrawer.tsx)跟桌面版的
// side panel 各自獨立掛載,不共用同一個 React tree,無法共用同一個常數
// 參照(但值本身完全一樣)。
const EMPTY_TIMELINE_MIRROR: DesktopTimelineMirror = {
  entries: [],
  updatingEntryIDs: new Set<string>(),
  taskPlaceholders: [],
  refetchEntries: () => {},
}

// PhoneContent:手機版(寬度 < 768px)主要應用狀態切換器——登入畫面/桌面版
// 導轉/聊天室/設定/導覽抽屜,見 App.tsx App() 的 /app 路由分支。
// 導覽比照桌面版 DesktopLayout.tsx 的 DesktopRail + .desktop-sidepanel 結構:
// 左上角常駐按鈕開啟左側抽屜(PhoneNavDrawer,見該檔案),裝著行程列表/
// 時間軸/配速表/demo 面板分頁 + 底部設定入口——取代原本各自獨立的整頁
// TripsScreen、ChatScreen 自己的右側時間軸抽屜,與右下角漢堡按鈕開的
// PhoneDemoDrawer。
//
// 主顯示區(抽屜關閉後看到的內容)對齊桌面版 DesktopContent 的
// .desktop-main 邏輯:選到的分頁是 'pace' 時顯示 PaceRouteMap(地圖),
// 其餘情況顯示 ChatScreen(有選行程)或空白提示(沒有)——'trips'/
// 'timeline' 分頁不影響主顯示,只影響抽屜欄裡的內容,同桌面版
// isSidepanelMode 的邏輯。
export function PhoneContent(props: ContentProps) {
  const { cfg, activeTrip, setActiveTrip } = props
  const [inSettings, setInSettings] = useState(false)
  // inShare:分享面板(見下方 .sharePanel)開關——跟 inSettings 同一種
  // 「從底部滿版滑入/滑出」呈現方式,由 PhoneNavDrawer 分頁列右上角的分享
  // 按鈕觸發(見該檔案的 onOpenShare),取代原本點下去就地取代抽屜分頁
  // 內容的行為。
  const [inShare, setInShare] = useState(false)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有行程/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // drawerOpen:抽屜開關本身是純 UI state,不進 URL——使用者收合/展開抽屜
  // 不該影響網址或瀏覽器上一頁/下一頁的行為。初始值取決於進入當下有沒有
  // 已選的行程:還沒選行程時預設開啟(維持「一進 App 先看到行程列表」的
  // 既有使用者習慣),已有 activeTrip(例如熱重載後恢復狀態)則不強制
  // 開啟,直接顯示 ChatScreen。
  const [drawerOpen, setDrawerOpen] = useState(!activeTrip)
  // tripsDrawerOpen:行程列表已經拆成獨立抽屜(PhoneTripsDrawer.tsx,
  // 疊在 PhoneNavDrawer 之上),開關是自己獨立的一組 UI state,不再是
  // drawerMode 眾多值的其中一個——初始值沿用原本「還沒選行程時預設開啟」
  // 的既有使用者習慣(一進 App 先看到行程列表)。
  const [tripsDrawerOpen, setTripsDrawerOpen] = useState(!activeTrip)
  // drawerMode:改用路徑參數驅動,跟桌面版 DesktopContent 的 panelMode 共用
  // 同一個 /app/:panelMode 路由——理由與既有設計相同,使用者縮放視窗跨越
  // 桌面/手機斷點時網址不必跳轉、狀態自然延續。網址沒帶 panelMode 或帶了
  // 不合法字串時,fallback 成 'trips'——現在純粹代表「尚未選取時間軸/
  // 配速表等內容分頁」的預設狀態,不再對應 PhoneNavDrawer 自己的任何一顆
  // 分頁(行程列表已經拆成獨立抽屜,見上方 tripsDrawerOpen)。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  // geo-outline(地理輪廓底圖規劃介面)、demo-route-editor(路徑編輯器
  // 試做)桌面版才有實作,手機版 PhoneNavDrawer 的 DrawerMode 型別故意
  // 不含它們——使用者若從桌面版縮小視窗跨越斷點、網址剛好停在
  // /app/geo-outline 或 /app/demo-route-editor,手機版 fallback 回
  // 'trips'(理由同其餘不合法字串的 fallback),避免型別不符,也讓
  // 使用者落地到一個看得懂的畫面。
  const drawerMode: DrawerMode =
    isPanelMode(panelModeParam) && panelModeParam !== 'geo-outline' && panelModeParam !== 'demo-route-editor'
      ? panelModeParam
      : 'trips'
  const navigate = useNavigate()
  // lastContentMode:記住使用者上一次主動選取的「時間軸」或「配速表」分頁。
  // 開啟獨立行程抽屜選新行程時,這個值仍保留原值不變,驅動 PhoneNavDrawer
  // 讓對應圖示繼續顯示 active(使用者觀點:行程列表只是暫時借用的工具畫面,
  // 不是真的離開了時間軸/配速表這個內容模式);選完行程後再靠這個值把
  // 使用者帶回選擇行程「之前」正在看的內容。用 state(而非 ref)是因為
  // 現在需要驅動 UI(tab 的 active 樣式),不能只是純暫存值。
  const [lastContentMode, setLastContentMode] = useState<'pace' | 'timeline' | null>(null)
  // setDrawerMode:再點一次目前啟用中的分頁圖示時收合抽屜,對齊桌面版
  // DesktopLayout.tsx 的 setPanelMode 行為。
  const setDrawerMode = (mode: DrawerMode) => {
    if (mode === drawerMode) {
      setDrawerOpen(false)
      return
    }
    if (mode === 'pace' || mode === 'timeline') {
      setLastContentMode(mode)
    }
    navigate(`/app/${mode}`)
  }
  // onOpenTrips:PhoneNavDrawer 分頁列的「行程」觸發鈕——開啟獨立的行程
  // 抽屜(疊在 PhoneNavDrawer 之上),已開啟時再點一次視為收合(toggle),
  // 不是切換 drawerMode。
  const onOpenTrips = () => {
    setTripsDrawerOpen((v) => !v)
  }
  // selectTrip:切換使用中的行程,並關閉獨立行程抽屜——若使用者選行程前
  // 正在看時間軸或配速表(lastContentMode 有值),選完後帶回同一個分頁、
  // 順便開啟 PhoneNavDrawer(時間軸/配速表元件都是依 activeTrip 反應式
  // 讀資料,不需要額外處理)。若 lastContentMode 為 null(例如剛進 App
  // 第一次選),維持原行為:關閉兩個抽屜直接看對話。
  const selectTrip = (t: Trip) => {
    setActiveTrip(t)
    setTripsDrawerOpen(false)
    if (lastContentMode) {
      navigate(`/app/${lastContentMode}`)
      setDrawerOpen(true)
    } else {
      setDrawerOpen(false)
    }
  }

  // useTripsState 提升到這裡頂層常駐呼叫(不只在抽屜開啟時才掛載)——
  // 這個 hook 內建「若 localStorage 記錄過預設行程,trips 載入後自動
  // onOpen() 跳進該行程」的既有行為,必須從一開始就掛載才不會漏掉這個自動
  // 導覽,理由與桌面版 DesktopTripList 掛載時機一致(桌面版預設就落在
  // 'trips' 分頁,同樣一開始就會掛載)。
  const {
    trips, err: tripsErr, loading: tripsLoading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useTripsState(cfg, selectTrip)

  // timelineMirror:ChatScreen 透過 onTimelineData 鏡像過來的時間軸資料,
  // 供抽屜欄的時間軸分頁(PhoneNavDrawer.tsx)顯示——跟桌面版
  // DesktopContent 的同名 state 是同一套機制,見該檔案的說明。用
  // useCallback 包 setter 傳給 ChatScreen,理由同 DesktopContent 的
  // desktopChat useMemo:避免每次重渲染都建立新的函式參照,導致 ChatScreen
  // 內鏡像資料的 effect 每次都重新觸發。
  const [timelineMirror, setTimelineMirror] = useState<DesktopTimelineMirror>(EMPTY_TIMELINE_MIRROR)
  const onTimelineData = useCallback((data: DesktopTimelineMirror) => {
    setTimelineMirror(data)
  }, [])
  // selectedEntry:配速表「點卡片→地圖平移→手動微調→儲存座標」互動用,
  // 跟桌面版 DesktopContent 同一套設計(見該檔案的說明)。
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null)
  // paceCheckpoints:PhoneNavDrawer 的 'pace' 分頁(PaceChart)目前選取的
  // 那一段 checkpoint 清單,透過 onRouteChange 鏡像過來,轉傳給主顯示區的
  // PaceRouteMap(地圖)——同一套模式比照桌面版 DesktopLayout.tsx。
  const [paceCheckpoints, setPaceCheckpoints] = useState<Checkpoint[]>([])
  // savedEntry:PaceRouteMap 手動拖曳選點、儲存座標成功後回報的結果,轉傳給
  // PhoneNavDrawer 的 PaceChart 讓它就地更新自己的 checkpointsBySegment
  // (見 PaceChart.tsx 的 savedEntry prop 說明)——同一套模式比照桌面版
  // DesktopLayout.tsx。
  const [savedEntry, setSavedEntry] = useState<{ id: string; lat: number; lng: number } | null>(null)

  // 時間軸與對話(ChatScreen)顯示位置對調:'timeline' 分頁時,時間軸改到
  // 主顯示區滿版顯示,對話改顯示在抽屜欄裡(跟配速表分頁的「側欄放清單、
  // 主區放地圖」相反過來)。ChatScreen 只在這裡掛載「一次」(下方
  // chatElement),不會因為 drawerMode 切換而重新掛載/重新連線 WebSocket
  // ——用 React Portal 把它的畫面投影到目前該出現的容器(主顯示區或抽屜欄),
  // 兩個容器都只是空的 DOM 節點,實際內容(元件實例、state、WS 連線)全程
  // 只存在這一份。mainChatSlotNode/timelineSlotNode 用 state(而非 ref)是
  // 因為節點掛載的時機在 effect 之後,需要能觸發重新渲染才能讓 portal
  // 抓到剛掛載好的節點。
  const [mainChatSlotNode, setMainChatSlotNode] = useState<HTMLDivElement | null>(null)
  const [timelineSlotNode, setTimelineSlotNode] = useState<HTMLDivElement | null>(null)
  // chatParkingNode:一律存在、不可見的備援投影目標——瀏覽「行程列表」
  // 分頁選新行程期間(見下方 effectiveMainMode 的說明),主顯示區跟抽屜欄
  // 可能同時都沒有 chatElement 該投影的容器,這時投進這裡「暫放」,避免
  // createPortal 因為找不到容器而讓 chatElement 整個從輸出樹消失(等同
  // 解除掛載,會導致 WebSocket 重新連線)。
  const [chatParkingNode, setChatParkingNode] = useState<HTMLDivElement | null>(null)

  // 主顯示區右滑開啟抽屜欄:只在觸控起點落在螢幕左邊緣一小段範圍內
  // (EDGE_ZONE_PX)才開始追蹤,不是整個主顯示區域都能滑——主顯示區裡有
  // 地圖(PaceRouteMap 需要自己的平移/縮放手勢)、訊息列表(ChatScreen 需要
  // 垂直捲動)等本來就有手勢需求的內容,若整片區域都能觸發開抽屜,會跟這些
  // 既有互動打架。只偵測「是否滑過門檻」就直接開啟,不做即時跟手的拖曳
  // 位移(那需要把這裡的手勢狀態跟 PhoneNavDrawer.tsx 自己的關閉拖曳狀態
  // 合併管理,複雜度不成比例)——開啟當下靠 PhoneNavDrawer 面板本身的
  // CSS transition 播放滑入動畫,體感依然順暢。
  const EDGE_ZONE_PX = 24
  const SWIPE_OPEN_THRESHOLD_PX = 60
  const edgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const onMainTouchStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0]
    edgeSwipeStartRef.current = touch.clientX <= EDGE_ZONE_PX ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onMainTouchMove = (e: ReactTouchEvent) => {
    const start = edgeSwipeStartRef.current
    if (!start) return
    const touch = e.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    // 垂直位移大於水平位移時判定使用者其實是想捲動(訊息列表/檢查站清單
    // 等),放棄這次手勢,交還給底下元件本來的捲動行為。
    if (Math.abs(dy) > Math.abs(dx)) {
      edgeSwipeStartRef.current = null
      return
    }
    if (dx >= SWIPE_OPEN_THRESHOLD_PX) {
      setDrawerOpen(true)
      edgeSwipeStartRef.current = null
    }
  }
  const onMainTouchEnd = () => {
    edgeSwipeStartRef.current = null
  }

  if (props.isGuest) {
    return (
      <LoginCard title="歡迎使用 Tripace" subtitle="請先登入或註冊帳號,才能查看與使用行程功能。">
        <LoginForm baseURL={cfg.baseURL} onAuthed={props.onAuthed} pill />
      </LoginCard>
    )
  }

  if (isDesktop) {
    return <DesktopContent {...props} />
  }

  // effectiveMainMode:主顯示區實際要顯示什麼——drawerMode 的 'trips' 值
  // 只出現在還沒選過任何內容分頁的預設狀態(URL fallback,見上方說明),
  // 這裡沿用 lastContentMode(若有)取代它,行為跟原本一致:剛進 App 或
  // 開獨立行程抽屜挑選行程期間,主顯示區不會因為 drawerMode 暫時落在
  // 'trips' 這個預設值就閃一下換成空白畫面又換回來。
  const effectiveMainMode: DrawerMode =
    drawerMode === 'trips' && lastContentMode ? lastContentMode : drawerMode
  // chatElement:ChatScreen 的唯一掛載點,固定用同一個 JSX 呼叫(不因
  // drawerMode 改變而換成不同的條件式),只透過下方 createPortal 決定它的
  // 畫面實際投影到哪個容器——這樣切換 'timeline' 分頁前後,React 對這個
  // 元件的認定都是「同一個 portal 底下的同一個 child」,不會判定成解除掛載
  // 又重新掛載一個新的 ChatScreen。
  const chatElement = activeTrip && (
    <ChatScreen
      cfg={cfg}
      trip={activeTrip}
      user={props.user}
      onBack={() => setActiveTrip(null)}
      onOpenDrawer={() => setDrawerOpen(true)}
      mobileHeader={effectiveMainMode === 'timeline' ? 'drawer' : 'main'}
      onTimelineData={onTimelineData}
    />
  )
  // chatPortalTarget:對話實際投影到哪個容器,見 effectiveMainMode 的理由。
  // chatParkingNode 是一個一律存在、只是不可見的備援掛載點——沒有它,轉場
  // 瞬間 chatElement 可能因為 createPortal 找不到容器而整個從輸出樹消失,
  // 等同解除掛載,WebSocket 重新連線。
  const chatPortalTarget =
    effectiveMainMode === 'timeline'
      ? (timelineSlotNode ?? chatParkingNode)
      : (mainChatSlotNode ?? chatParkingNode)

  return (
    <>
      {/* 主顯示區容器:承接左邊緣右滑開啟抽屜欄的手勢(見上方
          onMainTouchStart 等的說明),包住主顯示內容共用同一個手勢偵測
          範圍。flex 屬性延續原本 .web-app 直接排列這些內容時的版面
          (撐滿剩餘高度、內部再各自 flex column 排 navbar/內容/輸入列)。 */}
      <div
        className={styles.mainArea}
        onTouchStart={onMainTouchStart}
        onTouchMove={onMainTouchMove}
        onTouchEnd={onMainTouchEnd}
      >
        {effectiveMainMode === 'pace' ? (
          // 配速表分頁:主顯示區改成地圖(對齊桌面版 .desktop-main 在
          // panelMode === 'pace' 時顯示 PaceRouteMap 的邏輯),檢查站清單留在
          // 抽屜欄裡(見下方 PhoneNavDrawer 的 mode === 'pace' 分支)。標題
          // 顯示目前行程名稱(不是「配速表」這個畫面名稱本身,配速表已經是
          // 這個畫面唯一的內容,不需要再重複標示)。
          <>
            <MainNavBar
              onOpenDrawer={() => setDrawerOpen(true)}
              mode={effectiveMainMode}
              onSelectMode={setDrawerMode}
              activeTrip={activeTrip}
              title={activeTrip?.name ?? 'Tripace'}
            />
            <PaceRouteMap
              checkpoints={paceCheckpoints}
              selectedEntry={selectedEntry}
              onSelectedEntryDone={() => setSelectedEntry(null)}
              onEntrySaved={setSavedEntry}
            />
          </>
        ) : effectiveMainMode === 'timeline' ? (
          // 時間軸分頁:對調後時間軸改滿版顯示在主顯示區,對話(chatElement)
          // 改投影進抽屜欄(見下方 PhoneNavDrawer 的 timelineSlotRef)。用
          // effectiveMainMode(而非 drawerMode)判斷,瀏覽行程列表分頁選新
          // 行程期間主顯示區才不會閃一下切走又切回來(見上方說明)。
          <TimelineMainView
            cfg={cfg}
            activeTrip={activeTrip}
            user={props.user}
            timelineMirror={timelineMirror}
            drawerMode={effectiveMainMode}
            onSelectMode={setDrawerMode}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        ) : activeTrip ? (
          // 對話顯示在主顯示區:navbar 統一由這裡渲染(左上角開抽屜按鈕、
          // 時間軸/路徑切換、標題、ChatScreen 自己 navbar 右側按鈕的投影
          // 目標),ChatScreen 本身不再畫這段(見 ChatScreen.tsx 的
          // mobileHeader==='main')。下方 .chatSlot 是內容區(訊息列表/
          // 輸入列)的 portal 投影目標,見上方 chatElement/chatPortalTarget
          // 的說明。這裡的 mode 傳 'trips'(既非 timeline 也非
          // pace)——對話狀態本身不對應任何一顆時間軸/路徑圖示,兩顆都該
          // 顯示未選中。
          <>
            <MainNavBar
              onOpenDrawer={() => setDrawerOpen(true)}
              mode="trips"
              onSelectMode={setDrawerMode}
              activeTrip={activeTrip}
              title={activeTrip.name}
            />
            <div ref={setMainChatSlotNode} className={styles.chatSlot} />
          </>
        ) : (
          <PhoneEmptyState
            onOpenDrawer={() => setTripsDrawerOpen(true)}
            onSelectMode={setDrawerMode}
          />
        )}
      </div>
      {/* chatParking:一律掛載、不可見的備援投影目標,見上方 chatParkingNode
          的說明。 */}
      <div ref={setChatParkingNode} style={{ display: 'none' }} />
      {chatElement && chatPortalTarget && createPortal(chatElement, chatPortalTarget)}
      <PhoneNavDrawer
        open={drawerOpen}
        cfg={cfg}
        mode={drawerMode}
        onSelectMode={setDrawerMode}
        activeTrip={activeTrip}
        timelineSlotRef={setTimelineSlotNode}
        lastContentMode={lastContentMode}
        onSelectedEntry={setSelectedEntry}
        onRouteChange={setPaceCheckpoints}
        savedEntry={savedEntry}
        tripsDrawerOpen={tripsDrawerOpen}
        onOpenTrips={onOpenTrips}
        user={props.user}
        onOpenSettings={() => setInSettings(true)}
        onOpenShare={() => setInShare(true)}
        onClose={() => setDrawerOpen(false)}
      />
      {/* 行程列表獨立抽屜:疊在 PhoneNavDrawer 之上(見
          PhoneTripsDrawer.module.css 的 z-index),由上方分頁列的「行程」
          觸發鈕開關(onOpenTrips),不是 PhoneNavDrawer 自己 mode 的一部分
          ——見檔案開頭的說明。 */}
      <PhoneTripsDrawer
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
        onClose={() => setTripsDrawerOpen(false)}
      />
      {/* 設定頁:一律掛載,只切換 transform(translateY)——理由同抽屜欄的
          open prop 設計(見 PhoneNavDrawer.tsx 開頭說明),唯有元件全程留在
          DOM 上,CSS transition 才能在開/關切換的當下播放滑入/滑出動畫。
          從底部滑入(對齊使用者要求的「設定由下方往上滑出」),關閉時滑回
          底部(「關閉由上往下滑」——即這個面板本身往下滑回螢幕外,不是另一個
          方向的動畫)。 */}
      <div
        className={styles.settingsPanel}
        style={{ transform: inSettings ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <SettingsScreen
          cfg={props.cfg}
          user={props.user}
          email={props.email}
          isGuest={props.isGuest}
          onAuthed={props.onAuthed}
          onLogout={() => { props.onLogout(); setInSettings(false) }}
          onBack={() => setInSettings(false)}
        />
      </div>
      {/* 分享面板:一律掛載,只切換 transform(translateY)——同一套「從底部
          滿版滑入/滑出」模式,理由同上方 .settingsPanel 的說明。只在
          activeTrip 存在時渲染 ShareModal(分享操作的對象是目前選取的
          行程,見 PhoneNavDrawer.tsx 分享按鈕只在 activeTrip 存在時才
          顯示的邏輯,這裡對稱處理)。 */}
      {activeTrip && (
        <div
          className={styles.sharePanel}
          style={{ transform: inShare ? 'translateY(0)' : 'translateY(100%)' }}
        >
          <ShareModal
            cfg={cfg}
            trip={activeTrip}
            isOwner={activeTrip.ownerID === props.user.id}
            onClose={() => setInShare(false)}
          />
        </div>
      )}
    </>
  )
}

// MainNavBar:主顯示區統一的上方列,四種狀態(配速表/時間軸/對話/空狀態)
// 共用同一份——左上角開抽屜按鈕,中間是時間軸/路徑這兩顆內容分頁的切換
// 圖示(原本在 PhoneNavDrawer 抽屜欄的分頁列,使用者要求搬到主顯示區上方
// 列,不必先開抽屜才能切換),標題(對話顯示行程名稱,其餘顯示畫面名稱)。
// 分享/成員/使用者頭像已經搬到 PhoneNavDrawer 抽屜欄分頁列右上角(永遠
// 顯示,不受這裡切換分頁影響,見該檔案的說明),這裡右側只留一個等寬的
// 空白佔位,讓標題維持視覺置中,不因為左右不對稱而偏移。
function MainNavBar({
  onOpenDrawer,
  mode,
  onSelectMode,
  activeTrip,
  title,
}: {
  onOpenDrawer: () => void
  mode: DrawerMode
  onSelectMode: (mode: DrawerMode) => void
  activeTrip: Trip | null
  title: string
}) {
  return (
    <div className="navbar">
      <button className="btn icon-btn" onClick={onOpenDrawer} title="行程列表">
        <AlignLeft size={20} strokeWidth={1.8} />
      </button>
      <div style={{ display: 'flex', gap: 2 }}>
        <button
          type="button"
          className={mode === 'timeline' ? 'btn icon-btn active' : 'btn icon-btn'}
          onClick={() => onSelectMode('timeline')}
          disabled={!activeTrip}
          title={activeTrip ? '時間軸' : '請先選擇一個行程'}
        >
          <Timeline size={20} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={mode === 'pace' ? 'btn icon-btn active' : 'btn icon-btn'}
          onClick={() => onSelectMode('pace')}
          title="路徑"
        >
          <Route size={20} strokeWidth={1.8} />
        </button>
      </div>
      <span className="title">{title}</span>
      <span style={{ width: 36 }} />
    </div>
  )
}

// PhoneEmptyState:抽屜關閉且尚未選擇任何行程時,主要內容區顯示的提示畫面
// ——對應桌面版 DesktopLayout.tsx 的 .desktop-empty-state「選擇一個行程
// 開始」。
function PhoneEmptyState({
  onOpenDrawer,
  onSelectMode,
}: {
  onOpenDrawer: () => void
  onSelectMode: (mode: DrawerMode) => void
}) {
  return (
    <>
      <MainNavBar
        onOpenDrawer={onOpenDrawer}
        mode="trips"
        onSelectMode={onSelectMode}
        activeTrip={null}
        title="Tripace"
      />
      <div className="screen-body">
        <div className="empty">選擇一個行程開始</div>
      </div>
    </>
  )
}

// TimelineMainView:時間軸滿版顯示在主顯示區的內容(對調後對話改進抽屜欄,
// 見 PhoneContent 的說明)。對齊桌面版 DesktopContent 的
// panelMode === 'timeline' 分支(同樣的兩層空狀態判斷、cfg 依 owner 身分
// 決定是否可編輯)——原本是抽屜欄自己的分頁內容(PhoneNavDrawer.tsx 的
// TimelineTabContent),對調後搬來這裡,改用跟其他主顯示畫面共用的
// MainNavBar(左上角展開抽屜欄按鈕+時間軸/路徑切換)。todayRef/捲到今天的
// 邏輯搬自原本 ChatScreen.tsx 的右側時間軸抽屜(該機制已移除)。
function TimelineMainView({
  cfg,
  activeTrip,
  user,
  timelineMirror,
  drawerMode,
  onSelectMode,
  onOpenDrawer,
}: {
  cfg: ClientConfig
  activeTrip: Trip | null
  user: User
  timelineMirror: DesktopTimelineMirror
  drawerMode: DrawerMode
  onSelectMode: (mode: DrawerMode) => void
  onOpenDrawer: () => void
}) {
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (timelineMirror.entries.length > 0 && todayRef.current && bodyRef.current) {
      const el = todayRef.current
      const body = bodyRef.current
      body.scrollTo({ top: el.offsetTop - 60, behavior: 'instant' })
    }
  }, [timelineMirror.entries])

  return (
    <>
      <MainNavBar
        onOpenDrawer={onOpenDrawer}
        mode={drawerMode}
        onSelectMode={onSelectMode}
        activeTrip={activeTrip}
        title={activeTrip?.name ?? '時間軸'}
      />
      {!activeTrip ? (
        <div className="screen-body">
          <div className="empty">選擇一個行程後顯示時間軸。</div>
        </div>
      ) : timelineMirror.entries.length === 0 ? (
        <div className="screen-body">
          <div className="empty">尚無行程內容。</div>
        </div>
      ) : (
        <div className="screen-body" ref={bodyRef}>
          <MultiTrackTimeline
            entries={timelineMirror.entries}
            todayRef={todayRef}
            updatingIDs={timelineMirror.updatingEntryIDs}
            taskPlaceholders={timelineMirror.taskPlaceholders}
            cfg={activeTrip.ownerID === user.id ? cfg : undefined}
            onEntryUpdated={timelineMirror.refetchEntries}
          />
        </div>
      )}
    </>
  )
}
