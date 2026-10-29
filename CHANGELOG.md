# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.51.0 — 2026-10-29

照片儲存(GCS)斷路器:儲存服務壞掉時,背景補圖在花錢之前就跳過。**無破壞性變更**(只新增套件、方法與回應欄位;既有符號與 API 沒有移除或改名,`photostorage` 的上傳錯誤訊息文字不變)。

### 問題

背景補圖的順序是「打 Google `places.get` → 打 `photoMedia` 下載 → 上傳 GCS → 寫 `photo_assets`」。GCS 上傳失敗(實例:專案帳單停用,`403 accountDisabled`)時前兩步已計費、結果被丟掉,`photo_assets` 沒寫入,下一次請求看到照片還缺又重來——每次載入頁面都重複付費、永遠不會成功。

### 新增

- **`internal/storagehealth` 斷路器**:未知 / 正常 / 異常三態。啟動時先探測再補圖;連續 2 次真實上傳失敗轉異常;異常時跳過補圖並定期探測(間隔 1 分鐘起、失敗加倍、上限 15 分鐘,同時只放一個探測),探測成功即恢復。狀態只存單一實例的記憶體。
- **`photostorage`**:`Uploader.Probe`(寫 `_health/probe.txt`,用寫入而非讀取,因為帳單停用可能讀得過、寫才失敗)、`Uploader.Configured`、`IsStorageFailure`(只有 GCS 寫入失敗算儲存異常,圖片格式錯誤與未設定 bucket 不算,避免單張問題讓全站停補圖)。
- `backgroundFillPlacePhoto` 在打 Google 之前先問斷路器;沒接 bucket 的環境斷路器為 nil,行為不變。
- `geo-api-stats` 回應新增 `photoStorage`(state / skipped / lastError / nextProbe);`geo-stats show` 在異常或尚未探測時印出一段狀態。
- 狀態轉換寫 log;只有「異常 → 正常」才印恢復(啟動時未知轉正常不印)。

### 文件

- `SKILL.md` 補上 GCS 斷路器的行為,以及本機憑證的配額專案(`quota_project_id`)排查方式。

### 已知限制

- 「已略過 N 次」混有探測失敗那一次,不等於少打的 Google 次數;也不記是哪些地點被略過。
- CLI 的 `attraction photo-update`(`maintenance.go`)仍是先下載再上傳,GCS 壞時會白付 Google 的錢,尚未接斷路器。
- 探測寫 `_health/`、實際上傳寫 `place-details/`,若桶改成依前綴設權限,探測可能通過而實際上傳失敗(連續 2 次真實失敗仍會跳閘)。
- 斷路器異常期間,照片過期的地點回應不帶照片(`photo_assets` 查無有效紀錄時不回退舊來源),這是既有行為。

## v0.50.0 — 2026-10-29

Google API 呼叫統計與地點詳情快取命中記錄。**無破壞性變更**(只新增資料表、端點、CLI 指令與 geo 套件的觀察者介面;既有公開符號與 API 都沒有移除或改名)。

### 新增

- **`tripace-cli geo-stats show`**(`GET /internal/maintenance/geo-api-stats`,管理員):依日期區間(`-from`/`-to`,含頭尾)與分配週期(`-period day|hour`)回報各 Google 端點的呼叫次數與錯誤數,`-tz` 決定「一天」從哪裡切(預設 `Asia/Taipei`)。day 最多 92 天、hour 最多 7 天。只有請求筆數,沒有當時的計費層級。
- **地點詳情快取命中記錄**:新資料表 `geo_cache_logs`(啟動時 AutoMigrate 自動建立,已加進 schema check),每個地點詳情查詢一筆,結果為 `hit`(快取新鮮)、`miss`(自己打了 Google)、`shared`(共用同時進行的那次 Google 呼叫);含 caller、path、place_id。`geo-stats show` 會印命中率並依週期展開。`GetPlaceDetailsFresh` 不查快取、不記錄。
- geo 套件新增 `CacheObserver`/`SetCacheObserver`/`CacheOutcome`(`CacheHit`/`CacheMiss`/`CacheShared`),由 `cmd/server` 注入寫資料庫的實作。

### 維運

- 正式機 `placeDetails`、`cityDistricts` 兩個 field mask 已拿掉 `editorialSummary`,從 Enterprise + Atmosphere 降到 Pro(資料庫設定,非程式變更)。程式碼裡寫死的預設值仍帶 `editorialSummary`,資料庫沒有覆寫時會退回最貴那一檔。

### 文件

- `SKILL.md`、`docs/routing-architecture.md`、`cmd/cli/main.go` 開頭的指令清單補上 `geo-stats`。

### 已知限制

- 快取記錄上線前的日期沒有命中資料。
- `geo_cache_logs` 目前沒有保留期限,每次查詢寫一筆(含命中),寫入用不設上限的 goroutine;統計是把區間內的資料列讀進 Go 再分組。流量變大前應改成有上限的批次寫入、定期清理與資料庫端分組。
- 領頭者二次檢查快取命中時,等它的請求被記成 `shared` 而非 `hit`。

## v0.49.0 — 2026-10-29

規劃面板:時間軸圖卡上滑操作、更換地點、統一的詢問頁啟動、前端 Trip;island 茶樓模型瘦身與載入強化。**無破壞性變更**(對外 API、資料庫與既有公開符號都沒有移除或改名;前端新增的功能都是選填 prop 或預設關閉的開關)。

### 新增

- **手機版時間軸圖卡往上滑,卡片內下方露出操作列**(更換地點、刪除):方向鎖定(垂直超過水平 1.2 倍才算)、阻尼、速度/過半吸附、同時只展開一張;卡片列同時支援滑鼠左右拖曳換卡(`useSwipeReveal`、`useMouseDragScroll`、共用 `hooks/snapScroll`)。
- **更換地點**:開啟「選擇要換成的地點」詢問頁(以該站座標查附近觀光地點,排除自己),選完直接原地替換(`PlanOperations.replaceStop`:保留 id、順序、時間、備註,清掉舊地點的說明/座標/交通/標籤/子景點,重查新地點並重算前後交通)。候選裡已在行程中的地點標「已在行程」。
- **統一的詢問頁啟動 `startAsk`**(`useAskPageFlow`):啟動參數加 `onDone`/`onCancel`,回呼跟著該次詢問的生命週期;新增 `search` 候選來源(前端查完才顯示,選完拿得到名稱)。景點查詢不設逾時。
- **詢問頁候選點畫在地圖上**(`searchResultLayer`,青藍色圓點,已勾選變大,點圓點切換勾選,鏡頭防抖對焦),三個入口都接。景點候選頁拿掉「確認選擇」按鈕,改用輸入框送出鈕確認。
- **輸入框**:左側狀態星芒(推論中帶旋轉光環與脈動,支援減少動態效果)、送出鈕旁「選擇景點」與「新行程」按鈕(`Composer.extraButton` 可傳陣列)。「新行程」由 `VITE_FEATURE_NEW_TRIP_DRAFT` 控制,**預設關**。
- **前端 Trip 概念**(`planning/trip`):比時間軸大一層的容器(id、名稱、自動標題、時間),索引存 `localStorage`(`tripace.planTrips`),第一次讀取從舊草稿與固定 key 那份行程播種、不改寫舊資料;登入後桌面/手機入口改用使用中行程的時間軸。尚無切換介面;與後端 `Trip` 刻意分開,之後再整合。

### island

- 阿妹茶樓 GLB 從 2.27MB 降到 0.86MB(gzip 約 173KB):藤蔓叢數可由 `VINE_DENSITY` 調整(目前 0.15),燈籠改為 GLB 內的 `lantern_*` 錨點,島上用 InstancedMesh 畫(`stopLanterns.ts`,2 次繪製呼叫),建模腳本進版控(`web/tools/blender`、`web/tools/model-preview`)。
- 修正:`prism` 形狀面朝內、`extrude` 倒角沒置中;GLB 載入失敗/逾時(30 秒)不再永久快取、改自行 fetch 避免重試卡死;GLB 資源由 registry 擁有、卸載時不重傳 GPU;多材質網格明確報錯;碰撞改用宣告式版本;地形輪廓/格網邊界防護。

### 其他

- 診斷面板(`?debugSafeArea`)的推論紀錄移到頁面最外層並依版面定位,不再被手機版面蓋住。
- `docs/terminology.md` 補上前端「規劃旅程」與後端「旅程」的區分;`web/.env.example` 補上 `VITE_FEATURE_NEW_TRIP_DRAFT`。

### 已知限制

- 前端 Trip 與展示頁(`/ai-plan/live`)的舊草稿機制並存;尚無叫出舊行程的介面。
- 更換地點選了多個只取第一個;「選擇景點」不阻擋選已在行程的地點。
- 手勢手感、地圖圓點外觀、燈籠亮度與日夜連動**尚未在實機/瀏覽器確認**。

## v0.48.3 — 2026-10-28

遷移工具涵蓋 Schema check 找到的 5 張遺留表。

### 變更

- `cmd/migrate-drop-photo-url` 的 `DROP TABLE` 清單新增 `admin_users`、`admin_sessions`（舊管理後台獨立登入，改 JWT + email 白名單後已無用，`admin_users` 含舊的 bcrypt 密碼雜湊）與 `landmarks`（景點表舊名，`attractions` 改名時沒有搬資料，舊表留在資料庫），連同既有的 `pexels_photo_cache`、`place_pexels_photos` 共 5 張。
- 工具現涵蓋 3 個欄位（`attractions.photo_url`、`place_details_cache.photo_url`、`public_links.view_mode`）與這 5 張表；**資料庫尚未執行**，需以 `-dry-run=false` 傳參，workflow 會先備份（備份檔含舊管理員雜湊，注意 bucket 權限）。

