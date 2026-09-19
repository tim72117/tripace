import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useInfoCardStack, useInfoCardStackSync } from './useInfoCardStack'

// useInfoCardStack.test.ts——驗證 exclusive/stacked 這兩種卡片登記模式
// 的核心行為(見該檔案開頭完整說明):exclusive 出現時清空所有既有卡片
// (不分對方 mode),stacked 純附加、不影響任何既有卡片,但自己仍會被
// 之後出現的 exclusive 卡片一併清空。
describe('useInfoCardStack', () => {
  it('stacked 卡片附加進佇列,不清空已存在的卡片', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('poi', 1, 'stacked'))
    expect(result.current.entries.map((e) => e.id)).toEqual(['theme', 'poi'])
    expect(result.current.isPresent('theme')).toBe(true)
    expect(result.current.isPresent('poi')).toBe(true)
  })

  it('exclusive 卡片出現時,清空佇列裡所有其他卡片(含 stacked)', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.push('searchResults', 0, 'exclusive'))
    expect(result.current.entries.map((e) => e.id)).toEqual(['searchResults'])
    expect(result.current.isPresent('theme')).toBe(false)
    expect(result.current.isPresent('poi')).toBe(false)
  })

  it('exclusive 卡片出現時清空另一個 exclusive 卡片(互斥,不是只清 stacked)', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('searchResults', 0, 'exclusive'))
    expect(result.current.entries.map((e) => e.id)).toEqual(['searchResults'])
  })

  it('同一個 id 重複 push 會替換(依最新 mode/order),不會疊加成兩筆', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.push('poi', 1, 'stacked'))
    expect(result.current.entries).toHaveLength(1)
  })

  it('remove 只移除指定 id,不影響其他卡片', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.remove('poi'))
    expect(result.current.entries.map((e) => e.id)).toEqual(['theme'])
    expect(result.current.isPresent('theme')).toBe(true)
  })

  it('clear 清空整個佇列', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.clear())
    expect(result.current.entries).toEqual([])
  })

  it('entries 依 order 由小到大排序,不論 push 的先後順序', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.push('theme', 0, 'exclusive'))
    // theme 是 exclusive,push 時會清空佇列——這裡驗證清空後只剩自己,
    // 順序自然成立;改用兩個 stacked 卡片驗證排序本身。
    act(() => result.current.clear())
    act(() => result.current.push('poi', 1, 'stacked'))
    act(() => result.current.push('other', 0, 'stacked'))
    expect(result.current.entries.map((e) => e.id)).toEqual(['other', 'poi'])
  })

  it('presentOrders 反映目前佇列裡的順位集合,供 stackedInfoCardRightPx 使用', () => {
    const { result } = renderHook(() => useInfoCardStack())
    act(() => result.current.push('theme', 0, 'exclusive'))
    act(() => result.current.push('poi', 1, 'stacked'))
    expect(result.current.presentOrders).toEqual(new Set([0, 1]))
  })
})

