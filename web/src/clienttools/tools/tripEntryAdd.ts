import type { ClientTool } from '../ClientToolsBridge'
import { defineTool } from '../../sdk-proposals/defineTool'
import { asString, type TripBatches, type TripEntry } from '../tripEntryTools'

// newTripEntryId：核心用途是 trip_entry_add 產生新 id,因此邏輯搬進來跟工具
// 宣告放在同一個檔案;但 export 出去是因為 ClientToolsDemo.tsx 建立初始
// 示範資料時也需要產生 id(不經過這個工具的 handle,是畫面掛載時的種子資料),
// 所以不算「完全只被這個工具內部使用」,不能設為模組私有函式。
export function newTripEntryId(): string {
  return 'trip_' + Math.random().toString(36).slice(2, 10)
}

// addTripEntry：新增一筆旅程 entry 的純邏輯,不含 React 依賴。輸入目前的
// allBatches(所有批次)+ 要操作的 key + LLM 傳來的 args,回傳更新後的整個
// allBatches 與要回報給 LLM 的 result。key 對應的批次若原本不存在,視為
// LLM 開了一個新批次,直接建立(見 server/tools/clienttools.yaml「多批次
// (key)支援」——key 由 LLM 自訂字串,不要求前端事先存在才能新增)。維持
// export 讓這段邏輯可以被單獨測試,或未來被其他前端工具(例如非 WS bridge
// 的手動編輯 UI)獨立復用,不需要經過 ClientTool/ToolContext 這層協定包裝。
export function addTripEntry(
  allBatches: TripBatches,
  key: string,
  args: Record<string, unknown>,
): { allBatches: TripBatches; result: { id: string; key: string; title: string; date: string } } {
  const entry: TripEntry = {
    id: newTripEntryId(),
    title: asString(args.title) || '(未命名項目)',
    date: asString(args.date),
    time: asString(args.time),
    note: asString(args.note),
  }
  const existing = allBatches[key] ?? []
  const nextAllBatches: TripBatches = { ...allBatches, [key]: [...existing, entry] }
  return { allBatches: nextAllBatches, result: { id: entry.id, key, title: entry.title, date: entry.date } }
}

// TripEntryAddArgs — trip_entry_add 的 args 型別,對齊 server/tools/
// clienttools.yaml 裡這個工具的 parameters schema(key 必填,title/date/
// time/note 皆為字串、選填)。宣告這個型別本身不會驗證任何東西——真正的
// runtime 驗證在下面的 parseTripEntryAddArgs,型別只是「parse 完之後長什麼
// 樣子」的宣告,兩者透過 defineTool 綁定,不會不同步(見 defineTool.ts 的
// 設計說明)。
type TripEntryAddArgs = {
  key: string
  title?: string
  date?: string
  time?: string
  note?: string
}

// parseTripEntryAddArgs — 把 unknown 的 raw args 轉成型別安全的
// TripEntryAddArgs,取代原本在 handle 內部逐欄位呼叫 asString 的寫法。
// 沿用既有的 asString 慣例(非字串一律回退空字串,不 throw)——key 缺漏時
// 視為空字串批次,不特別擋下(異常輸入的處理交給呼叫端 LLM 的工具 schema
// 必填驗證負責,同原本的既有取捨,這裡沒有改變行為,只是把轉型邏輯集中
// 到一個有名字、有回傳型別的函式,而非分散寫在 handle 內文裡)。
function parseTripEntryAddArgs(raw: unknown): TripEntryAddArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    key: asString(r.key),
    title: asString(r.title) || undefined,
    date: asString(r.date) || undefined,
    time: asString(r.time) || undefined,
    note: asString(r.note) || undefined,
  }
}

// tripEntryAdd — trip_entry_add 工具宣告,用 defineTool 包裝(見 defineTool.ts
// 的設計說明)。跟改寫前相比,handle 內部直接拿到型別安全的 TripEntryAddArgs
// (args.key 是 string,不用再 asString(args.key)),轉型只在 parseTripEntryAddArgs
// 這一處集中處理。這裡只負責接線:透過 ctx 讀當下 allBatches、把純函式
// addTripEntry 回傳的新 allBatches 寫回 ctx、回傳 result 給 bridge 送回 LLM。
export const tripEntryAdd: ClientTool = defineTool<TripEntryAddArgs>(
  'trip_entry_add',
  parseTripEntryAddArgs,
  (args, ctx) => {
    const { allBatches: next, result } = addTripEntry(ctx.getAllBatches(), args.key, args)
    ctx.setAllBatches(next)
    return result
  },
)
