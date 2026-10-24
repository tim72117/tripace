import { Link } from 'react-router-dom'

// MarkerLayersPage:把 public/marker-layers.html(規劃地圖的架構文件:四個入口的分層、統一繪製層、
// 逐項對照表、重要決策紀錄)掛成文件站的一個路由。那份 HTML 是獨立的靜態檔(自帶日夜切換與樣式),
// 所以這裡只用 iframe 嵌入,不重寫成 React——內容改的時候只改 HTML 一處。
// 頂端留一條返回列,避免進了嵌入頁之後沒有回文件目錄的路。
export function MarkerLayersPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(128,128,128,.3)', fontSize: 14 }}>
        <Link to="/">← 回文件目錄</Link>
      </div>
      <iframe
        title="規劃地圖架構文件"
        src="/marker-layers.html"
        style={{ flex: 1, border: 0, width: '100%' }}
      />
    </div>
  )
}
