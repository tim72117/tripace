import { describe, expect, it } from 'vitest'
import {
  MAX_LINKS_PER_SECTION, MAX_SECTIONS, isHttpsUrl, isInternalPath, resolveSidebar, sanitizeAd, sanitizeSections,
} from './sidebarData'
import { makeItinerary } from './testUtils'
import type { SampleSidebar } from './types'

const base = (sidebar?: SampleSidebar, over = {}) => makeItinerary([], { id: 'cur', title: '目前', region: '北海道', categories: [], sidebar, ...over })
const GOOD_AD = { href: 'https://example.com/p', imageUrl: 'https://example.com/a.png', alt: '贊助' }

describe('isInternalPath', () => {
  it('收單一斜線開頭的站內路徑', () => {
    for (const p of ['/', '/momiji-front', '/itineraries/x?a=1#b']) expect(isInternalPath(p)).toBe(true)
  })
  it('擋掉外部網址、協定相對網址、危險協定、含空白/反斜線/控制字元與非字串', () => {
    for (const p of ['https://a.com', '//evil.com', 'javascript:alert(1)', 'data:text/html,x', 'relative/path', '/a b', '/a\\b', '/a\nb', '', null, undefined, 3]) {
      expect(isInternalPath(p)).toBe(false)
    }
  })
})

describe('isHttpsUrl', () => {
  it('只收 https,擋掉 http、帶帳密、壞網址與其他協定', () => {
    expect(isHttpsUrl('https://example.com/a')).toBe(true)
    for (const u of ['http://example.com', 'https://u:p@example.com', 'javascript:alert(1)', 'not a url', '', 5]) expect(isHttpsUrl(u)).toBe(false)
  })
})

describe('sanitizeSections', () => {
  it('合格的區段原樣保留(文字前後空白會去掉),hint 缺省為空字串', () => {
    const out = sanitizeSections([{ heading: ' 相關 ', links: [{ label: ' 紅葉前線 ', to: '/momiji-front', hint: '變色時程' }, { label: 'B', to: '/b' }] }])
    expect(out).toHaveLength(1)
    expect(out[0].heading).toBe('相關')
    expect(out[0].links.map((l) => [l.label, l.to, l.hint])).toEqual([['紅葉前線', '/momiji-front', '變色時程'], ['B', '/b', '']])
  })
  it('丟掉不合格的連結;連結全被丟掉的區段整段不要', () => {
    const out = sanitizeSections([
      { heading: 'A', links: [{ label: 'x', to: 'https://evil.com' }, { label: 'ok', to: '/ok' }, { label: '', to: '/empty' }, { to: '/nolabel' }] },
      { heading: 'B', links: [{ label: 'x', to: 'javascript:alert(1)' }] },
      { heading: '', links: [{ label: 'x', to: '/x' }] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].links.map((l) => l.to)).toEqual(['/ok'])
  })
  it('壞形狀不會丟例外', () => {
    expect(sanitizeSections(undefined)).toEqual([])
    expect(sanitizeSections('x')).toEqual([])
    expect(sanitizeSections([null, 3, 'a', { heading: 'A' }, { heading: 'A', links: 'x' }, { heading: 'A', links: [null, 4] }])).toEqual([])
  })
  it('區段與連結數量有上限', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ heading: `H${i}`, links: Array.from({ length: 20 }, (_, j) => ({ label: `L${j}`, to: `/p${j}` })) }))
    const out = sanitizeSections(many)
    expect(out).toHaveLength(MAX_SECTIONS)
    expect(out[0].links).toHaveLength(MAX_LINKS_PER_SECTION)
  })
  it('太長的文字視為不合格', () => {
    expect(sanitizeSections([{ heading: 'x'.repeat(31), links: [{ label: 'a', to: '/a' }] }])).toEqual([])
    expect(sanitizeSections([{ heading: 'h', links: [{ label: 'x'.repeat(61), to: '/a' }] }])).toEqual([])
  })
})

describe('sanitizeAd', () => {
  it('合格的廣告原樣回傳', () => {
    expect(sanitizeAd(GOOD_AD)).toEqual(GOOD_AD)
  })
  it('href 或 imageUrl 不是 https、alt 空白、或不是物件都回 null', () => {
    expect(sanitizeAd({ ...GOOD_AD, href: 'http://example.com' })).toBeNull()
    expect(sanitizeAd({ ...GOOD_AD, imageUrl: 'javascript:alert(1)' })).toBeNull()
    expect(sanitizeAd({ ...GOOD_AD, alt: '  ' })).toBeNull()
    expect(sanitizeAd(null)).toBeNull()
    expect(sanitizeAd('x')).toBeNull()
  })
})

describe('resolveSidebar', () => {
  it('沒有 sidebar 欄位:用全站預設連結(目前只有紅葉前線),沒有預設廣告就沒有廣告', () => {
    const r = resolveSidebar(base(), null)
    expect(r.sections).toHaveLength(1)
    expect(r.sections[0].links.map((l) => [l.label, l.to])).toEqual([['紅葉前線', '/momiji-front']])
    expect(r.ad).toBeNull()
  })
  it('sections 有值:完全由資料決定,取代預設連結', () => {
    const r = resolveSidebar(base({ sections: [{ heading: '延伸閱讀', links: [{ label: '另一份行程', to: '/itineraries/other' }] }] }), null)
    expect(r.sections).toHaveLength(1)
    expect(r.sections[0].links.map((l) => l.to)).toEqual(['/itineraries/other'])
  })
  it('sections 是空陣列:明確不顯示任何連結區塊', () => {
    expect(resolveSidebar(base({ sections: [] }), null).sections).toEqual([])
  })
  it('sections 裡的壞資料被丟掉、不退回預設連結', () => {
    const r = resolveSidebar(base({ sections: [{ heading: 'A', links: [{ label: 'x', to: 'https://evil.com' }] }] }), null)
    expect(r.sections).toEqual([])
  })
  it('sections 不是陣列(壞資料)視為沒設定,走預設連結', () => {
    const bad = base({ sections: 'oops' as unknown as never })
    expect(resolveSidebar(bad, null).sections[0].links[0].to).toBe('/momiji-front')
  })
  it('ad:undefined 用全站預設、物件用自己的、null 不顯示版位', () => {
    expect(resolveSidebar(base(), GOOD_AD).ad).toEqual(GOOD_AD)
    const own = { ...GOOD_AD, alt: '自己的' }
    expect(resolveSidebar(base({ ad: own }), GOOD_AD).ad).toEqual(own)
    expect(resolveSidebar(base({ ad: null }), GOOD_AD).ad).toBeNull()
  })
  it('自己指定的廣告沒通過檢查:不顯示,也不退回全站預設', () => {
    expect(resolveSidebar(base({ ad: { ...GOOD_AD, href: 'http://insecure.com' } }), GOOD_AD).ad).toBeNull()
  })
  it('全站預設廣告本身不合格也不會輸出', () => {
    expect(resolveSidebar(base(), { ...GOOD_AD, imageUrl: 'http://x.com/a.png' }).ad).toBeNull()
  })
})
