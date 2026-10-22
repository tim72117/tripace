# Changelog

本專案先前未維護 CHANGELOG，此檔案從 v0.2.0 開始記錄——之前版本（v0.0.1、v0.1.0、v0.1.1）的異動請直接查對應 tag 的 commit 歷史，不回溯補寫。

## v0.39.0 — 2026-10-23

規劃地圖的前端大重構，加上新頁面「紅葉前線」：`/ai-plan`（手機與桌面）、登入後手機、登入後桌面四個入口改成同一組分層架構，同層同功能的元件用同檔名放在各自目錄（`home/plan-ai-sim/`、`phone/`、`desktop/`），並共用同一個資料存取層、統一繪製層與狀態 hook。新增 `/momiji-front`（含 SEO meta 與 sitemap）。**無資料庫結構變更；後端只動 SEO meta 對照表與路由白名單。** 前端的檔案改名、搬移、刪除都是內部符號，沒有對外公開的 API 破壞，但舊檔名（`PhoneContent`、`DesktopLayout`、`ExploreMap` 等）已不存在，查舊註解或文件請用新名稱。

### 新增

- **分層架構與同名元件**：每個入口都是 `Content`（狀態擁有者）→ `PlanLayout`（容器）→ `PlanOverlayLayout`（地圖層加疊加層外殼）→ `LivePlanLayer`（把規劃面板接上入口）→ `PlanMap`。DOM 骨架統一為 `data-slot` 契約（`plan-core/overlayDom.ts`、`OverlayShell.tsx`），各層共同介面定義在 `plan-core/layerContracts.ts` 與 `currentLocationContract.ts`，`layerContracts.test.tsx` 以型別斷言檢查（編譯期，單跑 vitest 不會失敗，需靠 `tsc`）。
- **資料存取層統一（`PlanAiDataSource`）**：地圖與規劃領域的後端查詢（地點詳情、照片、搜尋、景點區域、地理編碼）全部走注入的實例，登入版打 `/internal`、訪客版打 `/public`、假資料版給播放態；元件與 hook 不再自己挑端點。`TripPlanPage` 的 `dataSource` 與 `store` 改為必填。
- **統一繪製層擴充**：站點圓點、目前位置藍點、景點光暈、轉乘虛線、整條路線、搜尋結果、旅程 entry 全由 `useSharedDrawLayer` 掛上同一個宿主；首頁展示頁（`InteractiveExploreMap`）的光暈也改走這一層，原本只有它有的「主題卡開啟時隱藏、時間軸聚焦、只有聚焦的主題點顯示照片」三組狀態併進 `attractionGlowLayer`。
- **站點平移拆成兩件事**：`useFirstStopAutoPan`（首站自動平移，四個入口全部套用；`/ai-plan` 的模擬態與推論態各一個實例）與 `useStopPan`（卡片「移動到此」，只分手機與桌面）；`usePanWithFirstStopPriority` 讓首站平移優先於目前位置平移。
- **目前位置：同名同介面的三個實體**：`home/plan-ai-sim/`、`phone/`、`desktop/` 各一個 `useCurrentLocation`（`/ai-plan` 已授權才靜默取、不跳授權；登入後直接問），共用狀態機在 `plan-core/currentLocation.ts`；`useGeoOutlineMapState` 不再碰瀏覽器定位，只回報 `locationWanted`。
- **登入後手機的安全區**：疊加層的 `safe-area` 節點標出搜尋框下方到面板上方（top 120px、bottom 454px，數字沿用 `/ai-plan` 手機版的估算），首站與搜尋的平移落在這個範圍中心；面板收起（沒有面積）時 `panMapTo` 退回直接 `panTo`。
- **站點檢視狀態統一**：推論態與登入後都用 `usePlanStopsState` 與 `maskPlanStopsView`（空檢視即不繪製），選取為受控且雙向同步；`/ai-plan` 的模擬態（`useSimulatedStopsView`）與推論態各持有一個完整實例，交接時整個換掉。
- **整條路線由 `ROUTE_LINE_ENABLED` 控制四個入口**（原本只控制登入後桌面的開關 icon）：flag 關閉四處都不畫；開啟後登入後桌面由開關切換，`/ai-plan` 與登入後手機有站點就畫。
- **新頁面 `/momiji-front`（紅葉前線）**：依日本気象株式会社 2026 年紅葉見頃預測日內插的全日本變色動畫。SEO：`seo_meta.go` 的 `seoMetaByPath` 新增專屬 title／description／canonical，`sitemap.xml` 加入該路徑，頁面補 `WebPage` 與 `BreadcrumbList` JSON-LD，並加上視覺隱藏、與畫面同源的文字版摘要（標題、14 個都市的預測見頃日、資料來源）。伺服器路由白名單 `static.go` 同步新增。
- **測試**：`attractionGlowSupport.test.tsx`（光暈照片查詢與標籤避讓）、`PlanPhoneView.mapWiring.test.tsx`（地圖接線）、三個 `useCurrentLocation` 的測試、`useSimulatedStopsView.test.tsx`、`usePanWithFirstStopPriority` 與 `/momiji-front` 的 SEO 測試等；修復項目的測試都做過「拿掉修復會失敗」的驗證。

### 修正

- **交接後模擬劇本沒有停止**：`handover()` 沒有讓 `usePlanSimSocket` 的 `start` 變 false，劇本計時器繼續對已清空的時間軸插入站點與備註。
- **`/ai-plan` 探索半徑算錯**：`useMapViewport` 的 zoom 固定從 12 起算，`/ai-plan` 以 zoom 14 建圖，直接按「探索」會用 4 倍半徑查詢；改為以地圖目前的 zoom 與 bounds 播種。
- **探索查詢取消後舊回應會讓景點復活**：`runExploreQuery` 補上請求編號。
- **`useLocateWhenWanted` 在 `wanted` 快速切換時重複寫入並重複平移**：改用每次 effect 的執行編號丟棄舊結果。
- **首站平移被目前位置平移蓋掉**：位置晚到時不再把剛平移到首站的地圖拉走（藍點照常畫）。
- **`/ai-plan` 推論態沒有首站自動平移**，與登入後不一致；登入後桌面首站平移原本吃沒遮蔽的站點，面板沒打開就可能讓地圖跳走，改吃遮蔽後的站點。
- **`NativeMapBase` 建圖進行中依賴變動，地圖可能永遠不建**：取消時交還 `buildingRef` 旗標。
- **placeDetails 去重機制重複**：`geo-planning/placeDetailsCache.ts` 改用 `PlaceDetailsDedupe`（不同端點、不同政策，同一套機制）。

### 變更

- **檔案改名與搬移（舊名已不存在）**：`PhoneContent`／`DesktopLayout`／`DesktopRail`／`PhoneTabBar` 改為 `phone/Content`、`desktop/PlanLayout`、`desktop/Nav`、`phone/Nav` 等；`ExploreMap`、`GeoOutlinePanel`、`GeoCandidateSidebar`、`GeoHotelSidebar`、`PlanPhoneListDrawer` 等由 `PlanMap` 與 `geo-planning/{desktop,phone}/` 的 `ResultList`／`CandidateList` 取代；`home/plan-ai-sim/AIPlanTimelinePage.tsx` 由 `Content.tsx` 取代。
- **小檔案合併**：`geoSelectedKey`（含原 `geoMarkerSelection`）、`overlayDom`（含原 `composerSlot`）、`mapMarkerLayer/planStops`（原 `types`／`reducer`／`planStopsToPoints`）、`useMapEvents`（原 `useMapIdle`／`useMapViewport`）、`exploreQuery`（原 `exploreMapConstants`／`attractionQueryRadius`／`geoAreaSearchState`）、`plan-core/currentLocation`（原 `getCurrentPosition`／`useLocateWhenWanted`）。
- **刪除沒有正式使用端的死碼**：`useAttractionOverlays`、`useLiveStopsView`、`PlanStopsView`、`useAiPlanCurrentLocation`、`useCurrentLocationMarker`、`usePlanRouteLine`、`usePlanTransitHoverLine`、`usePlanRoutePolyline`、`useMapPoiClick`、`useSearchResultMarkers`、`useTripEntryMarkers`、`mapMarkerLayer/index.ts`、`geoAttractionClick`、`geoAttractionZoomState`、`MobileMapReveal`、`planSimScrollSource` 等，連同專屬測試。
- **文件**：`web/showcase-demo/public/marker-layers.html`（架構文件，含四張架構圖文字與對照表，新檔）、`docs/terminology.md`、`docs/frontend-click-actions.md`、`docs/audit-*.md` 同步更新；`audit-functional.md` 的 F47（光暈整批重建）移到已解決。
- 約 170 個檔案的過時註解更正為現況名稱。

### 其他

- **已知未處理（code review 清單）**：桌面規劃面板加寬到 560px 後資訊卡避讓值（368px）沒跟著改；手機「附近景點」地點卡選日期後可能靜默失敗（`handleScheduleFromDateSheet` 讀 `geo.infoContent`）；`suppressNextIdle` 旗標在目標已在中心時可能洩漏；`/ai-plan` 推論態固定用訪客版資料存取層；`placeDetailsCache` 沒有身分區分；三個 `Content` 沒有整合測試；`phone/` 與 `desktop/` 的 `useCurrentLocation` 目前內容相同。
- **既有失敗測試**：`PlacePanel.test.tsx` 的兩個日期選擇器案例（找不到特定日期按鈕）在本次異動前就失敗，與本次無關。
- **本次沒有在瀏覽器實測**；驗證只有型別檢查、單元測試與 `vite build`。

## v0.38.0 — 2026-10-21

新增一組可線上調整的 Google 地理成本設定（照片張數上限、照片有效天數、地點詳情快取時效），並把地點詳情（`places.get`）收斂成統一快取加並發去重；首頁手機版展示重做版面並加上單一圓形遮罩的進退場動畫。**含資料庫結構變更（新增 `geo_settings` 表、`place_details_cache` 新增 `photo_count` 欄位，皆由 `AutoMigrate` 只增不改，不需手動遷移）。無破壞性 API 變更，但 `tripace-cli` 的 `-api` 預設值改為正式機（見「變更」）。**

### 新增

- **可線上調整的地理數值設定（`internal/geosettings` ＋ `geo_settings` 表 ＋ 維運端點 ＋ CLI）**：跟 `internal/ratelimits`、`internal/fieldmasks` 同一個模式——成本相關、需要運維依實際用量調整的數值，定義只有登錄表一處。三項設定：`photoMaxCount`（每個地點最多補幾張照片，預設 3、範圍 1~20）、`photoExpiryDays`（照片資產有效天數，預設 7、範圍 1~30，只影響之後寫入的照片）、`placeDetailsCacheHours`（地點詳情快取時效，預設 24 小時、範圍 1~720）。端點 `GET /internal/maintenance/geo-settings`、`PATCH /internal/maintenance/geo-settings/{key}`，CLI `tripace-cli geo-setting list [-json]` 與 `geo-setting set -key KEY -value 數值`。資料庫沒有資料列就沿用登錄表預設值，所以新增一項設定只要在登錄表加一筆；範圍設下限（0 會把補圖或快取整個關掉卻看起來有開）與上限（Google 對 Places 內容的快取有合規限制），超出範圍的值在端點與執行中實例各擋一次。修改後這個實例立即生效，其他實例約 45 秒內跟上，不需重啟。`set` 用 `flag.Visit` 判斷 `-value` 有沒有給，0 與負數原樣送到後端取得精準錯誤訊息。
- **統一的地點詳情快取與並發去重（`internal/geo/details_cache.go`）**：起因是 10/19 帳單上 `GetPlace` 與請求數 1:1——「先讀快取再決定要不要打 Google」原本寫在 api 層的單一 handler，AI 版 `place-details-any` 只拿了「未命中」那一半，每個請求都打一次 `places.get`。把讀快取下沉到 `Client`，並提供行程內預設快取（`SetDefaultDetailsCache`）讓 `geo.New()` 自動帶上，任何呼叫端都不可能跳過。只快取文字欄位（名稱、地址、座標、評分、簡介）；照片參照是有時效的 resource name，不快取，需要參照的背景補圖走 `GetPlaceDetailsFresh`。同一個 placeID 同時有多個未命中請求時只打一次 Google，領頭者在獨立 goroutine 執行並有 `recover` 與 `defer` 清理，各請求者各自尊重自己的 context 逾時，`Fresh` 與一般查詢用不同的登記 key（避免補圖因為共用到「命中快取、沒有照片參照」的結果而把實際張數誤記成 0）。
- **記下地點在 Google 上的實際照片數（`place_details_cache.photo_count`）與補圖有效上限**：補圖判斷原本只看「上限範圍內每個索引有沒有新鮮的 `photo_assets`」，地點實際照片數少於上限時，多出來的索引永遠沒有紀錄、永遠被判成「缺」，每次請求都白打一次 `places.get` 什麼都補不到。現在記下實際張數（`NULL`＝沒查過、`0`＝確認沒有照片，語意不同），有效上限取「點擊次數決定的上限、實際張數、`photoMaxCount`」三者最小值，補到上限就不再補、也不再重讀地點資訊。`SetCachedPlaceDetails` 的 `DoUpdates` 刻意不含這欄，否則每次請求都會把記下的張數洗回 `NULL`。
- **前端 `placeDetails` 去重（`placeDetailsDedupe.ts`）**：詢問頁為每張候選卡查一次、使用者確認後時間軸又對同一個 `placeId` 查一次，後端每次請求還會累加點擊數。進行中的請求共用同一個 Promise，成功結果短期記憶（5 分鐘、上限 100 筆）；失敗（429／5xx）、`photoRefreshPending`、`found === false` 一律不記憶——前兩者的呼叫端依賴「再查一次會拿到新結果」。依 `scopeKey` 在模組層級共用，因為詢問頁與時間軸不一定拿到同一個資料來源實例。
- **showcase-demo 新增稽核頁「Google API 快取涵蓋範圍稽核」**：盤點後端所有會打 Google 的端點哪些有快取、哪些沒有，並記錄這批統一快取的實測數據與待決定的後續範圍。
- **首頁手機版展示（frameless 斷點）重做**：版面改用單層 CSS Grid 取代多層 flex 連鎖，修掉時間軸貼底 88px 死間隙與地圖欄寬溢出；`HorizontalPlanTimeline` 新增 `stackedLayout` prop，明確關閉內部 `margin-top: auto` 貼底機制，不再依賴外層容器的隱性配合；導覽列高度抽成共用的 `--site-nav-h` CSS 變數。地圖改畫在 `.sticky` 的獨立層，真正滿版並貼齊視窗頂端（穿到導覽列底下，不受避開導覽列的 `padding-top` 影響），無圓角、不顯示 9:41 與訊號電量裝飾列。
- **首頁手機版的單一圓形遮罩進退場**：`progress` 超過 `START_AT`（0.08）時，遮罩從畫面中心圓形展開顯示地圖與時間軸；超過 `END_AT`（0.98，即將離開 `.sticky` 區塊時）圓形收回。只用一個遮罩元素——圓內透明、圓外靠超大 `box-shadow`（spread 150vmax、顏色 `--paper`）填滿，洞的 `width/height` 過渡；靠 z-index（遮罩 2、地圖與時間軸 1、caption 3）蓋住地圖與時間軸而讓文字不受影響，不需要各自 `clip-path`（`clip-path` 只能裁自己與子孫，z-index 與 DOM 親子無關）。偏好減少動態時直接跳到終態。

### 修正

- **推論態橫向時間軸「AI 思考中」沒有呼吸點與骨架卡動畫**：`TripPlanPage.tsx` 呼叫 `HorizontalPlanTimeline` 時沒傳 `isGenerating`，預設 `false`，只有 composer 的 placeholder 會變成「AI 思考中」，跟 `/ai-plan` 播放態視覺不對齊。改為 `isGenerating={planAiChat.isThinking}`；`/ai-plan` 交接後的推論態（`LivePlanLayer`）複用同一個 `TripPlanPage`，一併涵蓋。縱向版 `PlanTimelineView` 原本就有傳，不受影響。
- **AI 版 `place-details-any` 每次請求都把 Google 存的地址與評分洗成「城市名／0」並重設 `fetched_at`**：命中已建檔景點時為了累加點擊數而用 `SetCachedPlaceDetails`（upsert）建列，覆蓋既有資料，讓地圖版的 24 小時重查永遠不會發生。新增 `EnsureCachedPlaceDetailsRow`，只在列不存在時建立、不覆蓋既有資料。
- **首頁手機版展示的文字在遮罩收起時看不見**：caption 原本固定白字，遮罩收起（頁面底色）的淺色模式下完全隱形。文字色與陰影改讀 `--caption-fg`／`--caption-shadow`，一律跟主題走（`--ink`、`--paper` 光暈），淺色模式遮罩打開後也是深色字。
- **首頁地圖遮罩在深色模式下不變暗**：遮罩用的 `--ios-bg` 深色覆寫只掛在 `.app-theme-root`（`/app` 登入後路由），首頁走的是 `.kyoto-bloom[data-theme]` 這組選擇器，兩套 token 互不相通。改用 `--paper`。
- **「編排行程」紅字疊在地圖上對比不足**：原本的白色 `text-shadow` 假設底色永遠偏深；改用同色票裡本來就有的提亮變體 `--vermilion-soft` 搭配跟主題走的陰影。
- **「往下捲動，看 AI 排出一天的行程」提示位置**：改在 `steps` 為空時顯示於時間軸那塊區域（絕對定位於 `.screen`、跟文字同層，不被遮罩蓋住），第一張卡片出現後消失；不再 `aria-hidden`，螢幕閱讀器讀得到操作提示。
- **視窗縮放跨過手機斷點時遮罩狀態沒有重新計算**：捲動 effect 的依賴補上 `isPhoneFrameless`。

### 變更

- **`tripace-cli` 的 `-api` 預設值從 `http://localhost:8080` 改為 `https://tripace.io`（正式機）**：CLI 的主要使用情境已經是對正式環境查詢與調整（`rate-limit`、`geo-setting` 等）。**本機開發需明確帶 `-api http://localhost:8080`；未帶時，包含 `trip reset`、`entry delete`、`attraction delete` 這類會刪資料的指令也會預設打到正式環境**（已確認接受這個取捨）。`defaultAPIURL` 常數統一了 `main.go` 全域旗標與 `notify`、`geocode` 兩個子命令各自重複定義的預設值，usage 文字與 `tripace-cli` skill 文件同步更新。`README.md` 與 `SKILL.md` 裡指向已 301 轉址舊網域 `tripace.shuttle.tools` 的引用改為 `tripace.io`。
- **`/ai-plan` 播放態的詢問頁候選卡片改走真資料**：候選 `placeId` 改為資料庫景點固定的 Google Place ID，名稱與照片由 `createPlanAiPublicDataSource` → `/public/geo/plan-ai/place-details-any` 查回，跟推論態同一條路；查詢失敗時降級成劇本帶的名稱、沒有照片。時間軸那段的午餐站仍是假資料（阿堂鹹粥／福記肉圓），與詢問頁選的阿蓮牛肉湯不是同一家，兩邊敘事暫時對不上。
- **首頁標題文案**：「不只是排行程，而是與你一起規劃」改為「不只是排滿行程，而是與你一起規劃」（桌面版 header 與手機版 caption 兩處）。
- **移除沒有呼叫端的背景照片預熱函式**：`geo_outline.go` 移除 `warmPlaceDetailsPhotoCache` 與其逾時常數 `backgroundPhotoWarmTimeout`（`handleGeoPlacesNearby`／`handleGeoGeocode` 早已不在回應裡帶照片）。

### 其他

- **Google Places API 層限流的運行時設定調整（資料庫設定，非程式碼變更，已記於 v0.37.1）**：`public.placeSearch`、`public.nearbyAttractionSearch` 兩條 plan-ai 端點在正式機改為 60 秒／60 次、每日上限 500；本次沒有新增程式碼變更。

## v0.37.1 — 2026-10-21

`/ai-plan` 展示頁新增 1024px 寬螢幕側欄版面（地圖維持滿版，側欄與 composer 疊加顯示），詢問頁候選卡片在寬螢幕下改為縱向堆疊列表，並修正時間軸的捲軸樣式與桌面疊加版面的導覽列留白問題。無破壞性變更、無資料庫結構變更。

### 新增

- **寬螢幕（≥1024px）側欄版面 `PlanOverlayPanelWide`**：`/ai-plan` 展示頁在寬螢幕下改用這個獨立側欄外殼（`useIsWide` 判斷斷點），取代原本沿用桌面疊加版面 `PlanOverlayPanel` 的做法。地圖容器維持 `absolute` 鋪滿整個頁面不被擠壓（使用者明確要求「地圖一樣要滿版」），側欄疊加貼齊右緣、composer 插槽橫跨整頁貼底置中——都是疊加模式，不是 flex 擠壓。側欄幾何常數（側欄寬度、頂部留白、composer 佔用高度）抽成 `planOverlayGeometry.ts` 單一來源，供 `AIPlanTimelinePage.tsx` 的安全可視區矩形與 `WideLayoutDebugOverlay.tsx` 的除錯疊圖共用——這份數值先前各自手寫一份，同一輪改動裡已經造成兩次真實漂移（側欄頂部留白漏改一次、底部計算基準跟除錯框線不同步）。
- **`?debugSafeArea=1` 新增側欄/composer 邊界疊圖 `WideLayoutDebugOverlay`**：標示寬螢幕側欄與 composer 插槽的實際範圍，跟既有的 `SafeAreaDebugOverlay`（畫地圖安全可視區的計算結果）互補，`AIPlanTimelinePage.tsx` 的 `DEBUG_SAFE_AREA` 開關同時渲染兩者。
- **`throttleGeoQueryByIP` 的真並發測試**：既有測試全部是單一 goroutine 依序呼叫，從未驗證過 `RateLimiter` 內部的 `sync.Mutex` 保護在真正並發下是否確實生效。新增 `TestThrottleGeoQueryByIP_ConcurrentRequests_ExactlyMaxCallsAllowed`，同一個 IP 併發送出兩倍配額的請求，斷言放行次數精確等於配額上限（多了代表計數器有競態視窗）、放行加拒絕精確等於總請求數（有請求在併發中「消失」代表有 panic 被吞掉卻沒計數），`-race` 跑過確認沒有未同步的記憶體存取。
- **詢問頁候選卡片的 `stacked` 模式**：`AskPage`／`ScriptedAskPage` 新增 `stacked` prop，寬螢幕側欄下四種詢問項目（候選景點、國家、城市、交通方式）改成縱向堆疊的橫式列表，取代橫向捲動小卡——側欄欄位不寬但可以向下延伸，縱向清單更適合這個版面。沒有照片時顯示通用的地圖釘子佔位圖（`MapPin`，跟 `CountryPanel`／`CityPanel` 既有的 `.regionIcon` 共用同一顆圖示，不分景點類型），維持跟有照片項目一致的版面對齊——橫向捲動模式本身因為卡片固定尺寸已經「有留空間」，只在 stacked 模式才需要這個佔位圖。手機版（橫向捲動）完全不受影響，`stacked` 省略時維持原行為。

### 修正

