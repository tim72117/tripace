import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Rect } from '../member/phone/layoutDebugGeometry'

// debugOverlayParts——兩邊除錯疊圖(開發工具,?debugSafeArea=1 開啟)共用的繪製零件。
//
// /ai-plan 的 SafeAreaDebugOverlay、WideLayoutDebugOverlay 與登入後的 PlanLayoutDebugOverlay 都要
// 畫「虛線框、標籤膠囊、圓點」標出實際範圍,原本各自把同一組樣式(2px 虛線、padding 2px 6px、圓角 4、
// 等寬 11px 粗體、16px 白邊圓點)寫了好幾遍(Wide 一個檔案就寫了四次),現在收在這裡。
// 兩邊畫的內容不同(一邊依常數算預期範圍、一邊量 DOM 實際範圍),所以只共用零件,不共用疊圖本身。

export const DEBUG_LABEL_FONT = '600 11px/1.4 ui-monospace, monospace'

export function debugFrameStyle(color: string): CSSProperties {
  return { border: `2px dashed ${color}`, boxSizing: 'border-box' }
}

// 標籤膠囊(不含定位):底色、文字色(預設白)、等寬粗體。
export function debugLabelStyle(color: string, textColor = '#fff'): CSSProperties {
  return {
    padding: '2px 6px',
    borderRadius: 4,
    background: color,
    color: textColor,
    font: DEBUG_LABEL_FONT,
    whiteSpace: 'nowrap',
  }
}

// 16px 圓點,中心對準 p。
export function debugDotStyle(p: { x: number; y: number }, color: string): CSSProperties {
  return {
    position: 'absolute',
    left: p.x,
    top: p.y,
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: '50%',
    background: color,
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,.5)',
  }
}

export function DebugFrame({ box, color, label }: { box: Rect; color: string; label: string }) {
  return (
    <>
      <div style={{ position: 'absolute', top: box.top, left: box.left, width: box.width, height: box.height, ...debugFrameStyle(color) }} />
      <div style={{ position: 'absolute', top: box.top + 4, left: box.left + 4, ...debugLabelStyle(color) }}>
        {label} {Math.round(box.width)}×{Math.round(box.height)}
      </div>
    </>
  )
}

export function DebugDot({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) {
  return (
    <>
      <div style={debugDotStyle(p, color)} />
      <div style={{ position: 'absolute', left: p.x + 12, top: p.y - 8, ...debugLabelStyle(color) }}>
        {label} {p.x.toFixed(0)},{p.y.toFixed(0)}
      </div>
    </>
  )
}

export function rectOf(el: Element | null | undefined): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

// 換成相對於原點(例如疊加層左上角)的位置。
export function rel(r: Rect | null, origin: Rect): Rect | null {
  return r ? { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height } : null
}

// useMeasureOnLayoutChange——除錯疊圖共用的「量測並隨版面變化重量」骨架(2026-10 從 phone/、desktop/ 兩份
// PlanLayoutDebugOverlay 各一份相同的程式抽出):掛載時量一次;之後 overlay 與傳入的元素尺寸改變(ResizeObserver)、
// overlay 的父層底下 DOM 結構改變(MutationObserver,時間軸卡片出現/消失、地圖容器掛載不一定觸發尺寸事件)、視窗縮放
// (resize)時重量。update 放 ref——呼叫端每次 render 都會是新的函式,不該讓觀察器每次 render 重建(update 會 setState,
// 重建會形成迴圈);觀察器只在 overlayEl 或 els 內的元素換了才重建。els 的長度在同一個呼叫端必須固定。
export function useMeasureOnLayoutChange(
  overlayEl: HTMLElement | null,
  els: (Element | null)[],
  update: () => void,
) {
  const updateRef = useRef(update)
  updateRef.current = update
  useLayoutEffect(() => {
    if (!overlayEl) return
    const run = () => updateRef.current()
    run()
    const ro = new ResizeObserver(run)
    ;[overlayEl, overlayEl.parentElement, ...els].forEach((el) => el && ro.observe(el))
    const mo = new MutationObserver(run)
    mo.observe(overlayEl.parentElement ?? overlayEl, { childList: true, subtree: true })
    window.addEventListener('resize', run)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', run)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayEl, ...els])
}
