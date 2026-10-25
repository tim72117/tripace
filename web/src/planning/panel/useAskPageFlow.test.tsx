// useAskPageFlow.test.tsx——詢問頁串接流程的互動測試:接真的 useAskPageBridge(等待/不搶佔規則)與真的 AskPage,
// 從畫面上的按鈕操作整條流程(國家 → 城市 → 返回 → 景點 → 用下方輸入匡說明),只把查景點與送出訊息換成假的。
// TripPlanPage 本身會建立 onagent 連線、依賴 google.maps,不直接渲染;它對詢問頁的接線就是這個 hook。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { AskPage } from '../conversation/AskPage'
import { useAskPageBridge } from '../conversation/useAskPageBridge'
import type { AskPageCandidate, AskPageInput, AskPageSelection, UserSelectionRecord } from '../conversation/asktools'
import type { PlanAiDataSource } from '../data/source'
import type { TravelCity } from '../conversation/travelRegionData'
import { Composer } from '../../components/Composer'
import { composerModeFor, routeComposerSubmit } from './composerMode'
import { CITY_LOOKUP_LOADING_DELAY_MS, CITY_LOOKUP_LOADING_MIN_MS, CITY_LOOKUP_TIMEOUT_MS, useAskPageFlow } from './useAskPageFlow'

const dataSource = {
  placeDetails: vi.fn().mockResolvedValue({ found: false }),
  transitEstimate: vi.fn(),
} as unknown as PlanAiDataSource

interface HarnessProps {
  search?: (city: TravelCity, signal: AbortSignal) => Promise<AskPageCandidate[]>
  sendPrompt?: (text: string) => Promise<boolean>
  isThinking?: boolean
  onAskPageTextNotSent?: (text: string) => void
  // composer——一併渲染下方輸入匡,接線與 TripPlanPage 相同(composerModeFor/routeComposerSubmit/submitAskPageText)。
  composer?: boolean
  // 測試要拿到 bridge 直接模擬 LLM 的工具呼叫(openAskPage)。
  onBridge?: (bridge: ReturnType<typeof useAskPageBridge<AskPageInput>>) => void
  // 測試要檢查 get_user_selection 讀到的紀錄(userSelectionRef)。
  onSelectionRef?: (ref: { current: UserSelectionRecord | null }) => void
}

function Harness({ search = async () => [], sendPrompt = async () => true, isThinking = false, onAskPageTextNotSent, onBridge, onSelectionRef, composer = false }: HarnessProps) {
  const bridge = useAskPageBridge<AskPageInput>({ candidates: [] })
  onBridge?.(bridge)
  const userSelectionRef = useRef<UserSelectionRecord | null>(null)
  onSelectionRef?.(userSelectionRef)
  const [chatInput, setChatInput] = useState('')
  const flow = useAskPageFlow({
    bridge,
    searchCityAttractions: search,
    sendPrompt,
    isThinking,
    userSelectionRef,
    onAskPageTextNotSent: (text) => {
      onAskPageTextNotSent?.(text)
      setChatInput((current) => (current.trim() ? current : text))
    },
  })
  const mode = composerModeFor({ isThinking, ask: bridge.showAskPage ? bridge.askPageInput : null })
  return (
    <>
      {bridge.showAskPage ? (
        <AskPage
          dataSource={dataSource}
          input={bridge.askPageInput}
          onDone={flow.handleAskPageDone}
          onBack={flow.handleAskPageBack}
        />
      ) : (
        <TimelineProbe />
      )}
      {composer && (
        <Composer
          value={chatInput}
          onChange={setChatInput}
          placeholder={mode.placeholder}
          busy={mode.busy}
          onStop={() => {}}
          onSubmit={() => {
            const route = routeComposerSubmit(chatInput, mode)
            if (route === 'askPage') {
              setChatInput('')
              flow.submitAskPageText(chatInput)
            } else if (route === 'prompt') {
              void sendPrompt(chatInput)
            }
          }}
        />
      )}
    </>
  )
}

// timelineRenders——時間軸被渲染過幾次:「選完城市不閃回時間軸」要確認的是整段過程中一次都沒出現,不只是最後的畫面。
let timelineRenders = 0
function TimelineProbe() {
  timelineRenders++
  return <div data-testid="timeline" />
}

