# Tripace 架構評估與改良建議

> 評估日期:2026-07-24
> 範圍:`server/`(Go)、`web/` + `web/admin/`(React+Vite)、`ios/`(SwiftUI)、部署與 CI、文件
> 方法:五個面向並行探查(後端架構、前端架構、部署維運、安全與資料模型、產品功能與 iOS)
> **本報告只做評估,不改動任何程式碼。**
>
> 前情:`docs/project-health-review.md`(2026-07-22)是兩天前的結構性檢視,
> 本報告在其基礎上做更深入的逐檔調查,並補上安全性與資料模型的完整分析。
> 兩份重疊處已在文中標注,新發現的問題會特別點出。

---

## 摘要:如果只看三件事

1. **`server/internal/api/auth.go:15-21` 的訪客回退**——token 無效時不回 401 而是
   回退成固定訪客 `usr_me`。這一行讓下面所有權限檢查的價值大打折扣。
2. **四個端點完全沒有權限檢查**(`api.go:215, 517, 719, 724`)——任何人帶任意
   channelID 就能讀取他人的成員名單、行程條目、經緯度。這是新發現,前一份健康度
   檢查沒有抓到。
3. **`main.go:36` `devMode` 預設值是 `true`**,而 devMode 下 Apple 登入
   **不驗簽章**(`auth/apple.go:31-51` 只 base64 解 payload 取 `sub`)。
   任何人可自製 token 冒充任意使用者。

這三項都是單點修復即可大幅改善的高風險問題。

---

## 專案規模速覽

| 面向 | 數字 |
|---|---|
| Go 程式碼 | 89 檔 / 13,329 行 |
| TypeScript/TSX | 32 檔 / 6,747 行(另 `web/admin/` 獨立子專案) |
| Swift | 26 檔(實質停止維護) |
| Go 測試 | 8 檔 / 1,216 行(約佔 9%) |
| 前端測試 | 1 個 e2e spec(需手動起三個 process) |
| Go 直接依賴 | 38 個 |
| CI workflow | 4 個(**全是部署/build,無測試或 lint**) |
| 文件 | 22 份 md / 約 4,360 行 |
| TODO/FIXME 標記 | 1 處真實 TODO |

**最大的檔案**(God Object 訊號):

| 檔案 | 行數 | 備註 |
|---|---|---|
| `web/src/styles.css` | 2,475 | 單一全域樣式檔 |
| `web/src/App.tsx` | 1,295 | 35 個 `useState`、16 個元件/hook 定義在同檔 |
| `web/src/ChatScreen.tsx` | 890 | 16 個 `useState` + 13 個 `useEffect` |
| `server/internal/api/api.go` | 800 | 全部路由 + handler + helper |
| `web/src/Timeline.tsx` | 539 | 14 個 `useState`,零 `useMemo` |

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

### 1.2 IDOR:四個端點無權限檢查(新發現)

| 端點 | 位置 | 洩漏內容 |
|---|---|---|
| `GET /v1/channels/{id}/members` | `api.go:215-226` | 任意頻道全部成員的 id/name(PII) |
| `GET /v1/channels/{id}/entries` | `api.go:517-519` | 任意頻道全部行程條目(含地點、經緯度、備註) |
| `GET /v1/channels/{id}/trips` | `api.go:719-726` | 任意頻道的行程清單 |
| `GET /v1/channels/{id}/trips/{tripID}/entries` | `api.go:719-726` | 任意行程的條目 |

這四個都是 `GET`,不需要任何 token,只要知道(或猜到)channelID 即可。

**對照組(做得對的)**:`handleUpdateTripEntry`/`handleDeleteTripEntry`
(`api.go:608-611, 652-655`)有正確檢查 `entry.ChannelID == channelID`,防跨頻道竄改。

### 1.3 `/internal/*` 路由 fail-open

`middleware.go:45-49` 的 `internalAuth` 在 `INTERNAL_API_TOKEN` 未設定時
**只印警告然後放行**,且與 `/v1/*` 同一個 port 對外。這組端點直接操作 store,
可繞過所有權限檢查——例如 `DELETE /internal/channels/{id}/entries` 清空任意頻道。

**更關鍵的是**:部署 workflow(`deploy-cloudrun.yml`、`deploy-admin.yml`)的
`--update-secrets` 清單裡**沒有 `INTERNAL_API_TOKEN`**,意即正式環境很可能
處於完全無防護狀態。這是本次調查最需要立即確認的一項。

