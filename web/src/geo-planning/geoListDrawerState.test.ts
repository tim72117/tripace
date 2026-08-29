import { describe, it, expect } from 'vitest'
import { initialListDrawerState, reduceListDrawerState, type ListDrawerState } from './geoListDrawerState'

// 逐一套用一串事件到初始狀態,回傳每一步驟後的狀態快照——理由同
// geoAreaSearchState.test.ts 的同名 helper:斷言整條動作順序,不只斷言
// 最終結果,中間任何一步錯了測試會在那一步就失敗。
function run(events: Parameters<typeof reduceListDrawerState>[1][]): ListDrawerState[] {
  const snapshots: ListDrawerState[] = []
  let state = initialListDrawerState
  for (const event of events) {
    state = reduceListDrawerState(state, event)
    snapshots.push(state)
  }
  return snapshots
}

describe('reduceListDrawerState', () => {
  it('初始狀態:清單關閉、非載入中', () => {
    expect(initialListDrawerState).toEqual({ open: false, loading: false })
  })

  it('掛載後尚未有任何查詢動作,清單不該打開(初始狀態即是如此,不需事件驅動)——對應「剛進入規劃地圖畫面不該自動打開清單」的既有 bug 修復', () => {
    // 沒有任何事件發生時,狀態就是 initialListDrawerState 本身。這個
    // reducer 本身天生就無法在「沒有 dispatch 任何事件」的情況下打開
    // 清單——這正是收斂成 reducer 之後,「元件掛載時被意外觸發」這類
    // bug 不可能再發生的原因:呼叫端必須明確 dispatch 一個事件才會有
    // 任何狀態轉換,不像先前掛在 useEffect 依賴陣列上時,掛載當下的
    // 那一次執行也會被視為一次「變化」。
    expect(initialListDrawerState).toEqual({ open: false, loading: false })
  })

  it('search-started:立刻打開清單、進入載入中', () => {
    const [afterStart] = run([{ type: 'search-started' }])
    expect(afterStart).toEqual({ open: true, loading: true })
  })

  it('完整順序(城市搜尋框/類別標籤/搜尋這個區域三個入口共用的語意):查詢開始 → 結果回來,清單依序「打開且載入中→維持打開、結束載入中」', () => {
    const [afterStart, afterArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 2 },
    ])

    // 步驟 1:查詢開始的當下,清單立刻打開、顯示載入中——不等結果回來
    // 才讓使用者知道「有東西在發生」,這是使用者明確要求的行為。
    expect(afterStart).toEqual({ open: true, loading: true })
    // 步驟 2:結果回來(不論筆數),載入中結束,清單維持開啟。
    expect(afterArrived).toEqual({ open: true, loading: false })
  })

  it('使用者手動關閉:清單關閉、載入中狀態一併清空', () => {
    const [, afterClosed] = run([
      { type: 'search-started' },
      { type: 'user-closed' },
    ])
    expect(afterClosed).toEqual({ open: false, loading: false })
  })

  it('查詢結果回來後,使用者才手動關閉——關閉後不殘留任何載入中視覺', () => {
    const [, , afterClosed] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 2 },
      { type: 'user-closed' },
    ])
    expect(afterClosed).toEqual({ open: false, loading: false })
  })

  it('關閉清單後,若有一個延遲中的查詢結果之後才回來(results-arrived 晚到)——清單會被重新打開,這是這個 reducer 目前的既有語意,不是缺陷:results-arrived 代表「真的查到結果了」,理應讓使用者看到,不會因為使用者先前關過一次舊的清單就悄悄吞掉新結果', () => {
    const [, afterClosed, afterLateArrival] = run([
      { type: 'search-started' },
      { type: 'user-closed' },
      { type: 'results-arrived', resultCount: 2 },
    ])
    expect(afterClosed).toEqual({ open: false, loading: false })
    expect(afterLateArrival).toEqual({ open: true, loading: false })
  })

  it('三個查詢入口共用同一組事件,不分觸發來源——連續兩次 search-started(例如使用者連續點兩個不同類別標籤)不會產生非預期狀態', () => {
    const [, afterSecondStart] = run([
      { type: 'search-started' },
      { type: 'search-started' },
    ])
    expect(afterSecondStart).toEqual({ open: true, loading: true })
  })

  it('查詢中途使用者又觸發一次新查詢(例如切換類別標籤)——維持打開、重新進入載入中,不受前一次查詢是否已經有結果影響', () => {
    const [, afterArrived, afterRestart] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 2 },
      { type: 'search-started' },
    ])
    expect(afterArrived).toEqual({ open: true, loading: false })
    expect(afterRestart).toEqual({ open: true, loading: true })
  })

  it('resultCount === 1(唯一解):清單不打開——使用者明確要求,唯一解已經由 GeoOutlinePanel.tsx 自動打開資訊卡,不需要清單這層', () => {
    const [, afterArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 1 },
    ])
    expect(afterArrived).toEqual({ open: false, loading: false })
  })

  it('resultCount === 0(查無結果):清單仍要打開,讓使用者看到空狀態文案——只有唯一解(=1)才不開,不是「筆數不足」的泛化規則', () => {
    const [, afterArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 0 },
    ])
    expect(afterArrived).toEqual({ open: true, loading: false })
  })

  it('先前已因唯一解而不開清單,之後使用者又觸發一次查到多筆的新查詢——清單正常打開,不受上一次唯一解狀態影響', () => {
    const [, afterFirstArrived, , afterSecondArrived] = run([
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 1 },
      { type: 'search-started' },
      { type: 'results-arrived', resultCount: 3 },
    ])
    expect(afterFirstArrived).toEqual({ open: false, loading: false })
    expect(afterSecondArrived).toEqual({ open: true, loading: false })
  })
})
