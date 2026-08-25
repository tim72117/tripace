# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.8.0 — 2026-08-26

### 破壞性變更

- **地理規劃地圖飯店/地點/搜尋結果三種來源統一為單一資料流 `GeoSearchResult`**（`GeoOutlineMap.tsx`、`GeoOutlinePanel.tsx`、`GeoHotelSidebar.tsx`、`GeoOutlinePhoneListDrawer.tsx`、`geoInfoContent.ts`）：原本各自獨立的 `onVisibleHotelsChange`/`onPlacesNearby`/`onHotelSelect`/`onPlaceSelect`/`onGeocodeCandidateSelect` 等 callback 全部移除，合併為 `onSearchResultsChange`/`onSearchResultSelect`；`GeoHotelSidebar.tsx` 匯出的 `Tab` 型別與雙分頁切換（`onSelectHotel`/`onSelectPlace`）一併移除，改為單一合併清單搭配 `onSelect`；`geoInfoContent.ts` 的 `hotelInfoContent`/`placeInfoContent` 改為 `searchResultInfoContent`/`candidateInfoContent`。手機版 `GeoOutlinePhoneListDrawer.tsx` 的 `hotels`/`places`/`geocodeCandidates`/`onTabChange` 一併改為單一 `results`/`onSelect`。
- **`GeoOutlinePhoneView` 新增必填 prop `onOpenTrips`**：修正沒有選定行程時點日期選擇加入行程會靜默失敗的問題（見下方「修正」），呼叫端（`PhoneContent.tsx`）需額外傳入切到行程列表的導覽函式。
- **後端 `geo.SearchDistricts` 改名為 `SearchCityAttractions`，`geo.SearchKnownDistricts`/`DistrictAlias` 型別整個移除**（`server/internal/geo/places.go`，原 `district_aliases.go` 已刪除）：`SearchKnownDistricts` 呼叫前已確認恆為空 map，屬安全的死碼清除。`fetchNearbyHotels` 從套件層級函式改為 `(s *Server)` 方法，因落地 GCS 需要存取 `s.photoUploader`。以上均為套件內部符號，本次範圍內呼叫端已同步更新。

### 新增

- **地圖照片查詢改為 Pexels-first + GCS 落地**（`server/internal/geo/places.go`、新增 `server/internal/photostorage`）：查詢地點照片時優先查詢 Pexels 免費圖庫並落地存進自家 GCS bucket，查無結果或未設定 Pexels API key 才 fallback 回 Google Places 真實照片；`GET /internal/geo/place-details` 新增 `photoOnly=1`/`textOnly=1` 兩種輕量查詢模式供搜尋結果清單延遲載入使用，`GET /internal/geo/geocode` 新增可選的 `biasLat`/`biasLng` 位置偏向參數。
- **日期選擇 UI 改用 `react-day-picker` 月曆浮動匡**（新增 `web/src/geo-planning/DatePickerPopover.tsx`）：取代原本「加入行程」流程裡的原生 `<input type="date">`，改成疊加在按鈕組正下方（或視剩餘空間自動往上翻轉）的月曆格線浮動匡，點選日期格子即視為確定，不再需要額外的「確定」按鈕；配色沿用專案既有暖色系 CSS token，不使用套件預設的藍色主題。
- **浮動卡片外殼收斂為共用元件 `FloatingPanel`/`PanelHead`**（新增 `web/src/FloatingPanel.tsx`、`web/src/PanelHead.tsx`）：取代原本六處各自重複的「絕對定位疊在地圖上方 + 右上角關閉按鈕 + 標題列」樣板程式碼與 CSS，`styles-desktop.css` 拆分歸位到各元件的 module.css 後整份刪除。

### 修正

- **地圖搜尋結果 marker 連續點擊時，資訊卡照片/評分/「加入行程」按鈕會消失且不會補回來**（`GeoOutlinePanel.tsx`、`geoSelection.ts`）：地圖 marker 的點擊事件在建立當下就把候選物件封進 closure，同一顆 marker 被連續點擊時傳入的是同一個物件參照，導致負責補查照片/文字的 `useEffect` 依賴比對判定「沒有變化」而不重新查詢；同時 `geoSelection` reducer 對同一個地點的重複選取，原本會無條件用輕量版內容覆蓋已經補齊的完整內容。改為 `useEffect` 依賴穩定的 `placeId` 字串，`geoSelection` 對同一個 key 的重複選取保留既有內容不覆蓋。
- **對話浮動小匡與搜尋結果側欄同時開啟時位置重疊、高度不一致**（`DesktopLayout.module.css`）：兩者原本都固定貼右緣、互不避讓；改為對話小匡在搜尋結果側欄同時顯示時自動往左推開，且改用與搜尋結果側欄一致的高度計算方式，不再各自獨立換算。
- **候選籃「×」刪除時，同一個地點若已排入行程多次會被一併誤刪**（`useGeoPlanningState.ts` 的 `removeCandidate`）：原本用「名稱+座標」比對要移除的候選，同一地點多次排入行程時會產生多筆座標相同、但各自獨立的 entry，刪除其中一筆會誤判成全部符合刪除條件而一起消失。改為 entry 類型改用穩定的 `id` 精確比對，其餘沒有 `id` 的候選類型維持原本比對方式。
- **沒有選定行程時點日期選擇加入行程會靜默失敗**（`DesktopLayout.tsx`、`GeoOutlinePhoneView.tsx`）：原本 `handleScheduleCandidate` 內部因缺少 `tripID` 直接 no-op，使用者點了日期、浮動匡正常關閉卻毫無提示。改為記住候選與選定日期，導向行程列表引導使用者先選定行程，選定後自動補寫入剛才的候選。
- **加入行程成功後，已經展開的行程欄反而被收合**（`DesktopLayout.tsx`）：誤用了帶有「再次呼叫同一個 mode 會 toggle 收合」邏輯的 `setPanelMode`，改為直接呼叫 `navigate` 導向目標路徑，不受 toggle 邏輯影響。
- **候選籃某天「從候選加入」卡片外殼樣式全部失效、畫面版面錯亂**（`DesktopLayout.tsx`）：先前浮動卡片外殼重構時漏改這個分支，仍引用已經搬移、不存在的 CSS class 名稱，導致這張卡片變成沒有任何定位/樣式的裸元素。改用共用的 `FloatingPanel` 元件，並依需求調整為與行程欄並排顯示（不再互斥取代）。
- **Google Places 地點詳細資訊查詢缺少語系參數，回應內容為英文**（`server/internal/geo/places.go`）：`GetPlaceDetails` 補上 `languageCode=zh-TW`。

### 清理

