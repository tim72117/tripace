// layoutDebugFlag 契約測試——規則見 layoutDebugFlag.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { isLayoutDebugEnabled } from './layoutDebugFlag'

describe('isLayoutDebugEnabled', () => {
  it('網址有 debugSafeArea 參數就開(值不重要)', () => {
    expect(isLayoutDebugEnabled('?debugSafeArea=1')).toBe(true)
    expect(isLayoutDebugEnabled('?debugSafeArea')).toBe(true)
    expect(isLayoutDebugEnabled('?a=1&debugSafeArea=0')).toBe(true)
  })
  it('沒有參數、空字串、其他參數都不開', () => {
    expect(isLayoutDebugEnabled('')).toBe(false)
    expect(isLayoutDebugEnabled('?skipDemo=1')).toBe(false)
    expect(isLayoutDebugEnabled('?debugSafeAreaX=1')).toBe(false)
  })
  it('參數名稱區分大小寫(與 /ai-plan 的 URLSearchParams.has 一致)', () => {
    expect(isLayoutDebugEnabled('?debugsafearea=1')).toBe(false)
  })
})