### 1.4 公開分享連結

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| 高 | token 只用 **6 bytes(48 bit)**,格式 `lnk_` + 12 hex。配合無 rate limit,48-bit 對持續掃描不是安全邊界(建議 ≥16 bytes) | `store/public_links.go:11-15` |
| 高 | **editable 連結讓匿名者驅動 LLM 改資料**:`POST /v1/public/{token}/assist` 只檢查 `info.Editable`,無身分、無 rate limit。匿名訪客可無限觸發 LLM(成本放大 + 全域鎖 DoS),並經工具寫入/刪除頻道資料 | `api/public_link.go:112-149` |
| 中 | **無過期機制**:`publicLinkRow` 只有 `CreatedAt`,無 `ExpiresAt`/`RevokedAt`/存取次數。連結一經產生永久有效 | `store/entity.go:75-82` |
| 中 | 無存取稽核,無法得知連結被誰、何時存取 | 同上 |

撤銷機制本身存在且正確(`DELETE /v1/channels/{id}/public-link` 有 `requireEditor`)。

### 1.5 LLM 安全

- **【高】無任何 prompt injection 防護**:`want_analyzer.go:210` 把使用者原始輸入
  直接 `Submit`,無過濾、無分隔標記。結合匿名可用的 `public/{token}/assist`,
  外部人士可直接對 agent 注入指令。
- **【中】工具無 role 檢查**:只要進到 assist,LLM 即可呼叫 `entry_delete`、
  `delete_trip` 刪除同頻道任意資料。**editable 公開連結的匿名訪客同樣有這組能力**
  (該路徑傳 userID 為 `""`,不經 `requireEditor`)。
- **【中】LLM 輸出未驗證即執行**:工具參數(日期、標題)直接進 store,無 schema 再驗證。

**這是本專案最好的安全設計**:`channelID` 透過 `SetSessionEnvs` 由伺服器端注入,
**不進 prompt**,工具經 `ChannelFrom(ctx)` 取得。因此 LLM 無法透過提示詞操作其他
頻道——即使 prompt injection 成功,影響範圍仍被限制在當前頻道內。

### 1.6 其他 API 安全

- **【高】完全沒有 rate limiting**。受影響:`/v1/auth/login`(密碼暴力破解)、
  `/v1/public/{token}`(token 枚舉)、`/v1/public/{token}/assist`(LLM 成本 + DoS)、
  `/v1/auth/register`(大量註冊)。
- **【高】CORS `Access-Control-Allow-Origin: *`** 對所有路由(含 `/internal/*`)
  無條件放行,且允許 `Authorization` header(`middleware.go:22-27`)。
- **【中】WebSocket `InsecureSkipVerify: true`**(`api/ws.go:21-23`),停用 origin
  檢查。所幸有做 `requireMember`(正確設計),但 token 走 query string 有經
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

### 2.1 併發模型:目前最大的架構瓶頸

兩個問題疊加:

1. **want 引擎是全域單例**(`internal/llm/want_pool.go`):`For(sessionID)` 忽略
   sessionID,一律回傳同一個 shared analyzer,所有使用者的 LLM 對話被單一 mutex
   序列化(`want_analyzer.go:61,169,265`)。
2. **`internal/wanttools/sink.go:97-125` 把 request-scoped 狀態放成 package 全域**:
   `emitCount`、`emittedIDs`、`presented`、`recommendedPlaces` 等 13 個全域變數,
   靠單一 `recordMu` + `RecordLock()/RecordUnlock()` 保護。

結果:**整個 server 同一時間只能處理一個使用者的 LLM 請求**。第二個使用者送出訊息
會排隊等前一個跑完(逾時上限硬編碼 90 秒)。這不是效能調校問題,是會直接限制產品
可用性的架構天花板,也是一個現成的 DoS 面(單一匿名公開連結即可阻塞全站)。

`ChannelFrom(ctx)` 已經示範了正確做法(context-carried),`sink.go` 的全域狀態應
比照改成 request-scoped struct。

### 2.2 分層

無循環依賴,分層大致乾淨:

```
api → {auth, llm, clienttools, tripsvc, store, model, protocol, toolschema}
llm → {clienttools, wanttools, store, model, toolschema}
wanttools → {geo, store, model}
tripsvc → {geo, store, model}
store → model
adminconsole → adminauth → store(與主服務完全隔離)
```

問題:

- **分層倒置**:`wanttools`(LLM 工具層)直接依賴 `store` 打 DB
  (`entry_query.go:23` 的 `var entryStore *store.Store`),繞過 `tripsvc` 服務層。
- **service 層過薄**:`tripsvc` 只有 180 行,而 800 行的 `api.go` handler 直接呼叫
  store,權限檢查、資料歸組、驗證邏輯混在 HTTP 層。

### 2.3 韌性缺口

- **無 panic recovery**:全 repo `recover()` 零命中。任一 handler 或 WS goroutine
  panic 會整個 process 崩潰。
- **無 `http.Server` timeout**:用 `http.ListenAndServe`,無 `ReadTimeout`/
  `WriteTimeout`/`IdleTimeout`(slowloris 風險)。
- **無 graceful shutdown**。
- **LLM 無 retry / fallback**:provider 5xx 或逾時沒有重試也沒有降級,
  `orch.OnError` 只 `fmt.Printf` 到 stdout。
