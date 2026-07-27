# 立即處理候選清單 —— 測試/品質保證專家視角

> 守門員思維、風險導向、投報比優先。
>
> 前提現實：**單一 prod、push main 直接 100% 上線、無 smoke test、無自動 rollback**，唯一品質門檻是「能編譯過」。在這種部署現實下，測試專家的第一原則不是「提高覆蓋率」，而是「**把災難級迴歸擋在上線前，把上線後的靜默失敗變成看得見的訊號**」。以下候選按「先接底線 → 擋災難路徑 → 補關鍵迴歸 → 上線後守門」的邏輯排列，但每項都獨立標示投報比與依賴，方便後續與後端/架構師清單合併排序。
>
> 一個貫穿全清單的判斷：**「CI 沒跑測試」比「測試太少」更該先解決**。現在就算把測試寫到 80% 覆蓋率，只要 CI 不跑，push main 一樣不會被擋 —— 已寫好的 8 個 Go 測試 + e2e 現在就是「形同虛設」的狀態（能編譯就上線，測試紅不紅沒人看）。所以 C1 是所有測試工作的乘數，必須最先做。

---

## A. 先接底線：讓已存在的測試真的能擋 push（最高投報比，做一次全體受惠）

### C1. 建一個「go test + vet + lint」的 CI gate，掛在 push main / PR 上，紅了就擋部署

**為什麼是立即優先（會漏掉什麼災難）**
現在 4 個 workflow 全是 build/deploy，唯一門檻是「編譯過」。這代表：現有 8 個 Go 測試檔（adminauth、adminconsole、mockllm、store/trips、wanttools 等）任何人改壞了，`go test` 會紅，但 **CI 根本沒跑，照樣上 prod**。這是「投報比最高的一件事」——不用寫任何新測試，只是把已經寫好、正在退化中的資產接上電，就能把「編譯過」升級成「編譯過 + 既有測試綠 + vet 乾淨」。沒有這道 gate，後面所有補測試的工作都會被同一個漏洞稀釋（寫了也沒人擋）。

**具體怎麼做（利用哪些既有基礎設施）**
- 新增 `.github/workflows/ci.yml`，觸發 `pull_request` 與 `push: [main]`，`paths: server/**`。
- 步驟：`actions/setup-go` → `cd server && go build ./... && go vet ./... && go test ./... -race -count=1`。
- `-race` 幾乎免費且對這個含 WebSocket hub / goroutine（那 4 處 `go func(){ time.Sleep... }`）的專案特別值得。
- lint 用 `golangci-lint`（先開最保守的一組：`govet, staticcheck, errcheck, ineffassign`），第一輪允許 `continue-on-error` 觀察噪音再收緊，避免一上來就被既有 warning 淹沒而被迫關掉。
- **關鍵治理**：把這個 job 設為 branch protection 的 required check，否則「紅了就擋」只是願望。這一步是 C1 真正生效的開關（跟後端/架構師清單裡「分支保護」議題會重疊，合併時歸為一項）。

**工作量 / 依賴**：**S**。無前置依賴，可獨立完成，是其它所有測試項的乘數。

---

### C2. 把那個「要手動起三個 process」的 e2e 改造成 CI 一鍵可跑的守門員（Playwright webServer + mockllm）

**為什麼是立即優先（會漏掉什麼災難）**
目前唯一一條端到端覆蓋（東京行程 新增/更新/刪除，跨 瀏覽器→WS→渲染 全鏈路，`web/tests/e2e-mock-llm.spec.ts`）是這個專案**唯一驗證「核心流程整條真的能動」的東西**，卻被設計成無法獨立執行：必須先在另一個 terminal 手動跑 `server/scripts/run_e2e_mock_llm_test.sh` 起 mockllm(:9999) + server(:8180) + web(:5173) 三個 process，`playwright.config.ts` 刻意不用 `webServer`、`retries: 0`、無覆蓋率工具。CI 友善度為零 = 這條唯一的守門員永遠不會在 CI 站崗。改 prompt、改工具白名單、改時間欄位，這條 happy path 壞了也沒人知道。

