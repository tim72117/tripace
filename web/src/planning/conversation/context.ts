// context.ts —AI 工具(tools.ts)的 ctx 工廠:把「行動前先確認目前行程」與「天數上限」這兩層把關,
// 連同底層時間軸操作,組成 AttractionStepsCtx。從 TripPlanPage 的 usePlanAiChatBridge 內搬出來,為了能單獨測試。
//
// 一、行動前先確認目前行程(structureSignature,見 tools.ts)
//   list_itinerary 讀取(ctx.getTimeline)時記下簽名,之後每個會改動行程的方法先比對,不同就丟 STALE_READ_MESSAGE。
//   「AI 自己的寫入算已讀」:改動型方法在寫入「成功」之後,把記下的簽名更新成寫入後當下的簽名。寫入前已通過比對,
//   所以這代表「AI 自己的變更不會讓它失去新鮮度」,不必每寫一次就多一趟 list_itinerary(來回加倍會撞上 onagent 的 90 秒上限)。
//   使用者的拖曳、刪站、背景結構變動沒有經過這裡,簽名仍會不同而被擋。
//   - 只在 ok 時更新:失敗的寫入沒有改動時間軸,不能因此「洗白」別人造成的差異(寫入前的比對已通過才會走到這裡,
//     所以失敗時簽名本來就沒變,不更新與更新結果相同;但寫入拋例外時更不可更新)。
//   - 簽名用寫入後最新的時間軸(getTimeline 要同步反映剛 commit 的內容,TripPlanPage 傳的是 timelineRef.current)。
//   - remove_attraction 是兩階段(先淡出、REMOVE_FADE_MS 後才真正摘除):呼叫當下節點還在時間軸裡,稍後才消失,
//     若直接記當下簽名,摘除落地後簽名改變、AI 自己的刪除反而讓它失去新鮮度。所以記下「待摘除的 id」,簽名一律
//     「假設這些節點已被摘除」來算(用領域層 removeNode 模擬,連最後一天變空會被修剪的規則都一致),摘除前後簽名相同。
//   - 詢問工具(open_ask_page/ask_*)不改變時間軸,只用 ensureFreshRead 檢查、不更新簽名。
//
// 二、天數上限:AI 一次最多往後跳 MAX_DAY_JUMP 天——目標天不得超過「現有天數 + MAX_DAY_JUMP」。現有天數用 getTimeline
//   的最新時間軸算(通過新鮮度檢查後,等於 AI 讀到的那份;但仍以當下為準,不信任 LLM 的記憶)。
//   套用:add_attraction 的 day、add_day 的 atDay。set_lodging 的 days 與 move_day 本來就限制在現有天數內(更嚴格),不需要這層。
//   超過就 throw,訊息寫出目前幾天與上限,風格同 move_day 的超出範圍訊息。

import {
  STALE_READ_MESSAGE,
  structureSignature,
  type AttractionStepsCtx,
  type PlanAiOperationName,
} from './tools'
import { hasNode, removeNode, type PlanTimeline } from '../timeline/model'
import type { PlanOperations } from '../timeline/operations'

export const MAX_DAY_JUMP = 5

// dayLimitMessage——目標天超過上限時的錯誤訊息;沒超過回 null。day 為 undefined(沒指定)不檢查。
export function dayLimitMessage(label: string, day: number | undefined, dayCount: number): string | null {
  if (day === undefined || day <= dayCount + MAX_DAY_JUMP) return null
  return `${label}=${day} 超過上限:目前時間軸有 ${dayCount} 天,一次最多只能往後跳 ${MAX_DAY_JUMP} 天(目標天不得超過第 ${dayCount + MAX_DAY_JUMP} 天)。請改用 ${dayCount + 1} 到 ${dayCount + MAX_DAY_JUMP} 之間的天數,或先用 add_day 逐步補天。`
}

// PlanAiCtxDeps——底層時間軸操作直接 Pick 自 PlanOperations(名稱與簽章都與 usePlanTimelineCore 一致,呼叫端可原樣傳
// core 的方法);ctx(AttractionStepsCtx)對外用同名方法包一層把關,簽章較寬的理由見 tools.ts AttractionStepsCtx 上方說明。
export interface PlanAiCtxDeps extends Pick<PlanOperations, PlanAiOperationName> {
  // getTimeline——讀「當下最新」的時間軸(同步反映剛 commit 的內容)。
  getTimeline: () => PlanTimeline
  // newId——新節點 id 產生器,測試可注入固定值。
  newId?: () => string
}

