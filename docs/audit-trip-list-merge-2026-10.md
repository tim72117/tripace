# Code Review:候選籃簡化／行程清單合併（2026-10）

審查範圍:這批尚未 commit 的工作區改動(26 個檔案,約 +665/-1115 行),涵蓋:

1. 移除候選籃「候選中清單」與「從候選加入」候選匡(`AddFromCandidateSidebar.tsx` 整個刪除),只保留「已排入行程」顯示與拖放改期。
2. `GeoListItemCard` 抽成全專案通用元件 `web/src/components/ListItemCard.tsx`(`leading`/`trailing`/`badge` 插槽),解耦 `ClientConfig`/`fetchGeoPlacePhoto` 依賴。
3. 手機版底部功能列重組:「探索」「行程」搬到底部常駐列,AI 規劃改名「規劃」,旅程清單(`PhoneTripsDrawer`)與行程抽屜(`GeoOutlinePhoneCandidateDrawer`)合併成一組雙向連動的 bottom sheet。
4. 行程/清單項目圖示從灰色佔位或 `MapPin` 換成語意化圖示(`entryKindIcon`/`Luggage`)。
5. 統一所有手機版 bottom sheet 的關閉按鈕視覺樣式。
6. `PhoneTripsDrawer` 文案「新增旅程」→「新增清單」。

由子代理執行完整審查(讀取 diff + 相關檔案完整內容,另派兩個子代理分別深入覆核連動邏輯與元件抽換),以下是審查結果與修正狀態。

## 已修正

### 1. 行程 sheet 關閉後無條件強制重開清單 sheet

- **檔案**:`web/src/PhoneContent.tsx`
- **問題**:只要行程 bottom sheet 曾經被打開過一次,之後任何一次關閉(按 X、下滑手勢)都會無條件重新彈出清單 sheet,不管關閉原因是什麼。使用者無法單純關閉兩層 sheet 回到地圖主畫面,體感像卡在兩個 sheet 之間出不去。
- **修法**:改用 `pendingRestoreTripsRef` 這個 ref 旗標,只在「這次打開行程抽屜是因為剛在清單裡選定了旅程」(`selectTrip` 觸發)這個情境才標記,使用者關閉**這次**打開的行程抽屜時才回彈清單;其餘情況(自己按行程按鈕打開、行程內項目收合/復原的 `activeSnapIndex` 互動)關閉時單純回地圖。

### 2. `selectTrip` 重選同一個已選定的清單仍無條件重開行程

- **檔案**:`web/src/PhoneContent.tsx`
- **問題**:`selectTrip` 沒有判斷 `t.id === activeTripID`,使用者在清單裡重複點選目前已選定的旅程(例如只是想收起清單回地圖),也會被導去重新打開行程抽屜——疊加問題 1 後體感更像卡住。
- **修法**:加上 `isSameTrip` 判斷,只有真的切換到不同旅程時才觸發「打開行程 + 標記待回彈」;點同一個旅程單純關閉清單,不節外生枝。

### 3. 行程抽屜空狀態文案仍引用已移除的「加入候選」按鈕

- **檔案**:`web/src/geo-planning/GeoOutlinePhoneCandidateDrawer.tsx`
- **問題**:候選籃中介流程已移除(「加入行程」改成「選地點→直接選日期→加入時間軸」),但空狀態提示文字仍寫「資訊卡裡按『加入候選』」,地點資訊卡上的按鈕文字其實已經是「加入行程」,會誤導使用者尋找不存在的按鈕。
- **修法**:文案改成「資訊卡裡按『加入行程』」。

### 4. `PhoneTripsDrawer` 「管理」按鈕 tooltip 漏改

- **檔案**:`web/src/trip/PhoneTripsDrawer.tsx`
- **問題**:這次已把「新增旅程」→「新增清單」、抽屜標題→「清單」等使用者可見文案統一改掉,唯獨每個項目「管理」按鈕的 `title`(hover/長按提示)仍是舊名詞「旅程設定」。
- **修法**:改成「清單設定」。

### 5. CSS 孤兒樣式

