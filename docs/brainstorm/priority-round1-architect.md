# 立即處理候選清單 —— 系統架構師視角

> 第一輪腦力激盪,系統架構師角色的候選清單。聚焦兩條主線:(1) 觀測用戶狀態與系統健康、(2) 確保核心流程(記事 → AI 整理 → 存檔 → 顯示)穩定不靜默失敗。
> 之後會與後端工程師、測試專家的清單合併去重、排序成最終 10 項,故此處寧可多提。
>
> 架構師的判準:優先挑出**結構性缺口**(不處理會讓同一類問題在不同地方反覆出現)、以及**該一次鋪對地基的止血**(避免之後重做);並從「單一 prod、無 staging、push main 直接上線」的部署現實出發,把「上線後唯一能看到問題的手段」擺到最前面。

---

## 開場:三個貫穿全清單的結構性判斷

在逐項之前,先講清楚三個「為什麼這樣排」的原則,因為下面很多項其實是同一個地基的不同面向:

1. **沒有 request-scoped context 這條主幹,是所有觀測/穩定性問題的共同上游。** 目前 store 層不吃 `context.Context`、logging 沒有 request/trace ID、LLM 逾時各自 `time.After(90s)` 硬編碼、取消訊號無法從 HTTP 層貫穿到 DB 與 LLM。這些看似獨立的缺口,根因是同一個:**沒有一條 context 從 handler 入口一路帶到最底層**。因此「補 logging」「補逾時」「補取消」不該各做各的,應該先把 context 主幹鋪起來,再讓觀測、逾時、取消都掛在同一條線上。這是本清單第一序位的地基。

2. **在單一 prod、push main 直接 100% 切換的現實下,可觀測性不是「nice to have」,是唯一的事後偵測手段。** 沒有 staging 攔截,任何壞掉都只會在正式使用者身上發生;沒有結構化 log + 錯誤追蹤 + /health 真檢查 + alerting,壞了也是「事後才發現」——commit `dba5145`(環境變數漏設導致健康檢查失效)已經是一次血的教訓。所以觀測性的地基項(結構化 logging、/health 真檢查、錯誤上報、alerting)在架構師眼中與穩定性同等優先,而非其次。

3. **全域單例/全域可變狀態是核心瓶頸,但「立即處理」的切入點不是拆單例,而是先在其外圍上護欄。** `want` 引擎單例 + `sink.go` 13 個全域變數靠單一 `recordMu` 序列化——真正的解法是把 request-scoped 狀態改成 context-carried struct,但那是高風險大改。在「立即」範圍內,低風險的止血是:給這個序列化點**加上可觀測性(排隊深度、等待時長、逾時計數)+ 明確的排隊上限與快速失敗**,先讓它從「靜默排隊 90 秒後逾時」變成「可觀測、可預期、對匿名濫用有上限」,再談拆解。護欄先行,重構後補。

---

## A. 地基型結構項(先鋪對,後續才不用重做)

### A1. 建立貫穿全流程的 request context 主幹(logging / 逾時 / 取消的共同地基)

- **為什麼是立即優先且屬於結構性問題**:目前 `internal/store/*` 完全不吃 `context.Context`,`http.ListenAndServe`(`cmd/server/main.go:213`)沒有逾時,LLM 逾時是各自寫死的 `time.After(90 * time.Second)`(`want_analyzer.go:108,215,310`)。沒有一條 context 主幹,觀測(request ID)、逾時、取消三件事只能各自為政,而且每加一個新端點就要再手刻一次。這是「同一類問題反覆出現」的典型結構性缺口。
- **地基做法 vs 純止血**:止血 = 在個別 handler 塞 `context.WithTimeout` 應急。地基 = 一次把 `store` 方法簽章加上 `ctx context.Context`(哪怕內部暫時只用來傳 request ID、還沒接 DB 取消),並在 handler 入口用 middleware 生成帶 request ID 的 context 往下傳。這條主幹一旦在,A2 的 request ID、A5 的逾時、後續的 DB 取消全都是「掛上去」而非「重鋪」。
- **工作量**:store 簽章改動面大 → **L**(但可分批:先鋪 middleware + context 生成的 **S** 部分,store 逐檔跟進)。**前置依賴**:無,是其他多項的前置。

### A2. 一次到位上結構化 logging + request ID 貫穿全流程(而非多印幾行)

