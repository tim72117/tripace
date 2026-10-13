# 廣告投放設定介面規劃

> 對應 [構想六：廣告投放系統](2026-10-product-direction-brainstorm.md#構想六廣告投放系統) 的落地延伸：這份文件規劃「廣告主/營運人員怎麼設定廣告投放」的管理介面本身，不是重複整份系統探索——資料模型、投放演算法、精準投放訊號等完整內容仍以 brainstorm 文件與 Opus 探索報告為準。**這是規劃文件，不是實作**，尚未寫任何程式碼。

---

## 0. 放在哪裡、給誰用

沿用既有 `web/admin`（`Tripace admin`，獨立 SPA，`/admin/api/*`，`withAdmin` 驗證）新增一個分頁，對齊 MVP 決策「第一階段由內部營運人員代為上稿，不開放廣告主自助登入」（見 brainstorm 構想六）。

這個介面**不是**給廣告主本人操作的——廣告主（在地店家等）透過其他管道（email、電話）把素材與需求交給營運人員，營運人員在這裡建立活動、上傳素材。這個定位直接決定了介面可以多麼「內部工具感」，不需要考慮多租戶隔離、自助註冊等自助後台才需要的東西。

## 1. 分頁結構

比照既有 Tab 風格（`type Tab = 'users' | 'external' | ... `），新增：

```
type Tab = ... | 'sponsored-advertisers' | 'sponsored-campaigns' | 'sponsored-stats'
```

拆成三個子分頁而非一個，理由：

- **Advertisers（廣告主）**：維護廣告主的基本資料（名稱、聯絡窗口），資料量小、改動頻率低，獨立列表最單純。
- **Campaigns（活動 + 素材）**：核心操作畫面，建立/編輯活動與上傳素材都在這裡做，操作頻率最高。
- **Stats（報表）**：純唯讀的曝光/點擊數字，沿用 `TimelineChart` 元件。

這個切法對齊既有 `UsersTab`/`RequestStatsTab` 等「一個實體一個分頁」的既有切分邏輯，不把 CRUD 跟報表混在同一個畫面裡（參考 `GeoRateLimitsTab` 是設定+用量混一起，但那是因為兩者緊密相關且資料量小；廣告活動的報表會隨時間累積變大，值得分開）。

## 2. Advertisers 分頁

### 畫面

單一表格（比照 `GeoRateLimitsTab` 的 `table-scroll` + `<table>` 寫法），列出所有廣告主：

| 欄位 | 說明 |
|---|---|
| 名稱 | 文字 |
| 聯絡窗口 | email + 聯絡人姓名 |
| 狀態 | active / suspended（下拉選單，改了立即 PATCH） |
| 建立時間 | 唯讀 |
| 操作 | 「編輯」開啟同頁內嵌表單（不彈窗，比照 inline edit 風格），「查看活動」連結跳到 Campaigns 分頁並帶 filter |

頂部一顆「+ 新增廣告主」按鈕，點開一個簡單表單（名稱、聯絡 email、聯絡人姓名），送出後 `POST /admin/api/sponsored/advertisers`。

### 不做的事

不做刪除（廣告主底下可能已經有活動歷史記錄，刪除语意不清楚）——只有「停用」（`status: suspended`），停用後這個廣告主底下所有活動自動視為不可選取（Campaigns 分頁的「廣告主」下拉只列 active 的）。

## 3. Campaigns 分頁（核心）

這是整個介面裡最複雜的一塊，拆成「列表」與「編輯單一活動」兩個畫面，仿照 web 端常見的 list→detail 模式（而非把所有欄位塞進一行可展開的 table row——活動的欄位數量跟素材管理的複雜度，已經超過 inline table row 能優雅呈現的程度）。

### 3.1 活動列表

表格欄位：廣告主名稱、活動名稱、狀態（draft/scheduled/active/paused/ended，用色塊標籤區分）、檔期（開始～結束日期）、投放版位（badge 列出勾選了哪幾個版位的簡稱）、tier、操作（編輯/查看報表）。

篩選列（比照既有 `AttractionMissingPlaceIDTab` 的篩選下拉模式）：依廣告主、依狀態篩選。

頂部「+ 新增活動」按鈕，進入活動編輯畫面。

### 3.2 活動編輯畫面

這是真正的「投放設定」核心。表單分區塊（比照既有 `section-head` + `card` 的分區風格）：

**基本資料**
- 廣告主（下拉選單，從 Advertisers 分頁的 active 清單選）
- 活動名稱
- 狀態（draft/scheduled/active/paused/ended）——這裡刻意讓狀態是手動欄位而非系統自動推算，理由見下方「狀態機」說明
- 檔期：開始日期、結束日期（date picker，到期自動視為 ended，不需要手動切換，但手動設 paused 可以提前暫停）

**投放版位**（對應 brainstorm 的 3 個 MVP 版位）
- 核取方塊列表：城市頁時間軸結束後 / 文章結尾 / 範例行程列表中插
- 每個版位旁邊顯示一行小字說明位置（例如「時間軸敘事結束後、『探索其他城市』之前」），讓營運人員不用回頭查文件就知道這個版位在前台長在哪裡——這行文字直接對齊 `/showcase-demo/ad-system` 雛形頁 `adSystemData.ts` 裡 `positionDesc` 的內容，兩邊共用同一份描述文字來源最理想（⚠️ 待確認，見第 6 節）

**投放條件**
- 城市（多選，從既有 `attractions.CityName` 字典抓值，呼應 brainstorm「城市名稱的標準字典」待確認項）——這裡直接决定了這個活動只在哪些城市語境的頁面出現
- 裝置（全部 / 僅手機 / 僅桌面）
- 留空＝不限制（例如城市留空代表所有城市都可能投放這個活動，不是「不投放」）

**優先權重**
- Tier（sponsorship 獨佔 / standard 一般 / house 自家推廣）
- Weight（數字輸入，同層內用來加權隨機抽選）——這兩個欄位放在一起並附上簡短說明文字：「同一版位有多個符合條件的活動時，先選 tier 最高的一層，同層內依 weight 隨機抽選」，避免營運人員誤以為 weight 是絕對排序

**每日曝光上限**（選填）
- 數字輸入，留空＝不限制，對應 brainstorm 的 `daily_cap_impressions`

**素材管理**（這個活動底下的 creative 列表）
- 表格：縮圖、標題、描述、CTA 文案、狀態（active/paused）、操作（編輯/刪除）
- 「+ 新增素材」開啟表單：標題、描述、CTA 文案、連結網址（landing_url）、圖片上傳（沿用既有 `photoupload` 的簽名 URL 直傳流程）
- 圖片上傳後即時顯示預覽，且**直接渲染跟前台 `SponsoredCard` 相同的卡片樣式做預覽**（比照 Opus 報告 §6.2 的建議），讓營運人員上稿當下就能看到前台實際呈現效果，不用等發布後才發現圖片裁切或文案過長被截斷
- 連結網址欄位要做基本格式驗證（必須是 https），對應 Opus 報告提到的 open redirect 風險提醒

### 3.3 狀態機說明

活動狀態（`draft`/`scheduled`/`active`/`paused`/`ended`）刻意做成**手動欄位**而非純粹由檔期時間推算，原因：

- `draft`：素材還沒上傳齊全/還在跟廣告主確認內容，即使填了檔期日期也不會被投放系統選中
- `scheduled`：已確認、檔期未到，系統知道這個活動存在但還不會投放
- `active`：檔期內且正在投放
- `paused`：檔期內但營運人員手動喊停（例如廣告主要求臨時下架、素材有問題）
- `ended`：檔期已過，或營運人員手動結束

投放系統選取候選活動時只看 `status === 'active'`，不自己判斷日期——日期只用來讓 Admin 介面在「scheduled 活動到了開始日」時跳出提醒（或by排程自動把 scheduled 轉成 active，⚠️ 待確認是否要做自動轉換，或維持全手動更保守）。

## 4. Stats 分頁

唯讀報表，沿用既有 `TimelineChart` 元件（`web/admin/src/TimelineChart.tsx`，用於 `PlanAiChatLogsTab`/`RequestStatsTab` 這類時間序列資料）：

- 篩選：依活動、依版位、依日期區間
- 折線圖：每日曝光數、每日點擊數（兩條線疊加或左右分軸）
- 下方表格：活動加總（總曝光、總點擊、CTR），比照 `GeoAPIStatsTab` 的彙總表呈現方式

這個分頁完全不需要寫入操作，是這三個子分頁裡最單純的一塊。

## 5. API 端點對照

延續 Opus 報告 §7.2 列出的 14 支端點規劃，這裡確認每個畫面對應呼叫哪些端點（給之後寫 `api.ts` 時當對照表）：

| 畫面 | 呼叫端點 |
|---|---|
| Advertisers 列表/新增/編輯 | `GET/POST/PATCH /admin/api/sponsored/advertisers[/{id}]` |
| Campaigns 列表 | `GET /admin/api/sponsored/campaigns` |
| 活動編輯畫面（讀取/儲存） | `GET/POST/PATCH /admin/api/sponsored/campaigns[/{id}]` |
| 素材表單（上傳） | `POST .../creatives/upload-url` → 前端直傳 GCS → `POST .../creatives/{id}/complete`，比照既有 `photoupload` 流程 |
| 素材編輯/刪除 | `PATCH/DELETE .../creatives/{id}` |
| Stats 分頁 | `GET /admin/api/sponsored/stats?campaign=&placement=&from=&to=` |

## 6. ⚠️ 待確認

1. **版位說明文字的共用來源**：第 3.2 節提到活動編輯畫面裡每個版位旁的說明文字，建議跟 `/showcase-demo/ad-system` 雛形頁的 `adSystemData.ts` 共用同一份內容來源，但 Admin SPA（`web/admin`）跟主站（`web/src`）目前是兩個完全獨立的建置產物，沒有共用模組的既有慣例——是要為此新增一個小型共用 package，還是接受兩邊各自維護一份（內容短、改動頻率低，重複維護成本不高）？
2. **scheduled → active 的狀態轉換**：全手動（營運人員自己記得在檔期開始當天把狀態改成 active），還是要排程自動轉換？全手動比較保守（不會有排程漏跑的風險），但需要營運人員自己盯著日期。
3. **Admin 介面文字語言**：既有分頁全是英文（"Users"、"External services"），這次新分頁要跟進英文，還是像既有的「AI 規劃對話」分頁一樣用中文？（`PlanAiChatLogsTab` 的 tab 標籤已經是中文先例）
4. **素材審核欄位**：這份規劃沒有畫出獨立的「審核」步驟（因為 MVP 是營運人員自己上稿，等於上稿當下已經審過）——但 Opus 報告建議 `review_status` 欄位從第一版就要有，是否要在素材表單加一個「審核通過」勾選框當作欄位佔位，即使 MVP 階段永遠勾選？

## 7. 跟既有流程的銜接

- 圖片上傳：完全沿用 `internal/photoupload` 既有的簽名 URL 直傳流程，不另外設計一套。
- 認證：沿用 `withAdmin` + email 白名單，不另外設計廣告模組專屬的權限機制。
- CSS 風格：沿用 `web/admin/src/style.css` 既有的 `card`/`section-head`/`table-scroll`/`muted`/`error banner` 等既有 class，不引入新的設計語言。
