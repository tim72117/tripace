# want / onagent 功能腦力激盪 —— 系統架構師視角

> 這是一份純探索性的架構腦力激盪文件。目標不是提出可立即實作的 spec，而是站在系統架構師的高度，替兩個外部依賴 `github.com/tim72117/want`（自家 LLM/agent 編排引擎）與 `github.com/tim72117/onagent`（第三方 agent 平台）勾勒出「理想上應該長什麼樣」的能力邊界。所有建議都以 Tripace 現況為對照組，重點放在結構性、跨系統的韌性與可維護性，而非單一工具的小便利。
>
> 貫穿全文的核心命題是：**目前 Tripace 有太多本該由框架保證的性質（並行隔離、非同步工具、安全邊界、可觀測性、測試接縫），被下放成應用層必須小心翼翼手工維護的約定。** 好的框架應該把這些約定「原語化」，讓應用層無法輕易做錯。

---

## 一、隔離與並行（Isolation & Concurrency）

這是目前整個系統最硬的天花板。`internal/llm/want_pool.go` 的骨架寫得很誠實——它已經預留了 `byID map[string]*WantAnalyzer` 想做 per-session 實例，但註解直白承認 want 引擎是「全域單例」設計（`GlobalEngine` / `GlobalEventBus` / `GlobalAppStore`），所以 `For(sessionID)` 只能忽略 sessionID、一律回傳 `shared`。這不是應用層偷懶，而是框架的能力上限逼出來的妥協。

### 1. 引擎必須可實例化，而非全域單例

**問題脈絡**：want v0.0.2 把 engine / event bus / app store 都做成 process 級全域，導致 `want_pool.go` 明明備好了 per-session 容器也無法啟用（見檔案內註解「同一 process 內多個 orchestrator 會共用全域狀態而互相污染」）。全站所有使用者的 LLM 對話因此被壓進單一 analyzer、單一 mutex 序列化。**理想樣貌**：want 應提供 `want.NewEngine(cfg) *Engine` 形式的建構子，engine 內部持有自己的 event bus 與 app store，orchestrator 由 engine 派生。全域單例可以保留為「便利預設」，但不能是唯一路徑。**為什麼重要**：只要 engine 能實例化，`want_pool.go` 的 `newSessionAnalyzer()` 就能真正落地，「per-request 並行」從此變成框架保證的結構性質，而不是一行被註解掉的願望。

### 2. session / tenant 隔離要是第一類概念，而不是字串鍵

**問題脈絡**：現在 sessionID 只是 `For()` 的一個被丟棄的 `string` 參數，channelID 靠 `SetSessionEnvs` 塞進 map 再由 `ChannelFrom(ctx)` 撈出。租戶邊界完全靠慣例維繫。**理想樣貌**：want 應有明確的 `Session` / `Tenant` 型別作為 engine 的子作用域（scope），每個 session 擁有獨立的狀態命名空間、獨立的工具實例、獨立的事件流；跨 session 存取在框架層就是不可能的，而非「因為我們記得傳對 channelID 所以安全」。**為什麼重要**：把隔離做成型別而非字串，等於把「忘記隔離」這個 bug 類別從編譯期就消滅掉。對一個開放匿名公開分享連結的產品，這是安全底線。

### 3. 並行度與資源上限應由框架提供背壓（backpressure）

**問題脈絡**：因為全站共用單一 analyzer，單一使用者甚至一個匿名公開連結，只要持續打字就能長時間持有那把 mutex，形成現成的 DoS 面——這在 `want_pool.go` 的設計註解裡是隱含的天花板。**理想樣貌**：engine 應內建可設定的並行池（worker pool）、每租戶配額（per-tenant quota）、佇列上限與逾時，超限時回傳明確的 `ErrOverloaded` 讓應用層優雅降級，而不是無限等待 mutex。**為什麼重要**：LLM 呼叫昂貴且慢，沒有背壓的系統在流量尖峰下不是變慢而是整個卡死。框架級的配額讓「一個壞鄰居拖垮全站」不再可能。

### 4. request-scoped 狀態必須由框架用 context 承載，禁止套件全域