- **地理規劃地圖標記邏輯拆分為多個獨立 hook**（`GeoOutlineMap.tsx` 拆出 `useAttractionOverlays`/`useTripEntryMarkers`/`useSearchResultMarkers` 等，新增 `geoMarkerSelection.ts`/`mapMarkers.ts`）：取代原本集中在單一元件裡的多份圖層邏輯，各圖層獨立成純函式/hook，方便個別測試與維護。
- **後端 Places API 請求組裝統一**（`server/internal/geo/places.go`）：`Search`/`GetPlaceDetails` 改用共用的 `newPlacesSearchRequest`/`newPlaceDetailsRequest` helper 組裝請求，消除各端點各自手寫 `languageCode` 導致容易遺漏的問題。
- **移除試做功能「推薦景點卡片」「推薦景點橫滑」**（`DesktopShared.tsx`、`DesktopRail.tsx`、`demo/DemoPanelContent.tsx`、`recommended-places/RecommendedPlaces.tsx`）：含入口按鈕、`PanelMode`/feature flag、對應死碼（`RecommendedPlacesRow`/`FAKE_RECOMMENDED_PLACES`）與 CSS 一併移除；`RecommendedPlacesList`/`RecommendedPlaceCard` 仍被 `MessageBubble.tsx` 使用，予以保留。
- **手機版側滑/彈出抽屜的拖曳關閉手勢收斂為共用 hook `useDragToClose`**（新增 `web/src/hooks/useDragToClose.ts`）：取代原本 `PhoneTripsDrawer.tsx`/`GeoOutlinePhoneListDrawer.tsx`/`PhoneTimelineDrawer.tsx`/`GeoOutlinePhoneCandidateDrawer.tsx` 四份檔案各自複製貼上的 `dragOffset`/touch handler 邏輯。
- **候選籃側欄標題「候選籃」改為「行程」，行程列表改稱「旅程列表」**（`GeoCandidateSidebar.tsx`、`DesktopTripList.tsx`、`DesktopRail.tsx`、`PhoneTabBar.tsx`）：兩者原本都稱作「行程」容易混淆，明確區分「旅程」（挑選哪一趟旅行）與「行程」（該趟旅程裡排定的地點清單）。

## v0.7.0 — 2026-08-17

### 新增

- **手機版導覽再簡化，時間軸改為規劃地圖專屬的彈出面板**（`web/src/timeline/PhoneTimelineDrawer.tsx`）：底部常駐列（`PhoneTabBar.tsx`）不再含「時間軸」項目，改成規劃地圖畫面左下角的專屬入口，由下往上彈出（bottom sheet），只顯示唯讀清單，不含對話輸入列；選擇行程後不再自動跳轉到時間軸/路徑分頁，留在使用者原本所在的畫面（已與使用者確認）。分享連結/成員管理/開啟時自動進入三個功能，從精簡版側滑抽屜 `PhoneNavDrawer.tsx`（本次整個移除）搬到 `PhoneTripsDrawer.tsx` 每筆行程項目的「管理」按鈕，改用共用的 `TripManageModal`，對齊桌面版 `DesktopTripList.tsx` 的 `onManage` 心智模型；使用者頭像改為直接開啟設定畫面，不再先進中介選單。
- **地圖分類標籤旁新增城市搜尋框**（`GeoOutlineMap.tsx`）：不需要先開候選籃側欄，可直接在地圖上方輸入目的地城市觸發搜尋，樣式/行為對齊候選籃既有的搜尋框。
- **手機版鎖住整站手動縮放**（`web/index.html` 的 `maximum-scale=1, user-scalable=no`）：修正 iOS Safari 對小字級 `<input>`（規劃地圖城市搜尋框，13px）focus 時自動放大整頁面的不一致體感，取捨是使用者同時失去手動縮放頁面的能力（使用者明確選擇此做法）。

### 變更

- **搜尋結果清單（`GeoHotelSidebar.tsx`）取消飯店/附近推薦分頁，合併成單一清單**：不再需要切換分頁才能看到另一類別的查詢結果，飯店排在清單最前面，附近推薦（景點/餐廳）依查詢類別加小標題；兩者皆無資料時顯示統一空狀態提示。手機版 `GeoOutlinePhoneListDrawer.tsx` 維持原本雙分頁呈現，不受影響。
- **修正搜尋清單顯示條件錯誤**（`DesktopLayout.tsx` 的 `geoHotelSidebarVisible`）：原本額外檢查 `panelMode === 'geo-outline'`，導致在其他 `panelMode` 下用地圖上方類別標籤查詢時，即使已查到資料，清單也不會跳出來；改為只要有查詢結果就顯示，不受目前 `panelMode` 影響。

### 移除

- **移除地圖上景點區域間的距離估算連線示意功能**（`GeoOutlineMap.tsx`/`.module.css`）：兩兩相距較遠的景點區域之間原本會畫虛線並標示距離、伴隨文字圖例，使用者確認此功能整個移除，含 `farPairs`/`distanceKm` 計算邏輯與對應 CSS。

## v0.6.0 — 2026-08-16

### 新增

- **手機版新增「規劃地圖」畫面，分三階段完成**（`web/src/geo-planning/GeoOutlinePhoneView.tsx` 及相關檔案）：
  - 第一階段：地圖瀏覽 + 唯讀資訊卡（`GeoOutlinePhoneInfoSheet.tsx`），複用桌面版的地圖引擎（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）與資料轉換邏輯（新增 `geo-planning/geoInfoContent.ts` 供桌面/手機共用），並設為手機版進 App 後的預設起始畫面（不再自動彈出行程列表）。
  - 第二階段：候選籃抽屜（`GeoOutlinePhoneCandidateDrawer.tsx`，右側滑入），資訊卡加回「加入候選」「排入行程某一天」互動，純邏輯複用既有的 `geo-planning/geoCandidateHelpers.ts`。
  - 第三階段：飯店/推薦地點清單抽屜（`GeoOutlinePhoneListDrawer.tsx`，左側滑入，雙分頁），補上手機版原本缺漏的飯店/地點資料流串接。
  - 全程未修改任何桌面版檔案的行為，僅原封不動複用其匯出的元件與純函式。
- **手機版導覽從側滑抽屜改為底部常駐 tab bar**（新增 `web/src/PhoneTabBar.tsx`：行程/時間軸/規劃三項常駐顯示；新增 `web/src/PhoneSideTools.tsx`：路徑（配速表）與 demo-* 試做功能收成畫面右下角小圖示）：不再需要先點開抽屜才能切換分頁。`PhoneNavDrawer.tsx` 精簡為只剩分享/成員/頭像的操作抽屜。`web/index.html` 補上 `viewport-fit=cover`，讓 `env(safe-area-inset-*)` 在 iOS 上正確生效，底部導覽列與浮動卡片才能正確避開 home indicator。

### 清理