- **寬螢幕側欄內容緊貼視窗頂端，跟漂浮導覽列的按鈕幾乎疊在一起**：桌面疊加版面 `PlanOverlayPanel`、寬螢幕側欄 `PlanOverlayPanelWide` 的 `.panel` 原本都是 `top: 0`，而漂浮導覽列（`SiteNavButtons`，`position: fixed`）蓋在整個頁面最上層——側欄第一張候選卡片因此直接貼齊視窗頂端，跟「登入」「切換日夜模式」按鈕視覺上擁擠、沒有分隔空間。兩者都改成 `top: 72px`（沿用手機版 `.navSpacer` 既有的導覽列高度估算值），地圖安全可視區矩形同步排除這段範圍，避免地圖平移的目標點落在導覽列底下被蓋住的位置。
- **寬螢幕側欄內容跟底部 composer 輸入框重疊**：`PlanOverlayPanelWide` 的 `.panel` 原本 `bottom: 0`，composer 插槽（`position: absolute`、貼底置中）疊在側欄上方，候選清單底部幾項與「不用了」按鈕因此被輸入框蓋住一部分。改成 `bottom: 86px`（composer 貼底間距 20px ＋ 實機量測的插槽真實高度 66px），地圖安全可視區矩形同步排除這段底部範圍。
- **時間軸側欄出現難看的原生橫向捲軸**：寬螢幕側欄（560px）的可用寬度比交通段文字 pill（`.transitPill`，刻意用 `overflow: visible` 讓內容疊在卡片旁邊顯示，是既有設計）假設的版面寬度窄一截，溢出的 pill 把 `.timelineScroll` 的 `scrollWidth` 撐大過 `clientWidth`，觸發瀏覽器原生橫向捲軸。新增 `overflow-x: hidden` 只裁掉邊界外的溢出內容，不影響 pill 在卡片範圍內的正常顯示。
- **時間軸直向捲軸過粗，跟深色設計不搭**：新增 `scrollbar-width: thin` 搭配 `::-webkit-scrollbar` 系列偽元素（對齊既有的 `TripPlanPage.module.css` `.compactScroll` 做法），只改細視覺粗細與配色，不隱藏捲軸本身——桌面版使用者仍需要捲軸提示「還有更多內容」。
- **選完感興趣地點送出的提示文字過長，且跟 `thought.md` 的規則重複維護**：原本在 `TripPlanPage.tsx` 內嵌一長串「以選取地點為依據、補上順路景點與用餐休息、不要推估步調」的完整指示，簡化成一句單純的告知「我已經選好感興趣的地點了，請幫我安排行程。」。這些規則（何時該查 `get_user_selection`、排行程的步調與完整度基準）改由 `thought.md`（agent 的 system prompt）統一管理，不為這一個特定觸發路徑重複寫一次又臭又長的 inline 指示；代價是若 `thought.md` 日後沒有同步維護這些規則，這裡的極簡文案不會再提醒 LLM。
- **寬螢幕側欄下，桌面非 wide 版面（768px~1023px）意外觸發地圖自動置中**：補上 `isDesktop && !isWide` 排除條件與 `mapReady`／`mapRef` 就緒檢查——這個版面區間原本透過 `panToStopId` 的 `isDesktop || handedOver` 整條排除，改成直接呼叫 `panToWithinSafeArea` 後遺漏了對應排除，雖然安全區元素為 `null` 時會退化成普通 `panTo` 不會出錯，但仍是未經設計確認的鏡頭移動（code review 發現）。

### 其他

- **Google Places API 層限流運行時設定調整（資料庫設定，非程式碼變更）**：排查瀏覽器出現大量「查詢過於頻繁」429 錯誤，查出根因是 `places.get`（取得地點詳細資訊）的限流設定被人手動覆寫成 `60 秒/1 次`（程式碼預設值是 300 次，見 `docs/audit-place-photo-cost-control-2026-09.md`），而不是常見的「視窗過期」表面解釋。用 `tripace-cli rate-limit set` 改回 `60 秒/60 次`；順便把 `places.photoMedia`（取得地點照片）從原值調整為 `60 秒/10 次`。這兩個端點的限流規則存在 `geo_rate_limits` 資料表、45 秒內熱重載生效，不需要重新部署。

`/ai-plan` 從「看展示」到「自己排一趟」這條路徑補上入口與韌性（三層詢問頁、查詢失敗的重試），把限流與 Google Places 欄位兩組成本相關的設定從硬編碼改成可線上調整，並讓行程地圖支援夜間模式。無破壞性變更，**含資料庫結構變更（新增 `geo_field_masks` 表）**。

### 新增

- **`/ai-plan` 推論態的三層詢問頁（`AskPage`）**：使用者交接到真實 AI 之後，原本是一片空的時間軸、等他自己打字描述需求——那是最難起頭的狀態。改成一進來就問「要去哪個國家？」，接著是城市、再接著是該城市的候選景點（`travelRegionData.ts` 內建 22 國的固定「國家 → 熱門城市」兩層清單，城市帶經緯度供 Nearby Search 查景點）。三層都由前端自己接續，不需要 LLM 介入每一步。選項用前端內建的固定清單而不是讓 LLM 自己發明候選，避免每次列出的國家／城市不一致或出現使用者用不到的奇怪地名。
- **選完景點送出的 prompt 刻意不帶地點名稱**：改成在 prompt 裡叫 LLM 自己呼叫 `get_user_selection` 查。第一版是把名稱串進 prompt，但名稱不是穩定識別碼——LLM 拿到字串還是得自己 `place-search` 一次才能回推 `placeId`（實機觀察到的真實行為），而工具回的是 `placeId` ＋ `name` 齊備，可以直接 `add_attraction`。另一個理由是選擇內容寫進 prompt 就固定在對話歷史裡了，之後使用者改了選擇，歷史裡那句話仍然成立卻已經過時。
- **詢問頁只在「沒有任何站點」時開啟**：觸發條件不是「剛掛載」而是「目前沒有行程」，所以 effect 從只跑一次改成盯著 `stopCount`——掛載時時間軸是空的會開，行程被刪到空時也會開（三條刪除路徑都會讓 `stopCount` 歸零，不需要在每一處各自加觸發）。已經有行程時不開：使用者是回來繼續看的，不該被全幅選單蓋住。
- **`get_ui_state` 工具與 `uiStateStore`**：LLM 開完選單那一輪就結束了（工具不等待），下一輪被叫起來時無從得知使用者卡在哪一步——是還沒選、選到一半、還是早就選完了。沒有這份資訊它只能猜，或重複呼叫同一支開選單的工具（實機踩過的迴圈）。這支回答「現在在看什麼畫面、畫面上有哪些選項」，跟 `get_user_selection`（最近一次**完成**的選擇）、`get_attraction_pool`（這次對話查過哪些景點）回答的是不同問題，刻意不合併。是 module 層單一實例而非 React state：讀取方是 `AgentBridge` 的工具 handler，跑在 WebSocket `onmessage` 回呼裡、拿不到 state 最新值（沿用 `attractionPoolStore` 的同一解法）。刻意不持久化——描述的是「此刻的畫面」，重整後畫面本來就重建了。
- **播放態專用的 `ScriptedAskPage`（置換，不是在正式元件加分支）**：劇本指定選哪幾張、依序演出點擊特效、時間到自己送出。兩者只有「長得一樣」這點重疊，行為是相反的——正式版的勾選是使用者的輸入，播放態的勾選是劇本的輸出。塞進同一個元件會讓它同時裝著兩套 state 與兩條時間線，而正式路徑是會上線的功能，每多一條分支就多一份真實使用者會踩到的路徑要驗證。共用的只有 `AskPage.module.css`（外殼必須一模一樣，否則播放態演的就不是真實畫面）。
- **`PlanNodeData.failed` 與兩個時間軸的重試入口**：`add_attraction` 插入節點時只有 `placeId`、沒有名稱，所以 `name` 先填佔位字串「查詢中…」——那個值的前提是「查詢一定會完成並覆蓋它」。失敗時前提不成立：原本只寫 `{ loading: false }`，卡片就停在「查詢中…」上、連轉圈提示都沒了，使用者既不知道那是哪裡也沒有重來的入口。現在縱向與橫向時間軸都顯示錯誤狀態與重試按鈕，掛載時也會掃出 failed 的站點自動重查。`failed` 會被持久化，刻意跟 `loading`／`removing` 相反——那兩個是只在這次 session 有意義的暫態，`failed` 是已經定案的結果。
- **判準抽成領域層的 `stopLookupFailed`**：「要不要顯示錯誤」（兩個時間軸元件）與「要不要重查」（掛載重試）必須用同一個判準，不一致會出現「畫面說失敗但不會自動重試」或反之。判準不只看 `failed`，還看「有 `placeId` 但座標沒落地」：429 限流路徑刻意維持 `loading: true` 且不設 `failed`，而存檔時 `sanitizeNode` 會剝掉 `loading`，兩者相撞的結果是重整後出現「既不是 loading、也不是 failed、name 停在佔位字串」的孤兒節點。用座標而不是 `name` 當判準：`name` 在插入當下就有佔位字串，分不出「查到了」或「還沒查」。
- **限流規則集中成單一登錄表（`internal/ratelimits`）**：在這之前，一條限流規則的資訊散在四個地方——CLI flag 預設值、`geo_rate_limit.go` 的 seeding 與重讀 `switch/case`、`api.go` 裡 plan-ai 兩條的硬編碼 `SetLimitForKey`、`geo/places.go` 的 `RateLimitConfig` 欄位，而 endpoint key 是各處重複的字串字面值。新增一條規則要同時改四處，漏一處就靜默失效（key 不相符時設定的是一條規則、查的是另一條，等於完全沒有限流）。現在七條規則的 endpoint key、預設視窗、預設上限、每日額度、說明文字與「超過上限時呼叫端會看到什麼」全部集中在 `Registry`，四處改成共同讀它。
- **`plan-ai` 兩支公開端點納入可設定範圍**：`public.placeSearch` 與 `public.nearbyAttractionSearch` 正是「散在四處、漏一處」的實例——資料表、後台管理介面、熱重載迴圈全都沒有它們，它們是 `api.New` 裡的硬編碼字面值，要調整只能改程式碼重新部署。現在這兩條跟 Google 那五條一樣吃資料表、後台與熱重載，45 秒內生效、不需重啟。
- **限流的維運端點與 CLI `rate-limit` 子命令**：新增 `GET`／`PATCH /internal/maintenance/rate-limits`，以及 `tripace-cli rate-limit list [-json]` 與 `rate-limit set -endpoint KEY [-window 秒 | -window-ms 毫秒] [-max-calls N] [-daily-max N]`。在這之前要知道目前生效的限流只能讀程式碼，而程式碼裡的字面值未必等於實際生效值（後台可能已經改過資料庫）。`list` 標示每條規則是「已自訂」還是仍是預設值；`set` 沒帶的欄位維持目前值、不會被零值覆寫成「不限制」，`-window-ms` 不滿整秒直接拒絕並說明原因，不靜默四捨五入成 0 秒（等於關掉限流）或 1 秒（悄悄把保護放寬一倍）。
- **`ratelimits.RefreshInterval`**：重讀間隔的 45 秒原本在三處各寫死一份（`cmd/server` 的常數、維運端點回應的 `appliesWithinSec`、CLI 列表結尾那行「約 45 秒內生效」）。有人調整重讀間隔時，端點與 CLI 會繼續回報舊數字，運維照著等卻沒生效，是難查的誤導。
- **Google Places field mask 可線上設定（`internal/fieldmasks` ＋ `geo_field_masks` 表 ＋ CLI）**：Places API 用 `X-Goog-FieldMask` 指定回傳欄位，而**計費層級由請求裡最高層級的那一個欄位決定**，不是各欄位的總和。`placeDetails` 這個情境原本固定帶 `editorialSummary`，單這一個欄位就讓每一次呼叫都按最貴的 Enterprise ＋ Atmosphere 計費，即使那次查詢其實只需要名稱與座標。這些常數原本寫死在 `geo/places.go`，調整只能改程式碼重新部署。新增 `internal/fieldmasks` 當單一登錄表（四個查詢情境，每個欄位標註計費層級與「拿掉會失去什麼」），搭配資料表、維運端點與 `tripace-cli field-mask list`／`field-mask set -scenario KEY -fields a,b,c`。刻意跟 `internal/ratelimits` 同構，因為兩者是同一類東西：成本相關、需要運維依實際用量調整、不該寫死在程式碼裡。
- **field mask 設定端點三種驗證全部拒絕而非靜默修正**：情境 key 不在登錄表裡會拒絕（寫一個沒有任何呼叫處會讀的 key 只會讓表多一列永遠不生效的設定，操作者卻以為成功了）；欄位名稱不在該情境的登錄表裡會拒絕（送 Google 不認得的欄位會讓整支 API 回 400，那個情境的查詢全部失敗）；必填欄位（名稱、座標）不可移除。必填欄位全部限定 Essentials 級——「必填」的前提是「留著不影響價格」，有測試守住這個不變式。
- **訪客公開存取層 `planAiPublicDataSource`**：`?skipDemo=1` 讓未登入訪客直接進真實 AI 推論，但原本固定打 `/internal/*` 一律 401（實機回報照片連噴 8 次、交通 2 次）。新增這第三份 `PlanAiDataSource` 實作（展示頁假資料／訪客公開端點／登入版 internal），而不是在既有實作裡加 `cfg.token ? a : b`——「訪客模式」是一種完整的資料來源，不是每個方法各自的分岔。對齊 `PlanTimelineStore` 的既有模式。
- **手繪配色的行程地圖支援夜間模式**：手繪配色走的是 inline styles、不帶 `mapId`，而 Google 的 `colorScheme`（暗色）只對帶 `mapId` 的向量地圖生效——所以這些行程在頁面切到夜間模式時，地圖仍是整片淺米色。新增 `HAND_DRAWN_DARK_COLORS` 與 `HAND_DRAWN_MAP_STYLE_DARK`，依 theme 切換日夜兩份 styles。暗色版不是另寫一份規則，而是把淺色版的每個顏色依表替換：規則的結構（哪些地物顯示／隱藏、線條粗細）完全一致，只有顏色不同，避免日夜兩版的資訊量悄悄分岔。`handDrawnMapStyle.test.ts` 守住這個不變式——淺色版新增了表裡沒有的顏色就會失敗。另外新增 `.scrollSheetDark`／`.mapleSheetDark`：淺米色的羊皮紙漸層疊在暗色地圖上會變成一條突兀的亮邊。
- **新增範例行程「京都三大經典・燒肉吃到飽五日」**：`registry.ts` 是 `import.meta.glob` 自動收錄，新增一份範例行程不需要改註冊檔。

### 修正

- **任何登入使用者都能改限流設定**：兩支新端點掛在 `internalMux` 上，而 `internalAuth` 只驗 JWT 簽章、不判斷角色——任何一般使用者的 token 都能通過，把 `maxCalls` 或 `dailyMax` 調到極大值就等於直接拆掉 Google API 的計費保護。補上 `requireRateLimitAdmin`（沿用既有的 email 白名單模式，不另外發明角色模型）。對照組佐證這是疏漏而非刻意：adminconsole 的同功能端點本來就有 `withAdmin` 把關。刻意不把整個 `internalMux` 改成要管理權限——前端一般使用者依賴其中的 `/internal/geo/*`、`/internal/plan-ai/*`。
- **500ms 的規則被 seeding 寫成 0 秒，視窗靜默變成設計值的兩倍**：seeding 原本用 `int(window/time.Second)` 轉換，`int(500*time.Millisecond/time.Second)` 截斷成 0，而 `public.nearbyAttractionSearch` 的預設視窗正是 500ms。0 不會讓限流失效（`SetLimitForKey` 對 `window <= 0` 會夾成 1 秒），但造成兩個靜默錯誤：實際生效視窗變成 1 秒而非設計的 500ms，且 CLI／後台會顯示「視窗 0 秒」、看起來像沒有限制。新增 `windowSecForStore` 進位成 1 秒並記 log。另外 seeding「已有資料列就完全不動」的語意代表既有環境已經寫壞的那一列不會被自動修正，所以 `applyRateLimitsFromStore` 也把 `WindowSec <= 0` 視為無效值退回預設並記 log——沒有這道守衛，那些環境每 45 秒就會把 0 套進去再被夾成 1 秒，永久固化。
- **訪客模式每一段路程顯示「🚶 0 分」的假交通資訊**：公開端點沒有 `transit-estimate`，`planAiPublicDataSource` 原本 resolve 一組空值 `{ mode: '', minutes: 0, distance: '' }`，以為那等同「沒有交通資訊」。實際上呼叫端走的是成功分支、無條件寫進 `transitFromPrev`，而渲染端的判斷是 `transit.minutes != null`——0 會通過。結果比原本 401 時什麼都不顯示更糟。改成 reject，呼叫端既有的 `.catch` 會把 `transitFromPrev` 清成 `undefined`，膠囊完全不渲染。
- **純文字回覆會瞬間蓋掉正在等待操作的候選卡片詢問頁**：`useAskPageBridge` 原本假設「呼叫端都是 await 完成才呼叫下一次 `openAskPage`」，但收到純文字回覆時會呼叫 `openAskPage({ text })`、完全不 await。實機重現：LLM 開出候選卡片後緊接著送出一則文字回覆，第二次呼叫用新的 resolve 覆蓋掉 ref，候選卡片瞬間被文字氣泡取代——使用者永遠看不到候選、那個工具呼叫的 Promise 永遠不會 resolve，整個對話卡住。改為已有 pending 時忽略新呼叫。
- **地圖圖層在日夜切換後消失**：`NativeMapBase` 在 `theme`／`styles` 變動時會重建 `google.maps.Map` 實例，舊實例上的圖層隨之失效。但 `mapReady` 是布林值，重建過程中間的 `false` 可能被 React 18 的自動批次處理合併掉，只靠它當依賴會讓 effect 誤判成「沒有變化」而不重跑。`usePlanStopMarkers` 早有 `mapVersion` 這個參數，但 `usePlanRoutePolyline` 與兩支線圖層 hook 沒有，呼叫端也沒傳——夜間模式一旦接上，marker 與路徑線在切換主題後就會消失，而且因為 `stopsKey`／`enabled` 都沒變，使用者不關掉再開就叫不回來。
- **`plan-ai` 工具說明與 `thought.md` 多處互相矛盾的指示**：LLM 遇到矛盾會隨機挑一套。`thought.md` 重新分章（行為準則／行程安排方式／工具使用，一個工具一節／回應方式），新增的「行程安排方式」章節講一份好的行程長什麼樣（沒說長度就排一整天、一天 5~7 站的密度基準、地理順路、用餐時段、動靜交錯）。清掉的矛盾包括：「開選單那一輪可以簡短帶過在做什麼」vs「不要輸出任何文字」（前者是 `reason` 參數出現前的寫法）、`get_user_selection.yaml` 還留著已拆分的 `ask_travel_region`、四支開選單 yaml 仍寫「進入等待使用者回應的狀態」（工具其實不等待）、`open_ask_page.yaml` 說「訊息會帶著他勾選的地點」但前端刻意不帶、`ask_travel_country.yaml` 寫「全部 24 個」實際是 22 個。
- **`add_attraction` 的前置查詢從「不確定時才查」改為強制**：`add_attraction.yaml` 與 `list_itinerary.yaml` 的 description 改成「每一次呼叫 `add_attraction` 之前都必須先呼叫 `list_itinerary`」。參數 schema 沒動，不是 API 變更，但這是 agent 行為的實質改動。原本的寫法讓 LLM 憑記憶猜 `anchorId`，而使用者隨時可以自己刪站、拖曳改時間。
- **移除 `DestinationPrompt`（`/app` 的「想去哪裡？」對話氣泡）**：feature flag 原本預設關閉、從未啟用（`VITE_FEATURE_DESTINATION_PROMPT` 從未寫進 `.env.example`，`DesktopLayout.tsx` 也從未引用那個常數，v0.36.0 條目自己記載「開啟沒有效果」）。它跟這次做的 `AskPage` 詢問頁在問同一件事，兩套並存只會讓同一個產品問題有兩個答案。連帶移除它的孤兒依賴：`useTypewriter`、`useDeferredPromptSender`、`panToCity`，以及兩處只剩寫入沒有讀取的 `mapReady` state。
- **accent（紅）底上的文字在深色模式下變成深褐字配亮鮭紅底**：全站有 10 處用 `var(--ios-card)`／`var(--ios-bg)` 當 accent 底上的文字色，那兩個 token 會跟著主題翻。統一改為固定白字。深色模式白字對比 3.04:1 仍低於 WCAG AA，是評估後接受的取捨：`--color-accent` 同時扛 43 處文字色（紅字鋪深底，要夠亮）與 30 處底色（白字鋪紅底，要夠暗），調暗只是把問題從 30 處搬到 43 處，真要兩邊合格得把底色與文字色拆成兩個 token。
- **CLI 的哨兵值把不合法輸入靜默吞掉**：原本用哨兵值（0／-1）反推哪些旗標有給，`-max-calls -5`（打錯字、或 shell 把後續參數吃進來）不會送出請求，使用者看到的是「至少要指定一項要修改的值」，會以為自己漏打旗標而不是值不合法；後端那句精準的錯誤訊息永遠到不了使用者眼前。改用 `fs.Visit` 判斷旗標是否真的出現在命令列，哨兵值整套移除，驗證一律交給後端。
- **`rate-limit list` 表格混用資料庫值與程式碼預設值**：`windowSec` 為 0 時會印登錄表的 500ms、`CUSTOM` 欄還標著「已自訂」，等於把「設定壞了」顯示成「設定正常」——正好掩蓋上面那個 bug。改成同一欄只來自單一來源，0 印成「0（異常）」。
- **CLI 表格中文表頭造成欄位錯位**：`%-32s` 這類寬度按 byte 數補空白，中文字元佔 3 bytes 但終端機只顯示 2 格，中文表頭會比對應的資料欄少佔顯示格、誤差逐欄累積（實測偏左約 6 格）。表頭一律改用 ASCII。
- **`ExploreMap.tsx` 的 import 指向未進版控的檔案**：`usePlanRouteLine.ts` 與 `usePlanTransitHoverLine.ts` 兩個檔案從未進版控，但已經在版控裡的 `ExploreMap.tsx` 正 import 它們——單獨 checkout 編譯不過，`ExploreMap.searchEntries.test.tsx` 也因此整個載不起來。這次一併補上。
- **交通膠囊虛線在內容沒變時重複重畫**：`usePlanTransitHoverLine` 原本直接把 `stops` 陣列放進依賴陣列，每次父層 render 都是新參照。改用內容摘要字串 `stopsKey`，對齊隔壁兩支 hook 的既有做法。
- **`jozankei-1day` 移除楓葉相框**：不設 `borderStyle`，並把 `playfulUI` 關成 `false`——只拿掉 `borderStyle` 的話外框會退回預設的寶藏地圖（指北針＋羊皮紙）。`borderStyle: 'maple-leaf'` 目前沒有任何行程使用，元件保留。
- **移除打不開的 `ScrollTimelineDemoPage`**：檔頭宣稱路由 `/demo/scroll-timeline`，但那條路由從未註冊，頁面沒有任何進入點。`ScrollTimeline` 元件本身是活的，四個城市頁與 blog 文章頁都在用。
- **過時的註解與文件**：`LivePlanLayer.tsx` 還寫著「訪客工具呼叫會拿到 401」（本版已修掉）；`chatButtonOverlay` 在 `ExploreMap`／`GeoOutlinePanel`／`DesktopLayout.module.css` 的說明都還說它載著已移除的氣泡，`DesktopLayout.tsx` 另有一段 15 行、緊鄰不存在的 prop 的孤兒註解；`api.go` 的「目前是這三支」、`maintenance.go` 的「這兩支端點」、`places.go` 的「全部四個」數量陳述都已落後；`docs/routing-architecture.md` 補上限流與 field mask 的維運路由與 `/public/plan-ai/*` 五支；`tripace-cli` 的 SKILL.md 寫死了另一台 macOS 機器的絕對路徑，改為相對路徑並說明 `bin/` 是本機產物。

### 已知問題

