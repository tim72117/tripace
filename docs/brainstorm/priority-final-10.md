# 立即處理的 10 項 —— 可觀測性與核心功能穩定性

> 整合自三方腦力激盪（後端工程師 / 系統架構師 / 測試品保專家），兩輪討論後收斂。
> 第一優先主題:**觀測用戶狀態**（上線後看得見）+ **確保關鍵核心功能穩定運作**（不靜默壞掉）。
> 原始候選與收斂討論見同目錄 `priority-round1-*.md`、`priority-round2-*.md`。
>
> 本文件只做規劃排序,不含程式碼改動。

## 三方一致的核心結論

這三份清單不是在爭「誰的項目更重要」,而是在描述**同一條防線的三個時間段**:

```
上線前(測試攔截) ──→ 上線瞬間(health + smoke 判活) ──→ 上線後(log + metrics + alerting 偵測)
```

在「單一 prod、無 staging、push main 直接 100% 上線、唯一品質門檻是能編譯過」的現實下,**這條防線缺任何一段都會漏**。最終 10 項的排序原則因此是分層的:

> **先能看見**(health + log + 讓測試說真話)→ **再擋崩潰**(panic + timeout + pool)→ **再守迴歸**(關鍵測試)→ **最後補監測**(error tracking + alerting + metrics)

一個貫穿全局、且降低了成本估計的意外發現:**這個 codebase 的地基零件常常已做好一半、只是沒接起來**——最典型的是 `store.MigrationOK` 這個旗標早就存在(`store.go:25`),只是 `/health` 沒用它。這讓不少「地基項」的成本從 M 掉到 S,也讓「順手鋪對地基而非純止血」的主張更站得住腳。

---

## 最終 10 項(依建議執行順序)

### 第 1 層:先能看見(沒有這層,後面做了什麼都無從驗證)

#### 1. 誠實的 /health(liveness / readiness 分離 + DB ping + MigrationOK)

