import { useState } from 'react'
import type { ApiCall } from './api'

// Debug panel:依時間倒序列出每筆 API 交易。
// 點一筆可展開原始 request/response JSON、狀態碼、耗時 —— 開發測後端的主要工作面。

export function DebugPanel({
  calls,
  onClear,
}: {
  calls: ApiCall[]
  onClear: () => void
}) {
  return (
    <div className="debug">
      <div className="debug-head">
        <span className="h-title">⚡ API Debug · {calls.length} 筆</span>
        <button onClick={onClear}>清除</button>
      </div>
      <div className="debug-list">
        {calls.length === 0 ? (
          <div style={{ color: '#6e6e78', padding: 16, textAlign: 'center' }}>
            尚無請求。在左側操作 app,這裡會即時記錄每次 API 交易。
          </div>
        ) : (
          calls.map((c) => <CallRow key={c.id} call={c} />)
        )}
      </div>
    </div>
  )
}

function CallRow({ call }: { call: ApiCall }) {
  const [open, setOpen] = useState(false)

  // 狀態徽章:連線失敗(null)、2xx、其它。
  let statusClass = 'fail'
  let statusLabel = 'FAIL'
  if (call.status != null) {
    statusClass = call.ok ? 'ok' : 'err'
    statusLabel = String(call.status)
  }

  // 只顯示 path(去掉 base URL),列表才不會太長。
  let path = call.url
  try {
    const u = new URL(call.url)
    path = u.pathname + u.search
  } catch {
    /* 保留原字串 */
  }

  return (
    <div className="call">
      <div className="call-head" onClick={() => setOpen((o) => !o)}>
        <span className={`method ${call.method}`}>{call.method}</span>
        <span className="call-path">{path}</span>
        <span className={`status ${statusClass}`}>{statusLabel}</span>
        <span className="dur">{call.durationMs}ms</span>
      </div>
      {open && (
        <div className="call-body">
          <div className="kv-label">URL</div>
          <pre>{call.url}</pre>

          {call.requestBody != null && (
            <>
              <div className="kv-label">Request Body</div>
              <pre>{pretty(call.requestBody)}</pre>
            </>
          )}

          {call.error && (
            <>
              <div className="kv-label">連線錯誤</div>
              <pre className="json-err">{call.error}</pre>
            </>
          )}

          {call.status != null && (
            <>
              <div className="kv-label">
                Response · {call.status} · {call.durationMs}ms
              </div>
              {call.responseBody != null ? (
                <pre>{pretty(call.responseBody)}</pre>
              ) : (
                <pre className="json-err">
                  {call.responseText || '(空回應 / 非 JSON)'}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
