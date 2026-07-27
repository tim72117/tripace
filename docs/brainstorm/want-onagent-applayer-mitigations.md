# want / onagent 應用層緩解措施 —— 在不改 want 原始碼的前提下能做什麼

> 前一份文件（`want-onagent-architect.md`）談的是「want 這個框架理想上該長什麼樣」，但那些建議大多要改 want 的原始碼——而 want 是鎖在 `v0.0.2` 的外部私有依賴，短期內動不了。
>
> 這份文件反過來問：**在 want 維持 v0.0.2、我一行都不能改它原始碼的前提下，Tripace 自己的 codebase（主要是 `server/internal/` 底下那些檔案）能做哪些補救？** 針對前一份提出的每一個架構問題，這裡給出「應用層可以怎麼繞過或緩解」的具體做法，並標上可行性與預估工作量供排優先序。
>
> **一個重要前提修正（來自實際讀 want v0.0.2 原始碼，而非沿用舊假設）**：`want_pool.go` 的註解說「want 是全域單例、多 orchestrator 會互相污染」，這句話**只有一部分是對的**。實際查證 want 原始碼後發現：
> - `wantorch.SetupWith()` / `NewOrchestrator()` 每次呼叫都會建**獨立的** `EventBus`、`activationQueue`（buffer 500）、`interactionRegistry`、`readFileState`、`sessionEnvs`、`promptBuilder`、以及**獨立的 `AgentID`**（session transcript 就是用這個 ID 命名，見 `run_agent.go` 的 `session_%s.jsonl`）。這些全是 per-orchestrator，不共用。
> - 真正共用的全域可變狀態只有兩處：`GlobalEngine.Provider`（`internal/run_agent.go`，**init 後不再改動、只被讀取**，多 orchestrator 併發讀它是安全的——它內部的 `RequestQueue` 本來就是設計來被併發打的）與 `GlobalAppStore`（`internal/store.go`，**會在 run 期間被 `agent_context.go` 的 `setAppState` 寫入**，這才是唯一真正會跨 orchestrator 污染的東西；但 want 已經把子任務 Tasks 從它搬進 per-agent context 了，見 `agent_context.go:21` 註解）。`GlobalToolbox`（工具註冊表）在啟動註冊完之後也是唯讀。
>
> **這個修正的意義很大**：它代表「每 session 一個 orchestrator」在應用層其實**大致可行**，不必真的等 want 改造——真正要小心的只有 `GlobalAppStore` 這一個點。下面很多緩解措施建立在這個事實上。

---

## 可行性 / 工作量 標示說明

- **可行性**：🟢 現在就能做（純應用層，不碰 want）／🟡 能做但有 caveat 或需驗證 want 行為／🔴 應用層繞不掉，只能等 want 改（列出來是為了誠實標記邊界）
- **工作量**：S（1 天內）／M（數天）／L（一到數週）／XL（跨數週、牽動多處架構）

---

## 一、隔離與並行

這是最大的天花板，但也是應用層最有施力點的地方——因為瓶頸其實有**兩層**，而外面那層完全在應用層手上。

### M1. 縮短 `w.mu` 的臨界區：把「等 LLM 跑完」移出鎖外

**可行性 🟢｜工作量 M**

**問題**：真正卡住全站的不只是 `want_pool.go` 回傳 `shared`，更致命的是 `want_analyzer.go` 的 `Assist`/`Answer`/`generate` 三個方法**各自持有 `w.mu` 橫跨整段推論**——從 `Submit` 到等 `idle` 事件再加 `time.Sleep(1500ms)`，最長可以是 90 秒 timeout。一次 LLM 對話就把 `w.mu` 鎖 90 秒，這比「共用單例」本身傷害更大。**緩解**：`w.mu` 的存在理由是保護「`SetSessionEnvs` → `SetPromptBuilder` → `Submit`」這三步不被別的請求交錯覆寫（因為它們寫的是 orchestrator 的欄位）。但「等結果」這件事只依賴本次 `EventBus.Subscribe` 的 closure（每次呼叫各自 new 的 `sb`/`done`/`state`），與 orchestrator 欄位無關。所以可以把鎖縮到只包住「設定 + Submit」，`select {<-done}` 移到鎖外。**為什麼重要**：光這一步就能把「單一 analyzer 的有效並行度」從「一次一個完整對話」提升到「一次一個 Submit 瞬間」，臨界區從數十秒降到毫秒級，是投入產出比最高的一招——即使 orchestrator 還是同一個。（caveat：want 的 `activationQueue` 是序列消費的，多個 Submit 仍會在 want 內部排隊跑，所以這步能解「鎖太久」但不能解「want 內部單線程」，那要靠 M2。）