- **`/ai-plan` 的地圖標記在日夜切換後消失**：`mapVersion` 的斷鏈補進了 `usePlanStopMarkers`（`/app` 的路徑）與 `usePlanRoutePolyline`，但 `/ai-plan` 用的是 `useMapMarkerLayer`，同樣的斷鏈還在。
- **自動重試有兩個缺口**：多個實例同時掛載時會對同一站重複發出自動重試；`resyncFromStorage` 讀回來的 `failed` 節點不會自動重查（掛載重試的 effect 是空依賴陣列、只在掛載時跑一次）。
- **`get_ui_state.yaml` 沒說明 explore（探查）模式的 `options` 與 `selected` 一律為空**：LLM 讀到空陣列可能誤判為「使用者什麼都沒選」。
- **既有的測試紅項**：`PlacePanel` 2 項、`ExploreMap.searchEntries` 2 項。後者原本因為上述 import 斷鏈整檔載不起來，修掉斷鏈後才真的執行，然後撞上既有的地圖 mock 缺口（`useTripEntryMarkers.ts` 的 `mapRef.current.getDiv` 在 mock 上不存在）。

### 部署注意

- **新增 `geo_field_masks` 表**：啟動時會對登錄表裡每個情境檢查是否已有資料列，沒有才用程式碼預設值寫入一筆（已有資料列完全不動，避免每次重啟都蓋掉運維調整過的設定）。
- **`placeDetails` 情境預設仍含 `editorialSummary`**，也就是仍按最貴的 Enterprise ＋ Atmosphere 層級計費。要降一檔需執行 `tripace-cli field-mask set -scenario placeDetails -fields <不含 editorialSummary 的清單>`，代價是景點卡失去 Google 編輯撰寫的簡介文字。
- **`server/tools/plan-ai/*.yaml` 與 `thought.md` 要重新推上 onagent 平台才會生效**（`onagent tool create`／`onagent app thought set`）：本版改了多支 tool description（`add_attraction`、`list_itinerary`、`get_user_selection`、`ask_travel_country`、`ask_travel_city`、`open_ask_page` 等）與 `thought.md`，倉庫裡的檔案與平台上的版本在推送前不一致。

## v0.36.0 — 2026-10-19

首頁 AI 編排行程小展示抽出獨立的劇本與版面外殼，與 `/ai-plan` 完整展示頁解耦。無破壞性變更，不含資料庫結構變更。

### 新增

- **小展示專用的劇本與推論層**：新增 `demoScript.ts`（只取前 5 站）、`demoScrollSource.ts`（捲動驅動）、`demoSimSource.ts`（計時器驅動），不再共用 `/ai-plan` 的 `PLAN_SIM_SCRIPT` 與 `planSim*Source`。兩邊的內容與節奏之後可以各自調整，改一邊不會牽動另一邊。
- **`PhoneDemoLayout`**：手機展示框（390×844 寫死尺寸）專用的版面外殼，含狀態列、caption、時間軸三個插槽。刻意不跟 `/ai-plan` 的 `PlanDemoLayout`（整頁 100dvh）共用——兩者的座標系與尺寸來源不同。
- **`docs/terminology.md` 新增「/ai-plan 展示頁三階段」**：定調小展示／播放態／推論態三個詞，避免討論時混用。

### 修正

- **首頁展示的手機外框沒有照設計放大**：`HEADER_RESERVED_PX` 是「eyebrow + 標題 + 說明都在外框上方」時估的 260px，但那三段文字後來陸續搬進手機畫面內，外框上方只剩漂浮 nav 列。超估讓 `phoneScale` 被壓到 0.76（註解當時還寫著「通常落在 0.95~1.1」）。降到 120 後實測 0.93。
- **小展示捲動開頭約一個螢幕高度完全沒有畫面變化**：`DEMO_SCRIPT` 開頭複製了 `PLAN_SIM_SCRIPT` 的 `open_ask_page`，但小展示的畫面沒有接 `AskPage` 的三個 prop，詢問頁永遠不渲染——那一則只是讓捲動多出兩個空轉步驟（約佔總進度 10%）。移除後小展示也不再依賴 `PlanAction` 的 `'open_ask_page'` 型別擴充，這條線可以獨立於 `/ai-plan` 的改動之外。
- **「試試看」按鈕文字在深色模式下看不清楚**：原本用 `var(--ios-bg)` 當文字色，那是頁面底色，深色模式下變成深字配深色的 accent 底。改成固定白字。
- **`START_AT` 的推導註解差了 4 倍**：寫的是 `SCROLL_SPAN_VH` 還等於 300 時的算式，那之後它調成 900 卻沒回頭改——而那段推導正是調整這個值時唯一的依據。
- **移除 `.desc` 死 CSS**：對應的 JSX 已在文字搬進手機畫面時刪除，規則留著沒清，註解還描述著早就不存在的「狀態列」行為。

## v0.35.1 — 2026-10-16

修正 `/ai-plan` 交接到真實 AI 之後的三個缺陷（地圖無站點、主題點無法展開、AI 回覆無處顯示），並把讀取層做成可抽換。無破壞性變更，不含資料庫結構變更。

### 新增

- **讀取層可抽換（`PlanAiDataSource`）**：介面補上選填的 `photoAssets`（原本照片是 `/app` 自己直接呼叫 `fetchGeoPlacePhotoAssets`，展示頁則寫死在假資料裡，兩邊各走各的），並新增真後端實作 `createPlanAiApiDataSource(cfg)`。`usePlanSimSocket` 新增選填的第三參數 `dataSource`（預設假資料），原本寫死的 `planAiFakeDataSource` 呼叫全部改為注入。目前尚無呼叫端傳入真後端實作，這條路徑是備而不用的框架。
- **手機版交接後顯示 AI 回覆的對話泡泡**：橫向時間軸原本只渲染 `type === 'stop'` 的節點，交接到真實 AI 之後 onagent 回覆的文字無處顯示。改由 `HorizontalPlanTimeline` 透過新的選填 prop `onLatestMessageChange` 回報最新訊息，`TripPlanPage` 渲染在 `ComposerPortal` 內、緊貼輸入框上方（泡泡要貼著輸入框，而輸入框不在時間軸的 DOM 子樹內）。桌面版縱向時間軸不受影響，它的 message 節點本來就是獨立的一列。
- **`showcase-demo` 架構圖補上讀取層**：`/plan-data-flow` 新增「站點詳情與照片怎麼補上來」一節，記錄這條原本沒畫出來的路徑。

### 修正

- **交接到真實 AI 後地圖上完全沒有站點圓點**：`handover()` 只做一次 `setPlanSource(liveSource)`，存進 state 的是交接當下那個 `stops: []` 的快照；之後 `LivePlanLayer` 回報站點、`liveSource` 換成新物件，但 `planSource` 仍指著舊快照，地圖永遠拿到空陣列。補上與模擬來源對稱的同步 effect。
- **交接後主題點無法展開**：`PlanStopMarker` 原本不帶 `children`，`AIPlanTimelinePage` 因此繞過 `PlanStopsView` 介面直接讀 `timelineRef`，而且只在 `kind === 'simulated'` 時讀——交接後 timeline 住在 `TripPlanPage` 內部、外層讀不到，所有站點退化成單點。改為 `PlanStopMarker` 帶 `children`，由兩邊的投影各自填好（`TripPlanPage` 的 `mapStops` 一併補上回報），地圖那側不再需要分支。
- **`dragStopTime` 的 `useCallback` 漏了 `dataSource` 依賴**：注入真後端實作時會鎖住首次 render 的實例，`cfg`（含登入 token）更新後拖拉時間仍用舊的。
- **首頁小展示的節奏與版位**：「試試看」按鈕放大（40→52px 高、14→17px 字），時間軸往上挪讓出空間；假資料來源的人為查詢延遲從 650ms 降到 280ms——原值是對齊真後端 800~1500ms 的量級訂的，但展示頁資料全在前端記憶體，650ms 等於純粹讓使用者乾等（骨架卡仍然看得見）。這個延遲同時影響 `/ai-plan` 展示頁。

## v0.35.0 — 2026-10-16

首頁 AI 編排行程展示改為捲動式橫向時間軸，`/ai-plan` 抽出共用版面外殼並修正手機版交接後的版位與手勢問題，開放訪客使用 AI 排程所需的地點查詢端點（含 IP 節流）。無破壞性變更，不含資料庫結構變更。

### 新增

- **首頁捲動式 AI 編排行程展示**：`HomePage.tsx` 掛載新的 `ScrollPlanDemo`，使用者往下捲時行程一站一站排出來，取代原本靜態的 `AiPlanPhoneDemo` 手機展示；與 `/ai-plan` 共用同一份劇本與渲染元件，差別只在誰推進播放（計時器 vs 捲動位置，見 `planSimScrollSource.ts`）。新增 `FeatureShowcase`、橫向時間軸元件 `HorizontalPlanTimeline`。
- **`/ai-plan` 共用版面外殼 `PlanOverlayPanel`**：把定位（桌面右側欄／手機貼底）、手機版事件穿透、地圖安全區、輸入框插槽收進同一個元件，交接前的模擬層與交接後的真實層（`LivePlanLayer` → `TripPlanPage`）共用，輸入框前後在同一位置。`TripPlanPage` 透過 `ComposerSlotContext`／`ComposerPortal` 把輸入框傳送進插槽，不在外殼內（`/app`、`/trip-plan`）時維持原位渲染。
- **訪客公開端點**：新增 `GET /public/geo/plan-ai/place-search`、`/public/geo/plan-ai/attraction-search`，複用既有 handler，讓未登入訪客在 `/ai-plan` 也能體驗真實 AI 排程（原本打 `/internal/geo/plan-ai/*` 一律 401）。以來源 IP 為 key 節流（60 秒 300 次）。
- **`RateLimiter.AllowWithLimit`**：key 為外部來源 IP 這種無上限集合時，不把每個 key 寫進規則表（清理機制只回收計數視窗、不回收規則表，寫入就是永久洩漏）。
- **共用時間軸模組**：`planTimeline`、`PlanTimelineView`、`TripPlanPage` 新增選填 props，並新增草稿清單 `planTimelineDrafts`；地圖新增 `mapMarkerLayer`、`useMapSafeArea`、`solveSafeAreaCenter`。`usePlanSimSocket` 新增選填的第二參數 `createSource`，`AiPlanPhoneDemo`／`AiPlanPhoneDemoScreen` 新增選填 props（`scale`、`className`、`screenProps`、`createSource`、`started`、`onSource`、`focusLatest`），既有呼叫端不需調整。
- **新的前端 feature flag（皆預設關閉）**：`VITE_FEATURE_TRANSIT_MODE_SELECT`（交通方式選單）、`VITE_FEATURE_NEW_TRIP_DRAFT`（交接後的「新行程」按鈕）。另外 `DesktopShared.tsx` 已宣告 `ROUTE_LINE_ENABLED`（`VITE_FEATURE_ROUTE_LINE`）與 `DESTINATION_PROMPT_ENABLED`（`VITE_FEATURE_DESTINATION_PROMPT`）兩個旗標，但對應功能尚未納入本版，開啟沒有效果。
- **`showcase-demo` 新增 `/plan-data-flow` 內部文件頁**：整理行程資料的分層架構與四種輸入來源各自接在哪一層。

### 修正

- **手機版交接後地圖拉不動、輸入框貼在頂端**：交接後 `.timelinePanel` 撐滿整頁且 `TripPlanPage` 容器高度 100%，兩層都攔截指標事件；草稿為空時沒有東西把輸入框推到底部。改由 `PlanOverlayPanel` 統一處理貼底與事件穿透。
- **手機版橫向 overscroll**：`base-ui.css` 由 `overscroll-behavior-y` 改為不分軸向的 `overscroll-behavior`，修正拖曳橫向卡片列或地圖時整個畫面彈出視窗再彈回。
- **訪客端點 IP 節流可被偽造的 header 繞過**：`clientIP` 原本可能取 `X-Forwarded-For` 最左邊（用戶端自行送出）或 `X-Real-IP`（Cloud Run 不會設定），每次請求換一個假值就能讓節流永遠看不到同一個 key，耗用 Google Places 配額。改為取 `X-Forwarded-For` 由後往前數 `TRUSTED_PROXY_HOPS`（預設 1）筆，header 筆數不足時退回 `RemoteAddr`，不再讀 `X-Real-IP`。
- **Vitest 在 Node 25+ 整批失敗**：新版 Node 內建 Web Storage，沒帶 `--localstorage-file` 時 `globalThis.localStorage` 回傳 `undefined` 並搶先佔位，jsdom 自己的 Storage 拿不到。`vitest.setup.ts` 只在缺失時補上（優先用 jsdom 實例自己的 Storage），Node 26 下失敗由 45 項降到 4 項（剩餘為寫死日期與地圖 mock 缺方法的既有問題）。

### 部署注意

- **`TRUSTED_PROXY_HOPS`**（新環境變數，見 `server/.env.example`）：預設 1，對應 Cloud Run 直接面對外部流量。若 `tripace.io` 前面另外接了負載平衡器等代理，每多一層要加 1，否則所有訪客會被算成同一個 IP、共用 300 次/分鐘的額度。
- 公開端點 `/public/geo/plan-ai/*` 會消耗 Google Places 配額，上線後留意用量。

## v0.34.1 — 2026-10-15

九份主題景點頁新增第一個聯盟行銷版位（KKday Deeplink）。無破壞性變更。

### 新增

- **九份頁新增 KKday 聯盟行銷連結卡片**：`JiufenPage.tsx` 在捲動時間軸結束、最終 CTA 之前新增一張貼合本頁紙感和風視覺的卡片，連到 KKpartners 後台產生的 Deeplink（`cid=tripace-27468`，目標為「九份/野柳/十分/平溪一日遊+夜遊」商品頁），點擊有埋 `affiliate_link_click` GTM 事件。這是本站第一個實際上線的聯盟行銷版位，先手動建立單一連結驗證追蹤機制，尚未做批量產生或 API 整合（KKpartners API 目前僅開放精選合作夥伴申請，無公開文件）。

## v0.34.0 — 2026-10-14

精選行程展示頁新增後端發布機制、路由從 `/ai-itineraries` 改名為 `/itineraries`，整合定山溪秋日泡湯範例行程，`showcase-demo` 新增多個獨立產品原型展示頁。**本版含破壞性變更。**

### 破壞性變更

- **路由 `/ai-itineraries` 改名為 `/itineraries`，未保留舊路由重導向**：任何已分享、加入書籤的 `/ai-itineraries` 舊連結會直接變成 404，不再自動導向新路徑。改名依使用者明確要求分兩階段完成（先去除對外文案的 `ai` 字樣，後續再把 `web/src/ai-itineraries/` 目錄本身也改名為 `web/src/itineraries/`），元件內部命名（`AiItinerariesRoute` 等）維持不變。

### 新增

- **行程頁後端發布機制（`itinerary_pages`）**：新增資料表與對應 CLI（`itinerary-page add/get/set/publish`），比照部落格 `content_pages` 的發布模式。`/itineraries` 清單頁改為資料庫行程與靜態範例合併顯示，以 feature flag 控制靜態範例是否顯示（預設關閉）。
- **定山溪溫泉街紅葉散策一日遊（`jozankei-1day`）全套展示層**：手繪地圖樣式、楓葉相框、秋日泡湯地點卡等專屬呈現；地圖站點的 Google 照片改為透過 `attractionId` 即時查詢（新增公開端點 `GET /public/geo/attraction/{id}`），取代原本寫死照片網址的做法。
- **`tools/img2webp`**：獨立的圖片轉 WebP 工具（含 EXIF orientation 處理、resize），合併自 `wip/hokkaido-and-geo-outline-split` 分支。
- **`web/showcase-demo` 新增多個獨立產品原型展示頁**：廣告聯盟比較、行程大富翁、趣味地圖、行程海報、路徑規劃骨架/規劃等 mock-data 展示頁面。這些是獨立於主應用之外的展示沙盒，不影響正式路由。

### 修正

- **hand-drawn 地圖樣式與 `AdvancedMarkerElement` 互斥導致標記顯示失敗**：改用 `OverlayView` 實作，保留原有的發光/漣漪動畫效果。
- **`server/cmd/server/static.go` 的 `/itineraries` 路由註解文案過時**：仍寫著改名前的「AI 排好的範例行程」，已同步成「精選行程」。
- `server/internal/api/geo_outline.go` 的公開端點 handler（`handlePublicGeoAttractions`/`handlePublicGeoPlaceDetails`/`handlePublicGeoPlacePhotoAssets`/`handleGeoAttractionsByCity`）搬移到新檔案 `geo_outline_public.go`，純內部檔案組織調整，不影響對外行為。

## v0.33.1 — 2026-10-14

修正 v0.33.0 部署失敗。無破壞性變更。

### 修正

- **`Dockerfile` 的 SEO meta 測試數量健全性檢查過時，導致 v0.33.0 Docker build 階段直接失敗**：v0.33.0 新增部落格文章動態 SEO meta（`blogArticleSEOMeta`，`/u/{handle}/{slug}` 路徑，含 `og:image` 優先用 `heroPhotoId`、退回 `heroStandalonePhotoId` 的測試）相關測試後，`TestApplySEOMeta|TestStaticHandler` 這組 pattern 比對到的測試數量從 5 個增加到 9 個，但 `Dockerfile` 裡 `go test -list` 的數量檢查沒有同步更新，造成這道健全性檢查判定失敗、整個部署中止。已更新為正確的 9，並在真實建置產物下重新驗證全部 9 個測試皆通過。

## v0.33.0 — 2026-10-14

部落格發文功能大幅擴充（照片標注/評分、EXIF 轉正、多種單圖/多圖版型、Hero 圖、日夜模式建議值、SEO meta 動態注入）、CLI 新增同步處理旗標、移除部落格文章的假資料 fallback、首頁新增部落格文章入口。**本版含破壞性變更。**

### 破壞性變更

- **`ImageBlock`/`GalleryBlock.items[]` 的 `file` 欄位改名為 `photoId`**：文章內容裡的圖片改用後端 `uploaded_photos.id` 這個穩定識別碼取代直接存路徑字串，換圖/重新上傳後路徑不再失效。渲染端完全不認得 `file`，既有內容若未同步改名，圖片會顯示不出來。對應後端新增 `GET /public/blog/photos?ids=...` 批次展開 photoId 成實際網址（僅回傳被已發布文章引用且 `status=="ready"` 的圖片，避免被用來枚舉其他使用者的草稿配圖）。
- **`store.CreateUploadedPhoto` 新增必填參數**：簽名從 `CreateUploadedPhoto(ownerID, originalURL string)` 改為 `CreateUploadedPhoto(ownerID, originalURL, note string)`，支援上傳當下順手標記照片內容。既有呼叫端需要補上第三個參數才能編譯通過。

### 新增

- **照片標注（note）與品質評分（rating）**：`uploaded_photos` 表新增 `note`/`rating` 欄位，CLI 全線打通（`blog-photo upload -note`、`blog-photo note -id`、`blog-photo rating -id -rating 1~3`），評分用於未來 AI 編排/人工判斷主圖的依據。
- **EXIF Orientation 轉正**：`photoupload.DecodeImage` 新增讀取並套用 EXIF Orientation 標籤（標準 8 種值），解決手機直拍照片上傳後方向跑掉的問題，對齊 Google Photos/Cloudinary 等業界做法。
- **CLI 多選上傳**：`PhotoManagerPage.tsx` 的檔案選擇改為支援 `multiple`，逐一依序上傳並顯示進度。
- **照片管理介面縮圖不裁切預覽**：`PhotoManagerPage.module.css` 縮圖從固定正方形裁切改為 `max-height` + `object-fit: contain`，完整顯示原圖比例方便判斷方向/內容。
- **焦點編輯器改為拖曳固定比例裁切框**：`PhotoFocalEditor.tsx` 從「點擊設定單一焦點」改為「拖曳框選」，裁切框比例與文章實際顯示的裁切比例精確一致（直式對齊 `1/1.5`），移除原本顯示裁切比例不一致、易誤導判斷的「預覽(裁切效果)」區塊，彈窗寬度加大方便精細操作。
- **單圖多種版型**：`ImageBlock` 新增 `width`（`column`/`wide`/`full`，欄寬/外擴/全寬出血）、`float`（文繞排方向）、`orientation`（直式/橫式比例）、`overlayText`（文字疊在圖片上，適合短句且不依賴文字長度的收尾照片，取代文繞排配短段落效果不佳的情境）。
- **多圖群組新版型**：`GalleryBlock.layout` 新增 `row`（密集小圖，適合照片數量多的站點）、`split`（固定 3 張的左直右兩橫拼貼版面）。
- **文章 Hero 大圖**：`ThemePageContent` 新增 `heroPhotoId`（全寬背景圖，文字疊在上面）、`heroStandalonePhotoId`（標題下方獨立定場大圖），兩者可同時使用不同照片。
- **文章建議日夜間模式**：`ThemePageContent.preferredTheme`，讀者首次進入且尚未手動切換過主題時套用建議值，不強制鎖定。
- **部落格文章伺服器端動態 SEO meta 注入**：`server/cmd/server/seo_meta.go` 新增 `/u/{handle}/{slug}` 路徑的動態查詢——每篇已發布文章在伺服器端注入自己的 `title`/`description`/`canonical`，`og:image`/`twitter:image` 優先使用 `heroPhotoId`、查無則退回 `heroStandalonePhotoId` 對應的照片，都沒有才用站台預設圖。草稿文章不會被注入（避免索引到未公開內容的預覽）。
- **CLI 同步處理旗標**：`blog-photo upload -sync`/`blog-photo retry -sync`，讓伺服器端在這次 HTTP 請求處理期間同步完成圖片處理（不丟進背景 goroutine）——根因是 Cloud Run 只在處理 HTTP 請求期間分配 CPU，背景處理容易因 CPU 被收回而卡住/逾時，同步模式讓呼叫端多等一次 round trip 換取處理期間確實有 CPU 可用，並能直接從回應得知處理是否成功。
- **開發用版型目錄頁**：新增 `/dev/layouts`（`web/src/blog/LayoutGalleryPage.tsx`），陳列 `BlogArticle.css` 目前支援的所有版型，骨架圖+範例文字，不依賴真實照片或後端資料，純開發工具不加入站內導覽。
- **首頁新增部落格文章入口**：目的地清單新增「台灣．九份夜遊記」項目，連到已發布的部落格文章，標上「旅遊雜記」分類標籤與其餘城市介紹頁區隔。

### 修正

- **部落格文章完全移除假資料 fallback**：`BlogArticlePage.tsx` 原本在 API 失敗（非 404，例如網路錯誤、API 回應形狀不對）時會顯示 `sampleTainanChikan`（赤崁．府城展示內容），讀者會誤以為查到了一篇真實存在但內容錯誤的文章；文章載入中（`loading` 狀態）同樣會先借用這份假資料渲染出完整頁面，造成「任何文章一開始都先閃一下赤崁畫面」的體驗問題。`FetchState` 簡化為三態（`loading`/`api`/`not-found`），所有失敗情境與載入中都不再冒充任何文章內容，`loading` 顯示獨立的載入中畫面，其餘一律顯示 `NotFoundPage`。整個 `sampleTainanChikan.ts` 檔案已刪除。
- **EXIF Orientation 5、7 轉換邏輯顛倒**：`rotateImage` 原本 `case 5` 用 `rotate90(flipH(img))`、`case 7` 用 `rotate90(flipV(img))`，實際算出的結果互相對調（已用 Pillow 逐像素比對驗證），造成這兩種 EXIF 值的照片上傳後鏡像+錯誤旋轉 180 度。
- **焦點編輯器在特定比例下完全無法互動**：原圖寬高比恰好等於目標裁切比例（`dragAxis === 'none'`，框已貼合整張原圖）時，拖曳/點擊沒有任何反應，容易誤以為功能故障；新增提示文字告知「已經是最佳位置，不需要調整」，並在圖片載入時用既有的 `cropOffsetFromFocal` 反函式校正 focal 到目前幾何下的合法值，避免舊資料在新版編輯器開啟時位置跳變。
- **`GalleryBlock.layout: "split"` 缺少張數防呆**：`items` 長度不是 3 張時，渲染端現在會退回 `grid` 版面並印出 `console.warn`（含 photoId 清單方便定位），不再任由版面悄悄跑掉。
- **`/blog/photos`、`/dev/layouts` 路由未同步進 `server/cmd/server/static.go` 的 `knownRoutePatterns`**：正式環境直接重新整理這兩個網址原本會被誤判為非法路徑，已補上。
- **彈窗定位 bug**：`.rp-modal-backdrop` 原本用 `position: absolute`，在可捲動容器內開啟彈窗時會相對完整內容高度定位、而非目前可視範圍，改為 `position: fixed`。

