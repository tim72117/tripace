# 前端介面稽核（audit-frontend-ui）

> **稽核慣例**（濃縮自 `.claude/skills/doc-file-format`）：本檔為持續追蹤的稽核報告，不帶日期、不逐次疊加日期章節。結構固定三大塊：「最新掃描結果」（僅本次新發現，放最上方，每次掃描整塊替換）、「進行中的發現」（跨次追蹤，項目底下用「現況（YYYY-MM-DD 複核）」更新，不重複整段描述）、「已複核為安全/已解決」（確認修復後移入，不留在進行中清單打勾佔位）。嚴重度：🔴 critical｜🟠 high｜🟡 medium｜⚪ low。
>
> **與其他稽核檔的分工**：本檔收前端介面層發現——UI 邏輯錯誤、元件生命週期、設計模式/抽象品質、視覺設計、樣式一致性。後端/跨層架構債歸 `audit-functional.md`；有安全後果的一律歸 `audit-security.md`。
>
> 2026-10-16 複核：對照 main @ 4f14828 逐項檢查，已移除 10 項已修復/已過時的發現。（注意：2026-08 掃描後多個元件已改名搬移，下文原始 file:line 引用中的 `GeoOutlinePhoneView`/`GeoOutlinePhoneInfoSheet`/`GeoOutlinePhoneListDrawer`/`GeoOutlineMap` 現為 `geo-planning/PlanPhoneView`/`PlanPhoneInfoSheet`/`geo-planning/phone/ResultList`/`geo-planning/NativeMapBase`（原 `ExploreMap.tsx` 已刪除，建圖統一走 NativeMapBase；2026-10-23 重新定位），`useSheetStack` 現位於 `components/`；各項「現況」已標註目前位置。）

---

## 最新掃描結果（2026-08-30）

**方法**：三個背景 agent 併發掃描 `web/src`，各自負責（1）潛在邏輯錯誤——聚焦近期落地的新功能（夜間模式、GSI 登入、多層 bottom sheet 堆疊、三段式拖曳吸附、keepMounted 疊加層機制）與競態/狀態一致性；（2）邏輯與設計模式優化——新架構抽象品質（`PhoneBottomSheet`/`useSheetStack`/`geoListDrawerState`）、hook 職責邊界、死碼與過期註解；（3）視覺設計與樣式——以專案 `frontend-design-guidelines` skill 為稽核基準，最優先檢查夜間模式覆蓋完整性、色彩/間距/z-index 一致性、狀態回饋完整性。三路皆已排除先前稽核已記錄的已知項目，避免重複。

**狀態**：三路掃描已完成，結果如下。

### （1）潛在邏輯錯誤

**FE20 🟠 夜間模式切換對規劃地圖完全無效（重建邏輯是死碼）**
`geo-planning/GeoOutlineMap.tsx:490`（配合 `:525`、`:649`）。`buildingRef.current` 建圖前設 true、只有 `.catch` 會重置（成功路徑刻意不解除）。第一次建圖成功後，theme 改變讓 effect 重跑時，`:489` 的 colorScheme 比對雖放行，`:490` 的 `if (buildingRef.current) return` 立刻擋掉——`:520-570`「銷毀舊實例、用新 colorScheme 重建」整段是死碼。後果：切夜間模式後地圖永遠停在建圖當下配色，重整頁面才會變。修法：成功建圖後 `buildingRef.current = false`，或把 colorScheme 變更判斷移到 guard 之前。

**現況（2026-10-16 複核）**：仍存在。元件已改名為 `geo-planning/ExploreMap.tsx`：`:600` colorScheme 比對放行、`:601` `if (buildingRef.current) return` 擋下，`buildingRef` 僅在 `:636` 設 true、`:797`（`.catch`）重置，成功路徑仍不重置（`:792-796` 註解還刻意寫「成功路徑不解除」）。姊妹元件 `geo-planning/NativeMapBase.tsx:199-210` 已用「成功路徑 `buildingRef.current = false`」修掉同一個問題（註解記載 2026-09 實測日夜切換無效），可直接照抄。

**現況（2026-10-23 複核）**：`geo-planning/ExploreMap.tsx` 已刪除（`geo-planning/` 下找不到），上述舊位置（`:600`、`:601`、`:636`、`:797`）不再存在；建圖統一走 `NativeMapBase.tsx`，該檔已用成功路徑重置 `buildingRef`，原問題實質上隨檔案移除而消失，待下次掃描確認後移入「已複核為安全/已解決」。

**FE22 🟠 搜尋進行中關閉清單，結果回來會憑空彈出資訊卡**
`GeoOutlinePhoneView.tsx:381`、`GeoOutlinePanel.tsx:327-347`、`useSheetStack.ts:62`。清單 `onClose` 只 `closeAll()`、不取消在途查詢；唯一解回來時 `onSearchResultSelect`/`onSearchResultsChange` 都呼叫 `sheetStack.replace`，而 `replace` 在空堆疊時等同 push——資訊卡自己跳出來，`setGeocodeCandidates` 還把剛清掉的地圖 marker 補回去。修法：關閉時遞增 search epoch 丟棄舊結果，並讓 `replace` 在空堆疊時不動作。

**現況（2026-10-16 複核）**：仍存在。現位置：`geo-planning/PlanPhoneView.tsx:461-466, 480-482`（`onSearchResultSelect`/`onSearchResultsChange` 內 `sheetStack.replace({type:'info'})`）、`:764-790`（清單 `onClose` 只清候選/`closeAll()`，沒有取消在途查詢）、`components/useSheetStack.ts:61-63`（`replace` 在空堆疊仍 `[entry]`）；`geo-planning/useGeoOutlineMapState.ts:126-166` 的查詢 effect 僅依賴 `[searchTrigger]`，關閉清單不會觸發 `cancelled = true`。

