// planSimFakeSource.ts — PlanSimSource(見該檔案開頭的完整說明)的純
// 前端實作:用 setTimeout 逐步播放 planSimScript.ts 的固定劇本,節奏
// 對齊原始後端 plan_sim_demo.go 的 sendWithThinking(每則實際 action 送出
// 前先送一則 thinking、停頓 700~1200ms 隨機延遲,再送出實際內容)。
// 建立後立即自動從頭播到 done,不需要任何「開啟模擬」「下一步」之類的
// 手動控制——使用者明確要求這個頁面「預設進入會全部播放,用來展示功能
// 用的」,不是原始版本那種可暫停/單步推進/測試按鈕觸發額外訊息的互動
// 模擬器,故不移植 planSimTriggerActions(觸發表)與「下一步」等待機制。

import type { PlanAction } from './AIPlanTimelinePage'
import type { PlanSimSource } from './planSimSource'
import { PLAN_SIM_SCRIPT } from './planSimScript'

// randomDelayMs — 900~1500ms。原本使用者要求「每一個斷點都延長一點
// 時間」,調到 1400~2400ms;現在這個劇本站數變多(兩天行程),使用者
// 明確要求「行程播放速度稍微加快」,收回到比原始後端 randomDelay()
// (plan_sim_demo.go 的 700~1200ms)稍寬鬆、但比先前明顯快的區間——
// 保留足夠時間看清楚每一步,又不至於整段播完要等太久。
function randomDelayMs(): number {
  return 900 + Math.floor(Math.random() * 600)
}

// createPlanSimFakeSource — 建立一次播放。呼叫端(usePlanSimSocket)在
// 掛載時呼叫一次,對齊原本「effect 建立一條 WebSocket 連線」的生命週期
// ——這裡回傳的物件同樣代表「一次播放」,close() 呼叫後計時器全部清除,
// 不會有殘留的 setTimeout 在之後才觸發 onMessage。
export function createPlanSimFakeSource(): PlanSimSource {
  const messageCbs = new Set<(action: PlanAction) => void>()
  // errorCbs 目前沒有任何實際觸發點(見 PlanSimSource 的完整說明),但
  // 介面要求提供,呼叫端(usePlanSimSocket)也確實會註冊一個——保留這組
  // 訂閱集合是為了介面完整,不是死程式碼:未來若這份假資料來源需要
  // 模擬中斷情境,觸發點已經現成。
  const errorCbs = new Set<() => void>()
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function emit(action: PlanAction) {
    if (cancelled) return
    for (const cb of messageCbs) cb(action)
  }

  // playFrom — 遞迴排程下一則 thinking→延遲→action,對齊原始後端
  // sendWithThinking 的節奏(見該函式的完整說明)。done 訊息不經過
  // thinking/延遲,直接送出並結束整個播放,理由同原始後端 playScript
  // 對 done 的特判。
  function playFrom(index: number) {
    if (cancelled || index >= PLAN_SIM_SCRIPT.length) return
    const action = PLAN_SIM_SCRIPT[index]
    if (action.type === 'done') {
      emit(action)
      return
    }
    emit({ type: 'thinking' })
    timer = setTimeout(() => {
      if (cancelled) return
      emit(action)
      // 播完這一則立即排下一則——這個頁面固定「自動全部播放」,不等待
      // 任何「下一步」信號(對齊使用者明確要求的展示用途,見檔頭說明),
      // 跟原始後端版本 playScript 每播完一則就卡住 waitForNextStep 的
      // 行為不同。
      playFrom(index + 1)
    }, randomDelayMs())
  }

  // 建立後立即開始播放,不需要呼叫端額外呼叫任何「開始」方法——對齊
  // WebSocket 版本「effect 一掛載就建立連線、後端立刻開始推播」的既有
  // 時機。
  playFrom(0)

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
