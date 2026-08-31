# 前端介面稽核（audit-frontend-ui）

> **稽核慣例**（濃縮自 `.claude/skills/doc-file-format`）：本檔為持續追蹤的稽核報告，不帶日期、不逐次疊加日期章節。結構固定三大塊：「最新掃描結果」（僅本次新發現，放最上方，每次掃描整塊替換）、「進行中的發現」（跨次追蹤，項目底下用「現況（YYYY-MM-DD 複核）」更新，不重複整段描述）、「已複核為安全/已解決」（確認修復後移入，不留在進行中清單打勾佔位）。嚴重度：🔴 critical｜🟠 high｜🟡 medium｜⚪ low。
>
> **與其他稽核檔的分工**：本檔收前端介面層發現——UI 邏輯錯誤、元件生命週期、設計模式/抽象品質、視覺設計、樣式一致性。後端/跨層架構債歸 `audit-functional.md`；有安全後果的一律歸 `audit-security.md`。

---

## 最新掃描結果（2026-08-30）

**方法**：三個背景 agent 併發掃描 `web/src`，各自負責（1）潛在邏輯錯誤——聚焦近期落地的新功能（夜間模式、GSI 登入、多層 bottom sheet 堆疊、三段式拖曳吸附、keepMounted 疊加層機制）與競態/狀態一致性；（2）邏輯與設計模式優化——新架構抽象品質（`PhoneBottomSheet`/`useSheetStack`/`geoListDrawerState`）、hook 職責邊界、死碼與過期註解；（3）視覺設計與樣式——以專案 `frontend-design-guidelines` skill 為稽核基準，最優先檢查夜間模式覆蓋完整性、色彩/間距/z-index 一致性、狀態回饋完整性。三路皆已排除先前稽核已記錄的已知項目，避免重複。

**狀態**：三路掃描已完成，結果如下。

### （1）潛在邏輯錯誤

**FE20 🟠 夜間模式切換對規劃地圖完全無效（重建邏輯是死碼）**
`geo-planning/GeoOutlineMap.tsx:490`（配合 `:525`、`:649`）。`buildingRef.current` 建圖前設 true、只有 `.catch` 會重置（成功路徑刻意不解除）。第一次建圖成功後，theme 改變讓 effect 重跑時，`:489` 的 colorScheme 比對雖放行，`:490` 的 `if (buildingRef.current) return` 立刻擋掉——`:520-570`「銷毀舊實例、用新 colorScheme 重建」整段是死碼。後果：切夜間模式後地圖永遠停在建圖當下配色，重整頁面才會變。修法：成功建圖後 `buildingRef.current = false`，或把 colorScheme 變更判斷移到 guard 之前。

**FE22 🟠 搜尋進行中關閉清單，結果回來會憑空彈出資訊卡**
`GeoOutlinePhoneView.tsx:381`、`GeoOutlinePanel.tsx:327-347`、`useSheetStack.ts:62`。清單 `onClose` 只 `closeAll()`、不取消在途查詢；唯一解回來時 `onSearchResultSelect`/`onSearchResultsChange` 都呼叫 `sheetStack.replace`，而 `replace` 在空堆疊時等同 push——資訊卡自己跳出來，`setGeocodeCandidates` 還把剛清掉的地圖 marker 補回去。修法：關閉時遞增 search epoch 丟棄舊結果，並讓 `replace` 在空堆疊時不動作。

**FE25 🟡 鍵盤彈出時吸附段落用過期容器高度**
`PhoneBottomSheet.tsx:269-271, 348-352`。`containerHeightRef` 只在 open 轉 true 時量一次、寫 ref 不觸發重繪；`useKeyboardInset.ts:85` 縮小根容器 inline height 後 `stops` 仍用舊高度換算，收合段 top 可能大於實際容器高——對話 sheet 收合後整張消失。與 FE14 同根因（量測時序隱性依賴），修法一致：ResizeObserver + state 量測，一併解決。

