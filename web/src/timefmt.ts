// timefmt.ts:Entry/Trip 的時間欄位是 ISO 8601 timestamp(UTC,見 types.ts 的
// startAt/endAt)+ 該筆記錄自己的時區(tz,IANA 名稱如 "Asia/Tokyo")。
//
// 顯示端一律要用「這筆記錄自己的時區」換算,而非瀏覽器/裝置的當地時區——
// 旅遊行程的時間是「目的地當地時間」,不是「檢視者所在地時間」,兩者在使用者
// 抵達目的地前後會不一致(對齊後端 server/internal/store/timeconv.go 的
// FormatLocalDateTime/ParseLocalDateTime,前後端用同一套時區語意)。
//
// 用瀏覽器原生 Intl.DateTimeFormat 做時區換算,不需要額外套件依賴。

const FALLBACK_TZ = 'Asia/Taipei'

// resolveTz 決定實際換算用的時區:tz 為空或無法辨識的名稱時退回 FALLBACK_TZ
// (呼應後端 store.LoadTimeZoneOrDefault 的行為)。
export function resolveTz(tz: string | undefined | null): string {
  if (!tz) return FALLBACK_TZ
  try {
    // Intl 對無效時區名會直接 throw,藉此驗證 tz 是否為合法 IANA 名稱。
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return FALLBACK_TZ
  }
}

interface LocalParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
}

function partsInTz(iso: string, tz: string): LocalParts {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const out: Partial<LocalParts> = {}
  for (const part of fmt.formatToParts(d)) {
    if (part.type === 'year') out.year = part.value
    if (part.type === 'month') out.month = part.value
    if (part.type === 'day') out.day = part.value
    if (part.type === 'hour') out.hour = part.value === '24' ? '00' : part.value
    if (part.type === 'minute') out.minute = part.value
  }
  return out as LocalParts
}

// localDateStr 回傳 iso 依 tz 換算後的日期字串 'YYYY-MM-DD'。iso 為空回空字串。
// 用於依日期分組/排序時取得「這筆記錄自己時區的當地日期」,取代直接對
// ISO 字串做 UTC slice(0, 10) 這種會因時區而分錯天的做法。
export function localDateStr(iso: string | null | undefined, tz: string | undefined | null): string {
  if (!iso) return ''
  const p = partsInTz(iso, resolveTz(tz))
  return `${p.year}-${p.month}-${p.day}`
}

// localTimeStr 回傳 iso 依 tz 換算後的時刻字串 'HH:MM'。iso 為空回空字串。
export function localTimeStr(iso: string | null | undefined, tz: string | undefined | null): string {
  if (!iso) return ''
  const p = partsInTz(iso, resolveTz(tz))
  return `${p.hour}:${p.minute}`
}

// formatLocal 是 localDateStr/localTimeStr 的組合,對齊後端
// store.FormatLocalDateTime 的簽章與行為:allDay=true 時只回日期,時刻固定
// 回空字串(對齊「空字串=全日」的既有前端顯示慣例)。
export function formatLocal(
  iso: string | null | undefined,
  tz: string | undefined | null,
  allDay: boolean | undefined,
): { date: string; time: string } {
  const date = localDateStr(iso, tz)
  if (!date) return { date: '', time: '' }
  if (allDay) return { date, time: '' }
  return { date, time: localTimeStr(iso, tz) }
}

// formatLocalDisplay 把 formatLocal 的結果組成單一顯示字串(如
// "2026-06-29 15:00" 或全日時只有 "2026-06-29"),各元件顯示時通用。
export function formatLocalDisplay(
  iso: string | null | undefined,
  tz: string | undefined | null,
  allDay: boolean | undefined,
): string {
  const { date, time } = formatLocal(iso, tz, allDay)
  if (!date) return ''
  return time ? `${date} ${time}` : date
}

// compareIso 比較兩個(可能為 undefined/null 的)ISO 字串代表的時刻先後,
// 供排序用:回傳負值表示 a 早於 b。undefined/null 視為「沒有時間」,排在
// 有時間的項目之後(對齊 Timeline 原本「無時間排最後」的排序慣例)。
export function compareIso(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return new Date(a).getTime() - new Date(b).getTime()
}

// combineLocalDateTime 把「本地日期字串 + 時刻字串 + 時區」組成 ISO 8601
// timestamp(UTC),供編輯表單提交時用——是 formatLocal 的反向操作。
// date 為空回 undefined(代表沒有時間資訊,呼叫端應據此決定 API 欄位是否要帶)。
// timeStr 為空時視為全日,取當天 00:00(對齊後端 ParseLocalDateTime 的全日語意)。
export function combineLocalDateTime(
  date: string,
  timeStr: string,
  tz: string | undefined | null,
): string | undefined {
  if (!date) return undefined
  const resolvedTz = resolveTz(tz)
  const hm = timeStr || '00:00'
  // 用 Intl 反查「這個時區在這個本地時刻時的 UTC offset」:先假設 UTC 組出
  // 一個時間點,再用 Intl 讀出該時間點在目標時區顯示的本地時刻,兩者的差
  // 即為 offset,據此反推真正的 UTC 時刻。這個做法比手動維護 offset 表更
  // 可靠,能自動處理夏令時等規則(雖然本專案常用時區多為亞洲,較少遇到)。
  const naiveUtc = new Date(`${date}T${hm}:00Z`)
  const shifted = partsInTz(naiveUtc.toISOString(), resolvedTz)
  const shiftedAsUtc = new Date(
    `${shifted.year}-${shifted.month}-${shifted.day}T${shifted.hour}:${shifted.minute}:00Z`,
  )
  const offsetMs = naiveUtc.getTime() - shiftedAsUtc.getTime()
  return new Date(naiveUtc.getTime() + offsetMs).toISOString()
}