**FE26 🟡 資訊卡在日期 sheet 疊上來時仍是 topmost**
`GeoOutlinePhoneView.tsx:417-453`。`GeoOutlinePhoneInfoSheet` 沒有 `isTopmost`/`stackOffsetPx` prop 可轉傳（`GeoOutlinePhoneInfoSheet.tsx:252-263`），堆疊到第三層時它仍 `isTopmost=true`：不套 `pointer-events:none`、照常接拖曳，可在日期 sheet 未覆蓋區域被拖走。修法：比照清單補上兩個 prop。

**現況（2026-10-16 複核）**：仍存在。現位置：`geo-planning/PlanPhoneView.tsx:618-662`（`<PlanPhoneInfoSheet>` 沒有傳 `isTopmost`/`stackOffsetPx`）；`geo-planning/PlanPhoneInfoSheet.tsx:557-565` 使用 `StandaloneSheet`（`components/PhoneBottomSheet.tsx:1119-1123`，型別上排除 `isTopmost`/`stackOffsetPx`，恆為 topmost）；對照 `geo-planning/phone/ResultList.tsx:160, 190-194, 262-263` 已有這兩個 prop。

**FE27 🟡 補查照片回來會把資訊卡拉回中間段**
`GeoOutlinePhoneInfoSheet.tsx:161-164`。重設 effect 依賴 `content`/`attraction` 物件參照，`PATCH_INFO_CONTENT`（文字/照片補查）產生新物件 → `setActiveSnapIndex(1)` 把使用者剛拖到滿版/收合的卡片彈回中間，`dispatchAddUi({reset})` 讓「已加入」打勾提早消失。修法：依賴改 `content?.placeId`/`name` 等穩定鍵。

**現況（2026-10-16 複核）**：仍存在，機制改了但問題相同。現位置：`geo-planning/PlanPhoneInfoSheet.tsx:298-302`（render 期間比對 `prevSelection.content !== content` 物件參照，不同就 `setActiveSnapIndex(attraction ? 0 : 1)`）與 `:306-308`（`dispatchAddUi({type:'reset'})` 依賴 `[content, attraction]`）；`geo-planning/geoSelection.ts:60-62` 的 `PATCH_INFO_CONTENT` 回傳 `{...state, content: patch(...)}` 新物件，`useGeoPlanningState.ts:336-357` 補查照片即走此路徑。

**FE28 ⚪ 低嚴重度彙整**
- `PhoneBottomSheet.tsx:507` 註解宣稱 touch handler 有 `isTopmost` 短路，實際 `:375-453` 沒有——目前只靠 CSS `pointer-events:none`，呼叫端覆寫就破功。
- `GeoOutlinePhoneInfoSheet.tsx:210` 的 `if (!open) return null` 讓 `exitDurationMs`/`lastContentRef` 整套退場動畫失效——關資訊卡是瞬間消失。
- `useGeoPlanningState.ts:134-145` 切旅程只清 `inTrip` entry 候選，hotel/place 候選跨旅程殘留；`fetchedPlaceIdsRef`（:323）永不清空，照片查失敗後同一地點永不重試。
- `useGoogleSignIn.ts:60` 的 `gsiLoadPromise` 一旦 reject 永久快取失敗；`initialize` 全域單例，同時掛兩個 LoginForm 時後者 callback 蓋掉前者。
- `PaceRouteMap.tsx:241` 建圖沒帶 `colorScheme`（已併入 FE16 視覺項）。

**現況（2026-10-16 複核）**：五條皆仍存在。位置更新：（1）註解現位於 `components/PhoneBottomSheet.tsx:925`（`onTouchStart` `:834-847`、`onTouchMove` `:848-860` 仍無 `isTopmost` 判斷，只靠 `PhoneBottomSheet.module.css:66-69` 的 `.panelStacked { pointer-events: none }`）；（2）`geo-planning/PlanPhoneInfoSheet.tsx:502` 仍是 `if (!open) return null`；（3）`geo-planning/useGeoPlanningState.ts:137-148`（只濾掉 `inTrip` entry）、`:334`（`fetchedPlaceIdsRef` 永不清空）；（4）`hooks/useGoogleSignIn.ts:60` 的 `gsiLoadPromise` 仍永久快取；（5）`pace/PaceRouteMap.tsx:241-252` 仍無 `colorScheme`。

檢查後無其他問題的領域：GSI token 存取與 email 登入 state 互動、`useSheetStack` push/pop/replace 語意、三段式吸附容忍帶計算與 body 捲動交接。

### （2）邏輯與設計模式優化

依性價比排序（改動小、效益大者在前）。

**FE9 🟡 「`activeSnapIndex` state + open 時重設」逐字重複 4 處**
`phone/Content.tsx:105-108`、`GeoOutlinePhoneListDrawer.tsx:205-208`、`timeline/PhoneTimelineDrawer.tsx:63-66`、`GeoOutlinePhoneInfoSheet.tsx:160-164`——四處相同的 `useState(1)` + `useEffect(open 時重設)`，註解互相引用「理由同 XX」。修法：`PhoneBottomSheet` 新增非受控模式（`defaultSnapIndex` 由容器內部持有、open 轉 true 自動重設），受控 props 保留給真正需要外部觀察的呼叫端（目前只有資訊卡，見 FE12）。範圍：小。

