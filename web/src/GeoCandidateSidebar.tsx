import { useMemo, useState } from 'react'
import { Car, Hotel, MapPin, Plane, StickyNote, Ticket, UtensilsCrossed } from 'lucide-react'
import { isSubmitEnter } from './AppCommon'
import * as api from './api'
import type { ClientConfig, GeoAttraction, GeoHotel, GeoPlace, GeoTripEntry } from './api'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import { geoItemKey } from './GeoHotelSidebar'
import styles from './GeoCandidateSidebar.module.css'

// ENTRY_KIND_ICONS:「已排入行程」日層架卡片的類別圖示,對應後端
// model.Entry.Kind(見 types.ts 的 Entry.kind 註解——
// stay/flight/activity/note/car/restaurant/ticket,未分類或不認得的值
// 一律退回 MapPin)。stay/restaurant/activity 刻意對齊 GeoOutlineMap.tsx
// CATEGORY_TAGS 用的 Hotel/UtensilsCrossed/MapPin(飯店就是飯店 icon),
// 讓使用者在地圖類別標籤與這裡的日層架卡片看到同一種類型時,圖示語意
// 一致;其餘沒有對應類別標籤的 kind(flight/note/car/ticket)沿用各自
// 最貼切的圖示,兩套是不同的值域(CATEGORY_TAGS 對應 Google Places 的
// place type,這裡對應行程本身的 entry 類型),沒有共用機制,只是刻意讓
// 重疊的部分保持一致。
const ENTRY_KIND_ICONS: Record<string, typeof MapPin> = {
  stay: Hotel,
  flight: Plane,
  activity: MapPin,
  note: StickyNote,
  car: Car,
  restaurant: UtensilsCrossed,
  ticket: Ticket,
}
function entryKindIcon(kind?: string | null): typeof MapPin {
  return (kind && ENTRY_KIND_ICONS[kind]) || MapPin
}

// GeoCandidateSidebar:候選籃(構想 1,見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)——地理輪廓底圖(構想 6)的
// 桌面版試做承載元件,渲染在 rail 與主顯示區之間的 side panel(跟
// trips/timeline/pace 用同一個 .desktop-sidepanel 位置,見
// DesktopLayout.tsx 的 isSidepanelMode),對齊構想 1 定案的「候選籃是
// 規劃引導介面的主結構」空間配置。
//
// 目前只是純前端試做:候選清單只存在記憶體(DesktopContent 的
// geoCandidates state),重新整理頁面會消失,尚未接上任何持久化——構想
// 1 定案要求的「跨 session 保存」留待這個功能確定要正式化時再實作。
//
// 加入候選的入口是右側 GeoHotelSidebar(飯店/地點清單)每一項卡片上的
// 「+」按鈕(見該元件),這裡只負責顯示已加入的候選與移除。
// entry 種類:行程本身已有座標的 entry(見 GeoOutlineMap.tsx 的
// tripEntries 說明)——這批點不是使用者手動用「+」加入的,是進入規劃
// 分頁時自動帶入的行程既有內容(見 DesktopLayout.tsx 的
// onTripEntriesChange),但仍走同一份候選籃資料結構與顯示邏輯,不另開
// 一份平行清單。
export type GeoCandidate =
  | ({ kind: 'hotel' } & GeoHotel)
  | ({ kind: 'attraction' } & GeoAttraction)
  | ({ kind: 'place' } & GeoPlace)
  | ({ kind: 'entry' } & GeoTripEntry)

// dayGroupLabel/dayGroupKey:把「已排入行程」的 entry 依 start 日期分組——
// 對齊構想 5 桌面同屏並置原型(見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)右欄「日層架」的呈現方式:
// 每天一個區塊,標題顯示日期與該天已有幾個安排,底下才是卡片清單。沒有
// start 的 entry(尚未排定日期,理由同 Timeline.tsx 對無日期 entry 的
// 處理)另外歸進「未排定日期」分組,排在最後。
const NO_DATE_GROUP = '__no_date__'
function dayGroupKey(c: GeoCandidate): string {
  if (c.kind !== 'entry') return NO_DATE_GROUP
  return c.start || NO_DATE_GROUP
}
function dayGroupLabel(key: string): string {
  if (key === NO_DATE_GROUP) return '未排定日期'
  const [, month, day] = key.split('-')
  return month && day ? `${Number(month)}/${Number(day)}` : key
}

