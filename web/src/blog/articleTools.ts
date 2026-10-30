// articleTools——讓 onagent 控制文章編輯器的前端工具(app:blog-article-writer)。
//
// 工具只改「編輯器裡未存檔的狀態」(經由 ArticleEditorHandle),不碰後端;使用者看完畫面、按「儲存」才寫入。
// 工具名稱/參數要與 web/tools/blog-article/*.yaml 一致;結果 LLM 需要看到,所以 yaml 都是 kind: query。
// 驗證在這裡做(photoId 必須在素材庫且已就緒、gallery 張數/版面規則),錯誤用 throw,訊息寫明怎麼修正,
// LLM 才能據以重試(同 planning/conversation/tools.ts 的慣例)。
//
// 目前支援 paragraph / image / gallery 三種區塊(與編輯器一致);stop 與 scroll-timeline-* 編輯器本身還不支援新增。
import type { UploadedPhoto } from '../api'
import { defineTool } from '../sdk-proposals/defineTool'
import type { ClientTool } from '../sdk-proposals/arrayTools'
import type { GalleryBlock, ImageBlock, ImageFloat, ImageOrientation, ImageWidth, ParagraphBlock, ParagraphVariant, StopBlock } from './types'

export type ArticleBlock = ParagraphBlock | ImageBlock | GalleryBlock | StopBlock

export interface ArticleState {
  title: string
  lede: string
  blocks: ArticleBlock[]
}

// ArticleEditorHandle:ArticleEditor 提供給工具的控制介面。getState 必須回傳「最新」狀態(含同一輪稍早的工具
// 呼叫剛寫入、React 還沒重繪的變更),所以實作端要用 ref 同步更新,不能直接讀 render 當下的 state。
export interface ArticleEditorHandle {
  getState(): ArticleState
  setState(next: ArticleState): void
  getPhotos(): UploadedPhoto[]
  // isPublished:這篇是否已發佈(已發佈的不讓 AI 存,避免直接覆蓋公開內容)。
  isPublished(): boolean
  // save:存檔(新文章會建立並自動產生 slug),失敗會 throw。實作端與「儲存」按鈕共用同一條邏輯。
  save(): Promise<{ slug: string; created: boolean }>
}

const VARIANTS: ParagraphVariant[] = ['heading', 'emphasis', 'quote', 'caption']
const WIDTHS: ImageWidth[] = ['column', 'wide', 'full']
const FLOATS: ImageFloat[] = ['none', 'left', 'right']
const ORIENTATIONS: ImageOrientation[] = ['landscape', 'portrait']
const LAYOUTS: GalleryBlock['layout'][] = ['grid', 'row', 'split']
const MAX_GALLERY_ITEMS = 12

let idSeq = 0
export function newAiBlockId(): string {
  idSeq += 1
  return `ai_${Date.now().toString(36)}_${idSeq}`
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function oneOf<T extends string>(v: unknown, allowed: T[], field: string): T | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'string' && (allowed as string[]).includes(v)) return v as T
  throw new Error(`${field} 只能是 ${allowed.join(' / ')},收到 ${JSON.stringify(v)}`)
}

// 照片是否可引用:必須存在於素材庫且處理完成(ready),否則文章裡會顯示不出來。
function requirePhoto(photos: UploadedPhoto[], photoId: unknown): UploadedPhoto {
  if (typeof photoId !== 'string' || photoId === '') throw new Error('photoId 必填,請先呼叫 list_photos 取得')
  const p = photos.find((x) => x.id === photoId)
  if (!p) throw new Error(`找不到 photoId ${photoId},只能使用 list_photos 回傳過的 photoId,不可編造`)
  if (p.status !== 'ready') throw new Error(`photoId ${photoId} 還在處理中或處理失敗(status=${p.status}),請改用其他圖片`)
  return p
}

// buildBlock:把工具參數轉成合法的區塊(不含 id);不合法就 throw。獨立出來方便單元測試。
// 對聯集型別逐一 Omit(直接 Omit<聯集> 會把各 kind 獨有欄位全部丟掉)。
type BlockWithoutId = ArticleBlock extends infer B ? (B extends unknown ? Omit<B, 'id'> : never) : never