### M2. 建 N 個 orchestrator 做 worker pool，繞過單一 analyzer

**可行性 🟡｜工作量 L**

**問題**：`want_pool.go` 的 `For(sessionID)` 永遠回傳同一個 `shared`，全站共用一個 orchestrator 的 `activationQueue`，want 內部序列消費 → 天花板。**緩解**：`want_pool.go` 的骨架已經備好 `byID map`，但真正該做的不是「per-session 一個」（session 數無上限、會爆記憶體），而是**固定大小的 orchestrator pool**（例如 N=4~8 個 `SetupWith` 出來的 orchestrator，round-robin 或最少負載派工）。上面查證過：每個 orchestrator 的 `EventBus`/`queue`/`interactions`/`AgentID` 都獨立，所以 N 個 orchestrator 能真正併發跑 N 個推論。**唯一的 caveat 是 `GlobalAppStore`**：它會在 run 期間被寫，理論上 N 個併發 run 會互相踩。要驗證的是——Tripace 的 assistant role 實際上用到 `GlobalAppStore` 承載的哪些 state？從程式碼看，Tripace 的工具（`trip_entry_*`、`entry_query`、`task_plan` 等）自己管自己的狀態（`task_store.go` 是 wanttools 自己的 store、clienttools 走 WS），並不依賴 want 的 `AppState.Agent.Messages`。若確認無依賴，N-pool 就是安全的。**為什麼重要**：這是把並行天花板從「1」抬到「N」的關鍵一步，且完全在應用層完成；`want_pool.go` 早就為它留好了介面位置，等於 want 的原作者也預期宿主會這樣做。建議先做 M1（低風險立即見效），再以一個 feature flag + 壓測驗證 `GlobalAppStore` 無污染後才開 M2。

### M3. per-request 狀態改用 orchestrator-scoped，拆掉 `sink.go` 的 13 個全域變數

**可行性 🟡｜工作量 L**

**問題**：`wanttools/sink.go` 的 `emitCount`/`emittedIDs`/`presented`/`recommendedPlaces` 等是 package-level 全域，靠 `recordMu` 把整段記錄流程序列化。一旦做了 M2 的 N-pool，這 13 個全域變數會立刻變成 data race 的重災區——N 個併發推論全寫同一組全域 `presented`。**緩解**：want 每次工具呼叫都會傳 `ctx types.ToolContext`，而 `ctx.GetSessionEnvs()` 是 per-call 的。可以把「本次流程的結果收集器」的 key 放進 SessionEnvs（例如塞一個 `runID`），收集器改成 `map[runID]*collector` 由 `runID` 索引；或更乾淨地，用 want 已經提供的 `ctx.EmitToolResult(...)`（`tool.go` 裡的 clienttools 已經在用）把結果回傳，呼叫端從本次推論的事件流收集，而非讀全域。**為什麼重要**：這是 M2 能安全上線的**前置條件**——沒有它，開 N-pool 等於開 race。兩者是綁定的：要並行，就得先讓 per-request 狀態不再是 package 全域。工作量標 L 是因為要逐一改造 `sink.go` 依賴的每個工具（`present_entries`、`recommend_nearby`、`record_entry` …）。

### M4. 給 orchestrator pool 加派工背壓與逾時，堵住 DoS 面

**可行性 🟢｜工作量 S**

**問題**：目前匿名公開連結也能觸發 LLM 呼叫，且 `w.mu` 一鎖就是最長 90 秒，單一使用者持續打字就能長期霸佔 → 現成 DoS。**緩解**：不需要 want 支援配額，應用層就能在 `want_pool.go`（或其上層 api handler）做——用一個 buffered semaphore（`chan struct{}`）限制同時在跑的推論數，滿了就快速回「系統忙碌中，請稍候」而非排隊等鎖；per-channel 或 per-session 再加一個簡單的 rate limiter（令牌桶）。`activationQueue` 本身 buffer 500，也可以監看它的深度當背壓信號。**為什麼重要**：這是把「一個壞鄰居拖垮全站」從可能變不可能的最小成本手段，純應用層、S 工作量，且與 M1/M2 正交，可以最先做。