**具體怎麼做（利用哪些既有基礎設施）**
既有腳本已經把「三個 process 怎麼串」的所有陷阱解過了，直接把它的知識搬進 Playwright 生命週期，不要重寫：
- 在 `playwright.config.ts` 加 `webServer`（可多個），或做一個 `global-setup.ts`，用腳本已驗證過的同一組指令與環境變數啟動：
  - mockllm：`MOCKLLM_ADDR=:9999 go run ./cmd/mockllm`，`url` 輪詢 `http://127.0.0.1:9999/v1/models` 當就緒探針（腳本已在用）。
  - server：`DATABASE_URL= AI_PROVIDER=vllm VLLM_BASE_URL=http://127.0.0.1:9999 go run ./cmd/server -addr 127.0.0.1:8180 -db <tmp>.db -llm want -seed=true`，`url` 探 `/health`。**務必保留腳本裡「DATABASE_URL 設空字串而非不設」那個坑的修法**（否則 godotenv 會把它填成開發者的 Postgres），這是踩過的真實 bug。
  - web：`VITE_API_BASE=http://127.0.0.1:8180 npm run dev -- --port 5173 --strictPort`。
- CI 需要 `npx playwright install --with-deps chromium`（腳本註解已載明不隨 npm install 下載）。
- **CI 環境要件**：Go 1.26+ 用 `setup-go`；SQLite（`file:` / 檔案）而非 Postgres，符合腳本「加快測試速度」的原意，也讓 CI 不必起 DB container。
- 保留 spec 那套「用 WS frame 序列驗證過程、REST API 交叉驗證最終狀態」的斷言策略（那是作者實測後對 mock LLM 過快、中間態無可觀測窗口的正確設計，別退回逐步 DOM 快照）。
- CI 上 `retries` 建議設 1（本機開發維持 0）：CI 機器較慢、StrictMode 雙掛載那個已知連線競態偶發，1 次重試區分「真壞」與「已知窗口太窄」，但要在 report 標記重試次數避免掩蓋真 flaky。

**工作量 / 依賴**：**M**。依賴 C1（有了 CI 才有地方掛）。這是「唯一的守門員上崗」，投報比僅次於 C1。

---

### C3. 補一個「smoke test job」：部署後自動打幾個關鍵端點，失敗即 rollback

**為什麼是立即優先（會漏掉什麼災難）**
在**無 staging** 的現實下，這是測試與可觀測性的交集，也是「push main 直接 100% 上線、無自動 rollback」這個最大風險的直接對症藥。今天若一次部署讓 server 起不來、或起來了但 DB 連不上（`AutoMigrate` 失敗只降級不中止，見 store.go:66 —— server 會「成功啟動」但 schema 壞掉），**使用者是第一個發現的人**。smoke test 是上線前測試抓不到的（設定、secret、真實 DB、真實 provider 金鑰）最後一道防線。

**具體怎麼做（利用哪些既有基礎設施）**
- 在 `deploy-cloudrun.yml` 的 `Deploy` 之後加 `Smoke test` step：對 Cloud Run URL 打
  1. `GET /health`（現有，api.go:174）；
  2. 一條需要 DB 的唯讀端點（例如帶測試帳號 JWT 打 `GET /v1/channels`），確認「不只 process 活著，DB/auth 這條也活著」；
  3. 可選：一條輕量 assist 打通 LLM provider（確認 `GOOGLE_API_KEY` 這種 secret 真的生效 —— 呼應近期才補上 AI_PROVIDER/金鑰的 commit）。
- **前置改造（跟 C10 綁）**：現在 `/health` 是靜態 `{"status":"ok"}`，DB 掛了它也回 200。要讓 smoke test 有意義，得先讓 health 反映真實依賴（ping DB、回報 `store.MigrationOK`）。
- rollback：Cloud Run 用 revision 機制天然支援。smoke step 失敗 →`gcloud run services update-traffic <svc> --to-revisions=<上一個健康 revision>=100`。搭配 `--no-traffic` 先部署新 revision、smoke 綠了才 `update-traffic` 切 100%，是更安全的「金絲雀」版本（可作為 C3 的進階形態，和架構師清單的部署策略合併討論）。

**工作量 / 依賴**：**M**。依賴 C10（health 要先能反映依賴）才有守門價值；rollback 那半段可獨立先做。

---

## B. 擋災難路徑：權限/安全與核心流程的高風險零測試區

### C4. 為 requireOwner / requireEditor / requireMember 寫權限矩陣測試（安全迴歸的第一防線）