- **LLM 完成判定是 race-prone 的啟發式**:收到 `StatusViewModel{Status:"idle"}` 後
  `time.Sleep(1500ms)` 等文字事件(`want_analyzer.go:88-92`),而非確定性完成信號。

### 2.4 資料層

- **`AutoMigrate` 且失敗不中止**(`store.go:55`):只設 `MigrationOK=false` 讓服務
  降級啟動,生產會出現 schema 不一致但服務看似健康。無版本化 migration、無
  up/down、無 dry-run。
- **無 connection pool 設定**:無 `SetMaxOpenConns`/`SetMaxIdleConns`/
  `SetConnMaxLifetime`。Cloud SQL 有連線上限,預設 unlimited 容易打爆。
- **store 層完全不用 `context.Context`**:無法傳遞逾時/取消,慢查詢無法中斷。
- **交易極少**:僅 4 處 `db.Transaction`。entry 寫入 + trip 歸組 + message 關聯是
  多步驟寫入但未包在同一交易。

### 2.5 可觀測性

- 只有標準庫 `log.Printf`,**無結構化 logging**(無 `slog`)、無 request ID /
  trace ID、無 log level。logging middleware **不印 status code、不印錯誤**。
- **完全無 metrics、無 tracing**。LLM 延遲、token 用量、工具執行次數全無觀測。
- **`/health` 不檢查 DB**,直接回 `{"status":"ok"}`,也不回報 `MigrationOK`。
  Cloud Run liveness 會誤判健康。
- commit `dba5145` 正是「adminserver 漏設環境變數導致健康檢查失效」的真實事故,
  證明目前機制無法主動告警。

### 2.6 其他

- **API 錯誤格式不一致**(至少三種):`writeErr` 的巢狀 `{"error":{"code","message"}}`
  vs `http.Error` 的扁平 `{"error","message"}`(且 Content-Type 是 `text/plain`)。
- **無統一 domain error type**,無法區分 400/403/404/500。
- **設定散落**:`os.Getenv` 分散在 4+ 個檔案,無集中 config struct,middleware
  在函式內讀 env 導致測試難以注入。
- **Prompt 硬編碼在 Go 常數**(`assistant_agent.go` 353 行),改 prompt 要重編譯。

---

## 三、前端架構

### 3.1 結構與狀態管理

- **`web/src` 幾乎完全平鋪**:34 個原始檔中 22 個直接躺在根目錄,無
  `components/`/`hooks/`/`pages/`/`services/` 分層。
- **完全沒有狀態管理方案**:`createContext`/`useContext`/`useReducer` **零命中**。
  全靠 `useState` + props。
- **Prop drilling 明確存在**:`useAppState()` 回傳 10 個欄位的 `ContentProps`,
  透過 `{...props}` 一路灌到 `PhoneContent` → `DesktopContent` → 再手動拆給
  5 個子元件。`cfg`/`user`/`token` 幾乎每層都要接一次。
- **伺服器狀態全部手寫** `useState + useEffect + fetch`,**無快取、無去重、
  無 stale 處理**(沒有 TanStack Query 之類的資料層)。

### 3.2 路由

- **沒有 router 套件**。路由是 `App.tsx:99-113` 手刻的 `window.location.pathname`
  if/else + 一條正則。
- 畫面切換靠 state 而非 URL,**無法深連結、無瀏覽器上一頁支援**
  (沒有任何 `pushState`/`popstate`)。
- **零 code splitting**:`lazy(`/`Suspense` 完全無命中。
  `index.js` 398 KB + `sql-wasm.wasm` **644 KB** 一律預載——首頁 landing page
  的訪客也得付這個代價。

### 3.3 效能

- **記憶化嚴重不足**:`Timeline.tsx`(539 行)**零** `useMemo`/`useCallback`/`memo`,
  `MultiTrackTimeline` 每次 render 都重建整棵列表。`MessageBubble.tsx` 等 7 個
  元件同樣零記憶化。
- **無 `React.memo`**:每次 WS 事件更新 state,整棵 Timeline + 所有 MessageBubble
  全部重繪。
- **99 處 inline `style={{...}}`** 每次 render 新建參考,破壞任何下游 memo 效果。

### 3.4 可近性(a11y)

- **aria 屬性總共只有 4 個**(1 個 `aria-hidden`、2 個 `aria-label`、1 個 `aria-live`)。
- **15 處 `<div onClick={...}>`** 無對應 `role`/`tabIndex`/`onKeyDown`——鍵盤與
  螢幕閱讀器完全無法操作。
- 語意化 HTML 稀薄:全專案僅 1 個 `<main>`、1 個 `<header>`、1 個 `<nav>`、1 個 `<h1>`。
- 無 focus trap(modal)、無 skip link、無系統化 `:focus-visible`。
- 無 ESLint,自然也無 `eslint-plugin-jsx-a11y`。