**FE26 🟡 資訊卡在日期 sheet 疊上來時仍是 topmost**
`GeoOutlinePhoneView.tsx:417-453`。`GeoOutlinePhoneInfoSheet` 沒有 `isTopmost`/`stackOffsetPx` prop 可轉傳（`GeoOutlinePhoneInfoSheet.tsx:252-263`），堆疊到第三層時它仍 `isTopmost=true`：不套 `pointer-events:none`、照常接拖曳，可在日期 sheet 未覆蓋區域被拖走。修法：比照清單補上兩個 prop。

**FE27 🟡 補查照片回來會把資訊卡拉回中間段**
`GeoOutlinePhoneInfoSheet.tsx:161-164`。重設 effect 依賴 `content`/`attraction` 物件參照，`PATCH_INFO_CONTENT`（文字/照片補查）產生新物件 → `setActiveSnapIndex(1)` 把使用者剛拖到滿版/收合的卡片彈回中間，`dispatchAddUi({reset})` 讓「已加入」打勾提早消失。修法：依賴改 `content?.placeId`/`name` 等穩定鍵。

**FE28 ⚪ 低嚴重度彙整**
- `PhoneBottomSheet.tsx:507` 註解宣稱 touch handler 有 `isTopmost` 短路，實際 `:375-453` 沒有——目前只靠 CSS `pointer-events:none`，呼叫端覆寫就破功。
- `GeoOutlinePhoneInfoSheet.tsx:210` 的 `if (!open) return null` 讓 `exitDurationMs`/`lastContentRef` 整套退場動畫失效——關資訊卡是瞬間消失。
- `useGeoPlanningState.ts:134-145` 切旅程只清 `inTrip` entry 候選，hotel/place 候選跨旅程殘留；`fetchedPlaceIdsRef`（:323）永不清空，照片查失敗後同一地點永不重試。
- `useGoogleSignIn.ts:60` 的 `gsiLoadPromise` 一旦 reject 永久快取失敗；`initialize` 全域單例，同時掛兩個 LoginForm 時後者 callback 蓋掉前者。
- `PaceRouteMap.tsx:241` 建圖沒帶 `colorScheme`（已併入 FE16 視覺項）。

檢查後無其他問題的領域：GSI token 存取與 email 登入 state 互動、`useSheetStack` push/pop/replace 語意、三段式吸附容忍帶計算與 body 捲動交接。

### （2）邏輯與設計模式優化

依性價比排序（改動小、效益大者在前）。

**FE9 🟡 「`activeSnapIndex` state + open 時重設」逐字重複 4 處**
`PhoneContent.tsx:105-108`、`GeoOutlinePhoneListDrawer.tsx:205-208`、`timeline/PhoneTimelineDrawer.tsx:63-66`、`GeoOutlinePhoneInfoSheet.tsx:160-164`——四處相同的 `useState(1)` + `useEffect(open 時重設)`，註解互相引用「理由同 XX」。修法：`PhoneBottomSheet` 新增非受控模式（`defaultSnapIndex` 由容器內部持有、open 轉 true 自動重設），受控 props 保留給真正需要外部觀察的呼叫端（目前只有資訊卡，見 FE12）。範圍：小。

**FE10 🟡 z-index 階梯與 `panelStyle` 樣板散落 9 檔**
`{ position:'absolute', left:0, right:0, bottom:0, zIndex:X }` 幾乎逐字重複 6 次（z 值 13/33/35/36/37/38/39 分散在 `PhoneContent`/`GeoOutlinePhoneListDrawer`/`GeoOutlinePhoneCandidateDrawer`/`GeoOutlinePhoneInfoSheet`/`GeoOutlinePhoneDatePickerSheet`/`GeoOutlinePhoneDateCalendarSheet`/`PhoneTripsDrawer`/`PhoneTimelineDrawer`/`PhoneTabBar`），「誰疊誰上面」這個全域不變量要翻 9 個檔案的註解才拼得出來。修法：`components/sheetLayers.ts` 常數表 + `sheetPanelStyle(layer)` helper，註解從 9 份縮成 1 份。範圍：小。與 FE5（z-index 脫隊）同根因，一併處理。

