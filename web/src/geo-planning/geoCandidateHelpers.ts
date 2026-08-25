// geoCandidateHelpers:候選籃(GeoCandidateSidebar.tsx)相關的純函式與型別
// 定義,不含任何 React JSX——從 GeoCandidateSidebar.tsx 抽出,理由是這批
// 型別/函式被多個檔案廣泛引用(DesktopLayout.tsx、GeoHotelSidebar.tsx、
// GeoInfoPanel.tsx、AddFromCandidateSidebar.tsx),讓這些呼叫端只依賴這批
// 純邏輯時,不需要把整支候選籃 UI 元件檔案一起拉進 bundle 依賴圖。
// GeoCandidateSidebar.tsx 本身也從這裡 re-import 使用,行為與抽出前完全
// 一致,只是定義位置搬動。
import { useState } from 'react'
import * as api from '../api'
import type { ClientConfig, GeoAttraction, GeoHotel, GeoPlace, GeoSearchResult, GeoTripEntry } from '../api'
import { Car, Hotel, MapPin, Plane, StickyNote, Ticket, UtensilsCrossed } from 'lucide-react'

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
//
// inTrip(僅 kind:'entry' 才有):區分「這筆 entry 形狀的項目是否真的已經
// 排入行程」——true 代表後端真的有這筆 entry 資料(來自
// onTripEntriesChange 查詢結果),顯示在「已排入行程」分組;false 代表
// 使用者按過「返回候選」(見 GeoCandidateSidebar.tsx 的 DayEntryCard 說明),
// 後端那筆 entry 已經被真的刪除(api.deleteEntry),但本地保留這個物件的
// 完整內容(名稱/座標/地址/原本的分類 entryKind)讓它繼續顯示在「候選中」
// 分組,不需要因為沒有原始 hotel/attraction/place 資料就被迫遺失照片以外
// 的所有資訊。
export type GeoCandidate =
  | ({ kind: 'hotel' } & GeoHotel)
  | ({ kind: 'attraction' } & GeoAttraction)
  | ({ kind: 'place' } & GeoPlace)
  | ({ kind: 'entry'; inTrip: boolean; entryKind?: string | null } & Omit<GeoTripEntry, 'kind'>)

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

