# 系統路由架構

記錄後端 `server/internal/api` 掛載的所有路由,以及 CLI(`cmd/cli`)、iOS App、
Web(`web/src`)、Admin SPA(`web/admin`)四個前端各自呼叫哪些端點、
共用哪些 controller、哪些操作在不同路徑下重複實作。

## 一、四個呼叫端與後端的對應關係

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  iOS App    │     │  Web(/app)  │     │ Admin SPA    │
│ (Tripace)   │     │ ChatScreen等 │     │ (web/admin)  │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │  /v1/*  (登入驗證,requireOwner/Editor/Member)  │
       └──────────────────┬──────────────────┘         │
                           │              /admin/api/*(JWT,同 /v1/*
                           ▼               auth.Signer + email 白名單)   │
                    ┌─────────────┐                      │
                    │  server/    │◄─────────────────────┘
                    │  internal/  │
                    │  api        │
                    └──────┬──────┘
                           │  /internal/*(JWT,同 /v1/* 的 auth.Signer)
                           ▼
                    ┌─────────────┐
                    │  cmd/cli    │  ← 唯一呼叫 /internal/* 的呼叫端
                    └─────────────┘
```

**核心結論:iOS App 與 Web 共用同一組 `/v1/*` API**(同一批 handler、同一套
`requireOwner`/`requireEditor`/`requireMember` 權限檢查)。`/internal/*` 是
另一組獨立路由,只給 `cmd/cli` 用,不走 `/v1/*` 那套行程層級的
`requireOwner`/`requireEditor`/`requireMember` 檢查,改用 `internalAuth`
middleware 要求 `Authorization: Bearer` 帶一把有效的 JWT(見下方「安全邊界」)
——與 `/v1/*` 一般使用者同一套 `auth.Signer`,CLI 端透過
`tripace-cli login --web` 走瀏覽器核准流程換發。`/admin/api/*` 是第三組,
只給獨立部署的管理後台 SPA 用——2026-10 起改成跟前兩組共用同一套
`auth.Signer`(JWT Bearer token),額外多一層 email 白名單檢查
(`internal/adminidentity.IsAdminEmail` 比對 `ADMIN_BOOTSTRAP_EMAIL`),
不再是獨立的 session cookie 機制(見第五節「完全獨立、不共用」的完整
說明)。不共用 handler、不共用 store 存取層以外的任何程式碼。

## 二、`/v1/*` 完整路由表(iOS App + Web 共用)

| 方法 | 路徑 | Handler | 權限檢查 | Web 呼叫 | iOS 呼叫 |
|---|---|---|---|---|---|
| POST | /v1/auth/apple | handleAppleAuth | 無(登入端點本身) | ✅ | ✅ |
| POST | /v1/auth/google | handleGoogleAuth | 無(登入端點本身) | ✅ | ❌ |
| POST | /v1/auth/register | handleRegister | 無(註冊端點本身) | ✅ | ✅ |
| POST | /v1/auth/login | handleLogin | 無(登入端點本身) | ✅ | ✅ |
| GET | /v1/me | handleMe | Bearer token | ✅ | ✅ |
| GET | /v1/trips | handleListTrips | Bearer token | ✅ | ✅ |
| POST | /v1/trips | handleCreateTrip | Bearer token(任何登入使用者皆可建) | ✅ | ✅ |
| GET | /v1/trips/{id}/members | handleListMembers | Bearer token | ✅ | ✅ |
| POST | /v1/trips/{id}/members | handleAddMember | **requireOwner** | ✅ | ✅ |
| PATCH | /v1/trips/{id}/members/{userID} | handleSetMemberRole | **requireOwner** | ✅ | ✅ |
| GET | /v1/trips/{id}/entries | handleListEntries | Bearer token | ✅ | ✅ |
| DELETE | /v1/trips/{id}/entries | handleResetTripData | **requireOwner** | ✅ | — |
| PATCH | /v1/entries/{id} | handleUpdateEntry | 查 entry 取 tripID → **requireEditor** | ✅(`api.ts` 的 `updateEntry`,`timeline/Timeline.tsx` 的 `EditEntrySheet`) | — |
| GET | /v1/trips/{id}/ws | handleWS | **requireMember**(WS 訂閱) | ✅ | — |
| POST | /v1/trips/{id}/public-link | handleCreatePublicLink | **requireEditor** | ✅ | — |
| GET | /v1/trips/{id}/public-link | handleGetPublicLink | Bearer token | ✅ | — |
| DELETE | /v1/trips/{id}/public-link | handleDeletePublicLink | **requireEditor** | ✅ | — |
| GET | /v1/public/{token} | handlePublicView | 連結 token 存在即可(公開頁,無使用者身分) | ✅ | — |

> `PATCH /v1/entries/{id}` 的前端表單已實作(`web/src/timeline/Timeline.tsx` 的
> `EditEntrySheet`),見「待辦」一節。
>
> `POST /v1/trips/{id}/query`、`POST /v1/trips/{id}/assist`、
> `POST /v1/public/{token}/assist` 三條路由已於
> tripace 自家 want LLM 對話系統整套移除時一併刪除(前端對話改走 onagent
> 平台,見 `web/src/chat/useOnagentChatBridge.ts`)——三者的權限檢查邏輯
> (`requireMember`/`requireEditor`/`info.Editable` 旗標)也隨之消失,不再是
> 這份文件要描述的對象。onagent 平台自己觸發推論的路徑不經過 tripace 的
> `/v1/*`,見下方新增的「三之一、`/onagent/*`」一節。

## 三、`/internal/*` 完整路由表(只給 `cmd/cli` 用)

這組路由不走 `/v1/*` 那套行程層級的權限檢查(`requireOwner`/`requireEditor`/
`requireMember`),直接操作 `store`/`tripsvc`,設計目的是讓 CLI 或自動化腳本
能繞過「先登入拿行程成員身分」的流程直接操作資料。**改用 JWT**:呼叫端須帶
`Authorization: Bearer <token>`,由 `internalAuth`(見 `middleware.go`)以
`auth.Signer.Verify` 驗證,與 `/v1/*` 一般使用者共用同一套 signer。CLI 端
透過 `tripace-cli login --web` 走瀏覽器核准流程換發這把 JWT(見
`/v1/cli-auth/*` 路由與 `cmd/cli/login.go`)。

| 方法 | 路徑 | Handler | CLI 呼叫方法(cmd/cli/http.go) |
|---|---|---|---|
| GET | /internal/trips | handleInternalListTrips | listTrips() |
| POST | /internal/trips/{id}/notify | handleNotify | notifyTrip()(main.go,未經 httpClient.do) |
| POST | /internal/trips/{id}/entries | handleInternalRecord | record() |
| PATCH | /internal/entries/{id} | handleInternalUpdateEntry | updateEntry() |
| DELETE | /internal/entries/{id} | handleInternalDeleteEntry | deleteEntry() |
| PATCH | /internal/entries/{id}/latlng | handleInternalSetLatLng | (未包裝,CLI 未呼叫) |
| POST | /internal/entries/{id}/geocode | handleGeocodeEntry | (未包裝,CLI 未呼叫) |
| POST | /internal/entries/compute-route | handleComputeRouteFromEntries | (未包裝,CLI 未呼叫) |
| DELETE | /internal/trips/{id}/entries | handleInternalReset | reset() |

`cmd/cli` 曾經有一條**不經過 HTTP、直連資料庫**的路徑(`-db` 旗標,
`cmd/cli/db.go` 的 `dbClient`),現已完全移除——所有操作一律經過
server 的 HTTP API(見 `cmd/cli/main.go` 開頭的架構說明),不再有任何
一條路徑繞過認證/節流/請求記錄。

維運性質的操作(景點區域人工建檔、Google Photo 更新等)另外歸在
`/internal/maintenance/*` 命名空間,跟一般使用者會呼叫的上表 `/internal/*`
端點分開,方便從請求統計一眼分辨流量來源(見
`server/internal/api/maintenance.go` 開頭的完整說明):

| 方法 | 路徑 | Handler | CLI 呼叫方法(cmd/cli/http.go) |
|---|---|---|---|
| GET | /internal/maintenance/geocode | handleMaintenanceGeocode | geocode() |
| POST | /internal/maintenance/attractions/{id}/update-photo | handleMaintenanceAttractionUpdatePhoto | attractionUpdatePhoto() |
| POST | /internal/maintenance/attractions | handleMaintenanceAttractionAdd | attractionAdd() |
| GET | /internal/maintenance/attractions | handleMaintenanceAttractionList | attractionList() |
| GET | /internal/maintenance/attractions/cities | handleMaintenanceAttractionCities | attractionCities() |
| DELETE | /internal/maintenance/attractions/{id} | handleMaintenanceAttractionDelete | attractionDelete() |
| GET | /internal/maintenance/rate-limits | handleMaintenanceRateLimitList | rateLimitList()(`rate-limit list`) |
| PATCH | /internal/maintenance/rate-limits/{endpoint} | handleMaintenanceRateLimitSet | rateLimitSet()(`rate-limit set`) |
| GET | /internal/maintenance/field-masks | handleMaintenanceFieldMaskList | fieldMaskList()(`field-mask list`) |
| PATCH | /internal/maintenance/field-masks/{key} | handleMaintenanceFieldMaskSet | fieldMaskSet()(`field-mask set`) |

> 上表**不是**完整清單:`content-pages`、`itinerary-pages`、`sync/*` 與
> `attractions/{id}/{coords,field,place-id,theme}` 等維運路由後來陸續加入,
> 這份文件沒有跟上,以 `server/internal/api/api.go` 的 `internalMux`
> 註冊處為準。限流與 field mask 這四支要求管理權限
> (`requireRateLimitAdmin`),不是任何登入使用者都能呼叫。

### `/public/plan-ai/*` 與 `/public/geo/plan-ai/*`(訪客可呼叫,以來源 IP 節流)

`?skipDemo=1` 讓未登入訪客直接進真實 AI 推論時用的端點。複用既有 handler,
但**沒有**最早那三支 `/public/geo/*`(place-details/place-photo-assets/
attractions)的範圍白名單,只靠 IP 節流把關:

| 方法 | 路徑 | Handler | 節流 |
|---|---|---|---|
| GET | /public/geo/plan-ai/place-search | handlePublicGeoPlaceSearch | withGeoQueryIPThrottle |
| GET | /public/geo/plan-ai/attraction-search | handlePublicGeoAttractionSearch | withGeoQueryIPThrottle |
| GET | /public/geo/plan-ai/place-details-any | handlePublicGeoPlaceDetailsAny | withGeoQueryIPThrottle |
| POST | /public/plan-ai/chat | handlePlanAiChat | withPlanAiChatIPThrottle |
| POST | /public/plan-ai/chat/reply | handlePlanAiChatReply | withPlanAiChatIPThrottle |

沒有公開版的:`transit-estimate` 仍只在 `/internal/geo/plan-ai/`,訪客模式
的交通資訊因此完全不顯示。

## 三之一、`/onagent/*` 完整路由表(只給 onagent 平台呼叫)

onagent LLM 決定呼叫 BackendDispatch 型工具時,onagent 伺服器直接 POST 到
下面這兩個端點——不經過任何瀏覽器分頁,回應在同一次 HTTP 往返內帶回結果
(詳見 onagent 專案 `docs/backend-tool-dispatch-design-2026-08-08.md`)。
與 `/v1/*`/`/internal/*` 不同,呼叫端是 onagent 伺服器本身,不是使用者的
瀏覽器/CLI,故**不帶 tripace 自己的 JWT**,目前也**刻意不做簽章驗證**
(對齊 onagent 平台目前實際實作進度,見 `internal/onagenttools/dispatch.go`
開頭說明)——PoC 階段的已知風險,非本文件解決範圍。

| 方法 | 路徑 | Handler |
|---|---|---|
| POST | /onagent/recommend_nearby | onagenttools.HandleRecommendNearby |
| POST | /onagent/geocode | onagenttools.HandleGeocode |

## 四、`/admin/api/*` 完整路由表(只給 Admin SPA 用)

`web/admin` 是**獨立部署**的 Vite 專案(有自己的 build/deploy,不是
`/app` 的一部分),整組功能受 `ADMIN_ENABLED` 環境變數控制,未設定時
`adminconsole.NewHandler` 完全不會被呼叫、`/admin/*` 完全不會被注冊
(`cmd/server/main.go`)。

沒有獨立的 login/logout 端點——2026-10 起 admin 身份直接沿用一般使用者
透過 `/v1/auth/*` 登入換到的 JWT(見第五節的完整說明),Admin SPA 自己
的登入表單只是呼叫一般登入端點拿 token,不是打這裡的某支 admin 專屬
端點。

| 方法 | 路徑 | Handler | 權限檢查 |
|---|---|---|---|
| GET | /admin/api/me | withAdmin(me) | JWT + email 白名單 |
| GET | /admin/api/users | withAdmin(listUsers) | JWT + email 白名單 |
| GET | /admin/api/health/external | withAdmin(listExternalHealth) | JWT + email 白名單 |
| GET | /admin/api/request-stats | withAdmin(listRequestStats) | JWT + email 白名單 |
| GET | /admin/api/plan-ai-chat-logs | withAdmin(listPlanAiChatLogs) | JWT + email 白名單 |
| GET | /admin/api/geo-api-stats | withAdmin(listGeoAPIStats) | JWT + email 白名單 |
| GET | /admin/api/schema-check | withAdmin(checkSchema) | JWT + email 白名單 |
| GET | /admin/api/geo-rate-limits | withAdmin(listGeoRateLimits) | JWT + email 白名單 |
| PUT | /admin/api/geo-rate-limits | withAdmin(updateGeoRateLimit) | JWT + email 白名單 |
| GET | /admin/api/attraction-missing-place-id-check | withAdmin(checkAttractionMissingPlaceID) | JWT + email 白名單 |
| POST | /admin/api/attraction-missing-place-id-check/refetch | withAdmin(refetchAttractionPlaceID) | JWT + email 白名單 |

`/admin/*` 額外套一層獨立的 CORS 處理(`withAdminCORS`,`main.go`),因為
Admin SPA 是跨網域呼叫並帶 cookie(`credentials: 'include'`),不能沿用
`/v1/*`/`/internal/*` 共用的 `cors()` middleware(那個用 `Allow-Origin: *`,
跟帶憑證的請求不相容)。

## 五、共用 vs 不共用的 Controller/邏輯層

### 完全共用(同一段程式碼被多個入口呼叫)

- **`tripsvc.Service`**(`internal/tripsvc/tripsvc.go`):`Record`(新增
  entry)、`UpdateEntry`(更新 entry)是唯一的業務邏輯層,`/v1/*`、`/internal/*`
  兩組路由的對應 handler 都呼叫**同一個** `tripsvc.Service` 方法,只是外層包的
  權限檢查不同。這代表底層資料操作邏輯只寫一份,不會因為呼叫路徑不同而有
  兩套實作互相漂移。
- **`store.Store`**:所有 handler(含 `wanttools` 的 AI 工具)最終都經過同一個
  `store` 存取層讀寫資料庫,`wanttools` 甚至不經過 HTTP,直接呼叫 `store`。
- **`Hub.Broadcast`**(`internal/api/hub.go`):`entries_updated` 等 WS 廣播事件,
  不論觸發來源是 `/v1/*` handler、`/internal/*` handler、還是 `wanttools`
  的 AI 工具,都呼叫同一個 `Hub.Broadcast`,前端不需要區分事件是誰觸發的。

### 同一件事、兩條不同路徑各自實作(非共用,是重複)

| 操作 | /v1/* 版本 | /internal/* 版本 | 差異 |
|---|---|---|---|
| 更新條目 | `handleUpdateEntry` | `handleInternalUpdateEntry` | 前者查 entry 反查 tripID 做 requireEditor;後者無檢查。**底層都呼叫 `tripsvc.UpdateEntry`,是同一個函式**,只是外層 handler 各自獨立寫了一份,不是共用同一個 HTTP handler。 |
| 清空行程資料 | `handleResetTripData`(requireOwner) | `handleInternalReset`(無檢查) | 底層都呼叫 `s.resetTrip` → `store.DeleteTripEntries`,同函式、兩個 handler。 |

**這份對照表就是「安全邊界」一節要解決的問題**:`/internal/*` 版本因為無
檢查,任何知道 entryID/tripID 的呼叫者都能繞過 `/v1/*` 版本的權限檢查
直接達到同樣效果。

### 共用一般使用者身份、多一層白名單(Admin 那組)

`adminconsole` package(2026-10 起,原本獨立的 `adminauth` 套件、
`admin_users`/`admin_sessions` 兩張表、`admin_session` cookie 機制已整個
移除)現在改成跟 `/v1/*`/`/internal/*` 共用同一套 `auth.Signer`(JWT
Bearer token)身份驗證——`withAdmin` 中介層解析 Authorization header、
驗證簽章、查出對應使用者,再用 `internal/adminidentity.IsAdminEmail`
比對這個使用者的 email 是否等於 `ADMIN_BOOTSTRAP_EMAIL` 環境變數設定的
白名單值(大小寫不敏感)。符合白名單才放行,不符合或環境變數未設定一律
401(fail-closed)。

這代表 admin 權限不再有獨立的登入/登出、可從資料庫撤銷的 session——
依附在一般使用者的 30 天 JWT 上,token 外洩時只能靠轉動 `JWT_SECRET`
(會波及全站使用者)或縮短 JWT 有效期補救,沒有單獨撤銷單一 token 的
機制(見 `adminconsole.go` 的 `withAdmin` 開頭註解的完整說明)。仍然不共用
`requireOwner`/`requireEditor`/`requireMember`(那些是行程成員權限檢查,
跟「是不是 admin」是不同維度的授權),也不共用 `Hub.Broadcast`(Admin SPA
目前沒有即時通知需求)。

## 六、安全邊界

`/v1/*` 與 `/internal/*` 掛在**同一個對外 port**(單一 Go process,見
`Dockerfile`/`docker-compose.yml`,沒有反向代理或網路層隔離)。路徑命名
(`/internal/` 前綴)本身**不構成安全邊界**——這曾是實際問題,見上方
「同一件事、兩條不同路徑」表格,任何外部呼叫者只要把請求路徑從
`/v1/entries/{id}` 換成 `/internal/entries/{id}`,就能繞過 `requireEditor`
直接改任何人的資料。

**已修復**(`server/internal/api/middleware.go` 的 `internalAuth`):
`/internal/*` 現在改走獨立的 `internalMux`,套上 `internalAuth` middleware,
解析請求的 `Authorization: Bearer <token>`,以 `auth.Signer.Verify` 驗證這是
一把有效的自家 JWT——與 `/v1/*` 一般使用者同一套 `auth.Signer`。

- **驗證失敗一律回 401**:不論是缺 header、格式錯誤,還是 token 無效/過期,
  沒有任何「環境變數沒設定就整段跳過驗證放行」的分支,不存在舊機制那種
  「忘記設定就等於不設防」的失效模式。
- `cmd/cli` 端透過 `tripace-cli login --web` 走瀏覽器核准流程(見
  `/v1/cli-auth/*` 路由、`cmd/cli/login.go`)換發這把 JWT,存在本機(見
  `cmd/cli/token.go`),之後的指令自動帶上,不需要另外設定任何環境變數。
- 舊版共享密鑰機制(`X-Internal-Token` header 比對環境變數
  `INTERNAL_API_TOKEN`,未設定時本機放行)已完全移除——已確認正式環境
  (Cloud Run `tripace-server`)先前實際上就處於「未設定、完全不設防」的
  狀態,任何人都能不登入直接讀寫刪除任意行程資料,是這次改走 JWT 要修復的
  真實風險,不只是理論疑慮。

## 七、待辦 / 已知缺口

1. ~~**`PATCH /v1/entries/{id}` 前端表單尚未實作**~~——**已完成**。
   `web/src/api.ts` 有 `updateEntry(cfg, entryID, input)`,`timeline/Timeline.tsx`
   的卡片展開後有編輯入口,彈出 `EditEntrySheet` 底部表單(涵蓋
   title/start/startTime/end/endTime/location/note,以 portal 掛到最上層,
   避免被其他底部面板疊層遮住)。**iOS 端目前仍未實作**,是這條剩下的缺口。
2. ~~`INTERNAL_API_TOKEN` 尚未在任何 `.env`(本機或正式環境)實際設定過~~
   ——已隨共享密鑰機制整個移除而不再適用,`/internal/*` 現在強制要求有效
   JWT,不存在「忘記設定環境變數」這種失效模式(見上方「安全邊界」)。
3. `main.go` 呼叫 `srv.Routes()` 四次(`/v1/`、`/internal/`、`/health`、
   `/onagent/` 各一次)組出四個獨立但內容相同的 mux 實體,`internalAuth`
   middleware 因此被重複建構四次。不影響功能正確性(已用真實 HTTP 請求
   驗證 `internalAuth` 確實生效),純粹是啟動時多做了三份無用的 mux,未處理。
   (註:現行 `internalAuth`(`middleware.go`)只在驗證失敗時回 401,
   沒有任何啟動期 log 或警告輸出——那是舊共享密鑰版本的行為,已隨機制移除。)
