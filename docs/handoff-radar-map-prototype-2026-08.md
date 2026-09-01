# 工作交接：散策羅盤地圖疊加試做

2026-08-31 起筆,2026-09-01 更新。承接自 `research-curated-attraction-relationships-2026-08.md` 第 9 節「介面呈現試想」的「散策羅盤」方向,記錄目前實作進度,供下一次接續。

## 背景

`research-curated-attraction-relationships-2026-08.md` 提出三個視覺化試做方向,作者推薦「散策羅盤」(同心圓鄰近雷達 + 衛星卡片雙向連動)。原始試做是一個獨立網頁 Artifact(純 SVG,不是疊加在真實地圖上):
`https://claude.ai/code/artifact/b014e8ac-98e3-4f8c-bf07-48fd12eb5797`

目標是把這個構想落地到 tripace 正式的 Google Maps 地圖上(`web/src/geo-planning/GeoOutlineMap.tsx`),取代/補強現有的景點呈現方式。

**資料模型決策**:`model.Attraction`(`server/internal/model/model.go`)是純扁平表——只有 `id/name/cityName/lat/lng/level/radiusMeters/summary/photoUrl`,沒有「關聯」欄位。第一階段刻意**不動資料模型/後端**,純前端幾何計算(`geoDistance.ts` 的 `haversineMeters()`/`walkMinutesEstimate()`,80m/分鐘估算)。若真的要建檔,走既有 `tripace-cli attraction-add` CLI 手動建檔。

## 目前實作進度(2026-09-01)

### 主題點/精選點分級

使用者要求:「一開始先顯示主題點,進入主題後才依照附近景點顯示精選點」。

**分類方式(暫定)**:不新增後端欄位,重用既有 `model.Attraction`/`GeoAttraction` 的 `level`——`level === 1` 視為「主題點」(地圖恆顯示),其餘一律視為「精選點」(預設隱藏)。使用者明確選擇「先用 L1 代表主題」這個簡化版本,不是長期方案(見下方待確認)。

- **`DesktopLayout.tsx`**:`nearbyAttractions`(`useMemo`)只在錨點是主題點(`geoAttractionContent.level === 1`)才計算,候選限定 `level !== 1`,取最近 `NEARBY_ATTRACTION_LIMIT`(5)個依分鐘數排序(用 name+lat+lng 排除錨點自己,attraction 沒有穩定 id)。`revealedAttractionNames`(`useMemo`,`Set<string> | null`)算出同一批候選的名稱集合,傳給地圖決定要不要畫出這些精選點。
- **`GeoOutlinePanel.tsx`/`GeoOutlineMap.tsx`**:`revealedAttractionNames` 原封不動逐層轉傳給 `useAttractionOverlays`。
- **`useAttractionOverlays.ts`**:`filteredAttractions` 判斷式——`level == null`(即時查詢結果)恆顯示;`level === 1`(主題點)維持原本「依 zoom 對應知名度分級上限」規則;其餘(精選點)不吃 zoom 分級,完全由 `revealedAttractionNames.has(name)` 決定。

**⚠️ 已知的手機版行為變化(使用者已知情、暫不處理)**:`useAttractionOverlays` 桌面版/手機版共用,但只有 `DesktopLayout.tsx` 接上了 `revealedAttractionNames`。`GeoOutlinePhoneView.tsx` 完全沒碰,手機版現在**只顯示主題點,其餘所有既有的精選點(二年坂、八坂の塔、白川水路等)全部消失**,因為手機版永遠是 `undefined`。使用者選擇「暫不接手機版,先只讓桌面版進入主題後揭露」,等桌面版互動確定下來再一併接上。

### 點擊附近景點:開啟獨立地點卡

「附近景點」清單點擊後開啟一張**獨立的 `GeoInfoPanel`**(飯店/推薦地點共用的那種地點卡,不是 attraction 卡),疊在原本的 `AttractionInfoPanel` 左側並存,兩者不互斥——這是全專案第一次真正建構出 `GeoCandidate` 的 `{kind:'attraction'}` 分支(型別定義存在多年但從未被生產程式碼建構過)。

- 新增 `attractionToInfoContent()`(`geoInfoContent.ts`)把 `GeoAttraction` 轉成 `GeoInfoContent`,含 `candidate: {kind:'attraction', ...attraction}`,讓這張卡也能「加入候選/加入行程」。
- `DesktopLayout.tsx` 新增獨立於 `geoSelection` reducer 之外的 `openedNearbyAttraction` state 承接這張卡的開關,`nearbyInfoPanelRightPx` 動態算出它該疊在主題卡左側多遠(公式含 `infoPanelShiftBy` + 340px 寬度 + 12px 間隙)。
- `hoveredCuratedName`:滑鼠移到「附近景點」清單項目時(不用點擊),地圖上對應的精選點圓點會暫時展開成照片,滑開自動收回,跟點擊開卡是兩個獨立互動。

### 地圖顯示與互動細節

- 精選點在地圖上**預設只顯示散策羅盤圓點**,不是完整照片(避免地圖一開始就塞滿縮圖)——只有 hover 附近景點清單項目時才展開成照片。
- **移除「知名度」badge**(`attractionBadges()` 不再輸出 Lx 標籤)。
- **移除「探索周邊」按鈕**(`AttractionInfoPanel.tsx` 的 `onExplore`/`Compass`、`DesktopLayout.tsx` 的 `handleExploreAttraction`、`geoAttractionClick.ts` 的 `placesQueryRadiusMeters` 全部刪除)——「附近景點」清單已是主要延伸探索入口。
- **地圖縮放/平移不再自動重新查詢 attraction**:移除原本「依可視範圍自動查詢景點區域」的整個 `useEffect`,改成使用者手動按「搜尋這個區域」按鈕才觸發。
- 滑鼠指到 attraction 圖標時,該圖標 z-index 提升到最上層(`.geo-attraction-overlay:hover`/`.geo-attraction-overlay-hovered`),避免被相鄰圖標蓋住。

