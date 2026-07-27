# 可觀測性方案研究：系統狀態、用戶行為、異常偵測

> 研究時點：2026-07。文中的免費額度、計費級距為「抓數量級與計費模式」用途，**實際數字請以各服務官網為準**（雲端定價變動頻繁，本文只保證量級與計費邏輯，不保證單價精確到分）。
>
> 本文是方案研究與比較文件，不含任何實作程式碼，也不涉及修改專案。

---

## 0. 前情提要：這個專案現在長什麼樣

在比較方案之前，先把「現況」釘死，因為所有契合度、導入難度、維運負擔的判斷都建立在這個基礎上。以下為實際掃過 codebase 後確認的事實：

**後端（`server/`）**
- Go 1.26.3，標準庫 `net/http`（無 web framework），GORM + SQLite（本機）/ Postgres（正式，Cloud SQL）。
- 依賴清單（`server/go.mod`）裡**沒有任何 observability 套件**：無 OpenTelemetry、無 Prometheus client、無 Sentry SDK、無 `slog` handler、無任何結構化 log 框架。
- 目前 log 全部是標準庫 `log.Printf`，全專案約 60 個呼叫點。部分已經有「半結構化」的味道（例如 `[clienttools-ws] session %s closed: %v`、`[migrate] ...`），但本質仍是純文字行，沒有機器可解析的欄位。
- LLM 呼叫透過私有套件 `github.com/tim72117/want v0.0.2`（agent 編排引擎，被 26 個檔案 import）。這是很早期的版本號，且是黑箱——**它內部有沒有 emit trace/log 是未知數**，這點會影響「LLM 呼叫的 tracing」能做到多細。
- 有一支 HTTP middleware（`server/internal/api/middleware.go`）已經在記錄每個請求的 `method / path / 耗時`——這是未來要接指標/tracing 時**天然的 instrumentation 掛載點**，是個小加分。
- 部署：**GCP Cloud Run**，distroless 映像，`CGO_ENABLED=0` 靜態編譯的單一 binary。Dockerfile **沒有 `HEALTHCHECK`**。

**前端（`web/`、`web/admin/`）**
- React 18.3 + Vite + TypeScript，純 CSR。
- `package.json` 裡**沒有任何分析/追蹤/監控 SDK**：無 GA4、無 PostHog、無 Sentry、無 Mixpanel、無 Amplitude。
- 一個重要的細節：主 `web/` 專案的自我描述是「**Tripace 後端開發測試台——套 iPhone 外框的 web app，用於開發時測試 Go server**」。也就是說，這個 web 前端在目前定位上比較像**開發/測試主控台**，真正面向終端使用者的產品主要是 iOS App（`ios/`）加上這個 web 殼。做「用戶行為分析」時要意識到：**要埋點的「產品」到底是誰**會影響選型（web SDK vs 行動端 SDK vs 後端事件）。

**部署與團隊現實**
- **只有單一 prod 環境**，無 dev/staging，push main 直接上線。
- GCP 專案分散在兩個（`shuttle-045094509` 放 Cloud Run/Secret Manager、`onagent-prod` 放 Cloud SQL），是改名遺留的歷史問題——跨專案的監控聚合會稍微麻煩一點點（但不是阻礙）。
- 小團隊維運。`docs/PROJECT_HEALTH_REVIEW.md` 已明文點出「沒有 APM/tracing/error-tracking 整合」，並記錄了一次**真實事故**：`adminserver` 曾漏設 `AI_PROVIDER` / `GOOGLE_API_KEY` / `GOOGLE_PLACES_API_KEY`，導致健康檢查在正式環境一直回報未設定卻沒人即時發現（commit `dba5145`）。**這個事故正是本研究最好的動機**：一個「閾值告警 + 錯誤追蹤」的基礎層，本來就該把這種問題更早攔下來。

**一句話總結現況**：完全空白、零 sunk cost、零工具鏈包袱，但也沒有任何既有東西可延用。這是「從零選型」的最佳時機，也意味著**每一分導入成本都是淨新增**，所以「摩擦力」在這個專案裡的權重要調高。

---

## 1. 需求拆解與方案版圖（先建立共同語言）

三類需求，各自對應到不同的「資料形態」和「工具家族」。先把地圖攤開，後面三大節才不會混淆。

| 需求 | 資料形態 | 典型問題 | 工具家族 |
|---|---|---|---|
| **① 系統狀態**（infra/backend health） | Metrics（時序）＋ infra logs | 服務活著嗎？延遲多少？錯誤率？CPU/記憶體？LLM 呼叫成功率？ | GCP Monitoring／Prometheus+Grafana／Datadog／Grafana Cloud／New Relic |
| **② 用戶行為 — 產品分析粒度** | Events（誰做了什麼） | 漏斗、留存、功能使用率、記事流程完成率 | PostHog／GA4／Amplitude／Mixpanel／Plausible／Umami |
| **② 用戶行為 — 工程追蹤粒度** | Traces（一次請求的全貌）＋ session replay | 這個使用者這次請求卡在哪、錯在哪？前端畫面當下發生什麼？ | OpenTelemetry + Tempo/Jaeger／Cloud Trace／Sentry（tracing + replay）／Datadog APM |
| **③ 異常偵測（基礎層）** | Exceptions（聚合去重）＋ 告警規則 | 有沒有新的 crash？5xx / 延遲 / 錯誤率超標了嗎？ | Sentry／GlitchTip／Error Reporting／Cloud Monitoring alerting／Alertmanager |

**三大類現成方案**（本文每一節都會用這個分類來掃）：
1. **GCP 原生**：Cloud Logging、Cloud Monitoring、Cloud Trace、Error Reporting、Cloud Profiler。專案已在 Cloud Run 上，這類的整合摩擦力理論上最低。
2. **第三方 SaaS**：系統/工程面向有 Sentry、Datadog、Grafana Cloud、New Relic；產品分析面向有 PostHog、GA4、Amplitude、Mixpanel。
3. **自架開源**：Prometheus + Grafana + Alertmanager、Loki、Tempo/Jaeger、OpenTelemetry Collector、Plausible/Umami/PostHog 自架、GlitchTip。

