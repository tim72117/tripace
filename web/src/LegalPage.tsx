// LegalPage:隱私權政策/服務條款共用的頁面殼——沿用 landing.css 的視覺
//語言(導覽列/footer 跟 LandingPage 一致),讓使用者從首頁 footer 點過來
// 時不會覺得跳到另一個網站。內容本身很單純(純文字段落),不需要像
// LandingPage 那樣的 hero/功能卡片版面,故另外用一組窄版 .legal-* class,
// 不重用 .landing-hero/.landing-features 那些寬版排版。
import type { ReactNode } from 'react'
import './landing.css'

export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt: string
  children: ReactNode
}) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="landing-logo" href="/" style={{ textDecoration: 'none' }}>Tripace</a>
          <a className="landing-nav-cta" href="/app">開始使用</a>
        </div>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">最後更新:{updatedAt}</p>
        <div className="legal-body">{children}</div>
      </main>

      <footer className="landing-footer">
        <span className="landing-footer-brand">Tripace · 行程規劃</span>
        <div className="landing-footer-bar">
          <span className="landing-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="landing-footer-links">
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
