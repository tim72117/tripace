import { useCallback, useMemo, useRef } from 'react'
import { useSyncedState } from '../hooks/useSyncedState'
import {
  insertAfter,
  staleOtherAgentMessages,
  toRenderList,
  type PlanNodeData,
  type PlanTimeline,
} from './planTimeline'
import { createEmptyTimeline } from './planTimeline'
import { loadTimelineWithRev, readRev, saveTimeline } from './planTimelineStorage'

// usePlanTimelineCore — 時間軸的「資料層」:state、鏈結操作、(選用的)
// 持久化。刻意不碰任何 API、不吃 ClientConfig。
//
// 2026-10 抽出來的背景:/ai-plan 的模擬時間軸(home/plan-ai-sim/
// home/plan-ai-sim/Content.tsx)與 /app 的正式 AI 規劃(trip-plan/TripPlanPage.tsx)
// 各自寫了一份 insertAttractionAfter/setNoteForStop,結構幾乎逐行相同
// (同樣的 insertAfter → 檢查 ok → staleOtherAgentMessages 流程),差別
// 只在「插入後要做什麼背景查詢」注入的函式不同:正式版打真 API、模擬版
// 走 planAiFakeDataSource。使用者明確要求「兩個時間軸層可以分離乾淨,
// 但是裡面用到的共通元件要復用」,這支 hook 就是那個共通的資料層。
//
// 跟 PlanTimelineView(純渲染)的分工:那邊負責「把一條 PlanNode 陣列
// 畫出來」,這邊負責「那條陣列怎麼變動」。兩者都不知道訊號是從計時器
// 腳本還是 onagent WebSocket 來的——那是最外層各自的事。
//
// 不包含的東西(刻意留給呼叫端):
//   - 地點補查(resolveAttractionForStep)與交通估算(refreshTransitForStop)
//     ——它們需要 cfg/API,而且模擬版注入的是假資料來源。呼叫端在
//     onStopInserted 裡自己決定要做什麼。
//   - 移除節點的淡出動畫時序(REMOVE_FADE_MS)——那是視覺決定,兩邊的
//     數值目前相同但沒有理由綁死。
//   - 拖曳改時間(dragStopTime)——只有正式功能有這個互動。
//   - 移除節點(removeStep)——正式版是「先標記 removing、播完淡出動畫
//     再真的摘除」的兩階段流程(見 removeNode 的 allowRemoving 選項與
//     REMOVE_FADE_MS),那是視覺時序而非資料語意,各層自己決定。

// TODO(交接):這支 hook 已經抽出來並有測試覆蓋,但 TripPlanPage 與
// plan-ai-sim/Content 都還沒改用它——兩邊仍是各自的 insertAttractionAfter/
// setNoteForStop 實作。那是純重構(行為不變),可以獨立進行、獨立驗證:
//   1. 先改 plan-ai-sim/Content(較單純:不持久化、onStopInserted 注入
//      planAiFakeDataSource),跑 /ai-plan 確認腳本播放正常。
//   2. 再改 TripPlanPage(要處理 persist: true、真 API、以及它自己那套
//      removeStep 淡出動畫與 dragStopTime——後兩者刻意沒進這支 hook,
//      見下方「不包含的東西」)。
export interface PlanTimelineCoreOptions {
  // persist — 是否把異動寫進 localStorage(tripace.planTimeline)。
  //
  // 正式功能(/app 與 /app/plan-ai)要 true:使用者的規劃內容重整後要還在。
  // 模擬展示要 false:那是公開頁的自動播放腳本,不該污染使用者在正式
  // 功能裡排好的真實行程——實際會踩到的情境是使用者先在 /app 排了一趟,
  // 再開 /ai-plan 看展示,回到 /app 發現自己的行程被腳本蓋掉了。
  //
  // 預設 false(不持久化)——「寫入使用者的持久化資料」是需要明確選擇
  // 的行為,不該是忘了設定就自動發生。
  persist?: boolean
  // onStopInserted — 插入一個 stop 節點成功後呼叫,讓呼叫端接上自己的
  // 背景查詢(補地點資料、算交通時間)。
  //
  // 這是 Sim 與 Live 兩層最主要的差異點:Live 注入真 API,Sim 注入
  // planAiFakeDataSource,而腳本自帶座標的節點甚至不需要補查。
  //
  // 刻意在「commit 已經完成」之後才呼叫:插入本身是純本地的鏈結運算,
  // 立即返回,不該因為等待或觸發 API 查詢而受限流影響。
  onStopInserted?: (id: string, data: PlanNodeData) => void
}