**問題脈絡**：`server/internal/wanttools/sink.go` 有 13 個 package-level 全域變數（`emitCount`、`emittedIDs`、`presented`、`recommendedPlaces` 等），本質上是「這一次請求的執行結果」，卻被放進套件全域，只能靠單一 `recordMu` + `RecordLock()/RecordUnlock()` 把整個記錄流程序列化來避免交錯。這是全域單例瓶頸的直接後果——因為只有一個 analyzer，所以「這次請求的累積結果」也只好用一組全域變數裝。**理想樣貌**：want 的工具執行應提供一個 request-scoped 的收集器（例如 `ctx.Collector()` 或工具回傳值聚合），每次 Submit 自帶獨立的結果累積區，工具透過 context 寫入、呼叫端從該次執行的 result 讀出，全程不碰任何 package-level 變數。**為什麼重要**：`sink.go` 那把 `recordMu` 是「全域狀態」逼出來的序列化，一旦框架把 per-request 狀態原語化，這 13 個全域變數與那把鎖可以整組刪除，並行才有可能真正發生。

---

## 二、工具執行模型（Tool Execution Model）

Tripace 在工具這一層自製了大量本該屬於框架的東西，最戲劇性的證據是 `server/internal/clienttools/interaction.go` 開頭的註解：它明說 want v0.0.2 其實已經 ship 了可用的 `RequestInteraction`/`ResolveInteraction` bridge 在 `*orchestrator.Orchestrator` 上，但這個 POC「deliberately avoids」它、改用自製機制。這暴露了一個框架設計問題：即便原生能力存在，若它不夠好用/不夠顯眼/語意不合，應用層就會繞過它重刻一套。

### 5. 工具執行要原生支援「同步回傳」與「非同步等待外部系統」兩種模式

**問題脈絡**：`server/internal/clienttools/`（`interaction.go`、`tool.go`）是應用層自己刻的一整套「工具呼叫要等瀏覽器分頁非同步回應」機制。工具的本質有兩類——純函式式的同步計算（如 `parsetime`、`geocode`）和必須把控制權交給外部系統再等它回呼的（如 `trip_entry_add` 要等前端 WS 回應）。**理想樣貌**：want 的工具介面應把這兩類做成一等公民，例如工具可回傳 `Result` 或回傳 `Pending{correlationID}` 讓 runtime 掛起該次推論、待外部 `Resolve(correlationID, payload)` 後續跑。**為什麼重要**：非同步工具是 agent 系統的常態（人在迴路、外部審批、瀏覽器互動），若框架不原生支援，每個專案都得重刻一次 correlation/timeout/清理，且極易漏掉逾時與洩漏。

### 6. 原生能力要「好用到沒人想繞過」——POC 繞過原生 bridge 是框架的警訊

**問題脈絡**：`interaction.go` 的註解坦白 want 已有 `RequestInteraction`/`ResolveInteraction`，但 POC 選擇不用、自己接 WS session。無論原因是語意不合、文件不足還是耦合太緊，結果都是「原生能力形同不存在」。**理想樣貌**：框架的互動原語應該傳輸無關（transport-agnostic）——不預設 HTTP/WS/gRPC，只暴露「掛起、關聯、恢復、逾時」四個語意，讓應用層把自己的傳輸層（WS、SSE、polling）接上去即可，而非要求應用層遷就框架選定的傳輸。**為什麼重要**：當內建能力被繞過，維護者要同時維護「框架的那套」和「自己繞過後的那套」，是最糟的雙重負擔。框架設計的成敗，看的是原生路徑好不好用到讓人不想繞。

### 7. 工具註冊要型別安全、可測試隔離，不靠 `init()` 副作用與字串白名單

**問題脈絡**：`server/internal/wanttools/*.go` 用 `types.RegisterTool` 全域註冊，靠 `func init()` 副作用生效，註冊順序隱含；每個角色（如 assistant）各自維護一份工具名稱字串白名單（`Tools: []string{"trip_entry_add", ...}`），沒有型別安全，打錯字要到執行期才炸。**理想樣貌**：工具註冊應綁在 engine/registry 實例上（`registry.Register(tool)`），角色的工具集用具型別的引用（`[]Tool` 或編譯期常數 handle）而非裸字串；測試可建立乾淨的空 registry 只註冊待測工具。**為什麼重要**：`init()` 全域註冊讓「測試單一工具」必須拖進整包副作用，是 `internal/api` 零測試的結構性原因之一。把 registry 實例化，才有可能做到工具層的隔離測試。

