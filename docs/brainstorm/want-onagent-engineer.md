# want / onagent 功能腦力激盪 —— 工程師視角

> 這份文件是站在「實際維護 Tripace 後端、每天要跟 `want` 與 `onagent` 這兩個依賴打交道」的資深工程師角度，對兩個上游維護者提出的功能願望清單。不是 bug 修復清單，而是「如果這些東西存在，我寫程式碼會順很多」的功能腦力激盪。每一點都盡量說清楚「為什麼會卡」與「我希望它長什麼樣」。

---

## 一、`want`（LLM/agent 編排引擎）

`want` 是我們的核心引擎，但 `go.mod` 鎖在 `v0.0.2`，很多東西還沒長出來，逼得呼叫端（`server/internal/llm`、`wanttools`、`clienttools`）自己刻了不少繞路方案。以下依主題整理。

### 1.1 併發與 session 隔離

**1. 真正的實例化引擎（去全域單例）。**
現在 `want` 的 `GlobalEngine` / `GlobalEventBus` / `GlobalAppStore` 是 process 級全域狀態，同一 process 內開多個 `Orchestrator` 會互相污染，所以我們的 `want_pool.go` 裡 `For(sessionID)` 只能忽略 sessionID、一律回傳同一個共用 analyzer。我希望 `want` 提供 `NewEngine(settings) *Engine`，讓每個 `Orchestrator` 綁在自己的 engine 實例上、狀態完全隔離，我就能真的做到「一個 session 一個 orchestrator」，把 `want_pool.go` 裡那段被註解掉的 per-session 程式碼直接啟用。這是目前最大的架構解鎖點。

**2. 每個對話真正並行、不互相排隊。**
因為上一點做不到，我們只好在 `WantAnalyzer` 外面包一把 `sync.Mutex`（`w.mu`），把全站所有使用者的 LLM 呼叫序列化——這等於「同時只有一個人能跟 AI 講話」，其他人全部排隊，也是現成的 DoS 面（一個人送 90 秒逾時的 prompt，全站卡 90 秒）。我希望 `Orchestrator` 本身就是併發安全、且不同 orchestrator 之間零共享狀態，這樣我把那把 mutex 拿掉、換成 per-session pool 之後，N 個對話就真的 N 路並行。

**3. Engine 層的全域併發上限 / 佇列。**
真的做到並行之後，我又會擔心反過來壓垮 provider（rate limit、GPU 記憶體）。所以希望 engine 提供一個可設定的 `MaxConcurrentInferences` 與內建的等待佇列（帶佇列逾時），讓我在「每 session 並行」與「保護後端資源」之間有一個旋鈕可調，而不是只能在「全序列」與「全放行」兩個極端之間二選一。

### 1.2 推論生命週期與可觀測性

**4. 確定性的「推論完成」信號。**
這是每天最想罵人的一點。現在 `generate` / `Assist` / `Answer` 都靠 `EventBus.Subscribe("agent.inference")` 收事件，然後在收到 `StatusViewModel{Status:"idle"}` 之後又 `go func(){ time.Sleep(1500 * time.Millisecond); finish() }()`——因為文字事件「可能」晚於 idle 到達，只好硬等 1.5 秒賭它到齊。這是 race-prone 的啟發式，慢的時候漏字、快的時候白等。我希望 `want` 給一個明確的終局事件（例如 `agent.turn.complete`，帶上「本輪已無後續事件」的保證），或直接提供 `orch.Run(ctx, prompt) (Result, error)` 這種同步 API，一次把「整輪的完整文字 + 工具呼叫結果 + 結束」交給我，我就能把三個檔案裡重複的 `EventBus.Subscribe` + `time.Sleep` + `select{done/timeout}` 樣板全部刪掉。

**5. 高階同步 API：`Run(ctx, prompt) → 結構化結果`。**
延續上一點。我們其實只想要「送一段 prompt、拿回這輪的 assistant 文字與副作用」，但 `want` 只給事件流，逼我自己把事件驅動的東西重新包成同步的（三個 method 各包一次、各自維護 `sb strings.Builder` / `done chan` / `once`）。若 `want` 原生提供 request/response 風格的高階入口（事件流仍保留給需要串流 UI 的人），這層重複的膠水碼就消失了。