- **為什麼是立即優先且屬於結構性問題**:現況只有 `log.Printf`,無 level、無結構化、無 request ID;`logging` middleware(`middleware.go:11-17`)只印 method/path/duration,**不印 status code、不印錯誤**;LLM 錯誤走 `fmt.Printf`(`want_analyzer.go:48-49,216,311`)完全繞過 log 系統。在單一 prod 下,log 是上線後第一線的偵測手段,現在這條線幾乎是瞎的。
- **地基做法 vs 純止血**:止血 = 在 middleware 多印一個 status code。地基 = 換成 `log/slog`(Go 內建,零新依賴),定義統一欄位(request ID、method、path、status、latency、user/channel、error),把 `fmt.Printf` 的 LLM 錯誤收進同一套 handler,並讓 request ID 從 A1 的 context 帶出。**一次做對的關鍵是「request ID 貫穿」**——否則之後為了串接 trace 又要全部重改。
- **工作量**:**M**。**前置依賴**:A1(request ID 的來源);可與 A1 同批做。

### A3. 把 /health 改成真的健康檢查(DB ping + MigrationOK),並接上 Cloud Run probe

- **為什麼是立即優先且屬於結構性問題**:`handleHealth`(`api.go:174-176`)硬回 `{"status":"ok"}`,不碰 DB、不回報 `MigrationOK`。Cloud Run liveness 會據此誤判「健康」,而 `AutoMigrate` 失敗時服務其實是降級啟動(`store.go:65-66`,失敗只 log 不中止)。**這正是 commit `dba5145` 事故的結構性根因**:健康端點寫了卻沒反映真實健康,也沒人真的拿它當 probe。在無 staging 的環境,這是「上線後能不能自動發現壞掉」的分水嶺。
- **地基做法 vs 純止血**:止血 = /health 加一句 `db.Ping()`。地基 = 區分 **liveness(process 活著)** 與 **readiness(DB 通、migration OK、關鍵依賴就緒)** 兩個端點,readiness 納入 `MigrationOK` 與 DB ping,並在 Cloud Run deploy 與 Dockerfile 實際掛上 startup/liveness/readiness probe——健康端點寫了必須有人用,否則等於沒寫。
- **工作量**:端點本身 **S**;接 Cloud Run probe 設定 **S**。**前置依賴**:無(可獨立、優先做,CP 值最高的止血之一)。

### A4. 收斂 API 錯誤格式為單一 schema + 定義 domain error type

- **為什麼是立即優先且屬於結構性問題**:目前錯誤格式至少三種並存(`writeErr` 的巢狀 `{"error":{"code","message"}}` vs `http.Error` 的扁平 text/plain),且無統一 domain error type 可區分 400/403/404/500。這對觀測是直接傷害:**log 與 error tracking 無法可靠地按錯誤類型聚合**,前端也無法統一攔截(例如 401 過期)。錯誤處理沒有統一型別,是「每個 handler 各自發明」的結構性缺口,會一路污染觀測與前端。
- **地基做法 vs 純止血**:止血 = 把最刺眼的 `http.Error` 改成 `writeErr`。地基 = 定義 `AppError{Code, HTTPStatus, Message, Cause}` domain error type,所有 handler 回這一種,middleware 統一序列化並記 log(順帶解決「`err.Error()` 把 GORM/SQL 原文洩漏給客戶端」的安全問題)。這一步做對,A2 的錯誤 log、A7 的錯誤上報都能按 code 聚合。
- **工作量**:**M**(handler 面廣但機械)。**前置依賴**:與 A2 互補(統一錯誤 → 統一 log)。

---

## B. 核心流程穩定性(止血,但選對地基)

### B1. 加 panic recovery middleware(單一 goroutine panic 現在會整個 process 崩)

- **為什麼是立即優先且屬於結構性問題**:全 repo `recover()` 零命中。任一 HTTP handler 或 WS goroutine panic,整個 Cloud Run 實例崩潰、所有連線中斷。核心流程(記事 → 整理 → 存檔)橫跨多個 goroutine,任何一個沒守住都會拖垮全體。這是「一個點壞 → 全站壞」的結構性脆弱,且在無 staging 下,第一次遇到就是 prod 事故。
- **地基做法 vs 純止血**:止血 = 只在 HTTP middleware 包一層 recover。地基 = HTTP middleware **加上** WS / clienttools / LLM 背景 goroutine 都各自有 recover,並且 recover 後**把 panic 當作結構化錯誤上報(接 A2/A7)**,而非只印 stack——否則 panic 被吞掉反而更難查。recover 的落點要覆蓋所有「自己開 goroutine」的地方。
- **工作量**:HTTP 層 **S**;涵蓋所有背景 goroutine **M**。**前置依賴**:配合 A2(panic 進結構化 log)。

