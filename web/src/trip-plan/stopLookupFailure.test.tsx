import { describe, it, expect, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createEmptyTimeline, insertAfter, stopLookupFailed, updateNode, type PlanTimeline } from '../plan-core/planTimeline'
import { saveTimeline, loadTimelineWithRev, clearTimeline } from '../plan-core/planTimelineStorage'

// stopLookupFailure.test.tsx — 地點資料查詢失敗的完整機制回歸測試。
//
// 2026-10 新增(使用者明確要求「不要有任何失敗前會有的暫時性狀態跟文字,
// 失敗就標記該階段為錯誤,介面上做可以重試,重整後要進行重試」,並明確
// 要求「這個機制要用測試案例模擬一次」)。
//
// 這個機制有四段,四段都在這裡模擬:
//   1. 查詢失敗 → 節點標記 failed、不留下佔位文字
//   2. 介面顯示錯誤狀態與重試按鈕(不是停在「查詢中…」)
//   3. 按重試 → 走同一條查詢路徑,成功後清掉 failed
//   4. failed 會被持久化,重整(重新掛載)後自動重試
//
// 這個機制存在的理由是一個實際的缺口:add_attraction 插入節點時只有
// placeId,沒有名稱——name 先填寫死的佔位字串「查詢中…」(見
// attractionTools.ts 該處的說明)。那個佔位值的前提是「查詢一定會完成並
// 覆蓋它」,失敗時前提不成立:原本的失敗分支只寫 { loading: false },
// 卡片就停在「查詢中…」上,而且連轉圈的視覺提示都沒有了——使用者看到
// 一張寫著「查詢中…」卻已經停止查詢的卡,既不知道那是哪裡、也沒有重來
// 的入口。
//
// 跟 selectedStopSync.test.tsx 一樣刻意不渲染 TripPlanPage 本身(那個
// 元件會建立 onagent WebSocket、lazy 載入、依賴 google.maps),改成抽出
// 同構的最小實作——覆蓋的是「失敗標記 + 錯誤渲染 + 重試 + 掛載補救」
// 這四件事本身,它們是純粹的狀態邏輯,不依賴那些外部環境。

const PLACE_ID = 'ChIJtest123'
const STOP_ID = 'stop-1'

// 跟 attractionTools.ts add_attraction 插入當下完全一致的佔位資料——
// 測試要驗的正是「這個佔位字串不該在失敗後留在畫面上」,所以它必須跟
// 正式路徑用同一個值,不能自己另寫一個。
const PLACEHOLDER_NAME = '查詢中…'

function makeTimelineWithLoadingStop(): PlanTimeline {
  const inserted = insertAfter(createEmptyTimeline(), null, {
    type: 'stop',
    placeId: PLACE_ID,
    loading: true,
    name: PLACEHOLDER_NAME,
  }, STOP_ID)
  if (!inserted.ok) throw new Error('測試前置:插入節點失敗')
  return inserted.timeline
}

// resolveStop — 與 TripPlanPage 的 resolveAttractionForStep 同構的最小
// 實作:成功寫入真實資料並清掉 failed、失敗標記 failed 並清掉 loading。
// 兩條分支的欄位寫法與該函式逐行對應。
function resolveStop(
  stopId: string,
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; lat?: number; lng?: number }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
) {
  return fetchPlaceDetails(placeId)
    .then((details) => {
      if (details.found === false || details.lat == null || details.lng == null) {
        setTimeline((prev) => updateNode(prev, stopId, { loading: false, failed: true }))
        return
      }
      setTimeline((prev) => updateNode(prev, stopId, {
        loading: false,
        failed: false,
        name: details.name,
        lat: details.lat,
        lng: details.lng,
      }))
    })
    .catch(() => {
      setTimeline((prev) => updateNode(prev, stopId, { loading: false, failed: true }))
    })
}

