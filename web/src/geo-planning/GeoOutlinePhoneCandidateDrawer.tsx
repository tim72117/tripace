import { useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { ListPlus, X } from 'lucide-react'
import * as api from '../api'
import type { ClientConfig } from '../api'
import {
  type GeoCandidate,
  NO_DATE_GROUP,
  candidateListKey,
  createEntryFromCandidate,
  dayGroupKey,
  dayGroupLabel,
  entryKindIcon,
} from './geoCandidateHelpers'
import styles from './GeoOutlinePhoneCandidateDrawer.module.css'

// GeoOutlinePhoneCandidateDrawer:手機版候選籃——第二階段新增。桌面版是
// 兩張並排的浮動側欄(GeoCandidateSidebar「已排入行程」日層架 +
// AddFromCandidateSidebar「候選中」清單,見兩檔案的說明),手機螢幕放不下
// 並排兩塊,這裡合併成一份「從右側滑入」的抽屜:上半部是「候選中」清單
// (尚未排進任何一天),下半部依日期分組列出「已排入行程」。選用滑入
// 抽屜(而非再開一層 bottom sheet)理由同 pace/PacePhoneSwipe.tsx 的
// 既有先例——地圖是固定不動的底層,只有這塊面板本身滑入/滑出,手勢只
// 綁在面板上不綁地圖,避免跟 Google Maps 原生手勢衝突;選右側滑入(不是
// 左側,PhoneNavDrawer/PhoneTripsDrawer 已佔用左側滑入語意——地圖上
// 左上角是開抽屜按鈕,若候選籃也從左邊滑入,兩者的觸發方向會混淆使用者
// 對「這個方向是選單、那個方向是候選籃」的直覺區分)。
//
// 不像桌面版那樣支援拖曳排期(HTML5 drag events 在觸控裝置上沒有對應
// 手勢,且拖曳排期本來就是滑鼠/大螢幕才好操作的細緻動作)——手機版排期
// 一律透過「候選中」卡片本體的「加入」按鈕,展開日期選擇 UI(同
// GeoOutlinePhoneInfoSheet.tsx 的日期選擇邏輯,見該檔案),不提供拖放。
// 已排入行程的卡片同樣不支援拖曳改期,只提供「返回候選」/「移除」。
//
// 純邏輯(分組/建立 entry/型別)完全複用 geoCandidateHelpers.ts,與桌面版
// GeoCandidateSidebar.tsx 共用同一份,不重新實作——這個檔案只負責手機版
// 排版與觸控手勢,沒有另外定義任何候選籃相關的資料結構或轉換規則。
const DRAWER_WIDTH_PERCENT = 86

// CandidateRow:「候選中」卡片——比照桌面版 AddFromCandidateSidebar.tsx
// 的 CandidateRow 視覺語言(緊湊橫列:分類圖示 + 名稱),但互動改成手機版
// 慣例:點卡片本體展開/收合這張卡片自己的日期選擇區(inline,不是另開
// 浮動選單),不做拖曳。
function CandidateRow({
  cfg,
  tripID,
  c,
  scheduledDates,
  onRemove,
  onSelect,
  onScheduled,
}: {
  cfg: ClientConfig
  tripID?: string | null
  c: GeoCandidate
  scheduledDates: string[]
  onRemove: (candidate: GeoCandidate) => void
  onSelect: (candidate: GeoCandidate) => void
  onScheduled: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePick = async (date: string) => {
    if (!tripID) return
    setSaving(true)
    setErr(null)
    try {
      await createEntryFromCandidate(cfg, tripID, c, date)
      onScheduled()
      onRemove(c)
      setExpanded(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const Icon = entryKindIcon(c.kind === 'entry' ? c.entryKind : undefined)

  return (
    <div className={styles.candidateCard}>
      <div className={styles.candidateTopRow}>
        <div
          role="button"
          tabIndex={0}
          className={styles.candidateCardBody}
          onClick={() => onSelect(c)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(c) }}
        >
          <span className={styles.itemPin}>
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className={styles.itemName}>{c.name}</span>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          title="加入行程"
        >
          <ListPlus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(c) }}
          title="移除候選"
        >
          ×
        </button>
      </div>
      {expanded && (
        <div className={styles.scheduleRow} onClick={(e) => e.stopPropagation()}>
          {scheduledDates.length > 0 && (
            <div className={styles.scheduleChips}>
              {scheduledDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  className={styles.scheduleChip}
                  disabled={saving}
                  onClick={() => handlePick(date)}
                >
                  {dayGroupLabel(date)}
                </button>
              ))}
            </div>
          )}
          <div className={styles.scheduleInputRow}>
            <input
              type="date"
              className={styles.scheduleInput}
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
            <button
              type="button"
              className={styles.scheduleConfirmBtn}
              disabled={!dateValue || saving}
              onClick={() => handlePick(dateValue)}
            >
              {saving ? '加入中…' : '確定'}
            </button>
          </div>
          {err && <div className={styles.scheduleErr}>{err}</div>}
        </div>
      )}
    </div>
  )
}

