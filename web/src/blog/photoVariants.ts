// photoVariants——上傳部落格圖片前,在瀏覽器端用 canvas 產生各尺寸的縮圖(2026-10 起縮圖
// 統一由前端產生,後端縮圖先關閉,見 server Server.blogPhotoServerResize)。
//
// 三種尺寸(最長邊,等比例縮放、不放大、不裁切):
//  - thumbnail 400:列表/編輯器縮圖。
//  - large 1600:文章內文顯示。
//  - llm 1024:給 LLM 看圖推論用(例如自動產生圖片備註)。刻意跟上面兩種不同:400 太小,
//    LLM 看不清細節與文字;1600 對推論是多餘的,只會拉高 token 成本與上傳時間。
// 輸出一律 JPEG(後端只收 JPEG,見 handleBlogPhotoVariantUpload),canvas 輸出不含 EXIF,
// 解碼時已套用方向(imageOrientation: 'from-image'),所以不會有轉向問題。

export type PhotoVariantKind = 'thumbnail' | 'large' | 'llm'

export interface VariantSpec {
  maxEdge: number
  quality: number
}

export const VARIANT_SPECS: Record<PhotoVariantKind, VariantSpec> = {
  thumbnail: { maxEdge: 400, quality: 0.85 },
  large: { maxEdge: 1600, quality: 0.9 },
  llm: { maxEdge: 1024, quality: 0.8 },
}

// 上傳順序:顯示必需的 thumbnail/large 先上傳,選填的 llm 最後(失敗不影響顯示)。
export const VARIANT_KINDS: PhotoVariantKind[] = ['thumbnail', 'large', 'llm']

// fitWithin:把 width×height 等比例縮到最長邊不超過 maxEdge;原圖已經比 maxEdge 小就維持原尺寸
// (不放大)。回傳四捨五入後的整數尺寸,最小為 1。
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('瀏覽器無法輸出縮圖'))),
      'image/jpeg',
      quality,
    )
  })
}

// generatePhotoVariants:解碼一次原圖,依 VARIANT_SPECS 產生三種 JPEG 縮圖。瀏覽器無法解碼
// 的格式(例如部分瀏覽器的 HEIC)會丟出錯誤,呼叫端應在建立上傳記錄「之前」呼叫,失敗就不上傳。
export async function generatePhotoVariants(file: Blob): Promise<Record<PhotoVariantKind, Blob>> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('無法讀取這張圖片(瀏覽器不支援此格式)')
  }
  try {
    const out = {} as Record<PhotoVariantKind, Blob>
    for (const kind of VARIANT_KINDS) {
      const { maxEdge, quality } = VARIANT_SPECS[kind]
      const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('瀏覽器無法建立畫布')
      // PNG 透明底轉 JPEG 會變黑,先鋪白底。
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
      out[kind] = await canvasToJpeg(canvas, quality)
    }
    return out
  } finally {
    bitmap.close()
  }
}
