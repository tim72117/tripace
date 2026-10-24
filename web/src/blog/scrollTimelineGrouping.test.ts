import { describe, it, expect } from 'vitest'
import { groupScrollTimelineBlocks } from './scrollTimelineGrouping'
import type {
  ParagraphBlock,
  ScrollTimelineAnchorBlock,
  ScrollTimelineEndBlock,
  ScrollTimelineStartBlock,
  ThemePageBlock,
} from './types'

// 這份測試只涵蓋 groupScrollTimelineBlocks 的純計算邏輯,不測試
// BlogArticlePage.tsx 的 JSX 渲染——分組結果本身(哪些 block 被收進
// 哪個 anchor、容錯規則是否正確)是純資料轉換,渲染只是把分組結果原樣
// 組裝成 JSX,不需要重複用 React 測試工具驗證,對齊
// planning/timeline/PlanTimelineView.test.ts 只測純函式的既有做法。

function paragraph(id: string, text = id): ParagraphBlock {
  return { id, kind: 'paragraph', text }
}

function start(id: string, overrides: Partial<ScrollTimelineStartBlock> = {}): ScrollTimelineStartBlock {
  return { id, kind: 'scroll-timeline-start', city: '台南', accentColor: 'var(--brick)', ...overrides }
}

function anchor(id: string, overrides: Partial<ScrollTimelineAnchorBlock> = {}): ScrollTimelineAnchorBlock {
  return { id, kind: 'scroll-timeline-anchor', thumb: `${id}.webp`, ...overrides }
}

function end(id: string): ScrollTimelineEndBlock {
  return { id, kind: 'scroll-timeline-end' }
}

describe('groupScrollTimelineBlocks', () => {
  it('沒有任何 scroll-timeline 標記時,全部當成一般 block 輸出,順序不變', () => {
    const blocks: ThemePageBlock[] = [paragraph('p1'), paragraph('p2')]
    const items = groupScrollTimelineBlocks(blocks)
    expect(items).toEqual([
      { type: 'block', block: blocks[0], index: 0 },
      { type: 'block', block: blocks[1], index: 1 },
    ])
  })

  it('完整的 start-anchor-anchor-end 收斂成一個 scroll-timeline 分組,一般 block 歸進最近的 anchor', () => {
    const blocks: ThemePageBlock[] = [
      paragraph('intro'),
      start('s1'),
      anchor('a1'),
      paragraph('a1-content'),
      anchor('a2'),
      paragraph('a2-content'),
      end('e1'),
      paragraph('outro'),
    ]
    const items = groupScrollTimelineBlocks(blocks)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ type: 'block', block: blocks[0], index: 0 })
    expect(items[2]).toEqual({ type: 'block', block: blocks[7], index: 7 })

    const group = items[1]
    if (group.type !== 'scroll-timeline') throw new Error('expected scroll-timeline group')
    expect(group.group.start.id).toBe('s1')
    expect(group.group.anchors).toHaveLength(2)
    expect(group.group.anchors[0].meta.id).toBe('a1')
    expect(group.group.anchors[0].content).toEqual([blocks[3]])
    expect(group.group.anchors[1].meta.id).toBe('a2')
    expect(group.group.anchors[1].content).toEqual([blocks[5]])
  })

  it('start 之後、第一個 anchor 之前的一般 block,當成普通 block 輸出(不歸進任何 anchor)', () => {
    const blocks: ThemePageBlock[] = [start('s1'), paragraph('between'), anchor('a1'), end('e1')]
    const items = groupScrollTimelineBlocks(blocks)
    // between 在 start 之後、anchor 之前,此時 current.anchors 還是空的,
    // 應該被當成一般 block 輸出,不是被吃進 scroll-timeline 分組內部。
    expect(items.some((i) => i.type === 'block' && i.block.id === 'between')).toBe(true)
  })

  it('落單的 anchor(出現在任何 start 之前)——忽略這個標記,不影響其餘 block', () => {
    const blocks: ThemePageBlock[] = [paragraph('p1'), anchor('orphan'), paragraph('p2')]
    const items = groupScrollTimelineBlocks(blocks)
    expect(items).toEqual([
      { type: 'block', block: blocks[0], index: 0 },
      { type: 'block', block: blocks[2], index: 2 },
    ])
  })

  it('巢狀 start(前一組忘記寫 end)——視為前一組結束、開始新的一組,兩組都正確輸出', () => {
    const blocks: ThemePageBlock[] = [
      start('s1'),
      anchor('a1'),
      paragraph('a1-content'),
      start('s2'),
      anchor('a2'),
      paragraph('a2-content'),
      end('e2'),
    ]
    const items = groupScrollTimelineBlocks(blocks)
    const groups = items.filter((i) => i.type === 'scroll-timeline')
    expect(groups).toHaveLength(2)
    if (groups[0].type !== 'scroll-timeline' || groups[1].type !== 'scroll-timeline') throw new Error('unreachable')
    expect(groups[0].group.start.id).toBe('s1')
    expect(groups[0].group.anchors).toHaveLength(1)
    expect(groups[0].group.anchors[0].content).toEqual([blocks[2]])
    expect(groups[1].group.start.id).toBe('s2')
    expect(groups[1].group.anchors).toHaveLength(1)
    expect(groups[1].group.anchors[0].content).toEqual([blocks[5]])
  })

  it('陣列結尾前仍未閉合的 start(忘記寫 end)——視為收到陣列結尾都算這一組,正常輸出', () => {
    const blocks: ThemePageBlock[] = [start('s1'), anchor('a1'), paragraph('a1-content')]
    const items = groupScrollTimelineBlocks(blocks)
    expect(items).toHaveLength(1)
    const [group] = items
    if (group.type !== 'scroll-timeline') throw new Error('expected scroll-timeline group')
    expect(group.group.anchors).toHaveLength(1)
    expect(group.group.anchors[0].content).toEqual([blocks[2]])
  })

  it('同一個分組內的 key 彼此不同(多組 scroll-timeline 時 groupSeq 遞增)', () => {
    const blocks: ThemePageBlock[] = [
      start('s1'), anchor('a1'), end('e1'),
      start('s2'), anchor('a2'), end('e2'),
    ]
    const items = groupScrollTimelineBlocks(blocks)
    const groups = items.filter((i) => i.type === 'scroll-timeline')
    expect(groups).toHaveLength(2)
    const keys = groups.map((g) => (g.type === 'scroll-timeline' ? g.key : null))
    expect(new Set(keys).size).toBe(2)
  })

  it('start-end 之間完全沒有 anchor——仍輸出一個分組,anchors 為空陣列(由渲染端決定是否要忽略)', () => {
    const blocks: ThemePageBlock[] = [start('s1'), end('e1')]
    const items = groupScrollTimelineBlocks(blocks)
    expect(items).toHaveLength(1)
    const [group] = items
    if (group.type !== 'scroll-timeline') throw new Error('expected scroll-timeline group')
    expect(group.group.anchors).toEqual([])
  })
})
