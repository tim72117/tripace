# 全專案健康檢查（2026-10-16）

這是一次「檢查當下狀態」的快照，不是持續追蹤的稽核報告（持續追蹤的見 `audit-*.md`）。下次要再做一輪，請另開新日期的檔案，不要往這份疊加。

## 檢查對象與環境

| 項目 | 內容 |
|---|---|
| 版本 | `main` @ `4f14828`（最近的版號 `v0.35.0`，其後 `main` 另有 3 個提交） |
| 方式 | 在隔離的 git worktree 檢出該提交，不影響主目錄的工作內容 |
| Node | v26.7.0 |
| Go | go1.26.5 |
| 建置產物 | 比照 `Dockerfile` 的 `COPY --from=web-build` / `admin-build`，把前端與 admin 的 `dist` 放到 `server/cmd/server/web/dist`、`server/cmd/server/webadmin/dist`、`server/cmd/adminserver/web/dist`，才能編譯含 `adminserver` 的全部後端 |

## 結果總表

| 面向 | 結果 |
|---|---|
| 後端 `go build ./...`、`go vet ./...`（含 `adminserver`） | 通過 |
| 後端 `go test ./...` | 14 個套件通過、0 失敗；6 個套件沒有測試檔 |
| 後端 `go test -race`（`internal/api`、`apigateway`、`store`、`geo`） | 通過 |
| `Dockerfile` 測試數量檢查（`TestApplySEOMeta\|TestStaticHandler` 必須剛好 9 個） | 9，符合 |
| 真實建置產物下的 SEO 測試（`SEO_META_TEST_REQUIRE_REAL_BUILD=1`） | 通過 |
| 前端 `npm run build`（`tsc -b` + `vite build`） | 通過 |
| admin `npm run build` | 通過 |
| `showcase-demo` 型別檢查（`tsc -p tsconfig.app.json`） | 通過 |
| 前端 vitest | 57 個檔案、573 個測試：569 通過、4 失敗（2 個檔案） |
| `gofmt` | 13 個檔案不符合格式（見下） |

## 後端

- 套件共 20 個。**沒有測試檔的 6 個**：`cmd/adminserver`、`cmd/migrate-drop-photo-url`、`internal/auth`、`internal/model`、`internal/onagenttools`、`internal/tripsvc`。
- `internal/auth` 負責簽發與驗證 token，沒有任何單元測試，是這 6 個裡風險最高的一個。
- 編譯 `adminserver` 需要先有 admin 的建置產物（`go:embed web/dist`），單獨在乾淨的 checkout 跑 `go build ./...` 會失敗，這是已知前提，不是程式問題。

### `gofmt` 未符合格式的 13 個檔案

`internal/adminconsole/adminconsole.go`、`internal/adminconsole/health.go`、`internal/api/blog_photo.go`、`internal/api/content_page.go`、`internal/api/geo_outline_geocode_test.go`、`internal/api/itinerary_page.go`、`internal/model/model.go`、`internal/photoupload/photoupload.go`、`internal/photoupload/resize.go`、`internal/photoupload/resize_test.go`、`internal/store/entity.go`、`internal/store/testing.go`、`internal/store/uploaded_photos_test.go`。

`api.go`、`ratelimiter.go` 等近期修改的檔案都是合格的。這 13 個是既有的格式債，目前沒有任何流程在檢查 `gofmt`。

## 前端

### Node 26 下的 `localStorage`

新版 Node（v25 起，本次實測 v26）內建 Web Storage，沒帶 `--localstorage-file` 時 `globalThis.localStorage` 回傳 `undefined`；vitest 的 jsdom 環境裡 `window === globalThis`，jsdom 自己的 `localStorage` 因此拿不到。修正前在 Node 26 下整體失敗 45 項，其中 41 項是這個原因。

已在 `web/vitest.setup.ts` 補上保底（只在缺失時才補，優先使用 `globalThis.jsdom` 實例自己的 Storage，讓改寫 `Storage.prototype.setItem` 的測試仍然有效），修正後剩下 4 項。`Dockerfile` 與 CI 使用 Node 22，不受這個問題影響。

### 仍失敗的 4 項

| 檔案 | 項數 | 現象 |
|---|---|---|
| `src/geo-planning/PlacePanel.test.tsx` | 2 | 找不到名稱為 `2026年8月27日` 的按鈕。測試寫死了日期，該日期現在已是過去，日曆不再顯示 |
| `src/geo-planning/ExploreMap.searchEntries.test.tsx` | 2 | 錯誤訊息為 `mapRef.current.getDiv is not a function` 與 `button not found yet`。推測是測試的地圖 mock 缺方法，未深入追查 |

## 對 `v0.34.1..main` 的 code review 發現

範圍是 5 個提交、59 個檔案。以下依發現的內容列出，並標註對照原始碼後的判斷與處置。

