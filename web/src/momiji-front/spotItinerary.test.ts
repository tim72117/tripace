import { describe, expect, it } from 'vitest'
import { stopCountOf } from '../itineraries/catalog'
import { MOMIJI_SPOTS } from './momijiSpots'
import { itineraryPath, loadSpotItinerary } from './spotItinerary'

describe('景點對應的精選行程', () => {
  it('定山溪接上 jozankei-1day,載得到、有標題與站點', async () => {
    const spot = MOMIJI_SPOTS.find((s) => s.id === 'jozankei')
    expect(spot?.itineraryId).toBe('jozankei-1day')
    const it = await loadSpotItinerary('jozankei-1day')
    expect(it?.id).toBe('jozankei-1day')
    expect(it?.title).toContain('定山溪')
    expect(it && stopCountOf(it)).toBeGreaterThan(0)
  })
  it('資料完整性:每個有 itineraryId 的景點都真的載得到行程', async () => {
    for (const s of MOMIJI_SPOTS.filter((x) => x.itineraryId)) {
      expect(await loadSpotItinerary(s.itineraryId!), s.name).not.toBeNull()
    }
  })
  it('不存在的行程 id 回 null,不丟錯', async () => {
    expect(await loadSpotItinerary('no-such-itinerary')).toBeNull()
  })
  it('連結指向精選行程頁', () => {
    expect(itineraryPath('jozankei-1day')).toBe('/itineraries/jozankei-1day')
  })
})
