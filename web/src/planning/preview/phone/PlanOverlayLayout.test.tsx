// PlanOverlayLayout(/ai-plan 手機版,phone/)——「地圖加疊加 UI」外殼元件,對應登入後的 PlanOverlayLayout。
// 負責容器底下的 map-layer、controls-slot 與疊加面板(overlay > panel);容器本身與 nav 在 PlanLayout。
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { describeSlotTree } from '../../shared/overlayDom'
import panelStyles from '../PlanOverlayPanel.module.css'
import askStyles from '../../conversation/AskPage.module.css'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AskPage } from '../../conversation/AskPage'
import type { AskPageInput } from '../../conversation/asktools'
import type { PlanAiDataSource } from '../../data/source'
import { Composer } from '../../../components/Composer'

const dataSource = {
  placeDetails: vi.fn().mockResolvedValue({ found: false }),
  transitEstimate: vi.fn(),
} as unknown as PlanAiDataSource

const noopRef = () => {}

function renderLayout(props: Partial<React.ComponentProps<typeof PlanOverlayLayout>> = {}) {
  return render(
    <PlanOverlayLayout mapBackground={<div data-testid="map" />} safeAreaRef={noopRef} {...props}>
      <div data-testid="content" />
    </PlanOverlayLayout>,
  )
}

