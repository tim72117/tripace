// HorizontalPlanTimeline 的時間尺(.ruler)在不同尺度下的寬度/數量契約。
//
// jsdom 不計算真實版面(不會跑 layout engine,量不出像素位置),所以這裡
// 驗證的是「inline style 裡算出來的 left/width 百分比數值」與「DOM 節點
// 數量」是否符合預期的計算邏輯,不是實際渲染後的像素位置——那類問題
// (例如 2026-10 實際發生過的:position: relative 元素的 top/bottom 不會
// 撐開高度,導致子元素視覺上完全消失)本質上要靠瀏覽器端量測或肉眼才能
// 抓到,這份測試的目的是防止「寬度/數量計算邏輯」本身的回歸,不是取代
// 實機檢查。
//
// zoom in(單日 24 小時範圍,isGenerating=false)與 zoom out(跨天總覽,
// isGenerating=true 或推論過一次之後永久維持,見 showZoomOut 的完整
// 說明)是兩條完全獨立的渲染路徑,分開測試。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import type { PlanNode } from '../../plan-core/planTimeline'

function stopNode(overrides: Partial<PlanNode> & { id: string }): PlanNode {
  return {
    type: 'stop',
    prevId: null,
    nextId: null,
    ...overrides,
  }
}

const noop = () => {}