**FE11 ⚪ 死參數與過期註解（本次盤點）**
- `GeoOutlinePhoneInfoSheet.tsx:260-261` 同時傳 `backdropStyle` 與 `showBackdrop={false}`——backdropStyle 是死參數。
- 引用已刪除元件的註解：`PhoneNavDrawer` **41 處 / 17 檔**（含 `App.tsx:71`、`PhoneContent.tsx` 多處、`DesktopShared.tsx`、`ChatScreen.tsx`、多份 CSS）；`RecommendedPlacesMap.tsx`（`pace/PaceRouteMap.module.css:2,20` 等 4 處）；`TripsScreen`、`TimelineMainView`、不存在的 `PhoneFloatCard`（`PhoneContent.tsx:150,156` 還寫著「下一步接回」）；已移除的 prop/識別字 `maxHeightVh`、`mainChatSlotNode`/`chatParkingNode`、`useDragToClose`、`useKeyboardInsetDebug`。
- 未使用 export：`DesktopShared.tsx` 的 `PanelSlot`/`PanelSpec`、`ChatScreen.tsx:54` 的 `DesktopChatOptions` 可降為非 export。
- 命名不符：`components/useKeyboardInset.ts` 檔內唯一 export 是 `useKeyboardShrink`。
- ✅ debug 殘留已清乾淨：`console.log('[listDrawer] dispatch')` 確認不存在。

**FE12 🟡 資訊卡 snap 狀態「半受控」，同一個值鏡像 3 層**
`GeoOutlinePhoneInfoSheet.tsx:160-176` 自己持有 `activeSnapIndex` → useEffect 回報 → `GeoOutlinePhoneView` 存 `infoSheetSnapIndex`/`infoSheetDraggingDown` → 推導 `forceCollapsed` → 清單再用 `preForceSnapIndexRef`/`wasForcedRef` 翻譯回自己的 snapIndex——一個「第幾段」跨 3 元件、4 份 state、2 個 ref，實測 bug 註解（「鬆手就恢復大小」）正是這條鏈的產物。修法：兩層 snapIndex 都提升到 `GeoOutlinePhoneView`（堆疊擁有者），連動規則寫成純函式 `deriveStackSnapIndexes(...)` 並補測試。與 FE9 高度相關，連著改。範圍：中。

**FE13 🟡 候選籃遊離在 sheetStack 之外，且自帶第二套日期選擇 UI**
`GeoOutlinePhoneView.tsx:174, 469-487`、`GeoOutlinePhoneCandidateDrawer.tsx:49-140`。(1) `candidateDrawerOpen` 是獨立 useState，破壞了 `SheetEntry` 註解宣稱的「任何時刻該顯示哪些 sheet 只需看 sheetStack」不變量；(2) 資訊卡路徑的選日期已改成 `date-picker`/`date-calendar` 兩層 sheet，候選籃的 `CandidateRow` 仍是 inline chips + `<input type="date">`——同一個 App 兩套選日期 UI。修法：候選籃納入 `SheetEntry`、「加入」改走同一組日期 sheet。範圍：中。

**FE14 🟡 `PhoneBottomSheet` 量測時序的隱性依賴（潛在 bug）**
`components/PhoneBottomSheet.tsx:269-271, 348-352, 468`。`containerHeightRef` 在 `useEffect([open])` 量測，但 `stops` 在 render 階段讀它——open 轉 true 的那次 render 算出的收合段位置是錯的（`minHeightAsTop = 0`），目前靠 `entered` 的 rAF 觸發下一輪 render 才修正、且那一幀 panel 還在畫面外所以看不出來。**這是對進場動畫實作細節的隱性依賴**，拿掉 `entered` 或改同步進場就會爆。同源：`finishDrag` 的 `stops.indexOf(startTopRef.current)` 在量測值中途改變時回傳 -1、靜默落到索引 0。修法：量測改存 state（`useLayoutEffect` + `setContainerHeight`）。範圍：小。

