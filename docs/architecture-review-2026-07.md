# Tripace 架構評估與改良建議

> 評估日期:2026-07-24(2026-08-14 複查,已移除當時發現、現已修復或不再適用的項目)
> 範圍:`server/`(Go)、`web/` + `web/admin/`(React+Vite)、`ios/`(SwiftUI)、部署與 CI、文件
> 方法:五個面向並行探查(後端架構、前端架構、部署維運、安全與資料模型、產品功能與 iOS)
>
> 複查後確認已解決/不再適用,故整節移除的項目:`/internal/*` fail-open(已改 JWT 驗證)、
> want 引擎全域單例序列化(want 已完全移除)、editable 公開連結驅動 LLM 改資料(assist 端點已不存在)、
> 前端無 router/無測試(已導入 react-router、vitest)、push main 直接上線(已改 tag 觸發部署)。

---

## 摘要:如果只看三件事

1. **`server/internal/api/auth.go:15-21` 的訪客回退**——token 無效時不回 401 而是
   回退成固定訪客 `usr_me`。這一行讓下面所有權限檢查的價值大打折扣。
2. **兩個端點完全沒有權限檢查**(`GET /v1/trips/{id}/members`、`GET /v1/trips/{id}/entries`)
   ——任何人帶任意 tripID 就能讀取他人的成員名單、行程條目、經緯度。
3. **`main.go` `devMode` 預設值是 `true`**,而 devMode 下 Apple 登入
   **不驗簽章**(`auth/apple.go:31-51` 只 base64 解 payload 取 `sub`)。
   任何人可自製 token 冒充任意使用者。

這三項都是單點修復即可大幅改善的高風險問題。

---

## 一、安全性

### 1.1 認證與授權(最高風險區)

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| 高 | **訪客回退**:token 缺失**或無效**時回退成 `guestUser{ID:"usr_me"}`,而非 401。seed 會建立 `usr_me` 並加入示範頻道,等於未認證者直接繼承其權限 | `internal/api/auth.go:15-21, 26-36` |
| 高 | **Apple 登入不驗簽章**:只 base64 解 payload 取 `sub`,不驗 RS256 簽章 / iss / aud / exp。可自製 `{"sub":"<受害者 sub>"}` 冒充任意使用者 | `internal/auth/apple.go:31-51` |
| 高 | **`devMode` 預設 `true`**,放大上述 Apple 登入問題 | `cmd/server/main.go:36` |
| 高 | **JWT 密鑰預設硬編碼** `"dev-secret-change-me"`,未設 `JWT_SECRET` 時任何人可自簽任意 `sub` | `cmd/server/main.go:35` |
| 中 | 無 refresh token、無撤銷機制。TTL 固定 30 天,無 `jti`/黑名單,登出僅清 localStorage | `cmd/server/main.go:122`、`auth/jwt.go` |
| 中 | token 存 `localStorage`,任何 XSS 即可竊取長效 token | `web/src/App.tsx:34-47` |
| 中 | JWT 不驗 `alg` 欄位(目前因固定 HMAC 驗證而無實際繞過,但屬脆弱設計) | `auth/jwt.go:60-84` |

**做得好的部分**:owner/editor/viewer 三級權限模型設計合理,`requireOwner`/
`requireEditor`/`requireMember` 三個 helper 完整,owner 恆視為 editor。

### 1.2 IDOR:兩個端點無權限檢查

> 原文列出四個端點;資料模型後續已扁平化(entries 直接屬於 trip,不再有「trip 內的 trip」巢狀結構),
> `channels/{id}/trips`、`channels/{id}/trips/{tripID}/entries` 已不存在。剩下兩個(改名後)仍未受保護:

| 端點 | 位置 | 洩漏內容 |
|---|---|---|
| `GET /v1/trips/{id}/members` | `handleListMembers` | 任意行程全部成員的 id/name(PII) |
| `GET /v1/trips/{id}/entries` | `handleListEntries` | 任意行程全部條目(含地點、經緯度、備註) |

這兩個都是 `GET`,不需要任何 `requireMember` 檢查,只要知道(或猜到)tripID 即可。

