# 主題介紹頁內容規格化與資料庫化規劃（2026-10）

> 狀態：規劃中，尚未開始實作。

## 一、背景與目標

目前九份／京都・清水寺／台南・安平／台南・赤崬等「主題介紹頁」（`web/src/home/JiufenPage.tsx`、`KyotoPage.tsx`、`TainanPage.tsx`、`TainanChikanPage.tsx`）的文案與站點內容，是直接 hardcode 在各城市各自的 `.tsx` 檔案裡，透過 `ScrollTimeline`／`ScrollTimeline.Anchor`（見 [web/src/home/ScrollTimeline.tsx](../web/src/home/ScrollTimeline.tsx)）組裝成「文案隨捲動、左側時間軸漸進顯示錨點」的頁面。新增一個城市頁 = 新增一個 `.tsx` 檔案 + 對應 CSS + 在 `App.tsx`／`seo_meta.go` 各加一筆路由與 meta。

目標：把這類主題介紹頁的內容抽成**規格化、可序列化的資料結構**，存進資料庫，讓內容可以在不改前端程式碼、不重新部署的情況下新增/修改。分兩階段：

- **第一階段**：管理者透過 CLI（`tripace-cli`）新增/編輯/發布內容，前端頁面改成讀取資料庫內容渲染（取代目前的 hardcode `.tsx`）。
- **第二階段**：提供網頁介面編輯，取代 CLI 作為日常編輯手段。

## 二、已有的試做基礎（务必先讀）

使用者在 `web/src/demo/RouteEditor.tsx`（393 行，commit `90b271c`「路徑編輯器試做」）已經做過一輪「雜誌式內容編輯」的前端試做，是本次規劃的直接起點，**不要重新發明內容模型**：

- 內容模型是 `Block` 聯集型別：
  - `ParagraphBlock { kind: 'paragraph', text }`
  - `PlaceBlock { kind: 'place', name, desc, source: 'library' | 'custom', photoGradient }`
  - `ImageBlock { kind: 'image', caption, align: 'full' | 'left' | 'right', gradient }`
- 檔案開頭註解明確寫了目前的限制：純前端假資料存在 `useState`，不呼叫任何 API、重新整理即遺失；左側常駐地圖（選點/帶入既有 attraction）刻意沒做；「插入路線總覽圖」選項停用；**資料庫 schema 與投稿/審核機制都還在構想階段，尚未設計**——這正是本規劃要補上的部分。
- 編輯互動採 contentEditable 風格行內編輯（點什麼編什麼，沒有獨立的「編輯模式」），這是第二階段網頁編輯介面要延續的 UX，不是本次後端規劃的重點，但資料模型要能撐住它（區塊可任意順序插入/刪除/拖拉排序）。
- 功能旗標 `DEMO_ROUTE_EDITOR_ENABLED`（`web/src/DesktopShared.tsx:60`，環境變數 `VITE_FEATURE_DEMO_ROUTE_EDITOR`）控制是否顯示，掛在 `DesktopLayout.tsx` 的 `main-replace` slot，`DesktopRail.tsx` 有對應側邊導覽項。目前沒有對應的 server API 或資料表。

另外也有一份同一輪構想的研究筆記：[docs/research-attraction-storytelling-ideas-2026-09.md](research-attraction-storytelling-ideas-2026-09.md)，實作前建議詳讀，確認設計方向沒有分歧。

### 與現有 `ScrollTimeline` 的關係

`ScrollTimeline.tsx` 的 compound-components 寫法（`<ScrollTimeline><ScrollTimeline.Anchor id="..." thumb="..." theme="...">文案 JSX</ScrollTimeline.Anchor></ScrollTimeline>`）是**刻意**從舊版「丟一包 `anchors[]` 資料陣列、元件自己渲染」的資料驅動寫法改過來的——因為資料驅動版本排版被鎖死成「一筆資料一區塊」，無法自由插圖/插子標題/跨段落內容。

這代表本次要做的「規格化、可序列化」與 `ScrollTimeline` 原先拋棄的方向，表面上是同一件事：**關鍵是這次的 `Block` 模型要比舊版 `anchors[]` 更有彈性**（可任意順序排列段落/地點卡/圖片，而不是固定欄位的一筆資料對一個區塊），這也是為什麼 `RouteEditor.tsx` 的 `Block` 聯集型別比舊 `anchors[]` 適合拿來當規格基礎。渲染層仍可沿用 `ScrollTimeline` 的捲動/時間軸機制，只是「文案 JSX」改成由 `Block[]` 渲染產生，而非手寫在 `.tsx` 裡。

