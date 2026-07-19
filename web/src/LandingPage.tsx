// 產品介紹 landing page:依 Tripace 行程規劃的實際功能撰寫。
// 路由:pathname = /(見 App.tsx)。全寬呈現,不套 iPhone 外框。
import {
  MessageSquareText, CalendarRange, Layers, Search,
  Users, Share2, Navigation,
} from 'lucide-react'
import './landing.css'

// 產品核心功能,對齊 App 實作(assist 記事、時間軸、行程歸組、語意查詢、協作、分享、導航)。
const FEATURES = [
  {
    icon: MessageSquareText,
    title: '一句話記事',
    desc: '用自然口語說出行程,AI 自動判斷該記錄還是回答,並把口語整理成事項、時間與地點。',
  },
  {
    icon: CalendarRange,
    title: '多軌時間軸',
    desc: '行程依時間自動排列成時間軸,跨日行程以主線串連,點一下即可展開細節。',
  },
  {
    icon: Layers,
    title: '行程自動歸組',
    desc: '零散的事項會依時間自動歸組成一趟趟行程,不必手動分類整理。',
  },
  {
    icon: Search,
    title: '自然語言查詢',
    desc: '「退房是幾號?」直接問頻道就好,AI 讀懂行程後立刻回答。',
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

// 三步驟流程:說 → 整理 → 成行。
const STEPS = [
  { n: '1', title: '說出來', desc: '「7/20 早上 10 點東京車站集合,晚上住新宿。」' },
  { n: '2', title: '自動整理', desc: 'AI 抽出事項、時間、地點,寫成結構化條目。' },
  { n: '3', title: '成一趟行程', desc: '條目排上時間軸、歸成行程,分享給同行的人。' },
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
          <Navigation size={14} strokeWidth={2} /> 行程規劃,說一句話就好
        </span>
        <h1 className="landing-title">
          用口語把行程<br />變成<span className="lp-accent">一目了然的時間軸</span>
        </h1>
        <p className="landing-subtitle">
          Tripace 讓你用自然語言記錄行程,AI 自動整理成事項、時間與地點,
          排上時間軸、歸成一趟行程,還能和同行的人一起編輯、分享。
        </p>
        <div className="landing-cta-row">
          <a className="landing-btn-primary" href="/app">免費開始</a>
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
        <h2 className="landing-final-title">下一趟旅程,從一句話開始</h2>
        <a className="landing-btn-primary" href="/app">立即開始規劃</a>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">Tripace · 行程規劃</span>
      </footer>
    </div>
  )
}