**FE15 ⚪ 三個查詢入口的 dispatch 組合檔內重複**
`GeoOutlinePhoneView.tsx:317-346`，`onSearch` 與 `onSearchStart` 後 4 行相同。檔內抽 `beginSearch()` 即可，不要跨平台抽（共用規則已在 `geoCategoryTagsState`）。範圍：小。

**明確不建議動**（抽象剛好，硬拆反而變差）：`PhoneBottomSheet` 647 行不拆（手勢/動畫/延遲卸載共用同組 ref，拆了要跨 hook 傳參）；`useSheetStack` 保持對 sheet 種類無知，z-index 不塞進去；`theme` 4 層透傳不開 context（單一 prop、終點只讀一次）；`useAppState`/`useTripsState` 職責清楚；5 份 geo CSS 的 `.empty` 微調是刻意的；`useCandidateDatePicker` 切法正確。

**建議執行順序**：FE11 → FE10 → FE9 → FE14 → FE12（與 FE9 連改）→ FE13 → FE15 → FE6。

### （3）視覺設計與樣式

稽核基準：`.claude/skills/frontend-design-guidelines`。theme 機制本身正確（`theme.ts` 三態 + `base-ui.css:8-98` 四段式覆寫），問題全出在「元件沒吃 token」。

**FE16 🟠 夜間模式覆蓋嚴重不足：App scope 共 378 行硬編碼顏色，66 個 CSS Module 只有 1 個寫了 dark 覆寫**
唯一有 dark 覆寫的是 `GeoOutlineMap.module.css:94-105,169-180`。破格元件清單（深色模式下實際會發生的視覺災難）：

| 檔案:行 | 症狀 |
|---|---|
| `PhoneSideTools.module.css:28-33` | `.toolBtn` 毛玻璃 `rgba(245,242,237,0.92)` 寫死淺色 + `color: var(--color-dark)`（深色下變淺米色）→ 淺米圖示配淺米玻璃，**圖示消失** |
| `GeoOutlinePhoneView.module.css:75-82, 109-116` | `.candidateBtn`/`.listBtn` 同上——手機版地圖左下主要浮動鈕全數失明 |
| `timeline/Timeline.module.css:201,210,233,241,304,361,414,556,568` | 9 處硬編碼淺色（`#fff8f0`/`#1c1c1e`/`#3a3a3c`/`rgba(0,0,0,.06)`/`#8e8e93`/`#fff5e8`）→ 深色背景上一整塊亮白時間軸卡片，最刺眼 |
| `pace/PaceRouteMap.module.css:128-131`、`pace/PaceChart.module.css:246-247,252,311,356` | 毛玻璃白霧卡 + 淺色狀態特化色（`#fdf3e7`/`#eef2f5`/`#a5620e`）→ 配速表整頁破格 |
| `pace/PaceRouteMap.tsx:243-252` | **Google Maps 深色沒接上**：無 `colorScheme`（`GeoOutlineMap.tsx:90,554-556` 已正確做了 `themeToColorScheme` + 重建）→ 配速表地圖夜間永遠亮白 |
| `trip/TripManageModal.module.css:112` | `.toggleSlider::before` 開關鈕頭寫死白（`.qrBox` 白底有註解說明為 QR 可掃描性，合理不算） |

中等：`rgba(255,255,255,0.4)` 白色高光邊框 7 處在深色卡片上變明顯白框；所有陰影在深色背景幾乎不可見，缺層次分離。
修法：抽 `--glass-bg`/`--glass-border`/`--shadow-float` token 進 `base-ui.css` 主題區塊（`GeoOutlineMap.module.css:97` 已有現成深色值 `rgba(38,33,29,0.88)` 可複用）；Timeline/PaceChart 硬編碼灰階全部 token 化；`PaceRouteMap.tsx` 比照 `GeoOutlineMap` 補 `colorScheme` 與重建邏輯。