### 1.3 公開分享連結

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| 高 | token 只用 **6 bytes(48 bit)**,格式 `lnk_` + 12 hex。配合無 rate limit,48-bit 對持續掃描不是安全邊界(建議 ≥16 bytes) | `store/public_links.go:11-15` |
| 中 | **無過期機制**:`publicLinkRow` 只有 `CreatedAt`,無 `ExpiresAt`/`RevokedAt`/存取次數。連結一經產生永久有效 | `store/entity.go:75-82` |
| 中 | 無存取稽核,無法得知連結被誰、何時存取 | 同上 |

撤銷機制本身存在且正確(`DELETE /v1/trips/{id}/public-link` 有 `requireEditor`)。

> 原文本節另有「editable 連結讓匿名者驅動 LLM 改資料」與整節「LLM 安全」(prompt injection、
> 工具無 role 檢查)——複查時對話走 `POST /v1/public/{token}/assist` 的舊 want 對話管線已隨
> want 移除消失,對應風險已不成立。目前的 LLM 對話改走 onagent 平台,若要評估其安全性需另開範圍。

### 1.4 其他 API 安全

- **【高】完全沒有 rate limiting**。受影響:`/v1/auth/login`(密碼暴力破解)、
  `/v1/public/{token}`(token 枚舉)、`/v1/auth/register`(大量註冊)。
  (`internal/apigateway` 已針對外呼 Google Places/Geocoding API 加上節流,但對內端點仍無防護。)
- **【高】CORS `Access-Control-Allow-Origin: *`** 對所有路由(含 `/internal/*`)
  無條件放行,且允許 `Authorization` header(`middleware.go:22-27`)。
- **【中】WebSocket `InsecureSkipVerify: true`**(`api/ws.go:21-23`),停用 origin
  檢查。已補上 `requireMember` 身分檢查(accept 前驗證 JWT),但 token 走 query string 有經
  proxy/瀏覽器歷史外洩的風險。
- **【中】admin 後台 cookie session 無 CSRF token**,僅靠 SameSite。
- **【中】無安全標頭**:CSP、HSTS、X-Content-Type-Options、X-Frame-Options 全無。
- **【中】錯誤訊息洩漏內部細節**:大量 `writeErr(..., err.Error())` 把 GORM/DB
  原始錯誤(含 SQL 片段、表名)回傳客戶端。
- **【中】幾乎無輸入長度上限**:各 handler 只檢查非空,`decode()` 無
  `http.MaxBytesReader`。
- **【中】密碼 policy 過弱**:僅要求 6 字元,無複雜度檢查、無登入次數限制。

**做得好的**:GORM 全參數化(無 SQL injection)、密碼雜湊正確(PBKDF2-HMAC-SHA256
100k 迭代 + 16-byte salt + `subtle.ConstantTimeCompare`)、React 無
`dangerouslySetInnerHTML`(無 XSS sink)、log 不含敏感資料(只記 method/path/duration,
且記的是 `r.URL.Path` 不含 query,所以 WS token 不會被記進 log)。

---

## 二、後端架構

> 原文本節「2.1 併發模型」描述 want 引擎全域單例 + `sink.go` 全域狀態造成全站 LLM 請求
> 序列化——want 已完全移除(`internal/wanttools` 僅存未被任何 binary import 的殘留型別檔,
> 應清理),對話改走 onagent 平台,此問題已不成立。原「2.2 分層」圖中的 `llm`/`wanttools`
> 節點亦隨之消失,`wanttools` 分層倒置的問題同樣不再適用。

### 2.1 韌性缺口

- **無 panic recovery**:全 repo `recover()` 零命中。任一 handler 或 WS goroutine
  panic 會整個 process 崩潰。
- **無 `http.Server` timeout**:用 `http.ListenAndServe`,無 `ReadTimeout`/
  `WriteTimeout`/`IdleTimeout`(slowloris 風險)。
- **無 graceful shutdown**。

### 2.2 資料層

- **`AutoMigrate` 且失敗不中止**(`store.go:55`):只設 `MigrationOK=false` 讓服務
  降級啟動,生產會出現 schema 不一致但服務看似健康。無版本化 migration、無
  up/down、無 dry-run。
- **無 connection pool 設定**:無 `SetMaxOpenConns`/`SetMaxIdleConns`/
  `SetConnMaxLifetime`。Cloud SQL 有連線上限,預設 unlimited 容易打爆。