### 3.5 型別安全(這部分做得好)

- `tsconfig.json` **`strict: true`** + `noUnusedLocals` + `noUnusedParameters` +
  `noFallthroughCasesInSwitch`。
- **`any` 用量極低**:全專案僅 1 處且只在註解。零 `@ts-ignore`。
- 但:**前後端型別靠手寫同步**(`types.ts` 註解自承要手動對齊 Go 的 `model.go`),
  **無 OpenAPI / codegen**。後端改欄位前端不會有編譯錯誤——這是最大的型別風險。
- `request<T>()` 結尾 `return call.responseBody as T`,**無執行期驗證**
  (無 zod/valibot)。

### 3.6 樣式

- **純全域 CSS**:`styles.css`(2,475 行)+ `landing.css` + `debug.css`。
  無 CSS Modules / Tailwind / CSS-in-JS,類名靠約定,無 scope 隔離。
- 有初步 design token(12 個 CSS 變數),但**無 spacing / typography / radius /
  shadow scale**,大量硬編碼數值。
- 斷點魔數重複:`App.tsx:76 DESKTOP_BREAKPOINT = 768` 註解自承「需與 styles.css
  的 @media 一致」——手動同步的耦合。

### 3.7 API 層(設計不錯但有缺口)

- `api.ts` 有**統一的 `request<T>()` 封裝**,集中處理 baseURL、Bearer header、
  JSON 序列化、`ApiError`,並用 pub/sub 把每筆交易餵給 DebugPanel。這部分設計良好。
- 但:**無重試、無 timeout、無 `AbortController`**(元件 unmount 後 setState 競態)。
- **兩個函式繞過統一層**:`fetchPublicView`、`publicAssist` 直接用裸 `fetch`,
  不進 ApiCall 紀錄、錯誤型別不一致。
- **loading/error 全靠各元件手寫**:`setError`/`setLoading` 散落 28 處,42 個
  `catch` 各自處理。無全域 error boundary,401 過期無集中攔截。

### 3.8 測試

- **零單元測試、零元件測試**(無 vitest/jest/@testing-library)。
- 唯一的 `e2e-mock-llm.spec.ts` **無法獨立執行**,需先手動跑腳本啟動三個 process
  (刻意不用 Playwright 的 `webServer` 選項),CI 友善度低。
- `retries: 0`、`fullyParallel: false`、無覆蓋率工具。有效覆蓋僅一條 happy path。

### 3.9 `web/admin` 子專案

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

### 4.1 做得好的部分

- **Dockerfile 品質相當高**:三階段 multi-stage、`CGO_ENABLED=0` 靜態編譯、
  `-trimpath -ldflags="-s -w"`、go.mod 先 COPY 做 layer cache、
  `gcr.io/distroless/static-debian12:nonroot` 執行(已滿足 non-root)。
  `.dockerignore` 明確排除 `.env`、DB 檔、sessions。
- 使用 **Workload Identity Federation**(無長期金鑰)。
- image 同時打 `github.sha` 與 `latest` tag。
- `reset-admin-password.yml` 用 `::add-mask::` 保護 secret,且刻意不把密碼放進
  workflow input(註解說明清楚)。

### 4.2 CI/CD 缺口

- **【高】CI 完全沒有跑測試**:兩個 deploy workflow 只有 build → push → deploy。
  專案已有 8 支 Go test 與 1 支 e2e 卻完全沒接上。**唯一的品質門檻是「能編譯過」**。
- **【高】沒有任何 security scan**:無 `govulncheck`、`npm audit`、Trivy/Grype、
  CodeQL、secret scanning。
- **【高】push main 直接部署 prod**,無人工審核、無 staging gate、無 smoke test、
  無自動 rollback,且是直接 100% 切換(沒有 `--no-traffic` + 逐步導流)。
- **【中】無 PR 驗證 workflow**:只有 `ios-build.yml` 有 `pull_request` 觸發,
  後端與前端的 PR 不跑任何檢查。
- **【中】`deploy-admin.yml` 的 `skip_build` 分支會部署 `:latest`**,與 git SHA
  脫鉤,難以追溯正在跑的是哪個 commit。

### 4.3 環境管理

- **【高】只有一個環境(prod)**,無 dev/staging。所有變更 push main 後直接影響
  正式使用者。
- **【高】跨專案資源錯配**:Cloud Run 與 Secret Manager 在 `shuttle-045094509`,
  但 Cloud SQL 在 `onagent-prod`。`setup.sh` 自己有一大段警告說這是寫死的、
  腳本無法處理。專案改名(Shuttle → Tripace)遺留的命名混亂。
- **【中】secret 全部釘 `:latest`**,改版會在下次 revision 靜默改變行為,無版本追溯。
- **【中】`--allow-unauthenticated` 寫死在兩個 deploy workflow**,管理後台也是公開的,
  僅靠應用層 session 保護。
