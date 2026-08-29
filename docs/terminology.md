# 系統用語對照表

定調系統內部各種概念的正式中文用語（左欄），對照到系統裡實際的命名——介面用語是使用者在畫面上實際看到的文字，之後 UI 上一律統一使用這欄的字，不要出現同義詞的變體；介面/前端程式碼、後端變數、資料庫則是給開發時查閱對應到哪個符號用的。避免同一個東西在對話、畫面、程式碼、資料庫裡各自用不同名字。

新增/修改用語時，同步更新對應程式碼裡的註解用詞，並檢查畫面上顯示的文字是否已對齊「介面用語」這欄（不需要為了對齊這份文件而重新命名變數本身，除非變數名稱本身就是造成混淆的原因）。

**旅程／行程的區分**（v0.8.0 起）：「行程」曾經同時代表兩種不同概念，造成混淆——現已釐清：

- **旅程**：`Trip` 實體本身，即「選哪一趟旅行」（例如「東京五日遊」這整趟）。對應旅程列表（選擇/建立/管理旅程）、旅程設定彈窗等畫面。程式碼變數/型別（`Trip`／`activeTrip`／`tripID`／`TripRole` 等）維持英文不變，只有畫面上的中文字與註解改稱「旅程」。
- **行程**：一趟旅程「裡面」的日層架排程內容（哪天排了哪些地點）。對應候選籃側欄（`GeoCandidateSidebar`，標題「行程」）、「加入行程」按鈕、「已排入行程」等畫面/文案。

判斷原則：指「哪一趟」時用旅程，指「排了什麼」時用行程。

## 桌面版版面

桌面版**沒有常駐對話欄**：對話（`ChatScreen`）只透過地圖右上角搜尋框旁的 AI 按鈕以浮動小匡形式開啟，不佔用版面空間、不推擠地圖寬度。除了功能列／主顯示這組版面骨架，其餘全部是絕對定位疊在主顯示（`.desktop-main`）之上的漂浮卡片（四周留間距、圓角＋陰影，共用外殼元件 `FloatingPanel`／`PanelHead`，見 `web/src/components/FloatingPanel.tsx`／`web/src/components/PanelHead.tsx`），左緣一組、右緣一組，各自互斥顯示（同一側同時只會有一張）：