- **store 層完全不用 `context.Context`**:無法傳遞逾時/取消,慢查詢無法中斷。
- **交易極少**:僅 4 處 `db.Transaction`。entry 寫入 + trip 歸組 + message 關聯是
  多步驟寫入但未包在同一交易。

### 2.3 可觀測性

- 只有標準庫 `log.Printf`,**無結構化 logging**(無 `slog`)、無 request ID /
  trace ID、無 log level。logging middleware **不印 status code、不印錯誤**。
- **完全無 metrics、無 tracing**。
- **`/health` 不檢查 DB**,直接回 `{"status":"ok"}`,也不回報 `MigrationOK`。
  Cloud Run liveness 會誤判健康。(已新增 `store.Ping(ctx)` 方法但 `/health` 尚未使用它。)
- commit `dba5145` 正是「adminserver 漏設環境變數導致健康檢查失效」的真實事故,
  證明目前機制無法主動告警。

### 2.4 其他

- **API 錯誤格式不一致**(至少三種):`writeErr` 的巢狀 `{"error":{"code","message"}}`
  vs `http.Error` 的扁平 `{"error","message"}`(且 Content-Type 是 `text/plain`)。
- **無統一 domain error type**,無法區分 400/403/404/500。
- **設定散落**:`os.Getenv` 分散在多個檔案,無集中 config struct,middleware
  在函式內讀 env 導致測試難以注入。

---

## 三、前端架構

### 3.1 結構與狀態管理

> 原文「幾乎完全平鋪」與「無 router」已不準確:已出現 domain 分層目錄
> (`admin/`、`clienttools/`、`geo-planning/`、`sdk-proposals/`、`trip/`),且已導入
> `react-router-dom`(`BrowserRouter`/`Routes`/`Route`),支援深連結與瀏覽器上一頁。
> 仍有大量檔案留在根目錄,並非嚴格的 `components/`/`hooks/`/`pages/`/`services/` 分層。

- **完全沒有狀態管理方案**:`createContext`/`useContext`/`useReducer` **零命中**。
  全靠 `useState` + props。
- **Prop drilling 明確存在**:`useAppState()` 回傳多個欄位的 `ContentProps`,
  透過 `{...props}` 一路灌到子元件。`cfg`/`user`/`token` 幾乎每層都要接一次。
- **伺服器狀態全部手寫** `useState + useEffect + fetch`,**無快取、無去重、
  無 stale 處理**(沒有 TanStack Query 之類的資料層)。
- **零 code splitting**:`lazy`/`Suspense` 完全無命中。首頁 landing page 的訪客
  也得付大 bundle 的代價。

### 3.2 效能

- **記憶化嚴重不足**:`Timeline.tsx`(539 行)**零** `useMemo`/`useCallback`/`memo`,
  `MultiTrackTimeline` 每次 render 都重建整棵列表。`MessageBubble.tsx` 等 7 個
  元件同樣零記憶化。
- **無 `React.memo`**:每次 WS 事件更新 state,整棵 Timeline + 所有 MessageBubble
  全部重繪。
- **99 處 inline `style={{...}}`** 每次 render 新建參考,破壞任何下游 memo 效果。

### 3.3 可近性(a11y)

- **aria 屬性總共只有 4 個**(1 個 `aria-hidden`、2 個 `aria-label`、1 個 `aria-live`)。
- **15 處 `<div onClick={...}>`** 無對應 `role`/`tabIndex`/`onKeyDown`——鍵盤與
  螢幕閱讀器完全無法操作。
- 語意化 HTML 稀薄:全專案僅 1 個 `<main>`、1 個 `<header>`、1 個 `<nav>`、1 個 `<h1>`。
- 無 focus trap(modal)、無 skip link、無系統化 `:focus-visible`。
- 無 ESLint,自然也無 `eslint-plugin-jsx-a11y`。

### 3.4 型別安全(這部分做得好)

- `tsconfig.json` **`strict: true`** + `noUnusedLocals` + `noUnusedParameters` +
  `noFallthroughCasesInSwitch`。
