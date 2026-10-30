import { useEffect, useRef, useState } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { AgentBridge } from '@onagent/bridge'
import { toAgentBridgeTools } from '../sdk-proposals/toAgentBridgeTools'
import { createArticleTools, type ArticleEditorHandle, type ArticleState } from './articleTools'
import styles from './ArticleEditor.module.css'

// ArticleAiPanel——文章編輯器右側的「AI 協助撰寫」側欄:使用者輸入文章概略,onagent(app:blog-article-writer)
// 用 articleTools 讀取圖片備註、新增/調整文章區塊。AI 只改編輯器裡未存檔的狀態,使用者看過再按「儲存」;
// 每次送出前會留一份快照,可用「復原上一次 AI 修改」回到送出前的樣子。
//
// 版面(見 ArticleEditor.module.css 的 .aiSide):sticky 在 topbar 之下、高度等於視窗,對話在側欄內捲動,
// 文章與對話同時可見;開關由 topbar 的「AI」按鈕控制。收合時用 hidden 保留元件(不卸載),否則 AgentBridge
// 連線、對話紀錄與快照都會丟掉。
//
// 連線方式跟 planning/panel/TripPlanPage.tsx 的 usePlanAiChatBridge 相同(SSE、lazyConnect),同一條連線 =
// 同一段對話(可接著說「第三段改短一點」);「停止」會丟掉這條連線、下次送出重連。
// 面板由 feature flag VITE_FEATURE_BLOG_ARTICLE_AI=true 開啟(預設關閉,編輯器不顯示);開啟後仍需設定
// VITE_ONAGENT_URL 與 VITE_BLOG_WRITER_ONAGENT_APP_KEY,缺了面板會顯示「尚未設定」並停用送出。
const APP_ID = 'blog-article-writer'
const HTTP_URL = import.meta.env.VITE_ONAGENT_URL as string | undefined
const APP_KEY = import.meta.env.VITE_BLOG_WRITER_ONAGENT_APP_KEY as string | undefined

export const BLOG_ARTICLE_AI_ENABLED = import.meta.env.VITE_FEATURE_BLOG_ARTICLE_AI === 'true'
const CONFIGURED = Boolean(HTTP_URL && APP_KEY)

interface ChatLine {
  role: 'user' | 'assistant' | 'notice' | 'error'
  text: string
}

export function ArticleAiPanel({
  handle,
  open,
  onClose,
  onBusyChange,
}: {
  handle: ArticleEditorHandle
  open: boolean
  onClose: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<ChatLine[]>([])
  const [busy, setBusyState] = useState(false)
  const [snapshot, setSnapshot] = useState<ArticleState | null>(null)
  const [epoch, setEpoch] = useState(0)
  const bridgeRef = useRef<AgentBridge | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const linesRef = useRef<HTMLDivElement | null>(null)
  // handle 的方法讀的是 ArticleEditor 的 ref,本身身分穩定;用 ref 持有避免因父層重繪而重建連線。
  const handleRef = useRef(handle)
  handleRef.current = handle
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange

  function setBusy(v: boolean) {
    setBusyState(v)
    onBusyChangeRef.current?.(v)
  }

  useEffect(() => {
    if (!HTTP_URL || !APP_KEY) return
    const bridge = new AgentBridge({
      url: HTTP_URL.replace(/^http/, 'ws') + '/ws',
      appId: APP_ID,
      apiKey: APP_KEY,
      transport: 'sse',
      lazyConnect: true,
      tools: toAgentBridgeTools(createArticleTools(), handleRef.current),
      onAssistantMessage: (text) => {
        setLines((prev) => [...prev, { role: 'assistant', text }])
        setBusy(false)
      },
      onError: (err) => {
        setLines((prev) => [...prev, { role: 'error', text: err.message || `發生錯誤(${err.code})` }])
        setBusy(false)
      },
      onQuotaExceeded: () => {
        setLines((prev) => [...prev, { role: 'error', text: 'AI 額度已用完' }])
        setBusy(false)
      },
    })
    bridgeRef.current = bridge
    return () => {
      bridge.close()
      bridgeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

  // 新訊息/進度列出現時捲到最底。
  useEffect(() => {
    const el = linesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, busy])

  // 開啟時把焦點給輸入框;回覆到了(busy 結束)也還給輸入框。
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus()
  }, [open, busy])

  function send() {
    const text = input.trim()
    if (text === '' || busy || !CONFIGURED || !bridgeRef.current) return
    setSnapshot(handleRef.current.getState())
    setLines((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setBusy(true)
    bridgeRef.current.prompt(text)
  }

  // 停止:onagent 沒有取消單次推論的協議,做法是丟掉連線(進行中的工具呼叫與回覆不再進來),下次送出會重連。
  function stop() {
    setEpoch((n) => n + 1)
    setBusy(false)
    setLines((prev) => [...prev, { role: 'notice', text: '已停止' }])
  }

  function undo() {
    if (!snapshot) return
    handleRef.current.setState(snapshot)
    setSnapshot(null)
    setLines((prev) => [...prev, { role: 'notice', text: '已復原上一次 AI 修改' }])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <aside id="article-ai-side" className={styles.aiSide} aria-label="AI 協助撰寫" hidden={!open}>
      <div className={styles.aiSideHead}>
        <div className={styles.aiTitle}>AI 協助撰寫</div>
        {snapshot && !busy && (
          <button type="button" className={styles.aiHeadBtn} onClick={undo}>
            復原上一次 AI 修改
          </button>
        )}
        <button type="button" className={styles.aiClose} onClick={onClose} aria-label="關閉 AI 面板">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div ref={linesRef} className={styles.aiLines} role="log" aria-live="polite" aria-relevant="additions">
        {lines.length === 0 && !busy && (
          <div className={styles.aiEmpty}>
            輸入文章的概略內容,AI 會讀取圖片備註,幫你排出章節與結構。
            <br />
            只會改動畫面,按「儲存」才會存。
          </div>
        )}
        {!CONFIGURED && (
          <div className={`${styles.aiLine} ${styles.aiLine_error}`}>
            尚未設定 AI 服務{import.meta.env.DEV ? '(缺 VITE_ONAGENT_URL 或 VITE_BLOG_WRITER_ONAGENT_APP_KEY)' : ''}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`${styles.aiLine} ${styles[`aiLine_${l.role}`]}`}>
            {l.text}
          </div>
        ))}
        {busy && (
          <div className={styles.aiBusy}>
            <span className={styles.aiBusyDot} />
            AI 正在修改文章…
          </div>
        )}
      </div>

      <div className={styles.aiComposer}>
        <textarea
          ref={inputRef}
          className={styles.aiInput}
          value={input}
          rows={2}
          aria-label="輸入文章概略或追問"
          placeholder="例如:兩天一夜的京都東山散策,第一天清水寺到祇園……(Enter 送出,Shift+Enter 換行)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || !CONFIGURED}
        />
        {busy ? (
          <button type="button" className={styles.aiHeadBtn} onClick={stop}>
            停止
          </button>
        ) : (
          <button
            type="button"
            className={styles.aiSend}
            onClick={send}
            disabled={!CONFIGURED || input.trim() === ''}
            aria-label="送出"
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </aside>
  )
}