- **前端 `web/src/` 依功能領域重新整理目錄結構**，消除多個身兼多職的共用檔案：
  - 新增 `pace/`、`home/`、`chat/`、`timeline/`、`recommended-places/`、`demo/`、`user/`、`trip/` 等功能子目錄，搬入對應元件（含多個歷史遺留檔名的更新，例如 `PublicPaceDemoPage.tsx`→`pace/PacePage.tsx`、`PhoneScreens.tsx`→`trip/PublicViewScreen.tsx`），並移除確認無人引用的死碼 `landing.css`。
  - `AppCommon.tsx` 的 `useIsDesktop`/`useAppState`/`useTripsState` 三個 hook 拆到新增的 `web/src/hooks/` 目錄，各自獨立成檔案，對應測試同步搬到 `hooks/useTripsState.test.tsx`。
  - `types.ts` 依領域拆分為 `trip/types.ts`、`user/types.ts`、`chat/types.ts`，只保留跨領域共用的 `Entry`；未使用的 `SearchAnswer` 型別移除；純 API 層格式 `APIErrorBody` 併入 `api.ts`。
  - `DrawerMode` 型別與桌面版既有的 `PanelMode` 收斂到同一份定義（`DesktopShared.tsx`），避免兩份值域各自維護。
  - `docs/` 底下建立 `doc-file-format` skill 規範文件命名（`audit-*`/`research-*`/`refactor-*` 三種字首），現有全大寫底線檔名文件統一改為小寫橫線，並新增 `docs/audit-security.md`、`docs/audit-functional.md` 彙整多代理掃描結果。

### 文件

- `docs/terminology.md` 修正對手機版導覽結構的過時描述（`PhoneNavDrawer` 不再含分頁列、`SettingsScreen`/`SettingsDialog` 已搬到 `user/`），反映本次重構後的實際檔案位置。

## v0.5.0 — 2026-08-16

### 破壞性變更

- **CLI `attraction-update` 移除 `-name` 選項，改為通用的 `-field`/`-value`**（`server/cmd/cli/main.go`、`server/internal/store/attractions.go` 的 `UpdateAttractionName`→`UpdateAttractionField`）：上一版（v0.4.5）才新增的 `-name` 選項改成 `-field name -value "新名稱"`，`-field` 目前開放 `name`、`summary` 兩個欄位（白名單機制，見 `attractionUpdatableFields`），日後新增可更新欄位只需要在白名單加一行，不必再各自新增一支 store method + API handler + CLI flag。呼叫端一律改用 `-field`/`-value`，舊的 `-name` 用法不再支援。
- **維運端點路徑改名**：`POST /internal/maintenance/landmarks/{id}/update-photo` 改為 `POST /internal/maintenance/attractions/{id}/update-photo`，對齊同一資源底下其餘 `/internal/maintenance/attractions/*` 端點命名（這條路徑先前漏改，是唯一還留著 `landmarks` 命名的維運端點）。CLI 呼叫端（`attractionUpdatePhoto`）已同步更新，子命令名稱 `attraction-update-photo` 本身不受影響。

### 新增

- **景點照片改存 Google Cloud Storage**（新增 `server/internal/photostorage` 套件，`GCS_PHOTO_BUCKET` 環境變數）：景點建檔（`attraction-add`）、換圖（`attraction-update-photo`）時，不論圖片來源是使用者手動指定的連結或後端自動查詢的 Pexels 示意圖，都會下載後上傳到 GCS，資料庫欄位存我方 GCS 網址，不再直接引用外部圖床連結（避免外部連結失效或變更導致照片消失）。刪除景點（`attraction-delete`）或換圖覆蓋舊照片時，會連帶清理舊的 GCS 物件；非本 bucket 的外部連結（例如尚未遷移前既有的 Pexels 直連）安全 no-op，不受影響。GCS 客戶端初始化失敗時（例如未設定憑證）降級為不落地、僅記警示 log，不阻擋 server 啟動。
- **桌面版對話小匡支援無行程狀態**（`ChatScreen.tsx`、`DesktopLayout.tsx`）：`trip` prop 改為選填，使用者不需要先選定/建立行程就能開啟對話小匡並開始對話；未帶 `trip` 時，所有綁定行程 ID 的資料流（歷史訊息、entries、WebSocket、批次持久化）與行程專屬功能（分享／成員／`TripMenu`）一律跳過，只保留即時對話本身可用，尚無訊息時顯示簡短通用引導文字。
- **新增行程設定彈窗 `TripManageModal`**（`web/src/trip/TripManageModal.tsx`）：合併原本分散在對話小匡 navbar 上的分享連結（`ShareModal`）、成員管理（`MembersScreen`）、開啟時自動進入（`TripMenu` 下拉選單）三個入口，改為行程列表每筆項目的單一「行程設定」按鈕觸發同一個置中彈窗，三個功能以區塊分隔呈現。手機版仍使用原本的 `ShareModal`/`MembersScreen`/`TripMenu`，不受影響。
- **`DesktopUserMenu` 改用 Portal 動態定位**：左下角使用者選單改用 `createPortal` 投影到 `document.body` + `position: fixed`（依觸發按鈕即時量測的座標定位），修正原本 `position: absolute` 相對 `.desktop-rail` 定位、被該容器的 `overflow: hidden`（寬度收合/展開過渡動畫用）裁切邊緣、以及展開方向計算錯誤導致選單蓋住觸發按鈕本身的問題。

### 修正

- **`NeedsSync` 相關 API 一致性修復**（`server/internal/api/attraction_sync.go`/`geo_outline.go`）：抽出 `resolveCoords`／`prepareSyncRun` 共用函式，消除 CLI 與 API 端重複的座標解析、同步前置檢查邏輯；`geo_outline.go` 整合原本兩處重複宣告的查詢半徑上限常數為套件層級 `maxNearbyRadiusMeters`；維運端點錯誤訊息用詞統一（「地標」→「景點」、`no_match`→`not_found` 語意修正）。

### 清理

- 前端全域樣式依歸屬重新拆分：原本單一巨大的 `styles.css` 拆為 `base-ui.css`（跨檔案共用基礎樣式，如 `.navbar`/`.btn`/`.row`/`.rp-modal*`）與多個元件專屬 CSS Module（`App.module.css`、`AppCommon.module.css`、`SettingsDialog.module.css`、`AskSheets.module.css`、`DesktopShared.module.css`、`DesktopLayout.module.css`、`DesktopRail.module.css`、`DesktopTripList.module.css`、`DesktopUserMenu.module.css`、`trip/TripManageModal.module.css`）；`styles-desktop.css` 依「版面骨架」（新增 `desktop-layout-shell.css`）與「單一元件專屬」（併入對應元件的 module）進一步拆分，只保留真正跨多檔案共用的部分。所有拆出的 CSS 檔案改由實際使用的元件各自 `import`，不再於 `main.tsx` 全域載入，手機版使用者不再連帶下載桌面版專屬樣式。過程中發現並修正一起 CSS 註解內 `*/` 字元序列提前結束整段區塊註解、導致後續規則（含 `:root` 變數定義）解析失敗的 bug。