**現況（2026-10-16 複核）**：仍存在，位置與數量更新：`geo-planning/PhoneResultList.tsx:219-222`、`geo-planning/PhoneCandidateList.tsx:157-160`（新增的第二處同樣寫法，另有 `restoreTrigger` effect `:161-165`）、`timeline/PhoneTimelineDrawer.tsx:77-80`（變數名 `snapIndex`）、`phone/Content.tsx:208`（`chatSnapIndex` 初值 2）；`PlanPhoneInfoSheet.tsx:298-302` 已改為 render 期間比對的變體（見 FE27）。`PhoneBottomSheet` 仍沒有 `defaultSnapIndex` 非受控模式。

**現況（2026-10-23 複核）**：仍存在，位置因檔案搬移與改名重新定位：`geo-planning/phone/ResultList.tsx:213-216`（原 `PhoneResultList.tsx`）、`geo-planning/phone/CandidateList.tsx:155-158`（原 `PhoneCandidateList.tsx`；`restoreTrigger` effect 在 `:162-165`）、`timeline/PhoneTimelineDrawer.tsx:77-80`（變數名 `snapIndex`）；`phone/Content.tsx` 的 `chatSnapIndex` 已不存在，現在同樣寫法的是 `settingsSnapIndex`（`:194-197`）與 `paceSnapIndex`（`:198-201`），各自搭配 `useEffect` 在 `inSettings`／`paceSheetOpen` 轉 true 時重設為 1。`PhoneBottomSheet` 仍沒有 `defaultSnapIndex` 非受控模式。

**FE10 🟡 z-index 階梯與 `panelStyle` 樣板散落 9 檔**
`{ position:'absolute', left:0, right:0, bottom:0, zIndex:X }` 幾乎逐字重複 6 次（z 值 13/33/35/36/37/38/39 分散在 `PhoneContent`/`GeoOutlinePhoneListDrawer`/`GeoOutlinePhoneCandidateDrawer`/`GeoOutlinePhoneInfoSheet`/`GeoOutlinePhoneDatePickerSheet`/`GeoOutlinePhoneDateCalendarSheet`/`PhoneTripList`/`PhoneTimelineDrawer`/`PhoneNav`），「誰疊誰上面」這個全域不變量要翻 9 個檔案的註解才拼得出來。修法：`components/sheetLayers.ts` 常數表 + `sheetPanelStyle(layer)` helper，註解從 9 份縮成 1 份。範圍：小。與 FE5（z-index 脫隊）同根因，一併處理。

**現況（2026-10-16 複核）**：部分修復（PARTIAL）。z-index 常數表那一半已落地：`components/zLayers.ts` 的 `Z_LAYERS`（`BELOW_TAB_BAR_1/2`、`TAB_BAR`、`ABOVE_TAB_BAR`）與 `PLAN_SHEET_STACK`/`PLAN_SHEET_BACKDROP`，`components/zLayers.css` 的 `--z-tab-bar` 供 `phone/Nav.module.css:28` 使用，各 sheet 已改引用具名常數。仍在的是 `panelStyle` 樣板：沒有 `sheetPanelStyle(layer)` helper，`{ position, left:0, right:0, bottom:0, zIndex }` 仍逐字散落於 `phone/Content.tsx:500,552,632`、`geo-planning/PhoneResultList.tsx:260`、`geo-planning/phone/CandidateList.tsx:220`、`PlanPhoneInfoSheet.tsx:562`、`PlanPhoneDatePickerSheet.tsx:95`、`PlanPhoneDateCalendarSheet.tsx:81`、`trip/PhoneTripList.tsx:125`、`timeline/PhoneTimelineDrawer.tsx:101`，且 `backdropStyle` 的 `position: fixed; inset: 0; background: rgba(0,0,0,0.32)` 也重複於三個 sheet。

**FE11 ⚪ 死參數與過期註解（本次盤點）**
- `GeoOutlinePhoneInfoSheet.tsx:260-261` 同時傳 `backdropStyle` 與 `showBackdrop={false}`——backdropStyle 是死參數。
- 引用已刪除元件的註解：`PhoneNavDrawer` **41 處 / 17 檔**（含 `App.tsx:71`、`phone/Content.tsx` 多處、`DesktopShared.tsx`、`ChatScreen.tsx`、多份 CSS）；`RecommendedPlacesMap.tsx`（`pace/PaceRouteMap.module.css:2,20` 等 4 處）；`TripsScreen`、`TimelineMainView`、不存在的 `PhoneFloatCard`（`phone/Content.tsx:150,156` 還寫著「下一步接回」）；已移除的 prop/識別字 `maxHeightVh`、`mainChatSlotNode`/`chatParkingNode`、`useDragToClose`、`useKeyboardInsetDebug`。
- 未使用 export：`DesktopShared.tsx` 的 `PanelSlot`/`PanelSpec`、`ChatScreen.tsx:54` 的 `DesktopChatOptions` 可降為非 export。
- 命名不符：`components/useKeyboardInset.ts` 檔內唯一 export 是 `useKeyboardShrink`。
- ✅ debug 殘留已清乾淨：`console.log('[listDrawer] dispatch')` 確認不存在。

**現況（2026-10-16 複核）**：除 debug 殘留外仍存在，數字與位置更新：（1）`geo-planning/PlanPhoneInfoSheet.tsx:563-564` 仍同時傳 `backdropStyle` 與 `showBackdrop={false}`；（2）`PhoneNavDrawer` 註解現為 38 處 / 21 檔；`RecommendedPlacesMap` 殘留於 `DesktopShared.tsx:12`、`pace/PaceRouteMap.module.css:2,20`、`recommended-places/RecommendedPlaces.module.css:6`（`pace/PaceMap.css` 已清掉，見 FE7）；`phone/Content.tsx:92`（`TripsScreen`）、`:281,287`（`PhoneFloatCard`「下一步接回」）、`timeline/PhoneTimelineDrawer.tsx:10`（`TimelineMainView`）；`maxHeightVh`/`mainChatSlotNode`/`chatParkingNode`/`useDragToClose`/`useKeyboardInsetDebug` 仍有 6 處註解提及；（3）`DesktopShared.tsx:153,155` 的 `PanelSlot`/`PanelSpec` 與 `chat/ChatScreen.tsx:54` 的 `DesktopChatOptions` 仍 export 但無外部引用；（4）`components/useKeyboardInset.ts:71` 唯一 export 仍是 `useKeyboardShrink`。