**為什麼是立即優先（會漏掉什麼災難）**
`internal/api`（810 行主 handler）**零測試**，而**全部的授權檢查都在這裡**（api.go:322/343/376 三個 require\* 函式，散落在 20+ 個 handler 呼叫點）。這是整個清單裡「壞掉最貴」的地方：一個角色比對寫反、一個 handler 忘了呼叫 require\*，就是「viewer 能改別人行程」「非成員能讀私密頻道」這種災難級越權，而且是**靜默**的（不會 crash、功能照跑，只是權限破洞）。程式碼裡自己都標注了風險（middleware.go:41「繞過 requireOwner 清空任意頻道」、api.go:145「entryID/channelID 外部呼叫者繞過 /v1 權限檢查」）——這些擔憂必須用測試釘住，不能只留在註解裡。

**具體怎麼做（利用哪些既有基礎設施）**
- 用 `httptest.NewServer` + `store.Open("file::memory:?cache=shared")`（store 測試已在用的極快 in-memory 模式）架一個 Server。
- 建 fixture：owner / editor / viewer / 非成員四種身分 × 各類 handler（改成員、記事 entry_add/update/delete、query、public_link、清空頻道）。
- 寫成 **table-driven 權限矩陣**：每格斷言預期的 HTTP status（403 not_owner / 403 not_editor / 403 not_member / 200）。這種表最有價值的地方是「**加新 handler 時，漏了掛權限檢查會立刻讓對應格子從紅變綠地雷般被抓到**」。
- 特別針對兩個已註記的繞過風險各補一條回歸：(a) 非 owner 呼叫「清空頻道」須 403；(b) clienttools / 那條「不做 channel 關聯檢查」的路徑（clienttools_http.go:25 自己標注 unlike requireMember）須有明確的預期行為測試，確認它不是越權後門。

**工作量 / 依賴**：**M**。依賴一個可重用的 API 測試 harness（見 C6，建議先做 harness 再鋪這張矩陣）。**這是安全面投報比最高的一項。**

---

### C5. 為 internal/auth 寫 JWT / password / Apple token 單元測試（認證的地基）

**為什麼是立即優先（會漏掉什麼災難）**
`internal/auth`（jwt.go 101 行簽發驗證、password.go hash、apple.go token）**零測試**。這是「誰是誰」的地基，壞了不是功能 bug 是安全事件：JWT 過期/簽章驗證寫錯 → 任何 token 都過關或都被拒；password hash/verify 不對稱 → 全體登入壞掉或密碼形同虛設。這種純函式、無 I/O、無依賴的邏輯，是**單元測試投報比的教科書案例**：極快、極穩、一次寫好長期守。

**具體怎麼做（利用哪些既有基礎設施）**
- JWT：測 sign→verify round-trip 過關；篡改 payload / 換簽章金鑰 / 過期 token 必須被拒；claims（user id 等）正確帶入與取出。無外部依賴，可用 `time` 注入或短過期時間測過期路徑。
- password：hash 同一密碼兩次結果不同（salt）、正確密碼 verify 過、錯誤密碼 verify 敗、空密碼邊界。
- apple.go：token 解析用固定測試向量（table-driven），至少覆蓋格式錯誤/欄位缺失的拒絕路徑；真正需要 Apple 公鑰驗簽的部分若涉外部呼叫，抽介面用 stub 測我方解析邏輯。
- harness 幾乎不用建（都是純函式），是清單裡能最快變綠的一項。

**工作量 / 依賴**：**S**。無前置依賴，可與 C1 並行，馬上見效。

---

### C6. 建一個可重用的「API 整合測試 harness」（httptest + in-memory store + 認證捷徑）

**為什麼是立即優先（會漏掉什麼災難）**
C4 的權限矩陣、未來 entries/trips 的 API 層迴歸、C2 之外的更細端點測試，全都需要「起一個帶真實 store 的 Server、用某個身分打 request」的能力。現在沒有這個 harness，所以 `internal/api` 才會零測試（每寫一條都要重搭一次登入/建頻道/塞成員的樣板，成本太高沒人寫）。**先把這個地基做出來，後面每一條 API 測試的邊際成本才會降到可接受**，這是「讓 API 測試從不可能變便宜」的槓桿項。

