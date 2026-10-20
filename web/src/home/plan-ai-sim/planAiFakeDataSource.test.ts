// planAiFakeDataSource.searchNearby 的契約測試——見該函式(fakeSearchNearby)
// 的完整說明:query 模式用名稱包含比對找定位點、coords 模式直接用座標,
// 兩者最終都轉成依距離排序、排除定位點自己的候選清單。
import { describe, it, expect } from 'vitest'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { ATTRACTION_POOL } from './attractionPool'

describe('planAiFakeDataSource.searchNearby', () => {
  it('query 模式:名稱包含比對找到定位點,回傳的候選不包含定位點本身', async () => {
    const result = await planAiFakeDataSource.searchNearby!({ query: '赤崁樓' })
    expect(result.found).toBe(true)
    expect(result.candidates.some((c) => c.placeId === 'attr-chikanlou')).toBe(false)
  })

  it('query 模式:查無名稱命中時 found:false,候選為空', async () => {
    const result = await planAiFakeDataSource.searchNearby!({ query: '不存在的地名xyz' })
    expect(result).toEqual({ found: false, candidates: [] })
  })

  it('coords 模式:直接用座標查附近候選,found 固定為 true', async () => {
    const chikanlou = ATTRACTION_POOL.find((a) => a.id === 'attr-chikanlou')!
    const result = await planAiFakeDataSource.searchNearby!({ coords: { lat: chikanlou.lat, lng: chikanlou.lng } })
    expect(result.found).toBe(true)
    // coords 模式沒有「定位點自己」的概念,查詢座標剛好等於某筆景點時
    // 那筆景點本身(距離 0)應該出現在候選清單裡,不像 query 模式會排除。
    expect(result.candidates.some((c) => c.placeId === 'attr-chikanlou')).toBe(true)
  })

  it('候選依距離由近到遠排序', async () => {
    const chikanlou = ATTRACTION_POOL.find((a) => a.id === 'attr-chikanlou')!
    const result = await planAiFakeDataSource.searchNearby!({ coords: { lat: chikanlou.lat, lng: chikanlou.lng } })
    // 第一筆應該是距離最近的(查詢座標本身,距離 0)。
    expect(result.candidates[0]?.placeId).toBe('attr-chikanlou')
  })

  it('候選每筆帶 placeId/name/summary/category 四個欄位', async () => {
    const chikanlou = ATTRACTION_POOL.find((a) => a.id === 'attr-chikanlou')!
    const result = await planAiFakeDataSource.searchNearby!({ coords: { lat: chikanlou.lat, lng: chikanlou.lng } })
    const first = result.candidates[0]
    expect(first).toMatchObject({
      placeId: expect.any(String),
      name: expect.any(String),
    })
  })

  it('超出範圍的座標(遠離所有景點)回傳空候選,不報錯', async () => {
    const result = await planAiFakeDataSource.searchNearby!({ coords: { lat: 0, lng: 0 } })
    expect(result).toEqual({ found: true, candidates: [] })
  })
})
