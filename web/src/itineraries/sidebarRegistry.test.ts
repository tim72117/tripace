import { describe, expect, it } from 'vitest'
import { SAMPLE_ITINERARIES } from './registry'
import { sanitizeAd, sanitizeSections } from './sidebarData'

// 靜態行程檔(example/*.ts)裡寫的 sidebar 資料:畫面端會丟掉不合格的項目,但作者應該在寫的
// 當下就發現寫錯,所以這裡要求「一個都不能被丟掉」,連到其他行程的連結也必須指向真的存在的行程。
// 目前沒有靜態行程設定 sidebar,有人加了就會被檢查到。
describe('靜態行程的 sidebar 資料', () => {
  it('有設定 sidebar 的行程:區段與連結都通過畫面端檢查、站內行程連結存在、廣告合格', () => {
    const ids = new Set(SAMPLE_ITINERARIES.map((it) => it.id))
    for (const itin of SAMPLE_ITINERARIES) {
      if (!itin.sidebar) continue
      const { sections, ad } = itin.sidebar

      if (sections !== undefined) {
        const clean = sanitizeSections(sections)
        expect(clean, `${itin.id} 有區段被丟掉`).toHaveLength(sections.length)
        sections.forEach((sec, i) => {
          expect(clean[i].links, `${itin.id} 區段「${sec.heading}」有連結被丟掉`).toHaveLength(sec.links.length)
          for (const l of sec.links) {
            const m = /^\/itineraries\/([^/?#]+)/.exec(l.to)
            if (m) expect(ids.has(m[1]), `${itin.id}: ${l.to} 找不到對應的行程`).toBe(true)
          }
        })
      }
      if (ad) expect(sanitizeAd(ad), `${itin.id} 的廣告不合格`).not.toBeNull()
    }
  })
})