**6. 內建 tracing / 結構化日誌 hook。**
現在要知道「這輪 agent 到底呼叫了哪些工具、每個工具花多久、provider 回了什麼」，只能自己在事件裡撈或印 `fmt.Printf("[want] ...")`。我希望有一個 `orch.OnSpan(func(span))` 或 OpenTelemetry 整合點，讓每輪推論、每次工具呼叫、每次 provider 往返都是一個可觀測的 span，帶 latency 與 token 數。這對線上排查「為什麼這則訊息整理得很慢」是剛需。

**7. Token / 用量統計回傳。**
帳單與配額都需要知道每輪用了多少 token，現在 `want` 不回這個，等於用量對我是黑箱。希望結果裡帶 `Usage{PromptTokens, CompletionTokens, ...}`，我才能做 per-channel 配額、成本歸因與異常用量告警。

### 1.3 韌性（retry / timeout / fallback）

**8. 可設定的逾時，不要寫死。**
我們現在三處都是 `time.After(90 * time.Second)` 硬編碼。不同工具鏈長度差很多（純問答 vs 要連 geocode + recommend_nearby 的規劃），一個數字打天下。希望逾時能透過 `context.Context`（見 1.4）或設定傳入，並且逾時要能真正中止底層 provider 呼叫，而不是我這邊 `select` 逾時了、底下那個 goroutine 還在偷跑。

**9. 內建 retry 與退避策略。**
provider 偶發 5xx / 網路抖動是常態，現在 `want` 完全沒有 retry，一次失敗就整輪失敗、使用者看到一則整理失敗的訊息。希望 engine 層提供可設定的自動重試（含 exponential backoff、可重試錯誤白名單、冪等保證），把暫時性故障吸收掉。

**10. Circuit breaker 與 provider fallback。**
當主 provider 整個掛掉（例如 Anthropic 短暫不可用），現在會 90 秒逾時 ×N 把系統拖垮。希望 engine 內建 circuit breaker（連續失敗就快速失敗、半開探測恢復），並支援「主 provider 失敗自動切備援 provider / 備援 model」的 fallback 鏈，讓服務降級而不是硬卡。

### 1.4 Request-scoped context（而非全域狀態）

**11. 原生 `context.Context` 貫穿。**
現在 `orch.Submit(prompt)` 不吃 `context.Context`，所以我沒辦法把上游 HTTP request 的取消/逾時/deadline 傳進去——使用者關掉分頁了，後端那輪推論還在燒。希望所有入口（Submit / Run）第一參數都是 `ctx context.Context`，取消能一路傳到 provider 呼叫與工具執行，deadline 也從 ctx 來。

**12. Request-scoped 的環境值，取代 `SetSessionEnvs` 這種「設定→Submit」全域寫入模式。**
現在我們靠 `orch.SetSessionEnvs(map[...]{channelID, messageID, sessionID})` 把頻道範圍塞進去，讓工具用 `ctx.GetSessionEnvs()` 拿到——這個「不把 channelID 放進 prompt、LLM 無法被提示詞注入誘導去操作別的頻道」的設計本身是對的（是我們少數做對的安全設計），但實作是「Submit 前寫一個 orchestrator 上的欄位」，正因為它是實例級狀態，我們才被迫用 `w.mu` 序列化來保證「設定→Submit→這輪工具都讀到同一份值、不被下一次呼叫覆寫」。我希望這些值改成隨單次呼叫傳入（例如 `orch.Run(ctx, prompt, want.WithEnvs(map[...]))`，值綁在該次 ctx 上），這樣併發呼叫彼此天然隔離，我就不需要靠全域 mutex 來保護一份共享欄位——這一點同時解掉了 1.1 的併發問題。

### 1.5 工具介面（tools）

