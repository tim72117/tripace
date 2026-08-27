# Functional Audit — tripace

> 本檔案記錄 tripace 專案的功能/架構稽核結果（邏輯錯誤、狀態管理問題、架構債、效能、程式碼品質），由 Claude 執行多代理掃描 + 對抗式驗證產出。安全性相關發現另見 `docs/audit-security.md`。
>
> **格式慣例**（詳見 `.claude/skills/project-audit-format/SKILL.md`）：
> 1. 「最新掃描結果」永遠放最上方，只放「這次才第一次發現」的新項目；不累加歷史章節。
> 2. 舊發現複核後，在原項目段落下方加一行「**現況（YYYY-MM-DD 複核）**」更新狀態，不重複整份描述。
> 3. 已確認修復的項目，從「進行中的發現」移到「已複核為安全/已解決的項目」。
> 4. `file:line`、觸發情境、修法建議等具體內容一律保留，不因整理而濃縮。
> 5. 嚴重度：🔴 critical｜🟠 high｜🟡 medium｜⚪ low
>
> **來源合併記錄**：本檔案於 2026-08-16 建立時，已將舊有的三份混合稽核文件中的功能/架構類發現拆分併入本檔案，並移除該三份文件——`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #4/#5/#6/#8/#10，即 F7/F12/F13/F14/F15）、`docs/PROJECT_HEALTH_REVIEW.md`（2026-07-22 初版／2026-08-03 更新，測試/依賴/程式碼組織/部署維運章節，即 F16-F20 與對應已解決項目）、`docs/architecture-review-2026-07.md`（2026-07-24 評估／2026-08-14 複查，二～六章，即 F21-F41）。安全類發現已同步拆分至 `docs/audit-security.md`。

---

## 最新掃描結果（2026-08-16）

**掃描方法**：6 個平行 finder agent（後端 attractionsync/photostorage/pexels、API/trip/entry 邏輯、前端 trip/clienttools/geo-planning、移除行為與跨檔案 trace、cleanup 角度、altitude/慣例角度）掃出約 20 個候選項目，再以 4 個獨立 verifier agent 對最強候選重新讀原始碼、逐一對抗式覆核。以下為本次**首次發現**且經驗證存活的功能類項目。

### F1 🟠 GCS 舊照片先刪除、後寫 DB，DB 失敗時照片變成孤兒引用
- **位置**：`server/internal/api/maintenance.go:169-186`（`handleMaintenanceAttractionUpdatePhoto`）
- **問題**：`s.photoUploader.Delete(ctx, *lm.PhotoURL)` 在 `s.store.UpdateAttractionPhoto(id, photoURL)` 之前執行且無回滾。
- **觸發情境**：GCS 舊照片刪除成功，接著 `UpdateAttractionPhoto` 因暫時性 DB 錯誤/逾時失敗——API 回傳 500，但景點記錄的 `photo_url` 仍指向剛被永久刪除的 GCS 物件，形成無法復原的壞圖，且回應已明確告知操作失敗，使用者無從得知圖片已消失。
- **驗證狀態**：CONFIRMED（獨立 agent 重讀程式碼確認順序與無回滾邏輯）。
- **建議修法**：調換順序（先確認 DB 寫入成功，再刪除舊物件），或改為非同步/延後清理孤兒物件的機制。

### F2 🟡 `updateAttractionPhotoFromPexels` 吞掉 GCS 上傳錯誤且不記錄 log（有意設計但缺 log）
- **位置**：`server/internal/api/maintenance.go:242-266`
- **問題**：`Upload` 失敗時 fallback 回傳原始 Pexels 外部連結、`err` 視為 `nil`。程式碼上方註解已明確說明這是刻意設計（落地失敗不應讓整個操作失敗），但與相鄰的刪除失敗路徑（`log.Printf`）不同，此處完全沒有 log，失敗無跡可尋。
- **觸發情境**：GCS 短暫不可用時，`attractions.photo_url` 會存成 `images.pexels.com` 外部連結而非 GCS URL，且沒有任何 log 可用來事後排查為何某筆記錄沒落地到 GCS。
- **驗證狀態**：CONFIRMED（設計本身合理，但缺 log 是可改善的落差）。
- **建議修法**：在 `err != nil` 分支補上 `log.Printf`，維持現有 fallback 行為即可。

### F3 🟠 `handleMaintenanceAttractionAdd` 同時吞掉 Upload 與 DB 寫入錯誤，可能產生孤兒 GCS 物件
- **位置**：`server/internal/api/maintenance.go:291-330`
- **問題**：`Upload` 成功、`UpdateAttractionPhoto` 失敗時，兩層 `err == nil` guard 均無 `else` 分支、無 log，`res.PhotoURL` 維持成呼叫前的原始外部網址，回應仍是 `201 Created`。
- **觸發情境**：GCS 物件已建立但 DB 沒有任何欄位指向它（孤兒物件，且未來 `photostorage.Delete` 的前綴清理邏輯也找不到它），API 回應看起來完全成功，實際上發生了資料落地失敗。
- **驗證狀態**：CONFIRMED。
- **建議修法**：至少補上 log；若要求資料一致性，可考慮 Upload 成功但 DB 失敗時嘗試刪除剛上傳的 GCS 物件做補償。

### F4 🟡 `ListEntriesByRange` 在只給 `to`（無 `from`）時，無日期的 entry 會被排除
- **位置**：`server/internal/store/entries.go:163-183`
- **問題**：`to` 條件的 SQL 子句固定加上 `start <> ''`，導致未設定 `start` 的 entry（無日期的待辦型項目）在只有上界、沒有下界時仍被排除，即使邏輯上「無日期」應該落在任何「早於某日」的範圍內。
- **有真實呼叫端會觸發**：`server/internal/wanttools/entry_query.go:94` 呼叫 `ListEntriesByRange(tripID, from, to)`，其 tool 宣告明確教 LLM「不限定起點就留空字串」/「不限定終點就留空字串」，也就是單邊範圍查詢（例如「列出六月一日之前的行程」）是預期且被鼓勵的使用模式，不是理論邊界情境。
- **驗證狀態**：CONFIRMED（含真實呼叫端追蹤）。
- **建議修法**：當 `from == ""` 時，`to` 篩選不應加上 `start <> ''` 排除條件，讓無日期 entry 在單邊查詢下正常出現。

### F5 🟡 PATCH `UpdateEntry` 無法把字串欄位清空（空字串與未提供無法區分）
- **位置**：`server/internal/store/entries.go:86-127`（`UpdateEntry`），呼叫端 `server/internal/api/api.go:669-717`（`handleUpdateEntry` 解到純 `string` 而非 `*string`）
- **問題**：所有字串欄位（`title`、`start`、`startTime`、`end`、`endTime`、`location`、`note`、`kind`）都用空字串當「不更新」的哨兵值，`if location != "" { fields["location"] = location }` 這類判斷讓「省略欄位」與「明確清空為空字串」無法區分。程式碼註解（`api.go:668`）承認這是刻意設計（「空字串視為不改」），但仍是真實存在的功能限制。
- **觸發情境**：使用者在 UI 把 `location` 清空並 PATCH `{"location": ""}`，`UpdateEntry` 會判定「沒有要更新」而跳過，舊值留在 DB，但 API 回傳 200，使用者誤以為清空成功。
- **驗證狀態**：CONFIRMED。
- **建議修法**：若要支援清空，需改用 `*string`（nullable）欄位配合「key 是否存在於 JSON」判斷，或提供獨立的「清空欄位」語意（如傳特殊哨兵值）。

### F6 🟡 `tripEntryUpdate.ts` 用 `||` 導致 `title`/`date` 無法清空
- **位置**：`web/src/clienttools/tools/tripEntryUpdate.ts:39-40`
- **問題**：`title: asString(args.title) || e.title` 與 `date: asString(args.date) || e.date` 對明確傳入的空字串會 fallback 回舊值；同檔案的 `time`/`note` 欄位（`:41-42`）正確使用 `!== undefined` 判斷來區分「未提供」與「明確清空」，程式碼自身註解（`:51-56`）也解釋了這個區分的重要性，但 `title`/`date` 沒有套用同樣的處理。
- **觸發情境**：LLM tool call 傳入 `trip_entry_update` 帶 `title: ""` 意圖清空標題，實際上會靜默不生效、舊標題被保留，但 tool 回傳結果顯示成功（`{ updated: id }`），使用者/LLM 無從得知清空失敗。
- **驗證狀態**：CONFIRMED（獨立 agent 重讀程式碼確認不一致）。
- **建議修法**：把 `title`/`date` 改成與 `time`/`note` 一致的 `!== undefined` 判斷模式。

### F7 🟡 `runSyncPush` dry-run 對單筆查詢失敗直接靜默 `continue`，無計數/警告
- **位置**：`server/internal/api/attraction_sync.go:549-560`（原 `docs/ATTRACTION_SYNC_SECURITY_REVIEW.md` 風險清單 #8 記錄為 `:526-528`，行號因後續改動略有偏移）
- **問題**：對 `diff.Intersection` 中每個 ID 逐一 GET 目標端資料，若單筆查詢失敗就 `continue`（註解自承「單筆查詢失敗不中止整個 dry-run，略過這筆的欄位級比對」），但 `syncRunReport` struct（`:443-453`）完全沒有 skipped-count 或 warning 欄位，跳過的筆數不會出現在 dry-run 報告或 `-apply` 的實際同步結果中。
- **觸發情境**：500 筆 intersection 中有 1 筆因為暫時性網路問題查詢逾時，該筆被排除在 `toUpdate`/`toUpdateRecords` 之外，dry-run 報告顯示一切正常，`-apply` 也永遠不會同步這筆實際上可能有欄位差異的資料，使用者完全看不到有東西被跳過。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #8，標註 Medium），本次掃描獨立重新發現同一問題並補上真實 `runSyncPull` 對照。
- **現況（2026-08-16 複核）**：CONFIRMED，仍未修復，且本次驗證新增了 `runSyncPull` 走 `/compare` 端點、不受此問題影響、bug 僅限 push 路徑的具體確認。
- **建議修法**：在 `syncRunReport` 加入 `Skipped []string` 或至少 `SkippedCount int` 欄位，並在跳過時記錄具體 ID，讓 dry-run 報告能誠實反映「這幾筆沒有比對成功」。

### F8 🟡 `GeoOutlineMap` 分類查詢無取消機制，慢的舊請求可覆蓋新請求結果（race condition）
- **位置**：`web/src/geo-planning/GeoOutlineMap.tsx:802-815`（`runCategoryQuery`），呼叫端 `handleCategoryClick`（`:820-832`）、`handleSearchThisArea`（`:843-847`）
- **問題**：`.then` callback 無條件呼叫 `setPlaces(result.places)`，沒有 AbortController、序號或檢查 `type` 是否仍等於目前的 `activeCategory`。
- **觸發情境**：使用者快速點擊「景點」再點「餐廳」，若「景點」的請求晚於「餐廳」回應才 resolve，畫面會顯示景點清單/地圖標記，但分類標籤 UI 顯示的是「餐廳」被選取，兩者不一致。
- **驗證狀態**：CONFIRMED（獨立 agent 重讀程式碼確認無任何取消/序號機制）。
- **建議修法**：加入 AbortController 或請求序號比對，`.then` 內先確認仍是最新請求才 `setPlaces`。

---

## 進行中的發現（依嚴重度排序）

*（以下為既有稽核文件記錄過、本次尚未逐一重新複核的項目，來源已於各項標註）*

### F12 🟠 `-retry` 是空殼旗標，續傳邏輯在正式路徑上是死碼
- **位置**：`server/cmd/cli/attraction_sync.go:361`、`server/internal/attractionsync/handshake.go`、`server/internal/attractionsync/push.go`
- **問題**：`-retry` CLI 旗標存在但續傳邏輯（`Transfer`/`ResumeFrom`/`PushTo`）在正式路徑上從未被呼叫到，是死碼；唯一測到「中斷續傳」的整合測試測的正是這段永遠不會執行的程式碼，測試通過不代表功能可用。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #4，標註 High）。文件同時記載 `TestCmdAttractionSync_RejectsInvalidDirection` 是 `t.Skip`（`cmd/cli/attraction_sync_test.go:107-109`），`-retry` 沒有任何測試驗證 server 端實際行為。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄，屬於 tag/部署前建議優先處理的三項之一（與 `docs/audit-security.md` S13 並列）。
- **建議修法**：接上實際的續傳呼叫路徑，或在功能未完成前於 CLI help/文件中明確標示 `-retry` 尚未生效，避免使用者誤以為已支援中斷續傳。

### F13 🟡 `handshakeWrite` 在 `Written=false` 時仍回傳 `nil` error
- **位置**：`server/internal/api/attraction_sync.go:768`
- **問題**：`handshakeWrite` 在寫入未完成（`Written=false`）的情況下仍回傳 `nil` error，導致上層誤判為成功，`-apply` 的回應會顯示 `applied:true` 但實際上資料沒有真正寫完。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #5，標註 Medium）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。
- **建議修法**：`Written=false` 時應回傳明確錯誤，讓呼叫端能正確反映「未完全寫入」的狀態。

### F14 🟡 `toDelete` 無 sanity check，target 回傳不完整清單可能觸發全表刪除
- **位置**：`server/internal/api/attraction_sync.go:224`、`:625-630`
- **問題**：若目標端因網路問題或 bug 回傳不完整（例如空的或截斷的）清單，`toDelete` 計算邏輯沒有任何上限/比例檢查，可能被誤判為「這些全部都該刪除」而觸發大量或全表刪除。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #6，標註 Medium）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。與 `docs/audit-security.md` 記載的「危險旗標預設值安全」（`allowDelete`/`apply` 預設皆為 `false`）互為緩解因子，但機制本身仍缺 sanity check。
- **建議修法**：對 `toDelete` 加上刪除比例上限（例如單次刪除超過來源總筆數的某個百分比時要求二次確認），或至少在 dry-run 報告中特別標示大量刪除的警訊。

### F15 ⚪ `saveSyncToken` 非原子寫入，並發 setup 可能寫出半截 JSON
- **位置**：`server/internal/attractionsync/synctoken.go:58`
- **問題**：寫入 sync-token 檔案時沒有用 temp-file + rename 的原子寫入模式，若並發呼叫 setup，可能寫出半截/損毀的 JSON 檔案。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #10，標註 Low）。文件同時記載 sync-token 檔案權限正確（0600/0700），問題僅在寫入時機而非權限。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。
- **建議修法**：改為 temp-file 寫入完成後 `rename` 的原子寫入模式。

### F16 🟠 測試覆蓋率低，CI 未執行任何測試
- **位置**：全專案（`server/`、`web/`、`web/admin/`）+ `.github/workflows/*`
- **問題**：
  - Go 測試覆蓋率低：全專案 12 個 `*_test.go`，對比 100 個 `.go` 檔案，比例約 12%（初版掃描時為 8/89）。`internal/api` 已有 `auth_test.go`、`cliauth_device_test.go`，但相對於該套件的路由與權限邏輯量仍明顯不足，`requireOwner`/`requireEditor`/`requireMember` 這類權限檢查與公開連結端點都還沒有測試覆蓋，是目前風險最集中的地方（呼應 `docs/audit-security.md` S1/S2 這類授權漏洞本應由測試攔截）。
  - 前端完全沒有單元測試（`web/`、`web/admin/` 皆無 `*.test.ts`/`*.test.tsx`，也沒有 vitest/jest），只有一支 e2e（`web/tests/e2e-mock-llm.spec.ts`，串 mock LLM）。
  - **CI 沒有任何一個 workflow 執行測試**——六個 workflow（`deploy-cloudrun.yml`、`deploy-admin.yml`、`deploy-migrate.yml`、`inspect-cloudrun.yml`、`ios-build.yml`、`reset-admin-password.yml`）都只做 build/deploy/維運操作，iOS workflow 也只是 `xcodebuild ... build` 純編譯檢查。等於「能編譯過」是目前唯一的自動化品質門檻。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「測試」章節（2026-07-22 初版，2026-08-03 更新，標註為「目前是最大缺口」）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核測試覆蓋率與 CI 現況，狀態延續 8 月初記錄。
- **建議修法**：先把已有的 12 個 Go test、`e2e-mock-llm.spec.ts` 接進 CI，形成一道底線，之後再逐步補測試覆蓋——比從零開始建立習慣容易。

### F17 ⚪ 前端子專案版本分岔：`web/` vs `web/admin/`
- **位置**：`web/package.json`（TypeScript 5.6、Vite 5.4） vs `web/admin/package.json`（TypeScript 7.0、Vite 6.0）
- **問題**：兩個前端子專案版本已分岔，長期不同步可能導致工具鏈行為差異、共用邏輯難以抽取。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「依賴與架構耦合」章節。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄。
- **建議修法**：找時機同步版本，避免越拖越難統一。

### F18 ⚪ `web/src/ChatScreen.tsx`（911 行）是目前前端最大單一檔案
- **位置**：`web/src/ChatScreen.tsx`
- **問題**：已有過一次拆分嘗試（commit `9b0b425`），但行數不減反增，目前是前端最大的單一檔案，值得再排一輪拆分。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「程式碼組織」章節。
- **現況（2026-08-16）**：本次未覆核行數是否有變化，狀態延續原記錄。
- **建議修法**：排一輪拆分，比照 `App.tsx`（已成功拆分為 `AppCommon`/`DesktopLayout`/`PhoneContent` 等元件，目前僅剩 112 行）的既有先例。

### F19 🟡 `server/internal/wanttools/` 高風險寫入類工具缺乏測試
- **位置**：`server/internal/wanttools/`（僅 `sink.go`、`task_plan.go` 有對應測試）
- **問題**：這些工具直接被 LLM 呼叫、影響使用者資料，優先給高風險的寫入類工具（`trip_entry_add`/`update`/`delete`）補測試，比全面鋪開更划算。這一點在公開連結開啟 `editable` 時更重要——那條路徑上未登入訪客的輸入會一路走到這些寫入工具。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「程式碼組織」章節。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄。與 F5/F6（entry 清空欄位問題）同樣落在 entry 寫入工具範圍內，建議一併規劃測試補強時考慮這兩類問題的 regression 覆蓋。
- **建議修法**：優先為 `trip_entry_add`/`update`/`delete` 補測試。

### F20 ⚪ 部署維運：Dockerfile 無 `HEALTHCHECK`、無 APM/tracing
- **位置**：`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`
- **問題**：三個 Dockerfile 都沒有 `HEALTHCHECK` 指令；沒有 APM/tracing/error-tracking 整合（Sentry、OpenTelemetry 等完全沒有）。近期已發生一次「健康檢查在正式環境失效才發現」的真實案例（commit `dba5145`，adminserver 曾漏設 `AI_PROVIDER`/`GOOGLE_API_KEY`/`GOOGLE_PLACES_API_KEY` 導致健康檢查一直回報未設定），這類問題本來能被監控機制更早攔截。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「部署維運」章節。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄。
- **建議修法**：補上 `HEALTHCHECK`；評估接入輕量 error tracking（如 Sentry 或 GCP Error Reporting）。

### F21 🟠 無 panic recovery，任一 handler/goroutine panic 會整個 process 崩潰
- **位置**：全 repo（`recover()` 零命中）
- **問題**：全 repo grep `recover()` 零結果，任一 handler 或 WS goroutine panic 會直接讓整個 process 崩潰，沒有任何隔離。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.1 韌性缺口」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 panic recovery middleware，至少在 HTTP handler 與 WS goroutine 層級攔截 panic，避免單一請求拖垮整個服務。

### F22 🟡 無 `http.Server` timeout、無 graceful shutdown
- **位置**：`server/cmd/server/main.go`（用 `http.ListenAndServe`）
- **問題**：無 `ReadTimeout`/`WriteTimeout`/`IdleTimeout`（slowloris 風險）；也沒有 graceful shutdown（signal handling + `srv.Shutdown`）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.1 韌性缺口」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`http.Server` 補上明確 timeout；加上 signal handling 與 `srv.Shutdown` 支援 graceful shutdown。

### F23 🟠 `AutoMigrate` 失敗不中止啟動，服務會降級啟動但外觀正常
- **位置**：`server/internal/store/store.go:55`
- **問題**：`AutoMigrate` 失敗時只設 `MigrationOK=false` 讓服務降級啟動，生產環境會出現 schema 不一致但服務看似健康；無版本化 migration、無 up/down、無 dry-run。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.2 資料層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。與 F20（健康檢查未涵蓋 DB）互相關聯——`/health` 目前不檢查 DB 也不回報 `MigrationOK`，兩者疊加會讓 schema 不一致的問題更難被及早發現。
- **建議修法**：換版本化 migration 工具（golang-migrate / atlas），`AutoMigrate` 失敗改成中止啟動而非降級。

### F24 🟡 無 connection pool 設定、store 層不用 `context.Context`、交易極少
- **位置**：`server/internal/store/`
- **問題**：
  - 無 `SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime` 設定，Cloud SQL 有連線上限，預設 unlimited 容易打爆。
  - store 層完全不用 `context.Context`，無法傳遞逾時/取消，慢查詢無法中斷。
  - 交易極少，僅 4 處 `db.Transaction`。entry 寫入 + trip 歸組 + message 關聯是多步驟寫入但未包在同一交易。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.2 資料層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 connection pool 設定；store 層全面加 `context.Context` 參數；多步驟寫入包進同一交易。

### F25 🟡 無結構化 logging、無 metrics/tracing、`/health` 不檢查 DB
- **位置**：全專案 logging（僅 `log.Printf`）、`server/internal/api/`（`/health` 端點）
- **問題**：只有標準庫 `log.Printf`，無結構化 logging（無 `slog`）、無 request ID/trace ID、無 log level；logging middleware 不印 status code、不印錯誤。完全無 metrics、無 tracing。`/health` 不檢查 DB，直接回 `{"status":"ok"}`，也不回報 `MigrationOK`，Cloud Run liveness 會誤判健康（已新增 `store.Ping(ctx)` 方法但 `/health` 尚未使用它）。commit `dba5145` 正是「adminserver 漏設環境變數導致健康檢查失效」的真實事故，證明目前機制無法主動告警（與 F20 為同一事故的不同面向記錄）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.3 可觀測性」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：換成結構化 logging（Go 1.21+ 內建 `log/slog`），加 request ID；logging middleware 補印 status code、response size、錯誤；`/health` 改成真的呼叫 `store.Ping` 並回報 `MigrationOK`；設 uptime check + alert policy。

### F26 ⚪ API 錯誤格式不一致、無統一 domain error type、設定散落
- **位置**：全 `server/internal/api/`
- **問題**：API 錯誤格式不一致（至少三種）：`writeErr` 的巢狀 `{"error":{"code","message"}}` vs `http.Error` 的扁平 `{"error","message"}`（且 Content-Type 是 `text/plain`）。無統一 domain error type，無法區分 400/403/404/500。設定散落：`os.Getenv` 分散在多個檔案，無集中 config struct，middleware 在函式內讀 env 導致測試難以注入。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.4 其他」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：收斂 API 錯誤格式成單一 schema，定義 domain error type 對應 HTTP status；集中設定管理成單一 config struct，啟動時驗證必要欄位。

### F27 🟡 前端無狀態管理方案，prop drilling 明確存在
- **位置**：`web/src/`（`createContext`/`useContext`/`useReducer` 零命中）
- **問題**：完全沒有狀態管理方案，全靠 `useState` + props。`useAppState()` 回傳多個欄位的 `ContentProps`，透過 `{...props}` 一路灌到子元件，`cfg`/`user`/`token` 幾乎每層都要接一次。伺服器狀態全部手寫 `useState + useEffect + fetch`，無快取、無去重、無 stale 處理（沒有 TanStack Query 之類的資料層）。零 code splitting：`lazy`/`Suspense` 完全無命中，首頁 landing page 的訪客也得付大 bundle 的代價。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.1 結構與狀態管理」。文件同時記錄「幾乎完全平鋪」「無 router」的舊評估已不準確：目前已出現 domain 分層目錄（`admin/`、`clienttools/`、`geo-planning/`、`sdk-proposals/`、`trip/`），且已導入 `react-router-dom`，仍有大量檔案留在根目錄，並非嚴格分層。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：引入狀態管理（Context + useReducer 或 Zustand），消除 prop drilling；伺服器狀態改用 TanStack Query；加 code splitting（`lazy`/`Suspense`）。

### F28 🟡 記憶化嚴重不足，`Timeline.tsx` 等元件零 `useMemo`/`useCallback`/`memo`
- **位置**：`web/src/Timeline.tsx`（539 行）等 7 個元件；`web/src/`（99 處 inline `style={{...}}`）
- **問題**：`Timeline.tsx` 零 `useMemo`/`useCallback`/`memo`，`MultiTrackTimeline` 每次 render 都重建整棵列表。`MessageBubble.tsx` 等 7 個元件同樣零記憶化，無 `React.memo`，每次 WS 事件更新 state，整棵 Timeline + 所有 MessageBubble 全部重繪。99 處 inline `style={{...}}` 每次 render 新建參考，破壞任何下游 memo 效果。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.2 效能」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`Timeline.tsx` 等熱點元件加 `useMemo`/`React.memo`；逐步把 inline style 抽成常數或 CSS class。

### F29 🟡 可近性（a11y）幾乎空白，15 處 `<div onClick>` 無鍵盤支援
- **位置**：`web/src/`
- **問題**：aria 屬性總共只有 4 個（1 個 `aria-hidden`、2 個 `aria-label`、1 個 `aria-live`）。15 處 `<div onClick={...}>` 無對應 `role`/`tabIndex`/`onKeyDown`——鍵盤與螢幕閱讀器完全無法操作。語意化 HTML 稀薄：全專案僅 1 個 `<main>`、1 個 `<header>`、1 個 `<nav>`、1 個 `<h1>`。無 focus trap（modal）、無 skip link、無系統化 `:focus-visible`。無 ESLint，自然也無 `eslint-plugin-jsx-a11y`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.3 可近性」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：建立 ESLint 設定（含 `eslint-plugin-jsx-a11y`），修不可鍵盤操作的 `div onClick`。

### F30 ⚪ 前後端型別靠手寫同步，無 OpenAPI/codegen，`request<T>()` 無執行期驗證
- **位置**：`web/src/api.ts`（`request<T>()`）、`web/src/types.ts`
- **問題**：`tsconfig.json` 有 `strict: true` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch`，`any` 用量極低（全專案僅 1 處且只在註解），零 `@ts-ignore`——型別安全本身做得好。但前後端型別靠手寫同步（`types.ts` 註解自承要手動對齊 Go 的 `model.go`），無 OpenAPI/codegen。後端改欄位前端不會有編譯錯誤——這是最大的型別風險。`request<T>()` 結尾 `return call.responseBody as T`，無執行期驗證（無 zod/valibot）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.4 型別安全」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**（長期）：用 OpenAPI 當單一真實來源，前後端型別都從 spec codegen；前端 API 回應加 zod 執行期驗證。

### F31 ⚪ 純全域 CSS，無 scope 隔離，斷點魔數重複
- **位置**：`web/src/styles.css`（2,475 行）+ `landing.css` + `debug.css`；`web/src/App.tsx:76`（`DESKTOP_BREAKPOINT = 768`）
- **問題**：純全域 CSS，無 CSS Modules / Tailwind / CSS-in-JS，類名靠約定，無 scope 隔離。有初步 design token（12 個 CSS 變數），但無 spacing / typography / radius / shadow scale，大量硬編碼數值。斷點魔數重複：`App.tsx:76 DESKTOP_BREAKPOINT = 768` 註解自承「需與 styles.css 的 @media 一致」——手動同步的耦合。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.5 樣式」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。此章節與 [[313a90a]]（桌面版對話小匡與行程管理重構，CSS 依歸屬拆分為按需引入模組）commit 有部分重疊，下次稽核應確認該次重構是否已緩解「純全域 CSS」問題。
- **建議修法**：視重構進度評估是否需要引入 CSS Modules 或建立完整 design token scale。

### F32 ⚪ API 層無重試/timeout/`AbortController`，`fetchPublicView` 繞過統一層
- **位置**：`web/src/api.ts`
- **問題**：`api.ts` 有統一的 `request<T>()` 封裝，集中處理 baseURL、Bearer header、JSON 序列化、`ApiError`，並用 pub/sub 把每筆交易餵給 DebugPanel——這部分設計良好。但無重試、無 timeout、無 `AbortController`（元件 unmount 後 setState 競態，與 F8 的 race condition 屬同類問題但不同端點）。`fetchPublicView` 繞過統一層，直接用裸 `fetch`，不進 ApiCall 紀錄、錯誤型別不一致。loading/error 全靠各元件手寫：`setError`/`setLoading` 散落各處各自處理，無全域 error boundary，401 過期無集中攔截。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.6 API 層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`fetchPublicView` 改走統一 `request<T>()` 層；補上 `AbortController` 支援；建立全域 error boundary 與 401 集中攔截。

### F33 ⚪ `web/admin` 與主專案完全解耦，工具鏈版本分岔，殘留誤建目錄
- **位置**：`web/admin/`、`web/src/admin/`（誤建的殘留目錄）
- **問題**：`web/admin` 是獨立的第二個 Vite SPA，有自己的 `package.json`、`tsconfig`、`node_modules`，與主專案完全解耦：不同身分系統（cookie session）、不同 API 前綴、不共用任何程式碼（連型別都各自手寫一份）。工具鏈版本分岔：admin 用 Vite 6.x + TypeScript 7.0.2，主專案用 Vite 5.4.11 + TypeScript 5.6.3（與 F17 同一問題的細節記錄）。無 monorepo 工具管理。admin 的 tsconfig 反而更嚴格（多了 `verbatimModuleSyntax`、`erasableSyntaxOnly`）。`web/src/admin/` 是誤建的殘留目錄（只含 `.env.local`、`dist/`、`node_modules/`，未被 git 追蹤），應刪除。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.8 web/admin 子專案」。
- **現況（2026-08-16）**：本次未覆核 `web/src/admin/` 殘留目錄是否仍存在，建議下次稽核順手確認並清理。
- **建議修法**：清理 `web/src/admin/` 殘留目錄；長期考慮收進 monorepo（pnpm workspace / turborepo）統一工具鏈版本。

### F34 🟠 CI 完全沒有跑測試，無 security scan
- **位置**：`.github/workflows/*`
- **問題**：CI 完全沒有跑測試：deploy workflow 只有 build → push → deploy，測試已存在卻完全沒接上，唯一的品質門檻是「能編譯過」（與 F16 為同一問題的不同記錄來源）。沒有任何 security scan：無 `govulncheck`、`npm audit`、Trivy/Grype、CodeQL、secret scanning。原文「push main 直接部署 prod」已不成立：`deploy-cloudrun.yml` 已改為 tag 觸發（`push: tags: ['v*']`）+ `workflow_dispatch`，但仍無正式 staging 環境或 required-reviewers 機制，打 tag 後仍是直接 100% 切換（無 `--no-traffic` + 逐步導流、無 smoke test、無自動 rollback）。無 PR 驗證 workflow：只有 `ios-build.yml` 有 `pull_request` 觸發，後端與前端的 PR 不跑任何檢查。`deploy-admin.yml` 的 `skip_build` 分支會部署 `:latest`，與 git SHA 脫鉤，難以追溯正在跑的是哪個 commit。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.2 CI/CD 缺口」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，與 F16 併同一輪處理效益最高。
- **建議修法**：建 CI workflow 跑 `go test` + `go vet` + `tsc --noEmit`（現有測試先接上，成本最低、立即見效）；加 `govulncheck` 與 `npm audit` 到 CI；加 PR 觸發的驗證 workflow。

### F35 🟠 只有一個環境（prod），跨專案資源錯配
- **位置**：GCP 專案設定、`server/deploy/setup.sh`
- **問題**：只有一個環境（prod），無 dev/staging。跨專案資源錯配：Cloud Run 與 Secret Manager 在 `shuttle-045094509`，但 Cloud SQL 在 `onagent-prod`，`setup.sh` 自己有一大段警告說這是寫死的、腳本無法處理，是專案改名（Shuttle → Tripace）遺留的命名混亂。secret 全部釘 `:latest`，改版會在下次 revision 靜默改變行為，無版本追溯。`--allow-unauthenticated` 寫死在兩個 deploy workflow，管理後台也是公開的，僅靠應用層 session 保護。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.3 環境管理」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：建 staging 環境，人工確認後才升 prod；secret 改用明確版號而非 `:latest`；長期評估 GCP 資源改名從 `shuttle-045094509` 遷到 tripace 命名。

### F36 🟠 資料庫維運：無備份策略文件、無 rollback 機制
- **位置**：`server/deploy/setup.sh`、`server/internal/store/maintenance.go`、`scripts/rotate_db_password.sh`
- **問題**：無任何備份策略文件或設定：全 repo grep `backup`/`備份`/`PITR` 零結果，Cloud SQL 是否啟用自動備份與 PITR，在 `setup.sh` 中完全沒設定。無 rollback 機制：grep `rollback` 零結果，`AutoMigrate` 只增不減，schema 無法回退；Cloud Run 雖可手動切 revision，但無腳本或 runbook。破壞性維運操作無保護：`DropLegacyEntryColumns()` 會 DROP 欄位，雖有冪等檢查與充分註解，但無二次確認、無備份前置檢查，直接對 prod DB 操作。`scripts/rotate_db_password.sh` 直接對 prod 操作，無確認提示、無 dry-run，誤執行會立刻讓服務認證失敗（需重新 deploy 才讀到新 secret → 有服務中斷窗口），另外組出的 DSN 用 `sslmode=disable`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.4 資料庫維運」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：確認/啟用 Cloud SQL 自動備份與 PITR；`rotate_db_password.sh` 加確認提示與 dry-run 模式；`DSN` 改用 `sslmode=require` 或更嚴格設定。

### F37 🟠 完全沒有 error tracking/APM/tracing/uptime 監控
- **位置**：全專案
- **問題**：完全沒有 error tracking / APM / tracing：grep `sentry|opentelemetry|prometheus|datadog|newrelic` 全 repo 零結果。無 uptime 監控、無 alerting。Dockerfile 無 `HEALTHCHECK`，Cloud Run 也沒設 startup/liveness probe，儘管 `/health` 端點已經寫好——健康端點寫了但沒人用（與 F20/F25 為同一問題群的不同記錄角度）。唯一的健康機制是 admin 後台的 `GET /admin/api/health/external`，是 pull-based 且需要人主動查看。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.5 監控與告警」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，建議與 F20/F25/F23 一併規劃（都指向「健康檢查與可觀測性」這同一組根因）。
- **建議修法**：接 error tracking（Sentry 或 GCP Error Reporting）；設 Cloud Monitoring uptime check + alert policy（至少 5xx 率與 `/health` 失敗）；Dockerfile 加 `HEALTHCHECK`，Cloud Run deploy 加 startup/liveness probe。

### F38 ⚪ 無 dependabot/renovate，`golang.org/x/crypto` 版本落後，無 IaC
- **位置**：`go.mod`、`server/deploy/`
- **問題**：無 dependabot / renovate，無自動更新、無漏洞告警。`golang.org/x/crypto` 版本落後（對照同檔 `x/sys`、`x/text`），crypto 是安全敏感套件，建議定期核對。`server/deploy/` 只有一支 `setup.sh`（一次性 GCP bootstrap），無 Terraform/Pulumi，所有基礎設施靠 shell script + 手動 gcloud，無 state 追蹤、無 drift 偵測。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.6 依賴管理」「4.7 IaC」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 dependabot 或 renovate；核對並升級 `golang.org/x/crypto`；長期評估導入 Terraform 管理 GCP 基礎設施。

### F39 🟡 時間欄位用 string 而非 timestamp，缺複合索引，缺外鍵約束
- **位置**：`server/internal/store/entity.go`（`entries` 表：`Start`/`StartTime`/`End`/`EndTime` 全是 `string`）
- **問題**：
  - 時間欄位用 string 而非 date/timestamp，無法用 DB 做範圍查詢最佳化與正確排序（此問題與 `docs/audit-functional.md` F4「`ListEntriesByRange` 排除無日期 entry」屬於同一資料模型根因的不同表現）。**注意**：確實存在一個已完成的 timestamptz 遷移（改成 `time.Time`+時區+`AllDay`），但只在未合併的本地分支上，尚未進主線，不宜視為已解決。
  - 缺複合索引：`entries` 只有 `trip_id` 單欄索引。常見查詢 `WHERE trip_id=? AND start BETWEEN ?` 應建複合索引；`ORDER BY created_at DESC` 亦無索引。
  - 缺外鍵約束：無 `entries.trip_id → trips.id` 等 FK，全靠 `AutoMigrate`。刪行程會留下孤兒 entries/public_links，需手動級聯。
  - 全面 hard delete，無稽核軌跡：無 `deleted_at`，誤操作刪除的資料無法復原，也無操作歷史可追查。
  - N+1 風險：`ListTripsForUser`（`store/channels.go:14-30`）用相關子查詢做 `member_count` 與 `last_message_preview`，行程多時等同每列各跑兩次查詢。
  - PII 明文儲存：`email` 明文；`entries` 的 `location`/`lat`/`lng` 是使用者位置軌跡，屬敏感個資，全部明文無欄位級加密。
  - `entries.detail` 用 JSON serializer，無 schema 約束，Postgres 下未用 `jsonb`，無法索引。
  - **做得好的**：`public_links` 的 `trip_id` 與 `link_token` 皆有 `uniqueIndex`；`users.email`/`apple_sub` 有 `uniqueIndex`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「五、資料模型」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，建議下次稽核確認 timestamptz 遷移分支是否已合併主線。
- **建議修法**：評估合併既有的 timestamptz 遷移分支；`entries` 加複合索引；補上外鍵約束或至少級聯刪除邏輯；評估 soft delete + 稽核軌跡（B-5 建議 #97）。

### F40 ⚪ 多人協作衝突處理基本上沒有，WS 只做無 payload 的廣播通知
- **位置**：WS Hub（`server/internal/api/ws.go` 一帶）
- **問題**：WS Hub 只做單向廣播，且只廣播 `{"event":"entries_updated"}` 這種無 payload 的通知，前端收到後自己重新 fetch。衝突處理基本上沒有：無版本號、etag、optimistic lock、CRDT 或 last-write-wins 標記。兩人同時編輯同一 entry 就是後寫覆蓋，對方只會收到「重新抓一次」的通知。角色只有 editor/viewer 兩級，無「可留言不可編輯」的中間態，也無轉移 owner。
- **首次記錄**：`docs/architecture-review-2026-07.md`「6.3 多人協作的薄弱處」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**（短期）：WS 廣播從「無 payload 通知 + 前端重抓」改成帶 delta payload，減少往返；（長期，B-1 建議 #55）評估 CRDT（Yjs/Automerge）做行程協作編輯。

### F41 ⚪ 功能缺口：無匯出、無通知、無離線支援、iOS 實質停止維護
- **位置**：產品功能層級，非特定檔案
- **問題**：搜尋（只有 LLM 語意查詢，慢/貴/不精確）、匯出（無 iCal/Google Calendar/PDF/CSV——行程 app 沒有日曆匯出是明顯缺口）、通知（零推播/email，邀請成員、行程變更、同行者編輯都不會通知）、離線支援（entries/trips 全靠 API，無 service worker/PWA manifest）、版本歷史與 undo、相片/附件、費用/分帳、整趟行程的地圖總覽（只有推薦景點有地圖）、交通/路線時間計算（有 geocode 但無點對點移動時間）。iOS 端最後兩次 commit 都是純改名/xcodegen 重生成，沒有任何功能 commit（此結論未重新複查，狀態可能未變），與後端的功能落差需要重新盤點。
- **首次記錄**：`docs/architecture-review-2026-07.md`「6.2 iOS」「6.4 功能缺口」。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄，屬產品規劃層級，非程式碼 bug。
- **備註**：`docs/architecture-review-2026-07.md` 原文附有完整的 B-3 產品功能建議清單（iCal 匯出、地圖總覽、交通時間計算、全文檢索、推播通知、PWA、相片附件、費用分帳等 15 項），為避免重複記錄，此處不逐條複製，需要時請參照該文件的「B-3. 產品功能」章節（該文件本身已於本次稽核整理後標記為可移除的來源文件，內容已完整併入本檔案與 `docs/audit-security.md`，若日後需要查閱原文可從 git 歷史還原）。

### F9 ⚪ `docs/routing-architecture.md` 仍記載已改名的路由（文件過時）
- **位置**：`docs/routing-architecture.md:108`
- **問題**：仍列出 `POST /internal/maintenance/landmarks/{id}/update-photo` → `handleMaintenanceLandmarkUpdatePhoto`，但 commit `3d8d300` 已改名為 `/internal/maintenance/attractions/{id}/update-photo` → `handleMaintenanceAttractionUpdatePhoto`（`CHANGELOG.md`、`tripace-cli` skill 文件都已同步更新，唯獨此文件遺漏）。
- **現況（2026-08-16 複核）**：CONFIRMED 為文件遺漏，非程式碼 bug，修法為單純更新文件內容對齊現有路由。

### F10 ⚪ `geo_outline.go` 的 `attractionResponse` 仍用 `Landmark*` 命名，違反 terminology.md 統一用語規則
- **位置**：`server/internal/api/geo_outline.go:89-91`（`LandmarkPhotoURL`/`LandmarkName` 欄位，JSON tag `landmarkPhotoUrl`/`landmarkName`）
- **問題**：`docs/terminology.md` 規定正式用語統一為「景點區域」/`Attraction`，介面用語不應有同義詞變體；commit `3d8d300` 已在 `maintenance.go` 做過同一輪「landmark → attraction」改名清理，但同一 commit 觸及的 `geo_outline.go` 卻遺漏了這兩個欄位，且未被 `terminology.md` 已知的 `server/internal/geo/places.go` `District`/`Landmark` 待辦揭露涵蓋——屬於清理漏網之魚。
- **現況（2026-08-16 複核）**：CONFIRMED，影響對外 JSON 欄位命名，前端/CLI 若依賴此欄位名稱需一併調整命名。

### F11 ⚪ `UpdateAttractionField` 白名單無法把 `summary` 清空為空字串
- **位置**：`server/internal/api/maintenance.go:470`（`handleMaintenanceAttractionUpdateField`），CLI 端同步限制於 `server/cmd/cli/main.go:435`
- **問題**：`in.Value == ""` 一律視為 `invalid_input` 拒絕，但 `summary` 是合法可更新欄位，使用者若想清空摘要沒有正常管道（僅能手動改 DB）。
- **現況（2026-08-16 複核）**：CONFIRMED，與 F5 屬同類「空字串當哨兵值」問題的另一個實例，可考慮一併處理。

---

## 已複核為安全/已解決的項目

### 已排除：GORM `Detail` 欄位序列化路徑不一致疑慮
- **原始疑慮**：`InsertEntry` 透過 GORM `serializer:json` struct tag 寫入 `Detail`，`UpdateEntry` 則手動 `json.Marshal` 後以 map 形式 `Updates`，懷疑兩條路徑long-term可能產生不同編碼結果。
- **複核結果（2026-08-16）**：REFUTED。已追查 GORM `schema.JSONSerializer.Value()` 原始碼（`gorm.io/gorm@v1.31.2/schema/serializer.go:104-113`），確認其實作同樣是 `json.Marshal` + `string()` 轉換，與手動路徑位元對位元相同，無編碼落差。此路徑另有回歸測試 `TestEntryUpdateDetail`（`server/internal/store/entries_test.go`）鎖定既有正確行為，不需修復。

### 已排除：`photostorage.Uploader` 零值 client 的 nil pointer 疑慮
- **原始疑慮**：`New("")` 回傳的 `&Uploader{}` 其 `client` 為 `nil`，若未來重構移除或調換 `bucket == ""` 檢查順序，可能造成 `u.client.Bucket(...)` nil pointer dereference。
- **複核結果（2026-08-16）**：目前所有呼叫路徑都先經過 `bucket == ""` 檢查才會碰到 `client`，現況不可觸發，純屬潛在地雷、非現存 bug，暫不需修復，僅記錄提醒未來重構此檔案時留意此隱性耦合。

### 已解決：私有依賴 `github.com/tim72117/want v0.0.2`
- **原始問題**：私有依賴需要 `GH_PAT` 才能拉取，構成單點失效風險，並帶入 `go-rod/rod` 等間接依賴。
- **修復確認**：`server/internal/wanttools/` 對 `want/types` 的引用已改為本地定義（見該套件的 `wanttypes.go`），`want` 已從 `go.mod`/`go.sum` 完全移除。連帶讓 4 支 Dockerfile 的 `GH_PAT` build-arg、5 個 GitHub Actions workflow 的對應設定都不再需要。`internal/wanttools/` 本身沒有被任何 binary import（`go list -deps` 對 `cmd/server`/`cmd/adminserver`/`cmd/cli` 驗證過皆為空），是保留下來的舊 want 對話系統工具實作，未被刪除（`docs/PROJECT_HEALTH_REVIEW.md` 記錄確認日期 2026-08-14）。
- **確認方式**：程式碼複核，`go list -deps` 驗證。

### 已解決：`web/src/App.tsx`（1295 行）技術債
- **原始問題**：單一檔案 1295 行，是前端最大的技術債訊號。
- **修復確認**：`App.tsx` 目前只有 112 行。內容已拆成 `AppCommon`/`DesktopLayout`/`PhoneContent`/`PhoneNavDrawer`/`SettingsScreen` 等元件，且導入 React Router 後只剩路由骨架（`PhoneNavDrawer` 之後已整個移除，功能併入 `PhoneTabBar`/`PhoneSideTools`/`TripManageModal`，見 `docs/terminology.md`；此處記錄的是本次拆分確認當下的狀態）。
- **確認方式**：程式碼複核（`docs/PROJECT_HEALTH_REVIEW.md`）。

### 已解決：過時架構/API 文件（`docs/API.md`、`docs/ARCHITECTURE.md` 等）
- **原始問題**：`docs/API.md` 認證章節過時、`docs/ARCHITECTURE.md` 自專案第一天後未再更新，兩者連同 `docs/ROADMAP.md`、`server/README.md`、`docs/pace-demo-data-audit.md` 描述的是「iOS + Mock 後端 + 訊息分類 + RAG 向量檢索」的早期構想，與現行架構已非同一系統。
- **處理方式**：修補成本高於重寫，已於 2026-08-03 直接刪除。**目前專案缺少後端 API 規格與整體架構這兩類文件**，待重寫（此為遺留待辦，非本次稽核新項目，暫不單獨編號追蹤，待有人重寫文件時另行處理）。
- **確認方式**：`docs/PROJECT_HEALTH_REVIEW.md` 記錄。

### 已解決：缺少 `CLAUDE.md`
- **原始問題**：專案沒有 `CLAUDE.md`，AI 協作每次都要重新建立上下文。
- **修復確認**：已有 `.claude/CLAUDE.md`（目前內容精簡，僅記載對話語言慣例）。
- **確認方式**：檔案存在確認（`docs/PROJECT_HEALTH_REVIEW.md`）。