| 發現 | 判斷 | 處置 |
|---|---|---|
| `clientIP` 退回可偽造的 `X-Real-IP`，可繞過訪客端點的 IP 節流 | 屬實（條件：`TRUSTED_PROXY_HOPS` 設得比實際層數大，或直連） | **已修正**（`85698f1`，隨 `v0.35.0` 部署），並補了繞過情境的測試 |
| `LivePlanLayer`「新行程」把舊時間軸以 `legacy` 歸檔，但該 id 沒有對應的 storage key；`activeDraftId` 只在 React state，重新整理就丟失 | 屬實；草稿清單目前沒有任何讀取端 | **未處理**。「新行程」按鈕受 `NEW_TRIP_DRAFT_ENABLED` 管控，預設關閉 |
| `PlanTimelineView` 交通方式選單：開啟選單的那一下沒有 `stopPropagation`，effect 掛上的 `document` click 監聽會被同一次點擊觸發而立刻關閉 | 很可能屬實，未實測 | **未處理**。受 `TRANSIT_MODE_SELECT_ENABLED` 管控，預設關閉 |
| `TripPlanPage` 的 `forceMode`（使用者選的交通方式）只作用在當次查詢，之後重算會退回預設 | 屬實 | **未處理**。同上受旗標管控。對應「交通方式選擇不保留」這個既有待辦 |
| `mapMarkerLayer` 的 `pointsKey` 漏了 `glyph`、`size` | 屬實（兩者確實被標記樣式使用） | **未處理**。需要「id、座標、名稱、種類都不變、只改這兩項」才會發生，影響低 |
| `mapMarkerLayer` 的自動平移 effect 依賴 `pointsKey`，任何 points 變動都會再平移 | 機制屬實 | **未處理**。目前沒有任何呼叫端開啟 `autoPanOnSelect`，屬潛在問題 |
| `suppressAutoScrollRef` 在「移除或拖曳沒有造成狀態改變」時不會被清除，吞掉下一次自動捲動 | 未驗證 | 未處理 |
| `planSimScrollSource.advanceTo` 一次只走一步，捲動一次跳多格時時間軸落後 | 未驗證 | 未處理 |
| `startNewDraft` 用 `crypto.randomUUID()` 沒有備援 | 屬實，但 `TripPlanPage` 已有 4 處同樣用法，不是新引入 | 未處理 |
| `useTripPlanTimeline` 在 `store` 參數換掉時不重新載入 | 潛在：目前只有 `LivePlanLayer` 會換 store，且它用 `key` 重新掛載 | 未處理 |

審查工具本身的準確度有限：同一輪審查曾出現行號與實際內容對不上、以及子代理自行加入原文沒有的歸納，所以上表每一項都對照了程式碼再下判斷，標「未驗證」的是沒有讀到足以確認的程度。

## 部署後冒煙檢查（`v0.35.0`，`https://tripace.io`）

`Deploy to Cloud Run` run `38823727540` 成功。對外檢查：`/`、`/ai-plan`、`/v1/itinerary-pages/jozankei-1day` 回 200；新的公開端點 `/public/geo/plan-ai/place-search`、`attraction-search` 不帶參數回 400（`缺少 query 查詢參數`，是 handler 的回應）；`/internal/geo/plan-ai/place-search` 回 401。

## 未涵蓋的項目

- 依賴漏洞掃描（`npm audit`、`govulncheck`）：需要連外，未執行。
- Lint：前端的 ESLint 在專案裡沒有設定檔（找不到 `eslint.config.*`），實際上沒有 lint 在跑。
- Playwright E2E（`web/tests/`）：與 vitest 是不同框架，未執行。
- IP 節流在正式機的實際行為：不能用打滿 300 次的方式測（會消耗 Google Places 配額），只有本機測試證明；正式環境前面是否另有負載平衡器（決定 `TRUSTED_PROXY_HOPS` 該設多少）尚未確認。
- 訪客在 `/ai-plan` 實際排出行程：需要真人操作與 AI 後端，冒煙檢查看不到。
- `code-mapper/` 子專案：未追蹤、被本機規則排除，不在檢查範圍。

## 重跑方式

```
# 後端（需先把前端與 admin 的 dist 放到 Dockerfile 指定的位置）
cd server
go build ./... && go vet ./... && go test ./... -count=1
go test -race ./internal/api ./internal/apigateway ./internal/store ./internal/geo -count=1
test "$(go test ./cmd/server/ -list 'TestApplySEOMeta|TestStaticHandler' | grep -c '^Test')" = "9"
SEO_META_TEST_REQUIRE_REAL_BUILD=1 go test ./cmd/server/ -run 'TestApplySEOMeta|TestStaticHandler' -count=1
gofmt -l .

# 前端
cd web && npm run build && npx vitest run
cd web/admin && npm run build
cd web/showcase-demo && npx tsc --noEmit -p tsconfig.app.json
```
