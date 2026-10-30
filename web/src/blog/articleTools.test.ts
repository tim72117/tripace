import { describe, expect, it } from 'vitest'
import type { UploadedPhoto } from '../api'
import {
  addBlock,
  buildBlock,
  getArticle,
  insertIndex,
  listPhotos,
  moveBlock,
  removeBlock,
  saveArticle,
  setMeta,
  updateBlock,
  type ArticleBlock,
  type ArticleEditorHandle,
  type ArticleState,
} from './articleTools'

function photo(id: string, over: Partial<UploadedPhoto> = {}): UploadedPhoto {
  return { id, ownerId: '', originalUrl: '', status: 'ready', createdAt: '', updatedAt: '', ...over }
}
const PHOTOS = [
  photo('p1', { note: '清水寺舞台', width: 4000, height: 3000 }),
  photo('p2', { note: '', width: 3000, height: 4000 }),
  photo('p3', { note: '老街' }),
  photo('p4', { status: 'pending' }),
]
function makeHandle(init: Partial<ArticleState> = {}): ArticleEditorHandle & { state: ArticleState; published: boolean; saved: number } {
  const h = {
    state: { title: '', lede: '', blocks: [] as ArticleBlock[], ...init },
    getState: () => h.state,
    setState: (n: ArticleState) => {
      h.state = n
    },
    getPhotos: () => PHOTOS,
    published: false,
    saved: 0,
    isPublished: () => h.published,
    save: async () => {
      h.saved += 1
      return { slug: 'auto-slug', created: true }
    },
  }
  return h
}
const para = (id: string, text = 'x'): ArticleBlock => ({ id, kind: 'paragraph', text })
// ClientTool<Ctx>.handle 的型別是條件型別,測試裡統一轉成可呼叫的形狀。
type Call = (args: Record<string, unknown>, ctx: ArticleEditorHandle) => unknown
const call = (t: { handle: unknown }): Call => t.handle as Call

describe('buildBlock', () => {
  it('段落需要非空文字,variant 要合法', () => {
    expect(() => buildBlock({ kind: 'paragraph', text: ' ' }, PHOTOS)).toThrow('text')
    expect(() => buildBlock({ kind: 'paragraph', text: 'a', variant: 'big' }, PHOTOS)).toThrow('variant')
    expect(buildBlock({ kind: 'paragraph', text: 'a', variant: 'quote' }, PHOTOS)).toEqual({
      kind: 'paragraph',
      text: 'a',
      variant: 'quote',
    })
  })
  it('image 只能用 ready 的素材庫圖片,且需要 alt', () => {
    expect(() => buildBlock({ kind: 'image', photoId: 'nope', alt: 'a' }, PHOTOS)).toThrow('找不到')
    expect(() => buildBlock({ kind: 'image', photoId: 'p4', alt: 'a' }, PHOTOS)).toThrow('處理中')
    expect(() => buildBlock({ kind: 'image', photoId: 'p1', alt: '' }, PHOTOS)).toThrow('alt')
    expect(buildBlock({ kind: 'image', photoId: 'p1', alt: '舞台' }, PHOTOS)).toMatchObject({
      width: 'column',
      float: 'none',
    })
  })
  it('float 只在 width=column 有效', () => {
    expect(() => buildBlock({ kind: 'image', photoId: 'p1', alt: 'a', width: 'full', float: 'left' }, PHOTOS)).toThrow(
      'float',
    )
  })
  it('gallery:至少 2 張、不可重複、split 剛好 3 張', () => {
    const it1 = { photoId: 'p1', alt: 'a' }
    const it2 = { photoId: 'p2', alt: 'b' }
    expect(() => buildBlock({ kind: 'gallery', items: [it1] }, PHOTOS)).toThrow('至少 2')
    expect(() => buildBlock({ kind: 'gallery', items: [it1, it1] }, PHOTOS)).toThrow('重複')
    expect(() => buildBlock({ kind: 'gallery', layout: 'split', items: [it1, it2] }, PHOTOS)).toThrow('3 張')
    expect(buildBlock({ kind: 'gallery', items: [it1, it2] }, PHOTOS)).toMatchObject({ layout: 'grid' })
  })
  it('未知 kind 被拒絕', () => {
    expect(() => buildBlock({ kind: 'stop' }, PHOTOS)).toThrow('kind')
  })
})

describe('insertIndex', () => {
  const blocks = [para('a'), para('b')]
  it('省略=最後、start=最前、id=其後、找不到=錯誤', () => {
    expect(insertIndex(blocks, undefined)).toBe(2)
    expect(insertIndex(blocks, 'start')).toBe(0)
    expect(insertIndex(blocks, 'a')).toBe(1)
    expect(() => insertIndex(blocks, 'zzz')).toThrow('找不到')
  })
})

describe('tools', () => {
  it('list_photos 只回 ready,算出方向與未備註數', () => {
    const r = call(listPhotos)({}, makeHandle()) as {
      photos: { photoId: string; orientation?: string }[]
      withoutNote: number
    }
    expect(r.photos.map((p) => p.photoId)).toEqual(['p1', 'p2', 'p3'])
    expect(r.photos[1].orientation).toBe('portrait')
    expect(r.withoutNote).toBe(1)
  })
  it('set_meta / add_block / get_article 串起來', () => {
    const h = makeHandle()
    call(setMeta)({ title: '東山', lede: '導言' }, h)
    const a = call(addBlock)({ kind: 'paragraph', text: '第一段' }, h) as { id: string }
    call(addBlock)({ kind: 'image', photoId: 'p1', alt: '舞台', afterId: 'start' }, h)
    const art = call(getArticle)({}, h) as { title: string; blocks: { kind: string; id: string }[] }
    expect(art.title).toBe('東山')
    expect(art.blocks.map((b) => b.kind)).toEqual(['image', 'paragraph'])
    expect(art.blocks[1].id).toBe(a.id)
  })
  it('update / move / remove', () => {
    const h = makeHandle({ blocks: [para('a', '1'), para('b', '2'), para('c', '3')] })
    call(updateBlock)({ id: 'b', text: '改過', variant: 'heading' }, h)
    expect(h.state.blocks[1]).toMatchObject({ id: 'b', text: '改過', variant: 'heading' })
    expect(() => call(updateBlock)({ id: 'b', kind: 'image' }, h)).toThrow('kind')
    call(moveBlock)({ id: 'c', afterId: 'start' }, h)
    expect(h.state.blocks.map((b) => b.id)).toEqual(['c', 'a', 'b'])
    call(removeBlock)({ id: 'a' }, h)
    expect(h.state.blocks.map((b) => b.id)).toEqual(['c', 'b'])
    expect(() => call(removeBlock)({ id: 'zz' }, h)).toThrow('找不到')
  })
})

describe('save_article', () => {
  it('只存有標題與內容的草稿,回傳 slug', async () => {
    const h = makeHandle({ title: '東山', blocks: [para('a')] })
    await expect(call(saveArticle)({}, h)).resolves.toMatchObject({ ok: true, slug: 'auto-slug', status: 'draft' })
    expect(h.saved).toBe(1)
  })
  it('已發佈、沒標題、沒內容都拒絕且不存檔', async () => {
    const pub = makeHandle({ title: 't', blocks: [para('a')] })
    pub.published = true
    await expect(call(saveArticle)({}, pub)).rejects.toThrow('已發佈')
    await expect(call(saveArticle)({}, makeHandle({ blocks: [para('a')] }))).rejects.toThrow('標題')
    await expect(call(saveArticle)({}, makeHandle({ title: 't' }))).rejects.toThrow('區塊')
    expect(pub.saved).toBe(0)
  })
})