## v0.48.2 — 2026-10-28

Schema check 能列出資料庫裡「沒有對應 struct」的遺留表。

### 變更

- **`GET /admin/api/schema-check` 回應新增 `orphanTables`**（`store.OrphanTables`）：資料庫有、但沒有任何 struct 對應的資料表（沒有時為空陣列）；有遺留表時整體 `ok` 為 false。原本的檢查只從 struct 出發，struct 刪掉但 `DROP TABLE` 沒執行的表永遠看不到。
- 管理後台 Schema check 頁顯示遺留表清單。
- `schemaCheckTargets` 補上漏列的 7 張正式表（`ad_plans`、`campaigns`、`geo_field_masks`、`geo_settings`、`partners`、`photo_assets`、`plan_ai_chat_messages`）；它們之前從未被檢查過，部署後若有欄位漂移會首次顯示。

### 測試

- `store`：全新資料庫無遺留表（同時鎖住 `schemaCheckTargets` 與 `AutoMigrate` 清單須鏡像）、偵測無 struct 的表、`DropTable` 後消失；`adminconsole`：端點帶出 `orphanTables` 且為空陣列。

## v0.48.1 — 2026-10-28

清掉 Pexels 圖源與已移除欄位的資料庫殘留（解決 v0.48.0「已知未處理」的兩張表）。

### 變更

- 景點同步的 schema 欄位清單（`GET /internal/maintenance/sync/attractions/schema`）移除早已不存在的 `photo_url`。
- 移除 `pexels_photo_cache`、`place_pexels_photos` 兩張表的 struct、`AutoMigrate`/`schema_check` 項目與兩個死方法（`GetCachedPexelsPhoto`、`SetCachedPexelsPhoto`）。
- `cmd/migrate-drop-photo-url` 擴充：新增 `DROP TABLE` 支援（`store.HasTable`/`DropTable`），清單為 `attractions.photo_url`、`place_details_cache.photo_url`（之前漏列）、`public_links.view_mode` 三個欄位與上述兩張表。**資料庫尚未執行**，需先部署本版再執行 workflow，並以 `-dry-run=false` 傳參（空字串會被預設值 `-dry-run` 蓋掉）。

### 測試

- 新增 `store` 的 `HasTable`/`DropTable`/`HasColumn` 測試（`DropColumn` 因 SQLite 驅動限制無法在測試環境驗證）。

## v0.48.0 — 2026-10-28

移除「路徑（配速表）」功能、舊版對話系統（ChatScreen / wanttools）與 Pexels 圖源，並整理 CHANGELOG。

> **破壞性變更**
> - 移除 `GET /v1/demo/pace-route`、`POST /internal/entries/{id}/geocode`（`pace_route.go`、`entry_geocode.go`）。
> - 公開連結不再有 `viewMode`：`POST/PATCH /v1/trips/{id}/public-link` 的請求與回應都拿掉此欄位，`store.CreatePublicLink` 少一個參數。
> - 前端移除 `/demo/pace` 路由、桌面「路徑」按鈕與 `pace` panelMode、`VITE_FEATURE_PACE`、`VITE_FEATURE_DEMO_CHAT`、`VITE_ONAGENT_APP_KEY`（CI 不再傳此 build-arg）。
> - 刪除 Go 套件 `internal/wanttools`、`internal/pexels`，以及前端 `src/chat/`（ChatScreen 等）、`src/pace/`、`src/deviceDB.ts`、`src/clienttools/tools/`。

### 變更

- 手機版時間軸抽屜改用 `useTripEntriesMirror` 自己撈資料，不再隱藏掛載 ChatScreen（桌面版先前已如此）。
- 移除沒有呼叫端的死碼：`api.go` 的 7 個 `Notify*`、`fetchPhotosForCandidates`、`geo.Client` 的 Pexels 注入點。
- `cmd/migrate-drop-photo-url`：移除已執行的 `place_details_cache` 兩欄，新增 `public_links.view_mode`（**尚未在資料庫執行**，與 `attractions.photo_url` 一併待執行）。
- `web/tools/onagent-tools.yaml` 移除 5 個前端工具定義，只剩後端 dispatch 的 `recommend_nearby`、`geocode`；**其 thought 需另行重寫，平台上的舊工具定義也尚未刪除**。
- 刪除已失效的 `e2e-mock-llm.spec.ts` 與 `test:e2e:mockllm`。
- 過時的註解與活文件（README、terminology、routing-architecture 等）改為現況。

### 文件

- CHANGELOG 瘦身：v0.39.2 以前搬到 `docs/changelog/`（內容原樣保留），主檔只留 v0.40.0 之後。

### 已知未處理

- 資料庫仍有 `pexels_photo_cache`、`place_pexels_photos` 兩張表與對應 struct（AutoMigrate 仍會建立）。
- `docs/terminology.md`、`web/README.md` 另有更早之前就過時的路徑描述。

## v0.47.3 — 2026-10-28

開通業主身分時 `name` 改為選填。

### 變更

- **`POST /internal/maintenance/partners` 與 `tripace-cli partner-grant` 的 `name` 改為選填**（`internal/api/maintenance.go`、`cmd/cli/partner.go`）：只有 `email` 必填，缺少時回 400「email 為必填」；沒給 `name` 時用 email 當業主顯示名稱。向下相容，原本有給 `name` 的呼叫行為不變。
- 公開的 `packages/partner-installer/README.md` 不再提內部指令 `tripace-cli partner-grant`。
- 新增 `maintenance_partner_grant_test.go`（不給 name、重複開通 409、查無使用者 404、缺 email 400）與 CLI binary 測試（不給 `-name` 可送出）。

## v0.47.2 — 2026-10-28

修正 `tripace-cli` 全域旗標 `-api` 被部分指令忽略的問題。

### 修正

- **`partner-grant`、`geocode`、`notify` 現在會使用全域 `-api`**（`server/cmd/cli/main.go`、`partner.go`、`geocode.go`）：`main()` 會先把 `-api` 從參數剝掉再分派子命令，這三個指令卻各自寫死預設值，導致 `-api` 被默默忽略——`partner-grant` 一律打到 `http://localhost:8080`，`geocode`／`notify` 一律打到預設的正式站 `https://tripace.io`（`-api http://localhost:8080` 時 `notify` 會誤對正式站發通知）。`-api` 放在子指令前或後都有效。
- **回應不是 JSON 時錯誤訊息改為顯示請求方法、網址、HTTP 狀態與原文**（`server/cmd/cli/http.go`），不再只回報 `cannot unmarshal number into Go value`。
- 新增 `global_api_test.go`：編譯出實際的 binary 對假伺服器驗證上述三個指令、兩種旗標位置，共 6 個案例。

## v0.47.1 — 2026-10-28

業主身分尚未開通時，回應明確說明該怎麼辦。

### 變更

- **非業主帳號呼叫 `/partner/api/*` 改回 403 `partner_not_enabled`**（原為 401 `not authenticated`）：訊息說明「帳號尚未開通業主身分，請聯絡 Tripace 並提供登入用 email」並附帳號識別。只有 JWT 驗證通過但查無業主時才回 403；沒有 token、token 無效、查詢錯誤仍是 401。
- **`partner-cli login` 在帳號未開通時結束代碼改為 1**（原為 0）並印出申請說明，不再提示內部工具 `tripace-cli partner-grant`；業主網頁登入頁直接顯示後端訊息。依賴 `login` 永遠成功的腳本需調整。
- skill 套件 `SKILL.md` 同步：遇到 `partner_not_enabled` 時轉告使用者向 Tripace 申請，不再提內部指令。

## v0.47.0 — 2026-10-28

這一版把廣告業主控制台併入主服務（與主站同網域 `tripace.io`），業主可投放 KKday 聯盟方案，行程頁側欄可依行程投放，並整理 partner 套件與發布流程。

### 新增

- **業主控制台併入主服務**（`server/cmd/server/main.go`、`static_partner.go`、`Dockerfile`）：`cmd/server` 直接掛載 `/partner/api/*`（`partnerconsole`）與 `/partner/` 業主前端（`web/partner` 建置後 embed 進 `cmd/server/webpartner/dist`），沿用主站同一把 JWT signer，CORS 政策與 `/admin/` 相同。`partner-cli` 與業主網頁用 `https://tripace.io` 即可。Dockerfile 新增 `partner-build` 階段。
- **KKday 聯盟方案**（`server/internal/adlink`、`partnerconsole`、`web/partner`、`web/src/home/SponsoredPlanCard`）：方案 category 為 `kkday` 時，業主須填 `cid` 與 kkday.com 的 `landingUrl`，後端檢查網域並把 cid 寫進網址；可填參考價（`fromPrice`，最長 30 字）；前台點擊歸因到該業主。公開端點輸出前再驗一次。
- **行程頁側欄依行程投放**（`ItinerarySidebar`、`partnerconsole` 版位驗證）：版位 `itinerary-<行程 slug>` 只在該行程頁顯示，沒有時退回 `itinerary-sidebar`；`/partner/api/placements` 會列出已發布的行程。側欄沒有連結與廣告時，仍會顯示業主投放的卡片。
- **partner-cli**：新增 `-cid`、`-from-price`、`-activate`、`-publish`、`-quiet`，錯誤訊息可讀化。

