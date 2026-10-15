import type { PlanAction } from './AIPlanTimelinePage'
import type { PlanSimSource } from './planSimSource'
import { PLAN_SIM_SCRIPT } from './planSimScript'

// planSimScrollSource.ts — PlanSimSource(見該檔案開頭的完整說明)的
// 第三種實作:播放進度由外部推進,而不是自己用計時器往前跑。
//
// 用途是首頁的 AI 展示——使用者捲動頁面時,行程一站一站往下排出來。
// 跟 planSimFakeSource(計時器自動播完)是互斥的兩種節奏:
//   - 計時器版:進頁就自動播,使用者被動觀看(/ai-plan 展示頁)
//   - 捲動版:使用者捲多少、就播多少,節奏由他自己掌握(首頁)
//
// 為什麼不改 planSimFakeSource 加一個 mode 參數:兩者對「什麼時候送出
// 下一則」的答案完全不同(計時器 vs 外部呼叫),而其餘部分(劇本內容、
// thinking 前導、emit 給訂閱者)本來就只有幾行。拆成兩個實作、各自對
// PlanSimSource 這個既有介面負責,比在一個實作裡用 if 分岔兩種驅動方式
// 清楚——消費端(usePlanSimSocket)完全不需要知道差別,它只看介面。
//
// 回捲以「天」為單位,不做逐站倒退(2026-10,使用者明確要求「首頁展示,
// 當往回滾到前一天時,清除當天的資料」)。
//
// 為什麼不逐站:PlanSimSource 是串流模型(onMessage 推送,對齊
// WebSocket 的既有心智),串流無法「收回」已經發出的訊息。要逐站倒退
// 得改成進度驅動的模型——給定 progress 算出該時刻的完整時間軸,而不是
// 累積事件,那是整個模型的改寫。
//
// 以天為單位則不需要改模型:送一則 reset_day(見 PlanAction 的完整
// 說明)請接收端清掉那一天,播放進度倒回那天的第一步即可。往下捲時
// 這一天會重新一站一站排出來,其餘天數完全不受影響。
//
// 同一天內的回捲不做任何事——那是使用者在這一天的範圍內來回微調捲動
// 位置,清掉整天會讓畫面一直閃。

// ScrollPlanSource — 比 PlanSimSource 多一個 advance(),讓呼叫端把
// 捲動位置換算成「該播到第幾則」之後推進。
export interface ScrollPlanSource extends PlanSimSource {
  // advanceTo — 推進到第 n 個「播放步驟」(0-based 的下一個待播步驟)。
  //
  // 2026-10 使用者明確要求「骨架跟地點的信號要分開」:這裡的單位從
  // 「劇本動作索引」改成「播放步驟」——每個非 done 的劇本動作現在拆成
  // 兩個獨立步驟(先 thinking 讓骨架卡單獨出現並停留,下一次 advanceTo
  // 才送出真正的 action 讓它轉成完整卡),done 本身只佔一個步驟(不需要
  // thinking 前導,直接送出並結束)。呼叫端(捲動模式的 ScrollPlanDemo.tsx
  // /計時器模式的 planSimFakeSource.ts 同構寫法)不需要知道劇本動作跟
  // 步驟數的換算關係,只需要把進度換算成 0~total 的步驟數即可,內部
  // 自己拆解每個索引對應哪個劇本動作、該送 thinking 還是 action(見
  // STEPS_PER_ACTION/resolveStep 的完整說明)。
  //
  // 冪等:傳入相同值不會重複送出。傳入較小的值在跨出當天時會送一則
  // reset_day 並把進度倒回那天的第一步(見上方對回捲的完整說明)。
  // 呼叫端可以每次捲動事件都無腦呼叫,不需要自己記住上次推進到哪裡、
  // 也不需要判斷方向。
  //
  // 一次推進多步時只會真正送出一個事件、停在那裡——理由同原本「一開始
  // 跳太快」的修正(見 resolveStep 呼叫處的完整說明),跳過的部分留給
  // 下一次呼叫自然推進。
  advanceTo(index: number): void
  // total — 全部播放步驟數,讓呼叫端把捲動百分比換算成步驟索引。
  readonly total: number
}

// STEPS_PER_ACTION——每個劇本動作(除了 done)拆成幾個播放步驟。
const STEPS_PER_ACTION = 2

// resolveStep——把一個「播放步驟索引」解析成對應的劇本動作與這一步該
// 送出 thinking 還是 action 本身。劇本陣列裡 done 一定是最後一則(見
// planSimScript.ts 的既有慣例),只佔一個步驟、不需要 thinking 前導;
// 其餘每個動作佔兩步(偶數步驟送 thinking,奇數步驟送 action 本身)。
// stepIndex 超出範圍時回傳 null,呼叫端據此判斷已經播完。
function resolveStep(stepIndex: number): { action: PlanAction; phase: 'thinking' | 'action' } | null {
  const lastActionIndex = PLAN_SIM_SCRIPT.length - 1
  const doneStepIndex = lastActionIndex * STEPS_PER_ACTION
  if (stepIndex === doneStepIndex) {
    return { action: PLAN_SIM_SCRIPT[lastActionIndex], phase: 'action' }
  }
  if (stepIndex > doneStepIndex) return null
  const actionIndex = Math.floor(stepIndex / STEPS_PER_ACTION)
  const phase = stepIndex % STEPS_PER_ACTION === 0 ? 'thinking' : 'action'
  return { action: PLAN_SIM_SCRIPT[actionIndex], phase }
}