### B2. 補 http.Server 逾時 + graceful shutdown

- **為什麼是立即優先且屬於結構性問題**:`http.ListenAndServe`(`main.go:213`)無 `ReadTimeout`/`WriteTimeout`/`IdleTimeout`(slowloris 風險 + 慢連線佔死資源),也無 graceful shutdown——Cloud Run 換 revision(每次 push main 都會)時,進行中的請求會被硬切,核心流程可能在「存檔一半」被砍。這與部署現實(頻繁 100% 切換)直接衝突。
- **地基做法 vs 純止血**:止血 = 塞幾個 timeout 常數。地基 = 換成顯式 `http.Server{}` 設好各 timeout,並實作 signal handling + `srv.Shutdown(ctx)`,讓換 revision 時進行中請求能收尾。這也是 A1 context 主幹的自然落點(shutdown context)。
- **工作量**:**S**。**前置依賴**:無;與 A1 協同最佳。

### B3. LLM 呼叫加 retry(指數退避)+ 明確 fallback,錯誤收進 log 系統

- **為什麼是立即優先且屬於結構性問題**:LLM 是核心流程的中樞,但 provider 5xx/逾時**無重試、無降級**,`orch.OnError` 只 `fmt.Printf`(`want_analyzer.go:48-49`)。一次瞬斷就讓使用者的記事靜默失敗——這正是任務要防的「核心流程突然壞掉或靜默失敗」。錯誤還繞過 log 系統,連事後都難查。
- **地基做法 vs 純止血**:止血 = 包一層 for 迴圈重試。地基 = retry 用帶 context 的指數退避(掛在 A1 context 上,可被逾時/取消打斷)、區分可重試(5xx/逾時)與不可重試(4xx)、失敗時回**明確的 fallback 訊息給使用者**(而非靜默或吐原始錯誤)、並把每次重試/失敗記進 A2 的結構化 log 附 request ID。
- **工作量**:**M**。**前置依賴**:A1(context 傳遞)、A2(錯誤 log)。

### B4. 取代 LLM 完成判定的 sleep(1500ms) 啟發式(可能截斷回應)

- **為什麼是立即優先且屬於結構性問題**:完成判定靠收到 `idle` 後 `time.Sleep(1500ms)` 等文字事件(`want_analyzer.go:93,205,300`),這是 race-prone 啟發式——回應慢一點就被截斷,使用者看到半截整理結果。這是「核心流程靜默產出錯誤結果」的典型,比崩潰更難察覺(不會報錯,只是內容不對)。
- **地基做法 vs 純止血**:止血 = 把 1500ms 調大(治標,反而拖慢正常情況)。地基 = 改用確定性完成信號。**架構關鍵事實**:`want v0.0.2` 其實已內建 `RequestInteraction`/`ResolveInteraction`,而 clienttools 卻另刻了一套 `pendingCalls` 非同步回應機制;完成判定同理應改用 want 內建的確定性事件,而非自刻 sleep。這一步順帶指向「回收自刻機制、改用 want 內建」的方向。
- **工作量**:**M**(需摸清 want 的完成事件語意)。**前置依賴**:需確認 want v0.0.2 的完成/事件 API。

### B5. 設定 DB connection pool(SetMaxOpenConns 等)

- **為什麼是立即優先且屬於結構性問題**:無 `SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime`,預設 unlimited。Cloud SQL 有連線上限,一旦流量或慢查詢堆積,連線數會打爆 Cloud SQL、讓**全站 DB 存取失敗**——核心流程的存檔/顯示同時掛掉。這是一個小設定卻是系統級單點。
- **地基做法 vs 純止血**:止血 = 隨手設幾個數字。地基 = 依 Cloud SQL 實際上限與 Cloud Run 最大實例數反推每實例的合理連線上限,設好三個參數,並把連線池使用率納入 metrics(B7/A2)以便日後調參。
- **工作量**:**S**。**前置依賴**:無(可立即做)。

### B6. AutoMigrate 失敗改為中止啟動(fail-fast,而非降級)

