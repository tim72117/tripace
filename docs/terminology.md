# 系統用語對照表

定調系統內部各種概念的正式中文用語（左欄），對照到系統裡實際的命名——介面用語是使用者在畫面上實際看到的文字，之後 UI 上一律統一使用這欄的字，不要出現同義詞的變體；介面/前端程式碼、後端變數、資料庫則是給開發時查閱對應到哪個符號用的。避免同一個東西在對話、畫面、程式碼、資料庫裡各自用不同名字。

新增/修改用語時，同步更新對應程式碼裡的註解用詞，並檢查畫面上顯示的文字是否已對齊「介面用語」這欄（不需要為了對齊這份文件而重新命名變數本身，除非變數名稱本身就是造成混淆的原因）。

**旅程／行程的區分**（v0.8.0 起）：「行程」曾經同時代表兩種不同概念，造成混淆——現已釐清：

- **旅程**：`Trip` 實體本身，即「選哪一趟旅行」（例如「東京五日遊」這整趟）。對應旅程列表（選擇/建立/管理旅程）、旅程設定彈窗等畫面。程式碼變數/型別（`Trip`／`activeTrip`／`tripID`／`TripRole` 等）維持英文不變，只有畫面上的中文字與註解改稱「旅程」。
- **行程**：一趟旅程「裡面」的日層架排程內容（哪天排了哪些地點）。對應行程側欄（`CandidateList`，`web/src/geo-planning/desktop/CandidateList.tsx`，標題「行程」，現在只顯示「已排入行程」項目，不再有候選中清單）、「加入行程」按鈕、「已排入行程」等畫面/文案。

判斷原則：指「哪一趟」時用旅程，指「排了什麼」時用行程。

## 桌面版版面

桌面版**沒有常駐對話欄**：對話（`planning/panel/TripPlanPage.tsx`，onagent `plan-ai-timeline`）只透過地圖右上角搜尋框旁的 AI 按鈕以浮動小匡形式開啟，不佔用版面空間、不推擠地圖寬度。除了功能列／主顯示這組版面骨架，其餘全部是絕對定位疊在主顯示（`.desktop-main`）之上的漂浮卡片（四周留間距、圓角＋陰影，共用外殼元件 `FloatingPanel`／`PanelHead`，見 `web/src/components/FloatingPanel.tsx`／`web/src/components/PanelHead.tsx`），左緣一組、右緣一組，各自互斥顯示（同一側同時只會有一張）：