**具體怎麼做（利用哪些既有基礎設施）**
- 一個 `newTestServer(t)` helper：`store.Open("file::memory:?cache=shared")` → 建 Server → `httptest.NewServer`，`t.Cleanup` 收尾。
- 認證捷徑：提供 `asUser(userID)` 直接簽一個測試 JWT（複用 internal/auth 的 sign），或設一個「測試用 middleware 注入身分」的旁路，避免每條測試都跑完整登入流程。
- fixture builder：`seedChannel(owner)`、`addMember(ch, user, role)`、`seedEntry(...)`，回傳 id 供斷言。
- 讓它同時服務兩種顆粒度：純 handler 單元（直接呼叫 `handleXxx`）與 httptest 整合（走真實路由 + middleware，能抓到「路由沒掛權限」這類只有整條路徑才暴露的問題）。

**工作量 / 依賴**：**M**。無前置依賴，但**是 C4 的前置**，建議在 C4 之前或同批完成。

---

### C7. 為核心流程的「靜默失敗點」寫針對性回歸測試（sleep 完成判定、未包交易、AutoMigrate 降級）

**為什麼是立即優先（會漏掉什麼災難）**
核心流程（記事→AI 整理→存檔→顯示）有幾個已知會**靜默失敗**的破口，靜默 = 靠使用者回報才知道，正是專案負責人最怕的「突然壞掉或靜默失敗」。這些點不是「還沒測」，是「已知有風險但沒有測試釘住」，一旦有人重構就會無聲退化：
- **LLM 完成判定用 `time.Sleep(1500ms)` 啟發式**（want_analyzer.go:93/205/300、clienttools_agent.go:190 共 4 處）：太慢的回應會被截斷、太快則多等。這是核心流程「AI 整理」段最脆的地方。
- **多步驟寫入未包交易**：`store` 的交易只出現在 trips.go / channels.go，`entries.go` 的多步寫入（尤其時間欄位改版後 start_at/end_at/tz/all_day 一起寫）中途失敗會留下半套資料。
- **AutoMigrate 失敗只降級不中止**（store.go:66）：schema 壞掉但 server 照常起，功能靜默半殘。

**具體怎麼做（利用哪些既有基礎設施）**
- 完成判定：把「LLM 何時算完成」抽成可注入的信號（channel/callback）而非寫死 sleep，然後測「回應在 sleep 窗口後才到 → 不被截斷」與「多工具連續呼叫 → 完成事件只觸發一次」。這同時是修 bug 也是防迴歸（測試會逼出一個可測的介面）。可借用 mockllm 精確控制回應時序來重現慢回應。
- entries 交易：對 entries 的多步寫入補交易後，寫一條「注入中途錯誤 → 斷言資料庫維持一致（不留半筆）」的測試釘住原子性。
- AutoMigrate：用一個「故意 schema 不相容」的 in-memory DB 觸發 `MigrationOK=false`，斷言此時（依決策）server 拒絕服務 or health 明確回報異常（與 C10 綁）。至少把「降級了但沒人知道」變成「降級了 health 會亮紅」。

**工作量 / 依賴**：**M**（每個破口 S，但需先與後端工程師談「完成判定/交易」的修法，因為測試會牽動介面設計 —— 這幾項和後端清單高度重疊，合併時應歸為「修 + 測」的成對項）。

---

## C. 補關鍵迴歸：剛做完的大改動 + LLM 行為

### C8. 為「時間欄位 字串→timestamptz」大改動補跨層迴歸測試（時區換算 + 資料遷移 + 跨層一致性）

**為什麼是立即優先（會漏掉什麼災難）**
這是**剛完成、風險最集中**的改動：entries/trips 的時間從字串改 timestamptz，牽動 store（migrate_timestamps.go 233 行 + timeconv.go）→ tripsvc → API → 前端，但**目前只有 store 層的 trips 有測試**，entries 完全裸奔，時區換算與遷移邏輯零測試。這種改動的災難模式是**靜默偏移**：時間差幾小時（時區換算錯）、全日事件變成有時刻、舊資料遷移後日期跑掉——功能不會 crash，只是每筆行程時間都微妙地錯，使用者體驗全毀卻難以立即察覺。