**13. 讓「等外部系統回應」成為一等公民（RequestInteraction 的正式化）。**
這是我們最大的一塊重複造輪子。`want v0.0.2` 其實已經在 `orchestrator/interaction.go` 內建了 `RequestInteraction`/`ResolveInteraction`（`interactionRegistry`），但因為缺文件、缺範例、也不確定語義是否穩定，我們在 `server/internal/clienttools/interaction.go` 又自己刻了一整套平行的 `pendingCalls`＋阻塞機制來處理「工具呼叫要 block 等瀏覽器分頁回一個結果」這件事，程式碼註解裡自己標了「A production follow-up could consider consolidating onto orch.RequestInteraction later」。我希望 `want` 把這組 interaction API 正式化：清楚的型別、逾時/取消語義、多個 pending interaction 並存的保證、以及一份「工具在 dispatch goroutine 裡如何 block、host 如何 resolve」的完整範例，讓我能砍掉自己那套 `RegisterAsker`/`lookupAsker`/`askPage`。

**14. 型別安全的工具註冊，取代 `RegisterTool` + `json.RawMessage`。**
現在 `types.RegisterTool` 註冊的工具，input 是 `json.RawMessage` 自己 `Unmarshal`、output 也是自己 marshal，schema 與 Go struct 兩邊手寫、容易漂移（`onagent-tools.yaml` 的註解就記了一個血淋淋的例子：漏加 `kind: query` 會讓 LLM 完全看不到結果卻毫無錯誤）。我希望有泛型版註冊，例如 `want.RegisterTool[In, Out](name, desc, func(ctx, In) (Out, error))`，schema 由 struct tag 自動生成、輸入輸出強型別，編譯期就擋掉型別錯誤。

**15. Per-role 工具白名單成為引擎的一等概念。**
我們現在每個角色（assistant 等）的工具白名單是在 `assistant_agent.go` 的 `init()` 裡自己拼湊管理的（哪些工具取代哪些、哪些保留只為了不讓舊碼編不過）。希望 `want` 原生支援「角色 → 允許的工具集合」的宣告式設定，並在 dispatch 時就強制執行（LLM 叫了不在白名單的工具直接被引擎擋下並回明確錯誤），而不是靠我們在應用層自律。

**16. 工具執行的逾時、取消與 panic 隔離。**
工具跑在 `want` 自己的 dispatch goroutine 裡，如果某個工具（例如 `geocode` 打外部 API）卡住或 panic，我希望是「這個工具呼叫失敗、回錯誤給 LLM 讓它自己決定怎麼辦」，而不是拖垮或炸掉整輪推論。希望每次工具呼叫都在受控的 goroutine 裡執行，吃 ctx 逾時、recover panic、並把結果標準化成「成功/失敗」回給推論流程。

**17. 工具副作用的回傳，不要靠套件級全域變數收集。**
現在 `present_entries` / `recommend_nearby` 這類工具的產出，是寫進 `wanttools` 的套件級全域（`Presented()` / `RecommendedPlaces()` / `EmitCount()`），跑完再撈出來——正因為是全域，我們又得配一組 `RecordLock()` / `RecordUnlock()` 在每輪開頭重置，這也是逼我們序列化的原因之一。如果 `want` 的 `Run` 結果能結構化地帶回「這輪每個工具呼叫的輸入與輸出」，我就能直接從結果讀，不必維護這些全域 sink 與它們的鎖。

### 1.6 本地開發、測試與版本穩定性

**18. 官方的 mock / fake provider 與 in-memory engine，方便測試。**
現在要寫 `llm` 層的單元測試幾乎不可能，因為 `want` 會真的去連 provider、還讀 `os.Getwd()` 設 `InitialWorkingDir`、`MountServices()` 掛全域路由，測試環境很難拉起來。希望 `want` 提供 `want.NewFakeEngine(scriptedResponses)` 之類的測試工具，讓我可以「給定 prompt、預設 agent 會叫哪些工具、回什麼文字」，純記憶體、不連網、可平行跑，讓 `Assist`/`Answer` 的邏輯能被測。

**19. 去除隱式全域副作用（`InitialWorkingDir`、`MountServices`）。**
`NewWant()` 現在要先 `wanttypes.InitialWorkingDir = wd`、再 `wanttypes.MountServices()`，這些是隱式的全域初始化，順序敏感、也讓「同 process 兩個引擎」不可能。希望這些都收斂進 `NewEngine(settings)` 的顯式設定裡（工作目錄、要掛的服務路由都當參數傳），沒有藏在套件變數裡的初始化步驟。

