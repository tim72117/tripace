# 系統架構師的收斂意見 —— 第二輪

讀完後端工程師與測試專家的清單,我這一輪不再提新願景,只做一件事:**把三份清單壓成一條有結構的排序**。先講一個貫穿全局的觀察,再逐點收斂。

先對齊兩個事實。其一,先前資料提到的 `MockBackendService` 並不存在於程式碼,真正可用的 LLM 測試基礎設施是 **`mockllm`(vLLM 相容假 server)+ `agentbench`**——這一點直接影響測試專家 C2/C9 的可行性判斷,採信測試專家的版本。其二,測試專家指出 `store.MigrationOK` 這個旗標**其實已存在(store.go:25),只是沒被 /health 用**。這第二點不只是一個 bug,它是本輪最重要的結構性隱喻:**這個 codebase 的地基零件,常常已經做好一半、只是沒接起來。** 我第一輪講「地基先鋪對」時假設很多東西要從零蓋,但實情更接近「把已鋪好的半條線接通」——這讓不少地基項的成本從 M 掉到 S,也讓「順手鋪地基」的主張更站得住腳。

## 一、高共識項目:確認,但要指定「深淺」

三方都提到的第一梯隊,毫無爭議應排前段:**panic recovery**(我 B1 / 工程師 #1 / 測試 `-race` 間接守)、**誠實 health**(我 A3 / 工程師 #2 / 測試 C10)、**結構化 logging + request ID**(我 A2 / 工程師 #3 / 測試 C11)、**部署後 smoke test**(我 D1 / 工程師 #7 / 測試 C3)。這四項是共識底盤。

但架構師的價值在於指出:**這幾項「表面同名,做法深淺差很多」,最終清單必須明確指定做哪一版。**

- **logging**——這是差最遠的一項。「純止血版」是工程師 #4:給 middleware 補個 status code,多印幾行。「有地基版」是把 request ID 從 middleware 生成、塞進 `context`、貫穿到最底層,成為一條 **context spine**;之後 LLM 錯誤(那 4 處 `fmt.Printf`)、panic recover、metrics 全都掛在同一條線上。測試專家 C11 甚至加碼:欄位要足以**重建一條測試案例**(who/what/which-entry/which-tool/outcome),而非只給人看的一行字。我的立場明確:**這一項必須做有地基版**。理由是 request ID 這條線一旦沒鋪、之後幾乎每一項可觀測性都要回頭重改;而且因為 slog 是 Go 內建、middleware 掛點只有一處,地基版與止血版的成本差其實不大——這正是「已鋪好一半」的紅利。
- **health**——止血版是「加一句 `db.Ping()`」;地基版是 **liveness / readiness 分離**,readiness 納入 `MigrationOK` + DB ping(把 store.go:25 那個旗標接上),並在 Cloud Run 實際掛 probe。做地基版,因為 fail-fast、smoke test、uptime alerting 三者都以「health 說真話」為前提,止血版接不住它們。
- **panic recovery**——止血版是 HTTP middleware 包一層 recover;地基版要**覆蓋所有自己 `go func` 起的 goroutine**(sink、want_analyzer、WS),並且 recover 後當結構化錯誤上報。工程師 #1 說得對:middleware 只保護 handler stack,背景 goroutine 不在上面、照樣崩。這一項**必須做覆蓋背景 goroutine 的版本**,否則等於沒做。
- **smoke test**——止血版是「部署後打一下 /health」;地基版是打 readiness + 一條需要 DB/auth 的唯讀端點 + 失敗即 `update-traffic` 回滾。這一項我同意**可先做止血、地基漸進**(理由見下節)。

一句話:高共識不代表照抄,**logging / health / panic 這三項要做有地基版,smoke test 可先止血。**

## 二、回應工程師的取捨傾向:哪些先止血、哪些堅持順手鋪地基

工程師作為實作者,傾向「有些項目先獨立止血、不必等地基」。我逐項回應——**判準是:這個止血如果不順手鋪地基,之後會不會被打掉重做。**

**我同意「先止血、地基之後補」的:**

- **DB connection pool**(我 B5 / 工程師 #13):幾行 config,無地基可鋪,純止血就是正解。立即做。
- **http.Server timeout + graceful shutdown**(我 B2 / 工程師 #8):顯式 `http.Server{}` + `signal.NotifyContext` 即可,不必等 store context 化。工程師 #8 提醒 WriteTimeout 要遷就 LLM 90 秒長請求,這個耦合真實存在,與 retry timeout 一起定值即可,但不構成「要等地基」的理由。
- **smoke test**(我 D1 / 工程師 #7 / 測試 C3):我同意工程師「先做『失敗不切流量』比全自動 rollback 划算」。`--no-traffic` 起新 revision → smoke 綠了才導流,是正確終局但可漸進。這裡止血與地基是**平滑升級**關係,不會打掉重做,所以先止血合理。
- **store 吃 context.Context**(工程師 #14):工程師標 L、主張「先從最熱路徑開刀、漸進做」。我**同意漸進**——但關鍵是 A1 那條 middleware + context 生成的 **S 部分要先做**(它就是 request ID 的來源),store 簽章 L 的部分可逐檔跟進。地基的「入口」先鋪,「末端」漸進,兩者不衝突。

**我堅持「不順手鋪地基、之後一定打掉重做」的:**

- **LLM retry / 降級**(我 B3 / 工程師 #10):工程師想「包一層 for 迴圈重試」。我堅持 retry **必須掛在 context 上**(帶 context 的指數退避,可被逾時/取消打斷),而非裸 `for`。裸迴圈重試在「shutdown 時砍不掉、取消訊號進不去」兩點上必然要重寫——而 A1 context 主幹本來就要鋪,retry 順勢掛上去幾乎免費。這是典型「止血不鋪地基就白做」。
- **LLM 錯誤出口**(那 4 處 `fmt.Printf`):不能只是各自改成 `slog.Error`。要收進**統一錯誤出口**——我第一輪 A4 的 `AppError{Code, HTTPStatus, Message, Cause}` domain error type。工程師誠實說他「沒單列 domain error type,但 #10/#15 的『錯誤要一致、可見』其實需要它」,並把它讓給架構師主場。我接下這一棒:**沒有統一 error type,錯誤追蹤(C1/我 C1)按 code 聚合、前端統一攔 401、log 按類型過濾這三件事全部做不成**,而且會順帶漏掉「`err.Error()` 把 GORM/SQL 原文洩漏給客戶端」的安全洞。這一項是止血時不鋪、之後必定回頭重接的代表。
- **拆全域序列化點**(工程師 #9 / 我 B7):這裡我反過來**幫工程師踩煞車**。工程師把「拆 `sink.go` 全域鎖」標 L 並列入立即,理由是它同時是效能瓶頸 + DoS + panic 風險放大器。我同意它重要,但**在「立即」範圍內不該做 request-scoped 重構**——工程師自己也註記「建議在 recover 與 log 就位、能觀測後再動,且務必有測試」。我的 B7 立場更清楚:**立即只做低風險護欄**(排隊上限 + 快速失敗 + 排隊深度/等待/拒絕 metrics),把這個天花板從「不可見」變「可觀測」,DoS 面先止住;真正拆單例留到有 metrics 數據 + 有並發測試護體之後。這是「先鋪觀測地基、重構延後」,而非「立刻大改」。

## 三、把測試防線納入結構圖:上線前與上線後是同一條防線的兩端

測試專家最關鍵的一句是「**CI 沒跑測試比測試太少更該先解決**」——現有 8 個 Go 測試 + e2e 因為 CI 不跑,等於「形同虛設」。從架構師視角,這句話點破了一件事:**測試防線(上線前)與可觀測性(上線後),是同一個「及早發現問題」能力的兩端。** 前者在部署前攔,後者在部署後偵測,中間由 smoke test 這道「部署當下」的閘門銜接。

在「單一 prod、push main 直接上線」的現實下,這條防線缺任何一段都會漏。具體怎麼搭:

**「核心功能不會靜默壞掉」需要三件事合起來才構成完整防線:**

1. **權限矩陣測試**(測試 C4)——擋「viewer 能改別人行程」這種**靜默越權**(不 crash、功能照跑、只是權限破洞)。這是上線前唯一能釘住授權正確性的手段,`internal/api` 810 行目前零測試。
2. **誠實 health**(我 A3 / 測試 C10)——擋「schema 壞了但 health 還綠、流量繼續灌」。這是上線當下 smoke test 與 probe 能不能觸發 rollback 的信號源。
3. **smoke test**(我 D1 / 測試 C3)——擋「一部署就死」(漏 secret、DB 連不上),抓的是上線前測試碰不到的真實環境問題。

這三者的分工:**C4 管「邏輯對不對」、C10 管「依賴通不通」、C3 管「這次部署活不活」**——時間軸上分別是上線前、上線瞬間、上線後,合起來才是一條「核心功能不會靜默壞掉」的閉環。少了 C4,越權在上線前就漏過;少了 C10,C3 和 probe 測的是一個永遠說謊的信號;少了 C3,設定類事故直接 100% 打到使用者。

CI gate(測試 C1)則是這一切的**乘數與總開關**:它必須是 branch protection 的 required check,否則「紅了就擋」只是願望。C1 不寫一行新測試,只把已有資產接上電——這是投報比最高的單一項,且是 C4/C2/C8 所有測試項生效的前提。**在最終 10 項裡,C1 應與 health 並列最前段**:一個讓上線前的測試真的能擋、一個讓上線後的信號說真話,分居防線兩端的地基。

## 四、最終 10 項的推薦排序骨架

排序原則,我主張**分層**——按「一個問題從發生到被解決」的時間軸鋪:

> **先能看見(health + log + CI 讓測試說真話)→ 再擋崩潰(panic + timeout + pool)→ 再守迴歸(關鍵測試)→ 最後補監測(error tracking + alerting + metrics)**

這個順序的邏輯是:沒有「看見」,後面擋了什麼、守住什麼都無從驗證,所以可觀測性地基與 CI gate 打頭;崩潰類(panic/timeout)是「一點壞全站壞」,緊接其後;迴歸類守住「重構不無聲退化」;監測類(主動告警/指標)補「壞了立刻知道」的最後一哩。

**前 6 名具體建議(不可讓步的前段):**

1. **誠實 health(liveness/readiness 分離 + MigrationOK + DB ping)** — 我 A3 / 工程師 #2 / 測試 C10。成本 S(旗標已存在,只差接),是 smoke/alerting/fail-fast 的共同前置,三方共識最強。
2. **CI gate(go build + vet + test -race + branch protection required)** — 測試 C1。乘數項、S、無依賴,讓現有測試從「形同虛設」變「真能擋」。與 health 並列,是整條防線的總開關。
3. **結構化 logging + request ID(context spine 版,含收編 4 處 LLM `fmt.Printf`)** — 我 A2 / 工程師 #3+#4 / 測試 C11。必做地基版,它是 panic 上報、retry、error tracking、metrics 的共同掛點。
4. **panic recovery(HTTP + 所有背景 goroutine + 結構化上報)** — 我 B1 / 工程師 #1。必做覆蓋背景 goroutine 版,「一點壞全站壞」的最直接止血。
5. **http.Server timeout + graceful shutdown + DB connection pool** — 我 B2+B5 / 工程師 #8+#13。兩項都是 S、純止血即正解、直接對抗「頻繁換 revision 砍掉進行中請求」與「連線打爆 Cloud SQL」兩個系統級單點,合併為一格。
6. **權限矩陣測試 + API 測試 harness** — 測試 C4+C6。安全面投報比最高,擋靜默越權;harness 是 C4 前置,一併做讓 `internal/api` 從「零測試不可能」變「後續測試便宜」。

**7-10 名的候選池**(配比見下):deploy smoke test(C3)、LLM retry+降級+統一 error type(B3+A4)、時間欄位大改動迴歸測試(C8,遷移只有一次機會、時間敏感)、uptime + alerting(C2/我 C2)、序列化點護欄+metrics(B7)、錯誤追蹤(C1)。這一段要在最終會議定案。

**兩條主線的配比:** 前 6 名裡,「可觀測性/信號」佔 1、2、3(health、CI、log)三席,「核心功能穩定性」佔 4、5、6(panic、timeout+pool、權限測試)三席——**刻意 1:1**。我第一輪偏重可觀測性,但讀完兩份清單後修正:在無 staging 下,可觀測性是「看得見」的必要條件,但**看得見不等於不會壞**;工程師的崩潰類止血(panic/timeout/pool)投報比同樣極高且幾乎無依賴,測試專家的權限矩陣則補上「看得見與穩定都無法覆蓋的靜默越權」。三方合起來,恰好是「看見 / 不崩 / 不越權」三足。7-10 名則讓可觀測性略微加碼(error tracking + alerting + metrics 這條「上線後主動告警」線),把配比拉到約 **6:4 偏可觀測性**——因為 push main 直接上線的節奏下,「壞了立刻知道」的邊際價值最高。

## 五、三方合起來仍有的結構性盲點

補三個沒人單獨扛起的:

1. **多步驟寫入的交易邊界**(工程師 #15 / 測試 C7 提到但都當附屬)。entry 寫入、trip 歸組、message 關聯**分開寫、不在同一交易**,中途失敗(LLM 段本就易失敗)會留半套資料——「存檔→顯示」一致性的直接破口。這比「顯示錯亂」更陰險:資料層已經不一致,任何上層修補都是在髒資料上疊。它與 store context 化(#14)綁,但**交易邊界本身是獨立的正確性問題**,不該被 context 化的 L 工作量拖住。建議至少把 entries 那組寫入包進 `Transaction`,列入 7-10 池。
2. **統一 error type 是「三份清單的公共前置,卻沒人放進自己的前段」**。工程師讓給我、測試 C11 需要它做欄位、我第一輪列 A4 但排在 B 段之後。實際上它是 log 聚合、error tracking、前端攔截、安全(不洩漏 SQL 原文)四件事的共同上游。**它應該從「A4 附屬」升格為與 logging 綁定的同一批工作**——logging 鋪 context spine 時,順手把錯誤出口統一,一次到位。
3. **GH_PAT 單點失效沒有第二人提**(我 D2)。`want` 是 v0.0.2 私有套件、需 `GH_PAT` 拉取,**PAT 過期則所有部署立即中斷**——連緊急修復都推不上去。在單一 prod 下,部署管道本身斷掉是最壞一類故障。完整解(vendor/fork)是 L、非立即;但**「PAT 過期要有 alerting」是 S**,把單點失效變成可預警,應搭 alerting 那格順手做。這是唯一一個「連止血通道本身都會斷」的風險,值得在最終清單保留一個位置或至少掛在 C2 alerting 底下。

一句話收束:這一輪的結論不是「誰的項目更重要」,而是**這三份清單其實在描述同一條防線的不同時間段**——上線前(測試)、上線瞬間(health + smoke)、上線後(log + metrics + alerting)。最終 10 項應該讓每個時間段都有地基,而不是把資源全押在其中一段。而收斂過程最大的意外收穫,是那個 `MigrationOK` 已存在卻沒接的事實提醒我們:**很多「地基」不是要新蓋,是要把已鋪好的半條線接通**——這讓「順手鋪地基」的主張,比第一輪我以為的更便宜、也更該堅持。