**具體怎麼做（利用哪些既有基礎設施）**
沿用 store 既有的 in-memory 測試模式（`Open("file::memory:?cache=shared")`），分三層鋪：
- **轉換純函式（timeconv.go）**：`ParseLocalDateTime` / `FormatLocalDateTime` round-trip。重點邊界：跨時區（Asia/Tokyo 14:30 → UTG 存值 → 讀回顯示仍 14:30）、全日事件（timeStr 空 → all_day=true，讀回時刻仍空）、相容舊格式（date 含 `HH:MM`）、DST 邊界（選一個有夏令時的 loc）、時刻格式錯誤退回全日不丟日期（timeconv.go:36 那條 fallback）。
- **資料遷移(migrate_timestamps.go)**：塞舊 schema 的字串資料 → 跑 rename→AutoMigrate→backfill 全流程 → 斷言新欄位 start_at/end_at/tz/all_day 值正確，且 `LEGACY_TIME_ZONE` 覆寫生效、每列 tz 有被寫入（利於日後定位修正）。這是「一次性遷移」——**只有一次機會做對**，跑過 prod 就無法重來，測試是唯一能在上線前驗證它的手段。
- **跨層一致性（端到端）**：透過 C6 的 API harness，`entry_add` 帶日期時刻 → 讀回 API → 斷言顯示值一致（存 UTC、顯示本地不偏移）；entries 與 trips 兩張表對同一時區行為一致（避免只改了一半）。

**工作量 / 依賴**：**M**。純函式層可獨立（S）馬上做；跨層那段依賴 C6。**這是「近期改動守護」投報比最高的一項，且遷移只有一次機會，時間敏感。**

---

### C9. 建 LLM agent 行為的迴歸測試（用 mockllm / agentbench，改 prompt/工具白名單時抓到路徑壞掉）

**為什麼是立即優先（會漏掉什麼災難）**
LLM agent 的行為（意圖判斷、工具呼叫序列）**沒有任何迴歸測試**。改 prompt（server/internal/llm 的 thought）或改工具白名單，很容易**靜默弄壞某條路徑**（例如「使用者說刪掉那筆」不再觸發 entry_delete，或多喊一次 entry_add）而沒人發現——這正是「AI 整理」這個核心賣點最不穩定、最難用傳統測試守住的部分。好消息是**既有基礎設施已經幾乎湊齊**，只差把它接成自動化斷言。

**具體怎麼做（利用哪些既有基礎設施）**
- **確定性層（不打真 LLM，快、進 CI，當 C1 gate 的一部分）**：`mockllm` 是 vLLM 相容的動態劇本假 server（script.go / cmd/mockllm tokyoTripScript），已被 C2 的 e2e 驗證能驅動真實工具鏈。把「給定使用者輸入 → 預期的工具呼叫序列」寫成 golden 斷言：對真實 want orchestrator 餵劇本，斷言 entry_add→entry_update→entry_add→entry_delete 的序列與參數（借用 agentbench 的 `Expected`/`paramsMatch`/`evaluateGoal` 概念，goal.go 已有現成的「有沒有呼叫某工具 + 參數對不對」判斷邏輯，可抽成測試 helper）。這一層守的是「工具白名單/dispatch/orchestrator 接線」不被改壞——與真實 LLM 的隨機性無關，穩定可 gate。
- **語意層（打真 LLM，非阻斷、排程或手動觸發）**：`agentbench` 現在是 HTTP 驅動的互動 debug 工具（cmd/agentbench，:8090，供 Claude Code 之類連進來反覆試 thought），**不是 `go test`**。把它的核心（session Create/Run/evaluateGoal）包一層 `go test`，用一組固定 prompt 案例集當「行為基準」：改 prompt 後跑一遍，看意圖判斷達成率有沒有掉。因真 LLM 有隨機性，**不進 push gate**（會 flaky），改成 nightly / 手動 / 改 prompt 的 PR 上選擇性跑，用「達成率門檻」而非「逐字相等」判定。
- 兩層分工的原則：**確定性層擋接線迴歸（可 gate），語意層量行為漂移（不可 gate 只報告）**——別把真 LLM 塞進 push gate。

**工作量 / 依賴**：**M-L**（確定性層 M、語意層 L）。確定性層依賴 C1；語意層可獨立但價值在持續跑。這幾項與後端「LLM 完成判定」修法相關聯。

---

## D. 上線後守門：可觀測性中「測試專家會想要的」那一半

### C10. 讓 /health 反映真實依賴（DB ping + MigrationOK），當 smoke test 與線上探針的可信號源

