// PhoneBottomSheet.collapsedHeight.test.tsx——2026-10 新增(使用者實機
// 截圖回報:旅程清單/行程清單收合段被壓縮成 35px,預期 80-100px,附
// DevTools 截圖顯示 panelStyle.bottom 是 var(--tab-bar-height) 而非 0)。
//
// 根因(見 PhoneBottomSheet.tsx containerHeight/panelBottomPx/
// minHeightAsTop 宣告處的完整說明):minHeightAsTop 的計算公式原本只用
// containerHeight - minHeightPx,隱含假設 panelStyle.bottom 恆為 0——
// 呼叫端若把 bottom 設成非零值(例如 var(--tab-bar-height) 用來避開
// 底部常駐功能列),算出來的可視高度會變成 minHeightPx - bottom,不是
// 設計意圖的 minHeightPx。
//
// 第一版修法(已移除):只在輸出層對 isAtMinSnap 這個特例疊加 CSS
// height,code review 指出這只是表面補丁,容器高度不足(例如橫向模式)
// 時這個 height 可能誤套用到展開段。
// 第二版修法(這份測試驗證的版本):讓 containerHeight 的計算本身透過
// getComputedStyle(panelRef.current).bottom 讀取瀏覽器實際解析後的
// bottom px 值(不管呼叫端寫的是數字、calc()、var() 哪種格式,
// getComputedStyle 都會解析成固定的 px 字串),從源頭修正
// minHeightAsTop 的座標假設,不需要在輸出層對任何特定段落做特判——
// 這樣非收合段(若未來也遇到 bottom 非 0 的情境)同樣會被正確修正,
// 不會重蹈第一版「只堵住一個索引」的問題。
//
// jsdom 對 getComputedStyle 解析 inline style 的 bottom 屬性支援良好
// (已驗證:el.style.bottom = '64px' 後 getComputedStyle(el).bottom
// 正確回傳 "64px"),這份測試驗證的是「JS 邏輯讀到正確的 computed
// bottom 值、進而算出正確的 panelTop」,不是「瀏覽器最終繪製出來的
// 像素位置」(那仍然是只有真實瀏覽器才能完全確認的層次,但這裡至少
// 確認了從 computed style 讀值、到 panelTop 计算這整條鏈路的 JS 邏輯
// 本身是正確的)。
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render } from '@testing-library/react'
import { PhoneBottomSheet, SheetHead } from './PhoneBottomSheet'

function getPanel(container: HTMLElement) {
  const el = container.querySelector('[data-testid="phone-bottom-sheet"]')
  if (!el) throw new Error('找不到 .panel(data-testid="phone-bottom-sheet")')
  return el as HTMLElement
}

// readTopPx——從 panel 的 inline style 讀出 `top: ${panelTop}px` 目前的
// 數值(px),供測試斷言用。
function readTopPx(panel: HTMLElement): number {
  return parseFloat(panel.style.top)
}

describe('PhoneBottomSheet 收合段高度不受 panelStyle.bottom 影響（根因修正版）', () => {
  it('panelStyle.bottom 非 0(對齊 trip/PhoneTripsDrawer.tsx 用 var(--tab-bar-height) 的實際情境)：收合段 top 值會扣掉 bottom，可視高度精確等於 minHeightPx', () => {
    function Harness() {
      const [activeSnapIndex, setActiveSnapIndex] = useState(0) // 一開始就是收合段
      return (
        <PhoneBottomSheet
          open
          onClose={() => {}}
          snapPoints={[200]}
          minHeightPx={100}
          activeSnapIndex={activeSnapIndex}
          onSnapIndexChange={setActiveSnapIndex}
          // 對齊 trip/PhoneTripsDrawer.tsx 實際回報問題的寫法——bottom
          // 不是 0,是一個代表「功能列高度」的非零值。
          panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: '64px' }}
          head={<SheetHead title="旅程" onClose={() => {}} />}
        >
          <div>內容</div>
        </PhoneBottomSheet>
      )
    }
    const { container } = render(<Harness />)
    const panel = getPanel(container)
    // window.innerHeight(jsdom 預設 768) - minHeightPx(100) -
    // panelBottomPx(64,從 getComputedStyle 讀到) = 604。
    // 可視高度 = containerHeight - top - bottom = 768 - 604 - 64 = 100,
    // 精確等於 minHeightPx,不再是修法前的 100 - 64 = 36。
    expect(readTopPx(panel)).toBe(window.innerHeight - 100 - 64)
  })

  it('panelStyle.bottom 是 0（既有情境）：收合段 top 值不受影響，維持既有行為', () => {
    function Harness() {
      const [activeSnapIndex, setActiveSnapIndex] = useState(0)
      return (
        <PhoneBottomSheet
          open
          onClose={() => {}}
          snapPoints={[200]}
          minHeightPx={100}
          activeSnapIndex={activeSnapIndex}
          onSnapIndexChange={setActiveSnapIndex}
          panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          head={<SheetHead title="旅程" onClose={() => {}} />}
        >
          <div>內容</div>
        </PhoneBottomSheet>
      )
    }
    const { container } = render(<Harness />)
    const panel = getPanel(container)
    // bottom 是 0 時,panelBottomPx 讀到 0,等同修法前的既有行為——
    // top = containerHeight - minHeightPx,可視高度精確等於 minHeightPx。
    expect(readTopPx(panel)).toBe(window.innerHeight - 100)
  })

  it('bottom 非 0 且容器高度不足(橫向模式等邊界情況):minHeightAsTop 被 clamp 到不小於 snapPoints 最大值，不會算出負的可視高度', () => {
    // 模擬容器高度不足的情境:window.innerHeight 預設 768,這裡用較大的
    // snapPoints 逼近邊界(或者直接驗證 clamp 公式本身在 bottom 非 0 時
    // 仍然正確生效,不會因為多扣了 panelBottomPx 而讓 clamp 判斷錯誤)。
    function Harness() {
      const [activeSnapIndex, setActiveSnapIndex] = useState(0)
      return (
        <PhoneBottomSheet
          open
          onClose={() => {}}
          snapPoints={[700]} // 刻意設得很大,逼近 containerHeight
          minHeightPx={100}
          activeSnapIndex={activeSnapIndex}
          onSnapIndexChange={setActiveSnapIndex}
          panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: '64px' }}
          head={<SheetHead title="旅程" onClose={() => {}} />}
        >
          <div>內容</div>
        </PhoneBottomSheet>
      )
    }
    const { container } = render(<Harness />)
    const panel = getPanel(container)
    // containerHeight(768) - minHeightPx(100) - panelBottomPx(64) = 604,
    // 小於 snapPoints[0](700)——minHeightAsTop 應該被 clamp 到 700
    // (不小於 snapPoints 最大值,維持 stops 陣列遞減排序的前提),
    // 不是算出比展開段更靠外的奇怪值。
    expect(readTopPx(panel)).toBe(700)
  })
})