| 正式用語 | 定位 | 介面用語（畫面顯示文字） | 介面/前端程式碼 |
|---|---|---|---|
| 功能列 | 版面骨架 | 無文字，純圖示列；展開時每顆按鈕旁顯示文字標籤；展開/收合按鈕 tooltip「展開導覽列」／「收合導覽列」 | `DesktopRail`（`DesktopRail.tsx`）／class `.desktop-rail`，內部 `expanded` state 控制寬度 48px↔180px，由列表最上方的 `PanelLeft` 圖示按鈕切換，與對話功能無關 |
| 主顯示 | 版面骨架 | 無獨立標題，固定顯示規劃地圖 | class `.desktop-main`（`DesktopLayout.tsx`），固定顯示 `GeoOutlinePanel` |
| 對話按鈕 | 城市搜尋框膠囊左側 | tooltip／aria-label「開啟對話」 | `GeoOutlineMap.tsx`，`Sparkles` 圖示按鈕，僅在 `onOpenChat` 存在時渲染 |
| 城市搜尋框 | 地圖右上角，`top:16px; right:16px` | 輸入框＋搜尋按鈕（icon，`Search`/`Loader2`，非文字） | class `.citySearch`（`GeoOutlineMap.tsx`），跟分類標籤（飯店/景點/餐廳）列彼此獨立、不共用同一行 |
| 旅程列表／時間軸／配速表／行程 | 左緣，`.floating-panel-left`，寬度取自 `PANEL_REGISTRY[panelMode].width` | 依 `panelMode` 顯示：「旅程列表」（標題橫條）／「時間軸」（標題橫條）／配速表內容（無標題橫條）／「行程」（標題橫條）；共用關閉按鈕 tooltip「關閉」 | `trips→DesktopTripList`／`timeline→MultiTrackTimeline`（包在 `desktop-timeline-panel`）／`pace→PaceChart`／`geo-outline→GeoCandidateSidebar`（`DesktopLayout.tsx`），四種互斥、由 `panelMode` 決定 |
| 第二側欄 | 左緣，`.floating-panel-left`，與上一列互斥（`pickingDayKey` 有值時優先顯示） | 「從候選加入 · {日期}」 | `AddFromCandidateSidebar`（`web/src/geo-planning/AddFromCandidateSidebar.tsx`），由行程「已排入行程」日期分組標題列的「從候選加入」按鈕觸發 |
| 搜尋結果清單 | 右緣，`.floating-panel-right`，`right:12px`，寬度 280px | 標題「搜尋結果」；飯店/推薦地點/搜尋結果（geocode）三種來源合併成單一清單，不分頁、不分段小標題 | `GeoHotelSidebar`（`web/src/geo-planning/GeoHotelSidebar.tsx`），結果型別統一為 `GeoSearchResult`（見下方「地理輪廓底圖」一節），只在觸發過查詢（點類別標籤／地標／「搜尋這個區域」／城市搜尋框）後才出現 |
| 地點介紹卡 | 右緣，`top:64px`，避開常駐搜尋框；與下一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角；「加入行程」按鈕（不串上旅程名稱） | `GeoInfoPanel`（`web/src/geo-planning/GeoInfoPanel.tsx`），飯店/推薦地點/搜尋結果/Google 原生 POI／行程候選項目共用；日期選擇改用 `DatePickerPopover`（`react-day-picker` 月曆浮動匡） |
| 景點區域介紹卡 | 右緣，`top:64px`；與上一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角；「探索周邊」按鈕 | `AttractionInfoPanel`（`web/src/geo-planning/AttractionInfoPanel.tsx`） |
| 對話小匡 | 右緣，`right:16px`，寬度 340px | 無標題橫條；不需先選旅程即可使用，尚無訊息時顯示簡短引導「在下方輸入，開始對話。」；關閉按鈕 tooltip「關閉」 | class `.chat-popover`（`DesktopLayout.tsx`），`FloatingPanel` 永遠掛載、只用 `.chatPopoverHidden`（`display:none`）依 `chatPopoverOpen` 隱藏，避免每次開關重新掛載 `ChatScreen`、重新連線 WebSocket；由對話按鈕觸發 |
| 旅程設定彈窗 | 置中彈窗（`.rp-modal`），由旅程列表項目觸發 | 標題「旅程設定 · {旅程名}」；含「開啟時自動進入」開關／公開連結／成員管理三個區塊，各區塊間以留白色塊分隔 | `TripManageModal`（`web/src/trip/TripManageModal.tsx`），由 `DesktopTripList` 每筆項目的管理按鈕觸發 |

右緣同時有 `GeoHotelSidebar`／對話小匡、以及地點介紹卡或景點區域介紹卡時，介紹卡透過 `shiftBy: 'none' | 'hotel' | 'chat'` 往左避讓（見 `DesktopLayout.tsx` 的 `infoPanelShiftBy`；對話小匡較寬，兩者同時存在時優先避開對話小匡，不疊加偏移量）。

## 手機版