### 8. 完成判定要用確定性信號，不靠 `time.Sleep` 猜文字事件

**問題脈絡**：目前判斷 agent 這輪是否結束用 `time.Sleep(1500ms)` 等文字事件這種啟發式，是非確定性信號——太短會截斷、太長會拖慢每次互動。**理想樣貌**：want 的 orchestrator 應暴露明確的生命週期事件（`RunStarted` / `ToolCalled` / `RunCompleted` / `RunFailed`）或一個會在推論真正結束時 close 的 channel / resolve 的 future，讓呼叫端等一個確定的終止信號。**為什麼重要**：`Sleep` 猜測在正常負載下就已脆弱，一旦上了背壓與佇列，固定睡眠時間會系統性地不準。確定性完成信號是把 agent 執行納入可靠控制流的前提。

---

## 三、跨平台抽象（want ↔ onagent 的中介層）

onagent 的試做觸及一個真問題：`server/tools/onagent-tools.yaml` 本質上是 `server/tools/clienttools.yaml` 同一組工具邏輯的「第二份宣告」，而 `web/src/OnagentBridgeDemo.tsx` 用 onagent 的 AgentBridge SDK 去呼叫既有的 `trip_entry_*` 工具。動機是驗證「同一份工具邏輯能否同時被自家 want 與 onagent 呼叫，不用重寫」。這逼出一個架構抉擇：抽象層該切在哪裡。

### 9. 工具定義需要一份「框架無關（framework-agnostic）」的中介表示（IR）

**問題脈絡**：現在同一組工具存在三處真相——Go 實作（`wanttools/*.go`）、want/前端用的 `clienttools.yaml`、onagent 用的 `onagent-tools.yaml`。三份 schema 手工對齊，任何欄位改動都要同步三次，極易漂移。**理想樣貌**：以一份中立的工具描述（名稱、參數 schema、回傳 schema、副作用宣告、權限需求）作為單一真相來源，再由轉譯器（adapter）分別產生 want 的 registry 註冊與 onagent 的 YAML，前端型別也從同一份生成。**為什麼重要**：多份手寫 schema 是典型的「因不一致而失敗」溫床。收斂成一份 IR + 多個轉譯器，是同時對接兩套（未來 N 套）agent 平台而不重寫的唯一可持續解。

### 10. 抽象層要切在「工具邏輯 ↔ 執行環境」之間，而非包住整個引擎

**問題脈絡**：試圖抽象時容易犯的錯是想做一層「同時抽象 want 和 onagent 整個 agent runtime」的大介面，那會既漏抽象又過度耦合。真正穩定的接縫在更下面——工具的**純業務邏輯**（「新增一筆行程條目到某頻道」）與**誰來觸發、結果送去哪**（want 的 orchestrator / onagent 的 AgentBridge / 未來的 CLI）是可分離的。**理想樣貌**：工具實作只依賴一個最小的 port 介面（拿到 tenant/channel context、讀寫 store、回傳結果或掛起），want adapter 與 onagent adapter 各自把自家 runtime 適配到這個 port。**為什麼重要**：把接縫切在正確的高度，才能讓 `OnagentBridgeDemo.tsx` 這種「換一個 runtime 呼叫同一組工具」從 POC 變成常態，而不是每接一個平台就複製一份工具邏輯。

### 11. context 傳遞與權限邊界要是 IR 的一部分，不是各平台各自實作

**問題脈絡**：channelID 不進 prompt、由伺服器端注入這件事，在 want 這邊靠 `SetSessionEnvs` + `ChannelFrom(ctx)` 落實。若 onagent 那套沒有等價機制，「同一組工具在 onagent 上跑」時這條安全邊界可能默默消失。**理想樣貌**：IR 應把「哪些參數是 server-injected、不可由 agent/prompt 提供」宣告成工具契約的一部分（例如標記 `channelID` 為 `injected: true`），任何 adapter 都必須尊重；權限需求（這工具需要哪個 scope）同理。**為什麼重要**：安全邊界若只在其中一個 runtime 實作，跨平台就會出現「同一工具在 A 平台安全、在 B 平台可被 prompt injection 操縱」的不對稱漏洞。把邊界寫進契約，才能保證每個轉譯目標都繼承它。