// CandidateRow:單一候選項目的卡片,純候選組與日層架卡片共用同一份
// 渲染邏輯,只有外層分組容器不同。onSelect:點擊卡片本體(而非「×」)時
// 觸發,打開地點介紹面板(見 DesktopLayout.tsx 的接線)——理由同
// GeoHotelSidebar 卡片點擊的既有慣例,卡片本體不能整張都是
// <button>(HTML 不允許 button 巢狀 button),故沿用「本體是可點擊的
// <div role="button">,移除是卡片內獨立的 <button>」這個既有模式。
function CandidateRow({
  c,
  onRemove,
  onSelect,
  onHover,
  onDragStart,
  onDragEnd,
}: {
  c: GeoCandidate
  onRemove?: (candidate: GeoCandidate) => void
  onSelect?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  // onDragStart/onDragEnd:拖曳把這張候選卡片放進日層架某一天(見呼叫端
  // handleDropOnDay 的說明)——只有純候選(hotel/attraction/place)拖進
  // 日期分組才有意義(把候選寫成一筆真正的行程 entry),故這裡的型別跟
  // DayEntryCard 的 onDragStart 不同,收的是完整 GeoCandidate 而非限定
  // kind: 'entry'。
  onDragStart?: (c: GeoCandidate) => void
  onDragEnd?: () => void
}) {
  const photoUrl = c.kind === 'attraction' ? c.landmarkPhotoUrl : c.kind === 'entry' ? undefined : c.photoUrl
  const name = c.name
  const meta = c.kind === 'attraction' ? (c.landmarkName ?? '') : c.kind === 'entry' ? (c.location ?? '') : c.address
  return (
    <div
      className={styles.item}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(c) }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.itemBody}
        onClick={() => onSelect?.(c)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(c) }}
        onMouseEnter={() => onHover?.(geoItemKey(c.kind, c))}
        onMouseLeave={() => onHover?.(null)}
      >
        {photoUrl ? (
          <img className={styles.itemPhoto} src={photoUrl} alt={name} loading="lazy" />
        ) : (
          <div className={styles.itemPhotoPlaceholder} />
        )}
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>{name}</span>
          {meta && <span className={styles.itemMeta}>{meta}</span>}
        </div>
      </div>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove?.(c)}
        title="移除候選"
      >
        ×
      </button>
    </div>
  )
}

// DayEntryCard:「已排入行程」日層架分組底下的單一卡片,對齊構想 5 原型
// .placed-card 的緊湊橫列樣式(圓形姓名首字 pin + 名稱 + 靠右時刻),跟
// CandidateRow 那種帶大張縮圖的卡片視覺區分開來——日層架強調的是「這天
// 有哪些安排、幾點」,不是地點介紹用的縮圖,故不重用 CandidateRow。
// 互動(點擊開資訊欄/hover 同步地圖高亮/移除候選)維持與 CandidateRow
// 相同的三個 callback,只是外觀不同。
function DayEntryCard({
  c,
  onRemove,
  onSelect,
  onHover,
  onDragStart,
  onDragEnd,
}: {
  c: GeoCandidate & { kind: 'entry' }
  onRemove?: (candidate: GeoCandidate) => void
  onSelect?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  // onDragStart/onDragEnd:拖曳把這張卡片改到別天的日期(見呼叫端
  // handleDropOnDay 的說明)——拖曳本身的來源識別只需要知道「拖的是哪個
  // entry」,不需要卡片自己知道要拖去哪裡,目標(哪一天)由放開時滑鼠所在
  // 的日期分組決定,故這裡只回報「開始拖了」「拖曳結束了」,不帶目標
  // 資訊。
  onDragStart?: (c: GeoCandidate & { kind: 'entry' }) => void
  onDragEnd?: () => void
}) {
  return (
    <div
      className={styles.dayCard}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(c) }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.dayCardBody}
        onClick={() => onSelect?.(c)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(c) }}
        onMouseEnter={() => onHover?.(geoItemKey(c.kind, c))}
        onMouseLeave={() => onHover?.(null)}
      >
        <span className={styles.dayCardPin}>
          {(() => {
            const Icon = entryKindIcon(c.kind)
            return <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          })()}
        </span>
        <span className={styles.dayCardName}>{c.name}</span>
        {c.startTime && <span className={styles.dayCardTime}>{c.startTime}</span>}
      </div>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove?.(c)}
        title="移除候選"
      >
        ×
      </button>
    </div>
  )
}