### 文件

- `docs/TERMINOLOGY.md` 修正過時內容：對話小匡條目更新為反映無行程狀態下的通用引導文字（原文件仍描述「未選行程時顯示空狀態提示」的舊行為），新增「行程設定彈窗」條目說明 `TripManageModal` 取代原本分散的分享/成員入口。
- `.claude/skills/tripace-cli/SKILL.md` 修正 `attraction-update` 範例改用新的 `-field`/`-value` 語法，修正已改名的 `landmarks/{id}/update-photo` 舊路徑引用，新增景點照片落地 GCS 的行為說明。

## v0.4.5 — 2026-08-15

### 新增

- **景點資料同步機制**（`server/internal/attractionsync/`、`server/internal/api/attraction_sync.go`/`synctoken.go`、CLI `attraction-sync-setup`/`attraction-sync` 子命令，見 `docs/ATTRACTION_SYNC_DESIGN.md`）：本機開發站與正式站之間的景點資料單向同步，三層比對（新鮮度探測→輕量清單 diff→欄位級 diff）+ 交握式傳輸，依同步方向由來源方負責比對決策，sync-token 由本機 server 自行保管，CLI 只負責觸發。

  **⚠️ 已知安全風險，尚未修復完成，不應部署到正式站**：上線前複查（`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`）發現 `target` 參數未驗證、既有 `internalAuth` 中介層無角色檢查，任何在正式站註冊的一般使用者都能觸發 SSRF，並經由偽造的同步對象竊取/竄改/清空正式站景點資料（Critical）；錯誤訊息會把同步對象的回應內容原樣回吐，構成內網探測/資料外洩管道（High）；`-retry` 旗標目前是空殼，設計文件裡的續傳邏輯（`Transfer`/`ResumeFrom`/`PushTo`）在正式路徑上未被呼叫、是死碼（High）。這三項風險（複查編號 #1/#2/#4）皆未修復。詳見風險文件的完整清單、攻擊鏈說明與處理建議。
  - **本次已修正**：`NeedsSync`（`diff.go`）原本只看目的方最新一筆記錄的時間，忽略雙方記錄筆數差異，導致目的方有人手動新增一筆較新的資料時，即使來源方還有大量更早的資料未同步，也會被誤判為「不需要同步」而靜默漏同步（複查編號 #3）。已改為筆數不同即視為需要同步，並補上回歸測試 `TestNeedsSync_CountDiffersDespiteOlderTimestamp`。
  - 因為 CLI 介面純新增、未變更既有子命令、未刪除任何正式功能、未變更資料庫 schema（`attractionRow` 與 `AutoMigrate` 清單皆未變動），依 `.claude/skills/version-tagging/override.md` 三條判準本身不構成破壞性變更；但上述資安風險是獨立於破壞性判準之外、必須在對外部署前處理的問題。
- **CLI `attraction-update` 新增 `-name` 選項**（`server/cmd/cli/main.go`/`http.go`、`server/internal/api/maintenance.go`、`server/internal/store/attractions.go`）：新增 `PATCH /internal/maintenance/attractions/{id}/name` 端點，修正建檔時輸入錯誤/需要調整的景點名稱。`-name` 與既有的座標修正（`-lat/-lng` 或 `-place`）互不排斥，可同時帶入或只改其中一種，只要至少帶了一項即動作；既有的「必須帶 `-lat/-lng` 或 `-place`」規則放寬為「三者擇一」，舊呼叫方式不受影響，非破壞性。
- `docs/PLAYWRIGHT_WALKTHROUGH_FEEDBACK_2026-08-13.md`：Playwright 走查回饋文件。

### 文件

- `.claude/skills/tripace-cli/SKILL.md` 補上 `attraction-update` 子命令的說明與範例（原本完全沒有提及，本次連同 `-name` 選項一併補齊）；景點資料同步機制刻意不列入，避免在已知安全風險未修復前間接鼓勵在正式站使用。

## v0.4.4 — 2026-08-15

### 變更

- **桌面版側欄改為常駐對話欄 + 浮動卡片**（`DesktopLayout.tsx`/`DesktopRail.tsx`/`DesktopShared.tsx`/`styles-desktop.css`）：`ChatScreen` 移入常駐左側欄（可收合，`chatCollapsed`），主顯示區固定為規劃地圖，`trips`/`timeline`/`pace`/`geo-outline` 改為疊加在地圖上的浮動卡片（右上角有共用關閉按鈕），不再擠壓地圖寬度；`demo-*` 系列維持原本整頁取代主顯示的行為。桌面版 `pace` 模式不再掛載 `PaceRouteMap`（與「主顯示固定為地圖」的新版面衝突），該元件保留供 `/demo/pace` 公開分享頁與手機版使用。
- **新增 `PANEL_REGISTRY` 設定表**（`DesktopShared.tsx`）：取代原本散落在 `isSidepanelMode`／`.wide` 字串拼接／側欄與主區各自 ternary 等處的 `panelMode` 字串比對，新增或調整面板行為（浮動卡片 vs. 整頁取代、寬度、是否需要已選行程）現在只需要改這張表一處。
- **浮動卡片視覺語言統一為 `.floating-panel`**（`styles-desktop.css`）：取代原本各自獨立定義的 `.add-from-candidate-sidebar`/`.geo-hotel-sidebar-wrap`，四種 `panelMode` 浮動卡片與候選籃第二側欄、飯店/附近推薦清單共用同一套定位/樣式。
- **地圖上方新增城市搜尋框**（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）：類別標籤列旁新增城市搜尋輸入框，與候選籃側欄共用同一份搜尋狀態，不需要先展開候選籃就能在地圖上直接搜尋城市。

### 修正

- **正式環境地圖標記無法顯示**（`Dockerfile`/`deploy-cloudrun.yml`/`deploy-with-migration.yml`/`update-secret-manager.sh`）：`GeoOutlineMap.tsx` 改用 `AdvancedMarkerElement` 後要求地圖必須帶有效的 `mapId` 才能運作，但部署設定先前只設定了 `VITE_GOOGLE_MAPS_API_KEY`，`VITE_GOOGLE_MAPS_MAP_ID` 在正式環境建置時是 `undefined`，導致所有地圖標記（飯店/景點/推薦地點/搜尋候選點等）靜默失效。新增 `GOOGLE_MAPS_MAP_ID` secret（GCP Console 手動建立的 Map Style ID，非機密資料但集中管理），`update-secret-manager.sh` 新增 `-map-id` 選項維護，兩個部署 workflow 比照既有 `GOOGLE_MAPS_API_KEY` 的讀取模式，build 時當 `--build-arg` 傳入。

### 文件

