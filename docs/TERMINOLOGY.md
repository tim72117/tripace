# 系統用語對照表

定調系統內部各種概念的正式中文用語（左欄），對照到系統裡實際的命名——介面用語是使用者在畫面上實際看到的文字，之後 UI 上一律統一使用這欄的字，不要出現同義詞的變體；介面/前端程式碼、後端變數、資料庫則是給開發時查閱對應到哪個符號用的。避免同一個東西在對話、畫面、程式碼、資料庫裡各自用不同名字。

新增/修改用語時，同步更新對應程式碼裡的註解用詞，並檢查畫面上顯示的文字是否已對齊「介面用語」這欄（不需要為了對齊這份文件而重新命名變數本身，除非變數名稱本身就是造成混淆的原因）。

## 桌面版三段式版面

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 功能列 | （無文字，純圖示列） | `DesktopRail`（`DesktopLayout.tsx`）／class `.desktop-rail` | — | — |
| 側欄 | （無獨立標題，依分頁各自顯示標題） | class `.desktop-sidepanel`（`DesktopLayout.tsx`） | — | — |
| 主顯示 | （無獨立標題） | class `.desktop-main`（`DesktopLayout.tsx`） | — | — |

規劃分頁（`panelMode === 'geo-outline'`）額外會在主顯示（地圖）左右兩側各漂浮一塊獨立卡片，不算在上面三段式的任何一段裡，也不佔用 flex 版面空間、不壓縮主顯示的可用寬度：

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 第二側欄 | 從候選加入 · {日期} | `AddFromCandidateSidebar`（`web/src/AddFromCandidateSidebar.tsx`）／class `.add-from-candidate-sidebar`（`web/src/styles-desktop.css`） | — | — |
| 飯店/附近推薦清單 | （依分頁顯示「飯店」／附近推薦類別名，如「餐廳」） | `GeoHotelSidebar`（`web/src/GeoHotelSidebar.tsx`）／class `.geo-hotel-sidebar-wrap`（`web/src/styles-desktop.css`） | — | — |

兩者都是絕對定位疊在主顯示（`.desktop-main`）之上的漂浮卡片（四周留間距、圓角＋陰影），不是版面裡緊鄰的一欄——第二側欄疊在主顯示左緣，飯店/附近推薦清單疊在主顯示右緣。第二側欄由側欄（候選籃，`GeoCandidateSidebar`）內「已排入行程」每個日期分組標題列的「從候選加入」按鈕觸發；候選中清單（hotel/place/退回候選的 entry）已整個搬進第二側欄顯示，候選籃側欄本身只顯示「已排入行程」。飯店/附近推薦清單只在使用者觸發過查詢（點類別標籤／地標／「搜尋這個區域」）後才出現。

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
| 景點區域 | （地圖上以光暈＋標籤呈現，無獨立分頁；點擊開啟地點介紹卡片） | `GeoAttraction` / `attractions` / `setAttractions`（`web/src/GeoOutlineMap.tsx`）／地點介紹卡片 `AttractionInfoPanel`（`web/src/AttractionInfoPanel.tsx`） | `model.Attraction` / `attractionRow`（`server/internal/store/entity.go`） | 表 `attractions` |
| 飯店（即時查詢） | 飯店 | `GeoHotel` / `hotels`（`web/src/api.ts`） | `geo.NearbyPlace`（`server/internal/geo/places.go`） | — |
| 附近推薦（即時查詢） | 附近推薦 | `GeoPlace` / `places`（`web/src/api.ts`） | `placeResponse`（`server/internal/api/geo_outline.go`） | — |

前端命名的改名已完成對齊（`GeoDistrict`/`districts` 等舊名稱已不存在）。景點區域原本在 `GeoHotelSidebar`（飯店/附近推薦清單）有一個「地點」分頁可瀏覽清單，已依需求整個移除；景點區域現在只能透過地圖上本來就會畫出的光暈／標籤瀏覽與點擊，不再提供獨立的文字清單入口。

**待辦**：`server/internal/geo/places.go` 內部仍沿用 `District`/`Landmark` 命名（尚未改名跟進 `Attraction`），屬於獨立待辦事項，尚未執行。

（待續——後續用語持續補充於此。）