---

## 四、安全邊界作為框架原語（Security Boundaries as Primitives）

### 12. server-injected context 應是框架原生的「不可信輸入隔離」原語

**問題脈絡**：channelID 經 `SetSessionEnvs` 注入、經 `ChannelFrom(ctx)` 取用、且明確不組進送給 LLM 的 prompt（`sink.go` 的 `ChannelFrom` 註解特別強調這點）——這是全專案「做對了」的安全設計：即使 prompt injection 成功，LLM 也無法跨頻道操作資料。但它目前是應用層的自律，不是框架的保證。**理想樣貌**：want 應提供明確區分的兩種輸入通道——「可信的 server context」（工具可讀、絕不進 prompt、agent 無法覆寫）與「不可信的 model-provided 參數」（來自 LLM 輸出、需驗證）。工具簽章在型別上就分開這兩者。**為什麼重要**：prompt injection 是 LLM 應用的頭號威脅類別。把「哪些資料 agent 碰不到」做成框架原語，等於讓每個工具預設就有正確的信任邊界，而不是指望每位開發者都記得別把 channelID 塞進 prompt。

### 13. 權限與能力（capability）應可宣告、可審計

**問題脈絡**：角色能用哪些工具，現在是散落在各角色定義裡的字串陣列白名單，沒有集中視圖，也無法回答「哪些工具能寫資料庫」「匿名公開連結的 agent 能碰哪些工具」這類安全問題。**理想樣貌**：框架應支援以 capability 標註工具（read-only / mutating / calls-external / requires-auth），並讓 session 帶著一組 granted capabilities，runtime 在呼叫前強制檢查。**為什麼重要**：對一個有「免登入公開分享」的產品，「匿名 session 只能拿到 read-only capability」必須是框架擋得住的硬約束，而非靠人工維護每個角色的字串白名單不出錯。

---

## 五、可觀測性（Observability）

Tripace 目前完全沒有 metrics / tracing，LLM provider 錯誤只 `fmt.Printf` 到 stdout。對一個核心價值就是「跑 LLM agent」的系統，這意味著線上出問題時幾乎是盲飛。

### 14. 框架應原生提供 OpenTelemetry hook 點

**問題脈絡**：目前對「一次 agent 推論花了多久、呼叫了哪些工具、每個工具耗時、LLM token 用量、失敗率」一無所知，錯誤處理停留在 `fmt.Printf`。**理想樣貌**：want engine / orchestrator / 每次工具呼叫都應圍上 OTel span，並暴露標準 metrics（推論延遲、工具延遲、token 計數、錯誤計數、佇列深度），透過 context 傳遞 trace。應用層只需接一個 exporter 就能拿到端到端追蹤。**為什麼重要**：agent 系統的延遲與成本是複合的（LLM 往返 × 多輪工具呼叫），沒有 per-span 追蹤根本無法定位「這次為什麼慢/貴」。把 instrumentation 做進框架，好過事後在每個呼叫點手工補打點（那必然打不全）。

### 15. 結構化事件流應是可訂閱的第一類輸出，取代 stdout 列印

**問題脈絡**：完成判定靠等文字事件、錯誤靠 `fmt.Printf`，兩者都把「事件」當成非結構化的副產物。**理想樣貌**：orchestrator 的生命週期與工具事件應以結構化事件流（typed events）發布，可同時被三種消費者訂閱——完成判定（取代 `Sleep`）、可觀測性 exporter、以及前端即時 UI（取代目前各種 `Notify*` 廣播函式）。**為什麼重要**：現在 `sink.go` 裡一大堆 `BindNotify` / `NotifyAskChoice` / `NotifyEntriesLoaded` 等綁定函式，本質上都是在手工重建一個事件匯流排。若框架本身就有結構化事件流，這些 binding 大多可以由「訂閱框架事件」取代，UI、監控、控制流三者共用同一份真相。

### 16. LLM provider 呼叫需要框架級的 retry / fallback / circuit breaker