- `.claude/skills/version-tagging/override.md` 新增第三條破壞性判準：資料表變更若無法只靠 `AutoMigrate` 無痛套用（需要 backfill 既有資料、刪除表/欄位、或手寫 migration/人工介入資料庫），即算破壞性，不論是否對外公開、有沒有動到 CLI 介面。
- `docs/TERMINOLOGY.md` 修正過時內容：桌面版三段式版面段落更新為「常駐對話欄 + 固定地圖主顯示 + 四種 panelMode 浮動卡片」的現況（原文件仍描述舊版「side panel 依分頁切換」的版面），一併修正多處指向 `web/src/` 根目錄、實際已搬到 `web/src/geo-planning/` 子目錄的檔案路徑（`AddFromCandidateSidebar.tsx`/`GeoHotelSidebar.tsx`/`GeoOutlineMap.tsx`/`AttractionInfoPanel.tsx`），與已改名的 CSS class（`.add-from-candidate-sidebar`/`.geo-hotel-sidebar-wrap` → `.floating-panel`/`.floating-panel-left`/`.floating-panel-right`）。

## v0.4.3 — 2026-08-15

### 新增

- **CLI `attraction-update` 子命令**（`server/cmd/cli/main.go`/`http.go`）：修正建檔時輸入錯誤的景點座標，走新增的 `PATCH /internal/maintenance/attractions/{id}/coords` 端點（`server/internal/api/maintenance.go`、`store.UpdateAttractionCoords`）。支援 `-lat/-lng` 直接指定，或 `-place/-region` 改查該地名座標取第一筆候選結果，不需要自己先查好經緯度。
- **地理輪廓底圖搜尋框改為多候選**：`GET /internal/geo/geocode`（`handleGeoGeocode`）改用 Places API (New) Text Search 取代原本的 Geocoding API，回應形狀從單一最佳匹配 `{query, address, lat, lng}` 改為候選陣列 `{query, candidates: [...]}`，最多回傳 20 筆（`geo.Client.Search` 的 `MaxResults` 官方硬性上限，原本受限於本專案自訂的 5 筆節流已一併拉高）。原因：Geocoding API 對城市/觀光區/商圈這類口語化地名常查無結果或答非所問，且沒有候選清單可退。前端（`GeoOutlineMap.tsx`/`GeoOutlinePanel.tsx`）新增候選 marker 圖層：地圖 `fitBounds` 到能同時看見所有候選的範圍，點擊任一個確認選定、其餘候選仍留在地圖上可隨時回頭改選，選定後開啟 `GeoInfoPanel` 顯示該候選的名稱/地址。此端點僅供自家前端/CLI 呼叫（`/internal/*` 命名空間、需 JWT 登入），呼叫端已在同一次異動中同步更新，不構成對外相容性影響。
- **路徑編輯器試做**（`web/src/RouteEditor.tsx`/`.module.css`）：旅程分享/路徑編輯功能的雜誌式編輯介面試做，`contentEditable` 行內編輯（標題/段落/地點卡）、拖拉排序、圖片文繞圖。純前端假資料，不呼叫任何後端 API。透過 `DEMO_ROUTE_EDITOR_ENABLED` feature flag 控制（`DesktopShared.tsx`，環境變數 `VITE_FEATURE_DEMO_ROUTE_EDITOR`），預設關閉，桌面版限定入口收在 `DesktopRail.tsx` 分隔線之後、與其餘 demo-* 試做項目同組。

### 修正

- **新增行程後未自動選中**：`AppCommon.tsx` 的 `submitCreate` 建立行程成功後，明確標記 `hasAutoNavigatedRef` 避免緊接著的行程列表刷新觸發「自動導向 localStorage 預設行程」的既有 effect，把使用者剛選中的新行程蓋掉。
- **新增行程按鈕溢出側欄邊框**：`.new-trip-composer input`（`styles.css`）補上 `min-width: 0`，修正 flex 子元素預設 `min-width: auto` 導致無法縮小、把固定寬度的「建立」按鈕擠出側欄邊界的問題。
- **404 頁面風格與首頁不一致**：`NotFoundPage.tsx` 改用 `LegalPage.css` 既有的 `.legal-bloom` 京都和風視覺語言（暖紙底色、日夜間切換），取代原本沿用的舊版 `landing.css` 藍綠度假風格。

### 其他

- `web/index.html` 補上標準版 `mobile-web-app-capable` meta tag（`apple-mobile-web-app-capable` 前綴版本保留供 iOS Safari 相容），修正瀏覽器主控台的 deprecation 警告。

## v0.4.2 — 2026-08-14

### 清理

- **移除私有依賴 `github.com/tim72117/want`**：`server/internal/wanttools/`（9 個檔案）對 `want/types` 的引用改為本地定義（新增 `wanttypes.go`，型別/函式簽章照抄 `want@v0.0.2/types` 原始碼，非重新設計），`want` 已從 `server/go.mod`/`go.sum` 完全移除。`internal/wanttools/` 套件本身未被刪除、內容不變——它是保留下來的舊 want 對話系統工具實作，經 `go list -deps` 驗證未被 `cmd/server`/`cmd/adminserver`/`cmd/cli` 任一 binary import，純粹是先前依賴仍列在 `go.mod` 裡、拖著 `go mod download` 需要私有模組認證的技術債。
- **4 支 Dockerfile 移除 `GH_PAT`/`GOPRIVATE`**（`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`、`Dockerfile.redirect`）：`go mod download` 不再需要私有模組認證，本機 `docker build` 不用再另外提供 GitHub PAT。`Dockerfile.migrate` 順便修正一段描述已移除的 `cmd/cli -db` 模式的過時說明。
- **5 個 GitHub Actions workflow 移除 `--build-arg GH_PAT`**（`deploy-admin.yml`、`deploy-cloudrun.yml`、`deploy-migrate.yml`、`deploy-redirect.yml`、`deploy-with-migration.yml`，`deploy-with-migration.yml` 有 2 處）。
- `server/scripts/setup.sh` 移除「簽發 GH_PAT 設成 GitHub repo secret」的部署後續步驟指示（原本兩步，現在一步）。
- 修正 `docs/PROJECT_HEALTH_REVIEW.md` 對 `want` 依賴風險的過時描述（原文稱其「被 26 個檔案 import」，現已完全移除）。

## v0.4.1 — 2026-08-13

### 修正

- **首頁 Googlebot 渲染空白問題**：`HomePage.tsx` 組出地圖/敘事內容的 `useEffect` 內，`new IntersectionObserver(...)` 原本沒有任何存在性檢查——若渲染環境不支援此 API（例如部分受限的無頭渲染器）會直接拋出 `ReferenceError`，中斷整個 effect，導致 hero 以下所有內容（地圖、敘事文字、bloom 圖層）永遠不會掛載出來，且因專案先前完全沒有 React Error Boundary，React 會把失敗點之後的畫面整個留白，只剩下 mount 時已 commit 的頁首。實際症狀：Google Search Console 的 URL 檢查截圖只顯示頁首，下方全為空白。修正為偵測不到 `IntersectionObserver` 時直接將所有敘事文字設為可見（降級而非空白）。
- **地圖節點縮圖缺少替代文字**：`HomePage.tsx` 動態產生的 SVG `<image>` 縮圖（7 個景點節點）補上 `role="img" aria-label`，先前對輔助工具/爬蟲形同空白圖片。