- **【中】`GH_PAT` 以 `--build-arg` 傳入**,會留在 build stage 的 image history。
  應改用 BuildKit secret mount。

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
- **【高】關鍵依賴是極早期私有套件**:`github.com/tim72117/want v0.0.2` 被 26 個檔案
  import,是 LLM/agent 編排核心。v0.0.x 無 API 穩定性承諾,且需 `GH_PAT` 才能拉取
  ——**若 PAT 過期,所有部署立即中斷**(單點失效)。
- **【中】`golang.org/x/crypto v0.31.0` 明顯落後**(對照同檔 `x/sys v0.44.0`、
  `x/text v0.30.0`)。crypto 是安全敏感套件。
- **【低】`go-rod/rod`(headless browser)出現在 indirect 依賴**,透過 want 帶入,
  是相當大的攻擊面,值得確認是否真的需要。

### 4.7 IaC

`server/deploy/` 只有一支 `setup.sh`(一次性 GCP bootstrap),**無 Terraform/Pulumi**。
所有基礎設施靠 shell script + 手動 gcloud,無 state 追蹤、無 drift 偵測。

---

## 五、資料模型

表:`users`, `channels`, `entries`, `members`, `trips`, `public_links`,
`admin_users`, `admin_sessions`。

| 嚴重度 | 問題 | 說明 |
|---|---|---|
| 中 | **時間欄位用 string 而非 date/timestamp** | `entity.go:42-45` 的 `Start`/`StartTime`/`End`/`EndTime` 全是 `string`。無法用 DB 做範圍查詢最佳化與正確排序,`trips.go` 需在應用層自行 parse;`ListEntriesByRange` 對字串做比較,依賴 ISO 格式的隱性約定 |
| 中 | **缺複合索引** | `entries` 只有 `channel_id` 與 `trip_id` 單欄索引。常見查詢 `WHERE channel_id=? AND start BETWEEN ?` 應建 `(channel_id, start)`;`ORDER BY created_at DESC` 亦無索引 |
| 中 | **缺外鍵約束** | 無 `entries.channel_id → channels.id` 等 FK。刪頻道會留下孤兒 entries/trips/public_links,需手動級聯 |
| 中 | **全面 hard delete,無稽核軌跡** | 無 `deleted_at`,**LLM 或誤操作刪除的資料無法復原**,也無操作歷史可追查。與「LLM 可刪資料」疊加後風險放大 |
| 中 | **N+1 風險** | `ListChannelsForUser` 用相關子查詢做 `member_count` 與 `last_message_preview`,頻道多時等同每列各跑兩次查詢 |
| 中 | **PII 明文儲存** | `email` 明文;`entries` 的 `location`/`lat`/`lng` 是使用者位置軌跡,屬敏感個資,全部明文無欄位級加密 |
| 低 | `entries.detail` 用 JSON serializer,無 schema 約束,Postgres 下未用 `jsonb`,無法索引 |

**做得好的**:`public_links` 的 `channel_id` 與 `link_token` 皆有 `uniqueIndex`;
`users.email`/`apple_sub` 有 `uniqueIndex`。

---

## 六、產品功能與 iOS

### 6.1 已實作功能

一句話記事(assist)、語意查詢、條目 CRUD、行程自動歸組、多軌時間軸、
協作與權限(editor/viewer)、公開分享連結(含 editable 模式)、周邊景點推薦、
email/password + Apple 登入、admin 後台、裝置端本地 DB(原話不落後端)。

### 6.2 ClientTools 機制的定位問題

前端另開第二條 WS 取得 sessionID → assist 帶 `clientToolsSessionId` → 工具
`askPage()` 阻塞等瀏覽器回答(20s timeout,整體 prompt 90s 上限)。

- **重複造輪子**:程式碼自陳 want v0.0.2 已內建 `RequestInteraction`/
  `ResolveInteraction`,但這裡另刻平行的 `pendingCalls`,註記「未來可考慮整合」。
- **單分頁假設**:`clienttools_sessions.go:42` 明說「single-tab-at-a-time scope」,
  多分頁行為未定義。
- **走 `/internal/*` 路徑**,靠 `X-Internal-Token` 保護,但該 middleware fail-open。
- 全域 map 且 **session 未綁定 user/channel 驗證**,有 session 劫持風險。
- 前端關閉分頁 → 工具呼叫直接失敗,LLM 只收到錯誤字串。
- **仍被文件定位為 POC**(`docs/knowledge/clienttools-design-notes.md`),卻已接上正式對話流程。

### 6.3 iOS:實質停止維護

- 最後兩次 commit 都是純改名/xcodegen 重生成,**沒有任何功能 commit**。
- 已實作 `HTTPBackendService`(273 行)且確實注入 HTTP 版,但 `MockBackendService`
  (362 行)仍保留且行數更多。