function renderWithBridge(props: HarnessProps = {}) {
  let bridge!: ReturnType<typeof useAskPageBridge<AskPageInput>>
  let selectionRef!: { current: UserSelectionRecord | null }
  const utils = render(<Harness {...props} onBridge={(b) => { bridge = b }} onSelectionRef={(r) => { selectionRef = r }} />)
  return { ...utils, bridge: () => bridge, selection: () => selectionRef.current }
}

function title(): string {
  return document.querySelector('p')?.textContent ?? ''
}

function direction(container: HTMLElement): string | null {
  return container.querySelector('[data-direction]')?.getAttribute('data-direction') ?? null
}

describe('返回上一層(城市頁 → 國家頁)', () => {
  it('選台灣 → 城市頁 → 返回 → 回到國家頁(方向 back)→ 再選一次台灣能正常進到城市頁', async () => {
    const { container, bridge } = renderWithBridge()
    let initial!: Promise<AskPageSelection[]>
    act(() => {
      initial = bridge().openAskPage({ country: {} })
    })
    expect(title()).toBe('要去哪個國家?')

    fireEvent.click(screen.getByRole('button', { name: '台灣' }))
    await expect(initial).resolves.toEqual([{ placeId: 'taiwan' }])
    expect(title()).toBe('台灣要去哪裡?')
    expect(direction(container)).toBe('forward')

    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(title()).toBe('要去哪個國家?')
    expect(direction(container)).toBe('back')

    fireEvent.click(screen.getByRole('button', { name: '台灣' }))
    expect(title()).toBe('台灣要去哪裡?')
    expect(screen.getByRole('button', { name: '返回上一層' })).toBeTruthy()
  })

  it('返回後在國家頁按「不用了」:詢問頁收起,不殘留等待(之後 LLM 開的詢問頁照常顯示)', () => {
    const { bridge } = renderWithBridge()
    act(() => {
      void bridge().openAskPage({ country: {} })
    })
    fireEvent.click(screen.getByRole('button', { name: '台灣' }))
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()

    act(() => {
      void bridge().openAskPage({ transport: ['walk'] })
    })
    expect(title()).toBe('這段要怎麼移動?')
  })

  it('LLM 直接呼叫 ask_travel_city(沒有先問國家):沒有返回按鈕,選城市照常往下查景點', async () => {
    const search = vi.fn(async () => [{ placeId: 'p1', name: '赤崁樓' }])
    const { bridge } = renderWithBridge({ search })
    act(() => {
      void bridge().openAskPage({ city: { countryId: 'taiwan' } })
    })
    expect(screen.queryByRole('button', { name: '返回上一層' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await waitFor(() => expect(title()).toBe('選擇感興趣的景點'))
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ id: 'taiwan-tainan' }), expect.any(AbortSignal))
  })
})

