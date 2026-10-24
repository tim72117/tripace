import { useCallback } from 'react'
import { useSyncedState } from '../hooks/useSyncedState'
import {
  appendMessage as appendMessageTo,
  clearConversation as clearConversationOf,
  createEmptyConversation,
  staleAllMessages,
  staleOtherMessages,
  type PlanConversation,
  type PlanMessage,
} from './planConversation'

// usePlanConversation — 規劃對話的「資料層」:純記憶體 state、append/stale/clear。
//
// 2026-10-24 對話從 PlanTimeline 獨立出來時新增,介面風格比照 usePlanTimelineCore:不碰 API、不知道訊息是
// onagent 還是模擬腳本送來的(那是最外層各自的事)。跟行程完全分離——不 import 任何時間軸函式,
// 行程那邊也不知道這支 hook 存在;兩者唯一的連動是呼叫端在「新增站點」時自己呼叫 staleAll
// (話題推進、舊訊息淡化,見下方說明),資料層之間沒有耦合。
//
// 不持久化(使用者定案):對話只活在元件生命週期內,重整頁面或元件卸載後就清空,不讀寫 localStorage、
// 沒有版次、也不在多個實例間同步。「新行程」換草稿靠呼叫端用 key 讓 TripPlanPage 重新掛載(見
// home/plan-ai-sim/LivePlanLayer.tsx 的 mountKey),重新掛載就是一份全新的空對話;「模擬態交接給推論層」
// 則由模擬層自己呼叫 clearConversation(見 usePlanSimSocket)。
export function usePlanConversation() {
  const [conversationRef, conversation, commit] = useSyncedState<PlanConversation>(createEmptyConversation)

  const update = useCallback(
    (fn: (current: PlanConversation) => PlanConversation) => {
      commit<void>((current) => {
        const next = fn(current)
        return next === current ? { result: undefined } : { next, result: undefined }
      })
    },
    [commit],
  )

  // appendMessage——接在最後。不會順便淡化舊訊息:一則新訊息出現本身不代表話題推進(過去 message 節點插入也不觸發
  // stale,只有新增站點才會),要淡化由呼叫端明確呼叫 staleAll。
  const appendMessage = useCallback((message: PlanMessage) => update((c) => appendMessageTo(c, message)), [update])

  // staleAll——新增站點後呼叫:所有還新鮮的訊息淡化。
  const staleAll = useCallback(() => update((c) => staleAllMessages(c)), [update])

  // staleOthers——excludeId 以外的淡化(保留一則維持完整)。
  const staleOthers = useCallback((excludeId: string) => update((c) => staleOtherMessages(c, excludeId)), [update])

  // clearConversation——清空(模擬交接給真實 AI 時用)。
  const clearConversation = useCallback(() => update((c) => clearConversationOf(c)), [update])

  return {
    conversation,
    messages: conversation.messages,
    conversationRef,
    appendMessage,
    staleAll,
    staleOthers,
    clearConversation,
  }
}