## v0.32.2 — 2026-10-12

補齊「進入 app / 開啟展示畫面」入口按鈕的 GA 埋點缺口、部落格文章新增段落樣式變體、`/ai-plan` 展示頁補上獨立 SEO meta。無破壞性變更。

### 新增

- **部落格文章段落樣式變體（`ParagraphVariant`）**：`web/src/blog/types.ts` 的 `ParagraphBlock` 新增選填欄位 `variant?: 'heading' | 'emphasis' | 'quote' | 'caption'`——對齊既有「具名樣式」設計哲學，CLI 編輯者只選語意化變體名稱，實際視覺數值（字級/字重/顏色/間距）交給 `web/src/blog/BlogArticle.css` 的 `[data-variant]` 規則決定。省略時維持改動前的既有外觀。
- **`/ai-plan`（AI 安排行程模擬展示頁）補上獨立 SEO title/description/canonical**：`server/cmd/server/seo_meta.go` 的 `seoMetaByPath` 對照表新增這個路徑的條目，避免 Googlebot 初次抓取時 canonical 指向首頁、被當成首頁的重複內容。沿用首頁預設代表圖（跟 `/product` 的既有處理方式一致）。

### 修正

- **「進入 app」/「開啟展示畫面」入口按鈕的 GA 埋點缺口**：`HomePage.tsx`、`BlogArticlePage.tsx`、`PhotoManagerPage.tsx`、`AIPlanTimelinePage.tsx` 的登入/返回應用/功能介紹按鈕原本漏埋 `trackEvent`，九份/京都/台南安平/赤崁・府城/功能介紹頁都有埋、這幾個頁面卻沒有，補上後統一用既有事件名稱（`landing_cta_click`/`landing_feature_intro_click`）並補上 `page`/`position` 區分來源。
- **`web/src/blog/types.ts` 殘留的重複 doc comment**：前一版新增 `ParagraphVariant` 時，`ParagraphBlock` 上方留下一行重複的「一般文字段落」註解，修正為單一份。

## v0.32.1 — 2026-10-12

修正 v0.32.0 的疏漏:只刪除了安裝 service worker 的程式碼,沒有處理已經裝在訪客瀏覽器裡的舊版 service worker。無破壞性變更。

### 修正

- **已造訪過本站、瀏覽器裡還殘留舊版 service worker 的訪客,在 v0.32.0 部署後仍然命中同一個 bug**（實機回報:「還是一樣第一次都是舊的」）。根因:v0.32.0 移除了 `vite-plugin-pwa` 跟它的 `registerSW`/`autoUpdate` 機制,但這代表舊 service worker 賴以「偵測到新版本就自動更新/卸載」的機制本身也一起消失了——沒有新版本可以比對,舊 service worker 會原地繼續運作、永遠不會自然消失,持續把這批訪客的導航請求攔截回填舊版 `index.html`。
  - `web/src/main.tsx` 新增:應用啟動時呼叫 `navigator.serviceWorker.getRegistrations()` 找出任何殘留的 service worker 並 `unregister()`,同時清掉 `Cache Storage` 裡殘留的 precache 內容,讓這批訪客下一次導航（通常是下一次換頁或重新整理）回到乾淨狀態。best-effort,不支援 service worker API 或卸載失敗都不影響應用本身啟動。

## v0.32.0 — 2026-10-12

整個移除 PWA/service worker 支援。**本版含破壞性變更**。

### 移除（破壞性）

- **`vite-plugin-pwa` 整個移除**：實測發現的真實 bug——`view-source:https://tripace.io/kyoto-kiyomizu` 看到的 `<title>`/`og:title`/`canonical` 等 meta 永遠是首頁的版本，要重新整理、甚至無痕模式都一樣。根因：這個專案所有路徑共用同一份 `index.html`，不同路徑的 SEO meta 是伺服器端（`cmd/server/seo_meta.go`）依請求路徑即時改寫 placeholder 產生的，每個路徑理應拿到不同內容；但 service worker 的 `navigateFallback` 預設行為是「任何導航請求一律回填 precache 住的那份 `index.html`，不再問伺服器」，與此直接衝突——訪客看到的一直是最早被 precache 住的那份路徑版本的 meta（無痕模式一樣會重現，因為 service worker 的註冊/攔截不受無痕模式的 cookie/localStorage 隔離影響）。
  - 曾評估改用 `navigateFallbackDenylist` 排除需要動態內容的路徑，但這代表每新增一個公開頁面都要記得同步更新這份名單，否則會重現同一個 bug，判斷這個維護負擔與風險不值得換取「加到主畫面/離線開啟外殼」這個次要功能，改為整個移除。
  - 移除範圍：`web/vite.config.ts` 的 `VitePWA` 外掛設定、`web/src/main.tsx` 的 `registerSW` 呼叫、`web/src/vite-env.d.ts` 的型別參照、`web/index.html` 的 PWA 專屬 meta/link（`theme-color`、`apple-mobile-web-app-*`、`apple-touch-icon`）、`public/pwa-*.png` 圖示檔案、`package.json` 的 `vite-plugin-pwa` 依賴。
  - **影響**：這個網站不再能「加到手機主畫面」，也不再支援離線開啟 App 外殼。所有頁面的靜態資源一律直接打伺服器，不再有任何 service worker 快取層。

## v0.31.2 — 2026-10-12

正式環境端到端驗證部落格圖片上傳功能時發現該功能一直處於未啟用狀態，補上缺漏的部署設定；同時補上 CLI 的 `blog-photo` 指令組（先前只有 API，CLI 沒有對應操作指令）。無破壞性變更。

### 新增

- **CLI `blog-photo` 指令組**：`upload`（複合動詞，依序簽發 pre-signed URL→PUT 上傳本機檔案→回報完成）、`list`、`retry`、`focal`、`delete`，對齊 `server/internal/api/blog_photo.go` 的全部端點。身份固定是登入者自己，不支援 `-official`（跟 `blog-profile` 系列一致）。

### 修正

- **正式環境的圖片上傳功能一直處於未啟用狀態**：`internal/photoupload.New` 需要的 `BLOG_PHOTO_UPLOAD_BUCKET`、`GCS_SERVICE_ACCOUNT_EMAIL` 兩個環境變數，`v0.31.0` 開發部落格發文功能時沒有同步補進 `.github/workflows/deploy-cloudrun.yml`，導致正式環境的 `/v1/blog/photos/upload-url` 端點一直回應 `503 upload_disabled`（端到端驗證時發現的真實 bug）。已補上：
  - 新增 Secret Manager 秘密 `BLOG_PHOTO_UPLOAD_BUCKET`（沿用既有 `photo_assets`/`photostorage` 共用的 `shuttle-tripace-photos` bucket）、`GCS_SERVICE_ACCOUNT_EMAIL`（填 Cloud Run 服務本身執行用的 service account）。
  - 該 service account 補上對自己的 `roles/iam.serviceAccountTokenCreator`（`photoupload` 透過 IAM Credentials API 的 `SignBlob` 簽發 pre-signed URL 需要這個權限才能自簽）。
  - `deploy-cloudrun.yml` 的 `--update-secrets` 掛上這兩個新 secret。
- **`Dockerfile.admin` 的過時註解**：提到已於 `v0.31.0` 移除的 `internal/adminauth` 套件，改成描述現行的 `internal/auth.Signer`（JWT）+email 白名單機制。

## v0.31.1 — 2026-10-12

修正 v0.31.0 的部署失敗問題，無功能變動、無破壞性變更。

### 修正

- **`web/src/App.tsx` 誤混入尚未提交的 `showcase-demo/*` 路由引用**：v0.31.0 的 commit 把 `App.tsx` 一起提交時，連帶帶入了本該留在工作目錄、尚未提交的 `showcase-demo/*` lazy import 與路由，導致遠端 build 因找不到 `web/src/showcase-demo/` 目錄而失敗（`TS2307`）。已整段移除，`showcase-demo` 之後準備好了再另外提交。
- **`PhotoManagerPage.module.css` 的多行註解被提前關閉**：註解內容 `--ios-*/--color-*` 裡的 `*/` 被 postcss 誤判為註解結束符，提前結束整段多行註解，導致後續文字被當成裸露 CSS 宣告解析而建置失敗（`Unknown word token`）。改成 `--ios-* / --color-*` 加空格避開。

## v0.31.0 — 2026-10-12

新增多使用者部落格發文功能（路由 `/u/:handle/:slug`，含圖片上傳/焦點編輯），並把原本的「主題介紹頁」CMS 試做（`theme_pages`）正式轉型為通用的 `content_pages`，由同一套 CLI/API 透過 `-official` 旗標切換「部落客發文」與「官方城市介紹頁」兩種身份模式。同時把 admin 後台從獨立密碼/cookie 系統整個移除，改成與一般使用者共用 JWT、以 email 白名單判斷權限。**本版含多項破壞性變更**，詳見下方清單。

### 新增

- **部落格發文平台**：新增 `blog_profiles`（handle/頭像）、`uploaded_photos`+`photo_variants`（圖片上傳與多尺寸縮圖）兩組資料表與對應 store/API/CLI。
  - CLI 新增 `content-page`（`add`/`get`/`set`/`list`/`publish`/`unpublish`/`delete` 七個動詞）、`blog-profile`（`set`/`get`）兩組指令。
  - API 新增 `server/internal/api/blog_photo.go`（上傳 URL 簽發、完成回報、重試、設定焦點、刪除）、`blog_profile.go`（profile 查詢/upsert）。
  - 前端新增 `web/src/blog/` 目錄：`BlogArticlePage.tsx`（文章頁，含商標/登入按鈕/footer）、`PhotoManagerPage.tsx`（圖片管理頁，含商標/主題切換/已登入返回按鈕）、`PhotoFocalEditor.tsx`（拖曳設定圖片焦點）、`BlogProfileSettings.tsx`（handle/頭像設定表單），路由 `/u/:handle/:slug`、`/blog/photos`。
- **`server/internal/photoupload/`**：新增圖片直傳套件，前端透過 GCS pre-signed URL 直接 PUT 上傳（不經過 server），完成後由背景 goroutine（對齊既有 `photo_assets` 的 `backgroundFillPlacePhoto` 慣例）產生縮圖/大圖兩種尺寸變體。
- **`server/internal/adminidentity/`**：新增 `IsAdminEmail(email, adminBootstrapEmail string) bool` 共用套件，供 `internal/api`、`internal/adminconsole` 共同使用，避免白名單比對邏輯各自重複實作。
- **`auth.ResolveSecretFromEnv()`/`auth.DefaultDevJWTSecret`**：共用 JWT secret 解析邏輯，讓 `cmd/server`、`cmd/adminserver` 共用同一份 `JWT_SECRET` 設定來源。
- **`server/internal/api/auth.go` 新增 `requireRealUser`**：判斷 `userFor(r)` 回傳的使用者是否為訪客回退結果，避免部落格發文情境悄悄共用訪客身份。

### 變更（破壞性）

- **`theme_pages` 表與相關符號全面改名為 `content_pages`**：`themePageRow`→`contentPageRow`、`ThemePage`→`ContentPage`、CLI `theme-page`→`content-page`、ID 前綴 `thp_`→`cpg_`。所有 store 方法簽名新增 `ownerID` 參數（`CreateContentPage`/`GetContentPageBySlug`/`ListContentPages`/`UpdateContentPageContent`/`SetContentPageStatus`/`DeleteContentPage`），slug 唯一性範圍從「全域」改為「同一 ownerID 之內」（`ux_theme_pages_owner_slug`→`ux_content_pages_owner_slug` 複合唯一索引）。公開讀取路徑改為 `/v1/content-pages/{slug}`。
- **CLI `content-page` 指令預設行為翻轉**：不加 `-official` 旗標時，CLI 自動以登入者自己的身份當 ownerID（部落格發文情境）；加 `-official` 才是舊行為（ownerID 固定為空字串，服務官方城市介紹頁）。**編寫城市介紹頁的既有腳本/操作流程都需要補上 `-official` 旗標**，否則會被當成一般使用者的個人部落格文章寫入。
- **Admin 後台登入機制整個替換**：不再有獨立的 `admin_session` cookie、帳密登入；改成使用者透過一般登入流程（`/v1/auth/login`）取得 JWT 後，由 `withAdmin` 中介層比對使用者 email 是否等於 `ADMIN_BOOTSTRAP_EMAIL` 環境變數白名單值（大小寫不敏感），fail-closed（環境變數未設定視為無人有權限）。`adminconsole.NewHandler` 簽名改為接受 `Signer *auth.Signer`、`Store *store.Store`、`AdminBootstrapEmail string`。`cmd/adminserver` 現在需要與 `cmd/server` 共用同一組 `JWT_SECRET` 才能驗證 token。
- **官方城市介紹頁編寫權限收斂為 admin 專屬**：`-official` 模式下，API 會要求呼叫者 email 落在 `ADMIN_BOOTSTRAP_EMAIL` 白名單內，不再是任何登入使用者都能寫入官方頁面。

### 移除（破壞性）

- `server/internal/adminauth/` 套件（含測試）整個移除。
- `server/cmd/adminpasswd/` 工具整個移除。
- `admin_users`/`admin_sessions` 兩張表（對應的 `server/internal/store/admin_entity.go`）移除。
- `server/scripts/set-admin-bootstrap-secrets.sh`、`.github/workflows/reset-admin-password.yml` 移除（配合舊帳密系統的輔助腳本/workflow，已失效）。
- `ADMIN_BOOTSTRAP_PASSWORD` 環境變數移除，`.github/workflows/deploy-admin.yml` 的 `--update-secrets` 同步移除該項、新增 `JWT_SECRET`。

### 修正

- Code review 兩輪共 16 項發現全數修正，包含兩項安全性問題：`-official` 旗標權限提升（見上方「官方城市介紹頁編寫權限收斂」）、訪客身份與一般使用者身份衝突風險（`requireRealUser`）；其餘涵蓋背景 goroutine panic 防護、資料一致性/併發（GORM `TranslateError: true` + `gorm.ErrDuplicatedKey` 取代字串解析）、程式碼品質與重複實作清理。
- `docs/routing-architecture.md`：修正 Admin 身份驗證機制描述（原本停留在已移除的 session cookie 機制），並補齊 `/admin/api/*` 完整路由表（原文件只列 4 條且含已移除的 login/logout，現補齊為實際的 11 條路由）。

### 已知限制

- Admin JWT 目前沒有獨立的撤銷機制（依附在一般使用者的 30 天 JWT 上），token 外洩時只能靠轉動 `JWT_SECRET`（會波及全站使用者）或縮短 JWT 有效期補救，評估後判斷暫不值得為此改動 schema。
- `BlogArticlePage.tsx` 的作者資訊呈現方式（`FAKE_AUTHOR` 假資料 + 三種候選排版）尚未定案，待方案選定後一併調整。

## v0.30.2 — 2026-10-11

延續 v0.30.1 的 bottom sheet 體系調整：手機版規劃地圖 UX 微調、修正地圖點擊穿透 bug，以及一項 code review 抓到的重複實作。本版無破壞性變更。

### 變更

- **手機版規劃地圖的「設定頁」「規劃」「配速表」三個 bottom sheet，最大展開段從離頂部 60px 改成 12px，貼齊搜尋框上緣，改成蓋住搜尋框**（使用者明確要求「我要改成要蓋住」「貼齊搜尋匡上緣」）。
- **「規劃」對話疊加層從兩段（收合/展開）改成三段式（收合/中段/最大展開）**，比照地點清單/地點資訊卡的既有三段式設計（`PhoneContent.tsx` 新增 `CHAT_SHEET_SNAP_POINTS`）。
- **所有「中間段」的離頂部距離統一成 320px**：三段式 sheet（規劃小匡/地點清單/地點資訊卡）的中段，以及兩段式 sheet（旅程清單/時間軸，展開段本身語意上是「中間」位置而非貼頂的最大展開）的展開段，原本分別是 400px/200px，這次一併統一成 320px。

### 修正

- **地圖上的主題點／精選點縮圖圓圈，點選時會同時觸發底下的 Google 原生 POI**：根因是 `geoAttractionOverlay.ts` 的 click 監聽只對 `mousedown`/`touchstart` 呼叫 `stopPropagation()`（為了保留滑鼠滾輪縮放功能），唯獨沒有擋住 `click` 本身的冒泡——我們自建的 DOM click 處理會正確觸發，但事件繼續冒泡到地圖容器，被 Google Maps SDK 自己的事件委派依座標解讀成底層 POI 的點擊，兩套獨立事件系統同時觸發。補上 `click` 監聽的 `stopPropagation()`，不影響原本保留的 `wheel` 縮放行為。
- **`PhoneBottomSheet.tsx` 的 `containerHeight` 重複實作了同一輪新增的 `hooks/useElementHeight.ts`**（code review Reuse 角度發現）：原本手刻一份「掛載時量 `clientHeight` + `window resize` 時重量」的邏輯，改用 `useElementHeight`（`ResizeObserver` 持續監聽任何尺寸變化來源，不只是 `window resize` 事件）量測這個 sheet 的定位祖先容器真實高度。`panelRef` 改成 callback ref 形式，確保量測父容器的 `containerRef` 能跟 `panelRef` 的掛載同一輪 commit 完成賦值。

### 已知限制（尚未修正）

- `PhoneBottomSheet.tsx` 的 `panelBottomPx`（用 `getComputedStyle` 讀取 `panelStyle.bottom` 的真實 px 值，供收合段高度計算使用）只在 sheet 的 `open` 狀態切換或 `window resize` 時重新量測。若 sheet 已經開啟期間，`panelStyle.bottom` 背後依賴的 CSS 自訂屬性（例如 `--tab-bar-height`）獨立變化（不伴隨 `window resize` 事件，例如 `PhoneTabBar` 因內容或字級變化改變自身高度），`panelBottomPx` 不會重新量測、停留舊值，收合段可視高度可能重新出現 v0.30.1 已修復的壓縮症狀，只是觸發窗口變窄許多。沒有瀏覽器原生 API 可以直接訂閱 CSS 自訂屬性變化（`ResizeObserver` 只能偵測元素尺寸變化，而 CSS 變數改變時 `.panel` 自身尺寸不一定跟著變，只有位置變），這個邊界情況評估後續再處理。

### 測試

- 新增 `geoAttractionOverlay.clickTargets.test.ts` 的回歸測試，驗證點擊縮圖/圓點/標籤後 click 事件不會繼續冒泡到外層容器。

## v0.30.1 — 2026-10-11

延續 v0.30.0 的 bottom sheet 重構：補上功能列高度的動態量測機制，並修正多輪實機測試與 code review 抓到的 bug。本版無破壞性變更。

### 新增

- **`web/src/hooks/useElementHeight.ts`**：用 `ResizeObserver` 即時量測任意 DOM 元素的真實高度，取代原本手機版底部常駐功能列（`PhoneTabBar`）高度散落 5 處各自寫死 `64px` 複製貼上的做法。`PhoneTabBar.tsx` 改成 `forwardRef`，`PhoneContent.tsx` 用量到的高度寫入 `.mainArea` 的 CSS 自訂屬性 `--tab-bar-height`，`PhoneTripsDrawer.tsx`/`PhoneTimelineDrawer.tsx`/`PhoneSideTools.module.css`/`PlanPhoneView.module.css`（2 處）全部改用 `var(--tab-bar-height)`。功能列之後若改版面（文案、字級、padding）不需要回頭修改任何依賴它的程式碼。
- **`web/src/components/PhoneBottomSheet.tsx` 新增匯出 `useIsInsideSheetBody()`**：讓 `ScrollArea` 等共用捲動元件能偵測自己是否被渲染在 `SheetBody` 管轄的子樹裡，偵測到就在開發模式主動 `console.warn`（對齊 Radix UI「元件掛載時主動檢查環境條件」的慣例）——`SheetBody` 內部疊加另一層自己管 `overflow`/`touch-action` 的捲動容器，會讓外層的拖拉交接判斷/`overscroll-behavior` 防護失效。

### 修正

- **旅程清單／行程清單收合到最小段時，可視高度被壓縮成實際的 35px（預期 80–100px），標頭文字被底部功能列遮住一部分**：根因是 `PhoneBottomSheet.tsx` 的 `minHeightAsTop` 計算公式隱含假設 `panelStyle.bottom` 恆為 0，但這兩個呼叫端的 `bottom` 其實是 `var(--tab-bar-height)`（非 0，用來避開功能列），可視高度因此變成 `minHeightPx - tabBarHeight`。改用 `getComputedStyle(panelRef.current).bottom` 讀取瀏覽器實際解析後的 `bottom` px 值（涵蓋呼叫端傳入數字/`calc()`/`var()` 任意格式），讓計算公式對任何 `bottom` 值恆成立，而非只在輸出層對收合段這一個特例疊加 `height` 補丁（曾經的第一版修法，在容器高度不足的邊界情況下可能誤套用到展開段，已移除）。
- **手機版「規劃」對話小匡：捲動內容還沒拉到頂、sheet 就被判定可以收合**：根因是 `PhoneContent.tsx` 把 `SheetBody` 自己的 DOM 節點（`chatScrollRef`）誤傳給 `TripPlanPage` 的 `scrollContainerRef` 當成「真正的捲動容器」，但 `compact` 模式下真正承載捲動的是 `TripPlanPage` 內部的 `.compactScroll`，兩者是不同節點——`SheetBody` 的拖拉交接判斷因此讀到一個 scrollTop 永遠停留在初始值的錯誤節點，誤判「已經捲到頂」。移除這個誤傳的 `scrollContainerRef`，讓 `TripPlanPage` 在 `compact` 模式下使用它自己正確指向 `.compactScroll` 的 `scrollRef`；同時移除 `chatScrollRef` 這個已經沒有用途的死 ref。
- **手機版「規劃」對話小匡輸入框字體沒有放大**：`PhoneContent.tsx` 呼叫 `<TripPlanPage>` 時漏掉 `compact` prop，導致 `TripPlanPage.module.css` 的 `.compact .input` 字級規則（放大到 16px 對齊搜尋框）、`.compactScroll`（真正捲動容器）、`.compact .compactJumpPillWrap`（「回到最新」按鈕定位）全部從未套用，一併補上。
- **`SettingsScreen.tsx` 內部巢狀 `ScrollArea`**：`PhoneContent.tsx` 已經用 `SheetBody` 包住 `SettingsScreen`，但其內部又自己包一層 `ScrollArea`，形成兩層各自管理捲動的容器（跟上述對話小匡是同一種誤用模式的另一個實例）——移除內部的 `ScrollArea`，改用 inline style 補回原本的內距。
- **`PhoneBottomSheet.tsx` 的 `SheetBody` touch 事件處理常式重複實作了既有的 `hooks/useStableCallback.ts`**：第一版手刻了一個 `latestHandlersRef` 物件包三個 handler，改用既有的 `useStableCallback` 分別包三個 handler，行為不變（既有的 `PhoneBottomSheet.dragHandoff.test.tsx` 13 項測試驗證替換後 stale closure 修復依然正確）。

### 測試

