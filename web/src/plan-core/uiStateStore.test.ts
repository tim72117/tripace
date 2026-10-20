import { beforeEach, describe, expect, it } from 'vitest'
import { uiStateStore } from './uiStateStore'

// uiStateStore.test.ts — 見 uiStateStore.ts 的完整說明。
//
// 這支 store 是 module 單例,測試之間會互相污染,所以每個案例前先 clear()
// (對齊 attractionPoolStore 的既有測試慣例)。

beforeEach(() => {
  uiStateStore.clear()
})

describe('uiStateStore', () => {
  it('初始狀態是 timeline 畫面、沒有任何選項', () => {
    const s = uiStateStore.get()
    expect(s.screen).toBe('timeline')
    expect(s.options).toEqual([])
    expect(s.selected).toEqual([])
  })

  it('set 記下畫面、標題與選項,並補上 updatedAt', () => {
    uiStateStore.set({
      screen: 'country',
      title: '要去哪個國家?',
      options: [{ id: 'japan', name: '日本' }],
      selected: [],
    })
    const s = uiStateStore.get()
    expect(s.screen).toBe('country')
    expect(s.title).toBe('要去哪個國家?')
    expect(s.options).toEqual([{ id: 'japan', name: '日本' }])
    // updatedAt 是 set 當下補的,不需要呼叫端自己給
    expect(s.updatedAt).not.toBe('')
    expect(Number.isNaN(Date.parse(s.updatedAt))).toBe(false)
  })

  it('set 是整份覆寫,不會殘留上一個畫面的選項', () => {
    uiStateStore.set({
      screen: 'country',
      title: '要去哪個國家?',
      options: [{ id: 'japan', name: '日本' }],
      selected: [],
    })
    uiStateStore.set({ screen: 'transport', options: [{ id: 'car', name: 'car' }], selected: [] })
    const s = uiStateStore.get()
    expect(s.screen).toBe('transport')
    expect(s.options).toEqual([{ id: 'car', name: 'car' }])
    // 上一個畫面的 title 不該留下來——那會讓 LLM 讀到「transport 畫面
    // 標題寫著『要去哪個國家?』」這種不可能的組合
    expect(s.title).toBeUndefined()
  })

  it('setSelected 只改選取狀態,保留 screen/title/options', () => {
    uiStateStore.set({
      screen: 'attractions',
      title: '選擇感興趣的景點',
      options: [{ id: 'p1', name: '赤崁樓' }, { id: 'p2', name: '祀典武廟' }],
      selected: [],
    })
    uiStateStore.setSelected([{ id: 'p1', name: '赤崁樓' }])
    const s = uiStateStore.get()
    expect(s.screen).toBe('attractions')
    expect(s.title).toBe('選擇感興趣的景點')
    expect(s.options).toHaveLength(2)
    expect(s.selected).toEqual([{ id: 'p1', name: '赤崁樓' }])
  })

  it('reset 回到 timeline 並清掉選項與選取', () => {
    uiStateStore.set({
      screen: 'attractions',
      title: '選擇感興趣的景點',
      options: [{ id: 'p1', name: '赤崁樓' }],
      selected: [{ id: 'p1', name: '赤崁樓' }],
    })
    uiStateStore.reset()
    const s = uiStateStore.get()
    expect(s.screen).toBe('timeline')
    expect(s.options).toEqual([])
    expect(s.selected).toEqual([])
    expect(s.title).toBeUndefined()
    // reset 也算一次狀態變動,要有時間戳(LLM 用它判斷讀到的是不是
    // 剛剛那一刻)
    expect(s.updatedAt).not.toBe('')
  })
})
