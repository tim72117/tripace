import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import {
  List, Timeline, Sparkles, GalleryHorizontal, Radio, Route, Share2, Users,
} from 'lucide-react'
import type { Trip, User } from './types'
import { Avatar } from './AppCommon'
import {
  type DemoPanelMode, DemoPanelContent, TIMELINE_ENABLED, PACE_ENABLED,
  DEMO_CARDS_ENABLED, DEMO_ROW_ENABLED, DEMO_ONAGENT_ENABLED,
} from './DesktopShared'
import { PaceChart, type Checkpoint } from './PaceChart'
import type { SelectedEntry } from './PaceRouteMap'
import { TripMenu } from './trip/TripMenu'
import { MembersScreen } from './trip/MembersScreen'
import type { ClientConfig } from './api'
import styles from './PhoneNavDrawer.module.css'

// PhoneNavDrawer:手機版左側導覽抽屜欄,取代原本各自獨立的 TripsScreen
// (整頁行程列表)、ChatScreen 自己的右側時間軸抽屜,與右下角漢堡按鈕開的
// PhoneDemoDrawer(配速表/demo 面板),比照桌面版 DesktopLayout.tsx 的
// DesktopRail(功能列)+ .desktop-sidepanel(側欄)結構:上方一排功能列
// (時間軸/配速表/demo-*,對應桌面版 rail 的 timeline/pace/demo-* 項目),
// 下方視選取的分頁顯示對應內容。
//
// 行程列表('trips')已經拆成獨立的另一個抽屜(PhoneTripsDrawer.tsx),
// 疊在這個抽屜之上(更高的 z-index)——不再是這裡分頁列的其中一顆,見
// PhoneContent.tsx 的 tripsDrawerOpen。
//
// 分頁列右上角放三顆操作按鈕(分享/成員/使用者頭像),永遠顯示、不隨分頁
// 切換而消失——分享/成員操作的對象是「目前選取的行程」(activeTrip),
// 跟抽屜正在顯示哪個分頁無關;使用者頭像點擊直接開設定。這三顆原本分散在
// ChatScreen 自己的 navbar(桌面版仍保留在那裡)與主顯示區的
// MainNavBar,手機版統一收攏到這裡,理由是分享/成員操作即使對話沒有顯示在
// 畫面上(例如正在看時間軸/配速表分頁)也該找得到入口,不該綁定在對話
// 元件本身的 UI 裡。分享/成員點擊後在 .body 整塊換成 ShareModal/
// MembersScreen(取代原本分頁內容),關閉後恢復,寫法比照 ChatScreen.tsx
// 桌面版仍在用的同一套 showShare/showMembers 全螢幕切換模式。
//
// 'pace' 分頁只顯示檢查站清單(PaceChart),不含地圖——地圖(PaceRouteMap)
// 對齊桌面版改成顯示在主顯示區(見 PhoneContent.tsx),不是抽屜欄自己的
// 內容,理由同桌面版「側欄放清單、主區放地圖」的版面切分。
//
// 'timeline' 分頁反過來:對話(ChatScreen)才是內容,時間軸本身改到主顯示區
// 滿版顯示(見 PhoneContent.tsx 的 TimelineMainView)——這裡只留一個空的
// portal 投影目標(timelineSlotRef),ChatScreen 實際掛載處始終在
// PhoneContent.tsx,不會因為分頁切換而重新掛載/重新連線。ChatScreen 投影
// 進來時不帶自己的 navbar(見 ChatScreen.tsx 的 mobileHeader==='drawer'),
// 這個抽屜自己的分頁列就是唯一的「上方列」。
//
// 滑入手勢仿照 PacePhoneSwipe.tsx 的抽屜模式(左側滑入,拖曳關閉),只是這裡
// 疊在整個 PhoneContent 之上(相對於 .web-app 定位),不像 PacePhoneSwipe
// 只疊在配速表地圖上面。

export type DrawerMode = DemoPanelMode | 'pace' | 'trips' | 'timeline'

const DRAWER_WIDTH_PERCENT = 82

