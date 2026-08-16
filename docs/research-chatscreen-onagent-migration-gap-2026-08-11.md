# ChatScreen 記事對話改接 onagent——現況與落差分析

> 這份文件記錄「把正式 `ChatScreen.tsx` 的記事對話，從 tripace server
> 內建的 `want` 框架改成直接透過 WebSocket 連 onagent」這件事的現況
> 調查結果與協定落差，供之後決定要不要、以及怎麼實作這個遷移時參考。
> 純研究與範圍記錄，**尚未動手實作**。

## 背景

目前 tripace 有兩條完全獨立、互不相通的 LLM 對話路徑：

1. **正式路徑**：使用者在 `ChatScreen` 輸入行程訊息 → `want` 框架
   （tripace 自己的 LLM 推論框架，同進程直接呼叫）→ 外部 vLLM API。
2. **Demo/PoC 路徑**：`web/src/clienttools/OnagentBridgeDemo.tsx`，
   透過 WebSocket 連本機或正式環境的 onagent 服務，示範 onagent 串接
   （工具沿用同一批 `ClientTool` 物件，非正式產品入口）。

這份文件討論的是把第 1 條路徑改成走第 2 條路徑用的協定，即「記事對話
改接 onagent」。

## 現況調查

### 1. `OnagentBridgeDemo.tsx` 的 WebSocket 串接方式

- **連線建立**（`OnagentBridgeDemo.tsx:72-73, 120-123`）：
  `WS_URL = (VITE_ONAGENT_URL ?? 'http://localhost:8081').replace(/^http/,'ws') + '/ws'`，
  `APP_ID = 'tripace'`，用 `@onagent/bridge` 的
  `AgentBridge({ url, appId, apiKey, tools, onAssistantMessage, onError })`。
  `apiKey` 來自 `VITE_ONAGENT_APP_KEY`，缺就整頁不連線（WS 交握會被
  後端拒絕）。此 URL 與 tripace-server（`VITE_API_BASE`，8080）完全
  獨立，不可互相推導。
  - **本機已具備測試條件**：`web/.env.development.local` 已設定
    `VITE_ONAGENT_APP_KEY`，`web/.env.development` 已設定
    `VITE_ONAGENT_URL=http://localhost:8081`。
- **hello 握手**：`Envelope{type, requestId?, payload?}`；送出 `hello`：
  `HelloPayload{appId, sdkVersion?, pageUrl?, initialData?}`（apiKey
  走 WS query string `?token=`，非 payload 欄位）；收到 `ack`：
  `AckPayload{sessionId, toolNames}`。`AgentBridge` 沒有連線成功的
  callback（ack 只在內部處理），demo 用 `setTimeout(500ms)` 樂觀顯示
  ready。
- **送出/收到文字**：`bridge.prompt(text)` 送 `PromptPayload{text}`；
  LLM 文字透過 `onAssistantMessage(text)` 回呼，**整段文字一次回呼**，
  不是逐字元/token 串流。
- **工具呼叫**：後端送 `tool_call`：`ToolCallPayload{toolName, args}`；
  SDK 內部 `handleToolCall` 查 `tools` map 執行，結果包成 `tool_result`：
  `ToolResultPayload{toolName, ok, result?, error?}` 送回。`kind: action`
  工具（`trip_entry_delete`/`trip_entry_update`）結果只判斷成功/失敗，
  不會被塞回 LLM context（見 `onagent-tools.yaml` 對 `kind` 欄位的說明）。
- **掛載工具**：直接重用既有 `ClientTool` 物件（`tripEntryAdd/List/
  tripListBatches/Delete/Update`），透過 `web/src/sdk-proposals/
  toAgentBridgeTools.ts` 把 `ClientTool<Ctx>[]` 轉成 SDK 要的
  `Record<string, ToolHandler>`。`recommend_nearby` 是唯一例外，走
  `backendDispatch`（onagent 伺服器直接 POST 到 tripace
  `internal/api/onagent_dispatch.go`，伺服器對伺服器，不經瀏覽器）。
- **多輪對話/斷線重連/錯誤**：`AgentBridge` 內建 `scheduleReconnect`
  （`minBackoffMs/maxBackoffMs`，預設 500ms~10s）與訊息 queue（連線
  未就緒時緩衝、就緒後 flush），錯誤走 `onError(ErrorPayload{message,
  code?})`，另有專屬 `onQuotaExceeded`。多輪對話由 onagent 後端在同一
  `sessionId` 下維護，前端無需自行組歷史。

### 2. `ChatScreen.tsx` 目前跟 `want` 框架的互動方式