// DayEntryCard:「已排入行程」日層架卡片——比照桌面版 GeoCandidateSidebar.tsx
// 的同名元件,拿掉拖曳(理由見上方檔案說明),只保留點擊開資訊欄/返回候選/
// 移除三個互動。
function DayEntryCard({
  c,
  onRemove,
  onSelect,
  onReturnToCandidate,
}: {
  c: GeoCandidate & { kind: 'entry' }
  onRemove: (candidate: GeoCandidate) => void
  onSelect: (candidate: GeoCandidate) => void
  onReturnToCandidate: (candidate: GeoCandidate & { kind: 'entry'; inTrip: true }) => void
}) {
  const Icon = entryKindIcon(c.entryKind)
  return (
    <div className={styles.dayCard}>
      <div
        role="button"
        tabIndex={0}
        className={styles.dayCardBody}
        onClick={() => onSelect(c)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(c) }}
      >
        <span className={styles.dayCardPin}>
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className={styles.dayCardName}>{c.name}</span>
        {c.startTime && <span className={styles.dayCardTime}>{c.startTime}</span>}
      </div>
      {c.inTrip && (
        <button
          type="button"
          className={styles.returnBtn}
          onClick={() => onReturnToCandidate(c as GeoCandidate & { kind: 'entry'; inTrip: true })}
          title="返回候選"
        >
          返回候選
        </button>
      )}
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove(c)}
        title="移除"
      >
        ×
      </button>
    </div>
  )
}

