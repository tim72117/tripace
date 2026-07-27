# 立即處理候選清單 —— 後端工程師視角

第一輪腦力激盪，只出我這個角色的候選清單，之後會跟架構師、測試專家對照去重。範圍聚焦兩條主線：**(A) 觀測用戶狀態／系統健康**、**(B) 核心流程穩定性（記事→AI 整理→存檔→顯示不能靜默壞掉）**。

排序原則：投報比高、立即止血優先，不是完美架構。工作量標記 S（<0.5 天）/ M（0.5–2 天）/ L（>2 天）。

已核對過現況的具體證據（不是猜的）：
- `internal/api/api.go:174` `handleHealth` 直接回 `{"status":"ok"}`，完全不碰 DB。
- `internal/api/middleware.go:16` logging 只印 `method path duration`，**沒有 status code、沒有 error**。
- `cmd/server/main.go:213` 用裸 `http.ListenAndServe(...)`，沒有 `http.Server{}`，四個 binary（server/adminserver/mockllm/agentbench）全都這樣 → 無 timeout、無 graceful shutdown。
- `internal/wanttools/sink.go:99` `recordMu sync.Mutex` + 一堆 package-level 全域變數（`emitCount`/`emittedIDs`/`presented`/`recommendedPlaces`...）。
- `internal/llm/clienttools_agent.go:190` 與 `want_analyzer.go` 都是 `go func(){ time.Sleep(1500*time.Millisecond); finish() }()` 靠睡 1.5 秒判定完成。
- LLM 錯誤走 `fmt.Printf("[want] 🔴 Agent Error: %v\n", err)`（`clienttools_agent.go:127`、`want_analyzer.go:49/216/311`），繞過 log。
- 全 repo `recover()` 零命中、`SetMaxOpenConns` 零命中、retry/backoff 零命中。

---

## A. 可觀測性 / 系統健康（先讓自己看得見）

### 1. 把 panic recovery middleware 補上（含 WebSocket goroutine）
- **為什麼立即**：全 repo `recover()` 零命中。任一 handler、任一被 `go` 起來的 WebSocket / sink goroutine panic，就是整個 Cloud Run process 掛掉，**打爆所有使用者**、所有連線一起斷。這不是「觀測」問題，是「一顆髒 input 就能弄死線上」的問題，而且因為 sink 有一堆全域狀態，panic 後狀態可能還殘留。這是全清單投報比最高的一項。
- **做什麼**：一個 recovery middleware 包在最外層 handler chain，`recover()` 後記結構化 error log（帶 stack、request ID）、回 500。**特別注意**：middleware 只保護 HTTP handler goroutine，`sink.go` / `want_analyzer.go` 裡自己 `go func(){...}()` 起的 goroutine 不在 handler stack 上，必須各自包一層 `defer recover()`，否則照樣崩。
- **工作量 / 依賴**：S–M。無前置依賴，可獨立先做。建議跟 #3（結構化 log）一起，這樣 recover 的輸出就直接是結構化的。

### 2. 讓 /health 真的檢查 DB + migration 狀態（liveness/readiness 分開）
- **為什麼立即**：現在 `handleHealth` 回死字串 `ok`，DB 斷線 / Cloud SQL 連不上 / `MigrationOK=false`（schema 不一致）時，Cloud Run 一律看到綠燈，繼續把流量灌進一個實際上壞掉的實例。commit dba5145 那次 adminserver 漏環境變數是**事後**才發現的，就是因為健康檢查騙人。
- **做什麼**：`/health`（readiness）加一個帶 timeout 的 `db.PingContext` 或 `SELECT 1`，並回報 `store.MigrationOK`；DB 不通或 migration 失敗回 503。可另外留一個純 liveness 端點（只證明 process 活著、不查 DB）給 Cloud Run 分開設定，避免 DB 抖一下就被殺整台。順便把 build/commit SHA 一起回，方便確認線上真的是哪版。
- **工作量 / 依賴**：S。`store` 目前不吃 context（見 #12），但 health 這裡可以先用底層 `*sql.DB` 直接 ping，不必等 store 全面 context 化。

