// NotFoundPage:真正的 404 頁面,路由 catch-all(見 App.tsx)渲染此元件。
// 視覺對齊 LegalPage.tsx/HomePage.tsx 的紙感和風風格(見 LegalPage.css
// 開頭的 token 對應說明)——原本沿用 landing.css 的 .legal-*(藍綠度假風,
// 跟舊版 LandingPage 一致但跟現在的首頁語言不同,是 LegalPage.tsx 遷移前
// 遺留的同款過時狀態)。直接複用 LegalPage.css 已有的 class(不重複定義
// 一份幾乎相同的樣式),理由同 LegalPage.tsx 本身:內容很單純(一段訊息 +
// 回首頁連結),不需要 HomePage 那樣的捲動視差/hero,只借用配色 token、
// 字體與導覽/footer 結構。
//
// 這個元件本身不負責回傳 HTTP 404 狀態碼——狀態碼由後端
// server/cmd/server/static.go 依路徑是否符合已知路由 pattern 決定,
// 前端只負責在「後端已經判定要送 404 狀態碼」的情況下,把畫面渲染成
// 對使用者友善的樣子,而不是丟給瀏覽器原生的空白錯誤頁。
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import './LegalPage.css'

export function NotFoundPage() {
  // theme/systemPrefersDark/isCurrentlyDark:跟 LegalPage.tsx/HomePage.tsx
  // 完全相同的日夜間切換邏輯(見該兩個檔案對應註解)——theme 為 null 時
  // 跟隨系統 prefers-color-scheme,按下切換鈕後才有明確值,之後在
  // dark/light 間互切。
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
        <h1 className="legal-title">找不到這個頁面</h1>
        <p className="legal-updated">
          這個網址可能打錯了,或是你要找的分享連結已經失效。
        </p>
        <div className="legal-body">
          <p>
            <a href="/">回到首頁</a>看看,或是重新向對方索取一次分享連結。
          </p>
        </div>
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
