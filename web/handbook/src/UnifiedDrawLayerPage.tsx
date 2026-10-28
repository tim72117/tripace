import { Link } from 'react-router-dom'

// UnifiedDrawLayerPage:把 public/unified-draw-layer.html(統一繪製層的七層總覽與宿主架構)掛成文件站的一個路由。
// 這份是 marker-layers.html 四個入口小卡「統一繪製層」共同的詳細說明,抽成子頁後各入口小卡只留自己跟其他入口
// 不同的部分。做法同 MarkerLayersPage:靜態 HTML 以 iframe 嵌入,內容只改 HTML 一處;頂端留返回列。
export function UnifiedDrawLayerPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(128,128,128,.3)', fontSize: 14 }}>
        <Link to="/marker-layers">← 回規劃地圖的分層與繪製層</Link>
      </div>
      <iframe
        title="統一繪製層七層總覽"
        src="/unified-draw-layer.html"
        style={{ flex: 1, border: 0, width: '100%' }}
      />
    </div>
  )
}
