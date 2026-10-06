import { useEffect, useMemo, useState } from 'react'
import {
  type GeoCandidate,
  NO_DATE_GROUP,
  candidateListKey,
  dayGroupKey,
  dayGroupLabel,
  entryKindIcon,
} from './geoCandidateHelpers'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS, SheetHead } from '../components/PhoneBottomSheet'
import { ListItemCard } from '../components/ListItemCard'
import styles from './GeoOutlinePhoneCandidateDrawer.module.css'

// GeoOutlinePhoneCandidateDrawer:手機版「行程」抽屜——從下方彈出
// (bottom sheet,共用容器 components/PhoneBottomSheet.tsx),依日期分組
// 列出已排入行程的項目。
//
// 2026-10 修正:原本這裡還有「候選中」(尚未排進任何一天的候選)清單與
// 「返回候選」/「從候選加入」兩個操作——使用者明確要求移除整套候選籃
// 暫存/候選匡流程(含桌面版 AddFromCandidateSidebar),這個抽屜現在只
// 剩單純顯示「已排入行程」項目,不再有候選中清單、不再支援返回候選。
// 加入行程改成「選地點→直接選日期→加入時間軸」,不經過候選籃中介。
//
// 不支援拖曳改期(HTML5 drag events 在觸控裝置上沒有對應手勢)——只提供
// 「移除」。
//
// 純邏輯(分組/型別)複用 geoCandidateHelpers.ts,與桌面版
// GeoCandidateSidebar.tsx 共用同一份,不重新實作——這個檔案只負責手機版
// 排版與觸控手勢(現在完全交給 PhoneBottomSheet,見下方)。
//
// SHEET_SNAP_POINTS/SHEET_MIN_HEIGHT:兩段式(展開/收合),取代原本只有
// 一個 snapPoint 的「開/關」兩態。
//
// 2026-10 修正:使用者明確要求「點選行程內的項目時不要關閉行程,而是
// 縮到最下面就好」——原本點項目卡片(見下方 onSelect)會直接關閉整個
// 抽屜(open 變 false)並開資訊卡,資訊卡關閉後行程抽屜不會自動回來;
// 改成點項目時只切到收合段(SHEET_MIN_HEIGHT,只露出標頭這一條),不動
// open 本身,行程抽屜仍在背景保持開啟,資訊卡關閉後使用者可以直接把它
// 拖回展開段繼續看,不需要重新從底部列按「行程」才能叫回來。
const SHEET_MIN_HEIGHT = 80
const SHEET_SNAP_POINTS = [320]

// DayEntryCard:「已排入行程」日層架卡片——比照桌面版 GeoCandidateSidebar.tsx
// 的同名元件,拿掉拖曳(理由見上方檔案說明),只保留點擊開資訊欄/移除兩個
// 互動。
// DayEntryCard:2026-10 改用全專案通用元件 ListItemCard(原本是
// geo-planning 專屬的 GeoListItemCard,已抽成通用元件,見
// components/ListItemCard.tsx 的完整說明)——使用者明確要求行程項目的
// 樣式跟搜尋結果清單(GeoOutlinePhoneListDrawer.tsx)一致(卡片大小/
// 圓角/留白/字級比例,含照片/佔位圖的版面配置),不再是原本獨立的
// 「圓形分類圖示 + 名稱 + 時間」緊湊橫列。
//
// 行程 entry(GeoTripEntry)目前沒有存 placeId/photoUrl(後端寫入 entry
// 時沒有保留這兩個欄位,見 api.ts GeoTripEntry 的完整說明),一律沒有
// 真實照片可顯示——2026-10 修正:原本 leading 放灰色素色佔位方塊,
// 使用者要求改用圖示,改成跟桌面版 GeoCandidateSidebar.tsx 的
// DayEntryCard 同一套 entryKindIcon(entry.entryKind 對應
// stay/activity/restaurant 等分類,見 geoCandidateHelpers.ts 的完整
// 說明)圓形圖示,讓手機版跟桌面版看到同一筆 entry 時圖示語意一致。
// startTime 原本是獨立顯示的時刻(舊版 .dayCardTime),改放進 address
// 欄位(ListItemCard 的第二行文字),沒有 startTime 時這個欄位不顯示。
// 「移除」按鈕沒有對應的共用插槽語意(ListItemCard 的 addSlot 原本是給
// 「加入候選」按鈕用),這裡借用同一個插槽位置放「移除」,視覺上卡片
// 右側維持一個可互動按鈕的版面,不需要另外在元件外面加一層容器。
function DayEntryCard({
  c,
  onRemove,
  onSelect,
}: {
  c: GeoCandidate & { kind: 'entry' }
  onRemove: (candidate: GeoCandidate) => void
  onSelect: (candidate: GeoCandidate) => void
}) {
  const Icon = entryKindIcon(c.entryKind)
  return (
    <ListItemCard
      name={c.name}
      address={c.startTime ?? undefined}
      leading={
        <span className={styles.itemPin}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
      }
      selected={false}
      onSelect={() => onSelect(c)}
      styles={styles}
      trailing={
        <button
          type="button"
          className={styles.removeBtn}
          onClick={() => onRemove(c)}
          title="移除"
        >
          ×
        </button>
      }
    />
  )
}

