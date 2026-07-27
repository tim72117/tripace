# 後端工程師的收斂意見 —— 第二輪

讀完架構師與測試專家的清單，先講一句立場：三份清單的**方向高度一致**，分歧不在「該做什麼」，而在「先鋪地基還是先止血」與「同一件事掛在誰的骨架上」。我這輪的任務就是把重疊項去重、把依賴鏈釘死、給出前 5-6 名的排序，並在「可觀測性」與「核心穩定性」兩條主線之間定一個配比。

## 先做事實對齊：MockBackendService 的修正

測試專家的發現我核過了，屬實：`grep -rn MockBackendService` 全 repo 零命中。真正在的是 `internal/mockllm`（vLLM 相容假 server，`server.go` + `script.go` 的腳本化 `Engine`，而且**已經有 `script_test.go`**，代表它本來就能被 `go test` 驅動）與 `cmd/agentbench`（`goal.go` 裡已有 `Expected` / `paramsMatch` / `evaluateGoal` / `ToolCall` 這套「有沒有正確呼叫某工具、參數對不對」的判斷邏輯）。

好消息是：**我第一輪沒有任何一項依賴 MockBackendService**——我的證據全是對真實檔案的 grep（`sink.go:99`、`clienttools_agent.go:190` 那些行號）。所以我這邊不用改任何建議。但這件事對測試專家的 C9 很關鍵：確定性層的地基是現成的，不是要從零刻一個 mock，而是「把 `mockllm` 餵劇本 + 借 `goal.go` 的 `evaluateGoal` 抽成 test helper」，工作量比想像小，這點我背書，並願意在修「完成判定」時把可注入的完成信號一起交出去（見下文依賴鏈）。

## 一、三方其實在講同一件事（高共識，理應排最前面）

這四項是三份清單的最大公約數，應當直接進最終前段，不必再爭論：

- **panic recovery**：我的 #1、架構師 B1、測試專家在 C7 也間接依賴它。三方一致，且都特別點出「HTTP middleware 只保護 handler goroutine，`sink.go` / `want_analyzer.go` 自己 `go func(){}` 起的背景 goroutine 要各自 `defer recover()`」。這是全清單投報比最高的一項，沒有異議。
- **誠實的 /health（DB ping + MigrationOK，liveness/readiness 分開）**：我的 #2、架構師 A3、測試專家 C10。三方連做法都撞在一起（分 liveness/ready、納入 `store.MigrationOK`）。測試專家把它定位成「smoke 與探針的可信號源」，架構師把它定位成「fail-fast 的一體兩面」——兩個定位我都同意，它是下面依賴鏈的樞紐。
- **結構化 logging（slog）+ request ID**：我的 #3、架構師 A2、測試專家 C11。零外部依賴（Go 內建 slog），三方都指名它是其他觀測項的共同基礎。唯一要合併的差異：測試專家要求「欄位要足以重建一條測試案例」（who / what / which-entry / which-tool / outcome），這比我原本「給人看」的定義更嚴，我採納——反正 slog 帶結構化欄位，多帶幾個 key 幾乎零成本，卻讓線上 incident 能直接回放成 mockllm 劇本。
- **部署後 smoke test**：我的 #7、架構師 D1、測試專家 C3。三方一致，且都同意「先做『失敗不切流量 / 失敗告警』就已是從零到一」，全自動 rollback 是進階形態。

高共識但只有兩方提、我也認同的：**http.Server timeout + graceful shutdown**（我 #8、架構師 B2）、**DB connection pool 上限**（我 #13、架構師 B5）、**AutoMigrate fail-fast**（我 #12、架構師 B6、測試專家 C7 第三點）、**LLM retry/timeout/降級**（我 #10、架構師 B3）、**取代 sleep(1500ms) 完成判定**（我 #11、架構師 B4、測試專家 C7 第一點）。這些去重後都是同一項，合併時各記一次即可。

## 二、對方提到、我第一輪漏掉或想補充的點