---

## 二、工具執行模型

這一區 Tripace 其實**已經走在正確的路上**，只是自己不知道踩到了 want 已有的原生能力。

### M5. 非同步工具：`clienttools` 那套自製機制目前是合理的，但可考慮收斂到 `orch.RequestInteraction`

**可行性 🟢｜工作量 M（收斂）／0（維持現狀也可）**

**問題**：`clienttools/interaction.go` 開頭註解自己講得很清楚——want v0.0.2 **確實 ship 了可用的** `RequestInteraction`/`ResolveInteraction`（我查證了 `orchestrator/orchestrator.go` 的 `ResolveInteraction` 與 `orchestrator/interaction.go` 的 `interactionRegistry`，是真的、是 per-session 的），但這個 POC 刻意自建了一套 `askers` + `AskInteraction` 平行機制。**緩解**：這裡有兩個選擇——(a) **維持現狀**：自製那套（`RegisterAsker`/`lookupAsker`/`askPage`）其實運作良好、語意清晰，且不依賴 want internal 型別，維護成本可控，不動它是合理的工程決定。(b) **收斂**：把 `forwardingTool`/`queryTool` 的阻塞等待改成呼叫 `ctx` 對應 orchestrator 的 `RequestInteraction`，前端回應入口改呼叫 `orch.ResolveInteraction(requestID, data)`，刪掉自製的 `askers` map。**建議**：短期維持 (a)，因為它能用；但把 (b) 記為技術債，因為一旦做了 M2 的 N-pool，「用哪個 orchestrator 的 interactionRegistry」會變成必須正確路由的問題，屆時直接用 want 原生的 per-orchestrator registry 反而比自己維護一個全域 `askers` map 更不容易錯（全域 map 在多 orchestrator 下要自己確保 sessionID 不撞）。**為什麼重要**：這是少數「want 原生能力比自製更好」的點，且理由不是現在，而是 M2 之後——先標記，別急著改。

### M6. 完成判定：用確定性的 `idle` 事件，砍掉 `time.Sleep(1500ms)`

**可行性 🟡｜工作量 M**

**問題**：`want_analyzer.go` 三處都用 `StatusViewModel{Status:"idle"}` 觸發後再 `go func(){ time.Sleep(1500ms); finish() }()`，理由是「文字事件可能晚於 idle 到達」。這是 heuristic，1500ms 純猜——負載高時可能不夠、正常時白白拖慢每次回應 1.5 秒。**緩解**：want 的事件流其實有更確定的信號可用。`idle` 已經是「推論結束」的明確事件；文字晚到的問題，可以改成——收到 `idle` 後不立刻結束，而是**繼續消費事件直到 EventBus 對本次 Submit 再無新事件**（例如用一個「收到任何事件就重置的短 debounce」，如 100~200ms 空窗才算真結束），比固定 1500ms 又快又準。更徹底的做法是研究 want 的 `agent.inference` 事件序列裡有沒有明確的「本輪 AgentMessage 結束」marker（`HandleInferenceMessage` 的 view model 種類值得再挖）。**為什麼重要**：每次對話省下最多 1.5 秒、且在高負載下不再誤截斷，直接改善使用者感受到的延遲；純應用層，只改 `want_analyzer.go` 那個 closure。工作量標 M 是因為要小心驗證不同 provider（vLLM/gemma、claude）的事件時序都成立。

### M7. 工具白名單型別安全化：把裸字串換成常數 / codegen 校驗

**可行性 🟢｜工作量 S**

**問題**：`assistant_agent.go` 的 `Tools: []string{"trip_entry_add", "trip_entry_list", ...}` 是裸字串白名單，打錯字（或工具改名）要到執行期才被 want 引擎擋下（見該檔案 init 註解裡血淚斑斑的「漏掉 `trip_entry_list` 會讓整條 `trip_entry_update` 路徑無法運作」）。**緩解**：want 的 `types.RegisterTool` 沒法改，但**工具名稱在應用層可以集中成常數**——定義一個 `wanttools.ToolNames` 區塊（`const ToolTripEntryAdd = "trip_entry_add"`），白名單引用常數而非字面字串；再加一個啟動期自檢：把所有 role 白名單引用的工具名，比對 `GlobalToolbox` 實際註冊了的名稱（want 有 `GlobalToolbox.Declarations()` 可讀），不匹配就 `log.Fatal` 快速失敗。**為什麼重要**：把「工具名打錯」從「上線後某條路徑靜默失效」降級成「編譯期常數引用錯誤 or 啟動期 fatal」，成本極低（S），卻能消滅一整類 `assistant_agent.go` 註解裡反覆出現的坑。

