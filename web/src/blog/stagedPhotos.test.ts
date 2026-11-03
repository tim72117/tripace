import { describe, expect, it } from 'vitest'
import type { ArticleBlock } from './articleTools'
import { combinePhotos, dropStagedBlocks, isStagedId, remapPhotoIds, stagedIdsIn, stagedKeyOf, stagedPhotoId, stagedToPhoto } from './stagedPhotos'

const blocks: ArticleBlock[] = [
  { id: 'a', kind: 'paragraph', text: 'x' },
  { id: 'b', kind: 'image', photoId: 'staged:k1', alt: 'a', width: 'column', float: 'none' } as ArticleBlock,
  {
    id: 'c',
    kind: 'gallery',
    layout: 'grid',
    items: [
      { photoId: 'staged:k2', alt: 'b' },
      { photoId: 'real1', alt: 'c' },
    ],
  } as ArticleBlock,
]

describe('stagedPhotos', () => {
  it('id 與 key 互轉', () => {
    expect(stagedPhotoId('k')).toBe('staged:k')
    expect(isStagedId('staged:k')).toBe(true)
    expect(isStagedId('p1')).toBe(false)
    expect(stagedKeyOf('staged:k')).toBe('k')
  })
  it('合成 photo:ready、帶備註與尺寸,排在後端清單前面', () => {
    const p = stagedToPhoto({ key: 'k', filename: 'a.jpg', note: '清水寺', previewUrl: 'blob:x', width: 400, height: 300 })
    expect(p).toMatchObject({ id: 'staged:k', status: 'ready', note: '清水寺', originalUrl: 'blob:x', width: 400, height: 300 })
    const all = combinePhotos([{ ...p, id: 'real' }], [{ key: 'k', filename: 'a.jpg', previewUrl: 'blob:x' }])
    expect(all.map((x) => x.id)).toEqual(['staged:k', 'real'])
  })
  it('stagedIdsIn 找出 image 與 gallery 裡的待上傳 id', () => {
    expect(stagedIdsIn(blocks).sort()).toEqual(['staged:k1', 'staged:k2'])
  })
  it('remapPhotoIds 換掉 id;沒變動回傳同一個陣列', () => {
    const next = remapPhotoIds(blocks, { 'staged:k1': 'p1', 'staged:k2': 'p2' })
    expect(stagedIdsIn(next)).toEqual([])
    expect((next[1] as { photoId: string }).photoId).toBe('p1')
    expect((next[2] as { items: { photoId: string }[] }).items.map((i) => i.photoId)).toEqual(['p2', 'real1'])
    expect(remapPhotoIds(blocks, {})).toBe(blocks)
  })
  it('dropStagedBlocks:image 整個略過、gallery 去掉待上傳的幾張,回報略過張數', () => {
    const r = dropStagedBlocks(blocks)
    expect(r.skipped).toBe(2)
    expect(r.blocks.map((b) => b.id)).toEqual(['a', 'c'])
    expect((r.blocks[1] as { items: { photoId: string }[] }).items.map((i) => i.photoId)).toEqual(['real1'])
    expect(dropStagedBlocks([blocks[0]])).toEqual({ blocks: [blocks[0]], skipped: 0 })
  })
})