- 新增 `PhoneBottomSheet.dragHandoff.test.tsx`（13 項）：第一份真正驗證「觸控拖曳手勢」JS 邏輯的測試，涵蓋收合段/中間段/最大展開段 × 標頭/body × 往上/往下的完整矩陣。
- 新增 `PhoneBottomSheet.collapsedHeight.test.tsx`（3 項）：驗證收合段高度在 `panelStyle.bottom` 非 0 時仍精確等於 `minHeightPx`，含容器高度不足的 clamp 邊界情況。
- 新增 `ScrollArea.sheetBodyWarning.test.tsx`（3 項）：驗證 `useIsInsideSheetBody()` 開發期警告機制。
- 新增 `useElementHeight.test.tsx`（3 項）：驗證 hook 介面行為（無 `ResizeObserver` 環境防禦、`observe`/`disconnect` 生命週期、callback 正確更新）。

## v0.30.0 — 2026-10-11

手機版 bottom sheet 體系的大規模重構：收斂「拉動時反應不一致」的問題，統一用具名工廠元件與具名常數管理原本散落各處的行為差異與 z-index 魔法數字，並修正多個實際回報的手勢/拖曳 bug。

### 破壞性變更

- **`web/src/components/PhoneBottomSheet.tsx` 的 `PhoneBottomSheetProps` 移除 `loading`**：原本 `loading=true` 時由 `PhoneBottomSheet` 本身顯示置中轉圈動畫取代 `.body` 內容，改成新增的 `SheetBody` compound component 自己的 `loading` prop（`<SheetBody loading={...}>`）。理由：重構後 `PhoneBottomSheet` 不再固定渲染 `.body` div（見下方 `SheetBody` 說明），`loading` 這個機制只對「有可捲動內容」的 `SheetBody` 有意義。既有唯一呼叫端（`geo-planning/PlanPhoneListDrawer.tsx`）已同步改用新寫法。
- **`web/src/geo-planning/PlanPhoneDatePickerSheet.tsx`／`PlanPhoneDateCalendarSheet.tsx` 的 `isTopmost` 從選填改為必填**：原本選填＋內部用 `?? true` 補預設值，等於在 `StackedSheet`（見下方）刻意把 `isTopmost` 設計成必填、防止被意外忽略的保護之外，又重新開了一個後門（code review 發現）。既有唯一呼叫端（`PlanPhoneView.tsx`）本來就一直有明確傳值，不受影響。
- **6 個手機版元件檔案改名**（`git mv` 保留歷史，匯出的函式名稱同步改變，僅改名不改簽名）：
  - `GeoOutlinePhoneView` → `PlanPhoneView`
  - `GeoOutlinePhoneListDrawer` → `PlanPhoneListDrawer`
  - `GeoOutlinePhoneInfoSheet` → `PlanPhoneInfoSheet`
  - `GeoOutlinePhoneDatePickerSheet` → `PlanPhoneDatePickerSheet`
  - `GeoOutlinePhoneDateCalendarSheet` → `PlanPhoneDateCalendarSheet`
  - `GeoOutlinePhoneCandidateDrawer` → `PlanPhoneTripListDrawer`（延續前一版已開始的改名，此次一併完成最後 5 個檔案；已知範圍限制：仍有未直接改動的檔案裡的註解提及舊名字，未擴大範圍清理）

### 新增

- **`SheetHead`／`StandaloneSheet`／`StackedSheet`／`PersistentSheet`／`SheetBody`**（`web/src/components/PhoneBottomSheet.tsx`）：
  - `SheetHead` 的 `title` 從 `string` 放寬成 `ReactNode`，新增選填 `actions` 插槽（渲染在關閉鈕左邊）——既有純字串呼叫端不受影響。
  - 新增三個具名工廠元件（Compound Component 模式）取代呼叫端各自決定 `exitDurationMs`/`isTopmost`/`keepMounted` 組合的舊寫法：`StandaloneSheet`（獨立開關，不屬於堆疊）、`StackedSheet`（`useSheetStack` 多層堆疊的一員，`isTopmost` 必填）、`PersistentSheet`（children 需要永遠留在 React 樹上，例如需要維持 WebSocket 連線的 `ChatScreen`）。
  - 新增 `SheetBody` compound component：把原本隱含在 `PhoneBottomSheet` 內部、無條件套用在 children 外層的「捲到頂才能往下拖收合」交接邏輯，改成呼叫端自己在 JSX 裡宣告 `<SheetBody>` 才套用，不宣告就是普通內容；支援 `forwardRef` 取得內部捲動容器 DOM 節點做程式化捲動。
- **`web/src/components/zLayers.ts`／`zLayers.css`**：新增具名 z-index 常數（`Z_LAYERS`、`PLAN_SHEET_STACK`、`PLAN_SHEET_BACKDROP`）取代散落 8 處的裸數字 z-index；`zLayers.css` 額外用 CSS 自訂屬性 `--z-tab-bar` 讓 `PhoneTabBar.module.css` 不再寫死數字，消除 CSS 檔案之間各自維護相同數值卻可能漂移不同步的問題（TypeScript 端的 `Z_LAYERS.TAB_BAR` 仍是獨立複製值，CSS Modules 無跨語言常數共用機制）。
- **`web/src/hooks/useSwipeDirectionLock.ts`**：把原本寫死在 `geo-planning/PhotoCarousel.tsx` 的「位移閾值＋水平/垂直比例判定＋鎖定後 stopPropagation()」手勢仲裁邏輯抽成通用 hook，供任何「橫向手勢需要跟外層縱向拖曳仲裁」的元件複用；`PhotoCarousel.tsx` 已改用此 hook，行為不變。

### 修正

- **行程清單／地點資訊卡拉動內容到頂時 bottom sheet 不會縮小**：`finishDrag()` 原本用 `stops.indexOf(startTopRef.current)` 從數值反查手勢起點索引，這是脆弱的精確浮點數比對（`stops[0]` 隨 `containerHeight` 動態換算，resize 時可能有極小數值差異導致 `indexOf` 找不到而回傳 -1）。改成手勢開始當下直接記錄索引本身（`startIndexRef`），不再反查。
- **拉動內容到頂、sheet 開始縮合瞬間畫面抖動／突然縮一大段**：`SheetBody` 的拖曳交接判斷原本用「從 touchstart 算起」的位移量，若手指在內容未捲到頂前已經滑動一段距離（被原生捲動吃掉），交接瞬間會把這段「原生捲動已消耗的位移」一併套用到 sheet 的拖曳位移上，造成視覺跳動。改成交接那一刻重設位移基準，從 0 重新累積。
- **手機版對話小匡捲動容器依賴 `closest('main')` 標籤名稱猜測**：原本 `TripPlanPage` 內部用 `closest('main')` 往上找捲動祖先，`SheetBody` 取代原本的 `<main>` 包裝後找不到。改用 `TripPlanPage` 既有但手機版未使用的 `scrollContainerRef` prop，呼叫端明確傳入 DOM ref，不再依賴任何標籤名稱猜測。
- **`PhoneContent.tsx` 設定頁／配速表遺漏套用具名工廠元件**：仍直接呼叫 `PhoneBottomSheet` 而非 `StandaloneSheet`，已補上（code review 發現）。
- **`trip/PhoneTripsDrawer.tsx` 改用 `SheetBody` 取代 `ScrollArea` 後遺漏補償樣式**（code review 發現）：原本 `ScrollArea` 帶的 `padding: 0 12px 16px`、iOS `-webkit-overflow-scrolling: touch` 慣性捲動未補回，導致內容貼齊面板邊緣、舊版 iOS Safari 捲動頓挫。`-webkit-overflow-scrolling: touch` 補進共用的 `.bodyScrollable`（所有 `SheetBody` 呼叫端受益），padding 比照 `PhoneTimelineDrawer.tsx` 用呼叫端自訂 `CONTENT_PADDING_STYLE` 補回。
- **對話氣泡「想去哪裡」定位拉不準**：根因是 `.citySearchAiBtnAnchor` 缺少 `display: inline-flex`，依賴瀏覽器隱性 flex-item 行為。
- **手機版對話輸入框文字偏小**：`trip-plan/TripPlanPage.module.css` 新增 `.compact .input { font-size: 16px }`，只影響手機版對話小匡，對齊搜尋框字級；不影響桌面版 `/trip-plan` 全頁路由（維持 14px）。

### 清理

- 移除 `PhoneContent.module.css` 的死碼 `.planScroll`（原本配合 `closest('main')` 的 `<main>` 包裝，該包裝已移除，CSS 規則隨之不再被引用）。
- 修正 2 處過時註解（`PlanPhoneInfoSheet.module.css`/`.tsx`、`PlanPhoneListDrawer.module.css` 仍提及已不存在的 `mode="snap"` 字串參數，現已改成 `snapPoints`/`minHeightPx` 數值參數）。

## v0.29.1 — 2026-10-10

### 新增

- **時間軸小圓點拖拉調整時間（預設關閉）**：`PlanTimelineView` 新增選填 props `getStopTimeDragBounds`／`onDragStopTime`，拖動站點小圓點可每 18px 前進／後退 30 分鐘，邊界由新增的 `getTimeDragBounds(timeline, stopId)`（`web/src/plan-core/planTimeline.ts`）依同一天前後站點的時間算出；同檔新增 `minutesToTime`、`TimeDragBounds`。以編譯時 feature flag `TIME_DRAG_ENABLED`（`VITE_FEATURE_TIME_DRAG`，見 `web/src/DesktopShared.tsx`、`web/.env.example`）控制，未設為字串 `"true"` 時完全不啟用。
- **`PlanTimelineView` 的地點卡可替換**：新增選填 `renderStopCard` 插槽與 `StopCardRenderContext` 型別，呼叫端可自行渲染地點卡內容而不修改共用元件的 `.stopCard` 樣式；另新增選填 props `onRemoveStop`、`onHoverTransit`。皆為選填，既有呼叫端不受影響。
- `removeNode` 新增選填第三參數 `opts?: { allowRemoving?: boolean }`，預設行為不變。

### 變更

- **功能介紹頁「AI編排行程」手機小展示改為直接渲染 `AiPlanPhoneDemoScreen`**（新增，`web/src/home/AiPlanPhoneDemoScreen.tsx`）：固定 390×844 手機版面、不依賴 `@media` 斷點、使用靜態圖片地圖（`web/src/home/assets/ai-plan-demo-map.png`）加模擬時間軸、本身不可互動，點擊整支手機仍連到 `/ai-plan`。取代原本的 `<iframe src="/ai-plan?embedded=1">`，省掉獨立 document 與網路請求。`/ai-plan` 的 `?embedded=1` 參數目前沒有呼叫端，保留作為日後整頁嵌入的入口。
- **`/ai-plan` 展示頁地圖由 Static Maps 圖片換成 `NativeMapBase` 真實互動地圖**，站點以 `usePlanStopMarkers` 畫圓點；`usePlanSimSocket` 改為匯出，供小展示重用。

### 清理

- 移除不再有任何引用的 `web/src/home/plan-ai-sim/StaticMapBackdrop.tsx`／`.module.css`；順手更新註解中仍把它當成現況的描述。
- 本版**沒有破壞性變更**：所有新增符號與參數皆為選填或新增，被移除的 `StaticMapBackdrop` 只在 `plan-ai-sim/` 內部使用。

## v0.29.0 — 2026-10-09

### 破壞性變更

- **`web/src/plan-core/planTimeline.ts` 的 `removeNode` 改回傳結構化結果**：原本回傳值是 `PlanTimeline`（找不到對應 id 時原樣返回該參數，呼叫端無從分辨成功或失敗），改成 `RemoveNodeResult`（`{ ok: true; timeline } | { ok: false; error: { code: 'anchor_not_found' | 'already_removing'; message } }`），對齊既有 `insertAfter`/`InsertAfterResult` 的設計。新增 `already_removing` 錯誤碼：節點已標記 `removing: true`（淡出動畫播放中、尚未真正從鏈結摘除）時呼叫，也視為失敗而非靜默成功——修正原本「動畫播放期間對同一 id 重複呼叫會被誤判成功」的問題。呼叫端（`TripPlanPage.tsx`、`home/plan-ai-sim/AIPlanTimelinePage.tsx`）均已同步改用新回傳型別。
- **`web/src/plan-core/attractionTools.ts` 的 `AttractionStepsCtx` 介面新增必填方法 `removeStep`**：任何既有實作這個介面的呼叫端，若未補上這個方法會編譯失敗。

### 新增

- **AI 規劃對話的「刪除已排入景點」能力**：新增 onagent 工具 `remove_attraction`（`server/tools/plan-ai/remove_attraction.yaml`），讓對話能把時間軸上某個既有節點整個移除——底層 `removeStep`（`useTripPlanTimeline`）原本就為此預留，這次補上工具層串接。
- **AI 規劃對話改為「先送自家後端再轉發 onagent」模式**：新增 `POST /internal/plan-ai/chat`／`POST /internal/plan-ai/chat/reply` 兩支後端端點（`server/internal/api/plan_ai_chat.go`），對應新增的 `plan_ai_chat_messages` 資料表（`server/internal/model/model.go`、`server/internal/store/plan_ai_chat.go`）：使用者送出的訊息先經後端驗證、per-user rate-limit（`planAiChatRateLimiter`，預設 60 秒 10 次，估計值）、存檔，才轉發給 onagent；onagent 的回覆也會回存。記錄只關聯 `userID`，刻意不綁 `tripID`（延續同一次頁面掛載期間的 `conversationID`，重新整理會開新對話）。前端 `web/src/api.ts` 新增對應的 `postPlanAiChat`/`postPlanAiChatReply`。
- **Admin 後台新增「AI 規劃對話」分頁**：顯示所有使用者送出的 AI 規劃對話訊息（依時間排序），讀取來源就是上述新增的 `plan_ai_chat_messages` 表，新增 `GET /admin/api/plan-ai-chat-logs` 端點（`server/internal/adminconsole/plan_ai_chat_logs.go`）。

### 修正

- **AI 規劃對話 `pendingChatRef` 的 FIFO 配對可能錯位**：`AgentBridge` 的 `assistant_message` 回呼協議本身不帶 `requestId`，若使用者在等待回覆時又送出下一則訊息，回覆到達順序與送出順序不一致時，原本的 FIFO 佇列會把錯誤的回覆內容存成另一則訊息的回覆。改成在等待回覆（`isThinking`）期間禁止送出下一則訊息（UI 與邏輯層各自擋一次），並修正 `onError` 時未清空佇列導致後續永久錯位的問題。
- **AI 規劃對話輸入框在送出結果回來前就被清空**：若後端拒絕（429 rate-limited／400 內容過長）或網路錯誤，原本輸入框已經被同步清空、使用者打的文字永久遺失；改成等送出結果回來才決定是否清空。
- **`apigateway.RateLimiter` 的 `windows` map 新增惰性過期清除機制**：原本以使用者 ID 為 key 的限流元件（`geoQueryUserRateLimiter`、`planAiChatRateLimiter`）不會回收不再活躍使用者的視窗狀態，隨歷史上出現過的使用者數量單調增長；新增 `maybeSweepLocked`，每隔 1000 次 `Allow` 呼叫清除一次閒置視窗，門檻取 `max(1 小時, 該 key 的視窗長度)`，避免視窗長度本身設定得較長的 key 被誤判成閒置而提早清空重算。

## v0.28.0 — 2026-10-09

### 破壞性變更

- **桌面版 side panel（旅程列表／規劃／時間軸／路徑）展開與收合改回純本地 UI 狀態，不再綁定網址**：原本 `panelMode` 由 `/app/:panelMode` 網址驅動，讓重新整理、瀏覽器上一頁下一頁、分享連結都能還原到對應面板；改成 `DesktopLayout.tsx` 自己的 `useState` 後，這個能力不再存在——重新整理、分享 `/app/timeline` 這類連結、瀏覽器上一頁下一頁，現在都只會落在收合狀態。`/app/:panelMode?` 路由整段移除，`isPanelMode`/`PANEL_MODES`（驗證 URL 路徑參數合法性的輔助函式）隨之移除。為了不讓先前分享／加入書籤的舊深連結（`/app/trips`、`/app/geo-outline` 等）命中 404，補回一條只接受單層路徑片段的相容路由 `/app/:legacyPanelMode`，渲染跟 `/app` 完全相同的內容、忽略參數本身。
- **AI 規劃改為獨立路由 `/trip-plan`，移除 `/app/plan-ai` 面板**：`PanelMode` 型別移除 `'plan-ai'` 成員，`PANEL_REGISTRY`／`DrawerMode` 同步移除對應項目，桌面版 Rail 的「規劃」按鈕與 `.betaTag` 入口整個拿掉。新增 `trip-plan/TripPlanRoute.tsx` 作為 `/trip-plan` 的頁面外殼（自己管深色模式 token 與捲動容器，不依賴 `/app` 底下的版面機制；訪客內嵌登入卡片，登入後顯示 `TripPlanPage` 本體），後端 `static.go` 路由白名單同步新增 `/trip-plan`。舊網址 `/app/plan-ai` 轉址到 `/trip-plan`，保留外部連結與書籤相容性。地圖右上角對話小匡（含站點小圓點與雙向連動）維持不變，與 `/trip-plan` 並存；手機版底部「規劃」sheet 不受影響。

## v0.27.2 — 2026-10-09

### 修正

- **`/app`（登入後的正式功能頁）加上瀏覽器分頁標題「Tripace | 規劃」**：原本沒有自己的 `<title>`，SPA 內部換頁後瀏覽器分頁標題仍停留在 `index.html` 的靜態標題。仿照其餘城市頁既有的 `react-helmet-async` 模式補上，目前先固定寫死這個值，不跟著左側 Rail 切換的功能分頁（旅程列表／規劃／時間軸／路徑／AI 規劃）動態變化。

## v0.27.1 — 2026-10-09

### 新增

- **九份／京都／台南安平／赤崁四個城市介紹頁的固定導覽列加上「功能介紹」CTA 按鈕**，對齊 `HomePage` 既有模式，連到 `/product`。`SiteNavCta` 新增 `slot="2-wide"` 變體，處理這四頁第一顆按鈕文字「立即開始」比 `HomePage` 的「登入」寬、無法直接套用既有 `slot={2}` 偏移量的問題。

### 變更

- **`CityPageFooter`／`ExploreOtherCities`／`ScrollTimeline` 三個共用元件改用必填的 `accentColor` prop**（經新增的 `accentColor.ts` 提供的 `AccentColorProp` 型別統一管理），取代原本「呼叫端 CSS 自行定義同名變數」的隱性契約。舊模式沒有任何編譯期或執行期檢查，曾經導致九份／京都頁遺漏 `--timeline-accent`（地圖面板邊框顏色跑掉）、台南安平頁更是從未定義過 `--footer-accent`（頁尾 hover 顏色一直失效而未被察覺）；改成必填 prop 後，呼叫端忘記傳值會在編譯期直接報錯。
- **`ScrollTimeline` 地圖面板的定位邏輯改成「左緣包覆時間軸、右緣反推置中於視窗」**，取代先前「扣除時間軸寬度後置中」的方案（會讓地圖與時間軸在視覺上分離、留白不對稱）。相關定位算式一併改成讀取共用的 `--timeline-layout-padding-left` 自訂屬性，避免日後版面微調時兩處規則各自失步。
- 四個城市頁的 `ScrollTimeline` 外層容器版面數值（`max-width`／`margin`／`padding`）收進新增的 `ScrollTimelineContainer.css` 共用，不再四頁各自重複定義同一組數字。

### 修正

- **`/ai-plan` 展示頁地圖黑底回歸**：`StaticMapBackdrop` 的 `object-position` 曾經改成 `calc()` 精確公式，想解決超寬螢幕下視覺焦點偏移的已知限制，但這個 `calc()` 混合百分比／像素的寫法在實際瀏覽器渲染時會讓地圖右側大片區域變成純黑色塊（瀏覽器接受這個語法、卻無法正確渲染），已撤銷改回原本的百分比估算寫法。
- `/ai-plan` 展示頁「── 行程結束 ──」文字在地圖背景上對比度不足、不易閱讀，`PlanTimelineView` 新增選填的 `endMarkerClassName` prop 讓展示頁疊加文字陰影提升可讀性，不影響 `/app` 正式頁的既有樣式。
- `/ai-plan` 展示頁「已安排幾站」狀態膠囊從頂部品牌列移到輸入匡最前面；新增 `PlanTimelineView` 的選填 `hideEmptyState` prop，移除對話尚未開始前的空狀態引導文字，同樣不影響 `/app` 正式頁行為。
- 赤崁頁清除套用 `ScrollTimeline` 前遺留的舊版面死碼（進度指示點、互動地圖開頭容器相關樣式）——其餘三個城市頁在同一次改造時已清除，唯獨這頁殘留約 120 行未使用的 CSS。

## v0.27.0 — 2026-10-08

### 新增

- **功能介紹頁（`/product`）底部新增「精選景點」卡片區塊**：復用既有的 `ExploreOtherCities` 共用元件，展示全部四個城市介紹頁（京都/九份/台南安平/赤崁府城）的卡片，讓看完功能介紹的訪客能順勢點進城市頁。`ExploreOtherCities` 新增可選 `eyebrow` prop（預設「更多目的地」，四個城市頁不受影響），`/product` 傳入覆寫成「精選景點」，貼合「從功能介紹頁推薦去哪裡玩」的情境。

### 變更

- **台南安平頁（`/tainan-anping`）改套用 `ScrollTimeline`**，取代原本「獨立進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自獨立的結構，改成左側時間軸縮圖＋右側可展開的嵌入式小地圖，隨捲動同步移動（做法對齊先前 `/tainan-chikan` 的既有改造模式）。原本的 `useScrollProgress`/`MobileMapReveal` 機制、`.tainan-progress-rail`/`.tainan-map-intro` 相關樣式一併移除。
- 6 站全部補上地圖中心座標（`center`）：安平古堡、安平樹屋沿用資料庫既有記錄；億載金城、延平街、海山館以 CLI geocode 工具實查 Google Places 取得真實座標；「運河淤積與港口機能轉移」（無對應單一地標的抽象轉折敘事）以「安平運河公園」代表淤積後港區機能轉移的實際地理範圍。

### 修正

- `TainanPage.css` 補上 `--timeline-accent` 變數定義——改套用 `ScrollTimeline` 後，時間軸目前點外框、地圖面板邊框/陰影等強調色樣式皆依賴這個變數，先前漏填導致這些元素解析不到值、強調色完全失效。

## v0.26.0 — 2026-10-08

### 新增

- **地圖規劃的對話小匡改用 AI 規劃時間軸**，取代原本走 `trip_entry_*` 工具的 ChatScreen（舊對話框移到 demo 分頁保留）。`/app` 的對話小匡與 `/app/plan-ai` 全頁版共用同一份規劃內容。
- **時間軸持久化**（`web/src/plan-core/planTimelineStorage.ts`）：寫進 localStorage，重整後規劃內容與 AI 已排的站點都還在。`PlanTimeline.nodes` 是 `Map`，而 `JSON.stringify` 對 Map 會輸出 `{}` 並靜默丟失全部內容，故自訂序列化；刻意不跟 trip 綁定（跨行程的單一草稿）。
- **地圖顯示 AI 規劃的站點小圓點**（`web/src/geo-planning/usePlanStopMarkers.ts`）：與 `tripEntry` 的旗子刻意區分——旗子是已寫進資料庫的正式行程項目，圓點是還沒落進任何旅程的規劃草稿，尺寸也更小。強調態（選取／hover）用靶心＋光暈＋一次性漣漪，兩者再以外環墨濃度與光暈擴散區分「錨定 vs 掃過」。
- **時間軸卡片與地圖雙向連動**：點卡片把地圖平移到該站並高亮圓點、滑鼠移到卡片時圓點加強顯示、點地圖圓點回頭高亮對應卡片。

### 修正

