import { describe, it, expect, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createEmptyTimeline, getNode, insertAfter, listNodes, stopLookupFailed, updateNode, type PlanTimeline } from '../plan-core/planTimeline'
import { nodeStatusOf } from '../plan-core/planNodeStatus'
import { usePlanNodeStatus } from '../plan-core/usePlanNodeStatus'
import { resolveAttractionForStep } from '../plan-core/resolveAttractionForStep'
import { saveTimeline, loadTimelineWithRev, clearTimeline } from '../plan-core/planTimelineStorage'

// stopLookupFailure.test.tsx — 地點資料查詢失敗的完整機制回歸測試。
//
// 使用者明確要求「不要有任何失敗前會有的暫時性狀態跟文字,失敗就標記該階段為錯誤,介面上做可以重試,
// 重整後要進行重試」。四段都在這裡模擬:
//   1. 查詢失敗 → 節點狀態表標 failed、不留下佔位文字
//   2. 介面顯示錯誤狀態與重試按鈕(不是停在「查詢中…」)
//   3. 按重試 → 走同一條查詢路徑,成功後清掉 failed
//   4. 重整後自動重試:狀態表不持久化,靠資料本身(有 placeId 沒座標)找出要重查的站
//
// 2026-10 改寫:loading/failed/removing 已搬出節點(planNodeStatus.ts),原本這份測試用自己抄的 resolveStop
// 模擬流程;現在直接驅動真實的 resolveAttractionForStep 與 usePlanNodeStatus,不再有第二份實作可能與正式碼悄悄分歧。
// 刻意不渲染 TripPlanPage 本身(那個元件會建立 onagent WebSocket、lazy 載入、依賴 google.maps)。

const PLACE_ID = 'ChIJtest123'
const STOP_ID = 'stop-1'
// 跟 attractionTools.ts add_attraction 插入當下一致的佔位名稱:失敗後它不該留在畫面上。
const PLACEHOLDER_NAME = '查詢中…'

type Details = { found?: boolean; name?: string; lat?: number; lng?: number }

function makePlaceholderTimeline(): PlanTimeline {
  const inserted = insertAfter(createEmptyTimeline(), null, { type: 'stop', placeId: PLACE_ID, name: PLACEHOLDER_NAME }, STOP_ID)
  if (!inserted.ok) throw new Error('測試前置:插入節點失敗')
  return inserted.timeline
}

