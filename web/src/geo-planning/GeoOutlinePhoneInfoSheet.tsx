import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { Plus, X } from 'lucide-react'
import type { GeoAttraction } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { attractionBadges } from './geoInfoContent'
import { candidateHasScheduledDate, dayGroupLabel, type GeoCandidate } from './geoCandidateHelpers'
import styles from './GeoOutlinePhoneInfoSheet.module.css'

// SHEET_MIN/MAX_HEIGHT_VH:資訊卡預設高度(60vh,同原本固定值)與往上
// 拖曳展開的上限(90vh,留一點空間讓使用者仍能看到地圖與狀態列,不整個
// 佔滿螢幕)。
const SHEET_MIN_HEIGHT_VH = 60
const SHEET_MAX_HEIGHT_VH = 90

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

  // sheetHeightVh:目前卡片高度(vh 單位)——往上拖曳把手可以展開到
  // SHEET_MAX_HEIGHT_VH,看到更多卡片自己的內容(簡介、加入候選按鈕等,
  // 使用者明確要求「往上拉看到下面的內容」,不是收合卡片露出地圖)。
  // 每次換一張新卡片(content/attraction 變動,同上方 addUiMode 的重置
  // 依賴)重設回預設高度,不延續上一張卡片被拖曳展開過的高度。
  const [sheetHeightVh, setSheetHeightVh] = useState(SHEET_MIN_HEIGHT_VH)
  useEffect(() => {
    setSheetHeightVh(SHEET_MIN_HEIGHT_VH)
  }, [content, attraction])

  // 拖曳手勢:垂直方向,雙向——往上拖曳增加卡片高度(delta 為負,換算成
  // 正的展開量),往下拖曳關閉(delta 為正,理由與做法對齊
  // GeoOutlinePhoneListDrawer.tsx/trip/PhoneTripsDrawer.tsx 既有的
  // 「只能往下拖關閉」手勢,這裡額外多支援往上的方向)。startHeightRef
  // 記住手勢開始當下的高度,讓拖曳量是相對這次手勢起點的增量,而非每次
  // onTouchMove 都疊加,避免快速連續觸發時高度計算飄移。
  const startYRef = useRef<number | null>(null)
  const startHeightRef = useRef(SHEET_MIN_HEIGHT_VH)
  const draggingRef = useRef(false)
  const [closeDragOffset, setCloseDragOffset] = useState(0)

  function onHandleTouchStart(e: ReactTouchEvent) {
    startYRef.current = e.touches[0].clientY
    startHeightRef.current = sheetHeightVh
    draggingRef.current = true
  }
  function onHandleTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startYRef.current === null) return
    const delta = e.touches[0].clientY - startYRef.current
    if (delta < 0) {
      // 往上拖:增加高度,夾在 [起始高度, SHEET_MAX_HEIGHT_VH] 之間——
      // 用視窗高度換算 px 差距對應的 vh 量,避免不同裝置高度下拖曳手感
      // 不一致。
      const deltaVh = (-delta / window.innerHeight) * 100
      setSheetHeightVh(Math.min(SHEET_MAX_HEIGHT_VH, startHeightRef.current + deltaVh))
      setCloseDragOffset(0)
    } else {
      // 往下拖:維持起始高度,改用既有的「往下拖關閉」位移量,理由同
      // GeoOutlinePhoneListDrawer.tsx 的既有手勢。
      setSheetHeightVh(startHeightRef.current)
      setCloseDragOffset(delta)
    }
  }
  function onHandleTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (closeDragOffset > threshold) {
      onClose()
    }
    setCloseDragOffset(0)
    startYRef.current = null
  }

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
      <div
        className={styles.sheet}
        style={{
          maxHeight: `${sheetHeightVh}vh`,
          transform: `translateY(${closeDragOffset}px)`,
          transition: draggingRef.current ? 'none' : 'max-height 0.2s ease, transform 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={styles.dragHandle}
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
        >
          <div className={styles.dragHandleBar} />
        </div>
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