## 三、現有技術慣例（新功能要沿用，不要另立一套）

### 3.1 資料庫：GORM AutoMigrate，沒有 .sql migration

專案沒有獨立的 schema/migration SQL 檔案，用 GORM AutoMigrate：

- 新資料表 = 在 `server/internal/store/entity.go` 新增一個 `xxxRow` struct（GORM tag 定義欄位，欄位用 `gorm:"column:xxx"` 明確指定 snake_case 欄位名，型別後綴固定 `Row`，例如 `attractionRow`、`photoCacheRow`）。
- 新 struct 要**同時**加進兩處，這是容易忘記、但 `schema_check.go` 特別註記強調的地方：
  1. `server/internal/store/store.go` 的 `Open()` 內 `db.AutoMigrate(...)` 清單
  2. `server/internal/store/schema_check.go` 的 `schemaCheckTargets()` 鏡像清單（供 adminconsole 健康檢查比對 struct 定義 vs 實際欄位，因為 AutoMigrate 不會處理改名/改主鍵）
- 欄位棄用走獨立的一次性 drop-column migration 工具（參考 `server/internal/store/drop_column_migration.go`、`server/cmd/migrate-drop-photo-url/`），不要依賴 AutoMigrate 刪欄位（它不會刪）。本次是新增表，不涉及這塊，但若後續要廢棄舊 hardcode 內容或改欄位，要照這個模式另開 migration 工具。

### 3.2 序列化內容存 JSON 的先例

`entry update -detail JSON`（CLI 收一段 JSON 字串，整段存進 `entry` 資料表一個欄位，對應 `tripsvc.UpdateEntryInput`）是現成的「CLI 收 JSON、整段存欄位」模式，可直接套用。新表的內容欄位用 Postgres `jsonb`／SQLite 對應型別存 `Block[]` 序列化後的 JSON，需留意 `store.go` 的 Postgres/SQLite 雙 driver 相容性（目前專案同時支援兩種 driver，見 `Open()`）。

### 3.3 CLI：資源導向語法（resource-first，「名詞 動詞」）

2026-10 commit `96cbf7e` 已把 CLI 從扁平的「動詞-名詞」（`attraction-add`）改成「名詞 動詞」兩段式（`attraction add`），對齊 `gh repo create`／`kubectl get pods`，也對齊 onagent CLI 的同名模式。新功能**必須**沿用這個模式，不要引入新的 CLI 子系統或框架：

- 在 `server/cmd/cli/main.go` 的 `buildResources()` 新增一個 `resource{name: "theme-page"}`（或 `article`，命名待第四節決定），底下定義 `resourceCommand` 清單。
- `client` interface（`main.go` 頂部）要加對應方法，實作放 `httpClient`（`http.go`）。
- 全部走 HTTP 打 `/internal/*` 或 `/v1/*` API，**不直連資料庫**——CLI 早已移除 `-db` 直連旗標，一律經過 server 的認證/節流/請求記錄層，新功能不能開後門繞過。

### 3.4 API 路由分層慣例

維運性質操作歸 `/internal/maintenance/*`（跟一般使用者 `/v1/*`、產品核心 `/internal/geo/*` 分開，方便從請求統計分辨流量來源，見 `server/internal/api/maintenance.go` 開頭說明）。主題頁內容的「管理者寫入」API 應歸在維運類路由下（例如 `/internal/maintenance/theme-pages` 或沿用既有 `/internal/*` 分類方式，實作時再對齊 `maintenance.go` 的既有分類邏輯）；「前端讀取已發布內容」則走公開的 `/v1/*`（類似 `InteractiveExploreMap.tsx` 現在呼叫 `fetchPublicGeoAttractions` 的訪客 token 模式）。

### 3.5 SEO meta 是獨立事實來源，要一併納入規格

`server/cmd/server/seo_meta.go` 的 `seoMetaByPath` 是目前每個城市頁 `<title>`/`description`/`canonical`/OG/Twitter meta 的**唯一事實來源**（2026-10 修正過 react-helmet-async 與靜態 meta 衝突的問題，見 `JiufenPage.tsx` 開頭註解）。目前這份 meta 跟頁面文案（`SEO_DESCRIPTION` 等）各自維護、靠人工保持一致。

