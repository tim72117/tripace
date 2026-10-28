import { describe, expect, it } from 'vitest'
import { httpHref, kkdayHref } from './SponsoredPlanCard'

describe('kkdayHref', () => {
  it('kkday.com 與子網域通過,並補上 ud2=投放頁面', () => {
    const href = kkdayHref('https://www.kkday.com/zh-tw/product/2287?cid=tripace-27468', 'jiufen')
    expect(href).not.toBeNull()
    const u = new URL(href!)
    expect(u.searchParams.get('cid')).toBe('tripace-27468')
    expect(u.searchParams.get('ud2')).toBe('jiufen')
  })

  it('已有 ud2 時不覆蓋', () => {
    const u = new URL(kkdayHref('https://www.kkday.com/x?cid=a&ud2=custom', 'jiufen')!)
    expect(u.searchParams.get('ud2')).toBe('custom')
  })

  it.each([
    'javascript:alert(1)',
    'http://www.kkday.com/x',
    'https://example.com/x',
    'https://kkday.com.evil.com/x',
    'https://user:pw@www.kkday.com/x',
    '',
    'not a url',
  ])('拒絕 %s', (url) => {
    expect(kkdayHref(url, 'jiufen')).toBeNull()
  })
})

describe('httpHref', () => {
  it('http(s) 通過', () => {
    expect(httpHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(httpHref('http://example.com/')).toBe('http://example.com/')
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//example.com',
    '/relative',
    'https://user:pw@example.com',
    '',
  ])('拒絕 %s', (url) => {
    expect(httpHref(url)).toBeNull()
  })
})