- **架構師 A1「request context 主幹」——我認同它是上游，但不同意它排第一序位。** 作為實作者，我的判斷是：**有幾項該先獨立止血，不必等地基鋪完**。connection pool（#13/B5）、AutoMigrate fail-fast（#12/B6）、真 health（#2/A3）、panic recovery（#1/B1）這四項全是 S、幾乎無依賴、且都是「一放量就全域炸」或「一顆髒 input 弄死線上」的雷——這種東西等 store 全面 context 化（L、面積大）才做，是拿真實事故換架構整潔，投報比是負的。context 主幹我贊成鋪，但它是「並行推進的地基」，不是「阻塞其他人的閘門」。折衷：先做 A1 的 **S 部分**（middleware 生成帶 request ID 的 context），這部分本來就是 slog 的前置、也不貴；store 簽章的 L 部分逐檔跟進，別讓它擋住上面四顆 S 止血。
- **架構師 A4「統一 domain error type + 單一錯誤 schema」——我第一輪沒單列，看了認同，補一個技術細節。** 我原本只在 #10/#15 講「錯誤要一致、可見」，架構師把它抽成 `AppError{Code, HTTPStatus, Message, Cause}` 是對的，而且他點出的**附帶安全收益**（`err.Error()` 現在會把 GORM/SQL 原文洩漏給客戶端）我要加碼：這不只是觀測整潔，是**資訊洩漏**，middleware 統一序列化時應該對外只吐 `Code + Message`、`Cause` 只進 log。這項我願意讓它進前 10 的後半段。
- **測試專家 C4「權限矩陣測試」+ C6「API harness」——我第一輪完全沒碰授權面，這是我的盲點，我認同它高優先。** `internal/api` 810 行零測試、所有 `require*` 授權檢查都在裡面，而且程式碼註解自己標了兩個繞過風險（`middleware.go:41` 清空任意頻道、`clienttools_http.go:25` 不做 channel 關聯檢查）。「viewer 能改別人行程」這種**靜默越權**比 panic 更可怕——panic 至少會 crash 讓你發現，越權是無聲的。我原本只想著「流程不能靜默壞掉」，漏了「權限不能靜默破洞」。這項我從前 10 之外拉進來。

## 三、依賴鏈的工程判斷（這對排序最關鍵）

把三份清單的依賴關係合併，我看到的鏈是這樣，箭頭是「前置 → 後續」：

- **誠實 health（#2/A3/C10）→ smoke test（#7/D1/C3）+ uptime 告警（#6/C2）**。這是全清單最硬的一條依賴：不先做誠實 health，後兩者都在**監測一個永遠說謊的訊號**。測試專家講得最白——health 永遠綠，自動 rollback 根本觸發不了。所以誠實 health 必須排在 smoke 與告警之前，沒有例外。
- **slog + request ID（#3/A2/C11）→ panic 上報（#1）+ logging middleware 補 status（#4）+ LLM 指標（#5/C3/C12）+ LLM retry 錯誤落地（#10/B3）+ 錯誤追蹤（C1-架構師）**。slog 是最寬的一個上游，五六項都掛它。這也是為什麼它該和 health 並列排最前。
- **API harness（C6）→ 權限矩陣（C4）+ 跨層時間欄位測試（C8 那半段）**。測試專家自己排明了先做 harness。
- **誠實 health（C10）→ AutoMigrate 測試（C7）**。fail-fast 的行為要能被測，前提是 health 會誠實回報降級。
- **context 主幹的 S 部分（A1-S）→ store context 化（A1-L / 我的 #14）→ request timeout 真正貫穿 DB（#8）+ 交易吃 context（#15）**。這條是「可漸進」的，不該擋前面的止血。