### M8. 給 want 的 provider 錯誤補上 retry / fallback（在應用層的 provider 邊界外包一層）

**可行性 🔴→🟡｜工作量 M**

**問題**：want 在 `InitializeWithConfig` 裡直接 `switch settings.Provider` 建 provider，錯誤只透過 `OnError` 回調 `fmt.Printf`。want 內部沒有 retry/circuit breaker，應用層也無法插進 want 的 provider 呼叫路徑（那在 want internal）。**緩解**：真正的框架級 retry 繞不掉（🔴），但應用層可以做**外層重試**——`want_analyzer.go` 的 `Assist`/`Answer` 拿到「疑似暫時性失敗」（透過 `OnError` 捕捉到的 provider 錯誤、或 90 秒 timeout、或空回應）時，在應用層對整個 `Submit`+等待做有限次數的退避重試（例如最多 2 次、指數退避）。這不如 want 內建的細（無法只重試單一 HTTP 呼叫、會重跑整輪推論），但能擋掉「provider 偶發 429/5xx 導致整個對話失敗」的常見情況。搭配 M4 的 semaphore，還能做簡單的 circuit breaker（連續 N 次失敗就短暫拒絕新請求、回降級訊息）。**為什麼重要**：LLM provider 的暫時性錯誤是常態，目前「錯了就只印一行 log、使用者對話直接失敗」是很差的體驗。外層重試雖粗糙，但可行、純應用層，且是 timeout（M6 有觸及）之外唯一能在不改 want 下提升 LLM 呼叫韌性的手段。

---

## 三、跨平台抽象（want ↔ onagent）

**好消息：這一區 Tripace 已經無意間做對了最難的部分。**

### M9. `toolschema` 就是你要的「框架無關 IR」——把它扶正為單一真相來源

**可行性 🟢｜工作量 M**

**問題**：同一組工具目前有多份宣告——Go 實作（`wanttools/*.go`，upper-case schema）、`server/tools/clienttools.yaml`、`server/tools/onagent-tools.yaml`，三份手工對齊、極易漂移。**關鍵發現**：`server/internal/toolschema/`（`schema.go`/`loader.go`/`registry.go`）**已經是一份框架無關的工具中介表示**——它定義了與框架無關的 `Tool`/`ParameterSchema`/`App`，`clienttools/tool.go` 的 `RegisterApp` 把它轉譯成 want 的 `types.ToolDeclaration`（`parameterSchemaToWant`），而 onagent 那邊用的是同一份 schema 概念的 YAML。這正是前一份文件建議 9「工具定義需要框架無關 IR」的雛形，而且它已經存在、已經在跑。**緩解**：把它扶正——(a) 讓 `clienttools.yaml` 與 `onagent-tools.yaml` 從**同一份** `toolschema` 定義生成（onagent YAML 當成另一個轉譯目標，而非手寫第二份）；(b) 統一 schema 大小寫慣例（`tool.go` 註解已經指出 wanttools 用 upper-case、clienttools 用 lower-case，且查證 want 的 vLLM provider 對大小寫不敏感——所以可以統一成 JSON-Schema 標準的 lower-case）;(c) 補一個 codegen，從 `toolschema` 產出前端 TS 型別（`schema.go` 註解說 `Returns` 本來就是為 TS codegen 準備的，但 codegen 本身似乎還沒接上）。**為什麼重要**：這是「同一份工具邏輯同時被 want 與 onagent 呼叫、不用重寫」這個 onagent 試做初衷能否成立的關鍵，而地基已經打好，只差扶正成 SSOT 並補轉譯器。工作量 M 而非 L，正是因為 `toolschema` 已經存在。

### M10. 把安全邊界（injected params）寫進 `toolschema`，讓兩個平台都繼承

**可行性 🟢｜工作量 S**