describe('HorizontalPlanTimeline 時間尺寬度/數量契約', () => {
  describe('zoom in(單日 24 小時範圍)', () => {
    it('單一站點的 .rulerSegment 依時間比例算出 left/width(相對 24 小時)', () => {
      // 09:00 開始、時長 60 分鐘(09:00 ~ 10:00):
      // left = 09:00 的分鐘數 / (24*60) = 540/1440 = 37.5%
      // width = 60 / 1440 ≈ 4.1667%
      const steps: PlanNode[] = [
        stopNode({ id: 's1', time: '09:00', duration: '停留 1h', day: 1 }),
      ]
      const { container } = render(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId={null}
          onSelectStop={noop}
          onOpenPhotos={noop}
        />,
      )
      const segment = container.querySelector('[class*="rulerSegment"]') as HTMLElement
      expect(segment).not.toBeNull()
      expect(segment.style.left).toBe('37.5%')
      expect(Number.parseFloat(segment.style.width)).toBeCloseTo(100 / 24, 2)
    })

    it('只渲染 currentDay 當天的 .rulerSegment,不混進其他天的站點', () => {
      const steps: PlanNode[] = [
        stopNode({ id: 'd1-a', time: '09:00', duration: '停留 1h', day: 1 }),
        stopNode({ id: 'd2-a', time: '09:00', duration: '停留 1h', day: 2 }),
      ]
      const { container } = render(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId="d2-a"
          onSelectStop={noop}
          onOpenPhotos={noop}
        />,
      )
      // 選中 day 2 的站點,currentDay 應該跟著是 2,只渲染一條軌道、
      // 一個 segment(d2-a 的),不會同時看到 d1-a。用 aria-label 前綴
      // (.rulerSegment 固定是「跳到 X」)而不是 class 選擇器——
      // [class*="rulerSegment"] 會連 .rulerSegmentTime(選中站點時額外
      // 浮出的時間標籤 <span>,同樣包含 rulerSegment 這個子字串)一起
      // 選到,選中狀態下會多算一個節點,不是真的多了一個 segment。
      const segments = container.querySelectorAll('button[aria-label^="跳到"]')
      expect(segments).toHaveLength(1)
    })
  })

  // 2026-10 使用者明確要求「先不做 zoom out」:功能本身用
  // HorizontalPlanTimeline.tsx 檔案頂部的 ZOOM_OUT_ENABLED 開關關閉
  // (目前 false),.ruler 永遠走 zoom in 分支,這裡描述的「推論時顯示
  // 跨天總覽」行為目前不成立。測試邏輯本身沒有錯,保留不刪(重新啟用
  // 時這些測試仍然是有效的回歸保護),改用 describe.skip 標記——留著
  // 讓它們一直紅燈會汙染測試套件的訊號,之後真正的回歸會被淹沒在
  // 「反正本來就是紅的」裡。重新啟用 ZOOM_OUT_ENABLED 時記得把這裡
  // 的 .skip 拿掉。
  describe.skip('zoom out(跨天總覽,isGenerating 觸發後永久維持)', () => {
    it('isGenerating 為 true 時,.rulerOverviewSegment 依總天數等寬均分(不佔用 .rulerSegment)', () => {
      const steps: PlanNode[] = [
        stopNode({ id: 'd1-a', time: '09:00', duration: '停留 1h', day: 1 }),
        stopNode({ id: 'd2-a', time: '09:00', duration: '停留 1h', day: 2 }),
        stopNode({ id: 'd3-a', time: '09:00', duration: '停留 1h', day: 3 }),
      ]
      const { container } = render(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId="d1-a"
          onSelectStop={noop}
          onOpenPhotos={noop}
          isGenerating
        />,
      )
      // 3 天 → 每段均分 1/3 寬度,不管每天實際安排了幾站。
      const overviewSegments = container.querySelectorAll('[class*="rulerOverviewSegment"]')
      expect(overviewSegments).toHaveLength(3)
      const widths = Array.from(overviewSegments).map(
        (el) => Number.parseFloat((el as HTMLElement).style.width),
      )
      for (const w of widths) {
        expect(w).toBeCloseTo(100 / 3, 2)
      }
      // zoom out 分支不應該渲染 zoom in 專用的 .rulerSegment。
      expect(container.querySelectorAll('[class*="rulerSegment"]:not([class*="rulerOverviewSegment"])')).toHaveLength(0)
    })

    it('.rulerOverviewDot 數量等於當天站點數,且等寬切分段落內部空間', () => {
      const steps: PlanNode[] = [
        stopNode({ id: 'd1-a', time: '09:00', duration: '停留 1h', day: 1 }),
        stopNode({ id: 'd1-b', time: '11:00', duration: '停留 1h', day: 1 }),
        stopNode({ id: 'd1-c', time: '14:00', duration: '停留 1h', day: 1 }),
        stopNode({ id: 'd2-a', time: '09:00', duration: '停留 1h', day: 2 }),
      ]
      const { container } = render(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId="d1-a"
          onSelectStop={noop}
          onOpenPhotos={noop}
          isGenerating
        />,
      )
      const overviewSegments = Array.from(
        container.querySelectorAll('[class*="rulerOverviewSegment"]'),
      ) as HTMLElement[]
      expect(overviewSegments).toHaveLength(2)

      const [day1Segment, day2Segment] = overviewSegments
      const day1Dots = day1Segment.querySelectorAll('[class*="rulerOverviewDot"]')
      const day2Dots = day2Segment.querySelectorAll('[class*="rulerOverviewDot"]')
      expect(day1Dots).toHaveLength(3)
      expect(day2Dots).toHaveLength(1)

      // day1 有 3 站,每個 dot 應該各佔段落內部 1/3 寬度,left 依序是
      // 0%、33.33%、66.67%。
      const day1Widths = Array.from(day1Dots).map(
        (el) => Number.parseFloat((el as HTMLElement).style.width),
      )
      for (const w of day1Widths) {
        expect(w).toBeCloseTo(100 / 3, 2)
      }
      const day1Lefts = Array.from(day1Dots).map(
        (el) => Number.parseFloat((el as HTMLElement).style.left),
      )
      expect(day1Lefts[0]).toBeCloseTo(0, 2)
      expect(day1Lefts[1]).toBeCloseTo(100 / 3, 2)
      expect(day1Lefts[2]).toBeCloseTo(200 / 3, 2)

      // day2 只有 1 站,應該獨佔整段寬度(100%),left 是 0%。
      const day2Dot = day2Dots[0] as HTMLElement
      expect(Number.parseFloat(day2Dot.style.width)).toBeCloseTo(100, 2)
      expect(Number.parseFloat(day2Dot.style.left)).toBeCloseTo(0, 2)
    })

    it('isGenerating 轉回 false 後仍然維持 zoom out,不自動切回 zoom in(showZoomOut 永久鎖定)', () => {
      const steps: PlanNode[] = [
        stopNode({ id: 'd1-a', time: '09:00', duration: '停留 1h', day: 1 }),
      ]
      const { container, rerender } = render(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId="d1-a"
          onSelectStop={noop}
          onOpenPhotos={noop}
          isGenerating
        />,
      )
      expect(container.querySelectorAll('[class*="rulerOverviewSegment"]')).toHaveLength(1)

      rerender(
        <HorizontalPlanTimeline
          steps={steps}
          selectedStopId="d1-a"
          onSelectStop={noop}
          onOpenPhotos={noop}
          isGenerating={false}
        />,
      )
      // 推論結束(isGenerating 轉 false)後,使用者明確要求「不自動
      // zoom in」——總覽軌道應該仍然存在,.rulerSegment(zoom in 專用)
      // 不應該出現。
      expect(container.querySelectorAll('[class*="rulerOverviewSegment"]')).toHaveLength(1)
      expect(container.querySelectorAll('[class*="rulerSegment"]:not([class*="rulerOverviewSegment"])')).toHaveLength(0)
    })
  })
})