**FE17 🟡 色彩系統缺口與野生值**
色板僅 14 個 token，缺 hover 底色/玻璃色/陰影/on-accent。同語意不同值：灰文字 5 種（`--ios-gray`/`#8e8e93`/`#3a3a3c`/`#333`/`#8a8a93`）；佔位漸層兩套色各出現 4 次與 2 次；**box-shadow 24 種寫法無 token**（`--shadow-*` 只存在於 `demo/RouteEditor.module.css` 沒推全站），同一「浮動面板」語意有 4 版陰影。

**FE18 🟡 狀態回饋缺口（對照 skill 清單）**
- **沒有 toast/snackbar**：「加入候選成功」「儲存座標成功」各處自己發明臨時 highlight 手法——skill「狀態要看得見」最大缺口。
- **載入中不統一**：`PhoneBottomSheet` spinner、`GeoOutlineMap` Loader2、`TripManageModal`/`PublicViewScreen` 純文字「載入中…」三種呈現。
- **hover 缺失**：19 檔有 `cursor: pointer` 卻無任何 `:hover`，含共用基礎元件 `components/Button`/`IconButton`/`ListRow`/`PhoneBottomSheet` 與 `PhoneTabBar`/`TripManageModal`/`SettingsDialog`/`ThemeToggle`——桌面版滑過毫無回饋。
- **disabled 不一致**：`Button`/`IconButton` 用 `cursor: default` 而非 skill 明列的 `not-allowed`（全專案 `not-allowed` 只在 demo 出現過一次）。
- `prefers-reduced-motion` 8 個有動畫的檔案只覆蓋 6 個；`focus-visible` 僅 11/66 檔。

**FE19 🟡 尺寸/層級魔數**
- 圓角 10 種無規律（卡片同時存在 10/12/18/20px，另有 31px/28px 一次性魔數）——建議收斂 `--r-sm/md/lg/pill` 4 階。
- 字級 37 種、含 `9px`/`9.5px`/`12.5px` 等半像素魔數 24 處（9px 級在手機已低於可讀下限）。
- z-index 18 個層級無常數表（與 FE10 同修）。
- **過小點擊目標**：`PanelHead .closeBtn` 26×26、`PhoneBottomSheet .closeBtn` 28×28、`GeoOutlinePhoneInfoSheet` 28×28——都是 bottom sheet 關閉鈕，遠低於 44×44 且位於手機拇指區。
- ✅ 44px 圓鈕已統一（有註解記載修正過程），這項做得好。

**視覺類優先處理前 5**：①毛玻璃三處失明（抽 glass token 一次解決）→ ②Timeline 9 處硬編碼淺色 → ③PaceRouteMap 補 `colorScheme` + PaceChart 狀態色 token 化 → ④新增 Toast 共用元件 → ⑤基礎元件層補 `:hover` 與 `cursor: not-allowed`（一改惠及全站）。

### 本次掃描跨三路整合優先清單

1. **FE20 夜間模式切換地圖無效**（🟠 使用者立刻遇到：切主題地圖不變色）
2. **FE16 夜間模式毛玻璃/Timeline/配速表破格**（🟠 深色下按鈕圖示消失、整塊亮白卡）
3. **FE22 sheet 互動 bug**（🟠 搜尋中關清單彈資訊卡）
4. **FE14+FE25 PhoneBottomSheet 量測時序**（🟡 同根因一併修，鍵盤情境已實際可觸發 sheet 消失）
5. **FE11 死碼清理**（⚪ 改動小、立即降低維護噪音：清 41 處 PhoneNavDrawer 過期註解）

---

## 進行中的發現（依嚴重度排序）

### FE1 🟠 `PaceRouteMap` 建圖缺 `gestureHandling`，容器缺 `touch-action`

`web/src/pace/PaceRouteMap.tsx:241-252` 的建圖 options 只有 `disableDefaultUI`/`zoomControl`/`styles`/`renderingType`，沒有 `gestureHandling: 'greedy'`；容器 `.rp-map`（`web/src/pace/PaceMap.css`）沒有自己的 `touch-action` 宣告，目前靠繼承父層 `.webApp` 的 `touch-action: none`——專案自己的註解（`App.module.css`、`ScrollArea.module.css`）已記載「touch-action 靠繼承不可靠、必須在子層明確宣告」的實測結論。姊妹元件 `GeoOutlineMap.tsx` 先前已因「單指拖曳被誤判成頁面捲動、變成要雙指才能動」的實際 bug 補上這兩項（`gestureHandling: 'greedy'` + `touch-action: none`），本元件是同一次修復的遺漏。

