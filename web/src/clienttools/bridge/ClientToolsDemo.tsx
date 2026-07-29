import { useCallback, useEffect, useRef, useState } from 'react'
import { isSubmitEnter } from '../../AppCommon'
import { type TripBatches } from '../tripEntryTools'
import { ClientToolsBridge, type ConnStatus, type LogEntry } from './ClientToolsBridge'
import { defaultClientTools } from '../tools'
import { newTripEntryId } from '../tools/tripEntryAdd'
import styles from './ClientToolsDemo.module.css'

// status/dir 對應到 CSS Modules 雜湊過的 class 名稱——原本用字串樣板
// `cts-status-${status}` 直接接原始 class 名,雜湊過的名稱無法這樣拼,
// 改成小型對照表。
const STATUS_CLASS: Record<ConnStatus, string> = {
  open: styles.statusOpen,
  connecting: styles.statusConnecting,
  closed: styles.statusClosed,
}
const LOG_DIR_CLASS: Record<LogEntry['dir'], string> = {
  out: styles.logOut,
  in: styles.logIn,
}

// ClientToolsDemo — 「LLM 呼叫前端 tool」試做(POC)的畫面渲染。
//
// WebSocket 連線、協定處理與 sendPrompt/sendTestPrompt 邏輯都搬到
// ClientToolsBridge.ts(不含 React 依賴的純 class)。這個元件只負責:建立
// bridge 實例、把 bridge 的 callback 接到自己的 React state、渲染畫面。
//
// 多批次(key)支援後,種子資料改放進一個示範用的固定 key('demo')底下,
// 畫面渲染時把所有批次攤平成一張表(多加一欄顯示 key),讓這個試做頁面不需要
// 太複雜的 UI 就能驗證多批次資料確實能正確流動——這個頁面本來就只是純技術
// 試做,不追求跟 ChatScreen.tsx 一樣「每批各自一張表」的呈現方式。

const DEMO_BATCH_KEY = 'demo'

export function ClientToolsDemo() {
  const [allBatches, setAllBatches] = useState<TripBatches>({
    [DEMO_BATCH_KEY]: [
      { id: newTripEntryId(), title: '東京晴空塔', date: '2026-07-19', time: '10:00', note: '先上樓看夜景' },
      { id: newTripEntryId(), title: '築地場外市場早餐', date: '2026-07-20', time: '08:00', note: '' },
    ],
  })
  // allBatchesRef:allBatches 的唯一真相來源(同 ChatScreen.tsx 的
  // clientToolsBatchesRef 設計,見該處說明)。ClientToolsBridge 建構子改收
  // getAllBatches/setAllBatches 兩個函式直接讀寫這個 ref,bridge 不再自己
  // 持有 allBatches 副本。
  const allBatchesRef = useRef<TripBatches>(allBatches)
  const setAllBatchesBoth = useCallback(
    (updater: TripBatches | ((prev: TripBatches) => TripBatches)) => {
      const next = typeof updater === 'function' ? updater(allBatchesRef.current) : updater
      allBatchesRef.current = next
      setAllBatches(next)
    },
    [],
  )

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
        onAssistantText: setAssistantText,
        onLog: setLog,
        onBusyChange: setBusy,
      },
      () => allBatchesRef.current,
      (next) => setAllBatchesBoth(next),
    )
    bridgeRef.current = bridge
    bridge.connect()

    return () => {
      bridge.disconnect()
      bridgeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載時建立一次 bridge 並連線;initial allBatchesRef.current 只當建構子的種子資料。
  }, [])

  // entries：攤平所有批次成一份陣列供下方表格渲染,每筆帶上所屬的 key
  // (見下方表格新增的「批次」欄)。
  const entries = Object.entries(allBatches).flatMap(([key, list]) =>
    list.map((e) => ({ ...e, key })),
  )

  const sendPrompt = () => {
    if (bridgeRef.current?.sendPrompt(input)) setInput('')
  }

  const sendTestPrompt = async () => {
    const text = input
    await bridgeRef.current?.sendTestPrompt(text)
    setInput('')
  }

  return (
    <div className={styles.root}>
      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.title}>旅程清單(僅存在此頁面記憶體,不進資料庫)</span>
          <span className={`${styles.status} ${STATUS_CLASS[status]}`}>
            {status === 'open' ? `已連線 · ${toolNames.length} 個工具` : status === 'connecting' ? '連線中…' : '已斷線'}
          </span>
        </div>

        <div className={styles.entries}>
          {entries.length === 0 ? (
            <div className={styles.empty}>目前清單是空的。</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>批次</th>
                  <th>標題</th>
                  <th>日期</th>
                  <th>時間</th>
                  <th>備註</th>
                  <th>id</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.key}:${e.id}`} className={styles.entryRow}>
                    <td>{e.key}</td>
                    <td className={styles.entryTitle}>{e.title}</td>
                    <td className={styles.entryWhen}>{e.date}</td>
                    <td className={styles.entryWhen}>{e.time}</td>
                    <td className={styles.entryNote}>{e.note}</td>
                    <td className={styles.entryId}>{e.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {assistantText && <div className={styles.assistant}>{assistantText}</div>}

        <div className={styles.inputrow}>
          <input
            className={styles.input}
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

      <div className={styles.log}>
        <div className={styles.logTitle}>WS / HTTP 訊息記錄</div>
        <div className={styles.logList}>
          {log.map((l) => (
            <div key={l.id} className={`${styles.logEntry} ${LOG_DIR_CLASS[l.dir]}`}>
              <div className={styles.logSummary}>
                <span className={styles.logDir}>{l.dir === 'out' ? '→' : '←'}</span> {l.summary}
              </div>
              {l.detail && <div className={styles.logDetail}>{l.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
