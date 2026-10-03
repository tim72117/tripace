// geoAttractionOverlay.ts 的點擊目標範圍——2026-10 使用者明確要求「地圖上
// 精選點,要點文字也能打開」(原本只有圖示/圓點本身可點,文字標籤刻意不
// 綁點擊,見 renderContent() 內原本的說明)。這裡直接測這個類別本身組出的
// DOM 與綁定的事件,不透過 useAttractionOverlays hook(那是另一個檔案的
// 職責,見 useAttractionOverlays.test.tsx),也不透過完整 ExploreMap 掛載
// (成本高很多,且會混進地圖建圖等不相關邏輯)。
//
// google.maps.OverlayView 需要在呼叫 getAttractionOverlayClass() 之前就
// 存在於全域(見該函式的完整說明:extends 子句在 class 宣告當下就會被
// 求值)——這裡補一個最小可用的假實作,只需要 onAdd() 用到的
// getPanes().overlayMouseTarget,不需要 getProjection()/draw()(那是
// 另一回事,這份測試不驗證位置換算)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAttractionOverlayClass } from './geoAttractionOverlay'
import type { GeoAttraction } from '../api'

;(globalThis as { google?: unknown }).google = {
  maps: {
    OverlayView: class {
      // overlayMouseTarget 固定在建構時存一份、getPanes() 永遠回傳同一個
      // 參照——onAdd() 呼叫一次 getPanes().overlayMouseTarget.appendChild(div),
      // 測試這邊事後想撈出那個 div 時若又重新呼叫一次 getPanes() 拿到
      // 「另一個新建的空 div」,appendChild 當初塞的內容自然無從得知。
      overlayMouseTarget = document.createElement('div')
      getPanes() {
        return { overlayMouseTarget: this.overlayMouseTarget }
      }
      getProjection() {
        return null
      }
    },
  },
}

function attraction(overrides: Partial<GeoAttraction> & { name: string }): GeoAttraction {
  return { isTheme: false, lat: 1, lng: 1, ...overrides }
}

function mountOverlay(a: GeoAttraction, onClick: (a: GeoAttraction) => void) {
  const AttractionOverlay = getAttractionOverlayClass()
  const position = { lat: () => a.lat, lng: () => a.lng } as unknown as google.maps.LatLng
  const overlay = new AttractionOverlay(a, position, false, false, onClick)
  overlay.onAdd()
  return overlay
}

function getDiv(overlay: ReturnType<typeof mountOverlay>): HTMLElement {
  // onAdd() 把建立的 div 當成 overlayMouseTarget 的直接子元素塞進去(見
  // panes?.overlayMouseTarget.appendChild(div))——取 firstElementChild
  // 本身即可,不需要、也不能再用 querySelector('div') 往下找(那是找
  // 「子孫」,這個 div 本身沒有巢狀的 <div> 標籤子元素,querySelector 在
  // 它自己身上找不到任何東西)。不需要替 AttractionOverlayInstance 的
  // 型別額外開一個存取私有欄位的洞。
  const panes = (overlay as unknown as { getPanes: () => { overlayMouseTarget: HTMLElement } }).getPanes()
  return panes.overlayMouseTarget.firstElementChild as HTMLElement
}

beforeEach(() => {
  // getAttractionOverlayClass() 內部用模組級變數快取 class 單例(見該
  // 函式的完整說明)——不需要、也不能在測試之間重設它,所有測試共用同一個
  // class 定義本身沒問題,真正要在每個測試間隔離的是 DOM(每次重新建立
  // overlay 實例即可,不依賴殘留的全域狀態)。
})

describe('geoAttractionOverlay — 點擊目標範圍(圖示/圓點 + 文字標籤)', () => {
  it('主題點(isTheme=true):文字標籤(.geo-attraction-label)點擊會觸發 onClick', () => {
    const theme = attraction({ name: '清水寺', isTheme: true })
    const onClick = vi.fn()
    const overlay = mountOverlay(theme, onClick)
    const div = getDiv(overlay)

    const label = div.querySelector('.geo-attraction-label') as HTMLElement
    expect(label).toBeTruthy()
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledWith(theme)
  })

  it('精選點(isTheme=false):文字標籤(.geo-attraction-label)點擊會觸發 onClick', () => {
    const curated = attraction({ name: '二年坂', isTheme: false })
    const onClick = vi.fn()
    const overlay = mountOverlay(curated, onClick)
    const div = getDiv(overlay)

    const label = div.querySelector('.geo-attraction-label') as HTMLElement
    expect(label).toBeTruthy()
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledWith(curated)
  })

  it('精選點:圓點(.geo-attraction-curated-dot)本身點擊仍然觸發 onClick(既有行為不受影響)', () => {
    const curated = attraction({ name: '二年坂', isTheme: false })
    const onClick = vi.fn()
    const overlay = mountOverlay(curated, onClick)
    const div = getDiv(overlay)

    const dot = div.querySelector('.geo-attraction-curated-dot') as HTMLElement
    expect(dot).toBeTruthy()
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledWith(curated)
  })

  it('光暈(.geo-attraction-glow,僅主題點渲染)不是點擊目標——點擊它不觸發 onClick', () => {
    const theme = attraction({ name: '清水寺', isTheme: true })
    const onClick = vi.fn()
    const overlay = mountOverlay(theme, onClick)
    const div = getDiv(overlay)

    const glow = div.querySelector('.geo-attraction-glow') as HTMLElement
    expect(glow).toBeTruthy()
    glow.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
