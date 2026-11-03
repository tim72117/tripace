// stagedPhotos——「已選檔、已在前端縮圖、尚未上傳」的圖片(PhotoManagerBody 的待上傳區)讓文章編輯器與 AI 工具也能用。
//
// 做法:待上傳圖片在編輯器裡以合成的 UploadedPhoto 出現,id 為 `staged:<key>`(status 'ready',縮圖網址是本機 object URL)。
// 區塊的 photoId 可以直接存這個 id,編輯器畫面、選圖器、AI 的 list_photos / add_block 全都照常運作;
// 按「儲存」前才真正上傳(PhotoManagerBody.uploadStaged),成功後把區塊裡的 `staged:<key>` 換成後端給的真實 photoId。
// 所以後端存的內容永遠不會含 `staged:` 開頭的 id。
import type { UploadedPhoto } from '../api'
import type { ArticleBlock } from './articleTools'

export const STAGED_PREFIX = 'staged:'

export interface StagedPhotoView {
  key: string
  filename: string
  note?: string
  previewUrl: string
  width?: number
  height?: number
}

export function stagedPhotoId(key: string): string {
  return STAGED_PREFIX + key
}

export function isStagedId(photoId: string): boolean {
  return photoId.startsWith(STAGED_PREFIX)
}

export function stagedKeyOf(photoId: string): string {
  return photoId.slice(STAGED_PREFIX.length)
}

export function stagedToPhoto(s: StagedPhotoView): UploadedPhoto {
  const now = new Date(0).toISOString()
  return {
    id: stagedPhotoId(s.key),
    ownerId: '',
    originalUrl: s.previewUrl,
    status: 'ready',
    ...(s.note ? { note: s.note } : {}),
    ...(s.width && s.height ? { width: s.width, height: s.height } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

// combinePhotos:後端素材庫在後、待上傳在前(剛選的圖放最前面,跟待上傳區的排列順序一致)。
export function combinePhotos(server: UploadedPhoto[], staged: StagedPhotoView[]): UploadedPhoto[] {
  return [...staged.map(stagedToPhoto), ...server]
}

function photoIdsOf(block: ArticleBlock): string[] {
  if (block.kind === 'image') return [block.photoId]
  if (block.kind === 'gallery') return block.items.map((it) => it.photoId)
  return []
}

// stagedIdsIn:區塊裡引用到的待上傳圖片 id(去重)。
export function stagedIdsIn(blocks: ArticleBlock[]): string[] {
  const out = new Set<string>()
  for (const b of blocks) for (const id of photoIdsOf(b)) if (isStagedId(id)) out.add(id)
  return [...out]
}

// dropStagedBlocks:拿掉仍引用待上傳圖片(沒能上傳成功)的部分,供「照片上傳失敗仍先存文章」使用:
// image 區塊直接移除;gallery 去掉那幾張,剩 0 張就整個移除。回傳 skipped=被略過的圖片張數。
export function dropStagedBlocks(blocks: ArticleBlock[]): { blocks: ArticleBlock[]; skipped: number } {
  let skipped = 0
  const out: ArticleBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'image' && isStagedId(b.photoId)) {
      skipped += 1
    } else if (b.kind === 'gallery' && b.items.some((it) => isStagedId(it.photoId))) {
      const kept = b.items.filter((it) => !isStagedId(it.photoId))
      skipped += b.items.length - kept.length
      if (kept.length > 0) out.push({ ...b, items: kept })
    } else {
      out.push(b)
    }
  }
  return { blocks: out, skipped }
}

// remapPhotoIds:依對照表(舊 photoId → 新 photoId)換掉 image / gallery 區塊裡的 id;沒有任何變動時回傳原陣列。
export function remapPhotoIds(blocks: ArticleBlock[], map: Record<string, string>): ArticleBlock[] {
  let changed = false
  const next = blocks.map((b) => {
    if (b.kind === 'image' && map[b.photoId]) {
      changed = true
      return { ...b, photoId: map[b.photoId] }
    }
    if (b.kind === 'gallery' && b.items.some((it) => map[it.photoId])) {
      changed = true
      return { ...b, items: b.items.map((it) => (map[it.photoId] ? { ...it, photoId: map[it.photoId] } : it)) }
    }
    return b
  })
  return changed ? next : blocks
}
