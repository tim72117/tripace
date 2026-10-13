import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ClientConfig, UploadedPhoto } from '../api'
import * as api from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import {
  clamp01,
  cropBoxGeometry,
  cropOffsetFromFocal,
  focalFromCropOffset,
  offsetFromPointerEvent,
  type CropBoxGeometry,
  type FocalPoint,
} from './photoFocalMath'
import styles from './PhotoFocalEditor.module.css'

// PhotoFocalEditor:焦點編輯器彈窗本體——只處理「已經是 ready 狀態」的
// 圖片(呼叫端 PhotoManagerPage 已經用 canEditFocal 擋掉 pending/failed
// 的點擊,這裡不重複檢查)。
//
// 外層骨架沿用 .rp-modal-head/.rp-modal-body(跟 TripManageModal.tsx 同一套
// 置中卡片彈窗,見該檔案開頭的完整說明),不自創一套新的 Modal 樣式——
// backdrop/置中卡片本身由呼叫端(PhotoManagerPage)用 .rp-modal-backdrop/
// .rp-modal 包住,這裡只負責骨架內部的內容。
//
// 進入編輯器時若 photo.focalX/focalY 已經有值,用現有值初始化裁切框位置,
// 不是每次都從置中開始(任務規格明確要求)——沒有值(nil/undefined,從未
// 設定過)時才退回置中(0.5, 0.5),理由同 BlogArticlePage.tsx
// objectPositionFor 的 CSS 預設值語意:沒有明確焦點時以置中裁切處理。
function initialFocal(photo: UploadedPhoto): FocalPoint {
  if (photo.focalX != null && photo.focalY != null) {
    return { x: photo.focalX, y: photo.focalY }
  }
  return { x: 0.5, y: 0.5 }
}

