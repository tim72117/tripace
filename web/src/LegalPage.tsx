// LegalPage:隱私權政策/服務條款共用的頁面殼——視覺對齊 KyotoExploreBloom
// 的紙感和風風格(見 LegalPage.css 開頭的 token 對應說明),取代原本沿用
// landing.css 的 .legal-*(藍綠度假風,跟 LandingPage 一致但跟
// KyotoExploreBloom 語言不同)。內容本身很單純(純文字段落),不需要像
// KyotoExploreBloom 那樣的捲動視差/hero,故只借用它的配色 token、字體與
// footer 結構,不搬動它的捲動動畫邏輯。
//
// 日夜間切換沿用 KyotoExploreBloom.tsx 同一套「本地 state、寫進根節點
// data-theme」機制(不是全站共用的 theme context——目前專案沒有這樣的
// 全域機制,KyotoExploreBloom 本身也是頁面各自獨立管理),讓這兩個法律頁
// 在視覺與互動細節上都跟它保持一致。
import { type ReactNode, useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './LegalPage.css'

export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt: string
  children: ReactNode
}) {
  // theme/systemPrefersDark/isCurrentlyDark:跟 KyotoExploreBloom.tsx 完全
  // 相同的邏輯(見該檔案對應註解)——theme 為 null 時跟隨系統
  // prefers-color-scheme,按下切換鈕後才有明確值,之後在 dark/light 間互切。
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null)
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const isCurrentlyDark = (t: 'dark' | 'light' | null) => (t === null ? systemPrefersDark : t === 'dark')

  return (
    <div className="legal-bloom" data-theme={theme ?? undefined}>
      <header className="legal-nav">
        <div className="legal-nav-inner">
          <a className="legal-logo" href="/">Tripace</a>
          <div className="legal-nav-right">
            <button
              type="button"
              className="legal-theme-toggle"
              onClick={() => setTheme((t) => (isCurrentlyDark(t) ? 'light' : 'dark'))}
              title={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
              aria-label={isCurrentlyDark(theme) ? '切換成日間模式' : '切換成夜間模式'}
            >
              {isCurrentlyDark(theme) ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
            </button>
            <a className="legal-nav-cta" href="/app">開始使用</a>
          </div>
        </div>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">最後更新:{updatedAt}</p>
        <div className="legal-body">{children}</div>
      </main>

      <footer className="legal-footer">
        <span className="legal-footer-brand">Tripace · 行程規劃</span>
        <div className="legal-footer-bar">
          <span className="legal-footer-copyright">Copyright © 2026 Tripace</span>
          <nav className="legal-footer-links">
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a href="#">聯絡我們</a>
          </nav>
        </div>
        <a
          className="legal-footer-poweredby"
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