**內容規格化時要決定**：序列化內容是否也包含 SEO meta 欄位（title/description/slug），若包含，`seoMetaByPath` 要改成能從資料庫動態讀取，而非繼續寫死在 Go 原始碼裡；若不包含，至少在規格文件/CLI 操作指引裡明確提醒「改了主題頁內容記得同步改 `seo_meta.go`」，避免兩邊再度不一致。建議納入——否則規格化只解決一半問題，SEO meta 仍是另一個要手動同步的硬編碼點。

## 四、內容規格草案（延伸自 `RouteEditor.tsx` 的 `Block` 模型）

> 以下是起點草案，實作前應與使用者確認欄位，特別是 SEO meta 是否納入（見 3.5）、以及 `source: 'library' | 'custom'` 的 `'library'` 要怎麼對應既有 `attraction` 資料（見第六節開放問題）。

```ts
type ThemePageBlock =
  | { id: string; kind: 'paragraph'; text: string }
  | { id: string; kind: 'place'; name: string; desc: string; source: 'library' | 'custom'; attractionId?: string; photoUrl?: string | null }
  | { id: string; kind: 'image'; caption: string; align: 'full' | 'left' | 'right'; imageUrl: string }

interface ThemePageContent {
  slug: string              // 對應路由，例如 "jiufen" / "kyoto-kiyomizu"
  title: string
  lede: string
  coverImageUrl?: string
  blocks: ThemePageBlock[]
  seo?: { title: string; description: string }  // 見 3.5，待定
  status: 'draft' | 'published'
  updatedAt: string
  updatedBy: string
}
```

與 `RouteEditor.tsx` 原型的差異：

- `PlaceBlock.photoGradient`（demo 用假漸層色塊代表照片）要換成真正的照片來源。`source: 'library'` 的站點應該能對應既有 `attraction` 資料表（`attractionId` 欄位），照片沿用現有「地點照片漸進補圖機制」（`place_details_cache`/`google_place_photos`/`place_pexels_photos`），而不是重新做一套圖片上傳系統。`source: 'custom'` 的站點目前 demo 沒有照片上傳實作，第一階段 CLI 可能只能帶一個固定圖片 URL（例如沿用 `LANDING_ASSETS_BASE` GCS bucket 的既有模式，見 `JiufenPage.tsx` 開頭註解），上傳功能留到第二階段。
- `ImageBlock.gradient`（demo 假圖）同理換成 `imageUrl`。

## 五、資料庫與 CLI 規格（第一階段落地設計）

### 5.1 新資料表 `themePageRow`

```go
// server/internal/store/entity.go
type themePageRow struct {
    ID        string `gorm:"primaryKey;column:id"`
    Slug      string `gorm:"column:slug;not null;uniqueIndex"`
    Content   string `gorm:"column:content;type:jsonb;not null"` // 序列化 ThemePageContent JSON
    Status    string `gorm:"column:status;not null;default:draft"` // draft | published
    UpdatedBy string `gorm:"column:updated_by"`
    CreatedAt time.Time `gorm:"column:created_at"`
    UpdatedAt time.Time `gorm:"column:updated_at"`
}
```

- 加進 `store.go` 的 `Open()` AutoMigrate 清單與 `schema_check.go` 的 `schemaCheckTargets()`（見 3.1，兩處必須同步）。
- `jsonb` 型別要確認 SQLite driver 下的相容欄位型別（專案雙 driver 支援，需查 `store.go` 現有 jsonb 用法是否已有先例，或要新增處理）。
- 是否需要 `theme_page_revisions` 歷史表（保留每次發布前的版本，供回溯/審核）——第一階段 CLI 操作者就是管理者本人，風險較低，可以先不做，留給第二階段介面編輯時再評估（那時误操作的風險更高，見第六節開放問題）。

### 5.2 CLI 新資源 `theme-page`

沿用 3.3 的資源導向語法，草案：

```
tripace-cli theme-page list
tripace-cli theme-page get    -slug jiufen
tripace-cli theme-page set    -slug jiufen -content JSON（或 -content-file path.json）
tripace-cli theme-page publish -slug jiufen
tripace-cli theme-page delete -slug jiufen
```

- `set` 比照 `entry update -detail JSON` 的模式收整段 JSON；考慮到內容可能很長，建議同時支援 `-content-file` 讀本機檔案，避免在 shell 裡塞超長 JSON 字串。
- `get` 方便管理者先把現有內容拉下來改，改完用 `set` 寫回去——這個「先 get 再編輯再 set」的流程，也是為什麼內容最好先整理成格式化的 JSON 檔案（而非純粹 inline 字串）比較好操作。
- `publish` 把 `status` 從 `draft` 改成 `published`（草稿與正式內容分離，避免管理者還在改的半成品直接出現在正式頁面）。
- API 對應 `/internal/maintenance/theme-pages`（管理者寫入） + `/v1/theme-pages/:slug`（前端讀取已發布內容，比照 `InteractiveExploreMap` 現有的訪客 token 公開讀取模式）。

