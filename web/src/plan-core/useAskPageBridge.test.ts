// useAskPageBridge.test.ts — 針對 TripPlanPage.tsx/Content.tsx
// 共用的「顯示詢問頁、等待使用者選完才 resolve」狀態機補測試(見該檔案
// 開頭說明:抽出來之前這段邏輯包在元件內部完全無法單獨測試)。重點是
// 「卡住整個對話/整個展示播放」這類最嚴重症狀的來源:resolve 有沒有
// 正確完成待決的 Promise、ref 有沒有正確清空、連續呼叫兩次時第一個
// Promise 會不會被靜默遺棄。
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAskPageBridge } from './useAskPageBridge'
import type { AskPageCandidate, AskPageSelection } from './askPageTools'

describe('useAskPageBridge', () => {
  it('初始狀態:showAskPage 為 false,askPageInput 等於傳入的預設值', () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    expect(result.current.showAskPage).toBe(false)
    expect(result.current.askPageInput).toEqual({ candidates: [] })
  })

  it('openAskPage(input) 後:showAskPage 變 true,askPageInput 更新成傳入的值', () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    act(() => {
      result.current.openAskPage({ candidates: [{ placeId: 'p1' }] })
    })
    expect(result.current.showAskPage).toBe(true)
    expect(result.current.askPageInput).toEqual({ candidates: [{ placeId: 'p1' }] })
  })

  it('openAskPage 回傳的 Promise 在 handleAskPageDone 呼叫前保持 pending', async () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    let resolved = false
    let promise!: Promise<AskPageSelection[]>
    act(() => {
      promise = result.current.openAskPage({ candidates: [] })
    })
    promise.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
  })

  it('handleAskPageDone(selected) 後:openAskPage 的 Promise 用相同的 selected resolve,showAskPage 變回 false', async () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    let promise!: Promise<AskPageSelection[]>
    act(() => {
      promise = result.current.openAskPage({ candidates: [{ placeId: 'p1' }] })
    })
    const selection: AskPageSelection[] = [{ placeId: 'p1', attractionId: 'attr-1' }]
    act(() => {
      result.current.handleAskPageDone(selection)
    })
    await expect(promise).resolves.toEqual(selection)
    expect(result.current.showAskPage).toBe(false)
  })

  it('使用者按「不用了」(handleAskPageDone 傳空陣列)時,Promise 以空陣列 resolve,不是 reject', async () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    let promise!: Promise<AskPageSelection[]>
    act(() => {
      promise = result.current.openAskPage({ candidates: [{ placeId: 'p1' }] })
    })
    act(() => {
      result.current.handleAskPageDone([])
    })
    await expect(promise).resolves.toEqual([])
  })

  it('没有 pending 的 openAskPage 時呼叫 handleAskPageDone,不丟錯,showAskPage 仍變 false', () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    expect(() => {
      act(() => {
        result.current.handleAskPageDone([{ placeId: 'p1' }])
      })
    }).not.toThrow()
    expect(result.current.showAskPage).toBe(false)
  })

  // 2026-10 訂正(見該檔案開頭「2026-10 訂正」的完整說明):原本這裡
  // 測的是「第二次呼叫覆蓋第一次」的舊行為——實機測試發現這個假設不
  // 成立(TripPlanPage.tsx 的 onAssistantMessage 會在候選卡片詢問頁
  // 還 pending 時,不 await 地呼叫 openAskPage({ text }),導致候選
  // 卡片被文字氣泡覆蓋、原本的 open_ask_page 工具呼叫永遠卡死)。改成
  // 測新行為:第二次呼叫被忽略,不搶佔第一次仍在等待使用者操作的呼叫。
  it('已有 pending 的 openAskPage 時,第二次呼叫不搶佔:askPageInput/showAskPage 維持第一次的值,第二次的 Promise 立即以空陣列 resolve,第一次仍然 pending', async () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    let firstResolved = false
    let firstPromise!: Promise<AskPageSelection[]>
    let secondPromise!: Promise<AskPageSelection[]>
    act(() => {
      firstPromise = result.current.openAskPage({ candidates: [{ placeId: 'first' }] })
    })
    firstPromise.then(() => { firstResolved = true })

    act(() => {
      secondPromise = result.current.openAskPage({ candidates: [{ placeId: 'second' }] })
    })

    // 第二次呼叫立即以空陣列 resolve,不等待使用者操作。
    await expect(secondPromise).resolves.toEqual([])
    // 畫面仍然顯示第一次呼叫的輸入,沒有被第二次呼叫覆蓋。
    expect(result.current.askPageInput).toEqual({ candidates: [{ placeId: 'first' }] })
    expect(result.current.showAskPage).toBe(true)
    expect(firstResolved).toBe(false)

    // 之後使用者完成操作,resolve 的是第一次呼叫的 Promise。
    const selection: AskPageSelection[] = [{ placeId: 'first' }]
    act(() => {
      result.current.handleAskPageDone(selection)
    })
    await expect(firstPromise).resolves.toEqual(selection)
  })

  it('resolve 用完立刻清空 ref:handleAskPageDone 連續呼叫兩次,第二次不會重複 resolve 已完成的 Promise(呼叫本身不丟錯)', async () => {
    const { result } = renderHook(() => useAskPageBridge<{ candidates: AskPageCandidate[] }>({ candidates: [] }))
    let promise!: Promise<AskPageSelection[]>
    act(() => {
      promise = result.current.openAskPage({ candidates: [{ placeId: 'p1' }] })
    })
    act(() => {
      result.current.handleAskPageDone([{ placeId: 'p1' }])
    })
    expect(() => {
      act(() => {
        result.current.handleAskPageDone([{ placeId: 'should-not-affect-anything' }])
      })
    }).not.toThrow()
    await expect(promise).resolves.toEqual([{ placeId: 'p1' }])
  })
})
