import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { GeoAttraction } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { attractionBadges } from './geoInfoContent'
import { dayGroupLabel, type GeoCandidate } from './geoCandidateHelpers'
import styles from './GeoOutlinePhoneInfoSheet.module.css'

// candidateHasScheduledDate:同桌面版 GeoInfoPanel.tsx 的同名函式(該檔案
// 沒有 export,這裡是獨立的一份極簡複製,不是共用同一個函式)——只有
// kind==='entry' 且 start 非空字串的候選才符合。供下方「加入候選」按鈕
// 決定要不要先跳日期選擇,見 handleAddClick 的說明。
function candidateHasScheduledDate(c: GeoCandidate): boolean {
  return c.kind === 'entry' && !!c.start
}

// GeoOutlinePhoneInfoSheet:手機版規劃地圖資訊卡,從畫面下方滑入蓋住下
// 半部——桌面版對應的 GeoInfoPanel/AttractionInfoPanel 是絕對定位疊在
// 地圖右緣的浮動卡片,手機螢幕沒有那個空間,改用 bottom sheet(同 iOS/
// Material Design 地圖 App 的資訊卡呈現方式)。
//
// 第二階段新增候選籃相關按鈕與互動(第一階段唯讀瀏覽時特意拿掉,見舊版
// 註解)——「加入候選」按鈕行為對齊桌面版 GeoInfoPanel.tsx 的
// handleAddClick 分岔邏輯,但簡化掉「懸浮選單 vs 展開日曆」的位置量測
// (dateMenuOpenUp,桌面版是因為卡片可能出現在視窗下半部、選單需要
// 動態翻轉方向;這裡的 bottom sheet 本身已經是從下滑入、卡片內容本來就
// 會自然被 sheet 自己的 overflow-y: auto 捲動接住,不需要另外翻轉選單
// 方向)。三路分岔完全比照桌面版:
//  1. 候選已有排定日期(candidateHasScheduledDate)→ 直接呼叫 onAddCandidate。
//  2. 候選沒有日期,但行程本身已有排定日期(scheduledDates 非空)→ 展開
//     既有日期的按鈕列(比照桌面版 .dateMenu,這裡改成常駐在卡片內的
//     一列 chips,不用懸浮選單——手機觸控對懸浮選單的點外部收合手勢
//     沒有滑鼠 mousedown 事件可用,原地展開更符合觸控慣例)。
//  3. 兩者都沒有 → 直接展開日期輸入(<input type="date">)。
//
// attraction 沒有候選籃入口(理由同桌面版:AttractionInfoPanel.tsx 沒有
// 加入候選按鈕,自建景點區域本身沒有座標點以外的入口,見該檔案說明)。
export function GeoOutlinePhoneInfoSheet({
  content,
  attraction,
  tripName,
  scheduledDates,
  onClose,
  onAddCandidate,
  onSchedule,
}: {
  content: GeoInfoContent | null
  attraction: GeoAttraction | null
  onClose: () => void
  // tripName:「加入 {tripName}」按鈕文字——理由同桌面版 GeoInfoPanel.tsx
  // 的同名 prop,由呼叫端(GeoOutlinePhoneView.tsx)傳入 activeTrip?.name。
  tripName: string
  // scheduledDates:行程本身目前已排定的日期清單,由呼叫端算好傳入——
  // 理由同桌面版 GeoInfoPanel.tsx 的同名 prop。
  scheduledDates: string[]
  // onAddCandidate:候選已有排定日期時直接加入候選籃(純前端,不寫入
  // 後端)——理由同桌面版 GeoInfoPanel.tsx 的同名 prop。
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onSchedule:候選沒有排定日期、選好日期按確定觸發——把候選跟選定的
  // 日期一起回報給呼叫端,由它決定怎麼寫入(理由同桌面版
  // GeoInfoPanel.tsx 的同名 prop)。
  onSchedule?: (candidate: GeoCandidate, date: string) => void
}) {
  // addUiMode:同桌面版 GeoInfoPanel.tsx 的同名 state,拿掉 'menu'
  // 對應的懸浮選單模式(見上方元件說明,改成常駐 chips,不需要獨立的
  // UI 模式區分「選單」跟「日曆」兩種展開形態,一律用 'open' 表示
  // 「展開了選日期的區塊」,區塊內部視 scheduledDates 是否非空決定要不要
  // 多顯示一排 chips)。
  const [addUiMode, setAddUiMode] = useState<'closed' | 'open'>('closed')
  const [dateValue, setDateValue] = useState('')
  useEffect(() => {
    setAddUiMode('closed')
    setDateValue('')
  }, [content, attraction])

  const open = content != null || attraction != null
  if (!open) return null

  const name = attraction ? attraction.name : content!.name
  const photoUrl = attraction ? attraction.landmarkPhotoUrl : content!.photoUrl
  const subtitle = attraction
    ? attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined
    : content!.subtitle
  const summary = attraction ? attraction.summary : content!.summary
  const badges = attraction ? attractionBadges(attraction) : content!.badges
  const candidate = attraction ? undefined : content!.candidate

  // handleAddClick:「加入 {tripName}」按下時的分岔——理由同桌面版
  // GeoInfoPanel.tsx 的 handleAddClick,見上方元件說明。
  const handleAddClick = () => {
    if (!candidate) return
    if (candidateHasScheduledDate(candidate)) {
      onAddCandidate?.(candidate)
      return
    }
    setAddUiMode('open')
  }

  const handlePickScheduledDate = (date: string) => {
    if (!candidate) return
    onSchedule?.(candidate, date)
    setAddUiMode('closed')
  }

  const handleConfirmDate = () => {
    if (!candidate || !dateValue) return
    onSchedule?.(candidate, dateValue)
    setAddUiMode('closed')
    setDateValue('')
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.imageWrap}>
          {photoUrl ? (
            <img className={styles.photo} src={photoUrl} alt={name} />
          ) : (
            <div className={styles.photoPlaceholder} />
          )}
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.content}>
          <h2 className={styles.name}>{name}</h2>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          {badges.length > 0 && (
            <div className={styles.metaRow}>
              {badges.map((b) => (
                <span key={b} className={styles.badge}>{b}</span>
              ))}
            </div>
          )}
          {summary ? (
            <p className={styles.summary}>{summary}</p>
          ) : (
            <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
          )}
          {candidate && (
            <div className={styles.addCandidateWrap}>
              <button
                type="button"
                className={styles.addCandidateBtn}
                onClick={handleAddClick}
              >
                <Plus size={14} strokeWidth={2} />
                加入 {tripName}
              </button>
              {addUiMode === 'open' && (
                <div className={styles.dateEdit}>
                  {scheduledDates.length > 0 && (
                    <div className={styles.dateChips}>
                      {scheduledDates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          className={styles.dateChip}
                          onClick={() => handlePickScheduledDate(date)}
                        >
                          {dayGroupLabel(date)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.dateInputRow}>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={dateValue}
                      onChange={(e) => setDateValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className={styles.dateConfirmBtn}
                      onClick={handleConfirmDate}
                      disabled={!dateValue}
                    >
                      確定
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