- **檔案**:`web/src/geo-planning/GeoOutlinePhoneCandidateDrawer.module.css`
- **問題**:「候選中」分組整個刪除後,JSX 永遠只渲染一個 `.section`,鄰接選擇器 `.section + .section` 不可能觸發;`.sectionHead` 對應的「已排入行程」標題 JSX 也已刪除,兩者都是無人引用的孤兒樣式。
- **修法**:直接刪除這兩段定義。

## 次要/可延後(尚未處理)

1. **`onCandidateDrawerActiveChange` 的 `eslint-disable` 依賴是脆弱假設**——`GeoOutlinePhoneView.tsx` 裡 `useEffect(() => { onCandidateDrawerActiveChange?.(candidateDrawerOpen) }, [candidateDrawerOpen])` 目前安全只因為呼叫端傳入的剛好是穩定參照的 setter,一旦日後改傳每次 render 重建的箭頭函式,會變成真正的 stale closure 但不會報錯。建議補一句程式碼註解提醒「此 callback 必須是穩定參照」。
2. **`useGeoPlanningState.ts` 頂部平台差異說明段落過時**——仍寫著已移除的 `pickingDayKey`/`onlyCandidates`,只剩 `draggingCandidate` 還存在,容易誤導後續維護者。
3. **多處註解仍提及已刪除檔案 `AddFromCandidateSidebar.tsx`/`GeoListItemCard.tsx`**(純文件性 staleness,不影響編譯/執行)——分佈在 `DesktopLayout.tsx`、`GeoCandidateSidebar.tsx`、`GeoHotelSidebar.tsx`、`GeoOutlinePhoneView.tsx`、`PanelHead.tsx`、`FloatingPanel.module.css`、`PanelHead.module.css`,以及兩份 sheetStack 測試檔的註解裡仍提到舊的 `GeoListItemCard` 延遲載入實作位置。`PhoneTripsDrawer.tsx`/`.module.css` 也還有幾處註解混用「旅程」舊名詞。

## 檢查過確認沒問題的部分

- **`ListItemCard.tsx` 解耦**:完全沒有殘留 `ClientConfig`/`fetchGeoPlacePhoto`/geo-planning 型別依賴,查詢邏輯正確下放到三個呼叫端各自維護的 `lazyPhotos`/`handleLoadPhoto`。`badge`/`trailing`/`leading` 插槽在每個呼叫端的語意與原 `GeoListItemCard` 行為一致,無 regression。
- **死碼殘留**:`GeoListItemCard`/`AddFromCandidateSidebar`/`onReturnToCandidate`/`handleReturnToCandidate`/`pickingDayKey`/`onlyCandidates`/`handlePickFromCandidate` 全專案已無任何殘留 import 或呼叫端漏改,對應 CSS 也已同步刪除。
- **TypeScript 正確性**:`npx tsc --noEmit -p .` 全專案通過,既有 `GeoOutlinePhoneView.sheetStack*.test.tsx`(7 個測試)全過。
- **trigger 計數器模式**(`exploreTrigger`/`candidateDrawerTrigger`/`restoreTrigger`/`candidateFlashTrigger`):依賴陣列只放 trigger、不放 setter 的寫法在這幾處都安全,沒有 stale closure。
- **「點行程項目收合不關閉」與「關資訊卡後自動復原展開」**:兩者都只操作 `activeSnapIndex` 這一個 state,方向一致,沒有互相覆蓋或跳回的風險。
- **`ExploreMap.tsx` 的 `hideCategoryTags`/`hideExploreTag` 雙旗標**:邏輯正確,`hideExploreTag` 只隱藏探索標籤本身,`hideCategoryTags` 隱藏整排標籤列,桌面版/手機版傳值無衝突。
- **跨檔案一致性**:`GeoCandidateSidebar.tsx`(桌面)與 `GeoOutlinePhoneCandidateDrawer.tsx`(手機)共用的 `geoCandidateHelpers.ts` 導出介面沒有遺漏更新,兩邊對「返回候選」功能的移除完全同步。