// searchResultToCandidate:把 GeoSearchResult(飯店/推薦地點/搜尋結果
// 三種來源統一後的清單形狀,見 api.ts 的完整說明)轉成 GeoCandidate——
// 只有 hotel/place 兩種 kind 能加入候選籃(geocode 純定位用途,理由見
// GeoSearchResult 的說明,呼叫端應先用 r.kind !== 'geocode' 篩掉再呼叫
// 這支函式,故這裡的參數型別直接排除 geocode,由 TypeScript 在呼叫端
// 強制檢查,不需要在函式內部再判斷一次)。primaryType 補空字串,理由
// 同 poiInfoContent(geoInfoContent.ts)的既有慣例——這裡的候選籃資料
// 本來就只拿 name/address/lat/lng/photoUrl(/category)顯示,primaryType
// 沒有任何顯示邏輯依賴它。
//
// 抽成這支函式前,這段轉換邏輯在 geoInfoContent.ts、GeoHotelSidebar.tsx、
// GeoOutlinePhoneListDrawer.tsx 三處各自逐字重複——正是這個檔案開頭
// 註解反覆提醒要避免的「兩處各寫一份、之後改一邊忘了改另一邊」模式,
// 這次一併修正,三處呼叫端改叫這支函式。
export function searchResultToCandidate(r: Exclude<GeoSearchResult, { kind: 'geocode' }>): GeoCandidate {
  if (r.kind === 'hotel') {
    return { kind: 'hotel', name: r.name, address: r.address, lat: r.lat, lng: r.lng, primaryType: '', photoUrl: r.photoUrl }
  }
  return { kind: 'place', name: r.name, address: r.address, lat: r.lat, lng: r.lng, primaryType: '', category: r.category, photoUrl: r.photoUrl }
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

// dayGroupLabel/dayGroupKey:把「已排入行程」的 entry 依 start 日期分組——
// 對齊構想 5 桌面同屏並置原型(見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)右欄「日層架」的呈現方式:
// 每天一個區塊,標題顯示日期與該天已有幾個安排,底下才是卡片清單。沒有
// start 的 entry(尚未排定日期,理由同 Timeline.tsx 對無日期 entry 的
// 處理)另外歸進「未排定日期」分組,排在最後。
export const NO_DATE_GROUP = '__no_date__'
export function dayGroupKey(c: GeoCandidate): string {
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
// 時間,算出來的日期會倒退回前一天(實際發生過的 bug——見
// GeoCandidateSidebar.tsx 的 todayKey/nextDayKey/prevDayKey 呼叫處)。
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// candidateHasScheduledDate:判斷這個候選是否已經有排定日期——只有
// kind==='entry' 且 start 非空字串的候選才符合(entry 是「返回候選」後
// 暫時退回候選籃、但仍保留原本 start/startTime 的項目,見 GeoCandidate
// 型別定義的完整說明;hotel/attraction/place 三種來源天生沒有日期概念,
// 一律視為「沒有排定日期」)。供各處「加入候選」按鈕決定要不要先跳日期
// 選擇——桌面版 GeoInfoPanel.tsx 與手機版 GeoOutlinePhoneInfoSheet.tsx
// 原本各自獨立定義過一份逐字相同的複製,收斂成這裡的單一定義。
export function candidateHasScheduledDate(c: GeoCandidate): boolean {
  return c.kind === 'entry' && !!c.start
}

// useCandidateDatePicker:「選日期把候選寫成真正的行程 entry」這段 async
// 流程的共用核心——桌面版 GeoHotelSidebar.tsx 的 AddCandidateButton(懸浮
// popover)、手機版 GeoOutlinePhoneListDrawer.tsx 的 ItemAddButton(原地
// 展開)、GeoOutlinePhoneCandidateDrawer.tsx 的 CandidateRow(原地展開)
// 三處原本各自重寫一份逐字幾乎相同的 saving/err state + try/catch/finally
// 呼叫 createEntryFromCandidate 邏輯,只有「選好日期後」的收尾動作不同
// (收合 popover/清空輸入框/通知外部刷新)——這裡把 saving/err state 與
// 實際發 API 呼叫的部分收斂成一個 hook,呼叫端只需要傳入「成功後要做
// 什麼」(onScheduled),自己決定要不要額外收合 UI 狀態,視覺外殼(懸浮
// popover vs. 原地展開的 inline 區塊)本身因觸控/滑鼠操作習慣不同而各自
// 維護,不在這裡收斂。
//
// candidate 用 getter(而非直接傳值)是因為呼叫端(如 ItemAddButton)的
// candidate prop 在使用者操作 UI 展開期間可能因為上層重新查詢而變成新的
//物件參照(座標/名稱不變,但陣列 map 產生新物件)——這個 hook 本身沒有
// state 依賴 candidate,不需要 re-render 時重建 handlePick,用 getter 讀
// 呼叫當下最新的值即可,不需要為此把 candidate 放進任何依賴陣列。
export function useCandidateDatePicker({
  cfg,
  tripID,
  getCandidate,
  onScheduled,
}: {
  cfg: ClientConfig
  tripID?: string | null
  getCandidate: () => GeoCandidate
  // onScheduled:成功寫入後端 entry 後觸發——呼叫端決定要收合哪個 UI
  // 狀態、要不要清空輸入框、要不要通知外部重新查詢 tripEntries,這個
  // hook 本身不管視覺呈現。
  onScheduled: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePick = async (date: string) => {
    if (!date || !tripID) return
    setSaving(true)
    setErr(null)
    try {
      await createEntryFromCandidate(cfg, tripID, getCandidate(), date)
      onScheduled()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return { saving, err, handlePick }
}
