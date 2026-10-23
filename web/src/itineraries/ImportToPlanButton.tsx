import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { isTimelineEmpty, type PlanTimeline } from '../planning/timeline/model'
import { importTimelineToPlanDraft } from './importToPlanDraft'
import styles from './AiItineraryDetailPageMapView.module.css'

// ImportToPlanButton——行程詳情頁的「帶入我的規劃」按鈕:把這份行程的站點寫進登入後的規劃草稿,成功後前往 /app
// (訪客到 /app 會先看到登入畫面,登入後打開規劃面板即可看到,草稿存在瀏覽器 localStorage)。
// 草稿已有內容時,在按鈕下方展開頁內的確認列(不用瀏覽器原生的 confirm 視窗):「取代並帶入」才寫入,「取消」或按 Esc 收起;
// 寫入失敗在按鈕下方顯示訊息,不跳轉。
export const IMPORT_REPLACE_MESSAGE = '目前已經有規劃草稿,帶入會取代它。'

export function ImportToPlanButton({ timeline }: { timeline: PlanTimeline }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasStops = !isTimelineEmpty(timeline)

  const run = (replaceExisting: boolean) => {
    setError(null)
    const result = importTimelineToPlanDraft(timeline, { replaceExisting })
    if (result === 'saved') navigate('/app')
    else if (result === 'needs_confirm') setConfirming(true)
    else setError('帶入失敗:瀏覽器的儲存空間無法使用')
    if (result !== 'needs_confirm') setConfirming(false)
  }

  return (
    <div
      className={styles.importWrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setConfirming(false)
      }}
    >
      <button type="button" className={styles.importBtn} onClick={() => run(false)} disabled={!hasStops}>
        <CalendarPlus size={14} strokeWidth={2} aria-hidden="true" />
        帶入我的規劃
      </button>
      {confirming && (
        <div className={styles.importConfirm} role="alertdialog" aria-label="確認取代規劃草稿">
          <p className={styles.importConfirmText}>{IMPORT_REPLACE_MESSAGE}</p>
          <div className={styles.importConfirmActions}>
            <button type="button" className={styles.importConfirmCancel} onClick={() => setConfirming(false)} autoFocus>
              取消
            </button>
            <button type="button" className={styles.importConfirmOk} onClick={() => run(true)}>
              取代並帶入
            </button>
          </div>
        </div>
      )}
      {error && <p className={styles.importError} role="alert">{error}</p>}
    </div>
  )
}
