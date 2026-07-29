import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { ChatScreen, type DesktopTimelineMirror } from './ChatScreen'
import {
  useIsDesktop, useChannelsState, LoginForm, LoginCard,
  type ContentProps,
} from './AppCommon'
import { isPanelMode } from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { SettingsScreen } from './PhoneScreens'
import { PaceRouteMap, type SelectedEntry } from './PaceRouteMap'
import { PhoneNavDrawer, type DrawerMode } from './PhoneNavDrawer'
import type { Channel } from './types'
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
// ChannelsScreen、ChatScreen 自己的右側時間軸抽屜,與右下角漢堡按鈕開的
// PhoneDemoDrawer。
//
// 主顯示區(抽屜關閉後看到的內容)對齊桌面版 DesktopContent 的
// .desktop-main 邏輯:選到的分頁是 'pace' 時顯示 PaceRouteMap(地圖),
// 其餘情況顯示 ChatScreen(有選頻道)或空白提示(沒有)——'channels'/
// 'timeline' 分頁不影響主顯示,只影響抽屜欄裡的內容,同桌面版
// isSidepanelMode 的邏輯。
export function PhoneContent(props: ContentProps) {
  const { cfg, activeChannel, setActiveChannel } = props
  const [inSettings, setInSettings] = useState(false)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有頻道/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // drawerOpen:抽屜開關本身是純 UI state,不進 URL——使用者收合/展開抽屜
  // 不該影響網址或瀏覽器上一頁/下一頁的行為。初始值取決於進入當下有沒有
  // 已選的頻道:還沒選頻道時預設開啟(維持「一進 App 先看到行程列表」的
  // 既有使用者習慣),已有 activeChannel(例如熱重載後恢復狀態)則不強制
  // 開啟,直接顯示 ChatScreen。
  const [drawerOpen, setDrawerOpen] = useState(!activeChannel)
  // drawerMode:改用路徑參數驅動,跟桌面版 DesktopContent 的 panelMode 共用
  // 同一個 /app/:panelMode 路由——理由與既有設計相同,使用者縮放視窗跨越
  // 桌面/手機斷點時網址不必跳轉、狀態自然延續。網址沒帶 panelMode 或帶了
  // 不合法字串時,fallback 成 'channels'——對應抽屜預設開啟時應該看到的
  // 分頁。
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  const drawerMode: DrawerMode = isPanelMode(panelModeParam) ? panelModeParam : 'channels'
  const navigate = useNavigate()
  // lastContentMode:記住使用者上一次主動選取的「時間軸」或「配速表」分頁
  // (兩者是同一組內容切換,'channels' 分頁只是拿來挑選行程的工具畫面,不
  // 屬於這組要記住的內容狀態)。切到行程列表分頁選新行程時,drawerMode
  // 必然暫時變成 'channels'(選頻道這個動作只能在那個分頁做)——這段期間
  // lastContentMode 仍保留原值不變,驅動 PhoneNavDrawer 讓「行程列表」跟
  // 剛剛正在看的那個分頁「同時」顯示成 active(使用者觀點:行程列表只是
  // 暫時借用的工具畫面,不是真的離開了時間軸/配速表這個內容模式);選完
  // 行程後再靠這個值把使用者帶回選擇行程「之前」正在看的內容。用 state
  // (而非 ref)是因為現在需要驅動 UI(tab 的 active 樣式),不能只是純暫存值。
  const [lastContentMode, setLastContentMode] = useState<'pace' | 'timeline' | null>(null)
  // setDrawerMode:再點一次「目前實際所在」的那個分頁(不是視覺上顯示 active
  // 的那些,見 PhoneNavDrawer.tsx 的 isActive 判斷——'channels' 分頁瀏覽時
  // lastContentMode 對應的圖示也會顯示 active,但那不是「目前所在」的分頁)
  // 時關閉抽屜,對齊桌面版 DesktopLayout.tsx 的 setPanelMode:再點一次目前
  // 啟用中的 rail 圖示會收合側欄,這裡收合的手機版等價行為就是關閉抽屜。
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
  // selectChannel:切換使用中的行程,並且——若使用者選行程前正在看時間軸
  // 或配速表(lastContentMode 有值)——選完後帶回同一個分頁,只是資料换成
  // 新行程的(時間軸/配速表元件都是依 activeChannel 反應式讀資料,不需要
  // 額外處理)。若使用者是從尚未看過時間軸/配速表的狀態選行程(lastContentMode
  // 為 null,例如剛進 App 第一次選),維持原行為:留在 'channels' 分頁、
  // 關閉抽屜直接看對話。
  const selectChannel = (c: Channel) => {
    setActiveChannel(c)
    setDrawerOpen(false)
    if (lastContentMode) {
      navigate(`/app/${lastContentMode}`)
    }
  }

  // useChannelsState 提升到這裡頂層常駐呼叫(不只在抽屜開啟時才掛載)——
  // 這個 hook 內建「若 localStorage 記錄過預設頻道,channels 載入後自動
  // onOpen() 跳進該頻道」的既有行為,必須從一開始就掛載才不會漏掉這個自動
  // 導覽,理由與桌面版 DesktopChannelList 掛載時機一致(桌面版預設就落在
  // 'channels' 分頁,同樣一開始就會掛載)。
  const {
    channels, err: channelsErr, loading: channelsLoading,
    creating, setCreating,
    newName, setNewName,
    submitCreate,
  } = useChannelsState(cfg, selectChannel)

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

  return (
    <>
      {drawerMode === 'pace' ? (
        // 配速表分頁:主顯示區改成地圖(對齊桌面版 .desktop-main 在
        // panelMode === 'pace' 時顯示 PaceRouteMap 的邏輯),檢查站清單留在
        // 抽屜欄裡(見下方 PhoneNavDrawer 的 mode === 'pace' 分支)。
        // PaceRouteMap 本身不含 navbar(桌面版直接嵌在 .desktop-main 裡滿版
        // 顯示,不需要),這裡額外包一層跟 ChatScreen/PhoneEmptyState 同款
        // 的 navbar,確保左上角展開抽屜欄按鈕在所有主顯示畫面都一致存在,
        // 不會因為切到配速表分頁就找不到入口。
        <>
          <div className="navbar">
            <button className="btn icon-btn" onClick={() => setDrawerOpen(true)} title="行程列表/時間軸">
              <Menu size={20} strokeWidth={1.8} />
            </button>
            <span className="title">配速表</span>
            <span style={{ width: 36 }} />
          </div>
          <PaceRouteMap selectedEntry={selectedEntry} onSelectedEntryDone={() => setSelectedEntry(null)} />
        </>
      ) : activeChannel ? (
        <ChatScreen
          cfg={cfg}
          channel={activeChannel}
          user={props.user}
          onBack={() => setActiveChannel(null)}
          onOpenDrawer={() => setDrawerOpen(true)}
          onTimelineData={onTimelineData}
        />
      ) : (
        <PhoneEmptyState onOpenDrawer={() => setDrawerOpen(true)} />
      )}
      <PhoneNavDrawer
        open={drawerOpen}
        cfg={cfg}
        mode={drawerMode}
        onSelectMode={setDrawerMode}
        isDemo={!!props.isDemo}
        channels={channels}
        channelsErr={channelsErr}
        channelsLoading={channelsLoading}
        creating={creating}
        setCreating={setCreating}
        newName={newName}
        setNewName={setNewName}
        submitCreate={submitCreate}
        activeChannel={activeChannel}
        onSelectChannel={selectChannel}
        timelineMirror={timelineMirror}
        lastContentMode={lastContentMode}
        user={props.user}
        onSelectedEntry={setSelectedEntry}
        onOpenSettings={() => setInSettings(true)}
        onClose={() => setDrawerOpen(false)}
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
    </>
  )
}

// PhoneEmptyState:抽屜關閉且尚未選擇任何行程時,主要內容區顯示的提示畫面
// ——對應桌面版 DesktopLayout.tsx 的 .desktop-empty-state「選擇一個行程
// 開始」,只是這裡多一顆左上角常駐按鈕(跟 ChatScreen 同一個位置)可以
// 重新開啟抽屜。
function PhoneEmptyState({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <>
      <div className="navbar">
        <button className="btn icon-btn" onClick={onOpenDrawer} title="行程列表/配速表">
          <Menu size={20} strokeWidth={1.8} />
        </button>
        <span className="title">Tripace</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        <div className="empty">選擇一個行程開始</div>
      </div>
    </>
  )
}
