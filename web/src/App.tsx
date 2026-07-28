import { useEffect, useState } from 'react'
import {
  X,
  Sparkles, GalleryHorizontal, Map, Navigation, Wrench, Radio, Bike, Menu,
} from 'lucide-react'
import { LandingPage } from './LandingPage'
import { CliAuthPage } from './CliAuthPage'
import { ChatScreen } from './ChatScreen'
import { PaceChartDemo } from './PaceChartDemo'
import { PaceRouteMap } from './PaceRouteMap'
import { PacePhoneSwipe } from './PacePhoneSwipe'
import {
  useAppState, LoginForm,
  type ContentProps,
} from './AppCommon'
import {
  type DemoPanelMode, DemoPanelContent,
} from './DesktopShared'
import { DesktopContent } from './DesktopLayout'
import { ChannelsScreen, PublicViewScreen, SettingsScreen } from './PhoneScreens'

// 桌面版斷點,需與 styles.css 的 @media (min-width: 768px) 一致。
const DESKTOP_BREAKPOINT = 768

// useIsDesktop:用 matchMedia 判斷目前寬度是否達到桌面斷點。
// 用 JS 判斷、只渲染其中一種佈局(而非兩份 DOM 都渲染、用 CSS 切換顯示),
// 是因為 ChatScreen 掛載時會建立 WebSocket 連線並各自 fetch 資料——
// 若手機版與桌面版兩棵 DOM 同時存在,選中頻道時會同時掛載兩個 ChatScreen,
// 造成重複連線與重複請求。
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

export function App({ isDemo = false }: { isDemo?: boolean } = {}) {
  const props = useAppState()
  // 根路徑渲染產品介紹 landing page(全寬,不套 phone 外框)
  if (window.location.pathname === '/') {
    return <LandingPage />
  }
  // 偵測 /public/{token} 路徑，直接渲染公開分享頁
  const publicMatch = window.location.pathname.match(/^\/public\/([^/]+)$/)
  if (publicMatch) {
    return (
      <div className="web-app">
        <PublicViewScreen token={publicMatch[1]} />
      </div>
    )
  }
  // /cli-auth 路徑:`tripace-cli login --web` 開瀏覽器落地的核准頁面
  // (見 CliAuthPage.tsx)。與 /public/{token} 一樣是獨立於主要 App 狀態機
  // 之外的頁面,不套用 PhoneContent 那套登入/頻道/聊天畫面切換邏輯。
  if (window.location.pathname === '/cli-auth') {
    return (
      <div className="web-app">
        <CliAuthPage />
      </div>
    )
  }
  // /demo/pace 路徑:配速表 demo 的公開分享頁(見 PaceChartDemo.tsx 的
  // 「分享這個配速表」按鈕)。這是固定示範資料(花東193公路),不是真實
  // 使用者頻道,不需要登入、不涉及任何真實資料權限問題——跟 /public/{token}
  // 那套給真實頻道用的公開分享是分開的機制,不走後端建立/驗證 token 那套
  // 流程,單純是一個固定網址。
  if (window.location.pathname === '/demo/pace') {
    return (
      <div className="web-app">
        <PublicPaceDemoPage />
      </div>
    )
  }
  // /app 路徑:主要應用畫面本體(套 iPhone 外框,寬螢幕自動切桌面版佈局)
  return (
    <div className="web-app">
      <PhoneContent {...props} isDemo={isDemo} />
    </div>
  )
}

// PublicPaceDemoPage:/demo/pace 的公開分享頁內容(見 App() 的路由判斷)。
// 版型直接比照登入後 demo-pace 面板的樣子(側欄清單 + 主區地圖,見
// DesktopContent 的 demo-pace 分支),只是不放最左側的 DesktopRail(頻道/
// 時間軸/使用者選單那條圖示列,公開頁不需要、也沒有登入身分可以顯示)。
// 沿用同一套 .desktop-sidepanel/.desktop-main class,不是重新設計一份
// 版型;.desktop-layout 底下少了 DesktopRail 這個 flex sibling 不影響
// sidepanel/main 各自的排版,不需要額外 CSS。手機寬度沿用跟登入後手機版
// 一致的 PacePhoneSwipe(滑動雙頁),不需要另外做一份。
function PublicPaceDemoPage() {
  const isDesktop = useIsDesktop()
  if (!isDesktop) {
    return <PacePhoneSwipe />
  }
  return (
    <div className="desktop-layout">
      <aside className="desktop-sidepanel wide">
        <div className="desktop-sidepanel-inner">
          <div className="desktop-sidepanel-pace">
            <PaceChartDemo />
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        <div className="desktop-demo-panel">
          <PaceRouteMap />
        </div>
      </main>
    </div>
  )
}

export function PhoneContent(props: ContentProps) {
  const { cfg, activeChannel, setActiveChannel } = props
  const [inSettings, setInSettings] = useState(false)
  // 寬度 >= 768px:改走桌面版佈局(側欄 + 主要區塊)。登入前不分寬度,一律走下面的
  // 登入畫面(登入前沒有頻道/聊天可看,不必特地做桌面版登入版面)。
  const isDesktop = useIsDesktop()
  // demoDrawerOpen/demoPanelMode:手機版存取 demo 面板(DemoPanelContent,
  // 見上方定義)的入口。桌面版本來就有 DesktopRail 可以切換這些面板,不需要
  // 這組 state——isDesktop 為 true 時下面會直接 return <DesktopContent>,
  // 不會走到用這組 state 的漢堡按鈕/抽屜。
  const [demoDrawerOpen, setDemoDrawerOpen] = useState(false)
  const [demoPanelMode, setDemoPanelMode] = useState<DemoPanelMode>('demo-pace')

  if (props.isGuest) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-logo">
              <Navigation size={20} strokeWidth={2} />
              <span>Tripace</span>
            </div>
            <div className="login-card-title">歡迎使用 Tripace</div>
            <div className="login-card-subtitle">請先登入或註冊帳號,才能查看與使用行程功能。</div>
          </div>
          <LoginForm baseURL={cfg.baseURL} onAuthed={props.onAuthed} />
        </div>
      </div>
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