- **送出方式**：`isOwner` 走 `api.assist(cfg, trip.id, text,
  clientToolsSessionIdRef.current)`，是 **HTTP POST**
  `/v1/trips/{tripID}/assist`，非 WebSocket。非 owner 走
  `api.semanticQuery` → `/v1/trips/{tripID}/query`。另有兩條獨立
  WebSocket：`/v1/trips/{id}/ws`（推播 `entry_updating/entries_updated/
  ask_user/ask_choice/task_created/task_entry_ready/entries_loaded`
  等**事件通知**，非對話文字串流）與 `/internal/clienttools/ws`
  （`ClientToolsBridge`，供 want 端 `trip_entry_*` 工具轉發呼叫回
  瀏覽器執行）。
- **後端回應格式**：`want_analyzer.go` 的 `Assist()` 內部用
  `orch.Submit(text)` 觸發 want orchestrator 推論，訂閱
  `agent.inference` 事件蒐集完整文字（後端內部收集完才一次性 HTTP
  回傳，非串流給前端），逾時 90 秒。回傳 `AssistResult{Kind:"recorded"
  |"answer", Text, EntryIDs, Entries, RecommendedPlaces}`，一次性 JSON
  response。唯一的「即時性」是走 `/internal/clienttools/ws` 阻塞轉發，
  讓工具執行結果在 HTTP 回應返回前就已寫入前端 state。
- **`ChatScreen` 依賴的 state/callback（遷移時最容易被破壞之處）**：
  - `messages/latestAnswerID/entries/updatingEntryIDs/taskPlaceholders/
    askUser/askChoice`：分別由 `api.assist()` 回傳值或第一層 WS 事件
    驅動
  - `clientToolsBatches`/`clientToolsBatchesRef`/
    `setClientToolsBatchesBoth`：由 `ClientToolsBridge` 讀寫，
    `trip_entry_add/update/list/trip_list_batches` 執行結果落在這裡
  - `clientToolsSessionIdRef`：第二條 WS ack 後拿到，`send()` 呼叫
    `api.assist` 時附帶，讓後端 `askPage` 找到對應瀏覽器分頁
  - `tripListBefore`/`changedBatchKeys`/`queriedBatchKeysRef`：
    `send()` 內比對這輪工具呼叫改動了哪些批次，用於掛在該則訊息下方
    渲染 `TripListTable`
  - `saveMessage/replaceTripBatch/saveMessageRecommendedPlaces/
    saveMessageTripListKeys`（`deviceDB.ts`）：裝置端持久化，後端不存
    原話
  - `drop()`/`scrollMessageToTop`/`mkLocalMsg`：純 UI 行為
- **寫入行程動作的實際執行位置**：現行**不是**後端直接寫 Postgres——
  `trip_entry_add/update/list/delete/trip_list_batches` 已是 wanttools
  白名單成員，但實作是 `clienttools/tool.go` 的
  `forwardingTool/queryTool`：Go 工具本身只 `askPage()` 阻塞等待，經
  `/internal/clienttools/ws` 轉發給瀏覽器分頁的 `ClientToolsBridge`，
  由前端 `ClientTool` handler（`web/src/clienttools/tools/
  tripEntryAdd.ts` 等）在瀏覽器記憶體 `clientToolsBatches` 執行、回傳
  結果經 WS 回後端再回給 LLM。真正持久化落地是前端呼叫
  `replaceTripBatch`（IndexedDB，**裝置端**，非 tripace-server 的
  Postgres）。

### 3. 本機 onagent（8081）目前的路由現況

實測確認 `backend-dispatch-poc` 分支（`/Users/caitingyu/Documents/
onagent`）目前 `cmd/server/main.go` 只掛了 `/ws`，**沒有**
`POST /v1/apps/{appId}/complete` 這類非 WS 的 HTTP 推論觸發端點——
這代表任何要觸發 onagent LLM 推論的整合，目前都必須走 WebSocket 協定，
沒有更輕量的 HTTP 替代方案。

## 協定落差

- **觸發推論**：onagent 用 WS `prompt` envelope（`bridge.prompt(text)`）；
  want 目前是 HTTP POST `/v1/trips/{id}/assist`，一次性 request/
  response，無 envelope 概念。改用 onagent 需整個換成 WS 生命週期管理
  （連線/ack/重連），且 `assist` 端點目前還夾帶 `clientToolsSessionId`、
  `lang` 等 tripace 專屬欄位，onagent `hello.initialData` 需另行設計
  對應機制（見下方「業務上下文落差」）。