// 選完城市 → 景點候選:查詢在 CITY_LOOKUP_LOADING_DELAY_MS 內回來就不經過查詢中;超過才顯示查詢中,且至少顯示
// CITY_LOOKUP_LOADING_MIN_MS。整段時間軸一次都不出現。用 fake timers 控制查詢回應時間與兩個門檻。
describe('選完城市 → (查詢中)→ 景點候選', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const LOADING_TITLE = '正在查詢台南的景點…'
  const CANDIDATES = [{ placeId: 'p1', name: '赤崁樓' }, { placeId: 'p2', name: '安平古堡' }]

  // searchAfter——ms 毫秒後回應(result 為 Error 時 reject)。
  function searchAfter(ms: number, result: AskPageCandidate[] | Error = CANDIDATES) {
    return vi.fn(
      () =>
        new Promise<AskPageCandidate[]>((resolve, reject) => {
          setTimeout(() => (result instanceof Error ? reject(result) : resolve(result)), ms)
        }),
    )
  }

  function openTaiwanCities(bridge: () => ReturnType<typeof useAskPageBridge<AskPageInput>>) {
    act(() => {
      void bridge().openAskPage({ country: {} })
    })
    fireEvent.click(screen.getByRole('button', { name: '台灣' }))
    expect(title()).toBe('台灣要去哪裡?')
  }

  // advance——每 10ms 推進一次並記下畫面標題(時間軸出現時記 'timeline'),回傳取樣序列。
  async function advance(ms: number, samples: string[] = []) {
    for (let t = 0; t < ms; t += 10) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(10, ms - t))
      })
      samples.push(screen.queryByTestId('timeline') ? 'timeline' : title())
    }
    return samples
  }

  it('門檻常數', () => {
    expect(CITY_LOOKUP_LOADING_DELAY_MS).toBe(150)
    expect(CITY_LOOKUP_LOADING_MIN_MS).toBe(300)
    expect(CITY_LOOKUP_TIMEOUT_MS).toBe(15_000)
  })

  it('快回應(50ms):城市頁直接換成景點候選,從未出現查詢中,時間軸也從未出現', async () => {
    const search = searchAfter(50)
    const { bridge } = renderWithBridge({ search })
    openTaiwanCities(bridge)
    timelineRenders = 0

    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    expect(title()).toBe('台灣要去哪裡?')
    const samples = await advance(600)

    expect(samples).not.toContain(LOADING_TITLE)
    expect(samples).not.toContain('timeline')
    expect(samples[samples.length - 1]).toBe('選擇感興趣的景點')
    expect(screen.getAllByRole('button', { pressed: false }).length).toBe(2)
    expect(timelineRenders).toBe(0)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('慢回應(600ms):150ms 前仍是城市頁,150ms 起顯示查詢中,查完原地換成景點候選;時間軸從未出現', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(600) })
    openTaiwanCities(bridge)
    timelineRenders = 0

    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    const samples = await advance(800)
    // 第 n 個取樣 = (n+1)*10ms。
    expect(samples.slice(0, 14).every((t) => t === '台灣要去哪裡?')).toBe(true)
    expect(samples[14]).toBe(LOADING_TITLE)
    expect(samples.slice(14, 59).every((t) => t === LOADING_TITLE)).toBe(true)
    expect(samples[59]).toBe('選擇感興趣的景點')
    expect(samples).not.toContain('timeline')
    expect(timelineRenders).toBe(0)
  })

  it('剛過門檻(200ms 回應):查詢中仍至少顯示 300ms(150ms 出現、450ms 才換成候選)', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(200) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    const samples = await advance(600)
    const shown = samples.filter((t) => t === LOADING_TITLE).length
    expect(samples[14]).toBe(LOADING_TITLE)
    expect(samples[43]).toBe(LOADING_TITLE)
    expect(samples[44]).toBe('選擇感興趣的景點')
    expect(shown * 10).toBeGreaterThanOrEqual(CITY_LOOKUP_LOADING_MIN_MS)
  })

  it('查詢中與景點候選共用同一個等待:背景的文字回覆(openAskPage)不能蓋掉它', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(600) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe(LOADING_TITLE)
    let intruder!: Promise<AskPageSelection[]>
    act(() => {
      intruder = bridge().openAskPage({ text: '背景文字' })
    })
    await expect(intruder).resolves.toEqual([])
    expect(title()).toBe(LOADING_TITLE)
    await advance(500)
    expect(title()).toBe('選擇感興趣的景點')
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
  })

  it('等待查詢中出現前的連點/改點/返回/不用了一律忽略:只查一次,城市頁不動,結果照常顯示', async () => {
    const search = searchAfter(100)
    const { bridge } = renderWithBridge({ search })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    fireEvent.click(screen.getByRole('button', { name: '台北' }))
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(title()).toBe('台灣要去哪裡?')
    await advance(50)
    fireEvent.click(screen.getByRole('button', { name: '台北' }))
    expect(title()).toBe('台灣要去哪裡?')
    await advance(300)
    expect(title()).toBe('選擇感興趣的景點')
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ id: 'taiwan-tainan' }), expect.any(AbortSignal))
  })

  it('查詢中出現前詢問頁被別的方式結束(例如打字送出新訊息):之後不再顯示查詢中、查完也不塞回候選', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(400) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(50)
    act(() => {
      bridge().handleAskPageDone([])
    })
    const samples = await advance(800)
    expect(samples.every((t) => t === 'timeline')).toBe(true)
    // 之後 LLM 開的詢問頁照常顯示(沒有殘留的等待或擋點擊的保護)。
    act(() => {
      void bridge().openAskPage({ transport: ['walk'] })
    })
    expect(title()).toBe('這段要怎麼移動?')
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
  })

  it('查詢中顯示後詢問頁被別的方式結束:查完不再塞回候選', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(600) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe(LOADING_TITLE)
    act(() => {
      bridge().handleAskPageDone([])
    })
    const samples = await advance(800)
    expect(samples.every((t) => t === 'timeline')).toBe(true)
  })

  it.each([
    ['快速失敗(50ms)', 50, new Error('network down')],
    ['快速無結果(50ms)', 50, []],
    ['慢速失敗(600ms)', 600, new Error('network down')],
    ['慢速無結果(600ms)', 600, []],
  ] as const)('%s:維持原本行為——不開景點選單,收起詢問頁回到時間軸', async (_label, ms, result) => {
    const { bridge } = renderWithBridge({ search: searchAfter(ms, result as AskPageCandidate[] | Error) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    const samples = await advance(1000)
    expect(samples[samples.length - 1]).toBe('timeline')
    expect(screen.queryByText('選擇感興趣的景點')).toBeNull()
    // 不殘留等待:之後的詢問頁照常顯示。
    act(() => {
      void bridge().openAskPage({ transport: ['walk'] })
    })
    expect(title()).toBe('這段要怎麼移動?')
  })

  // searchAbortable——ms 毫秒後回應,並記下收到的 AbortSignal(檢查關閉/逾時有沒有中止請求)。
  function searchAbortable(ms: number, result: AskPageCandidate[] = CANDIDATES) {
    const signals: AbortSignal[] = []
    const fn = vi.fn(
      (_city: TravelCity, signal: AbortSignal) =>
        new Promise<AskPageCandidate[]>((resolve) => {
          signals.push(signal)
          setTimeout(() => resolve(result), ms)
        }),
    )
    return { fn, signals }
  }

  it('查詢中右上角有關閉鈕(不用了):點了詢問頁收起、中止查詢,晚到的結果不塞回', async () => {
    const { fn, signals } = searchAbortable(2000)
    const { bridge } = renderWithBridge({ search: fn })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe(LOADING_TITLE)
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(signals[0].aborted).toBe(true)
    const samples = await advance(2500)
    expect(samples.every((t) => t === 'timeline')).toBe(true)
    // 不殘留等待:之後 LLM 開的詢問頁照常顯示。
    act(() => {
      void bridge().openAskPage({ transport: ['walk'] })
    })
    expect(title()).toBe('這段要怎麼移動?')
  })

  it('查詢中關閉:不把剛記下的城市選擇覆寫成「景點一個都沒選」', async () => {
    const { bridge, selection } = renderWithBridge({ search: searchAfter(2000) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(selection()).toMatchObject({ kind: 'region', items: [{ value: 'taiwan-tainan', name: '台南' }] })
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(selection()).toMatchObject({ kind: 'region', items: [{ value: 'taiwan-tainan', name: '台南' }] })
  })

  it('景點候選頁關閉:同樣不覆寫城市選擇;真的選了景點才寫入', async () => {
    const { bridge, selection } = renderWithBridge({ search: searchAfter(50) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe('選擇感興趣的景點')
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(selection()).toMatchObject({ kind: 'region', items: [{ value: 'taiwan-tainan' }] })

    act(() => {
      void bridge().openAskPage({ candidates: [{ placeId: 'p1', name: '赤崁樓' }] })
    })
    await advance(20)
    fireEvent.click(screen.getByRole('button', { name: /赤崁樓/ }))
    fireEvent.click(screen.getByRole('button', { name: /確認選擇/ }))
    expect(selection()).toMatchObject({ kind: 'attractions', items: [{ placeId: 'p1', name: '赤崁樓' }] })
  })

  it(`逾時(${CITY_LOOKUP_TIMEOUT_MS}ms 未回):視同無結果收起詢問頁回到時間軸,並中止請求`, async () => {
    const { fn, signals } = searchAbortable(CITY_LOOKUP_TIMEOUT_MS + 5000)
    const { bridge } = renderWithBridge({ search: fn })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe(LOADING_TITLE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CITY_LOOKUP_TIMEOUT_MS - 200 - 20)
    })
    expect(title()).toBe(LOADING_TITLE)
    expect(signals[0].aborted).toBe(false)
    await advance(40)
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(signals[0].aborted).toBe(true)
  })

  it('逾時後晚到的回應被忽略:不塞回候選,也不蓋掉之後開的詢問頁', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(CITY_LOOKUP_TIMEOUT_MS + 3000) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CITY_LOOKUP_TIMEOUT_MS + 10)
    })
    expect(screen.getByTestId('timeline')).toBeTruthy()
    act(() => {
      void bridge().openAskPage({ transport: ['walk'] })
    })
    expect(title()).toBe('這段要怎麼移動?')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(title()).toBe('這段要怎麼移動?')
    expect(screen.queryByText('選擇感興趣的景點')).toBeNull()
  })

  it('快回應不受逾時影響:候選照常顯示,之後過了逾時時間也不會被收起', async () => {
    const { fn, signals } = searchAbortable(50)
    const { bridge } = renderWithBridge({ search: fn })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe('選擇感興趣的景點')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CITY_LOOKUP_TIMEOUT_MS + 1000)
    })
    expect(title()).toBe('選擇感興趣的景點')
    expect(signals[0].aborted).toBe(false)
  })

  // 2026-10:景點候選頁(含查詢中)由城市頁選完城市進來時可以返回城市頁(replaceAskPage 原地換回,不結束等待)。
  it('候選頁有返回鈕:點了回到城市頁(方向 back),城市頁自己的返回仍可回國家頁', async () => {
    const { container, bridge } = renderWithBridge({ search: searchAfter(50) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe('選擇感興趣的景點')
    expect(direction(container)).toBe('forward')
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(title()).toBe('台灣要去哪裡?')
    expect(direction(container)).toBe('back')
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(title()).toBe('要去哪個國家?')
  })

  it('查詢中可以返回:回城市頁、中止查詢,晚到的結果與 300ms 最短顯示計時都不會把候選塞回', async () => {
    const { fn, signals } = searchAbortable(2000)
    const { bridge } = renderWithBridge({ search: fn })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    expect(title()).toBe(LOADING_TITLE)
    expect(screen.getByRole('button', { name: '不用了' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    expect(title()).toBe('台灣要去哪裡?')
    expect(signals[0].aborted).toBe(true)
    const samples = await advance(2500)
    expect(samples.every((t) => t === '台灣要去哪裡?')).toBe(true)
  })

  it('查詢早已回來、查詢中最短顯示還沒到就返回:最短顯示到期時不把候選塞回', async () => {
    const { bridge } = renderWithBridge({ search: searchAfter(200) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(250)
    expect(title()).toBe(LOADING_TITLE)
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    const samples = await advance(600)
    expect(samples.every((t) => t === '台灣要去哪裡?')).toBe(true)
  })

  it('返回後再選另一個城市:重新查詢、重新進候選頁,只有一個等待', async () => {
    const search = searchAfter(50)
    const { bridge } = renderWithBridge({ search })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    const idOnCity = bridge().pendingId()
    expect(idOnCity).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '台北' }))
    await advance(200)
    expect(title()).toBe('選擇感興趣的景點')
    expect(search).toHaveBeenCalledTimes(2)
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'taiwan-taipei' }), expect.any(AbortSignal))
    // 不殘留等待:關閉後詢問頁收起,之後的詢問頁照常顯示。
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(bridge().pendingId()).toBeNull()
  })

  it('返回城市頁後按關閉:不寫成「景點一個都沒選」', async () => {
    const { bridge, selection } = renderWithBridge({ search: searchAfter(50) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    await advance(200)
    fireEvent.click(screen.getByRole('button', { name: '返回上一層' }))
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(selection()?.kind).not.toBe('attractions')
  })

  it('LLM 直接 open_ask_page 開的候選頁、explore:沒有返回鈕', async () => {
    const { bridge } = renderWithBridge()
    act(() => {
      void bridge().openAskPage({ candidates: [{ placeId: 'p1', name: '赤崁樓' }] })
    })
    expect(screen.queryByRole('button', { name: '返回上一層' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    act(() => {
      void bridge().openAskPage({ explore: { destination: '台南' } })
    })
    await advance(20)
    expect(screen.queryByRole('button', { name: '返回上一層' })).toBeNull()
  })

  it('卸載後計時器不再動作(不在卸載後改狀態)', async () => {
    const { bridge, unmount } = renderWithBridge({ search: searchAfter(600) })
    openTaiwanCities(bridge)
    fireEvent.click(screen.getByRole('button', { name: '台南' }))
    unmount()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  })
})

describe('輸入匡說明(詢問頁開著時直接用下方輸入匡回答)', () => {
  // 回傳包一層物件:直接回傳 Promise 的話呼叫端 await 會等到它 resolve(也就是詢問頁結束)才繼續。
  function openCandidates(bridge: () => ReturnType<typeof useAskPageBridge<AskPageInput>>) {
    let pending!: Promise<AskPageSelection[]>
    act(() => {
      pending = bridge().openAskPage({ candidates: [{ placeId: 'p1', name: '赤崁樓' }] })
    })
    return { pending }
  }
  function input(): HTMLInputElement {
    return screen.getByRole('textbox', { name: '輸入指令' }) as HTMLInputElement
  }
  function typeAndSubmit(text: string) {
    fireEvent.change(input(), { target: { value: text } })
    fireEvent.submit(input().closest('form')!)
  }

  it('候選頁不再有「我要直接說明」按鈕;輸入匡提示改成詢問頁文案', () => {
    const { bridge } = renderWithBridge({ composer: true })
    expect(input().placeholder).toBe('請輸入想去的地方')
    openCandidates(bridge)
    expect(screen.queryByRole('button', { name: '我要直接說明' })).toBeNull()
    expect(input().placeholder).toBe('或直接說明想去哪')
  })

  it('推論中(LLM 開的候選頁在等使用者):輸入匡不鎖、送出鈕不是停止;沒有詢問頁時推論中鎖住', () => {
    const { bridge } = renderWithBridge({ composer: true, isThinking: true })
    expect(input().disabled).toBe(true)
    expect(input().placeholder).toBe('AI 思考中…')
    openCandidates(bridge)
    expect(input().disabled).toBe(false)
    expect(screen.getByRole('button', { name: '送出' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
  })

  it('送出:詢問頁關閉(等待中的工具呼叫以空陣列 resolve),去前後空白的文字走 sendPrompt,輸入匡清空', async () => {
    const sendPrompt = vi.fn(async () => true)
    const { bridge } = renderWithBridge({ composer: true, sendPrompt })
    const { pending } = openCandidates(bridge)
    await act(async () => {
      typeAndSubmit('  想看古蹟和老街  ')
    })
    await expect(pending).resolves.toEqual([])
    expect(screen.getByTestId('timeline')).toBeTruthy()
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(sendPrompt).toHaveBeenCalledWith('想看古蹟和老街')
    expect(input().value).toBe('')
  })

  it('國家頁、交通頁也一樣:輸入匡送出結束等待並送出文字', async () => {
    const sendPrompt = vi.fn(async () => true)
    const { bridge } = renderWithBridge({ composer: true, sendPrompt })
    let pending!: Promise<AskPageSelection[]>
    act(() => {
      pending = bridge().openAskPage({ country: {} })
    })
    expect(input().placeholder).toBe('或直接輸入國家')
    await act(async () => {
      typeAndSubmit('義大利')
    })
    await expect(pending).resolves.toEqual([])
    expect(sendPrompt).toHaveBeenCalledWith('義大利')
  })

  it('空白不送出,詢問頁維持開著', async () => {
    const sendPrompt = vi.fn(async () => true)
    const { bridge } = renderWithBridge({ composer: true, sendPrompt })
    openCandidates(bridge)
    await act(async () => {
      typeAndSubmit('   ')
    })
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(title()).toBe('要安排這些地點嗎?')
  })

  it('推論中(sendPrompt 會被擋):先關閉詢問頁、記下文字,這一輪推論結束後自動送出', async () => {
    const sendPrompt = vi.fn(async () => true)
    let bridge!: ReturnType<typeof useAskPageBridge<AskPageInput>>
    const { rerender } = render(<Harness composer sendPrompt={sendPrompt} isThinking onBridge={(b) => { bridge = b }} />)
    const { pending } = openCandidates(() => bridge)
    await act(async () => {
      typeAndSubmit('想看古蹟和老街')
    })
    await expect(pending).resolves.toEqual([])
    expect(sendPrompt).not.toHaveBeenCalled()
    // 詢問頁關了、推論仍在進行:回到一般的推論中鎖定。
    expect(input().disabled).toBe(true)
    await act(async () => {
      rerender(<Harness composer sendPrompt={sendPrompt} isThinking={false} onBridge={(b) => { bridge = b }} />)
    })
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(sendPrompt).toHaveBeenCalledWith('想看古蹟和老街')
  })

  it('沒送出去(後端拒絕/網路錯誤):文字放回輸入匡', async () => {
    const onAskPageTextNotSent = vi.fn()
    const { bridge } = renderWithBridge({ composer: true, sendPrompt: async () => false, onAskPageTextNotSent })
    openCandidates(bridge)
    await act(async () => {
      typeAndSubmit('想看古蹟和老街')
    })
    expect(onAskPageTextNotSent).toHaveBeenCalledWith('想看古蹟和老街')
    expect(input().value).toBe('想看古蹟和老街')
  })

  it('查詢中:推論中維持鎖住(不算等待使用者),提示為查詢中', async () => {
    const { bridge } = renderWithBridge({ composer: true, isThinking: true })
    act(() => {
      void bridge().openAskPage({ candidates: [], reason: '正在查詢台南的景點…', loading: true })
    })
    expect(input().disabled).toBe(true)
    expect(input().placeholder).toBe('景點查詢中…')
  })
})
