// planSimSource.ts — 膠合層:把「開啟模擬」自動播放的推論信號來源收斂
// 成一個介面,usePlanSimSocket(AIPlanTimelinePage.tsx)只依賴這個介面,
// 不直接建立 WebSocket 或計時器。
//
// 背景:原始(plan-ai-sim 分支)版本是後端 handlePlanSimWS
// (plan_sim_demo.go)透過 WebSocket 逐步推播固定腳本(planSimScript)的
// 每一則 PlanAction,前端 usePlanSimSocket 的 ws.onmessage 收到後統一
// 轉呼叫 insertAttractionAfter/setNoteForStop 等處理函式。那條 WS 路徑
// 在 main 分支已改成需登入、搬到別的路徑。使用者明確要求:這個獨立
// 公開頁不打任何後端,改用純前端計時器逐步播放同一份劇本;同時要求
// 「不要改動到前端串接方式」——即 usePlanSimSocket 內收到訊息之後的
// 處理邏輯(action.type 判斷、呼叫哪個函式)一個字都不改,只把「訊息
// 從哪裡來」抽成這個介面,呼叫端注入不同實作即可切換來源。
//
// PlanSimSource 的方法命名刻意對齊 WebSocket 的既有心智模型
// (onMessage/onError/close),讓 usePlanSimSocket 原本圍繞 ws.onmessage/
// ws.onerror/ws.close 寫的邏輯只需要換呼叫對象,結構不必重寫。

import type { PlanAction } from './AIPlanTimelinePage'

export interface PlanSimSource {
  // onMessage — 註冊收到一則 PlanAction 時的回呼,回傳取消訂閱函式
  // (對齊 WebSocket 只能設一個 onmessage、但這裡允許多次註冊/取消,
  // 因為 usePlanSimSocket 每次 effect 重跑都要重新註冊一次)。
  onMessage(cb: (action: PlanAction) => void): () => void
  // onError — 連線/播放中斷時的回呼(WebSocket 版本對應 ws.onerror;
  // 前端計時器版本理論上不會真的出錯,但介面仍保留這個口子,對齊
  // WebSocket 心智模型,也讓未來若有實作需要回報錯誤有地方可用)。
  onError(cb: () => void): () => void
  // close — 主動中止播放(對齊 ws.close())。
  close(): void
}
