import { describe, it, expect } from 'vitest'
import { SAMPLE_ITINERARIES } from './registry'
import { allNodesOf, dayCountOf, toPlanTimeline } from './catalog'

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
        expect(allNodesOf(itinerary).length).toBeGreaterThan(0)
      })

      it('每一天都有穩定的 id(不重複),每個節點都有唯一的 id 與 type', () => {
        const dayIds = itinerary.timeline.days.map((d) => d.id)
        expect(new Set(dayIds).size, '天的 id 重複').toBe(dayIds.length)
        const nodeIds = allNodesOf(itinerary).map((n) => n.id)
        expect(nodeIds.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(nodeIds).size, '節點 id 重複').toBe(nodeIds.length)
        for (const n of allNodesOf(itinerary)) expect(n.type, `${n.id} 缺 type`).toBe('stop')
      })

      it('節點裡沒有 day 欄位(天由所在的 PlanDay 決定),也不直接存照片網址(照片經 placeId 由資料存取層查),也沒有內嵌子景點 children(改存 attractions/places 的 id)', () => {
        for (const n of allNodesOf(itinerary)) {
          expect(n, `${n.name} 不該有 day`).not.toHaveProperty('day')
          expect(n, `${n.name} 不該直接存 googlePhotoUrls`).not.toHaveProperty('googlePhotoUrls')
          expect(n, `${n.name} 不該有內嵌的 children`).not.toHaveProperty('children')
        }
      })

      it('至少一天,每一個站都有 time、kind、duration(時間軸卡片固定顯示「停留時間 · 類型」)', () => {
        expect(dayCountOf(itinerary)).toBeGreaterThanOrEqual(1)
        for (const s of allNodesOf(itinerary)) {
          expect(s.time ?? '', `${s.name} 缺 time`).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
          expect((s.kind ?? '').trim(), `${s.name} 缺 kind`).not.toBe('')
          expect((s.duration ?? '').trim(), `${s.name} 缺 duration`).not.toBe('')
        }
      })

      it('同一天內時間由早到晚遞增', () => {
        for (const day of itinerary.timeline.days) {
          const times = day.nodes.map((n) => n.time ?? '')
          expect(times, `${day.id} 時間倒退`).toEqual([...times].sort())
        }
      })

      it('住宿獨立存放:節點不可再有 checkOutDay 或 kind 為「住宿」的 stop', () => {
        for (const n of allNodesOf(itinerary)) {
          expect((n as { checkOutDay?: unknown }).checkOutDay, `${n.name} 不可再帶 checkOutDay`).toBeUndefined()
          expect(n.kind, `${n.name} 住宿要寫在 timeline.lodgings`).not.toBe('住宿')
        }
      })

      it('旅館:id 唯一、dayIds 非空且都存在於 days、不重複', () => {
        const dayIds = new Set(itinerary.timeline.days.map((d) => d.id))
        const seen = new Set<string>()
        for (const l of itinerary.timeline.lodgings ?? []) {
          expect(seen.has(l.id), `旅館 id 重複:${l.id}`).toBe(false)
          seen.add(l.id)
          expect(l.dayIds.length, `${l.name ?? l.id} 的 dayIds 為空`).toBeGreaterThan(0)
          expect(new Set(l.dayIds).size, `${l.name ?? l.id} 的 dayIds 重複`).toBe(l.dayIds.length)
          for (const id of l.dayIds) expect(dayIds.has(id), `${l.name ?? l.id} 的天 ${id} 不存在`).toBe(true)
          expect(l.placeId || l.name, `${l.id} 至少要有 placeId 或 name`).toBeTruthy()
        }
      })

      it('lat/lng 要嘛兩個都有、要嘛都沒有', () => {
        for (const s of allNodesOf(itinerary)) expect(s.lat == null, `${s.name}`).toBe(s.lng == null)
      })

      it('載入補值後的時間軸天數與資料一致', () => {
        expect(toPlanTimeline(itinerary).timeline.days).toHaveLength(dayCountOf(itinerary))
      })
    })
  }
})