### 3. 導入結構化 logging（slog）+ request ID，統一所有輸出管道
- **為什麼立即**：現在是標準庫 `log.Printf`、無 level、無 request ID / trace ID，而且**最關鍵的 LLM 錯誤根本不走 log**（走 `fmt.Printf` 帶 emoji 到 stdout）。在 Cloud Run 上這代表：出事時無法用 severity 過濾、無法把「同一個使用者這一次請求」的多條 log 串起來、無法對 ERROR 設告警。這是「瞎眼飛行」的核心。
- **做什麼**：換成 `log/slog` 輸出 JSON（Cloud Logging 直接吃 JSON 並解析 severity）；一個 middleware 生成 request ID 塞進 `context`，之後所有 log 帶上；把 `fmt.Printf("[want] 🔴 ...")` 那 4 處全部改成 `slog.Error(...)`。定義 `INFO/WARN/ERROR` 使用約定。
- **工作量 / 依賴**：M。無硬依賴，但它是 #1 recover 輸出、#4 logging middleware、#7 LLM 指標的共同基礎，建議排在很前面。

### 4. 修 logging middleware：補上 status code、錯誤、慢請求標記
- **為什麼立即**：`middleware.go:16` 只印 `method path duration`。**線上回了多少 500 我們完全不知道**，只看得到「有個請求跑了 3 秒」但不知道它成功還失敗。這是最基本的 access log 都不完整。
- **做什麼**：包一個 `responseWriter` 攔截 status code；log 出 `method / path / status / duration / request_id / user_id（若有）`；duration 超過門檻（例如 >2s）打 WARN。搭 #3 用 slog 輸出。
- **工作量 / 依賴**：S。依賴 #3（要有 slog 與 request ID 才漂亮），但也可先做、之後升級。

### 5. 補上 LLM 呼叫的核心指標（延遲 / 錯誤率 / token / 逾時次數）
- **為什麼立即**：LLM 是這產品的心臟，也是最貴、最會抖的外部依賴，但現在延遲、token 用量、工具執行次數、錯誤率、逾時次數**全部零觀測**。provider 開始變慢或狂噴 5xx，我們只能等使用者抱怨。也無法知道成本燒在哪。
- **做什麼**：先不用整套 Prometheus/OTel（那是 L）。**最小止血**：在 LLM 呼叫的進出點用 slog 記結構化欄位（provider、model、duration_ms、prompt/completion tokens、tool_calls、outcome=ok/timeout/error），Cloud Logging 就能用 log-based metrics 拉出趨勢與告警。要更正式再上 OTel。
- **工作量 / 依賴**：M（走 log-based）/ L（走 OTel）。依賴 #3。

### 6. 加最基本的 uptime 監控 + 告警（外部探測 + 錯誤日誌告警）
- **為什麼立即**：現在**完全沒有 alerting、沒有 uptime 監控**。服務掛了、health 變紅、ERROR 暴增，第一個發現的是使用者不是我們。只有單一 prod、無 staging，這條防線更不能省。
- **做什麼**：GCP Cloud Monitoring uptime check 打 #2 的 `/health`，掛 alerting policy（連續失敗 → 通知）；再加一條 log-based alert：ERROR severity 在 N 分鐘內超過 M 條就通知。通知先進 email / 一個 webhook 即可。
- **工作量 / 依賴**：S–M（多為 GCP 設定）。依賴 #2（health 要能真實反映健康）與 #3（ERROR 要進得了 log severity）。

### 7. 部署後跑 smoke test，失敗別讓它上（或能快速 rollback）
- **為什麼立即**：現在 push main → Cloud Run 直接 100% 切換，**無 smoke test、無自動 rollback**。像 dba5145 那種「漏一個環境變數整台起不來」的事故，會直接 100% 打到使用者身上，且要人工才發現。
- **做什麼**：CI 部署後對新 revision 打 `/health`（DB 版）+ 一兩個關鍵端點（例如登入、建立頻道）做 smoke check，失敗就不 promote 流量 / 保留舊 revision。Cloud Run 本身支援用 revision + traffic split，先做「失敗不切流量」比做全自動 rollback 划算。
- **工作量 / 依賴**：M。依賴 #2（要有可信的 health）。

---

## B. 核心流程穩定性（記事→AI 整理→存檔→顯示）

