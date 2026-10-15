import { describe, it, expect } from 'vitest'
import { DESTINATION_REGIONS, DESTINATION_DIRECTIONS, buildDestinationPrompt } from './destinationPromptData'

describe('DESTINATION_REGIONS', () => {
  it('介於 3~5 筆之間(使用者明確要求不要過度擴充大地區選項)', () => {
    expect(DESTINATION_REGIONS.length).toBeGreaterThanOrEqual(3)
    expect(DESTINATION_REGIONS.length).toBeLessThanOrEqual(5)
  })

  it('每個地區都有穩定的 id、顯示用的 label,以及至少一個城市', () => {
    for (const region of DESTINATION_REGIONS) {
      expect(region.id.length).toBeGreaterThan(0)
      expect(region.label.length).toBeGreaterThan(0)
      expect(region.cities.length).toBeGreaterThan(0)
    }
  })

  it('id 彼此不重複(React key 與選取狀態比對都依賴這個唯一性)', () => {
    const ids = DESTINATION_REGIONS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('buildDestinationPrompt', () => {
  it('組出「我想去○○玩」這句提示文字', () => {
    expect(buildDestinationPrompt('東京')).toBe('我想去東京玩')
  })

  it('帶方向時把偏好接在句尾', () => {
    const food = DESTINATION_DIRECTIONS.find((d) => d.id === 'food')!
    expect(buildDestinationPrompt('東京', [food])).toBe('我想去東京玩,想多吃在地美食')
  })

  it('複選時依序接上每個方向的偏好句', () => {
    const heritage = DESTINATION_DIRECTIONS.find((d) => d.id === 'heritage')!
    const food = DESTINATION_DIRECTIONS.find((d) => d.id === 'food')!
    expect(buildDestinationPrompt('東京', [heritage, food])).toBe(
      '我想去東京玩,想多看古蹟、歷史建築,想多吃在地美食',
    )
  })

  it('空陣列(「都可以」)或沒帶方向,等同單純句子', () => {
    expect(buildDestinationPrompt('東京', [])).toBe('我想去東京玩')
    expect(buildDestinationPrompt('東京')).toBe('我想去東京玩')
  })
})

describe('DESTINATION_DIRECTIONS', () => {
  it('包含古蹟/美食/展館/戶外活動四個方向,id 不重複', () => {
    const labels = DESTINATION_DIRECTIONS.map((d) => d.label)
    expect(labels).toEqual(['古蹟', '美食', '展館', '戶外活動'])
    const ids = DESTINATION_DIRECTIONS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每個方向都有代表照片', () => {
    for (const d of DESTINATION_DIRECTIONS) {
      expect(d.photo, `${d.label} 缺少代表照片`).toBeTruthy()
    }
  })
})