**問題**：channelID 不進 prompt、由 server 注入這件事，在 want 這邊靠 `SetSessionEnvs`+`ChannelFrom` 落實（做對了）。但這是**應用層的約定**，`toolschema` 本身沒有記錄「哪些參數是 server-injected」。若 onagent 那條路徑忘了做等價注入，同一組工具在 onagent 上可能就少了這條邊界。**緩解**：在 `toolschema.ParameterSchema`（或 `Tool`）加一個宣告欄位，例如 `Injected bool` 或一個 `InjectedParams []string`，明確標記 `channelID`/`sessionID` 這類「由 host 注入、agent 與 prompt 都不可提供」的參數。轉譯器（want adapter 的 `parameterSchemaToWant`、未來的 onagent adapter）讀到這個標記時，就**不把它放進送給 LLM 的 schema**，並在執行時強制從 host context 取值。**為什麼重要**：把「哪些資料 agent 碰不到」從「兩個平台各自的實作約定」升級成「IR 裡的一條契約」，是防止「同一工具在 A 平台安全、在 B 平台可被 prompt injection 操縱」這種跨平台不對稱漏洞的唯一乾淨辦法。且因為 `toolschema` 已存在，這只是加一個欄位 + 兩個轉譯器讀它，S 工作量。

### M11. 把「工具業務邏輯」與「哪個平台在呼叫」解耦成一個 port 介面

**可行性 🟡｜工作量 L**

**問題**：現在工具邏輯直接寫成 want 的 `types.ToolInterface`（`forwardingTool`/`queryTool` 實作 `Call(args, ctx)`），與 want 的型別綁死。onagent 要用同一邏輯就得再包一層。**緩解**：定義一個框架無關的工具執行介面（port），例如 `type ToolHandler func(ctx AppToolContext, args json.RawMessage) (json.RawMessage, error)`，其中 `AppToolContext` 只暴露應用層關心的東西（`ChannelID()`、`SessionID()`、store 存取、`RequestInteraction` 抽象）。want adapter（現有的 `forwardingTool`）與未來的 onagent adapter 各自把自家 runtime 的 context 適配到這個 port。真正的業務邏輯（「新增一筆 trip entry」）只依賴 port，不 import want 也不 import onagent。**為什麼重要**：這是讓 `OnagentBridgeDemo.tsx` 那種「換一個 runtime 呼叫同一組工具」從一次性 POC 變成可持續模式的結構前提。工作量標 L 是因為要抽象化 context（尤其 `RequestInteraction` 在 want 與 onagent 語意可能不同），但它與 M9/M10 是同一個方向的三步，做完這三步，跨平台抽象就基本成形。

---

## 四、安全邊界作為原語

### M12. 用啟動期自檢 + 型別把「injected 不進 prompt」變成擋得住的約束

**可行性 🟢｜工作量 S**

**問題**：`ChannelFrom(ctx)` 讀 SessionEnvs、不進 prompt——這條邊界目前純靠開發者「記得每次 `SetSessionEnvs` 都設對、且工具都用 `ChannelFrom` 而非從 args 拿 channelID」。沒有任何機制擋住「哪天有人手滑把 channelID 加進工具參數 schema」。**緩解**：純應用層可加兩道保險——(a) 一個啟動期或測試期的自檢：掃所有 `toolschema` 工具的參數 schema，斷言 `channelID`/`sessionID` 這些保留名**不出現在任何工具的可見參數裡**（配合 M10 的 `Injected` 標記），出現就 fatal；(b) 把 SessionEnvs 的 key 集中成常數並提供一個 typed accessor（`wanttools.ChannelFrom` 已經是雛形），避免各處用裸字串 `"channelID"` 拼錯。**為什麼重要**：這把「安全邊界」從「靠自律」推進到「靠自檢擋」，雖然還不是 want 原生原語（🔴 那部分繞不掉），但在應用層已經能把「不小心破壞邊界」變成「CI/啟動時就爆」。低成本、高價值。

### M13. capability 標註 + 匿名 session 降權，在應用層強制

**可行性 🟢｜工作量 M**

**問題**：Tripace 有免登入公開分享連結，但目前沒有機制保證「匿名 session 只能用唯讀工具」——角色能用哪些工具是散在 `assistant_agent.go` 的字串白名單裡，跟「這是不是匿名連結」無關。**緩解**：在 `toolschema.Tool` 加一個 capability 標註（`Mutating bool` 或 `Capability string`：read-only / mutating / external），然後在**選 role / 組工具白名單的那一層**（應用層完全掌控）依請求身份過濾——匿名 session 拿到的 orchestrator，其 role 白名單只含標記為 read-only 的工具。因為 want 的白名單是 `AgentDefinition.Tools` 字串陣列、由應用層在 `agentreg.Register` 時給定，應用層可以為「匿名」註冊一個削減版 role。**為什麼重要**：對一個開放匿名寫入面的產品，「匿名只能讀」必須是系統擋得住的硬約束而非人工維護。這完全在應用層可做（想清楚 role 怎麼分、白名單怎麼依身份組），是實打實的攻擊面收斂。