- **`any` 用量極低**:全專案僅 1 處且只在註解。零 `@ts-ignore`。
- 但:**前後端型別靠手寫同步**(`types.ts` 註解自承要手動對齊 Go 的 `model.go`),
  **無 OpenAPI / codegen**。後端改欄位前端不會有編譯錯誤——這是最大的型別風險。
- `request<T>()` 結尾 `return call.responseBody as T`,**無執行期驗證**
  (無 zod/valibot)。

### 3.5 樣式

- **純全域 CSS**:`styles.css`(2,475 行)+ `landing.css` + `debug.css`。
  無 CSS Modules / Tailwind / CSS-in-JS,類名靠約定,無 scope 隔離。
- 有初步 design token(12 個 CSS 變數),但**無 spacing / typography / radius /
  shadow scale**,大量硬編碼數值。
- 斷點魔數重複:`App.tsx:76 DESKTOP_BREAKPOINT = 768` 註解自承「需與 styles.css
  的 @media 一致」——手動同步的耦合。

### 3.6 API 層(設計不錯但有缺口)

- `api.ts` 有**統一的 `request<T>()` 封裝**,集中處理 baseURL、Bearer header、
  JSON 序列化、`ApiError`,並用 pub/sub 把每筆交易餵給 DebugPanel。這部分設計良好。
- 但:**無重試、無 timeout、無 `AbortController`**(元件 unmount 後 setState 競態)。
- **`fetchPublicView` 繞過統一層**,直接用裸 `fetch`,不進 ApiCall 紀錄、錯誤型別不一致。
- **loading/error 全靠各元件手寫**:`setError`/`setLoading` 散落各處各自處理。
  無全域 error boundary,401 過期無集中攔截。

### 3.7 測試

> 原文「零單元測試、零元件測試」已不成立:已導入 vitest + @testing-library,
> 新增多個測試檔涵蓋 `AppCommon`、`api.ts`、`geo-planning/` 模組。

- 舊的 `e2e-mock-llm.spec.ts`(依賴已移除的 want 對話管線)是否仍可用、CI 友善度如何,
  需另外確認現狀。

### 3.8 `web/admin` 子專案

- 是**獨立的第二個 Vite SPA**,有自己的 `package.json`、`tsconfig`、`node_modules`。
- 與主專案**完全解耦**:不同身分系統(cookie session)、不同 API 前綴、
  **不共用任何程式碼**(連型別都各自手寫一份)。
- **工具鏈版本分岔**:admin 用 Vite 6.x + TypeScript 7.0.2,主專案用 Vite 5.4.11 +
  TypeScript 5.6.3。無 monorepo 工具(無 workspaces/pnpm/turborepo)管理。
- admin 的 tsconfig 反而**更嚴格**(多了 `verbatimModuleSyntax`、`erasableSyntaxOnly`)。
- `web/src/admin/` 是誤建的殘留目錄(只含 `.env.local`、`dist/`、`node_modules/`,
  未被 git 追蹤),應刪除。

---

## 四、部署與維運

### 4.2 CI/CD 缺口

- **【高】CI 完全沒有跑測試**:deploy workflow 只有 build → push → deploy。
  測試已存在卻完全沒接上。**唯一的品質門檻是「能編譯過」**。
- **【高】沒有任何 security scan**:無 `govulncheck`、`npm audit`、Trivy/Grype、
  CodeQL、secret scanning。
- 原文「push main 直接部署 prod」已不成立:`deploy-cloudrun.yml` 已改為
  tag 觸發(`push: tags: ['v*']`)+ `workflow_dispatch`,不再監聽 push to main。
  但仍無正式 staging 環境或 required-reviewers 機制,打 tag 後仍是直接 100% 切換
  (無 `--no-traffic` + 逐步導流、無 smoke test、無自動 rollback)。
- **【中】無 PR 驗證 workflow**:只有 `ios-build.yml` 有 `pull_request` 觸發,
  後端與前端的 PR 不跑任何檢查。
- **【中】`deploy-admin.yml` 的 `skip_build` 分支會部署 `:latest`**,與 git SHA
  脫鉤,難以追溯正在跑的是哪個 commit。

### 4.3 環境管理

- **【高】只有一個環境(prod)**,無 dev/staging。
- **【高】跨專案資源錯配**:Cloud Run 與 Secret Manager 在 `shuttle-045094509`,
  但 Cloud SQL 在 `onagent-prod`。`setup.sh` 自己有一大段警告說這是寫死的、
  腳本無法處理。專案改名(Shuttle → Tripace)遺留的命名混亂。
