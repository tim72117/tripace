// PlanPhoneListDrawer 的 forceCollapsed prop——驗證使用者明確要求
// 的「前一層(資訊卡)比後層(清單)高時,往下拉後層也要跟著往下」這個
// 堆疊互動:PlanPhoneView.tsx 把資訊卡的 onDraggingDownChange 訊號
// 轉成 forceCollapsed 傳給這個元件,forceCollapsed 為 true 時清單應該
// 強制縮到最小段(索引 0),變回 false 時恢復成使用者原本停留的段落。
//
// mock 掉 PhoneBottomSheet(這個測試不驗證真實觸控拖曳手勢,那是
// PhoneBottomSheet 自己的職責——只驗證 PlanPhoneListDrawer 依
// forceCollapsed 算出來的 activeSnapIndex 是否正確),直接捕捉傳入的
// activeSnapIndex/onSnapIndexChange 供測試斷言與模擬使用者拖曳。
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { PlanPhoneListDrawer } from './PlanPhoneListDrawer'
import type { ClientConfig, GeoSearchResult } from '../api'

let capturedActiveSnapIndex: number | undefined
let capturedOnSnapIndexChange: ((index: number) => void) | undefined

// StackedSheet——2026-10 改名(PlanPhoneListDrawer.tsx 原本直接
// 呼叫 PhoneBottomSheet,改用具名工廠元件,見該元件的完整說明),mock 要
// 跟著換成攔截這個新名字,否則測試會噴「StackedSheet 沒有被 mock 返回」
// 的錯誤。SheetBody 這裡不需要特別處理邏輯,直接原樣渲染 children 即可
// ——這個測試只關心 activeSnapIndex/onSnapIndexChange 怎麼被
// PlanPhoneListDrawer 算出來,不驗證真實觸控手勢(那是
// PhoneBottomSheet/SheetBody 自己的職責)。
vi.mock('../components/PhoneBottomSheet', () => ({
  StackedSheet: (props: { activeSnapIndex?: number; onSnapIndexChange?: (index: number) => void; children: React.ReactNode }) => {
    capturedActiveSnapIndex = props.activeSnapIndex
    capturedOnSnapIndexChange = props.onSnapIndexChange
    return <div>{props.children}</div>
  },
  SheetBody: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
  SheetHead: () => null,
}))

const cfg: ClientConfig = { baseURL: 'http://localhost', token: 'test-token' }
const results: GeoSearchResult[] = []

function renderDrawer(forceCollapsed: boolean) {
  return render(
    <PlanPhoneListDrawer
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

describe('PlanPhoneListDrawer：forceCollapsed 強制收合', () => {
  it('掛載時預設展開(索引 1)——forceCollapsed 未傳入時的既有行為不受影響', () => {
    renderDrawer(false)
    expect(capturedActiveSnapIndex).toBe(1)
  })

  it('forceCollapsed 從 false 變 true:強制切到最小段(索引 0)', () => {
    const { rerender } = render(
      <PlanPhoneListDrawer
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
      <PlanPhoneListDrawer
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
      <PlanPhoneListDrawer
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
      <PlanPhoneListDrawer
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
      <PlanPhoneListDrawer
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
