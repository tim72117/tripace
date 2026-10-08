import { describe, it, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { useStableCallback } from '../hooks/useStableCallback'

// selectedStopSync.test.tsx — TripPlanPage 的 selectedStopId 受控/非受控
// 雙模式的回歸測試。
//
// 這裡刻意不渲染 TripPlanPage 本身:那個元件會建立 onagent WebSocket
// 連線、lazy 載入、依賴 google.maps 與大量 API mock(同資料夾的
// geo-planning 測試已經因為 jsdom 沒有 google.maps 而長期失敗),成本
// 遠高於這次要保護的邏輯。改成抽出同構的最小元件,覆蓋的是「受控/非受控
// 判斷 + selectStop 寫入口 + 事件驅動通知」這三件事本身——它們是純粹的
// React 狀態邏輯,不依賴那些外部環境。
//
// 這組測試存在的理由是一個實際發生過的 bug(2026-10):原本
// selectedStopId 由 TripPlanPage 自己持有、用 useEffect 依賴
// [selectedStopId] 單向上報給 DesktopLayout,而地圖那側點圓點時直接寫
// DesktopLayout 的 state。結果:
//   點卡片 A(兩份都 A)→ 點地圖圓點 B(父=B、子仍 A,畫面同時兩個
//   選中)→ 再點卡片 A:setSelectedStopId('A') 本身正常執行,但子元件的
//   值本來就是 'A',React bail out、上報 effect 的依賴沒變、不重跑,
//   父層永遠停在 B,地圖再也回不到 A。
// 下方第一個測試就是這個情境。

// SelectableTimeline — 與 TripPlanPage 同構的最小實作(受控/非受控判斷、
// selectStop 寫入口、事件驅動通知),三者的寫法與該元件逐行對應。
function SelectableTimeline({
  selectedStopId: controlledSelectedStopId,
  onSelectedStopChange,
}: {
  selectedStopId?: string | null
  onSelectedStopChange?: (id: string | null) => void
}) {
  const [internalSelectedStopId, setInternalSelectedStopId] = useState<string | null>(null)
  const isSelectionControlled = controlledSelectedStopId !== undefined
  const selectedStopId = isSelectionControlled ? controlledSelectedStopId : internalSelectedStopId
  const selectStop = useStableCallback((id: string | null) => {
    if (!isSelectionControlled) setInternalSelectedStopId(id)
    onSelectedStopChange?.(id)
  })
  const panToStop = useCallback((id: string) => { selectStop(id) }, [selectStop])

  return (
    <div>
      <button data-testid="card-A" onClick={() => panToStop('A')}>A</button>
      <button data-testid="card-B" onClick={() => panToStop('B')}>B</button>
      <span data-testid="selected">{selectedStopId ?? 'none'}</span>
    </div>
  )
}

describe('selectedStopId 受控模式(地圖對話小匡)', () => {
  it('外部(點地圖圓點)改成 B 之後,再點卡片 A 能正確回到 A', () => {
    let setFromMap: ((id: string | null) => void) | null = null

    function Host() {
      const [selected, setSelected] = useState<string | null>(null)
      setFromMap = setSelected
      return (
        <div>
          <SelectableTimeline selectedStopId={selected} onSelectedStopChange={setSelected} />
          <span data-testid="host-selected">{selected ?? 'none'}</span>
        </div>
      )
    }

    const { getByTestId } = render(<Host />)

    act(() => { getByTestId('card-A').click() })
    expect(getByTestId('selected').textContent).toBe('A')
    expect(getByTestId('host-selected').textContent).toBe('A')

    // 點地圖圓點:直接寫唯一事實來源(DesktopLayout 的
    // onPlanStopClick={setSelectedPlanStopId})。受控之下時間軸立刻跟著變,
    // 不會出現「地圖與卡片各自高亮不同站」。
    act(() => { setFromMap!('B') })
    expect(getByTestId('selected').textContent).toBe('B')

    // 回歸點:改受控前這裡會卡在 B。
    act(() => { getByTestId('card-A').click() })
    expect(getByTestId('selected').textContent).toBe('A')
    expect(getByTestId('host-selected').textContent).toBe('A')
  })

  it('重複點同一張卡片仍然每次都通知呼叫端(事件驅動,不看值有沒有變)', () => {
    const reports: (string | null)[] = []

    function Host() {
      const [selected, setSelected] = useState<string | null>(null)
      const onChange = useCallback((id: string | null) => {
        reports.push(id)
        setSelected(id)
      }, [])
      return <SelectableTimeline selectedStopId={selected} onSelectedStopChange={onChange} />
    }

    const { getByTestId } = render(<Host />)
    act(() => { getByTestId('card-A').click() })
    act(() => { getByTestId('card-A').click() })
    act(() => { getByTestId('card-A').click() })

    // 三次點擊三次通知——若改回用 useEffect 依賴 [selectedStopId] 上報,
    // 第二、三次會因為值沒變而完全不觸發(那正是上面那個 bug 的成因)。
    expect(reports).toEqual(['A', 'A', 'A'])
  })

  it('selectedStopId 傳 null 仍算受控(null 是「沒選任何站」的合法值)', () => {
    const reports: (string | null)[] = []
    const { getByTestId } = render(
      <SelectableTimeline selectedStopId={null} onSelectedStopChange={(id) => reports.push(id)} />,
    )
    act(() => { getByTestId('card-A').click() })
    // 受控:自己不改狀態,只通知——呼叫端沒有把值寫回來,畫面就維持 none。
    expect(getByTestId('selected').textContent).toBe('none')
    expect(reports).toEqual(['A'])
  })
})

describe('selectedStopId 非受控模式(/app/plan-ai 全頁)', () => {
  it('不傳 selectedStopId 時用內部 state,點卡片正常切換', () => {
    const { getByTestId } = render(<SelectableTimeline />)
    expect(getByTestId('selected').textContent).toBe('none')
    act(() => { getByTestId('card-A').click() })
    expect(getByTestId('selected').textContent).toBe('A')
    act(() => { getByTestId('card-B').click() })
    expect(getByTestId('selected').textContent).toBe('B')
  })

  it('只傳 onSelectedStopChange、不傳 selectedStopId:自己管狀態,同時通知', () => {
    const reports: (string | null)[] = []
    const { getByTestId } = render(
      <SelectableTimeline onSelectedStopChange={(id) => reports.push(id)} />,
    )
    act(() => { getByTestId('card-A').click() })
    // 內部 state 有更新(非受控),呼叫端也收到通知——這是合法的第三種
    // 組合,對齊 <input onChange> 不給 value 的既有語意。
    expect(getByTestId('selected').textContent).toBe('A')
    expect(reports).toEqual(['A'])
  })
})