### 變更

- **partner-cli 的 `-api` 預設值改為 `https://tripace.io`**（原為 `http://localhost:8082`）。**本機開發需明確帶 `-api http://localhost:8080`；沒帶時會打到正式環境。**
- **移除獨立的 `cmd/partnerserver` 與 `Dockerfile.partner`**：功能已併入主服務。
- **所有分類的方案 `landingUrl` 只允許 http(s)**，擋掉 `javascript:` 等協定（儲存型 XSS）；公開端點輸出前同樣過濾。
- **partner skill 套件移到 `packages/partner-installer/`**（原 `web/partner-installer`），版本 0.0.2；`SKILL.md` 改用 `-api https://tripace.io`、安裝指令改為 `npx @tripace/partner-claude-skill`。
- **`release-partner-claude-skill.yml` 改為推 `partner-claude-skill-v*` tag 自動發布**（保留手動觸發），並檢查 tag 版本與 `package.json` 一致。
- 舊網域 `tripace.shuttle.tools` 的殘留引用改為 `tripace.io`（`web/tools/onagent-tools.yaml`、`marketing/tripace/`、註解與測試字串）。

### 部署注意

- 部署後 `tripace.io/partner/api/me` 不帶 token 應回 401（原為 404）。
- `web/tools/onagent-tools.yaml` 的位址變更僅在檔案內，需另外同步到正式 onagent 平台才會生效。

## v0.46.0 — 2026-10-28

這一版有四組改動：①`/ai-plan` 播放態與推論態拆成兩個獨立路由（新增 `/ai-plan/live`），備註（note）改成卡片內固定高度橫列，並新增手機版／桌面疊加版的版面骨架除錯疊圖與 AI 工具呼叫紀錄面板；②廣告業主自助控制台與投放系統（新後端服務、新前端、`SponsoredPlanCard`）；③`/island` 重構成場景化（`/island/:sceneId`、探索模式、連續地形）；④草稿清單加入標題與最後編輯時間。**資料庫新增三張表 `partners`、`campaigns`、`ad_plans`（啟動時 AutoMigrate 自動建立，既有表無欄位增刪，不需手動遷移）；環境變數新增 `VITE_FEATURE_ISLAND_SAMPLE`（前端，預設關閉）、`VITE_PARTNER_API_URL`、`VITE_MAIN_API_URL`（`web/partner`）、partnerserver 的 `PORT`、`DATABASE_URL`；localStorage 新增 `tripace_partner_token`（草稿 key `tripace.planTimeline.drafts` 不變、舊資料相容）；LLM 工具、yaml、thought 皆不變（不需重推 onagent）；新的 npm 相依只在 `web/partner`、`web/partner-installer`，主站 `package.json`、`go.mod` 無變動。**

> **內部不相容變更**（0.x 階段依版號慣例升 minor）：
>
> - `/ai-plan` 不再在同一個元件內用 `handedOver` 切換推論態：`planning/preview/Content.tsx` 現在只是播放態，推論態在 `planning/preview/LiveContent.tsx`（路由 `/ai-plan/live`）。交接用 `navigate`，不傳任何狀態。`SimComposerProps` 移除 `handedOver`、`userPrompt`、`setUserPrompt`。
> - `sdk-proposals/toAgentBridgeTools.ts`：回傳的 handler 一律變成 async，`onToolResult` 收到的是 await 之後的實際結果（原本可能是 pending 的 Promise）。
> - `HorizontalPlanTimeline`（手機橫向時間軸）移除外層全寬 `.noteBanner` 與 `selectedNote`/`selectedNoteMeta`，備註改為每張卡內的 `.cardNoteRow`；`--horizontal-timeline-card-height` 由 300px 改 322px，連動安全區 `bottom` 由 454px 改 476px（`planning/preview/PlanOverlayPanel.module.css`、`planning/member/phone/PlanOverlayLayout.module.css`）。
> - 舊版 `timeline/Timeline.tsx` 移除 CSS 類別 `.expandSummary`，備註改為常駐的 `.noteRow`。
> - `/island`：`island/seo.ts`（`SEO_TITLE`、`SEO_DESCRIPTION`）與 `seo.test.ts` 刪除，改由 `scenes/night-jiufen/index.ts` 的 `seo` 與 `scenes/seo.test.ts` 取代；`data/night-jiufen.json`、`data/layout.ts`、`models/stop-*.ts` 搬到 `scenes/night-jiufen/`；移除匯出 `MODELS`、`ISLAND_SOURCE`、`ISLAND_BYLINE`；HUD 的 `setTouring`、`onTourEnd` 與 `IslandApp.startTour` 移除，**自動導覽（28 秒）整個移除**，改為「探索」模式；`mountIsland(root, search, data, sceneOpts)` 簽名改變，`loadIslandData(sceneId)` 與 `createMini` 改為 async。
> - handbook：`HandbookIndex` 的 props 由無參數改為必填 `mode`；根路徑 `/` 由雛形列表改為分類首頁，原雛形列表在 `/category/prototypes`、系統文件在 `/category/system-docs`。

### 新增

- **`/ai-plan/live`（推論態獨立路由）**（`planning/preview/LiveContent.tsx`、`web/src/App.tsx`、`server/cmd/server/static.go` 的 `knownRoutePatterns`、`seo_meta.go`）：不接收播放態任何狀態，掛載後整頁重新初始化（地圖重建一次）。播放態按「讓我試看看」經 `liveHandoverUrl.ts` 的 `buildLiveHandoverUrl` 導過來，保留 `embedded`、`debugSafeArea` 等網址參數、去掉 `skipDemo`。SEO：專案沒有 noindex 機制，只用 canonical 指向 `/ai-plan`。
- **手機版推論態「移動到此」按鈕**：`TripPlanPage` 只有收到 `onPanToStop` 時才把 `panToStopId` 傳給手機橫向時間軸（`resolvePhonePanToStop`），`/app` 手機版沒有該 callback 所以不顯示。
- **版面骨架除錯疊圖（`?debugSafeArea=1`）**：`planning/preview/phone/LayoutDebugOverlay.tsx`、`desktop/LayoutDebugOverlay.tsx`，做法同登入後（`getBoundingClientRect` 即時量測 + `ResizeObserver`），經 `OverlayShell` 新增的 `overlayEnd` render prop 與 `desktop/PlanOverlayPanel` 新增的 `onPanelElChange`、`onComposerElChange` 取得節點。
- **AI 工具呼叫紀錄面板**（`ToolCallLogDebugOverlay.tsx`、`TripPlanPage` 的 `onToolCallLogChange`、`LivePlanLayer` 透傳）：只有呼叫端傳了 `onToolCallLogChange` 才收集，最多保留最近 200 筆，id 用遞增計數器。
- **備註（note）卡片內固定高度橫列**：桌面 `PlanTimelineView` 的 `.stopNoteRow`（交通備註維持獨立一列）、手機版 `.cardNoteRow`、舊版 `Timeline.tsx` 的 `.noteRow`（展開時換行顯示全文），以及兩個 `renderStopCard` 插槽卡（`renderItineraryStopCard`、`renderOnsenAutumnStopCard`，原本完全不顯示備註）。過長以省略號截斷，文字元素帶 `title` 全文。
- **handbook**：`public/marker-layers.html` 的 `/ai-plan` 結構圖拆成播放態／推論態各手機與桌面共四張，頁首標籤（全部／播放態／推論態／登入後）切換，選擇記在網址 hash；四個入口的「統一繪製層」卡只留各自差異（實心白框＝多掛或特別的層、虛線框＝不掛），共同的七層明細抽到 `public/unified-draw-layer.html`（路由 `/unified-draw-layer`，`UnifiedDrawLayerPage.tsx`），點卡開啟。構想文件新增選填欄位 `IdeaDoc.scale?: 'small'` 與構想 `maintenance-02`（感興趣點改用 `searchResultLayer` 繪製，標 `small`）。
- **廣告業主自助控制台與投放系統**：後端 `server/cmd/partnerserver`（掛 `/partner/`）、`server/internal/partnerconsole`（`/partner/api/*`：me、placements、campaigns CRUD 與 status、plans CRUD 與 status）；主站公開端點 `GET /public/ad-plans?placement=`、`POST /internal/maintenance/partners`；CLI `tripace-cli partner-grant -email -name`；`server/cmd/partner-cli`、`web/partner-installer`（`@tripace/partner-claude-skill`）、`Dockerfile.partner`、兩個手動觸發的 release workflow；前端 `web/partner`；主站 `SponsoredPlanCard` 掛在九份、京都、台南、台南赤崁四個城市頁（placement 為頁面 slug）；埋點新增 `sponsored_plan_click`。業主帳號要用 `partner-grant` 手動開通，沒有自助申請。
- **`/island` 場景化**：`/island/:sceneId`（`/island` 為預設場景夜遊九份，不存在的 id 與 `/island/night-jiufen` 都導回 `/island`）、`scenes/` 模組（`registry.ts`、`types.ts`、`useIslandScene.ts`…）、HUD 場景切換選單、實驗場景 `sample-islet`（`VITE_FEATURE_ISLAND_SAMPLE=true` 才存在）、第一人稱探索模式（`three/explorer.ts`、`logic/walk.ts`…）、連續高度場地形（`logic/heightfield.ts`、`three/terrainField.ts`，取代 `terraces`/`slopes`）、新模型 `landmark-sheng-ping-theater`；伺服器 `static.go` 路由放寬為 `^/island(/[a-z0-9]+(-[a-z0-9]+)*)?$`、`seo_meta.go` 新增 `seoPathAliases`。設計文件 `docs/refactor-island-terrain-2026-10.md`。
- **草稿清單標題與最後編輯時間**（`planning/timeline/drafts.ts`）：每筆草稿多 `title`（取前兩個站名，超過兩站加「⋯等」，沒有站名為「新行程」）與 `updatedAt`；`saveTimeline` 存檔成功後 `touchDraft`，草稿一編輯就進清單；新增 `deriveDraftTitle`、`sortDraftsByRecent`、`touchDraft`。舊資料（只有 `id`、`createdAt`）讀取時自動補值，不需遷移；「叫出舊行程清單」的畫面尚未實作。
- handbook 分類首頁：`HandbookHome`、`categories.ts`、`/category/{id}`、`system-maintenance` 群組與構想 `maintenance-01`。

