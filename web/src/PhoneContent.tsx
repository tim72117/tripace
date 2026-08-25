import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { Timeline, Route, Layers, Radio } from 'lucide-react'
import { ChatScreen, type DesktopTimelineMirror } from './chat/ChatScreen'
import { type ContentProps } from './AppCommon'
import { useIsDesktop } from './hooks/useIsDesktop'
import { useTripsState } from './hooks/useTripsState'
import { LoginForm, LoginCard } from './home/LoginForm'
import {
  isPanelMode, type DrawerMode, TIMELINE_ENABLED, GEO_OUTLINE_ENABLED, PACE_ENABLED,
  DEMO_ONAGENT_ENABLED,
} from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { SettingsScreen } from './user/SettingsScreen'
import { TripManageModal } from './trip/TripManageModal'
import { PaceRouteMap, type SelectedEntry } from './pace/PaceRouteMap'
import type { Checkpoint } from './pace/PaceChart'
import { GeoOutlinePhoneView } from './geo-planning/GeoOutlinePhoneView'
import { PhoneTripsDrawer } from './trip/PhoneTripsDrawer'
import { PhoneTimelineDrawer } from './timeline/PhoneTimelineDrawer'
import { PhoneTabBar } from './PhoneTabBar'
import { PhoneSideTools } from './PhoneSideTools'
import type { Trip } from './trip/types'
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
// 導轉/聊天室/設定,見 App.tsx App() 的 /app 路由分支。
// 導覽:底部常駐 PhoneTabBar.tsx(行程/時間軸/規劃)+ 右側小圖示
// PhoneSideTools.tsx(路徑/demo-*),不需要先開抽屜才看得到分頁——取代
// 原本各自獨立的整頁 TripsScreen、ChatScreen 自己的右側時間軸抽屜,與
// PhoneNavDrawer 側滑抽屜的分頁列。行程列表獨立成 PhoneTripsDrawer 抽屜
// (由底部列「行程」按鈕開關),分享/成員/開啟時自動進入合併成
// TripManageModal,入口在該抽屜每筆行程項目的「管理」按鈕,對齊桌面版
// DesktopTripList.tsx 的 onManage 心智模型。
//
// 主顯示區:選到的分頁是 'pace' 時顯示 PaceRouteMap(地圖),'geo-outline'
// 顯示規劃地圖,其餘情況顯示 ChatScreen(有選行程)或空白提示(沒有)
// ——'trips'/'timeline' 分頁不影響主顯示。桌面版 DesktopContent 已改版
// (見該檔案的說明:主顯示固定是規劃地圖,pace/trips/timeline/geo-outline
// 全部改成疊加在地圖上的浮動卡片),手機版這裡刻意不比照,維持原本
// 「分頁決定主顯示內容」的版型。
export function PhoneContent(props: ContentProps) {
  const { cfg, activeTrip, setActiveTrip } = props
  const [inSettings, setInSettings] = useState(false)
  // manageTrip:行程管理彈窗(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)——對齊桌面版 DesktopLayout.tsx 的同名 state,
  // 原本手機版這幾個功能散落在 PhoneNavDrawer 抽屜(已隨底部常駐導覽列
  // 拿掉),現在跟桌面版一樣統一收到行程列表每一筆項目的「管理」按鈕
  // (見 PhoneTripsDrawer.tsx 的 onManage)。
  const [manageTrip, setManageTrip] = useState<Trip | null>(null)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有行程/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // tripsDrawerOpen:行程列表獨立抽屜(PhoneTripsDrawer.tsx)開關——預設
  // 收合,使用者需要選行程時自行點底部「行程」按鈕開啟,不再進 App 就
  // 強制彈出。原本還有 drawerOpen 控制 PhoneNavDrawer(分享/成員/頭像
  // 精簡版抽屜),隨分享/成員對齊桌面版搬到行程項目、頭像改直接開設定,
  // 這個抽屜已無存在必要,整組移除(不再有任何畫面殘留「開抽屜」入口)。
  const [tripsDrawerOpen, setTripsDrawerOpen] = useState(false)
  // timelineDrawerOpen:時間軸 bottom sheet(timeline/PhoneTimelineDrawer.tsx)
  // 開關——由規劃地圖左下角「時間軸」按鈕觸發(見下方 GeoOutlinePhoneView
  // 的 onOpenTimeline),不經過 drawerMode/navigate,純粹是這個元件內部
  // 的疊加狀態(使用者要求「時間軸不用獨立路由」)。
  const [timelineDrawerOpen, setTimelineDrawerOpen] = useState(false)
  // drawerMode:改用路徑參數驅動,跟桌面版 DesktopContent 的 panelMode 共用
  // 同一個 /app/:panelMode 路由——理由與既有設計相同,使用者縮放視窗跨越
  // 桌面/手機斷點時網址不必跳轉、狀態自然延續。網址沒帶 panelMode 或帶了
  // 不合法字串時,fallback 成 'geo-outline'——規劃地圖是進 App 後的預設
  // 起始畫面(不需要先選行程就能瀏覽,見 GeoOutlinePhoneView.tsx),取代
  // 原本 fallback 到 'trips'(尚未選取內容分頁的中性狀態,會落到
  // PhoneEmptyState 空白提示或自動彈出行程列表抽屜)的既有行為。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  // demo-route-editor(路徑編輯器試做)只有桌面版才有實作,手機版
  // PhoneNavDrawer 的 DrawerMode 型別故意不含它——網址剛好停在
  // /app/demo-route-editor 時 fallback 回 'geo-outline'(理由同其餘不合法
  // 字串的 fallback),避免型別不符,也讓使用者落地到一個看得懂的畫面。
  const drawerMode: DrawerMode =
    isPanelMode(panelModeParam) && panelModeParam !== 'demo-route-editor'
      ? panelModeParam
      : 'geo-outline'
  const navigate = useNavigate()
  // lastContentMode:記住使用者上一次主動選取的「配速表」分頁——時間軸
  // 已不再是這個值的一員(改成規劃地圖專屬的 bottom sheet,見
  // timeline/PhoneTimelineDrawer.tsx,不經過 drawerMode 導航)。開啟獨立
  // 行程抽屜選新行程時,這個值仍保留原值不變,驅動 PhoneTabBar 讓對應圖示
  // 繼續顯示 active(使用者觀點:行程列表只是暫時借用的工具畫面,不是真的
  // 離開了配速表這個內容模式);選完行程後這個值只用於 effectiveMainMode
  // fallback(見下方),不再驅動任何自動導航。用 state(而非 ref)是因為
  // 需要驅動 UI(tab 的 active 樣式),不能只是純暫存值。
  const [lastContentMode, setLastContentMode] = useState<'pace' | null>(null)
  // setDrawerMode:底部常駐列/右側小圖示常駐顯示,沒有「收合」的概念——
  // 再點一次目前已選中的分頁是 no-op。
  const setDrawerMode = (mode: DrawerMode) => {
    if (mode === drawerMode) return
    if (mode === 'pace') {
      setLastContentMode(mode)
    }
    navigate(`/app/${mode}`)
  }
  // onOpenTrips:底部常駐列「行程」按鈕——開啟獨立的行程抽屜
  // (PhoneTripsDrawer.tsx),已開啟時再點一次視為收合(toggle)。
  const onOpenTrips = () => {
    setTripsDrawerOpen((v) => !v)
  }
  // selectTrip:切換使用中的行程,並關閉獨立行程抽屜——不再自動跳轉到
  // lastContentMode(時間軸/路徑),使用者要求「選擇旅程後不用跳轉到
  // 時間軸」。時間軸/路徑現在都是規劃地圖畫面專屬的入口(見
  // GeoOutlinePhoneView.tsx 的 onOpenTimeline/onOpenPace),選行程後
  // 留在使用者原本所在的畫面即可,不需要強制帶去別的內容模式。
  const selectTrip = (t: Trip) => {
    setActiveTrip(t)
    setTripsDrawerOpen(false)
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
  // paceCheckpoints:'pace' 分頁(PaceChart)目前選取的那一段 checkpoint
  // 清單,透過 onRouteChange 鏡像過來,轉傳給主顯示區的 PaceRouteMap(地圖)
  // ——同一套模式比照桌面版 DesktopLayout.tsx。PaceChart 目前還沒接回
  // PhoneFloatCard(下一步),setPaceCheckpoints 暫時沒有呼叫端,底線前綴
  // 避免 noUnusedLocals 報錯,paceCheckpoints 本身仍被 PaceRouteMap 讀取。
  const [paceCheckpoints, _setPaceCheckpoints] = useState<Checkpoint[]>([])
  // savedEntry:PaceRouteMap 手動拖曳選點、儲存座標成功後回報的結果,轉傳給
  // PaceChart 讓它就地更新自己的 checkpointsBySegment(見 PaceChart.tsx 的
  // savedEntry prop 說明)——同一套模式比照桌面版 DesktopLayout.tsx。
  // PaceChart 目前還沒接回 PhoneFloatCard(下一步),savedEntry 暫時沒有
  // 讀取端,底線前綴避免 noUnusedLocals 報錯,setSavedEntry 仍被
  // PaceRouteMap 的 onEntrySaved 呼叫。
  const [_savedEntry, setSavedEntry] = useState<{ id: string; lat: number; lng: number } | null>(null)

  // ChatScreen 只在這裡掛載「一次」(下方 chatElement),不會因為
  // drawerMode 切換而重新掛載/重新連線 WebSocket——用 React Portal 把它的
  // 畫面投影到主顯示區的容器。時間軸原本是另一個投影目標(timelineSlotNode,
  // 對話與時間軸顯示位置對調),已隨「時間軸不用獨立路由」(改成規劃地圖
  // 專屬的 bottom sheet,見 timeline/PhoneTimelineDrawer.tsx)拿掉——時間軸
  // sheet 只顯示 timelineMirror 唯讀清單,不含 ChatScreen 的對話輸入列,
  // 不需要再投影對話畫面進去。mainChatSlotNode 用 state(而非 ref)是因為
  // 節點掛載的時機在 effect 之後,需要能觸發重新渲染才能讓 portal 抓到剛
  // 掛載好的節點。
  const [mainChatSlotNode, setMainChatSlotNode] = useState<HTMLDivElement | null>(null)
  // chatParkingNode:一律存在、不可見的備援投影目標——瀏覽「行程列表」
  // 分頁選新行程期間(見下方 effectiveMainMode 的說明),主顯示區可能還
  // 沒有 chatElement 該投影的容器,這時投進這裡「暫放」,避免 createPortal
  // 因為找不到容器而讓 chatElement 整個從輸出樹消失(等同解除掛載,會導致
  // WebSocket 重新連線)。
  const [chatParkingNode, setChatParkingNode] = useState<HTMLDivElement | null>(null)

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
  // 不再是 URL fallback 的預設狀態(見上方說明,預設已改成 'geo-outline'),
  // 只會在使用者手動打 /app/trips 網址時出現;這裡沿用 lastContentMode
  // (若有)取代它,維持原本的既有行為(不會因為 drawerMode 落在 'trips'
  // 就閃一下換成空白畫面又換回來),不強行拿掉這條邏輯。
  // 'timeline' 併入 'geo-outline'——時間軸不再是獨立的主畫面模式(見上方
  // mainChatSlotNode 的說明),手動打 /app/timeline 網址(或舊書籤)時退回
  // 規劃地圖,不再有專屬渲染分支;真正開啟時間軸內容改用下方
  // timelineDrawerOpen 這個獨立 state(見 PhoneTimelineDrawer 渲染處)。
  const effectiveMainMode: DrawerMode =
    drawerMode === 'trips' && lastContentMode
      ? lastContentMode
      : drawerMode === 'timeline'
        ? 'geo-outline'
        : drawerMode
  // bottomTabs/sideTools:底部常駐列(PhoneTabBar.tsx)/右側小圖示群組
  // (PhoneSideTools.tsx)各自的項目清單,依 feature flag 組出——理由同
  // 原本 PhoneNavDrawer.tsx 的 items 陣列(現已拆分)。目前階段兩者都還是
  // 呼叫既有的 setDrawerMode/onOpenTrips,行為對齊改版前,只是按鈕位置
  // 換了容器,尚未接上底部列常駐後「再點同一分頁 no-op」與浮動卡片的
  // 後續調整。
  // disabled 不再依 activeTrip 鎖死「時間軸」分頁——使用者要求底部三顆
  // 分頁都要可以點擊,未選行程時點進時間軸由畫面本身顯示空狀態引導選
  // 行程(見下方 chatElement 的 !activeTrip 分支),不在按鈕層級就整個
  // 灰掉不能點。
  // bottomTabs:不再含「時間軸」——使用者要求「時間軸放左側」,改成規劃
  // 地圖(GeoOutlinePhoneView)專屬的 onOpenTimeline prop(見下方該元件
  // 呼叫處),不再是跨畫面常駐的底部列項目;其他主畫面(配速表/對話)
  // 因此不再有直接切到時間軸的入口,已與使用者確認可接受。
  const bottomTabs: { mode: DrawerMode; icon: typeof Timeline; title: string }[] = [
    ...(GEO_OUTLINE_ENABLED ? [{ mode: 'geo-outline' as DrawerMode, icon: Layers, title: '規劃' }] : []),
  ]
  const sideTools: { mode: DrawerMode; icon: typeof Route; title: string }[] = [
    ...(PACE_ENABLED ? [{ mode: 'pace' as DrawerMode, icon: Route, title: '路徑' }] : []),
    ...(DEMO_ONAGENT_ENABLED ? [{ mode: 'demo-onagent' as DrawerMode, icon: Radio, title: 'onagent 串接' }] : []),
  ]
  // chatElement:ChatScreen 的唯一掛載點,固定用同一個 JSX 呼叫(不因
  // drawerMode 改變而換成不同的條件式),只透過下方 createPortal 決定它的
  // 畫面實際投影到哪個容器——mobileHeader 固定 'main'(時間軸不再是另一個
  // 投影目標,見上方 mainChatSlotNode 的說明,ChatScreen 永遠顯示主畫面
  // header)。
  const chatElement = activeTrip && (
    <ChatScreen
      cfg={cfg}
      trip={activeTrip}
      user={props.user}
      onBack={() => setActiveTrip(null)}
      mobileHeader="main"
      onTimelineData={onTimelineData}
    />
  )
  // chatPortalTarget:chatParkingNode 是一個一律存在、只是不可見的備援
  // 掛載點——沒有它,轉場瞬間 chatElement 可能因為 createPortal 找不到
  // 容器而整個從輸出樹消失,等同解除掛載,WebSocket 重新連線。
  const chatPortalTarget = mainChatSlotNode ?? chatParkingNode

  return (
    <>
      {/* 主顯示區容器:flex 屬性延續原本 .web-app 直接排列這些內容時的
          版面(撐滿剩餘高度、內部再各自 flex column 排 navbar/內容/
          輸入列)。 */}
      <div className={styles.mainArea}>
        {effectiveMainMode === 'geo-outline' ? (
          // 規劃地圖分頁:不渲染 MainNavBar,搜尋框/使用者頭像/候選籃
          // 按鈕改由 GeoOutlinePhoneView 自己疊在地圖上方。activeTrip
          // 供候選籃「加入 {tripName}」按鈕文字使用。
          <GeoOutlinePhoneView
            cfg={cfg}
            tripID={activeTrip?.id ?? null}
            activeTrip={activeTrip}
            user={props.user}
            onOpenSettings={() => setInSettings(true)}
            onOpenTimeline={TIMELINE_ENABLED ? () => setTimelineDrawerOpen(true) : undefined}
            onOpenTrips={() => setTripsDrawerOpen(true)}
          />
        ) : effectiveMainMode === 'pace' ? (
          // 配速表分頁:主顯示區改成地圖(對齊桌面版 .desktop-main 在
          // panelMode === 'pace' 時顯示 PaceRouteMap 的邏輯)。標題顯示
          // 目前行程名稱(不是「配速表」這個畫面名稱本身,配速表已經是
          // 這個畫面唯一的內容,不需要再重複標示)。
          <>
            <MainNavBar
              mode={effectiveMainMode}
              onSelectMode={setDrawerMode}
              onOpenTimeline={() => setTimelineDrawerOpen(true)}
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
        ) : activeTrip ? (
          // 對話顯示在主顯示區:navbar 統一由這裡渲染(時間軸/路徑切換、
          // 標題、ChatScreen 自己 navbar 右側按鈕的投影目標),ChatScreen
          // 本身不再畫這段(見 ChatScreen.tsx 的 mobileHeader==='main')。
          // 下方 .chatSlot 是內容區(訊息列表/輸入列)的 portal 投影目標,
          // 見上方 chatElement/chatPortalTarget 的說明。這裡的 mode 傳
          // 'trips'(既非 timeline 也非 pace)——對話狀態本身不對應任何
          // 一顆時間軸/路徑圖示,兩顆都該顯示未選中。
          <>
            <MainNavBar
              mode="trips"
              onSelectMode={setDrawerMode}
              onOpenTimeline={() => setTimelineDrawerOpen(true)}
              activeTrip={activeTrip}
              title={activeTrip.name}
            />
            <div ref={setMainChatSlotNode} className={styles.chatSlot} />
          </>
        ) : (
          <PhoneEmptyState
            onOpenTrips={() => setTripsDrawerOpen(true)}
            onSelectMode={setDrawerMode}
            onOpenTimeline={() => setTimelineDrawerOpen(true)}
          />
        )}
        {/* PhoneSideTools:右側下方路徑+demo-* 小圖示,跨所有主畫面模式
            共用(不是規劃地圖專屬),見該元件開頭說明。 */}
        <PhoneSideTools tools={sideTools} onSelect={setDrawerMode} />
        {/* PhoneTabBar:底部常駐導覽列(行程/規劃),取代原本要開
            PhoneNavDrawer 抽屜才看得到的分頁列,見該元件開頭說明。 */}
        <PhoneTabBar
          tabs={bottomTabs}
          mode={drawerMode}
          lastContentMode={lastContentMode}
          tripsDrawerOpen={tripsDrawerOpen}
          onOpenTrips={onOpenTrips}
          onSelectMode={setDrawerMode}
        />
        {/* 行程列表獨立抽屜,由底部常駐列的「行程」按鈕開關(onOpenTrips)。
            onManage 對齊桌面版 DesktopTripList.tsx,開啟合併後的
            TripManageModal(分享連結/成員/開啟時自動進入),見下方渲染。
            渲染在 .mainArea 內部(跟 PhoneTabBar 同一層,而非它的
            sibling)——PhoneTripsDrawer 的 .panel/.backdrop 用
            position: absolute 定位到「貼齊 PhoneTabBar 上緣」(bottom:
            calc(52px + safe-area)),定位基準要跟 PhoneTabBar 同一個
            position: relative 祖先(.mainArea 本身),放在外面會找到
            錯的祖先容器計算高度,導致視覺上蓋住 PhoneTabBar(使用者
            回報「功能列被遮住了」的根因)。 */}
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
          onManage={setManageTrip}
          onClose={() => setTripsDrawerOpen(false)}
        />
        {/* 時間軸 bottom sheet,由規劃地圖左下角「時間軸」按鈕開關
            (timelineDrawerOpen,見上方說明)——同樣渲染在 .mainArea 內部、
            跟 PhoneTabBar 同一層,理由同上方 PhoneTripsDrawer 的說明
            (定位基準要一致,才不會蓋住底部功能列)。timelineMirror 是
            ChatScreen 透過 onTimelineData 鏡像過來的資料,不論目前主畫面
            顯示什麼都持續更新(mainChatSlotNode 是 ChatScreen 唯一的投影
            目標,見上方說明)。 */}
        <PhoneTimelineDrawer
          open={timelineDrawerOpen}
          onClose={() => setTimelineDrawerOpen(false)}
          tripName={activeTrip?.name ?? '時間軸'}
          timelineMirror={timelineMirror}
          editCfg={activeTrip && activeTrip.ownerID === props.user.id ? cfg : undefined}
        />
      </div>
      {/* chatParking:一律掛載、不可見的備援投影目標,見上方 chatParkingNode
          的說明。 */}
      <div ref={setChatParkingNode} style={{ display: 'none' }} />
      {chatElement && chatPortalTarget && createPortal(chatElement, chatPortalTarget)}
      {/* 設定頁:一律掛載,只切換 transform(translateY)——唯有元件全程留在
          DOM 上,CSS transition 才能在開/關切換的當下播放滑入/滑出動畫。
          從底部滑入,關閉時滑回底部。 */}
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
      {/* manageTrip:行程管理彈窗,對齊桌面版 DesktopLayout.tsx 的同名
          渲染邏輯——用 base-ui.css 既有的 .rp-modal*(置中卡片彈窗骨架)
          包住,TripManageModal 本身用 .rp-modal-head/.rp-modal-body
          渲染內容(見該檔案的說明)。分享/成員/開啟時自動進入原本散落在
          PhoneNavDrawer 抽屜(已隨底部常駐導覽列拿掉),現在統一收到這裡,
          跟桌面版同一套心智模型。 */}
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

// MainNavBar:主顯示區統一的上方列,三種狀態(配速表/對話/空狀態)共用
// 同一份——中間是時間軸/路徑這兩顆入口圖示,時間軸點下去開啟
// timeline/PhoneTimelineDrawer.tsx 的 bottom sheet(onOpenTimeline,見下方
// 說明),路徑點下去仍是 onSelectMode('pace')切換主畫面(路徑還是獨立的
// drawerMode)。標題(對話顯示行程名稱,其餘顯示畫面名稱)。左側不再有
// 開抽屜按鈕(分頁列已改為底部常駐 PhoneTabBar.tsx,行程列表也是底部列
// 「行程」按鈕直接開,不需要再從這裡多一層入口),改留一個等寬空白佔位
// 跟右側對稱,讓標題維持視覺置中。
function MainNavBar({
  mode,
  onSelectMode,
  onOpenTimeline,
  activeTrip,
  title,
}: {
  mode: DrawerMode
  onSelectMode: (mode: DrawerMode) => void
  // onOpenTimeline:時間軸圖示觸發,開啟 timeline/PhoneTimelineDrawer.tsx
  // 的 bottom sheet——不再透過 onSelectMode('timeline')/navigate(時間軸
  // 已不是獨立的 drawerMode 主畫面模式,見 PhoneContent 上方 effectiveMainMode
  // 的說明),改由呼叫端(PhoneContent.tsx)直接傳入
  // () => setTimelineDrawerOpen(true)。
  onOpenTimeline: () => void
  activeTrip: Trip | null
  title: string
}) {
  return (
    <div className="navbar">
      <span style={{ width: 36 }} />
      <div style={{ display: 'flex', gap: 2 }}>
        <button
          type="button"
          className="btn icon-btn"
          onClick={onOpenTimeline}
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

// PhoneEmptyState:尚未選擇任何行程時,主要內容區顯示的提示畫面——對應
// 桌面版 DesktopLayout.tsx 的 .desktop-empty-state「選擇一個行程開始」。
function PhoneEmptyState({
  onOpenTrips,
  onSelectMode,
  onOpenTimeline,
}: {
  onOpenTrips: () => void
  onSelectMode: (mode: DrawerMode) => void
  onOpenTimeline: () => void
}) {
  return (
    <>
      <MainNavBar
        mode="trips"
        onSelectMode={onSelectMode}
        onOpenTimeline={onOpenTimeline}
        activeTrip={null}
        title="Tripace"
      />
      <div className="screen-body">
        <div className="empty">
          <button type="button" className="btn-primary" onClick={onOpenTrips}>
            選擇一個行程開始
          </button>
        </div>
      </div>
    </>
  )
}