| 正式用語 | 定位 | 介面用語（畫面顯示文字） | 介面/前端程式碼 |
|---|---|---|---|
| 功能列 | 版面骨架 | 無文字，純圖示列；展開時每顆按鈕旁顯示文字標籤；展開/收合按鈕 tooltip「展開導覽列」／「收合導覽列」 | `Nav`（`desktop/Nav.tsx`，`desktop/Content.tsx` 以別名 `DesktopNav` 引用）／class `.desktop-rail`，內部 `expanded` state 控制寬度 48px↔180px，由列表最上方的 `PanelLeft` 圖示按鈕切換，與對話功能無關 |
| 主顯示 | 版面骨架 | 無獨立標題，固定顯示規劃地圖 | class `.desktop-main`（`desktop/Content.tsx`），固定顯示規劃地圖 `PlanMap`（`geo-planning/PlanMap.tsx`；原 `GeoOutlinePanel` 元件已刪除，只剩 `GeoOutlinePanel.module.css` 樣式檔） |
| 對話按鈕 | 城市搜尋框膠囊左側 | tooltip／aria-label「開啟對話」 | `ExploreMap.tsx`，`Sparkles` 圖示按鈕，僅在 `onOpenChat` 存在時渲染 |
| 城市搜尋框 | 地圖右上角，`top:16px; right:16px` | 輸入框＋搜尋按鈕（icon，`Search`/`Loader2`，非文字） | class `.citySearch`（`ExploreMap.tsx`），跟分類標籤（飯店/景點/餐廳）列彼此獨立、不共用同一行 |
| 旅程列表／時間軸／行程 | 左緣，`.floating-panel-left`，寬度取自 `PANEL_REGISTRY[panelMode].width` | 依 `panelMode` 顯示：「旅程列表」（標題橫條）／「時間軸」（標題橫條）／「行程」（標題橫條，僅顯示「已排入行程」項目，不再有候選中清單）；共用關閉按鈕 tooltip「關閉」 | `trips→TripList`（`trip/desktop/TripList.tsx`）／`timeline→MultiTrackTimeline`（包在 `desktop-timeline-panel`）／`geo-outline→CandidateList`（`geo-planning/desktop/CandidateList.tsx`；以上皆在 `desktop/Content.tsx` 以 `DesktopTripList`／`DesktopCandidateList` 別名引用），四種互斥、由 `panelMode` 決定 |
| 搜尋結果清單 | 右緣，`.floating-panel-right`，`right:12px`，寬度 280px | 標題「搜尋結果」；飯店/推薦地點/搜尋結果（geocode）三種來源合併成單一清單，不分頁、不分段小標題 | `ResultList`（`web/src/geo-planning/desktop/ResultList.tsx`，`desktop/Content.tsx` 以別名 `DesktopResultList` 引用），結果型別統一為 `GeoSearchResult`（見下方「地理輪廓底圖」一節），只在觸發過查詢（點類別標籤／地標／「搜尋這個區域」／城市搜尋框）後才出現 |
| 地點介紹卡 | 右緣，`top:64px`，避開常駐搜尋框；與下一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角；「加入行程」按鈕（不串上旅程名稱） | `PlacePanel`（`web/src/geo-planning/PlacePanel.tsx`），飯店/推薦地點/搜尋結果/Google 原生 POI／行程候選項目／非主題點 attraction 共用；日期選擇改用 `DatePickerPopover`（`react-day-picker` 月曆浮動匡） |
| 主題介紹卡 | 右緣，`top:64px`；與上一列互斥 | 無標題橫條；關閉按鈕懸浮於卡片頂部照片右上角；「附近景點」清單 | `AttractionInfoPanel`（`web/src/geo-planning/AttractionInfoPanel.tsx`），只有主題點（`isTheme`／`level===1`）點擊才開這張卡，非主題點改開地點介紹卡（見下方「地理輪廓底圖」一節） |
| 對話小匡 | 右緣透明側欄，寬度 560px，貼齊右緣、上下撐滿 | 無標題橫條；不需先選旅程即可使用，尚無訊息時顯示簡短引導「在下方輸入，開始對話。」；關閉按鈕 tooltip「關閉」 | `desktop/Content.tsx` 渲染 `desktop/PlanOverlayLayout`（與 /ai-plan、登入後手機版同名同層級，共用 `OverlayShell` 的 `data-slot` 骨架：地圖在 map-layer、`PlanPanelContent` 在 panel、輸入列在 composer-slot；2026-10 取代原本的 `FloatingPanel` + `.chatPopover`），永遠掛載、用 `hidden` 依 `chatPopoverVisible` 隱藏 overlay，避免每次開關重新掛載、重新連線 WebSocket；搜尋結果側欄同時顯示時 `shifted` 往左推；由對話按鈕觸發 |
| 旅程設定彈窗 | 置中彈窗（`.rp-modal`），由旅程列表項目觸發 | 標題「旅程設定 · {旅程名}」；含「開啟時自動進入」開關／公開連結／成員管理三個區塊，各區塊間以留白色塊分隔 | `TripManageModal`（`web/src/trip/TripManageModal.tsx`），由 `trip/desktop/TripList.tsx` 的 `TripList` 每筆項目的管理按鈕觸發 |

右緣同時有 `ResultList`（`geo-planning/desktop/ResultList.tsx`）／對話小匡、以及地點介紹卡或主題介紹卡時，介紹卡透過 `shiftBy: 'none' | 'hotel' | 'chat'` 往左避讓（見 `desktop/Content.tsx` 的 `infoPanelShiftBy`；對話小匡較寬，兩者同時存在時優先避開對話小匡，不疊加偏移量）。主題介紹卡開啟時，點擊地圖上的非主題點景點或 Google POI，會改在主題介紹卡左側並存顯示第二張地點介紹卡（不關閉主題介紹卡），共用外框元件 `DesktopInfoCard`（`web/src/geo-planning/DesktopInfoCard.tsx`）。

（已移除）原第二側欄 `AddFromCandidateSidebar`（從候選加入 · 日期），現改為選地點後直接彈出日期選擇、加入時間軸。

## 手機版