**FE12 🟡 資訊卡 snap 狀態「半受控」，同一個值鏡像 3 層**
`GeoOutlinePhoneInfoSheet.tsx:160-176` 自己持有 `activeSnapIndex` → useEffect 回報 → `GeoOutlinePhoneView` 存 `infoSheetSnapIndex`/`infoSheetDraggingDown` → 推導 `forceCollapsed` → 清單再用 `preForceSnapIndexRef`/`wasForcedRef` 翻譯回自己的 snapIndex——一個「第幾段」跨 3 元件、4 份 state、2 個 ref，實測 bug 註解（「鬆手就恢復大小」）正是這條鏈的產物。修法：兩層 snapIndex 都提升到 `GeoOutlinePhoneView`（堆疊擁有者），連動規則寫成純函式 `deriveStackSnapIndexes(...)` 並補測試。與 FE9 高度相關，連著改。範圍：中。

**現況（2026-10-16 複核）**：仍存在。現位置：`geo-planning/PlanPhoneInfoSheet.tsx:298`（自持 `activeSnapIndex`）、`:329-331`（useEffect 回報 `onSnapIndexChange`）→ `geo-planning/PlanPhoneView.tsx:378-379`（`infoSheetDraggingDown`/`infoSheetSnapIndex`）、`:662`、`:802-` 推導 `forceCollapsed` → `geo-planning/PhoneResultList.tsx:224-240`（`preForceSnapIndexRef`/`wasForcedRef`）；`deriveStackSnapIndexes` 不存在。

**FE15 ⚪ 三個查詢入口的 dispatch 組合檔內重複**
`GeoOutlinePhoneView.tsx:317-346`，`onSearch` 與 `onSearchStart` 後 4 行相同。檔內抽 `beginSearch()` 即可，不要跨平台抽（共用規則已在 `geoCategoryTagsState`）。範圍：小。

**現況（2026-10-16 複核）**：仍存在。現位置：`geo-planning/PlanPhoneView.tsx:532-546`，`onSearch` 與 `onSearchStart` 後 4 行（`setListLoading(true)`、`dispatchCategoryTags({type:'search-started'})`、`sheetStack.closeAll()`、`sheetStack.push({type:'list'})`）相同；目前查詢入口剩兩個，沒有 `beginSearch()`。

**明確不建議動**（抽象剛好，硬拆反而變差）：`PhoneBottomSheet` 647 行不拆（手勢/動畫/延遲卸載共用同組 ref，拆了要跨 hook 傳參）；`useSheetStack` 保持對 sheet 種類無知，z-index 不塞進去；`theme` 4 層透傳不開 context（單一 prop、終點只讀一次）；`useAppState`/`useTripsState` 職責清楚；5 份 geo CSS 的 `.empty` 微調是刻意的；`useCandidateDatePicker` 切法正確。

**建議執行順序**：FE11 → FE10 → FE9 → FE12（與 FE9 連改）→ FE15 → FE6。

### （3）視覺設計與樣式

稽核基準：`.claude/skills/frontend-design-guidelines`。theme 機制本身正確（`theme.ts` 三態 + `base-ui.css:8-98` 四段式覆寫），問題全出在「元件沒吃 token」。

**FE16 🟠 夜間模式覆蓋嚴重不足：App scope 共 378 行硬編碼顏色，66 個 CSS Module 只有 1 個寫了 dark 覆寫**
唯一有 dark 覆寫的是 `GeoOutlineMap.module.css:94-105,169-180`。破格元件清單（深色模式下實際會發生的視覺災難）：

| 檔案:行 | 症狀 |
|---|---|
| `timeline/Timeline.module.css:201,210,233,241,304,361,414,556,568` | 9 處硬編碼淺色（`#fff8f0`/`#1c1c1e`/`#3a3a3c`/`rgba(0,0,0,.06)`/`#8e8e93`/`#fff5e8`）→ 深色背景上一整塊亮白時間軸卡片，最刺眼 |
| `pace/PaceRouteMap.module.css:128-131`、`pace/PaceChart.module.css:246-247,252,311,356` | 毛玻璃白霧卡 + 淺色狀態特化色（`#fdf3e7`/`#eef2f5`/`#a5620e`）→ 配速表整頁破格 |
| `pace/PaceRouteMap.tsx:243-252` | **Google Maps 深色沒接上**：無 `colorScheme`（`GeoOutlineMap.tsx:90,554-556` 已正確做了 `themeToColorScheme` + 重建）→ 配速表地圖夜間永遠亮白 |
| `trip/TripManageModal.module.css:112` | `.toggleSlider::before` 開關鈕頭寫死白（`.qrBox` 白底有註解說明為 QR 可掃描性，合理不算） |

中等：`rgba(255,255,255,0.4)` 白色高光邊框 7 處在深色卡片上變明顯白框；所有陰影在深色背景幾乎不可見，缺層次分離。
修法：抽 `--glass-bg`/`--glass-border`/`--shadow-float` token 進 `base-ui.css` 主題區塊（`GeoOutlineMap.module.css:97` 已有現成深色值 `rgba(38,33,29,0.88)` 可複用）；Timeline/PaceChart 硬編碼灰階全部 token 化；`PaceRouteMap.tsx` 比照 `GeoOutlineMap` 補 `colorScheme` 與重建邏輯。

