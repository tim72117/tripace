import { describe, expect, it } from 'vitest'
import { VARIANT_KINDS, VARIANT_SPECS, fitWithin } from './photoVariants'

describe('fitWithin', () => {
  it('橫圖:最長邊縮到上限,等比例', () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 })
  })
  it('直圖:最長邊是高', () => {
    expect(fitWithin(3000, 4000, 400)).toEqual({ width: 300, height: 400 })
  })
  it('原圖已經比上限小就不放大', () => {
    expect(fitWithin(300, 200, 1024)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(1024, 768, 1024)).toEqual({ width: 1024, height: 768 })
  })
  it('極端長寬比:短邊至少 1px', () => {
    expect(fitWithin(10000, 3, 400)).toEqual({ width: 400, height: 1 })
  })
})

describe('VARIANT_SPECS', () => {
  it('LLM 縮圖的解析度刻意介於 thumbnail 與 large 之間', () => {
    expect(VARIANT_SPECS.llm.maxEdge).toBeGreaterThan(VARIANT_SPECS.thumbnail.maxEdge)
    expect(VARIANT_SPECS.llm.maxEdge).toBeLessThan(VARIANT_SPECS.large.maxEdge)
  })
  it('顯示必需的 thumbnail/large 排在選填的 llm 前面上傳', () => {
    expect(VARIANT_KINDS).toEqual(['thumbnail', 'large', 'llm'])
  })
})
