import { describe, it, expect, vi } from 'vitest'
import { toAgentBridgeTools } from './toAgentBridgeTools'
import type { ClientTool } from './arrayTools'

const tool = (name: string, handle: (a: Record<string, unknown>, c: unknown) => unknown) =>
  ({ name, handle }) as unknown as ClientTool<unknown>

describe('toAgentBridgeTools onToolResult', () => {
  it('收到 await 後的實際結果,並照常回傳', async () => {
    const onToolResult = vi.fn()
    const rec = toAgentBridgeTools([tool('t', async (a) => ({ ok: a.x }))], {}, onToolResult)
    await expect(rec.t({ x: 1 })).resolves.toEqual({ ok: 1 })
    expect(onToolResult).toHaveBeenCalledWith({ name: 't', args: { x: 1 }, result: { ok: 1 } })
  })
  it('handle 拋錯時不呼叫 onToolResult,錯誤往外拋', async () => {
    const onToolResult = vi.fn()
    const rec = toAgentBridgeTools([tool('t', async () => { throw new Error('boom') })], {}, onToolResult)
    await expect(rec.t({})).rejects.toThrow('boom')
    expect(onToolResult).not.toHaveBeenCalled()
  })
  it('未傳 onToolResult 也能正常執行', async () => {
    const rec = toAgentBridgeTools([tool('t', () => 5)], {})
    await expect(rec.t({})).resolves.toBe(5)
  })
})