- **為什麼是立即優先且屬於結構性問題**:`store.go:65-66` migration 失敗只設 `MigrationOK=false` 並繼續啟動。結果是「服務看似健康、實則 schema 不一致」,核心流程會在某個欄位對不上時靜默出錯——這是最難查的一類事故,且在無 staging 下第一次遇到就在 prod。
- **地基做法 vs 純止血**:止血 = 直接 `log.Fatal`。地基 = fail-fast **但要搭配 A3 的 readiness 端點**——啟動失敗要能被 Cloud Run 的 startup probe 正確識別為「未就緒」而不導流,而非讓實例反覆崩潰重啟卻仍被誤判健康。fail-fast 與健康檢查是一體兩面,分開做會出事。
- **工作量**:**S**。**前置依賴**:A3(否則 fail-fast 後 Cloud Run 行為不受控);與資料庫版本化 migration(更大的工程)脫鉤,此項只改「失敗時的行為」。

### B7. 為全域序列化點加護欄:排隊上限 + 快速失敗 + 排隊觀測(單例瓶頸的低風險切入點)

- **為什麼是立即優先且屬於結構性問題**:`want` 全域單例(`want_pool.go` 的 `For()` 忽略 sessionID 一律回 `shared`)+ `sink.go` 13 個全域變數靠單一 `recordMu`(`RecordLock/RecordUnlock`),讓**全站 LLM 請求被序列化**:第二個使用者排隊等前一個跑完、上限硬編碼 90 秒。這既是效能天花板,也是現成的 DoS 面(一條匿名公開連結就能阻塞全站)。完整解法(改 request-scoped struct)是高風險大改,但**放著不管等於接受單點阻塞 + 無上限排隊**。
- **地基做法 vs 純止血**:純止血 = 把 90 秒調小。**低風險地基** = 在序列化點外圍加護欄:(1) 明確的排隊上限(超過 N 個等待者直接快速失敗回「系統忙碌」,而非無限排隊);(2) 可設定的 acquire 逾時取代硬編碼 90 秒;(3) **把排隊深度、平均等待時長、逾時/拒絕次數做成 metrics**,讓這個天花板從「不可見」變「可觀測」。這樣不動核心重構就先止住 DoS 與靜默排隊,也為日後拆單例(`want_pool.go` 已鋪好 per-session 骨架)提供數據依據。
- **工作量**:護欄 + 觀測 **M**(不含拆單例)。**前置依賴**:A2/B10(metrics 落點);與後端工程師的「拆全域狀態」清單需對齊(此項是其前置的緩解層,不是替代)。

---

## C. 觀測性補完(上線後唯一的眼睛)

### C1. 接錯誤追蹤(GCP Error Reporting 或 Sentry)

- **為什麼是立即優先且屬於結構性問題**:目前無任何 error tracking,錯誤散在 stdout log 裡、且 LLM 錯誤還走 `fmt.Printf`。在單一 prod 下,沒有主動聚合的錯誤流,就只能靠使用者回報或事後翻 log。這是「上線後能不能主動知道壞了」的核心觀測能力,不是進階功能。
- **地基做法 vs 純止血**:止血 = 手動去 Cloud Logging 撈。地基 = 統一錯誤出口(接 A4 的 domain error type + B1 的 panic recover)一律上報,附 request ID / user / channel context,讓一次事故能一鍵看到相關軌跡。GCP Error Reporting 幾乎零成本接入(已在 GCP),優先於 Sentry。
- **工作量**:**M**。**前置依賴**:A2(結構化 log)、A4(統一錯誤)、B1(panic 上報)——這也是為什麼 A2/A4/B1 要先鋪。

### C2. 設 uptime check + alerting(至少 5xx 率與 /health 失敗)

- **為什麼是立即優先且屬於結構性問題**:無 uptime 監控、無 alerting。commit `dba5145` 的事故本質就是「壞了但沒有任何東西主動告警,事後才發現」。在 push main 直接上線的節奏下,沒有 alerting = 每次部署都是盲跳。這是把「事後才發現」變成「壞了立刻知道」的關鍵一環。
- **地基做法 vs 純止血**:止血 = 設一個 ping /health 的 uptime check。地基 = 基於 A3 的**真** readiness 端點設 uptime check,再加 Cloud Monitoring alert policy(5xx 率、readiness 失敗、latency p99),告警落到實際會被看到的管道。alert 建立在「/health 說真話」的前提上,所以 A3 是其前置。
- **工作量**:**S**(GCP 內設定)。**前置依賴**:A3(健康端點要先說真話)。

### C3. 加核心流程的基礎 metrics(LLM 延遲/成功率、序列化排隊、各端點 QPS/p99)

