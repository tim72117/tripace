import { describe, expect, it } from 'vitest'
import { buildLiveHandoverUrl } from './liveHandoverUrl'

describe('buildLiveHandoverUrl', () => {
  it('保留 embedded、debugSafeArea,移除 skipDemo', () => {
    expect(buildLiveHandoverUrl('?embedded=1&debugSafeArea=1&skipDemo=1')).toBe(
      '/ai-plan/live?embedded=1&debugSafeArea=1',
    )
  })
  it('沒有參數時不帶問號', () => {
    expect(buildLiveHandoverUrl('')).toBe('/ai-plan/live')
  })
  it('只有 skipDemo 時不帶問號', () => {
    expect(buildLiveHandoverUrl('?skipDemo=1')).toBe('/ai-plan/live')
  })
})