### 修改

- `SafeAreaDebugOverlay`：修正容器尚未掛載時不會補算（框線完全不出現）的時序問題，改用重試（上限 2 秒）加 `ResizeObserver`；`?debugSafeArea=1` 不再強制停止播放態劇本。
- `/ai-plan` 播放態 `Content.tsx` 大幅瘦身（移除 `handedOver`、live 站點檢視、定位、光暈相關程式，兩個 `useFirstStopAutoPan` 合併為一個）；`.composerCta` 改為 `.composerCta.composerCta`，避免與 `components/Composer.module.css` 的 `.sendBtn` 因 CSS 打包順序互相覆寫。
- 手機版橫向卡片的關閉與「移動到此」按鈕改放右上角並排（線條圖示，圖示大小不變，觸控熱區用 `::after` 擴大 10px）。
- 九份頁（`JiufenPage`）新增 `SponsoredPlanCard`（placement `jiufen`）；KKday 聯盟卡片在 v0.45.0 已移除，期間因合併重新出現後再次移除，相對 v0.45.1 無新的版位移除。
- `HeroIsland.tsx` 補 `await createMini` 並在卸載時 dispose；封面鏡頭依畫面比例拉遠（`fitCoverToAspect`）。
- 文件與註解依新架構更新：`docs/terminology.md`、handbook `PlanDataFlowPage.tsx` 的「播放態／推論態」改述為兩個獨立路由（移除 `handedOver` 說法），`SimPlanLayer`、`LivePlanLayer`、`LiveContent`、`useSimulatedStopsView`、`HorizontalPlanTimeline`、`PlanTimelineView` 等檔的過時註解同步修正；`docs/research-plan-actions-inventory-2026-10.md`、`docs/research-timeline-core-comparison-2026-10.md` 是帶日期的研究快照，仍描述 `handedOver`，視為歷史紀錄未改。
- handbook 十餘個頁面的返回連結改指 `/category/system-docs`；`web/vite.config.ts` 的測試環境設 `VITE_FEATURE_ISLAND_SAMPLE='true'`（dev 設定不變）。

### 測試

- 新增：`liveHandoverUrl.test.ts`、`panel/toolCallLog.test.tsx`、`sdk-proposals/toAgentBridgeTools.test.ts`、`timeline/Timeline.note.test.tsx`、`itineraries/stopCardNote.test.tsx`、`seo_meta_test.go` 的 `/ai-plan/live` 與 island 別名測試、`partnerconsole_test`、`partner_tenant_isolation_test`、`partner-cli/detail_test`，以及 island 的 `IslandPage`、`scenes/registry`、`heightfield`、`walk`、`explorer` 等測試；`crud.testutils.tsx` 的 `shownNote` 跟著新的備註位置調整。
- 完整 `npm test`：244 個檔案、2525 個測試通過（3 個略過）；`go test ./cmd/server/...` 通過。

### 已知未處理

- `LiveContent`、兩個 `LayoutDebugOverlay`、`web/partner`、`SponsoredPlanCard` 沒有自動化測試；`PlanTimelineView`、`HorizontalPlanTimeline` 的備註 `title` 沒有獨立測試。手機觸控裝置看不到 `title` 提示，長備註在手機版與桌面直向卡片仍只能看到截斷的單行。
- 手機版卡片 322px 與安全區 476px 只在 500px 寬的視窗實測過（卡片 322px、安全區底邊距容器頂 11px），390px 寬未量；`marker-layers.html` 裡手動排版的標註文字只在 700px 寬看過。
- `/ai-plan/live` 沒有 noindex（專案無此機制）；`sortDraftsByRecent` 目前沒有呼叫端。
- `/island/<任何合法 id>` 伺服器一律回 200，不存在的 id 靠前端導回，爬蟲看不到 404；新增場景要手動在 `seoMetaByPath` 加條目；導覽結束的過肩鏡頭、街燈未做。
- 廣告：活動只看 status、不依起訖日自動切換；partnerserver 需另建 Cloud Run 服務與路由（程式碼內沒有部署設定）。
- 443de40 的 commit 訊息寫「修正部落格 Title 死欄位」，但差異裡沒有對應的程式變更（v0.45.1 時就沒有該欄位），本版不列入修改。
- `docs/attraction-theme-points-2026-09.md` 記載紅葉景點 86 筆「只寫入本機、尚未推正式站」，與 v0.45.1 CHANGELOG「已用 `attraction sync` 推到正式站」說法不一致，未查證；清邁段落（2 個主題點、10 個精選點）也只是文件，尚未寫入資料庫。
- `handbook/dist/` 是舊的 build 產物，下次 build 才會更新。

## v0.45.1 — 2026-10-27

紅葉前線的賞楓景點新增 11 個精選行程連結（原本只有定山溪），行程靜態檔改放 `example/momiji/` 子目錄；每份新行程的左側「相關資訊」區塊帶「紅葉前線」連結。**無資料庫結構變更；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）；無新的 npm 相依；無不相容變更**（`example/` 內的行程檔搬了位置，但都經 `registry.ts` 的 glob 載入，沒有程式直接匯入這些檔案的路徑）。

### 新增

- **11 份紅葉主題精選行程**（`web/src/itineraries/example/momiji/`）：`kyoto-arashiyama-1day`、`kyoto-higashiyama-1day`、`nikko-2day`、`hakone-2day`、`kawaguchiko-1day`、`miyajima-1day`、`oirase-1day`、`kakunodate-1day`、`yoshino-1day`、`kamikochi-1day`、`unazuki-1day`。站點的名稱、座標、`placeId` 都對應資料庫已建立的景點，同一區不排時間的周邊景點放在站點的 `attractions`（景點 id）。每份都帶 `sidebar`（延伸閱讀 → 紅葉前線）。這些檔案是資料庫 `itinerary_pages` 內容的靜態備份：行程頁以 API 為優先、查無才退回這裡；紅葉前線的景點卡片只讀這裡。
- 紅葉前線 `momijiSpots.ts` 的 12 個景點（原本 1 個）有 `itineraryId`，點開出現行程摘要卡片；`spotItinerary.test.ts` 新增「12 個景點與行程 id 的對應」測試。

### 修改

- 行程靜態檔搬進子目錄：`jozankei-1day.ts` 從 `example/` 移到 `example/momiji/`（內容不變，只改型別匯入路徑）。`registry.ts` 的 glob 改成 `./example/**/*.ts`（含子目錄）；紅葉前線 `spotItinerary.ts` 的 glob 只讀 `example/momiji/`。
- `MomijiFrontPage.tsx` 的卡片註解不再寫死景點數量。

### 資料（不在程式碼內）

- 景點：12 個主題點加周邊精選點（含吉野山、上高地）共新增 86 筆，已用 `attraction sync` 推到正式站。景點同步只搬景點表，照片沒有一起搬，新增景點尚未補圖。
- 行程：11 份已用 `itinerary-page add` 寫進正式站資料庫並發佈；修改行程內容時資料庫與靜態檔要一起改。

### 已知未處理

- 行程的時間與時長是依地理順序粗排，沒核對營業時間與交通時間；站間偏緊的有：奧入瀨 十和田湖 → 蔦沼（約 16 公里、只留 30 分鐘）、角館 抱返り渓谷 → 田澤湖（約 12 公里、只留 30 分鐘），嵐山與上高地有幾處站間 0 分鐘銜接。
- `spotItinerary.ts` 的 glob 只讀 `example/momiji/`，之後紅葉景點若要接到其他目錄的行程檔需一併調整。
- 11 份行程沒有交通資訊（`transitFromPrev`）；畫面（側欄、站點卡片、地圖）沒有在瀏覽器逐項確認。

## v0.45.0 — 2026-10-27

夜遊九份島後方改成一整面有菱角的峭壁山壁（九份依山而建），島的地形資料新增斜坡與貼坡擺放；首頁九份頁移除 KKday 聯盟卡片；行程詳情頁左側不再有全站預設連結。**無資料庫結構變更；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）；無新的 npm 相依。**