export function PhoneNavDrawer({
  open,
  cfg,
  mode,
  onSelectMode,
  activeTrip,
  timelineSlotRef,
  lastContentMode,
  onSelectedEntry,
  onRouteChange,
  savedEntry,
  tripsDrawerOpen,
  onOpenTrips,
  user,
  onOpenSettings,
  onOpenShare,
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
  activeTrip: Trip | null
  // timelineSlotRef:'timeline' 分頁時,抽屜欄這裡不再自己顯示時間軸內容
  // ——對齊使用者要求的「時間軸與對話顯示位置對調」,時間軸改到主顯示區
  // 滿版顯示,這裡改顯示對話(ChatScreen)本身。ChatScreen 實際上仍然只在
  // PhoneContent.tsx 掛載一次(避免每次切換分頁都重新掛載、重新連線
  // WebSocket),用 React Portal 把它的畫面「投影」進這裡——這個 ref 就是
  // portal 的投影目標容器,由 PhoneContent.tsx 建立/持有那個 DOM 節點。
  timelineSlotRef: (node: HTMLDivElement | null) => void
  // lastContentMode:使用者上一次主動選取的「時間軸」或「配速表」分頁
  // (見 PhoneContent.tsx 的說明)。瀏覽獨立行程抽屜選新行程時,這個分頁的
  // 功能列圖示要跟 lastContentMode 對應的那顆圖示同時顯示 active——使用者
  // 觀點:行程列表只是借來挑選行程的工具畫面,不代表真的離開了時間軸/
  // 配速表這個內容模式,兩顆圖示都該保持「選中」的視覺回饋。
  lastContentMode: 'pace' | 'timeline' | null
  // onSelectedEntry:配速表分頁點擊檢查站卡片時往上通知,驅動主顯示區地圖
  // (PaceRouteMap,見 PhoneContent.tsx)平移過去。
  onSelectedEntry: (entry: SelectedEntry) => void
  // onRouteChange:'pace' 分頁目前選取的那一段 checkpoint 清單變動時往上
  // 通知——見 PaceChart.tsx 的 onRouteChange 說明,PhoneContent.tsx 再轉傳
  // 給主顯示區的 PaceRouteMap(地圖)。
  onRouteChange: (checkpoints: Checkpoint[]) => void
  // savedEntry:地圖手動拖曳選點儲存座標成功後回報的結果,轉傳給 PaceChart
  // 讓它就地更新自己的清單(見 PaceChart.tsx 的 savedEntry prop 說明)。
  savedEntry?: { id: string; lat: number; lng: number } | null
  // tripsDrawerOpen:獨立行程抽屜(PhoneTripsDrawer.tsx,疊在這個抽屜
  // 之上)目前是否開啟——驅動下方使用者頭像旁「行程」觸發鈕的 active 樣式。
  tripsDrawerOpen: boolean
  // onOpenTrips:點擊行程觸發鈕時,開啟獨立的行程抽屜(不是切換這個抽屜
  // 自己的 mode)。
  onOpenTrips: () => void
  user: User
  // onOpenSettings:點擊右上角使用者頭像時直接開設定(不再先進選單),見
  // PhoneContent.tsx 的 SettingsScreen 疊層。
  onOpenSettings: () => void
  // onOpenShare:點擊分享按鈕時,開啟從底部滑出的分享面板(見
  // PhoneContent.tsx 的 sharePanel)——跟使用者設定同一種呈現方式,不是
  // 這個抽屜自己 .body 內的分頁切換,理由是分享/設定都是「離開目前操作
  // 情境的獨立任務」,滿版由下往上滑入比較符合這種語意,不像分享/成員
  // 按鈕過去那樣就地取代分頁內容。
  onOpenShare: () => void
  onClose: () => void
}) {
  // showMembers:成員按鈕點擊後,.body 整塊換成 MembersScreen(取代原本
  // 分頁內容)——分享已經改成獨立的滑出面板(見上方 onOpenShare),只有
  // 成員維持這個抽屜自己的行內切換。
  const [showMembers, setShowMembers] = useState(false)
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

  const items: { mode: DrawerMode; icon: typeof Timeline; title: string; disabled?: boolean }[] = [
    // TIMELINE_ENABLED/PACE_ENABLED:編譯時 feature flag,同桌面版 DesktopRail
    // 的機制(見 DesktopShared.tsx 對這兩個常數的說明)。
    ...(TIMELINE_ENABLED ? [{ mode: 'timeline' as DrawerMode, icon: Timeline, title: '時間軸', disabled: !activeTrip }] : []),
    ...(PACE_ENABLED ? [{ mode: 'pace' as DrawerMode, icon: Route, title: '路徑' }] : []),
    // DEMO_*_ENABLED:同上,各自獨立的編譯時 feature flag(見 DesktopShared.tsx
    // 對這幾個常數的說明),取代原本綁在網址參數 ?demo 底下的單一 isDemo 開關。
    ...(DEMO_CARDS_ENABLED ? [{ mode: 'demo-cards' as DrawerMode, icon: Sparkles, title: '推薦景點卡片' }] : []),
    ...(DEMO_ROW_ENABLED ? [{ mode: 'demo-row' as DrawerMode, icon: GalleryHorizontal, title: '推薦景點橫滑' }] : []),
    ...(DEMO_ONAGENT_ENABLED ? [{ mode: 'demo-onagent' as DrawerMode, icon: Radio, title: 'onagent 串接' }] : []),
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
          {/* 行程觸發鈕:放在功能列最左邊——點擊開啟獨立的行程抽屜
              (PhoneTripsDrawer.tsx,疊在這個抽屜之上),不是切換這個抽屜
              自己的 mode——行程列表已經拆成獨立抽屜,見檔案開頭的說明。 */}
          <button
            type="button"
            className={`${styles.tab}${tripsDrawerOpen ? ` ${styles.tabActive}` : ''}`}
            onClick={onOpenTrips}
            title="行程列表"
          >
            <List size={20} strokeWidth={1.8} />
          </button>
          {items.map(({ mode: m, icon: Icon, title, disabled }) => {
            // isActive:一般情況就是「目前分頁就是這顆」;例外是使用者正在
            // 獨立行程抽屜瀏覽選新行程時,先前正在看的時間軸/配速表分頁
            // 圖示要一起顯示 active(見上方 lastContentMode 的說明)。
            const isActive = mode === m || (tripsDrawerOpen && lastContentMode === m)
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
          {/* 右上角操作群組:分享/成員(操作目前選取的行程,永遠顯示,不受
              分頁切換影響)+ 使用者頭像(開設定)——見檔案開頭的說明。
              margin-left: auto 把這一群推到分頁列最右側。 */}
          <div className={styles.headerActions}>
            {activeTrip && (
              <>
                <TripMenu tripID={activeTrip.id} />
                {activeTrip.ownerID === user.id && (
                  <button type="button" className={styles.tab} onClick={onOpenShare} title="分享">
                    <Share2 size={18} strokeWidth={1.8} />
                  </button>
                )}
                <button type="button" className={styles.tab} onClick={() => setShowMembers(true)} title="成員">
                  <Users size={18} strokeWidth={1.8} />
                </button>
              </>
            )}
            <button type="button" className={styles.avatarBtn} onClick={onOpenSettings} title="設定">
              <Avatar user={user} />
            </button>
          </div>
        </div>
        <div className={styles.body}>
          {showMembers && activeTrip ? (
            <MembersScreen
              cfg={cfg}
              trip={activeTrip}
              isOwner={activeTrip.ownerID === user.id}
              onBack={() => setShowMembers(false)}
            />
          ) : mode === 'timeline' ? (
            // portal 投影目標,見上方 timelineSlotRef 的說明——這裡故意留空,
            // 實際內容(ChatScreen)由 PhoneContent.tsx 投影進來,不帶自己的
            // navbar(這個抽屜的分頁列本身就是唯一的「上方列」)。
            <div ref={timelineSlotRef} className={styles.timelineChatSlot} />
          ) : mode === 'pace' ? (
            <PaceChart
              cfg={cfg}
              tripID={activeTrip?.id}
              onCheckpointClick={onSelectedEntry}
              onRouteChange={onRouteChange}
              savedEntry={savedEntry}
            />
          ) : mode === 'trips' ? null : (
            <DemoPanelContent mode={mode} />
          )}
        </div>
      </div>
    </>
  )
}