// NoDateDayHead:「未排定日期」分組的標題列——可點擊,點下去在原地展開一個
// 極簡的日期輸入(單一 <input type="date"> + 確定按鈕),不彈跳窗、不加
// icon 或其他裝飾,保持跟其餘分組標題一樣的視覺重量,只是多了 cursor:
// pointer 與 hover 底色暗示「這是可以按的」。確定後把選到的日期一次寫回
//這個分組底下所有 entry(見呼叫端 handleAssignDate 的說明),成功後收合
// 輸入列並通知呼叫端刷新——該 entry 會在下一次渲染自然移動到正確的日期
// 分組,這個元件不需要自己維護「移過去了」的中間狀態。
function NoDateDayHead({
  count,
  onAssign,
}: {
  count: number
  onAssign: (date: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const confirm = async () => {
    if (!date) return
    setSaving(true)
    setErr(null)
    try {
      await onAssign(date)
      setEditing(false)
      setDate('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={styles.dayHead}
        onClick={() => setEditing((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter') setEditing((v) => !v) }}
      >
        <span className={styles.dayDate}>未排定日期</span>
        <span className={styles.dayStatus}>{count} 個安排</span>
      </div>
      {editing && (
        <div className={styles.dayDateEdit} onClick={(e) => e.stopPropagation()}>
          <input
            type="date"
            className={styles.dayDateInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
          />
          <button type="button" className={styles.dayDateConfirmBtn} onClick={confirm} disabled={!date || saving}>
            {saving ? '儲存中…' : '確定'}
          </button>
        </div>
      )}
      {err && <div className={styles.dayDateErr}>{err}</div>}
    </>
  )
}

// GeoCandidateSidebar 的城市搜尋欄 props——原本是 GeoOutlinePanel.tsx 疊在
// 地圖上方的浮動搜尋列(毛玻璃卡片),改放進這個側欄最上方,以側欄慣用的
// 靜態表單列呈現(不再需要 backdrop-filter 毛玻璃處理,側欄本身已經是
// 不透明底色,不會有內容從底下透出來的疑慮)。查詢邏輯本身(呼叫
// fetchGeoGeocode、算 panTarget)仍留在 GeoOutlinePanel.tsx——這裡只負責
// 呈現輸入框/按鈕/錯誤訊息,狀態與行為透過 props 從外部傳入,理由同
// candidates/onRemove 這組既有 props 的模式,維持這個元件單純是「受控
// 呈現層」。
export function GeoCandidateSidebar({
  cfg,
  tripID,
  candidates,
  onRemove,
  onSelect,
  onHover,
  city,
  onCityChange,
  onSearch,
  searching,
  searchError,
  onDatesAssigned,
}: {
  cfg: ClientConfig
  // tripID:拖曳純候選(飯店/景點/推薦地點)進日層架某一天時,要把它寫成
  // 真正的行程 entry 需要知道寫進哪個行程(見 handleDropOnDay 呼叫
  // api.recordEntry 的說明)——這個側欄本來就綁定在已選行程的情境下渲染
  // (見 DesktopLayout.tsx 的接線),故 undefined/null 理論上不該發生,
  // 但保守起見拖放時仍會判斷,沒有 tripID 就直接放棄這次操作。
  tripID?: string | null
  candidates: GeoCandidate[]
  onRemove?: (candidate: GeoCandidate) => void
  onSelect?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  city: string
  onCityChange: (city: string) => void
  onSearch: () => void
  searching?: boolean
  searchError?: string | null
  // onDatesAssigned:「未排定日期」分組補上日期成功後觸發,通知呼叫端
  // (DesktopLayout.tsx)重新查一次 tripEntries——這個元件自己拿到的
  // candidates 是上游傳下來的 props,寫入日期成功後沒辦法自己更新它,
  // 只能請呼叫端重新查詢真正的資料來源,讓補了日期的項目在下一次渲染
  // 自然移到正確的日期分組。
  onDatesAssigned?: () => void
}) {
  // 已排入行程 vs 純候選:kind === 'entry' 是行程本身已有座標的既有內容
  // (進入規劃分頁時自動帶入,見上方型別註解),不是使用者用「+」手動加入
  // 的——這批天然就等於「已排入行程」,其餘 kind(hotel/attraction/place)
  // 是使用者主動丟進候選籃、但尚未真正寫回行程的項目,故以 kind 分組,不
  // 需要另外比對是否重複。
  const inTrip = candidates.filter((c): c is GeoCandidate & { kind: 'entry' } => c.kind === 'entry')
  const onlyCandidate = candidates.filter((c) => c.kind !== 'entry')

  // inTripByDay:「已排入行程」依 start 日期分組、日期升冪排序,未排定
  // 日期的分組固定排最後——對齊構想 5 原型日層架「一天一個區塊」的結構
  // (見上方 dayGroupKey/dayGroupLabel 的說明)。同一天內維持 inTrip 原本
  // 的順序(由上游 fetchEntries 決定,通常已經是時間序),不再另外排序,
  // 避免跟後端既有排序邏輯打架。
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

  // datedDays/noDateGroup:把 inTripByDay 拆成「有日期的分組」跟「未排定
  // 日期的分組」兩份——渲染時要在有日期分組的最後面(未排定日期分組
  // 之前)插入下方的「隔天」拖放區,用單一 .map 沒辦法在特定位置插入
  // 額外的區塊,故拆開分別渲染。
  const datedDays = inTripByDay.filter(([k]) => k !== NO_DATE_GROUP)
  const noDateGroup = inTripByDay.find(([k]) => k === NO_DATE_GROUP)

  // nextDayKey:目前「已排入行程」最後一天的隔天日期(YYYY-MM-DD)——拖曳
  // 卡片到最後一天最後一張卡片下方時,顯示一個空白的「隔天」拖放區塊,
  // 讓使用者能把候選/已排入行程的卡片放進一個目前還沒有任何項目的新
  // 日期,不需要先手動選好日期(理由同構想 5 原型「一直在場的日層架」
  // 精神)。沒有任何已有日期的分組時(datedDays 為空)不算得出「最後
  // 一天」,不顯示這個區塊——這種情況下「未排定日期」分組本身的日期
  // 輸入已經能達到同樣的目的。
  const lastDatedDayKey = datedDays.length > 0 ? datedDays[datedDays.length - 1][0] : null
  const nextDayKey = useMemo(() => {
    if (!lastDatedDayKey) return null
    const d = new Date(lastDatedDayKey + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [lastDatedDayKey])

  // handleAssignDate:「未排定日期」分組標題按下後,選好日期按確定時觸發
  // ——把選到的 date 一次寫回這個分組底下所有 entry(PATCH /v1/entries/
  // {id},只帶 start,不動其餘欄位,理由同 Timeline.tsx EditEntrySheet 的
  // 既有慣例)。逐筆平行送出(Promise.all),任何一筆失敗就整批視為失敗、
  // 讓 NoDateDayHead 顯示錯誤訊息、輸入列維持開啟——不做部分成功的複雜
  // 狀態呈現,失敗時使用者可以直接重試(已成功的那幾筆重送一次 PATCH 同一個
  // 日期是幂等操作,不會有副作用)。全部成功才呼叫 onDatesAssigned 通知
  // 上游重新查詢,讓這些項目在下一次渲染自然移到正確的日期分組。
  const handleAssignDate = async (entries: (GeoCandidate & { kind: 'entry' })[], date: string) => {
    await Promise.all(entries.map((e) => api.updateEntry(cfg, e.id, { start: date })))
    onDatesAssigned?.()
  }

  // handleCreateEntryFromCandidate:拖曳純候選(飯店/景點/推薦地點)放進
  // 某一天時觸發——這批候選還不是真正的行程 entry(見上方型別註解),
  // 要先用 api.recordEntry 寫成一筆新 entry(title 用候選名稱、start 用
  // 放置的日期、location 用地址/地標名稱),拿到新 entryID 後再呼叫
  // api.setEntryLatLng 補上候選已經有的座標——recordEntry 那支端點本身
  // 不接受 lat/lng(見該函式的說明),必須分兩步。成功後呼叫 onRemove
  // 把這個候選從「候選中」清單移除(它已經變成真正的行程 entry,不該
  // 再留在候選籃裡跟自己重複),再呼叫 onDatesAssigned 讓上游重新查詢
  // tripEntries,新條目會在下一次渲染出現在正確的日期分組。
  const handleCreateEntryFromCandidate = async (c: GeoCandidate, date: string) => {
    if (!tripID || c.kind === 'entry') return
    const location = c.kind === 'attraction' ? (c.landmarkName ?? c.name) : c.address
    const { entryID } = await api.recordEntry(cfg, tripID, { title: c.name, start: date, location })
    await api.setEntryLatLng(cfg, entryID, c.lat, c.lng)
    onRemove?.(c)
    onDatesAssigned?.()
  }

  // draggingCandidate/dragOverDay:拖曳卡片放進日層架某一天的極簡實作——
  // 不用額外的拖放函式庫,直接用瀏覽器原生 HTML5 drag events。
  // draggingCandidate 記住目前正在拖的是哪一張卡片(DayEntryCard/
  // CandidateRow 的 onDragStart 回報,兩種來源共用同一個 state——已排入
  // 行程的卡片放開後改日期,純候選卡片放開後建立新 entry,見下方分派
  // 邏輯),dragOverDay 記住滑鼠目前懸停在哪個日期分組上,用來讓該分組的
  // .dayBody 換成 accent 實線的「可放下」樣式(見下方 dayBody className
  // 的條件式與 .module.css 的 .dayBodyDragOver)。只有「已有日期的分組」
  // 才是合法放置目標——「未排定日期」分組故意不接 onDrop:已排入行程的
  // 卡片若拖過去,PATCH /v1/entries/{id} 的 start 欄位送空字串會被後端
  // 視為「不改該欄位」(見 store.UpdateEntry 的既有行為),沒辦法透過這支
  // API 清空日期;純候選卡片拖過去同樣沒有明確的日期可用於
  // recordEntry,兩種來源都沒有合理行為,故一併排除。
  const [draggingCandidate, setDraggingCandidate] = useState<GeoCandidate | null>(null)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  const handleDropOnDay = async (dayKey: string) => {
    setDragOverDay(null)
    const c = draggingCandidate
    setDraggingCandidate(null)
    if (!c || dayKey === NO_DATE_GROUP) return
    if (c.kind === 'entry') {
      if (dayKey === dayGroupKey(c)) return
      try {
        await handleAssignDate([c], dayKey)
      } catch {
        // 拖曳放開後失敗不彈錯誤訊息打斷瀏覽——理由同其餘查詢/寫入失敗的
        // 既有處理方式,使用者可以再拖一次重試。
      }
      return
    }
    try {
      await handleCreateEntryFromCandidate(c, dayKey)
    } catch {
      // 理由同上——建立失敗不彈錯誤訊息,候選卡片維持在「候選中」清單裡
      // (onRemove 只有成功才會呼叫),使用者可以再拖一次重試。
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="輸入目的地城市,如「東京」"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          onKeyDown={(e) => { if (isSubmitEnter(e)) onSearch() }}
        />
        <button className={styles.searchBtn} onClick={onSearch} disabled={searching || !city.trim()}>
          {searching ? '查詢中...' : '查看'}
        </button>
      </div>
      {searchError && <div className={styles.searchError}>{searchError}</div>}
      <div className="desktop-sidebar-head">
        <span className="desktop-sidebar-title">候選籃 · {candidates.length}</span>
      </div>
      <div className={styles.list}>
        {candidates.length === 0 ? (
          <div className={styles.empty}>
            搜尋或點地圖,把想去的丟進來——右側清單每一項卡片上的「+」可以加入候選。
          </div>
        ) : (
          <>
            {inTrip.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>已排入行程 · {inTrip.length}</div>
                {datedDays.map(([dayKey, dayEntries]) => (
                  <div key={dayKey} className={styles.day}>
                    <div className={styles.dayHead}>
                      <span className={styles.dayDate}>{dayGroupLabel(dayKey)}</span>
                      <span className={styles.dayStatus}>{dayEntries.length} 個安排</span>
                    </div>
                    <div
                      className={`${styles.dayBody}${dragOverDay === dayKey ? ` ${styles.dayBodyDragOver}` : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(dayKey) }}
                      onDragLeave={() => setDragOverDay((d) => (d === dayKey ? null : d))}
                      onDrop={(e) => { e.preventDefault(); handleDropOnDay(dayKey) }}
                    >
                      {dayEntries.map((c) => (
                        <DayEntryCard
                          key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`}
                          c={c}
                          onRemove={onRemove}
                          onSelect={onSelect}
                          onHover={onHover}
                          onDragStart={setDraggingCandidate}
                          onDragEnd={() => { setDraggingCandidate(null); setDragOverDay(null) }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {/* 「隔天」拖放區:只有拖曳進行中(draggingCandidate 有值)且
                    算得出最後一天(nextDayKey)才顯示,平時不佔版面——拖到
                    最後一天最後一張卡片下方,讓使用者能把卡片放進一個目前
                    還沒有任何項目的新日期,不需要先手動選好日期。放開後走
                    跟其餘日期分組一樣的 handleDropOnDay,新條目建立/改期
                    成功後,這個分組會在下一次渲染(onDatesAssigned 觸發
                    重新查詢)變成 datedDays 裡真正的一個分組,這裡只是
                    拖曳當下的臨時佔位,不需要自己維護額外的顯示狀態。 */}
                {draggingCandidate && nextDayKey && (
                  <div className={styles.day}>
                    <div className={styles.dayHead}>
                      <span className={styles.dayDate}>{dayGroupLabel(nextDayKey)}</span>
                      <span className={styles.dayStatus}>隔天 · 拖曳到這裡新增</span>
                    </div>
                    <div
                      className={`${styles.dayBody} ${styles.dayBodyEmpty}${dragOverDay === nextDayKey ? ` ${styles.dayBodyDragOver}` : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(nextDayKey) }}
                      onDragLeave={() => setDragOverDay((d) => (d === nextDayKey ? null : d))}
                      onDrop={(e) => { e.preventDefault(); handleDropOnDay(nextDayKey) }}
                    />
                  </div>
                )}
                {noDateGroup && (
                  <div className={styles.day}>
                    <NoDateDayHead
                      count={noDateGroup[1].length}
                      onAssign={(date) => handleAssignDate(noDateGroup[1], date)}
                    />
                    <div className={styles.dayBody}>
                      {noDateGroup[1].map((c) => (
                        <DayEntryCard
                          key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`}
                          c={c}
                          onRemove={onRemove}
                          onSelect={onSelect}
                          onHover={onHover}
                          onDragStart={setDraggingCandidate}
                          onDragEnd={() => { setDraggingCandidate(null); setDragOverDay(null) }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {onlyCandidate.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>候選中 · {onlyCandidate.length}</div>
                {onlyCandidate.map((c) => (
                  <CandidateRow
                    key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`}
                    c={c}
                    onRemove={onRemove}
                    onSelect={onSelect}
                    onHover={onHover}
                    onDragStart={setDraggingCandidate}
                    onDragEnd={() => { setDraggingCandidate(null); setDragOverDay(null) }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
