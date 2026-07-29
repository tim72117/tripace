import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import {
  List, Timeline, Plus, Sparkles, GalleryHorizontal, Map, Wrench, Radio, Route, Settings, MapPin,
} from 'lucide-react'
import type { Channel, User } from './types'
import { Avatar, ErrorBanner, isSubmitEnter } from './AppCommon'
import { type DemoPanelMode, DemoPanelContent } from './DesktopShared'
import { MultiTrackTimeline } from './Timeline'
import { PaceChart } from './PaceChart'
import type { SelectedEntry } from './PaceRouteMap'
import type { DesktopTimelineMirror } from './ChatScreen'
import type { ClientConfig } from './api'
import styles from './PhoneNavDrawer.module.css'

// PhoneNavDrawer:手機版左側導覽抽屜欄,取代原本各自獨立的 ChannelsScreen
// (整頁行程列表)、ChatScreen 自己的右側時間軸抽屜,與右下角漢堡按鈕開的
// PhoneDemoDrawer(配速表/demo 面板),比照桌面版 DesktopLayout.tsx 的
// DesktopRail(功能列)+ .desktop-sidepanel(側欄)結構:上方一排功能列
// (行程列表/時間軸/配速表/demo-*,對應桌面版 rail 的 channels/timeline/
// pace/demo-* 項目),下方視選取的分頁顯示對應內容,底部一顆使用者頭像列
// 對應桌面版 DesktopUserMenu 的位置,點擊進入 SettingsScreen。
//
// 'pace' 分頁只顯示檢查站清單(PaceChart),不含地圖——地圖(PaceRouteMap)
// 對齊桌面版改成顯示在主顯示區(見 PhoneContent.tsx),不是抽屜欄自己的
// 內容,理由同桌面版「側欄放清單、主區放地圖」的版面切分。
//
// 滑入手勢仿照 PacePhoneSwipe.tsx 的抽屜模式(左側滑入,拖曳關閉),只是這裡
// 疊在整個 PhoneContent 之上(相對於 .web-app 定位),不像 PacePhoneSwipe
// 只疊在配速表地圖上面。

export type DrawerMode = DemoPanelMode | 'pace' | 'channels' | 'timeline'

const DRAWER_WIDTH_PERCENT = 82

