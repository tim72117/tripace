import { useEffect, useRef, useState } from 'react'
import { AgentBridge } from '@onagent/bridge'
import { tripEntryAdd } from '../clienttools/tools/tripEntryAdd'
import { tripEntryList } from '../clienttools/tools/tripEntryList'
import { tripListBatches } from '../clienttools/tools/tripListBatches'
import { tripEntryDelete } from '../clienttools/tools/tripEntryDelete'
import { tripEntryUpdate } from '../clienttools/tools/tripEntryUpdate'
import type { TripBatches } from '../clienttools/tripEntryTools'
import { toAgentBridgeTools } from '../sdk-proposals/toAgentBridgeTools'

// useOnagentChatBridge:ChatScreen「onagent 推論模式」開關(見
// DesktopShared.tsx 的 CHAT_ONAGENT_TOGGLE_ENABLED)用的獨立連線 hook——
// 從 OnagentBridgeDemo.tsx 抽出同一套連線/工具接線邏輯。
//
// 跟最初版本不同:這裡不再自己管理獨立的 log/allBatches state,而是直接
// 讀寫呼叫端(ChatScreen)既有的 clientToolsBatches(透過 getAllBatches/
// setAllBatches 注入),並用 onAssistantMessage 回呼把 LLM 文字回覆交給
// 呼叫端自己組成 ChatMessage、塞進既有的 messages/MessageBubble 渲染
// 管線——這樣 onagent 模式下的畫面沿用正式的訊息泡泡/旅程清單表格樣式,
// 不是另一塊獨立的除錯用文字列表(使用者明確要求「接到原本的樣式跟
// 元件」)。tripID/sessionID/lang 等業務上下文傳遞落差仍未處理,同
// docs/chatscreen-onagent-migration-gap-2026-08-11.md 記錄的範圍決定。
const APP_ID = 'tripace'
const WS_URL = (import.meta.env.VITE_ONAGENT_URL ?? 'http://localhost:8081').replace(/^http/, 'ws') + '/ws'

export type OnagentChatStatus = 'connecting' | 'ready' | 'closed'

export function useOnagentChatBridge(
  enabled: boolean,
  getAllBatches: () => TripBatches,
  setAllBatches: (next: TripBatches) => void,
  onAssistantMessage: (text: string) => void,
) {
  const apiKey = import.meta.env.VITE_ONAGENT_APP_KEY as string | undefined
  const [status, setStatus] = useState<OnagentChatStatus>('connecting')
  const bridgeRef = useRef<AgentBridge | null>(null)
  // getAllBatches/setAllBatches/onAssistantMessage 是每次 render 都可能是
  // 新的閉包(呼叫端未必用 useCallback 包),用 ref 保存「呼叫當下最新版本」,
  // 避免下面 useEffect 的依賴陣列把這幾個函式列進去導致連線頻繁重建——
  // 連線只應該依 enabled/apiKey 變化,不該因為呼叫端重新渲染出新的閉包
  // 就重新連一次 WS。
  const getAllBatchesRef = useRef(getAllBatches)
  const setAllBatchesRef = useRef(setAllBatches)
  const onAssistantMessageRef = useRef(onAssistantMessage)
  useEffect(() => {
    getAllBatchesRef.current = getAllBatches
    setAllBatchesRef.current = setAllBatches
    onAssistantMessageRef.current = onAssistantMessage
  })

  useEffect(() => {
    if (!enabled || !apiKey) return
    const onagentToolContext = {
      getAllBatches: () => getAllBatchesRef.current(),
      setAllBatches: (next: TripBatches) => setAllBatchesRef.current(next),
      // notifyBatchQueried:trip_entry_list 純讀取、不改動 allBatches,故沒有
      // 對應的畫面提示需求——ChatScreen 正式路徑的 tripListTriggered 標記
      // 也是靠比對 setAllBatches 前後差異才顯示表格,查詢類工具維持原本
      // 「靠 changedBatchKeys 偵測不到就不特別標記」的行為,不在這裡另外
      // 接一條通知線。
      notifyBatchQueried: () => {},
    }
    const bridge = new AgentBridge({
      url: WS_URL,
      appId: APP_ID,
      apiKey,
      tools: toAgentBridgeTools(
        [tripEntryAdd, tripEntryList, tripListBatches, tripEntryDelete, tripEntryUpdate],
        onagentToolContext,
      ),
      onAssistantMessage: (text) => onAssistantMessageRef.current(text),
      onError: (err) => onAssistantMessageRef.current(`(onagent 連線錯誤: ${err.message})`),
    })
    bridgeRef.current = bridge
    setStatus('connecting')
    // AgentBridge 沒有連線成功的 callback,用送出後短暫延遲樂觀顯示 ready
    // (同 OnagentBridgeDemo.tsx 的既有做法)。
    const t = window.setTimeout(() => setStatus('ready'), 500)
    return () => {
      window.clearTimeout(t)
      bridge.close()
      bridgeRef.current = null
      setStatus('closed')
    }
  }, [enabled, apiKey])

  const sendPrompt = (text: string) => {
    if (!text.trim() || !bridgeRef.current) return
    bridgeRef.current.prompt(text)
  }

  return {
    // apiKeyMissing:呼叫端用來判斷要不要顯示「未設定 apiKey」的提示,
    // 理由同 OnagentBridgeDemo.tsx 開關掉整頁的既有處理方式。
    apiKeyMissing: !apiKey,
    status,
    sendPrompt,
  }
}