export interface PlanAiCtx {
  ctx: AttractionStepsCtx
  // ensureFreshRead——給詢問工具(AskPageCtx.ensureFreshRead)用:只檢查,不更新簽名。
  ensureFreshRead: () => void
}

export function createPlanAiCtx(deps: PlanAiCtxDeps): PlanAiCtx {
  const newId = deps.newId ?? (() => `agent-${crypto.randomUUID()}`)
  let lastReadSignature: string | null = null
  // pendingRemovals——AI 已受理、但還在淡出動畫中的刪除 id(見檔頭)。節點真的摘除後在 currentSignature 內順手清掉。
  const pendingRemovals = new Set<string>()

  const currentSignature = (): string => {
    let timeline = deps.getTimeline()
    for (const id of [...pendingRemovals]) {
      if (!hasNode(timeline, id)) {
        pendingRemovals.delete(id)
        continue
      }
      const removed = removeNode(timeline, id)
      if (removed.ok) timeline = removed.timeline
    }
    return structureSignature(timeline)
  }
  const ensureFreshRead = () => {
    if (lastReadSignature !== currentSignature()) throw new Error(STALE_READ_MESSAGE)
  }
  // markWritten——AI 自己的寫入成功後呼叫:把已讀簽名更新成寫入後的簽名。
  const markWritten = () => {
    lastReadSignature = currentSignature()
  }
  const assertDayLimit = (label: string, day: number | undefined) => {
    const message = dayLimitMessage(label, day, deps.getTimeline().days.length)
    if (message) throw new Error(message)
  }

  const ctx: AttractionStepsCtx = {
    getTimeline: () => {
      const timeline = deps.getTimeline()
      lastReadSignature = currentSignature()
      return timeline
    },
    addStop: async (anchorId, step) => {
      ensureFreshRead()
      assertDayLimit('day', step.day)
      const result = deps.addStop(anchorId, newId(), step)
      if (!result.ok) return { ok: false, error: result.error }
      markWritten()
      return { ok: true, id: result.insertedId }
    },
    setStopNote: async (anchorId, text, category) => {
      ensureFreshRead()
      const result = deps.setStopNote(anchorId, text, category)
      if (!result.ok) return { ok: false, error: result.error }
      markWritten()
      return { ok: true, id: result.insertedId }
    },
    // removeStop——見 AttractionStepsCtx.removeStop:底層回傳 boolean(id 不存在或已在移除中為 false)。
    removeStop: async (id) => {
      ensureFreshRead()
      if (!deps.removeStop(id)) {
        return {
          ok: false,
          error: { code: 'anchor_not_found', message: `找不到 id 為 "${id}" 的節點,無法移除(可能不存在,或正在移除中)。` },
        }
      }
      pendingRemovals.add(id)
      markWritten()
      return { ok: true }
    },
    addDay: async (atDay) => {
      ensureFreshRead()
      assertDayLimit('atDay', atDay)
      const result = deps.addDay(atDay)
      if (!result.ok) return result
      markWritten()
      return result
    },
    moveDay: async (fromDay, toDay) => {
      ensureFreshRead()
      const result = deps.moveDay(fromDay, toDay)
      if (!result.ok) return { ok: false, error: result.error }
      markWritten()
      return { ok: true, dayCount: result.dayCount }
    },
    setLodging: async (args) => {
      ensureFreshRead()
      const result = deps.setLodging(args)
      if (!result.ok) return { ok: false, error: result.error }
      markWritten()
      return { ok: true, lodgingId: result.lodgingId, created: result.created, removed: result.removed, days: result.days, dayCount: result.dayCount }
    },
    removeLodging: async (lodgingId) => {
      ensureFreshRead()
      const result = deps.removeLodging(lodgingId)
      if (!result.ok) return { ok: false, error: result.error }
      markWritten()
      return { ok: true }
    },
  }
  return { ctx, ensureFreshRead }
}
