import { Link } from 'react-router-dom'

// TimelineArchitecturePage:把 public/timeline-architecture.html(時間軸的資料結構與使用端:PlanNode 鏈結串列、
// 五個入口的擁有者/資料來源/檢視)掛成文件站的一個路由。做法同 MarkerLayersPage:那份 HTML 是獨立的靜態檔
// (自帶日夜切換與樣式),這裡只用 iframe 嵌入,內容改的時候只改 HTML 一處;頂端留返回列。
export function TimelineArchitecturePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(128,128,128,.3)', fontSize: 14 }}>
        <Link to="/category/system-docs">← 回系統文件</Link>
      </div>
      <iframe
        title="時間軸架構文件"
        src="/timeline-architecture.html"
        style={{ flex: 1, border: 0, width: '100%' }}
      />
    </div>
  )
}
