# Security Audit — tripace

> 本檔案記錄 tripace 專案的安全稽核結果，由 Claude 執行多代理掃描 + 對抗式驗證產出。
>
> **格式慣例**（詳見 `.claude/skills/project-audit-format/SKILL.md`）：
> 1. 「最新掃描結果」永遠放最上方，只放「這次才第一次發現」的新項目；不累加歷史章節。
> 2. 舊發現複核後，在原項目段落下方加一行「**現況（YYYY-MM-DD 複核）**」更新狀態，不重複整份描述。
> 3. 已確認修復的項目，從「進行中的發現」移到「已複核為安全/已解決的項目」。
> 4. `file:line`、攻擊情境、修法建議等具體內容一律保留，不因整理而濃縮。
> 5. 嚴重度：🔴 critical｜🟠 high｜🟡 medium｜⚪ low
>
> 2026-10-16 複核：對照 main @ 4f14828 逐項檢查，14 項發現均仍成立，另移除 1 個已過時的子項（S11 的 admin cookie CSRF）。
>
> **來源合併記錄**：本檔案於 2026-08-16 建立時，已將舊有的三份混合稽核文件中的安全類發現拆分併入本檔案，並移除該三份文件——`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（2026-07-xx，攻擊鏈分析）、`docs/PROJECT_HEALTH_REVIEW.md`（2026-07-22 初版／2026-08-03 更新，安全性章節）、`docs/architecture-review-2026-07.md`（2026-07-24 評估／2026-08-14 複查，一、安全性章節）。功能/架構類發現已同步拆分至 `docs/audit-functional.md`。

---

## 最新掃描結果（2026-08-16）

**掃描方法**：6 個平行 finder agent（後端 attractionsync/photostorage/pexels、API/trip/entry handler、前端 trip/clienttools/geo-planning、跨檔案 trace、cleanup/altitude 角度）掃出約 20 個候選項目，再以 4 個獨立 verifier agent 對最強候選逐一重新讀原始碼、對抗式覆核。以下為本次**首次發現**且經驗證存活的安全類項目。

*（本次掃描聚焦程式碼正確性層面的授權/資料洩漏問題，未新發現先前未記錄過的項目——本次找到的兩個 IDOR 端點〔`GET /v1/trips/{id}/entries`、`GET /v1/trips/{id}/members`〕經比對後確認在 `architecture-review-2026-07.md`〔2026-07-24 評估、2026-08-14 複查仍存在〕已有記錄，故不重複列為「新發現」，已併入下方「進行中的發現」S1/S2，並標註本次複核結果。）*

---

## 進行中的發現（依嚴重度排序）

### S1 🔴 `GET /v1/trips/{id}/entries` 缺少授權檢查（IDOR）
- **位置**：`server/internal/api/api.go:517-520`（`handleListEntries`），路由註冊於 `api.go:185`
- **問題**：`handleListEntries` 直接呼叫 `s.writeEntries(w, tripID)`，`writeEntries`（`api.go:721-731`）只呼叫 `s.store.ListEntriesByTrip(tripID)` 並回傳，全程未呼叫 `requireMember`/`requireEditor`/`requireOwner`，也未呼叫 `s.userFor(r)`。同檔案內的 `handleCreateTripEntry`（`api.go:550-554`）、`handleResetTripData`（`api.go:524-529`）等同類 handler 都有對應的授權檢查，此 handler 是唯一的例外。
- **攻擊情境**：任何登入使用者只要知道/猜到別人的 `tripID`，呼叫 `GET /v1/trips/{tripID}/entries` 即可取得該行程完整的 entry 清單（標題、地點、備註、經緯度），無需是該行程的成員。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.2 IDOR」章節，評估日期 2026-07-24，2026-08-14 複查仍確認存在。
- **現況（2026-08-16 複核）**：CONFIRMED，仍未修復。兩個獨立 verifier agent 分別重讀 `api.go` 路由註冊與 handler 實作，確認完全沒有授權檢查，與 7 月底的評估結論一致，超過 3 週未處理。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`handleListEntries` 現位於 `server/internal/api/api.go:1162-1164`，仍只呼叫 `s.writeEntries(w, r.PathValue("id"))`；`writeEntries` 現位於 `api.go:1365-1375`；路由註冊現位於 `api.go:658`。同檔案 `handleCreateTripEntry`（`api.go:1194-1196`）、`handleResetTripData`（`api.go:1168-1170`）仍有 `requireEditor`/`requireOwner`。
- **建議修法**：在 `handleListEntries` 開頭加入 `s.requireMember(w, tripID, s.userFor(r).ID)`（或視業務需求改 `requireEditor`），比照同檔案其他 handler 的作法。

### S2 🔴 `GET /v1/trips/{id}/members` 缺少授權檢查（資訊洩漏）
- **位置**：`server/internal/api/api.go:331-342`（`handleListMembers`），路由註冊於 `api.go:182`
- **問題**：直接呼叫 `s.store.ListMembers(id)` 並回傳，同樣未呼叫 `userFor`/`requireOwner`/`requireEditor`/`requireMember`。同檔案的 `handleAddMember`（`api.go:351`）、`handleSetMemberRole`（`api.go:401`）都有 `requireOwner` 檢查。
- **攻擊情境**：任何登入使用者呼叫 `GET /v1/trips/{tripID}/members`，可列舉出任意行程（不論是否為成員）的完整成員清單（user ID、角色）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.2 IDOR」章節，評估日期 2026-07-24，2026-08-14 複查仍確認存在。
- **現況（2026-08-16 複核）**：CONFIRMED，仍未修復。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`handleListMembers` 現位於 `server/internal/api/api.go:975-986`，仍直接呼叫 `s.store.ListMembers(id)` 且無任何授權檢查；路由註冊現位於 `api.go:655`；`handleAddMember`（`api.go:990`，`requireOwner` 於 `:995`）、`handleSetMemberRole`（`api.go:1040`，`requireOwner` 於 `:1045`）仍有檢查。
- **建議修法**：加入 `requireMember`（僅需能看見成員清單）或 `requireOwner`（若成員清單視為管理資訊），與 S1 一併修復時建議統一走同一套授權 middleware/helper，避免第三個 handler 再漏掉。

### S5 🟠 認證訪客回退：無效/缺失 token 直接繼承固定帳號 `usr_me` 的權限
- **位置**：`server/internal/api/auth.go:15-21, 26-36`
- **問題**：token 缺失**或無效**時不回 401，而是回退成 `guestUser{ID:"usr_me"}`。seed 會建立 `usr_me` 並加入示範頻道，等於任何未認證請求直接繼承其權限，下游所有 `requireOwner`/`requireEditor`/`requireMember` 檢查的價值因此打折扣。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.1 認證與授權」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次掃描未安排 verifier 重新覆核此項（不在本輪 6 個 finder agent 的掃描範圍內），狀態延續 7 月底評估的「高風險、未修復」，下次稽核應排入覆核範圍。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`userFor` 現位於 `server/internal/api/auth.go:14-20`，無 token/無效 token 仍回 `s.guestUser`（`api.go:340` 建立為 `ID:"usr_me"`）；`userFromToken`（`auth.go:~26-36`）簽章有效但使用者不存在時同樣回退訪客。部分端點已另外用 `isGuestUser`（`plan_ai_chat.go:54`）/`requireRealUser` 擋掉訪客，但回退機制本身仍在。
- **建議修法**：移除訪客回退，無效/缺失 token 一律回 401；若要保留免登入體驗，改成明確的匿名 session 而非繼承 `usr_me`。

### S6 🟠 Apple 登入不驗簽章，可偽造任意使用者身分
- **位置**：`server/internal/auth/apple.go:31-51`
- **問題**：只 base64 解 payload 取 `sub`，不驗 RS256 簽章 / `iss` / `aud` / `exp`。攻擊者可自製 `{"sub":"<受害者 sub>"}` 冒充任意使用者。
- **加成風險**：`cmd/server/main.go:36` 的 `devMode` 預設值為 `true`，會放大此問題的影響範圍。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.1 認證與授權」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續 7 月底評估，未確認是否修復，下次稽核應排入覆核範圍。
- **現況（2026-10-16 複核）**：部分緩解（PARTIAL），嚴重度維持 🟠。`server/internal/auth/apple.go:31-51` 現為 `devMode=false` 時在解析 payload 後直接回傳錯誤「apple signature verification not implemented」（fail-closed），所以正式環境若 `DEV_MODE=false` 就無法偽造；部署流程（`.github/workflows/deploy-cloudrun.yml:176`、`deploy-with-migration.yml:233`、`deploy-admin.yml:72`）皆設定 `DEV_MODE=false`。但仍未實作 JWKS/RS256/iss/aud/exp 驗證（等於 Apple 登入在正式環境不可用），且 `server/cmd/server/main.go:37` 的 `-dev` flag 預設仍為 `true`（`main.go:149-150` 僅在設了 `DEV_MODE` 環境變數時覆寫），任何漏設 `DEV_MODE` 的部署仍可被偽造。
- **建議修法**：實作 JWKS 簽章驗證（驗 RS256/iss/aud/exp）；`devMode` 預設值改為 `false`。

### S7 🟠 JWT 密鑰預設硬編碼
- **位置**：`server/cmd/server/main.go:35`
- **問題**：未設定 `JWT_SECRET` 環境變數時，使用硬編碼預設值 `"dev-secret-change-me"`，任何人可自簽任意 `sub` 的合法 JWT。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.1 認證與授權」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續 7 月底評估，下次稽核應優先確認正式環境是否已設定 `JWT_SECRET`（若已設定則風險已緩解，但程式碼層級的「未設定即用弱預設值」仍算設計缺陷，建議改為未設定即拒絕啟動）。
- **現況（2026-10-16 複核）**：程式碼層級仍未修復，行號已位移：預設值常數 `auth.DefaultDevJWTSecret = "dev-secret-change-me"` 位於 `server/internal/auth/jwt.go:~17-22`，`server/cmd/server/main.go:36` 以它作為 `-jwt-secret` 預設值，`main.go:146-148` 僅在 `JWT_SECRET` 有設時覆寫，未設時不會拒絕啟動。部署流程（`deploy-cloudrun.yml:192`、`deploy-with-migration.yml:234`、`deploy-admin.yml:73`）皆從 Secret Manager 注入 `JWT_SECRET`，故正式環境風險已緩解，但設計缺陷仍在。
- **建議修法**：未設 `JWT_SECRET` 即拒絕啟動，而非靜默使用弱預設值。

### S8 🟡 CORS `Access-Control-Allow-Origin: *` 對所有路由（含 `/internal/*`）無條件放行
- **位置**：`server/internal/api/middleware.go:61-63`（另見 `middleware.go:22-27`，允許 `Authorization` header）
- **問題**：無條件設定 `Access-Control-Allow-Origin: *`，程式碼自身註解已明確記載：「正式環境應收斂 Allow-Origin 為白名單，這是已知待處理項目，不應僅視為開發階段的暫時設定」。正式環境用的就是這個設定，沒有依環境切換的邏輯。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「安全性」章節（2026-07-22 初版，2026-08-03 複查仍確認未修復，且明確提醒「其餘項目多已解決，不要因此推論 CORS 也一併修好」）；`docs/architecture-review-2026-07.md`「1.4 其他 API 安全」同步記載。
- **現況（2026-08-16 複核）**：CONFIRMED，仍未修復（本輪 6 個 finder agent 之一的 altitude/慣例掃描重新確認此設定與註解內容與 8 月初一致）。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`server/internal/api/middleware.go:108-120` 的 `cors()` 仍無條件設定 `Access-Control-Allow-Origin: *`（`:110`），註解（`:105-107`）仍寫明「正式環境應收斂 Allow-Origin 為白名單」；`api.go:930` 的 `s.requestLogging(cors(mux))` 仍套用於所有路由（含 `/internal/*`）。
- **建議修法**：至少改讀環境變數決定允許的 origin 清單。

### S9 🟠 完全沒有 rate limiting
- **位置**：`/v1/auth/login`（密碼暴力破解）、`/v1/public/{token}`（token 枚舉）、`/v1/auth/register`（大量註冊）
- **問題**：內部端點完全沒有任何請求頻率限制。（`internal/apigateway` 已針對外呼 Google Places/Geocoding API 加上節流，但對內端點仍無防護。）
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.4 其他 API 安全」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續 7 月底評估。
- **現況（2026-10-16 複核）**：仍未修復（範圍略有縮小）。`/v1/auth/login`、`/v1/auth/register`、`/v1/public/{token}`（`server/internal/api/api.go:648-651, 668-669`）仍無任何 rate limiting，`handleLogin`/`handleRegister`（`auth.go`）內無節流。已新增的限流僅涵蓋 Google API 相關端點：`geo.RateLimiter`（`internal/geo/places.go`）、`planAiRateLimiter`/`geoQueryUserRateLimiter`/`geoQueryIPRateLimiter`/`planAiChatRateLimiter`（`api.go:185-234` 欄位宣告），不含登入、註冊與公開連結 token 查詢。
- **建議修法**：優先為 `/v1/auth/login`、`/v1/public/*` 加上 rate limiting。

### S10 🟡 公開分享連結 token 長度僅 6 bytes（48 bit），且無過期機制
- **位置**：`server/internal/store/public_links.go:11-15`（token 長度）、`server/internal/store/entity.go:75-82`（`publicLinkRow` 無 `ExpiresAt`/`RevokedAt`/存取次數欄位）
- **問題**：token 格式 `lnk_` + 12 hex，48-bit 長度配合無 rate limit，對持續掃描而言不是安全邊界；連結一經產生永久有效，無過期機制、無存取稽核。
- **已確認沒問題的部分**：撤銷機制本身存在且正確（`DELETE /v1/trips/{id}/public-link` 有 `requireEditor`）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「1.3 公開分享連結」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續 7 月底評估。
- **現況（2026-10-16 複核）**：仍未修復。`server/internal/store/public_links.go:11-15` 的 `newLinkToken()` 仍為 `make([]byte, 6)`；`server/internal/store/entity.go:557-572` 的 `publicLinkRow` 仍無 `ExpiresAt`/`RevokedAt`/存取次數欄位（行號已位移，僅新增 `ViewMode`、`Editable`）。撤銷機制（`public_link.go:85-87` `requireEditor`）仍正確。
- **建議修法**：token 長度提升到 ≥16 bytes；加上 `ExpiresAt`/存取次數欄位與基本稽核記錄。

### S11 🟡 其他既有 API 安全缺口（WS/安全標頭/錯誤訊息/輸入長度/密碼強度）
- **位置與問題**（皆來自 `docs/architecture-review-2026-07.md`「1.4 其他 API 安全」，評估日期 2026-07-24）：
  - WebSocket `InsecureSkipVerify: true`（`api/ws.go:21-23`），停用 origin 檢查；已補上 `requireMember` 身分檢查（accept 前驗證 JWT），但 token 走 query string 有經 proxy/瀏覽器歷史外洩的風險。
  - 無安全標頭：CSP、HSTS、X-Content-Type-Options、X-Frame-Options 全無。
  - 錯誤訊息洩漏內部細節：大量 `writeErr(..., err.Error())` 把 GORM/DB 原始錯誤（含 SQL 片段、表名）回傳客戶端。
  - 幾乎無輸入長度上限：各 handler 只檢查非空，`decode()` 無 `http.MaxBytesReader`。
  - 密碼 policy 過弱：僅要求 6 字元，無複雜度檢查、無登入次數限制。
- **做得好的部分（原文保留）**：GORM 全參數化（無 SQL injection）、密碼雜湊正確（PBKDF2-HMAC-SHA256 100k 迭代 + 16-byte salt + `subtle.ConstantTimeCompare`）、React 無 `dangerouslySetInnerHTML`（無 XSS sink）、log 不含敏感資料（只記 method/path/duration，且記的是 `r.URL.Path` 不含 query，所以 WS token 不會被記進 log）。
- **現況（2026-08-16）**：本次未安排 verifier 逐項覆核，狀態延續 7 月底評估，建議下次稽核挑 1-2 項排入驗證範圍。
- **現況（2026-10-16 複核）**：PARTIAL，逐項核對：(1) WebSocket 仍 `InsecureSkipVerify: true`（`server/internal/api/ws.go:21-23`），token 仍走 query string（`ws.go:14`），仍存在；(2) 「admin 後台 cookie session 無 CSRF token」子項已過時並移除——後台改用 `Authorization: Bearer`（`server/internal/adminconsole/adminconsole.go:105`、`cmd/server/static_admin.go:62`），後端程式碼已無任何 `Set-Cookie`；(3) 安全標頭（CSP/HSTS/X-Content-Type-Options/X-Frame-Options）全後端 Go 程式碼搜尋無任何設定，仍存在；(4) `writeErr(..., err.Error())` 仍大量存在（例如 `api.go:979`、`:1368`、`public_link.go:107`），仍存在；(5) `decode()`（`api.go:1393-1399`）仍無 `http.MaxBytesReader`，全後端搜尋無 `MaxBytesReader`，仍存在；(6) 密碼仍僅要求 6 字元（`auth.go:228`），登入仍無次數限制，仍存在。

### S12 ⚪ `/internal/entries/{id}/geocode` 無 trip 層級授權範圍（已知、有意設計的信任邊界）
- **位置**：`server/internal/api/entry_geocode.go:39-101`（`handleGeocodeEntry`），掛載於 `internalMux`（`api.go:241`），受 `internalAuth`（`middleware.go:94-107`）保護。
- **問題**：`internalAuth` 只驗證 JWT 簽章有效，不做 trip 範圍限制；`handleGeocodeEntry` 內部呼叫 `s.store.GetEntry(entryID)` 後直接 `SetEntryLatLngWithPlaceID`，未檢查該 entry 是否屬於呼叫者有權限的行程。
- **與其他系統設計的關係**：這是 `/internal/*` 命名空間整體的既定信任邊界，非本 handler 獨有的疏漏——同檔案 `handleComputeRouteFromEntries`（`entry_geocode.go:148-152`）明確註解「此端點掛在 internalAuth 之後（需登入 JWT），故不限制 entryIDs 要屬於哪個行程」，並與需要 `scopeTripID` 的公開端點 `handlePublicComputeRoute` 對比說明。`middleware.go:78-93` 也明確記載 `/internal/*` 路由「不像 /v1/* 有 requireOwner/requireEditor/requireMember 檢查，設計上只給 CLI/自動化腳本用」。
- **攻擊情境**：任何取得合法 internal JWT 的登入使用者（例如透過 `tripace-cli login --web`），可對任意 entryID（非自己行程內的）呼叫 geocode 端點，覆寫其經緯度/place_id。entryID 為 6 bytes hex，非機密但可窮舉/嘗試。
- **現況（2026-08-16 複核）**：CONFIRMED 為既有、有文件記載的設計取捨，不是新出現的 bug。是否要收斂 `/internal/*` 信任邊界（例如加上可選的 `scopeTripID` 或 per-user 限制）屬於產品/架構層級決策，非緊急修復項；建議列為待評估項目而非立即修復的漏洞。
- **現況（2026-10-16 複核）**：仍成立，行號已位移。`handleGeocodeEntry` 現位於 `server/internal/api/entry_geocode.go:39`（`GetEntry` 於 `:52`、`SetEntryLatLngWithPlaceID` 於 `:91`），路由於 `api.go:833`；`handleComputeRouteFromEntries` 位於 `entry_geocode.go:139`，註解「不限制 entryIDs 要屬於哪個行程」於 `:151`；`internalAuth` 現位於 `middleware.go:138`，`internalMux` 掛載於 `api.go:928`。仍未加 trip 範圍限制，設計取捨不變。

### S13 🔴 `attractionsync` 功能：`target` 零驗證 + `internalAuth` 無角色檢查，可構成 SSRF/資料竄改鏈
- **位置**：`server/internal/api/attraction_sync.go:339-353`、`server/internal/api/middleware.go:94-107`
- **問題**：`internalAuth` 只驗證「這是一把有效的自家 JWT」，沒有角色/擁有者檢查；`POST /v1/auth/register` 是公開端點。因此任何自行註冊的使用者都能：
  1. 帶普通登入 JWT 呼叫 `POST /internal/maintenance/sync/setup`，`target` 指向攻擊者控制的伺服器——`setup` handler 只檢查欄位非空，沒有 host 驗證、內網位址阻擋、白名單。sync-token 是全域單一檔案（非 per-user 隔離），寫入即覆蓋原有設定。
  2. 帶同一把 JWT 呼叫 `POST /internal/maintenance/sync/attractions/run`，`direction: "pull"`。正式站主動對攻擊者的假伺服器發出 `compare` 請求，**body 帶上正式站全部景點資料**。
  3. 攻擊者的假伺服器回傳偽造的 `toCreate`/`toUpdate`/`toDelete`，正式站的 `runSyncPull` 無條件寫入——**任意資料注入、竄改，或清空整張 `attractions` 表**。
- **根本落差**：`docs/attraction-sync-design.md` 的「明確擱置」章節假設「本機是使用者自己的開發機，風險可控」，但程式碼把同一組端點也部署到了正式站，而正式站的帳號註冊是公開的——這個信任假設在正式站不成立。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #1），對應功能設計文件 `docs/attraction-sync-design.md`，實作於 commit `487aeb0`。
- **結論（原文保留）**：不建議直接 tag/部署到正式站，直到 #1（本項）、#2（下方 S14）、#4（下方 S15）修復或緩解為止。
- **現況（2026-08-16）**：本次掃描未涵蓋 `attractionsync` 授權面（本輪 finder 聚焦於程式邏輯正確性而非此項已知的架構級風險），狀態延續原文件記錄，尚未確認是否已修復或以「正式站關閉 setup/run 端點」的過渡方案緩解。**下次稽核應優先覆核此項**。
- **現況（2026-10-16 複核）**：仍未修復。`handleMaintenanceSyncSetup`（`server/internal/api/attraction_sync.go:334-353`）仍只檢查 `target`/`token` 非空即 `saveSyncToken`，無 host 驗證/內網阻擋/白名單；`handleMaintenanceSyncRun`（`attraction_sync.go:368-`）以 `syncClient{target: syncTok.Target...}`（`:390`）對該 target 發請求；`internalAuth`（`middleware.go:138-`）仍只驗證 JWT 簽章，無角色檢查；`/v1/auth/register` 仍公開（`api.go:650`）；路由於 `api.go:925-926`。本次複核未見正式站關閉 setup/run 的環境變數過渡方案。
- **建議修法（原文保留）**：**根本解法**：給 `/internal/maintenance/sync/setup` 與 `/run` 加上真正的授權檢查；對 `target` 加 host 驗證（禁止內網網段/loopback/link-local）、`syncClient` 設定 timeout 與 redirect 限制。**過渡方案**：用環境變數把 `setup`/`run` 這兩支「主動發起請求」的端點在正式站部署時關閉，保留被動接收端點（push 仍可運作）。

### S14 🟠 `attractionsync`：錯誤訊息把 target 回應內容原樣回吐
- **位置**：`server/internal/api/attraction_sync.go:728-731` → `:396`
- **問題**：錯誤訊息把目標伺服器的回應內容原樣回吐給呼叫端，構成內網探測與資料外洩管道，尤其在 S13 的 SSRF 情境下可用於確認內網服務是否存在、取得其回應內容。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #2）。
- **現況（2026-08-16）**：狀態延續原文件記錄，未複核，需與 S13 一併處理。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`syncClient.do`（`server/internal/api/attraction_sync.go:744-757`）在 target 回應 >=300 時仍以 `fmt.Errorf("target 回應 %d: %v", resp.StatusCode, errBody)` 把解析出的回應 body 放進錯誤；呼叫端 `handleMaintenanceSyncRun` 以 `writeErr(w, http.StatusBadGateway, "sync_failed", runErr.Error())` 回吐（約 `:437`），schema/時鐘檢查失敗路徑（`:~403-415`）同理。
- **建議修法**：錯誤訊息不應原樣回吐目標伺服器的回應內容，改為記錄到伺服器端 log、回應端只給通用錯誤訊息。

### S15 🟠 `attractionsync`：`compare` 端點空 list 即傾印全表
- **位置**：`server/internal/api/attraction_sync.go:178-231`
- **問題**：`compare` 端點送空 list 即回傳全表資料，任何持有效 JWT 者可用，是 S13 攻擊鏈第 3 步驟得以運作的關鍵環節之一。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #7）。
- **現況（2026-08-16）**：狀態延續原文件記錄，未複核。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`handleMaintenanceAttractionSyncCompare` 現位於 `server/internal/api/attraction_sync.go:169-231`，仍無條件 `ListAllAttractions()` 並把 `OnlyInSource`（`DestinationList` 為空時即全表）放進 `toCreate` 回傳；無角色檢查、無筆數/分頁限制。
- **建議修法**：與 S13 根本解法一併處理（加上角色檢查），或至少限制單次回應筆數並要求明確分頁參數。

### S16 ⚪ `attractionsync`：`syncClient` 無 timeout、無 redirect 政策
- **位置**：`server/internal/api/attraction_sync.go:723`
- **問題**：`syncClient` 用 `http.DefaultClient`，無 timeout、無 redirect 政策，handler 可被無限期掛住（DoS 風險，非資料外洩）。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #9，標註 Low-Medium）。
- **現況（2026-08-16）**：狀態延續原文件記錄，未複核。
- **現況（2026-10-16 複核）**：仍未修復，行號已位移。`syncClient.do` 現於 `server/internal/api/attraction_sync.go:745` 仍呼叫 `http.DefaultClient.Do(req)`，無 timeout、無 redirect 政策（`syncClient` struct 定義於 `:708-711`，僅含 `target`/`token`）。
- **建議修法**：`syncClient` 加上明確 timeout 與 redirect 限制（與 S13 根本解法建議一致）。

---

## 已複核為安全/已解決的項目

### 已排除：GORM `Detail` 欄位序列化路徑不一致疑慮
- **原始疑慮**：`InsertEntry` 透過 GORM `serializer:json` struct tag 寫入 `Detail`，`UpdateEntry` 則手動 `json.Marshal` 後以 map 形式 `Updates`，懷疑兩條路徑長期可能產生不同編碼結果。
- **複核結果（2026-08-16）**：REFUTED。已追查 GORM `schema.JSONSerializer.Value()` 原始碼（`gorm.io/gorm@v1.31.2/schema/serializer.go:104-113`），確認其實作同樣是 `json.Marshal` + `string()` 轉換，與手動路徑位元對位元相同，無編碼落差。此路徑另有回歸測試 `TestEntryUpdateDetail`（`server/internal/store/entries_test.go`）鎖定既有正確行為，不需修復。

### 已解決：`INTERNAL_API_TOKEN` 未設定時預設放行
- **原始問題**：`internalAuth` 曾以共享密鑰環境變數 `INTERNAL_API_TOKEN` 驗證，若忘記設定即等於不設防。
- **修復確認**：`internalAuth`（`server/internal/api/middleware.go`）已改為與 `/v1/*` 一般使用者共用同一套 JWT 驗證（`auth.Signer`），不再有共享密鑰環境變數，也不存在「忘記設定就等於不設防」的分支，驗證失敗一律回 401。CLI 端透過 `tripace-cli login --web` 換發 JWT。
- **確認方式**：程式碼複核（`docs/PROJECT_HEALTH_REVIEW.md`，2026-08-03 記錄）；`docs/architecture-review-2026-07.md` 2026-08-14 複查同步確認此項不再適用。

### 已解決：`attractionsync` — `NeedsSync` 忽略記錄筆數 `Count`，導致同步靜默失效
- **原始問題**：`NeedsSync` 只比對最新一筆的 `UpdatedAt`，未比對來源方與目的方筆數，來源方 5 筆、目的方僅 1 筆但目的方最新一筆時間反而較新時，會誤判為「已同步」。
- **修復確認**：`server/internal/attractionsync/diff.go` 的 `NeedsSync` 新增「來源方與目的方筆數不同即視為需要同步」的判斷。新增回歸測試 `TestNeedsSync_CountDiffersDespiteOlderTimestamp`（`diff_test.go`），直接對照原文件記錄過的重現案例。相關套件（`attractionsync`/`api`/`cmd/cli`）測試全數通過。
- **確認方式**：程式碼複核 + 測試通過（`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`「修正紀錄」章節）。

### 已確認非問題：`web/.env.development` 被 git 追蹤
- **原始疑慮**：擔心該檔案含機密資訊卻被版本控制追蹤。
- **複核結果**：該檔案內容只有註解說明與非機密設定（`VITE_API_BASE`、`VITE_ONAGENT_URL` 位址，以及設計上本就可公開的 `VITE_PACE_PUBLIC_LINK_TOKEN`），不含任何金鑰值；真正的金鑰（`VITE_GOOGLE_MAPS_API_KEY`、`VITE_ONAGENT_APP_KEY`）放在 gitignore 排除的 `.env.development.local`。
- **確認方式**：程式碼複核（`docs/PROJECT_HEALTH_REVIEW.md`，2026-08-03 記錄）。
