# 景點資料同步機制 — 上線前風險複查

對應功能：`docs/ATTRACTION_SYNC_DESIGN.md`（設計文件），實作於 commit `487aeb0`（`docs/playwright-walkthrough-feedback` 分支），新增 `server/cmd/cli/attraction_sync.go`、`server/internal/api/attraction_sync.go`/`synctoken.go`、`server/internal/attractionsync/`（`diff.go`/`handshake.go`/`precheck.go`/`push.go`）。

**結論：不建議直接 tag/部署到正式站。** 破壞性變更判準（見 `.claude/skills/version-tagging/override.md`）三條全部通過——純新增子命令與端點，未動到既有 CLI 介面、未刪除既有正式功能、未變更資料庫 schema。但「是否破壞性」與「是否安全可上線」是兩個不同維度：這個功能本身存在可被任意登入使用者利用的 SSRF/資料竄改鏈，以及會導致同步靜默失效的正確性缺陷。

## 風險清單（依嚴重度排序）

| # | 問題 | 嚴重度 | 位置 |
|---|---|---|---|
| 1 | `target` 零驗證 + `internalAuth` 無角色檢查 → 任意註冊使用者可觸發 SSRF、覆寫全域 sync-token、經由假 target 竊取/竄改/清空正式站景點資料 | **Critical** | `server/internal/api/attraction_sync.go:339-353`、`server/internal/api/middleware.go:94-107` |
| 2 | 錯誤訊息把 target 回應內容原樣回吐 → 內網探測與資料外洩管道 | **High** | `attraction_sync.go:728-731` → `:396` |
| 3 | ~~`NeedsSync` 忽略記錄筆數 `Count` → 同步靜默失效，使用者無感~~ **已修正** | **High** | `server/internal/attractionsync/diff.go:29-37` |
| 4 | `-retry` 是空殼旗標；續傳邏輯（`Transfer`/`ResumeFrom`/`PushTo`）在正式路徑上是死碼，唯一測到「中斷續傳」的整合測試測的是永遠不會執行的程式碼 | **High** | `attraction_sync.go:361`、`handshake.go`、`push.go` |
| 5 | `handshakeWrite` 在 `Written=false` 時仍回傳 `nil` error → 回報 `applied:true` 但實際未寫完 | **Medium** | `attraction_sync.go:768` |
| 6 | `toDelete` 無 sanity check，target 回傳不完整清單即可能觸發全表刪除 | **Medium** | `attraction_sync.go:224`、`:625-630` |
| 7 | `compare` 端點送空 list 即傾印全表（任何持有效 JWT 者可用） | **Medium** | `attraction_sync.go:178-231` |
| 8 | push 方向第二層單筆查詢失敗靜默 `continue`，`apply` 真寫入路徑上也一樣漏 | **Medium** | `attraction_sync.go:526-528` |
| 9 | `syncClient` 用 `http.DefaultClient`，無 timeout、無 redirect 政策 → handler 可被無限期掛住（DoS） | **Low-Medium** | `attraction_sync.go:723` |
| 10 | `saveSyncToken` 非原子寫入（無 temp-file + rename），並發 setup 可能寫出半截 JSON | **Low** | `synctoken.go:58` |

## 攻擊鏈詳述（# 1，最高優先）

`internalAuth`（`middleware.go`）只驗證「這是一把有效的自家 JWT」，沒有角色/擁有者檢查；`POST /v1/auth/register` 是公開端點。因此：

1. 攻擊者在正式站自行註冊帳號，取得普通登入 JWT。
2. 帶該 JWT 呼叫 `POST /internal/maintenance/sync/setup`，`target` 指向攻擊者控制的伺服器——`setup` handler 只檢查欄位非空，沒有 host 驗證、內網位址阻擋、白名單。sync-token 是全域單一檔案（非 per-user 隔離），寫入即覆蓋原有設定。
3. 帶同一把 JWT 呼叫 `POST /internal/maintenance/sync/attractions/run`，`direction: "pull"`。正式站主動對攻擊者的假伺服器發出 `compare` 請求，**body 帶上正式站全部景點資料**（`destinationList`/`localAll` 全量傳出）。
4. 攻擊者的假伺服器回傳偽造的 `toCreate`/`toUpdate`/`toDelete`，正式站的 `runSyncPull` 無條件用 `CreateAttractionWithID`/`UpdateAttractionFields`/（`allowDelete=true` 時）`DeleteAttraction` 寫入——**任意資料注入、竄改，或清空整張 `attractions` 表**。