**「自建方案」的定義**（本文對每一類都會單獨評估）：不用上述任何現成產品的後端/介面，完全自己刻。包含一個關鍵的**灰色地帶**——「結構化 log 到 stdout，讓 Cloud Run 自動收進 Cloud Logging」。這條路嚴格說是「半自建、半利用 GCP 收集層」，本文會明確把它標出來，因為它往往是這個專案 CP 值最高的第一步。

---

## 2. 系統狀態（Infra / Backend Health）

**目標子項**：服務健康（up/down）、延遲（latency / p50-p99）、錯誤率（5xx 比例）、資源使用（CPU/記憶體/instance 數）、**LLM 呼叫延遲與成功率**、Cloud Run 與 Cloud SQL 的原生指標。

### 2.1 現成方案比較

| 方案 | 能力涵蓋（系統狀態子項） | 與本專案契合度 | 導入難度 | 維運負擔 | 成本（量級） | 適合小團隊？ |
|---|---|---|---|---|---|---|
| **GCP Cloud Monitoring + Cloud Logging（原生）** | Cloud Run/Cloud SQL 的 request count、latency、5xx、CPU、記憶體、instance 數**開箱即有**，不埋任何碼。LLM 成功率需自訂指標。 | **極高**。已在 Cloud Run，指標自動流入，logs 自動收集。零 SDK、零 sidecar。 | **極低**：系統層幾乎 0 工。自訂指標（LLM）需寫 log-based metric 或自訂 metric，中等。 | **極低**：Google 全託管，無元件要維護。 | 系統 metrics（GCP-native）免費；Cloud Logging 每專案 **50 GiB/月免費**，之後約 $0.50/GiB。留意 **2026-09 起每個被 alert 引用的 metric 約 $0.35/月**。 | **非常適合**。零維運、零 sunk cost。 |
| **Grafana Cloud（SaaS）** | Prometheus 相容 metrics、Loki logs、Tempo traces、告警、現成 dashboard，一站式。 | 中高。需在 Go 端加 Prometheus client 或 OTel exporter，把 Cloud Run 指標搬過去要額外 scrape/推送設定。 | **中**：要接 exporter/agent，設 remote-write。 | 低（後端託管），但要顧「資料怎麼送出去」的那條管線。 | 免費層很實在：**10K active series + 50GB logs + 50GB traces，14 天保留，3 users**，不用信用卡。超過走用量計費。 | 適合，但相對 GCP 原生多一層「把資料送出 GCP」的功。 |
| **Datadog（SaaS）** | 全家桶：infra metrics、APM、log、dashboard、alerting、LLM Observability 專屬模組。能力最完整。 | 中。Go 有官方 SDK/agent，但 Cloud Run 上要跑 agent（sidecar 或 serverless init）較繁瑣。 | **中高**：agent + 各模組串接。 | 低（託管），但**設定面複雜、概念多**。 | 免費層很有限（主機數/保留短）。**按主機 + 用量計費，是本清單裡最容易「量一大就貴」的**。 | **偏不適合**：能力遠超現階段需求，成本與複雜度對小團隊過重。 |
| **New Relic（SaaS）** | 全家桶 APM + infra + log + alert，Go agent 成熟。 | 中。Go APM agent 需埋，Cloud Run 可跑。 | 中高。 | 低（託管）。 | 有「**每月 100GB 資料免費 + 1 個 full user 免費**」的獨特模式，對單人/雙人團隊意外友善；超過按資料量 + user 數計費。 | 尚可：免費額度對小團隊友善，但整套概念仍偏重。 |

**GCP 原生的細節補充**：Cloud Run 本身就把 request 數、延遲分佈、instance 數、CPU/記憶體、容器啟動延遲等**內建指標**直接送進 Cloud Monitoring，Metrics Explorer 立刻能畫，這些**完全不用改一行程式**。Cloud SQL 同理有 CPU、連線數、磁碟、複製延遲等原生指標——只是它在**另一個 GCP 專案**（`onagent-prod`），跨專案看指標要嘛切專案、要嘛做 metrics scope 聚合，是唯一的小摩擦。**唯一需要自己動手的是「LLM 呼叫延遲與成功率」**，因為那是應用層語意，GCP 不會自動知道；做法是在呼叫 `want` 的前後記錄，用 log-based metric 或 OpenTelemetry/自訂 metric 產出。

### 2.2 自架開源方案評估

代表組合：**Prometheus（拉指標）+ Grafana（畫圖）+ Alertmanager（告警）**，log 聚合再加 **Loki**。

- **能力**：能力天花板很高，是業界事實標準，dashboard 與告警彈性極大。
- **與本專案契合度 / 導入難度**：Go 有官方 `prometheus/client_golang`，加一個 `/metrics` endpoint 很直覺。**但真正的痛點是「Prometheus 的 pull 模型 vs Cloud Run 的 serverless 生命週期天生不合」**——Cloud Run instance 會自動縮到 0、IP 不固定、會頻繁增減，Prometheus 「定期去 scrape 一個固定 target」的假設在這裡站不住腳。要嘛改用 push（Pushgateway，但它本身有語意坑）、要嘛改用 OTel + remote-write。**這是一條明顯逆風的路。**
- **維運負擔**：**這是關鍵扣分**。你得自己跑 Prometheus + Grafana + Alertmanager（+ Loki）這幾個常駐服務、自己顧它們的儲存（時序資料會長）、自己備份、自己升級、自己扛可用性。對一個「單一 prod、無 staging、小團隊」而言，**你等於為了監控主服務，又養出了一組需要被監控的服務**——這是典型的「監控系統自己掛了誰來告訴你」悖論。
- **成本**：軟體免費，但**運算/儲存/人力全是你的**。要嘛在 GCE 開 VM（又是要顧的機器），要嘛上 GKE（對這個規模是殺雞用牛刀）。
- **適合小團隊？** **不適合**，除非有強烈的「不想被雲鎖定 / 要極度客製」動機。以現階段來說，這條路帶來的維運負擔遠大於它相對 GCP 原生多出來的能力。