- **【中】secret 全部釘 `:latest`**,改版會在下次 revision 靜默改變行為,無版本追溯。
- **【中】`--allow-unauthenticated` 寫死在兩個 deploy workflow**,管理後台也是公開的,
  僅靠應用層 session 保護。

### 4.4 資料庫維運

- **【高】無任何備份策略文件或設定**:全 repo grep `backup`/`備份`/`PITR` 零結果。
  Cloud SQL 是否啟用自動備份與 PITR,在 `setup.sh` 中完全沒設定。
- **【高】無 rollback 機制**:grep `rollback` 零結果。AutoMigrate 只增不減,
  schema 無法回退;Cloud Run 雖可手動切 revision,但無腳本或 runbook。
- **【中】破壞性維運操作無保護**:`store/maintenance.go` 的
  `DropLegacyEntryColumns()` 會 DROP 欄位,雖有冪等檢查與充分註解,
  但**無二次確認、無備份前置檢查**,直接對 prod DB 操作。
- **【中】`scripts/rotate_db_password.sh` 直接對 prod 操作**,無確認提示、無 dry-run,
  誤執行會立刻讓服務認證失敗(需重新 deploy 才讀到新 secret → 有服務中斷窗口)。
  另外組出的 DSN 用 `sslmode=disable`。

### 4.5 監控與告警

- **【高】完全沒有 error tracking / APM / tracing**:grep
  `sentry|opentelemetry|prometheus|datadog|newrelic` 全 repo 零結果。
- **【高】無 uptime 監控、無 alerting**。
- **【中】Dockerfile 無 `HEALTHCHECK`**,Cloud Run 也沒設 startup/liveness probe,
  儘管 `/health` 端點已經寫好——健康端點寫了但沒人用。
- 唯一的健康機制是 admin 後台的 `GET /admin/api/health/external`,是 pull-based
  且需要人主動查看。

### 4.6 依賴管理

- **【高】無 dependabot / renovate**,無自動更新、無漏洞告警。
- **【中】`golang.org/x/crypto` 版本落後**(對照同檔 `x/sys`、`x/text`)。crypto 是安全敏感套件,建議定期核對。

> 原文本節提到的 `want v0.0.2` 私有套件依賴風險(需 `GH_PAT` 拉取、單點失效)與其帶入的
> `go-rod/rod` 間接依賴——want 已完全移除,此風險已不存在。

### 4.7 IaC

`server/deploy/` 只有一支 `setup.sh`(一次性 GCP bootstrap),**無 Terraform/Pulumi**。
所有基礎設施靠 shell script + 手動 gcloud,無 state 追蹤、無 drift 偵測。

---

## 五、資料模型

表:`users`, `trips`, `entries`, `members`, `public_links`, `admin_users`, `admin_sessions`。
(原文用 `channels`/`channel_id` 命名,已隨改名統一為 `trips`/`trip_id`。)

| 嚴重度 | 問題 | 說明 |
|---|---|---|
| 中 | **時間欄位用 string 而非 date/timestamp** | `Start`/`StartTime`/`End`/`EndTime` 全是 `string`。無法用 DB 做範圍查詢最佳化與正確排序。**注意**:確實存在一個已完成的 timestamptz 遷移(改成 `time.Time`+時區+`AllDay`),但只在未合併的本地分支上,尚未進主線,不宜視為已解決 |
| 中 | **缺複合索引** | `entries` 只有 `trip_id` 單欄索引。常見查詢 `WHERE trip_id=? AND start BETWEEN ?` 應建複合索引;`ORDER BY created_at DESC` 亦無索引 |
| 中 | **缺外鍵約束** | 無 `entries.trip_id → trips.id` 等 FK,全靠 `AutoMigrate`。刪行程會留下孤兒 entries/public_links,需手動級聯 |
| 中 | **全面 hard delete,無稽核軌跡** | 無 `deleted_at`,誤操作刪除的資料無法復原,也無操作歷史可追查 |
| 中 | **N+1 風險** | `ListTripsForUser`(`store/channels.go:14-30`)用相關子查詢做 `member_count` 與 `last_message_preview`,行程多時等同每列各跑兩次查詢 |
| 中 | **PII 明文儲存** | `email` 明文;`entries` 的 `location`/`lat`/`lng` 是使用者位置軌跡,屬敏感個資,全部明文無欄位級加密 |
| 低 | `entries.detail` 用 JSON serializer,無 schema 約束,Postgres 下未用 `jsonb`,無法索引 |

