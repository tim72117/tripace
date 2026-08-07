// 產品介紹 landing page:依 Tripace 行程規劃的實際功能撰寫。
// 路由:pathname = /(見 App.tsx)。全寬呈現,不套 iPhone 外框。
import {
  Map, CalendarRange, Route, Search,
  Users, Share2, Navigation,
} from 'lucide-react'
import './landing.css'

// 產品核心功能,對齊 App 實作(地圖探索候選籃、拖曳排程、時間軸、路徑地圖、語意查詢、協作、分享)。
const FEATURES = [
  {
    icon: Map,
    title: '地圖探索候選籃',
    desc: '在地圖上瀏覽附近的飯店、景點、餐廳,喜歡的先丟進候選籃,不用馬上決定排哪一天。',
  },
  {
    icon: CalendarRange,
    title: '拖曳排入日程',
    desc: '把候選拖進日層架的某一天,立刻變成正式的行程項目;還沒想好的維持候選狀態,不佔行程版面。',
  },
  {
    icon: Route,
    title: '路徑地圖',
    desc: '把行程地點串成路線畫在地圖上,沿路檢查站一目了然,騎乘/駕駛時還能看自己現在到哪。',
  },
  {
    icon: Search,
    title: '自然語言查詢',
    desc: '「退房是幾號?」直接問行程就好,AI 讀懂行程後立刻回答。',
  },
  {
    icon: Users,
    title: '協作與權限',
    desc: '邀請同行者一起加入行程,可共同編輯或僅查看,權限分明。',
  },
  {
    icon: Share2,
    title: '公開分享連結',
    desc: '產生分享連結,把行程傳給任何人,不需下載 App 或註冊就能直接打開查看。',
  },
]

// 三步驟流程:探索 → 拖曳排入 → 成行。
const STEPS = [
  { n: '1', title: '探索', desc: '在地圖上瀏覽附近的飯店、景點、餐廳,點喜歡的地方丟進候選籃。' },
  { n: '2', title: '拖曳排入', desc: '把候選拖進日層架的某一天,馬上變成正式的行程項目。' },
  { n: '3', title: '成一趟行程', desc: '項目排上時間軸、標在地圖上,分享給同行的人。' },
]

export function LandingPage() {
  return (
    <div className="landing">
      {/* 導覽列 */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">Tripace</span>
          <a className="landing-nav-cta" href="/app">開始使用</a>
        </div>
      </header>

      {/* 主視覺 */}
      <section className="landing-hero">
        <span className="landing-eyebrow">
          <Navigation size={14} strokeWidth={2} /> 行程規劃,從地圖開始
        </span>
        <h1 className="landing-title">
          在地圖上探索,<br />拖曳就<span className="lp-accent">排進行程</span>
        </h1>
        <p className="landing-subtitle">
          Tripace 讓你在地圖上瀏覽飯店、景點與餐廳,喜歡的先丟進候選籃,
          想好哪天要去,直接拖進日層架就成一趟行程,還能和同行的人一起編輯、分享。
        </p>
        <div className="landing-cta-row">
          <a className="landing-btn-primary" href="/app">開始規劃</a>
        </div>
      </section>

      {/* 功能區 */}
      <section className="landing-features">
        <h2 className="landing-section-title">你需要的行程功能,都在這裡</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-feature-card">
              <div className="landing-feature-ico">
                <f.icon size={20} strokeWidth={1.8} />
              </div>
              <div className="landing-feature-title">{f.title}</div>
              <div className="landing-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 流程區 */}
      <section className="landing-how">
        <h2 className="landing-section-title">三步,就成一趟行程</h2>
        <div className="landing-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="landing-step">
              <div className="landing-step-num">{s.n}</div>
              <div className="landing-step-title">{s.title}</div>
              <div className="landing-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 結尾行動呼籲 */}
      <section className="landing-final">
        <h2 className="landing-final-title">下一趟旅程,從地圖開始探索</h2>
        <a className="landing-btn-primary" href="/app">立即開始規劃</a>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">Tripace · 行程規劃</span>
        {/* 法律資訊列(隱私權政策/條款等)——目前這幾個連結還沒有對應頁面,
            先建立版面結構,連結指向的頁面之後補上時直接換 href 即可。 */}
        <div className="landing-footer-bar">
          <span className="landing-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="landing-footer-links">
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        {/* powered-by:單純的信用背書/合作標註,連到 onagent 平台官網——
            不代表 onagent 目前是正式功能的必要依賴(見 clienttools/
            OnagentBridgeDemo.tsx,那是預設關閉的試做面板),純粹是想在
            首頁掛上這個連結。 */}
        <a
          className="landing-footer-poweredby"
          href="https://onagent.shuttle.tools"
          target="_blank"
          rel="noreferrer"
        >
          Powered by onagent
        </a>
      </footer>
    </div>
  )
}
