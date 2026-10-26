// articleToIsland.ts——部落客文章 → 島的站點資料(純函式)。
//
// 島的內容是「由文章自動生成」:站點、順序、站名、摘錄都以文章為準(文章 stop 區塊),
// 版面資料(layout.stops)只補視覺欄位(位置、模型、示意時間)。對不上時不丟錯,
// 而是回報 issues 並盡量產出結果,讓原型在資料不完整時仍然能看。
import type { IslandLayout, StopAnchor } from '../data/layoutTypes'
import { formatTime, parseTime } from './lighting'

export type StopBlockLike = { id: string; kind: 'stop'; index?: string; name: string; desc?: string; blurb?: string; media?: unknown[] }

export type ArticleSource = {
  slug: string
  ownerId?: string
  content: { title: string; eyebrow?: string; lede?: string; heroStandalonePhotoId?: string; blocks: unknown[] }
}

export type Byline = { name: string; handle?: string; articleUrl?: string }

export type Issue = { level: 'error' | 'warn'; path: string; msg: string }

export type IslandStop = {
  stopId: string
  order: number
  index: string // '壱' 等文章裡的序號,沒有則空字串
  name: string
  excerpt: string
  blurb?: string
  time: string
  timeSource: 'layout' | 'generated'
  anchor: StopAnchor | null
}

export type IslandMeta = { title: string; eyebrow?: string; lede?: string; byline: Byline }

// 只取 kind === 'stop',依陣列順序;未知 kind(scroll-timeline-* 等)靜默略過。
export function extractStops(blocks: ReadonlyArray<unknown>): StopBlockLike[] {
  const out: StopBlockLike[] = []
  for (const b of blocks) {
    if (typeof b === 'object' && b !== null && (b as { kind?: unknown }).kind === 'stop') {
      const s = b as StopBlockLike
      if (typeof s.id === 'string' && typeof s.name === 'string') out.push(s)
    }
  }
  return out
}

// excerpt——取第一句(以。！？結尾),超過 max 字加「…」。以 code point 計算,不切斷 emoji。
export function excerpt(text: string, max: number): string {
  const m = /^[^。！？!?]*[。！？!?]?/.exec(text.trim())
  const first = (m?.[0] ?? '').trim() || text.trim()
  const chars = [...first]
  return chars.length <= max ? first : chars.slice(0, max).join('') + '…'
}

// generateTimes——沒有時間時,在 [start, end] 平均分配並對齊 5 分鐘。
export function generateTimes(n: number, start: string, end: string): string[] {
  if (n <= 0) return []
  const a = parseTime(start)
  const b = parseTime(end)
  if (n === 1) return [formatTime(a)]
  return Array.from({ length: n }, (_, i) => formatTime(Math.round((a + ((b - a) * i) / (n - 1)) / 5) * 5))
}

// displayableStops——島上實際會顯示的站:有版面站點(anchor)、且版面指定的模型存在。
// 這是「哪些站會顯示」的唯一判斷處:HUD(資訊卡、上一站/下一站)與 3D 場景(建築、標籤、導覽鏡頭、旅人時間表)
// 都必須用同一份過濾後的清單,它們互相傳遞的「第 i 站」才會指向同一站。articleToIsland 在缺版面時只警告、
// 仍回傳完整的站點清單,所以呼叫端用這個函式過濾後再往下傳,不要各自過濾。
export function displayableStops<M>(stops: ReadonlyArray<IslandStop>, models: Readonly<Record<string, M>>): IslandStop[] {
  return stops.filter((s) => s.anchor !== null && models[s.anchor.model] !== undefined)
}

export function articleToIsland(
  src: ArticleSource,
  layout: Pick<IslandLayout, 'stops'>,
  byline: Byline,
): { stops: IslandStop[]; meta: IslandMeta; issues: Issue[] } {
  const issues: Issue[] = []
  const blocks = extractStops(src.content.blocks)
  const byId = new Map(layout.stops.map((s) => [s.stopId, s]))
  const articleIds = new Set(blocks.map((b) => b.id))
  for (const s of layout.stops) {
    if (!articleIds.has(s.stopId)) issues.push({ level: 'warn', path: `stops.${s.stopId}`, msg: '版面有這一站但文章沒有' })
  }
  // 順序檢查:文章中有對應版面站點的,版面順序必須與文章順序一致
  const layoutOrder = layout.stops.map((s) => s.stopId).filter((id) => articleIds.has(id))
  const articleOrder = blocks.map((b) => b.id).filter((id) => byId.has(id))
  if (layoutOrder.join('|') !== articleOrder.join('|')) {
    issues.push({ level: 'error', path: 'stops', msg: '版面站點順序與文章順序不一致' })
  }
  const generated = generateTimes(blocks.length, '17:30', '20:15')
  const stops = blocks.map((b, i): IslandStop => {
    const anchor = byId.get(b.id) ?? null
    if (!anchor) issues.push({ level: 'warn', path: `stops.${b.id}`, msg: '文章有這一站但版面沒有(島上不會出現建築)' })
    return {
      stopId: b.id,
      order: i,
      index: b.index ?? '',
      name: b.name,
      excerpt: excerpt(b.desc ?? '', 60),
      blurb: b.blurb || undefined,
      time: anchor?.time ?? generated[i],
      timeSource: anchor?.time ? 'layout' : 'generated',
      anchor,
    }
  })
  return { stops, meta: { title: src.content.title, eyebrow: src.content.eyebrow, lede: src.content.lede, byline }, issues }
}