---

## 五、可觀測性

want 不原生支援 OTel（🔴 那部分繞不掉），但應用層有大量現成的觀測接縫沒被用起來。

### M14. 用 `EventBus.Subscribe` + `OnError` 打點，補上 metrics/tracing

**可行性 🟢｜工作量 M**

**問題**：全站無 metrics/tracing，LLM 錯誤只 `fmt.Printf`（`want_analyzer.go` 的 `OnError` 就是這樣）。線上等於盲飛。**緩解**：want 其實給了兩個絕佳的觀測掛點，應用層現在就能接——(a) `orch.EventBus.Subscribe("agent.inference", ...)`：`want_analyzer.go` 已經在訂閱它做文字收集了，在同一個 closure 裡就能順手記錄「本次推論用了多久、發了哪些工具呼叫、什麼 view model」，導出成 Prometheus metrics 或 OTel span；(b) `orch.OnError(...)`：把現在的 `fmt.Printf` 換成結構化 log + error counter。再包一層：在 `Assist`/`Answer` 進出各記一個 span（推論延遲、是否 timeout、logged 幾筆），就有了端到端的每次對話追蹤。**為什麼重要**：這是「從盲飛到有儀表板」最直接的一步，且完全不碰 want——want 的事件流已經把該暴露的都用事件暴露了，應用層只是還沒去訂閱它做觀測。工作量 M，價值極高（尤其配合 M8 的 retry，能看到 provider 失敗率）。

### M15. 把散落的 `NotifyXxx` binding 收敛成一條結構化事件流

**可行性 🟢｜工作量 M**

**問題**：`sink.go` 有一大堆 `BindNotify`/`NotifyAskChoice`/`NotifyEntriesLoaded`/`NotifyTaskCreated`… 綁定函式，本質上是應用層在**手工重建一個事件匯流排**——工具要通知前端就呼叫對應的 `NotifyXxx`。這既是 M14 想要的觀測來源，也是 M3 想拆的全域狀態的近親。**緩解**：把這些 `NotifyXxx` 統一成「往一條 typed event channel 發結構化事件」，由三個消費者訂閱：前端 WS 廣播（現有行為）、可觀測性 exporter（M14）、以及未來的完成判定。這樣工具端只管「發一個 `EntriesLoaded` 事件」，不用知道有誰在聽。**為什麼重要**：現在每加一種前端通知就要加一對 `BindXxx`/`NotifyXxx`（`sink.go` 已經肉眼可見地臃腫），收斂成事件流後，觀測、UI、控制流三者共用同一份真相，也讓 M3（拆全域狀態）有一個現成的載體。純應用層。

---

## 六、版本與供應鏈

### M16. 為 want 建立 vendor + 版本自檢，降低單點風險

**可行性 🟢｜工作量 S**

**問題**：want 鎖 `v0.0.2`、需私有 `GH_PAT` 才能拉、無 dependabot（前一份文件建議 17）。want 自己怎麼發版繞不掉（🔴），但**供應鏈韌性可以在 Tripace 這側加固**。**緩解**：(a) `go mod vendor` 把 want v0.0.2 連同其原始碼 vendor 進 repo，這樣即使 `GH_PAT` 失效、上游倉庫消失，專案仍能建置——對一個「需要私有 token 才能拉的核心依賴」，vendoring 是最直接的單點風險對沖；(b) 在 CI 加一個 `go.sum` 校驗 + 「want 版本號變動需人工 review」的守門；(c) 既然已經在讀 want 原始碼（本文件就做了），把「want 對外 API 的哪些行為是 Tripace 依賴的」寫成一份契約清單（例如「依賴 `SetupWith` 建獨立 EventBus」「依賴 `GlobalAppStore` 不被 assistant role 用到」），未來若真要升級 want，這份清單就是回歸測試的依據。**為什麼重要**：無法讓 want 變穩定，但能讓「want 消失或變動」對 Tripace 的衝擊從「無法建置/靜默壞掉」降到「vendored 仍可跑 + 契約清單指出風險點」。工作量 S，是供應鏈風險最務實的止血。