> **內部不相容變更**（0.x 階段依版號慣例升 minor）：
>
> - 移除 `web/src/itineraries/sidebarDefaults.ts` 與其匯出的 `DEFAULT_SIDEBAR_SECTIONS`：行程頁沒有設定 `sidebar.sections` 時不再顯示預設的「延伸閱讀／紅葉前線」連結，改為沒有連結（連結與廣告都沒有時整個區塊不渲染）。要顯示連結請在行程資料的 `sidebar.sections` 寫明。已確認專案內沒有其他引用。
> - 移除九份頁（`JiufenPage`）的 KKday 聯盟行銷 Deeplink 卡片與常數 `KKDAY_AFFILIATE_URL`、CSS 類別 `.jiufen-affiliate-*`，以及埋點 `affiliate_link_click`（`partner: 'kkday'`）。這是使用者看得到的版位移除，不是純內部重構。

### 新增

- **夜遊九份島：斜坡（`layout.slopes`）**（`island/logic/terrain.ts`、`data/layoutTypes.ts`）：每塊是頂視圖多邊形加方向線（`from`→`to`）與高度（`y0`→`y1`），沿方向線線性升高、兩端夾住；`heightAt` 取階地與斜坡裡最高者，所以路徑、站點、旅人、散落物都自動貼著斜坡。`validateLayout` 檢查輪廓點數與自交、`from`/`to` 重合、高度不得低於 `topY`、頂點超出島輪廓（警告）。
- **夜遊九份島：整面後山壁**（`island/data/layout.ts` 的 `SLOPES`）：沿島北緣（向內縮 6%）橫跨整個島寬，前緣接階地後緣（y=6），以 60° 陡升約 4 格（高度約 12.9），之後夾住成平坦山頂。角度由 `SLOPE_DEG`、`SLOPE_RUN` 決定。
- **有菱角的峭壁外觀（`crag`）**（`three/terrain.ts` 的 `slopeGeometry`、新檔 `logic/delaunay.ts`）：頂面是「輪廓上每隔 `10/2^detail` 一個點＋內部抖動格點」的 Delaunay 三角剖分，所以稜面大小一致；內部頂點只往上長（最多 `amp`），輪廓上不動、往內依距離淡入，與相鄰地面、裙邊不裂縫；陡面用岩色、平緩處用草色，每片明暗不同；側壁沿輪廓分格並朝外凸出。非索引三角形、平面著色。頂面三角形排在緩衝區最前面，`geometry.groups[0]` 標出範圍。`validateLayout` 要求 `detail` 是 0~5 的整數、`amp` 不小於 0；凹形輪廓加峭壁給警告（Delaunay 不保證密閉）。注意 `heightAt` 不含起伏，畫面岩面最多比它高 `amp`。
- **貼坡擺放（`Placement.tilt`）**（`three/scatter.ts`、`logic/scatterResolve.ts`）：`tilt: [rotX, rotZ]`（弧度）讓物件的「上方」對齊坡面法線，再繞自己的上方轉 `rotY`；有 `tilt` 的物件不做「腳印等高」檢查，且可埋進坡面最多 `MAX_SINK`（1 格）。`validateLayout` 要求 `tilt` 是有限數字。
- **新模型 `deco-cliff-rock`**：有稜有角的峭壁岩塊，由旋轉過的方塊、四稜柱、四角錐疊成；目前在山壁上試放一顆（`layout.ts` 的第 10 步，放在所有亂數擺放之後，不影響其他散落物的位置）。

### 修改

- 夜遊九份島散落物（房子、樹、竹叢等）的擺放不得壓到斜坡輪廓內（`flatFootprint` 新增 `onSlope`），避免被岩面穿過；北側原本的部分擺放因此改變。
- 行程詳情頁左側「相關資訊」區塊：沒有 `sidebar` 資料也沒有廣告時整個區塊不出現；`aside` 的「相關資訊」landmark 只在區塊存在時才有。

### 已知未處理

- 未在瀏覽器逐項確認：首頁縮小島島底有幾根尖刺狀岩片（`/island` 沒看到；縮小島與主畫面共用同一套建島程式，疑為原本的島底岩造型，未查證是否為本次改動造成）；峭壁岩塊埋進坡面的接縫（相機最近距離限制，無法特寫）；夜色下山壁偏暗、稜面對比低。
- 山壁只有一顆試放的岩塊，尚無沿山壁自動擺放岩塊的規則；陡坡上（60°）不能放房子，需要之後做地基柱或整地。
- 地形仍是階地、斜坡、河等各自建網格，只有 `heightAt` 共用；尚未烘成共同的高度場，階地與斜坡交界仍靠「剛好等高」避免縫。

## v0.44.0 — 2026-10-27

紅葉前線頁新增北海道降雪與地面積雪、右側賞楓景點清單、景點行程摘要卡片，模擬起始日改為「今天」；行程詳情頁左側新增由資料控制的相關資訊區塊（站內連結與廣告版位）。**無資料庫結構變更（`itinerary_pages` 內容 JSON 新增選填欄位 `sidebar`，不需遷移）；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）；無新的 npm 相依；無不相容變更。**

### 新增

- **紅葉前線：北海道降雪與地面積雪**（`momiji-front/hokkaidoSnow.ts`、`snowfall.ts`，繪製在 `momijiRenderer.ts` 的 `drawSnow`）：畫在楓葉的同一張地圖 canvas 上，所以跟著地圖縮放、平移。
  - 只落在北海道本島陸地（輪廓取自 `JAPAN_LAND` 中含札幌的那個環）；地面積雪是約 130 個冷白色斑塊，從內陸（大雪山一帶）先出現、海岸一圈保持裸露，最大積雪量上限 0.7（零星分布，不鋪滿）。雪片依深度分三層（遠小慢淡、近大快實，帶短拖尾）。
  - 控制列最右新增雪花開關（`aria-pressed`）：預設開；系統設為「減少動態」時預設關，且積雪量從 0 開始。開啟後積雪量從 0.3 約 25 秒累積到上限，關閉後約 3 秒融化。
  - 效能：積雪畫進離屏 canvas 快取（簽名＝輪廓錨點、積雪量量化階、深淺色、畫布尺寸與 dpr，變了才重建），雪片不使用 `ctx.clip`，改逐片判斷是否在輪廓內並依深度分三組各一次繪製；楓葉 canvas 的外擴範圍 `OVERSCAN` 由 0.25 降到 0.1。實測（headless Chrome、預設縮放、積雪長滿）降雪開啟時幀間隔 41.9ms → 9.5ms，與關閉時相同。
- **紅葉前線：右側賞楓景點清單**（`SpotListPanel`、`spotList.ts`）：列出全部景點（名稱、地區與類型）；有精選行程的排最前面並多一個「查看行程」連結（`/itineraries/<id>`，埋點 `momiji_spot_itinerary_open` 帶 `from: 'list'`）；點一列讓地圖移到該景點（至少放大到 zoom 8）並開啟摘要卡片，埋點 `momiji_spot_list_click`。寬度 ≥768px 預設展開；手機寬度貼在播放控制列上方、預設收合，選取後自動收合。
- **景點行程摘要卡片與名稱文字可點**（`spotItinerary.ts`、`spotHit.ts`，`momijiSpots.ts` 新增選填 `itineraryId`）：有 `itineraryId` 的景點（目前只有定山溪 → `jozankei-1day`）點徽章或名稱文字會開摘要卡片（標題、地區、天數、站數、簡介，行程檔點開才動態載入），連到完整行程頁；游標移到可點區域變手指。命中判斷是徽章圓形加名稱文字矩形，文字字型與位移與繪製共用同一組常數。
- **行程詳情頁左側「相關資訊」區塊**（`itineraries/ItinerarySidebar`、`sidebarData.ts`、`sidebarDefaults.ts`、`sidebarAd.ts`）：站內連結＋廣告版位，內容由資料決定。
  - 行程資料新增選填欄位 `sidebar`（`types.ts` 的 `SampleSidebar`）：`sections`（陣列時完全取代預設連結區塊，空陣列代表不顯示連結）與 `ad`（`undefined` 用全站預設、`null` 不顯示、物件為該行程自己的廣告）。可寫在 `example/*.ts`，或像 `foodSpots` 一樣用 CLI 寫進 content JSON。沒有設定時用預設連結（`sidebarDefaults.ts`，目前只有「紅葉前線」）。
  - 畫面端會檢查資料（資料可能來自 API）：連結只收站內路徑（單一 `/` 開頭、不含空白與反斜線）、廣告的 `href` 與 `imageUrl` 只收 https，數量與文字長度有上限（區段 4、每段連結 8），不合格的項目直接丟掉。沒有可用廣告就整個版位不渲染（含「廣告」標示）；有廣告時連結帶 `rel="sponsored"`、新分頁開啟；沒有連結也沒有廣告時整個區塊不渲染。
  - 擺法：一般單欄版在視窗 ≥1320px 時貼在置中欄位左邊（捲動時黏住），較窄時接在內容下方；地圖版有美食清單時放在美食面板下方（`FoodSpotPanel` 新增選填 `footer`），沒有美食清單時是獨立左側面板（≥1024px 才顯示）。

### 修改

