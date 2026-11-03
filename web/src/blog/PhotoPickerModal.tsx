import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import * as api from '../api'
import { Button } from '../components/Button'
import styles from './ArticleEditor.module.css'

// PhotoPickerModal:插入圖片/圖組時,從「圖片素材庫」(本檔下方掛載的
// PhotoManagerBody 讀的同一份清單)挑選要引用的 photoId——對齊
// types.ts ImageBlock.photoId 的完整說明:內容裡只存穩定識別碼,不是
// 檔案路徑/網址。gallery 模式(multi)最少選 2 張、最多 4 張(見
// GalleryBlock.items 的完整說明,對齊 Medium/Ghost 刻意訂低張數上限的
// 慣例),選好後一次性建立一個 gallery block;single 模式選一張立刻
// 插入一個 image block。
export function PhotoPickerModal({
  photos,
  mode,
  title,
  onClose,
  onConfirm,
}: {
  photos: api.UploadedPhoto[]
  mode: 'single' | 'multi'
  title?: string
  onClose: () => void
  onConfirm: (selected: api.UploadedPhoto[]) => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Esc 關閉(頭像、封面、插入圖片都用這個選圖器,鍵盤使用者不該只能點右上角的 X)。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const readyPhotos = photos.filter((p) => p.status === 'ready')

  function toggle(photo: api.UploadedPhoto) {
    if (mode === 'single') {
      onConfirm([photo])
      return
    }
    setSelectedIds((prev) =>
      prev.includes(photo.id) ? prev.filter((id) => id !== photo.id) : prev.length >= 4 ? prev : [...prev, photo.id],
    )
  }

  const canConfirmMulti = mode === 'multi' && selectedIds.length >= 2

  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div
        className={`rp-modal ${styles.pickerModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? (mode === 'single' ? '選擇一張圖片' : '選擇圖片')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.pickerHead}>
          <span className={styles.pickerTitle}>{title ?? (mode === 'single' ? '選擇一張圖片' : '選擇 2~4 張圖片(多圖組)')}</span>
          <button type="button" className={styles.pickerClose} onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        {readyPhotos.length === 0 ? (
          <div className={styles.pickerEmpty}>素材庫還沒有可用的圖片——先在下方「圖片素材庫」上傳並等待處理完成。</div>
        ) : (
          <div className={styles.pickerGrid}>
            {readyPhotos.map((p) => {
              const thumb = p.variants?.find((v) => v.kind === 'thumbnail')
              const selected = selectedIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.pickerItem}${selected ? ` ${styles.pickerItemSelected}` : ''}`}
                  onClick={() => toggle(p)}
                >
                  <img src={thumb?.url ?? p.originalUrl} alt="" className={styles.pickerItemImg} />
                  {selected && <span className={styles.pickerItemCheck}>✓</span>}
                </button>
              )
            })}
          </div>
        )}
        {mode === 'multi' && (
          <div className={styles.pickerFooter}>
            <span className={styles.pickerHint}>已選 {selectedIds.length} / 4</span>
            <Button
              variant="primary"
              compact
              disabled={!canConfirmMulti}
              onClick={() => onConfirm(selectedIds.map((id) => readyPhotos.find((p) => p.id === id)!))}
            >
              插入圖組
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