// StopCard——與 TripPlanPage 同構的最小宿主:持有時間軸 state 與節點狀態表,
// retry/掛載重試都呼叫真實的 resolveAttractionForStep,渲染規則同 PlanTimelineView(失敗時不顯示佔位名稱)。
function StopCard({
  initialTimeline,
  fetchPlaceDetails,
  persist = false,
  retryOnMount = false,
  autoStart = false,
}: {
  initialTimeline: PlanTimeline
  fetchPlaceDetails: (placeId: string) => Promise<Details>
  persist?: boolean
  retryOnMount?: boolean
  autoStart?: boolean
}) {
  const [timeline, setTimeline] = useState(initialTimeline)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const { nodeStatus, nodeStatusRef, setStatus } = usePlanNodeStatus(timeline, timelineRef)

  useEffect(() => {
    if (persist) saveTimeline(timeline, 0)
  }, [persist, timeline])

  const lookup = useCallback((stopId: string) => {
    const node = getNode(timelineRef.current, stopId)
    if (!node || node.type !== 'stop' || !node.placeId) return
    resolveAttractionForStep({
      stepId: stopId,
      placeId: node.placeId,
      fetchPlaceDetails,
      setTimeline,
      setStatus,
      isCancelled: () => false,
      onSettled: () => {},
    })
  }, [fetchPlaceDetails, setStatus])

  // 掛載後自動重試(對應 TripPlanPage 的同名 effect):用 stopLookupFailed(資料 + 狀態表)找出要重查的站。
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (autoStart) lookup(STOP_ID)
    if (!retryOnMount) return
    for (const node of listNodes(timelineRef.current)) {
      if (stopLookupFailed(node, nodeStatusOf(nodeStatusRef.current, node.id))) lookup(node.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const node = getNode(timeline, STOP_ID)
  if (!node) return <div data-testid="gone">節點已移除</div>
  const status = nodeStatusOf(nodeStatus, STOP_ID)
  const failed = stopLookupFailed(node, status)
  return (
    <div>
      <span data-testid="title">{failed ? '未能取得地點資料' : node.name}</span>
      <span data-testid="loading">{status.loading ? 'loading' : 'idle'}</span>
      <span data-testid="failed">{failed ? 'failed' : 'ok'}</span>
      {failed && <button data-testid="retry" onClick={() => lookup(STOP_ID)}>重試</button>}
    </div>
  )
}

describe('地點查詢失敗:狀態表標錯誤、不留暫時性文字', () => {
  it('查詢拋錯:狀態表 failed、loading 清掉,畫面顯示錯誤而非佔位字串', async () => {
    const { getByTestId } = render(
      <StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={() => Promise.reject(new Error('network down'))} autoStart />,
    )
    await waitFor(() => expect(getByTestId('failed').textContent).toBe('failed'))
    expect(getByTestId('loading').textContent).toBe('idle')
    expect(getByTestId('title').textContent).toBe('未能取得地點資料')
  })

  it('查詢中:狀態表 loading,不算失敗', async () => {
    const { getByTestId } = render(
      <StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={() => new Promise<Details>(() => {})} autoStart />,
    )
    await waitFor(() => expect(getByTestId('loading').textContent).toBe('loading'))
    expect(getByTestId('failed').textContent).toBe('ok')
  })

  it('查無此地(found:false)與缺座標都視為失敗', async () => {
    const a = render(<StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={() => Promise.resolve({ found: false })} autoStart />)
    await waitFor(() => expect(a.getByTestId('failed').textContent).toBe('failed'))
    a.unmount()
    const b = render(<StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={() => Promise.resolve({ found: true, name: '赤崁樓' })} autoStart />)
    await waitFor(() => expect(b.getByTestId('failed').textContent).toBe('failed'))
  })

  it('成功:名稱與座標寫回節點、loading/failed 都清掉', async () => {
    const { getByTestId } = render(
      <StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={() => Promise.resolve({ found: true, name: '赤崁樓', lat: 22.997, lng: 120.202 })} autoStart />,
    )
    await waitFor(() => expect(getByTestId('title').textContent).toBe('赤崁樓'))
    expect(getByTestId('loading').textContent).toBe('idle')
    expect(getByTestId('failed').textContent).toBe('ok')
  })
})

describe('失敗後的重試', () => {
  it('重試會把狀態表先設回 loading、清掉 failed,成功後顯示真實名稱', async () => {
    let resolveFn: ((v: Details) => void) | null = null
    const fetchPlaceDetails = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockImplementationOnce(() => new Promise<Details>((res) => { resolveFn = res }))
    const { getByTestId } = render(<StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={fetchPlaceDetails} autoStart />)
    await waitFor(() => expect(getByTestId('failed').textContent).toBe('failed'))

    await act(async () => { getByTestId('retry').click() })
    expect(getByTestId('loading').textContent).toBe('loading')
    expect(getByTestId('failed').textContent).toBe('ok')
    expect(fetchPlaceDetails).toHaveBeenCalledWith(PLACE_ID)

    await act(async () => { resolveFn?.({ found: true, name: '赤崁樓', lat: 22.997, lng: 120.202 }) })
    expect(getByTestId('title').textContent).toBe('赤崁樓')
    expect(getByTestId('failed').textContent).toBe('ok')
    expect(getByTestId('loading').textContent).toBe('idle')
  })
})

describe('重整後自動重試', () => {
  it('狀態表不持久化:存檔→讀回的節點沒有任何狀態欄位,但「有 placeId 沒座標」仍被認出需要重查', () => {
    clearTimeline()
    saveTimeline(makePlaceholderTimeline(), 0)
    const { timeline } = loadTimelineWithRev()
    const node = getNode(timeline, STOP_ID)!
    for (const k of ['loading', 'failed', 'removing']) expect(k in node).toBe(false)
    expect(stopLookupFailed(node)).toBe(true)
    clearTimeline()
  })

  it('掛載時掃出要重查的站點並自動重查,成功後顯示真實名稱', async () => {
    const fetchPlaceDetails = vi.fn().mockResolvedValue({ found: true, name: '祀典武廟', lat: 22.998, lng: 120.202 })
    const { getByTestId } = render(<StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />)
    await waitFor(() => expect(getByTestId('title').textContent).toBe('祀典武廟'))
    expect(fetchPlaceDetails).toHaveBeenCalledWith(PLACE_ID)
    expect(getByTestId('failed').textContent).toBe('ok')
  })

  it('掛載時的自動重試只跑一次——持續失敗不該變成無限重試迴圈', async () => {
    const fetchPlaceDetails = vi.fn().mockRejectedValue(new Error('still down'))
    const { getByTestId } = render(<StopCard initialTimeline={makePlaceholderTimeline()} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />)
    await waitFor(() => expect(getByTestId('failed').textContent).toBe('failed'))
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
  })

  it('已查到座標的站點不會被掛載重試誤觸', () => {
    const fetchPlaceDetails = vi.fn()
    const healthy = updateNode(makePlaceholderTimeline(), STOP_ID, { name: '赤崁樓', lat: 22.997, lng: 120.202 })
    render(<StopCard initialTimeline={healthy} fetchPlaceDetails={fetchPlaceDetails} retryOnMount />)
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })
})

describe('stopLookupFailed 判準(資料 + 狀態表)', () => {
  const nodeOf = (over = {}) => getNode(updateNode(makePlaceholderTimeline(), STOP_ID, over), STOP_ID)!

  it('有 placeId 沒座標且沒有狀態:視為沒拿到(重整後的孤兒節點,含 429 等待時被重整)', () => {
    expect(stopLookupFailed(nodeOf())).toBe(true)
  })
  it('狀態 loading:正在查,不算失敗', () => {
    expect(stopLookupFailed(nodeOf(), { loading: true })).toBe(false)
  })
  it('狀態 failed:失敗(即使資料看起來完整)', () => {
    expect(stopLookupFailed(nodeOf({ lat: 1, lng: 2 }), { failed: true })).toBe(true)
  })
  it('已有座標:不算失敗', () => {
    expect(stopLookupFailed(nodeOf({ lat: 22.997, lng: 120.202 }))).toBe(false)
  })
  it('沒有 placeId 的 stop 不需要查', () => {
    expect(stopLookupFailed(nodeOf({ placeId: undefined, name: '手動加的站' }))).toBe(false)
  })
})