使用者情境：手機版開「路徑」畫面 → 路線地圖單指拖不動、或拖到一半被 sheet 拖曳手勢接管。

修法：建圖 options 補 `gestureHandling: 'greedy'`；給 `.rp-map` 補明確的 `touch-action: none`（不直接改共用的 `PaceMap.css` 的話，可在 `PaceRouteMap.module.css` 加 module class）。

**現況（2026-08-30 複核）**：仍未修復，兩處皆確認存在。

### FE2 🟠 `ChatScreen` 時間軸鏡像 effect 依賴不穩定物件（`desktopChat`/`onTimelineData` 雙通道）

`web/src/chat/ChatScreen.tsx:293-303` 的時間軸鏡像 effect 依賴陣列直接放 `desktopChat`（物件）與 `onTimelineData`（函式）。`desktopChat` 是呼叫端以內聯物件字面量建立的 prop，父層重渲染即產生新參照。同檔案 `:275-282` 的「捲到底部」effect 已經因為完全相同的問題改用 `!!desktopChat`（布林值）當依賴，註解詳述了「訊息沒辦法往上拉、會抖動」的實際 bug 成因——但鏡像 effect 沒有跟進同一個修法。同一支檔案內兩個相似 effect 一個修過、一個沒修。

目前鏡像 effect 重跑僅造成多餘的 `setState`（冪等，無可見 bug），屬效能與脆弱性問題；更深層的成因是 `desktopChat.onTimelineData` 與頂層 `onTimelineData` 兩條 prop 通道表達同一個概念，`ChatScreen` 內部要用 `??` 判斷走哪條。

修法：短期——鏡像 effect 依賴改用穩定值（注意這裡需要實際呼叫 `desktopChat.onTimelineData`，不能單純布林化，可配合 `useStableCallback` 或 ref 模式）。長期——統一成單一 `onTimelineData` prop，桌面/手機差異改用獨立的 variant prop 表達。

**現況（2026-08-30 複核）**：仍未修復，依賴陣列維持原狀。

### FE3 🟡 `.rp-modal-backdrop` 用 `position: absolute`，定位基準會隨鍵盤縮放

`web/src/base-ui.css:187-197`：`position: absolute; inset: 0`。手機版 `TripManageModal` 渲染處是 `.mainArea` 的兄弟節點，實際定位基準是 `.webApp`（`height: 100dvh`，且虛擬鍵盤彈出時由 `useKeyboardShrink` 直接改寫 inline height）——鍵盤一彈出，backdrop 跟著縮、`.rp-modal` 的 `max-height: 80%` 隨之變矮跳動。桌面版 Ctrl/Cmd+滾輪整頁縮放時 `dvh` 的 CSS px 值改變，彈窗尺寸非線性變化。

業界慣例是 modal 一律 `position: fixed` 相對 layout viewport。同檔案 `.settings-dialog-backdrop`（`base-ui.css` 約 :253）已用 `fixed` 覆寫並在註解寫明理由——正確做法已存在於同一支檔案，只是沒推廣到 `.rp-modal-backdrop` 本身。

修法：`.rp-modal-backdrop` 改 `position: fixed`，並移除 `.settings-dialog-backdrop` 的重複覆寫。

**現況（2026-08-30 複核）**：仍未修復，確認 `position: absolute` 原樣存在。

### FE4 🟡 `timelineMirror` 手機版缺「切換旅程時清空」邏輯

`DesktopLayout.tsx` 有「切換旅程時清空 mirror」的 useEffect，`PhoneContent.tsx` 沒有對應邏輯——桌面版已修過的「切換旅程時短暫顯示前一個旅程時間軸殘影」bug 會在手機版重現。兩邊另各自宣告一份內容相同的 `EMPTY_TIMELINE_MIRROR` 常數。