- **onagent WebSocket 反覆重建**：`useAppState` 的 `cfg` 每次 render 都是新物件，而下游 `usePlanAiChatBridge` 用它當 effect 依賴——任何一次 state 更新都會 cleanup 再開一條新連線，實際觀察到單一頁面累積出 9 條。連帶造成規劃結果寫不進時間軸（agent 還在推論，連線就被下一次 render 關閉）。改用 `useMemo` 只在 `token` 變動時換 identity。
- **兩份時間軸實例互相覆蓋**：`TripPlanPage` 會同時掛載兩份（常駐的對話小匡 + 切到 `/app/plan-ai` 的全頁版），共用同一個 localStorage key 卻各自只在掛載時讀一次。在全頁版規劃完切回地圖，小匡那份舊內容（常是空的）下一次寫入就把剛規劃好的全部蓋掉。加入版次（`rev`）機制：寫入前先追上磁碟內容再計算；存檔失敗回傳 `null` 且不推進 state——若讓記憶體套用而磁碟沒有，版次會謊稱一致，之後會被另一實例靜默抹掉，且 `revRef` 一旦高於磁碟版次，「我是否過期」的判斷將永遠為 false，機制等同失效。
- **選取狀態回不去**：`selectedStopId` 原本在 `TripPlanPage` 與 `DesktopLayout` 各存一份、只有子→父單向上報，而點地圖圓點是直接寫父層那份。「點卡片 A → 點地圖圓點 B → 再點卡片 A」時，`setSelectedStopId('A')` 因值未變而被 React bail out、上報 effect 不重跑，地圖永遠停在 B。改為受控的單一事實來源，並把上報從 effect 改成事件驅動（每次點擊都通知，不看值變不變）。
- **景點縮圖載入失敗顯示破圖**：`photo_assets` 有 7 天過期，而時間軸是持久化的、可以存在更久，舊節點的 URL 失效是預期中的事。縮圖 `<img>` 補上 `onError`，整組失敗時退回 `thumbIcon` + 底色佔位，Lightbox 也不會翻到破圖。
- **地圖圓點被蓋住**：marker 建立時未帶 `zIndex`，而同步 effect 在狀態未變時會提早 return，導致重建後強調中的圓點 `zIndex` 停在預設值。
- **連點同一個目標地圖不動**：`panTarget` 的消費端依賴拆開的純量（lat/lng/…），同一座標連續設定兩次時所有依賴都沒變。加入選填的 `nonce`，讓「使用者又點了一次」這個事件語意能被表達。

### 變更

- **SEO 產品定位更新**（首頁與 `/product`）：不再描述已經不是主線操作的「候選籃 → 日層架」流程，改以 AI 編排行程為主軸。前後端兩份（`web/index.html` 與 `cmd/server/seo_meta.go`）必須逐字一致——SSR 的 `applySEOMeta` 是用 `strings.Replace` 原文比對後替換，差一個字就會靜默失效、爬蟲拿到首頁預設文案。
- 移除 `TripPlanPage` 的 header 工具列：最後只剩一顆狀態藥丸，而站數在時間軸上一目了然、「正在安排」由底部骨架卡在生成的位置本身表達，比固定在頂端的一行字更精準。

## v0.25.2 — 2026-10-07

### 變更

- 舊網域 `tripace.shuttle.tools` 改為整站 301 永久轉址到現在的正式網域 `tripace.io`（`cmd/server/main.go` 的 `withLegacyDomainRedirect`，沿用原本處理 `app.shuttle.tools` → `tripace.shuttle.tools` 的同一套機制，只是轉址目標換成這一輪的網域遷移）——不再是過渡期並存，透過舊網域存取的使用者/搜尋引擎索引會被導到新網域。
- 移除更早期處理 `app.shuttle.tools` 舊網域轉址用的獨立服務：`server/cmd/redirectserver`、`Dockerfile.redirect`、`.github/workflows/deploy-redirect.yml` 一併刪除；正式環境對應的 Cloud Run 服務 `tripace-redirect` 與 `app.shuttle.tools` 的 domain-mapping 經確認皆已不存在，不需額外清理。

## v0.25.1 — 2026-10-07

### 新增

- 新網域 `tripace.io` 上線，過渡期與既有 `tripace.shuttle.tools` 並存運作，兩者皆指向同一個 Cloud Run 服務（DNS ALIAS 記錄、domain-mapping、SSL 憑證皆已設定完成）。
- SEO 網域（canonical/og:url/og:image/twitter:image 與四個城市頁面的 JSON-LD breadcrumb）改用環境變數驅動，不再分散寫死在多個檔案：後端新增 `SITE_BASE_URL`（`cmd/server/seo_meta.go`），前端新增 `VITE_SITE_BASE_URL`（`AppCommon.tsx` 匯出 `SITE_SEO_BASE_URL`），兩者預設 fallback 皆為 `https://tripace.io`。`SITE_BASE_URL` 只透過 CD 部署流程（Cloud Run 系統環境變數）設定，不支援本機 `.env` 檔案（套件層級變數初始化早於 `.env` 載入，寫在 `.env` 不會生效，故 `server/.env.example` 不再列出這個變數）；`Dockerfile`/`deploy-cloudrun.yml` 已補上對應的 `--build-arg`/`--update-env-vars`。
- `web/public/sitemap.xml`、`robots.txt` 改指向 `tripace.io`（維持手寫，不走環境變數）。

## v0.25.0 — 2026-10-07

### 破壞性變更

- **候選籃「候選中清單」與「從候選加入」候選匡整個移除**：`web/src/geo-planning/AddFromCandidateSidebar.tsx`（含 `.module.css`）整個刪除，桌面版/手機版候選籃（`GeoCandidateSidebar.tsx`、`GeoOutlinePhoneCandidateDrawer.tsx`）都只保留「已排入行程」顯示與拖放改期；加入行程改成「選地點 → 直接選日期 → 加入時間軸」單一流程，不再有「加到候選 → 再從候選加入」兩段式操作。`onReturnToCandidate`/`handleReturnToCandidate`/`pickingDayKey`/`onlyCandidates`/`handlePickFromCandidate` 等相關 state/callback 一併移除，呼叫端需同步更新。
- **`GeoListItemCard` 移除，改為全專案通用的 `components/ListItemCard.tsx`**：原本耦合 `ClientConfig`/`fetchGeoPlacePhoto` 的查詢邏輯下放到各呼叫端自行維護，改以 `leading`/`trailing`/`badge` 插槽組裝；`web/src/geo-planning/GeoListItemCard.tsx` 已刪除，任何直接匯入這個檔案的程式碼需要改用新元件。

### 新增

- 手機版底部功能列重組：「探索」「行程」搬到底部常駐列，AI 規劃改名「規劃」；旅程清單（`PhoneTripsDrawer`）與行程抽屜（`GeoOutlinePhoneCandidateDrawer`）合併成一組雙向連動的 bottom sheet（選清單自動開行程、行程關閉視情境回彈清單、點行程項目收合不關閉、關地點資訊卡後行程自動復原展開）。
- 行程/清單項目圖示從灰色佔位或 `MapPin` 換成語意化圖示（`entryKindIcon`/`Luggage`），統一所有手機版 bottom sheet 的關閉按鈕視覺樣式。
- `PhoneTripsDrawer` 文案「新增旅程」→「新增清單」，補上關閉按鈕。

### 修正

- `docs/audit-trip-list-merge-2026-10.md` 審查文件列出的 3 項延後問題全數補完並刪除該文件：`GeoOutlinePhoneView.tsx` 的 `onCandidateDrawerActiveChange` 補上穩定參照提醒註解；`useGeoPlanningState.ts` 頂部過時的平台差異說明（仍提及已移除的 `pickingDayKey`/`onlyGeoCandidate`）更新為目前實際狀態；全專案多處殘留的已刪除檔名（`AddFromCandidateSidebar`/`GeoListItemCard`）註解改指向現存元件，`PhoneTripsDrawer` 殘留的「旅程」舊用語統一為「清單」。純文件/註解修正，不含邏輯變動。

## v0.24.2 — 2026-10-06

### 修正

- Dockerfile 的 `web-build` 階段在 `npm ci` 之前新增 `npm install -g npm@12.2.0`，修正 node:22-alpine 內建 npm 版本在 `npm ci` 時的依賴解析 bug 導致 web-build 階段失敗的問題。

## v0.24.1 — 2026-10-06

### 修正

- 重新產生 `package-lock.json`（以 npm 12.2.0、在 linux/amd64 平台），修正 Docker build 內 `npm ci` 失敗的問題。

## v0.24.0 — 2026-10-06

### 新增

- 新增 `ScrollTimeline` compound component（`<ScrollTimeline>`/`<ScrollTimeline.Anchor>`）：文案隨捲動、左側時間軸漸進顯示錨點、右側可展開嵌入式小地圖的互動機制，取代原本單純的資料驅動寫法，讓呼叫端可以自由排版文案、只在想標記的地方插入錨點。`<ScrollTimeline.Anchor>` 支援 `theme`（指向資料庫主題點，取得開卡/附近景點揭露等完整效果）或 `center`（直接指定任意座標，單純移動地圖視角）兩種定位方式。
- `InteractiveExploreMap` 新增一組 opt-in prop（`focusedTheme`/`focusedCenter`/`openCardOnFocus`/`themeCardNearbyOnly`/`disableThemeCardOnMapClick`/`revealNearbyOnFocus`/`themePhotoOnlyWhenFocused`/`restrictRadiusKm`/`showZoomControl`），讓嵌入式地圖情境可以受控切換聚焦點、控制主題卡是否顯示/以精簡模式顯示、調整可拖曳範圍——皆為新增且預設關閉，九份/京都/台南等既有城市頁呼叫方式與行為完全不變。
- 地圖上的精選點標記新增獨立的 `focused` 視覺狀態（深紅色淚滴圖釘，與既有的候選景點 `selected` 狀態完全獨立、互不干擾），供 `ScrollTimeline` 聚焦到某個精選點時套用；主題點新增可選的「只有被聚焦時才顯示圓形照片、其餘時候退化成小圓點」行為（`themePhotoOnlyWhenFocused`），照片收起時有淡出轉場。
- `/demo/scroll-timeline` 新增 ScrollTimeline 互動示範頁（假資料）。
- `/tainan-chikan`（赤崁・府城介紹頁）套用 `ScrollTimeline`，取代原本「獨立進度點 nav + 分站列表 + 頁尾固定地圖區塊」三段各自獨立的結構。

### 修正

- `geoQueryUserRateLimiter` 的預設節流規則改以「每分鐘次數」表示（`200ms/1次` → `60秒/300次`，換算等效，實際速率不變），對齊同一輪 `places.get`/`photoMedia` 兩個 endpoint 的分鐘表示法；補上連續請求放行/拒絕邊界與多使用者配額互不影響的測試。
- 新增路由層級的 `ScrollRestoration`：修正主題介紹頁捲到最底部後切換到另一頁，新頁面仍停留在底部（未捲回頂部）的問題。

### 已知問題（詳見 `docs/audit-functional.md` F42-F49）

- 🟠 `ScrollTimeline` 面板停留在「附近景點」模式時捲動到沒有 `theme` 的錨點，舊主題卡不會收掉（目前因「附近景點」按鈕被暫時隱藏而休眠，尚未修復）。
- 🟠 套用 `ScrollTimeline` 後，`/tainan-chikan` 手機版地圖從「點了才載入」退化成「進頁面就無條件載入」，尚未修復。
- 🟡 `/tainan-chikan` 原本的進度點跳轉導覽（跳到任一站/跳回地圖）被移除、未提供替代方案。

## v0.23.0 — 2026-10-06

### 破壞性變更

- **`attractions.photo_url` 資料庫欄位本身已實際 `DROP COLUMN`**（連同 `place_details_cache.new_photo_count`/`google_photo_target_count`），不只是 v0.22.0 移除的 API 回應相容欄位——這是兩個不同層級的東西：v0.22.0 移除的是 `GET /internal/geo/place-details` 等 API 回應裡的 `photoUrl` 複寫欄位，這次移除的是 `model.Attraction.PhotoURL` 這個 Go struct 欄位與對應的 DB column 本身。新增一次性維運工具 `cmd/migrate-drop-photo-url`（搭配 `Dockerfile.migrate-drop-photo-url`、Cloud Run Job 部署流程）執行這個不可逆的 schema 變更。
- `store.Store.IncrementPlaceClickCount` 回傳值簡化為 `(clickCount int64, err error)`（原本還回傳 `newPhotoCount`/`googlePhotoTargetCount`，隨兩個欄位一併移除）；`store.Store.CreateAppleUser`/`CreateGoogleUser` 新增必填的 `email` 參數——呼叫端需要同步更新,舊呼叫碼無法編譯通過。
- `POST /internal/maintenance/attractions/{id}/update-photo` 不再支援 `source: "pexels"`，改以查詢到的 Google Place 照片寫入 `photo_assets` 表（不再寫回已移除的 `photo_url` 欄位）；`POST /internal/maintenance/attractions` 建檔不再接受任何照片相關輸入，不再自動查 Pexels 補圖。
- **CLI（`server/cmd/cli`）指令語法整體改成「資源 動詞」兩段式**，所有舊指令字串全部失效（例如 `list-trips` → `trip list`、`attraction-add` → `attraction add`、`attraction-update-photo` → `attraction photo-update` 且移除 `-source` 旗標、改用 `-place-id`）。完整對照見 `tripace-cli` skill 文件。
- 後台管理介面移除「Photo target zero check」整頁功能（`GET`/`POST /admin/api/photo-target-zero-check*`、對應前端 Tab 與 API client 方法），改用新的 CLI 查詢指令 `attraction query -status no-google-photo` 取代。

### 新增

- CLI 新增 `attraction query -status no-google-photo [-city]`，查詢「有 place_id 但還沒有 Google 照片」的景點清單，對應新路由 `GET /internal/maintenance/attractions/query`。
- 修正 Apple/Google 登入建立的使用者 `email` 欄位永遠是 `NULL` 的既存問題：建立帳號時補寫入 `email`，既有帳號重新登入時自動 backfill（`store.BackfillUserEmailIfMissing`）。
- `attraction photo-update` 新增 `place_id` 來源優先序（請求帶的 `-place-id` > 該地標既有登記的 place_id > 查詢命中的結果），讓「補照片」與「補 place_id」兩件事脫鉤，不再互相耦合。

### 修正

- `server/.env.example` 的 `GCS_PHOTO_BUCKET` 本機開發預設值改成獨立的 `-dev` bucket，避免本機測試寫入正式環境的 `photo_assets`。

## v0.22.0 — 2026-10-05

### 破壞性變更

- `GET /internal(或 public)/geo/place-details`（一般模式）與 `GET /internal(或 public)/geo/place-photo-assets` 兩支 API 回應，移除 `photoUrl` 相容欄位——這個欄位原本是 `googlePhotoUrls` 清單第一張的複寫，供還沒改用多圖 UI 的舊呼叫端使用，前端已全面改讀 `googlePhotoUrls`，故不再序列化進回應。`photoOnly=1`/`textOnly=1` 這兩種查詢模式的回應形狀不受影響。任何外部直接呼叫這兩支 API 並讀取 `photoUrl` 欄位的呼叫端，需要改讀 `googlePhotoUrls[0]`。

### 新增

- `/product` 功能介紹頁補上專屬 SEO meta（title/description/canonical），修正原本 canonical 沿用首頁預設值、導致無法被 Google 獨立索引的問題。
- 地圖上主題點（isTheme）的照片查詢新增主動重試機制：查無照片時每隔 2 秒重查一次、最多 3 次，跟點開詳情卡時的既有重試邏輯一致；精選點維持單次查詢、失敗靜默，避免一次揭露大量精選點時疊加過多背景重試。
- Google Places/Geocoding API 的拒絕型限流（RateLimiter）新增涵蓋 `places.searchText`、`places.searchNearby`、`geocode` 三個先前只靠排隊節流保護的 endpoint；後台管理介面「Google API rate limits」頁面同步可管理。

### 變更

- Google Places/Geocoding API 的排隊型節流（Gateway 的 `MaxConcurrency`/`MinInterval`）預設改為不限制——短時間一批查詢在舊的排隊機制下容易讓排在後面的請求等待逾時，總量防護責任改由拒絕型 RateLimiter 統一負責。

### 修正

- 修正地圖上主題點/精選點的縮圖判斷「有沒有圖」改用 `googlePhotoUrls` 陣列長度，不再依賴即將移除的 `photoUrl` 欄位。
- 修正主題點照片重試查到新照片後，共用快取（`placeDetailsCache`）沒有同步更新的問題——先前查到新照片只會更新地圖縮圖，使用者點開詳情卡時仍會看到查詢剛觸發時的舊快取（無照片），且沒有任何機制會自動修正。
- 修正 AI 規劃版行程時間軸的照片重試機制：因為 `place-photo-assets` 回應不再帶 `photoUrl`，重試邏輯改成從 `googlePhotoUrls` 第一張衍生，避免即使背景補圖完成、縮圖仍永遠卡在沒有照片的狀態。
- 修正 Geocoding API（`geo.Client.Geocode`，供地址轉座標使用）在上述排隊節流解除後完全沒有任何節流保護的缺口——先前排隊節流解除時只把四個 Places endpoint 納入新的拒絕型限流，遺漏了共用同一個 Gateway 的 geocode 呼叫路徑。

## v0.21.5 — 2026-10-04

### 修正

- 修正子頁面（九份/京都・清水寺/台南・安平/赤崁・府城）在 Google 等搜尋引擎索引時，`<title>`/`canonical`/`description`/OG 與 Twitter 分享卡片標籤全部錯誤指向首頁的問題——本站是純前端渲染的 SPA，所有路由原本共用同一份 `index.html`，搜尋引擎第一次抓取、JS 尚未執行時讀到的都是首頁內容，很可能是這些子頁面始終沒有被獨立收錄的根因之一。
- 修正前端 `react-helmet-async` 動態改寫 `<head>` 時，不會移除 `index.html` 原有的靜態標籤、只會在旁邊追加一份，導致 JS 執行完成後同時存在兩個互相矛盾的 `canonical`（一個指向首頁、一個指向正確頁面）的問題——Google 官方文件記載多個互相矛盾的 canonical 會被直接忽略。改由 server 端統一輸出 `title`/`description`/`canonical`/`og:*`/`twitter:*`，作為唯一事實來源；四個子頁面的 React 元件僅保留 `<title>`（覆寫 `document.title` 不會重複/衝突）與 JSON-LD structured data，其餘重複宣告已移除。
- 更新 `sitemap.xml` 中受影響四個子頁面的 `lastmod`。

### 內部

- `Dockerfile` 新增建置階段測試，驗證真實前端建置產物的 `index.html` 仍包含預期的 SEO 標籤片段；若比對目標找不到、或測試因拼字錯誤等原因沒有真正執行，建置會直接失敗，不會讓壞掉的 SEO 設定悄悄上線。

## v0.21.4 — 2026-10-04

### 新增

- 城市介紹頁（九份/京都/台南安平/赤崁・府城）手機版主題點卡片的「附近景點」清單改為左右滑動瀏覽，滑動時地圖上對應的精選點會即時放大顯示縮圖、並在該點不在目前可視範圍內時自動將地圖移動過去。
- 地圖上景點標籤/縮圖新增自動避讓機制：多個景點座標距離過近、視覺上互相重疊時，依優先序（使用者正在互動的 > 主題點 > 一般精選點）自動隱藏較低優先序的標籤文字，避免文字互相蓋住看不清楚。
- 手機版主題點卡片收合到最小高度時，過濾標籤列固定顯示在標頭、不隨卡片收合而消失。

### 變更

- 手機版主題點卡片開啟期間，地圖上對應主題點原本顯示的縮圖會暫時隱藏，避免卡片內容與地圖縮圖同時重複呈現。
- CLI 工具（`tripace-cli`）登入憑證改依 API 位址分開存放，本機開發環境與正式環境的登入狀態不再互相覆蓋。

### 修正

- 修正手機版主題點卡片在地圖容器尚未展開（手機版「點一下探索地圖」縮圖尚未點開）時，底部收合高度計算錯誤導致卡片被固定在錯誤高度、內容空白且無法拖曳展開的問題。
- 修正地圖上同一批景點座標彼此接近時，縮圖/圓點/標籤的疊放順序不穩定（有時被蓋住、有時正常）的問題——根因是每個景點疊層各自建立獨立的視覺堆疊層級，子層的顯示優先序設定從未真正套用生效；改為统一由景點本身的疊層容器決定優先序。
- 修正台南赤崁・府城介紹頁地圖預設開啟的主題點名稱寫錯，導致進入頁面時沒有任何主題卡片自動展開。
- 修正資料庫中「赤崁樓」同時存在重複記錄（一筆誤標為主題點）的問題，已清理本機與正式環境資料。
- 修正「附近景點」清單文字間距過大、左右滑動時定位邏輯錯誤導致地圖畫面跳動的問題。

## v0.21.3 — 2026-10-04

### 新增

- 後端新增以使用者為單位的查詢節流（預設 200 毫秒一次），套用在所有會呼叫 Google API 的查詢端點，避免單一使用者短時間內大量操作造成計費異常。
- 正式地圖「直接點擊 Google 原生 POI 圖標」與「點擊非主題點地標」這兩種操作，補上查無照片時自動重試的機制（與主題卡、附近景點、AI 規劃卡片等既有入口一致），避免剛好遇到背景補圖還沒完成時，卡片永遠沒有照片可看。

### 變更

- Google API 查詢節流改以「每分鐘」為單位計算：地點資訊查詢放寬為每分鐘 300 次，地點照片下載為每分鐘 60 次，避免原本以秒為單位的限制太嚴格，在連續查詢時容易被誤擋。
- 後台管理介面的 API 節流設定頁面，改用「每分鐘次數」直接輸入，取代原本「視窗秒數＋次數」兩欄位分開設定的方式，操作更直覺。

## v0.21.2 — 2026-10-02

### 新增

- AI 規劃功能（正式頁 /app 與展示頁 /ai-plan）的景點查詢改套用跟地圖功能一致的漸進補圖機制，查詢結果若有多張 Google 照片，時間軸卡片縮圖現在支援點擊開啟全螢幕瀏覽（1 張或多張皆可放大檢視，多張時可左右切換）。

### 變更

- 正式頁 /app 與展示頁 /ai-plan 的時間軸畫面（景點卡片、交通估算、備註、對話訊息等）改為共用同一份元件實作，不再各自獨立維護容易脫節的複製版本。
- 移除時間軸頁面右上角固定小地圖功能（原本預設關閉，未對外曝光）。

### 修正

- 修正展示頁 /ai-plan 的對話輸入框缺少堆疊順序設定，導致生成過程中偶爾被時間軸卡片內容遮蔽的問題。

## v0.21.1 — 2026-10-02

### 修正

- 修正 GA4「瀏覽量（劃分依據：網頁標題與畫面名稱）」報表看不出各頁面差異的問題：全站是 React Router 的用戶端路由（SPA），站內導覽換頁不會重新整理瀏覽器，GTM 容器預設的頁面瀏覽偵測只在最初的文件載入觸發一次，之後完全沒有任何事件告訴 GA4「使用者換頁了」。新增路由變化監聽，每次切換頁面手動推送 page_view 事件（含 page_path/page_title/page_location）。

## v0.21.0 — 2026-10-02

### 新增

- 新增正式公開頁面 /tainan-chikan：赤崁・府城「老地方的前世今生」兩日遊介紹頁，從內部試做頁 /tainan-chikan-draft 轉正，外殼架構對齊九份頁/京都頁/台南安平頁的既有模式（互動地圖、進度導覽點、分段長頁、SEO meta/JSON-LD）。
- 首頁目的地清單新增「赤崁・府城」項目，連到新頁面，並補上點擊追蹤事件。
- 赤崁・府城頁面的頂部「立即開始」按鈕補上點擊追蹤事件（先前只有頁尾按鈕有追蹤，對齊其餘城市頁的既有涵蓋範圍）。

### 變更

