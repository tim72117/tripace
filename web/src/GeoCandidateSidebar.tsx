import { useMemo, useState } from 'react'
import { Car, Hotel, ListPlus, MapPin, Plane, StickyNote, Ticket, Undo2, UtensilsCrossed } from 'lucide-react'
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
export function entryKindIcon(kind?: string | null): typeof MapPin {
  return (kind && ENTRY_KIND_ICONS[kind]) || MapPin
}

// PLACE_CATEGORY_TO_ENTRY_KIND:GeoPlace.category(後端封裝過的自訂分類,
// 值域固定是 lodging/tourist_attraction/restaurant,見該欄位的完整說明)
// 對應到 model.Entry.Kind 的值域——兩套字串剛好在這三個類別上重疊,故
// 直接沿用同樣的字串。不要用 GeoPlace.primaryType(Google 原始細分類型,
// 如 "hotel"/"japanese_restaurant")做這個判斷,那是後端已經處理過、
// 前端不該重複解讀的原始資料。
const PLACE_CATEGORY_TO_ENTRY_KIND: Record<string, string> = {
  lodging: 'stay',
  restaurant: 'restaurant',
  tourist_attraction: 'activity',
}

// candidateEntryKind:候選籃項目(飯店/景點/推薦地點/返回候選的 entry)
// 拖進日層架、寫成一筆新 entry 時,推導該用哪個 model.Entry.Kind 值——
// 讓分類資訊在候選 → entry 的轉換過程中保留下來(拖回候選籃、再拖回
// 行程,分類都不會遺失),而不是每次建立新 entry 都固定不分類。
//  - hotel:候選籃裡的飯店類別本身就等同「住宿」,直接對應 'stay'。
//  - place:依 primaryType 查表,查不到(不在 CATEGORY_TAGS 涵蓋的三種
//    類型內)一律退回 'activity'——理由同 PLACE_CATEGORY_GLYPHS 的
//    CAMERA_GLYPH fallback,泛用推薦地點沒有更精確分類時,「這是個值得
//    去的活動地點」是最保守合理的預設。
//  - attraction:人工建檔的景點區域,沒有 Google Places 分類可查,固定
//    對應 'activity'。
//  - entry(返回候選後、尚未真正排入行程的候選,inTrip===false):直接
//    沿用它自己保留的 entryKind(見 GeoCandidate 型別定義處的說明),
//    沒有值時退回 'activity'——理論上不該發生(entryKind 在
//    onTripEntriesChange 建立候選時一律會帶入,即使後端該筆 entry 本身
//    沒有設 kind,值也會是 null/undefined,一樣落到這個 fallback),
//    保守起見仍處理。
export function candidateEntryKind(c: GeoCandidate): string {
  if (c.kind === 'hotel') return 'stay'
  if (c.kind === 'place') return (c.category && PLACE_CATEGORY_TO_ENTRY_KIND[c.category]) ?? 'activity'
  if (c.kind === 'entry') return c.entryKind ?? 'activity'
  return 'activity'
}

