// toAgentBridgeTools — @onagent/bridge 0.0.2 已經原生匯出 defineTool/
// toToolRecord(見 node_modules/@onagent/bridge/dist/client.d.ts),AgentBridge
// 建構子的 tools 選項現在原生接受 Record<string, ToolHandler> | ToolEntry[]
// 兩種形狀——這代表這個檔案原本示範的「陣列輸入 + 查重複」提案已經被 SDK
// 作者採納,不需要再自己手寫一份重複邏輯(先前這個檔案的版本整個 for 迴圈
// 手動查 hasOwnProperty + throw,現在直接呼叫 SDK 原生的 toToolRecord 做同
// 一件事)。
//
// 但這個轉接層本身沒有變得完全多餘,還留著兩件事是 SDK 原生機制沒有的:
//
//   1. ctx 綁定——SDK 原生的 ToolHandler/ToolEntry.handle 簽章是
//      (args) => unknown,完全不帶 context 參數(見 client.d.ts 的
//      ToolHandler 型別)。這個專案的工具(ClientTool<Ctx>,見 arrayTools.ts)
//      需要 ctx 才能讀寫 allBatches,SDK 不知道也不該知道這件事——ctx 是
//      這個專案私有的業務擴充,不是「陣列輸入」這個模式本身要解決的問題。
//      這裡把 ctx 用閉包 close 進每個工具的 handler,轉成 SDK 認得的
//      (args) => unknown 形狀,再交給 toToolRecord 組表。
//
//   2. onToolResult 回呼(選用)——SDK 的 AgentBridgeOptions 沒有「每個工具
//      呼叫完成後」的全域 hook(只有 onAssistantMessage/onError/
//      onQuotaExceeded 這幾個跟單一工具呼叫無關的回呼),這個專案的呼叫端
//      (OnagentBridgeDemo.tsx)需要在畫面上顯示「哪個工具被呼叫、結果是
//      什麼」,故保留這個回呼機制,由這裡的轉接層在每次工具執行成功後補上
//      這一段可觀測性,呼叫端不需要自己再包一層。
//
// 用法:defineTool 產出的 ClientTool 物件可以直接放進陣列,呼叫
// toAgentBridgeTools(tools, ctx) 轉成 AgentBridgeOptions.tools 要的形狀:
//
//   new AgentBridge({
//     ...,
//     tools: toAgentBridgeTools([tripEntryAdd, tripEntryList], onagentToolContext),
//   })

import { toToolRecord, type ToolHandler } from '@onagent/bridge'
import type { ClientTool } from './arrayTools'

// toAgentBridgeTools — 把 ClientTool<Ctx>[] 轉成 AgentBridgeOptions.tools 要
// 的 Record<string, ToolHandler> 形狀,統一注入呼叫端提供的同一個 ctx(Ctx
// 由呼叫端自己決定型別——這裡不寫死成 tripace 的 ToolContext,SDK 原生
// ToolHandler 完全不帶 context,是否需要 ctx、ctx 長怎樣,都是消費者的選擇,
// 不是這個轉接層該預設的事)。
//
// 重複名稱防呆:直接交給 SDK 原生的 toToolRecord 處理(同一批 tools 若有
// 重複的 name,它會直接丟出 Error,不讓後面的悄悄覆蓋前面的),不再自己
// 手寫一次同樣的查表邏輯。
//
// onToolResult(選用):每次工具執行成功後回報 { name, args, result },供呼叫端
// 接自己的 log/UI(例如 OnagentBridgeDemo.tsx 想在畫面上顯示「哪個工具被
// 呼叫、結果是什麼」)。錯誤(handle 拋出例外)不吞、不過這個回呼——直接
// 往外 throw,交給 AgentBridge 既有的 try/catch 轉成 tool_result 的
// { ok: false, error } 回報,同 defineTool 的既有取捨,不重新發明錯誤處理
// 路徑。
export function toAgentBridgeTools<Ctx>(
  tools: ClientTool<Ctx>[],
  ctx: Ctx,
  onToolResult?: (info: { name: string; args: Record<string, unknown>; result: unknown }) => void,
): Record<string, ToolHandler> {
  const boundTools = tools.map((tool) => ({
    name: tool.name,
    handle: ((args: Record<string, unknown>) => {
      const toolResult = tool.handle(args, ctx)
      onToolResult?.({ name: tool.name, args, result: toolResult })
      return toolResult
    }) as ToolHandler,
  }))
  return toToolRecord(boundTools)
}