- **紅葉前線模擬起始日改為「今天」**（`momijiFrontModel.ts`）：原本是最早見頃日往前推 18 天（10/17），現在第 0 天是今天（本地 0 點），終點仍是最晚的預測見頃日（和歌山 12/12），`TOTAL_DAYS` 隨今天變動（10/27 為 46）。新增 `resolveSeasonStart`：今天不早於 12/12 時（例如隔年）退到 12/11，頁面顯示全國已轉紅。第一幀直接顯示今天各地的熟度，不從綠色漸變。
- 行程詳情頁地圖版手機寬度：返回鈕由 `top: 16px` 改為 `58px`（原本蓋在固定品牌列正上方、兩者疊在一起）；行程頁的品牌列標題過長時顯示省略號，不再延伸到登入與主題按鈕底下。
- 紅葉前線：選取清單景點時手機版自動收合；景點卡片在 ≥768px 往清單左邊讓開；文字摘要區（給爬蟲與螢幕閱讀器）裡的景點行程連結加 `tabIndex={-1}`，鍵盤 Tab 不會落在看不見的連結上；Maps 同步補畫後同一幀的 rAF 不再重畫一次。
- 測試固定系統日期（`momijiFrontModel.test.ts`），不再隨執行當天變動。

### 已知未處理

- 未在瀏覽器確認：行程詳情頁左側區塊的實際版面（單欄版 ≥1320px 的側欄、地圖版面板與美食面板下方的區塊）、手機版景點清單與播放控制列的間距；降雪的零星積雪只在預設縮放看過，近景與深色模式只有開發過程的截圖。
- 廣告版位沒有接任何廣告來源（`sidebarAd.ts` 為 `null`）；連結與廣告目前只能改 `example/*.ts` 或資料庫內容 JSON，沒有後台編輯介面。地圖版視窗 768–1023px 且沒有美食清單的行程，左側不顯示這個區塊。
- 紅葉預測資料是第 2 回（2026-10-01），來源預定 11 月上旬發表下一回；12/12 之後（含隔年）頁面直接顯示全國已轉紅。`momijiForecast.ts` 的金澤銀杏黃葉預測日是 11/10，來源頁目前寫 10/26（平年差 -15 日），疑似來源筆誤，未更新（頁面只用紅葉預測）。
- 降雪、積雪沒有依實際天氣變動：只是視覺效果，不代表真實降雪狀況。

## v0.43.0 — 2026-10-27

夜遊九份島（互動 3D 旅遊小島）從獨立原型轉為正式功能，完整版掛在 `/island`、縮小版放進首頁 hero；首頁「目的地」下方新增精選行程；sitemap 動態補上行程詳情頁；移除行程詳情頁的楓葉相框。**無資料庫結構變更；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）。有一個新的 npm 相依（`three@0.170.0`，`web/package-lock.json` 已更新），部署前需要 `npm ci`。**

> **內部不相容變更**（0.x 階段依版號慣例升 minor）：
> - `SampleItinerary.borderStyle` 欄位（`'treasure-map' | 'maple-leaf'`）從 `itineraries/types.ts` 移除，地圖外框裝飾固定為寶藏地圖（`playfulUI` 為真時畫指北針與暈影）。資料庫 `itinerary_pages` 內容若仍帶 `borderStyle` 會被忽略，不影響顯示。

### 新增

- **夜遊九份島 `/island`**（`web/src/island/`，原 `web/island-demo/` 獨立子專案搬入主網站）：依部落客文章「夜遊九份」（4 站）生成的低多邊形小島（three.js），傍晚到夜晚、紅燈籠沿步道一盞一盞亮起；可旋轉縮放、點站看資訊卡、時間滑桿與播放、導覽模式、下載附署名的分享圖、「用 Tripace 排我的九份」按鈕。網址參數 `?t=19:30`、`?q=low|mid|high`、`?debug`。three 只在這一頁與首頁 hero 的獨立 lazy chunk 載入。
  - server 同步：`static.go` 的 `knownRoutePatterns` 加 `/island`；`seo_meta.go` 的 `seoMetaByPath` 加 `/island` 的專屬 title／description／canonical（`web/src/island/seo.ts` 的 `SEO_TITLE`／`SEO_DESCRIPTION` 必須與它逐字相同，`seo.test.ts` 直接讀該檔比對）；`Dockerfile` 的 `SEO_TEST_MIN` 由 10 調為 11。
- **首頁 hero 縮小版 3D 島**（`web/src/home/heroIsland/`）：固定光照（亮色夕陽、暗色夜晚燈籠全亮）、背景透明、只自動旋轉、30fps、頁面 load 後閒置才載入、離開畫面暫停、減少動態時只畫靜止一幀；省流量、沒有 WebGL、版位太小或建立失敗時整個收起，hero 文字回到垂直置中。桌機文字在左、島在右，窄螢幕上下疊；整座島是連結，連到 `/island`。
- **首頁精選行程**（`web/src/home/FeaturedItineraries.tsx`）：目的地區塊下方，資料庫已發布的行程最多 3 筆（沿用 `useListItineraries`，依上架日期由新到舊），文字列表樣式（標題、「N 天 · M 站」標籤、簡介、箭頭），底下「看全部精選行程」連到 `/itineraries`；載入中一列骨架，載入結束沒有行程就整節不畫。埋點 `landing_featured_itinerary_click`、`landing_featured_itinerary_all_click`。
- **sitemap**（`server/cmd/server/sitemap.go`）：回應 `/sitemap.xml` 時，在靜態檔之後補上資料庫已發布的行程詳情頁 `/itineraries/{slug}`（已存在的 `<loc>` 不重複；讀取資料庫失敗退回靜態檔）；靜態 `web/public/sitemap.xml` 新增 `/itineraries` 與 `/island`。
- **文件**：`docs/island/`（實作計劃、視覺規劃、首頁 hero 整合計畫，附 `island-demo` 到新位置的路徑對照）、handbook 構想七「文章變島」頁、`web/src/island/README.md`；`test:ui` 分組納入 `src/island`（`web/package.json`、`.claude/CLAUDE.md`）。

### 移除

- 行程詳情頁的**楓葉相框**（`MapleLeaf`、`MapleLeafCorner`、`MapleLeafBorder`、`MapleVignette` 與全部 `.maple*` 樣式）與 `SampleItinerary.borderStyle`（見上方不相容變更）。秋日泡湯主題卡（`cardTheme: 'onsen-autumn'`）與 `mapleLeafPath.ts`（卡片上的楓葉圖樣）保留。

### 已知未處理

- 首頁精選行程：目前沒有「精選」欄位，只是最新 3 份；每次進首頁多打一次 `/v1/itinerary-pages`，內容由前端載入、爬蟲看不到；與上方目的地區塊的上下留白疊加後的視覺未在瀏覽器確認；`HomePage.heroIsland.test.tsx` 未攔截這個請求。
- 首頁 hero 縮小島與 `/island` 在實機上的版面、暗色配色、幀率與場景建構耗時尚未實際量測或檢視。
- 資料庫裡的 `jozankei-1day` 與 `kyushu-yufuin-beppu-4day` 在正式站仍是舊格式（`stops` 扁平陣列），不符 `isSampleItineraryShape`，詳細頁與清單會濾掉；本機資料庫的 `jozankei-1day` 已換成新格式。
- `/itineraries` 清單頁沒有專屬 SEO meta；靜態範例行程沒有動態 meta，也不在 sitemap。

## v0.42.0 — 2026-10-26

地圖站點圓點旁常駐站名，桌面時間軸的預設景點卡也能顯示主題點的子景點 chip（與手機共用同一個元件），文件站新增「時間軸架構」頁。**無資料庫結構變更；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）；無不相容變更。**

### 新增

- **地圖站名標籤**：行程站點圓點右側常駐站點名稱（單行、最寬 140px、超出省略號；`planning/map/mapMarkers.ts` 新增 `withMarkerLabel`，`planStopLayer` 套用，名稱併入 `contentKey`，名稱改變才重建）。手機沒有 hover，原本看不到站名。點名稱與點圓點一致（同一個 `gmp-click`、游標相同）。畫在三個入口共用的圖層上，所以 /ai-plan、登入後、行程詳情頁同時生效。已知限制：標籤沒有避讓，站點密集時會重疊；標籤蓋住的範圍點下去算點該站點。
- **子景點 chip 共用元件** `planning/timeline/ThemeChildChips`（由手機橫向時間軸原本的 chip 抽出，樣式不變）：手機橫向時間軸與桌面 `PlanTimelineView` 的預設景點卡都用它。
- **桌面預設景點卡新增子景點 chip**：節點帶 `attractions`／`places` 時，預設卡下方列出子景點（名稱經資料存取層解析，解析前顯示 id）。`PlanTimelineView` 新增選填屬性 `onSelectThemeChild(parentId, child)`；登入後（`TripPlanPage`）與 /ai-plan（`SimPlanLayer`）選中主題卡本身（與手機版一致），行程詳情頁選取該子景點。自訂卡（`renderStopCard`）不經過這裡。
- **行程詳情頁的主題點**：站點標記帶上 `children`（`resolveMapChildren`），選中主題點或點卡片上的子景點 chip 時，地圖展開範圍圓圈與子景點小點（與 /ai-plan、登入後同一套繪製）。`itineraries/example/` 目前沒有行程使用 `attractions`／`places`，實際要等有行程寫了這兩個欄位才看得到。
- **文件站**：新增路由 `/timeline-architecture` 與目錄項目，嵌入 `timeline-architecture.html`（時間軸的資料結構、五個入口的擁有者與資料來源、兩個檢視元件的差異）；`marker-layers.html` 補站名標籤說明。

### 修改