**做得好的**:`public_links` 的 `trip_id` 與 `link_token` 皆有 `uniqueIndex`;
`users.email`/`apple_sub` 有 `uniqueIndex`。

---

## 六、產品功能與 iOS

### 6.1 已實作功能

語意查詢、條目 CRUD、行程自動歸組、多軌時間軸、協作與權限(editor/viewer)、
公開分享連結、周邊景點推薦、email/password + Apple 登入、admin 後台、
裝置端本地 DB。

> 原文本節提到的舊 `assist`(一句話記事的 LLM 對話入口)與「6.2 ClientTools 機制」
> (前端第二條 WS + `clientToolsSessionId` + `askPage()` 阻塞等待)整套機制皆隨 want
> 移除而消失(`clienttools_sessions.go` 等檔案已不存在)。LLM 對話現況改走 onagent 平台,
> 若要評估其設計,需另開範圍調查,不宜沿用本節舊有結論。

### 6.2 iOS:實質停止維護

- 最後兩次 commit 都是純改名/xcodegen 重生成,**沒有任何功能 commit**(此結論未重新複查,狀態可能未變)。
- 與後端的功能落差(語意查詢、即時同步等)需要重新盤點——原文列出的「clienttools 工具在 iOS 上全數失效」
  已因 clienttools 機制本身消失而不適用,但 iOS 端與現行 web/API 的同步程度需要另外確認。

### 6.3 多人協作的薄弱處

- **WS Hub 只做單向廣播**,且只廣播 `{"event":"entries_updated"}` 這種
  **無 payload 的通知**,前端收到後自己重新 fetch。
- **衝突處理基本上沒有**:無版本號、etag、optimistic lock、CRDT 或 last-write-wins
  標記。兩人同時編輯同一 entry 就是後寫覆蓋,對方只會收到「重新抓一次」的通知。
- 角色只有 editor/viewer 兩級,無「可留言不可編輯」的中間態,也無轉移 owner。

### 6.4 功能缺口(使用者會預期但沒有)

**搜尋**(只有 LLM 語意查詢,慢/貴/不精確)、**匯出**(無 iCal/Google Calendar/
PDF/CSV——行程 app 沒有日曆匯出是明顯缺口)、**通知**(零推播/email,邀請成員、
行程變更、同行者編輯都不會通知)、**離線支援**(entries/trips 全靠 API,
無 service worker/PWA manifest)、**版本歷史與 undo**、**相片/附件**、
**費用/分帳**、**整趟行程的地圖總覽**(只有推薦景點有地圖)、
**交通/路線時間計算**(有 geocode 但無點對點移動時間)。

### 6.5 文件狀態

> 原文這裡列出的具體檔案路徑(`docs/knowledge/*`、`docs/design/*`)屬於評估當下的
> 文件目錄結構快照,`docs/` 後續已多次重新整理,路徑已對不上——此節不再逐一更新,
> 「文件與程式碼現況有落差、需要定期核對」這個結論本身仍值得留意。

無 ADR(architecture decision records)、無 onboarding/runbook/incident 文件、
無 `CLAUDE.md`。

**值得肯定**:程式碼內註解密度極高且解釋「為什麼」(Dockerfile、setup.sh、
reset-admin-password.yml 的註解品質遠高於一般專案),部分彌補了文件缺口。

---

## 建議清單

> 分兩部分:A 是**實用建議**(依優先級排序,標注成本),B 是**有趣/前瞻建議**
> (不見得現在該做,但值得知道有這些方向)。複查後已移除的項目不再編號,
> 故下方編號不連續。

### A. 實用建議

#### A-1. 立即處理(安全,1-2 天內)