**現況（2026-10-16 複核）**：部分修復（PARTIAL）。已修：毛玻璃浮動鈕——`base-ui.css:39,82,116` 已新增 `--ios-glass-bg`（淺色 `rgba(245,242,237,0.92)`／深色 `rgba(38,33,29,0.88)`），`PhoneSideTools.module.css` 的 `.toolBtn` 與 `geo-planning/PlanPhoneView.module.css` 的 `.candidateBtn`/`.listBtn` 皆改用 `var(--ios-glass-bg)`，上方表格已移除這兩列。仍在：`timeline/Timeline.module.css` 仍有 `#fff8f0`(`:201`)、`#1c1c1e`(`:210,414`)、`#3a3a3c`(`:233,241`)、`#fff5e8`(`:304,361`)、`#333`/`#8e8e93`(`:556,568`) 且無任何 dark 覆寫；`pace/PaceRouteMap.module.css:128-131` 的 `rgba(253,252,250,0.78)`、`pace/PaceChart.module.css:246,252,311,356` 的 `#fdf3e7`/`#eef2f5`/`#a5620e` 仍在、PaceChart 無 dark 覆寫；`pace/PaceRouteMap.tsx:241-252` 建圖仍只帶 `styles: MINIMAL_MAP_STYLE`、無 `colorScheme`/重建；`--glass-border`/`--shadow-float` 尚未新增，`rgba(255,255,255,0.4)` 高光邊框仍有 7 處。另：標題的「66 個 Module 只有 1 個」已過時——目前除 `geo-planning/ExploreMap.module.css`（原 `GeoOutlineMap.module.css`）外，`plan-core/PlanTimelineView.module.css`、`home/plan-ai-sim/*`、`blog/BlogArticle.css`、各 `home/*Page.css` 等也有 dark 覆寫，但 App 主要手機/桌面 UI 仍以 Timeline、Pace 兩處最缺。

**FE17 🟡 色彩系統缺口與野生值**
色板僅 14 個 token，缺 hover 底色/玻璃色/陰影/on-accent。同語意不同值：灰文字 5 種（`--ios-gray`/`#8e8e93`/`#3a3a3c`/`#333`/`#8a8a93`）；佔位漸層兩套色各出現 4 次與 2 次；**box-shadow 24 種寫法無 token**（`--shadow-*` 只存在於 `demo/RouteEditor.module.css` 沒推全站），同一「浮動面板」語意有 4 版陰影。

**現況（2026-10-16 複核）**：仍存在（僅 `--ios-glass-bg` 一個玻璃 token 補上，見 FE16）。`base-ui.css` 色彩 token 目前約 18 個，仍無 hover 底色/陰影/on-accent token；全站（排除 `home/`、`blog/`、`demo/`）仍有約 66 種不同的 `box-shadow` 寫法，`--shadow-*` 仍只在 `demo/` 出現。

**FE18 🟡 狀態回饋缺口（對照 skill 清單）**
- **沒有 toast/snackbar**：「加入候選成功」「儲存座標成功」各處自己發明臨時 highlight 手法——skill「狀態要看得見」最大缺口。
- **載入中不統一**：`PhoneBottomSheet` spinner、`GeoOutlineMap` Loader2、`TripManageModal`/`PublicViewScreen` 純文字「載入中…」三種呈現。
- **hover 缺失**：19 檔有 `cursor: pointer` 卻無任何 `:hover`，含共用基礎元件 `components/Button`/`IconButton`/`ListRow`/`PhoneBottomSheet` 與 `PhoneNav`/`TripManageModal`/`SettingsDialog`/`ThemeToggle`——桌面版滑過毫無回饋。
- **disabled 不一致**：`Button`/`IconButton` 用 `cursor: default` 而非 skill 明列的 `not-allowed`（全專案 `not-allowed` 只在 demo 出現過一次）。
- `prefers-reduced-motion` 8 個有動畫的檔案只覆蓋 6 個；`focus-visible` 僅 11/66 檔。

**現況（2026-10-16 複核）**：大致仍存在，細節更新：（1）全專案沒有 toast/snackbar 共用元件（`components/` 下無此類檔案）；（2）hover：`components/Button.module.css`、`IconButton.module.css`、`ListRow.module.css`、`PhoneBottomSheet.module.css`、`phone/Nav.module.css`、`trip/TripManageModal.module.css`、`user/SettingsDialog.module.css` 皆有 `cursor: pointer` 而 `:hover` 數為 0（`components/PanelHead.module.css:32` 已有 `.closeBtn:hover`，屬個案）；（3）`Button.module.css`/`IconButton.module.css`/`TripManageModal.module.css` 仍有 `cursor: default`，`not-allowed` 已在 `DesktopNav`/`DesktopResultList`/`DesktopCandidateList`/`HorizontalPlanTimeline` 各出現一次，但基礎元件仍未採用；（4）`focus-visible` 目前 19 個 CSS 檔、`prefers-reduced-motion` 16 個 CSS 檔有寫（分母檔案數已與原統計不同，覆蓋率落差是否仍在未逐檔重算）。

**FE19 🟡 尺寸/層級魔數**
- 圓角 10 種無規律（卡片同時存在 10/12/18/20px，另有 31px/28px 一次性魔數）——建議收斂 `--r-sm/md/lg/pill` 4 階。
- 字級 37 種、含 `9px`/`9.5px`/`12.5px` 等半像素魔數 24 處（9px 級在手機已低於可讀下限）。
- z-index 18 個層級無常數表（與 FE10 同修）。
- **過小點擊目標**：`PanelHead .closeBtn` 26×26、`PhoneBottomSheet .closeBtn` 28×28、`GeoOutlinePhoneInfoSheet` 28×28——都是 bottom sheet 關閉鈕，遠低於 44×44 且位於手機拇指區。
- ✅ 44px 圓鈕已統一（有註解記載修正過程），這項做得好。

