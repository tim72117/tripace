// photoFocalMath.ts——PhotoFocalEditor/PhotoManagerPage 用到的純計算邏輯,
// 獨立成檔案方便單元測試(比照 scrollTimelineGrouping.ts 把純計算邏輯跟
// 元件渲染拆開的既有慣例,見該檔案開頭的完整說明)。

/** 圖片裁切焦點(0~1 相對座標)——跟 web/src/blog/types.ts 的 FocalPoint
 *  是同一套座標系統(0,0 左上角、1,1 右下角),這裡編輯的是 UploadedPhoto
 *  本身的焦點,不是文章內容 ImageBlock/GalleryBlock 的 focal 欄位(見
 *  api.ts setPhotoFocal 的完整說明)。 */
export interface FocalPoint {
  x: number
  y: number
}

/** clamp01:把數值限制在 0~1 之間——使用者在圖片容器邊緣點擊/拖曳時,
 *  滑鼠座標可能因為捕捉事件(pointer capture)在按住拖曳時跑出容器
 *  邊界外一點點,算出來的相對比例會略小於 0 或大於 1,後端
 *  handleBlogPhotoFocal 對超出 0~1 範圍的值一律回 400(見該 handler 的
 *  完整說明),前端在送出前先 clamp 避免這種使用者體驗(拖到邊緣卻儲存
 *  失敗)。 */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** pointFromPointerEvent:把一次點擊/拖曳事件在「圖片容器」裡的像素座標
 *  (clientX/clientY 與容器的 getBoundingClientRect())轉成 0~1 的相對
 *  焦點座標,並 clamp 在範圍內。容器尺寸為 0(極端情況,例如量測時機
 *  不對/容器尚未 layout)時退回置中(0.5, 0.5),避免除以 0 產生 NaN。 */
export function pointFromPointerEvent(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): FocalPoint {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0.5, y: 0.5 }
  }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

/** objectPositionFor:把 FocalPoint 轉成 CSS object-position 的百分比
 *  語法——公式對齊 BlogArticlePage.tsx 既有的 objectPositionFor(見該
 *  檔案的完整說明),刻意在這裡自己寫一份等價的小函式而不直接 import,
 *  避免這個獨立功能跟部落格文章展示頁耦合(該檔案的函式是模組內部
 *  helper,未匯出)。沒有焦點時回傳 undefined,讓瀏覽器使用
 *  object-position 的 CSS 預設值(50% 50%,置中裁切)。 */
export function objectPositionFor(focal?: FocalPoint): string | undefined {
  if (!focal) return undefined
  return `${focal.x * 100}% ${focal.y * 100}%`
}

/** PhotoDisplayStatus:圖片清單每一筆該顯示哪種狀態 UI 的判斷結果——把
 *  "pending"/"ready"/"failed" 以外的未知字串值(理論上不會發生,但後端
 *  status 是純字串非型別安全的列舉)也收斂進明確的三態,呼叫端不需要
 *  自己處理「兩者都不是」的第四種分支。未知值保守視為 pending(畫面上
 *  顯示處理中,而非誤判成 ready 允許點擊進入焦點編輯器、或誤判成 failed
 *  顯示錯誤讓使用者誤按重試)。 */
export type PhotoDisplayStatus = 'pending' | 'ready' | 'failed'

export function photoDisplayStatus(status: string): PhotoDisplayStatus {
  if (status === 'ready') return 'ready'
  if (status === 'failed') return 'failed'
  return 'pending'
}

/** canEditFocal:只有 ready 狀態的圖片才能點擊進入焦點編輯器——pending
 *  還沒有可用的 variants/尺寸資訊,failed 則根本沒有成功產生的衍生版本
 *  可供即時預覽。 */
export function canEditFocal(status: string): boolean {
  return photoDisplayStatus(status) === 'ready'
}