`PhoneNavDrawer`（精簡版側滑抽屜）已整個移除——分享／成員／開啟時自動進入合併進 `TripManageModal`，入口移到旅程列表每筆項目的「管理」按鈕；使用者頭像改為直接開啟設定畫面。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 主顯示（規劃地圖） | 無獨立標題，固定顯示規劃地圖 | `GeoOutlinePhoneView`（`web/src/geo-planning/GeoOutlinePhoneView.tsx`），唯一常駐主畫面，不再有可切換的分頁模式（規劃地圖已不再有獨立 feature flag，見下方「地理輪廓底圖」一節） | — | — |
| 底部導覽列 | 「旅程列表」按鈕 tooltip；「對話」按鈕 tooltip | 螢幕下緣常駐的分頁列（旅程／對話，各自獨立開關疊加層，不是互斥分頁）；`PhoneTabBar`（`PhoneTabBar.tsx`），不需開抽屜即可見 | — | — |
| 旅程列表抽屜 | 標題「旅程列表」 | `PhoneTripsDrawer`（`web/src/trip/PhoneTripsDrawer.tsx`），由底部導覽列「旅程」按鈕開關，每筆項目的「管理」按鈕開啟 `TripManageModal` | — | — |
| 對話疊加層 | 標題為旅程名稱（未選旅程時顯示「Tripace」） | `PhoneContent.tsx` 內建的 `PhoneBottomSheet`，由底部導覽列「對話」按鈕開關（`chatSheetOpen`）；`ChatScreen` 永遠掛載、透過 React Portal 投影進疊加層內部的投影目標容器，關閉時不卸載，避免 WebSocket 重新連線；不需先選旅程即可使用 | — | — |
| 配速表疊加層 | 標題為旅程名稱（未選旅程時顯示「Tripace」） | `PhoneContent.tsx` 內建的 `PhoneBottomSheet`，由右側工具列「路徑」按鈕開關（`paceSheetOpen`），內嵌 `PaceRouteMap`；跟對話不同，關閉時直接卸載（無需保持連線） | — | — |
| 右側工具列 | （無文字，純圖示列） | 疊在畫面右下角的路徑／demo-* 小圖示群組；`PhoneSideTools`（`PhoneSideTools.tsx`），每個項目自帶 `onClick`（不再是統一切換分頁模式） | — | — |
| 規劃地圖清單抽屜 | 標題「地點」 | `GeoOutlinePhoneListDrawer`（`web/src/geo-planning/GeoOutlinePhoneListDrawer.tsx`），飯店/推薦地點/搜尋結果三種來源合併成單一清單（同桌面版 `GeoHotelSidebar`，不分頁），由規劃地圖畫面的清單按鈕開啟；觸發搜尋的同一刻即開啟並顯示載入中，不等查詢結果回來才開啟 | — | — |
| 地點介紹卡（手機版） | 由下往上滑入的 bottom sheet；「加入行程」按鈕 | `GeoOutlinePhoneInfoSheet`（`web/src/geo-planning/GeoOutlinePhoneInfoSheet.tsx`），未選定旅程時按「加入行程」會先引導切到旅程列表（`onOpenTrips`） | — | — |
| 設定面板 | 設定 | `SettingsScreen`（`user/SettingsScreen.tsx`，改用共用容器 `PhoneBottomSheet`）／桌面版 `SettingsDialog`（`user/SettingsDialog.tsx`） | — | — |

手機版 bottom sheet（旅程列表／對話／配速表／設定／規劃地圖清單抽屜／地點介紹卡）共用同一個外殼元件 `PhoneBottomSheet`（`web/src/components/PhoneBottomSheet.tsx`）——不區分模式，統一用 `snapPoints`（由大到小排序的「離螢幕頂部距離」陣列，單位 px）＋選填的 `minHeightPx`（收合段的固定高度）決定能滑到哪些段落、段落分別在哪：只給一個 `snapPoints` 值時退化成固定高度＋只能拖到底關閉；給多個值（或額外帶 `minHeightPx`）時在各段之間拖曳吸附。標題列共用 `SheetHead`（標題文字＋關閉鈕）。