export function GeoOutlinePhoneCandidateDrawer({
  open,
  onClose,
  candidates,
  onRemove,
  onSelect,
  flashTrigger,
  restoreTrigger,
}: {
  open: boolean
  onClose: () => void
  candidates: GeoCandidate[]
  // onRemove:直接是 useGeoPlanningState.ts 的 handleRemoveCandidate
  // (已內建 api.deleteEntry 呼叫與錯誤處理,不在這個檔案裡重複實作一份,
  // 見該 hook 的說明)——呼叫端(GeoOutlinePhoneView.tsx)傳入時帶上自己
  // 的 logTag。
  onRemove: (candidate: GeoCandidate) => void
  // onSelect:點卡片本體(已排入行程項目)——把該候選轉成資訊卡內容並
  // 開啟 GeoOutlinePhoneInfoSheet,理由同桌面版 selectGeoCandidate。
  // 這個檔案自己另外處理「收合抽屜」(見下方 activeSnapIndex),onSelect
  // 本身不再負責關閉行程抽屜。
  onSelect: (candidate: GeoCandidate) => void
  flashTrigger?: number
  // restoreTrigger:2026-10 新增——使用者明確要求「關閉地點後,行程要
  // 復原」:點行程項目收合這個抽屜、開啟地點資訊卡(見下方 onSelect)
  // 之後,使用者把資訊卡關掉時,行程抽屜要自動展開回來,不需要使用者
  // 自己手動拖。這個抽屜本身不知道資訊卡何時關閉(那是
  // GeoOutlinePhoneView.tsx 的 sheetStack 概念),故用遞增計數器讓外部
  // 通知「該復原展開了」,對齊 candidateDrawerTrigger 等既有的觸發器
  // 慣例寫法。
  restoreTrigger?: number
}) {
  // activeSnapIndex:受控吸附段落——預設展開(索引 1,對應
  // SHEET_SNAP_POINTS[0]),每次重新開啟都重設回展開,不延續上次的收合
  // 狀態(理由同 GeoOutlinePhoneListDrawer.tsx 的同名 state)。點項目卡片
  // 時收合到索引 0(SHEET_MIN_HEIGHT,只露出標頭),不呼叫 onClose——見
  // 上方 SHEET_SNAP_POINTS 的完整說明。
  const [activeSnapIndex, setActiveSnapIndex] = useState(1)
  useEffect(() => {
    if (open) setActiveSnapIndex(1)
  }, [open])
  // restoreTrigger 變動時展開回索引 1(見該 prop 的完整說明)——對齊
  // candidateDrawerTrigger 的既有慣例寫法:初次渲染(undefined 或 0)
  // 不觸發,只在真正遞增時才展開。
  useEffect(() => {
    if (!restoreTrigger) return
    setActiveSnapIndex(1)
  }, [restoreTrigger])
  // inTrip:同桌面版 GeoCandidateSidebar.tsx/DesktopLayout.tsx 的篩選
  // 規則——kind==='entry' && inTrip===true 是「已排入行程」。
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
      minHeightPx={SHEET_MIN_HEIGHT}
      activeSnapIndex={activeSnapIndex}
      onSnapIndexChange={setActiveSnapIndex}
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
      head={<SheetHead title="行程" onClose={onClose} />}
    >
      <div className={styles.list}>
        {candidates.length === 0 ? (
          <div className={styles.empty}>
            地圖上點飯店/景點/地點,資訊卡裡按「加入行程」把想去的丟進來。
          </div>
        ) : (
          <>
            {inTripByDay.length > 0 && (
              <div className={styles.section}>
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
                        onSelect={(candidate) => {
                          setActiveSnapIndex(0)
                          onSelect(candidate)
                        }}
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