**現況（2026-10-16 複核）**：仍存在。`components/PanelHead.module.css:20-21` 26×26、`components/PhoneBottomSheet.module.css:235-236` 28×28、`geo-planning/PlanPhoneInfoSheet.module.css:53-54` `.closeBtn` 28×28（`:70-71` `.addCandidateIconBtn` 亦 28×28）；`font-size` 的 `9px`/`9.5px`/`12.5px` 目前約 18 處；z-index 已有 `components/zLayers.ts` 常數表涵蓋 bottom sheet 體系（見 FE10），但 CSS 內仍有約 29 種不同的 `z-index` 數值。

**視覺類優先處理前 5**：①毛玻璃三處失明（抽 glass token 一次解決）→ ②Timeline 9 處硬編碼淺色 → ③PaceRouteMap 補 `colorScheme` + PaceChart 狀態色 token 化 → ④新增 Toast 共用元件 → ⑤基礎元件層補 `:hover` 與 `cursor: not-allowed`（一改惠及全站）。

### 本次掃描跨三路整合優先清單

1. **FE20 夜間模式切換地圖無效**（🟠 使用者立刻遇到：切主題地圖不變色）
2. **FE16 夜間模式毛玻璃/Timeline/配速表破格**（🟠 深色下按鈕圖示消失、整塊亮白卡）
3. **FE22 sheet 互動 bug**（🟠 搜尋中關清單彈資訊卡）
4. **FE11 死碼清理**（⚪ 改動小、立即降低維護噪音：清 41 處 PhoneNavDrawer 過期註解）

---

## 進行中的發現（依嚴重度排序）

### FE1 🟠 `PaceRouteMap` 建圖缺 `gestureHandling`，容器缺 `touch-action`

`web/src/pace/PaceRouteMap.tsx:241-252` 的建圖 options 只有 `disableDefaultUI`/`zoomControl`/`styles`/`renderingType`，沒有 `gestureHandling: 'greedy'`；容器 `.rp-map`（`web/src/pace/PaceMap.css`）沒有自己的 `touch-action` 宣告，目前靠繼承父層 `.webApp` 的 `touch-action: none`——專案自己的註解（`App.module.css`、`ScrollArea.module.css`）已記載「touch-action 靠繼承不可靠、必須在子層明確宣告」的實測結論。姊妹元件 `GeoOutlineMap.tsx` 先前已因「單指拖曳被誤判成頁面捲動、變成要雙指才能動」的實際 bug 補上這兩項（`gestureHandling: 'greedy'` + `touch-action: none`），本元件是同一次修復的遺漏。

使用者情境：手機版開「路徑」畫面 → 路線地圖單指拖不動、或拖到一半被 sheet 拖曳手勢接管。

修法：建圖 options 補 `gestureHandling: 'greedy'`；給 `.rp-map` 補明確的 `touch-action: none`（不直接改共用的 `PaceMap.css` 的話，可在 `PaceRouteMap.module.css` 加 module class）。

**現況（2026-08-30 複核）**：仍未修復，兩處皆確認存在。

**現況（2026-10-16 複核）**：仍未修復。`pace/PaceRouteMap.tsx:241-252` options 仍只有 `styles`/`renderingType` 等、無 `gestureHandling`；`pace/PaceMap.css` 的 `.rp-map` 仍無 `touch-action`（`pace/` 下唯一的 `touch-action` 是 `PacePhoneSwipe.module.css:45`）。姊妹元件現為 `geo-planning/ExploreMap.tsx`。

### FE2 🟠 `ChatScreen` 時間軸鏡像 effect 依賴不穩定物件（`desktopChat`/`onTimelineData` 雙通道）

`web/src/chat/ChatScreen.tsx:293-303` 的時間軸鏡像 effect 依賴陣列直接放 `desktopChat`（物件）與 `onTimelineData`（函式）。`desktopChat` 是呼叫端以內聯物件字面量建立的 prop，父層重渲染即產生新參照。同檔案 `:275-282` 的「捲到底部」effect 已經因為完全相同的問題改用 `!!desktopChat`（布林值）當依賴，註解詳述了「訊息沒辦法往上拉、會抖動」的實際 bug 成因——但鏡像 effect 沒有跟進同一個修法。同一支檔案內兩個相似 effect 一個修過、一個沒修。

目前鏡像 effect 重跑僅造成多餘的 `setState`（冪等，無可見 bug），屬效能與脆弱性問題；更深層的成因是 `desktopChat.onTimelineData` 與頂層 `onTimelineData` 兩條 prop 通道表達同一個概念，`ChatScreen` 內部要用 `??` 判斷走哪條。

修法：短期——鏡像 effect 依賴改用穩定值（注意這裡需要實際呼叫 `desktopChat.onTimelineData`，不能單純布林化，可配合 `useStableCallback` 或 ref 模式）。長期——統一成單一 `onTimelineData` prop，桌面/手機差異改用獨立的 variant prop 表達。

**現況（2026-08-30 複核）**：仍未修復，依賴陣列維持原狀。

**現況（2026-10-16 複核）**：仍未修復，行號位移：鏡像 effect 現為 `chat/ChatScreen.tsx:321-331`（依賴 `[desktopChat, onTimelineData, entries, ...]`，`:322` 仍以 `??` 選通道），「捲到底部」effect 的 `!!desktopChat` 依賴在 `:296-310`。

### FE5 🟡 `PhoneTimelineDrawer` z-index 脫隊、sheet 定位錨點三分

