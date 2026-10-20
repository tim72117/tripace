// planSimFakeSource.ts — PlanSimSource(見該檔案開頭的完整說明)的純
// 前端實作:用 setTimeout 逐步播放 planSimScript.ts 的固定劇本,節奏
// 對齊原始後端 plan_sim_demo.go 的 sendWithThinking(每則實際 action 送出
// 前先送一則 thinking、停頓 700~1200ms 隨機延遲,再送出實際內容)。
// 建立後立即自動從頭播到 done,不需要任何「開啟模擬」「下一步」之類的
// 手動控制——使用者明確要求這個頁面「預設進入會全部播放,用來展示功能
// 用的」,不是原始版本那種可暫停/單步推進/測試按鈕觸發額外訊息的互動
// 模擬器,故不移植 planSimTriggerActions(觸發表)與「下一步」等待機制。
//
// openAskPage(2026-10 新增,使用者明確要求「播放畫面第一個先模擬送出
// 一個 ask」)是這個「全部自動播放」原則底下唯一的例外,但不是靠
// PlanSimSource 介面新增暫停/恢復方法做到的——使用者明確要求「不要在
// UI 埋入相關程式碼」且「暫停不該由消費端中斷,推論層本身就可以控制
// 要不要輸出信號」:這支工廠函式現在直接接收 openAskPage 這個函式當
// 建立參數,形狀跟真實 AgentBridge 收到的 open_ask_page 工具 handle 完全
// 對應((candidates) => Promise<selection>,見
// plan-core/askPageTools.ts AskPageCtx.openAskPage 的完整說明)。
// playFrom 遇到這則 action 時直接 await 這個函式——這正是真實系統的
// 運作方式:AgentBridge 呼叫工具的 handle 之後,下一步要說什麼本來就
// 要等這次工具呼叫回傳才知道,不是外部介入讓它暫停,是它自己選擇在這
// 裡等待。PlanSimSource 介面因此完全不需要改動,暫停邏輯整個封裝在
// 這個實作內部,消費端(usePlanSimSocket)跟 UI(AskPage.tsx)都不需要
// 知道這件事發生過。

import type { PlanAction } from './AIPlanTimelinePage'
import type { AskPageCandidate, AskPageSelection } from '../../plan-core/askPageTools'
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
//
// openAskPage——選填,見檔頭的完整說明。省略時(例如某些呼叫端完全不
// 需要示範這個暫停點,或測試情境)劇本若剛好播到 open_ask_page 這則,
// 直接當作沒有候選可問、跳過等待立即繼續——不強迫每個呼叫端都要提供
// 這個函式才能使用這支工廠函式,對齊 dataSource 等其餘選填參數的既有
// 慣例(省略時該功能的最小可用行為仍然成立)。
export function createPlanSimFakeSource(
  openAskPage?: (input: { candidates: AskPageCandidate[]; picks?: string[] }) => Promise<AskPageSelection[]>,
): PlanSimSource {
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
  //
  // async——2026-10 新增(見檔頭 openAskPage 的完整說明):open_ask_page
  // 這則送出後,直接 await ctx 提供的 openAskPage(candidates),等使用者
  // 在 AskPage 上操作完、Promise resolve 才繼續排下一則。這是這個函式
  // 唯一會真的等待外部事件的地方,其餘動作仍然維持「播完立即排下一則」
  // 的既有行為,不受影響。
  async function playFrom(index: number) {
    if (cancelled || index >= PLAN_SIM_SCRIPT.length) return
    const action = PLAN_SIM_SCRIPT[index]
    if (action.type === 'done') {
      emit(action)
      return
    }
    // nextType/nextId——2026-10 使用者明確要求「先分離推論中跟安排中的
    // 信號」/「安排中時就加入一張卡片,只是這張卡片沒有資料時就呈現
    // 骨架卡」:帶上 action.type 跟 action.id(見 PlanAction.nextType/
    // nextId 的完整說明),讓接收端判斷下一步是不是真的 add_stop、以及
    // 待會兒要插入的佔位節點該用哪個 id,才能在真正的 add_stop 訊息
    // 到達時用 updateNode 原地補資料,不需要插入新節點。
    emit({ type: 'thinking', nextType: action.type, nextId: action.id })
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, randomDelayMs())
    })
    if (cancelled) return
    emit(action)
    // open_ask_page——見檔頭與這支函式開頭的完整說明:await 使用者在
    // AskPage 上操作完,才繼續排下一則。劇本固定只用 candidates 模式
    // (探查模式依賴即時的地圖中心/使用者位置,不適合寫死在固定劇本
    // 裡,見 plan-core/askPageTools.ts AskPageExplore 的完整說明)。
    // candidates 缺漏或沒有提供 openAskPage 函式時直接跳過等待(見上方
    // openAskPage 參數選填的說明),不會卡住整段播放。
    if (action.type === 'open_ask_page' && openAskPage) {
      // picks——2026-10 使用者明確定調「播放態不會有真實互動」:劇本
      // 一併表達「這一步哪幾個候選被選中」(見 PlanAction.picks 的完整
      // 說明),呼叫端據此讓 AskPage 用腳本模式渲染(勾選狀態由劇本
      // 決定、不渲染按鈕列、停留一下自動送出),而不是 await 一次真人
      // 點選。這支函式本身不需要知道那些細節——它仍然只是 await 一個
      // Promise,誰 resolve、何時 resolve 都由呼叫端決定(見檔頭「它自己
      // 選擇在這裡等待」的既有說明,那個設計沒有變)。
      await openAskPage({ candidates: action.candidates ?? [], picks: action.picks })
      if (cancelled) return
    }
    // 播完這一則(含 open_ask_page 等待完成後)立即排下一則——這個頁面
    // 固定「自動全部播放」,不等待任何其他「下一步」信號(對齊使用者
    // 明確要求的展示用途,見檔頭說明),跟原始後端版本 playScript 每播
    // 完一則就卡住 waitForNextStep 的行為不同。
    void playFrom(index + 1)
  }

  // 建立後立即開始播放,不需要呼叫端額外呼叫任何「開始」方法——對齊
  // WebSocket 版本「effect 一掛載就建立連線、後端立刻開始推播」的既有
  // 時機。不 await 這次呼叫本身(playFrom 現在是 async 函式)——建立
  // 這個 source 不需要等整段劇本播完,呼叫端透過 onMessage 訂閱逐步
  // 接收,理由同原本同步版本就已經是「觸發後立刻返回」的既有行為。
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
