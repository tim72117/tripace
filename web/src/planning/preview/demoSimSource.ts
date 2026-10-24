// demoSimSource.ts — PlanSimSource(見該檔案開頭的完整說明)給小展示
// (/product FeatureShowcase.tsx,見 docs/terminology.md「/ai-plan 展示頁
// 三階段」的完整定義)專用的計時器播放實作。2026-10 新增(使用者明確
// 要求「小展示只留 5 個」景點站,並確認要用「另寫一套獨立的 demo
// source」而非讓 planSimFakeSource.ts 的 createPlanSimFakeSource 新增
// 劇本參數):邏輯跟 planSimFakeSource.ts 完全一樣,只是讀的劇本換成
// demoScript.ts 的 DEMO_SCRIPT——使用者明確要求小展示跟播放態(/ai-plan
// 完整展示頁,仍然讀 planSimScript.ts 的 PLAN_SIM_SCRIPT)是分離的兩套
// 概念,不是「同一套 source 邏輯、參數化要播哪份資料」的關係,因此刻意
// 另外複製一份而不是替既有函式加參數。
//
// 這份實作不支援 openAskPage 暫停機制——DEMO_SCRIPT 開頭雖然也有
// open_ask_page 動作(直接拷貝自 PLAN_SIM_SCRIPT 前幾站,見該檔案的
// 完整說明),但小展示本身不做互動(見 AiPlanPhoneDemoScreen.tsx 檔頭
// 「小展示不做互動」的既有定調),沒有呼叫端會傳 openAskPage 函式進來,
// 遇到這則動作時直接跳過等待、照常繼續播放,不需要像 planSimFakeSource.ts
// 那樣準備這個參數。

import type { PlanAction } from './planAction'
import type { PlanSimSource } from './planSimSource'
import { DEMO_SCRIPT } from './demoScript'

// randomDelayMs — 900~1500ms,數值與理由同 planSimFakeSource.ts 的
// 同名函式。
function randomDelayMs(): number {
  return 900 + Math.floor(Math.random() * 600)
}

// createDemoSimSource — 建立一次播放,行為對齊 planSimFakeSource.ts 的
// createPlanSimFakeSource:建立後立即自動從頭播到 done,不需要任何
// 「開啟模擬」「下一步」之類的手動控制。
export function createDemoSimSource(): PlanSimSource {
  const messageCbs = new Set<(action: PlanAction) => void>()
  const errorCbs = new Set<() => void>()
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function emit(action: PlanAction) {
    if (cancelled) return
    for (const cb of messageCbs) cb(action)
  }

  function playFrom(index: number) {
    if (cancelled || index >= DEMO_SCRIPT.length) return
    const action = DEMO_SCRIPT[index]
    if (action.type === 'done') {
      emit(action)
      return
    }
    emit({ type: 'thinking', nextType: action.type, nextId: action.id })
    timer = setTimeout(() => {
      if (cancelled) return
      emit(action)
      // 不支援 open_ask_page 暫停(見檔頭的完整說明),播完這一則立即
      // 排下一則。
      playFrom(index + 1)
    }, randomDelayMs())
  }

  void playFrom(0)

  return {
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
      if (timer != null) clearTimeout(timer)
      timer = null
    },
  }
}
