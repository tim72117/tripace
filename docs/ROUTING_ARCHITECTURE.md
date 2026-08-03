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
                           │                    /admin/api/*(session cookie)
                           ▼                             │
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
另一組獨立路由,只給 `cmd/cli` 用,不走 `/v1/*` 那套頻道層級的
`requireOwner`/`requireEditor`/`requireMember` 檢查,改用 `internalAuth`
middleware 要求 `Authorization: Bearer` 帶一把有效的 JWT(見下方「安全邊界」)
——與 `/v1/*` 一般使用者同一套 `auth.Signer`,CLI 端透過
`tripace-cli login --web` 走瀏覽器核准流程換發。`/admin/api/*` 是第三組,
只給獨立部署的管理後台 SPA 用,走 session cookie 驗證,跟前兩組完全不共用
handler、不共用 store 存取層以外的任何程式碼。

## 二、`/v1/*` 完整路由表(iOS App + Web 共用)

| 方法 | 路徑 | Handler | 權限檢查 | Web 呼叫 | iOS 呼叫 |
|---|---|---|---|---|---|
| POST | /v1/auth/apple | handleAppleAuth | 無(登入端點本身) | ✅ | ✅ |
| POST | /v1/auth/register | handleRegister | 無(註冊端點本身) | ✅ | ✅ |
| POST | /v1/auth/login | handleLogin | 無(登入端點本身) | ✅ | ✅ |
| GET | /v1/me | handleMe | Bearer token | ✅ | ✅ |
| GET | /v1/channels | handleListChannels | Bearer token | ✅ | ✅ |
| POST | /v1/channels | handleCreateChannel | Bearer token(任何登入使用者皆可建) | ✅ | ✅ |
| GET | /v1/channels/{id}/members | handleListMembers | Bearer token | ✅ | ✅ |
| POST | /v1/channels/{id}/members | handleAddMember | **requireOwner** | ✅ | ✅ |
| PATCH | /v1/channels/{id}/members/{userID} | handleSetMemberRole | **requireOwner** | ✅ | ✅ |
| POST | /v1/channels/{id}/query | handleQuery | **requireMember** | ✅ | ✅ |
| POST | /v1/channels/{id}/assist | handleAssist | **requireEditor** | ✅ | ✅ |
| GET | /v1/channels/{id}/entries | handleListEntries | Bearer token | ✅ | ✅ |
| DELETE | /v1/channels/{id}/entries | handleResetChannelData | **requireOwner** | ✅ | — |
| PATCH | /v1/entries/{id} | handleUpdateEntry | 查 entry 取 channelID → **requireEditor** | ✅(`api.ts` 的 `updateEntry`,`Timeline.tsx` 的 `EditEntrySheet`) | — |
| GET | /v1/channels/{id}/ws | handleWS | **requireMember**(WS 訂閱) | ✅ | — |
| POST | /v1/channels/{id}/public-link | handleCreatePublicLink | **requireEditor** | ✅ | — |
| GET | /v1/channels/{id}/public-link | handleGetPublicLink | Bearer token | ✅ | — |
| DELETE | /v1/channels/{id}/public-link | handleDeletePublicLink | **requireEditor** | ✅ | — |
| GET | /v1/public/{token} | handlePublicView | 連結 token 存在即可(公開頁,無使用者身分) | ✅ | — |
| POST | /v1/public/{token}/assist | handlePublicAssist | 連結 token + `info.Editable` 旗標 | ✅ | — |

> `PATCH /v1/entries/{id}` 的前端表單已實作(`web/src/Timeline.tsx` 的
> `EditEntrySheet`),見「待辦」一節。

## 三、`/internal/*` 完整路由表(只給 `cmd/cli` 用)

這組路由不走 `/v1/*` 那套頻道層級的權限檢查(`requireOwner`/`requireEditor`/
`requireMember`),直接操作 `store`/`tripsvc`,設計目的是讓 CLI 或自動化腳本
能繞過「先登入拿頻道成員身分」的流程直接操作資料。**改用 JWT**:呼叫端須帶
`Authorization: Bearer <token>`,由 `internalAuth`(見 `middleware.go`)以
`auth.Signer.Verify` 驗證,與 `/v1/*` 一般使用者共用同一套 signer。CLI 端
透過 `tripace-cli login --web` 走瀏覽器核准流程換發這把 JWT(見
`/v1/cli-auth/*` 路由與 `cmd/cli/login.go`)。

| 方法 | 路徑 | Handler | CLI 呼叫方法(cmd/cli/http.go) |
|---|---|---|---|
| GET | /internal/channels | handleInternalListChannels | listChannels() |
| POST | /internal/channels/{id}/notify | handleNotify | notifyChannel()(main.go,未經 httpClient.do) |
| POST | /internal/channels/{id}/entries | handleInternalRecord | record() |
| PATCH | /internal/entries/{id} | handleInternalUpdateEntry | updateEntry() |
| DELETE | /internal/entries/{id} | handleInternalDeleteEntry | deleteEntry() |
| PATCH | /internal/entries/{id}/latlng | handleInternalSetLatLng | (未包裝,CLI 未呼叫) |
| POST | /internal/entries/{id}/geocode | handleGeocodeEntry | (未包裝,CLI 未呼叫) |
| POST | /internal/entries/compute-route | handleComputeRouteFromEntries | (未包裝,CLI 未呼叫) |
| DELETE | /internal/channels/{id}/entries | handleInternalReset | reset() |

`cmd/cli` 也有一條**不經過 HTTP、直連資料庫**的路徑(`-db` 旗標,見
`cmd/cli/db.go` 的 `dbClient`),兩條路徑實作同一組 `client` 介面
(`cmd/cli/main.go`),使用者可以選擇要不要透過網路呼叫 server。

## 四、`/admin/api/*` 完整路由表(只給 Admin SPA 用)

`web/admin` 是**獨立部署**的 Vite 專案(有自己的 build/deploy,不是
`/app` 的一部分),整組功能受 `ADMIN_ENABLED` 環境變數控制,未設定時
`adminconsole.NewHandler` 完全不會被呼叫、`/admin/*` 完全不會被注冊
(`cmd/server/main.go`)。

| 方法 | 路徑 | Handler | 權限檢查 |
|---|---|---|---|
| POST | /admin/api/login | login | 無(登入端點本身,帳密驗證) |
| POST | /admin/api/logout | logout | session cookie |
| GET | /admin/api/me | withAdmin(me) | session cookie |
| GET | /admin/api/users | withAdmin(listUsers) | session cookie |

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
| 更新條目 | `handleUpdateEntry` | `handleInternalUpdateEntry` | 前者查 entry 反查 channelID 做 requireEditor;後者無檢查。**底層都呼叫 `tripsvc.UpdateEntry`,是同一個函式**,只是外層 handler 各自獨立寫了一份,不是共用同一個 HTTP handler。 |
| 清空頻道資料 | `handleResetChannelData`(requireOwner) | `handleInternalReset`(無檢查) | 底層都呼叫 `s.resetChannel` → `store.DeleteChannelEntries`,同函式、兩個 handler。 |
| 新增條目 | `handleAssist`(requireEditor,經 LLM 判斷後呼叫 `trip_entry_add` 工具寫入) | `handleInternalRecord`(無檢查,直接呼叫 `tripsvc.Record`) | 不是同一個 handler,效果也不再等價:前者(AI 對話)寫入的是裝置端旅程清單(見 `docs/ENTRY_WRITE_ORDER.md`),後者才是直接寫入 Postgres 的 entry。 |

**這份對照表就是「安全邊界」一節要解決的問題**:`/internal/*` 版本因為無
檢查,任何知道 entryID/channelID 的呼叫者都能繞過 `/v1/*` 版本的權限檢查
直接達到同樣效果。

### 完全獨立、不共用(Admin 那組)

`adminconsole`/`adminauth` 兩個 package 有自己的 session 機制
(`admin_session` cookie)、自己的使用者資料模型查詢邏輯,跟 `/v1/*`/
`/internal/*` 用的 `auth.Signer`(JWT Bearer token)是兩套完全不同的驗證
機制,不共用 `requireOwner`/`requireEditor`/`requireMember`,也不共用
`Hub.Broadcast`(Admin SPA 目前沒有即時通知需求)。

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
  狀態,任何人都能不登入直接讀寫刪除任意頻道資料,是這次改走 JWT 要修復的
  真實風險,不只是理論疑慮。

## 七、待辦 / 已知缺口

1. ~~**`PATCH /v1/entries/{id}` 前端表單尚未實作**~~——**已完成**。
   `web/src/api.ts` 有 `updateEntry(cfg, entryID, input)`,`Timeline.tsx`
   的卡片展開後有編輯入口,彈出 `EditEntrySheet` 底部表單(涵蓋
   title/start/startTime/end/endTime/location/note,以 portal 掛到最上層,
   避免被其他底部面板疊層遮住)。**iOS 端目前仍未實作**,是這條剩下的缺口。
2. ~~`INTERNAL_API_TOKEN` 尚未在任何 `.env`(本機或正式環境)實際設定過~~
   ——已隨共享密鑰機制整個移除而不再適用,`/internal/*` 現在強制要求有效
   JWT,不存在「忘記設定環境變數」這種失效模式(見上方「安全邊界」)。
3. `main.go` 呼叫 `srv.Routes()` 三次(`/v1/`、`/internal/`、`/health` 各一次)
   組出三個獨立但內容相同的 mux 實體,`internalAuth` middleware 因此被重複
   建構三次。不影響功能正確性(已用真實 HTTP 請求驗證 `internalAuth` 確實
   生效),純粹是啟動時多做了兩份無用的 mux,未處理。
   (註:現行 `internalAuth`(`middleware.go`)只在驗證失敗時回 401,
   沒有任何啟動期 log 或警告輸出——那是舊共享密鑰版本的行為,已隨機制移除。)