`PhoneNavDrawer`（精簡版側滑抽屜）已整個移除——分享／成員／開啟時自動進入合併進 `TripManageModal`，入口移到旅程列表每筆項目的「管理」按鈕；使用者頭像改為直接開啟設定畫面。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 主顯示（規劃地圖） | 無獨立標題，固定顯示規劃地圖 | `PlanPhoneView`（`web/src/geo-planning/PlanPhoneView.tsx`），唯一常駐主畫面，不再有可切換的分頁模式（規劃地圖已不再有獨立 feature flag，見下方「地理輪廓底圖」一節） | — | — |
| 底部導覽列 | 「行程」「探索」「規劃」三顆按鈕，icon 下方各自顯示文字標籤（直向排列） | 螢幕下緣常駐的分頁列，各項目各自獨立開關疊加層，不是互斥分頁；`Nav`（`phone/Nav.tsx`，`phone/Content.tsx` 以別名 `PhoneNav` 引用），不需開抽屜即可見。原「AI 規劃」已改名「規劃」；「探索」原本是地圖左上角的按鈕、「行程」原本是地圖左下角浮動按鈕群組的一員，兩者皆已搬到底部導覽列 | — | — |
| 旅程列表抽屜 | 標題「旅程列表」 | `TripList`（`web/src/trip/phone/TripList.tsx`，`phone/Content.tsx` 以別名 `PhoneTripList` 引用），由底部導覽列「行程」按鈕開關（尚未選定旅程時優先開啟此抽屜），每筆項目的「管理」按鈕開啟 `TripManageModal` | — | — |
| 對話疊加層 | 標題為旅程名稱（未選旅程時顯示「Tripace」） | `phone/Content.tsx` 內建的 `PhoneBottomSheet`，由底部導覽列「規劃」按鈕開關（`chatSheetOpen`）；對話內容（`TripPlanPage`）直接放在 `PhoneBottomSheet` 的 `children` 裡，搭配該元件的 `keepMounted` prop 讓它即使關閉也不卸載（只用位移隱藏），避免 WebSocket 重新連線——原本改用 React Portal 投影達到同樣效果，但 portal 內容在 React 元件樹上跟 `PhoneBottomSheet` 是平行兄弟節點、導致觸控事件無法冒泡到拖曳手勢，故已改用 `keepMounted` 取代；不需先選旅程即可使用 | — | — |
| 規劃地圖清單抽屜 | 標題「地點」 | `ResultList`（`web/src/geo-planning/phone/ResultList.tsx`），飯店/推薦地點/搜尋結果三種來源合併成單一清單（同桌面版 `geo-planning/desktop/ResultList.tsx`，不分頁）；觸發搜尋的同一刻即開啟並顯示載入中，不等查詢結果回來才開啟，但查到唯一解時清單不顯示、直接開啟地點介紹卡（見下一列） | — | — |
| 地點介紹卡（手機版） | 由下往上滑入的 bottom sheet；「加入行程」按鈕 | `PlanPhoneInfoSheet`（`web/src/geo-planning/PlanPhoneInfoSheet.tsx`），未選定旅程時按「加入行程」會先引導切到旅程列表（`onOpenTrips`）；候選沒有排定日期時「加入行程」改開獨立的日期選擇 bottom sheet（見下方「日期選擇 sheet」），不再是卡片內部展開的區塊 | — | — |
| 日期選擇 sheet（手機版） | 標題「選擇日期」；日期清單顯示既有排定日期＋「其他日期」按鈕；日曆為月曆格線 | 兩層獨立 bottom sheet：`PlanPhoneDatePickerSheet`（既有日期，直向可捲動清單）／`PlanPhoneDateCalendarSheet`（`DatePickerPopover` 月曆，同桌面版），行程完全沒有排定日期時跳過清單直接開日曆；由 `PlanPhoneView.tsx` 的 `sheetStack` 決定要開哪一層 | — | — |
| 設定面板 | 設定 | `SettingsScreen`（`user/SettingsScreen.tsx`，改用共用容器 `PhoneBottomSheet`）／桌面版 `SettingsDialog`（`user/SettingsDialog.tsx`） | — | — |

手機版 bottom sheet（旅程列表／對話／設定／規劃地圖清單抽屜／地點介紹卡／日期選擇 sheet）共用同一個外殼元件 `PhoneBottomSheet`（`web/src/components/PhoneBottomSheet.tsx`）——不區分模式，統一用 `snapPoints`（由大到小排序的「離螢幕頂部距離」陣列，單位 px）＋選填的 `minHeightPx`（收合段的固定高度）決定能滑到哪些段落、段落分別在哪：只給一個 `snapPoints` 值時退化成固定高度＋只能拖到底關閉；給多個值（或額外帶 `minHeightPx`）時在各段之間拖曳吸附。標題列共用 `SheetHead`（標題文字＋關閉鈕）。