**問題脈絡**：目前無 retry、無 fallback、無 circuit breaker，provider 出錯就只是印一行 log。LLM API 的暫時性錯誤（429、5xx、逾時）是常態而非例外。**理想樣貌**：want 應在 provider 層內建可設定的重試（含 backoff 與 jitter）、多 provider fallback（主模型掛了退到備援）、以及斷路器（連續失敗時快速失敗、避免雪崩），並把這些狀態透過 metrics 暴露。**為什麼重要**：把韌性做進框架的 provider 層，是唯一能保證「每一條 LLM 呼叫路徑」都受保護的方式；靠應用層在每個呼叫點自己包 retry，必然有遺漏，而遺漏處就是線上事故的起點。

---

## 六、版本演進與供應鏈（Versioning & Supply Chain）

### 17. 私有極早期版本需要明確的穩定性承諾與遷移路徑

**問題脈絡**：`server/go.mod` 把 want 鎖在 `v0.0.2`，需要私有 `GH_PAT` 才能拉取，且無 dependabot。`v0.0.x` 依語意化版本代表「沒有任何相容性承諾」，被 26 個 `internal` 檔案深度依賴的核心引擎停在這個版本號，是實打實的供應鏈風險。**理想樣貌**：want 應盡快切到有 SemVer 承諾的 `v0.x`（至少宣告 minor 內相容）乃至 `v1`，公開 CHANGELOG 與破壞性變更遷移指南；發布 artifact 到可存取的 registry，降低對單一 `GH_PAT` 的依賴。**為什麼重要**：一個沒有相容性承諾、只能靠個人 token 拉取的私有依賴，等於把整個產品的核心引擎綁在單點風險上——維護者離開、token 失效、或一次無預警的 breaking change，都可能讓專案無法建置。

### 18. 引擎與工具契約要有版本協商，避免 IR 漂移導致靜默失效

**問題脈絡**：一旦引入前述的工具 IR（建議 9），會出現「IR 版本 vs want 版本 vs onagent 平台期望版本」三方演進的問題。**理想樣貌**：工具契約（IR）本身要帶 schema 版本，adapter 在啟動時做相容性檢查，不相容時 fail fast 並給出清楚訊息，而非在執行期用一個欄位對不上的工具靜默失敗。**為什麼重要**：跨系統整合最陰險的失效模式是「schema 悄悄漂移、直到某個工具在生產環境回傳垃圾才被發現」。把版本協商前置到啟動期，是把這類問題從「線上事故」降級為「部署時就擋下」。

---

## 七、測試策略與依賴注入（Testability）

`internal/api` 目前完全零測試，這不是紀律問題，而是被架構逼出來的——全域單例引擎、`init()` 全域工具註冊、`sink.go` 的 package-level 狀態，三者疊加讓「建立一個乾淨、隔離、可控的被測環境」在現有框架下幾乎不可能。

### 19. 框架介面應對 test double / DI 友善

**問題脈絡**：想測 `internal/api` 的 handler，就得起一個真的 want analyzer（全域單例）、拖進所有 `init()` 註冊的工具、還要面對 `sink.go` 那組全域狀態的殘留污染，測試之間無法隔離。**理想樣貌**：want 的核心互動應以介面（interface）暴露——`Engine`、`Orchestrator`、`Provider`、`Registry` 都能被替身取代；提供官方的 fake/mock（例如 `wanttest.NewFakeEngine()`、可腳本化回應的 fake provider），讓應用層不必打真的 LLM 就能測完整流程。**為什麼重要**：`internal/api` 零測試的根因是「沒有便宜的方式建立被測環境」。框架若原生提供 DI 接縫與測試替身，等於把測試從「昂貴到不寫」變成「便宜到值得寫」，這是撬動測試覆蓋率的支點。

### 20. request-scoped 狀態實例化後，工具可獨立單元測試

