// guard.ts —onagent bridge 的「世代防護」:一個 bridge 實例(一次連線 effect)對應一個 guard,
// 使用者按「停止」或元件卸載時 expire(),之後這個世代留下來的回呼與工具呼叫一律失效。
//
// 為什麼需要(讀 @onagent/bridge 0.2.0 dist/client.js 的結論,TripPlanPage 的 stopPrompt 靠它):
//   1. bridge.close() 只設 closedByUser、解除 visibility 監聽並關掉 transport。WebSocket 的 message 事件在 readyState
//      不是 OPEN 之後不再派發;SSE 的 shutdown 會 es.close(),且 transport 的 onMessage 是同步派發。所以 close() 之後
//      「新的」assistant_message/tool_call/error 基本上不會再進來——但這是瀏覽器行為的推論,不是 SDK 的保證。
//   2. close() 不會取消「已經在跑」的工具:handleToolCall 是 `await handler(args)`,close() 當下已經進了 handler 的工具
//      (例如 search_attraction 還在等網路,回來後才呼叫 ctx.insertAttractionAfter)會照常往下執行並寫入時間軸;
//      它最後的 tool_result 只會被 write() 塞進已無人 flush 的 queue。這才是停止之後仍可能改動行程的真實缺口。
//   3. onError 也可能在 close() 之後被呼叫:SSE 的 POST 失敗回報(onSendFailed → opts.onError)是 fetch 非同步完成後才發生,
//      與 transport 是否已關閉無關。
//   4. stopPrompt 是遞增 state 讓 effect 重連,cleanup 要等 React 下一次 commit 才跑;這中間有一小段視窗,
//      所以 stopPrompt 要「立刻」expire 目前世代,不能只靠 cleanup。
// 因此:回呼過期就丟掉(不 append、不碰 pendingChatRef 佇列),工具方法過期就 throw 讓晚到的工具呼叫失敗而不是寫入時間軸。
// 純函式、不依賴 React,方便單獨測試。

export class StaleBridgeError extends Error {
  constructor() {
    super('這次對話已被使用者停止,這個工具呼叫沒有執行。')
    this.name = 'StaleBridgeError'
  }
}

export interface BridgeGuard {
  // isCurrent——這個世代是否仍有效(未 expire)。
  isCurrent(): boolean
  // expire——標記為過期,不可逆。重複呼叫無副作用。
  expire(): void
}

export function createBridgeGuard(): BridgeGuard {
  let current = true
  return {
    isCurrent: () => current,
    expire: () => {
      current = false
    },
  }
}

// guardCallback——包裝 bridge 的事件回呼(onAssistantMessage/onError):過期就直接丟掉,什麼都不做。
export function guardCallback<A extends unknown[]>(guard: BridgeGuard, fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    if (!guard.isCurrent()) return
    fn(...args)
  }
}

// guardCtx——包裝工具的 ctx 物件:每個函式型成員在入口先檢查世代,過期就 throw StaleBridgeError(工具呼叫因此失敗,
// 不會寫入時間軸、也不會開詢問頁)。檢查在「最外層」,早於 ctx 內部的 assertFreshRead 等其他檢查。
// 只包函式成員;非函式成員原樣保留。
export function guardCtx<T extends object>(guard: BridgeGuard, ctx: T): T {
  const wrapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(ctx)) {
    wrapped[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            if (!guard.isCurrent()) throw new StaleBridgeError()
            return (value as (...a: unknown[]) => unknown)(...args)
          }
        : value
  }
  return wrapped as T
}

// createSendSequence——「送出」的流水號:sendPrompt 在 await postPlanAiChat 之前 begin() 取得 token,await 回來後用 isCurrent(token)
// 確認期間沒有被 invalidate()(使用者按了停止)。過期的送出訊息已存檔,但不再轉發給 onagent、也不 push pendingChatRef。
export interface SendSequence {
  begin(): number
  isCurrent(token: number): boolean
  invalidate(): void
}
export function createSendSequence(): SendSequence {
  let seq = 0
  return {
    begin: () => ++seq,
    isCurrent: (token) => token === seq,
    invalidate: () => {
      seq += 1
    },
  }
}