- **與後端已不同步的缺口**:
  - 用舊的 `POST channels/{id}/query`,web 已主要走 assist
  - assist 不帶 `clientToolsSessionId` → **clienttools 工具在 iOS 上全數失效**
  - **完全沒有 WebSocket** → 沒有即時同步
  - 沒有 public-link(分享功能缺席)、沒有景點推薦、沒有手動編輯條目
- 功能覆蓋估計約 web 的 50-60%,且互動核心完全沒有。

### 6.4 多人協作的薄弱處

- **WS Hub 只做單向廣播**,且只廣播 `{"event":"entries_updated"}` 這種
  **無 payload 的通知**,前端收到後自己重新 fetch。
- **衝突處理基本上沒有**:無版本號、etag、optimistic lock、CRDT 或 last-write-wins
  標記。兩人同時編輯同一 entry 就是後寫覆蓋,對方只會收到「重新抓一次」的通知。
- 角色只有 editor/viewer 兩級,無「可留言不可編輯」的中間態,也無轉移 owner。

### 6.5 功能缺口(使用者會預期但沒有)

**搜尋**(只有 LLM 語意查詢,慢/貴/不精確)、**匯出**(無 iCal/Google Calendar/
PDF/CSV——行程 app 沒有日曆匯出是明顯缺口)、**通知**(零推播/email,邀請成員、
行程變更、同行者編輯都不會通知)、**離線支援**(entries/trips 全靠 API,
無 service worker/PWA manifest)、**版本歷史與 undo**、**相片/附件**、
**費用/分帳**、**整趟行程的地圖總覽**(只有推薦景點有地圖)、
**交通/路線時間計算**(有 geocode 但無點對點移動時間)。

### 6.6 文件狀態

| 狀態 | 文件 |
|---|---|
| **已過時** | `docs/knowledge/api.md`(開頭仍寫「認證之後再加」)、`docs/knowledge/architecture.md`(2026-06-22 的純 iOS 架構圖,完全沒有 Go 後端/web/clienttools)、`docs/roadmap.md`(階段二「實作 HTTPBackendService」未打勾但早已完成)、根目錄 `README.md`(仍寫「一個 iOS App」「預設使用 MockBackendService」) |
| **設計提案(未必等於現況)** | `docs/design/trip-sharing-*`、`docs/design/channel-sharing-*`、`docs/design/public-link-*`——四份 design+flow 成對且內容重疊,channel sharing 與 trip sharing 兩套設計並存,實際只做了 public link |
| **仍準確** | `docs/knowledge/clienttools-design-notes.md`、`docs/project-health-review.md`、`docs/knowledge/entry-write-order.md`、`docs/knowledge/llm-trip-build-order.md` |
| **純腦力激盪** | `docs/feature-brainstorm.md`、`docs/feature-priorities.md`、`docs/naming-ideas-pace.md`、`docs/design/itinerary-ux-design.md`(686 行,最大一份) |

無 ADR(architecture decision records)、無 onboarding/runbook/incident 文件、
無 `CLAUDE.md`。

**值得肯定**:程式碼內註解密度極高且解釋「為什麼」(Dockerfile、setup.sh、
reset-admin-password.yml 的註解品質遠高於一般專案),部分彌補了文件缺口。

---

## 建議清單

> 以下 100 項建議分兩部分:前 50 項是**實用建議**(依優先級排序,標注成本),
> 後 50 項是**有趣/前瞻建議**(不見得現在該做,但值得知道有這些方向)。

### A. 實用建議 50 項

#### A-1. 立即處理(安全,1-2 天內)

| # | 建議 | 成本 |
|---|---|---|
| 1 | `auth.go:15-21` 移除訪客回退,無效/缺失 token 一律回 401。若要保留免登入體驗,改成明確的匿名 session 而非繼承 `usr_me` | 低 |
| 2 | `api.go:215, 517, 719, 724` 四個端點補 `requireMember` | 低 |
| 3 | 確認正式環境 `INTERNAL_API_TOKEN` 是否真的沒設;`middleware.go:45` 改成 `DEV_MODE=false` 時未設就 `log.Fatalf` 拒絕啟動 | 低 |
| 4 | `main.go:36` `devMode` 預設改 `false` | 低 |
| 5 | `main.go:35` 移除硬編碼 JWT 密鑰,未設 `JWT_SECRET` 即拒絕啟動 | 低 |
| 6 | `auth/apple.go` 實作 JWKS 簽章驗證(驗 RS256/iss/aud/exp) | 中 |
| 7 | `middleware.go:24` CORS 改讀環境變數的 origin 白名單 | 低 |
| 8 | `public_links.go:12` token 從 6 bytes 提升到 16+ bytes | 低 |
| 9 | 加 rate limiting,優先 `/v1/auth/login`、`/v1/public/*`、`/v1/channels/*/assist` | 中 |
| 10 | `decode()` 加 `http.MaxBytesReader`,各 handler 補欄位長度上限 | 低 |

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
| 19 | 加基本 metrics(至少:LLM 呼叫延遲/成功率/token 用量、各端點 QPS 與 p99) | 中 |
| 20 | 設 Cloud Monitoring uptime check + alert policy(至少 5xx 率與 /health 失敗) | 低 |
| 21 | LLM 呼叫加 retry(指數退避)與明確的 fallback 訊息 | 中 |
| 22 | `want_analyzer.go:88-92` 的 `time.Sleep(1500ms)` 完成判定改成確定性信號 | 中 |
| 23 | LLM 逾時從硬編碼 90 秒改成可設定,並依端點區分 | 低 |