**為什麼是立即優先（會漏掉什麼災難）**
現在 `/health` 回靜態 `{"status":"ok"}`（api.go:174）——DB 掛了、schema 壞了（`MigrationOK=false`），它照樣回 200。這讓 C3 的 smoke test 與 Cloud Run 的 liveness probe 都在**測一個永遠說謊的訊號**：「活著」不等於「能服務」。這是可觀測性裡測試專家最先要的東西——一個**誠實的健康訊號**，否則自動 rollback 根本觸發不了（health 永遠綠）。

**具體怎麼做（利用哪些既有基礎設施）**
- health handler 加：DB `PingContext`（帶短 timeout，store.go:96 已有帶 timeout 的 ctx 模式可參考）+ 回報 `store.MigrationOK`（store.go:25 這個旗標已存在，只是沒被 health 用）。
- 區分 `/health`（liveness，process 活著就好，給 Cloud Run 重啟判斷）與 `/ready`（readiness，DB+migration 都 OK 才回 200，給 smoke test 與流量切換判斷）——避免「DB 短暫抖動就被 Cloud Run 殺 process」與「schema 壞了仍收流量」兩種誤判。
- 為這兩個端點各寫一條測試（DB 正常→200、注入 DB 錯誤/`MigrationOK=false`→503），釘住「health 會誠實反映依賴」這個承諾本身。

**工作量 / 依賴**：**S**。無前置依賴，**是 C3 smoke test 與 C7 AutoMigrate 測試的共同前置**，應優先做。

---

### C11. 導入結構化 logging（slog），讓失敗案例可重現、可從線上回推測試

**為什麼是立即優先（會漏掉什麼災難）**
目前 0 結構化 log（63 處 stdlib `log.Print`，純文字、無欄位、無 request/trace id）。對測試專家的意義：**線上出事時沒有足夠上下文把它變成一條可重現的測試**。核心流程靜默失敗（LLM 截斷、寫入半套、越權放行）發生時，若 log 沒有帶 channelID/userID/entryID/intent/tool 序列，就只能靠使用者描述猜——這正是「測試（上線前）與可觀測性（上線後）是同一個『能不能及早發現問題』的兩端」的體現。有了結構化 log，一個線上 incident 可以直接回放成 mockllm 劇本或一條 table case。

**具體怎麼做（利用哪些既有基礎設施）**
- 換 `log/slog`（Go 標準庫，零外部依賴），JSON handler，Cloud Run 的 log 天然吃 JSON、能欄位化查詢。
- 在核心流程關鍵節點打結構化事件：`entry.write`（帶 channelID/userID/entryID/result）、`llm.tool_call`（帶 intent/tool/args 摘要/序號）、`llm.complete`（帶是否命中 sleep 窗口 → 直接對應 C7 那個 sleep 破口的線上證據）、`authz.deny`（帶 require 種類/角色/channelID → 越權嘗試留痕）。
- 一個 request-scoped correlation id（middleware 產生、貫穿 log 與 WS）——讓一條使用者操作的完整鏈路可被串起來重放。
- 這一項與後端/架構師清單的「可觀測性」會大幅重疊；測試視角的獨特要求是**欄位要足以重建一條測試案例**（who/what/which-entry/which-tool/outcome），而非只給人看的一行字。

**工作量 / 依賴**：**M**。無硬性前置，但與 C12 共用同一套 slog 基礎，建議一起做。

---

### C12. 定義並上報「關鍵業務指標」作為線上的持續驗證（記事成功率、LLM 回應完成率）

**為什麼是立即優先（會漏掉什麼災難）**
測試只能覆蓋上線前想得到的路徑；**業務指標是「線上的持續驗證」**——它會抓到測試永遠想不到的退化。對這兩條主線最相關的指標：**記事成功率**（entry 寫入成功/嘗試）與 **LLM 回應完成率**（agent 正常完成/被 sleep 截斷/逾時）。若某次改 prompt 後「完成率」從 98% 掉到 80%，這是任何離線測試都抓不到、只有線上指標能發現的靜默退化——正好補上 C9 語意層「不可 gate」留下的缺口。