### M17. 建立 want 行為的 characterization test（把隱性依賴顯性化）

**可行性 🟢｜工作量 M**

**問題**：Tripace 對 want 有一堆**隱性行為依賴**，散在註解裡（`SetPromptBuilder` 每輪重跑、`activationQueue` buffer 500、`GlobalAppStore` 語意…），沒有任何測試把它們釘住。哪天 want 換版本、某個行為變了，只會在生產環境以詭異方式炸。**緩解**：針對 Tripace 實際依賴的 want 行為寫一組 characterization test（特徵化測試）——用 want 的 `mock` provider（`InitializeWithConfig` 支援 `settings.Provider == "mock"` + `MockScenario`，`internal/mockllm/` 也已經有腳本化假 LLM 的基建）跑一遍 `Assist`/`Answer`，斷言「N 個 orchestrator 併發不互相污染」「`SetSessionEnvs` 的值確實只給到本次呼叫的工具」「`idle` 事件時序符合 M6 的假設」。**為什麼重要**：這既是 M2（N-pool 安全性）的驗證手段，也是 M16 契約清單的可執行版本，還是未來升級 want 的安全網。它把「我們以為 want 是這樣」變成「CI 每次都驗證 want 確實是這樣」。

---

## 七、測試策略與依賴注入

`internal/api` 零測試的根因是全域狀態 + `init()` 註冊讓「建乾淨被測環境」太貴。應用層能做的比想像多。

### M18. 善用 want 已有的 `mock` provider + `mockllm`，讓 api 層可測

**可行性 🟢｜工作量 M**

**問題**：前一份文件建議 19 說「要測 api 就得起真 analyzer、拖進所有 init 工具」。但實際上 want **已經提供了測試替身的基建**——`InitializeWithConfig` 認 `mock` provider（腳本驅動、不打真 API），Tripace 自己也有 `internal/mockllm/`（`script.go`/`server.go`）和 `internal/llm/mock_analyzer.go`。**緩解**：把 api handler 對 LLM 的依賴，從「直接拿 `WantPool`」改成「依賴一個 `Analyzer` interface」（`want_pool.go` 其實已經定義了 `Analyzer`/`Assistant` interface，且有 `mock_analyzer.go`！），測試時注入 mock。api handler 測試就不必起真 want，只驗證 HTTP 層邏輯（路由、驗證、序列化、錯誤碼）。**為什麼重要**：接縫**已經存在**（interface + mock_analyzer 都有），缺的只是 api 層真的透過 interface 注入而非直接 new。這是把 `internal/api` 從零測試撬起來的支點，且大半基建現成。工作量 M。

### M19. 把 `wanttools` 全域狀態改造後，工具可獨立單元測試（與 M3 同源）

**可行性 🟡｜工作量 L**

**問題**：現在測一個 wanttools 工具要先 `RecordLock()` 再讀 `EmitCount()`/`Presented()` 全域讀取器，測試間透過全域狀態耦合、不能並行（`sink_test.go`/`task_plan_test.go` 就是這樣寫的）。**緩解**：這與 M3 是一體兩面——一旦 per-request 狀態實例化（用 runID-keyed collector 或 `EmitToolResult` 收集），每個工具測試自帶獨立 context 與收集器，斷言讀本次回傳值，測試間零共享、可並行。`toolschema` 的 `Validate()` 已經是純函式好測的正面例子，工具邏輯也該往那個方向走。**為什麼重要**：這再次說明 M3 不只是「為並行」——它同時解鎖了「工具的隔離單元測試」。生產並行與測試隔離是同一個「拆全域狀態」改造的兩張臉，做一次、兩邊都受益。

---

## 八、部署與多環境

### M20. orchestrator 實例化 → 應用層自己做「不同配置的 analyzer」

**可行性 🟡｜工作量 M**