// useInfoCardStackSync——驗證這個接線 hook 的行為:present 為 true 時
// 登記進 stack(exclusive 卡片並觸發 onExclusivePresent),present 變回
// false 時從 stack 移除;onExclusivePresent 只在「從不存在到存在」這個
// 上升緣觸發一次,不會因為其他重渲染而重複呼叫。這對應
// DesktopLayout.tsx 用這個 hook 把 geoHotelSidebarVisible 接到
// geo.clearSelection() 的實際用法——搜尋結果一出現時只該關閉一次主題卡,
// 不該每次重渲染都呼叫。
describe('useInfoCardStackSync', () => {
  function setup() {
    return renderHook(
      ({ present }: { present: boolean }) => {
        const stack = useInfoCardStack()
        useInfoCardStackSync(stack, 'searchResults', 0, 'exclusive', present, onExclusivePresent)
        return stack
      },
      { initialProps: { present: false } },
    )
  }
  const onExclusivePresent = vi.fn()

  it('present 為 true 時登記進 stack', () => {
    onExclusivePresent.mockClear()
    const { result, rerender } = setup()
    expect(result.current.isPresent('searchResults')).toBe(false)
    rerender({ present: true })
    expect(result.current.isPresent('searchResults')).toBe(true)
  })

  it('present 變回 false 時從 stack 移除', () => {
    onExclusivePresent.mockClear()
    const { result, rerender } = setup()
    rerender({ present: true })
    rerender({ present: false })
    expect(result.current.isPresent('searchResults')).toBe(false)
  })

  it('exclusive 卡片 present 變 true 時觸發 onExclusivePresent 一次', () => {
    onExclusivePresent.mockClear()
    const { rerender } = setup()
    rerender({ present: true })
    expect(onExclusivePresent).toHaveBeenCalledTimes(1)
  })

  it('present 持續為 true(其他原因重渲染)不會重複觸發 onExclusivePresent', () => {
    onExclusivePresent.mockClear()
    const { rerender } = setup()
    rerender({ present: true })
    rerender({ present: true })
    rerender({ present: true })
    expect(onExclusivePresent).toHaveBeenCalledTimes(1)
  })

  it('present 從 true 變 false 再變 true——onExclusivePresent 在每次新的上升緣各觸發一次', () => {
    onExclusivePresent.mockClear()
    const { rerender } = setup()
    rerender({ present: true })
    rerender({ present: false })
    rerender({ present: true })
    expect(onExclusivePresent).toHaveBeenCalledTimes(2)
  })

  it('stacked 卡片沒有帶 onExclusivePresent 時,present 變 true 不會出錯', () => {
    const { result, rerender } = renderHook(
      ({ present }: { present: boolean }) => {
        const stack = useInfoCardStack()
        useInfoCardStackSync(stack, 'nearbyPlace', 1, 'stacked', present)
        return stack
      },
      { initialProps: { present: false } },
    )
    expect(() => rerender({ present: true })).not.toThrow()
    expect(result.current.isPresent('nearbyPlace')).toBe(true)
  })
})

// 雙向互斥組合場景——對應 DesktopLayout.tsx 實際用法:searchResults 與
// attraction 都是 exclusive,各自帶 onExclusivePresent 反向清空對方的
// 實際 state(geo.clearSelection()/geo.setGeocodeCandidates([]))。這裡
// 直接驗證「先出現哪一個」都不影響互斥結果——先前的 bug 是只做了
// 「searchResults 出現時清空 attraction」單一方向,若使用者先看到搜尋
// 結果、後點開主題點,反方向完全沒有觸發清空,兩者會並存而非互斥。
describe('useInfoCardStackSync 雙向互斥組合', () => {
  function setupBothExclusive(onA: () => void, onB: () => void) {
    return renderHook(
      ({ aPresent, bPresent }: { aPresent: boolean; bPresent: boolean }) => {
        const stack = useInfoCardStack()
        useInfoCardStackSync(stack, 'a', 0, 'exclusive', aPresent, onA)
        useInfoCardStackSync(stack, 'b', 0, 'exclusive', bPresent, onB)
        return stack
      },
      { initialProps: { aPresent: false, bPresent: false } },
    )
  }

  it('a 先出現、b 後出現時,b 的 onExclusivePresent 觸發(清空 a 的實際 state)', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const { rerender } = setupBothExclusive(onA, onB)
    rerender({ aPresent: true, bPresent: false })
    onA.mockClear()
    onB.mockClear()
    rerender({ aPresent: true, bPresent: true })
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onA).not.toHaveBeenCalled()
  })

  it('b 先出現、a 後出現時(反過來的順序),a 的 onExclusivePresent 也會觸發——這是先前遺漏的方向', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const { rerender } = setupBothExclusive(onA, onB)
    rerender({ aPresent: false, bPresent: true })
    onA.mockClear()
    onB.mockClear()
    rerender({ aPresent: true, bPresent: true })
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })

  it('登記簿本身在 b 出現時清空 a 的登記(不論呼叫端有沒有接住 onExclusivePresent)', () => {
    const { result, rerender } = setupBothExclusive(vi.fn(), vi.fn())
    rerender({ aPresent: true, bPresent: false })
    expect(result.current.isPresent('a')).toBe(true)
    rerender({ aPresent: true, bPresent: true })
    expect(result.current.isPresent('a')).toBe(false)
    expect(result.current.isPresent('b')).toBe(true)
  })
})
