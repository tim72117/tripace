import { useCallback, useEffect, useRef, useState } from 'react'
import { listNodes, type PlanTimeline } from './model'
import {
  clearNodeStatus,
  EMPTY_NODE_STATUS,
  pruneNodeStatus,
  setNodeStatus,
  type NodeStatus,
  type NodeStatusMap,
} from './status'

// usePlanNodeStatus——時間軸節點的執行狀態表(loading/failed/removing,見 status.ts)的 React 包裝。
//
// 這份狀態**不持久化**:重整頁面就是空的。查詢流程與兩階段移除寫入,視圖以 nodeStatus 讀取。
//
// 為什麼 state 與 ref 並存:setStatus 常在非 React 事件(WebSocket onmessage、setTimeout、fetch 的 then)裡
// 呼叫,而且「重複移除要擋下」這類判斷需要「現在就拿到最新值」——所以寫入先改 ref(同步、一定是最新),
// 再 setState 通知畫面;statusRef 讓呼叫端同步讀取(例如 removeStop 檢查節點是否已在 removing)。
//
// 修剪:timeline 變動時,把已經不在時間軸裡的節點的狀態丟掉(節點被移除、時間軸被清空或被另一份實例的內容換掉)。
// 修剪讀的是 timelineRef(useSyncedState 的 ref,同步寫入、永遠是最新),不是 render 當下的 timeline 參數:
// 後者在「剛插入節點、緊接著標 loading」的瞬間可能還是舊的(前一次 render 的 passive effect 會在新更新處理前先跑),
// 用它修剪會把剛標的狀態誤丟。timeline 參數只用來當「時間軸變了,該修剪了」的觸發條件。
export function usePlanNodeStatus(timeline: PlanTimeline, timelineRef: { readonly current: PlanTimeline }) {
  const [nodeStatus, setNodeStatusState] = useState<NodeStatusMap>(EMPTY_NODE_STATUS)
  const nodeStatusRef = useRef<NodeStatusMap>(nodeStatus)

  const apply = useCallback((next: NodeStatusMap) => {
    if (next === nodeStatusRef.current) return
    nodeStatusRef.current = next
    setNodeStatusState(next)
  }, [])

  // setStatus——合併寫入某節點的狀態(語意見 setNodeStatus)。
  const setStatus = useCallback(
    (id: string, patch: NodeStatus) => apply(setNodeStatus(nodeStatusRef.current, id, patch)),
    [apply],
  )
  // clearStatus——整筆清掉某節點的狀態。
  const clearStatus = useCallback((id: string) => apply(clearNodeStatus(nodeStatusRef.current, id)), [apply])

  useEffect(() => {
    if (nodeStatusRef.current.size === 0) return
    const ids = new Set(listNodes(timelineRef.current).map((n) => n.id))
    apply(pruneNodeStatus(nodeStatusRef.current, ids))
  }, [timeline, timelineRef, apply])

  return { nodeStatus, nodeStatusRef, setStatus, clearStatus }
}