### 2.3 純自建方案評估（完全自己刻）

「不用任何現成工具，自己刻系統狀態監控」大概長這樣，以及能做到什麼程度：

- **最小版**：自己寫一個 `/healthz`（回 200 + 檢查 DB/LLM 可達性）+ 一個 `/metrics-lite`（回一個 JSON：累計請求數、錯誤數、平均延遲、LLM 成功率，用記憶體裡的計數器）。前者接上 Cloud Run 健康檢查或外部 uptime 監控；後者人工開來看。
- **能做到的程度**：**能回答「活著嗎」和「大致的即時數字」，但僅此而已。** 記憶體計數器在 Cloud Run 縮到 0 或多 instance 時會歸零/分裂，沒有歷史、沒有趨勢圖、沒有告警。要補這些，你就是在重新發明 Prometheus + Grafana + Alertmanager——**這是明顯不划算的重造輪子**。
- **結論**：純自建在「系統狀態」這一類**最沒有意義**，因為 GCP 原生已經免費把 80% 的活兒幹完了。

### 2.4 灰色地帶：`slog` 結構化 log → Cloud Run 自動收進 Cloud Logging

這是本專案 CP 值最高的一步，值得單獨講。

- **做法**：把後端 60 處 `log.Printf` 逐步換成 Go 1.21+ 標準庫 `log/slog`，用 JSON handler 輸出到 stdout。Cloud Run **自動**把 stdout 收進 Cloud Logging，且如果 JSON 欄位符合 Cloud Logging 的結構化慣例（如 `severity`、`message`、`trace`），就能在 Logs Explorer 裡**按欄位過濾、依 severity 分級、依 trace id 串連**。
- **為什麼算「灰色地帶」**：instrumentation 是你自己刻的（自建），但收集、儲存、查詢、保留全靠 GCP（利用現成）。**你只付出「改 log 格式」的成本，就換到一個能結構化查詢的 log 平台。**
- **能做到的程度**：涵蓋「系統狀態」的一大塊（可查詢的營運 log）、並且是「異常偵測」和「工程追蹤」的地基（見第 4、3 節）。**遷移成本低、風險低、沒有 vendor lock-in（slog 是標準庫，換平台也不用改埋點）**——這是幾乎無腦該做的事。

### 2.5 小結：系統狀態

- **GCP 原生（Cloud Monitoring + Logging）是壓倒性的預設選擇**：零埋碼、零維運、免費額度覆蓋現階段，且專案本來就在 Cloud Run 上。
- **唯一要自己補的是 LLM 呼叫的延遲/成功率**——用 log-based metric 或自訂 metric 補上即可，工作量小。
- **配合 `slog` 結構化 log** 打底，系統狀態這一類幾乎不用花錢也不用養任何元件就能達到「堪用甚至好用」。
- **Prometheus/Grafana 自架與純自建都不建議**：前者維運負擔與 Cloud Run 的 pull 模型逆風、後者是重造輪子，兩者相對 GCP 原生多出來的能力都不值得那份成本。

---

## 3. 用戶行為（兩種粒度都要）

這一節要特別小心：**「用戶行為」在本專案裡是兩種完全不同的東西**，工具家族不重疊，得分開處理。

### 3A. 產品分析粒度（漏斗、留存、功能使用、記事流程完成率）

**目標子項**：使用者在產品裡做了什麼——事件流、漏斗轉換、留存曲線、哪些功能被用、記事流程從「開始輸入」到「AI 整理完成」的完成率。

#### 3A.1 現成方案比較

| 方案 | 能力涵蓋（產品分析子項） | 與本專案契合度 | 導入難度 | 維運負擔 | 成本（量級） | 適合小團隊？ |
|---|---|---|---|---|---|---|
| **PostHog（SaaS 雲版）** | 事件分析、漏斗、留存、path、feature flag、A/B、**session replay**、甚至 error tracking，一站式產品可觀測性平台。 | **高**。有 JS SDK（前端）、Go SDK（後端埋事件）、React 整合。web 與後端都能送。 | **低-中**：裝 SDK、埋幾個關鍵事件即可起步。 | 極低（雲版託管）。 | **免費層非常大方**：約 **1M events/月 + 5K session recordings/月 + 100K exceptions/月 + 1M feature flag 請求/月**，重點是**每月重置**、成員無上限。超過走用量計費。 | **非常適合**：免費額度大到現階段幾乎不可能用完，且一個工具就把「產品分析 + replay + 錯誤追蹤」都涵蓋了。 |
| **GA4（Google Analytics 4）** | 事件、漏斗、留存、受眾、轉換。與 Google 生態（Ads、BigQuery export）整合好。 | 中。前端裝 gtag/SDK。**偏行銷/受眾分析視角**，產品工程視角的細粒度事件分析不如 PostHog 直覺。 | 低（前端埋點）。 | 極低（託管、免費）。 | **免費**（標準版對這個規模綽綽有餘）；BigQuery export 另計但量小可忽略。 | 適合，但**產品分析的「工程手感」不如 PostHog**，且資料模型偏行銷。 |
| **Mixpanel（SaaS）** | 事件分析、漏斗、留存的老牌強者，報表細緻。 | 中。前端/後端 SDK 齊全。 | 低-中。 | 極低（託管）。 | 有免費層（月事件數上限），超過按 event/MTU 計費。 | 尚可：能力聚焦產品分析、好用，但單一用途，不像 PostHog 一魚多吃。 |
| **Amplitude（SaaS）** | 與 Mixpanel 同級的產品分析平台，行為分析、留存、實驗。 | 中。SDK 齊全。 | 低-中。 | 極低（託管）。 | 有免費層（月事件上限），超過計費。 | 尚可，定位同 Mixpanel。 |

