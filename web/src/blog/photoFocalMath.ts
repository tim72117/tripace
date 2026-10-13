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

/** TARGET_CROP_RATIO:焦點編輯器裁切框固定採用的寬高比——對齊
 *  BlogArticle.css 裡最常見的橫式單圖顯示比例(.theme-page-demo-stop-
 *  gallery img 的 aspect-ratio: 1.5 / 1)。文章橫式照片實際展示時還會
 *  用到其他比例(1.4/1 單圖版、1.6/1、手機版 1.37/1),這裡只能取一個
 *  代表值當編輯器的裁切框,換算到其他橫式比例時仍會有一定誤差——跟
 *  原本「點一個焦點座標」的設計本質上是同一種取捨,只是改成框選後這個
 *  取捨對使用者是可見、可預期的(看得到框目前裁到哪裡),不是看不見的
 *  黑盒子換算。
 *  2026-10 修正:直式照片不再是這種「取代表值、留誤差」的關係——
 *  BlogArticle.css 的直式裁切比例(1/1.5,見該檔案 data-orientation=
 *  "portrait" 規則的完整說明)已改成直接等於這裡鏡像算出的
 *  1/TARGET_CROP_RATIO,兩者精確一致,不是近似值。只有橫式照片仍維持
 *  上述「代表值」的取捨(文章橫式版位比例種類較多,無法逐一對齊)。 */
export const TARGET_CROP_RATIO = 1.5

/** CropBoxGeometry:裁切框相對於原圖的尺寸與可拖動軸。框永遠貼齊原圖的
 *  短邊方向(框在該方向撐滿 100%),只能沿長邊方向拖動——例如直幅原圖
 *  (寬高比小於 TARGET_CROP_RATIO)時,框寬度=原圖寬度(撐滿橫向),框
 *  高度 = 寬度 / TARGET_CROP_RATIO,使用者只能上下拖動框。 */
export interface CropBoxGeometry {
  /** 框寬度,原圖寬度的相對比例(0~1) */
  widthRatio: number
  /** 框高度,原圖高度的相對比例(0~1) */
  heightRatio: number
  /** 可拖動的軸:框在這個方向比原圖短,才有拖動空間 */
  dragAxis: 'x' | 'y' | 'none'
}

/** cropBoxGeometry:依原圖寬高比算出裁切框的幾何——imageAspectRatio 是
 *  原圖的寬/高。
 *
 *  目標比例依原圖本身是橫式還是直式鏡像對調——橫式原圖用
 *  TARGET_CROP_RATIO:1,直式原圖用鏡像的 1:TARGET_CROP_RATIO。原本
 *  固定用橫式的 TARGET_CROP_RATIO,會讓直幅原圖(例如手機直拍人像)
 *  算出一個「貼齊寬度、但高度被壓得極扁」的橫式框,框內幾乎看不到
 *  人像主體,體驗很差。依方向鏡像對調後,直式原圖得到一個直的裁切框,
 *  貼齊寬度、沿垂直方向拖動,符合「框與短邊對齊,在長邊移動」的直覺。
 *  2026-10 修正:直式這個鏡像比例(1/TARGET_CROP_RATIO)現在跟
 *  BlogArticle.css 的直式顯示比例(data-orientation="portrait" 規則)
 *  精確一致,編輯器裡拖拉確認的框就是文章最終呈現的裁切範圍(橫式
 *  仍是取代表值、留誤差,見 TARGET_CROP_RATIO 常數定義的完整說明)。
 *
 *  寬高比剛好等於目標比例時框貼合整張原圖,dragAxis 為 'none'(無法
 *  拖動,也不需要)。 */