export function PhotoFocalEditor({
  cfg,
  photo,
  onClose,
  onSaved,
}: {
  cfg: ClientConfig
  photo: UploadedPhoto
  onClose: () => void
  // onSaved:儲存成功後呼叫,讓呼叫端(PhotoManagerPage)更新列表裡這張
  // 圖片的 focalX/focalY,不需要重新整理整個列表。
  onSaved: (focal: FocalPoint) => void
}) {
  const [focal, setFocal] = useState<FocalPoint>(() => initialFocal(photo))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // geometry:null 代表原圖還沒載入完成(onLoad 尚未觸發),拿不到
  // naturalWidth/naturalHeight,裁切框還算不出來——這段期間先不顯示框,
  // 避免用錯誤的 1:1 預設幾何閃一下再跳正確位置。
  const [geometry, setGeometry] = useState<CropBoxGeometry | null>(null)
  // imageRef(非外層容器 imageAreaRef)量測拖動範圍——.originalImage 有
  // max-height 限制(見 PhotoFocalEditor.module.css),超高直幅圖被
  // max-height 卡住時,圖片實際寬度會小於容器寬度(object-fit: contain
  // 留白),這種情況下容器尺寸 ≠ 圖片實際顯示尺寸,必須量測 <img> 本身
  // 的 rect 才準確。
  const imageRef = useRef<HTMLImageElement | null>(null)
  const draggingRef = useRef(false)

  // handleImageLoad:原圖載入完成後才拿得到實際像素寬高,算出裁切框的
  // 幾何(cropBoxGeometry,見 photoFocalMath.ts 的完整說明)。框的畫面
  // 位置直接用 focal.x/focal.y(框中心)減半個框寬/高算出左上角(見下方
  // JSX),不需要額外反推——已經設定過焦點的照片,initialFocal 已經把
  // 既有值帶進 focal state,框一開始就會落在正確位置。
  //
  // 載入時用 cropOffsetFromFocal → focalFromCropOffset 把既有 focal
  // 校正成目前幾何下的合法值(2026-10 code review 修正,接上原本定義了
  // 卻沒有任何呼叫端使用的 cropOffsetFromFocal 死碼)——這兩個函式互為
  // 反函式,正常情況下(focal 本來就落在短邊固定 0.5、長邊合法範圍內)
  // 這趟來回不會改變 focal 的值,只有在 focal 不符合目前幾何限制時才
  // 會把它拉回合法值,包含:
  //   - dragAxis==='none'(框貼合整張原圖,無偏移空間):
  //     cropOffsetFromFocal 回傳 0.5,focalFromCropOffset(0.5) 回傳
  //     置中,等同強制校正為置中。
  //   - 短邊方向不是 0.5 的舊資料(理論上不該發生,但無法排除歷史髒
  //     資料):校正回短邊固定 0.5。
  // 原本沒有這段校正時,若 focal 跟目前幾何不符,框會顯示在錯誤位置,
  // 且使用者完全無法透過拖曳/點擊修正(updateFocalFromEvent 對
  // dragAxis==='none' 直接 return,等同卡死;對 'x'/'y' 軸則只能拖到
  // 合法範圍內,但初始錯誤位置的視覺跳動仍會發生)。
  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    const ratio = img.naturalWidth / img.naturalHeight
    const g = cropBoxGeometry(ratio)
    setGeometry(g)
    setFocal((prev) => focalFromCropOffset(g, cropOffsetFromFocal(g, prev)))
  }

  // dragTrackRect:目前拖動軸上「可移動範圍」對應的螢幕座標區間——不是
  // 整張原圖的 rect,而是框中心可以移動到的那一段距離(原圖在該方向的
  // 長度扣掉框本身的寬/高)。呼叫端拿這個區間去算 offsetFromPointerEvent,
  // 等同把「框可移動範圍」當成拖曳的參考容器。
  function dragTrackRect(g: CropBoxGeometry): { start: number; length: number } | null {
    const el = imageRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (g.dragAxis === 'x') {
      const boxWidth = rect.width * g.widthRatio
      return { start: rect.left + boxWidth / 2, length: rect.width - boxWidth }
    }
    if (g.dragAxis === 'y') {
      const boxHeight = rect.height * g.heightRatio
      return { start: rect.top + boxHeight / 2, length: rect.height - boxHeight }
    }
    return null
  }

  function updateFocalFromEvent(e: { clientX: number; clientY: number }) {
    if (!geometry || geometry.dragAxis === 'none') return
    const track = dragTrackRect(geometry)
    if (!track) return
    const clientPos = geometry.dragAxis === 'x' ? e.clientX : e.clientY
    const offset = offsetFromPointerEvent(clientPos, track)
    setFocal(focalFromCropOffset(geometry, offset))
    setSaved(false)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    updateFocalFromEvent(e)
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    updateFocalFromEvent(e)
  }
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const x = clamp01(focal.x)
      const y = clamp01(focal.y)
      await api.setPhotoFocal(cfg, photo.id, x, y)
      setSaved(true)
      onSaved({ x, y })
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="rp-modal-head">
        <span className="rp-modal-title">設定裁切焦點</span>
        <IconButton onClick={onClose} title="關閉">
          <X size={18} strokeWidth={1.8} />
        </IconButton>
      </div>
      <div className="rp-modal-body">
        <ErrorBanner msg={err} />
        {/* dragAxis==='none' 時另外顯示「無需調整」提示(2026-10 code
            review 修正)——原本沒有這段文字時,使用者對這類原圖(比例
            剛好貼合目標裁切框)拖曳/點擊完全沒有反應,容易誤以為互動
            功能壞掉,而不是理解成「已經是最佳位置,不需要調整」。 */}
        <div className={styles.hint}>
          {geometry?.dragAxis === 'none'
            ? '這張照片的比例剛好貼合裁切框,已經是最佳位置,不需要調整。'
            : '拖曳下方的方框,選出照片要保留在畫面裡的位置——方框的比例跟文章實際顯示的裁切框一致。'}
        </div>
        <div className={styles.imageArea}>
          <div
            className={styles.imageWrap}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <img
              ref={imageRef}
              src={photo.originalUrl}
              alt="原圖"
              className={styles.originalImage}
              draggable={false}
              onLoad={handleImageLoad}
            />
            {geometry && (
              // 框的 left/top 是「左上角」位置,focal.x/focal.y 是框的
              // 中心,兩者差半個框寬/高——跟 cropBoxGeometry/
              // focalFromCropOffset 使用同一套「focal = 框中心」的語意
              // (見 photoFocalMath.ts 的完整說明),不透過 offset 中轉,
              // 避免多一層換算累積誤差。
              <div
                className={styles.cropBox}
                style={{
                  left: `${(focal.x - geometry.widthRatio / 2) * 100}%`,
                  top: `${(focal.y - geometry.heightRatio / 2) * 100}%`,
                  width: `${geometry.widthRatio * 100}%`,
                  height: `${geometry.heightRatio * 100}%`,
                  cursor:
                    geometry.dragAxis === 'x' ? 'ew-resize' : geometry.dragAxis === 'y' ? 'ns-resize' : 'default',
                }}
              />
            )}
          </div>
        </div>

        <div className={styles.actionRow}>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? '儲存中…' : saved ? '✅ 已儲存' : '儲存'}
          </Button>
        </div>
      </div>
    </>
  )
}
