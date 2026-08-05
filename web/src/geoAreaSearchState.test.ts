import { describe, it, expect } from 'vitest'
import { initialAreaSearchState, reduceAreaSearchState, type AreaSearchState } from './geoAreaSearchState'

// 逐一套用一串事件到初始狀態,回傳每一步驟後的狀態快照——用來斷言整條
// 「動作順序」而非只斷言單一轉換的終點,若中間任何一步驟的中繼狀態不對
// (例如查詢中還沒結束,按鈕卻已經重新出現),測試會在那一步就失敗,而
// 不是只看最終結果掩蓋掉中間順序錯誤。
function run(events: Parameters<typeof reduceAreaSearchState>[1][]): AreaSearchState[] {
  const snapshots: AreaSearchState[] = []
  let state = initialAreaSearchState
  for (const event of events) {
    state = reduceAreaSearchState(state, event)
    snapshots.push(state)
  }
  return snapshots
}

describe('reduceAreaSearchState', () => {
  it('初始狀態:按鈕不顯示、非查詢中', () => {
    expect(initialAreaSearchState).toEqual({ areaDirty: false, searching: false })
  })

  it('掛載後尚未拖曳地圖,map-idle 之前按鈕不該出現(初始狀態即是如此,不需事件驅動)', () => {
    // 沒有任何事件發生時,狀態就是 initialAreaSearchState 本身——這裡
    // 明確斷言一次,對齊 GeoOutlineMap.tsx「掛載時第一次查詢不算使用者
    // 拖曳,不該顯示搜尋按鈕」的預期行為。
    expect(reduceAreaSearchState(initialAreaSearchState, { type: 'query-succeeded' })).toEqual({
      areaDirty: false,
      searching: false,
    })
  })

  it('拖曳地圖(map-idle)後,按鈕出現,且不影響查詢中狀態', () => {
    const [afterIdle] = run([{ type: 'map-idle' }])
    expect(afterIdle).toEqual({ areaDirty: true, searching: false })
  })

  it('完整順序:拖曳 → 按下搜尋 → 查詢成功,按鈕依序「出現→按下當下就收起→查詢完成後仍收著」', () => {
    const [afterIdle, afterPress, afterSuccess] = run([
      { type: 'map-idle' },
      { type: 'search-pressed' },
      { type: 'query-succeeded' },
    ])

    // 步驟 1:拖曳結束,按鈕該出現,查詢還沒開始。
    expect(afterIdle).toEqual({ areaDirty: true, searching: false })
    // 步驟 2:按下的當下,按鈕立刻收起(不等查詢完成才消失),同時進入查詢中。
    expect(afterPress).toEqual({ areaDirty: false, searching: true })
    // 步驟 3:查詢成功,查詢中結束,按鈕維持收起(已經是最新範圍的資料)。
    expect(afterSuccess).toEqual({ areaDirty: false, searching: false })
  })

  it('完整順序:拖曳 → 按下搜尋 → 查詢失敗,查詢中結束但按鈕重新出現以便重試', () => {
    const [afterIdle, afterPress, afterFailure] = run([
      { type: 'map-idle' },
      { type: 'search-pressed' },
      { type: 'query-failed' },
    ])

    expect(afterIdle).toEqual({ areaDirty: true, searching: false })
    expect(afterPress).toEqual({ areaDirty: false, searching: true })
    // 查詢失敗:searching 結束,但 areaDirty 重新變 true——這是跟成功
    // 路徑唯一的分歧點,必須明確斷言,否則容易誤植成跟成功一樣收著不動,
    // 導致查詢失敗後使用者沒有任何重試入口。
    expect(afterFailure).toEqual({ areaDirty: true, searching: false })
  })

  it('查詢中途又被拖曳(map-idle 與查詢中重疊):不打斷查詢中狀態,查詢結束後仍照結果分支處理', () => {
    const [afterPress, afterIdleDuringSearch, afterSuccess] = run([
      { type: 'search-pressed' },
      { type: 'map-idle' },
      { type: 'query-succeeded' },
    ])

    // 按下當下已在查詢中。
    expect(afterPress).toEqual({ areaDirty: false, searching: true })
    // 查詢跑到一半使用者又拖了一下地圖:searching 不該被打斷或重置,
    // 但 areaDirty 這時候該記錄「範圍又變了」。
    expect(afterIdleDuringSearch).toEqual({ areaDirty: true, searching: true })
    // 查詢完成(針對按下當下那次範圍的查詢結果送達):即使中途又被拖曳,
    // query-succeeded 仍無條件把 areaDirty 收回 false——這是目前 reducer
    // 的既有語意(見 reduceAreaSearchState 的說明:不因為又被拖曳了就
        // 取消或提前結束查詢中狀態),此處明確斷言避免之後改動時被誤判為
    // bug 而悄悄改掉語意。
    expect(afterSuccess).toEqual({ areaDirty: false, searching: false })
  })

  it('連續多次拖曳(尚未按下搜尋):按鈕維持顯示,不會因為重複觸發而消失', () => {
    const snapshots = run([{ type: 'map-idle' }, { type: 'map-idle' }, { type: 'map-idle' }])
    snapshots.forEach((s) => expect(s).toEqual({ areaDirty: true, searching: false }))
  })

  it('按下搜尋後查詢完成前,重複按下不會產生非預期狀態(searching 已是 true,再次觸發維持不變)', () => {
    const [, afterSecondPress] = run([{ type: 'search-pressed' }, { type: 'search-pressed' }])
    expect(afterSecondPress).toEqual({ areaDirty: false, searching: true })
  })
})