先前發現：`PhoneTimelineDrawer` 用 z-index 13（其他 sheet 為 33/36，低於底部導覽列的 35），靠 bottom 數值巧合避開重疊；各 sheet 的定位錨點分散在 `.wrap`/`.mainArea`/`.webApp` 三處，z-index 數值相近但跨 stacking context 不可比較。

**現況（2026-08-30 複核）**：`GeoOutlinePhoneListDrawer` 已改 `bottom: 0; zIndex: 36`；`PhoneTimelineDrawer` **仍是 z-index 13**（本次掃描 FE10 的 9 檔盤點確認）。定位錨點三分問題在多層 sheet 堆疊框架落地後仍存在，修法併入 FE10 的 `sheetLayers.ts` 常數表方案一起處理。

**現況（2026-10-16 複核）**：部分修復（PARTIAL）。`timeline/PhoneTimelineDrawer.tsx:101` 現引用 `Z_LAYERS.BELOW_TAB_BAR_2`（`components/zLayers.ts`，值仍是 13，註解刻意保留「旅程清單 33 疊在時間軸 13 之上」的相對順序）；常數表已存在（見 FE10），故「裸數字」已解決，但 13 與其他 sheet 的落差（13/33 < 35 TAB_BAR < 36 ABOVE_TAB_BAR）依然存在，定位錨點也仍混用 `position: absolute`（`PhoneContent`/`PhoneTimelineDrawer`/`PhoneTripList`/`PhoneResultList`）與 `position: fixed`（`PlanPhoneInfoSheet`/`PlanPhoneDatePickerSheet`/`PlanPhoneDateCalendarSheet`）兩種。

### FE6 🟡 `useGeoPlanningState` 回傳大聯集物件，平台專屬欄位無型別區分

桌面專屬（`pickingDayKey`/`draggingCandidate`/`hoverKey`）與雙平台共用欄位混在同一扁平回傳物件，呼叫端靠註解判斷哪些欄位「手機版不解構就好」；`desktop/Content.tsx` 對葉元件的逐一透傳達 12 個 prop 且中間層不消費。另有 `pickingDayKey` 被 `desktop/Content.tsx` 的 useEffect 越權直接清空（違反 hook 自我管理 state 的封裝原則）。

修法：依用途拆命名空間（`geo.selection`/`geo.basket`/`geo.desktopOnly`）或葉元件直接收整個 geo 物件；`pickingDayKey` 清空邏輯下放回 hook 內部。

**現況（2026-08-30 複核）**：仍存在（回傳已達 40 欄位、橫跨四個子域）。本次掃描給出更精準的修法：整體聯集設計有充分理由**不硬拆成 4 個 hook**，只把註解已標記「僅桌面版使用」的 `pickingDayKey`/`onlyCandidates`/`draggingCandidate`/`handlePickFromCandidate`/`hoverKey` 抽成 `useGeoDesktopExtras(base)` 由 `DesktopContent` 單獨呼叫（`useGeoPlanningState.ts:367-389, 438-444`）。

**現況（2026-10-16 複核）**：部分修復（PARTIAL），範圍縮小。已修：`pickingDayKey`/`onlyCandidates`/`handlePickFromCandidate` 隨「從候選加入」整套移除（`geo-planning/useGeoPlanningState.ts:386-391` 有說明），`desktop/Content.tsx` 對 `pickingDayKey` 的越權清空 useEffect 也已不存在（`desktop/Content.tsx:564` 註解）。仍在：回傳仍是單一扁平聯集物件（`useGeoPlanningState.ts:395-450` 約 36 個欄位），桌面專屬的 `draggingCandidate`（`:392, 441`）與 `hoverKey`（`:72, 411`）仍混在其中，無 `useGeoDesktopExtras`，也無型別區分；嚴重度可視為 🟡 偏低。

### FE7 ⚪ 低優先項目彙整

- **`manageTrip` state 與 modal 渲染區塊**在 `phone/Content.tsx`/`desktop/Content.tsx` 逐字重複——可抽共用元件。
- **`DrawerMode`/`PanelMode`** 型別衍生（`Exclude`）與執行期 if 各自表達同一條排除規則——可收斂進 `PANEL_REGISTRY` 加欄位。
- **`phone/Content.tsx`/`desktop/Content.tsx` 巨大三元運算式鏈**可拆成 render 函式（純可讀性，不建議上 state machine——路由已是單一事實來源）。
- **地圖容器尺寸撐開時機**：依賴父層 flex 層層撐開，首繪 reflow 期間建圖可能讀到非最終尺寸，SDK 事後 resize 校正產生一次可感知跳動——可用 ResizeObserver 或固定高度佔位改善。
- **`.rp-modal-body` 缺 `touch-action`**：繼承到 `none` 時手機上長清單可能捲不動；且繞過了 `ScrollArea.tsx` 訂下的「捲動容器收斂單一元件」慣例。

**現況（2026-10-16 複核）**：逐項複核結果——（1）`manageTrip` 重複：仍存在，`phone/Content.tsx:125, 647-665` 與 `desktop/Content.tsx:105, 1053-1070` 的 modal 渲染區塊仍逐字重複；（2）`DrawerMode`/`PanelMode`：仍存在，`DesktopShared.tsx:192` 的 `Exclude<PanelMode, 'demo-route-editor' | 'demo-chat' | null>` 與 `PANEL_REGISTRY`（`:162`）仍各自表達；（3）三元運算式鏈：仍存在，`desktop/Content.tsx:795-841` 的 `panelMode === 'trips' ? … : 'timeline' ? … : 'pace' ? … : 'geo-outline' ?` 仍是長鏈；（4）地圖容器尺寸：部分修復，`geo-planning/ExploreMap.tsx:834-850` 已加 ResizeObserver 觸發 resize，但 `pace/PaceRouteMap.tsx` 仍無（未再發現實際跳動回報，保留為低優先）；（5）`.rp-modal-body`（`base-ui.css:268-272`）仍無 `touch-action`。其餘條目（`onOpenTimeline` 三處透傳、`pace/PaceMap.css:2` 過期註解、`useGeoPlanningState.ts` 檔頭註解）已不再適用，已移除。

