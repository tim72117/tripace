import type { ClientTool } from '../ClientToolsBridge'
import { defineTool } from '../../sdk-proposals/defineTool'
import { asString, type TripBatches } from '../tripEntryTools'

// deleteTripEntry：刪除一筆旅程 entry 的純邏輯,不含 React 依賴。呼叫端必須
// 傳入「當下已確定穩定」的 allBatches 快照(見 ClientToolsBridge.ts 建構子裡
// ToolContext.getAllBatches 的說明)——同一輪 LLM 推論連續呼叫多個工具時(如
// 先 add 再緊接著 delete),用不穩定的快照判斷存在性會有競態,導致誤報找不到。
// key 對應的批次不存在、或批次內找不到該 id 時皆 throw,呼叫端應視為「這次
// 操作失敗」,不要吞掉錯誤。維持 export 讓這段邏輯可以被單獨測試或未來獨立
// 復用。
export function deleteTripEntry(
  allBatches: TripBatches,
  key: string,
  args: Record<string, unknown>,
): { allBatches: TripBatches; result: { deleted: string } } {
  const id = asString(args.id)
  const entries = allBatches[key]
  if (!entries || !entries.some((e) => e.id === id)) {
    throw new Error(`entry ${id} not found in batch ${key}`)
  }
  const nextAllBatches: TripBatches = { ...allBatches, [key]: entries.filter((e) => e.id !== id) }
  return { allBatches: nextAllBatches, result: { deleted: id } }
}

// TripEntryDeleteArgs — trip_entry_delete 的 args 型別,對齊 server/tools/
// clienttools.yaml 的 parameters schema(key、id 皆必填)。
type TripEntryDeleteArgs = {
  key: string
  id: string
}

function parseTripEntryDeleteArgs(raw: unknown): TripEntryDeleteArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return { key: asString(r.key), id: asString(r.id) }
}

// tripEntryDelete — trip_entry_delete 工具宣告,用 defineTool 包裝(見
// sdk-proposals/defineTool.ts 的設計說明)。找不到對應 key/id 時
// deleteTripEntry 會 throw,交給 bridge 統一轉成 tool_result 的 error 回應。
export const tripEntryDelete: ClientTool = defineTool<TripEntryDeleteArgs>(
  'trip_entry_delete',
  parseTripEntryDeleteArgs,
  (args, ctx) => {
    const { allBatches: next, result } = deleteTripEntry(ctx.getAllBatches(), args.key, args)
    ctx.setAllBatches(next)
    return result
  },
)