- 互動地圖（九份/京都/台南安平/赤崁等頁面共用）的可拖曳範圍限制從 2km 半徑放大一倍為 4km。

## v0.20.3 — 2026-10-01

### 新增

- 功能介紹頁「核心功能」區塊新增「觀看展示」按鈕，從 AI 編排行程卡片直接連到 AI 規劃展示頁。
- 首頁、功能介紹頁、九份頁、台南安平頁的轉換按鈕（頂部「立即開始」、頁尾主要按鈕）新增點擊追蹤，用於衡量各主題介紹頁的轉換情形。

### 變更

- 功能介紹頁「自動編排行程」卡片改名為「AI編排行程」並移到第一個位置，拿掉「即將推出」提示——已不是未上線的試做功能。
- 全站「免費開始使用」按鈕文字統一改為「開始使用」。

## v0.20.2 — 2026-10-01

### 變更

- 「AI 規劃」展示頁網址從 /plan-ai 改為 /ai-plan。

## v0.20.1 — 2026-10-01

### 修正

- 修正 v0.20.0 新增的 /plan-ai 展示頁在正式環境直接訪問（或重新整理）時會收到 404 的問題：後端判斷「合法路徑」的白名單沒有同步加入這個新路由，導致伺服器端把它當成未知路徑處理。

## v0.20.0 — 2026-10-01

### 新增

- 新增獨立公開展示頁面 /plan-ai：固定播放一段兩日台南行程的腳本，用來展示「AI 規劃」功能的排程時間軸長什麼樣子；不需要登入，也不會呼叫正式功能共用的地圖查詢或 AI 對話後端，純前端固定假資料。
- 排程時間軸元件支援「多天行程」概念：同一份行程可以標示不同天，畫面會在跨天的地方自動插入分隔線，不需要再手動插入分段標記。

### 變更（含破壞性）

- 「AI 規劃」頁面不再顯示行程名稱（原本會顯示旅程名稱或「未命名行程」），因為外層桌面版/手機版已經各自有行程情境，重複顯示沒有必要——連動的 tripName 傳入方式已移除，若有其他呼叫端仍在傳遞行程名稱給這個頁面，需要一併移除。
- 手機版底部導覽列原本的「對話」分頁改為「AI 規劃」，並加上 BETA 標示。

### 修正

- 修正排程時間軸在「跨天分隔線」邏輯中，若某一站的天數比前一站更早（而非更晚）時，該站會被誤併入前一天、完全不顯示分隔線的問題。
- 修正共用的頂部漂浮品牌按鈕元件在未提供頁面標籤文字時，會忽略呼叫端額外傳入內容的問題。

### 測試

- 補齊多天行程分隔線在「天數非遞增」情境下的回歸測試覆蓋。

## v0.19.0 — 2026-09-30

### 新增

- 「AI 規劃」功能（/app/plan-ai）不再需要部署時另外開關，成為正式核心功能，與規劃地圖看齊。

### 變更（含破壞性）

- 「AI 規劃」查詢景點、地點詳情、交通時間等後端功能，改為需要登入才能使用——先前任何人都能直接呼叫，改動後未登入會收到需要登入的回應。
- 移除未受保護、任何人都能直接訪問的獨立展示頁面（/plan-ai），避免有心人士藉此大量消耗與正式功能共用的地圖查詢與 AI 對話額度。
- 「AI 規劃」對話功能改用與既有對話功能共用的平台網址設定，部署設定簡化為單一組來源。

### 修正

- 修正桌面版從「AI 規劃」頁面切回規劃地圖時，地圖偶爾維持空白、需要重新整理頁面才會顯示的問題。

## v0.18.4 — 2026-09-28

### 新增

- 規劃地圖在開新旅程（尚無任何已排定地點）時，會嘗試取得使用者目前位置當作地圖初始畫面，並在地圖上顯示一個藍點標示所在位置；使用者拒絕定位權限或裝置不支援時，維持原本的預設畫面。

### 測試

- 補齊上述定位功能成功／失敗／不支援／既有地點優先四種情境的測試覆蓋。

## v0.18.3 — 2026-09-28

### 新增

- 登入 token 失效時，網站會自動登出並回到登入畫面，不再需要使用者自己發現操作一直悄悄失敗才手動登出。

### 修正

- 修正登入狀態在特定情況下（例如登入紀錄只被部分清除）畫面仍顯示已登入、但實際上所有需要登入的功能都會失敗的問題。
- 修正 CLI／裝置登入核准流程中，若登入過期導致核准失敗，畫面會直接跳回登入畫面而看不到任何錯誤訊息的問題。

### 測試

- 補齊上述登入狀態一致性檢查與自動登出行為的測試覆蓋。

## v0.18.2 — 2026-09-28

### 新增

- 管理後台新增「Attractions missing place_id」核對清單，列出所有沒有對應 Google Place ID 的景點區域，並提供一鍵重查按鈕，自動搜尋並寫回正確的 Place ID。
- 附近景點清單拿掉顯示筆數上限，改成完整列出，與地圖上的顯示範圍一致。

### 修正

- 一般使用者登入過期時，先前的錯誤訊息誤導使用者去執行開發者用的指令；同時修正這則錯誤訊息的資料格式與其他錯誤訊息不一致、導致前端顯示不出正確內容的問題。

## v0.18.1 — 2026-09-28

### 新增

- **管理後台可查看並手動重置「Google 照片 target=0」名單裡的個別地點**：既有的核對清單新增直接顯示照片目標數量的欄位；核對確認某一列是舊資料而非合法的「已確認沒照片」後，可以直接在後台把它重置回「尚未確認」狀態，讓下次查詢時重新跟 Google 確認。
- **正式環境部署補上 GCS 照片儲存桶的授權掛載**：先前主服務的部署設定漏掉這項授權，導致漸進補圖下載到的新照片完全無法真正落地儲存——只有透過先前的一次性遷移工具搬進來的舊照片能顯示，之後所有需要「補圖」的地點永久補不上。這是正式環境「無法補圖成功」問題的根因，現已修復並於正式環境部署驗證。
- 首頁地圖入口縮圖新增周邊光暈的呼吸動畫，強化「這裡可以點」的視覺引導。

### 修正

- 背景補圖流程原本多處失敗會完全靜默、不留下任何紀錄，難以排查——現在會留下紀錄，方便後續追蹤補圖失敗的實際原因。
- 管理後台重置某個不存在的地點時，先前會誤報成功；現在會明確回報找不到對應紀錄。
- 修正一處可能讓外部服務金鑰意外流入紀錄的風險：某些網路層級的錯誤內容原本可能包含完整的請求位址，現在會先過濾掉不必要的細節再留下紀錄。

### 測試

- 補齊上述管理後台重置功能、找不到對應地點兩種情境的測試覆蓋。

## v0.18.0 — 2026-09-27

### 破壞性變更

- **公開展示頁的地點查詢授權改變**：不再用手動維護的固定景點清單，改成「只要是已建檔的景點就能查」；公開版與登入版的取圖行為（含漸進補圖）從此完全一致。
- **主題卡／景點介紹卡不再回傳舊版照片欄位**：改成一律以新的統一圖片紀錄為準，不回退任何舊資料。
- **完全移除 Pexels 作為照片來源**（僅限主題卡／景點介紹卡這條路徑），同時補上一個安全缺口：先前有個輕量查詢模式會繞過授權，讓未登入者能觸發 Pexels 查詢。

### 新增

- **圖片改用統一的落地紀錄機制**，取代原本兩張各自存完整圖片內容的舊表，資料庫不再背負儲存圖片位元組的負擔。
- **沒圖時前端會自動重試**：查完地點詳情若還沒有照片，每隔 2 秒原地重新確認一次、最多 3 次；卡片文字內容第一次查完就立即顯示，重試只補照片、不拖慢卡片出現；查詢中的佔位圖疊加載入動畫。
- **新增一次性圖片遷移工具**：把舊表的圖片內容遷移落地到雲端儲存，分兩階段執行（可重複執行的遷移階段、需人工確認後才執行的刪除階段），支援乾跑模式與範圍過濾。

### 修正

- 圖片紀錄重複寫入同一筆資料時會失敗的問題（影響遷移工具的可重跑性）。
- 「沒圖時自動重試」功能先前因為後端路由遺漏，在正式環境完全無法運作，現已修復並實測確認生效。

### 測試

- 補齊圖片落地紀錄的讀寫邏輯、遷移工具兩階段流程、地圖圖示照片查詢的測試覆蓋，先前皆為零。

## v0.16.0 — 2026-09-22

### 新增

- **台南・安平介紹頁補齊景點與 SEO**：STOPS 新增「億載金城」（純敘事，未建檔於資料庫）、「海山館」取代地理上不屬於安平的「神農街」；新增河岸咖啡、德記洋行、安平航海城三筆景點區域資料（已關閉的「0343選物店」同步從後端 allowlist 與資料庫移除）；補齊 `og:image`／`twitter:image`／JSON-LD `image` 等社群分享用 meta（之前缺漏，分享連結不會顯示縮圖）。
- **手機版城市介紹頁地圖新增不顯示餐飲/旅宿樣式**：`NativeMapBase` 新增可選 `mapId` prop（不傳時沿用既有 `VITE_GOOGLE_MAPS_MAP_ID`，正式規劃功能不受影響），`InteractiveExploreMap` 改用專屬的 `VITE_GOOGLE_MAPS_LANDING_MAP_ID` Cloud Style（`docs/map-style/*-no-food-lodging.json` 為對應樣式快照：`pointOfInterest` 父層整批關閉標籤、只重新開啟 landmark／recreation／entertainment 三個子分類）。
- 首頁「目的地」列表補上台南入口（修正此前的孤兒頁面問題），三個入口新增 `landing_destination_click` GA 事件。
- 本機開發環境（`VITE_DISABLE_ANALYTICS=1`）現在會完全不載入 GTM 容器腳本，而不只是排除 `trackEvent` 自訂事件——原本 GTM 容器本身在任何 React 程式碼執行前就已載入，即使排除自訂事件仍會觸發預設 pageview，本機測試流量被誤計入正式站統計。

### 重構

- 抽出 `useThemeToggle`／`useScrollProgress` 共用 hook 與 `CityPageFooter` 共用元件，京都／九份／台南三個城市頁移除約 130 行重複邏輯；footer 精簡對齊首頁既有結構（移除「產品功能」「更多景點」sitemap 區塊），改用 `--footer-accent` 中性 CSS 變數統一 hover 顏色（各頁在自己作用域指向各自的強調色 token）。

### 其他

- `ProductPage.tsx` 功能清單以「主題景點」（主題點／精選點分級揭露機制）取代已移除的「拖曳排入日程」項目。
- 京都／九份／台南三頁「立即開始」CTA 按鈕背景由完全透明改為低透明度頁面背景色，避免捲動內容穿透影響可讀性。

## v0.15.0 — 2026-09-21

### 新增

- **台南・安平介紹頁**（`/tainan-anping`）：比照九份、京都介紹頁模式，港口地形→貿易→淤積轉型→人文重生因果鏈的分段長頁，嵌入互動地圖並支援日夜切換、進度導覽點；後端補上對應的路由白名單、景點/地點詳情 allowlist（安平古堡、安平樹屋等 7 個地點），`sitemap.xml` 補上路由條目。
- **手機版城市介紹頁地圖改為「圓形縮圖 → 點擊展開滿版地圖」**（新元件 `MobileMapReveal`）：手機版一進頁面先顯示圓形地點縮圖，不立即建立 Google Maps（避免一進頁面就付出建圖成本），點擊縮圖後才掛載 `InteractiveExploreMap` 並以 `clip-path` 圓形展開動畫過渡到滿版（`100dvh`）地圖；展開後鎖住 `body` 捲動，避免地圖上彈出的 bottom sheet 捲動觸底時，觸控手勢穿透拉動底層頁面造成破版。京都、九份介紹頁套用此元件；地圖邊緣淡化效果同時改為只在桌面版套用，手機版維持清晰直角邊界。

### 已知缺口（待後續處理）

- 手機版地圖展開機制導入後，原本 hero 區塊對所有使用者、所有狀態都可見的「SCROLL」捲動提示已移除，改成只在 `MobileMapReveal` 的圓形縮圖畫面顯示——桌面版使用者、以及手機版已展開地圖的使用者，目前沒有任何往下捲動的視覺引導。
- `useIsDesktop`（768px）與地圖邊緣淡化 CSS 的手機斷點（900px）不一致，768–900px 寬度區間會出現桌面版地圖版面卻套用了手機版淡化歸零規則的不一致外觀。
- 首頁「目的地」列表、京都／九份頁尾「更多景點」清單尚未加入台南頁連結，僅能透過 sitemap／搜尋／直接網址進入該頁。

## v0.14.0 — 2026-09-21

### 新增

- **京都獨立介紹頁**（`/kyoto-kiyomizu`）：比照九份介紹頁模式，把原本內嵌在首頁的京都東山捲動視差敘事獨立成一個頁面，敘事文案照搬首頁既有內容，圖片搬遷到 GCS（`landing/kyoto/`），嵌入互動地圖並支援日夜切換即時換色、進度導覽點、開頭自動聚焦。
- 九份、京都介紹頁各自加上專屬的 SEO meta（`<title>`／`<meta description>`／OG／Twitter card／canonical，透過新引入的 `react-helmet-async`），取代原本整站共用首頁預設值的狀況；`sitemap.xml` 補上這兩條路由。
- 首頁新增「目的地」文字列表區塊，取代原本的完整京都捲動敘事與互動地圖，改為列出九份、京都兩個城市介紹頁的連結入口。

### 修正

- **`/jiufen`、`/kyoto-kiyomizu` 直接訪問或重新整理回傳 404**：`server/cmd/server/static.go` 的 `knownRoutePatterns` 白名單未同步新路由。
- **管理後台（`/admin`）被 PWA service worker 攔截成 404**：主應用的 `navigateFallback` 未排除 `/admin` 路徑，導致對它的導航請求被誤導回主應用的 `index.html`；`navigateFallbackDenylist` 補上 `/admin` 排除規則。
- **九份頁面公開展示頁「加入行程」按鈕靜默失效**：訪客身份下按鈕會展開日期選單，選定後卻沒有任何動作（沒有候選籃/行程可寫入，也沒有提示登入）；`PlacePanel`／`GeoOutlinePhoneInfoSheet` 新增 `requireAuth` optional prop，公開展示頁改為點擊後直接導向登入頁。
- `JiufenPage.tsx` 頁尾「更多景點」連結指向首頁而非京都介紹頁的錯字修正。

### 重構

- **`KiyomizuDemoPage` 更名為 `InteractiveExploreMap`**：這個元件已從最初的京都限定 demo，演變成首頁／九份頁／京都頁三個正式頁面共用的互動地圖元件，新名稱不再暗示綁定單一城市或暫時性質；新增 `initialZoom`／`centerNorthOffsetKm` 兩個 optional prop，讓呼叫端依景點分布密度覆寫地圖初始縮放與中心點偏移。
- 首頁移除舊版京都捲動視差敘事（SVG 手繪路徑動畫、逐站文字、bloom 展開照片）與內嵌互動地圖的全部程式碼與樣式（`HomePage.css` 約 426 行死碼一併清除）。
- `KyotoPage.css` 選擇器統一補上 `.kyoto-page` scope 前綴，避免與 `HomePage.css` 的 `.kyoto-bloom` scope 下同名 class 混淆。

## v0.13.1 — 2026-09-20

### 新增

- 首頁 hero 區塊「開始探索」按鈕旁新增「體驗探索地圖」按鈕，點擊直接捲動到下方互動地圖展示區塊，讓想直接摸真實產品的訪客不需要先看完整段手繪路徑敘事動畫。

### 修正

- `sitemap.xml` 的 `lastmod` 更新為各頁面實際最後修改日期（原本停留在 `2026-08-12`，未隨後續改動更新）。

## v0.13.0 — 2026-09-20

### 新增

- **主題點/精選點兩級揭露機制**（`attractions.is_theme` 欄位）：地圖預設只顯示主題點，點開後才揭露該主題點周邊的精選點；精選點可對應 Google `place_id`，接上既有的漸進補圖機制。
- **散策羅盤展示頁**（`KiyomizuDemoPage`）：嵌入首頁 `HomePage` 的互動地圖區塊，手機版支援點擊或滾動觸發全螢幕展開、右上角關閉按鈕退出；小卡片狀態下在地圖上滑動會正確轉為頁面捲動，不再被地圖手勢吃掉。
- **`geo_rate_limits` 資料表與後台管理介面**：地點查詢／照片下載的限流視窗、上限次數、每日額度改為可透過後台即時調整，不需重新部署。
- 手機版地點資訊卡新增「附近景點」清單，分類篩選改為點擊已選中的分類即取消（移除原本的「全部」按鈕）。

### 修正

- **`place_details_cache.google_photo_target_count` 預設值死鎖 bug**：`0` 同時代表「未確認」與「已確認且真的是 0 張」，導致某些地點永遠卡住、不再重新確認 Google 端照片張數。欄位預設值改為 `-1`（未確認 sentinel），並在 `store.Open()` 加入一次性資料修復，每次啟動自動修正符合條件的既有卡住資料列。

### 重構

- `GeoOutlineMap.tsx` 拆分為 `ExploreMap.tsx` + `NativeMapBase.tsx`，地圖建置與 overlay/marker 邏輯分離；抽出 `useAttractionOverlays`／`useInfoCardStack`／`useThemeAttractionSelection` 等共用 hook，供桌面版、手機版、展示頁三處共用同一套邏輯。
- 移除獨立的 `/demo/kiyomizu` 展示路由，保留 `HomePage` 首頁內嵌入的版本。

## v0.12.2 — 2026-09-10

### 修正

- **`/product` 頁面請求誤回 404**：`server/cmd/server/static.go` 的 `knownRoutePatterns` 白名單漏了同步 `web/src/App.tsx` 已存在的 `/product`（`ProductPage`）路由，導致伺服器誤判成未知路徑、故意回真正的 404 狀態碼——回應內容仍是可正常渲染的 `index.html`，故畫面顯示正常，但瀏覽器開發者工具的 document 請求會顯示 404，可能影響 SEO 收錄判斷。

## v0.12.1 — 2026-09-02

### 修正

- **Pexels 照片缺圖時永久不會補查**：`handleGeoPlaceDetails` 快取命中／降級回應分支新增 `ensurePexelsPhotos`，只要 Pexels 沒圖且 Google 也沒圖（`cached.NewPhotoCount == 0`）就嘗試補查一次，取代原本「Pexels 只在地點第一次被查詢時查一次、之後永遠不再嘗試」的行為——已實測重現：手動清空某地點的照片快取後，卡片會永久顯示空白，直到這次修正。
- **CI 部署腳本明確帶上地點速率限制參數**：`GOOGLE_PLACES_GET_RATE_LIMIT_*`／`GOOGLE_PLACES_PHOTO_MEDIA_RATE_LIMIT_*` 加進 `deploy-cloudrun.yml` 的 `--update-env-vars`，讓正式環境實際生效的限流參數在部署設定裡可見，之後調整不需要改程式碼重新編譯（行為與原本的程式碼預設值等價，純粹讓設定顯性化）。

### 文件

- `docs/audit-place-photo-cost-control-2026-09.md` 補上三項後續稽核發現：R4（第一次查詢撞上限流會整體降級成空白卡片）、R5（已修正，見上）、R6（`GetPlaceDetails` 與 `ListPlacePhotoRefs` 共用同一個 `places.get` 限流 key，兩者同時觸發時後者必然被前者用光的額度擋下，已查證修法方向為合併成同一次查詢）。

## v0.12.0 — 2026-09-02

### 新增

- **地點照片改為 Google／Pexels 雙來源並列，Google 端漸進補圖**（`handleGeoPlaceDetails`）：點擊地圖上 Google 原生 POI 圖標查詢地點詳情時，照片不再是「Pexels 優先、查無才 fallback Google」互斥擇一，改成兩種來源同時並列顯示（`googlePhotoUrls`／`pexelsPhotoUrls`）。Google 端因 Photos 欄位屬 Enterprise 級計費，改成依「點擊節奏 OR 距上次查詢逾 7 天」雙觸發條件才重新確認該地點實際照片張數，每次至多補下載一張，不再一次查詢就下載到上限，大幅降低單次查詢成本。
- **拒絕型速率限制元件 `apigateway.RateLimiter`**：對「地點資訊查詢」（10 秒視窗最多 1 次）與「地點照片下載」（10 分鐘視窗最多 1 次）分別設定獨立上限，超過視窗上限直接拒絕、不排隊等待，取代原本 `apigateway.Gateway` 純排隊型節流在長時間持續請求下總量無上限的缺口。
- **同一地點併發請求改為搶佔丟棄**：原本用 `singleflight.Group` 合併同一 placeID 的併發查詢（後續請求等待、共享結果），改用 `sync.Map` 搶佔機制——同一 placeID 若已有請求在處理，後續並發請求立即丟棄（不等待），降級改讀現有快取回應，使用者體驗上仍能看到內容，只是這次沒有觸發新查詢。
- 單點地點介紹查詢路徑新增 `PhotoDataURIUnrestricted`，不再受 `GOOGLE_PLACES_FETCH_PHOTOS` 全域開關控制（改由上述新機制控管成本），飯店照片／附近景點候選卡片縮圖等其餘照片查詢路徑維持原樣受此開關控制。
- 手機版地點介紹卡（`GeoOutlinePhoneInfoSheet.tsx`）補上 `PhotoCarousel` 元件（原本只有桌面版有）：多張照片時可自由橫向捲動瀏覽（不用 scroll-snap 吸附），每張照片各自帶圓角與間距，首尾張顯示時對應側留白、其餘情況貼齊卡片外緣；新增左右滑動時鎖住卡片上下拖曳手勢的方向鎖定，避免瀏覽照片時誤觸卡片收合/展開。
- 新增 `docs/audit-place-photo-cost-control-2026-09.md`，記錄這次改動前後對 Google API 呼叫成本控制的稽核結果與風險處理狀態。

## v0.11.1 — 2026-09-01

### 新增

- **安裝 Google Tag Manager**（容器 `GTM-563D8TXG`，`web/index.html`）：容器代碼放在 `<head>` 開頭、`<noscript>` 備援放在 `<body>` 開頭，符合官方安裝規範。容器內已設定「GA4 設定」代碼（測量 ID `G-ZSPVT49BNE`，觸發條件 All Pages）並發布，之後新增 Google Ads 轉換等追蹤只需在 GTM 後台調整，不需再改動程式碼。

### 修正

- **登出未清除殘留旅程**（FE21）：`onLogout` 補上 `setActiveTrip(null)` 並清除 `LS_DEFAULT_TRIP`，避免換帳號後沿用舊 `tripID`。
- **切換旅程時意外彈出鍵盤**（FE23）：`ChatScreen` 輸入框移除 `autoFocus`，改由 `open` prop 轉為 `true` 時的 effect 手動聚焦。
- **地圖類別標籤連點造成查詢結果亂序覆蓋**（FE24）：`runPlacesQuery` 加入 `requestId` 防護，只採最新一筆回應。
- **快速切換候選卡片時舊查詢覆蓋新卡片內容**：`patchGeocodeCandidateText`／`patchGeocodeCandidatePhoto` 加入 `placeId` 二次確認。
- 移除已退化成死碼的 `geoListDrawerState` reducer，`GeoOutlinePhoneView.tsx` 改用單純的 `listLoading` state（FE8）。
- 補上日期選擇／日曆 sheet 缺少的退場動畫。
- 新增 `--ios-sand` 深色模式 token，修正 attraction 地圖光暈、地標佔位圖、地名標籤底色在夜間模式下不正確或不可讀的問題；修正 `tripEntry` marker 誤用 attraction 色而非 accent 色。
- 補上 Google 帳號登入（GSI 模式，v0.11.0 之前已隨 commit `b8c1d2f` 加入）正式環境所需的部署配置：`GOOGLE_OAUTH_CLIENT_ID` 納入 Secret Manager 管理腳本，並補上兩份 Cloud Run 部署 workflow 缺少的 build-time `--build-arg` 與執行期 `--update-secrets`——先前功能程式碼已存在，但未部署到正式站即無法運作。

