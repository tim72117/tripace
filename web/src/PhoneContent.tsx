import { useCallback, useEffect, useState } from 'react'
import { Route, Radio, MessageSquareText } from 'lucide-react'
import { ChatScreen, type DesktopTimelineMirror } from './chat/ChatScreen'
import { type ContentProps } from './AppCommon'
import { useIsDesktop } from './hooks/useIsDesktop'
import { useTripsState } from './hooks/useTripsState'
import { LoginForm, LoginCard } from './home/LoginForm'
import { TIMELINE_ENABLED, PACE_ENABLED, DEMO_ONAGENT_ENABLED } from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { SettingsScreen } from './user/SettingsScreen'
import { TripManageModal } from './trip/TripManageModal'
import { PaceRouteMap, type SelectedEntry } from './pace/PaceRouteMap'
import type { Checkpoint } from './pace/PaceChart'
import { GeoOutlinePhoneView } from './geo-planning/GeoOutlinePhoneView'
import { PhoneTripsDrawer } from './trip/PhoneTripsDrawer'
import { PhoneTimelineDrawer } from './timeline/PhoneTimelineDrawer'
import { PhoneBottomSheet, SheetHead } from './components/PhoneBottomSheet'
import { PhoneTabBar } from './PhoneTabBar'
import { PhoneSideTools } from './PhoneSideTools'
import type { Trip } from './trip/types'
import styles from './PhoneContent.module.css'

// 時間軸鏡像資料的初始值(尚未收到 ChatScreen 鏡像前,或未選擇旅程時使用)
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

// 設定頁 bottom sheet 面板頂部離定位祖先頂端的距離(px)——見
// components/PhoneBottomSheet.tsx 的說明,定位數值(bottom/z-index)見
// 下方 PhoneBottomSheet 呼叫處的說明。使用者已確認改成 60(跟對話/配速表
// 的 CHAT_SHEET_TOP 同一個展開高度)。
const SETTINGS_SHEET_TOP = 60
// 對話/配速表 bottom sheet 的離頂部距離(px)——比設定頁/地點清單更高
// (數值更小),理由見下方對話 PhoneBottomSheet 呼叫處的說明。
const CHAT_SHEET_TOP = 60
// CHAT_SHEET_MIN_HEIGHT:對話疊加層收合段的固定高度(px)——使用者明確
// 要求「對話也要可縮到最底」,比照地點清單/地點資訊卡,新增可拖曳收合到
// 只顯示標頭的最小段,不再只能整個滑出關閉。理由/算法見
// components/PhoneBottomSheet.tsx 的 minHeightPx 說明。配速表疊加層不
// 套用(維持單段,見下方 paceSheetOpen 的 PhoneBottomSheet 呼叫處)——
// 配速表是地圖類內容,收合成只剩標頭列的用途不大,使用者這次明確只提到
// 「對話」。
const CHAT_SHEET_MIN_HEIGHT = 100

