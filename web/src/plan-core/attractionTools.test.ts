// attractionTools.test.ts — 目前只針對 remove_attraction 補測試:
// parseRemoveAttractionArgs 的參數驗證,以及 removeAttraction 這個
// ClientTool 在 ctx.removeStep 回傳 ok:false(id 不存在)時,是否如預期
// throw 出人類可讀的錯誤訊息,而不是靜默吞掉。其餘既有工具
// (search_attraction/add_attraction/add_note/list_itinerary)目前沒有
// 既有測試檔案可比照,這裡不額外補——範圍限定在這次新增的 remove_attraction。
import { describe, expect, it, vi } from 'vitest'
import { removeAttraction, type AttractionStepsCtx } from './attractionTools'

function makeCtx(overrides: Partial<AttractionStepsCtx> = {}): AttractionStepsCtx {
  return {
    getSteps: () => [],
    insertAttractionAfter: vi.fn(),
    addNote: vi.fn(),
    removeStep: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  }
}

describe('removeAttraction', () => {
  it('缺少 id 時直接 throw,不呼叫 ctx.removeStep', async () => {
    const removeStep = vi.fn()
    const ctx = makeCtx({ removeStep })
    await expect(removeAttraction.handle({}, ctx)).rejects.toThrow('缺少 id')
    expect(removeStep).not.toHaveBeenCalled()
  })

  it('id 存在時呼叫 ctx.removeStep 並立即回傳成功(不等待動畫)', async () => {
    const removeStep = vi.fn(async () => ({ ok: true as const }))
    const ctx = makeCtx({ removeStep })
    const result = await removeAttraction.handle({ id: 'n2' }, ctx)
    expect(removeStep).toHaveBeenCalledWith('n2')
    expect(result).toEqual({ id: 'n2', removed: true })
  })

  it('ctx.removeStep 回傳 ok:false(id 不存在)時,把錯誤訊息原樣 throw 給呼叫端', async () => {
    const ctx = makeCtx({
      removeStep: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'anchor_not_found' as const, message: '找不到 id 為 "not-exist" 的節點,無法移除。' },
      })),
    })
    await expect(removeAttraction.handle({ id: 'not-exist' }, ctx)).rejects.toThrow('找不到 id 為 "not-exist" 的節點')
  })

  it('raw args 裡 id 不是 string 時視為缺漏(空字串),一律 throw', async () => {
    const removeStep = vi.fn()
    const ctx = makeCtx({ removeStep })
    await expect(removeAttraction.handle({ id: 123 }, ctx)).rejects.toThrow('缺少 id')
    expect(removeStep).not.toHaveBeenCalled()
  })
})