**具體怎麼做（利用哪些既有基礎設施）**
- 先用**最輕量**做法起步：不急著上 Prometheus/OTel（那是架構師清單範疇），可先用 slog 打 counter 事件（`metric.entry_write{outcome=ok|fail}`、`metric.llm_complete{outcome=ok|truncated|timeout}`），在 Cloud Run log-based metrics 上聚合出儀表板與告警。這樣 C11 一做，這項幾乎順手完成。
- 定義少數幾個「北極星」而非鋪滿指標：記事成功率、LLM 完成率、授權拒絕率（異常飆高=可能有越權攻擊或前端 bug）、p95 assist 延遲（對照那個 1500ms sleep）。
- 設「回歸告警」：完成率/成功率跌破門檻就通知——等於把「線上迴歸」也納入守門，與 C3 smoke（部署當下）互補（smoke 抓「一部署就死」，指標抓「上線後慢慢爛」）。
- 進階（與架構師合流）：升級成 Prometheus/OTel + Grafana，本項先確保「指標的定義與埋點位置」是對的，載體之後可換。

**工作量 / 依賴**：**M**。依賴 C11（共用 slog 埋點）。

---

### C13. 建立 flaky 測試治理與 e2e 覆蓋率可視化（別讓守門員自己先爛掉）

**為什麼是立即優先（會漏掉什麼災難）**
這是「元」層面的守門：測試防線建起來後，最常見的失敗模式是**測試自己 flaky → 大家開始習慣性 re-run / 忽略紅燈 → gate 名存實亡**。這個專案已經有徵兆：e2e spec 註解裡記錄了多個實測到的時序競態（StrictMode 雙掛載 vs WS handshake、mock LLM 過快導致中間態無窗口），作者已用「WS 事件序列 + 條件式略過」謹慎處理——這份謹慎需要制度化，否則 CI 一上，這些偶發就會侵蝕大家對綠燈的信任。同時，前端**零覆蓋率工具**、e2e 也無覆蓋率，我們無法回答「到底守住了哪些路徑、哪些還裸奔」。

**具體怎麼做（利用哪些既有基礎設施）**
- flaky 治理：CI 收集 Playwright trace（config 已設 `retain-on-failure`）與 `-race`/test 輸出為 artifact；建一條規則「同一測試 7 天內 flaky ≥N 次就開 issue 隔離並限期修，不准長期 `skip` 掩蓋」。CI 的 retry 次數必須顯式記錄在 report（呼應 C2），避免用重試把真 flaky 藏起來。
- 覆蓋率可視化：Go 端 `go test -coverprofile` 產覆蓋率，在 CI summary 顯示核心包（api/auth/store/tripsvc）覆蓋率趨勢——**目的不是追高數字，是讓「api/auth 還是 0%」這件事持續刺眼、無法被遺忘**。前端未來若引入 vitest（本輪不強求）再一併納入。
- 明確標示「已知不進 gate」清單（真 LLM 語意層 C9-語意、需外部金鑰的 smoke 深層檢查），與「必進 gate」清單（C1 全 Go 測試、C2 e2e、C9-確定性層）分離，讓守門員的職責邊界清楚、不互相污染。

**工作量 / 依賴**：**S-M**。依賴 C1/C2（要先有 CI 與 e2e 才有東西可治理）。這是讓前面所有防線「長期不退化」的維護項。

---

## 小結：如果只能先做三件事（供合併排序時參考）

按「投報比 × 擋災難級 × 解鎖後續」三重權衡，測試視角的最優先三連：

1. **C1（CI gate）** —— 乘數項，不寫一行新測試就讓現有 8 個測試 + 之後所有測試真的能擋 push；不做這個，其它全被稀釋。
2. **C2（e2e 上 CI 當守門員）** —— 讓唯一一條「核心流程整條能動」的覆蓋真正站崗，改 prompt/改工具/改時間欄位壞了 happy path 會被擋。
3. **C4 + C6（權限矩陣 + API harness）** —— 擋掉最貴的災難（靜默越權），同時把 `internal/api` 從「零測試不可能」變成「後續測試便宜」。

而 **C10（誠實的 health）** 因為同時是 C3 smoke 與 C7 AutoMigrate 測試的前置、成本又只有 S，建議與上述三連並行插隊先做——它是「上線後守門」整條線的地基，且投報比極高。

三條主線的收束：**C1/C2 接底線 → C4/C5/C6/C7 擋災難 → C8/C9 守近期改動與 AI 行為 → C10/C11/C12/C13 補上線後的持續驗證**。測試（上線前）與可觀測性（上線後）在 C3(smoke)、C10(health)、C12(業務指標) 三處交會——這正是「能不能及早發現問題」的完整閉環。