### 新增

- **全站 React Error Boundary**（`web/src/ErrorBoundary.tsx`）：包在 `App.tsx` 的路由樹最外層。此前任何路由元件在 render/effect 階段拋出未捕捉例外，都會讓 React 把畫面整個留白且無法恢復；現在會落地成一個可重新整理的畫面。這是最後一道安全網，不是特定錯誤的修法（`IntersectionObserver` 那個已在 `HomePage.tsx` 個別處理）。
- `sitemap.xml` 補上所有既有條目的 `<lastmod>`，並新增先前遺漏的 `/product` 頁面條目（該頁面在 v0.4.0 從 `"/"` 遷出後，`sitemap.xml` 一直沒有同步更新）。

### 其他

- 首頁 `<title>`/`<meta description>`/Open Graph/Twitter Card 文案調整：內容改為聚焦「協助使用者深入體驗一個想去的地方」的產品定位，不描述京都東山這類具體示範內容的細節（避免文案與首頁實際展示的範例路線強耦合，日後更換展示城市不需要連動改文案）；Twitter Card 型別由 `summary` 改為 `summary_large_image`。

  **⚠️ 待補**：新增的 `og:image`/`twitter:image` 目前指向 `https://tripace.shuttle.tools/og-image.png`，此檔案尚未建立（`web/public/` 底下沒有對應圖檔）——社群分享預覽圖目前會是失效連結，需另外提供一張 1200×630px 的分享預覽圖並放到 `web/public/og-image.png`。

## v0.4.0 — 2026-08-12

### 破壞性變更

- **首頁改版**：`"/"` 路由改渲染 `HomePage.tsx`（原 `KyotoExploreBloom.tsx`，京都東山探索路線捲動視差敘事），取代原本掛在該路徑的功能介紹頁；原功能介紹頁重新命名為 `ProductPage.tsx`（原 `LandingPage.tsx`），改掛到新路由 `/product`。暫時性的 `/kyoto-bloom-preview` 預覽路由已移除（首頁本身即是該內容，不再需要獨立預覽路徑）。曾經連到 `/kyoto-bloom-preview` 的書籤/分享連結會變成 404。
- **`LoginCard`/`LoginForm` 從 `AppCommon.tsx` 搬到新檔案 `LoginForm.tsx`**：兩者是 React 元件的具名匯出，原本跟 `useIsDesktop`/`useTripsState` 等不相關工具擠在同一個檔案，現已獨立。任何 `import { LoginCard, LoginForm } from './AppCommon'` 的呼叫端需改成 `from './LoginForm'`（本次一併更新了全部既有呼叫端：`CliAuthPage.tsx`、`DesktopUserMenu.tsx`、`PhoneContent.tsx`、`DeviceAuthPage.tsx`、`SettingsScreen.tsx`）。
- **移除全域樣式檔 `styles-login.css`/`styles-demo.css`**：`main.tsx` 不再 import 這兩個檔案。`styles-login.css` 的內容改為 `LoginForm.tsx` 自己 import 的 `LoginForm.css`（元件自帶樣式，不再依賴 `main.tsx` 的全域載入順序）；`styles-demo.css` 本身早已無實際規則（只剩解釋性註解），一併移除，不影響任何畫面。

### 新增

- **登入頁視覺改版**：`LoginCard` 的品牌 logo/標題/副標從卡片內部移到卡片外的獨立歡迎區塊（`.login-welcome`），卡片本身只保留表單——避免迎賓文字與操作型表單擠在同一個帶陰影方框裡。配色/字體對齊 `HomePage.css` 的紙感和風 token（`--paper`/`--ink`/`--vermilion`、`ShipporiSerif` 標題字），取代原本沿用舊版 `LandingPage` 度假配色（海青→暖沙漸層文字）的做法。卡片與輸入框改用純框線（背景透明，不帶實色底），陰影從戲劇化的大範圍柔焦陰影改成克制的雙層淺陰影；歡迎標題上方、卡片外框都加入低調的磚紅色點綴（`--line`/`--vermilion` 混色或純磚紅細線）。表單底部冗長的服務條款免責聲明改成一行短文字＋連到 `/terms` 的連結。以上改動僅套用在 `LoginCard` 的全螢幕迎賓情境（`.login-form.pill`），不影響 `login-dropdown`/`SettingsScreen`/`DesktopUserMenu` popover 共用同一顆 `LoginForm` 元件、走 App 自身 iOS 設計系統的情境。
- `HomePage.tsx` 右上角新增「登入」按鈕（`.app-cta`，透明底框線款），直接連到 `/app`，不需捲到頁尾或結尾 CTA 才找得到入口；首頁結尾 CTA「規劃我的探索路線」與頁尾新增的「產品功能」連結也一併補上（原本分別是佔位 `href="#"` 與缺漏）。
- `web/scripts/kyoto-bloom-generate-path.mjs`：路徑生成腳本正式收進 repo（原本是暫存目錄裡的一次性腳本），一次執行同時算出 `COORDS`/路徑 `d` 屬性/`nodeLenFractions` 三份資料，取代先前「跑兩支分開的腳本、中間手動複製貼上」的流程，避免手動搬運造成兩者不一致。

### 修正/清理

