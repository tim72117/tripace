# 系統用語對照表

定調系統內部各種概念的正式中文用語（左欄），對照到系統裡實際的命名——介面用語是使用者在畫面上實際看到的文字，之後 UI 上一律統一使用這欄的字，不要出現同義詞的變體；介面/前端程式碼、後端變數、資料庫則是給開發時查閱對應到哪個符號用的。避免同一個東西在對話、畫面、程式碼、資料庫裡各自用不同名字。

新增/修改用語時，同步更新對應程式碼裡的註解用詞，並檢查畫面上顯示的文字是否已對齊「介面用語」這欄（不需要為了對齊這份文件而重新命名變數本身，除非變數名稱本身就是造成混淆的原因）。

## 桌面版版面

桌面版**沒有常駐對話欄**：對話（`ChatScreen`）只透過地圖右上角搜尋框旁的 AI 按鈕以浮動小匡形式開啟，不佔用版面空間、不推擠地圖寬度。除了功能列／主顯示這組版面骨架，其餘全部是絕對定位疊在主顯示（`.desktop-main`）之上的漂浮卡片（四周留間距、圓角＋陰影），左緣一組、右緣一組，各自互斥顯示（同一側同時只會有一張）：

| 正式用語 | 定位 | 介面用語（畫面顯示文字） | 介面/前端程式碼 |
|---|---|---|---|
| 功能列 | 版面骨架 | 無文字，純圖示列；展開時每顆按鈕旁顯示文字標籤；展開/收合按鈕 tooltip「展開導覽列」／「收合導覽列」 | `DesktopRail`（`DesktopRail.tsx`）／class `.desktop-rail`，內部 `expanded` state 控制寬度 48px↔180px，由列表最上方的 `PanelLeft` 圖示按鈕切換，與對話功能無關 |
| 主顯示 | 版面骨架 | 無獨立標題，固定顯示規劃地圖 | class `.desktop-main`（`DesktopLayout.tsx`），固定顯示 `GeoOutlinePanel` |
| 對話按鈕 | 城市搜尋框膠囊左側 | tooltip／aria-label「開啟對話」 | `GeoOutlineMap.tsx`，`Sparkles` 圖示按鈕，僅在 `onOpenChat` 存在時渲染 |
| 城市搜尋框 | 地圖右上角，`top:16px; right:16px` | 輸入框＋搜尋按鈕（icon，`Search`/`Loader2`，非文字） | class `.citySearch`（`GeoOutlineMap.tsx`），跟分類標籤（飯店/景點/餐廳）列彼此獨立、不共用同一行 |
| 行程列表／時間軸／配速表／候選籃 | 左緣，`.floating-panel-left`，寬度取自 `PANEL_REGISTRY[panelMode].width` | 依 `panelMode` 顯示：「行程」（無標題橫條）／「時間軸」（標題橫條）／配速表內容（無標題橫條）／「候選籃」（標題橫條）；共用關閉按鈕 tooltip「關閉」 | `trips→DesktopTripList`／`timeline→MultiTrackTimeline`（包在 `desktop-timeline-panel`）／`pace→PaceChart`／`geo-outline→GeoCandidateSidebar`（`DesktopLayout.tsx`），四種互斥、由 `panelMode` 決定 |
| 第二側欄 | 左緣，`.floating-panel-left`，與上一列互斥（`pickingDayKey` 有值時優先顯示） | 「從候選加入 · {日期}」 | `AddFromCandidateSidebar`（`web/src/geo-planning/AddFromCandidateSidebar.tsx`），由候選籃「已排入行程」日期分組標題列的「從候選加入」按鈕觸發 |
| 飯店/附近推薦清單 | 右緣，`.floating-panel-right`，`right:12px`，寬度 280px | 依分頁顯示「飯店」／附近推薦類別名（如「餐廳」） | `GeoHotelSidebar`（`web/src/geo-planning/GeoHotelSidebar.tsx`），只在觸發過查詢（點類別標籤／地標／「搜尋這個區域」）後才出現 |
| 地點介紹卡 | 右緣，`top:64px`，避開常駐搜尋框；與下一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角 | `GeoInfoPanel`（`web/src/geo-planning/GeoInfoPanel.tsx`），飯店/推薦地點/Google 原生 POI／候選籃項目共用 |
| 景點區域介紹卡 | 右緣，`top:64px`；與上一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角；「探索周邊」按鈕 | `AttractionInfoPanel`（`web/src/geo-planning/AttractionInfoPanel.tsx`） |
| 對話小匡 | 右緣，`right:16px`，寬度 340px | 無標題橫條；不需先選行程即可使用，尚無訊息時顯示簡短引導「在下方輸入，開始對話。」；關閉按鈕 tooltip「關閉」 | class `.chat-popover`（`DesktopLayout.tsx`），由 `chatPopoverOpen` state 控制顯示，內嵌 `ChatScreen`（`trip` prop 未選行程時不傳），由對話按鈕觸發 |
| 行程設定彈窗 | 置中彈窗（`.rp-modal`），由行程列表項目觸發 | 標題「行程設定 · {行程名}」；含「開啟時自動進入」開關／公開連結／成員管理三個區塊，各區塊間以留白色塊分隔 | `TripManageModal`（`web/src/trip/TripManageModal.tsx`），由 `DesktopTripList` 每筆項目的管理按鈕觸發，取代原本掛在對話小匡上的分享／成員按鈕與「設為開啟時自動進入」選單 |

