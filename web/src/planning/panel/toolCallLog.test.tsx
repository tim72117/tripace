import { describe, it, expect, vi } from 'vitest'
import { renderWithPlanData as render } from '../data/fixtures'
import { HorizontalPlanTimeline } from '../timeline/phone/HorizontalPlanTimeline'
import { timelineOf } from '../timeline/fixtures'
import { appendToolCallLog, MAX_TOOL_CALL_LOG, resolvePhonePanToStop } from './TripPlanPage'

// 不渲染 TripPlanPage 本身(會建立 onagent 連線、依賴 google.maps)。
// 接線用 resolvePhonePanToStop(TripPlanPage 實際呼叫的函式)搭配真實的 HorizontalPlanTimeline 驗證。

const noop = () => {}

function mount(onPanToStop: ((id: string) => void) | undefined) {
  const wired = resolvePhonePanToStop(onPanToStop, (id: string) => onPanToStop?.(id))
  return render(
    <HorizontalPlanTimeline
      timeline={timelineOf([{ id: 's1', type: 'stop', name: '站一', time: '09:00', duration: '停留 1h', day: 1 }])}
      selectedStopId={null}
      onSelectStop={noop}
      onOpenPhotos={noop}
      onPanToStop={wired}
    />,
  )
}

describe('手機版「移動到此」按鈕接線', () => {
  it('onPanToStop 未提供時不渲染按鈕', () => {
    const { container } = mount(undefined)
    expect(container.querySelector('[aria-label^="在地圖上移動到"]')).toBeNull()
  })
  it('提供時渲染按鈕', () => {
    const { container } = mount(vi.fn())
    expect(container.querySelector('[aria-label^="在地圖上移動到"]')).not.toBeNull()
  })
})

describe('appendToolCallLog', () => {
  it('id 遞增且不重複、不依賴 crypto.randomUUID', () => {
    const orig = globalThis.crypto.randomUUID
    // @ts-expect-error 模擬非安全環境
    globalThis.crypto.randomUUID = undefined
    try {
      let log = appendToolCallLog([], { name: 'a', args: {}, result: 1 })
      log = appendToolCallLog(log, { name: 'b', args: {}, result: 2 })
      expect(new Set(log.map((e) => e.id)).size).toBe(2)
    } finally {
      globalThis.crypto.randomUUID = orig
    }
  })
  it('超過上限只保留最近的筆數', () => {
    let log: ReturnType<typeof appendToolCallLog> = []
    for (let i = 0; i < MAX_TOOL_CALL_LOG + 5; i++) log = appendToolCallLog(log, { name: `t${i}`, args: {}, result: i })
    expect(log).toHaveLength(MAX_TOOL_CALL_LOG)
    expect(log[0].name).toBe('t5')
    expect(log[log.length - 1].name).toBe(`t${MAX_TOOL_CALL_LOG + 4}`)
  })
})