## 資料模型

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 旅程 | 旅程 | `Trip` / `TripRole`（`web/src/types.ts`，型別/變數名稱維持英文不變） | `model.Trip` / `tripRow`（`server/internal/store/entity.go`） | 表 `trips` |
| 地點 | 地點 | `Entry`（`web/src/types.ts`） | `entryRow`（`server/internal/store/entity.go`） | 表 `entries` |
| 時間軸 | 時間軸 | `MultiTrackTimeline`（`web/src/timeline/Timeline.tsx`） | — | — |
| 路徑（配速表介面） | 配速表 | `PaceRouteMap`（`web/src/pace/PaceRouteMap.tsx`） | — | — |

## 地理輪廓底圖

**景點區域**：具觀光吸引力的地點或區域，人工建檔、依知名程度分 1～5 級（1 級如國際知名地標「101」，5 級如在地商圈「永康商圈」）。可以是單點地標（`radiusMeters` 為 0）也可以是有範圍的區域（如「古城區」），不拆成兩個型別，用同一個符號涵蓋兩種情況。正式用語定為「景點區域」，程式碼命名統一用 `Attraction`。

**搜尋結果**：地圖拖曳/縮放/搜尋時，即時打 Google Places API 查回來的資料，非人工建檔、無知名度分級，僅在被查詢的當下存在，隨查詢範圍變動而變動。跟「景點區域」是完全不同的兩種資料來源，不應共用命名。v0.8.0 起，飯店（原 `GeoHotel`/`hotels`）、附近推薦（原 `GeoPlace`/`places`）、搜尋候選（原 `GeoGeocodeCandidate`/`geocodeCandidates`）三種來源統一轉成單一型別 `GeoSearchResult`（`kind: 'hotel' | 'place' | 'geocode'` 判別欄位），前端清單/marker 圖層/選取邏輯共用同一份，不再各自維護三組平行的 state 與 callback（原本的 `onVisibleHotelsChange`/`onPlacesNearby`/`onHotelSelect`/`onPlaceSelect`/`onGeocodeCandidateSelect` 等已移除，合併為 `onSearchResultsChange`/`onSearchResultSelect`）。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 景點區域 | （地圖上以光暈＋標籤呈現，無獨立分頁；點擊開啟景點區域介紹卡片） | `GeoAttraction` / `attractions`（`web/src/geo-planning/GeoOutlineMap.tsx`）／`AttractionInfoPanel`（`web/src/geo-planning/AttractionInfoPanel.tsx`） | `model.Attraction` / `attractionRow`（`server/internal/store/entity.go`） | 表 `attractions` |
| 搜尋結果（統一型別） | 依來源分類但同一份清單，不分頁：飯店／附近推薦類別名（如「餐廳」）／搜尋結果（geocode） | `GeoSearchResult`（`web/src/api.ts`，`kind` 判別欄位）／`GeoHotelSidebar`（桌面）／`GeoOutlinePhoneListDrawer`（手機）／共用卡片元件 `GeoListItemCard`（`web/src/geo-planning/GeoListItemCard.tsx`） | `geo.NearbyPlace`（飯店/附近推薦，`server/internal/geo/places.go`）／`placeResponse`（`server/internal/api/geo_outline.go`） | — |

前端命名的改名已完成對齊（`GeoDistrict`/`districts` 等舊名稱已不存在）。景點區域原本在 `GeoHotelSidebar`（飯店/附近推薦清單）有一個「地點」分頁可瀏覽清單，已依需求整個移除；景點區域現在只能透過地圖上本來就會畫出的光暈／標籤瀏覽與點擊，不再提供獨立的文字清單入口。

規劃地圖已不再有獨立 feature flag（原 `GEO_OUTLINE_ENABLED`/`VITE_FEATURE_GEO_OUTLINE` 已整個移除）——已是核心功能，`DesktopRail` 的「規劃」按鈕、手機版 `GeoOutlinePhoneView` 主畫面固定顯示，不受部署環境變數控制。

**待辦**：`server/internal/geo/places.go` 內部仍沿用 `District`/`Landmark` 命名（尚未改名跟進 `Attraction`），屬於獨立待辦事項，尚未執行。

（待續——後續用語持續補充於此。）