// dayOfStep——某個播放步驟屬於行程的第幾天。
//
// 劇本裡只有 add_stop 帶 day 欄位(見 planSimScript.ts),其餘動作
// (add_note/add_message 等)依附在前一個 add_stop 之後,所以往前掃到
// 最近的一個 add_stop 取它的天數——跟 planTimeline.removeDay 判斷
// message 歸屬的方式一致。
//
// 掃不到(時間軸開頭還沒有任何 add_stop)時回傳 1,對齊 day 欄位省略
// 視為第一天的既有慣例。
function dayOfStep(stepIndex: number): number {
  const actionIndex = Math.min(Math.floor(stepIndex / STEPS_PER_ACTION), PLAN_SIM_SCRIPT.length - 1)
  for (let i = actionIndex; i >= 0; i -= 1) {
    const action = PLAN_SIM_SCRIPT[i]
    if (action.type === 'add_stop') return action.day ?? 1
  }
  return 1
}

// firstStepOfDay——某一天的第一個播放步驟索引。回捲清除那一天之後,
// 播放進度要倒回這裡,再往下捲才會從這一天的第一站重新排起。
function firstStepOfDay(day: number): number {
  for (let i = 0; i < PLAN_SIM_SCRIPT.length; i += 1) {
    const action = PLAN_SIM_SCRIPT[i]
    if (action.type === 'add_stop' && (action.day ?? 1) === day) return i * STEPS_PER_ACTION
  }
  return 0
}

export function createPlanSimScrollSource(): ScrollPlanSource {
  const messageCbs = new Set<(action: PlanAction) => void>()
  const errorCbs = new Set<() => void>()
  let cancelled = false
  // played — 已經送出到第幾個播放步驟(exclusive:played 等於下一個
  // 待播步驟的索引,見 resolveStep 的完整說明)。
  let played = 0
  // total——done 本身只佔一步,其餘每個動作佔 STEPS_PER_ACTION 步。
  const total = (PLAN_SIM_SCRIPT.length - 1) * STEPS_PER_ACTION + 1

  function emit(action: PlanAction) {
    if (cancelled) return
    for (const cb of messageCbs) cb(action)
  }

  return {
    advanceTo(index: number) {
      if (cancelled) return
      const target = Math.min(index, total)
      if (target < played) {
        // 回捲(使用者明確要求「首頁展示,當往回滾到前一天時,清除當天
        // 的資料」)。
        //
        // 不做逐站倒退——串流模型無法收回已送出的訊息(見檔頭的完整
        // 說明)。改成以「天」為單位回退:目標位置跟目前進度跨越了日界
        // 時,把正要退出的那一天整個清掉(reset_day),播放進度倒回那天
        // 的第一步,再往下捲時這一天重新一站一站排出來。
        //
        // 還在同一天內的回捲不做任何事——那是使用者在這一天的範圍內
        // 來回微調捲動位置,清掉整天會讓畫面一直閃。只有真的跨出這一天
        // 才清除。
        const currentDay = dayOfStep(played - 1)
        const targetDay = dayOfStep(target)
        if (targetDay >= currentDay) return
        emit({ type: 'reset_day', day: currentDay })
        played = firstStepOfDay(currentDay)
        return
      }
      // 停在原地(target === played)不做任何事。
      if (target === played) return
      // 2026-10 使用者明確回報「一開始的信號太密了,滾動時一次就把兩個
      // 站點顯示出來」:這裡每次呼叫最多推進一個播放步驟,跳過的部分
      // 留給下一次呼叫自然推進——這代表使用者捲動很快一次跳過很多步
      // 後完全停下不動時,畫面會停在目前已播到的進度,不會自動追趕剩下
      // 的步驟(使用者明確確認這個取捨可接受,見這次修正的討論)。
      const step = resolveStep(played)
      played += 1
      if (!step) return
      if (step.phase === 'thinking') {
        // thinking:消費端(usePlanSimSocket)用它驅動 isGenerating,
        // 讓骨架卡單獨出現、停留在這個狀態,直到下一個播放步驟(action
        // 本身)才轉成完整卡——這正是「骨架跟地點的信號要分開」的
        // 落地,兩者不再是同一次 advanceTo 呼叫內連續送出。
        // nextType/nextId——2026-10 使用者明確要求「先分離推論中跟安排
        // 中的信號」/「安排中時就加入一張卡片,只是這張卡片沒有資料時
        // 就呈現骨架卡」:帶上 step.action.type 跟 step.action.id(見
        // PlanAction.nextType/nextId 的完整說明),讓接收端判斷下一步
        // 是不是真的 add_stop、以及待會兒要插入的佔位節點該用哪個 id。
        emit({ type: 'thinking', nextType: step.action.type, nextId: step.action.id })
        return
      }
      emit(step.action)
    },
    total,
    onMessage(cb) {
      messageCbs.add(cb)
      return () => messageCbs.delete(cb)
    },
    onError(cb) {
      errorCbs.add(cb)
      return () => errorCbs.delete(cb)
    },
    close() {
      cancelled = true
      messageCbs.clear()
      errorCbs.clear()
    },
  }
}
