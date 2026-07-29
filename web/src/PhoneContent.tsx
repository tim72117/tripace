import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sparkles, GalleryHorizontal, Map, Wrench, Radio, Route, Menu, X } from 'lucide-react'
import { ChatScreen } from './ChatScreen'
import { PacePhoneSwipe } from './PacePhoneSwipe'
import {
  useIsDesktop, LoginForm, LoginCard,
  type ContentProps,
} from './AppCommon'
import {
  type DemoPanelMode, isPanelMode, DemoPanelContent,
} from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { ChannelsScreen, SettingsScreen } from './PhoneScreens'

// PhoneContent:手機版(寬度 < 768px)主要應用狀態切換器——登入畫面/桌面版
// 導轉/聊天室/設定/頻道列表,見 App.tsx App() 的 /app 路由分支。
// PhoneDemoDrawer(下方)是這個檔案內部專屬的子元件,只從這裡的漢堡按鈕
// 開啟,不對外匯出。
export function PhoneContent(props: ContentProps) {
  const { cfg, activeChannel, setActiveChannel } = props
  const [inSettings, setInSettings] = useState(false)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有頻道/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // demoDrawerOpen:抽屜開關本身是純 UI state,不進 URL——使用者收合/展開
  // 抽屜不該影響網址或瀏覽器上一頁/下一頁的行為(手機版一般抽屜/彈層都不會
  // 佔用瀏覽器歷史記錄)。
  //
  // demoPanelMode:改用路徑參數驅動,跟桌面版 DesktopContent 的 panelMode
  // 共用同一個 /app/:panelMode 路由——桌面版側欄跟這裡手機版抽屜承載的是
  // 同一組值,語意上是「同一個狀態,只是呈現方式不同(側欄 vs 抽屜)」,不是
  // 各自獨立的兩個狀態。好處是使用者縮放視窗跨越桌面/手機斷點時,網址不必
  // 跳轉、狀態自然延續。
  //
  // 網址沒帶 panelMode、或帶了 channels/timeline(桌面版側欄專屬,手機版沒有
  // 對應的抽屜分頁)或其他不合法字串時,fallback 成 'pace'——維持原本
  // useState 初始值的行為:手機版漢堡按鈕開啟的抽屜預設落在配速表。
  const [demoDrawerOpen, setDemoDrawerOpen] = useState(false)
  const { panelMode: panelModeParam } = useParams<{ panelMode?: string }>()
  const demoPanelMode: PaceDrawerMode =
    isPanelMode(panelModeParam) && panelModeParam !== 'channels' && panelModeParam !== 'timeline'
      ? panelModeParam
      : 'pace'
  const navigate = useNavigate()
  const setDemoPanelMode = (mode: PaceDrawerMode) => navigate(`/app/${mode}`)

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

  const content = activeChannel ? (
    <ChatScreen
      cfg={cfg}
      channel={activeChannel}
      user={props.user}
      onBack={() => setActiveChannel(null)}
    />
  ) : inSettings ? (
    <SettingsScreen
      cfg={props.cfg}
      user={props.user}
      email={props.email}
      isGuest={props.isGuest}
      onAuthed={props.onAuthed}
      onLogout={() => { props.onLogout(); setInSettings(false) }}
      onBack={() => setInSettings(false)}
    />
  ) : (
    <ChannelsScreen
      cfg={props.cfg}
      user={props.user}
      isGuest={props.isGuest}
      onAuthed={props.onAuthed}
      onOpen={(c) => setActiveChannel(c)}
      onOpenSettings={() => setInSettings(true)}
    />
  )

  // 漢堡按鈕/抽屜:配速表('pace')是正式功能,永遠顯示、不受 isDemo 閘門
  // 限制;其餘 demo-* 分頁只在網址帶 ?demo 時才會出現在抽屜的分頁列裡
  // (見下方 PhoneDemoDrawer 的 items),維持正式使用者只看得到配速表一項、
  // ?demo 使用者能看到全部分頁。
  return (
    <>
      {content}
      <button
        type="button"
        className="phone-demo-hamburger"
        onClick={() => setDemoDrawerOpen(true)}
        title={props.isDemo ? 'Demo 面板(?demo)' : '配速表'}
      >
        {props.isDemo ? <Menu size={20} strokeWidth={2} /> : <Route size={20} strokeWidth={1.8} />}
      </button>
      {demoDrawerOpen && (
        <PhoneDemoDrawer
          mode={demoPanelMode}
          onSelect={setDemoPanelMode}
          onClose={() => setDemoDrawerOpen(false)}
          isDemo={!!props.isDemo}
        />
      )}
    </>
  )
}

// PaceDrawerMode:PhoneDemoDrawer 的分頁狀態——正式功能 'pace'(配速表)
// 一定存在,其餘 DemoPanelMode 只在 isDemo 時才會出現在分頁列,但型別上
// 仍允許,因為同一個 state 在 isDemo 切換時可能停留在上次選過的 demo 分頁。
type PaceDrawerMode = DemoPanelMode | 'pace'

// PhoneDemoDrawer:手機版存取配速表 + demo 面板的全螢幕疊層,只從上面
// PhoneContent 的按鈕開啟。'pace' 分頁(配速表)永遠顯示在分頁列最前面,
// 是正式功能;其餘 5 個 demo 面板分頁只在 isDemo 時才出現(圖示對齊
// DesktopRail 用的同一組,維持視覺一致性),不整顆搬 DesktopRail 過來——
// 那顆混了頻道列表/時間軸/設定/登出的切換,手機版本來就有自己的入口,
// 搬過來只是多餘。
function PhoneDemoDrawer({
  mode,
  onSelect,
  onClose,
  isDemo,
}: {
  mode: PaceDrawerMode
  onSelect: (mode: PaceDrawerMode) => void
  onClose: () => void
  isDemo: boolean
}) {
  const items: { mode: PaceDrawerMode; icon: typeof Sparkles; title: string }[] = [
    { mode: 'pace', icon: Route, title: '配速表' },
    ...(isDemo
      ? [
        { mode: 'demo-cards' as PaceDrawerMode, icon: Sparkles, title: '推薦景點卡片' },
        { mode: 'demo-row' as PaceDrawerMode, icon: GalleryHorizontal, title: '推薦景點橫滑' },
        { mode: 'demo-map' as PaceDrawerMode, icon: Map, title: '推薦景點地圖' },
        { mode: 'demo-clienttools' as PaceDrawerMode, icon: Wrench, title: 'ClientToolsBridge' },
        { mode: 'demo-onagent' as PaceDrawerMode, icon: Radio, title: 'onagent 串接' },
      ]
      : []),
  ]
  return (
    <div className="phone-demo-drawer">
      <div className="phone-demo-drawer-tabs">
        {items.map(({ mode: m, icon: Icon, title }) => (
          <button
            key={m}
            type="button"
            className={`phone-demo-drawer-tab${mode === m ? ' active' : ''}`}
            onClick={() => onSelect(m)}
            title={title}
          >
            <Icon size={20} strokeWidth={1.8} />
          </button>
        ))}
        <button type="button" className="phone-demo-drawer-close" onClick={onClose} title="關閉">
          <X size={20} strokeWidth={1.8} />
        </button>
      </div>
      <div className="phone-demo-drawer-body">
        {mode === 'pace' ? <PacePhoneSwipe /> : <DemoPanelContent mode={mode} />}
      </div>
    </div>
  )
}
