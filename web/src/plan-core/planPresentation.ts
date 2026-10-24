// planPresentation.ts — 行程畫面共用的「呈現常數」:備註分類的顏色/圖示、交通方式選單的選項。只放常數與純函式,不含任何 React 或視圖行為。
//
// 為什麼集中在這裡:同一份對照表原本分散在 TripPlanPage.tsx(NOTE_STYLES)、PlanTimelineView.tsx(NOTE_STYLES + TRANSIT_MODE_OPTIONS)、
// HorizontalPlanTimeline.tsx(NOTE_CATEGORY_META + TRANSIT_MODE_OPTIONS)各自宣告一份,改一個分類或加一種交通方式要改三處,
// 漏改任何一處就會出現「同一種備註在不同畫面長不一樣」。三處的內容(分類 key、配色 token、預設分類、四個交通方式字串)原本就相同,
// 唯一差別是圖示呈現:縱向視圖與 TripPlanPage 用 emoji 字元(noteIcon),橫向卡片改用線條 SVG(icon 名稱,見 HorizontalPlanTimeline 的 NoteIcon,
// 刻意不用 emoji 的理由寫在那裡)。這裡兩種都保留在同一筆資料裡,各視圖取自己要的欄位,畫面不變。

export type NoteIconName = 'star' | 'info' | 'cost' | 'weather'

interface NoteCategoryDef {
  // color——配色 token(--ios-*),所有畫面共用,維持「同一種備註分類在哪個畫面都長一樣顏色」。
  color: string
  // noteIcon——縱向時間軸用的 emoji/符號字元。
  noteIcon: string
  // icon——橫向卡片用的線條 SVG 名稱。
  icon: NoteIconName
}

// 備註分類(語意層級字串,AI 的 add_note 的 category):沒給或不在表裡的退回 DEFAULT_NOTE_CATEGORY。
const NOTE_CATEGORIES: Record<string, NoteCategoryDef> = {
  consideration: { color: 'var(--ios-gray)', noteIcon: '✦', icon: 'star' },
  info: { color: 'var(--ios-sand)', noteIcon: 'ⓘ', icon: 'info' },
  cost: { color: 'var(--ios-green)', noteIcon: '💰', icon: 'cost' },
  weather: { color: 'var(--ios-blue)', noteIcon: '☁︎', icon: 'weather' },
}
export const DEFAULT_NOTE_CATEGORY = 'info'

// NOTE_STYLES——縱向視圖與 TripPlanPage 用的形狀({ color, noteIcon })。
export const NOTE_STYLES: Record<string, { color: string; noteIcon: string }> = Object.fromEntries(
  Object.entries(NOTE_CATEGORIES).map(([key, def]) => [key, { color: def.color, noteIcon: def.noteIcon }]),
)

// NOTE_CATEGORY_META——橫向卡片用的形狀({ colorVar, icon })。
export const NOTE_CATEGORY_META: Record<string, { colorVar: string; icon: NoteIconName }> = Object.fromEntries(
  Object.entries(NOTE_CATEGORIES).map(([key, def]) => [key, { colorVar: def.color, icon: def.icon }]),
)

// isKnownNoteCategory——category 是否為表裡的合法分類。
export function isKnownNoteCategory(category: string | undefined): category is string {
  return !!category && category in NOTE_CATEGORIES
}

// resolveNoteCategory——把 AI 給的 category 收斂成合法分類(未提供或不在表列範圍內時退回預設)。
export function resolveNoteCategory(category: string | undefined): string {
  return isKnownNoteCategory(category) ? category : DEFAULT_NOTE_CATEGORY
}

// TRANSIT_MODE_CHOICES——交通方式選單(交通膠囊可手動切換)的選項。字串值對齊後端 geo_plan_ai.go
// estimateTransitMode/metersPerMinuteFor/iconForTransitMode 認得的同一組中文字串;'大眾運輸' 是後端「公車」的同義別名,
// 故意不列入(手動選的情境不需要兩個意思相同的選項)。圖示因視圖而異(縱向用 lucide 元件),由各視圖依 mode 自己對照,不放在這裡。
export const TRANSIT_MODE_CHOICES: { mode: string; label: string }[] = [
  { mode: '步行', label: '步行' },
  { mode: '公車', label: '公車' },
  { mode: '捷運', label: '捷運' },
  { mode: '開車', label: '開車' },
]