- **收文字**：onagent 走 `onAssistantMessage(text)` 回呼（一次性完整
  文字，非逐字元串流，與 want 現況相同）；want 是 HTTP response body
  一次性。兩者都不是真正的 token 級串流，落差較小，但傳輸層（WS push
  vs HTTP response）不同，`ChatScreen` 現有「等 await 完再
  `setMessages`」的寫法需要改成監聽 WS 回呼。
- **工具呼叫執行位置（原以為是最大落差，實際評估後落差較小）**：
  want 現況 `trip_entry_add` 等已經是「後端 wanttool 殼子 + 阻塞轉發
  到前端 `ClientToolsBridge` 執行」的混合架構，並非後端直接碰資料庫；
  onagent 的 `onagent-tools.yaml` 對這五個工具的設計同樣是**前端
  ClientTool**（未設 `backendDispatch`），流程幾乎同構（
  `OnagentBridgeDemo.tsx` 本身就是直接重用同一批 `ClientTool` 物件）。
  換句話說，**寫入行程的執行模型（前端 ClientTool 執行、瀏覽器記憶體
  為真相來源、裝置端 DB 落地）不需要重新設計**，因為 want 現況本來就
  已經是前端執行；真正要重做的是「後端轉發配對機制」——want 用
  tripace 自家 `/internal/clienttools/ws` + `sessionID` 走
  `SetSessionEnvs`/`askPage` 阻塞配對；改用 onagent 後這層完全由
  onagent SDK/平台原生的 `tool_call`/`tool_result` envelope 取代，
  tripace-server 的 `clienttools` package（`tool.go`/`interaction.go`/
  `clienttools_ws.go`）理論上整層可被拿掉。`assistant_agent.go` 的
  白名單/thought 文字則要搬到 `onagent-tools.yaml` 的 `thought`
  （demo 用的那份是精簡版，未涵蓋 `entry_query/geocode/ask_user/
  ask_choice/task_plan`）。
- **業務上下文落差（尚未處理）**：want 靠 `WantAnalyzer.orch`（單一
  共享 orchestrator）+ `SetSessionEnvs`（`tripID/messageID/
  sessionID`）在每次 `Submit` 前手動注入上下文；onagent 則是每個 WS
  連線一個 `sessionId`（`ack.sessionId`），由平台自己管理對話歷史與
  並發會話，**沒有對應 `SetSessionEnvs` 的概念**。改用 onagent 後，
  `tripID`/`messageID`/使用者語言（`lang`）這些 tripace 業務上下文
  需要透過 `hello.initialData` 或 tool args 另行傳遞。
  **本輪明確決定暫不處理這個落差**（見下方「範圍決定」）。
- **多輪對話狀態**：want 靠 `sync.Mutex` 序列化的單一共享
  orchestrator，沒有真正的多會話並發；onagent 每個 WS 連線各自一個
  `sessionId`，並發會話由平台原生管理。

## 範圍決定（本輪對話已定案）

1. **只做本機 PoC，不動正式產品行為**——目標是把 `ChatScreen` 改成打
   本機 onagent（`8081`），驗證整條路徑能通、且能實際觀察到 LLM 判斷
   呼叫 `recommend_nearby` 觸發 BackendDispatch，不是要正式切換
   `want`。
2. **業務上下文落差（`tripID`/`sessionID`/`lang` 傳遞方式）本輪不
   處理**——先寫死單一測試行程的 `tripID`，不設計通用的
   `hello.initialData`/tool args 傳遞方案。這個決定明確記錄在這裡，
   避免之後回頭看程式碼時誤以為忘記考慮這個問題。
3. 尚未動手實作，下一步待確認。

## 尚未回答的問題（留給下一輪）

- `want` 路徑要不要保留（例如用 feature flag 切換），還是這次 PoC
  之後就決定汰換方向？
- `ChatScreen` 目前依賴的第一層事件 WS（`/v1/trips/{id}/ws` 推播
  `entries_updated` 等）在改接 onagent 後，這些事件的來源要怎麼處理
  ——onagent 沒有這套事件推播機制，這些通知目前跟 `want` 路徑的
  Postgres 寫入綁在一起，但如任務二所述，真正的資料落地其實是前端
  IndexedDB，這個落差需要進一步釐清。
- `assistant_agent.go` 完整的 `thought` 文字（含 `entry_query`/
  `geocode`/`ask_user`/`ask_choice`/`task_plan` 等 demo 版本未涵蓋的
  工具）要不要一併搬到 onagent，還是本輪 PoC 只驗證 demo 版本已有的
  五個 `trip_entry_*` 工具 + `recommend_nearby`。