### 8. 設定 http.Server 的 timeout（Read/Write/Idle）+ graceful shutdown
- **為什麼立即**：四個 binary 全用裸 `http.ListenAndServe`，`ReadTimeout/WriteTimeout/IdleTimeout` 都沒設 → slowloris 一條慢連線就能吃住資源、連線洩漏、goroutine 越積越多。無 graceful shutdown → Cloud Run 換版 / 縮容時正在處理的請求直接被砍，可能寫一半。
- **做什麼**：改用 `http.Server{}` 明確設三個 timeout（WriteTimeout 要考慮 LLM 長請求，可能要對 LLM 路由放寬或用 per-handler context）；`signal.NotifyContext` 收 SIGTERM 後 `srv.Shutdown(ctx)` 排空連線。**注意**：目前 LLM 請求可長達 90 秒，WriteTimeout 不能設太短把正常回應砍掉，要跟 #10 逾時策略一起想。
- **工作量 / 依賴**：M。跟 #10 有耦合（timeout 數值要一致），建議一起做。

### 9. 拆掉全站 LLM 請求的單一 mutex 序列化（sink 全域狀態）
- **為什麼立即**：`sink.go` 用 `recordMu` 一把鎖 + 一堆 package-level 全域變數保護整個「記錄一則訊息」流程，等於**全站 LLM 請求被序列化**——第二個使用者送訊息要排隊等前一個跑完（上限 90 秒）。這既是效能天花板，也是**現成的 DoS 面**：一個人卡住，全部人卡住。同時全域狀態也讓 #1 的 panic 更危險（狀態污染）。
- **做什麼**：把 sink 的全域狀態改成 per-session / per-channel 的實例狀態（用 struct 持有，隨請求 context 傳遞），移除全域鎖，讓不同使用者的請求能並行。這是本清單裡最偏「重構」的一項，但因為它同時是效能瓶頸 + DoS + panic 風險放大器，值得列入立即。
- **工作量 / 依賴**：L。改動面較大、要小心並發正確性，建議在 #1（recover）與 #3（log）就位、能觀測後再動，並且務必有測試（跟測試專家的清單會重疊）。

### 10. 給 LLM 呼叫加 retry + timeout + 降級，錯誤走 log 不要吞掉
- **為什麼立即**：LLM provider 5xx / 逾時現在**既不重試也不降級**，錯誤只 `fmt.Printf` 就沒了。provider 抖一下，使用者的記事就整理失敗、而且是**靜默失敗**——他不知道發生什麼，我們的 log 也查不到。這直接違反「核心流程不能靜默壞掉」。
- **做什麼**：對可重試錯誤（5xx、逾時、連線）做有上限的指數退避重試；設明確 per-call context timeout；失敗時回一個對使用者可見的明確狀態（「AI 整理暫時失敗，稍後重試」）而非假裝成功或無聲吞掉；錯誤一律 `slog.Error`。降級策略至少要「明確告知失敗 + 保住使用者原始輸入不遺失」。
- **工作量 / 依賴**：M。依賴 #3（錯誤要進 log）。與 #8 的 timeout 數值需一致。

### 11. 換掉 race-prone 的「睡 1.5 秒判定 LLM 完成」啟發式
- **為什麼立即**：`clienttools_agent.go:190` / `want_analyzer.go` 收到 `idle` 後 `time.Sleep(1500ms)` 再 `finish()`，靠猜文字事件會在 1.5 秒內到。這是**時序賭博**：文字晚於 1.5 秒到就被截斷（使用者看到半截的 AI 整理結果），或該完成時多等 → 影響體驗，且在慢環境更容易誤判。核心流程「AI 整理」的正確性直接押在這上面。
- **做什麼**：改成確定性完成信號——若底層事件流有明確的「本輪結束」事件就用它；沒有的話，改成「收到 idle 後等待文字事件流真正 EOF / 明確終止 marker」而非固定睡眠。至少把魔術數字 1500ms 收斂、加上「已收到文字後才提早結束」的條件，降低截斷機率。
- **工作量 / 依賴**：M。需要理解 `want` 引擎事件協議（`internal/protocol`）。建議有 #5 的觀測後更好驗證改動有沒有減少截斷。