- 移除 `HomePage.tsx`（原 `KyotoExploreBloom.tsx`）的開發用「校準模式」面板（`⚙ 校準模式` 按鈕與對應調參邏輯）——`START_FRAC`/`END_FRAC` 校準已完成，不再需要即時調參工具。
- `HomePage.tsx`/`.css` 一系列耦合/結構修正：`viewBox` 的 y 偏移與高度改由 SVG 元素自身的 `viewBox` 屬性讀取（不再三處各自寫死同一組數字）；地圖節點縮圖半徑收成具名常數 `NODE_THUMB_RADIUS`；手機/桌面版行為分支（文字淡出時機、bloom 照片定位公式）收斂成 `LAYOUT_BEHAVIOR` 查表；z-index 裸數字收成 `--z-fixed-ui`/`--z-progress`/`--z-bloom`/`--z-mobile-map`/`--z-base` 五個具名 token；`update()` 拆成 `computeFrameState()`（純計算）+ `applyMapVisuals`/`applyTextEmphasis`/`applyBloomPhoto`（純 DOM 寫入）；補上 `cancelAnimationFrame`，避免 unmount 後仍有排程中的動畫幀執行；`.map-col` 手機版媒體查詢移除與桌面版重複的宣告。
- 修正 `ProductPage.css` 的一處 CSS specificity 陷阱：`.product-page a { color: inherit }` 的 specificity 高於多個單一 class 的按鈕/連結顏色規則，導致這些規則即使寫在檔案後面也會被蓋掉（按鈕文字顏色因此顯示錯誤）——受影響的選擇器補上 `.product-page` 前綴拉高權重。
- 修正 `LoginForm.css` 的 `.login-screen` 缺少 `flex-direction: column`，導致歡迎區塊與登入卡片在所有螢幕尺寸下都變成左右並排而非垂直堆疊。
- 修正 `ProductPage.tsx` 四處連到不存在路由 `/register`/`/login` 的連結（本專案沒有獨立的登入/註冊頁面，`/app` 本身已內建 `LoginForm`）；移除因此變得多餘的 `.product-btn-secondary`/`.product-nav-link` 死 CSS 規則。
- 校正 `ProductPage.css` 的配色 token 數值——原本與 `HomePage.css` 同名 token（`--paper`/`--vermilion` 等）數值不同（尤其 `--vermilion` 是明顯不同的飽和橙紅 vs 對照組偏暗磚紅），改成逐位元相符；深色模式下 `--vermilion`/`--vermilion-soft` 語意互換的錯誤一併修正。
- 修正 `ProductPage.tsx` footer 的 `onagent` 連結誤植為不存在的 `onagent.ai`（應為全站實際使用的 `https://onagent.shuttle.tools`），並將整個 footer 結構/文案對齊 `HomePage.tsx`。
- 修正並更新多處指向已改名/已刪除檔案（`LandingPage.tsx`、`KyotoExploreBloom.tsx`/`.css`、`web/public/kyoto-demo-pages/kyoto-explore-bloom.html`）的過時註解與文件（`web/README.md`、`docs/FRONTEND_CLICK_ACTIONS.md`）。

## v0.3.0 — 2026-08-12

### 破壞性變更

- **`tripace-cli` 移除 `-db` 直連 PostgreSQL 模式**：`cmd/cli/db.go`（`dbClient` 及其 `listTrips`/`createTrip`/`record`/`updateEntry`/`deleteEntry`/`reset`/`attractionAdd`/`attractionList`/`attractionCities`/`attractionDelete`/`dropTripGrouping`/`renameChannelToTrip`/`fixPhotoCacheSchema` 等方法）已整個刪除，`main.go` 移除 `-db` 全域旗標；曾經只在 `-db` 模式下可用的一次性維運指令 `drop-trip-grouping`/`rename-channel-to-trip`/`fix-photo-cache-schema` 一併移除（已在正式站執行完畢，見移除前 `store/maintenance.go` 開頭的說明）。所有操作現在一律經過 server 的 HTTP API，不再有任何路徑繞過認證/節流/請求記錄。曾以 `-db` 旗標呼叫本工具的腳本/流程需改為先 `tripace-cli login --web` 登入後直接呼叫（不帶 `-db`）。
- 連帶移除 `server/docker-compose.yml`（本地直連 PostgreSQL 開發用，隨 `-db` 模式一起失去用途）。

### 新增

- **`internal/pexels`**：新增 Pexels Search API 封裝（`Client.Search`），作為 `POST /internal/maintenance/attractions` 建檔時未帶 `photoUrl` 的自動補圖來源（查無結果或未設定 `PEXELS_API_KEY` 時靜默略過，不阻擋建檔）。同時新增 `pexels_photo_cache` 表與 `store.GetCachedPexelsPhoto`/`SetCachedPexelsPhoto`（鍵為 `search_query`）供日後「使用者瀏覽景點時即時查詢示意圖」功能共用，`attraction-add` 本身目前不經過這層快取。需設定 `PEXELS_API_KEY`（見 `server/.env.example`）。
- `POST /internal/maintenance/landmarks/{id}/update-photo` 新增 `source` 欄位（`"google"`｜`"pexels"`，未帶預設 `"google"`，向下相容既有呼叫端），可指定改走 Pexels 查詢示意圖而非 Google Places 真實照片。
- `cmd/cli` 的 `attraction-add`/`attraction-list`/`attraction-cities`/`attraction-delete` 改走新的 `/internal/maintenance/attractions*` HTTP 端點（`handleMaintenanceAttractionAdd`/`List`/`Cities`/`Delete`），取代原本只能在 `-db` 模式下使用的 `dbClient` 實作；`attraction-add` 未帶 `photoUrl` 時由後端自動查 Pexels 補上。
- 新增京都東山探索路線互動原型：`web/public/kyoto-demo-pages/`（classic 版：sticky 地圖 + clip-path 相片顯影；bloom 版：接近節點時圓點展開成大圖，靜態 HTML/CSS/JS demo）與正式 React 元件 `web/src/KyotoExploreBloom.tsx`/`.css`（掛在暫定路由 `/kyoto-bloom-preview`，尚未取代 `LandingPage`）。桌面版地圖左、文字右並排，隨捲動位置展開/收合節點縮圖為大圖；手機版改為地圖 sticky 釘在畫面上方、文字在下方捲動，套用與桌面版相同的圓點展開機制（只是方向由左右改為上下）。
- `LegalPage.tsx`/`LegalPage.css`：隱私權政策/服務條款頁面視覺改對齊 `KyotoExploreBloom` 的紙感和風風格（配色 token、`ShipporiSerif` 標題字體、footer 結構、日夜間切換機制），取代原本沿用 `landing.css` 的藍綠度假風。`PrivacyPage.tsx`/`TermsPage.tsx` 文字內容未變動。
- `App.tsx` 全部 11 條路由改用 `React.lazy()` 動態載入，取代原本的靜態 import——避免瀏覽器造訪任一頁面時，連帶下載其餘不相關頁面元件的程式碼。

### 其他

- `geo.PhotosEnabled()`：新增匯出函式，供 `internal/pexels` 判斷 Google Photo 下載是否已開啟（避免各自重複讀一次 `GOOGLE_PLACES_FETCH_PHOTOS` 環境變數）。

## v0.2.1 — 2026-08-11

### 新增

- Cloud Run 部署新增 `VITE_ONAGENT_APP_KEY`/`VITE_ONAGENT_URL` build-arg 串接（`Dockerfile`、`.github/workflows/deploy-cloudrun.yml`）——正式站前端 build 現在會正確讀到 onagent 平台的 apiKey/URL，不再 fallback 到 `localhost:8081`（此前完全沒有任何部署流程處理這兩個變數，onagent 對話功能在正式站原本會整個失效）。
- `Dockerfile` 補齊 `web/admin` 合併編譯 stage（`admin-build`），依循 onagent 專案 `Dockerfile` 的多前端合併模式：build 兩個前端、`rm -rf` 清掉 checked-in placeholder、分別 COPY 進各自的 `go:embed` 路徑。`cmd/server` 的 `-admin`/`ADMIN_ENABLED` 合併掛載開關本已支援，但先前實際 embed 進去的一直是 placeholder；目前僅補齊「合併編譯」能力，`deploy-cloudrun.yml` 未設定 `ADMIN_ENABLED`，不影響現有部署行為。
- `server/scripts/update-secret-manager.sh` 新增 `-onagent`（貼上既有 `VITE_ONAGENT_APP_KEY` 值寫入 Secret Manager——onagent apiKey 只能靠 `onagent issue-key` 另外核發，此腳本不提供現場申請）、`-cleanup-legacy-provider`（互動確認後刪除已無用的 `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` secret 容器）、`-h`/`--help`。

