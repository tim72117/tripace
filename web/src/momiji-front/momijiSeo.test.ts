import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORECAST_YEAR } from './momijiForecast'
import { SEO_DESCRIPTION, SEO_TITLE } from './momijiSeo'

// 讀伺服器端 seo_meta.go 裡 "/momiji-front" 那一筆的 title / description 字串。
function readServerSeoEntry(): { title: string; description: string } {
  // vitest 從 web/ 目錄執行(見 vitest.config),伺服器端檔案在同一個 repo 的 ../server。
  const src = readFileSync(resolve(process.cwd(), '../server/cmd/server/seo_meta.go'), 'utf-8')
  const m = /"\/momiji-front": \{\s*title:\s*"([^"]*)",\s*description:\s*"([^"]*)",/.exec(src)
  if (!m) throw new Error('seo_meta.go 找不到 "/momiji-front" 的 title/description')
  return { title: m[1], description: m[2] }
}

describe('紅葉頁的搜尋/分享文案', () => {
  it('前端的 title 與 description 跟伺服器端 seo_meta.go 逐字相同(含標點)', () => {
    const server = readServerSeoEntry()
    expect(SEO_TITLE).toBe(server.title)
    expect(SEO_DESCRIPTION).toBe(server.description)
  })
  it('文案裡的年份跟預測資料的年份一致(換年份時會被抓到)', () => {
    expect(SEO_TITLE).toContain(`【${FORECAST_YEAR}日本紅葉】`)
    expect(SEO_DESCRIPTION).toContain(`【${FORECAST_YEAR}日本紅葉】`)
  })
  it('保留「內插的示意」說明,不讓人誤以為是逐地點預測', () => {
    expect(SEO_DESCRIPTION).toContain('內插')
  })
  it('標題不超過 40 字、說明不超過 160 字(搜尋結果不被截斷太多)', () => {
    expect([...SEO_TITLE].length).toBeLessThanOrEqual(40)
    expect([...SEO_DESCRIPTION].length).toBeLessThanOrEqual(160)
  })
})