**產品分析選型的核心判斷**：這一類**幾乎沒有理由自建**（見 3A.3），現成 SaaS 的免費層都足夠現階段。差別在「一魚多吃 vs 單一用途」和「工程視角 vs 行銷視角」：
- **PostHog** 最貼合這個專案，因為它的免費層**同時覆蓋了產品分析、session replay（工程追蹤的一半）、和 exception tracking（異常偵測的一半）**——對一個想用最少工具解決最多需求的小團隊，這是極大的加分。
- **GA4** 若團隊已重度使用 Google 生態、或有行銷/受眾分析需求，是零成本的合理選擇，但產品工程視角較弱。
- **Mixpanel / Amplitude** 是純粹的產品分析強者，但單一用途，在「小團隊想少養工具」的前提下優先序低於 PostHog。

#### 3A.2 自架開源方案評估

- **輕量派：Plausible / Umami**——這兩個是「隱私友善的 GA 替代品」，主打**網站流量分析**（PV、UV、來源、跳出率）。**它們做的是「網站分析」，不是「產品事件分析」**：能告訴你「多少人來、從哪來」，但**做不了漏斗、留存、記事流程完成率這種基於自訂事件的分析**。對本專案「記事流程完成率」這種需求，Plausible/Umami **能力不足**。它們自架很輕（單一服務 + 一個 DB），但因為能力不匹配，這裡不是好選項。
- **重量派：PostHog 自架版**——能力等同雲版，但**自架成本極高**：官方架構需要 ClickHouse + Kafka + Postgres + Redis 一整套，運維這組東西的門檻遠超小團隊能力，也和「單一 prod、小團隊」的現實嚴重衝突。**既然雲版免費層這麼大，自架 PostHog 在現階段完全沒道理。**

#### 3A.3 純自建方案評估（前端自己埋點打自家 API 存 DB 再自己查）

- **做法**：前端在關鍵動作（開始記事、送出、AI 整理完成、查看時間軸…）呼叫自家後端一個 `/events` endpoint，後端寫進一張 `events` 表（GORM），之後用 SQL 自己查漏斗/留存。
- **能做到的程度**：**「記錄原始事件」很容易，但「從原始事件算出有用的產品洞察」極難。** 漏斗、留存、cohort、path 分析這些看似簡單，實際上每一個都是**需要精心設計的 SQL / 資料模型**（留存要定義 cohort 與時間窗、漏斗要處理事件順序與去重、path 要遞迴…），而且**沒有 UI**——每次想看新角度都要寫新 query。你等於在重新發明 Mixpanel/PostHog 的分析引擎與報表層。
- **額外代價**：事件寫進**主資料庫**會增加 prod DB 負載與資料膨脹；要做對還得考慮批次寫入、非同步、取樣。
- **結論**：**這是三類需求裡「自建最不划算」的一項。** 產品分析工具的價值 90% 在「分析與視覺化」而非「儲存」，而免費 SaaS 已經把這 90% 免費送你。**強烈不建議自建。**

#### 3A.4 小結：產品分析

- **直接用現成 SaaS，且免費層綽綽有餘**。首選 **PostHog 雲版**（一個工具吃下產品分析 + replay + exception，免費額度現階段用不完）；若偏好 Google 生態或只要基本流量/行為，**GA4** 是零成本備選。
- **自架（含 PostHog 自架、Plausible/Umami）與純自建都不建議**：Plausible/Umami 能力不匹配（只做網站分析不做事件分析）、PostHog 自架運維過重、純自建是重造分析引擎。
- **一個必要提醒**：埋點的對象是誰要先想清楚。既然主 `web/` 目前偏「開發測試台」，真正該埋產品分析的可能是 **iOS App** 與正式對外的使用者入口——選 PostHog/GA4 時要確認**對應平台的 SDK**（web / iOS）都到位。

---

### 3B. 工程追蹤粒度（追某一個使用者的某一次請求發生了什麼）

**目標子項**：distributed tracing（一次請求跨 handler → DB → LLM 呼叫的完整耗時分解與失敗點）、request-level 追蹤（把某個 user 某次操作的後端行為串起來）、session replay（重現前端當下畫面與操作）。

#### 3B.1 現成方案比較

| 方案 | 能力涵蓋（工程追蹤子項） | 與本專案契合度 | 導入難度 | 維運負擔 | 成本（量級） | 適合小團隊？ |
|---|---|---|---|---|---|---|
| **GCP Cloud Trace（原生）** | 分散式 tracing：request 級的 span 樹、延遲瓶頸定位。Cloud Run 有基本整合，OTel 送 trace 進來即可。 | **高**。已在 Cloud Run，OTel Go SDK → Cloud Trace exporter 直送，無 sidecar。 | **中**：要在 Go 端接 OpenTelemetry SDK 並手動包關鍵 span（尤其 LLM 呼叫）。 | 極低（託管）。 | **每月 2.5M spans 免費**，之後約 $0.20/百萬 span。現階段幾乎全免費。 | **適合**：後端 request 級追蹤靠這個很划算。**但它不做前端 session replay。** |
| **Sentry（SaaS）— performance/tracing + session replay** | 錯誤追蹤 + performance tracing（含 trace）+ **前端 session replay**（重現使用者畫面）。**跨前後端串同一個 trace**。 | **高**。前端 `@sentry/react`、後端 `sentry-go` 都成熟，Cloud Run 可跑。 | **中**：前後端各裝 SDK；tracing 需設取樣率。 | 極低（託管）。 | **免費 Developer 層**：約 **5K errors/月**，含少量 spans 與 replays（量小）。tracing/replay 量大要付費（Team 約 $26/月起）。 | **很適合**：**唯一在免費/低價層同時給你「後端 tracing + 前端 session replay + 錯誤追蹤」的方案**，一個工具打通工程追蹤 + 異常偵測。 |
| **Datadog APM（SaaS）** | 頂級 APM、分散式 tracing、trace-log 關聯、（RUM 另購含 replay）。 | 中。需 agent + SDK，Cloud Run 上較繁瑣。 | 中高。 | 低（託管），設定複雜。 | 按用量/主機計費，容易貴。 | **偏不適合**：對現階段過重過貴。 |
| **Grafana Cloud（Tempo）+ OTel** | 分散式 tracing（Tempo），與 metrics/logs 同平台關聯。 | 中高。OTel Go SDK → Grafana Cloud。 | 中。 | 低（後端託管）。 | 免費層 **50GB traces/月**。 | 適合系統狀態已選 Grafana Cloud 時順帶；**但不含前端 session replay**。 |