**20. 語意化版本、變更日誌與穩定性承諾。**
`v0.0.2` 這個版本號本身就是風險：沒有 changelog，我升版前完全不知道哪些行為會變（尤其 EventBus 事件語義、`HandleInferenceMessage` 的回傳型別、interaction API 這些我們深度依賴的東西）。希望上游走 semver、標注哪些是 public API、每次發版附 changelog 與 migration note，讓我敢升級而不是永遠釘死在 `v0.0.2`。

**21. 供應與拉取的可靠性（配合 dependabot/renovate）。**
`want` 是私有套件、要 `GH_PAT` 才拉得到，PAT 一過期部署就整個中斷（單點失效），而且我們沒有 dependabot/renovate 盯它更新。這比較偏我們自己的 CI 要補，但也想請上游至少發正式的 tagged release（而非只靠 branch/commit）、並考慮提供可被自動化更新工具追蹤的 release feed，讓「有新版」這件事能被機器發現。

**22. 文件品質：事件型別對照表與最小可跑範例。**
我們現在對 `want` 的理解，很多是逆向 `web/server.go` 官方範例＋讀原始碼推出來的（例如「`TextViewModel` 是 assistant 文字、`StatusViewModel{idle}` 表示結束、但文字可能晚於 idle 到」這種關鍵知識，是靠註解口耳相傳的）。希望有一份文件把所有 `agent.inference` 事件型別、觸發時機、順序保證講清楚，並附「送一個 prompt → 收完整回應」的最小完整範例，我就不用每次都回去啃原始碼。

---

## 二、`onagent`（第三方 agent 平台串接）

`onagent` 目前還在 POC（`web/src/OnagentBridgeDemo.tsx` + `server/tools/onagent-tools.yaml` + `.claude/skills/onagent-cli-setup`）。這次試做的核心命題是：**同一份工具邏輯，能不能同時被自家系統與 onagent 呼叫，不用重寫。** 以下願望都圍繞這個命題與 POC 過程踩到的坑。

### 2.1 工具定義的單一事實來源

**23. 工具定義能從既有格式生成，不要逼我維護第二份。**
現在 `server/tools/onagent-tools.yaml` 跟自家的 `web/src/clienttools/clienttools.yaml` 是兩套完全獨立、格式還不完全相同的系統（onagent 沒有 `appId` 欄位概念、不支援某些擴充欄位、`kind` 欄位語義也不同），我得手動維護兩份、還得靠 `web/src/sdk-proposals/toAgentBridgeTools.ts` 做轉接。我希望 onagent 提供一個標準的工具 schema 匯入（吃 JSON Schema，或至少提供官方 adapter），讓我能從單一事實來源生成 onagent 的工具定義，兩邊永不漂移。這正是「同一份邏輯兩邊共用」命題成立的前提。

**24. `kind`（action / query）預設值要安全、缺漏要能被偵測。**
`onagent-tools.yaml` 註解記了一個很痛的坑：`kind` 不設時預設是 `action`（fire-and-forget，前端回傳內容永遠不餵回 LLM），所以一個「本該讓 LLM 看到結果的查詢工具」漏了 `kind: query`，LLM 就完全看不到結果，而且沒有任何錯誤，超難察覺。我希望 onagent 要嘛把「有 `returns` 定義的工具」預設成 query、要嘛在 `save-tools` 時對「宣告了 returns 卻是 action」發出警告，讓這種靜默失敗在推送階段就被擋下。

### 2.2 開發者體驗（CLI / 本地環境）

**25. `save-tools` 的 dry-run、diff 與驗證。**
`onagent save-tools -api <url> tripace onagent-tools.yaml` 現在推上去之前，我看不到「這次會改動什麼、schema 合不合法」。希望 CLI 支援 `--dry-run` 顯示與線上現況的 diff、並在推送前做 schema 驗證（欄位型別、required、kind 合法性），避免把壞定義推上平台才發現。

