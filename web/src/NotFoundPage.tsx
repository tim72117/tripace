// NotFoundPage:真正的 404 頁面,路由 catch-all(見 App.tsx)渲染此元件。
// 沿用 landing.css 的導覽列/footer 視覺語言(比照 LegalPage.tsx),但不用
// LegalPage 本身——404 不是條款類的長文內容,不需要 legal-title/legal-body
// 那套排版,直接寫一組簡短的置中訊息 + 回首頁按鈕。
//
// 這個元件本身不負責回傳 HTTP 404 狀態碼——狀態碼由後端
// server/cmd/server/static.go 依路徑是否符合已知路由 pattern 決定,
// 前端只負責在「後端已經判定要送 404 狀態碼」的情況下,把畫面渲染成
// 對使用者友善的樣子,而不是丟給瀏覽器原生的空白錯誤頁。
import './landing.css'

export function NotFoundPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="landing-logo" href="/" style={{ textDecoration: 'none' }}>Tripace</a>
          <a className="landing-nav-cta" href="/app">開始使用</a>
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