**問題**：Tripace 只有單一 prod、部署在 Cloud Run，全 process 一組 want 配置。前一份文件建議 21 期待 want 支援 per-env engine。**緩解**：查證發現 `SetupWith(settings, role)` 是**純函式、吃呼叫端組好的 `Settings`**（`want_analyzer.go` 的 `NewWant` 已經自己組 `Settings` 傳進去，不依賴 want 的 configs 路徑），所以應用層其實**能建多個不同配置的 orchestrator**——只要 `GlobalEngine` 的共用不擋路。**caveat（重要）**：`InitializeWithConfig` 會**覆寫全域的 `GlobalEngine.Provider`**——所以「同一 process 內並存兩個不同 provider 的 orchestrator」目前**做不到**（後一次 `SetupWith` 會蓋掉前一次的 `GlobalEngine`）。這是應用層繞不掉的 🔴 部分。但「不同環境用不同配置」可以靠**部署層**解——Cloud Run 用不同的環境變數起不同的 revision/service（dev/staging/prod 各一套 env），每個 process 內仍是單一 `GlobalEngine`，不衝突。**為什麼重要**：釐清了邊界——「多環境」用部署層的多 service 解（🟢，本來就該這樣）；「同 process 多 provider（A/B、影子流量）」才是繞不掉的 want 限制（🔴）。別把前者誤當後者去硬幹。

### M21. 為 Cloud Run 多實例把 session/interaction 狀態外部化

**可行性 🟡｜工作量 L**

**問題**：Cloud Run 會水平擴展多實例，但 `clienttools` 的 `askers` map、want 的 `interactionRegistry`、`sink.go` 的全域狀態都是**單實例記憶體內**的。一旦擴到多實例，「工具在實例 A 掛起等前端回應，但前端的 WS 連到了實例 B」就會永遠等不到。**緩解**：短期最務實的是**用 Cloud Run 的 session affinity**（把同一使用者的 WS 與其觸發的 HTTP 導向同一實例），讓「掛起與回應落在同一實例」成立——這是純部署設定，🟢 立即可做，但只是止血。中期若要真多實例，得把 pending interaction 的關聯狀態外部化到 Redis（requestID → 哪個實例/如何喚醒），這是 L 工作量且部分依賴 M5 的收敛決定。**為什麼重要**：這決定了 Tripace 能不能安全地開多實例。在做 M2 的 N-pool（單實例內並行）之前，其實可以先靠「單實例 + session affinity + 更大機器」走一段路；真正需要跨實例時再上外部化。誠實標記：跨實例的非同步工具狀態，是應用層能緩解（affinity）但無法優雅根治（要外部化 + 部分 want 限制）的地方。

---

## 排序建議（給你的 TL;DR）

**先做這批（🟢、低風險、立即見效）**：
- **M1**（縮短 `w.mu` 臨界區）— 投報比最高，臨界區從數十秒降到毫秒。
- **M4**（背壓 + rate limit）— 堵 DoS 面，S 工作量。
- **M7**（工具名常數化 + 啟動自檢）— 消滅一整類字串白名單坑。
- **M14**（用 EventBus/OnError 打點）— 從盲飛到有儀表板。
- **M16**（vendor want + 版本守門）— 供應鏈止血。
- **M18**（用現成 mock/interface 讓 api 可測）— 撬起零測試，接縫已存在。

**接著做（🟡、需驗證或中等工作量，解結構問題）**：
- **M3 + M17**（拆 `sink.go` 全域狀態，並用 characterization test 驗證）— 這是 M2 的前置。
- **M2**（N-orchestrator pool）— 把並行天花板從 1 抬到 N，但務必先做 M3 並壓測 `GlobalAppStore`。
- **M6**（確定性完成判定）、**M8**（外層 retry）、**M13**（匿名降權）。

**跨平台三部曲（🟢🟡、把 onagent 試做扶正）**：
- **M9 → M10 → M11**（`toolschema` 當 SSOT → injected 標記 → port 介面）。地基已在，順序做。

**繞不掉、只能標記為 want 的硬限制（🔴）**：
- 同 process 多 provider 並存（`GlobalEngine` 覆寫，M20 caveat）。
- provider 呼叫路徑內的細粒度 retry/circuit breaker（在 want internal，M8 只能外層粗粒度緩解）。
- 跨 Cloud Run 實例的非同步工具狀態根治（M21 只能靠 affinity 止血 + 外部化緩解）。

**一句話總結**：真正卡你的不是「want 是全域單例」這句話本身——查證後，want 的 orchestrator 其實大致可獨立併發，真正的瓶頸是**應用層把 `w.mu` 鎖太久（M1）**、**per-request 狀態放進了 package 全域（M3）**、以及**沒去用 want 已經暴露的接縫**（EventBus 觀測、mock provider、RequestInteraction、SetupWith 的純函式性、`toolschema` 這份現成 IR）。這些幾乎全部在應用層可解，不必等 want 動一行。
