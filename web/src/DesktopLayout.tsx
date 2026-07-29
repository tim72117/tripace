import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronDown, Settings, LogOut, X,
  List, Timeline, Sparkles, GalleryHorizontal, Map, Wrench, Radio, Activity, Route, Plus,
} from 'lucide-react'
import type { ClientConfig, ApiCall, WsEvent } from './api'
import * as api from './api'
import { onApiCall, onWsEvent } from './api'
import type { Channel, User } from './types'
import { ChatScreen } from './ChatScreen'
import type { DesktopTimelineMirror } from './ChatScreen'
import { MultiTrackTimeline, type TaskPlaceholder } from './Timeline'
import type { AssistLang } from './assistLang'
import { ASSIST_LANG_KEY, getAssistLang } from './assistLang'
import { PaceChart } from './PaceChart'
import { PaceRouteMap, type SelectedEntry } from './PaceRouteMap'
import { DemoPanel } from './DemoPanel'
import {
  Avatar, ErrorBanner, errMsg, isSubmitEnter, LoginForm, useChannelsState,
  type ContentProps,
} from './AppCommon'
import {
  type PanelMode, isPanelMode, DemoPanelContent, LangSelect, TokenDisplay,
} from './DesktopShared'

// DesktopLayout:桌面版(寬度 >= 768px)專屬佈局元件——左側邊欄(頻道列表 +
// 使用者選單)+ 右側 ChatScreen 主要區塊,類似 Slack/Discord 的頻道側欄
// 模式。PanelMode/DemoPanelContent/LangSelect/TokenDisplay/useChannelsState
// 這些「桌面/手機共用」的部分不在這裡,分別在 DesktopShared.tsx/
// AppCommon.tsx——避免這裡跟手機版檔案(PhoneContent.tsx/PhoneNavDrawer.tsx/
// PhoneScreens.tsx)互相 import 對方造成循環依賴。

// PANEL_COLLAPSED_SEGMENT:/app/:panelMode 路徑參數裡代表「side panel 收合」
// (原本的 panelMode === null)的專屬字串,不屬於 PanelMode 型別的合法值——
// 純粹是路由層級的一個記號,不是業務上的「面板模式」。用一個明確字串
// (而非讓 null 對應到 /app 無參數)是因為 /app 無參數依規格要 fallback 成
// 'channels'(見 DesktopContent 內的說明),兩者不能共用同一個網址。
const PANEL_COLLAPSED_SEGMENT = 'none'

// 時間軸鏡像資料的初始值(尚未收到 ChatScreen 鏡像前,或未選擇行程時使用)。
const EMPTY_TIMELINE_MIRROR: DesktopTimelineMirror = {
  entries: [],
  updatingEntryIDs: new Set<string>(),
  taskPlaceholders: [] as TaskPlaceholder[],
  refetchEntries: () => {},
}

