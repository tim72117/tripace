import { describe, expect, it, vi } from 'vitest'
import { loadModels, modelIdOfPath, neededModelIds } from './modelIds'

const layout = {
  stops: [{ model: 'stop-a' }, { model: 'deco-rock' }],
  scatter: [{ model: 'deco-rock' }, { model: 'deco-bush' }],
} as never

describe('neededModelIds', () => {
  it('站點與散落物用到的模型(去重)加上旅人,排序固定', () => {
    expect(neededModelIds(layout)).toEqual(['deco-bush', 'deco-rock', 'stop-a', 'traveler-child', 'traveler-parent'])
  })
})

describe('modelIdOfPath', () => {
  it('取檔名(不含副檔名)', () => {
    expect(modelIdOfPath('../models/deco-rock.ts')).toBe('deco-rock')
    expect(modelIdOfPath('./models/stop-a.ts')).toBe('stop-a')
  })
})

describe('loadModels', () => {
  it('只載入需要的 id,沒用到的模型載入器不會被呼叫', async () => {
    const used = vi.fn(async () => 'rock')
    const unused = vi.fn(async () => 'tree')
    const r = await loadModels<string>(['deco-rock'], [{ '../models/deco-rock.ts': used, '../models/deco-tree.ts': unused }])
    expect(r).toEqual({ 'deco-rock': 'rock' })
    expect(unused).not.toHaveBeenCalled()
  })
  it('sources 靠後的優先(場景專屬蓋過共用);找不到載入器的 id 略過、不丟錯', async () => {
    const r = await loadModels<string>(
      ['deco-rock', 'missing'],
      [{ '../models/deco-rock.ts': async () => 'shared' }, { './models/deco-rock.ts': async () => 'local' }],
    )
    expect(r).toEqual({ 'deco-rock': 'local' })
  })
  it('任一載入失敗就整體 reject(由場景載入層顯示錯誤與重試)', async () => {
    await expect(loadModels(['a'], [{ './a.ts': async () => { throw new Error('boom') } }])).rejects.toThrow('boom')
  })
})
