# 系統用語對照表

定調系統內部各種概念的正式中文用語（左欄），對照到系統裡實際的命名——介面用語是使用者在畫面上實際看到的文字，之後 UI 上一律統一使用這欄的字，不要出現同義詞的變體；介面/前端程式碼、後端變數、資料庫則是給開發時查閱對應到哪個符號用的。避免同一個東西在對話、畫面、程式碼、資料庫裡各自用不同名字。

新增/修改用語時，同步更新對應程式碼裡的註解用詞，並檢查畫面上顯示的文字是否已對齊「介面用語」這欄（不需要為了對齊這份文件而重新命名變數本身，除非變數名稱本身就是造成混淆的原因）。

## 桌面版三段式版面

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 功能列 | （無文字，純圖示列） | `DesktopRail`（`DesktopLayout.tsx`）／class `.desktop-rail` | — | — |
| 側欄 | （無獨立標題，依分頁各自顯示標題） | class `.desktop-sidepanel`（`DesktopLayout.tsx`） | — | — |
| 主顯示 | （無獨立標題） | class `.desktop-main`（`DesktopLayout.tsx`） | — | — |

## 手機版

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 抽屜欄 | （無獨立標題） | `PhoneNavDrawer`（`PhoneNavDrawer.tsx`）整片滑出面板，內容對應桌面版的功能列＋側欄 | — | — |
| 功能列 | （無文字，純圖示列，跟桌面版一致） | 抽屜欄打開後，上方那排分頁圖示按鈕列；class `.tabs`（`PhoneNavDrawer.module.css`） | — | — |
| 主顯示 | （無獨立標題） | `PhoneContent.tsx` 的主要 render 分支（抽屜欄關閉時看到的內容） | — | — |
| 設定面板 | 設定 | `SettingsScreen`（`PhoneScreens.tsx`）／桌面版 `SettingsDialog`（`DesktopLayout.tsx`） | — | — |

## 資料模型

後端（`server/`）已完成「頻道 → 行程」改名重構：`model.Channel` → `model.Trip`、`channelRow` → `tripRow`、資料表 `channels` → `trips`、欄位 `channel_id` → `trip_id`，程式碼識別符已與介面用語「行程」一致，故不再需要維護行程/channel 的對照關係。

前端（`web/src/types.ts`）尚未跟進這次改名，仍使用 `Channel`／`ChannelRole` 型別名稱——這是已知的技術債，不影響介面顯示文字（畫面上一律顯示「行程」）。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 行程 | 行程 | `Channel`（`web/src/types.ts`，尚未改名） | `model.Trip` / `tripRow`（`server/internal/store/entity.go`） | 表 `trips` |
| 地點 | 地點 | `Entry`（`web/src/types.ts`） | `entryRow`（`server/internal/store/entity.go`） | 表 `entries` |
| 時間軸 | 時間軸 | `MultiTrackTimeline`（`web/src/Timeline.tsx`） | — | — |
| 路徑（配速表介面） | 配速表 | `PaceRouteMap`（`web/src/PaceRouteMap.tsx`） | — | — |

（待續——後續用語持續補充於此。）
