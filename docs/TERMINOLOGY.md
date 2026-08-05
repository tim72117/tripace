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

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 行程 | 行程 | `Trip` / `TripRole`（`web/src/types.ts`） | `model.Trip` / `tripRow`（`server/internal/store/entity.go`） | 表 `trips` |
| 地點 | 地點 | `Entry`（`web/src/types.ts`） | `entryRow`（`server/internal/store/entity.go`） | 表 `entries` |
| 時間軸 | 時間軸 | `MultiTrackTimeline`（`web/src/Timeline.tsx`） | — | — |
| 路徑（配速表介面） | 配速表 | `PaceRouteMap`（`web/src/PaceRouteMap.tsx`） | — | — |

## 地理輪廓底圖（構想 6）

**景點區域**：具觀光吸引力的地點或區域，人工建檔、依知名程度分 1～5 級（1 級如國際知名地標「101」，5 級如在地商圈「永康商圈」）。可以是單點地標（`radiusMeters` 為 0）也可以是有範圍的區域（如「古城區」），不拆成兩個型別，用同一個符號涵蓋兩種情況。正式用語定為「景點區域」，程式碼命名統一用 `Attraction`。

**即時查詢資料**：地圖拖曳/縮放時，即時打 Google Places API 查回來的資料（如飯店 `GeoHotel`/`hotels`、附近推薦 `GeoPlace`/`places`），非人工建檔、無知名度分級，僅在被查詢的當下存在，隨查詢範圍變動而變動。跟「景點區域」是完全不同的兩種資料來源，不應共用命名。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 景點區域 | （依分頁脈絡顯示，如「地點」分頁） | `GeoDistrict` / `districts` / `setDistricts`（`web/src/GeoOutlineMap.tsx`，**尚未改名，仍用舊名稱**） | `model.Attraction` / `attractionRow`（`server/internal/store/entity.go`） | 表 `attractions` |
| 飯店（即時查詢） | 飯店 | `GeoHotel` / `hotels`（`web/src/api.ts`） | `geo.NearbyPlace`（`server/internal/geo/places.go`） | — |
| 附近推薦（即時查詢） | 附近推薦 | `GeoPlace` / `places`（`web/src/api.ts`） | `placeResponse`（`server/internal/api/geo_outline.go`） | — |

**已知待對齊**：後端（`model`/`store`/資料表）已完成改名，前端（`web/src/GeoOutlineMap.tsx` 等）與後端呼叫端（`api/geo_outline.go`、`api/maintenance.go`、`cmd/cli/*.go`）尚未跟進，仍引用舊符號（`model.Landmark`、`store.ListLandmarksByCity` 等），目前無法編譯，待後續一併修正。

（待續——後續用語持續補充於此。）