- **三方共識最強**(工程師 #2 / 架構師 A3 / 測試 C10),連做法都撞在一起。
- **問題**:`/health` 現在死回 `{"status":"ok"}`(`api.go:174`),DB 掛了、schema 壞了照樣回 200。Cloud Run liveness 探針、部署 smoke test、uptime 告警**全都建在這個永遠說謊的訊號上**。曾發生真實事故(環境變數漏設導致健康檢查失效、事後才發現)。
- **做法(地基版,非止血版)**:liveness(process 活著)與 readiness(DB ping 通 + `MigrationOK=true`)分離,Cloud Run 實際掛上兩種 probe。`MigrationOK` 旗標已存在,只差接上。
- **為什麼排第 1**:它是第 5、9、10 項(smoke / alerting)的共同前置——不先做,後面全在監測謊言。
- **工作量**:S。**驗收門檻(測試專家堅持)**:一條測試證明「注入 DB 錯誤 / `MigrationOK=false` 時真的回非 200」,否則哪天有人重構把 ping 拿掉,它又默默變回說謊的 200。

#### 2. CI gate(go build + vet + test -race,設為 branch protection required check)

- **測試專家 C1,力爭抬到最前段;架構師收斂時同意與 health 並列。**
- **問題**:專案已有 8 個 Go 測試 + 1 條 e2e,但 CI 四個 workflow 全是 build/deploy,`go test` 紅了照樣上 prod。**現有測試形同虛設。** 這代表下面每一項「立即處理」的改動,合併前都沒有任何機制跑一次測試證明它沒把別的東西改壞——等於在沒有安全網的高空作業。
- **做法**:把現有 `go test` / `go vet` 接上 PR 與 push main,設為必過的 branch protection check。**不寫一行新測試**,純粹把已有資產接上電。
- **為什麼排第 2**:它是**乘數項**,不是競爭項——是第 6、7 項所有測試工作生效的前提,也是第 4、8 項高風險改動「可以安全地做」的前提。
- **工作量**:S。**注意**:`-race` 第一次跑極可能就紅——`sink.go` 的 package-level 全域變數(`emitCount`/`emittedIDs`/`presented` 等)在並發下本來就可能有 data race。這不是壞事,是 `-race` 正在幫忙找第 8 項的證據;排期上先 `continue-on-error` 觀察、再收緊,別讓它擋住 gate 上線。

#### 3. 結構化 logging(slog + request ID 貫穿全流程,收編 4 處 LLM `fmt.Printf`)

- **三方共識**(工程師 #3+#4 / 架構師 A2 / 測試 C11)。零外部依賴(Go 內建 slog)。
- **問題**:只有 `log.Printf`,無結構化、無 request ID、無 level;logging middleware 不印 status code 與錯誤;LLM 錯誤走 4 處 `fmt.Printf`(帶 emoji)繞過任何 log 系統,雲端 log 查不到、告警不了。
- **做法(必做地基版)**:request ID 從 middleware 生成、塞進 `context`、貫穿到最底層,成為一條 **context spine**。它同時是第 4 項(panic 上報)、第 7 項(LLM retry 錯誤落地)、第 10 項(metrics)的共同掛點。**這一項必須連同「統一 error type」一起做**(見下方盲點說明)——錯誤出口統一後,`fmt.Printf` 才有地方收。
- **測試專家加碼**:log 欄位要足以**把一次線上事故重建成一條測試案例**(who / what / which-entry / which-tool / outcome),而非只給人看的一行字。這樣線上 incident 能直接回放成 mockllm 劇本。
- **為什麼排第 3**:它是最寬的觀測上游,五六項都掛它。這是「順序問題」不是「配比問題」——不先鋪這條線,之後幾乎每項可觀測性都要回頭重改。
- **工作量**:M(request ID 貫穿是主要工作,但因 slog 內建、middleware 掛點只有一處,地基版與止血版成本差不大)。

### 第 2 層:再擋崩潰(一點壞、全站壞的直接止血)

#### 4. panic recovery(HTTP + 所有背景 goroutine + 結構化上報)

- **投報比之王**,三方一致(工程師 #1 / 架構師 B1 / 測試 C7)。
- **問題**:全 repo `recover()` 零命中。任一 handler 或背景 goroutine panic 會讓整個 process 崩潰、影響**所有**使用者。
- **做法(必做覆蓋背景 goroutine 版)**:HTTP middleware 只保護 handler stack,但 `sink.go`/`want_analyzer.go` 自己 `go func(){}` 起的背景 goroutine **不在上面、照樣崩**,每個都要各自 `defer recover()`,recover 後當結構化錯誤上報(掛第 3 項的 slog)。
- **工作量**:S-M。**驗收門檻(測試專家堅持)**:一條「在背景 goroutine 裡故意 panic → 斷言 process 仍存活、其他請求仍可服務」的測試。**recover 沒有測試守著比沒 recover 更危險**,因為它給你「已經處理了」的錯覺。

#### 5. http.Server timeout + graceful shutdown + DB connection pool 上限

- 三項都是 S、純止血即正解、幾乎無依賴(工程師 #8+#13 / 架構師 B2+B5),合併為一格。
- **問題**:(a) 用裸 `http.ListenAndServe`,無 `ReadTimeout`/`WriteTimeout`/`IdleTimeout`,slowloris 與連線洩漏風險;(b) 無 graceful shutdown,Cloud Run 頻繁換 revision 會砍掉進行中的請求;(c) 無 `SetMaxOpenConns` 等設定,Cloud SQL 連線數容易被打爆——一放量就全域炸。
- **做法**:顯式 `http.Server{}` + `signal.NotifyContext`;`SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime` 幾行 config。`WriteTimeout` 要遷就 LLM 90 秒長請求,與第 7 項的 retry timeout 一起定值。
- **工作量**:S。

#### 6. 權限矩陣測試 + API 測試 harness

- **測試專家 C4+C6;工程師與架構師收斂時都認這是自己的盲點、認同高優先。**
- **問題**:`internal/api` 810 行、**所有授權檢查**(`requireOwner`/`requireEditor`/`requireMember`)都在裡面、**零測試**,程式碼自己都註記了兩個繞過風險(`middleware.go:41` 可清空任意頻道、`clienttools_http.go:25` 不做 channel 關聯檢查)。「viewer 能改別人行程」這種**靜默越權**比 panic 更可怕——panic 至少會 crash 讓你發現,越權是無聲的、功能照跑、只是權限破洞,而且是「壞掉最貴」的一類。
- **做法**:先建 API 測試 harness(沿用既有 `Open("file::memory:?cache=shared")` 的 in-memory pattern,極快),再寫權限矩陣測試(各角色 × 各端點的允許/拒絕）。harness 是權限測試的前置,一併做讓 `internal/api` 從「零測試不可能」變「後續測試便宜」,同時解鎖第 8 項與時間欄位跨層驗證所需的 harness。
- **工作量**:M。

### 第 3 層:守迴歸 + 補監測

#### 7. LLM retry / 逾時 / 降級(掛在 context 上,錯誤落 slog)+ 取代 sleep(1500ms) 完成判定

- 兩項綁在一起(工程師 #10+#11 / 架構師 B3+B4 / 測試 C7),因為都動 LLM 呼叫的核心生命週期。
- **問題**:(a) LLM provider 5xx 或逾時沒有重試也沒有降級,錯誤只 `fmt.Printf`;(b) 完成判定是 race-prone 的啟發式——收到 idle 後 `time.Sleep(1500ms)` 等文字事件(出現 4 處:`want_analyzer.go:93/205/300` + `clienttools_agent.go:190`),可能截斷或誤判回應完成。
- **做法**:retry **必須掛在 context 上**(帶 context 的指數退避,可被逾時/取消打斷),**不是裸 `for` 迴圈**(裸迴圈在 shutdown 砍不掉、取消訊號進不去兩點上必然要重寫)。完成判定改用確定性事件信號(架構師指出 want 內建 `RequestInteraction`/`ResolveInteraction` 可用),並把「可注入的完成信號」交出去給測試用。
- **工作量**:M。**驗收門檻(測試專家堅持)**:用 mockllm 精確控制回應時序,讓回應在原本 1500ms 窗口之後才到 → 斷言不被截斷。改的是核心流程的完成語意,更需要測試釘住。

#### 8. 唯一 e2e 接上 CI + 核心流程守門(給定輸入 → 預期工具序列的 golden 斷言)

- **測試專家 C2 + C9。**
- **問題**:專案裡**唯一**驗證「記事→AI→存檔→顯示整條真的能動」的 e2e,被設計成要手動起三個 process(刻意不用 Playwright 的 `webServer` 選項),等於這個唯一守門員永遠不上崗。改 prompt、改工具白名單、改 dispatch 接線弄壞某條路徑(例如「使用者說刪掉那筆」不再觸發 `entry_delete`),**沒有任何自動化會發現**,直到使用者抱怨——正是最怕的靜默失敗。
- **做法**:用 Playwright `webServer` + mockllm 讓 e2e 能在 CI 獨立跑;並借既有 `agentbench/goal.go` 的 `evaluateGoal`/`paramsMatch` 邏輯抽成 test helper,用 mockllm 餵劇本,把「給定輸入 → 預期工具序列」寫成 golden 斷言,守住 agent 行為不被改壞。(註:LLM 測試基礎設施是 `mockllm` + `agentbench`,先前資料誤植的 `MockBackendService` 實際不存在。)
- **工作量**:M。

#### 9. 部署後 smoke test(失敗不切流量 / 失敗告警)+ uptime 監控與 alerting

- 合為一條「部署後守門」(工程師 #6+#7 / 架構師 D1+C2 / 測試 C3)。**前置是第 1 項(誠實 health)。**
- **問題**:push main 直接 100% 切換,無 smoke test、無自動 rollback、無 uptime 監控、無 alerting。設定類事故(漏 secret、DB 連不上)直接 100% 打到使用者。
- **做法**:`--no-traffic` 起新 revision → smoke 打 readiness + 一條需要 DB/auth 的唯讀端點 → 綠了才導流、紅了不切流量並告警(全自動 rollback 是進階形態,可漸進)。uptime check + alert policy(至少 5xx 率與 /health 失敗)。**順手納入**:`GH_PAT` 過期告警(S)——`want` 是需 PAT 拉取的私有套件,PAT 過期則所有部署立即中斷、連緊急修復都推不上去,是唯一「連止血通道本身都會斷」的風險。
- **工作量**:M。**注意**:smoke test 本身也會 flaky、會誤報,需納入下方「持續事項」的 flaky 治理,否則守門員自己爛掉是最隱蔽的失敗。

#### 10. LLM 核心業務指標(記事成功率 / LLM 回應完成率 / 延遲 / 排隊深度)+ 全域序列化點護欄

- 工程師 #5 / 架構師 C(metrics)+ B7(護欄)/ 測試 C12,收斂為「上線後主動告警」這條線的收尾。
- **問題**:(a) LLM 呼叫延遲、token 用量、工具執行次數、錯誤率全無觀測——「上線後壞了」只能靠使用者回報;(b) 全站 LLM 請求被單一 mutex 序列化(want 全域單例 + `sink.go` 全域狀態靠單一 `recordMu`),第二個使用者要排隊等 90 秒逾時,既是效能天花板也是**現成 DoS 面**,而且完全不可見。
- **做法**:先用 slog log-based metrics(和第 3 項合流,OTel 延後)產出關鍵業務指標。序列化點**立即只做低風險護欄**——排隊上限 + acquire 逾時 + 排隊深度/等待/拒絕 metrics,把這個天花板從「不可見」變「可觀測」、DoS 面先止住。
- **為什麼「拆單例」不在這 10 項內**:三方一致——拆 `sink.go` 全域鎖是 L、高風險,**立即範圍內只做護欄,真正拆解留到有 metrics 數據 + 有並發測試護體之後**。若貿然拆解而沒有並發測試守著,會把「慢但正確」的系統換成「快但偶爾錯」的系統,比不拆更危險。
- **工作量**:M(護欄 + log-based metrics)。

---

## 兩條主線的配比

前 6 名刻意接近 **1:1**——可觀測性/信號佔第 1、2、3(health、CI gate、log),核心穩定性佔第 4、5、6(panic、timeout+pool、權限測試),恰好構成「看得見 / 不崩潰 / 不越權」三足。第 7-10 名讓可觀測性略微加碼(retry 錯誤落地、smoke+alerting、metrics),整體約 **6:4 偏可觀測性**——因為 push main 直接上線的節奏下,「壞了立刻知道」的邊際價值最高。

測試/品保性質的項目在最終清單佔 **3 席**(第 2 項 CI gate、第 6 項權限測試+harness、第 8 項 e2e+行為守門),這是測試專家力爭、另兩方認同的底線:可觀測性回答「壞了看不看得見」,測試回答「改動之後還沒壞嗎」,兩者各自需要席次,缺一邊另一邊遲早悄悄失效。

---

## 收斂過程釐清的三個事實(影響執行)

1. **`MockBackendService` 不存在**——先前架構評估誤植。真正可用的 LLM 測試基礎設施是 `mockllm`(vLLM 相容假 server,已有 `script_test.go` 代表本來就能被 `go test` 驅動)+ `agentbench`(`goal.go` 已有工具呼叫判斷邏輯)。第 8 項據此調整。
2. **`store.MigrationOK` 已存在但沒接上 /health**——第 1 項成本因此從 M 降到 S。這也提醒:很多「地基」不是要新蓋,是把已鋪好的半條線接通。
3. **`sleep(1500ms)` 完成判定是系統性的**,出現 4 處而非單點;`-race` 首次上 CI 極可能就紅(`sink.go` 既有 data race)。

## 明確排出前 10、留待之後的項目

- **拆 `sink.go` 全域鎖 / want 單例**:立即只做護欄(第 10 項),拆解本身延後到有 metrics + 並發測試之後。
- **store 層全面 context 化的 L 部分**:只做第 3 項的 middleware context 生成(request ID 來源),store 簽章逐檔漸進。
- **多步驟寫入包交易**(entry + trip 歸組 + message 關聯):正確性問題,但與 store context 化綁,建議至少先把 entries 那組寫入包進 `Transaction`——驗收門檻是「注入中途錯誤 → 斷言 DB 不留半筆」的原子性測試。列為第 11 順位。
- **時間欄位 timestamptz 遷移的迴歸測試**(剛完成的大改動,只有一次機會做對):時區換算、資料遷移、跨層一致性測試——列為緊接前 10 的補強(依賴第 6 項的 harness)。
- **OTel 正式指標、want vendor/fork、統一 domain error type 的完整版**:延後(error type 的最小版已併入第 3 項)。

## 貫穿全清單、執行時必須注意的兩個陷阱(三方額外點出)

1. **`context.Canceled` 分流**:第 3 項 context spine 一鋪,使用者中途關頁面 / WS 斷線會產生 context 取消。若把 `context.Canceled` 當 ERROR 記+上報+retry,會製造大量假告警、還可能對已離開的使用者狂重試 LLM(燒錢)。做 slog + retry 時必須把「取消」和「真錯誤」分流。
2. **測試防線自身的腐化**:smoke/e2e 會 flaky(e2e 已知有 StrictMode 雙掛載 vs WS handshake 的時序競態),CI retry 會被拿來掩蓋真 flaky。需要 flaky 治理與「必進 gate / 不進 gate」清單分離——不必進前 10,但必須跟第 2、8 項同一批規劃,否則守門員上崗當天就開始生鏽。
