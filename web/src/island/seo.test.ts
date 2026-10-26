import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEO_DESCRIPTION, SEO_TITLE } from './seo'

// 讀伺服器端 seo_meta.go 裡 "/island" 那一筆的 title / description 字串。
function readServerSeoEntry(): { title: string; description: string } {
  // vitest 從 web/ 目錄執行;伺服器端檔案在同一個 repo 的 ../server
  const src = readFileSync(resolve(process.cwd(), '../server/cmd/server/seo_meta.go'), 'utf-8')
  const m = /"\/island": \{\s*title:\s*"([^"]*)",\s*description:\s*"([^"]*)",/.exec(src)
  if (!m) throw new Error('seo_meta.go 找不到 "/island" 的 title/description')
  return { title: m[1], description: m[2] }
}

describe('/island 的搜尋/分享文案', () => {
  it('前端的 title 與 description 跟伺服器端 seo_meta.go 逐字相同(含標點)', () => {
    const server = readServerSeoEntry()
    expect(SEO_TITLE).toBe(server.title)
    expect(SEO_DESCRIPTION).toBe(server.description)
  })
  it('標題不超過 40 字、說明不超過 160 字', () => {
    expect([...SEO_TITLE].length).toBeLessThanOrEqual(40)
    expect([...SEO_DESCRIPTION].length).toBeLessThanOrEqual(160)
  })
})
