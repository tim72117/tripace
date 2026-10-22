// debugOverlayParts:兩邊除錯疊圖(/ai-plan 的 SafeAreaDebugOverlay、WideLayoutDebugOverlay,登入後的
// PlanLayoutDebugOverlay)共用的繪製零件:虛線框、標籤膠囊、圓點,以及量範圍的小工具。
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  DEBUG_LABEL_FONT,
  DebugDot,
  DebugFrame,
  debugDotStyle,
  debugFrameStyle,
  debugLabelStyle,
  rectOf,
  rel,
} from './debugOverlayParts'

describe('樣式 helper', () => {
  it('debugFrameStyle:2px 虛線框,boxSizing 為 border-box', () => {
    expect(debugFrameStyle('#a855f7')).toEqual({ border: '2px dashed #a855f7', boxSizing: 'border-box' })
  })

  it('debugLabelStyle:標籤膠囊(底色、白字、等寬 11px 粗體、不換行);文字色可改', () => {
    expect(debugLabelStyle('#ef4444')).toEqual({
      padding: '2px 6px',
      borderRadius: 4,
      background: '#ef4444',
      color: '#fff',
      font: DEBUG_LABEL_FONT,
      whiteSpace: 'nowrap',
    })
    expect(debugLabelStyle('#eab308', '#1c1815').color).toBe('#1c1815')
    expect(DEBUG_LABEL_FONT).toBe('600 11px/1.4 ui-monospace, monospace')
  })

  it('debugDotStyle:16px 圓點,中心對準座標,白邊', () => {
    const st = debugDotStyle({ x: 30, y: 40 }, '#16a34a')
    expect(st).toMatchObject({
      position: 'absolute',
      left: 30,
      top: 40,
      width: 16,
      height: 16,
      marginLeft: -8,
      marginTop: -8,
      borderRadius: '50%',
      background: '#16a34a',
      border: '2px solid #fff',
    })
  })
})

describe('DebugFrame', () => {
  it('畫一個虛線框(位置與大小照 box),並在左上角貼標籤「名稱 寬×高」', () => {
    const { container } = render(<DebugFrame box={{ top: 10, left: 20, width: 100.4, height: 50.6 }} color="#3b82f6" label="overlay" />)
    const [frame, label] = Array.from(container.children) as HTMLElement[]
    expect(frame.style.top).toBe('10px')
    expect(frame.style.left).toBe('20px')
    expect(frame.style.width).toBe('100.4px')
    expect(frame.style.border).toContain('dashed')
    expect(label.textContent).toBe('overlay 100×51')
    expect(label.style.top).toBe('14px')
    expect(label.style.left).toBe('24px')
  })
})

describe('DebugDot', () => {
  it('畫圓點,旁邊貼標籤「名稱 x,y」', () => {
    const { container } = render(<DebugDot p={{ x: 12.4, y: 33.6 }} color="#16a34a" label="center" />)
    const [dot, label] = Array.from(container.children) as HTMLElement[]
    expect(dot.style.left).toBe('12.4px')
    expect(label.textContent).toBe('center 12,34')
    expect(label.style.left).toBe('24.4px')
    expect(label.style.top).toBe('25.6px')
  })
})

describe('rectOf / rel', () => {
  it('rectOf:沒有元素回 null;有元素回 getBoundingClientRect 的 top、left、寬、高', () => {
    expect(rectOf(null)).toBeNull()
    expect(rectOf(undefined)).toBeNull()
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ top: 5, left: 6, width: 7, height: 8 }) as DOMRect
    expect(rectOf(el)).toEqual({ top: 5, left: 6, width: 7, height: 8 })
  })

  it('rel:換成相對於原點的位置,寬高不變;沒有就回 null', () => {
    expect(rel(null, { top: 0, left: 0, width: 1, height: 1 })).toBeNull()
    expect(rel({ top: 15, left: 30, width: 4, height: 5 }, { top: 10, left: 20, width: 100, height: 100 })).toEqual({
      top: 5,
      left: 10,
      width: 4,
      height: 5,
    })
  })
})