一個我要特別強調的**交叉依賴**：架構師 B7（給全域序列化點加護欄）與我的 #9（拆全域鎖）、測試專家 C7（完成判定抽可注入信號）三者糾纏。架構師的判斷是對的——**立即範圍內先加護欄（排隊上限 + acquire 逾時 + 排隊 metrics），不要現在拆單例**（那是 L、高風險）。我讓步：#9 的「拆」退出前 10，改採 B7 的「護欄先行」。但護欄需要 metrics 落點，所以它其實掛在 slog / 指標那條線上。

## 四、我推薦的最終前 6 名與配比

前 6 名（不分絕對先後，但這 6 個該在最前面，且能大量並行）：

1. **panic recovery（含背景 goroutine）** —— 投報比之王，S-M，止一顆髒 input 弄死全站的血。
2. **slog + request ID** —— 最寬的觀測上游，解鎖五六項，零外部依賴。
3. **誠實 health（liveness/readiness）** —— smoke 與告警的共同前置，S。
4. **DB connection pool 上限** —— 幾行 config，止「一放量 Cloud SQL 連線爆掉」的全域雷，S，無依賴。
5. **AutoMigrate fail-fast**（搭 health readiness）—— S，止「schema 壞了卻看似健康」的最難查事故。
6. **API harness + 權限矩陣測試** —— 補我原本的盲點，止靜默越權，是「內部 api 從零測試變便宜」的槓桿。

緊接第 7-10 我會放：**http.Server timeout + graceful shutdown**、**LLM retry/timeout/降級**（錯誤落 slog）、**取代 sleep 完成判定**（同時交出可注入信號給 C7/C9）、**smoke test + uptime 告警**（併為一條「部署後守門」）。測試專家的 **C1（CI gate）** 我認為應該和 #1-#6 並行插隊——它不寫一行新測試就讓現有 8 個測試真的能擋 push，是所有測試工作的乘數，成本 S，我完全支持它算「第 0 項」。

**兩條主線的配比**：前 10 我建議大約**可觀測性 4-5、核心穩定性 5-6**，接近一半一半但穩定性略多。理由是：可觀測性項（slog、health、告警、指標）多是「地基一鋪就解鎖一片」，投報比高但**單項不直接止血**；穩定性項（panic、pool、fail-fast、retry、交易）才是**直接堵住正在流血的傷口**。所以我讓穩定性在數量上略勝，但把兩個最寬的觀測地基（slog、health）硬塞進前 3，因為它們是「後續一切能被看見/被測」的先決條件——這不是配比問題，是順序問題。

## 五、我願意讓出前 10 的東西

- **#9 拆全域鎖**：改由架構師 B7 的護欄替代，拆解本身延後。
- **#14 store 全面 context 化的 L 部分**：只保留 A1 的 S 部分（middleware context），其餘漸進。
- **#5 走 OTel 的正式指標**：先用 slog log-based metrics（和測試專家 C12 合流），OTel 延後。
- **架構師 D2 的 vendor/fork want**：只保留「PAT 過期告警」這個 S，fork 評估是 L、非立即。

## 六、合起來仍有的盲點（三方都沒明講）

1. **`context.Canceled` 的正確處理**：等 A1 context 主幹一鋪，使用者中途關頁面 / WS 斷線會產生 context 取消——如果我們把 `context.Canceled` 當成 ERROR 記 + 上報 + retry，會製造大量假告警、還可能對一個已離開的使用者狂重試 LLM（燒錢）。做 slog + retry 時必須把「取消」和「真錯誤」分流，這在三份清單都沒點到，但一鋪 context 就會踩到。
2. **`-race` 下的既有 race**：測試專家 C1 建議開 `-race`，我強烈附議，但要預期它**第一次就會紅**——`sink.go` 那堆 package-level 全域變數（`emitCount`/`emittedIDs`/`presented`…）在並發下極可能本來就有 data race。這不是壞事，是 `-race` 正在幫我們找 #9 的證據；但排期上要留一格「處理 `-race` 首次噴出的既有 race」，別讓它擋住 CI gate 上線（可先 `continue-on-error` 觀察，再收緊，跟測試專家對 lint 的策略一致）。
