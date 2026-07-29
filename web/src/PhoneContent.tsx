import { useState } from 'react'
import { Sparkles, GalleryHorizontal, Map, Wrench, Radio, Bike, Menu, X } from 'lucide-react'
import { ChatScreen } from './ChatScreen'
import { PacePhoneSwipe } from './PacePhoneSwipe'
import {
  useIsDesktop, LoginForm, LoginCard,
  type ContentProps,
} from './AppCommon'
import {
  type DemoPanelMode, DemoPanelContent,
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
  // demoDrawerOpen/demoPanelMode:手機版存取 demo 面板(DemoPanelContent,
  // 見上方 import)的入口。桌面版本來就有 DesktopRail 可以切換這些面板,不需要
  // 這組 state——isDesktop 為 true 時下面會直接 return <DesktopContent>,
  // 不會走到用這組 state 的漢堡按鈕/抽屜。
  const [demoDrawerOpen, setDemoDrawerOpen] = useState(false)
  const [demoPanelMode, setDemoPanelMode] = useState<DemoPanelMode>('demo-pace')

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

  // 漢堡按鈕/抽屜只在網址帶 ?demo 時出現,跟桌面版 DesktopRail 的 demo 項目
  // 用同一個 isDemo 閘門——正式的手機版體驗完全不受影響、不多出任何按鈕。
  if (!props.isDemo) return content

  return (
    <>
      {content}
      <button
        type="button"
        className="phone-demo-hamburger"
        onClick={() => setDemoDrawerOpen(true)}
        title="Demo 面板(?demo)"
      >
        <Menu size={20} strokeWidth={2} />
      </button>
      {demoDrawerOpen && (
        <PhoneDemoDrawer
          mode={demoPanelMode}
          onSelect={setDemoPanelMode}
          onClose={() => setDemoDrawerOpen(false)}
        />
      )}
    </>
  )
}

// PhoneDemoDrawer:手機版存取 demo 面板的全螢幕疊層,只從上面 PhoneContent
// 的漢堡按鈕開啟。上排是 6 個 demo 面板的迷你按鈕列(圖示對齊 DesktopRail
// 用的同一組,維持視覺一致性),不整顆搬 DesktopRail 過來——那顆混了頻道
// 列表/時間軸/設定/登出的切換,手機版本來就有自己的入口,搬過來只是多餘。
function PhoneDemoDrawer({
  mode,
  onSelect,
  onClose,
}: {
  mode: DemoPanelMode
  onSelect: (mode: DemoPanelMode) => void
  onClose: () => void
}) {
  const items: { mode: DemoPanelMode; icon: typeof Sparkles; title: string }[] = [
    { mode: 'demo-cards', icon: Sparkles, title: '推薦景點卡片' },
    { mode: 'demo-row', icon: GalleryHorizontal, title: '推薦景點橫滑' },
    { mode: 'demo-map', icon: Map, title: '推薦景點地圖' },
    { mode: 'demo-clienttools', icon: Wrench, title: 'ClientToolsBridge' },
    { mode: 'demo-onagent', icon: Radio, title: 'onagent 串接' },
    { mode: 'demo-pace', icon: Bike, title: '單車配速表' },
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
        {mode === 'demo-pace' ? <PacePhoneSwipe /> : <DemoPanelContent mode={mode} />}
      </div>
    </div>
  )
}
