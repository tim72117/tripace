// withMarkerLabel——marker 內容旁的常駐文字標籤(行程站點圓點用)。
import { describe, it, expect } from 'vitest'
import { svgStringToElement, withMarkerLabel } from './mapMarkers'

const svg = () => svgStringToElement('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"></svg>')

describe('withMarkerLabel', () => {
  it('沒有名稱(undefined、空字串、全空白):原樣回傳 svg,不包殼', () => {
    for (const name of [undefined, '', '   ']) {
      const el = svg()
      expect(withMarkerLabel(el, name)).toBe(el)
    }
  })

  it('有名稱:外包一個跟 svg 同寬同高的 div,svg 在裡面,標籤文字是名稱(去頭尾空白)', () => {
    const el = svg()
    const wrap = withMarkerLabel(el, ' 赤崁樓 ') as HTMLElement
    expect(wrap.tagName).toBe('DIV')
    expect(wrap.style.width).toBe('14px')
    expect(wrap.style.height).toBe('14px')
    expect(wrap.firstElementChild).toBe(el)
    const label = wrap.querySelector('.ps-label') as HTMLElement
    expect(label.textContent).toBe('赤崁樓')
  })

  it('標籤用絕對定位貼在右側、單行省略,不影響內容尺寸', () => {
    const label = (withMarkerLabel(svg(), '赤崁樓') as HTMLElement).querySelector('.ps-label') as HTMLElement
    expect(label.style.position).toBe('absolute')
    expect(label.style.whiteSpace).toBe('nowrap')
    expect(label.style.textOverflow).toBe('ellipsis')
    expect(label.style.left).toContain('100%')
  })

  it('點名稱與點圓點一致:標籤接收指標事件、游標與圓點相同,點擊會冒泡到 marker 內容(同一個 gmp-click)', () => {
    const wrap = withMarkerLabel(svg(), '赤崁樓') as HTMLElement
    const label = wrap.querySelector('.ps-label') as HTMLElement
    expect(label.style.pointerEvents).toBe('auto')
    expect(label.style.cursor).toBe('pointer')
    // marker 的 gmp-click 掛在內容外層:從標籤與從圓點起的點擊都要抵達這一層。
    let clicks = 0
    wrap.addEventListener('click', () => (clicks += 1))
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    wrap.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicks).toBe(2)
  })

  it('名稱以文字節點放入,不解析成 HTML(避免注入)', () => {
    const wrap = withMarkerLabel(svg(), '<img src=x onerror=alert(1)>') as HTMLElement
    expect(wrap.querySelector('img')).toBeNull()
    expect((wrap.querySelector('.ps-label') as HTMLElement).textContent).toBe('<img src=x onerror=alert(1)>')
  })
})
