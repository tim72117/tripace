import { describe, it, expect } from 'vitest'
import { clampToStep, defaultStartMinutesForDrag } from './PlanTimelineView'
import type { TimeDragBounds } from './planTimeline'

// 這份測試只涵蓋 PlanTimelineView.tsx 裡拖拉手勢背後的純計算邏輯
// (clampToStep/defaultStartMinutesForDrag),不測試完整的 pointer 事件
// 手勢(handlePointerDown/Move/Up)——那部分綁在原生 document 事件監聽器
// 上,要測試整條手勢需要模擬 PointerEvent 序列,相對脆弱且這個專案目前
// 沒有這類元件測試的既有慣例;這兩個函式是手勢計算的核心,直接測函式
// 本身能用低成本涵蓋最容易出錯的分支判斷,對齊 planTimeline.test.ts 把
// 純資料邏輯獨立出來測試的既有做法。

describe('clampToStep', () => {
  it('吸附到最近的 30 分鐘刻度(無邊界限制)', () => {
    const bounds: TimeDragBounds = { minMinutes: null, maxMinutes: null }
    // 9:07 → 9:00(13 分四捨五入到 0,不到半格)
    expect(clampToStep(9 * 60 + 7, bounds)).toBe(9 * 60)
    // 9:20 → 9:30(20 分比較接近下一格 30)
    expect(clampToStep(9 * 60 + 20, bounds)).toBe(9 * 60 + 30)
  })

  it('邊界本身不是刻度值時,clamp 到邊界精確值,不會把邊界也吸附掉', () => {
    // 前一站 09:15(非刻度值),拖到比這個時間還早,應該被攔在 09:15 本身,
    // 不是被吸附成 09:00 或 09:30。
    const bounds: TimeDragBounds = { minMinutes: 9 * 60 + 15, maxMinutes: null }
    expect(clampToStep(9 * 60, bounds)).toBe(9 * 60 + 15)
  })

  it('上界同樣可以是非刻度值,拖超過上界會被攔住在上界精確值', () => {
    const bounds: TimeDragBounds = { minMinutes: null, maxMinutes: 14 * 60 + 45 }
    expect(clampToStep(15 * 60, bounds)).toBe(14 * 60 + 45)
  })

  it('兩端都沒有限制時,clamp 在當天 00:00~23:59 範圍內', () => {
    const bounds: TimeDragBounds = { minMinutes: null, maxMinutes: null }
    expect(clampToStep(-30, bounds)).toBe(0)
    expect(clampToStep(30 * 60, bounds)).toBe(24 * 60 - 1)
  })
})

describe('defaultStartMinutesForDrag', () => {
  it('前後都有站點時,取中點並吸附到刻度', () => {
    // 09:00 ~ 11:00 之間,中點 10:00 本身就是刻度值
    const bounds: TimeDragBounds = { minMinutes: 9 * 60, maxMinutes: 11 * 60 }
    expect(defaultStartMinutesForDrag(bounds)).toBe(10 * 60)
  })

  it('只有下界時,從下界往後推一步(30 分鐘),不會直接貼著下界', () => {
    const bounds: TimeDragBounds = { minMinutes: 9 * 60, maxMinutes: null }
    expect(defaultStartMinutesForDrag(bounds)).toBe(9 * 60 + 30)
  })

  it('只有上界時,從上界往前推一步(30 分鐘),不會直接貼著上界', () => {
    const bounds: TimeDragBounds = { minMinutes: null, maxMinutes: 15 * 60 }
    expect(defaultStartMinutesForDrag(bounds)).toBe(15 * 60 - 30)
  })

  it('兩端都沒有限制時(當天唯一一站),退回預設值 09:00', () => {
    const bounds: TimeDragBounds = { minMinutes: null, maxMinutes: null }
    expect(defaultStartMinutesForDrag(bounds)).toBe(9 * 60)
  })

  it('前後站間距小於一步(30 分鐘)時,取中點仍然落在合法範圍內', () => {
    // 09:00 ~ 09:20 之間只有 20 分鐘,中點 09:10 吸附到刻度後會是 09:00
    // (10 分不到半格,四捨五入到 0),且 09:00 本身就是下界,仍在合法
    // 範圍內,不會被 clamp 推到範圍外。
    const bounds: TimeDragBounds = { minMinutes: 9 * 60, maxMinutes: 9 * 60 + 20 }
    const result = defaultStartMinutesForDrag(bounds)
    expect(result).toBeGreaterThanOrEqual(bounds.minMinutes!)
    expect(result).toBeLessThanOrEqual(bounds.maxMinutes!)
  })
})
