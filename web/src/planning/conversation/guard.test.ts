// guard.test.ts — 「停止」的世代防護(見 guard.ts 的說明)。TripPlanPage 的 usePlanAiChatBridge 把這些元件接在
// bridge 的回呼、ctx 與 sendPrompt 上;這裡用同樣的接法(回呼 + 佇列 + 真的 ctx 工廠)驗證停止後的行為。
import { describe, expect, it, vi } from 'vitest'
import { createBridgeGuard, createSendSequence, guardCallback, guardCtx, StaleBridgeError } from './guard'
import { createPlanAiCtx } from './context'
import { addAttraction, listItinerary } from './tools'
import { createEmptyTimeline, insertAfter, type PlanTimeline } from '../timeline/model'

describe('createBridgeGuard', () => {
  it('expire 之後 isCurrent 為 false,重複 expire 無副作用', () => {
    const g = createBridgeGuard()
    expect(g.isCurrent()).toBe(true)
    g.expire()
    g.expire()
    expect(g.isCurrent()).toBe(false)
  })
})

describe('guardCallback:停止後晚到的回呼被丟棄', () => {
  // 仿 usePlanAiChatBridge 的 onAssistantMessage:append 訊息、開詢問頁、shift 佇列。
  function setup() {
    const guard = createBridgeGuard()
    const pending = [1]
    const appended: string[] = []
    const opened: string[] = []
    const replied: Array<[number, string]> = []
    const onAssistantMessage = guardCallback(guard, (text: string) => {
      appended.push(text)
      opened.push(text)
      const id = pending.shift()
      if (id !== undefined) replied.push([id, text])
    })
    const onError = guardCallback(guard, (err: { message: string }) => {
      pending.shift()
      appended.push(`(連線錯誤: ${err.message})`)
    })
    return { guard, pending, appended, opened, replied, onAssistantMessage, onError }
  }

  it('世代有效時照常處理並配對佇列', () => {
    const h = setup()
    h.onAssistantMessage('你好')
    expect(h.appended).toEqual(['你好'])
    expect(h.replied).toEqual([[1, '你好']])
    expect(h.pending).toEqual([])
  })

  it('過期後 onAssistantMessage:不 append、不開詢問頁、不動佇列(下一輪回覆不會錯位配對)', () => {
    const h = setup()
    // 模擬 stopPrompt:expire 並清空佇列;之後下一輪送出又 push 了新的 messageID
    h.guard.expire()
    h.pending.length = 0
    h.pending.push(2)
    h.onAssistantMessage('舊推論晚到的回覆')
    expect(h.appended).toEqual([])
    expect(h.opened).toEqual([])
    expect(h.replied).toEqual([])
    expect(h.pending).toEqual([2])
  })

  it('過期後 onError 同樣丟棄,不 shift 佇列', () => {
    const h = setup()
    h.guard.expire()
    h.onError({ message: 'x' })
    expect(h.appended).toEqual([])
    expect(h.pending).toEqual([1])
  })
})

describe('createSendSequence:停止後在途的 sendPrompt 不轉發', () => {
  it('begin 之後 invalidate,舊 token 不再有效;新的 begin 取得有效的新 token', () => {
    const seq = createSendSequence()
    const t1 = seq.begin()
    expect(seq.isCurrent(t1)).toBe(true)
    seq.invalidate()
    expect(seq.isCurrent(t1)).toBe(false)
    const t2 = seq.begin()
    expect(seq.isCurrent(t2)).toBe(true)
    expect(seq.isCurrent(t1)).toBe(false)
  })

  it('仿 sendPrompt:await 後端期間停止 → 不 push 佇列、不呼叫 bridge.prompt', async () => {
    const seq = createSendSequence()
    const pending: number[] = []
    const prompt = vi.fn()
    let release!: (v: { messageID: number }) => void
    const post = new Promise<{ messageID: number }>((r) => (release = r))
    const send = async () => {
      const token = seq.begin()
      const result = await post
      if (!seq.isCurrent(token)) return false
      pending.push(result.messageID)
      prompt('text')
      return true
    }
    const sending = send()
    seq.invalidate() // 使用者按停止
    release({ messageID: 7 })
    expect(await sending).toBe(false)
    expect(pending).toEqual([])
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('guardCtx:過期的 ctx 工具呼叫失敗且不改時間軸', () => {
  function setup() {
    let timeline: PlanTimeline = createEmptyTimeline()
    const guard = createBridgeGuard()
    const insert = vi.fn((anchorId: string | null, newId: string, data: Parameters<typeof insertAfter>[2]) => {
      const r = insertAfter(timeline, anchorId, data, newId)
      if (r.ok) timeline = r.timeline
      return r
    })
    const { ctx: rawCtx } = createPlanAiCtx({
      getTimeline: () => timeline,
      addStop: insert,
      setStopNote: vi.fn(),
      removeStop: vi.fn(),
      addDay: vi.fn(),
      moveDay: vi.fn(),
      setLodging: vi.fn(),
      removeLodging: vi.fn(),
    })
    const ctx = guardCtx(guard, rawCtx)
    return { guard, ctx, insert, getTimeline: () => timeline }
  }

  it('世代有效:工具照常寫入', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    await addAttraction.handle({ placeId: 'p1', time: '09:00' }, h.ctx)
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.getTimeline().days[0].nodes).toHaveLength(1)
  })

  it('停止後才進 ctx 的工具(在途工具晚到)throw StaleBridgeError,不呼叫底層、時間軸不變', async () => {
    const h = setup()
    await listItinerary.handle({}, h.ctx)
    // 一個「停止前已經開始、停止後才回來呼叫 ctx」的工具:先等一個外部 promise 再寫入
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const inFlight = (async () => {
      await gate
      return addAttraction.handle({ placeId: 'p1', time: '09:00' }, h.ctx)
    })()
    h.guard.expire() // 使用者按停止
    release()
    await expect(inFlight).rejects.toBeInstanceOf(StaleBridgeError)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.getTimeline().days).toHaveLength(0)
  })

  it('過期後連 getTimeline 也失敗(不會被記成「已讀」)', async () => {
    const h = setup()
    h.guard.expire()
    await expect(listItinerary.handle({}, h.ctx)).rejects.toThrow('已被使用者停止')
  })

  it('非函式成員原樣保留', () => {
    const guard = createBridgeGuard()
    const wrapped = guardCtx(guard, { n: 3, f: () => 1 })
    expect(wrapped.n).toBe(3)
    guard.expire()
    expect(() => wrapped.f()).toThrow(StaleBridgeError)
  })
})
