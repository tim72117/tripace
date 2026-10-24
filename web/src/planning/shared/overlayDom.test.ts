// overlayDom 的小工具測試。
import { describe, it, expect } from 'vitest'
import { panelContentRoot, describeSlotTree } from './overlayDom'

function panel(html: string) {
  const el = document.createElement('div')
  el.setAttribute('data-slot', 'panel')
  el.innerHTML = html
  return el
}

describe('panelContentRoot', () => {
  it('略過 safe-area 洞,回傳面板裡第一個真正的內容元素(時間軸根元素)', () => {
    const p = panel('<div data-slot="safe-area"></div><section id="root"><i></i></section><div data-slot="composer-slot"></div>')
    expect(panelContentRoot(p)?.id).toBe('root')
  })

  it('洞排在最前面也不影響:除錯疊圖靠它找時間軸', () => {
    const p = panel('<div data-slot="safe-area"></div><div id="a"></div><div id="b"></div>')
    expect(panelContentRoot(p)?.id).toBe('a')
  })

  it('沒有內容元素(只有插槽)或面板為 null:回傳 null', () => {
    expect(panelContentRoot(panel('<div data-slot="safe-area"></div><div data-slot="composer-slot"></div>'))).toBeNull()
    expect(panelContentRoot(null)).toBeNull()
  })
})

describe('describeSlotTree', () => {
  it('沒有 data-slot 的元素略過、往下展開', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div><div data-slot="a"><span><b data-slot="b"></b></span></div></div>'
    expect(describeSlotTree(root)).toBe('a(b)')
  })
})