根本落差：`docs/ATTRACTION_SYNC_DESIGN.md` 的「明確擱置」章節假設「本機是使用者自己的開發機，風險可控」，但程式碼把同一組端點也部署到了正式站，而正式站的帳號註冊是公開的——這個信任假設在正式站不成立。

## 已確認沒問題的部分

- **破壞性變更判準**：純新增，`api.go` 只新增路由、`main.go` 只新增 case 與介面方法、store 只新增函式，既有 CLI 子命令/端點/`attractionRow`/`AutoMigrate` 清單均未變動。
- **危險旗標的預設值是安全的**：`allowDelete` 與 `apply` 兩層（CLI 與 API）預設值都是 `false`（不刪除、dry-run），且有對照組測試涵蓋。
- **push/pull 方向本身沒有搞反**：`SourceCount`/`DestCount`、`NeedsSync` 呼叫參數、`allowDelete` gating 在兩個方向上都正確對應各自的 source/dest 角色。
- **sync-token 檔案權限正確**：0600/0700，本機檔案層級沒有洩漏問題（問題在於誰能觸發寫入/使用它，見 #1）。
- **`UpdateAttractionFields` 覆蓋既有欄位是刻意設計**（來源方為權威版本），非 bug，但意味著 pull 一筆 `Summary` 為空的來源記錄會清掉本機已補的內容，屬已知取捨。

## 測試涵蓋空隙

- 零個授權測試（未帶 token / 非管理者身分應被拒絕）——因為系統本身沒有角色概念可測。
- 零個 `target` 驗證測試——因為沒有驗證邏輯可測。
- `-retry` 沒有任何測試驗證 server 端實際行為（因為它沒有行為）。
- `TestCmdAttractionSync_RejectsInvalidDirection` 是 `t.Skip`（`cmd/cli/attraction_sync_test.go:107-109`）。
- push 方向的 `apply` 只有 1 個最簡情境測試；push 的 `toUpdate`（交集且欄位不同）與 `allowDelete` 刪除路徑完全沒測，pull 方向測得比較完整。
- 中斷/續傳在正式路徑上零覆蓋（`integration_test.go` 的兩個相關測試打在 #4 所述的死碼上）。
- 完全沒有併發測試（sync-token 全域單檔、非原子寫入的風險見 #10）。
- `clock_skew`/`schema_mismatch` 回 409 的端到端路徑沒有測試（只有底層單元函式有測）。

## 處理建議

**Tag/部署前的最低要求是 #1、#2、#4（#3 已修正）。**

- **#1 根本解法**：給 `/internal/maintenance/sync/setup` 與 `/run` 加上真正的授權檢查（目前「有帳號即維運人員」的模型撐不住這個功能）；同時對 `target` 加 host 驗證（禁止內網網段/loopback/link-local）、`syncClient` 設定 timeout 與 redirect 限制。
- **過渡方案**（時間壓力大時）：用環境變數把 `setup`/`run` 這兩支「主動發起請求」的端點在正式站部署時關閉，保留被動接收端點（push 仍可運作），把 SSRF 攻擊面整個移除；#4（`-retry` 空殼）當作已知限制留到下一版修，並在 CHANGELOG 明確記錄。
- 不論選哪個方案，**在問題 #1、#2、#4 修復或以上述方式緩解之前，不應該把這個功能對外部署到正式站**。

## 修正紀錄

- **#3（`NeedsSync` 忽略 Count）**：`server/internal/attractionsync/diff.go` 的 `NeedsSync` 新增「來源方與目的方筆數不同即視為需要同步」的判斷，不再只看最新一筆的 `UpdatedAt`。新增回歸測試 `TestNeedsSync_CountDiffersDespiteOlderTimestamp`（`diff_test.go`），直接對照本文件記錄過的重現案例（來源方 5 筆 vs 目的方 1 筆，目的方最新一筆時間反而較新）。相關套件（`attractionsync`/`api`/`cmd/cli`）測試全數通過。