### 店家分類(前端寫死對照表)

使用者要求「加入像散策羅盤那樣的店家分類」,選擇「前端寫死對照表,先試做」而非後端欄位:

- 新增 `geoCuratedCategoryStub.ts`——`tea`(甜點/茶屋)/`restaurant`(傳統小吃/餐廳)/`craft`(工藝/伴手禮)/`street`(街景/散策重點)四類,`name → category` 純字串對照表,只涵蓋目前已建檔的清水寺周邊精選點(CHASEN 因查不到精確座標而跳過建檔,沒有這筆條目)。
- 「附近景點」清單項目、地圖上的精選點圓點都依分類套用對應 lucide 圖示與顏色(craft 類用 `color-mix` 壓暗 `--ios-blue`,理由是原色跟 tea 的 `--ios-sand` 色相太近、14px 圓點分不出來)。

### 已解決:滑鼠停在 attraction 上無法滾輪縮放地圖

耗時最多的 bug,經過三次失敗迭代才找到根因與解法,記錄於此避免下次重蹈覆轍:

- **根因**:`geoAttractionOverlay.ts` 原本呼叫 Google 官方 `google.maps.OverlayView.preventMapHitsAndGesturesFrom`,官方文件記載這個 API 會攔截點擊/拖曳**以及 wheel 事件**。
- 第一版修法(手動 `map.setZoom`)→ 縮放中心跑到地圖中心,不是滑鼠位置。
- 第二版修法(手動用 `map.getProjection()` 全域投影 + `this.getProjection()` 的 `MapCanvasProjection` 算出縮放後該平移的地圖中心)→ 位置仍不對。
- 第三版修法(`dispatchEvent` 轉發原始 wheel 事件到 `map.getDiv()`)→ 完全無法縮放(推測合成事件 `isTrusted:false` 被忽略,或轉發目標不是 Maps 內部真正監聽器所在層級)。
- **最終解法(已實作,`tsc --noEmit` 通過)**:完全不呼叫 `preventMapHitsAndGesturesFrom`、完全不碰 `wheel` 事件,只對 `mousedown`/`touchstart` 呼叫 `e.stopPropagation()`——真正會被 Maps 拖曳偵測誤判成拖曳手勢的是這兩個事件,不是 wheel,也不是 click 本身。維持 100% 原生縮放行為(以滑鼠游標為中心)。

### 環境問題順手修正

- `web/.env.development.local` 的 `VITE_API_BASE` 寫死區網 IP(`192.168.1.12`)已過期,實際 IP 已變成 `192.168.1.10`,已更新。
- `DesktopLayout.tsx` 一處 `attractionPanelRightPx`/`nearbyInfoPanelRightPx` 宣告順序造成的 TDZ 錯誤已修正(移到 `infoPanelShiftBy` 宣告之後)。

## 待確認的細節

- **主題點/精選點分級用 `level === 1` 是否要長期維持**:目前用既有的知名度分級欄位硬切,語意上有點勉強(`level` 原本設計是「知名度」不是「是否為主題」)。若之後同一座城市想要有「不算主題點的獨立次要景點」(例如「白川水路」這種本身值得單獨列出、不依附任何主題的次要景點),現在的規則會把它也歸類成精選點、預設隱藏。需要之後確認是否符合預期,或要不要換成專屬欄位。
- **手機版尚未接上**:使用者已知情並同意暫緩,`GeoOutlinePhoneInfoSheet.tsx` 是否也要接上同一套附近景點清單/主題揭露規則,尚未討論,下次接續應優先處理這個落差(精選點目前在手機版全部消失)。
- **滾輪縮放最終修法尚未經使用者在瀏覽器實測驗證**——唯一明確要求「這次麻煩實測」但還沒收到結果確認的項目,下次接續應優先請使用者確認。
- **候選籃側欄尚未支援 `kind:'attraction'` 候選卡片**:「加入候選並顯示候選籃」路徑(不選日期,直接把附近景點加入候選籃),`GeoCandidateSidebar`/`AddFromCandidateSidebar` 還沒支援渲染這種候選卡片——「選日期排入行程」主路徑不受影響,只有候選籃預覽這條路徑有缺口。
- **精選點資料完全來自後台手動建檔**(`tripace-cli attraction-add`),沒有串接 Google Places API——原始構想有提過要串,這次沒有實作。
- **絲線(Polyline)連線視覺效果沒有實作**:曾規劃過點擊景點時用 `Polyline` 畫一條連線的方向(fable 提案之一),後來被「開啟獨立地點卡」取代,目前不在路線圖上。

## 相關連結

- 研究文件:`docs/research-curated-attraction-relationships-2026-08.md`
- 延伸研究文件:`docs/research-attraction-explore-ux-2026-08.md`、`docs/research-curated-attraction-next-steps-2026-09.md`、`docs/research-attraction-storytelling-ideas-2026-09.md`
- 散策羅盤原始獨立 Artifact:`https://claude.ai/code/artifact/b014e8ac-98e3-4f8c-bf07-48fd12eb5797`