修法：`EMPTY_TIMELINE_MIRROR` 提升為共用常數（如 `DesktopShared.tsx`），「切換旅程清空」邏輯一併搬到共用層或共用 hook。

**現況（2026-08-25 發現，尚未在最新程式碼複核）**：近期對話疊加層改用 keepMounted children（commit f6a6f66）後 `PhoneContent.tsx` 結構有變，需先複核此問題是否仍存在再動手。

### FE5 🟡 `PhoneTimelineDrawer` z-index 脫隊、sheet 定位錨點三分

先前發現：`PhoneTimelineDrawer` 用 z-index 13（其他 sheet 為 33/36，低於底部導覽列的 35），靠 bottom 數值巧合避開重疊；各 sheet 的定位錨點分散在 `.wrap`/`.mainArea`/`.webApp` 三處，z-index 數值相近但跨 stacking context 不可比較。

**現況（2026-08-30 複核）**：`GeoOutlinePhoneListDrawer` 已改 `bottom: 0; zIndex: 36`；`PhoneTimelineDrawer` **仍是 z-index 13**（本次掃描 FE10 的 9 檔盤點確認）。定位錨點三分問題在多層 sheet 堆疊框架落地後仍存在，修法併入 FE10 的 `sheetLayers.ts` 常數表方案一起處理。

### FE6 🟡 `useGeoPlanningState` 回傳大聯集物件，平台專屬欄位無型別區分

桌面專屬（`pickingDayKey`/`draggingCandidate`/`hoverKey`）與雙平台共用欄位混在同一扁平回傳物件，呼叫端靠註解判斷哪些欄位「手機版不解構就好」；`DesktopLayout.tsx` 對葉元件的逐一透傳達 12 個 prop 且中間層不消費。另有 `pickingDayKey` 被 `DesktopLayout.tsx` 的 useEffect 越權直接清空（違反 hook 自我管理 state 的封裝原則）。

修法：依用途拆命名空間（`geo.selection`/`geo.basket`/`geo.desktopOnly`）或葉元件直接收整個 geo 物件；`pickingDayKey` 清空邏輯下放回 hook 內部。

**現況（2026-08-30 複核）**：仍存在（回傳已達 40 欄位、橫跨四個子域）。本次掃描給出更精準的修法：整體聯集設計有充分理由**不硬拆成 4 個 hook**，只把註解已標記「僅桌面版使用」的 `pickingDayKey`/`onlyCandidates`/`draggingCandidate`/`handlePickFromCandidate`/`hoverKey` 抽成 `useGeoDesktopExtras(base)` 由 `DesktopLayout` 單獨呼叫（`useGeoPlanningState.ts:367-389, 438-444`）。

### FE7 ⚪ 低優先項目彙整

- **`manageTrip` state 與 modal 渲染區塊**在 `PhoneContent.tsx`/`DesktopLayout.tsx` 逐字重複——可抽共用元件。
- **`DrawerMode`/`PanelMode`** 型別衍生（`Exclude`）與執行期 if 各自表達同一條排除規則——可收斂進 `PANEL_REGISTRY` 加欄位。
- **`onOpenTimeline`** callback 三處淺層透傳無加工。
- **`PhoneContent.tsx`/`DesktopLayout.tsx` 巨大三元運算式鏈**可拆成 render 函式（純可讀性，不建議上 state machine——路由已是單一事實來源）。
- **地圖容器尺寸撐開時機**：依賴父層 flex 層層撐開，首繪 reflow 期間建圖可能讀到非最終尺寸，SDK 事後 resize 校正產生一次可感知跳動——可用 ResizeObserver 或固定高度佔位改善。
- **過期註解**：`pace/PaceMap.css:2` 仍提及已移除的 `RecommendedPlacesMap.tsx`。
- **`.rp-modal-body` 缺 `touch-action`**：繼承到 `none` 時手機上長清單可能捲不動；且繞過了 `ScrollArea.tsx` 訂下的「捲動容器收斂單一元件」慣例。
- **`useGeoPlanningState.ts` 檔頭「已知歷史問題」註解**未補記候選籃刪除/返回候選重複已收斂一事（避免下次稽核重新發現）。

