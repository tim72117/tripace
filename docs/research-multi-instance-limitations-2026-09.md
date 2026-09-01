# 多伺服器（多 Cloud Run instance）情境下的既有限制

寫作時間 2026-09-02。這不是理論性的預防文件——Cloud Run 服務
`tripace-server` 目前設定 `autoscaling.knative.dev/maxScale=20`（見
`gcloud run services describe tripace-server`），代表正式環境流量夠大
時隨時可能同時跑到 20 個獨立 instance，以下問題屬於**目前架構下已經
存在、只是還沒被高流量觸發的實際風險**，不是假設性的未來規劃。

本文件只記錄本專案程式碼裡實際存在、且會因為多 instance 而出問題的
地方，不做通用的分散式系統教學。

## 已確認會出問題的地方

### 1. WebSocket 廣播（`Hub`，`server/internal/api/hub.go`）—— 影響最大

`Hub` 是純 in-memory 的訂閱者登記表（`map[tripID]map[*websocket.Conn]struct{}`），
`Broadcast` 只會把事件送給**這個 process 自己記憶體裡**登記過的連線。

**實際情境**：旅程成員 A 連上 instance 1，成員 B 連上 instance 2（Cloud
Run 依負載平衡把不同的 WebSocket 連線分派到不同 instance，沒有
sticky session 的保證更是如此）。A 在自己的 instance 1 上編輯行程，
`s.hub.Broadcast(tripID, event)` 只會廣播給登記在 instance 1 記憶體裡
的連線——B 完全收不到這個事件，即時協作功能（多人同時編輯同一趟旅程,
見 CHANGELOG 反覆提到的「即時同步」）在跨 instance 情境下會直接失效,
且不會有任何錯誤訊息,只是安靜地漏播。

這是目前所有已知問題裡**唯一會直接造成核心產品功能失效**（而不只是
效能/成本上的浪費）的一項。

### 2. `singleflight` 合併查詢（`Server.placeDetailsGroup`，`server/internal/api/api.go`）

這次為了解決「兩個使用者同時點擊地圖上同一個 Google 原生 POI」的
重複計費 API 呼叫問題（見 `docs/audit-functional.md` 或本次改動的
commit 說明），在 `handleGeoPlaceDetails` 加了 `singleflight.Group`。

`singleflight` 的合併範圍**只在單一 process 內生效**——A 打到
instance 1、B 打到 instance 2，兩者仍會各自真正查一次 Google/Pexels,
`singleflight` 完全防不住跨 instance 的重複查詢。多 instance 情境下,
這個機制退化成「只能防住同一台伺服器內剛好撞在一起的請求」,防護力
隨 instance 數量增加而遞減——instance 越多,兩個併發請求剛好落在同一台
的機率越低,重複計費的風險反而越高。

### 3. Google Places API 節流器（`apigateway.defaultGateway()`，`server/internal/apigateway/apigateway.go`）

節流器是「整個 Gateway 共用一份節流額度」的 process 內單例（見該檔案
第 111 行附近的說明）,目的是避免地圖被高頻拖曳觸發過量的 Google API
呼叫。

**實際情境**：這份節流額度是 per-instance 的,不是全域的——如果設定
「最多同時 5 個並發請求」,20 個 instance 同時運作時,實際對 Google
的並發呼叫上限會是 `5 × instance 數`,而不是預期中的固定上限 5。這個
節流器原本設計的目的（保護 Google API 配額、控制計費成本）在多
instance 高流量情境下,實際生效的上限會隨自動擴展的 instance 數量
浮動,達不到原本想要的固定護欄效果。

### 4. `want` agent 規劃步驟清單（`wanttools.tasks`，`server/internal/wanttools/task_store.go`）

`var tasks = &taskStore{...}` 是一個 package 級全域變數,存「AI agent
規劃行程異動時,這次工作要做哪些步驟」的暫存清單,設計上就是
per-process、not persisted（程式碼註解明講「不需持久化到 DB,server
重啟即清空」）。

**實際情境**：如果同一個使用者的一次多步驟 AI 對話,前後兩個 HTTP
請求被路由到不同的 instance（Cloud Run 不保證同一個使用者的連續請求
會落在同一台）,第二個請求讀不到第一個請求在另一台 instance 記憶體裡
寫入的規劃步驟,可能導致「AI 說已經排好了下一步,但實際查詢不到這個
步驟」的不一致行為。這個問題的觸發條件跟現有 `ChatScreen`
WebSocket 連線的生命週期有關——只要同一趟對話的 WebSocket 連線全程
連在同一個 instance 上（WebSocket 本身是長連線,一旦建立就不會中途
被負載平衡重新分派）,這個問題就不會發生;只有當同一個使用者的
「不同次」對話被分派到不同 instance 時才會出現。

## 排除、不算問題的地方

- **`store.GetCachedPhoto`/`SetCachedPhoto`、`SetGooglePlacePhotos`、
  `SetPlacePexelsPhotos`、`SetCachedPlaceDetails` 等資料庫層快取**：
  全部讀寫同一個 Cloud SQL Postgres 實例,天生跨 instance 共享,沒有
  多伺服器問題。
- **`IncrementPlaceClickCount`**：用 SQL 端原子 `UPDATE ... SET
  click_count = click_count + 1`,由資料庫本身保證跨 instance 的原子性,
  沒有多伺服器問題。

## 暫不處理的理由

目前正式環境的實際流量規模,多 instance 同時運作的機率、以及即使
發生時單一使用者跨 instance 的機率都還低,加上修正這些問題（尤其是
Hub 廣播）需要引入外部的跨 instance 訊息機制（例如 Redis Pub/Sub 或
Cloud Pub/Sub）,屬於架構層級的變更,不是這次「地點圖片漸進補圖」改動
範圍內該處理的事。這份文件的目的是留下明確記錄,避免未來流量成長、
這些問題開始頻繁出現時,需要從頭重新排查才能定位根因。

## 待辦

- 若之後要修 Hub 廣播的跨 instance 問題，需要引入某種 pub/sub 機制
  讓多個 instance 之間能互相轉發事件，而不是直接改 Hub 本身的資料結構
  （純 in-memory map 天生就無法跨 process，這是架構層級的限制，不是
  bug）。
- 若要修 singleflight 的跨 instance 限制，選項包括改用資料庫層級的
  advisory lock（Postgres `pg_advisory_lock`），或接受目前的防護力
  隨 instance 數遞減，只當作「盡力而為」的優化，不當作正確性保證。