// PhoneContent:手機版(寬度 < 768px)主要應用狀態切換器——登入畫面/桌面版
// 導轉/聊天室/設定,見 App.tsx App() 的 /app 路由分支。
// 導覽:底部常駐 PhoneTabBar.tsx(旅程/時間軸/規劃)+ 右側小圖示
// PhoneSideTools.tsx(路徑/demo-*),不需要先開抽屜才看得到分頁——取代
// 原本各自獨立的整頁 TripsScreen、ChatScreen 自己的右側時間軸抽屜,與
// PhoneNavDrawer 側滑抽屜的分頁列。旅程列表獨立成 PhoneTripsDrawer 抽屜
// (由底部列「旅程」按鈕開關),分享/成員/開啟時自動進入合併成
// TripManageModal,入口在該抽屜每筆旅程項目的「管理」按鈕,對齊桌面版
// DesktopTripList.tsx 的 onManage 心智模型。
//
// 主顯示區:選到的分頁是 'pace' 時顯示 PaceRouteMap(地圖),'geo-outline'
// 顯示規劃地圖,其餘情況顯示 ChatScreen(有選旅程)或空白提示(沒有)
// ——'trips'/'timeline' 分頁不影響主顯示。桌面版 DesktopContent 已改版
// (見該檔案的說明:主顯示固定是規劃地圖,pace/trips/timeline/geo-outline
// 全部改成疊加在地圖上的浮動卡片),手機版這裡刻意不比照,維持原本
// 「分頁決定主顯示內容」的版型。
export function PhoneContent(props: ContentProps) {
  const { cfg, activeTrip, setActiveTrip } = props
  const [inSettings, setInSettings] = useState(false)
  // manageTrip:旅程管理彈窗(分享連結/成員/開啟時自動進入,見
  // TripManageModal.tsx)——對齊桌面版 DesktopLayout.tsx 的同名 state,
  // 原本手機版這幾個功能散落在 PhoneNavDrawer 抽屜(已隨底部常駐導覽列
  // 拿掉),現在跟桌面版一樣統一收到旅程列表每一筆項目的「管理」按鈕
  // (見 PhoneTripsDrawer.tsx 的 onManage)。
  const [manageTrip, setManageTrip] = useState<Trip | null>(null)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有旅程/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // tripsDrawerOpen:旅程列表獨立抽屜(PhoneTripsDrawer.tsx)開關——預設
  // 收合,使用者需要選旅程時自行點底部「旅程」按鈕開啟,不再進 App 就
  // 強制彈出。原本還有 drawerOpen 控制 PhoneNavDrawer(分享/成員/頭像
  // 精簡版抽屜),隨分享/成員對齊桌面版搬到旅程項目、頭像改直接開設定,
  // 這個抽屜已無存在必要,整組移除(不再有任何畫面殘留「開抽屜」入口)。
  const [tripsDrawerOpen, setTripsDrawerOpen] = useState(false)
  // timelineDrawerOpen:時間軸 bottom sheet(timeline/PhoneTimelineDrawer.tsx)
  // 開關——由規劃地圖左下角「時間軸」按鈕觸發(見下方 GeoOutlinePhoneView
  // 的 onOpenTimeline),不經過路由導航,純粹是這個元件內部的疊加狀態
  // (使用者要求「時間軸不用獨立路由」)。
  const [timelineDrawerOpen, setTimelineDrawerOpen] = useState(false)
  // chatSheetOpen/paceSheetOpen:對話/配速表改成疊加層開關,同
  // timelineDrawerOpen 同一套模式——使用者明確要求「規劃地圖常駐為主
  // 畫面,對話/配速表都改成跟地點清單/設定頁一樣的 PhoneBottomSheet 疊加
  // 層」,不再是「分頁決定主顯示內容」的版型(舊版 drawerMode/
  // effectiveMainMode 整組邏輯隨這次調整移除,不再需要路徑參數驅動主畫面
  // 切換——規劃地圖是唯一常駐的主畫面,/app/:panelMode 這個路由現在只供
  // 桌面版使用,見 App.tsx)。
  const [chatSheetOpen, setChatSheetOpen] = useState(false)
  const [paceSheetOpen, setPaceSheetOpen] = useState(false)
  // chatSnapIndex:對話疊加層自己的吸附段落狀態——使用者明確要求「對話
  // 也要可縮到最底」,比照地點清單/地點資訊卡(GeoOutlinePhoneListDrawer.tsx/
  // GeoOutlinePhoneInfoSheet.tsx 的同名 state),索引 0 是收合段
  // (CHAT_SHEET_MIN_HEIGHT),索引 1 是展開段(CHAT_SHEET_TOP)。初始為
  // 展開,每次重新開啟都重設回展開,不延續上次被拖曳收合的狀態。
  const [chatSnapIndex, setChatSnapIndex] = useState(1)
  useEffect(() => {
    if (chatSheetOpen) setChatSnapIndex(1)
  }, [chatSheetOpen])
  // onOpenTrips:底部常駐列「旅程」按鈕——開啟獨立的旅程抽屜
  // (PhoneTripsDrawer.tsx),已開啟時再點一次視為收合(toggle)。
  const onOpenTrips = () => {
    setTripsDrawerOpen((v) => !v)
  }
  // selectTrip:切換使用中的旅程,並關閉獨立旅程抽屜——不自動跳轉到其他
  // 畫面,選完旅程後留在使用者原本所在的畫面(規劃地圖/對話/配速表疊加層)
  // 即可,不需要強制帶去別的內容模式。
  const selectTrip = (t: Trip) => {
    setActiveTrip(t)
    setTripsDrawerOpen(false)
  }

  // useTripsState 提升到這裡頂層常駐呼叫(不只在抽屜開啟時才掛載)——
  // 這個 hook 內建「若 localStorage 記錄過預設旅程,trips 載入後自動
  // onOpen() 跳進該旅程」的既有行為,必須從一開始就掛載才不會漏掉這個自動
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

  if (props.isGuest) {
    return (
      <LoginCard title="歡迎使用 Tripace" subtitle="請先登入或註冊帳號,才能查看與使用旅程功能。">
        <LoginForm baseURL={cfg.baseURL} onAuthed={props.onAuthed} pill />
      </LoginCard>
    )
  }

  if (isDesktop) {
    return <DesktopContent {...props} />
  }

  // bottomTabs/sideTools:底部常駐列(PhoneTabBar.tsx)/右側小圖示群組
  // (PhoneSideTools.tsx)各自的項目清單——每個項目自帶 onClick,直接開啟
  // 對應的疊加層(使用者明確要求「規劃地圖常駐為主畫面,對話/配速表都
  // 改成疊加層」,不再是切換分頁模式,見上方 chatSheetOpen/paceSheetOpen
  // 的說明)。
  const bottomTabs: { key: string; icon: typeof MessageSquareText; title: string; active: boolean; onClick: () => void }[] = [
    { key: 'chat', icon: MessageSquareText, title: '對話', active: chatSheetOpen, onClick: () => setChatSheetOpen(true) },
  ]
  const sideTools: { key: string; icon: typeof Route; title: string; onClick: () => void }[] = [
    ...(PACE_ENABLED ? [{ key: 'pace', icon: Route, title: '路徑', onClick: () => setPaceSheetOpen(true) }] : []),
    ...(DEMO_ONAGENT_ENABLED ? [{ key: 'demo-onagent', icon: Radio, title: 'onagent 串接', onClick: () => {} }] : []),
  ]
  // chatElement:ChatScreen 的唯一掛載點,固定用同一個 JSX 呼叫,直接放在
  // 下方對話疊加層 PhoneBottomSheet 的 children 裡(該元件傳
  // keepMounted,即使 chatSheetOpen 為 false 也不卸載,避免每次關閉對話
  // 都重新連線 WebSocket——理由與原本改用 React Portal 投影的目的相同,
  // 但不再需要 portal,見該處呼叫的說明)。
  //
  // trip 允許是 undefined(不要求 activeTrip 存在才渲染)——使用者明確
  // 要求「手機版的對話跟桌面版用一樣的」,對齊桌面版 DesktopLayout.tsx
  // 的 chat-popover 既有行為(ChatScreen 本身已經支援無 trip 也能對話,
  // 見該元件 trip prop 的說明):沒選旅程時依然能開啟對話,不需要先選/
  // 建立旅程。key 比照桌面版加上 activeTrip?.id ?? 'no-trip',確保「無
  // 旅程對話」跟「某個旅程的對話」是各自獨立的掛載週期,避免沿用前一個
  // 旅程殘留的 WebSocket/訊息 state。
  const chatElement = (
    <ChatScreen
      key={activeTrip?.id ?? 'no-trip'}
      cfg={cfg}
      trip={activeTrip ?? undefined}
      user={props.user}
      onBack={() => setActiveTrip(null)}
      mobileHeader="main"
      onTimelineData={onTimelineData}
      open={chatSheetOpen}
    />
  )

  return (
    <>
      {/* 主顯示區容器:flex 屬性延續原本 .web-app 直接排列這些內容時的
          版面(撐滿剩餘高度、內部再各自 flex column 排 navbar/內容/
          輸入列)。 */}
      <div className={styles.mainArea}>
        {/* 規劃地圖:唯一常駐的主畫面(使用者明確要求,見上方
            chatSheetOpen/paceSheetOpen 的說明),不再隨分頁切換卸載重掛
            ——理由同對齊桌面版 GeoOutlinePanel 永遠掛載的既有模式
            (DesktopLayout.tsx)。搜尋框/使用者頭像/候選籃按鈕由
            GeoOutlinePhoneView 自己疊在地圖上方。activeTrip 供候選籃
            「加入行程」判斷是否已選定旅程使用。 */}
        <GeoOutlinePhoneView
          cfg={cfg}
          tripID={activeTrip?.id ?? null}
          activeTrip={activeTrip}
          user={props.user}
          onOpenSettings={() => setInSettings(true)}
          onOpenTimeline={TIMELINE_ENABLED ? () => setTimelineDrawerOpen(true) : undefined}
          onOpenTrips={() => setTripsDrawerOpen(true)}
          theme={props.theme}
        />
        {/* PhoneSideTools:右側下方路徑+demo-* 小圖示,跨所有主畫面模式
            共用(不是規劃地圖專屬),見該元件開頭說明。 */}
        <PhoneSideTools tools={sideTools} />
        {/* PhoneTabBar:底部常駐導覽列(旅程/對話),取代原本要開
            PhoneNavDrawer 抽屜才看得到的分頁列,見該元件開頭說明。 */}
        <PhoneTabBar
          tabs={bottomTabs}
          tripsDrawerOpen={tripsDrawerOpen}
          onOpenTrips={onOpenTrips}
        />
        {/* 旅程列表獨立抽屜,由底部常駐列的「旅程」按鈕開關(onOpenTrips)。
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
            顯示什麼都持續更新(ChatScreen 永遠掛載在下方對話疊加層的
            children 裡,見該處 chatElement 的說明)。 */}
        <PhoneTimelineDrawer
          open={timelineDrawerOpen}
          onClose={() => setTimelineDrawerOpen(false)}
          tripName={activeTrip?.name ?? '時間軸'}
          timelineMirror={timelineMirror}
          editCfg={activeTrip && activeTrip.ownerID === props.user.id ? cfg : undefined}
        />
      </div>
      {/* 設定頁:改用共用容器 components/PhoneBottomSheet.tsx
          (mode="slide-close"),對齊 trip/PhoneTripsDrawer.tsx 的既有用法
          (使用者明確要求改成一般高度、可下滑關閉的 bottom sheet,不再是
          滿版全螢幕滑入)。bottom: 0、zIndex: 36——使用者明確要求開啟時
          不要被底部常駐導覽列 PhoneTabBar.tsx(z-index: 35)蓋住,不是貼齊
          它的上緣讓開空間,理由同 geo-planning/GeoOutlinePhoneListDrawer.tsx
          的 panelStyle 說明。showBackdrop={false}——使用者明確要求完全
          不要遮罩,點外部不關閉,只能靠 head 的關閉鈕或下滑手勢關閉。
          head 改用共用的 SheetHead(標題+關閉鈕標準樣式),不再自己拼
          navbar class,理由見該元件的說明。 */}
      <PhoneBottomSheet
        open={inSettings}
        onClose={() => setInSettings(false)}
        snapPoints={[SETTINGS_SHEET_TOP]}
        panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 36 }}
        showBackdrop={false}
        head={<SheetHead title="設定" onClose={() => setInSettings(false)} />}
      >
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
      </PhoneBottomSheet>
      {/* 對話:改成跟地點清單/設定頁一樣的滿版 PhoneBottomSheet 疊加層,由
          底部常駐列「對話」按鈕開關(chatSheetOpen,見上方說明)——使用者
          明確要求「規劃地圖常駐為主畫面,對話變疊加層」,取代原本「分頁
          決定主顯示內容」的版型。maxHeightVh 設 92——比其餘 bottom sheet
          (70)更高,貼近桌面版 chat-popover 幾乎滿版的視覺比例,對話輸入/
          訊息列表需要的垂直空間本來就比清單類內容多。bottom: 0、
          zIndex: 36、showBackdrop={false}——理由同設定頁。
          keepMounted——ChatScreen 直接放在 children 裡(不再透過 React
          Portal 投影),用 keepMounted 讓 PhoneBottomSheet 即使
          chatSheetOpen 為 false 也不卸載 children,避免每次關閉對話都
          重新連線 WebSocket(理由同 PhoneBottomSheet.tsx 的 keepMounted
          說明)。原本改用 React Portal(mainChatSlotNode/chatParkingNode/
          createPortal)是為了達到同樣的「永遠掛載」效果,但 portal 內容
          在 React 元件樹上跟 PhoneBottomSheet 是平行兄弟節點,不是它的
          React 子孫,導致觸控事件無法沿 React 樹冒泡到 PhoneBottomSheet
          的 onTouchStart/onTouchMove/onTouchEnd——使用者實測回報「對話
          疊加層只有標頭能拖,內容區完全拖不動」,跟地點清單/時間軸(內容
          直接是 children,沒有這個問題)對照後找到的根因。改用
          keepMounted 後不再需要 portal,ChatScreen 是真正的 React 子孫,
          觸控事件正常運作,原本用來解決「投影目標過早卸載導致地圖抽動」
          的 exitDurationMs/chatSheetSettled 雙層延遲機制也一併不再需要
          ——children 從不卸載,沒有卸載時機的問題可言。 */}
      <PhoneBottomSheet
        open={chatSheetOpen}
        onClose={() => setChatSheetOpen(false)}
        snapPoints={[CHAT_SHEET_TOP]}
        minHeightPx={CHAT_SHEET_MIN_HEIGHT}
        activeSnapIndex={chatSnapIndex}
        onSnapIndexChange={setChatSnapIndex}
        panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 36 }}
        showBackdrop={false}
        keepMounted
        head={<SheetHead title={activeTrip?.name ?? 'Tripace'} onClose={() => setChatSheetOpen(false)} />}
      >
        {chatElement}
      </PhoneBottomSheet>
      {/* 配速表:同上方對話,改成滿版 PhoneBottomSheet 疊加層,由右側小圖示
          「路徑」按鈕開關(paceSheetOpen)。跟對話不同,PaceRouteMap 不需要
          永遠掛載+portal 投影這套機制(沒有 WebSocket 之類需要避免重連的
          成本),sheet 關閉時直接卸載,開啟時才掛載,維持原本條件式掛載的
          既有行為。 */}
      <PhoneBottomSheet
        open={paceSheetOpen}
        onClose={() => setPaceSheetOpen(false)}
        snapPoints={[CHAT_SHEET_TOP]}
        panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 36 }}
        showBackdrop={false}
        head={<SheetHead title={activeTrip?.name ?? 'Tripace'} onClose={() => setPaceSheetOpen(false)} />}
      >
        {paceSheetOpen && (
          <PaceRouteMap
            checkpoints={paceCheckpoints}
            selectedEntry={selectedEntry}
            onSelectedEntryDone={() => setSelectedEntry(null)}
            onEntrySaved={setSavedEntry}
          />
        )}
      </PhoneBottomSheet>
      {/* manageTrip:旅程管理彈窗,對齊桌面版 DesktopLayout.tsx 的同名
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