export function DesktopContent(props: ContentProps) {
  const { cfg, activeChannel, setActiveChannel } = props
  // settingsOpen 獨立於 DesktopUserMenu 內部的 popover 開關狀態:選單裡點「設定」
  // 時會同時關閉 popover(DesktopUserMenu 內部 state)並開啟這裡的 dialog。
  // dialog 提升到這一層(而非渲染在 DesktopUserMenu/側欄內部)渲染,是因為
  // .desktop-layout 設有 overflow: hidden,side bar 寬度也只有 272px——
  // 若 dialog 渲染在側欄內部,置中/覆蓋全畫面的彈窗會被側欄裁切或擠壓變形。
  // 提升到這裡、和 .desktop-layout 同層,搭配 CSS 的 position: fixed 疊加,
  // 才能保證 dialog 蓋住整個桌面版佈局(含側欄)最上層。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // panelMode:rail/side panel 的狀態改由網址驅動(/app/:panelMode,見 App.tsx),
  // 不再是這一層自己的 useState——這樣瀏覽器上一頁/下一頁、重新整理、分享連結
  // 都能還原到對應的 side panel/main 畫面。navigate 的部分見下方 setPanelMode。
  //
  // 「收合」(原本 panelMode === null)需要一個獨立於「沒有路徑參數」的網址
  // 表示法,不能直接讓 null 對應到 /app(無參數)——因為下面這條規則要求
  // /app 本身要 fallback 成 'channels'(維持既有使用者習慣),若兩者共用
  // 同一個網址,「再點一次啟用中的圖示收合 panel」會導致 navigate 到 /app、
  // 又立刻被 fallback 規則解回 'channels',使用者永遠無法真正收合側欄。
  // 因此用 PANEL_COLLAPSED_SEGMENT('none')這個明確的路徑片段代表收合狀態,
  // 跟「沒帶參數」區分開來。
  //
  // 網址沒帶 panelMode(例如直接訪問 /app)時 useParams() 回傳 undefined,
  // 這裡 fallback 成 'channels'——維持進入桌面版時 panel 開啟且顯示頻道列表的
  // 既有使用者習慣(這行為原本就是這裡的預設值,只是現在由「沒有路徑參數」
  // 觸發而非 useState 初始值)。
  //
  // 網址帶了不合法的 panelMode 字串(不在 PanelMode 列表、也不是
  // PANEL_COLLAPSED_SEGMENT 的字串)時,同樣 fallback 成 'channels' 而非收合
  // ——理由:讓使用者從一個「看起來壞掉的網址」落地時,至少有個看得懂的畫面
  // (頻道列表)可以操作,好過收合側欄後找不到任何導覽入口(rail 上也沒有
  // 任何按鈕會是 active 狀態,使用者會搞不清楚目前在哪)。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  const panelMode: PanelMode =
    panelModeParam === PANEL_COLLAPSED_SEGMENT
      ? null
      : isPanelMode(panelModeParam) ? panelModeParam : 'channels'
  const navigate = useNavigate()
  // setPanelMode:取代原本的 useState setter,改成 navigate 到對應路徑。
  // 沿用原本「再點一次啟用中的圖示會收合 panel」的行為——這裡收合改成導向
  // /app/none(見上方說明),而不是 /app。
  const setPanelMode = useCallback((mode: Exclude<PanelMode, null>) => {
    navigate(panelMode === mode ? `/app/${PANEL_COLLAPSED_SEGMENT}` : `/app/${mode}`)
  }, [navigate, panelMode])
  // selectedEntry:配速表「點卡片→地圖平移→手動微調→儲存座標」互動用,
  // 跟 PublicPaceDemoPage.tsx(/demo/pace 公開頁)同一套設計——PaceChart/
  // PaceRouteMap 這裡跟那裡各自獨立掛載,狀態不共用,故這裡需要自己的
  // selectedEntry state,不能指望公開頁那份。
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null)
  // timelineMirror:ChatScreen 透過 desktopChat.onTimelineData 鏡像過來的時間軸資料
  // (entries/updatingEntryIDs/taskPlaceholders/refetchEntries)。ChatScreen 是這份
  // 資料唯一的擁有者(它的 WS 連線即時維護這些 state),這裡只是接住鏡像後轉交給
  // side panel 的 MultiTrackTimeline,不可以自己另外 fetch 或開第二條 WS。
  const [timelineMirror, setTimelineMirror] = useState<DesktopTimelineMirror>(EMPTY_TIMELINE_MIRROR)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // showDebugPanel/calls/wsEvents:原本 DebugApp.tsx(?debug 獨立工作台)裡的
  // API/WS 狀態面板,併入正式 App 後改成只在 ?demo 模式下、由 rail 上一顆
  // 獨立按鈕切換顯示的附加面板(不佔用 panelMode 的三態切換,因為它要能疊加
  // 顯示、不取代 side panel 或 .desktop-main 的內容——見下方渲染邏輯)。
  // onApiCall/onWsEvent 訂閱本身沒有開銷(見 api.ts),即使面板收合也持續
  // 累積,收合後重新展開不會漏掉收合期間發生的紀錄。
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [debugCalls, setDebugCalls] = useState<ApiCall[]>([])
  const [debugWsEvents, setDebugWsEvents] = useState<WsEvent[]>([])
  useEffect(() => onApiCall((c) => setDebugCalls((prev) => [c, ...prev].slice(0, 100))), [])
  useEffect(() => onWsEvent((e) => setDebugWsEvents((prev) => [e, ...prev].slice(0, 100))), [])
  // isSidepanelMode:panelMode 是不是「該展開 side panel」的模式——
  // channels/timeline/pace 這三種正式功能(pace 配速表側欄顯示檢查站清單,
  // 跟 timeline 用同一種「side panel 開、main 區顯示 ChatScreen/空狀態」
  // 版面)。其餘 demo-cards/demo-row/demo-map/demo-clienttools/demo-onagent
  // 這幾種試做模式維持顯示在右側 .desktop-main(取代 ChatScreen,見下方
  // 渲染邏輯),不佔用 side panel,故不能讓 side panel 因為 panelMode 有值
  // 就誤判成該展開,否則會出現一個空白的展開面板。
  const isSidepanelMode = panelMode === 'channels' || panelMode === 'timeline' || panelMode === 'pace'

  // 切換行程時,先清空鏡像資料,避免新行程的 ChatScreen 還沒送出第一次鏡像前,
  // side panel 短暫顯示上一個行程的時間軸內容。
  useEffect(() => {
    setTimelineMirror(EMPTY_TIMELINE_MIRROR)
  }, [activeChannel?.id])

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

  return (
    <>
      <div className="desktop-layout">
        <DesktopRail
          panelMode={panelMode}
          onSelect={setPanelMode}
          timelineDisabled={!activeChannel}
          user={props.user}
          isGuest={props.isGuest}
          cfg={cfg}
          onAuthed={props.onAuthed}
          onLogout={props.onLogout}
          onOpenSettings={() => setSettingsOpen(true)}
          isDemo={!!props.isDemo}
          showDebugPanel={showDebugPanel}
          onToggleDebugPanel={() => setShowDebugPanel((v) => !v)}
        />
        <aside className={`desktop-sidepanel${isSidepanelMode ? '' : ' collapsed'}${panelMode === 'timeline' || panelMode === 'pace' ? ' wide' : ''}`}>
          <div className="desktop-sidepanel-inner">
            {panelMode === 'channels' && (
              <DesktopChannelList
                cfg={cfg}
                activeChannelID={activeChannel?.id ?? null}
                onOpen={(c) => setActiveChannel(c)}
              />
            )}
            {panelMode === 'timeline' && (
              <div className="desktop-timeline-panel">
                <div className="desktop-sidebar-head">
                  <span className="desktop-sidebar-title">時間軸</span>
                </div>
                <div className="desktop-timeline-scroll">
                  {!activeChannel ? (
                    <div className="empty">選擇一個行程後顯示時間軸。</div>
                  ) : timelineMirror.entries.length === 0 ? (
                    <div className="empty">尚無行程內容。</div>
                  ) : (
                    <MultiTrackTimeline
                      entries={timelineMirror.entries}
                      todayRef={todayRef}
                      updatingIDs={timelineMirror.updatingEntryIDs}
                      taskPlaceholders={timelineMirror.taskPlaceholders}
                      cfg={activeChannel.ownerID === props.user.id ? cfg : undefined}
                      onEntryUpdated={timelineMirror.refetchEntries}
                    />
                  )}
                </div>
              </div>
            )}
            {panelMode === 'pace' && (
              <div className="desktop-sidepanel-pace">
                <PaceChart cfg={cfg} channelID={activeChannel?.id} onCheckpointClick={setSelectedEntry} />
              </div>
            )}
          </div>
        </aside>
        <main className="desktop-main">
          {panelMode === 'pace' ? (
            // 配速表拆成兩塊:檢查站清單留在左側 side panel(見上方
            // .desktop-sidepanel-pace),地圖需要較寬的空間,改在右側主區
            // 顯示——跟 timeline 模式「側欄放清單、主區放詳細內容」是同一種
            // 版面邏輯。selectedEntry 這套「點卡片→地圖平移→手動微調→
            // 儲存座標」互動只在這裡(登入後正式介面)提供,/demo/pace 公開
            // 分享頁刻意不接(見 PaceRouteMap.tsx 的 SelectedEntry 說明)。
            <div className="desktop-demo-panel">
              <PaceRouteMap selectedEntry={selectedEntry} onSelectedEntryDone={() => setSelectedEntry(null)} />
            </div>
          ) : panelMode === 'demo-cards' || panelMode === 'demo-row' || panelMode === 'demo-map'
            || panelMode === 'demo-clienttools' || panelMode === 'demo-onagent' ? (
            <DemoPanelContent mode={panelMode} />
          ) : activeChannel ? (
            <ChatScreen
              cfg={cfg}
              channel={activeChannel}
              user={props.user}
              onBack={() => setActiveChannel(null)}
              desktopChat={desktopChat}
            />
          ) : (
            <div className="desktop-empty-state">選擇一個行程開始</div>
          )}
        </main>
        {props.isDemo && showDebugPanel && (
          <DemoPanel
            calls={debugCalls}
            onClear={() => setDebugCalls([])}
            wsEvents={debugWsEvents}
            onClearWsEvents={() => setDebugWsEvents([])}
            cfg={cfg}
            channel={activeChannel}
            // .debug 這組樣式(見 debug.css)原本假設父層是撐滿整頁的
            // .workbench,寫死 height: 100vh。這裡改成 .desktop-layout
            // 這個非全頁的 flex row 底下的一個子項,覆寫成吃滿容器高度
            // (100%)、固定寬度(不像 .debug 原本的 flex: 0 0 auto 那樣
            // 依內容決定寬度)。
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
    </>
  )
}

// DesktopRail:最左緣 48px 固定寬的 icon rail(比照 VSCode activity bar / Slack
// 頻道列)。上方兩顆圖示鈕切換 side panel 內容(再點一次啟用中的圖示會收合 panel),
// 底部放 DesktopUserMenu。當前啟用的圖示用左緣 accent 豎條 + 底色標記(見 styles.css
// .desktop-rail-btn.active)。
function DesktopRail({
  panelMode,
  onSelect,
  timelineDisabled,
  user,
  isGuest,
  cfg,
  onAuthed,
  onLogout,
  onOpenSettings,
  isDemo,
  showDebugPanel,
  onToggleDebugPanel,
}: {
  panelMode: PanelMode
  onSelect: (mode: Exclude<PanelMode, null>) => void
  timelineDisabled: boolean
  user: User
  isGuest: boolean
  cfg: ClientConfig
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onOpenSettings: () => void
  // isDemo:網址帶 ?demo 時為 true,才會多渲染下方幾顆試做用按鈕
  // (推薦景點卡片/橫滑/地圖、ClientToolsBridge/onagent 串接試做、API/WS
  // 狀態面板開關)。沒帶 ?demo 時 rail 維持現狀,不多出任何項目。
  isDemo: boolean
  // showDebugPanel/onToggleDebugPanel:API/WS 狀態面板(原 DebugApp.tsx 的
  // DebugPanel)的開關狀態——獨立於 panelMode 之外的一個 boolean,不是三態
  // 切換的一員,因為這個面板是疊加顯示、不取代 side panel 或 .desktop-main
  // 的內容(見 DesktopContent 渲染邏輯裡 showDebugPanel 的用法)。
  showDebugPanel: boolean
  onToggleDebugPanel: () => void
}) {
  return (
    <nav className="desktop-rail">
      <div className="desktop-rail-buttons">
        <button
          className={`desktop-rail-btn${panelMode === 'channels' ? ' active' : ''}`}
          onClick={() => onSelect('channels')}
          title="頻道列表"
        >
          <List size={20} strokeWidth={1.8} />
        </button>
        <button
          className={`desktop-rail-btn${panelMode === 'timeline' ? ' active' : ''}`}
          onClick={() => !timelineDisabled && onSelect('timeline')}
          disabled={timelineDisabled}
          title={timelineDisabled ? '請先選擇一個行程' : '時間軸'}
        >
          <Timeline size={20} strokeWidth={1.8} />
        </button>
        <button
          className={`desktop-rail-btn${panelMode === 'pace' ? ' active' : ''}`}
          onClick={() => onSelect('pace')}
          title="配速表"
        >
          <Route size={20} strokeWidth={1.8} />
        </button>
        {isDemo && (
          <>
            {/* 試做用導覽項目與正式功能之間的視覺分隔線,只在 ?demo 時出現,
                避免試做項目跟正式功能混在一起難以分辨。 */}
            <div className="desktop-rail-divider" />
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-cards' ? ' active' : ''}`}
              onClick={() => onSelect('demo-cards')}
              title="推薦景點卡片(試做)"
            >
              <Sparkles size={20} strokeWidth={1.8} />
            </button>
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-row' ? ' active' : ''}`}
              onClick={() => onSelect('demo-row')}
              title="推薦景點橫滑(試做)"
            >
              <GalleryHorizontal size={20} strokeWidth={1.8} />
            </button>
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-map' ? ' active' : ''}`}
              onClick={() => onSelect('demo-map')}
              title="推薦景點地圖(試做)"
            >
              <Map size={20} strokeWidth={1.8} />
            </button>
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-clienttools' ? ' active' : ''}`}
              onClick={() => onSelect('demo-clienttools')}
              title="LLM 呼叫前端 tool 試做(ClientToolsBridge)"
            >
              <Wrench size={20} strokeWidth={1.8} />
            </button>
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-onagent' ? ' active' : ''}`}
              onClick={() => onSelect('demo-onagent')}
              title="onagent 平台串接試做"
            >
              <Radio size={20} strokeWidth={1.8} />
            </button>
            <button
              className={`desktop-rail-btn desktop-rail-btn-demo${showDebugPanel ? ' active' : ''}`}
              onClick={onToggleDebugPanel}
              title="API / WS 狀態面板"
            >
              <Activity size={20} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
      <DesktopUserMenu
        cfg={cfg}
        user={user}
        isGuest={isGuest}
        onAuthed={onAuthed}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
      />
    </nav>
  )
}

// 桌面版側欄頻道列表:複用 useChannelsState(與手機版 PhoneNavDrawer 的
// 行程列表分頁共用抓取/建立邏輯),只是呈現方式改成緊湊的側欄列表項目,
// 選中的頻道有高亮(.desktop-channel-item.active)。
function DesktopChannelList({
  cfg,
  activeChannelID,
  onOpen,
}: {
  cfg: ClientConfig
  activeChannelID: string | null
  onOpen: (c: Channel) => void
}) {
  const {
    channels, err, loading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useChannelsState(cfg, onOpen)

  return (
    <div className="desktop-channel-list">
      <div className="desktop-sidebar-head">
        <span className="desktop-sidebar-title">行程</span>
        <button className="btn icon-btn" onClick={() => setCreating((v) => !v)} title="新增行程">
          <Plus size={18} strokeWidth={1.8} />
        </button>
      </div>
      {creating && (
        <div className="new-channel-composer">
          <input
            autoFocus
            value={newName}
            placeholder="新行程名稱…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitEnter(e)) submitCreate()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
          <button className="btn-primary" onClick={submitCreate} disabled={!newName.trim()}>
            建立
          </button>
        </div>
      )}
      <ErrorBanner msg={err} />
      <div className="desktop-channel-scroll">
        {channels.length === 0 && !err ? (
          <div className="empty">
            {loading ? '載入中…' : '沒有行程，按上方 ＋ 建立一個。'}
          </div>
        ) : (
          channels.map((c) => (
            <button
              key={c.id}
              className={`desktop-channel-item${c.id === activeChannelID ? ' active' : ''}`}
              onClick={() => onOpen(c)}
            >
              <Avatar user={{ name: c.name, avatarColor: 'var(--color-accent)' }} />
              <div className="grow">
                <div className="name">{c.name}</div>
                <div className="sub">
                  {c.lastMessagePreview ?? '尚無訊息'} · {c.memberCount} 人
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// 桌面版左下方使用者設定入口:頭像 + 名稱一列,點擊展開 popover 選單。
// 已登入時選單只有「設定」(開啟 SettingsDialog)、「登出」兩項精簡項目;
// 訪客狀態維持原邏輯不變,popover 顯示登入表單(LoginForm)。
function DesktopUserMenu({
  cfg,
  user,
  isGuest,
  onAuthed,
  onLogout,
  onOpenSettings,
}: {
  cfg: ClientConfig
  user: User
  isGuest: boolean
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onOpenSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="desktop-user-menu" ref={menuRef}>
      {open && (
        <div className="desktop-user-popover">
          {isGuest ? (
            <>
              <div className="section-title">目前身分</div>
              <div className="row">
                <Avatar user={user} />
                <div className="grow">
                  <div className="name">訪客</div>
                  <div className="sub">登入後發送的訊息會以你的身分顯示</div>
                </div>
              </div>
              <LoginForm baseURL={cfg.baseURL} onAuthed={(tok, u, mail) => {
                onAuthed(tok, u, mail)
                setOpen(false)
              }} />
            </>
          ) : (
            <>
              <button
                className="desktop-user-menu-item"
                onClick={() => { setOpen(false); onOpenSettings() }}
              >
                <Settings size={16} strokeWidth={1.8} />
                <span>設定</span>
              </button>
              <button
                className="desktop-user-menu-item"
                onClick={() => { onLogout(); setOpen(false) }}
              >
                <LogOut size={16} strokeWidth={1.8} color="var(--ios-red)" />
                <span style={{ color: 'var(--ios-red)' }}>登出</span>
              </button>
            </>
          )}
        </div>
      )}
      <button className="desktop-user-trigger" onClick={() => setOpen((v) => !v)}>
        <Avatar user={user} />
        <div className="grow">
          <div className="name">{isGuest ? '訪客' : user.name}</div>
          {isGuest && <div className="sub">點擊登入</div>}
        </div>
      </button>
    </div>
  )
}

// 桌面版「設定」dialog:點選 DesktopUserMenu 的「設定」項目後開啟,置中卡片彈窗,
// 視覺沿用原 RecommendedPlacesModal(已移除)留下的 .rp-modal-backdrop/.rp-modal
// 樣式骨架(見 styles.css),內容則對應手機版 SettingsScreen 扣除「登出」
// (登出已是選單裡的獨立項目)。疊加 .settings-dialog-backdrop 只覆寫 position
// 從 absolute 改為 fixed:.rp-modal-backdrop 原本用 absolute+inset:0 是相對
// 最近的 relative 祖先(.desktop-main)定位,只蓋住右側聊天區;這裡是從
// DesktopContent 頂層渲染,需要蓋住整個桌面版佈局(含左側側欄),且不能被
// .desktop-layout 的 overflow: hidden 裁切,故改用 fixed。
function SettingsDialog({
  cfg,
  user,
  email,
  onClose,
}: {
  cfg: ClientConfig
  user: User
  email: string
  onClose: () => void
}) {
  const [health, setHealth] = useState<string>('未測試')
  const [assistLang, setAssistLang] = useState<AssistLang>(() => getAssistLang())
  const [devOpen, setDevOpen] = useState(false)

  const ping = async () => {
    setHealth('測試中…')
    try {
      const r = await api.health(cfg)
      setHealth(`✅ ${r.status}`)
    } catch (e) {
      setHealth(`❌ ${errMsg(e)}`)
    }
  }

  return (
    <div className="rp-modal-backdrop settings-dialog-backdrop" onClick={onClose}>
      <div className="rp-modal settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-head">
          <span className="rp-modal-title">設定</span>
          <button className="btn icon-btn" onClick={onClose} title="關閉">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="rp-modal-body">
          <div className="section-title">目前登入</div>
          <div className="row">
            <Avatar user={user} />
            <div className="grow">
              <div className="name">{user.name}</div>
              <div className="sub">{email || user.id}</div>
            </div>
          </div>
          <div className="section-title">LLM 回答語言</div>
          <div className="field">
            <label>助理回答(assist/語意查詢)使用的語言,不影響介面文字</label>
            <LangSelect
              value={assistLang}
              onChange={(v) => {
                setAssistLang(v)
                localStorage.setItem(ASSIST_LANG_KEY, v)
              }}
            />
          </div>
          <div className="dev-section-toggle" onClick={() => setDevOpen((o) => !o)}>
            <span>開發</span>
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              color="var(--ios-gray)"
              className={devOpen ? 'dev-section-chevron open' : 'dev-section-chevron'}
            />
          </div>
          {devOpen && (
            <>
              <div className="section-title">API Token (CLI 用)</div>
              <TokenDisplay token={cfg.token} />
              <div className="section-title">後端連線</div>
              <div className="field">
                <label>Base URL(由 VITE_API_BASE 設定,不可於此修改)</label>
                <input value={cfg.baseURL} readOnly disabled />
              </div>
              <div className="section-title">健康檢查</div>
              <div className="row" onClick={ping}>
                <div className="grow">
                  <div className="name">GET /health</div>
                  <div className="sub">{health}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
