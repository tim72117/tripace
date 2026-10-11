import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ClientConfig, UploadedPhoto } from '../api'
import * as api from '../api'
import { ErrorBanner, errMsg } from '../AppCommon'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { clamp01, objectPositionFor, pointFromPointerEvent, type FocalPoint } from './photoFocalMath'
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
// 進入編輯器時若 photo.focalX/focalY 已經有值,用現有值初始化圓點位置與
// 預覽,不是每次都從置中開始(任務規格明確要求)——沒有值(nil/undefined,
// 從未設定過)時才退回置中(0.5, 0.5),理由同 objectPositionFor 的 CSS
// 預設值語意:沒有明確焦點時以置中裁切處理。
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
  const imageAreaRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  // 預覽用的 variant——優先用 "thumbnail"(縮圖通常是裁切最明顯的情境,
  // 任務規格明確建議),查無則退回原圖本身(預覽畫面仍然正確,只是
  // object-fit:cover 的裁切幅度較不明顯)。
  const previewVariant = photo.variants?.find((v) => v.kind === 'thumbnail')
  const previewURL = previewVariant?.url ?? photo.originalUrl

  function updateFocalFromEvent(e: { clientX: number; clientY: number }) {
    const el = imageAreaRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setFocal(pointFromPointerEvent(e.clientX, e.clientY, rect))
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
        <div className={styles.hint}>
          點擊或拖曳下方原圖,標出照片的主體位置——縮圖裁切時會盡量保留這個位置。
        </div>
        <div
          ref={imageAreaRef}
          className={styles.imageArea}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <img src={photo.originalUrl} alt="原圖" className={styles.originalImage} draggable={false} />
          <div
            className={styles.focalDot}
            style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
          />
        </div>

        <div className="section-title">預覽(縮圖效果)</div>
        <div className={styles.previewBox}>
          <img
            src={previewURL}
            alt="預覽"
            className={styles.previewImage}
            style={{ objectPosition: objectPositionFor(focal) }}
          />
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
