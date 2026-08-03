import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ApiCall, ClientConfig, WsEvent } from './api'
import * as api from './api'
import type { Trip, Entry } from './types'
import styles from './DemoPanel.module.css'

// DemoPanel:只在網址帶 ?demo、且點開桌面版 rail 上的 API/WS 狀態面板圖示
// 時才會出現(見 DesktopLayout.tsx 的 showDebugPanel),不是正式使用者看
// 得到的功能——元件/檔案命名故意帶上 Demo 反映這件事。
// 三個分頁 —— API 交易紀錄、WS 事件、目前行程的 Entry 條目。
// API:依時間倒序列出每筆交易,點開看原始 request/response JSON。
// WS 事件:後端主動推送的介面更新事件(entries_updated/ask_user/task_created/
//   entries_loaded 等,見 server/internal/api/ws.go 的各個 Notify* 方法)。
// Entries:看 record_entry 工具記了哪些結構化條目(item + 時間)。

type DebugTab = 'api' | 'ws' | 'entries'

// call.method 是後端回傳的純字串(見 api.ts 的 ApiCall.method: string),
// 不是固定的聯合型別,理論上可以是任何值——只有 GET/POST/DELETE/OPTIONS
// 這 4 種有對應色系,其餘沿用 .method 的預設樣式(無額外底色),故用
// Partial 對照表、找不到就不加額外 class,行為對齊原本 CSS 的
// `.method.XXX` 只匹配這 4 種的效果。
const METHOD_CLASS: Partial<Record<string, string>> = {
  GET: styles.methodGet,
  POST: styles.methodPost,
  DELETE: styles.methodDelete,
  OPTIONS: styles.methodOptions,
}
const STATUS_CLASS = {
  ok: styles.statusOk,
  err: styles.statusErr,
  fail: styles.statusFail,
}

export function DemoPanel({
  calls,
  onClear,
  wsEvents,
  onClearWsEvents,
  cfg,
  trip,
  style,
}: {
  calls: ApiCall[]
  onClear: () => void
  wsEvents: WsEvent[]
  onClearWsEvents: () => void
  cfg: ClientConfig
  trip: Trip | null
  style?: CSSProperties
}) {
  const [tab, setTab] = useState<DebugTab>('api')

  return (
    <div className={styles.panel} style={style}>
      <div className={styles.head}>
        <div className={styles.tabs}>
          <button
            className={tab === 'api' ? 'active' : ''}
            onClick={() => setTab('api')}
          >
            ⚡ API · {calls.length}
          </button>
          <button
            className={tab === 'ws' ? 'active' : ''}
            onClick={() => setTab('ws')}
          >
            📡 WS · {wsEvents.length}
          </button>
          <button
            className={tab === 'entries' ? 'active' : ''}
            onClick={() => setTab('entries')}
          >
            📅 Entries
          </button>
        </div>
        {tab === 'api' && <button onClick={onClear}>清除</button>}
        {tab === 'ws' && <button onClick={onClearWsEvents}>清除</button>}
      </div>
      {tab === 'api' ? (
        <div className={styles.list}>
          {calls.length === 0 ? (
            <div style={{ color: '#6e6e78', padding: 16, textAlign: 'center' }}>
              尚無請求。在左側操作 app,這裡會即時記錄每次 API 交易。
            </div>
          ) : (
            calls.map((c) => <CallRow key={c.id} call={c} />)
          )}
        </div>
      ) : tab === 'ws' ? (
        <div className={styles.list}>
          {wsEvents.length === 0 ? (
            <div style={{ color: '#6e6e78', padding: 16, textAlign: 'center' }}>
              尚無事件。後端透過 WebSocket 主動推送的介面更新事件(entries_updated、
              entries_loaded 等)會即時顯示在這裡。
            </div>
          ) : (
            wsEvents.map((e) => <WsEventRow key={e.id} evt={e} />)
          )}
        </div>
      ) : (
        <EntriesView cfg={cfg} trip={trip} />
      )}
    </div>
  )
}