### 清理

- 移除 `internal/adminconsole/health.go` 的 LLM provider 健檢項目（`llmCheckName`/`checkLLM`/`probeGET`，三者皆為套件私有符號）：這組健檢依賴的 `AI_PROVIDER`/`VLLM_BASE_URL`/`GOOGLE_API_KEY` 環境變數原本是給 v0.2.0 已移除的 want 對話系統用的，移除後已無任何 tripace 側程式碼路徑讀取，繼續探測「這個環境變數所指的服務是否可連通」已無實際功能意義。保留 DB、Google Places API 兩項健檢。
- `.github/workflows/deploy-cloudrun.yml`、`server/.env`、`server/.env.example`、`server/scripts/update-secret-manager.sh` 一併清除對應的 `AI_PROVIDER`/`AI_MODEL`/`VLLM_BASE_URL`/`OLLAMA_URL`/`GOOGLE_API_KEY`/`ANTHROPIC_API_KEY`/`LLM_KIND` 殘留設定與互動流程。

### 其他

- `server/tools/onagent-tools.yaml` 的 `recommend_nearby`/`geocode` BackendDispatch endpoint 從本機開發位址改指向正式站 `https://tripace.shuttle.tools`（已同步推送至正式 onagent 平台）。
- `ChatScreen.tsx` 輸入框 placeholder 由「onagent 推論路徑(本機測試)…」改為面向使用者的引導文字。

## v0.2.0 — 2026-08-11

### 破壞性變更

- **移除 tripace 自家 want LLM 對話系統**：前端對話（`ChatScreen.tsx`）改用 onagent 平台（`web/src/useOnagentChatBridge.ts`）。以下路由與符號已刪除：
  - `POST /v1/trips/{id}/assist`（`handleAssist`）
  - `POST /v1/trips/{id}/query`（`handleQuery`）
  - `POST /v1/public/{token}/assist`（`handlePublicAssist`）
  - `api.New(st, an llm.Analyzer, signer, devMode)` → `api.New(st, signer, devMode)`（移除 `llm.Analyzer` 參數）
  - `(*Server).EnableClientTools`
  - `GET /internal/clienttools/ws`、`POST /internal/clienttools/test-prompt`、`GET /internal/clienttools/info`
  - `internal/llm`、`internal/clienttools`、`internal/protocol`、`internal/toolschema` 四個套件整套移除；`server/tools/clienttools.yaml` 移除
  - `cmd/dumpthought`、`cmd/agentbench`、`cmd/mockllm` 三個除錯/測試用 binary 移除
  - `internal/wanttools`（`entry_query`/`geocode`/`ask_user`/`ask_choice`/`task_plan` 等工具實作）**保留原始碼**，供日後視情況遷移到 onagent，但目前無任何呼叫方
  - **已知副作用（尚未修復）**：公開分享連結的 `editable` 旗標（開啟後讓匿名訪客透過 AI 對話寫入行程）唯一的消費者就是 `handlePublicAssist`，隨其移除後**公開連結目前恆為唯讀**，不論 `editable` 開關切成什麼——欄位與 API/UI 開關仍保留，但功能上已失效。詳見 `docs/PUBLIC_LINK_DESIGN.md`「`editable` 開關」一節。

### 新增

- `recommend_nearby`、`geocode` 兩個查詢型、無副作用工具改以 onagent **BackendDispatch** 模式實作於 `internal/onagenttools`：onagent 平台的 LLM 決定呼叫時，onagent 伺服器直接 POST 到 tripace 後端執行，不經過瀏覽器分頁。對應新路由 `POST /onagent/recommend_nearby`、`POST /onagent/geocode`（見 `docs/ROUTING_ARCHITECTURE.md`「三之一、`/onagent/*`」）。搬移時修正了 want 舊版缺漏的空結果防呆（避免 index-out-of-range panic），並補上 `recommend_nearby` 的 `radius_meters` 範圍驗證。**目前刻意不做 HMAC 簽章驗證**，對齊 onagent 平台目前實際實作進度（PoC 階段已知風險）。
- `GeoInfoPanel`「加入 {tripName}」按鈕：行程本身已有排定日期時，先展開日期下拉選單（列出既有日期 + 「其他日期」），而非直接跳日曆；選單改為懸浮疊層，貼齊按鈕下方，不擠壓卡片版面，並支援視窗剩餘空間不足時自動往上翻轉、點選單外部自動收合。
- `DesktopLayout`/`GeoCandidateSidebar` 拆分重構：抽出 `DesktopRail`、`DesktopTripList`、`DesktopUserMenu`、`SettingsDialog` 四個獨立元件；`GeoCandidateSidebar` 抽出 `geoCandidateHelpers.ts` 純函式模組；地理輪廓底圖規劃頁相關 14 個元件搬進 `web/src/geo-planning/` 目錄。
- `GeoCandidateSidebar`「前一天」/「隔天」改成常駐顯示的「+ 新增」按鈕，取代原本拖曳時才浮現的臨時佔位區；已排日期之間的中間空白天自動常駐顯示。

### 修正

- `GeoOutlineMap`：點選 attraction 時不再意外觸發 `GeoHotelSidebar`（移除多餘的 `fetchGeoPlacesNearby` 呼叫）。

### 文件

- `docs/ROUTING_ARCHITECTURE.md`：移除已刪除路由的記錄，新增「三之一、`/onagent/*`」路由表，修正 `srv.Routes()` 呼叫次數（三次→四次）。
- `docs/PUBLIC_LINK_FLOW.md`、`docs/PUBLIC_LINK_DESIGN.md`：`editable` 旗標章節改寫為目前實際行為（恆為唯讀），移除已失效的 `handlePublicAssist` 流程描述。
- `docs/ENTRY_WRITE_ORDER.md` 移至 `docs/archive/ENTRY_WRITE_ORDER-obsolete-want-flow-2026-08-11.md`（描述的整套 want 工具鏈已不存在，僅供歷史參考）；`docs/ENTRY_CLI_GUIDE.md` 更新交叉引用。
- `assistant_agent.go` 完整內容備份於 `docs/archive/assistant_agent-go-backup-2026-08-11.md`。