## v0.11.0 — 2026-08-30

### 新增

- **手機版規劃地圖的地點清單／地點介紹卡／日期選擇改由統一堆疊管理**（`GeoOutlinePhoneView.tsx` 新增 `sheetStack`，`components/useSheetStack.ts`）：原本清單開關（`listDrawerState.open`）與資訊卡開關（`geo.infoContent`）是兩條獨立真相來源，任何新增的「打開資訊卡」入口（點地圖 marker、城市搜尋唯一解、候選籃選取）都繞過堆疊直接操作，導致堆疊記錄與畫面實際顯示不同步。改為所有入口統一透過 `push`／`replace`／`pop`／`closeAll` 操作同一個堆疊，任何時刻該顯示哪些 sheet 只需要看堆疊本身即可確定。非頂層的 sheet 仍掛載但套用退縮視覺、停用手勢。
- **搜尋結果只有一筆時（唯一解）不再顯示地點清單**，直接開啟地點介紹卡（`geoListDrawerState.ts` 的 `results-arrived` 事件依 `resultCount` 決定）。
- **「加入行程」的日期選擇改為兩層獨立 bottom sheet**：日期清單 sheet（`GeoOutlinePhoneDatePickerSheet.tsx`，既有排定日期改為縱向可捲動清單，取代原本橫向 chips）、日曆 sheet（`GeoOutlinePhoneDateCalendarSheet.tsx`，改用跟桌面版一致的 `DatePickerPopover` 月曆格線，取代原生 `<input type="date">`）；行程完全沒有排定日期時直接跳過清單、開日曆 sheet。加入成功後「加入行程」按鈕短暫變成打勾圖示提示（`geoAddCandidateState.ts`）。
- **地點介紹卡往下拖曳或收合到最小段時，下層地點清單連動縮到最小段**（`components/PhoneBottomSheet.tsx` 新增 `onDraggingDownChange`／`onSnapIndexChange`／`isTopmost`／`stackOffsetPx`），鬆手/展開後清單恢復原本段落。
- 地圖上方類別標籤列新增獨立狀態機控制隱藏/顯示（`geoCategoryTagsState.ts`），搜尋開始時立即隱藏（不等結果回來），取代原本手機版/桌面版各自一套判斷式。
- `geocodeCandidates`／`selectedCandidate` 資料擁有權從 `GeoOutlinePanel.tsx` 遷移到共用的 `useGeoPlanningState.ts`，讓上層能在關閉清單時一併清空地圖上的搜尋結果 marker；`searchResults` 改為 `geocodeCandidates` 的衍生值，不再是獨立手動同步的 state。

### 修正

- 地點清單/旅程列表的 loading 轉圈動畫尺寸過大、置中於整個容器高度：改為靠頂顯示的較小圖示。
- 「搜尋這個區域」按鈕位置改為對齊城市搜尋框下緣（原本對齊類別標籤列，在小螢幕下容易讓人誤以為兩者有關聯）。
- 移除搜尋標籤（景點/飯店/餐廳/探索）的選取態視覺高亮，底層查詢/開關邏輯不受影響。
- 修正日期選擇 sheet 選定日期後誤用 `sheetStack.closeAll()` 導致地點介紹卡本身也被一併關閉的問題（新增 `popDateSheets()`，只收掉堆疊頂端連續的日期選擇層）。
- 修正 `docs/routing-architecture.md`、`docs/terminology.md` 記載已過時的路由/元件路徑（`server/internal/api/maintenance.go` 的 `update-photo` 路由改名、`FloatingPanel`/`PanelHead` 元件搬移後路徑未同步更新）。

## v0.10.0 — 2026-08-28

### 破壞性變更

- **`api.New()` 新增 `googleClientID` 參數**（`server/internal/api/api.go`）：簽章從 `New(st, signer, devMode)` 改為 `New(st, signer, devMode, googleClientID)`，任何呼叫這個函式的程式碼需要同步更新。
- **`base-ui.css`/`desktop-layout-shell.css` 移除大量全域字串 CSS class**：`.navbar`、`.btn`/`.icon-btn`、`.new-trip-composer`、`.screen-body`、`.list`/`.row`、`.btn-primary`/`.btn-secondary`/`.btn-danger`、`.field`、`.banner`、`.desktop-layout`、`.desktop-rail`、`.desktop-sidepanel`、`.desktop-main` 等已改用型別安全的共用 React 元件（`components/Navbar.tsx`、`components/IconButton.tsx`、`trip/NewTripComposer.tsx`、`components/ScrollArea.tsx`、`components/ListRow.tsx`、`components/Button.tsx`、`components/FormField.tsx`、`components/Banner.tsx`、`DesktopLayoutShell.tsx`、`DesktopRail.tsx`、`DesktopSidepanel.tsx`、`DesktopMain.tsx`）取代，這批全域 class 名稱已從樣式表中移除，任何依賴這些字串選擇器的外部程式碼（樣式表、E2E 測試腳本等）會失效。
- **`web/src/hooks/useDragToClose.ts` 移除**：唯一呼叫端（`GeoOutlinePhoneCandidateDrawer.tsx`）已改用共用元件 `components/PhoneBottomSheet.tsx`，這個 hook 沒有其他消費者。
- **`components/PhoneBottomSheet.tsx` 的 `.body`/`.bodyScrollable` 捲動機制內部實作改變**（`touch-action` 統一改為更嚴格的 `none`，取代先前實測發現在部分裝置上無法可靠擋住雙指縮放的 `pan-y`）：不影響對外 props 介面，但依賴內部 CSS class 結構的外部程式碼（若有）會受影響。

### 新增

- **Google 登入**（GSI 模式）：前端用 Google Identity Services 官方按鈕取得 ID Token，送至新端點 `POST /v1/auth/google`；後端用 `idtoken.Validate` 驗證簽章/audience/issuer 後，比照既有 Apple 登入模式查詢/建立使用者（`google_sub` 欄位）並簽發同一套 JWT。email 已驗證（`email_verified`）且對應既有帳號時自動關聯，避免重複帳號；未驗證則拒絕，防止帳號接管。環境變數新增 `GOOGLE_OAUTH_CLIENT_ID`（後端）、`VITE_GOOGLE_OAUTH_CLIENT_ID`（前端建置期）；兩者留空時 Google 登入功能整體停用，不影響既有登入方式。
- **候選籃抽屜改用共用 bottom sheet 容器**（`geo-planning/GeoOutlinePhoneCandidateDrawer.tsx`）：原本從右側滑入的獨立實作，改成跟地點清單等其餘手機版抽屜一致的由下往上滑入語言，單段開關（比照原本開/關兩態，不含多段吸附）。
- **`components/PhoneBottomSheet.tsx` 的 `.bodyScrollable` 內容捲動改用瀏覽器原生捲動**：取代先前用 JS 手動模擬 `scrollTop` 的做法（該做法在部分裝置上會與拖曳手勢互搶事件，導致「sheet 拖曳跟清單捲動同時被觸發」），改為在已展開到最頂段時，用 CSS `overflow-y: auto` 讓瀏覽器原生接手，中途才透過 `preventDefault()` 精確交接回拖曳手勢。
- 新增基礎 UI 元件：`components/Banner.tsx`、`components/Button.tsx`（`variant="primary"|"secondary"|"danger"`）、`components/FormField.tsx`、`components/IconButton.tsx`、`components/ListRow.tsx`（含 `List`）、`components/Navbar.tsx`、`components/ScrollArea.tsx`；`components/FloatingPanel.tsx`、`components/PanelHead.tsx` 從 `web/src/` 根目錄搬入 `components/`；`trip/NewTripComposer.tsx`（旅程列表領域專屬）。
- 新增桌面版版面骨架元件：`DesktopLayoutShell.tsx`、`DesktopSidepanel.tsx`、`DesktopMain.tsx`（`unbounded`/`unboundedScroll` prop 取代原本的 CSS `:has()` 被動偵測）；`DesktopRail.tsx` 內部合併原骨架 class，新增把 `expanded` 狀態當 prop 傳給 `DesktopUserMenu` 的機制，取代原本 `:global(.desktop-rail)` CSS 選擇器偵測。

### 修正

- **手機版主畫面可以捲動到底部功能列下方**（`App.module.css`）：`.webApp` 的 `overflow: hidden` 屬性在先前多輪修改 `touch-action` 過程中被意外刪除（僅剩解釋用的註解），導致靠 `transform` 位移到畫面外的抽屜/面板在捲動時被帶進可視範圍。
- **手機版部分 bottom sheet（對話疊加層、旅程清單、候選籃抽屜）雙指縮放未被正確擋住**：`touch-action: pan-y` 在實機測試（含真實手機，非僅 DevTools 模擬）中證實無法可靠排除縮放手勢，全面改用更嚴格的 `touch-action: none`，捲動需求改在真正需要的內層元素上局部放行 `pan-y`。
- **手機版整頁一度可以左右拖動**：修正 `.webApp` 誤設為 `touch-action: pan-x pan-y`（應只放行垂直方向）的問題。
- **地點清單捲到頂端後往下拉，內容會先被瀏覽器原生 overscroll 效果拉開一段間隙**：`.bodyScrollable` 新增 `overscroll-behavior-y: contain`。

## v0.9.1 — 2026-08-27

### 新增

- **手機版地點清單改為三段式拖曳吸附**（`geo-planning/GeoOutlinePhoneListDrawer.tsx`）：原本收合（標頭）＋一個展開段共兩層，新增中間段，對齊地點資訊卡既有的三段式段落結構。
- **`components/PhoneBottomSheet.tsx` 新增 `keepMounted` prop**：`true` 時 `children` 即使 `open` 為 `false` 也不卸載，只用 `translateY` 位移隱藏。取代對話疊加層原本透過 React Portal（`mainChatSlotNode`/`chatParkingNode`/`chatPortalTarget`/`chatSheetSettled`/`createPortal`）投影 `ChatScreen` 的機制——投影內容在 React 樹上是平行兄弟節點，觸控事件無法冒泡到 `PhoneBottomSheet` 的拖曳手勢處理，導致「對話疊加層只有標頭能拖，內容區完全拖不動」。

### 修正

- **對話疊加層拖曳手勢只有標頭能拖，內容區完全無法拖動**（根因見上方 `keepMounted` 說明）：改為 `ChatScreen` 直接放進 `children`，移除整套投影機制。
- **時間軸抽屜**（`timeline/PhoneTimelineDrawer.tsx`）新增可拖曳收合到標頭的功能（原為排查上述投影問題新增的對照組，驗證完成後保留）。

## v0.9.0 — 2026-08-27

### 破壞性變更

- **手機版底部常駐列拿掉「規劃」「時間軸」入口，改為「旅程」「對話」兩項**（`PhoneTabBar.tsx`、`PhoneContent.tsx`）：規劃地圖（`GeoOutlinePhoneView`）已是唯一常駐主畫面，不再是可切換的分頁之一，故底部列不再需要額外的「規劃」入口；「時間軸」改為規劃地圖左下角專屬按鈕（此前已是如此，這次移除的是舊有殘留的底部列位置）。使用者原本能從底部列直接切到規劃地圖/時間軸的操作方式已不存在，改為規劃地圖預設可見、時間軸從地圖內按鈕開啟。
- **手機版對話、配速表從「主畫面分頁切換」改為「滿版疊加層」**（`PhoneContent.tsx`）：原本切換底部列分頁會取代整個主顯示區內容，現在對話／配速表各自透過獨立按鈕開啟一個蓋在規劃地圖之上的 `PhoneBottomSheet` 疊加層，關閉後回到規劃地圖；不再有可以「切換到對話分頁」這個操作路徑本身（改成「開啟對話」）。
- **手機版設定頁移除「API Token」「後端連線 Base URL」「健康檢查」三個區塊**（`user/SettingsScreen.tsx`）：這些是開發除錯用的資訊，非一般使用者需要的設定項目，移除後這幾項操作/資訊在畫面上不再可見（桌面版 `SettingsDialog` 不受影響）。
- **`components/PhoneBottomSheet.tsx` 移除 `mode: 'slide-close' | 'snap'` 這個 prop**，改用 `snapPoints`（由大到小排序的「離螢幕頂部距離」陣列，單位 px，取代原本以 `vh` 高度百分比表達的 `snapPoints`/`maxHeightVh`）搭配選填的 `minHeightPx`（收合段的固定高度）決定拖曳吸附的段數與位置——只給一個 `snapPoints` 值時退化為固定高度＋只能拖到底關閉的語意。這是本應用程式內部共用元件的 props 變動，不影響任何使用者可感知的行為（各呼叫端已在同一次異動中同步更新），依專案慣例（見 `.claude/skills/version-tagging/override.md`）不計入本次破壞性項目，僅記錄於此供日後檢索。
- **地理輪廓底圖（規劃地圖）移除獨立 feature flag**（`DesktopShared.tsx` 的 `GEO_OUTLINE_ENABLED`、環境變數 `VITE_FEATURE_GEO_OUTLINE` 一併移除）：已是核心功能，`PANEL_REGISTRY` 的 `geo-outline` 項目固定 `enabled: true`，不再能透過部署環境變數關閉——若有部署環境依賴這個變數關閉規劃地圖，該環境會發現規劃地圖無法再被關閉。

### 新增

- **手機版對話不再要求先選定旅程**（`PhoneContent.tsx`）：`ChatScreen` 的 `trip` prop 改為允許 `undefined`，對齊桌面版 chat-popover 既有行為，未選旅程時仍可開啟對話並直接發送訊息。
- **搜尋觸發時立即開啟地點清單並顯示載入中動畫**（`GeoOutlinePhoneView.tsx`、`GeoOutlinePhoneListDrawer.tsx`、`components/PhoneBottomSheet.tsx`）：`PhoneBottomSheet` 新增 `loading` prop（true 時 body 顯示置中轉圈動畫取代 children），搜尋一觸發就開啟清單抽屜並進入載入中狀態，不用等查詢結果回來才看到清單出現。
- **`components/PhoneBottomSheet.tsx` 新增共用進場滑入動畫**：`'slide-close'` 語意（現為單段 `snapPoints`）此前只有滑出動畫、沒有滑入動畫，現在跟多段模式共用同一套「掛載時先在畫面外、下一幀才滑入」邏輯。
- **`components/PhoneBottomSheet.tsx` 新增共用標頭元件 `SheetHead`**（標題文字＋關閉鈕），收斂原本 `GeoOutlinePhoneListDrawer.tsx`、`timeline/PhoneTimelineDrawer.tsx`、手機版設定頁各自重複刻一份的標頭 JSX/CSS。
- **桌面版對話小匡改為永遠掛載**（`DesktopLayout.tsx`、`DesktopLayout.module.css` 新增 `.chatPopoverHidden`）：關閉小匡時不再卸載 `ChatScreen`，改用 `display: none` 隱藏，避免每次開關對話都重新連線 WebSocket——對齊手機版對話疊加層的常駐掛載設計。

### 修正

- **對話疊加層滑出關閉時，規劃地圖畫面會跟著抽動偏移**（`PhoneContent.tsx`）：投影目標容器（`mainChatSlotNode`）原本隨 `chatSheetOpen` 一起提前卸載，觸發的 DOM 搬移剛好跟 sheet 滑出動畫的同一幀重疊，造成一次性版面重排波及地圖。改為投影目標的卸載延後到 `PhoneBottomSheet` 本身的退場動畫（`exitDurationMs`）播完之後。
- **對話疊加層開啟時滑入動畫看不到、直接出現在最終位置**（`PhoneContent.tsx`）：投影目標容器掛載時觸發的 `ref` callback 會連帶一次額外的 state 更新，這次更新與 `PhoneBottomSheet` 內部進場動畫的 `requestAnimationFrame` 排程在同一個瀏覽器繪製週期內互相競爭，導致「畫面外」的中間態被跳過，只看到 `transform` 的收尾動畫。改為投影目標延後掛載，確保排在進場動畫確定播完之後。
- **`PhoneBottomSheet` 內部量測容器高度的邏輯每次 render 都重新讀取 DOM**（`components/PhoneBottomSheet.tsx`）：`useEffect` 原本沒有依賴陣列，含拖曳中每一幀都會強制瀏覽器同步重新計算一次版面（layout thrashing），這個同步重排恰好跟 sheet 自身的 CSS transition 動畫同時發生，連帶讓地圖跟著抽動。改為只在 `open` 變 `true` 時量測一次。
- **`PhoneBottomSheet` 多段拖曳吸附的離頂部距離計算方向寫反**（`components/PhoneBottomSheet.tsx`）：手指往上拖曳時計算出的面板位置反而往下移動，跟預期方向相反；修正拖曳位移量的加減號。

## v0.8.2 — 2026-08-26

### 變更

- **桌面版右緣浮動卡片寬度統一為 340px**（`GeoInfoPanel.module.css`、`AttractionInfoPanel.module.css`、`DesktopLayout.tsx` 的 `GeoHotelSidebar` 容器寬度）：地點介紹卡（原 300px）、搜尋結果側欄（原 280px）改成跟既有的城市搜尋框/對話小匡一致的 340px，不再是三種混用的寬度；連帶更新 `.shiftedHotel`/`.shiftedChat`/`.chatPopoverShifted` 的偏移量換算，含補上前一版遺漏未更新的 `.chatPopoverShifted`（原本仍沿用 280px 換算出的舊偏移量）。
- **手機版地點資訊卡（`GeoOutlinePhoneInfoSheet.tsx`）版面順序調整**：改成把手 → 標頭（名稱/副標/badges）→ 圖片（左右留 16px 間距，不再滿版貼齊卡片邊緣）→ 簡介/日期選擇區，原本是圖片滿版置頂、關閉按鈕疊在圖片右上角。
- **手機版「加入行程」按鈕改為標頭區純 icon 按鈕**（`GeoOutlinePhoneInfoSheet.tsx`）：從圖片下方帶文字的按鈕，改成放在標頭關閉按鈕左邊、只有圖示的按鈕；點擊展開的既有日期 chips/日期輸入區塊維持顯示在下方內容區，不隨按鈕搬移到標頭。

### 修正

- **手機版地點資訊卡拖曳把手拉到最大高度後，繼續往上滑完全沒有反應**（`GeoOutlinePhoneInfoSheet.tsx`）：把手區域設有 `touch-action: none` 完全關閉瀏覽器原生觸控手勢處理，卡片高度到達上限（90vh）後，JS 端的展開邏輯也不再處理後續拖曳，導致使用者無法在把手上繼續往上滑動查看卡片下方被截斷的內容（簡介、加入行程按鈕等）。改為到達高度上限後，把後續的拖曳增量手動轉發成卡片內容的捲動量，讓使用者不需要放開把手、改摸內容區域即可無縫接續往上滑動。

## v0.8.1 — 2026-08-26

### 新增

- **候選籃「已排入行程」日層架，連續多天無安排時收攏成單一摘要列**（`GeoCandidateSidebar.tsx`）：長天數旅程中間若有連續多天完全沒有安排，原本會逐天各自渲染一個空白日期區塊，長天數旅程會佔用大量版面卻沒有內容；改為收攏顯示「{起日} ~ {迄日}（共 N 天）無安排」單一列，點擊可展開查看/操作區段內每一天（含拖放候選卡片），僅單一天的空白（前後皆非空白）不收攏，維持原樣顯示。

### 修正

- **正式環境部署從未設定 `PEXELS_API_KEY`，Pexels-first 照片查詢完全不會生效**（`.github/workflows/deploy-cloudrun.yml`、`deploy-with-migration.yml`、`server/scripts/update-secret-manager.sh`）：兩份部署 workflow 的 `--update-secrets` 清單一直漏了這把 key（只有本機 `server/.env` 有設定），導致正式站的地圖照片查詢直接跳過 v0.8.0 新增的 Pexels 管道，一律 fallback 到按張計費的 Google Photo Media 或完全沒有照片。`update-secret-manager.sh` 新增 `-pexels` 旗標寫入 Secret Manager，兩份 workflow 的 `--update-secrets` 補上 `PEXELS_API_KEY=PEXELS_API_KEY:latest`。
- **選日期加入行程、但尚未選定旅程時，沒有確實引導使用者切到旅程列表**（`DesktopLayout.tsx`）：`onSchedule` 分支呼叫 `setPanelMode('trips')` 帶有「再點一次同個 mode 會收合」的 toggle 邏輯，若使用者當下已經在旅程列表畫面（例如先前操作留下的狀態），會被誤判成「收合」而不是「確保開啟」。改為直接呼叫 `navigate('/app/trips')`，不受目前面板狀態影響。
- **選定旅程後，先前待補寫的候選沒有自動展開「行程」欄讓使用者確認**（`DesktopLayout.tsx`）：`DesktopTripList` 的 `onOpen` 原本選定旅程後一律收合浮動卡回到預設畫面；現在若是因為 `pendingSchedule`（選日期加入行程時尚未選定旅程）才被導來選旅程，選定後改為導向 `/app/geo-outline` 並觸發短暫 highlight，讓使用者立即看到剛補寫進去的候選是否成功。

### 變更

- **「加入行程」按鈕文字不再串接旅程名稱**（`GeoInfoPanel.tsx`、`GeoOutlinePhoneInfoSheet.tsx`）：原本顯示「加入 {旅程名稱}」，改為固定文字「加入行程」，兩元件的 `tripName` prop 一併移除（呼叫端 `DesktopLayout.tsx`／`GeoOutlinePhoneView.tsx` 同步更新）。
- **統一「行程」與「旅程」两個中文用語的定義，修正過去混用造成的混淆**（跨 `web/src` 約 40 個檔案的畫面文字與註解，`docs/terminology.md` 同步更新）：「旅程」專指 `Trip` 實體本身（選哪一趟旅行，如旅程列表、旅程設定彈窗），「行程」專指旅程裡的日層架排程內容（如候選籃「行程」欄、「加入行程」按鈕、「已排入行程」文案）。前端變數/型別名稱（`Trip`／`activeTrip`／`tripID`／`TripRole` 等）維持英文不變，只調整畫面顯示的中文字與註解用詞。

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
- **正式環境部署從未設定 `PEXELS_API_KEY`，Pexels-first 照片查詢完全不會生效**（`.github/workflows/deploy-cloudrun.yml`、`deploy-with-migration.yml`、`server/scripts/update-secret-manager.sh`）：兩份部署 workflow 的 `--update-secrets` 清單一直漏了這把 key（只有本機 `server/.env` 有設定），導致正式站的地圖照片查詢直接跳過本次新增的 Pexels 管道，一律 fallback 到按張計費的 Google Photo Media 或完全沒有照片。`update-secret-manager.sh` 新增 `-pexels` 旗標寫入 Secret Manager，兩份 workflow 的 `--update-secrets` 補上 `PEXELS_API_KEY=PEXELS_API_KEY:latest`。
- **`web/package-lock.json` 版本解析無效，Docker build 內 `npm ci` 失敗**：lockfile 在本機 npm 11 環境下產生，`vitest` v4 巢狀相依的 `vite@8.x` 要求 `esbuild@^0.27||^0.28`，被本機 npm 11 錯誤去重成跟頂層 `vite@5.x` 共用不相容的 `esbuild@0.21.5`，本機較新版 npm 容忍此無效狀態繼續運作，但 `Dockerfile` 用的 `node:22-alpine`（內建 npm 10.9.8）執行 `npm ci` 時嚴格拒絕。改在與 `Dockerfile` 完全一致的容器環境內重新產生 lockfile，讓兩份巢狀 `esbuild` 各自獨立鎖定相容版本。

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