export function PhoneNavDrawer({
  open,
  cfg,
  mode,
  onSelectMode,
  isDemo,
  channels,
  channelsErr,
  channelsLoading,
  creating,
  setCreating,
  newName,
  setNewName,
  submitCreate,
  activeChannel,
  onSelectChannel,
  timelineMirror,
  lastContentMode,
  user,
  onSelectedEntry,
  onOpenSettings,
  onClose,
}: {
  // open:面板一律掛載(不像先前的版本靠條件渲染整個元件),只用這個 boolean
  // 切換 translateX——理由同 PacePhoneSwipe.tsx 的 .panel:唯有元件全程留在
  // DOM 上,CSS transition 才能在「開/關」切換的當下播放滑入/滑出動畫;
  // 條件掛載/卸載沒有「前一刻」可以從那裡動畫過來,只會瞬間出現/消失。
  open: boolean
  cfg: ClientConfig
  mode: DrawerMode
  onSelectMode: (mode: DrawerMode) => void
  isDemo: boolean
  channels: Channel[]
  channelsErr: string | null
  channelsLoading: boolean
  creating: boolean
  setCreating: (v: boolean) => void
  newName: string
  setNewName: (v: string) => void
  submitCreate: () => void
  activeChannel: Channel | null
  onSelectChannel: (c: Channel) => void
  // timelineMirror:ChatScreen 透過 PhoneContent.tsx 鏡像過來的時間軸資料,
  // 跟桌面版 DesktopContent 傳給側欄時間軸分頁的是同一份形狀。
  timelineMirror: DesktopTimelineMirror
  // lastContentMode:使用者上一次主動選取的「時間軸」或「配速表」分頁
  // (見 PhoneContent.tsx 的說明)。目前在「行程列表」分頁瀏覽選新行程時,
  // 這個分頁的功能列圖示要跟 lastContentMode 對應的那顆圖示同時顯示
  // active——使用者觀點:行程列表只是借來挑選行程的工具畫面,不代表真的
  // 離開了時間軸/配速表這個內容模式,兩顆圖示都該保持「選中」的視覺回饋。
  lastContentMode: 'pace' | 'timeline' | null
  user: User
  // onSelectedEntry:配速表分頁點擊檢查站卡片時往上通知,驅動主顯示區地圖
  // (PaceRouteMap,見 PhoneContent.tsx)平移過去。
  onSelectedEntry: (entry: SelectedEntry) => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  // 拖曳關閉手勢:跟 PacePhoneSwipe.tsx 同一套寫法——開啟時只能往左拖(關閉
  // 方向,delta 為負),超過門檻放開手指直接關閉;面板收合時位在螢幕外,
  // 手指本來就摸不到它,不需要另外擋掉這組 handler。
  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    const delta = Math.min(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold) onClose()
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `${dragOffset}px` : `calc(-100% + ${dragOffset}px)`

  const items: { mode: DrawerMode; icon: typeof List; title: string; disabled?: boolean }[] = [
    { mode: 'channels', icon: List, title: '行程列表' },
    { mode: 'timeline', icon: Timeline, title: '時間軸', disabled: !activeChannel },
    { mode: 'pace', icon: Route, title: '配速表' },
    ...(isDemo
      ? [
        { mode: 'demo-cards' as DrawerMode, icon: Sparkles, title: '推薦景點卡片' },
        { mode: 'demo-row' as DrawerMode, icon: GalleryHorizontal, title: '推薦景點橫滑' },
        { mode: 'demo-map' as DrawerMode, icon: Map, title: '推薦景點地圖' },
        { mode: 'demo-clienttools' as DrawerMode, icon: Wrench, title: 'ClientToolsBridge' },
        { mode: 'demo-onagent' as DrawerMode, icon: Radio, title: 'onagent 串接' },
      ]
      : []),
  ]

  return (
    <>
      {open && (
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={styles.panel}
        style={{
          width: `${DRAWER_WIDTH_PERCENT}%`,
          transform: `translateX(${translate})`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.tabs}>
          {items.map(({ mode: m, icon: Icon, title, disabled }) => {
            // isActive:一般情況就是「目前分頁就是這顆」;例外是使用者正在
            // 「行程列表」分頁瀏覽選新行程時,先前正在看的時間軸/配速表分頁
            // 圖示要一起顯示 active(見上方 lastContentMode 的說明)。
            const isActive = mode === m || (mode === 'channels' && lastContentMode === m)
            return (
              <button
                key={m}
                type="button"
                className={`${styles.tab}${isActive ? ` ${styles.tabActive}` : ''}`}
                onClick={() => !disabled && onSelectMode(m)}
                disabled={disabled}
                title={disabled ? '請先選擇一個行程' : title}
              >
                <Icon size={20} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
        <div className={styles.body}>
          {mode === 'channels' ? (
            <ChannelsTabContent
              channels={channels}
              err={channelsErr}
              loading={channelsLoading}
              creating={creating}
              setCreating={setCreating}
              newName={newName}
              setNewName={setNewName}
              submitCreate={submitCreate}
              activeChannelID={activeChannel?.id ?? null}
              onSelectChannel={onSelectChannel}
            />
          ) : mode === 'timeline' ? (
            <TimelineTabContent
              cfg={cfg}
              activeChannel={activeChannel}
              user={user}
              timelineMirror={timelineMirror}
            />
          ) : mode === 'pace' ? (
            <PaceChart cfg={cfg} channelID={activeChannel?.id} onCheckpointClick={onSelectedEntry} />
          ) : (
            <DemoPanelContent mode={mode} />
          )}
        </div>
        <div className={styles.userRow}>
          <Avatar user={user} />
          <div className={styles.userName}>{user.name}</div>
          <button type="button" className={styles.settingsBtn} onClick={onOpenSettings} title="設定">
            <Settings size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </>
  )
}

// TimelineTabContent:時間軸分頁內容,對齊桌面版 DesktopContent 的
// panelMode === 'timeline' 分支(同樣的兩層空狀態判斷、cfg 依 owner 身分
// 決定是否可編輯)。todayRef/捲到今天的邏輯搬自原本 ChatScreen.tsx 的
// 右側時間軸抽屜(該機制已移除,時間軸只剩這一個入口)。
function TimelineTabContent({
  cfg,
  activeChannel,
  user,
  timelineMirror,
}: {
  cfg: ClientConfig
  activeChannel: Channel | null
  user: User
  timelineMirror: DesktopTimelineMirror
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

  if (!activeChannel) {
    return <div className="empty">選擇一個行程後顯示時間軸。</div>
  }
  if (timelineMirror.entries.length === 0) {
    return <div className="empty">尚無行程內容。</div>
  }
  return (
    <div className="screen-body" ref={bodyRef}>
      <MultiTrackTimeline
        entries={timelineMirror.entries}
        todayRef={todayRef}
        updatingIDs={timelineMirror.updatingEntryIDs}
        taskPlaceholders={timelineMirror.taskPlaceholders}
        cfg={activeChannel.ownerID === user.id ? cfg : undefined}
        onEntryUpdated={timelineMirror.refetchEntries}
      />
    </div>
  )
}

// ChannelsTabContent:行程列表分頁內容,從原本的 ChannelsScreen(整頁元件)
// 搬過來——瀏覽/新增行程兩態切換的邏輯不變,只是不再包自己的 .navbar
// (抽屜自己的功能列已經扮演了「上方導覽」的角色)。
function ChannelsTabContent({
  channels,
  err,
  loading,
  creating,
  setCreating,
  newName,
  setNewName,
  submitCreate,
  activeChannelID,
  onSelectChannel,
}: {
  channels: Channel[]
  err: string | null
  loading: boolean
  creating: boolean
  setCreating: (v: boolean) => void
  newName: string
  setNewName: (v: string) => void
  submitCreate: () => void
  activeChannelID: string | null
  onSelectChannel: (c: Channel) => void
}) {
  return (
    <div className="screen-body">
      <ErrorBanner msg={err} />
      {channels.length === 0 && !err && (
        <div className="empty">
          {loading ? '載入中…' : '沒有行程。按下方「新增行程」建立一個。'}
        </div>
      )}
      <ul className={styles.channelList}>
        {/* 新增行程:跟下面實際的行程項目共用同一套 .channelItem 樣式(借來
            瀏覽/新增行程的是同一個工具畫面,視覺上該是同一組清單的一份子,
            不是另一顆突兀的強調色橫幅按鈕),只把大頭貼換成「＋」圖示徽章
            區分。點擊後這個項目原地換成輸入框(composer),下面既有行程
            清單維持可見、可捲動,不會像原本整塊消失。 */}
        <li>
          {creating ? (
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
          ) : (
            <button type="button" className={styles.channelItem} onClick={() => setCreating(true)}>
              <div className={styles.newChannelIcon}>
                <Plus size={18} strokeWidth={1.8} />
              </div>
              <div className={styles.channelGrow}>
                <div className={styles.channelName}>新增行程</div>
              </div>
            </button>
          )}
        </li>
        {channels.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`${styles.channelItem}${c.id === activeChannelID ? ` ${styles.channelItemActive}` : ''}`}
              onClick={() => onSelectChannel(c)}
            >
              <div className={styles.newChannelIcon}>
                <MapPin size={18} strokeWidth={1.8} />
              </div>
              <div className={styles.channelGrow}>
                <div className={styles.channelName}>{c.name}</div>
                <div className={styles.channelSub}>
                  {c.lastMessagePreview ?? '尚無訊息'} · {c.memberCount} 人
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