// StopCard — 與 PlanTimelineView 對 failed 的渲染同構的最小實作:
// 失敗時標題改成明確的錯誤文字(不顯示 p.name 那個佔位字串)、並顯示
// 一顆重試按鈕。
function StopCard({
  initialTimeline,
  fetchPlaceDetails,
  persist = false,
  retryOnMount = false,
}: {
  initialTimeline: PlanTimeline
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; lat?: number; lng?: number }>
  persist?: boolean
  retryOnMount?: boolean
}) {
  const [timeline, setTimeline] = useState(initialTimeline)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline

  // 持久化——只在 persist 開啟時寫入,模擬 TripPlanPage 的 commitTimeline
  // 每次異動都存檔的行為。
  useEffect(() => {
    if (persist) saveTimeline(timeline, 0)
  }, [persist, timeline])

  const retry = useCallback((stopId: string) => {
    const node = timelineRef.current.nodes.get(stopId)
    if (!node || node.type !== 'stop' || !node.placeId) return
    setTimeline((prev) => updateNode(prev, stopId, { loading: true, failed: false }))
    void resolveStop(stopId, node.placeId, fetchPlaceDetails, setTimeline)
  }, [fetchPlaceDetails])

  // 掛載後自動重試 failed 的站點(對應 TripPlanPage 的同名 effect)。
  const retriedRef = useRef(false)
  useEffect(() => {
    if (!retryOnMount || retriedRef.current) return
    retriedRef.current = true
    const ids: string[] = []
    for (const [id, node] of timelineRef.current.nodes) {
      if (node.type === 'stop' && node.failed && node.placeId) ids.push(id)
    }
    for (const id of ids) retry(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const node = timeline.nodes.get(STOP_ID)
  if (!node) return <div data-testid="gone">節點已移除</div>
  return (
    <div>
      <span data-testid="title">{node.failed ? '未能取得地點資料' : node.name}</span>
      <span data-testid="loading">{node.loading ? 'loading' : 'idle'}</span>
      <span data-testid="failed">{node.failed ? 'failed' : 'ok'}</span>
      {node.failed && (
        <button data-testid="retry" onClick={() => retry(STOP_ID)}>重試</button>
      )}
    </div>
  )
}

describe('地點查詢失敗:標記錯誤、不留暫時性文字', () => {
  it('查詢拋錯時標記 failed、清掉 loading', async () => {
    const setTimeline = vi.fn()
    let timeline = makeTimelineWithLoadingStop()
    const apply = (fn: unknown) => {
      timeline = typeof fn === 'function' ? (fn as (p: PlanTimeline) => PlanTimeline)(timeline) : (fn as PlanTimeline)
    }
    setTimeline.mockImplementation(apply)

    await resolveStop(STOP_ID, PLACE_ID, () => Promise.reject(new Error('network down')), setTimeline as never)

    const node = timeline.nodes.get(STOP_ID)
    expect(node?.failed).toBe(true)
    expect(node?.loading).toBe(false)
  })

  it('查無此地(found:false)同樣標記 failed', async () => {
    let timeline = makeTimelineWithLoadingStop()
    const setTimeline = ((fn: unknown) => {
      timeline = typeof fn === 'function' ? (fn as (p: PlanTimeline) => PlanTimeline)(timeline) : (fn as PlanTimeline)
    }) as never

    await resolveStop(STOP_ID, PLACE_ID, () => Promise.resolve({ found: false }), setTimeline)

    expect(timeline.nodes.get(STOP_ID)?.failed).toBe(true)
  })

  it('缺座標視為失敗——沒有座標就無從估算交通時間、也畫不出地圖圓點', async () => {
    let timeline = makeTimelineWithLoadingStop()
    const setTimeline = ((fn: unknown) => {
      timeline = typeof fn === 'function' ? (fn as (p: PlanTimeline) => PlanTimeline)(timeline) : (fn as PlanTimeline)
    }) as never

    await resolveStop(STOP_ID, PLACE_ID, () => Promise.resolve({ found: true, name: '赤崁樓' }), setTimeline)

    expect(timeline.nodes.get(STOP_ID)?.failed).toBe(true)
  })

})

describe('失敗後的重試', () => {
  it('重試會把節點先設回 loading,讓使用者看得出按鈕有反應', async () => {
    let resolveFn: ((v: { found: boolean; name: string; lat: number; lng: number }) => void) | null = null
    const fetchPlaceDetails = vi.fn(() => new Promise<{ found?: boolean; name?: string; lat?: number; lng?: number }>((res) => {
      resolveFn = res as never
    }))

    // 起始狀態:已經是 failed(模擬先前查詢失敗過)
    const failed = updateNode(makeTimelineWithLoadingStop(), STOP_ID, { loading: false, failed: true })
    const { getByTestId } = render(
      <StopCard initialTimeline={failed} fetchPlaceDetails={fetchPlaceDetails} />,
    )

    expect(getByTestId('failed').textContent).toBe('failed')
    expect(getByTestId('title').textContent).toBe('未能取得地點資料')

    await act(async () => {
      getByTestId('retry').click()
    })

    // 按下之後:loading 回來、failed 清掉
    expect(getByTestId('loading').textContent).toBe('loading')
    expect(getByTestId('failed').textContent).toBe('ok')
    expect(fetchPlaceDetails).toHaveBeenCalledWith(PLACE_ID)

    // 讓查詢成功
    await act(async () => {
      resolveFn?.({ found: true, name: '赤崁樓', lat: 22.997, lng: 120.202 })
    })

    expect(getByTestId('title').textContent).toBe('赤崁樓')
    expect(getByTestId('failed').textContent).toBe('ok')
    expect(getByTestId('loading').textContent).toBe('idle')
  })
})

describe('重整後自動重試', () => {
  it('failed 會被持久化——不像 loading/removing 那樣在存檔時被剝掉', () => {
    clearTimeline()
    const failed = updateNode(makeTimelineWithLoadingStop(), STOP_ID, {
      loading: true,
      removing: true,
      failed: true,
    })
    saveTimeline(failed, 0)

    const { timeline } = loadTimelineWithRev()
    const node = timeline.nodes.get(STOP_ID)
    // loading/removing 被剝掉(那兩個是只在這次 session 有意義的暫態)
    expect(node?.loading).toBeUndefined()
    expect(node?.removing).toBeUndefined()
    // failed 保留——重整後要靠它知道哪一站需要重查
    expect(node?.failed).toBe(true)
    clearTimeline()
  })

  it('掛載時掃出 failed 的站點並自動重查,成功後顯示真實名稱', async () => {
    const fetchPlaceDetails = vi.fn().mockResolvedValue({
      found: true, name: '祀典武廟', lat: 22.998, lng: 120.202,
    })
    // 模擬「重整後讀回來的時間軸」:failed 還在,loading 已被剝掉
    const restored = updateNode(makeTimelineWithLoadingStop(), STOP_ID, { loading: false, failed: true })

    const { getByTestId } = render(
      <StopCard initialTimeline={restored} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />,
    )

    await waitFor(() => {
      expect(getByTestId('title').textContent).toBe('祀典武廟')
    })
    expect(fetchPlaceDetails).toHaveBeenCalledWith(PLACE_ID)
    expect(getByTestId('failed').textContent).toBe('ok')
  })

  it('掛載時的自動重試只跑一次——持續失敗不該變成無限重試迴圈', async () => {
    const fetchPlaceDetails = vi.fn().mockRejectedValue(new Error('still down'))
    const restored = updateNode(makeTimelineWithLoadingStop(), STOP_ID, { loading: false, failed: true })

    const { getByTestId } = render(
      <StopCard initialTimeline={restored} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />,
    )

    await waitFor(() => {
      expect(getByTestId('failed').textContent).toBe('failed')
    })
    // 重試失敗後節點又變回 failed,若 effect 盯著 timeline 跑就會再觸發
    // 一次、形成迴圈。只呼叫一次才是對的。
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
  })

  it('沒有 failed 的站點不會被掛載重試誤觸', async () => {
    const fetchPlaceDetails = vi.fn()
    const healthy = updateNode(makeTimelineWithLoadingStop(), STOP_ID, {
      loading: false, failed: false, name: '赤崁樓', lat: 22.997, lng: 120.202,
    })

    render(<StopCard initialTimeline={healthy} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />)

    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })
})

// needsStopLookup / lookupFailed 的判準——涵蓋 429 孤兒節點。
//
// 2026-10（review 發現）：原本掛載重試只掃 `failed`,而 429 限流路徑
// 刻意維持 loading: true 且不設 failed,存檔時 loading 又被剝掉。
// 結果重整後產生「既不是 loading、也不是 failed、name 停在佔位字串」
// 的節點——沒有錯誤標示、沒有重試按鈕、自動重試也跳過它,完全重現
// 這次要修的原始 bug,只是觸發條件縮成「429 期間重整」。
describe('429 孤兒節點:loading 被剝掉但 failed 從未設定', () => {
  it('needsStopLookup 認得這種節點(光看 failed 會漏掉)', () => {
    // 模擬 429 期間存檔、重整後讀回來的樣子:sanitizeNode 剝掉 loading,
    // failed 從未被設定,name 停在插入當下的佔位字串。
    const orphan = updateNode(makeTimelineWithLoadingStop(), STOP_ID, {
      loading: undefined,
      failed: undefined,
    }).nodes.get(STOP_ID)!

    expect(orphan.failed).toBeUndefined()
    expect(orphan.loading).toBeUndefined()
    expect(orphan.name).toBe(PLACEHOLDER_NAME)
    // 光看 failed 會漏掉它——這正是原本的 bug。
    expect(stopLookupFailed(orphan)).toBe(true)
  })

  it('已經查到座標的節點不會被誤判成待重查', () => {
    const done = updateNode(makeTimelineWithLoadingStop(), STOP_ID, {
      loading: false, failed: false, name: '赤崁樓', lat: 22.997, lng: 120.202,
    }).nodes.get(STOP_ID)!
    expect(stopLookupFailed(done)).toBe(false)
  })

  it('正在查詢中的節點不重複觸發', () => {
    const loading = makeTimelineWithLoadingStop().nodes.get(STOP_ID)!
    expect(loading.loading).toBe(true)
    expect(stopLookupFailed(loading)).toBe(false)
  })

  it('沒有 placeId 的 stop 不需要查(劇本的固定資料本來就不打 API)', () => {
    const noPlace = updateNode(makeTimelineWithLoadingStop(), STOP_ID, {
      loading: false, placeId: undefined, name: '手動加的站',
    }).nodes.get(STOP_ID)!
    expect(stopLookupFailed(noPlace)).toBe(false)
  })

  it('經過真正的存檔→讀回,孤兒節點仍然被認出來', () => {
    clearTimeline()
    // 429 期間的真實狀態:loading: true、failed 未設定
    saveTimeline(makeTimelineWithLoadingStop(), 0)
    const { timeline } = loadTimelineWithRev()
    const node = timeline.nodes.get(STOP_ID)!
    // sanitizeNode 剝掉 loading,所以讀回來不是 loading
    expect(node.loading).toBeUndefined()
    expect(node.failed).toBeUndefined()
    // 但判準仍然認得它需要重查
    expect(stopLookupFailed(node)).toBe(true)
    clearTimeline()
  })
})
