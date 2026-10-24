import { describe, it, expect, vi } from 'vitest'
import { resetBridgeTurnState } from './TripPlanPage'
import { createBridgeGuard, createSendSequence, guardCallback } from '../plan-core/bridgeGuard'

// bridgeReconnectReset.test.ts — 連線 effect 重建(cfg 換參照、按停止、卸載)時,推論狀態要一併重設。
//
// 回歸的 bug:推論中 cfg 換參照(換 token、重新登入)→ cleanup 讓舊世代過期並關掉連線,但沒有重設
// isThinking/isThinkingRef 與 pendingChatRef。舊世代的回覆被 guard 丟掉、永遠不會來,輸入框卡在「AI 思考中」。
// 刻意不渲染 TripPlanPage(會建立 onagent 連線、依賴 import.meta.env 與 google.maps),只測抽出的重設函式,
// 並用真實的 bridgeGuard 模擬「舊世代晚到的事件」。

function makeState() {
  return {
    isThinkingRef: { current: true },
    pendingChatRef: { current: [101] as number[] },
    sendSeq: createSendSequence(),
    setIsThinking: vi.fn(),
  }
}

describe('resetBridgeTurnState', () => {
  it('重設思考中狀態(ref 與 state)並清空待配對佇列', () => {
    const s = makeState()
    resetBridgeTurnState(s)
    expect(s.isThinkingRef.current).toBe(false)
    expect(s.setIsThinking).toHaveBeenCalledWith(false)
    expect(s.pendingChatRef.current).toEqual([])
  })

  it('讓還在等 postPlanAiChat 的送出失效(不會在重連後把舊送出轉發到新連線)', () => {
    const s = makeState()
    const token = s.sendSeq.begin()
    resetBridgeTurnState(s)
    expect(s.sendSeq.isCurrent(token)).toBe(false)
  })

  it('舊世代晚到的回覆被丟掉,不會改到新世代的狀態', () => {
    const s = makeState()
    // 舊世代的 onAssistantMessage(與 TripPlanPage 同樣包 guardCallback,行為是收回思考中並 shift 佇列)
    const oldGuard = createBridgeGuard()
    const oldOnAssistantMessage = guardCallback(oldGuard, () => {
      s.isThinkingRef.current = false
      s.setIsThinking(false)
      s.pendingChatRef.current.shift()
    })

    // 連線重建:cleanup 先 expire 舊世代,再重設推論狀態
    oldGuard.expire()
    resetBridgeTurnState(s)

    // 新世代:使用者送出新訊息
    s.isThinkingRef.current = true
    s.pendingChatRef.current.push(202)
    s.setIsThinking.mockClear()

    // 舊世代的回覆此時才抵達
    oldOnAssistantMessage()

    expect(s.isThinkingRef.current).toBe(true)
    expect(s.pendingChatRef.current).toEqual([202])
    expect(s.setIsThinking).not.toHaveBeenCalled()
  })
})