規劃地圖清單抽屜／地點介紹卡／日期選擇 sheet 這四層可以同時疊放（例如清單→介紹卡→日期清單→日曆最多四層），開關統一由 `PlanPhoneView.tsx` 的 `sheetStack`（`useSheetStack`，`web/src/components/useSheetStack.ts`）以堆疊（`push`／`replace`／`pop`／`closeAll`）管理，不再各自用獨立的 `useState`/布林值決定顯示與否——非頂層的 sheet 仍掛載但套用退縮視覺、停用手勢（`isTopmost`／`stackOffsetPx`）。地點介紹卡往下拖曳或收合到最小段時，堆疊中下一層（清單）會連動縮到最小段（`forceCollapsed`），鬆手/展開後恢復。

## /ai-plan 展示頁三階段

`/ai-plan`（`planning/preview/Content.tsx`）、`/ai-plan/live`（`planning/preview/LiveContent.tsx`）與首頁/`/product` 的手機展示框，圍繞同一套「AI 排行程」敘事分成三個不同的畫面/狀態，彼此不是同一件事，容易在討論時混用——正式定調如下：

- **小展示**：首頁（`ScrollPlanDemo.tsx`）與 `/product` 功能介紹頁（`FeatureShowcase.tsx`）裡的手機外框展示（`AiPlanPhoneDemo.tsx` 包著 `AiPlanPhoneDemoScreen.tsx`），固定 390×844 尺寸、不接受真正互動（`pointer-events: none`，整支手機是連到 `/ai-plan` 的 `<Link>`）。讀同一份固定劇本（`planSimScript.ts`），但推進節奏依呼叫端而異：首頁用 `createPlanSimScrollSource`（捲動位置驅動），`/product` 用 `createPlanSimFakeSource`（計時器自動播完）。版面骨架是獨立的 `PhoneDemoLayout`（`web/src/home/PhoneDemoLayout.tsx`），不跟下面兩階段共用。
- **播放態**：`/ai-plan` 完整展示頁（`planning/preview/Content.tsx`），同樣播放 `planSimScript.ts` 固定劇本（用 `createPlanSimFakeSource`，計時器自動播完），但是整頁、允許地圖縮放拖曳、有真正的詢問框（`AskPage.tsx`）互動。版面骨架是 `PlanLayout`（`web/src/planning/preview/PlanLayout.tsx`），內部包著 `PlanOverlayPanel`。純模擬，不接真實 AI。
- **推論態**：獨立路由 `/ai-plan/live`（`planning/preview/LiveContent.tsx`）。使用者在播放態按下「讓我試看看」後 `navigate('/ai-plan/live')`（網址 search 經 `liveHandoverUrl.ts` 保留，`skipDemo` 除外），兩頁互不傳狀態（不再用 `handedOver` 在同一個元件內切換）。整頁掛載 `LivePlanLayer`（內部掛載 `/app` 正式頁的 `TripPlanPage`），接上真實 onagent AI 對話——**完全不讀 `planSimScript.ts`**，沒有固定劇本，是真正的即時推論。版面骨架仍是同一個 `PlanLayout`，只是 `passThrough` 模式。

判斷原則：講「固定劇本播放」時用小展示或播放態（依是否為整頁/可互動判斷是哪一個）；講「真實 AI 對話」時一律是推論態，三者不要混用同一個詞籠統帶過。

## 資料模型

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 旅程 | 旅程 | `Trip` / `TripRole`（`web/src/types.ts`，型別/變數名稱維持英文不變） | `model.Trip` / `tripRow`（`server/internal/store/entity.go`） | 表 `trips` |
| 地點 | 地點 | `Entry`（`web/src/types.ts`） | `entryRow`（`server/internal/store/entity.go`） | 表 `entries` |
| 時間軸 | 時間軸 | `MultiTrackTimeline`（`web/src/timeline/Timeline.tsx`） | — | — |
| 規劃旅程（前端） | 無獨立畫面（尚未有介面） | `PlanTrip`（`web/src/planning/trip/trips.ts`，索引存 `localStorage` 的 `tripace.planTrips`；`useTrips` hook 訂閱）。一趟規劃的容器：id、使用者取的名稱、自動標題、建立/最後編輯時間，底下掛一份規劃時間軸 `PlanTimeline`（天、站點、住宿，見 `planning/timeline/model.ts`）。與上面的「旅程」（後端 `Trip`、團隊協作）刻意分開、不接後端，之後整合再決定對應；第一次讀取時從舊的草稿索引與固定 key 那份行程播種，不改寫舊資料 | — | — |

## 地理輪廓底圖

**景點區域**：具觀光吸引力的地點或區域，人工建檔、依知名程度分 1～5 級（1 級如國際知名地標「101」，5 級如在地商圈「永康商圈」）。可以是單點地標（`radiusMeters` 為 0）也可以是有範圍的區域（如「古城區」），不拆成兩個型別，用同一個符號涵蓋兩種情況。正式用語定為「景點區域」，程式碼命名統一用 `Attraction`。

