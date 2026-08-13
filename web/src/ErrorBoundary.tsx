import { Component, type ErrorInfo, type ReactNode } from 'react'

// 全站唯一的 React Error Boundary，包在 App.tsx 的 <Routes> 外層。
//
// 背景：HomePage.tsx 內有一段用 document.createElement 手刻 DOM 的
// useEffect（地圖、bloom 圖層等），曾發生過在沒有防護的情況下呼叫
// `new IntersectionObserver(...)`——若執行環境不支援這個 API（例如某些
// 受限的無頭渲染器）會直接拋出 ReferenceError，讓 React 把整棵樹 unmount
// 到最近的 error boundary；而先前完全沒有 error boundary，導致 React 把
// 失敗點之後的畫面整個留空，只剩下 mount 時已 commit 的內容（例如頁首）。
// 對 SEO 是嚴重問題：Googlebot 這類爬蟲看到的等同一片空白頁面。
//
// 這個元件不是要「修好」任何特定錯誤（IntersectionObserver 那個已經在
// HomePage.tsx 加了防護），而是最後一道安全網——未來任何未預期的 render/
// effect 例外，都會落地成一個有品牌感、可重新整理的畫面，而不是無聲空白。
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            padding: '24px',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#2B2420',
            background: '#F7F3EC',
          }}
        >
          <p style={{ fontSize: '16px' }}>頁面發生了一點問題，請重新整理再試一次。</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              borderRadius: '6px',
              border: '1px solid #C9BFA8',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            重新整理
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