**工程追蹤選型的核心判斷**：
- **後端 request-level tracing** 有兩條乾淨的路：**Cloud Trace**（若系統狀態已用 GCP 原生，這是同生態、免費額度大、零額外平台）或 **Grafana Cloud Tempo**（若已選 Grafana Cloud）。兩者都靠 **OpenTelemetry Go SDK** 埋點——**這一步是這一類的主要工作量**：要在 middleware 起 root span、在 DB/LLM 呼叫處包 child span。好消息是專案已有一支記錄 method/path/耗時的 middleware，是 OTel 的天然掛載點；壞消息是 **`want` 是黑箱**，LLM 內部的細粒度 span 可能只能包到「呼叫 want 的整段」而看不進它內部。
- **前端 session replay** 是完全不同的東西，GCP 原生**沒有**。要 replay，實務上就是 **Sentry**（或 PostHog，其免費層也含 replay）。
- **Sentry 的獨特價值**：它是**唯一在免費/低價層就同時把「後端 tracing、前端 session replay、錯誤聚合」串在一個 trace/一個工具裡**的方案。當一個使用者回報「我剛剛送出記事後畫面卡住」，Sentry 能讓你：看前端 replay 畫面 → 順著同一個 trace 跳到後端這次請求的 span → 看到是 LLM 呼叫逾時 → 看到聚合後的 exception。**這種「一條線索串穿前後端」的體驗，正是工程追蹤最想要的，而它同時就把第 4 節的異常偵測也解決了。**

#### 3B.2 自架開源方案評估

- **Jaeger / Tempo（tracing 後端）+ OpenTelemetry Collector**：能力完整，是自架 tracing 的標準組合。埋點層一樣是 OTel SDK（和用 Cloud Trace/Grafana Cloud 完全一樣），差別只在「trace 資料送去哪」。
- **維運負擔**：又是「多養一組常駐服務（Collector + Jaeger/Tempo + 其儲存後端）」的問題，和 2.2 節 Prometheus 自架同病。trace 資料量可能很大，儲存與保留要自己扛。
- **session replay 自架**：rrweb（PostHog replay 底層的開源函式庫）理論上可自架收集，但要自己搭收集、儲存、播放、隱私遮罩——**工程量巨大，對小團隊不現實**。
- **結論**：**不建議自架**。埋點成本和用託管方案一樣（都是 OTel SDK），但你額外扛了整個 trace 後端的運維——**多花的力氣沒換到多的能力**。

#### 3B.3 純自建方案評估

- **後端 request-level 追蹤的「窮人版」**：給每個請求產生一個 `request_id`（middleware 塞進 context），所有 `slog` log 都帶上這個 id，並在 LLM 呼叫前後、DB 操作前後記錄耗時。之後在 Cloud Logging 用 `request_id` 過濾，就能把「某次請求發生了什麼」串起來看。
  - **能做到的程度**：**意外地實用，且成本極低。** 這其實就是「結構化 log + correlation id」，能回答絕大多數「這次請求卡在哪、錯在哪」的問題，只是**沒有 span 樹的視覺化**（你是在讀 log 行，不是看瀑布圖）。對這個規模的專案，**這條路可能就足夠了**，且它是 2.4 節 `slog` 那步的自然延伸。
- **前端 session replay 的自建**：**基本不可行**。自己刻 DOM 錄製/重播/遮罩是一個獨立的大工程，不值得。要 replay 就用 Sentry/PostHog。
- **結論**：**後端 request 追蹤「窮人版」（request_id + slog）是很划算的起點**，能用極低成本覆蓋大部分需求；**要「span 瀑布圖」再上 OTel + Cloud Trace；要「前端 replay」就只能靠 SaaS。**

#### 3B.4 小結：工程追蹤

- **後端**：起點用 **`request_id` + `slog` 結構化 log**（窮人版 request 追蹤，成本極低、是 slog 那步的延伸）；需要 span 瀑布圖時，加 **OpenTelemetry Go SDK → Cloud Trace**（同 GCP 生態、免費額度大）。
- **前端 session replay**：GCP 原生做不到，只能靠 **Sentry**（免費層即含）或 **PostHog**（免費層即含）。
- **一個關鍵的「順手」**：若異常偵測選了 **Sentry**（見第 4 節），則後端 tracing + 前端 session replay + 錯誤聚合**一次到位、同一條 trace 串穿前後端**——這是把 3B 和第 4 節**合併解決**的最省力路徑。
- **自架 Jaeger/Tempo 與自建 replay 都不建議**：埋點成本一樣、卻多扛後端運維或巨大工程量。

---

## 4. 異常偵測（基礎層：錯誤追蹤 + 閾值告警）