export function GeoOutlinePhoneCandidateDrawer({
  cfg,
  tripID,
  open,
  onClose,
  candidates,
  scheduledDates,
  onRemove,
  onSelect,
  onReturnToCandidate,
  onScheduled,
  flashTrigger,
}: {
  cfg: ClientConfig
  tripID?: string | null
  open: boolean
  onClose: () => void
  candidates: GeoCandidate[]
  // scheduledDates:行程本身目前已排定的日期清單——理由同桌面版
  // DesktopLayout.tsx 的 geoScheduledDates,由呼叫端算好傳入。
  scheduledDates: string[]
  onRemove: (candidate: GeoCandidate) => void
  // onSelect:點卡片本體(候選中/已排入行程皆同)——把該候選轉成資訊卡
  // 內容並開啟 GeoOutlinePhoneInfoSheet,理由同桌面版 selectGeoCandidate。
  onSelect: (candidate: GeoCandidate) => void
  onReturnToCandidate: (candidate: GeoCandidate & { kind: 'entry'; inTrip: true }) => void
  // onScheduled:候選被排進某一天成功後觸發(不論來自哪張卡片的日期選擇
  // UI)——通知呼叫端重新查詢 tripEntries,理由同桌面版 onDatesAssigned。
  onScheduled: () => void
  flashTrigger?: number
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    // 從右側滑入的抽屜,開啟狀態下只能往右拖(關閉方向,delta 為正)——
    // 對稱 PacePhoneSwipe.tsx/PhoneTripsDrawer.tsx 左側抽屜「只能往關閉
    // 方向拖」的既有慣例,方向相反(那兩個抽屜是左側滑入、只能往左拖)。
    const delta = Math.max(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset > threshold) onClose()
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `${dragOffset}px` : `calc(100% + ${dragOffset}px)`

  // onlyCandidate/inTrip:同桌面版 GeoCandidateSidebar.tsx/DesktopLayout.tsx
  // 的篩選規則——kind==='entry' && inTrip===true 是「已排入行程」,其餘
  // 是「候選中」。
  const onlyCandidate = useMemo(() => candidates.filter((c) => !(c.kind === 'entry' && c.inTrip)), [candidates])
  const inTrip = useMemo(
    () => candidates.filter((c): c is GeoCandidate & { kind: 'entry'; inTrip: true } => c.kind === 'entry' && c.inTrip),
    [candidates],
  )
  const inTripByDay = useMemo(() => {
    const groups = new Map<string, (GeoCandidate & { kind: 'entry' })[]>()
    for (const c of inTrip) {
      const key = dayGroupKey(c)
      const arr = groups.get(key)
      if (arr) arr.push(c)
      else groups.set(key, [c])
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === NO_DATE_GROUP) return 1
      if (b === NO_DATE_GROUP) return -1
      return a.localeCompare(b)
    })
  }, [inTrip])

  const handleReturnToCandidate = async (c: GeoCandidate & { kind: 'entry'; inTrip: true }) => {
    try {
      await api.deleteEntry(cfg, c.id)
      onReturnToCandidate(c)
    } catch (err) {
      console.error('[GeoOutlinePhoneCandidateDrawer] 返回候選失敗:', err)
    }
  }

  const handleRemove = async (c: GeoCandidate) => {
    if (c.kind === 'entry' && c.inTrip) {
      try {
        await api.deleteEntry(cfg, c.id)
      } catch (err) {
        console.error('[GeoOutlinePhoneCandidateDrawer] 刪除已排入行程項目失敗:', err)
        return
      }
    }
    onRemove(c)
  }

  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!flashTrigger) return
    setFlashing(true)
    const t = setTimeout(() => setFlashing(false), 900)
    return () => clearTimeout(t)
  }, [flashTrigger])

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />}
      <div
        className={`${styles.panel}${flashing ? ` ${styles.panelFlash}` : ''}`}
        style={{
          width: `${DRAWER_WIDTH_PERCENT}%`,
          transform: `translateX(${translate})`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.head}>
          <span className={styles.title}>候選籃</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.list}>
          {candidates.length === 0 ? (
            <div className={styles.empty}>
              地圖上點飯店/景點/地點,資訊卡裡按「加入候選」把想去的丟進來。
            </div>
          ) : (
            <>
              {onlyCandidate.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHead}>候選中</div>
                  {onlyCandidate.map((c) => (
                    <CandidateRow
                      key={candidateListKey(c)}
                      cfg={cfg}
                      tripID={tripID}
                      c={c}
                      scheduledDates={scheduledDates}
                      onRemove={handleRemove}
                      onSelect={onSelect}
                      onScheduled={onScheduled}
                    />
                  ))}
                </div>
              )}
              {inTripByDay.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHead}>已排入行程</div>
                  {inTripByDay.map(([dayKey, dayEntries]) => (
                    <div key={dayKey} className={styles.day}>
                      <div className={styles.dayHead}>
                        <span className={styles.dayDate}>{dayGroupLabel(dayKey)}</span>
                        <span className={styles.dayStatus}>{dayEntries.length} 個安排</span>
                      </div>
                      {dayEntries.map((c) => (
                        <DayEntryCard
                          key={candidateListKey(c)}
                          c={c}
                          onRemove={handleRemove}
                          onSelect={onSelect}
                          onReturnToCandidate={handleReturnToCandidate}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
