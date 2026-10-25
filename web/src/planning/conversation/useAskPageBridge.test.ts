// useAskPageBridge.test.ts — 針對 TripPlanPage.tsx/Content.tsx
// 共用的「顯示詢問頁、等待使用者選完才 resolve」狀態機補測試(見該檔案
// 開頭說明:抽出來之前這段邏輯包在元件內部完全無法單獨測試)。重點是
// 「卡住整個對話/整個展示播放」這類最嚴重症狀的來源:resolve 有沒有
// 正確完成待決的 Promise、ref 有沒有正確清空、連續呼叫兩次時第一個
// Promise 會不會被靜默遺棄。
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAskPageBridge, type AskPageState } from './useAskPageBridge'
import type { AskPageCandidate, AskPageSelection } from './asktools'

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

  // replaceAskPage——「原地換頁、不結束等待」(城市頁按「返回上一層」回到國家頁用):openAskPage 在有 pending 時會忽略新呼叫,
  // 返回若走 openAskPage 會被吞掉、按了沒反應。
  describe('replaceAskPage', () => {
    it('有 pending 時:只換 askPageInput,showAskPage 維持 true,原本的 Promise 仍然 pending、之後由 handleAskPageDone resolve', async () => {
      const { result } = renderHook(() => useAskPageBridge<{ step: string }>({ step: 'init' }))
      let first!: Promise<AskPageSelection[]>
      let settled = false
      act(() => {
        first = result.current.openAskPage({ step: 'city' })
      })
      first.then(() => { settled = true })
      let replaced = false
      act(() => {
        replaced = result.current.replaceAskPage({ step: 'country' })
      })
      expect(replaced).toBe(true)
      expect(result.current.askPageInput).toEqual({ step: 'country' })
      expect(result.current.showAskPage).toBe(true)
      await Promise.resolve()
      expect(settled).toBe(false)
      act(() => {
        result.current.handleAskPageDone([{ placeId: 'jp' }])
      })
      await expect(first).resolves.toEqual([{ placeId: 'jp' }])
    })

    it('沒有 pending 時是 no-op:回傳 false,不打開詢問頁、不改 input(不能憑空開出一個沒人等待的畫面)', () => {
      const { result } = renderHook(() => useAskPageBridge<{ step: string }>({ step: 'init' }))
      let replaced = true
      act(() => {
        replaced = result.current.replaceAskPage({ step: 'country' })
      })
      expect(replaced).toBe(false)
      expect(result.current.showAskPage).toBe(false)
      expect(result.current.askPageInput).toEqual({ step: 'init' })
    })
  })

  // advanceAskPage——「結束這一步、立刻換到下一步」:resolve 目前的等待,同一個 commit 換成下一步並建立新的等待,
  // 中間 showAskPage 不會變回 false(選完城市接著顯示「查詢中」用,不閃回時間軸)。任何時刻最多一個 pending。
  describe('advanceAskPage', () => {
    it('resolve 目前的 Promise、換成新 input、showAskPage 維持 true,並回傳新的 pending Promise', async () => {
      const { result } = renderHook(() => useAskPageBridge<{ step: string }>({ step: 'init' }))
      let first!: Promise<AskPageSelection[]>
      act(() => {
        first = result.current.openAskPage({ step: 'city' })
      })
      let second!: Promise<AskPageSelection[]>
      act(() => {
        second = result.current.advanceAskPage([{ placeId: 'tainan' }], { step: 'loading' })
      })
      await expect(first).resolves.toEqual([{ placeId: 'tainan' }])
      expect(result.current.showAskPage).toBe(true)
      expect(result.current.askPageInput).toEqual({ step: 'loading' })
      let secondSettled = false
      second.then(() => { secondSettled = true })
      await Promise.resolve()
      expect(secondSettled).toBe(false)
      // 新的等待也照常被 openAskPage 的「不搶佔」保護:背景文字不能蓋掉查詢中/候選畫面。
      let intruder!: Promise<AskPageSelection[]>
      act(() => {
        intruder = result.current.openAskPage({ step: 'text' })
      })
      await expect(intruder).resolves.toEqual([])
      expect(result.current.askPageInput).toEqual({ step: 'loading' })
      act(() => {
        result.current.handleAskPageDone([])
      })
      await expect(second).resolves.toEqual([])
      expect(result.current.showAskPage).toBe(false)
    })

    it('沒有 pending 時等同 openAskPage', () => {
      const { result } = renderHook(() => useAskPageBridge<{ step: string }>({ step: 'init' }))
      act(() => {
        void result.current.advanceAskPage([], { step: 'loading' })
      })
      expect(result.current.showAskPage).toBe(true)
      expect(result.current.askPageInput).toEqual({ step: 'loading' })
    })
  })

  // 狀態模型合併(2026-10):showAskPage/askPageInput 由單一個 askPage(closed | open 帶 input)衍生。
  // 快照每一次 render 的 [askPage, showAskPage, askPageInput],證明整段流程沒有任何一次 render 落在中間態
  // (旗標開著但 input 是舊值/旗標關了 input 還在),而且每個轉移恰好產生一次 render、直接到達目標狀態。
  describe('單一狀態模型:不存在中間態', () => {
    type Input = { step: string }
    const DEFAULT: Input = { step: 'init' }

    function renderRecorded() {
      const renders: Array<{ askPage: AskPageState<Input>; show: boolean; input: Input }> = []
      // 每次 render 傳新的預設值字面值:關閉時的 askPageInput 仍要是同一個參照(掛載時那個)。
      const hook = renderHook(() => {
        const bridge = useAskPageBridge<Input>({ ...DEFAULT })
        renders.push({ askPage: bridge.askPage, show: bridge.showAskPage, input: bridge.askPageInput })
        return bridge
      })
      return { ...hook, renders }
    }

    function step(renders: ReturnType<typeof renderRecorded>['renders'], fn: () => void) {
      const before = renders.length
      act(fn)
      return renders.slice(before)
    }

    it('open → replace → advance → done:每個轉移恰好一次 render,且每次 render 的 [show, input] 都對得上 askPage', () => {
      const { result, renders } = renderRecorded()
      const closedInput = renders[0].input

      const afterOpen = step(renders, () => { void result.current.openAskPage({ step: 'city' }) })
      const afterReplace = step(renders, () => { result.current.replaceAskPage({ step: 'country' }) })
      const afterAdvance = step(renders, () => { void result.current.advanceAskPage([{ placeId: 'x' }], { step: 'loading' }) })
      const afterDone = step(renders, () => { result.current.handleAskPageDone([]) })

      expect(afterOpen.map((r) => r.askPage)).toEqual([{ status: 'open', input: { step: 'city' } }])
      expect(afterReplace.map((r) => r.askPage)).toEqual([{ status: 'open', input: { step: 'country' } }])
      expect(afterAdvance.map((r) => r.askPage)).toEqual([{ status: 'open', input: { step: 'loading' } }])
      expect(afterDone.map((r) => r.askPage)).toEqual([{ status: 'closed' }])

      for (const r of renders) {
        if (r.askPage.status === 'open') {
          expect(r.show).toBe(true)
          expect(r.input).toBe(r.askPage.input)
        } else {
          expect(r.show).toBe(false)
          expect(r.input).toBe(closedInput)
        }
      }
      // 關閉後 input 不殘留上一頁的值(舊模型關閉後 askPageInput 仍是 { step: 'loading' })。
      expect(result.current.askPageInput).toEqual(DEFAULT)
      expect(result.current.askPageInput).toBe(closedInput)
    })

    it('被忽略的呼叫(pending 中的 openAskPage、沒有 pending 的 replaceAskPage)不產生任何 render', () => {
      const { result, renders } = renderRecorded()
      expect(step(renders, () => { result.current.replaceAskPage({ step: 'x' }) })).toEqual([])
      step(renders, () => { void result.current.openAskPage({ step: 'city' }) })
      expect(step(renders, () => { void result.current.openAskPage({ step: 'text' }) })).toEqual([])
      expect(result.current.askPageInput).toEqual({ step: 'city' })
    })

    it('pendingId:open/advance 開新的等待會換 id,replace 不換,結束後為 null', () => {
      const { result } = renderRecorded()
      expect(result.current.pendingId()).toBeNull()
      act(() => { void result.current.openAskPage({ step: 'city' }) })
      const first = result.current.pendingId()
      expect(first).not.toBeNull()
      act(() => { result.current.replaceAskPage({ step: 'country' }) })
      expect(result.current.pendingId()).toBe(first)
      act(() => { void result.current.advanceAskPage([], { step: 'loading' }) })
      const second = result.current.pendingId()
      expect(second).not.toBeNull()
      expect(second).not.toBe(first)
      act(() => { result.current.handleAskPageDone([]) })
      expect(result.current.pendingId()).toBeNull()
    })

    it('型別上不可能表達中間態(tsc 驗證)', () => {
      // @ts-expect-error closed 不帶 input
      const closedWithInput: AskPageState<Input> = { status: 'closed', input: { step: 'stale' } }
      // @ts-expect-error open 一定要有 input
      const openWithoutInput: AskPageState<Input> = { status: 'open' }
      expect([closedWithInput, openWithoutInput]).toHaveLength(2)
    })
  })
})