- **為什麼是立即優先且屬於結構性問題**:完全無 metrics,LLM 延遲、成功率、工具執行、序列化排隊深度全不可見。任務第一優先是「觀測用戶當下在系統裡發生什麼」——沒有 metrics,連「現在有幾個人在跑 LLM、排隊多深、多少失敗」都答不出來。這是觀測用戶狀態的骨幹,也是 B7 護欄與日後拆單例的決策數據來源。
- **地基做法 vs 純止血**:止血 = 印幾個計數到 log。地基 = 上 Prometheus/OTel client(至少 counter/histogram),優先埋核心流程四個點:LLM 呼叫延遲與成功率、序列化 acquire 等待時長與拒絕數(對接 B7)、各端點 QPS 與 p99、DB 連線池使用率(對接 B5)。metrics 命名與 label 一次定好(附 request context),避免之後重埋。
- **工作量**:**M**(選型 + 埋點)。**前置依賴**:A1(context 提供 label 來源);與 B7/B5 的觀測需求合流。

---

## D. 部署與供應鏈的立即護欄(讓上線本身不變成事故源)

### D1. 部署後加 smoke test,失敗即快速止損(對抗 push main 直接 100% 切換)

- **為什麼是立即優先且屬於結構性問題**:push main 直接 100% 切換、無 smoke test、無自動 rollback。這意味著任何壞掉的部署會立刻打到全體使用者,而第一個發現的往往是使用者。在無 staging 的前提下,**部署後 smoke test 是唯一能在「全量受影響」前攔一道的機制**。
- **地基做法 vs 純止血**:止血 = 部署後手動打一下首頁。地基 = deploy workflow 尾段自動打幾個關鍵端點(readiness、一條 assist happy path),失敗就標記部署失敗/阻止導流;理想再進一步是 `--no-traffic` 起新 revision → smoke test 過再導流,但**即使先只做「失敗告警」也已是從零到一的關鍵護欄**。
- **工作量**:基本 smoke test **S**;接 `--no-traffic` 逐步導流 **M**。**前置依賴**:A3(readiness 端點)。

### D2. 消除 GH_PAT 單點失效(want v0.0.2 私有套件拉取)

- **為什麼是立即優先且屬於結構性問題**:`want` 是 v0.0.2 私有套件、需 `GH_PAT` 拉取,**PAT 過期則所有部署立即中斷**——這是一個會讓「連緊急修復都推不上去」的單點失效,且與 `--build-arg` 傳入還會把 PAT 留在 image history(安全問題)。在單一 prod 下,部署管道本身斷掉是最壞的一類故障。
- **地基做法 vs 純止血**:止血 = 續期 PAT。地基 = (1) PAT 過期本身要有 alerting(否則又是「事後才發現」);(2) 改用 BuildKit secret mount 而非 `--build-arg`,避免留痕;(3) 中期評估 vendor/fork want 以降低對私有拉取的硬依賴。至少第 (1) 項屬「立即」——把單點失效變成可預警。
- **工作量**:PAT 告警 + secret mount **S**;vendor/fork 評估 **L**(非立即)。**前置依賴**:與 C2 的 alerting 機制共用。

---

## 附:與另兩位清單對照時的架構師立場備註

- **序位主張**:`A1(context 主幹)→ A2/A3(結構化 log + 真健康檢查)→ B1/B2(panic/timeout/shutdown)` 是不可讓步的地基前四拍;C1/C2/C3(錯誤追蹤/alerting/metrics)必須排在多數功能性穩定項之前,因為它們是「上線後唯一的眼睛」。
- **與後端工程師預期重疊**:B3/B4/B5/B6/B7 很可能與後端清單重疊——架構師視角的差異在於**強調它們的地基掛點**(retry 掛 context、fail-fast 掛 readiness、序列化護欄掛 metrics),避免各自止血後又要重接。
- **與測試專家預期重疊**:D1 smoke test、B4 完成判定的確定性化,會與測試清單交界;架構師立場是這兩項的價值在「無 staging 下的事後偵測與確定性」,而非測試覆蓋率本身。
- **刻意排除於「立即」之外**:拆 `want` 單例為 request-scoped(高風險重構)、版本化 migration 工具、回收 clienttools 自刻機制改用 want 內建——這些是正確終局,但本輪只放它們的**低風險緩解層**(B7 護欄、B6 只改失敗行為、B4 指出方向),避免把「立即」變成「大重構」。
