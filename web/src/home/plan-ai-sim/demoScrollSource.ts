import type { PlanAction } from './AIPlanTimelinePage'
import type { PlanSimSource } from './planSimSource'
import { DEMO_SCRIPT } from './demoScript'

// demoScrollSource.ts — PlanSimSource(見該檔案開頭的完整說明)給小展示
// (首頁 ScrollPlanDemo.tsx,見 docs/terminology.md「/ai-plan 展示頁三
// 階段」的完整定義)專用的捲動驅動播放實作。2026-10 新增(使用者明確
// 要求「小展示只留 5 個」景點站,並確認要用「另寫一套獨立的 demo
// source」而非讓 planSimScrollSource.ts 的 createPlanSimScrollSource
// 新增劇本參數):邏輯跟 planSimScrollSource.ts 完全一樣,只是讀的劇本
// 換成 demoScript.ts 的 DEMO_SCRIPT——理由同 demoSimSource.ts 的完整
// 說明:小展示跟播放態是分離的兩套概念,不是同一套 source 邏輯參數化
// 要播哪份資料,因此刻意另外複製一份而不是替既有函式加參數。

// DemoScrollSource — 比 PlanSimSource 多一個 advance(),定義同
// planSimScrollSource.ts 的 ScrollPlanSource。
export interface DemoScrollSource extends PlanSimSource {
  advanceTo(index: number): void
  readonly total: number
}

// STEPS_PER_ACTION——每個劇本動作(除了 done)拆成幾個播放步驟,數值與
// 理由同 planSimScrollSource.ts 的同名常數。
const STEPS_PER_ACTION = 2

// resolveStep/dayOfStep/firstStepOfDay——邏輯與理由同
// planSimScrollSource.ts 的同名函式,只是讀 DEMO_SCRIPT 而非
// PLAN_SIM_SCRIPT。
function resolveStep(stepIndex: number): { action: PlanAction; phase: 'thinking' | 'action' } | null {
  const lastActionIndex = DEMO_SCRIPT.length - 1
  const doneStepIndex = lastActionIndex * STEPS_PER_ACTION
  if (stepIndex === doneStepIndex) {
    return { action: DEMO_SCRIPT[lastActionIndex], phase: 'action' }
  }
  if (stepIndex > doneStepIndex) return null
  const actionIndex = Math.floor(stepIndex / STEPS_PER_ACTION)
  const phase = stepIndex % STEPS_PER_ACTION === 0 ? 'thinking' : 'action'
  return { action: DEMO_SCRIPT[actionIndex], phase }
}

function dayOfStep(stepIndex: number): number {
  const actionIndex = Math.min(Math.floor(stepIndex / STEPS_PER_ACTION), DEMO_SCRIPT.length - 1)
  for (let i = actionIndex; i >= 0; i -= 1) {
    const action = DEMO_SCRIPT[i]
    if (action.type === 'add_stop') return action.day ?? 1
  }
  return 1
}

function firstStepOfDay(day: number): number {
  for (let i = 0; i < DEMO_SCRIPT.length; i += 1) {
    const action = DEMO_SCRIPT[i]
    if (action.type === 'add_stop' && (action.day ?? 1) === day) return i * STEPS_PER_ACTION
  }
  return 0
}

export function createDemoScrollSource(): DemoScrollSource {
  const messageCbs = new Set<(action: PlanAction) => void>()
  const errorCbs = new Set<() => void>()
  let cancelled = false
  let played = 0
  const total = (DEMO_SCRIPT.length - 1) * STEPS_PER_ACTION + 1

  function emit(action: PlanAction) {
    if (cancelled) return
    for (const cb of messageCbs) cb(action)
  }

  return {
    advanceTo(index: number) {
      if (cancelled) return
      const target = Math.min(index, total)
      if (target < played) {
        const currentDay = dayOfStep(played - 1)
        const targetDay = dayOfStep(target)
        if (targetDay >= currentDay) return
        emit({ type: 'reset_day', day: currentDay })
        played = firstStepOfDay(currentDay)
        return
      }
      if (target === played) return
      const step = resolveStep(played)
      played += 1
      if (!step) return
      if (step.phase === 'thinking') {
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