// createEntryFromCandidate:把一個純候選(飯店/景點/推薦地點,或按過
// 「返回候選」、inTrip===false 的 entry 形狀候選)寫成一筆真正的行程
// entry——抽成獨立函式供兩處呼叫端共用(GeoCandidateSidebar 的拖曳放進
// 日層架、GeoHotelSidebar/GeoInfoPanel 的「+」按鈕展開日期選擇後直接
// 建立),避免同一段「recordEntry 再 setEntryLatLng 補座標」的兩步驟邏輯
// 兩處各寫一份、之後改一邊忘了改另一邊。title 用候選名稱、start 用選定
// 的日期、location 用地址/地標名稱、kind 用 candidateEntryKind 推導出的
// 分類。recordEntry 端點本身不接受 lat/lng(見 api.ts 的 RecordEntryInput
// 說明),必須分兩步呼叫。
export async function createEntryFromCandidate(
  cfg: ClientConfig,
  tripID: string,
  c: GeoCandidate,
  date: string,
): Promise<string> {
  const location = c.kind === 'attraction' ? (c.landmarkName ?? c.name)
    : c.kind === 'entry' ? (c.location ?? '')
    : c.address
  const { entryID } = await api.recordEntry(cfg, tripID, {
    title: c.name,
    start: date,
    location,
    kind: candidateEntryKind(c),
  })
  await api.setEntryLatLng(cfg, entryID, c.lat, c.lng)
  return entryID
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
//
// inTrip(僅 kind:'entry' 才有):區分「這筆 entry 形狀的項目是否真的已經
// 排入行程」——true 代表後端真的有這筆 entry 資料(來自
// onTripEntriesChange 查詢結果),顯示在「已排入行程」分組;false 代表
// 使用者按過「返回候選」(見 DayEntryCard 的說明),後端那筆 entry 已經
// 被真的刪除(api.deleteEntry),但本地保留這個物件的完整內容(名稱/
// 座標/地址/原本的分類 entryKind)讓它繼續顯示在「候選中」分組,不需要
// 因為沒有原始 hotel/attraction/place 資料就被迫遺失照片以外的所有
// 資訊。之所以沒有拿掉 entry 形狀改成硬塞回 hotel/attraction/place 其中
// 一種:那三種形狀的專屬欄位(landmarkPhotoUrl/primaryType 等)在 entry
// 資料裡從一開始就不存在(entries 資料表沒有存這些),假造一個不存在的
// 來源分類反而失真——entry 形狀本身(名稱+地址+座標+entryKind)已經是
// 這筆資料唯一誠實、可還原的樣貌。
//
// entryKind:entry 本身的類型(對齊 model.Entry.Kind,如
// "stay"/"activity"/"restaurant",見 GeoTripEntry.kind 的完整說明)——
// 刻意改名、不直接沿用 GeoTripEntry 原本的 kind 欄位,是因為 GeoCandidate
// 本身也有一個叫 kind 的判別欄位(用來分辨 hotel/attraction/place/entry
// 四種來源,即這裡的 'entry' 字面值),兩個 kind 同名會在交集型別合併時
// 互相覆蓋——過去的寫法(見已修正前的版本)讓判別欄位的字面值 'entry'
// 蓋掉了 entry 本身的分類值,導致 DayEntryCard 的圖示永遠退回預設的
// MapPin,從未正確顯示過飯店/餐廳專屬圖示(實際存在的既有 bug,這次
// 一併修正)。用 Omit<GeoTripEntry, 'kind'> 明確排除原本的 kind 欄位,
// 改用 entryKind 承接同一份資料,兩個欄位的語意才不會互相打架。
export type GeoCandidate =
  | ({ kind: 'hotel' } & GeoHotel)
  | ({ kind: 'attraction' } & GeoAttraction)
  | ({ kind: 'place' } & GeoPlace)
  | ({ kind: 'entry'; inTrip: boolean; entryKind?: string | null } & Omit<GeoTripEntry, 'kind'>)

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

// candidateListKey:候選籃清單渲染用的 React key——entry 形狀的候選(見
// GeoTripEntry.id 的說明)有穩定、保證唯一的 id,優先使用;其餘三種
// (hotel/attraction/place)沒有穩定 id(即時查詢結果),退回原本的
// 「名稱+座標」組合。過去三處渲染(datedDays.map/noDateGroup.map/
// onlyCandidate.map)一律都用「名稱+座標」當 key,即使是 entry 形狀也
// 一樣——如果使用者把同一個候選拖進行程兩次,會產生兩筆不同 id、但
// 名稱/座標完全相同的 entry,key 就會撞在一起,觸發 React 的 duplicate
// key 警告(實際發生過的 bug)。改用這個函式統一產生 key,entry 形狀
// 一律用它自己的 id,徹底避開這個碰撞。
export function candidateListKey(c: GeoCandidate): string {
  if (c.kind === 'entry') return `entry-${c.id}`
  return `${c.kind}-${c.name}-${c.lat}-${c.lng}`
}
export function dayGroupLabel(key: string): string {
  if (key === NO_DATE_GROUP) return '未排定日期'
  const [, month, day] = key.split('-')
  return month && day ? `${Number(month)}/${Number(day)}` : key
}

// localDateKey:把一個 Date 物件轉成 YYYY-MM-DD 字串,全程用本地時間的
// 年/月/日欄位組字串,不經過任何 UTC 轉換——不能用 d.toISOString().
// slice(0, 10) 這種常見寫法,那會先把時間轉成 UTC 再取字串,在 UTC 之後
// 的時區(例如 UTC+7/+8)最明顯的症狀是:本地深夜到隔天日出前這段
// 時間,算出來的日期會倒退回前一天(實際發生過的 bug——見下方 todayKey/
// nextDayKey 的呼叫處)。
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  onReturnToCandidate,
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
  // onReturnToCandidate:「返回候選」按鈕觸發(只在 inTrip===true 時
  // 顯示,見下方 render 條件)——把這筆真正已排入行程的 entry 退回候選籃
  // (見呼叫端 handleReturnToCandidate 的完整說明:真的刪除後端那筆
  // entry,本地保留內容並標記 inTrip:false)。跟既有的「×」(onRemove)
  // 語意不同,不互相取代:onRemove 只從前端候選籃清單移除、不動後端
  // 資料(換行程/重新查詢時舊行為仍會讓它重新出現);這顆新按鈕才是
  // 「真的讓這筆項目不再算入行程」的操作。
  onReturnToCandidate?: (candidate: GeoCandidate & { kind: 'entry'; inTrip: true }) => void
}) {
  return (
    <div
      className={styles.dayCard}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.name); onDragStart?.(c) }}
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
            const Icon = entryKindIcon(c.entryKind)
            return <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          })()}
        </span>
        <span className={styles.dayCardName}>{c.name}</span>
        {c.startTime && <span className={styles.dayCardTime}>{c.startTime}</span>}
      </div>
      {c.inTrip && (
        <button
          type="button"
          className={styles.returnToCandidateBtn}
          onClick={() => onReturnToCandidate?.(c as GeoCandidate & { kind: 'entry'; inTrip: true })}
          title="返回候選"
        >
          <Undo2 size={13} strokeWidth={2} />
        </button>
      )}
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
  onReturnToCandidate,
  onPickFromCandidate,
  draggingCandidate,
  onDraggingCandidateChange,
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
  // onReturnToCandidate:「返回候選」按鈕(見 DayEntryCard 的說明)成功
  // 刪除後端 entry 後觸發,通知呼叫端(DesktopLayout.tsx)把這個物件的
  // inTrip 改成 false、留在 geoCandidates 裡——這個元件不持有
  // geoCandidates state,無法自己改,只能請上游代為更新(同
  // onDatesAssigned 既有的模式)。
  onReturnToCandidate?: (candidate: GeoCandidate & { kind: 'entry'; inTrip: true }) => void
  // onPickFromCandidate:某一天 dayHead 的「從候選加入」按鈕按下時觸發,
  // 帶上該天的 dayKey——這個元件不再自己持有「目前是為哪一天開啟第二
  // 側欄」的狀態(pickingDayKey 已提升到 DesktopLayout.tsx,因為第二側欄
  // 是絕對定位疊在 main 之上的獨立元件(AddFromCandidateSidebar,見該
  // 檔案的說明),只能由共同的父層中介才能同時控制兩者),這裡只負責回報
  // 使用者按了哪一天的按鈕。
  onPickFromCandidate?: (dayKey: string) => void
  // draggingCandidate/onDraggingCandidateChange:目前正在拖曳的候選卡片
  // ——原本是這個元件內部的 state,提升到 DesktopLayout.tsx 是因為「候選
  // 中」清單已經搬進第二側欄(AddFromCandidateSidebar,使用者明確要求),
  // 拖曳現在會跨元件:起點在第二側欄的候選卡片,放開目標是這個元件底下
  // 的日期分組 .dayBody。兩個分開掛載的 sibling 只能靠共同的父層持有
  // 這份 state 才能互相溝通「現在正在拖哪一張」。dragOverDay(滑鼠懸停在
  // 哪個日期分組上)不需要跨元件,仍是這個元件自己的內部 state(見下方)
  // ——那份狀態只影響這個元件自己畫出的 .dayBody 樣式,不需要讓第二側欄
  // 知道。
  draggingCandidate: GeoCandidate | null
  onDraggingCandidateChange: (c: GeoCandidate | null) => void
}) {
  // 已排入行程:kind === 'entry' && inTrip === true 是行程本身已有座標的
  // 既有內容(進入規劃分頁時自動帶入,見上方型別註解),不是使用者用「+」
  // 手動加入的——這批天然就等於「已排入行程」。其餘情況(hotel/
  // attraction/place,或按過「返回候選」、kind==='entry' 但
  // inTrip===false 的項目)是候選中,已搬到第二側欄
  // (AddFromCandidateSidebar,使用者明確要求),這個元件不再顯示,故不
  // 需要在這裡算出對應的篩選結果。
  const inTrip = candidates.filter((c): c is GeoCandidate & { kind: 'entry'; inTrip: true } => c.kind === 'entry' && c.inTrip)

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
    // new Date(lastDatedDayKey + 'T00:00:00') 這個「有時間但沒帶時區」的
    // 字串會被解析成本地時間午夜,setDate()/getDate() 也是本地時間運算,
    // 這兩步都正確——關鍵是轉回字串時要用 localDateKey(見該函式說明),
    // 不能用 toISOString(),否則算出的「隔天」在某些時區會倒退回原本
    // 那天(實際發生過的 bug)。
    const d = new Date(lastDatedDayKey + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return localDateKey(d)
  }, [lastDatedDayKey])

  // todayKey:全新行程(inTrip 完全是空的,連「未排定日期」分組都沒有——
  // 一筆 entry 都還沒有)時,拖曳純候選卡片沒有任何現成的日期分組可以
  // 拖進去,因為下方 datedDays.map/noDateGroup 兩條路徑都要求「已經有
  // 至少一筆 entry」才有東西可渲染,nextDayKey 也因為 lastDatedDayKey 是
  // null 而算不出來——形成候選籃永遠無法幫全新行程排出第一天的死角
  // (實際發生過的 bug,不是預防性寫法)。用今天當第一天的預設值,只在
  // inTrip.length === 0 且拖曳中時顯示這個佔位拖放區,建立成功後
  // (onDatesAssigned 觸發重新查詢)inTrip 就不再是空的,這個特例分支
  // 自然被下方 inTrip.length > 0 的正常渲染路徑取代,不需要額外狀態
  // 收尾。
  const todayKey = useMemo(() => localDateKey(new Date()), [])

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

  // handleReturnToCandidate:「返回候選」按鈕觸發(見 DayEntryCard 的
  // 說明)——先呼叫 api.deleteEntry 真的把後端那筆 entry 刪除(不像
  // onRemove 只從前端候選籃清單移除、後端資料仍在),成功後呼叫
  // onReturnToCandidate 讓上游(DesktopLayout.tsx)把這個物件的 inTrip
  // 改成 false、繼續留在 geoCandidates 裡——這個元件本身不持有
  // geoCandidates state(見上方元件註解「維持這個元件單純是受控呈現
  // 層」),不能自己改,只能呼叫回呼委託上游處理。刪除失敗不彈錯誤訊息
  // 打斷瀏覽,理由同其餘拖放/日期寫入失敗的既有處理方式,印 console 供
  // 除錯即可,使用者可以再按一次重試。
  const handleReturnToCandidate = async (c: GeoCandidate & { kind: 'entry'; inTrip: true }) => {
    try {
      await api.deleteEntry(cfg, c.id)
      onReturnToCandidate?.(c)
    } catch (err) {
      console.error('[GeoCandidateSidebar] 返回候選失敗:', err)
    }
  }

  // handleRemove:「×」按鈕觸發——真正已排入行程的項目
  // (kind==='entry' && inTrip===true)點「×」時,要先呼叫
  // api.deleteEntry 把後端那筆 entry 真的刪除,成功才呼叫 onRemove 讓
  // 上游把它從前端 geoCandidates 移除;過去「×」對這種項目只從前端
  // 畫面移除、完全沒動後端資料,重新整理頁面或任何情境觸發
  // onTripEntriesChange 重新查詢時,這筆資料會重新出現在候選籃,使用者
  // 會誤以為「刪除」沒有生效(實際發生過的 bug)。其餘情況(候選中的
  // hotel/attraction/place,或 inTrip===false 的 entry——後端那筆已經
  // 在先前「返回候選」時被刪除,這裡沒有東西可刪)本來就沒有對應的後端
  // 資料,維持原本「只從前端移除」的行為,不需要呼叫任何 API。刪除失敗
  // 時不從前端移除(避免畫面顯示跟後端狀態不一致),只印 console 供
  // 除錯,使用者可以再按一次重試。
  const handleRemove = async (c: GeoCandidate) => {
    if (c.kind === 'entry' && c.inTrip) {
      try {
        await api.deleteEntry(cfg, c.id)
      } catch (err) {
        console.error('[GeoCandidateSidebar] 刪除已排入行程項目失敗:', err)
        return
      }
    }
    onRemove?.(c)
  }

  // handleCreateEntryFromCandidate:拖曳純候選(飯店/景點/推薦地點,或
  // 按過「返回候選」、inTrip===false 的 entry 形狀候選)放進某一天時
  // 觸發——這批候選目前都不是真正的行程 entry(entry 形狀但
  // inTrip===false 的那批,後端那筆 entry 先前已被 deleteEntry 真的刪除,
  // 見 DayEntryCard「返回候選」的說明),要先用 api.recordEntry 寫成一筆
  // 新 entry(title 用候選名稱、start 用放置的日期、location 用地址/
  // 地標名稱、kind 用 candidateEntryKind 推導出的分類,讓分類資訊不會
  // 因為候選 ↔ entry 來回轉換而遺失),拿到新 entryID 後再呼叫
  // api.setEntryLatLng 補上候選已經有的座標——recordEntry 那支端點本身
  // 不接受 lat/lng(見該函式的說明),必須分兩步。成功後呼叫 onRemove
  // 把這個候選從「候選中」清單移除(它已經變成真正的行程 entry,不該
  // 再留在候選籃裡跟自己重複),再呼叫 onDatesAssigned 讓上游重新查詢
  // tripEntries,新條目會在下一次渲染出現在正確的日期分組。
  const handleCreateEntryFromCandidate = async (c: GeoCandidate, date: string) => {
    if (!tripID) return
    await createEntryFromCandidate(cfg, tripID, c, date)
    onRemove?.(c)
    onDatesAssigned?.()
  }

  // dragOverDay:拖曳卡片放進日層架某一天的極簡實作——不用額外的拖放
  // 函式庫,直接用瀏覽器原生 HTML5 drag events。draggingCandidate(目前
  // 正在拖的是哪一張卡片)已提升為受控 props(見上方型別註解的說明),
  // 這裡的 dragOverDay 記住滑鼠目前懸停在哪個日期分組上,用來讓該分組的
  // .dayBody 換成 accent 實線的「可放下」樣式(見下方 dayBody className
  // 的條件式與 .module.css 的 .dayBodyDragOver)。只有「已有日期的分組」
  // 才是合法放置目標——「未排定日期」分組故意不接 onDrop:已排入行程的
  // 卡片若拖過去,PATCH /v1/entries/{id} 的 start 欄位送空字串會被後端
  // 視為「不改該欄位」(見 store.UpdateEntry 的既有行為),沒辦法透過這支
  // API 清空日期;純候選卡片拖過去同樣沒有明確的日期可用於
  // recordEntry,兩種來源都沒有合理行為,故一併排除。
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  const handleDropOnDay = async (dayKey: string) => {
    setDragOverDay(null)
    const c = draggingCandidate
    onDraggingCandidateChange(null)
    if (!c || dayKey === NO_DATE_GROUP) return
    // 只有「真的已排入行程」的 entry(inTrip===true)才走改期路徑——
    // inTrip===false 的 entry 形狀候選(按過「返回候選」,見
    // DayEntryCard 的說明)後端那筆 entry 已經被刪除,沒有 id 可以
    // PATCH,必須走下面 handleCreateEntryFromCandidate 重新建立一筆
    // 新 entry(kind 用 candidateEntryKind 讀回它保留的 entryKind,分類
    // 不會遺失)。
    if (c.kind === 'entry' && c.inTrip) {
      if (dayKey === dayGroupKey(c)) return
      try {
        await handleAssignDate([c], dayKey)
      } catch (err) {
        // 拖曳放開後失敗不彈錯誤訊息打斷瀏覽——理由同其餘查詢/寫入失敗的
        // 既有處理方式,使用者可以再拖一次重試。仍印到 console 供除錯,
        // 避免完全沒有線索可查(這支 API 失敗原因可能是權限/網路等,不
        // 應該對使用者完全不可見)。
        console.error('[GeoCandidateSidebar] 拖曳改期失敗:', err)
      }
      return
    }
    try {
      await handleCreateEntryFromCandidate(c, dayKey)
    } catch (err) {
      // 理由同上——建立失敗不彈錯誤訊息,候選卡片維持在「候選中」清單裡
      // (onRemove 只有成功才會呼叫),使用者可以再拖一次重試。
      console.error('[GeoCandidateSidebar] 拖曳建立行程失敗:', err)
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
            {/* 全新行程(inTrip 完全是空的)拖曳純候選卡片時的佔位拖放區——
                見上方 todayKey 的說明,解決「一筆 entry 都沒有時,候選籃
                永遠沒有任何地方可以拖放」的死角。放在 inTrip.length > 0
                分支之外、之前,是因為兩者互斥(有 entry 就不會是全新
                行程,不需要同時渲染)。放開後走跟其餘日期分組一樣的
                handleDropOnDay,建立成功後 inTrip 不再是空的,下一次
                渲染會改用下方正常的 datedDays 分組路徑,這裡不需要自己
                收尾。
                平時就常駐顯示(不再靠 draggingCandidate 切換
                display:none/顯示)——之前用 display:none 隱藏、只在拖曳
                中才顯示的做法,雖然沒有插入/移除 DOM 節點,但顯示/隱藏
                切換本身仍然會改變這個區塊的版面高度,一樣會把下面的
                「候選中」清單(以及正在被拖曳的那張卡片本身,若它排在
                這個區塊下面)往下推——瀏覽器判定拖曳來源元素在
                dragstart 後的極短時間內位置被改變,直接中止這次拖曳
                (實際發生過的 bug:候選卡片按下拖曳後完全沒有跟著游標
                移動的視覺回饋,交叉測試證實只要把候選卡片挪到不受這個
                佔位區高度變化影響的位置就能正常拖曳)。改成平時就顯示,
                版面高度從頭到尾都穩定,才是真正避開這個陷阱的做法。 */}
            {inTrip.length === 0 && (
              <div className={styles.group}>
                <div className={styles.day}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayDate}>{dayGroupLabel(todayKey)}</span>
                    <span className={styles.dayStatus}>拖曳到這裡開始排行程</span>
                  </div>
                  <div
                    className={`${styles.dayBody} ${styles.dayBodyEmpty}${dragOverDay === todayKey ? ` ${styles.dayBodyDragOver}` : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverDay(todayKey) }}
                    onDragLeave={() => setDragOverDay((d) => (d === todayKey ? null : d))}
                    onDrop={(e) => { e.preventDefault(); handleDropOnDay(todayKey) }}
                  />
                </div>
              </div>
            )}
            {inTrip.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>已排入行程 · {inTrip.length}</div>
                {datedDays.map(([dayKey, dayEntries]) => (
                  <div key={dayKey} className={styles.day}>
                    <div className={styles.dayHead}>
                      <span className={styles.dayDate}>{dayGroupLabel(dayKey)}</span>
                      <span className={styles.dayStatus}>{dayEntries.length} 個安排</span>
                      <button
                        type="button"
                        className={styles.addFromCandidateBtn}
                        onClick={() => onPickFromCandidate?.(dayKey)}
                        title="從候選加入"
                      >
                        <ListPlus size={13} strokeWidth={2} />
                        從候選加入
                      </button>
                    </div>
                    <div
                      className={`${styles.dayBody}${dragOverDay === dayKey ? ` ${styles.dayBodyDragOver}` : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(dayKey) }}
                      onDragLeave={() => setDragOverDay((d) => (d === dayKey ? null : d))}
                      onDrop={(e) => { e.preventDefault(); handleDropOnDay(dayKey) }}
                    >
                      {dayEntries.map((c) => (
                        <DayEntryCard
                          key={candidateListKey(c)}
                          c={c}
                          onRemove={handleRemove}
                          onSelect={onSelect}
                          onHover={onHover}
                          onDragStart={onDraggingCandidateChange}
                          onDragEnd={() => { onDraggingCandidateChange(null); setDragOverDay(null) }}
                          onReturnToCandidate={handleReturnToCandidate}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {/* 「隔天」拖放區:算得出最後一天(nextDayKey)時才有意義
                    渲染(沒有任何已有日期的分組就沒有「隔天」可言),拖到
                    最後一天最後一張卡片下方,讓使用者能把卡片放進一個目前
                    還沒有任何項目的新日期,不需要先手動選好日期。放開後走
                    跟其餘日期分組一樣的 handleDropOnDay,新條目建立/改期
                    成功後,這個分組會在下一次渲染(onDatesAssigned 觸發
                    重新查詢)變成 datedDays 裡真正的一個分組,這裡只是
                    拖曳當下的臨時佔位,不需要自己維護額外的顯示狀態。
                    平時就常駐顯示(理由同上方「全新行程」佔位拖放區的
                    說明)——若只在拖曳中才顯示,顯示/隱藏切換造成的版面
                    高度變化會把拖曳來源元素往下推,導致瀏覽器判定拖曳
                    無效而中止。 */}
                {nextDayKey && (
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
                          key={candidateListKey(c)}
                          c={c}
                          onRemove={handleRemove}
                          onSelect={onSelect}
                          onHover={onHover}
                          onDragStart={onDraggingCandidateChange}
                          onDragEnd={() => { onDraggingCandidateChange(null); setDragOverDay(null) }}
                          onReturnToCandidate={handleReturnToCandidate}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
