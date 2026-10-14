import { describe, it, expect } from 'vitest'
import { SAMPLE_ITINERARIES } from './registry'
import { toPlanTimeline } from './catalog'

// 對「所有已登錄的範例行程」的資料驗證。範例行程會持續增加(每份一個檔案),
// 這支測試就是守門員:新加的檔案只要格式不對,在這裡就失敗,不會等到畫面壞掉。
describe('已登錄的範例行程資料', () => {
  it('至少有一份(registry 有收到 example/*.ts)', () => {
    expect(SAMPLE_ITINERARIES.length).toBeGreaterThan(0)
  })

  it('id 不重複,且是網址安全的小寫英數與連字號', () => {
    const ids = SAMPLE_ITINERARIES.map((it) => it.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, `id "${id}" 格式`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('已依上架日期由新到舊排好', () => {
    const dates = SAMPLE_ITINERARIES.map((it) => it.addedAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  for (const itinerary of SAMPLE_ITINERARIES) {
    describe(itinerary.id, () => {
      it('必填欄位齊全、上架日期格式為 YYYY-MM-DD', () => {
        expect(itinerary.title.trim()).not.toBe('')
        expect(itinerary.region.trim()).not.toBe('')
        expect(itinerary.summary.trim()).not.toBe('')
        expect(itinerary.categories.length).toBeGreaterThan(0)
        expect(itinerary.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(itinerary.stops.length).toBeGreaterThan(0)
      })

      it('每一站的 day 在 1..days 之間,days 不小於實際最大的 day', () => {
        expect(Number.isInteger(itinerary.days) && itinerary.days >= 1).toBe(true)
        for (const s of itinerary.stops) {
          const day = s.day ?? 1
          expect(Number.isInteger(day) && day >= 1 && day <= itinerary.days, `${s.name} 的 day=${day}`).toBe(true)
        }
      })

      it('每一站都有 kind 與 duration(時間軸卡片固定顯示「停留時間 · 類型」)', () => {
        for (const s of itinerary.stops) {
          expect(s.kind.trim(), `${s.name} 缺 kind`).not.toBe('')
          expect(s.duration.trim(), `${s.name} 缺 duration`).not.toBe('')
        }
      })

      it('lat/lng 要嘛兩個都有、要嘛都沒有', () => {
        for (const s of itinerary.stops) expect(s.lat == null, `${s.name}`).toBe(s.lng == null)
      })

      it('能完整轉成時間軸(沒有任何站因為時間格式/順序被略過)', () => {
        const { skipped } = toPlanTimeline(itinerary)
        expect(skipped).toEqual([])
      })
    })
  }
})