**現況（2026-10-23 複核）**：行號重新定位，結論不變——（1）`manageTrip` 重複：仍存在，state 在 `phone/Content.tsx:103`／`desktop/Content.tsx:79`，modal 渲染區塊在 `phone/Content.tsx:573-581`／`desktop/Content.tsx:989-998`，仍逐字重複；（2）`DrawerMode`／`PanelMode`：仍存在，`DesktopShared.tsx:183` 的 `Exclude<PanelMode, 'demo-route-editor' | 'demo-chat' | null>` 與 `PANEL_REGISTRY`（`:153`）仍各自表達；（3）三元運算式鏈：仍存在，`desktop/Content.tsx:635-694` 的 `panelMode === 'trips' ? … : 'timeline' ? … : 'pace' ? … : 'geo-outline' ? … : null` 仍是長鏈；（4）地圖容器尺寸：部分修復，`ExploreMap.tsx` 已刪除，現由 `geo-planning/NativeMapBase.tsx:300-317` 的 ResizeObserver 追蹤容器尺寸，`pace/PaceRouteMap.tsx` 仍無；（5）`.rp-modal-body`（`base-ui.css:268-272`）仍無 `touch-action`。

---

## 已複核為安全/已解決的項目

- ✅ **FE21 登出沒有清 `activeTrip`**——`onLogout` 已補 `setActiveTrip(null)` 並清除 `LS_DEFAULT_TRIP`，新增 `useAppState.test.ts` 覆蓋。
- ✅ **FE23 切旅程會彈出鍵盤**——`ChatScreen` 輸入框移除 `autoFocus`，改由 `open` prop 轉為 true 時的 effect 手動聚焦，`phone/Content.tsx` 已傳入 `open={chatSheetOpen}`。
- ✅ **FE24 類別標籤連點的結果亂序覆蓋**——`runPlacesQuery` 已加入 `placesQueryRequestIdRef`，`.then`/`.catch` 回來時比對 requestId 只採最新一筆。
- ✅ **FE8 `geoListDrawerState` reducer 已退化成死碼**——`geoListDrawerState.ts`/`geoListDrawerState.test.ts` 已刪除，`GeoOutlinePhoneView.tsx`（現為 `geo-planning/PlanPhoneView.tsx`）改用單純的 `listLoading` useState。
- ✅ **FE16（局部）夜間模式 attraction 地圖標籤淺底看不見**——`GeoOutlineMap.module.css` 的 `.geo-attraction-label`/`.geo-attraction-landmark-placeholder`/光暈已改用 `--ios-sand`/`--ios-card` token（含 `color-mix()`），`useAttractionOverlays.ts`（範圍圓圈）、`mapMarkers.ts`/`useTripEntryMarkers.ts`（trip entry marker 改讀 `--color-accent`）同步修正；`PhoneSideTools.module.css`/`PlanPhoneView.module.css` 的毛玻璃浮動鈕後來已改用 `--ios-glass-bg`（見 FE16 現況），Timeline/PaceRouteMap/PaceChart 等其餘破格項目仍未處理。
- ✅ **ChatScreen 遺留除錯紅標籤（z-index 9999）**——2026-08-28 稽核發現，2026-08-30 複核確認已移除（全專案已 grep 不到 `9999`，`useKeyboardInset.ts` 僅存正式邏輯）。
- ✅ **手機版規劃地圖條件式掛載導致首開閃動**——`GeoOutlinePhoneView` 隨分頁切換整個卸載重掛、Google Maps 每次重跑建圖流程。已改為常駐主畫面（commit b9edc6e），並經 in-app 導航實測確認元件跨分頁切換不再 remount。
- ✅ **四個手機版抽屜拖曳手勢逐字重複**——已抽 `hooks/useDragToClose.ts` 收斂，後續再演進為 `components/PhoneBottomSheet.tsx` 共用容器（含三段式吸附）。
- ✅ **候選籃「返回候選」/「刪除已排入行程」錯誤處理兩檔重複**——已收斂進 `useGeoPlanningState.ts` 的 `handleReturnToCandidate`/`handleRemoveCandidate`（logTag 參數化，比照 `handleScheduleCandidate` 先例）。**（2026-10 更新：`onReturnToCandidate`/`handleReturnToCandidate` 已隨候選籃候選中清單/返回候選功能整個移除，不只是當年那次收斂重複的狀態，目前只剩 `handleRemoveCandidate`。）**
- ✅ **PhoneNav 被 bottom sheet 蓋住**——z-index 疊層順序問題，底部導覽列提升至 35 修復；後續多層 sheet 堆疊框架又將「清單/資訊卡刻意蓋過導覽列」改為新的預期行為（見各 sheet 的 panelStyle 註解）。
- ✅ **ChatScreen Portal 投影目標切換競態**——`chatParkingNode` 常駐備援容器機制驗證有效；其後架構再演進為 keepMounted children（commit f6a6f66），Portal 機制已整體移除。
- ✅ **`:global(.citySearch)` 選擇器從未生效**——Vite CSS Modules 雜湊命名使 `:global()` 完整 token 比對失敗，改用 `[class*='_citySearch_']` 屬性子字串選擇器（前後底線界定 token 邊界）修復。
