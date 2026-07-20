import type { ClientTool, ToolContext } from '../ClientToolsBridge'
import { asString, type TripEntry } from '../tripEntryTools'

// newTripEntryId：核心用途是 trip_entry_add 產生新 id,因此邏輯搬進來跟工具
// 宣告放在同一個檔案;但 export 出去是因為 ClientToolsDemo.tsx 建立初始
// 示範資料時也需要產生 id(不經過這個工具的 handle,是畫面掛載時的種子資料),
// 所以不算「完全只被這個工具內部使用」,不能設為模組私有函式。
export function newTripEntryId(): string {
  return 'trip_' + Math.random().toString(36).slice(2, 10)
}

// addTripEntry：新增一筆旅程 entry 的純邏輯,不含 React 依賴。輸入目前的
// entries 陣列 + LLM 傳來的 args,回傳新的 entries 陣列與要回報給 LLM 的
// result。維持 export 讓這段邏輯可以被單獨測試,或未來被其他前端工具(例如
// 非 WS bridge 的手動編輯 UI)獨立復用,不需要經過 ClientTool/ToolContext
// 這層協定包裝。
export function addTripEntry(
  entries: TripEntry[],
  args: Record<string, unknown>,
): { entries: TripEntry[]; result: { id: string; title: string; date: string } } {
  const entry: TripEntry = {
    id: newTripEntryId(),
    title: asString(args.title) || '(未命名項目)',
    date: asString(args.date),
    time: asString(args.time),
    note: asString(args.note),
  }
  return { entries: [...entries, entry], result: { id: entry.id, title: entry.title, date: entry.date } }
}

// tripEntryAdd — trip_entry_add 工具宣告。這裡只負責接線:透過 ctx 讀當下
// entries、把純函式回傳的新 entries 寫回 ctx、回傳 result 給 bridge 送回 LLM。
export const tripEntryAdd: ClientTool = {
  name: 'trip_entry_add',
  handle: (args, ctx: ToolContext) => {
    const { entries: next, result } = addTripEntry(ctx.getEntries(), args)
    ctx.setEntries(next)
    return result
  },
}
