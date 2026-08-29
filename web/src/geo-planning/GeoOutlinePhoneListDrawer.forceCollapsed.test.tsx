// GeoOutlinePhoneListDrawer 的 forceCollapsed prop——驗證使用者明確要求
// 的「前一層(資訊卡)比後層(清單)高時,往下拉後層也要跟著往下」這個
// 堆疊互動:GeoOutlinePhoneView.tsx 把資訊卡的 onDraggingDownChange 訊號
// 轉成 forceCollapsed 傳給這個元件,forceCollapsed 為 true 時清單應該
// 強制縮到最小段(索引 0),變回 false 時恢復成使用者原本停留的段落。
//
// mock 掉 PhoneBottomSheet(這個測試不驗證真實觸控拖曳手勢,那是
// PhoneBottomSheet 自己的職責——只驗證 GeoOutlinePhoneListDrawer 依
// forceCollapsed 算出來的 activeSnapIndex 是否正確),直接捕捉傳入的
// activeSnapIndex/onSnapIndexChange 供測試斷言與模擬使用者拖曳。
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { GeoOutlinePhoneListDrawer } from './GeoOutlinePhoneListDrawer'
import type { ClientConfig, GeoSearchResult } from '../api'

let capturedActiveSnapIndex: number | undefined
let capturedOnSnapIndexChange: ((index: number) => void) | undefined

vi.mock('../components/PhoneBottomSheet', () => ({
  PhoneBottomSheet: (props: { activeSnapIndex?: number; onSnapIndexChange?: (index: number) => void; children: React.ReactNode }) => {
    capturedActiveSnapIndex = props.activeSnapIndex
    capturedOnSnapIndexChange = props.onSnapIndexChange
    return <div>{props.children}</div>
  },
  PHONE_BOTTOM_SHEET_EXIT_MS: 350,
  SheetHead: () => null,
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const results: GeoSearchResult[] = []

function renderDrawer(forceCollapsed: boolean) {
  return render(
    <GeoOutlinePhoneListDrawer
      cfg={cfg}
      tripID="trip_1"
      open={true}
      onClose={() => {}}
      results={results}
      selectedKey={null}
      candidateKeys={new Set()}
      scheduledDates={[]}
      onSelect={() => {}}
      onAddCandidate={() => {}}
      onCandidateCreated={() => {}}
      forceCollapsed={forceCollapsed}
    />,
  )
}

describe('GeoOutlinePhoneListDrawer：forceCollapsed 強制收合', () => {
  it('掛載時預設展開(索引 1)——forceCollapsed 未傳入時的既有行為不受影響', () => {
    renderDrawer(false)
    expect(capturedActiveSnapIndex).toBe(1)
  })

  it('forceCollapsed 從 false 變 true:強制切到最小段(索引 0)', () => {
    const { rerender } = render(
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID="trip_1"
        open={true}
        onClose={() => {}}
        results={results}
        selectedKey={null}
        candidateKeys={new Set()}
        scheduledDates={[]}
        onSelect={() => {}}
        onAddCandidate={() => {}}
        onCandidateCreated={() => {}}
        forceCollapsed={false}
      />,
    )
    expect(capturedActiveSnapIndex).toBe(1)

    rerender(
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID="trip_1"
        open={true}
        onClose={() => {}}
        results={results}
        selectedKey={null}
        candidateKeys={new Set()}
        scheduledDates={[]}
        onSelect={() => {}}
        onAddCandidate={() => {}}
        onCandidateCreated={() => {}}
        forceCollapsed={true}
      />,
    )
    expect(capturedActiveSnapIndex).toBe(0)
  })

  it('forceCollapsed 從 true 變回 false:恢復成強制收合前使用者原本停留的段落', () => {
    const { rerender } = render(
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID="trip_1"
        open={true}
        onClose={() => {}}
        results={results}
        selectedKey={null}
        candidateKeys={new Set()}
        scheduledDates={[]}
        onSelect={() => {}}
        onAddCandidate={() => {}}
        onCandidateCreated={() => {}}
        forceCollapsed={false}
      />,
    )
    // 模擬使用者拖曳到最展開的段(索引 2)——比照 PhoneBottomSheet 真實
    // 拖曳鬆手後呼叫 onSnapIndexChange 的既有行為。
    act(() => capturedOnSnapIndexChange!(2))
    expect(capturedActiveSnapIndex).toBe(2)

    rerender(
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID="trip_1"
        open={true}
        onClose={() => {}}
        results={results}
        selectedKey={null}
        candidateKeys={new Set()}
        scheduledDates={[]}
        onSelect={() => {}}
        onAddCandidate={() => {}}
        onCandidateCreated={() => {}}
        forceCollapsed={true}
      />,
    )
    expect(capturedActiveSnapIndex).toBe(0)

    rerender(
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID="trip_1"
        open={true}
        onClose={() => {}}
        results={results}
        selectedKey={null}
        candidateKeys={new Set()}
        scheduledDates={[]}
        onSelect={() => {}}
        onAddCandidate={() => {}}
        onCandidateCreated={() => {}}
        forceCollapsed={false}
      />,
    )
    // 恢復成強制收合前的段落(索引 2),不是重設回預設值(索引 1)。
    expect(capturedActiveSnapIndex).toBe(2)
  })
})