**現況（2026-08-25～28 發現，尚未逐項複核）**。

---

## 已複核為安全/已解決的項目

- ✅ **FE21 登出沒有清 `activeTrip`**——`onLogout` 已補 `setActiveTrip(null)` 並清除 `LS_DEFAULT_TRIP`，新增 `useAppState.test.ts` 覆蓋。
- ✅ **FE23 切旅程會彈出鍵盤**——`ChatScreen` 輸入框移除 `autoFocus`，改由 `open` prop 轉為 true 時的 effect 手動聚焦，`PhoneContent.tsx` 已傳入 `open={chatSheetOpen}`。
- ✅ **FE24 類別標籤連點的結果亂序覆蓋**——`runPlacesQuery` 已加入 `placesQueryRequestIdRef`，`.then`/`.catch` 回來時比對 requestId 只採最新一筆。
- ✅ **FE8 `geoListDrawerState` reducer 已退化成死碼**——`geoListDrawerState.ts`/`geoListDrawerState.test.ts` 已刪除，`GeoOutlinePhoneView.tsx` 改用單純的 `listLoading` useState。
- ✅ **FE16（局部）夜間模式 attraction 地圖標籤淺底看不見**——`GeoOutlineMap.module.css` 的 `.geo-attraction-label`/`.geo-attraction-landmark-placeholder`/光暈已改用 `--ios-sand`/`--ios-card` token（含 `color-mix()`），`useAttractionOverlays.ts`（範圍圓圈）、`mapMarkers.ts`/`useTripEntryMarkers.ts`（trip entry marker 改讀 `--color-accent`）同步修正；`PhoneSideTools.module.css`/`GeoOutlinePhoneView.module.css`/Timeline/PaceRouteMap 等其餘破格項目仍未處理。
- ✅ **ChatScreen 遺留除錯紅標籤（z-index 9999）**——2026-08-28 稽核發現，2026-08-30 複核確認已移除（全專案已 grep 不到 `9999`，`useKeyboardInset.ts` 僅存正式邏輯）。
- ✅ **手機版規劃地圖條件式掛載導致首開閃動**——`GeoOutlinePhoneView` 隨分頁切換整個卸載重掛、Google Maps 每次重跑建圖流程。已改為常駐主畫面（commit b9edc6e），並經 in-app 導航實測確認元件跨分頁切換不再 remount。
- ✅ **四個手機版抽屜拖曳手勢逐字重複**——已抽 `hooks/useDragToClose.ts` 收斂，後續再演進為 `components/PhoneBottomSheet.tsx` 共用容器（含三段式吸附）。
- ✅ **候選籃「返回候選」/「刪除已排入行程」錯誤處理兩檔重複**——已收斂進 `useGeoPlanningState.ts` 的 `handleReturnToCandidate`/`handleRemoveCandidate`（logTag 參數化，比照 `handleScheduleCandidate` 先例）。
- ✅ **PhoneTabBar 被 bottom sheet 蓋住**——z-index 疊層順序問題，底部導覽列提升至 35 修復；後續多層 sheet 堆疊框架又將「清單/資訊卡刻意蓋過導覽列」改為新的預期行為（見各 sheet 的 panelStyle 註解）。
- ✅ **ChatScreen Portal 投影目標切換競態**——`chatParkingNode` 常駐備援容器機制驗證有效；其後架構再演進為 keepMounted children（commit f6a6f66），Portal 機制已整體移除。
- ✅ **`:global(.citySearch)` 選擇器從未生效**——Vite CSS Modules 雜湊命名使 `:global()` 完整 token 比對失敗，改用 `[class*='_citySearch_']` 屬性子字串選擇器（前後底線界定 token 邊界）修復。
