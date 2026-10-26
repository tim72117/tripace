// 守住「three 不進首頁 chunk」:首頁與 HeroIsland 只能「動態 import」island/mini/loadMini,
// 不可靜態 import,也不可直接 import three 或 island/three。靜態 import 會把 three(約 130KB gzip)併進首屏 chunk。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf-8')
const staticImports = (src: string) => [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])

describe('縮小島的載入邊界', () => {
  it('HomePage 與 HeroIsland 沒有靜態 import 縮小島載入入口、island/three 或 three', () => {
    for (const f of ['../HomePage.tsx', './HeroIsland.tsx']) {
      const imports = staticImports(read(f))
      const heavy = imports.filter((i) => i.includes('island/mini') || i.includes('island/three') || i === 'three' || i.startsWith('three/'))
      expect(heavy, f).toEqual([])
    }
  })
  it('HeroIsland 以動態 import 載入縮小島', () => {
    expect(read('./HeroIsland.tsx')).toMatch(/import\(\s*['"]\.\.\/\.\.\/island\/mini\/loadMini['"]\s*\)/)
  })
  it('HeroIsland 唯一靜態引用 island 的是純邏輯(logic/mini),不含 three', () => {
    const fromIsland = staticImports(read('./HeroIsland.tsx')).filter((i) => i.includes('/island/'))
    expect(fromIsland).toEqual(['../../island/logic/mini'])
    expect(read('../../island/logic/mini.ts')).not.toMatch(/from\s+['"]three/)
  })
})