// EntriesView 顯示目前行程的 Entry 條目(record_entry 工具寫進 DB 的結構化資料)。
function EntriesView({
  cfg,
  trip,
}: {
  cfg: ClientConfig
  trip: Trip | null
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!trip) return
    setLoading(true)
    setErr(null)
    try {
      setEntries(await api.fetchEntries(cfg, trip.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, trip?.id])

  useEffect(() => {
    load()
  }, [load])

  // 重置:清空此行程的 entry(破壞性,限 owner)。完成後重新載入。
  const reset = useCallback(async () => {
    if (!trip) return
    if (!window.confirm(`確定清空行程「${trip.name}」的所有條目?此操作無法復原。`))
      return
    setLoading(true)
    setErr(null)
    try {
      await api.resetTripData(cfg, trip.id)
      setEntries([])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, trip?.id])

  if (!trip) {
    return (
      <div className={styles.list}>
        <div style={{ color: '#6e6e78', padding: 16, textAlign: 'center' }}>
          先在左側進入一個行程,這裡會顯示該行程的 Entry 條目。
        </div>
      </div>
    )
  }

  return (
    <div className={styles.list}>
      <div className={styles.entriesHead}>
        <span>行程 {trip.name} · {entries.length} 筆</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={load} disabled={loading}>
            {loading ? '…' : '↻ 重整'}
          </button>
          <button onClick={reset} disabled={loading} className="danger">
            🗑 重置
          </button>
        </span>
      </div>
      {err && <pre className={styles.jsonErr}>{err}</pre>}
      {!err && entries.length === 0 && !loading && (
        <div style={{ color: '#6e6e78', padding: 16, textAlign: 'center' }}>
          這個行程還沒有 Entry。owner 記事(需 -llm want)後會出現。
        </div>
      )}
      {entries.map((e) => (
        <div key={e.id} className={styles.entryRow}>
          <span className={styles.entryWhenMono}>
            {e.start ? (e.startTime ? `${e.start} ${e.startTime}` : `${e.start} 全日`) : '(無時間)'}
            {e.end ? ` ~ ${e.endTime ? `${e.end} ${e.endTime}` : e.end}` : ''}
          </span>
          <span className={styles.entryItemMono}>{e.title}</span>
          <span className={styles.entryIdMono}>{e.id}</span>
        </div>
      ))}
    </div>
  )
}

// WsEventRow 顯示單筆 WS 事件,點擊展開看原始 payload JSON(對齊 CallRow 的互動模式)。
function WsEventRow({ evt }: { evt: WsEvent }) {
  const [open, setOpen] = useState(false)
  const time = evt.receivedAt.slice(11, 19) // 只取 HH:MM:SS,列表夠用

  return (
    <div className={styles.call}>
      <div className={styles.callHead} onClick={() => setOpen((o) => !o)}>
        <span className={`${styles.method} ${styles.methodPost}`}>{evt.event}</span>
        <span className={styles.callPath}>{evt.tripID ?? ''}</span>
        <span className={styles.dur}>{time}</span>
      </div>
      {open && (
        <div className={styles.callBody}>
          <div className={styles.kvLabel}>Payload</div>
          <pre>{pretty(evt.payload)}</pre>
        </div>
      )}
    </div>
  )
}

function CallRow({ call }: { call: ApiCall }) {
  const [open, setOpen] = useState(false)

  // 狀態徽章:連線失敗(null)、2xx、其它。
  let statusClass: string = STATUS_CLASS.fail
  let statusLabel = 'FAIL'
  if (call.status != null) {
    statusClass = call.ok ? STATUS_CLASS.ok : STATUS_CLASS.err
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
    <div className={styles.call}>
      <div className={styles.callHead} onClick={() => setOpen((o) => !o)}>
        <span className={`${styles.method} ${METHOD_CLASS[call.method] ?? ''}`}>{call.method}</span>
        <span className={styles.callPath}>{path}</span>
        <span className={`${styles.status} ${statusClass}`}>{statusLabel}</span>
        <span className={styles.dur}>{call.durationMs}ms</span>
      </div>
      {open && (
        <div className={styles.callBody}>
          <div className={styles.kvLabel}>URL</div>
          <pre>{call.url}</pre>

          {call.requestBody != null && (
            <>
              <div className={styles.kvLabel}>Request Body</div>
              <pre>{pretty(call.requestBody)}</pre>
            </>
          )}

          {call.error && (
            <>
              <div className={styles.kvLabel}>連線錯誤</div>
              <pre className={styles.jsonErr}>{call.error}</pre>
            </>
          )}

          {call.status != null && (
            <>
              <div className={styles.kvLabel}>
                Response · {call.status} · {call.durationMs}ms
              </div>
              {call.responseBody != null ? (
                <pre>{pretty(call.responseBody)}</pre>
              ) : (
                <pre className={styles.jsonErr}>
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