### 5.3 前端渲染改動

城市頁（`JiufenPage.tsx` 等）改成：打 `/v1/theme-pages/:slug` 拿 `ThemePageContent`，把 `blocks` 渲染成 `ScrollTimeline`/`ScrollTimeline.Anchor` 結構（渲染邏輯需要新寫一層「`Block[]` → `ScrollTimeline` JSX」的轉換，取代目前手寫 JSX）。這是本規劃範圍內最大的前端改動，建議：

1. 先挑一個城市頁（例如最新的 `TainanChikanPage.tsx`）做轉換試點，驗證 `Block` 模型是否撐得住現有排版需求（圖文繞排、地點卡插圖等），再推廣到其餘城市頁。
2. 舊的 hardcode `.tsx` 內容先搬進資料庫（寫一次性 seed script 或手動用 CLI `set` 建檔），確認視覺一致後才移除原 `.tsx` 裡的手寫 JSX。

## 六、第二階段（網頁編輯介面）銜接

- 把 `web/src/demo/RouteEditor.tsx` 從 demo 轉正：移除 `DEMO_ROUTE_EDITOR_ENABLED` 旗標限制，`useState` 假資料改接第一階段做好的 `/internal/maintenance/theme-pages` API（讀取現有內容、編輯、呼叫 `set`/`publish`）。
- `RouteEditor.tsx` 目前「插入地點」只能新增空白地點卡手動填寫，無法從地圖選點/帶入既有 attraction——這是 demo 註解裡明確列出的已知限制（左側常駐地圖刻意沒做）。第二階段若要補上，需要設計「地圖選點 → 帶入 `attractionId`」的互動，這部分还沒有設計雛形，需要額外一輪規劃（不在本次規劃範圍內，先標記為後續工作）。
- 投稿/審核機制：demo 註解裡 `投稿審核` 按鈕目前是 disabled（「投稿審核機制尚未設計」）。若第二階段要開放給非工程背景的管理者，需要設計 draft → 審核 → publish 的流程與權限模型（目前 `adminUserRow`/`adminSessionRow` 已有管理者帳號體系，可以沿用其權限分層,但審核流程本身要另外設計）。

## 七、開放問題（實作前建議與使用者確認）

1. **SEO meta 是否納入序列化內容**（見 3.5）：納入可讓內容與 meta 單一事實來源，但增加前端動態讀取 meta 的改動範圍（目前 `seo_meta.go` 是 server 端靜態輸出，改成動態查資料庫涉及 server 端架構改動）。
2. **`PlaceBlock.source: 'library'` 如何關聯既有 `attraction` 資料**：是否要求 library 來源的站點必須先在 `attraction` 表建檔（走現有 `tripace-cli attraction add`），`theme-page` 內容只存 `attractionId` 引用；還是允許 library 來源直接複製一份靜態摘要進 `theme-page` 內容（不即時同步 attraction 表的後續更新）？這影響資料正規化程度與維護成本。
3. **歷史版本/回溯**：第一階段是否需要 `theme_page_revisions` 表，或先不做、靠 git 歷史/手動備份 JSON 應急（見 5.1）。
4. **既有四個城市頁的搬遷順序與時程**：是否一次性全部搬完，或先挑一個做轉換試點觀察效果後再推廣（建議見 5.3 第 1 點）。

## 八、建議實作順序

1. 確認第七節開放問題（至少第 1、2 點，影響資料模型設計）。
2. `server/internal/store/entity.go` 新增 `themePageRow`，`store.go`/`schema_check.go` 同步更新 AutoMigrate 清單。
3. Server 端 CRUD：`/internal/maintenance/theme-pages`（管理者）+ `/v1/theme-pages/:slug`（公開讀取，僅回傳 `published` 內容）。
4. CLI `theme-page` 資源（`main.go` `buildResources()` + `client` interface + `httpClient` 實作）。
5. 前端挑一個城市頁做 `Block[]` → `ScrollTimeline` 渲染轉換試點，驗證規格可行性。
6. 用 CLI 把既有四個城市頁內容搬進資料庫，移除對應 `.tsx` 手寫 JSX。
7. 第二階段：`RouteEditor.tsx` 轉正、接上第一階段 API。
