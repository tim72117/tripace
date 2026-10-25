import { describe, it, expect } from 'vitest'
import { askDirectionBetween, askLayerOf } from './askTransition'

describe('askLayerOf', () => {
  it('國家 0、城市 1、景點(candidates 與 explore)2', () => {
    expect(askLayerOf({ country: { countryIds: undefined } } as never)).toBe(0)
    expect(askLayerOf({ city: { countryId: 'tw' } } as never)).toBe(1)
    expect(askLayerOf({ candidates: [] })).toBe(2)
    expect(askLayerOf({ explore: {} } as never)).toBe(2)
  })
  it('交通方式與純文字不在層級內', () => {
    expect(askLayerOf({ transport: ['walk'] } as never)).toBeUndefined()
    expect(askLayerOf({ text: 'hi' })).toBeUndefined()
  })
})

describe('askDirectionBetween', () => {
  it('層級變大是前進,變小是返回', () => {
    expect(askDirectionBetween(0, 1)).toBe('forward')
    expect(askDirectionBetween(1, 2)).toBe('forward')
    expect(askDirectionBetween(1, 0)).toBe('back')
    expect(askDirectionBetween(2, 1)).toBe('back')
  })
  it('跳層也依大小判斷', () => {
    expect(askDirectionBetween(0, 2)).toBe('forward')
    expect(askDirectionBetween(2, 0)).toBe('back')
  })
  it('層級沒變、或有一邊不在層級內,不做方向動畫', () => {
    expect(askDirectionBetween(1, 1)).toBe('none')
    expect(askDirectionBetween(undefined, 1)).toBe('none')
    expect(askDirectionBetween(1, undefined)).toBe('none')
    expect(askDirectionBetween(undefined, undefined)).toBe('none')
  })
})