**明確範圍**：**只要基礎層**，不做進階自動異常偵測/基線學習。兩個子項：
1. **錯誤追蹤**：exception 聚合去重（同一個錯誤發生一千次聚成一條、附 stack trace、發生次數、首末次時間、受影響 release）。
2. **閾值告警**：固定 threshold 觸發通知（5xx 率、延遲、錯誤率超標就發 Slack/Email）。

### 4.1 現成方案比較

| 方案 | 能力涵蓋 | 與本專案契合度 | 導入難度 | 維運負擔 | 成本（量級） | 適合小團隊？ |
|---|---|---|---|---|---|---|
| **Sentry（SaaS）** | **錯誤追蹤的黃金標準**：自動聚合去重、stack trace、release 追蹤、regression 偵測、告警（含門檻/頻率規則）。前後端都涵蓋。 | **極高**。`@sentry/react` + `sentry-go`，兩三行初始化就開始收 exception。 | **低**：裝 SDK、填 DSN，幾乎立刻有錯誤聚合。 | 極低（託管）。 | **免費 Developer 層約 5K errors/月**，含 30 天保留、1 user——**對現階段錯誤量幾乎必然夠用**。超過走 Team（約 $26/月）。 | **非常適合**：導入摩擦最低、免費層夠用、一裝就見效。 |
| **GlitchTip（自架，Sentry 開源替代）** | Sentry 核心錯誤追蹤 + 基本告警 + release 追蹤。**相容 Sentry SDK 協定**——用一樣的 `@sentry/*`、`sentry-go`，只換 DSN。 | 高（埋點端）／中（要自架後端）。**埋點碼與 Sentry 完全一樣，未來可無痛切換**。 | **中**：埋點低，但要自架服務（約 4 個容器：Django + Celery + Postgres + Redis）。 | **中**：要顧一台 ~2GB 的 VM/容器、升級、備份。**比 Prometheus 那套輕，但仍是「多養一個服務」**。 | 軟體免費，成本 = 一台小 VM（量級每月個位數美金）。**無 per-event 計費，量大時比 Sentry 省**。 | 尚可：**適合「不想把錯誤資料送出去/未來怕 Sentry 帳單」但願意扛一台小 VM 的團隊**。對「完全不想維運」的團隊仍偏重。 |
| **GCP Error Reporting（原生）** | 自動從 Cloud Logging 裡**辨識、聚合、去重 stack trace**，形成錯誤清單，可設通知。**只要 log 格式對，幾乎零設定就有**。 | **極高**。已在 Cloud Run + Cloud Logging，Go panic/error log 用對格式（含 stack trace）就會自動被抓。 | **低**：主要成本是「讓 error log 帶正確結構與 stack trace」，配合 slog 即可。 | **極低**：全託管，無元件。 | 併入 Cloud Logging 計費，實質幾乎免費。 | **非常適合**：零維運、零 sunk cost、與 GCP 生態無縫。**能力略遜 Sentry**（release/前端整合/regression 偵測沒那麼強）。 |
| **Cloud Monitoring Alerting（原生，閾值告警）** | 對任何 metric（含 Cloud Run 5xx 率、延遲 p99、instance 數、log-based metric）設**固定門檻告警**，通知走 Email/Slack/PagerDuty/Webhook。 | **極高**。指標本來就在 Cloud Monitoring 裡，直接設 alerting policy。 | **低**：點選式設定告警政策 + 通知管道。 | **極低**：全託管。 | 告警本身實質免費；**留意 2026-09 起每個被 alert 引用的 metric 約 $0.35/月**（量級極小）。 | **非常適合**：這正是能攔下 `dba5145` 那類事故的機制。 |

### 4.2 兩個子項的最佳解，其實可以拆開

**閾值告警（5xx/延遲/錯誤率超標）**：
- **GCP Cloud Monitoring Alerting 是壓倒性首選**。因為系統狀態的指標本來就已經在 Cloud Monitoring 裡（見第 2 節），**直接對這些指標設門檻告警、接 Slack/Email，零額外基礎設施**。這就是能把「adminserver 健康檢查在 prod 默默壞掉」（`dba5145`）更早攔下來的那道防線。
- 對「服務整個掛掉/URL 打不通」這種最基本的存活告警，還可搭 **Cloud Monitoring Uptime Checks**（從外部定期打你的 `/healthz`，掛了就通知）——這直接補上專案目前 Dockerfile 缺 `HEALTHCHECK`、且曾吃過健康檢查失效苦頭的洞。

**錯誤追蹤（exception 聚合去重）**：有三個層次的選擇，取決於團隊願意投入多少——
- **最省力**：**GCP Error Reporting**。已經在 GCP 生態內，log 格式對就自動聚合，零維運、零額外工具。能力足夠「基礎層」，只是前端整合、release 對應、regression 偵測不如 Sentry 細。
- **最好用**：**Sentry 免費層**。錯誤追蹤體驗最好、前後端一致、5K errors/月免費對現階段夠用，且順帶把第 3B 節的 tracing + session replay 一起解決。**唯一「代價」是把錯誤資料送到第三方**。
- **最可控**：**GlitchTip 自架**。埋點碼與 Sentry 一模一樣（未來可無痛在 Sentry 雲版與自架間切換）、無 per-event 帳單、資料留在自己手上——代價是要養一台小 VM。

### 4.3 純自建方案評估

- **錯誤追蹤自建**：要做「聚合去重」，你得自己對 stack trace 做指紋（fingerprint）、分組、計數、存 DB、做一個查詢介面。**這正是 Sentry/GlitchTip/Error Reporting 的核心價值，自己刻等於重造它們**。而 **GCP Error Reporting 已經免費把這件事做掉了**，所以自建**毫無道理**。
- **閾值告警自建**：理論上可以寫個 cron 定期查 log-based metric、超標就打 Slack webhook。**但 Cloud Monitoring Alerting 已經免費提供這個且更可靠**（它不會像你的 cron job 那樣自己也掛掉），自建同樣**沒有意義**。
- **結論**：異常偵測基礎層是**現成方案（尤其 GCP 原生）輾壓自建**的一類——因為「聚合去重」和「可靠地定時檢查並通知」這兩件事，恰好都是雲平台已經免費做好、且自建容易出錯（尤其「監控自己掛掉」）的地方。