#### A-3. 架構瓶頸(2-4 週,但影響最大)

| # | 建議 | 成本 |
|---|---|---|
| 24 | **`sink.go` 的 request-scoped 全域狀態改成 context-carried struct**——`ChannelFrom(ctx)` 已示範正確做法,照做即可解除全域 `recordMu` | 高 |
| 25 | **拆解 want 引擎單例**,讓 LLM 請求能並行(這是目前的吞吐天花板) | 高 |
| 26 | store 層全面加 `context.Context` 參數 | 中 |
| 27 | 加 connection pool 設定(`SetMaxOpenConns` 等) | 低 |
| 28 | 換版本化 migration 工具(golang-migrate / atlas),AutoMigrate 失敗改成中止啟動 | 中 |
| 29 | 多步驟寫入(entry + trip 歸組 + message 關聯)包進同一交易 | 中 |
| 30 | 收斂 API 錯誤格式成單一 schema,定義 domain error type 對應 HTTP status | 中 |
| 31 | 集中設定管理成單一 config struct,啟動時驗證必要欄位 | 低 |
| 32 | prompt 從 Go 常數移到外部檔案(改 prompt 不用重編譯) | 中 |
| 33 | `wanttools` 不再直接依賴 `store`,改走 `tripsvc` 服務層 | 高 |

#### A-4. 測試與 CI(1-2 週,防止之後倒退)

| # | 建議 | 成本 |
|---|---|---|
| 34 | **建 CI workflow 跑 `go test` + `go vet` + `tsc --noEmit`**(現有 8 支測試先接上,成本最低、立即見效) | 低 |
| 35 | 加 `govulncheck` 與 `npm audit` 到 CI | 低 |
| 36 | 加 PR 觸發的驗證 workflow(目前只有 iOS 有) | 低 |
| 37 | `internal/api` 補測試,優先權限檢查(`requireOwner`/`requireEditor`/`requireMember`) | 中 |
| 38 | `internal/auth` 補測試(JWT 簽發驗證、Apple token、password hash) | 中 |
| 39 | 前端引入 vitest + @testing-library,先測 `api.ts` 與純函式 | 中 |
| 40 | e2e 測試改用 Playwright `webServer` 選項,讓它能獨立執行並進 CI | 中 |
| 41 | 高風險寫入類工具(`trip_entry_add/update/delete`)補測試 | 中 |
| 42 | 加 dependabot 或 renovate | 低 |

#### A-5. 前端結構(2-4 週)

| # | 建議 | 成本 |
|---|---|---|
| 43 | **拆 `App.tsx`(1,295 行/16 個元件)**,至少分出 `pages/`、`layouts/`、`components/` | 中 |
| 44 | **拆 `ChatScreen.tsx`(890 行/16 state/13 effect)** | 中 |
| 45 | 引入狀態管理(Context + useReducer 或 Zustand),消除 10 欄位的 prop drilling | 中 |
| 46 | 伺服器狀態改用 TanStack Query(自動快取/去重/stale 處理/retry) | 中 |
| 47 | 引入 react-router,支援深連結與瀏覽器上一頁 | 中 |
| 48 | `sql-wasm.wasm`(644 KB)改 lazy load,加 code splitting | 低 |
| 49 | `Timeline.tsx` 等熱點元件加 `useMemo`/`React.memo` | 低 |
| 50 | 建立 ESLint 設定(含 `eslint-plugin-jsx-a11y`),修 15 處不可鍵盤操作的 `div onClick` | 中 |

### B. 有趣 / 前瞻建議 50 項

#### B-1. 架構實驗