- 行程詳情頁不再為主題點另換自訂卡（`createRenderItineraryStopCard` 目前沒有任何呼叫端，函式與其註解仍在，另案處理）。
- 手機橫向時間軸的 chip 改呼叫共用元件，外觀與行為不變（刪除該檔自己的 `.themeChildChip` 樣式，只留卡片內外距）。

### 已知未處理

- 站名標籤的外觀（深色底圖的對比、密集重疊）尚未在瀏覽器確認。
- 桌面點 chip 在登入後與 /ai-plan 只選中主題卡本身（不指定子景點），與行程詳情頁選取子景點不同。
- `ThemeChildChips` 沿用手機版寫法：`<button role="listitem">`（螢幕閱讀器當清單項目而非按鈕），尚未改成 `<li>` 包 `<button>`。

## v0.41.0 — 2026-10-25

詢問頁（選國家、城市、景點、交通方式）大幅改版，全站「載入中站位」統一成共用元件，並讓資料未到時外框不再跳動。**無資料庫結構變更；環境變數、網址參數、localStorage key、LLM 工具、yaml、thought 皆不變（不需重推 onagent）。**

> **內部不相容變更**（只影響前端內部呼叫，0.x 階段依版號慣例升 minor）：
> - `useMapState` 移除 `onGeocodeCandidateText`／`onGeocodeCandidatePhoto` 參數（`outlineBindingFrom` 同步拿掉），`selectedCandidate` 改選填且不再使用；地點簡介與照片的補查移到 `usePlanningState`，依 `PlaceInfoContent.textStatus`／`photoStatus` 為 `'pending'` 觸發，並以 placeId 暫存（上限 100 筆）。
> - `usePlanningState` 的 `patchGeocodeCandidateText` 只在簡介查詢中才寫入、且只更新 `summary`／`badges`（原本會整包覆蓋候選資料）；`patchGeocodeCandidatePhoto(placeId, null)` 改標 `photoStatus: 'none'`。
> - `useAskPageBridge` 新增 `askPage`／`replaceAskPage`／`advanceAskPage`／`pendingId`，`showAskPage`／`askPageInput` 改由單一狀態 `AskPageState`（closed｜open 帶 input）衍生；關閉後 `askPageInput` 回到掛載時的預設值（原本殘留最後一次 input）。
> - `ListItemCard` 的照片改由 `FramedImage` 渲染（外框為 span，同時套 `photoClassName` 與 `placeholderClassName`）；`SimComposer` 的 `handedOver`／`userPrompt`／`setUserPrompt` 改選填且不再使用。
> - 多個 CSS module class 與 keyframes 被共用骨架取代而移除（見「移除」），只有各檔自己引用，無跨檔引用者。

### 新增

- **詢問頁**：
  - 換步驟依方向轉場（前進從右、返回從左；寬螢幕側欄向上浮起；減少動態時只淡入），換頁後焦點移到標題（僅在焦點不在輸入匡時），手機版面板高度平滑過渡。
  - 換頁後原位置卡片不再套 hover（`useHoverLock`）。
  - 城市頁與景點候選頁（含查詢中）左上角返回箭頭；詢問頁右上角關閉鈕取代「不用了」文字按鈕（aria-label 不變）；查詢中也能關閉。
  - 選完城市不再閃回時間軸：詢問頁全程不關閉；景點查詢 150ms 內回來直接換、超過才顯示「查詢中」且至少 300ms；景點查詢 15 秒逾時（視同無結果）。
  - 輸入匡提示文字隨畫面變動（`composerMode.ts`，預設「請輸入想去的地方」、思考中「AI 思考中…」、未設定 key 時「對話功能調整中，請稍候」，每句不超過 12 個全形字）；詢問頁等待使用者時輸入匡可直接輸入並走詢問頁送出（`submitAskPageText`）。
  - 手機 `/ai-plan` 推論態詢問匡與下方輸入列融合成一體（`PlanOverlayPanel.module.css` 的 `.fuse`，以屬性掛點——`AskShell` 的 `data-ask-part` 與 `Composer` 的 `data-composer-part`——加 `@supports selector(:has(*))`，詢問匡與輸入列兩邊都存在才生效，文字氣泡與播放態不套用）。
  - 抽出共用元件 `AskShell`、`AskOptionList`、`RegionOption`、`TransportOption`、`CandidateCard`（`ScriptedAskPage` 也共用 `CandidateCard`）。
- **共用載入站位元件**（`components/`）：`SkeletonBlock`、`SkeletonLines`、`SkeletonRegion`、`SkeletonMask`（遮罩真內容、不改盒模型）、`FramedImage`（固定外框、佔位、淡入、失敗佔位、`pending`、`unstyled`、外框 `ref`）；統一「淡色掃光」，減少動態時退成靜態底色。
- **版面站位**（資料未到、圖片載入中或失敗時外框尺寸不變）：縱向與橫向時間軸（站點卡文字行、交通膠囊、縮圖、照片橫幅）、地點資訊卡（桌面與手機：評分與簡介預留）、照片輪播、結果清單縮圖、行程詳情頁與城市頁照片（`photoSize`）、行程清單與詳情頁標頭骨架、部落格縮圖、分享連結 QR、推薦地點卡。
- **地點資訊**：簡介載入中顯示骨架、失敗顯示「簡介載入失敗。」、真的沒有才顯示「還沒有簡介資料」；照片有明確狀態（查詢中掃光、沒有或失敗為靜態佔位）；已查到的簡介與照片以 placeId 暫存，重開卡片不再閃骨架或重打請求。
- **測試與文件**：時間軸 CRUD 元件整合測試（28 個：14 個情境，直向與橫向各跑一次）、`docs/research-plan-actions-inventory-2026-10.md`（全部動作與回應方向盤點）；handbook 補上本輪新增元件、詢問頁狀態模型與「載入佔位該用哪個」。

### 修正

- 詢問頁「返回上一層」按了沒反應（橋接層「已有等待就忽略新呼叫」擋掉了返回；桌面版原本沒傳 `onBack`）。
- 換步驟時搶走輸入匡焦點；高度過渡在動畫中又換步驟會讓 `overflow` 永久 hidden；滑入動畫在同一步驟內重播。
- 橫向時間軸旅館入住日剛好是空天時「Day N」出現兩次；候選縮圖網址失效破圖；照片橫幅沒有淡入；按「重試」時清空失敗照片網址，短暫斷網後可重新載入。
- 地點簡介與照片：同一地點重開卡片照片永遠掃光、確定沒照片也一直掃光、簡介重開每次重打請求、`patchGeocodeCandidateText` 覆蓋完整候選資料。
- 站點卡縮圖底色為漸層時查詢中沒有任何載入提示（約 40 筆資料）；行程清單 API 卡住時停在無限骨架（改 10 秒逾時），失敗或逾時也會結束骨架。
- 播放態詢問頁 `onDone` 回傳的 `attractionId` 永遠是 undefined。
- `DatePickerPopover` 補位日期可被點選（現為不可點，仍固定 6 列）；`PlacePanel` 日期測試不再依賴今天的日期。

### 移除

- 詢問頁「不用了」文字按鈕（改為右上角關閉鈕）、站點縮圖與交通列的轉圈 spinner（`.thumbSpinner`）、被共用骨架取代的掃光動畫（`shimmer`、`horizontalShimmer`、`horizontalSkeletonFade`、`photoPlaceholderShimmer`、`itineraryThumbSpin`、`onsenThumbSpin`）。

### 已知未處理

- 詢問頁逾時與清單逾時目前只是丟棄晚到結果，網路請求本身會在背景跑完。
- 排隊的輸入匡說明在推論結束時自動送出，可能關掉 LLM 剛開的詢問頁、按停止或重連後仍會送出。
- 「新行程」按鈕（`VITE_FEATURE_NEW_TRIP_DRAFT=true`）會夾在融合後的詢問匡與輸入列之間。
- 有標籤的站點卡在資料補齊後仍會長高約 36px；縮圖載入失敗一律顯示通用圖示（不再保留各卡片主題佔位）。
- 桌面與寬螢幕、登入後手機與播放態尚未套用融合；`moveDay` 的錯誤沒有 `code`；`planning/place/LateTextSkeleton.tsx` 的檔名與匯出（`SummarySkeleton`、`BadgeSkeleton`）對不上。
- 本版多數畫面僅以元件測試與讀程式驗證，尚未在瀏覽器逐項實測。

## v0.40.1 — 2026-10-24

延續 v0.40.0：時間軸操作層的命名統一並加上介面約束，onagent 正式機位址改為 `onagents.dev`，文件同步。**無資料庫結構變更；LLM 工具名稱、yaml、thought 不變（不需要重推 onagent）。**

> **內部不相容變更**（只影響前端內部呼叫，依使用者決定走 patch）：`usePlanTimelineCore` 與 AI 工具 ctx 的方法改名；視圖 props `onDragStopTime`、`onTransitModeChange` 改名。

### 變更