右緣同時有 `GeoHotelSidebar`／對話小匡、以及地點介紹卡或景點區域介紹卡時，介紹卡透過 `shiftBy: 'none' | 'hotel' | 'chat'` 往左避讓（見 `DesktopLayout.tsx` 的 `infoPanelShiftBy`；對話小匡較寬，兩者同時存在時優先避開對話小匡，不疊加偏移量）。

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

## 地理輪廓底圖

**景點區域**：具觀光吸引力的地點或區域，人工建檔、依知名程度分 1～5 級（1 級如國際知名地標「101」，5 級如在地商圈「永康商圈」）。可以是單點地標（`radiusMeters` 為 0）也可以是有範圍的區域（如「古城區」），不拆成兩個型別，用同一個符號涵蓋兩種情況。正式用語定為「景點區域」，程式碼命名統一用 `Attraction`。

**即時查詢資料**：地圖拖曳/縮放時，即時打 Google Places API 查回來的資料（如飯店 `GeoHotel`/`hotels`、附近推薦 `GeoPlace`/`places`），非人工建檔、無知名度分級，僅在被查詢的當下存在，隨查詢範圍變動而變動。跟「景點區域」是完全不同的兩種資料來源，不應共用命名。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 景點區域 | （地圖上以光暈＋標籤呈現，無獨立分頁；點擊開啟地點介紹卡片） | `GeoAttraction` / `attractions` / `setAttractions`（`web/src/geo-planning/GeoOutlineMap.tsx`）／地點介紹卡片 `AttractionInfoPanel`（`web/src/geo-planning/AttractionInfoPanel.tsx`） | `model.Attraction` / `attractionRow`（`server/internal/store/entity.go`） | 表 `attractions` |
| 飯店（即時查詢） | 飯店 | `GeoHotel` / `hotels`（`web/src/api.ts`） | `geo.NearbyPlace`（`server/internal/geo/places.go`） | — |
| 附近推薦（即時查詢） | 附近推薦 | `GeoPlace` / `places`（`web/src/api.ts`） | `placeResponse`（`server/internal/api/geo_outline.go`） | — |

前端命名的改名已完成對齊（`GeoDistrict`/`districts` 等舊名稱已不存在）。景點區域原本在 `GeoHotelSidebar`（飯店/附近推薦清單）有一個「地點」分頁可瀏覽清單，已依需求整個移除；景點區域現在只能透過地圖上本來就會畫出的光暈／標籤瀏覽與點擊，不再提供獨立的文字清單入口。

**待辦**：`server/internal/geo/places.go` 內部仍沿用 `District`/`Landmark` 命名（尚未改名跟進 `Attraction`），屬於獨立待辦事項，尚未執行。

（待續——後續用語持續補充於此。）