**主題點／精選點**：散策羅盤點擊行為的分級——主題點是使用者點開後會揭露周邊「精選點」的錨點，點擊開啟**主題介紹卡**（`AttractionInfoPanel`）；精選點預設不在地圖上顯示，只有其對應的主題點被開啟時才依距離揭露，點擊開啟**地點介紹卡**（`PlacePanel`，即打 Google Place Details 顯示的那種，跟飯店/推薦地點/Google 原生 POI 共用同一種卡片）。以 `model.Attraction.IsTheme`（新增欄位，與 `Level` 並存不取代）判斷，見 `attractionGlowLayer.ts`／`geoAttractionOverlay.ts` 的 `isTheme`。

**搜尋結果**：地圖拖曳/縮放/搜尋時，即時打 Google Places API 查回來的資料，非人工建檔、無知名度分級，僅在被查詢的當下存在，隨查詢範圍變動而變動。跟「景點區域」是完全不同的兩種資料來源，不應共用命名。v0.8.0 起，飯店（原 `GeoHotel`/`hotels`）、附近推薦（原 `GeoPlace`/`places`）、搜尋候選（原 `GeoGeocodeCandidate`/`geocodeCandidates`）三種來源統一轉成單一型別 `GeoSearchResult`（`kind: 'hotel' | 'place' | 'geocode'` 判別欄位），前端清單/marker 圖層/選取邏輯共用同一份，不再各自維護三組平行的 state 與 callback（原本的 `onVisibleHotelsChange`/`onPlacesNearby`/`onHotelSelect`/`onPlaceSelect`/`onGeocodeCandidateSelect` 等已移除，合併為 `onSearchResultsChange`/`onSearchResultSelect`）。

| 正式用語 | 介面用語（畫面顯示文字） | 介面/前端程式碼 | 後端變數 | 資料庫 |
|---|---|---|---|---|
| 景點區域 | （地圖上以光暈＋標籤呈現，無獨立分頁；點擊開啟主題介紹卡或地點介紹卡，見下方說明） | `GeoAttraction` / `attractions`（`web/src/geo-planning/ExploreMap.tsx`）／`AttractionInfoPanel`／`PlacePanel`（`web/src/geo-planning/`） | `model.Attraction` / `attractionRow`（`server/internal/store/entity.go`） | 表 `attractions` |
| 搜尋結果（統一型別） | 依來源分類但同一份清單，不分頁：飯店／附近推薦類別名（如「餐廳」）／搜尋結果（geocode） | `GeoSearchResult`（`web/src/api.ts`，`kind` 判別欄位）／`geo-planning/desktop/ResultList.tsx`（桌面）／`geo-planning/phone/ResultList.tsx`（手機）／共用卡片元件 `ListItemCard`（`web/src/components/ListItemCard.tsx`，全專案通用，不限定 geo-planning；props 改名為 `leading`/`trailing`/`badge`/`loadKey`/`onLoadPhoto`，取代舊的 `photoUrl`/`placeId`/`onPhotoLoaded`/`addSlot`/`badgeSlot`，並解除對 `ClientConfig`/`fetchGeoPlacePhoto` 的耦合——照片延遲載入邏輯抽成可選的 `useLazyPhotoObserver`/`PhotoLeading` 輔助元件，呼叫端自行決定要不要用） | `geo.NearbyPlace`（飯店/附近推薦，`server/internal/geo/places.go`）／`placeResponse`（`server/internal/api/geo_outline.go`） | — |

前端命名的改名已完成對齊（`GeoDistrict`/`districts` 等舊名稱已不存在）。景點區域原本在桌面版 `ResultList`（`geo-planning/desktop/ResultList.tsx`，飯店/附近推薦清單）有一個「地點」分頁可瀏覽清單，已依需求整個移除；景點區域現在只能透過地圖上本來就會畫出的光暈／標籤瀏覽與點擊，不再提供獨立的文字清單入口。

規劃地圖已不再有獨立 feature flag（原 `GEO_OUTLINE_ENABLED`/`VITE_FEATURE_GEO_OUTLINE` 已整個移除）——已是核心功能，`desktop/Nav.tsx` 的「規劃」按鈕、手機版 `PlanPhoneView`（`geo-planning/PlanPhoneView.tsx`）主畫面固定顯示，不受部署環境變數控制。

**待辦**：`server/internal/geo/places.go` 內部仍沿用 `District`/`Landmark` 命名（尚未改名跟進 `Attraction`），屬於獨立待辦事項，尚未執行。

（待續——後續用語持續補充於此。）