export function usePlanTimelineCore(options: PlanTimelineCoreOptions = {}) {
  const { persist = false, onStopInserted } = options

  // 初值:persist 時從 localStorage 讀回(內容與版次用同一次讀取,見
  // loadTimelineWithRev 的完整說明),否則一律空時間軸。
  //
  // 用 ref 保存:Strict Mode 會雙重 render,放進 useState/useRef 的
  // initializer 參數會被求值兩次(第二次的結果丟棄),這裡讓它確實
  // 只讀一次 localStorage。
  const initialRef = useRef<{ timeline: PlanTimeline; rev: number } | null>(null)
  if (initialRef.current === null) {
    initialRef.current = persist ? loadTimelineWithRev() : { timeline: createEmptyTimeline(), rev: 0 }
  }

  const [timelineRef, timeline, rawCommitTimeline] = useSyncedState<PlanTimeline>(initialRef.current.timeline)
  // revRef — 這個實例手上這份對應的持久化版次。persist 為 false 時完全
  // 不會用到(下方所有讀寫都包在 persist 判斷裡),維持 0 即可。
  const revRef = useRef(initialRef.current.rev)

  // onStopInsertedRef — 用 ref 包一層,避免呼叫端每次 render 的新閉包
  // 讓下方 useCallback 全部換新參照(它們會再往下傳給 PlanTimelineView
  // 等元件)。理由同 geo-planning 既有的 useStableCallback 模式。
  const onStopInsertedRef = useRef(onStopInserted)
  onStopInsertedRef.current = onStopInserted

  // resyncFromStorage — 把另一個實例寫入的較新內容讀回來。
  //
  // 只在 persist 模式有意義:兩份 TripPlanPage 實例(常駐的規劃面板 +
  // /app/plan-ai 全頁)共用同一個 localStorage key,各自掛載時讀一次後
  // 就不再重讀,不同步的話後寫的會把先寫的蓋掉。見 planTimelineStorage
  // 的 rev 機制說明。
  const resyncFromStorage = useCallback(() => {
    if (!persist) return
    const diskRev = readRev()
    if (diskRev <= revRef.current) return
    const { timeline: fresh, rev } = loadTimelineWithRev()
    revRef.current = rev
    rawCommitTimeline<void>(() => ({ next: fresh, result: undefined }))
  }, [persist, rawCommitTimeline])

  // commitTimeline — 所有寫入的單一攔截點,順手處理持久化。
  //
  // persist 時:寫入前先追上磁碟(resyncFromStorage),確保以最新內容為
  // 基準計算;存檔失敗(配額/無痕)回傳 null 時刻意不推進 state——若讓
  // 記憶體套用而磁碟沒有,版次會謊稱一致,之後會被另一個實例靜默抹掉。
  const commitTimeline = useCallback(
    <R,>(compute: (current: PlanTimeline) => { next?: PlanTimeline; result: R }): R => {
      if (persist) resyncFromStorage()
      return rawCommitTimeline<R>((current) => {
        const outcome = compute(current)
        if (outcome.next !== undefined && persist) {
          const saved = saveTimeline(outcome.next, revRef.current)
          if (saved === null) return { result: outcome.result }
          revRef.current = saved
        }
        return outcome
      })
    },
    [persist, rawCommitTimeline, resyncFromStorage],
  )

  const setTimeline = useCallback(
    (updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => {
      commitTimeline((current) => ({
        next: typeof updater === 'function' ? (updater as (prev: PlanTimeline) => PlanTimeline)(current) : updater,
        result: undefined,
      }))
    },
    [commitTimeline],
  )

  // insertAttractionAfter — 在 anchorId 之後插入一個節點。
  //
  // 插入 stop 時一併把其他還「新鮮」的 message 節點淡化(見
  // staleOtherAgentMessages 的完整說明):新增景點代表話題已經推進。
  // 只在插入的是 stop 時觸發——插入 message 本身不代表話題推進,不該
  // 讓其他 message(包括它自己)跟著被標記成 stale。
  const insertAttractionAfter = useCallback(
    (anchorId: string | null, newId: string, data: PlanNodeData): ReturnType<typeof insertAfter> => {
      const result = commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        const inserted = insertAfter(current, anchorId, data, newId)
        if (!inserted.ok) return { result: inserted }
        if (data.type !== 'stop') return { next: inserted.timeline, result: inserted }
        return { next: staleOtherAgentMessages(inserted.timeline, newId), result: inserted }
      })
      // 背景查詢交給呼叫端(見 onStopInserted 的完整說明)。插入本身
      // 已經 commit 完成,這裡不等待、不影響回傳值。
      if (result.ok && data.type === 'stop') onStopInsertedRef.current?.(newId, data)
      return result
    },
    [commitTimeline],
  )

  // clearTimeline — 清空成空時間軸。
  //
  // 存在的理由是「模擬交接給真實 AI」那個流程(使用者明確要求交接時
  // 清空時間軸):模擬層跑完腳本後按下「讓我試試」,真實層接手前要先
  // 把展示用的站點清掉,不能讓使用者以為那些是自己排的。
  const clearTimeline = useCallback(() => {
    commitTimeline(() => ({ next: createEmptyTimeline(), result: undefined }))
  }, [commitTimeline])

  // useMemo——toRenderList 每次呼叫都回傳新陣列,若不 memo,任何一次
  // 重渲染(例如呼叫端的輸入框打字)都會讓依賴 steps 的 effect 誤判
  // 「時間軸內容變了」。這是修過的真實 bug:使用者停在最底部打字時,
  // 畫面會被強制 smooth-scroll 往上跳一段並被踢出跟隨模式。只有
  // timeline 這份真正的資料改變時才需要重新攤平。
  const steps = useMemo(() => toRenderList(timeline), [timeline])

  return {
    steps,
    timeline,
    timelineRef,
    commitTimeline,
    setTimeline,
    insertAttractionAfter,
    clearTimeline,
    resyncFromStorage,
  }
}