- **操作層命名統一**：站點名詞一律 Stop，動詞統一；核心 hook、AI 工具 ctx、模擬態、視圖 props 用同一組名稱——`insertAttractionAfter`／`insertAttraction`→`addStop`、`removeStep`→`removeStop`（內部 `removeNodeNow`→`removeStopNow`）、`dragStopTime`→`setStopTime`（`onDragStopTime`→`onSetStopTime`）、`setNoteForStop`／ctx `addNote`→`setStopNote`、`retryStopLookup`→`retryStop`、`addDayToTimeline`→`addDay`、`moveDayInTimeline`→`moveDay`、`setLodgingInTimeline`→`setLodging`、`removeLodgingFromTimeline`→`removeLodging`、`onTransitModeChange`→`onSetStopTransitMode`。領域層 `model.ts` 的純函式不改名。
- **`PlanOperations` 介面**（`planning/timeline/operations.ts`）：列出 9 個操作的簽章；`usePlanTimelineCore` 的回傳型別、AI 底層 `PlanAiCtxDeps` 以它約束；簽章較寬的 AI 工具 ctx 只以 `PlanOperationNames` 約束方法名（名稱約束、不是簽章保護，註解已寫明）。視圖 props 的參數型別由它衍生。
- **onagent 正式機位址改為 `https://onagents.dev`**（同一台服務，金鑰與 Allowed origin 沿用）：`deploy-cloudrun.yml` 的 `VITE_ONAGENT_URL`、`update-secret-manager.sh` 與 `.env.example` 的說明，以及網站五個「Powered by onagent」連結。
- **文件**：`marker-layers.html` 新增「時間軸操作的名稱與介面」對照表與「規劃中：雙向串接」說明，重要決策紀錄補 3 條；`/plan-data-flow` 的舊名稱同步。

### 已知未處理

- 雙向 adapter 串接（指令方向 `PlanOperations`、回應方向 `PlanUpdates`，範圍涵蓋所有動作）只完成命名與第一個介面，後續分階段進行。
- `web/tools/onagent-tools.yaml` 的 BackendDispatch 仍指向 `https://tripace.shuttle.tools`（該網域整站 301 轉址到 `tripace.io`），POST 遇到轉址的處理待確認。
- 本機 `onagent-cli-setup` skill 說明仍寫舊網域 `onagent.shuttle.tools`。
- `PlacePanel.test.tsx` 有 2 個日曆測試失敗，找不到固定日期的按鈕，與本版改動無關（疑與日期有關）。
- 上線前事項同 v0.40.0（正式機推送 `web/tools/plan-ai/` 的工具與 thought、`itinerary_pages` 轉新格式）。

## v0.40.0 — 2026-10-24

規劃時間軸的資料結構與前端目錄大幅重整：時間軸改成依天分組、節點不再存 `day`，執行狀態與對話搬出節點，資料來源上移到根部共用 store，三個入口的地圖連線統一，前端規劃程式收進 `web/src/planning/`。**本版含破壞性變更；無資料庫結構變更，但資料庫 `itinerary_pages` 的內容格式與 onagent 工具定義需要在上線前處理（見最後一節）。**

> **不相容變更**（0.x 階段依版號慣例升 minor）：
> - `PlanTimeline` 由鏈結串列改成 `{ days: PlanDay[]; lodgings?: PlanLodging[] }`；節點不再存 `day`（讀取時補衍生值），`PlanNodeType` 只剩 `'stop'`（`message`、`section` 移除）。節點的 `loading`／`failed`／`removing`／`googlePhotoUrls`／`children` 等欄位移除，主題子景點改存 `attractions`（景點區域 id）與 `places`（placeId）兩個 id 陣列。
> - 行程詳情頁的 `SampleItinerary` 直接帶 `timeline: PlanTimeline`，`SampleStop`、`days`／`stops` 欄位移除；16 個範例檔已轉。
> - 前端規劃相關目錄全部搬進 `web/src/planning/`（`plan-core`、`geo-planning`、`trip-plan`、`home/plan-ai-sim`、`desktop/`、`phone/` 的規劃檔案），非元件的檔名去前綴；舊 import 路徑全部失效。`itineraries/` 沒有移動。
> - `web/showcase-demo` 改名為 `web/handbook`（系統文件站）；`server/tools` 移到 `web/tools`（onagent 工具定義與 thought，推送指令路徑隨之改變）。
> - 對話改成純記憶體，不再持久化；`conversationStore`、`PlanMessage.ephemeral` 移除。
> - `PlanMapSharedProps.showPlanRouteLine` 改為 `routeSegments`；`routePolylineLayer`、`itineraries/routeSegments` 移除；`useSharedDrawLayer` 的 `extraLayers` 參數移除。
> - `HorizontalPlanTimeline` 的 `dataSource` prop、`PlanTimelineView` 的 `resolvedRefs` prop 移除，改由 `PlanDataProvider` 提供；`usePlanTimelineCore` 的 `commitTimeline` 在存檔失敗時回 `ok:false`（錯誤碼 `save_failed`）。

### 新增

- **依天分組的時間軸領域層**（`planning/timeline/model.ts`）：`addDay`／`removeDay`／`moveDay`、住宿（`lodgings`）系列函式；AI 工具新增 `add_day`、`move_day`、`set_lodging`、`remove_lodging`，`list_itinerary` 回傳依天分組並帶住宿，`add_attraction` 可指定天（相鄰天最多跳 5 天）。
- **共用 `usePlanTimelineCore`**：/ai-plan 模擬態、推論態與 `TripPlanPage` 的插入、移除、拖曳時間、交通重算、重試全部收斂成同一份；執行狀態另放 `planNodeStatus`（記憶體，不存檔）。
- **資料來源上移**：`PlanDataProvider` 與共用 store（每個資料存取層實例一個，各入口根部提供）；5 分鐘 TTL、回到前景與每分鐘檢查過期重取、失敗 30 秒後才重查、補照片迴圈；行程詳情頁只剩一份時間軸。
- **AI 把關**：停止鈕世代防護（`bridgeGuard`）、行動前先 `list_itinerary`（`planAiCtx`）、連線重建時重設「AI 思考中」；輸入列推論中改為停止鈕。
- **連線統一為 `routeLineLayer`**：一段一條、只畫有交通膠囊的那一段、顏色一律用主題強調色、畫成弧線（弧度為弦長 12%）、線寬 2.5px、箭頭依段長分級且不出現在起點；深色主題光暈。
- **圓形 marker 以圓心對準座標**（`MarkerDrawable.anchor`，預設 `bottom`，圓形一律 `center`）。
- **測試 script 依模組分區**：`test:core`／`test:map`／`test:plan`／`test:itinerary`／`test:ui`／`test:changed`；`.claude/CLAUDE.md` 補測試怎麼跑。
- **文件站**：`marker-layers.html` 改成五欄對照（/ai-plan 手機分推論態與播放態）、新增 `planning/` 目錄樹與重要決策紀錄，並掛上文件站路由 `/marker-layers`；`/plan-data-flow` 補共用 store 與存檔失敗說明。

### 修正

- 在兩站之間插入已有座標的站時，下一站的交通沒有補算（連帶地圖線消失）。
- 存檔失敗（例如 localStorage 滿了）時，AI 工具仍回報成功；`removeStep` 第二階段失敗後節點卡成看不見又移不掉。
- 交通估算回來時沒檢查元件是否已卸載，「新行程」重新掛載後會寫進舊草稿。
- 資料 store 的 TTL 實際不生效；TTL 重取與補照片迴圈互卡；沒座標的地點詳情被快取 5 分鐘導致重試無效。
- 換 token 或重新登入後輸入框一直停在「AI 思考中」。
- 線的端點與站點圓點偏移（圓點圓心比座標高約 7px）。

### 移除

- 死碼：`usePlanStopMarkers` hook 與 `planStopOverlay`、沒人讀的 `lodging` 旗標管線、`arcPolylinePath`、`moveNode`／`setNodeDay`／`lodgingsOnDay`、`staleOtherMessages`、舊的 `planAiDataSource` 轉出外殼、`useResolvedNodeRefs` 的三層快取（檔案改名為 `timeline/resolved.ts`，只剩純函式）。
- 去掉 geo 前綴與 `GeoOutline` 用語的檔名與 hook：`useGeoOutlineMapState`→`useMapState`、`useGeoPlanningState`→`usePlanningState`、`geoSelection`→`explore/selection` 等；API 回應型別（`GeoAttraction` 等）不動。

### 上線前要做的事（目前只做在本機）

- **onagent 正式機**：推送 `web/tools/plan-ai/` 的 `add_attraction`、`list_itinerary`、`add_day`、`move_day`、`set_lodging`、`remove_lodging` 與 `thought.md`（`onagent tool create`／`onagent app thought set`，路徑已從 `server/tools` 改為 `web/tools`）；確認正式機支援 `/sse`（前端 `@onagent/bridge` 0.2.0 改用 `transport: 'sse'`）。
- **資料庫 `itinerary_pages`** 的內容要整份轉成新格式（`stops`＋`days` → `timeline.days[].nodes[]`、每站加 id 與 type、去掉 `day` 與照片網址、`photos` 改 placeId）；本機只有 `jozankei-1day` 已轉。舊草稿（localStorage）的相容處理另行排程。
- **已知未處理**：AI 移除站點時第一階段先回成功，存檔失敗要等淡出後才知道；`PlacePanel.test.tsx` 有 2 個既有失敗。

## 更早的版本(已封存)

舊版本的完整記錄搬到 `docs/changelog/`,內容原樣保留:

- [v0.30-v0.39](docs/changelog/v0.30-v0.39.md):v0.39.2 ~ v0.30.0
- [v0.20-v0.29](docs/changelog/v0.20-v0.29.md):v0.29.1 ~ v0.20.0
- [v0.2-v0.19](docs/changelog/v0.2-v0.19.md):v0.19.0 ~ v0.2.0
