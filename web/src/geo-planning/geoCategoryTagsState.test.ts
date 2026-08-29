import { describe, it, expect } from 'vitest'
import { initialCategoryTagsState, reduceCategoryTagsState, type CategoryTagsState } from './geoCategoryTagsState'

function run(events: Parameters<typeof reduceCategoryTagsState>[1][]): CategoryTagsState[] {
  const snapshots: CategoryTagsState[] = []
  let state = initialCategoryTagsState
  for (const event of events) {
    state = reduceCategoryTagsState(state, event)
    snapshots.push(state)
  }
  return snapshots
}

describe('reduceCategoryTagsState', () => {
  it('初始狀態:標籤列顯示(未隱藏)', () => {
    expect(initialCategoryTagsState).toEqual({ hidden: false })
  })

  it('search-started:立刻隱藏標籤列——不等結果回來', () => {
    const [afterStart] = run([{ type: 'search-started' }])
    expect(afterStart).toEqual({ hidden: true })
  })

  it('查詢結果回來且非空:維持隱藏(避免疊在清單/候選籃內容上方)', () => {
    const [, afterArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', hasResults: true },
    ])
    expect(afterArrived).toEqual({ hidden: true })
  })

  it('查詢結果回來但是空的:重新顯示標籤列,讓使用者能立刻換一顆標籤再查', () => {
    const [, afterArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', hasResults: false },
    ])
    expect(afterArrived).toEqual({ hidden: false })
  })

  it('使用者關閉清單/候選籃結果:重新顯示標籤列', () => {
    const [, , afterClosed] = run([
      { type: 'search-started' },
      { type: 'results-arrived', hasResults: true },
      { type: 'user-closed' },
    ])
    expect(afterClosed).toEqual({ hidden: false })
  })

  it('連續兩次 search-started(例如連續點兩個不同類別標籤)不會產生非預期狀態', () => {
    const [, afterSecondStart] = run([
      { type: 'search-started' },
      { type: 'search-started' },
    ])
    expect(afterSecondStart).toEqual({ hidden: true })
  })
})
