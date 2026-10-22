// resolveMapCenter 契約測試——規則見 mapCenter.ts 檔頭。
import { describe, it, expect } from 'vitest'
import { DEFAULT_MAP_CENTER, resolveMapCenter } from './mapCenter'

describe('resolveMapCenter', () => {
  it('undefined = 呼叫端還在決定,維持 undefined(地圖先不建)', () => {
    expect(resolveMapCenter(undefined)).toBeUndefined()
  })

  it('null = 查無可用座標,退回預設起點(新旅程、剛登入的常態路徑)', () => {
    expect(resolveMapCenter(null)).toEqual(DEFAULT_MAP_CENTER)
  })

  it('有座標就原樣使用', () => {
    const c = { lat: 22.99, lng: 120.2 }
    expect(resolveMapCenter(c)).toBe(c)
  })

  it('預設起點維持原本 PlanMap 寫死的座標', () => {
    expect(DEFAULT_MAP_CENTER).toEqual({ lat: 35.0, lng: 135.76 })
  })
})