| # | 建議 | 成本 |
|---|---|---|
| 1 | `auth.go:15-21` 移除訪客回退,無效/缺失 token 一律回 401。若要保留免登入體驗,改成明確的匿名 session 而非繼承 `usr_me` | 低 |
| 2 | `GET /v1/trips/{id}/members`、`GET /v1/trips/{id}/entries` 補 `requireMember` | 低 |
| 3 | `main.go` `devMode` 預設改 `false` | 低 |
| 4 | 移除硬編碼 JWT 密鑰,未設 `JWT_SECRET` 即拒絕啟動 | 低 |
| 5 | `auth/apple.go` 實作 JWKS 簽章驗證(驗 RS256/iss/aud/exp) | 中 |
| 6 | CORS 改讀環境變數的 origin 白名單 | 低 |
| 7 | `public_links.go:12` token 從 6 bytes 提升到 16+ bytes | 低 |
| 8 | 加 rate limiting,優先 `/v1/auth/login`、`/v1/public/*` | 中 |
| 9 | `decode()` 加 `http.MaxBytesReader`,各 handler 補欄位長度上限 | 低 |

#### A-2. 韌性與可觀測性(1-2 週)

| # | 建議 | 成本 |
|---|---|---|
| 11 | 加 panic recovery middleware(目前全 repo `recover()` 零命中) | 低 |
| 12 | `http.Server` 補 `ReadTimeout`/`WriteTimeout`/`IdleTimeout` | 低 |
| 13 | 加 graceful shutdown(signal handling + `srv.Shutdown`) | 低 |
| 14 | `/health` 改成真的檢查 DB(`store.Ping`)與回報 `MigrationOK` | 低 |
| 15 | Dockerfile 加 `HEALTHCHECK`,Cloud Run deploy 加 startup/liveness probe | 低 |
| 16 | 換成結構化 logging(Go 1.21+ 內建 `log/slog`),加 request ID | 中 |
| 17 | logging middleware 補印 status code、response size、錯誤 | 低 |
| 18 | 接 error tracking(Sentry 或 GCP Error Reporting) | 中 |
| 19 | 加基本 metrics(各端點 QPS 與 p99 等) | 中 |
| 20 | 設 Cloud Monitoring uptime check + alert policy(至少 5xx 率與 /health 失敗) | 低 |

#### A-3. 架構瓶頸

| # | 建議 | 成本 |
|---|---|---|
| 21 | store 層全面加 `context.Context` 參數 | 中 |
| 22 | 加 connection pool 設定(`SetMaxOpenConns` 等) | 低 |
| 23 | 換版本化 migration 工具(golang-migrate / atlas),AutoMigrate 失敗改成中止啟動 | 中 |
| 24 | 多步驟寫入(entry + trip 歸組)包進同一交易 | 中 |
| 25 | 收斂 API 錯誤格式成單一 schema,定義 domain error type 對應 HTTP status | 中 |
| 26 | 集中設定管理成單一 config struct,啟動時驗證必要欄位 | 低 |

#### A-4. 測試與 CI(防止之後倒退)

| # | 建議 | 成本 |
|---|---|---|
| 27 | **建 CI workflow 跑 `go test` + `go vet` + `tsc --noEmit`**(現有測試先接上,成本最低、立即見效) | 低 |
| 28 | 加 `govulncheck` 與 `npm audit` 到 CI | 低 |
| 29 | 加 PR 觸發的驗證 workflow(目前只有 iOS 有) | 低 |
| 30 | `internal/api` 補測試,優先權限檢查(`requireOwner`/`requireEditor`/`requireMember`) | 中 |
| 31 | `internal/auth` 補測試(JWT 簽發驗證、Apple token、password hash) | 中 |
| 32 | 加 dependabot 或 renovate | 低 |

#### A-5. 前端結構

| # | 建議 | 成本 |
|---|---|---|
| 33 | **拆 `App.tsx`**,至少分出 `pages/`、`layouts/`、`components/`(已有部分 domain 目錄,可延續) | 中 |
| 34 | **拆 `ChatScreen.tsx`** | 中 |
| 35 | 引入狀態管理(Context + useReducer 或 Zustand),消除 prop drilling | 中 |
| 36 | 伺服器狀態改用 TanStack Query(自動快取/去重/stale 處理/retry) | 中 |
| 37 | 加 code splitting(`lazy`/`Suspense`),減少首屏 bundle | 低 |
| 38 | `Timeline.tsx` 等熱點元件加 `useMemo`/`React.memo` | 低 |
| 39 | 建立 ESLint 設定(含 `eslint-plugin-jsx-a11y`),修不可鍵盤操作的 `div onClick` | 中 |