export function buildBlock(raw: Record<string, unknown>, photos: UploadedPhoto[]): BlockWithoutId {
  const kind = raw.kind
  if (kind === 'paragraph') {
    const text = str(raw.text)
    if (text === undefined || text.trim() === '') throw new Error('paragraph 需要非空的 text')
    const variant = oneOf(raw.variant, VARIANTS, 'variant')
    return { kind: 'paragraph', text, ...(variant ? { variant } : {}) }
  }
  if (kind === 'image') {
    requirePhoto(photos, raw.photoId)
    const alt = str(raw.alt)
    if (!alt || alt.trim() === '') throw new Error('image 需要 alt(寫這張圖實際的畫面內容)')
    const width = oneOf(raw.width, WIDTHS, 'width') ?? 'column'
    const float = oneOf(raw.float, FLOATS, 'float') ?? 'none'
    if (float !== 'none' && width !== 'column') {
      throw new Error('float 只在 width 為 column 時有效;要文繞圖請把 width 設成 column,否則 float 用 none')
    }
    const orientation = oneOf(raw.orientation, ORIENTATIONS, 'orientation')
    const caption = str(raw.caption)
    const overlayText = str(raw.overlayText)
    return {
      kind: 'image',
      photoId: raw.photoId as string,
      alt,
      width,
      float,
      ...(caption ? { caption } : {}),
      ...(orientation ? { orientation } : {}),
      ...(overlayText ? { overlayText } : {}),
    }
  }
  if (kind === 'gallery') {
    const items = raw.items
    if (!Array.isArray(items) || items.length < 2) throw new Error('gallery 需要至少 2 張圖;只有 1 張請改用 image')
    if (items.length > MAX_GALLERY_ITEMS) throw new Error(`gallery 最多 ${MAX_GALLERY_ITEMS} 張,建議 2~4 張,多的請分成別組`)
    const layout = oneOf(raw.layout, LAYOUTS, 'layout') ?? 'grid'
    if (layout === 'split' && items.length !== 3) {
      throw new Error('layout 為 split 時 items 必須剛好 3 張(items[0] 直式大圖,其餘兩張橫式)')
    }
    const seen = new Set<string>()
    const built = items.map((it, i) => {
      const r = (it ?? {}) as Record<string, unknown>
      requirePhoto(photos, r.photoId)
      if (seen.has(r.photoId as string)) throw new Error(`items[${i}] 的 photoId 重複`)
      seen.add(r.photoId as string)
      const alt = str(r.alt)
      if (!alt || alt.trim() === '') throw new Error(`items[${i}] 需要 alt`)
      const orientation = oneOf(r.orientation, ORIENTATIONS, `items[${i}].orientation`)
      const caption = str(r.caption)
      return {
        photoId: r.photoId as string,
        alt,
        ...(caption ? { caption } : {}),
        ...(orientation ? { orientation } : {}),
      }
    })
    const caption = str(raw.caption)
    return { kind: 'gallery', layout, items: built, ...(caption ? { caption } : {}) }
  }
  throw new Error('kind 只能是 paragraph / image / gallery')
}

// insertIndex:afterId 省略 = 加在最後;"start" = 最前面;否則插在該區塊後面(找不到就 throw)。
export function insertIndex(blocks: ArticleBlock[], afterId: unknown): number {
  if (afterId === undefined || afterId === null || afterId === '') return blocks.length
  if (afterId === 'start') return 0
  const i = blocks.findIndex((b) => b.id === afterId)
  if (i < 0) throw new Error(`找不到區塊 ${JSON.stringify(afterId)},請呼叫 get_article 查看目前的區塊 id`)
  return i + 1
}

function blockIndex(blocks: ArticleBlock[], id: unknown): number {
  const i = blocks.findIndex((b) => b.id === id)
  if (i < 0) throw new Error(`找不到區塊 ${JSON.stringify(id)},請呼叫 get_article 查看目前的區塊 id`)
  return i
}

function summarize(b: ArticleBlock) {
  switch (b.kind) {
    case 'paragraph':
      return { id: b.id, kind: b.kind, variant: b.variant, text: b.text }
    case 'image':
      return { id: b.id, kind: b.kind, photoId: b.photoId, alt: b.alt, width: b.width, float: b.float }
    case 'gallery':
      return { id: b.id, kind: b.kind, layout: b.layout, photoIds: b.items.map((i) => i.photoId) }
    default:
      return { id: b.id, kind: b.kind }
  }
}

function asArgs(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>
}

export const listPhotos: ClientTool<ArticleEditorHandle> = defineTool(
  'list_photos',
  () => ({}),
  (_args, handle) => {
    const ready = handle.getPhotos().filter((p) => p.status === 'ready')
    const photos = ready.map((p) => {
      const thumb = p.variants?.find((v) => v.kind === 'thumbnail')
      const w = thumb?.width ?? p.width
      const h = thumb?.height ?? p.height
      return {
        photoId: p.id,
        note: p.note ?? '',
        rating: p.rating ?? null,
        orientation: w && h ? (h > w ? 'portrait' : 'landscape') : undefined,
      }
    })
    return { photos, withoutNote: photos.filter((p) => p.note === '').length }
  },
)

