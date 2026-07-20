import type { ClientTool, ToolContext } from '../ClientToolsBridge'
import { asNonNegativeInt, type TripEntry } from '../tripEntryTools'

// listTripEntries：分頁查詢的純邏輯,不改動 entries,純讀取,不含 React 依賴。
// offset/limit 在 server/tools/clienttools.yaml 標成必填,但這裡仍防禦性地
// 處理「缺漏或型別不可信」的情況——offset 缺漏或無效值一律回退到 0(從頭
// 查);limit 缺漏或無效值(含 0、負數)一律回退到目前清單長度(等同「這次
// 查全部」,也避免 limit<=0 時 slice 出空陣列讓 LLM 誤以為清單是空的)。
// offset 超出清單長度時 slice 自然回傳空陣列。asNonNegativeInt 是共用的
// 非負整數轉型 helper(留在 tripEntryTools.ts,不是這個工具專屬邏輯)。維持
// export 讓這段邏輯可以被單獨測試或未來獨立復用。
export function listTripEntries(
  entries: TripEntry[],
  args: Record<string, unknown>,
): { result: { entries: TripEntry[]; total: number } } {
  const total = entries.length
  const offset = asNonNegativeInt(args.offset, 0)
  const rawLimit = asNonNegativeInt(args.limit, total)
  const limit = rawLimit > 0 ? rawLimit : total
  return { result: { entries: entries.slice(offset, offset + limit), total } }
}

// tripEntryList — trip_entry_list 工具宣告。純讀取、不改動 entries,所以不
// 需要呼叫 ctx.setEntries。
export const tripEntryList: ClientTool = {
  name: 'trip_entry_list',
  handle: (args, ctx: ToolContext) => {
    return listTripEntries(ctx.getEntries(), args).result
  },
}