**問題脈絡**：現在要測 `record_entry` 這類工具，得先 `RecordLock()`、跑完再讀 `EmitCount()` / `EmittedIDs()` 這些全域讀取器，測試彼此透過全域狀態耦合，無法並行。**理想樣貌**：一旦 per-request 收集器實例化（建議 4），每個工具測試自帶獨立的 context 與結果收集器，斷言直接讀該次執行的回傳值，測試之間零共享狀態、可安全並行。**為什麼重要**：這與建議 4 是一體兩面——把全域狀態實例化，同時解鎖了「生產環境的並行」與「測試環境的隔離」。兩個看似不同的痛點，其實是同一個架構缺陷的兩張臉。

---

## 八、部署與多環境（Deployment & Multi-Environment）

### 21. 框架應支援與部署環境對齊的租戶/環境隔離

**問題脈絡**：Tripace 目前只有單一 prod 環境（無 dev/staging 分離），部署在 GCP Cloud Run。當未來要拆出 staging、或做 A/B 測試不同模型、或按環境切換 provider 時，全域單例引擎完全沒有這個彈性——整個 process 只有一組配置。**理想樣貌**：engine 實例化（建議 1）自然帶來這個能力——不同環境/租戶可持有不同配置的 engine（不同 provider、不同工具集、不同配額），甚至同一 process 內並存以支援藍綠或影子流量。**為什麼重要**：從「單一全域引擎」到「可實例化引擎」的改造，不只解決並行，也一併解決了「配置無法按環境/租戶分化」的問題。這讓框架能長到支撐 dev/staging/prod 分離與漸進式發布，而不是永遠卡在單一 prod。

### 22. 無狀態化以契合 Cloud Run 的水平擴展與冷啟動

**問題脈絡**：Cloud Run 會水平擴展多個實例、會冷啟動、會回收閒置實例。目前 `sink.go` 的 package-level 狀態與全域單例都假設「單一長生命週期 process」，這與 Cloud Run 的執行模型是衝突的——一旦擴到多實例，那些「本次流程」全域狀態在跨實例時毫無意義，非同步互動（clienttools 等待前端回呼）也可能落在不同實例上。**理想樣貌**：框架應把 session/互動狀態設計成可外部化（externalizable，例如可序列化到 Redis/DB），使任一實例都能恢復任一 session 的掛起互動；engine 啟動要輕、以配合冷啟動。**為什麼重要**：一個綁死「單一常駐 process」假設的框架，在 Cloud Run 上要嘛只能跑單實例（放棄水平擴展、回到並行天花板），要嘛在多實例下出現難以重現的狀態錯亂。把狀態外部化，才能讓 agent 系統真正吃到 serverless 的彈性。

---

## 綜合觀察：一條主線串起所有建議

回頭看，上述 22 點大多可以收斂到**同一個根因**——want 的全域單例設計。它像一顆投進水面的石頭，漣漪擴散成了每一個具體症狀：

- 因為引擎是全域單例 → `want_pool.go` 的 per-session 容器只能是註解（建議 1、2）
- 因為只有一個 analyzer → 「本次請求結果」只好用 `sink.go` 的 13 個全域變數裝、用 `recordMu` 序列化（建議 4、20）
- 因為狀態是全域的 → `internal/api` 無法建立隔離的被測環境（建議 19）
- 因為假設單一常駐 process → 與 Cloud Run 的水平擴展/冷啟動模型衝突（建議 21、22）

因此若要排優先序，**「把 want engine 從全域單例改為可實例化」是撬動一切的那根槓桿**——它一旦成立，per-request 並行、request-scoped 狀態、測試隔離、多環境配置、水平擴展會像骨牌一樣依次解鎖。

第二條主線是**「把應用層的自律升格為框架的保證」**：channelID 不進 prompt（建議 12）、非同步工具互動（建議 5、6）、工具契約與安全邊界（建議 9、11、13）、可觀測性打點（建議 14、15）——這些 Tripace 現在全靠開發者「記得做對」。好的框架不該要求每個人每次都記得，而應該讓做錯這件事在型別上就不可能、或在啟動時就被擋下。

第三條主線是**供應鏈與演進的成熟度**（建議 17、18）：一個被 26 個檔案深度依賴、卻停在 `v0.0.2`、需要個人 token 才能拉取的核心引擎，是整個產品韌性的單點風險。在追求上述所有能力之前，先讓 want 有一個可被信任地依賴、可被安全地升級的版本承諾，是所有其他改進能站得住的地基。
