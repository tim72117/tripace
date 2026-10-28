// ToolCallLogDebugOverlay——開發工具:顯示 AI 推論過程中每次工具呼叫的
// 紀錄(工具名稱/參數/回傳值),共用同一個 ?debugSafeArea=1 開關(見
// planning/preview/Content.tsx 的 DEBUG_SAFE_AREA 完整說明)。跟同目錄的
// SafeAreaDebugOverlay/WideLayoutDebugOverlay 標示的是不同性質的資訊:
// 那兩個畫版面幾何框線,這個列的是 AI 推論的文字紀錄(見
// planning/panel/TripPlanPage.tsx ToolCallLogEntry/toolCallLog 的完整
// 說明:@onagent/bridge SDK 本身不提供工具呼叫層級的回呼,只能在我們
// 自己註冊給 SDK 的 tool handler 外面包一層記錄,見 toAgentBridgeTools
// 的 onToolResult 參數)。
//
// 固定在畫面左下角、可捲動、半透明深色底——跟既有兩個 debug 疊圖共用
// 同一種「疊在畫面上、不擋互動核心區域」的視覺語言,但刻意選左下角
// (SafeAreaDebugOverlay 的面板在右側,避免兩者互相遮擋)。
import type { ToolCallLogEntry } from '../panel/TripPlanPage'

export function ToolCallLogDebugOverlay({ log }: { log: ToolCallLogEntry[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 30,
        width: 320,
        maxHeight: '50vh',
        overflowY: 'auto',
        background: 'rgba(20, 20, 19, 0.88)',
        color: '#fff',
        fontSize: 11,
        fontFamily: 'monospace',
        borderRadius: 8,
        padding: '8px 10px',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        推論工具呼叫紀錄({log.length})
      </div>
      {log.length === 0 && <div style={{ opacity: 0.6 }}>尚無工具呼叫</div>}
      {[...log].reverse().map((entry) => (
        <div key={entry.id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
          <div style={{ color: '#7dd3fc' }}>{entry.name}</div>
          <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            args: {JSON.stringify(entry.args)}
          </div>
          <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            result: {JSON.stringify(entry.result)}
          </div>
        </div>
      ))}
    </div>
  )
}