**26. 明確的健康檢查端點，別讓我被假 200 騙。**
本地開發踩過一個大坑（註解有記）：誤把 onagent 後端當成 tripace-server 的 8080 埠，而 tripace-server 對任何未知路徑都回 `200 + 一段 HTML` 的靜態 fallback，製造出「看起來有回應、其實沒人處理」的假象，一度誤導判斷（實際 onagent 後端在 8081）。我希望 onagent 後端提供一個明確、輕量、回 JSON 的 `/healthz`（或 `/console/ping`），讓我一個 `curl` 就能斬釘截鐵確認「我連到的是不是 onagent」，而不用靠「回傳開頭是不是 `<!doctype html>`」來土法判斷。

**27. 本地開發的離線模式 / 平台 emulator。**
現在要試 onagent，得真的連上外部 onagent 後端（還要登入、建 app、發 apiKey、設 allowed origin 一整套流程）。希望官方提供一個可本機跑的 emulator（`onagent dev`），讓前端能連本機 WebSocket、跑完整「agent 呼叫工具 → 工具在瀏覽器執行 → 結果餵回」的迴路，不依賴外部服務、也不用每次都跑那一長串 console 設定，CI 裡也能跑端對端測試。

### 2.3 SDK、協定與安全

**28. 型別安全的 AgentBridge SDK（TypeScript 型別由工具定義生成）。**
`OnagentBridgeDemo.tsx` 現在用 AgentBridge SDK 接工具，但工具的參數/回傳型別跟 `onagent-tools.yaml` 是靠人腦對齊的。希望 SDK 能從工具定義生成 TypeScript 型別（`onagent codegen`），讓前端註冊 handler 時參數與回傳都有型別檢查，schema 一改、前端編譯就報錯。

**29. WebSocket 連線的韌性：重連、心跳、背壓。**
「前端連 WebSocket → agent 呼叫工具」這條連線在真實網路下會斷。希望 SDK 內建自動重連（帶退避）、心跳保活、以及斷線期間工具呼叫的處理策略（明確報錯或排隊），我不想自己在應用層重寫一套連線狀態機。

**30. allowed origin / apiKey 之外，工具層級的授權。**
現在的安全邊界是 app 級的 apiKey ＋ allowed origin。但我們自家系統靠 `SessionEnvs` 把 channelID 綁在後端、LLM 碰不到（就是那個「防提示詞注入操作別的頻道」的設計）。走 onagent 時，工具是在瀏覽器端執行的，我需要一個對等的機制：把「這個 session 只能操作哪個 channel/trip」的範圍綁在連線或呼叫的憑證上、由平台強制，而不是信任 LLM 傳來的參數。缺了這層，onagent 路徑的安全性會比自家路徑弱一截。

**31. Agent 呼叫工具的稽核紀錄與重放。**
串平台之後，「agent 到底叫了哪個工具、帶什麼參數、前端回了什麼」對我變成半個黑箱。希望 onagent console 提供每次工具呼叫的稽核日誌（可查、可匯出、最好能重放），這樣線上出問題時我能回溯是 agent 判斷錯、還是工具執行錯，而不是只能盲猜。

### 2.4 兩套系統的收斂路線

**32. 一份關於「onagent vs 自家 ClientToolsBridge 如何共存/收斂」的官方指引。**
我們現在同時有兩套平行系統：自家的 `ClientToolsBridge`（後端轉發工具呼叫到瀏覽器分頁）與 onagent 的 AgentBridge。POC 想驗證的正是「能不能不重寫兩份」。希望 onagent 官方能給一份設計指引，說明它與「開發者已有的自建 bridge」該如何分工、哪些責任該交給平台、遷移路徑長怎樣——讓我能做出「要不要、以及如何從自家 bridge 收斂到 onagent」的架構決策，而不是讓兩套系統無限期並存、各自維護、彼此漂移。

---

## 附註：一句話總結

`want` 最想要的是**去全域化**（實例化引擎 + request-scoped context），它一次解掉併發序列化、mutex、全域 sink 三個連環問題；其次是**確定性的完成信號**（幹掉 `time.Sleep(1500ms)`）與**把 interaction 正式化**（幹掉自刻的 `pendingCalls`）。`onagent` 最想要的是**工具定義的單一事實來源**（讓「同一份邏輯兩邊共用」的命題真的成立）與**安全的預設值 + 明確的健康檢查**（別再被靜默失敗與假 200 騙）。