### 12. AutoMigrate 失敗要中止啟動（fail fast，別降級成「看似健康」）
- **為什麼立即**：`store.go` 現在 AutoMigrate 失敗只設 `MigrationOK=false` 就繼續起服務。生產會出現 **schema 不一致但服務對外看似健康**的最壞情況：讀寫打到缺欄位的表 → 存檔靜默失敗或 500，而且 health 還是綠的（見 #2）。
- **做什麼**：正式環境（用環境變數判斷）AutoMigrate 失敗直接 `log.Fatal` 不啟動，讓部署明確失敗、觸發 #7 的 smoke fail / #6 的告警，而不是帶病上線。若要保留本機開發的寬容行為，用 flag 區分。此項與 #2 互補：一個讓壞掉的實例「起不來」，一個讓壞掉的實例「被看見」。
- **工作量 / 依賴**：S。可獨立做。跟 #2 一起效果最好。

### 13. 設定 DB connection pool 上限（保護 Cloud SQL）
- **為什麼立即**：`SetMaxOpenConns / SetMaxIdleConns / SetConnMaxLifetime` **全沒設**（零命中）。Cloud Run 會多實例橫向擴，每個實例不限連線數 → Cloud SQL 連線數很容易被打爆，一旦爆掉是**全域性**故障（所有實例都連不上 DB）。這是那種「平常沒事、一放量就崩」的雷。
- **做什麼**：在 `store.Open` 拿到底層 `*sql.DB` 後設合理的 `SetMaxOpenConns`（依 Cloud SQL 方案上限 / 預估實例數反推）、`SetMaxIdleConns`、`SetConnMaxLifetime`（避免 stale 連線）。這是幾行 config，投報比極高。
- **工作量 / 依賴**：S。無依賴，可馬上做。

### 14. 讓 store 層吃 context.Context（慢查詢可逾時/取消）
- **為什麼立即**：`store` 完全不用 `context.Context`，所以慢查詢**無法設逾時、無法取消**。一個慢查詢會一直佔著連線（跟 #13 的連線耗盡互相加乘），且請求端 context 取消了 DB 還在跑。也讓 #2 的 health ping、#8 的 request timeout 無法真正貫穿到 DB 層。
- **做什麼**：store 方法簽章加 `ctx context.Context`，改用 GORM 的 `WithContext(ctx)`；handler 把 request context 傳下去。這是機械式但面積大的改動。可先從最熱 / 最慢的查詢路徑開刀，不必一次全改。
- **工作量 / 依賴**：L（面積大）。是 #8 request timeout 真正生效的前提之一，但可漸進做。

### 15. 關鍵多步驟寫入包進單一交易（entry + trip 歸組 + message 關聯）
- **為什麼立即**：記事存檔目前是 entry 寫入、trip 歸組、message 關聯**分開寫、不在同一交易**。中途失敗（LLM 那段本來就容易失敗，見 #10）會留下**半套資料**：有 entry 沒歸到 trip、或 message 指向不存在的 entry → 前端時間軸顯示錯亂或缺漏，且難以事後對帳。這直接砸「存檔→顯示」的一致性。
- **做什麼**：把這組相關寫入用 GORM `Transaction` 包起來，任一步失敗整組 rollback；確保錯誤有回傳、不被吞。與 #14 一起做（交易也要吃 context）。
- **工作量 / 依賴**：M。與 #14（context）相關；改動需搭配測試驗證（跟測試專家清單會重疊）。

---

## 給後續合併討論的幾點註記

- **最該先做的一小撮（我的主觀 top）**：#1 panic recovery、#3 結構化 log、#2 真 health、#13 connection pool、#12 migration fail fast、#10 LLM retry/降級。這幾項多是 S/M、幾乎無依賴、且直接對應「別再瞎眼飛行 / 別再靜默壞掉」。
- **依賴鏈**：#3（slog + request ID）是 #1/#4/#5/#6/#10 的共同基礎，排最前面最划算。#2 是 #6/#7 的前提。#14（store context）是 #8/#15 完整生效的前提，但面積大，可漸進。
- **最像重構、要謹慎的**：#9（拆全域鎖）、#14（store context 化）。這兩項工作量 L、且需要測試護體——這裡會跟測試專家「先補 `internal/api`／`internal/auth` 測試」的主張直接相關，建議合併時綁在一起排。
- **與架構師可能重疊**：#7 部署/rollback、#9 並發模型、統一 domain error type（我沒單列，但 #10/#15 的「錯誤要一致、可見」其實需要它）——留給架構師主場，我這邊只從「止血」角度提。