| # | 建議 |
|---|---|
| 51 | **用 OpenAPI 當單一真實來源**,前後端型別都從 spec codegen(消除手寫同步的最大型別風險) |
| 52 | 前端 API 回應加 zod 執行期驗證,後端改欄位時前端立刻在開發階段就爆錯而非靜默 |
| 53 | 把 `web/` 與 `web/admin/` 收進 monorepo(pnpm workspace / turborepo),統一工具鏈版本並共用型別 |
| 54 | 用 Go 的 `embed` + templ/html 為 landing page 做 SSR,解決 CSR 的 SEO 天花板(其餘 app 部分維持 SPA) |
| 55 | 或整個前端遷移到 Next.js/Remix,取得 SSR + 檔案路由 + code splitting |
| 56 | 引入 Temporal / river 之類的 workflow engine 處理長時間 LLM 流程,取代目前的同步阻塞 |
| 57 | LLM 呼叫改成 job queue + SSE 推送結果,前端不用苦等 90 秒 |
| 58 | 用 CRDT(Yjs/Automerge)做行程協作編輯,徹底解決衝突問題 |
| 59 | WS 廣播從「無 payload 通知 + 前端重抓」改成帶 delta payload,減少往返 |
| 60 | 引入 event sourcing 記錄所有行程變更,自然得到版本歷史與 undo |

#### B-2. LLM / Agent 方向

| # | 建議 |
|---|---|
| 61 | **把 `examples/dspy` 的 DSPy 成果接回正式系統**——用 MIPRO 優化 `assistant_agent.go` 的 prompt,取代手寫 |
| 62 | 用 `flow_intent.mmd` 那套「圖定義行為骨架 + LLM 生成訓練資料」的方法,建立 agent 行為的迴歸測試集 |
| 63 | 加 LLM-as-judge 的自動評估流程,每次改 prompt 都跑一次 benchmark(`cmd/agentbench` 已有雛形) |
| 64 | 意圖分類與工具執行拆成兩個模型:意圖用小模型(便宜快速),工具執行用大模型 |
| 65 | 加 prompt injection 偵測層(分隔標記 + 啟發式規則 + 小模型分類) |
| 66 | 工具呼叫加 dry-run 模式,破壞性操作(刪除)先讓使用者確認 |
| 67 | LLM 回應加 streaming,使用者不用等整段跑完 |
| 68 | 建立 prompt 版本管理與 A/B 測試機制 |
| 69 | 加 token 用量追蹤與成本歸因(哪個頻道/使用者花最多) |
| 70 | 快取常見查詢的 LLM 回應(語意相似度比對) |

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
| 88 | 建 staging 環境,push main 先進 staging,人工確認後才升 prod |
| 89 | 用 Terraform 管理 GCP 基礎設施,取代 `setup.sh` |
| 90 | Cloud Run 部署改成 `--no-traffic` + 逐步導流 + 自動 rollback |
| 91 | 加 smoke test:部署後自動打幾個關鍵端點,失敗即 rollback |
| 92 | 建立 ADR 目錄記錄架構決策(為什麼選 want、為什麼有 clienttools) |
| 93 | 寫 runbook:如何 rollback、如何處理 DB migration 失敗、on-call 流程 |
| 94 | 統一 `docs/` 現況(過時的 knowledge/api.md/knowledge/architecture.md/roadmap.md/README.md) |
| 95 | GCP 資源改名從 `shuttle-045094509` 遷到 tripace 命名 |

#### B-5. 值得評估但不急

| # | 建議 |
|---|---|
| 96 | 評估 `want v0.0.2` 的依賴風險——是否要 vendor、fork 或減少 import 面 |
| 97 | 確認 `go-rod/rod`(headless browser,透過 want 帶入)是否真的需要,不需要就想辦法排除 |
| 98 | iOS 決定去留:要嘛補齊(WS、clienttools、分享),要嘛明確標記為暫停維護 |
| 99 | `entries` 的時間欄位從 string 改成 timestamp(需 migration,但長期收益大) |
| 100 | 加 soft delete + 稽核軌跡(與「LLM 可刪資料」疊加的風險最直接的解法) |

---

## 附錄:本次評估與 `docs/project-health-review.md`(2026-07-22)的差異

**兩份都提到的**:CORS 全開、`INTERNAL_API_TOKEN` fail-open、測試覆蓋率低、
CI 不跑測試、want v0.0.2 依賴風險、clienttools 重複造輪子、前端版本分岔、
`App.tsx` 過大、文件過時、無 APM/tracing、GCP 舊命名。

**本次新發現的**:

- 四個端點完全沒有權限檢查(IDOR)
- 訪客回退在 **token 無效時**也會發生(不只是無 token)
- Apple 登入不驗簽章 + `devMode` 預設 `true`
- JWT 密鑰預設值硬編碼
- 公開分享 token 只有 48-bit 熵、無過期機制
- editable 公開連結讓匿名者驅動 LLM 刪改資料
- want 單例 + `sink.go` 全域狀態造成**全站 LLM 請求序列化**(架構天花板)
- 無 panic recovery、無 http timeout、無 graceful shutdown
- store 層完全不用 context
- 無備份策略、無 rollback 機制
- 資料模型:時間欄位用 string、缺複合索引、缺外鍵、全面 hard delete
- 前端:無 router(無深連結)、零 code splitting、a11y 幾乎為零、零記憶化
- iOS 與後端 API 已明顯不同步(clienttools 全失效、無 WS)