### B. 有趣 / 前瞻建議

#### B-1. 架構實驗

| # | 建議 |
|---|---|
| 51 | **用 OpenAPI 當單一真實來源**,前後端型別都從 spec codegen(消除手寫同步的最大型別風險) |
| 52 | 前端 API 回應加 zod 執行期驗證,後端改欄位時前端立刻在開發階段就爆錯而非靜默 |
| 53 | 把 `web/` 與 `web/admin/` 收進 monorepo(pnpm workspace / turborepo),統一工具鏈版本並共用型別 |
| 54 | 用 Go 的 `embed` + templ/html 為 landing page 做 SSR,解決 CSR 的 SEO 天花板(其餘 app 部分維持 SPA) |
| 55 | 用 CRDT(Yjs/Automerge)做行程協作編輯,徹底解決衝突問題 |
| 56 | WS 廣播從「無 payload 通知 + 前端重抓」改成帶 delta payload,減少往返 |
| 57 | 引入 event sourcing 記錄所有行程變更,自然得到版本歷史與 undo |

> 原文本節「B-2. LLM / Agent 方向」10 項建議(prompt 優化、agent 評估流程、
> prompt injection 偵測等)均針對已隨 want 移除的舊對話管線(`assistant_agent.go` 等),
> 現行 LLM 對話改走 onagent 平台,若要規劃這類方向需針對 onagent 重新評估,不宜沿用。

#### B-3. 產品功能

| # | 建議 |
|---|---|
| 71 | **iCal / Google Calendar 匯出**(行程 app 最明顯的缺口) |
| 72 | 整趟行程的地圖總覽(目前只有推薦景點有地圖) |
| 73 | 點對點交通時間計算,自動偵測行程安排是否不合理(兩個行程間距不夠移動) |
| 74 | 全文檢索(關鍵字搜尋),補足 LLM 語意查詢的不足 |
| 75 | 推播通知 / email 通知(邀請、行程變更、同行者編輯) |
| 76 | PWA 化(service worker + manifest),支援離線讀取行程 |
| 77 | 相片附件(把旅遊照片掛在行程條目上) |
| 78 | 費用記錄與分帳(多人行程的常見需求) |
| 79 | 行程範本(把過去的行程存成範本重複使用) |
| 80 | 從既有行程一鍵複製成新行程 |
| 81 | 天氣資訊整合(依行程日期與地點顯示預報) |
| 82 | 航班/訂房確認信 email 轉發自動解析成行程條目 |
| 83 | 行程列印/PDF 匯出(旅行時的離線備份) |
| 84 | 時區處理(跨國行程的顯示與提醒) |
| 85 | 「這趟行程的地圖動線」視覺化(把條目依時間連成路線) |

#### B-4. 開發體驗

| # | 建議 |
|---|---|
| 86 | 建立 `CLAUDE.md`(降低每次 AI 協作重新建立上下文的成本) |
| 87 | 加 pre-commit hook(gofmt、eslint、typecheck) |
| 88 | 建 staging 環境,人工確認後才升 prod(部署已改 tag 觸發,但仍無 staging gate) |
| 89 | 用 Terraform 管理 GCP 基礎設施,取代 `setup.sh` |
| 90 | Cloud Run 部署改成 `--no-traffic` + 逐步導流 + 自動 rollback |
| 91 | 加 smoke test:部署後自動打幾個關鍵端點,失敗即 rollback |
| 92 | 建立 ADR 目錄記錄架構決策 |
| 93 | 寫 runbook:如何 rollback、如何處理 DB migration 失敗、on-call 流程 |
| 94 | 定期核對 `docs/` 現況與程式碼是否一致 |
| 95 | GCP 資源改名從 `shuttle-045094509` 遷到 tripace 命名 |

#### B-5. 值得評估但不急

| # | 建議 |
|---|---|
| 96 | `entries` 的時間欄位從 string 改成 timestamp(遷移已在未合併分支完成,待評估合併) |
| 97 | 加 soft delete + 稽核軌跡 |
