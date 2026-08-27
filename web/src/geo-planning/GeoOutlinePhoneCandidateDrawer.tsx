import { useEffect, useMemo, useState } from 'react'
import { ListPlus } from 'lucide-react'
import type { ClientConfig } from '../api'
import {
  type GeoCandidate,
  NO_DATE_GROUP,
  candidateListKey,
  dayGroupKey,
  dayGroupLabel,
  entryKindIcon,
  useCandidateDatePicker,
} from './geoCandidateHelpers'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS, SheetHead } from '../components/PhoneBottomSheet'
import styles from './GeoOutlinePhoneCandidateDrawer.module.css'

// GeoOutlinePhoneCandidateDrawer:手機版候選籃——第二階段新增,第四階段
// (這次)改用共用容器 components/PhoneBottomSheet.tsx,從下方彈出
// (bottom sheet),取代原本「從右側滑入」的獨立側邊抽屜實作——使用者
// 明確要求「改成從下方滑入(跟地點清單等其他手機版抽屜一致)」,統一成
// 跟 GeoOutlinePhoneListDrawer.tsx/GeoOutlinePhoneInfoSheet.tsx 一致的
// bottom sheet 視覺語言,不再是本檔案獨立維護一份 useDragToClose(axis:
// 'x')側滑手勢。桌面版是兩張並排的浮動側欄(GeoCandidateSidebar「已排入
// 行程」日層架 + AddFromCandidateSidebar「候選中」清單,見兩檔案的
// 說明),手機螢幕放不下並排兩塊,這裡合併成一份 sheet:上半部是「候選中」
// 清單(尚未排進任何一天),下半部依日期分組列出「已排入行程」。
//
// 不像桌面版那樣支援拖曳排期(HTML5 drag events 在觸控裝置上沒有對應
// 手勢,且拖曳排期本來就是滑鼠/大螢幕才好操作的細緻動作)——手機版排期
// 一律透過「候選中」卡片本體的「加入」按鈕,展開日期選擇 UI(同
// GeoOutlinePhoneInfoSheet.tsx 的日期選擇邏輯,見該檔案),不提供拖放。
// 已排入行程的卡片同樣不支援拖曳改期,只提供「返回候選」/「移除」。
//
// 純邏輯(分組/建立 entry/型別)完全複用 geoCandidateHelpers.ts,與桌面版
// GeoCandidateSidebar.tsx 共用同一份,不重新實作——這個檔案只負責手機版
// 排版與觸控手勢(現在完全交給 PhoneBottomSheet,見下方)。
//
// SHEET_MIN_HEIGHT/SHEET_SNAP_POINTS:單段開關(只有一個 snapPoint,沒有
// minHeightPx)——比照原本「開/關」兩態,只是方向從右側改下方。候選籃是
// 使用者「打開看一下候選/排期、關掉繼續操作地圖」的短暫互動(點候選卡片
// 會直接關閉抽屜並開資訊卡,見下方 onSelect 呼叫端 GeoOutlinePhoneView.tsx
// 的用法),不像地點清單(GeoOutlinePhoneListDrawer.tsx)是「邊看地圖邊
// 持續瀏覽清單」的情境,不需要多段吸附(收合到只剩標頭/中間展開/滿版三態)
// ——單段開關以「離頂部固定距離」表達,足以覆蓋候選籃內容(候選中清單+
// 已排入行程依日期分組),過長時交給 PhoneBottomSheet 的 .body 統一捲動。
// 若之後候選籃內容經常長到需要分段瀏覽,可仿照 GeoOutlinePhoneListDrawer.tsx
// 加上 minHeightPx 改成多段。
const SHEET_SNAP_POINTS = [80]

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
  const { saving, err, handlePick } = useCandidateDatePicker({
    cfg,
    tripID,
    getCandidate: () => c,
    onScheduled: () => {
      onScheduled()
      onRemove(c)
      setExpanded(false)
    },
  })

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
  // onRemove/onReturnToCandidate:直接是 useGeoPlanningState.ts 的
  // handleRemoveCandidate/handleReturnToCandidate(已內建 api.deleteEntry
  // 呼叫與錯誤處理,不在這個檔案裡重複實作一份,見該 hook 的說明)——呼叫
  // 端(GeoOutlinePhoneView.tsx)傳入時各自帶上自己的 logTag。
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

  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!flashTrigger) return
    setFlashing(true)
    const t = setTimeout(() => setFlashing(false), 900)
    return () => clearTimeout(t)
  }, [flashTrigger])

  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      // showBackdrop:false——比照 GeoOutlinePhoneInfoSheet.tsx/
      // GeoOutlinePhoneListDrawer.tsx 的用法,使用者要求候選籃出現時地圖
      // 不要被遮罩變暗,背景地圖保持可見可互動(候選籃打開時使用者仍可能
      // 想操作地圖比對位置)——這是延續原本透明 backdrop 的既有行為,不是
      // 這次重構新引入的決策。
      showBackdrop={false}
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      // panelStyle:bottom: 0、zIndex: 36——比照 GeoOutlinePhoneListDrawer.tsx/
      // GeoOutlinePhoneInfoSheet.tsx 的慣例,蓋住底部常駐導覽列
      // PhoneTabBar.tsx(z-index: 35)。候選籃與地點清單雖然理論上互不
      // 依賴各自的 open state(GeoOutlinePhoneView.tsx 各自獨立
      // useState,沒有互斥開關),但兩者都是「點按鈕才開,開啟後通常會先
      // 關掉才做下一步」的短暫操作,採用同一個 z-index 慣例、讓兩者都能
      // 蓋住導覽列即可,不需要額外設計互斥邏輯或分開層級——真的同時觸發
      // 開啟時(少見的操作順序),後開啟的那個在 DOM 順序中排在後面,
      // 自然疊在上層,不會出現互相穿透看不到內容的情況。
      panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 36 }}
      panelClassName={flashing ? styles.panelFlash : undefined}
      head={<SheetHead title="候選籃" onClose={onClose} />}
    >
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
                    onRemove={onRemove}
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
                        onRemove={onRemove}
                        onSelect={onSelect}
                        onReturnToCandidate={onReturnToCandidate}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PhoneBottomSheet>
  )
}
