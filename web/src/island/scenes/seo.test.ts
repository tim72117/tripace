import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCENES, sceneHref } from './registry'

// 讀伺服器端 seo_meta.go 裡某個路徑那一筆的 title / description 字串。
function readServerSeoEntry(path: string): { title: string; description: string } {
  // vitest 從 web/ 目錄執行;伺服器端檔案在同一個 repo 的 ../server
  const src = readFileSync(resolve(process.cwd(), '../server/cmd/server/seo_meta.go'), 'utf-8')
  const m = new RegExp(`"${path.replace(/\//g, '\\/')}": \\{\\s*title:\\s*"([^"]*)",\\s*description:\\s*"([^"]*)",`).exec(src)
  if (!m) throw new Error(`seo_meta.go 找不到 "${path}" 的 title/description`)
  return { title: m[1], description: m[2] }
}

describe('/island 各場景的搜尋/分享文案', () => {
  // 實驗場景不對外,伺服器沒有對應條目
  for (const def of SCENES.filter((s) => !s.experimental)) {
    it(`${def.id}:前端的 title 與 description 跟伺服器端 seo_meta.go 逐字相同(含標點)`, () => {
      const server = readServerSeoEntry(sceneHref(def.id))
      expect(def.seo.title).toBe(server.title)
      expect(def.seo.description).toBe(server.description)
    })
    it(`${def.id}:標題不超過 40 字、說明不超過 160 字`, () => {
      expect([...def.seo.title].length).toBeLessThanOrEqual(40)
      expect([...def.seo.description].length).toBeLessThanOrEqual(160)
    })
  }
  it('場景 id 只用小寫英數與連字號(要當網址 slug)、不重複', () => {
    const ids = SCENES.map((s) => s.id)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