export function cropBoxGeometry(imageAspectRatio: number): CropBoxGeometry {
  if (!Number.isFinite(imageAspectRatio) || imageAspectRatio <= 0) {
    return { widthRatio: 1, heightRatio: 1, dragAxis: 'none' }
  }
  // 原圖本身是橫式(寬>=高)用 TARGET_CROP_RATIO:1,直式(高>寬)用鏡像
  // 的 1:TARGET_CROP_RATIO——用原圖比例跟 1 比較,不是跟
  // TARGET_CROP_RATIO 比較,才是依「原圖方向」而非「原圖是否比目標框
  // 更寬」決定要套用哪一種目標比例。
  const targetRatio = imageAspectRatio >= 1 ? TARGET_CROP_RATIO : 1 / TARGET_CROP_RATIO
  if (imageAspectRatio > targetRatio) {
    // 原圖比目標更寬——框貼齊原圖的高(短邊),寬度縮小,沿水平方向拖動。
    const heightRatio = 1
    const widthRatio = clamp01(targetRatio / imageAspectRatio)
    return { widthRatio, heightRatio, dragAxis: widthRatio < 1 ? 'x' : 'none' }
  }
  if (imageAspectRatio < targetRatio) {
    // 原圖比目標更窄(較高)——框貼齊原圖的寬(短邊),高度縮小,沿垂直
    // 方向拖動。
    const widthRatio = 1
    const heightRatio = clamp01(imageAspectRatio / targetRatio)
    return { widthRatio, heightRatio, dragAxis: heightRatio < 1 ? 'y' : 'none' }
  }
  return { widthRatio: 1, heightRatio: 1, dragAxis: 'none' }
}

/** focalFromCropOffset:把「裁切框中心在可拖動軸上的位置」(0~1,0 是
 *  該軸最靠左/上、1 是最靠右/下)換算成 FocalPoint——短邊方向固定置中
 *  (0.5),長邊方向用 offset 換算成框中心在原圖座標系中的實際位置。
 *  跟 cropOffsetFromFocal 互為反函式。 */
export function focalFromCropOffset(geometry: CropBoxGeometry, offset: number): FocalPoint {
  const o = clamp01(offset)
  if (geometry.dragAxis === 'x') {
    // 框中心可移動範圍是 [widthRatio/2, 1 - widthRatio/2],offset=0 對應
    // 最左、offset=1 對應最右。
    const half = geometry.widthRatio / 2
    const x = half + o * (1 - geometry.widthRatio)
    return { x: clamp01(x), y: 0.5 }
  }
  if (geometry.dragAxis === 'y') {
    const half = geometry.heightRatio / 2
    const y = half + o * (1 - geometry.heightRatio)
    return { x: 0.5, y: clamp01(y) }
  }
  return { x: 0.5, y: 0.5 }
}

/** cropOffsetFromFocal:focalFromCropOffset 的反函式——從既有 FocalPoint
 *  還原出框目前該在的 offset(0~1),讓已經設定過焦點的照片一打開編輯器
 *  框就定位在正確位置,不會每次都從置中開始。dragAxis 為 'none' 時框
 *  固定置中,回傳 0.5。 */
export function cropOffsetFromFocal(geometry: CropBoxGeometry, focal: FocalPoint): number {
  if (geometry.dragAxis === 'x') {
    const half = geometry.widthRatio / 2
    const span = 1 - geometry.widthRatio
    if (span <= 0) return 0.5
    return clamp01((focal.x - half) / span)
  }
  if (geometry.dragAxis === 'y') {
    const half = geometry.heightRatio / 2
    const span = 1 - geometry.heightRatio
    if (span <= 0) return 0.5
    return clamp01((focal.y - half) / span)
  }
  return 0.5
}

/** offsetFromPointerEvent:把一次點擊/拖曳事件在「可拖動軌道」容器裡的
 *  像素座標轉成 0~1 的 offset——跟 pointFromPointerEvent 共用「除以容器
 *  尺寸、clamp 在 0~1」的邏輯,但只取 dragAxis 指定的單一軸,且容器本身
 *  就代表「可移動範圍」而非整張原圖(呼叫端用框的可移動距離當容器尺寸,
 *  見 PhotoFocalEditor.tsx 的完整說明)。 */
export function offsetFromPointerEvent(
  clientPos: number,
  rect: { start: number; length: number },
): number {
  if (rect.length <= 0) return 0.5
  return clamp01((clientPos - rect.start) / rect.length)
}
