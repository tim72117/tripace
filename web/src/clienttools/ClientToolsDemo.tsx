import { useEffect, useRef, useState } from 'react'
import { isSubmitEnter } from '../App'
import { type TripEntry } from './tripEntryTools'
import { ClientToolsBridge, type ConnStatus, type LogEntry } from './ClientToolsBridge'
import { defaultClientTools } from './tools'
import { newTripEntryId } from './tools/tripEntryAdd'

// ClientToolsDemo — 「LLM 呼叫前端 tool」試做(POC)的畫面渲染。
//
// WebSocket 連線、協定處理與 sendPrompt/sendTestPrompt 邏輯都搬到
// ClientToolsBridge.ts(不含 React 依賴的純 class)。這個元件只負責:建立
// bridge 實例、把 bridge 的 callback 接到自己的 React state、渲染畫面。

export function ClientToolsDemo() {
  const [entries, setEntries] = useState<TripEntry[]>([
    { id: newTripEntryId(), title: '東京晴空塔', date: '2026-07-19', time: '10:00', note: '先上樓看夜景' },
    { id: newTripEntryId(), title: '築地場外市場早餐', date: '2026-07-20', time: '08:00', note: '' },
  ])

  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [toolNames, setToolNames] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [assistantText, setAssistantText] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])

  const bridgeRef = useRef<ClientToolsBridge | null>(null)

  useEffect(() => {
    const bridge = new ClientToolsBridge(
      defaultClientTools,
      {
        onStatusChange: setStatus,
        onToolNamesChange: setToolNames,
        onEntriesChange: setEntries,
        onAssistantText: setAssistantText,
        onLog: setLog,
        onBusyChange: setBusy,
      },
      entries,
    )
    bridgeRef.current = bridge
    bridge.connect()

    return () => {
      bridge.disconnect()
      bridgeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載時建立一次 bridge 並連線;初始 entries 只當建構子的種子資料。
  }, [])

  const sendPrompt = () => {
    if (bridgeRef.current?.sendPrompt(input)) setInput('')
  }

  const sendTestPrompt = async () => {
    const text = input
    await bridgeRef.current?.sendTestPrompt(text)
    setInput('')
  }

  return (
    <div className="cts-root">
      <div className="cts-main">
        <div className="cts-header">
          <span className="cts-title">旅程清單(僅存在此頁面記憶體,不進資料庫)</span>
          <span className={`cts-status cts-status-${status}`}>
            {status === 'open' ? `已連線 · ${toolNames.length} 個工具` : status === 'connecting' ? '連線中…' : '已斷線'}
          </span>
        </div>

        <div className="cts-entries">
          {entries.length === 0 ? (
            <div className="cts-empty">目前清單是空的。</div>
          ) : (
            <table className="cts-table">
              <thead>
                <tr>
                  <th>標題</th>
                  <th>日期</th>
                  <th>時間</th>
                  <th>備註</th>
                  <th>id</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="cts-entry-row">
                    <td className="cts-entry-title">{e.title}</td>
                    <td className="cts-entry-when">{e.date}</td>
                    <td className="cts-entry-when">{e.time}</td>
                    <td className="cts-entry-note">{e.note}</td>
                    <td className="cts-entry-id">{e.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {assistantText && <div className="cts-assistant">{assistantText}</div>}

        <div className="cts-inputrow">
          <input
            className="cts-input"
            placeholder="跟 LLM 說一句話,例如「幫我新增一筆明天的東京晴空塔行程」"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitEnter(e) && !busy) sendPrompt()
            }}
            disabled={busy}
          />
          <button className="btn-secondary" onClick={sendPrompt} disabled={busy || status !== 'open' || !input.trim()}>
            {busy ? '推論中…' : '送出(WS）'}
          </button>
          <button
            className="btn-secondary"
            onClick={sendTestPrompt}
            disabled={busy || !input.trim()}
            title="走 POST /internal/clienttools/test-prompt,不需要自己開 WS 連線也能觸發同一個 session 的推論"
          >
            測試端點
          </button>
        </div>
      </div>

      <div className="cts-log">
        <div className="cts-log-title">WS / HTTP 訊息記錄</div>
        <div className="cts-log-list">
          {log.map((l) => (
            <div key={l.id} className={`cts-log-entry cts-log-${l.dir}`}>
              <div className="cts-log-summary">
                <span className="cts-log-dir">{l.dir === 'out' ? '→' : '←'}</span> {l.summary}
              </div>
              {l.detail && <div className="cts-log-detail">{l.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
