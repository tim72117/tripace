// defineTool — 試做:讓每個工具宣告自己的 args 型別,取代目前 ClientTool.handle
// 統一用 Record<string, unknown> 的籠統簽章(見 ../clienttools/ClientToolsBridge.ts
// 的 ClientTool 型別)。
//
// 這個目錄(sdk-proposals/)存放的不是 tripace 的業務邏輯,而是「若
// @onagent/bridge 這個 SDK 願意補上某項功能,雛型會長什麼樣」的獨立試做——
// 跟 clienttools/ 底下其餘檔案分開放,是為了讓「這是提案雛型、設計上不依賴
// 任何 tripace 業務語意」這件事在目錄結構上就看得出來,不會因為混在
// clienttools/ 裡而被誤認成正式業務程式碼的一部分。這裡的檔案只依賴
// ClientTool/ToolContext 這兩個協定介面型別(不含 TripBatches/TripEntry 等
// 業務資料型別),理論上抽離出這個 repo、換掉 import 路徑,就能貼到任何
// 想採用同一套模式的專案。
//
// 動機:目前每個工具檔案(../clienttools/tools/ 底下)都要自己在 handle 內部
// 手動呼叫 asString(args.key)、asNonNegativeInt(args.offset, 0) 這類防禦性
// 轉型 helper,把 unknown 挖成自己要的形狀——這件事編譯期完全沒有檢查,少寫、
// 打錯欄位名稱,TypeScript 不會報錯,只有 runtime 才會發現(甚至可能默默
// fallback 成空字串/預設值,不會顯式報錯,更難察覺)。跟 server/tools/
// clienttools.yaml 定義的 parameters schema 之間也完全靠人工對齊,沒有
// 自動化的一致性檢查。
//
// 設計取捨(把自己當成要推廣給任意消費者用的 SDK 作者,不只是服務這個專案):
//
//   1. parseArgs 而非型別斷言(as Args)——WS 傳進來的 args 本質是 unknown,
//      單純斷言(as)完全不會在 runtime 驗證,等於只是「掩耳盜鈴」的型別
//      安全,型別系統相信了一個沒人真的檢查過的宣告。要求呼叫端提供一個
//      「raw unknown → Args」的 parse 函式,把 runtime 驗證跟型別宣告綁在
//      一起——型別是 parseArgs 回傳值的型別,不是憑空宣告來的,兩者不可能
//      不同步。
//
//   2. 不綁定任何第三方 schema 驗證庫(zod/valibot 等)——SDK 保持零依賴,
//      parseArgs 可以是最陽春的手寫函式(像 tripEntryAdd.ts 示範的),也
//      可以是 zod schema 的 .parse 方法包一層;消費者自己選擇要不要引入
//      額外依賴,defineTool 本身不替他們決定。
//
//   3. parseArgs 驗證失敗時該怎麼辦?——直接讓它 throw(不在 defineTool
//      內部吞掉錯誤)。原因:ClientTool.handle 呼叫端(ClientToolsBridge.ts
//      的 tool_call/tool_query 處理、或 AgentBridge 的 handleToolCall)本來
//      就已經有 try/catch 把任何 handler 拋出的錯誤轉成 tool_result 的
//      { ok: false, error } 回給 LLM——parseArgs 失敗沿用同一條錯誤回報
//      路徑即可,不需要 defineTool 自己另外發明一套錯誤處理。
//
//   4. 回傳值的型別跟輸入的 ToolContext 完全不受影響——defineTool 只碰
//      args 這一個面向,不試圖同時解決「ctx 該不該業務綁定」這個問題(那是
//      另一個獨立的設計維度,見 ClientToolsBridge.ts 的 ToolContext 型別
//      與相關討論)。這裡刻意維持 ToolContext 作為第二參數不變,示範
//      defineTool 可以跟現有的 ClientTool/ToolContext 介面共存、漸進導入,
//      不是破壞性改動。

import type { ClientTool, ToolContext } from '../clienttools/ClientToolsBridge'

export function defineTool<Args>(
  name: string,
  parseArgs: (raw: unknown) => Args,
  handle: (args: Args, ctx: ToolContext) => unknown,
): ClientTool {
  return {
    name,
    // 外層仍符合 ClientTool 既有的 (args: Record<string, unknown>, ctx) 簽章
    // ——對 ClientToolsBridge/AgentBridge 這些呼叫端來說,defineTool 產生的
    // 工具跟手寫的 ClientTool 完全無法區分,可以混在同一個 tools 陣列/物件裡,
    // 不需要呼叫端知道某個工具是不是用 defineTool 定義的。
    handle: (raw, ctx) => handle(parseArgs(raw), ctx),
  }
}