### 4.4 小結：異常偵測

- **閾值告警**：**GCP Cloud Monitoring Alerting**（+ **Uptime Checks** 做存活監控），零基礎設施、免費、直接攔 `dba5145` 那類事故。**無異議首選。**
- **錯誤追蹤**：兩個都很好的選項——
  - 想完全留在 GCP、零維運：**Error Reporting**（配合 slog 讓 error log 帶 stack trace）。
  - 想要最好的錯誤追蹤體驗、且順帶解決前端 replay + 後端 tracing：**Sentry 免費層**。
  - 想資料自持、避免未來帳單：**GlitchTip 自架**（願意養一台小 VM 的前提下）。
- **自建完全不建議**：聚合去重與可靠告警都是雲平台免費做好、自建易錯的事。

---

## 5. 三大類方案的橫向總覽

把「GCP 原生 / 第三方 SaaS / 自架開源 / 純自建」四條路，攤在三類需求上，一眼看清各自的定位：

| | 系統狀態 | 產品分析 | 工程追蹤 | 異常偵測（基礎層） |
|---|---|---|---|---|
| **GCP 原生** | ★★★★★ Monitoring+Logging，零埋碼免費覆蓋 | ★☆☆☆☆ 非其所長（勉強用 log 分析） | ★★★☆☆ Cloud Trace（後端 OK，無前端 replay） | ★★★★☆ Error Reporting + Alerting，零維運 |
| **第三方 SaaS** | ★★★★☆ Grafana Cloud/DD/NR，需送資料出 GCP | ★★★★★ PostHog/GA4/Mixpanel，免費層夠用 | ★★★★★ Sentry（tracing+replay 一站到位） | ★★★★★ Sentry，體驗最佳、免費層夠 |
| **自架開源** | ★★☆☆☆ Prom+Grafana，維運重、與 Cloud Run 逆風 | ★★☆☆☆ PostHog 自架過重／Plausible 能力不匹配 | ★★☆☆☆ Jaeger/Tempo，多養一套後端 | ★★★☆☆ GlitchTip，輕於 Prom 但仍要養 VM |
| **純自建** | ★☆☆☆☆ 重造 Prometheus，不值得 | ★☆☆☆☆ 重造分析引擎，最不划算 | ★★★☆☆ request_id+slog「窮人版」意外好用 | ★☆☆☆☆ 重造聚合去重與告警，不值得 |
| **灰色地帶（slog→Cloud Logging）** | ★★★★☆ 打底可查詢的營運 log | — | ★★★☆☆ 加 request_id 即窮人版追蹤 | ★★★★☆ 讓 Error Reporting/Alerting 生效的地基 |

**一眼可見的規律**：
- **系統狀態、異常偵測 → GCP 原生輾壓**（零維運、免費、與 Cloud Run 天生一體）。
- **產品分析 → 第三方 SaaS 輾壓**（免費層夠用、自建重造引擎）。
- **工程追蹤 → 分兩半**：後端可 GCP 原生或窮人版，前端 replay 只有 SaaS 給。
- **自架開源** 在每一類都是「能力可以但維運負擔壓垮小團隊」的定位——它的價值在「不想被雲鎖定/要極度客製/資料主權」這些本專案現階段沒有的訴求上。
- **`slog` 灰色地帶** 是所有路線的共同地基，且成本最低——不論最終選哪條路，這步幾乎都該先做。

---

## 6. 總結建議

### 6.1 整體判斷：**傾向「現成方案為主、極少量灰色地帶自建打底」，明確不建議自架開源或純自建**

理由直接扣回這個專案的三個現實：

1. **零 sunk cost，但每分導入成本都是淨新增。** 沒有既有工具鏈包袱是好事，但也意味著「摩擦力」權重要調高——在這個階段，**能零埋碼/零維運就拿到的能力，價值遠高於理論上更強但要自己養的能力**。
2. **單一 prod、無 staging → 「多養一個服務」的風險被放大。** 自架 Prometheus/Grafana/Jaeger/PostHog 這類方案，等於為了監控主服務又生出一組「自己也需要被監控、也會掛、也要升級備份」的服務。**「監控系統自己掛了誰通知你」這個悖論，在沒有 staging 可緩衝的單一 prod 上尤其致命。**
3. **小團隊 → 維運心力是最稀缺資源。** 現成託管方案把運維外包給 Google/Sentry/PostHog；自架則把這份心力全壓回團隊。以現階段規模，**過度複雜的方案本身就是風險**（`docs/PROJECT_HEALTH_REVIEW.md` 已隱含這個判斷）。

**唯一該做的「自建」是灰色地帶那一步**：把 `log.Printf` 換成 `log/slog` 結構化輸出（+ request_id）。因為它成本低、無 lock-in（標準庫）、且是讓 GCP Logging/Error Reporting/Aligning 和窮人版追蹤全部生效的共同地基。

### 6.2 具體混合搭配建議（推薦組合）

按「摩擦力最低、免費額度覆蓋現階段、能力對得上需求」三原則，給一個具體組合：