describe('PlanOverlayLayout 手機版', () => {
  it('長出共同骨架:map-layer、controls-slot、overlay > (safe-area、panel > composer-slot)', () => {
    const { container } = renderLayout()
    expect(describeSlotTree(container)).toBe('map-layer,controls-slot,overlay(safe-area,panel(composer-slot))')
  })

  it('地圖放進 map-layer、內容放進 panel', () => {
    const { getByTestId } = renderLayout()
    expect(getByTestId('map').closest('[data-slot="map-layer"]')).not.toBeNull()
    expect(getByTestId('content').closest('[data-slot="panel"]')).not.toBeNull()
  })

  it('composer prop 放進 composer-slot', () => {
    const { getByTestId } = renderLayout({ composer: <div data-testid="composer" /> })
    expect(getByTestId('composer').closest('[data-slot="composer-slot"]')).not.toBeNull()
  })

  it('controls-slot 把元素交給 onControlsSlotChange(同登入後的外殼),卸載時回報 null', () => {
    const onChange = vi.fn()
    const { unmount } = renderLayout({ onControlsSlotChange: onChange })
    expect(onChange).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    unmount()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('沒有 mapBackground:不渲染 map-layer', () => {
    const { container } = renderLayout({ mapBackground: undefined })
    expect(describeSlotTree(container)).toBe('controls-slot,overlay(safe-area,panel(composer-slot))')
  })

  describe('詢問匡與輸入列融合(.fuse)', () => {
    const panelClasses = (container: HTMLElement) =>
      Array.from(container.querySelector('[data-slot="panel"]')!.classList)

    it('panel 一律掛 .fuse,passThrough 照樣保留;骨架不變', () => {
      expect(panelClasses(renderLayout().container)).toEqual([panelStyles.panel, panelStyles.fuse])
      const { container } = renderLayout({ passThrough: true })
      expect(panelClasses(container)).toEqual([panelStyles.panel, panelStyles.fuse, panelStyles.passThrough])
      expect(describeSlotTree(container)).toBe('map-layer,controls-slot,overlay(safe-area,panel(composer-slot))')
    })

    // 真的 AskPage + Composer 放進外殼:融合規則靠的掛點都在,且落在 .fuse 底下(閘門的兩邊都命中)。
    it('一般詢問匡與輸入列:AskShell 的 wrap/bubble、Composer 根節點都有掛點,且都在 .fuse panel 底下', () => {
      const { container } = render(
        <PlanOverlayLayout safeAreaRef={noopRef} composer={<Composer value="" onChange={() => {}} />}>
          <div>
            <AskPage dataSource={dataSource} input={{ country: {} } as AskPageInput} onDone={() => {}} />
          </div>
        </PlanOverlayLayout>,
      )
      const panel = container.querySelector(`.${panelStyles.fuse}`)!
      const bubble = panel.querySelector('[data-ask-part="bubble"]')!
      expect(bubble).not.toBeNull()
      expect(bubble.classList.contains(askStyles.bubble)).toBe(true)
      expect(bubble.parentElement!.getAttribute('data-ask-part')).toBe('wrap')
      expect(bubble.parentElement!.classList.contains(askStyles.wrap)).toBe(true)
      // 時間軸容器歸零用的轉場外殼掛點
      expect(panel.querySelector('[data-ask-part="transition"] [data-ask-part="wrap"]')).not.toBeNull()
      const composerRoot = panel.querySelector('[data-slot="composer-slot"] [data-composer-part="root"]')!
      expect(composerRoot).not.toBeNull()
      expect(composerRoot.querySelector('input')).not.toBeNull()
    })

    it('純文字對話氣泡(messageBubble)沒有 wrap/bubble 掛點,不參與融合', () => {
      const { container } = render(
        <PlanOverlayLayout safeAreaRef={noopRef} composer={<Composer value="" onChange={() => {}} />}>
          <AskPage dataSource={dataSource} input={{ text: '你好' } as AskPageInput} onDone={() => {}} />
        </PlanOverlayLayout>,
      )
      const message = container.querySelector(`.${askStyles.messageBubble}`)!
      expect(message).not.toBeNull()
      expect(message.hasAttribute('data-ask-part')).toBe(false)
      expect(container.querySelector('[data-ask-part="bubble"]')).toBeNull()
      expect(container.querySelector('[data-ask-part="wrap"]')).toBeNull()
    })

    // jsdom 不處理 CSS:直接解析規則檔。.fuse 的每一條規則都要在 @supports selector(:has(*)) 裡、只用屬性掛點
    // (不再用 `> *` 這類層數)、且以「詢問匡 bubble 與插槽裡的 Composer 根節點同時存在」的閘門開頭。
    describe('規則檔', () => {
      const rules = parseCssRules(readFileSync(join(__dirname, '..', 'PlanOverlayPanel.module.css'), 'utf8'))
      const fuseRules = rules.filter((r) => r.selectors.some((sel) => /\.fuse\b/.test(sel)))

      it('有 .fuse 規則,且四個掛點都有被用到', () => {
        const all = fuseRules.flatMap((r) => r.selectors).join('\n')
        expect(fuseRules.length).toBeGreaterThan(0)
        for (const hook of ["[data-ask-part='transition']", "[data-ask-part='wrap']", "[data-ask-part='bubble']", "[data-composer-part='root']"]) {
          expect(all).toContain(hook)
        }
      })

      it('每一條 .fuse 規則都在 @supports selector(:has(*)) 區塊內', () => {
        for (const rule of fuseRules) {
          expect(rule.ancestors.some((a) => /^@supports\s+selector\(\s*:has\(\s*\*\s*\)\s*\)/.test(a))).toBe(true)
        }
      })

      it('每一條選擇器:以雙邊閘門開頭、只用屬性掛點、不靠層數(沒有 `> *`、沒有 class 後代)', () => {
        const gate = /^\.fuse:has\(\[data-ask-part='bubble'\]\):has\(\[data-slot='composer-slot'\] \[data-composer-part='root'\]\)/
        for (const sel of fuseRules.flatMap((r) => r.selectors)) {
          expect(sel).toMatch(gate)
          const rest = sel.replace(gate, '')
          expect(rest).not.toMatch(/>\s*\*/)
          expect(rest).not.toMatch(/\.[a-zA-Z]/) // 閘門之後不再出現任何 class(雜湊 class 跨 module 也寫不出來)
          expect(rest).toMatch(/\[data-(ask|composer)-part=/)
        }
      })
    })
  })
})

// parseCssRules——極簡 CSS 解析:去註解後依大括號巢狀走一遍,收集每條樣式規則的選擇器清單與外層 at-rule 前導。
// 只用於測試讀規則檔,容忍換行/縮排等格式變化,不依賴行數。
function parseCssRules(css: string): { selectors: string[]; ancestors: string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selectors: string[]; ancestors: string[] }[] = []
  const stack: string[] = []
  let buf = ''
  for (const ch of text) {
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ')
      if (!prelude.startsWith('@') && !stack.some((a) => !a.startsWith('@'))) {
        out.push({ selectors: splitSelectors(prelude), ancestors: [...stack] })
      }
      stack.push(prelude)
      buf = ''
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';') {
      buf = ''
    } else {
      buf += ch
    }
  }
  return out
}

// 以頂層逗號切開選擇器清單(忽略 :has(...)/:not(...) 括號內的逗號)。
function splitSelectors(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of prelude) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}