export const getArticle: ClientTool<ArticleEditorHandle> = defineTool(
  'get_article',
  () => ({}),
  (_args, handle) => {
    const s = handle.getState()
    return { title: s.title, lede: s.lede, blocks: s.blocks.map(summarize) }
  },
)

export const setMeta: ClientTool<ArticleEditorHandle> = defineTool(
  'set_meta',
  (raw) => {
    const r = asArgs(raw)
    const title = str(r.title)
    const lede = str(r.lede)
    if (title === undefined && lede === undefined) throw new Error('title 與 lede 至少要給一個')
    return { title, lede }
  },
  (args, handle) => {
    const s = handle.getState()
    handle.setState({ ...s, title: args.title ?? s.title, lede: args.lede ?? s.lede })
    return { ok: true }
  },
)

export const addBlock: ClientTool<ArticleEditorHandle> = defineTool('add_block', asArgs, (args, handle) => {
  const s = handle.getState()
  const built = buildBlock(args, handle.getPhotos())
  const block = { ...built, id: newAiBlockId() } as ArticleBlock
  const at = insertIndex(s.blocks, args.afterId)
  const blocks = s.blocks.slice()
  blocks.splice(at, 0, block)
  handle.setState({ ...s, blocks })
  return { id: block.id, position: at + 1, total: blocks.length }
})

export const updateBlock: ClientTool<ArticleEditorHandle> = defineTool('update_block', asArgs, (args, handle) => {
  const s = handle.getState()
  const i = blockIndex(s.blocks, args.id)
  const old = s.blocks[i]
  if (old.kind === 'stop') throw new Error('站點卡片(stop)不支援用工具修改')
  // 以舊區塊為底、套用新參數後整體重新驗證;kind 不可改。
  const { id: _id, afterId: _afterId, ...patch } = args
  void _id
  void _afterId
  if (patch.kind !== undefined && patch.kind !== old.kind) {
    throw new Error('不能改變區塊的 kind;要換種類請 remove_block 後 add_block')
  }
  const merged = buildBlock({ ...old, ...patch, kind: old.kind }, handle.getPhotos())
  const blocks = s.blocks.slice()
  blocks[i] = { ...merged, id: old.id } as ArticleBlock
  handle.setState({ ...s, blocks })
  return { ok: true }
})

export const moveBlock: ClientTool<ArticleEditorHandle> = defineTool('move_block', asArgs, (args, handle) => {
  const s = handle.getState()
  const from = blockIndex(s.blocks, args.id)
  if (args.afterId === args.id) throw new Error('afterId 不能是自己')
  const blocks = s.blocks.slice()
  const [moved] = blocks.splice(from, 1)
  const at = insertIndex(blocks, args.afterId)
  blocks.splice(at, 0, moved)
  handle.setState({ ...s, blocks })
  return { ok: true, position: at + 1 }
})

export const removeBlock: ClientTool<ArticleEditorHandle> = defineTool('remove_block', asArgs, (args, handle) => {
  const s = handle.getState()
  const i = blockIndex(s.blocks, args.id)
  const blocks = s.blocks.slice()
  blocks.splice(i, 1)
  handle.setState({ ...s, blocks })
  return { ok: true, total: blocks.length }
})

// saveArticle:把編輯器目前的文章存成草稿。規則(刻意保守):不碰發佈、已發佈的文章拒絕、沒有標題或沒有內容不存。
// 呼叫前 thought 要求 AI 先問過使用者;這裡是最後一道防線。
export const saveArticle: ClientTool<ArticleEditorHandle> = defineTool(
  'save_article',
  () => ({}),
  async (_args, handle) => {
    if (handle.isPublished()) {
      throw new Error('這篇文章已發佈,不能由 AI 直接存檔(會覆蓋公開內容)。請告訴使用者自己按「儲存」,或先取消發布。')
    }
    const s = handle.getState()
    if (s.title.trim() === '') throw new Error('文章還沒有標題,請先用 set_meta 設定 title 再存檔')
    if (s.blocks.length === 0) throw new Error('文章還沒有任何區塊,沒有內容可以存')
    const r = await handle.save()
    return { ok: true, slug: r.slug, created: r.created, status: 'draft' }
  },
)

export function createArticleTools(): ClientTool<ArticleEditorHandle>[] {
  return [listPhotos, getArticle, setMeta, addBlock, updateBlock, moveBlock, removeBlock, saveArticle]
}