| 需求 | 建議方案 | 為什麼 |
|---|---|---|
| **打底（前置）** | **`log/slog` 結構化 JSON → stdout → Cloud Logging**，並在 middleware 注入 `request_id` | 成本最低、無 lock-in、是下面一切的地基。專案已有 method/path/耗時 middleware，是天然掛載點。 |
| **系統狀態** | **GCP Cloud Monitoring + Cloud Logging（原生）**；LLM 延遲/成功率用 log-based metric 或自訂 metric 補上 | 零埋碼、零維運、免費覆蓋。Cloud Run/Cloud SQL 指標開箱即有。 |
| **異常偵測 — 閾值告警** | **GCP Cloud Monitoring Alerting + Uptime Checks** | 指標已在 Monitoring 裡，直接設門檻接 Slack/Email。直接補上曾出事的健康檢查洞（`dba5145`）。 |
| **異常偵測 — 錯誤追蹤 + 工程追蹤（前端 replay + 後端 tracing）** | **Sentry（雲版免費 Developer 層）**，前端 `@sentry/react` + 後端 `sentry-go` | **一個工具、免費層就同時解決三件事**：exception 聚合去重、前端 session replay、跨前後端 tracing。5K errors/月對現階段夠用。導入摩擦極低。 |
| **產品分析** | **PostHog（雲版免費層）**，或若偏 Google 生態用 **GA4** | 免費層（~1M events/月）現階段用不完；PostHog 甚至順帶提供 replay 與 exception（與 Sentry 部分重疊，可擇一深用）。 |

**這個組合的整體性質**：
- **系統狀態 + 閾值告警 = 100% GCP 原生**（零維運、與 Cloud Run 一體）。
- **錯誤追蹤 + 前端 replay + 後端 tracing = Sentry 一站解決**（免費層，摩擦最低）。
- **產品分析 = PostHog 或 GA4**（免費層）。
- **打底 = 唯一的自建（slog），成本極低。**
- **全部落在各家免費額度內**，現階段**月成本趨近於零**，且**沒有自架任何需要維運的服務**。

**關於 Sentry 與 PostHog 的重疊**：兩者的免費層都提供 session replay 與 exception。若想再精簡，可以二選一深用：
- 若最重視**錯誤追蹤與跨前後端 tracing 的體驗** → 以 **Sentry** 為主，PostHog 只做純產品分析。
- 若最重視**產品分析且想少一個工具** → 以 **PostHog** 為主（產品分析 + replay + exception 一把抓），後端系統面靠 GCP 原生，可不引入 Sentry。
- **兩種都是合理的簡化**，差別只在團隊更在意「工程追蹤體驗」還是「工具數量最小化」。

### 6.3 有沒有「免費額度就能滿足現階段、完全不用自建」的選項？——**有，而且這正是最務實的起點**

明確回答任務裡這個關鍵問題：**有。** 對這個規模的專案，下面這條路**幾乎不花錢、也不需要自架任何東西**：

- **系統狀態**：Cloud Monitoring + Cloud Logging——**GCP 原生免費額度**（Logging 50 GiB/專案/月、Cloud Run/SQL 指標免費）現階段用不完。
- **閾值告警 + 存活監控**：Cloud Monitoring Alerting + Uptime Checks——**實質免費**。
- **錯誤追蹤**：Sentry **免費 Developer 層**（5K errors/月）或 GCP **Error Reporting**（併入 Logging，實質免費）——**都免費**。
- **前端 replay + 後端 tracing**：Sentry 免費層即含（少量）；Cloud Trace **2.5M spans/月免費**——**現階段免費覆蓋**。
- **產品分析**：PostHog **免費層**（~1M events/月）或 GA4（免費）——**都免費**。

換句話說，**現階段完全可以「零自架、月成本趨近於零」地把三類需求都覆蓋到堪用**。唯一的「投入」是工程時間（裝幾個 SDK、設幾條告警、把 log 換成 slog），而**這遠比自架任何一套開源監控要省力、也遠比重造輪子要划算**。

**這就是給小團隊的最務實起點**：先把免費額度用滿、把摩擦力壓到最低、把能力覆蓋到堪用；等到某一類需求真的撞到免費額度天花板、或出現「資料主權/避免帳單暴增/需要極度客製」的明確訴求時，**再針對那一類**評估是否升級到付費層或轉向自架（例如錯誤量大到 Sentry 帳單不划算時，因為埋點碼相容，可平滑切到自架 GlitchTip）。**在那之前，不需要自建任何需要維運的東西。**

### 6.4 落地優先序（若要排先後）

1. **先做打底**：`log.Printf` → `log/slog`（JSON + severity + request_id）。這步無 lock-in、解鎖後面一切，且順手改善現有 60 處 log 的可查詢性。
2. **零成本先攔事故**：設 Cloud Monitoring Alerting（5xx 率、延遲）+ Uptime Check（打 `/healthz`）。這步最快回本——直接防住 `dba5145` 那類「prod 默默壞掉沒人知道」。
3. **裝 Sentry**（前後端 SDK）：立刻有錯誤聚合，之後再逐步開 tracing / replay 的取樣。
4. **裝 PostHog 或 GA4**（在正確的平台——web / iOS）：開始累積產品行為資料（漏斗、留存越早埋越有歷史價值）。
5. **需要 span 瀑布圖時**再加 OpenTelemetry → Cloud Trace（把 LLM 呼叫、DB 操作包成 span）。
6. **撞到天花板/出現特定訴求時**，再針對單一需求評估付費升級或轉自架（如 GlitchTip）。

---

### 附註：本文引用的外部參考（研究時點，實際以官網為準）
- Sentry pricing / free Developer plan：last9.io、sentrypricing.com（5K errors/月免費）
- PostHog pricing / free tier：posthog.com/pricing、schematichq.com（~1M events + 5K recordings + 100K exceptions/月免費）
- Grafana Cloud free tier：grafana.com/pricing、cloudzero.com（10K series + 50GB logs/traces、14 天保留）
- GCP Cloud Logging / Monitoring / Trace pricing：cloudcostkit.com、monitoringcost.com（Logging 50 GiB/月免費、Trace 2.5M spans/月免費、2026-09 起 alert metric $0.35/月）
- GlitchTip（Sentry 開源自架替代）：makerstack.co、danubedata.ro（相容 Sentry DSN、4 容器、~2GB VPS 可跑）
