// arrayTools ——「工具陣列 → 查表,重複就 throw」這個模式的核心邏輯,不帶
// 任何 tripace 專案私有的擴充。這個模式最初是以「若 AgentBridge 建構子願意
// 多接受一種陣列輸入,核心邏輯會長什麼樣」的提案雛型寫在這裡,後來
// @onagent/bridge 0.0.2 版真的原生採納了這個模式(見該套件匯出的
// defineTool/toToolRecord,node_modules/@onagent/bridge/dist/client.d.ts)
// ——提案已經被接受,不再是等待驗證的雛型。
//
// 但這個檔案本身沒有因此變得多餘:tripace 自己的 ClientToolsBridge.ts(本地
// bridge,跟 @onagent/bridge 這個套件完全無關)仍然需要同一套「陣列 →
// 查表」邏輯,而且需要帶 Ctx 這個 SDK 原生版本沒有、也不該有的維度(見下方
// Ctx 泛型參數的說明)。讓 ClientToolsBridge.ts 為了借一個查重複的工具函式
// 去依賴 @onagent/bridge 這個跟它毫無關係的外部套件,是不必要且不合理的
// 耦合——這個檔案因此繼續作為獨立、專案自有的實作存在,是 tripace 內部
// 「工具陣列註冊」這個模式唯一自足的型別來源,defineTool.ts、
// toAgentBridgeTools.ts 都改成從這裡 import ClientTool,不再向
// ../clienttools/ClientToolsBridge.ts 借用型別——那兩個檔案的存在本身依賴
// ClientToolsBridge.ts,任何只想用 sdk-proposals、完全不碰
// ClientToolsBridge.ts 的新元件都會被那個 import 卡住,「理論上可以抽離出
// 這個 repo」這句話就不成立。方向必須反過來:sdk-proposals 自己定義好一套
// 完整型別,clienttools/ClientToolsBridge.ts 的 ClientTool 改成基於這裡的
// 型別做具體實例化(見該檔案的型別定義處的說明),而不是現在這樣反過來被
// 借用。
//
// 命名沿用 ClientTool 這個既有名字(而非另創一個「SDKTool」之類的新詞彙)
// ——這裡定義的本來就是 tripace 這個專案 ClientTool 概念的通用化版本,用
// 同一個名字才看得出兩者是同一件事,不是兩套平行概念。ClientToolsBridge.ts
// 的 ClientTool 需要 import 這裡的泛型型別再具體代入 ToolContext,兩個
// 檔案裡都會出現「ClientTool」這個名字,若有撞名疑慮,由匯入端自行取別名
// 即可(見 ClientToolsBridge.ts 的 import 寫法)。
//
// Ctx 泛型參數:不是每個消費者都需要「context」這個概念(SDK 原生
// ToolHandler 就完全不帶),但也不能寫死「一定不帶」——tripace 這個專案的
// ClientTool 就需要帶 ToolContext 才能運作(讀寫 allBatches)。用泛型
// ClientTool<Ctx> 表達這件事:Ctx 預設是 void(對齊 SDK 現有 ToolHandler
// 簽章,handle 只收 args),消費者需要 context 時自己代入實際型別,handle
// 簽章自動變成收兩個參數。這樣「要不要帶 context」變成消費者自己的選擇,
// 不是 sdk-proposals 替所有消費者預先決定的事——ClientToolsBridge.ts 的
// ClientTool 正是這個泛型型別代入 ToolContext 後的具體實例化(見該檔案的
// 型別定義)。
export type ClientTool<Ctx = void> = {
  name: string
  handle: Ctx extends void
    ? (args: Record<string, unknown>) => unknown
    : (args: Record<string, unknown>, ctx: Ctx) => unknown
}

// ClientToolHandler——單獨 export 出來,給 defineTool.ts 的 handle 參數型別、
// ClientToolsBridge.ts 組 handlers 表時的內部型別共用,不必各自重新推導
// ClientTool<Ctx>['handle'] 這種寫法。
export type ClientToolHandler<Ctx = void> = ClientTool<Ctx>['handle']

// toToolRecord——把 ClientTool<Ctx>[] 轉成 Record<string, handler> 形狀。
// 目前實際呼叫端是 ClientToolsBridge.ts 的建構子(帶 Ctx = ToolContext);
// onagent/AgentBridge 那條線改用 SDK 原生的同名函式(見
// sdk-proposals/toAgentBridgeTools.ts 的說明,那裡的轉接層只負責綁定 ctx,
// 陣列轉表本身交給 SDK 處理,不再呼叫這裡的版本)。重複名稱視為設定錯誤,
// 直接丟出 Error 讓開發者馬上發現,不要讓後面的悄悄覆蓋前面的——物件字面量
// 寫法(`{ ...a, ...b }`)後面的 key 覆蓋前面是合法語法,TypeScript 不會
// 報錯,只會讓某個工具的呼叫默默失聯,很難 debug。
export function toToolRecord<Ctx = void>(
  tools: ClientTool<Ctx>[],
): Record<string, ClientToolHandler<Ctx>> {
  const result: Record<string, ClientToolHandler<Ctx>> = {}
  for (const tool of tools) {
    if (Object.prototype.hasOwnProperty.call(result, tool.name)) {
      throw new Error(`toToolRecord: duplicate tool name "${tool.name}"`)
    }
    result[tool.name] = tool.handle
  }
  return result
}
