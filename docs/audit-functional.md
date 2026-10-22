# Functional Audit — tripace

> 本檔案記錄 tripace 專案的功能/架構稽核結果（邏輯錯誤、狀態管理問題、架構債、效能、程式碼品質），由 Claude 執行多代理掃描 + 對抗式驗證產出。安全性相關發現另見 `docs/audit-security.md`。
>
> **格式慣例**（詳見 `.claude/skills/project-audit-format/SKILL.md`）：
> 1. 「最新掃描結果」永遠放最上方，只放「這次才第一次發現」的新項目；不累加歷史章節。
> 2. 舊發現複核後，在原項目段落下方加一行「**現況（YYYY-MM-DD 複核）**」更新狀態，不重複整份描述。
> 3. 已確認修復的項目，從「進行中的發現」移到「已複核為安全/已解決的項目」。
> 4. `file:line`、觸發情境、修法建議等具體內容一律保留，不因整理而濃縮。
> 5. 嚴重度：🔴 critical｜🟠 high｜🟡 medium｜⚪ low
>
> 2026-10-16 複核：對照 main @ 4f14828 逐項檢查，已移除 6 項已修復/已過時的發現。
>
> **來源合併記錄**：本檔案於 2026-08-16 建立時，已將舊有的三份混合稽核文件中的功能/架構類發現拆分併入本檔案，並移除該三份文件——`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #4/#5/#6/#8/#10，即 F7/F12/F13/F14/F15）、`docs/PROJECT_HEALTH_REVIEW.md`（2026-07-22 初版／2026-08-03 更新，測試/依賴/程式碼組織/部署維運章節，即 F16、F17、F20 與對應已解決項目）、`docs/architecture-review-2026-07.md`（2026-07-24 評估／2026-08-14 複查，二～六章，即 F21-F41）。安全類發現已同步拆分至 `docs/audit-security.md`。

---

## 最新掃描結果（2026-10-06）

**掃描方法**：對 `wip/scroll-timeline-demo` 分支（新增 ScrollTimeline compound component、InteractiveExploreMap 嵌入式小地圖整合、TainanChikanPage 套用）執行 8 個平行 finder agent（正確性逐行掃描、已移除行為稽核、重複實作、效率、簡化、抽象層級/慣例、CLAUDE.md 慣例核對、跨檔案 trace），再以獨立 verifier agent 對候選重新讀原始碼對抗式覆核。以下為本次**首次發現**且經驗證存活的功能類項目。

### F42 🟠 面板停留在 'nearby' 模式時捲動到無 theme 的錨點，舊主題卡不會收掉
- **位置**：`web/src/home/ScrollTimeline.tsx:289`（捲動同步 effect）、`web/src/home/InteractiveExploreMap.tsx:696-711`（`focusedTheme` 受控 effect 的 `if (!focusedTheme) return` 提前退出，未對稱收掉 `openThemeId`）
- **問題**：捲動同步 effect 只把 `panel.id` 換成目前錨點，`mode` 原樣保留；若面板正開在 `'nearby'` 模式、使用者捲到一個只有 `center`（沒有 `theme`）的錨點，`openCardOnFocus` 仍是 `true`，但 `focusedTheme` 變成 `undefined`，`InteractiveExploreMap` 的受控 effect 在 `focusedTheme` 為假值時直接 `return`，從未呼叫 `setOpenThemeId(null)` 收卡。
- **觸發情境**：在 `TainanChikanPage.tsx` 開啟「附近景點」面板於「赤崁樓」（有 `theme`），再捲動到「武廟愛玉」（只有 `center`）——地圖已經平移到武廟愛玉，但介紹卡仍顯示赤崁樓的附近景點清單，卡片與地圖內容不同步。目前因 `SHOW_NEARBY_LIST_BUTTON=false` 暫時沒有 UI 入口能進入 `'nearby'` 模式而處於休眠狀態，但這顆按鈕一旦重新開啟會立即重現。
- **驗證狀態**：CONFIRMED（多個獨立 verifier agent 重讀程式碼確認觸發鏈）。
- **建議修法**：捲動同步 effect 換錨點時，若新錨點沒有對應的 `theme`，連帶把 `mode` 降級為 `'map'`；或在 `InteractiveExploreMap` 的受控 effect 裡補上「`focusedTheme` 變成假值時主動收卡」的對稱邏輯。
- **現況（2026-10-16 複核）**：仍未修復。`ScrollTimeline.tsx:289-292` 的捲動同步 effect 換錨點時仍只換 `id`、`mode: prev.mode` 原樣保留；`InteractiveExploreMap.tsx:698` 仍是 `if (!focusedTheme) return`，未收 `openThemeId`。行號已更新。原敘述中的 `TainanChikanPage.tsx`「赤崁樓」例子已不成立（該頁 8 站現在全部只填 `center`、都沒填 `theme`），目前可觸發的組合是 `KyotoPage.tsx` 的「清水寺／八坂神社」（有 `theme`）捲到「產寧坂・二年坂」等只有 `center` 的站；`SHOW_NEARBY_LIST_BUTTON` 仍為 `false`（`ScrollTimeline.tsx:81`），因此仍處於休眠狀態。

### F43 🟠 套用 ScrollTimeline 後，手機版地圖從「點了才載入」退化成「進頁面就無條件載入」
- **位置**：`web/src/home/TainanChikanPage.tsx:389-415`（移除 `MobileMapReveal` 包裹，改用 `ScrollTimeline`）
- **問題**：原本 `MobileMapReveal` 讓手機版地圖（Google Maps SDK + attractions API 查詢）延遲到使用者點擊縮圖才真的掛載；`ScrollTimeline.tsx` 的 `.mapPanel`／`InteractiveExploreMap` 一開始就常駐掛載，只用 CSS `visibility:hidden` 隱藏，整個檔案沒有任何 `isDesktop`/`useIsDesktop` 判斷。
- **觸發情境**：手機（<768px）訪客開啟 `/tainan-chikan`，不管有沒有展開地圖面板，一律立即載入 Google Maps SDK、觸發一次 attractions API 查詢——重新引入 `MobileMapReveal` 當初要避免的載入成本，跟同層的 `TainanPage.tsx`/`KyotoPage.tsx`/`JiufenPage.tsx` 行為不一致。
- **驗證狀態**：CONFIRMED。
- **建議修法**：`ScrollTimeline` 補上手機版延遲掛載的等效機制（例如沿用 `useIsDesktop` 判斷，手機版先顯示靜態縮圖、使用者互動後才真正掛載 `InteractiveExploreMap`），或在 `TainanChikanPage.tsx` 層面針對手機版另外處理。
- **現況（2026-10-08 複核）**：`TainanPage.tsx`（台南安平頁）也已改套用 `ScrollTimeline`（原本的 `MobileMapReveal` 包裹連同 `useScrollProgress` 一併移除），同一個問題現在同時影響 `/tainan-chikan` 與 `/tainan-anping` 兩個路由；原敘述「跟同層的 `TainanPage.tsx` 行為不一致」已過時——`TainanPage.tsx` 現在跟 `TainanChikanPage.tsx` 行為一致（都無條件載入），不一致的對照組只剩尚未套用 `ScrollTimeline` 的 `KyotoPage.tsx`/`JiufenPage.tsx`。`ScrollTimeline` 本身仍未補上延遲掛載機制，問題尚未修復。
- **現況（2026-10-23 補註）**：`MobileMapReveal.tsx` 與其 CSS 已刪除（沒有任何頁面再 import，死碼清理）；本項描述的是「各城市頁改用 `ScrollTimeline` 後地圖常駐載入」，與該檔案是否存在無關，仍待處理。
- **現況（2026-10-16 複核）**：仍未修復，且範圍擴大：`JiufenPage.tsx:286`、`KyotoPage.tsx:297`、`TainanPage.tsx:265`、`TainanChikanPage.tsx:415` 四個城市頁現在全部套用 `ScrollTimeline`，`ScrollTimeline.tsx` 仍無任何 `useIsDesktop`／`isDesktop`／延遲掛載判斷，`InteractiveExploreMap` 於 `ScrollTimeline.tsx` 的 `.mapPanelBody` 內一律掛載。前一則複核所說「尚未套用的 `KyotoPage.tsx`/`JiufenPage.tsx`」對照組已不存在；`MobileMapReveal.tsx` 檔案仍在 `web/src/home/`，但已沒有任何頁面 import 它。

### F44 🟡 進度點導覽（跳到任一站/跳回地圖）被拿掉，沒有替代方案
- **位置**：`web/src/home/TainanChikanPage.tsx:389-415`（移除 `.tainan-chikan-progress-rail` 與 `useScrollProgress`）
- **問題**：原本的進度點 nav 可以 `scrollIntoView` 直接跳到任一站或跳回地圖區塊；`ScrollTimeline.tsx` 的時間軸縮圖/模式按鈕只會呼叫 `toggleAnchor` 開關地圖面板，整個檔案沒有任何 `scrollIntoView` 或等效跳轉機制。
- **觸發情境**：使用者原本可以點進度點直接跳到第 6 站，改版後只能手動捲動整頁才能到達。
- **驗證狀態**：CONFIRMED。
- **建議修法**：在 `ScrollTimeline`（或呼叫端）補上「點縮圖跳轉捲動位置」的功能，不只是開關地圖面板。
- **現況（2026-10-16 複核）**：仍未修復。`ScrollTimeline.tsx` 與 `TainanChikanPage.tsx` 內仍沒有任何 `scrollIntoView`／`scrollTo`，縮圖與小圓點只呼叫 `toggleAnchor`。行號已更新。

### F45 🟡 `theme` 比對失敗時不會退回 `center`，兩者混用的錨點有單點失效風險
- **位置**：`web/src/home/TainanChikanPage.tsx:405`（「赤崁樓」錨點同時填 `theme="赤崁樓"` 與 `center`）、`web/src/home/ScrollTimeline.tsx:335、342`（`focusedTheme`/`focusedCenter` 推導邏輯）
- **問題**：只要 `openMeta.theme` 非空字串，`focusedCenter` 就直接被設成 `undefined`，不管 `theme` 字串最終有沒有在 `InteractiveExploreMap` 裡比對到真正的主題點。`TainanChikanPage.tsx` 檔案開頭的註解已自承：本機資料庫目前的主題點名稱是「赤崁樓」，但正式/部署環境可能已遷移成「赤崁・府城」（赤崁樓降級為一般精選點）。
- **觸發情境**：若部署環境真的套用了那次更名遷移、此處 `theme="赤崁樓"` 忘記同步更新，`themePoints.find` 會比對失敗，但因為 `theme` 非空已經讓 `focusedCenter` 被壓成 `undefined`，地圖對這個錨點完全不會移動——即使座標其實已經寫在同一筆資料的 `center` 欄位裡、本可以直接拿來用。
- **驗證狀態**：CONFIRMED。
- **建議修法**：`focusedTheme`/`focusedCenter` 的決策改成「`theme` 有填且真的比對到主題點」才判定為 theme 模式，比對失敗時改退回使用 `center`（若有提供），而不是單純以「`theme` 欄位是否非空」決定。
- **現況（2026-10-16 複核）**：部分已變：`TainanChikanPage.tsx` 現在 8 站全部只填 `center`、已沒有任何一站填 `theme`（見該檔 `<ScrollTimeline.Anchor … center={stop.center}>`，約 :432-438），因此原本「赤崁樓」`theme`／`center` 混用而失效的具體情境已不存在；`KyotoPage.tsx` 的 theme 站（清水寺、八坂神社）只填 `theme`、不填 `center`，也沒有混用。但機制本身未改：`ScrollTimeline.tsx:335`（`openMeta?.theme ?? …`）與 `:342`（`openMeta && !openMeta.theme ? openMeta.center : undefined`）仍以「`theme` 是否非空」而非「是否比對到主題點」決定，日後只要有錨點同時填兩者就會重現。降為潛在風險。

### F46 🟡 `ScrollTimeline.tsx` 重造一份 IntersectionObserver 版「目前捲動區段」邏輯，未重用既有的 `useScrollProgress`
- **位置**：`web/src/home/ScrollTimeline.tsx:182`、對照 `web/src/hooks/useScrollProgress.ts`
- **問題**：`useScrollProgress` 當初就是為了讓 JiufenPage/KyotoPage/TainanPage 不用各自重寫一份幾乎相同的 IntersectionObserver「找出目前捲動到哪個區段」邏輯而抽出來的共用 hook；`ScrollTimeline.tsx` 改用自己手刻的 rootMargin 窄帶版本（`TainanChikanPage.tsx` 的 diff 也因此拿掉了原本的 `useScrollProgress` 呼叫）。
- **觸發情境**：日後任何一邊對 threshold/rootMargin 調校或補上邊界案例修正（例如 `useScrollProgress` 已有的「`IntersectionObserver` 不存在時的降級」），另一邊不會跟著更新，兩份邏輯會逐漸走樣。
- **驗證狀態**：CONFIRMED。
- **建議修法**：評估讓 `ScrollTimeline` 改用/擴充 `useScrollProgress`，或至少把兩者的核心判斷邏輯抽成同一個底層函式共用。
- **現況（2026-10-16 複核）**：仍成立。`ScrollTimeline.tsx:182` 仍是自建的 `IntersectionObserver`（`rootMargin: '-45% 0px -45% 0px'`）；`hooks/useScrollProgress.ts` 仍存在，目前唯一的使用者是 `blog/BlogArticlePage.tsx:502`，四個城市頁都已不再使用它。兩份「目前捲動區段」邏輯並存的狀況未變。行號已更新。

### F48 ⚪ `SHOW_NEARBY_LIST_BUTTON=false` 讓整條 `'nearby'` 模式成為跨兩個檔案的死碼
- **位置**：`web/src/home/ScrollTimeline.tsx:81`（常數定義）、連動 `openCardOnFocus`/`themeCardNearbyOnly` 在 `web/src/home/InteractiveExploreMap.tsx` 的對應分支
- **問題**：唯一會傳入 `'nearby'` 字面值的呼叫點（`renderModeButton('nearby', ...)`）整個被 `SHOW_NEARBY_LIST_BUTTON &&` 擋住；旗標為 `false` 時，`PanelMode` 的 `'nearby'` 分支、`openCardOnFocus`/`themeCardNearbyOnly` 的串接、以及對應 JSX 全部無法被執行到，但程式碼仍完整留在兩個檔案裡。
- **觸發情境**：非功能性缺陷，屬於可維護性問題——之後任何人要理解/修改 ScrollTimeline 的面板模式邏輯，都得先追蹤這個旗標才知道有一半的分支目前是死碼（包含 F42 這個目前休眠中的 bug）。
- **驗證狀態**：CONFIRMED。
- **建議修法**：若短期內不會重新開啟「附近景點」按鈕，考慮先移除 `'nearby'` 模式的完整分支，待未來真的要做時再重新加回；若近期會重新啟用，則應儘快處理 F42，讓死碼不會帶著未修的 bug 一起被喚醒。
- **現況（2026-10-16 複核）**：仍成立：`SHOW_NEARBY_LIST_BUTTON = false`（`ScrollTimeline.tsx:81`），`renderModeButton('nearby', …)` 仍被 `SHOW_NEARBY_LIST_BUTTON &&` 擋住（:464-465），`openCardOnFocus={panel?.mode === 'nearby'}` 仍在 :577。行號已更新。

### F49 ⚪ `InteractiveExploreMap` 為單一呼叫端（ScrollTimeline）新增五個各自獨立的 opt-in boolean/字串 prop，缺乏統一的「嵌入模式」抽象
- **位置**：`web/src/home/InteractiveExploreMap.tsx:195-344`（prop 解構約 :244-328、型別宣告 :336-344；`openCardOnFocus`、`themeCardNearbyOnly`、`disableThemeCardOnMapClick`、`revealNearbyOnFocus`、`themePhotoOnlyWhenFocused`）
- **問題**：這五個 prop 全部只有 `ScrollTimeline.tsx` 會傳入，`JiufenPage.tsx`/`KyotoPage.tsx`/`TainanPage.tsx` 一個都沒用到；每次 ScrollTimeline 這邊冒出一個新的「這個嵌入情境不要做 X」需求，就新增一個獨立的布林 prop 處理，而非收斂成單一的嵌入模式設定物件。
- **觸發情境**：非立即性缺陷，但 `disableThemeCardOnMapClick` 的存在本身就是個警訊——它是為了補上 `openCardOnFocus`/`focusedTheme` 管不到「直接點地圖上的主題點圖標」這條路徑而額外新增的,下一個開卡入口（例如鍵盤導覽、deep link）很可能重蹈覆轍、繞過這整組旗標。
- **驗證狀態**：CONFIRMED。
- **建議修法**：評估收斂成單一 `embedded`/`focusMode` 設定物件（例如 `{ cardMode: 'full' | 'nearbyOnly' | 'disabled', revealAlways: boolean, themePhotoOnlyWhenFocused: boolean }`），所有開卡/揭露入口統一讀這個設定，而不是逐一新增平行旗標。
- **現況（2026-10-08 複核）**：`TainanPage.tsx` 已改套用 `ScrollTimeline`，原敘述「`JiufenPage.tsx`/`KyotoPage.tsx`/`TainanPage.tsx` 一個都沒用到」已過時——這五個 prop 現在透過 `ScrollTimeline` 間接傳給 `TainanPage.tsx` 底下的 `InteractiveExploreMap` 呼叫，唯一尚未用到的只剩 `JiufenPage.tsx`/`KyotoPage.tsx`。問題本身（缺乏統一的嵌入模式抽象）未修復，多一個呼叫端使用反而讓這組零散 prop 的維護成本更明顯。
- **現況（2026-10-16 複核）**：仍未修復。五個 prop 仍只由 `ScrollTimeline.tsx`（約 :572-580）傳入。因 `JiufenPage.tsx`／`KyotoPage.tsx` 也已改用 `ScrollTimeline`，現在四個城市頁都間接用到這組 prop，沒有任何頁面直接傳入；缺乏統一嵌入模式抽象的問題不變。

---

## 進行中的發現（依嚴重度排序）

*（以下為既有稽核文件記錄過、本次尚未逐一重新複核的項目，來源已於各項標註）*

### F4 🟡 `ListEntriesByRange` 在只給 `to`（無 `from`）時，無日期的 entry 會被排除
- **位置**：`server/internal/store/entries.go:167-183`
- **問題**：`to` 條件的 SQL 子句固定加上 `start <> ''`，導致未設定 `start` 的 entry（無日期的待辦型項目）在只有上界、沒有下界時仍被排除，即使邏輯上「無日期」應該落在任何「早於某日」的範圍內。
- **有真實呼叫端會觸發**：`server/internal/wanttools/entry_query.go:94` 呼叫 `ListEntriesByRange(tripID, from, to)`，其 tool 宣告明確教 LLM「不限定起點就留空字串」/「不限定終點就留空字串」，也就是單邊範圍查詢（例如「列出六月一日之前的行程」）是預期且被鼓勵的使用模式，不是理論邊界情境。
- **驗證狀態**：CONFIRMED（含真實呼叫端追蹤）。
- **建議修法**：當 `from == ""` 時，`to` 篩選不應加上 `start <> ''` 排除條件，讓無日期 entry 在單邊查詢下正常出現。
- **現況（2026-10-16 複核）**：部分改變：`ListEntriesByRange` 的行為未修（:178 仍是 `start <> '' AND start <= ?`；函式註解 :166 已改為明文寫「start 為空字串的條目不會落在任何範圍內，僅在 from、to 皆空時納入」，等於把它定為既有設計）。但文中「有真實呼叫端會觸發」已過時：唯一呼叫端 `server/internal/wanttools/entry_query.go:94` 所在的 `internal/wanttools` 套件目前沒有被任何 binary import（`server/internal/wanttools/wanttypes.go` 開頭註解自承，且 `cmd/` 下無 import），現行 LLM 工具在 `internal/onagenttools/` 與前端 client tools，並無此查詢。因此目前實際不可達，降為潛在問題（嚴重度可視為 ⚪）。

### F5 🟡 PATCH `UpdateEntry` 無法把字串欄位清空（空字串與未提供無法區分）
- **位置**：`server/internal/store/entries.go:86-128`（`UpdateEntry`），呼叫端 `server/internal/api/api.go:1313-1361`（`handleUpdateEntry` 解到純 `string` 而非 `*string`）
- **問題**：所有字串欄位（`title`、`start`、`startTime`、`end`、`endTime`、`location`、`note`、`kind`）都用空字串當「不更新」的哨兵值，`if location != "" { fields["location"] = location }` 這類判斷讓「省略欄位」與「明確清空為空字串」無法區分。程式碼註解（`api.go:1312`）承認這是刻意設計（「空字串視為不改」），但仍是真實存在的功能限制。
- **觸發情境**：使用者在 UI 把 `location` 清空並 PATCH `{"location": ""}`，`UpdateEntry` 會判定「沒有要更新」而跳過，舊值留在 DB，但 API 回傳 200，使用者誤以為清空成功。
- **驗證狀態**：CONFIRMED。
- **建議修法**：若要支援清空，需改用 `*string`（nullable）欄位配合「key 是否存在於 JSON」判斷，或提供獨立的「清空欄位」語意（如傳特殊哨兵值）。
- **現況（2026-10-16 複核）**：仍未修復，行號已更新：`entries.go:88-111` 仍以 `!= ""` 判斷是否更新；`api.go:1328-1338` 的 body 仍是純 `string`；`internal/tripsvc/tripsvc.go:119-121` 只是原樣轉呼叫。

### F6 🟡 `tripEntryUpdate.ts` 用 `||` 導致 `title`/`date` 無法清空
- **位置**：`web/src/clienttools/tools/tripEntryUpdate.ts:39-40`
- **問題**：`title: asString(args.title) || e.title` 與 `date: asString(args.date) || e.date` 對明確傳入的空字串會 fallback 回舊值；同檔案的 `time`/`note` 欄位（`:41-42`）正確使用 `!== undefined` 判斷來區分「未提供」與「明確清空」，程式碼自身註解（`:51-56`）也解釋了這個區分的重要性，但 `title`/`date` 沒有套用同樣的處理。
- **觸發情境**：LLM tool call 傳入 `trip_entry_update` 帶 `title: ""` 意圖清空標題，實際上會靜默不生效、舊標題被保留，但 tool 回傳結果顯示成功（`{ updated: id }`），使用者/LLM 無從得知清空失敗。
- **驗證狀態**：CONFIRMED（獨立 agent 重讀程式碼確認不一致）。
- **建議修法**：把 `title`/`date` 改成與 `time`/`note` 一致的 `!== undefined` 判斷模式。
- **現況（2026-10-16 複核）**：仍未修復（`web/src/clienttools/tools/tripEntryUpdate.ts:39-40`，行號未變）。另外原文「`time`/`note` 正確使用 `!== undefined` 判斷」已不準確：目前 :41-42 寫成 `args.time !== undefined && asString(args.time) !== '' ? … : e.time`，同樣會把明確傳入的空字串當成未提供，所以現在 `title`/`date`/`time`/`note` 四個欄位都無法透過此工具清空。

### F7 🟡 `runSyncPush` dry-run 對單筆查詢失敗直接靜默 `continue`，無計數/警告
- **位置**：`server/internal/api/attraction_sync.go:551-560`（原 `docs/ATTRACTION_SYNC_SECURITY_REVIEW.md` 風險清單 #8 記錄為 `:526-528`，行號因後續改動略有偏移）
- **問題**：對 `diff.Intersection` 中每個 ID 逐一 GET 目標端資料，若單筆查詢失敗就 `continue`（註解自承「單筆查詢失敗不中止整個 dry-run，略過這筆的欄位級比對」），但 `syncRunReport` struct（`:443-453`）完全沒有 skipped-count 或 warning 欄位，跳過的筆數不會出現在 dry-run 報告或 `-apply` 的實際同步結果中。
- **觸發情境**：500 筆 intersection 中有 1 筆因為暫時性網路問題查詢逾時，該筆被排除在 `toUpdate`/`toUpdateRecords` 之外，dry-run 報告顯示一切正常，`-apply` 也永遠不會同步這筆實際上可能有欄位差異的資料，使用者完全看不到有東西被跳過。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #8，標註 Medium），本次掃描獨立重新發現同一問題並補上真實 `runSyncPull` 對照。
- **現況（2026-08-16 複核）**：CONFIRMED，仍未修復，且本次驗證新增了 `runSyncPull` 走 `/compare` 端點、不受此問題影響、bug 僅限 push 路徑的具體確認。
- **建議修法**：在 `syncRunReport` 加入 `Skipped []string` 或至少 `SkippedCount int` 欄位，並在跳過時記錄具體 ID，讓 dry-run 報告能誠實反映「這幾筆沒有比對成功」。
- **現況（2026-10-16 複核）**：仍未修復，行號已更新：:553-555 單筆 GET 失敗仍直接 `continue`；`syncRunReport`（:443-453）仍只有 `NeedsSync/SourceCount/DestCount/ToCreate/ToUpdate/ToDelete/Applied/WrittenCount/Complete`，沒有 skipped 欄位。

### F12 🟠 `-retry` 是空殼旗標，續傳邏輯在正式路徑上是死碼
- **位置**：`server/cmd/cli/attraction_sync.go:132`（`-retry` 旗標）、`server/internal/api/attraction_sync.go:361、437`（`Retry` 欄位僅被原樣回傳）、`server/internal/attractionsync/handshake.go`、`server/internal/attractionsync/push.go`
- **問題**：`-retry` CLI 旗標存在但續傳邏輯（`Transfer`/`ResumeFrom`/`PushTo`）在正式路徑上從未被呼叫到，是死碼；唯一測到「中斷續傳」的整合測試測的正是這段永遠不會執行的程式碼，測試通過不代表功能可用。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #4，標註 High）。文件同時記載 `TestCmdAttractionSync_RejectsInvalidDirection` 是 `t.Skip`（`cmd/cli/attraction_sync_test.go:107-109`），`-retry` 沒有任何測試驗證 server 端實際行為。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄，屬於 tag/部署前建議優先處理的三項之一（與 `docs/audit-security.md` S13 並列）。
- **建議修法**：接上實際的續傳呼叫路徑，或在功能未完成前於 CLI help/文件中明確標示 `-retry` 尚未生效，避免使用者誤以為已支援中斷續傳。
- **現況（2026-10-16 複核）**：仍成立（2026-10-16 逐行確認）：`Retry` 在 `internal/api/attraction_sync.go` 只出現在 :361（request 欄位）與 :437（回應原樣回傳），沒有任何邏輯讀它；`attractionsync.Transfer`／`ResumeFrom`／`PushTo` 在非測試程式碼中沒有任何呼叫端（只被 `handshake_test.go`、`integration_test.go` 使用）；`TestCmdAttractionSync_RejectsInvalidDirection` 的 `t.Skip` 現位於 `cmd/cli/attraction_sync_test.go:108`。

### F13 🟡 `handshakeWrite` 在 `Written=false` 時仍回傳 `nil` error
- **位置**：`server/internal/api/attraction_sync.go:768`
- **問題**：`handshakeWrite` 在寫入未完成（`Written=false`）的情況下仍回傳 `nil` error，導致上層誤判為成功，`-apply` 的回應會顯示 `applied:true` 但實際上資料沒有真正寫完。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #5，標註 Medium）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。
- **建議修法**：`Written=false` 時應回傳明確錯誤，讓呼叫端能正確反映「未完全寫入」的狀態。
- **現況（2026-10-16 複核）**：部分緩解：`handshakeWrite`（`attraction_sync.go:768-796`）在 `!result.Written` 且 `postErr == nil` 時仍回傳 `(written, false, nil)`，error 仍為 `nil`（仍成立）；但呼叫端 `runSyncPush`（:577-590）現在會把 `WrittenCount` 與 `Complete`（`*bool`）放進報告（:451-452），所以輸出雖有 `applied:true`，也會帶 `complete:false`，使用者可由此得知未寫完。建議仍是回傳明確錯誤，嚴重度可酌降。

### F14 🟡 `toDelete` 無 sanity check，target 回傳不完整清單可能觸發全表刪除
- **位置**：`server/internal/api/attraction_sync.go:224`、`:625-630`
- **問題**：若目標端因網路問題或 bug 回傳不完整（例如空的或截斷的）清單，`toDelete` 計算邏輯沒有任何上限/比例檢查，可能被誤判為「這些全部都該刪除」而觸發大量或全表刪除。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #6，標註 Medium）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。與 `docs/audit-security.md` 記載的「危險旗標預設值安全」（`allowDelete`/`apply` 預設皆為 `false`）互為緩解因子，但機制本身仍缺 sanity check。
- **建議修法**：對 `toDelete` 加上刪除比例上限（例如單次刪除超過來源總筆數的某個百分比時要求二次確認），或至少在 dry-run 報告中特別標示大量刪除的警訊。
- **現況（2026-10-16 複核）**：仍未修復（行號已移位）：`attraction_sync.go:224`（`toDelete := diff.OnlyInDest`）仍無任何比例或數量上限；pull 路徑的刪除迴圈在約 :629-634，push 路徑的刪除迴圈在 :579-583（且 `_ = client.post(…delete…)` 完全忽略刪除失敗）。預設仍是 `allowDelete=false`／`apply=false`。

### F15 ⚪ `saveSyncToken` 非原子寫入，並發 setup 可能寫出半截 JSON
- **位置**：`server/internal/api/synctoken.go:44-59`（原 `server/internal/attractionsync/synctoken.go:58`，該檔已不存在）
- **問題**：寫入 sync-token 檔案時沒有用 temp-file + rename 的原子寫入模式，若並發呼叫 setup，可能寫出半截/損毀的 JSON 檔案。
- **首次記錄**：`docs/ATTRACTION_SYNC_SECURITY_REVIEW.md`（風險清單 #10，標註 Low）。文件同時記載 sync-token 檔案權限正確（0600/0700），問題僅在寫入時機而非權限。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原文件記錄。
- **建議修法**：改為 temp-file 寫入完成後 `rename` 的原子寫入模式。
- **現況（2026-10-16 複核）**：仍未修復，檔案位置已更新：`saveSyncToken` 現在位於 `server/internal/api/synctoken.go:44`，仍以 `os.WriteFile(path, data, 0600)`（:58）直接寫入，沒有 temp-file + rename。

### F16 🟠 測試覆蓋率低，CI 未執行任何測試
- **位置**：全專案（`server/`、`web/`、`web/admin/`）+ `.github/workflows/*`
- **問題**：
  - Go 測試覆蓋率低：全專案 12 個 `*_test.go`，對比 100 個 `.go` 檔案，比例約 12%（初版掃描時為 8/89）。`internal/api` 已有 `auth_test.go`、`cliauth_device_test.go`，但相對於該套件的路由與權限邏輯量仍明顯不足，`requireOwner`/`requireEditor`/`requireMember` 這類權限檢查與公開連結端點都還沒有測試覆蓋，是目前風險最集中的地方（呼應 `docs/audit-security.md` S1/S2 這類授權漏洞本應由測試攔截）。
  - 前端完全沒有單元測試（`web/`、`web/admin/` 皆無 `*.test.ts`/`*.test.tsx`，也沒有 vitest/jest），只有一支 e2e（`web/tests/e2e-mock-llm.spec.ts`，串 mock LLM）。
  - **CI 沒有任何一個 workflow 執行測試**——六個 workflow（`deploy-cloudrun.yml`、`deploy-admin.yml`、`deploy-migrate.yml`、`inspect-cloudrun.yml`、`ios-build.yml`、`reset-admin-password.yml`）都只做 build/deploy/維運操作，iOS workflow 也只是 `xcodebuild ... build` 純編譯檢查。等於「能編譯過」是目前唯一的自動化品質門檻。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「測試」章節（2026-07-22 初版，2026-08-03 更新，標註為「目前是最大缺口」）。
- **現況（2026-08-16）**：本次未安排 verifier 覆核測試覆蓋率與 CI 現況，狀態延續 8 月初記錄。
- **建議修法**：先把已有的 12 個 Go test、`e2e-mock-llm.spec.ts` 接進 CI，形成一道底線，之後再逐步補測試覆蓋——比從零開始建立習慣容易。
- **現況（2026-10-16 複核）**：部分已改善：Go 測試現有 62 個 `*_test.go`（對比 106 個非測試 `.go`），`internal/api` 已有 `auth_*_test.go`、`entry_test.go`、`content_page_test.go`、`attraction_sync_test.go` 等多支；前端已有 vitest（`web/package.json` 的 `test: vitest run`）與約 57 個 `*.test.ts(x)`，另有 `tests/e2e-*.spec.ts`；`web/admin/` 仍無測試。仍成立的是 CI：`.github/workflows/` 現有 7 個 workflow（`deploy-cloudrun`、`deploy-admin`、`deploy-migrate`、`deploy-migrate-drop-photo-url`、`deploy-with-migration`、`inspect-cloudrun`、`ios-build`），全文搜尋沒有任何 `go test`／`go vet`／`vitest`／`npm test`／`tsc` 步驟，測試仍完全沒有接進 CI。「前端完全沒有單元測試」「六個 workflow」「12 個 Go test」這些數字已過時。

### F17 ⚪ 前端子專案版本分岔：`web/` vs `web/admin/`
- **位置**：`web/package.json`（TypeScript 5.6、Vite 5.4） vs `web/admin/package.json`（TypeScript 7.0、Vite 6.0）
- **問題**：兩個前端子專案版本已分岔，長期不同步可能導致工具鏈行為差異、共用邏輯難以抽取。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「依賴與架構耦合」章節。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄。
- **建議修法**：找時機同步版本，避免越拖越難統一。
- **現況（2026-10-16 複核）**：仍成立：`web/package.json` 為 TypeScript `^5.6.3`／Vite `^5.4.11`，`web/admin/package.json` 為 TypeScript `^7.0.2`／Vite `^6.0.2`。

### F20 ⚪ 部署維運：Dockerfile 無 `HEALTHCHECK`、無 APM/tracing
- **位置**：`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`
- **問題**：三個 Dockerfile 都沒有 `HEALTHCHECK` 指令；沒有 APM/tracing/error-tracking 整合（Sentry、OpenTelemetry 等完全沒有）。近期已發生一次「健康檢查在正式環境失效才發現」的真實案例（commit `dba5145`，adminserver 曾漏設 `AI_PROVIDER`/`GOOGLE_API_KEY`/`GOOGLE_PLACES_API_KEY` 導致健康檢查一直回報未設定），這類問題本來能被監控機制更早攔截。
- **首次記錄**：`docs/PROJECT_HEALTH_REVIEW.md`「部署維運」章節。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄。
- **建議修法**：補上 `HEALTHCHECK`；評估接入輕量 error tracking（如 Sentry 或 GCP Error Reporting）。
- **現況（2026-10-16 複核）**：仍成立：`Dockerfile`、`Dockerfile.admin`、`Dockerfile.migrate`、`Dockerfile.migrate-drop-photo-url` 均無 `HEALTHCHECK`；`server/`、`web/src` 搜尋 sentry／opentelemetry／prometheus／datadog／newrelic 零命中。

### F21 🟠 無 panic recovery，任一 handler/goroutine panic 會整個 process 崩潰
- **位置**：全 repo（`recover()` 零命中）
- **問題**：全 repo grep `recover()` 零結果，任一 handler 或 WS goroutine panic 會直接讓整個 process 崩潰，沒有任何隔離。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.1 韌性缺口」，評估日期 2026-07-24。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 panic recovery middleware，至少在 HTTP handler 與 WS goroutine 層級攔截 panic，避免單一請求拖垮整個服務。
- **現況（2026-10-16 複核）**：部分改變：全 repo 的 `recover()` 現有兩處，皆為背景 goroutine 專用——`internal/api/geo_outline.go:151`（`warmPlaceDetailsPhotoCache`）與 `internal/api/blog_photo.go:246`（`runPhotoProcessingInBackground`）；仍沒有 HTTP middleware 層級或 WS goroutine 的統一 panic recovery（`requestLogging`／`cors` 包裝之外無 recover，`internal/api/ws.go` 無 recover）。補充：Go 標準庫 `net/http` 對 handler goroutine 的 panic 本身會攔截並只結束該連線，不會讓整個 process 崩潰；真正會讓 process 崩潰的是自行開的 goroutine，因此本項實際風險在「其餘未加 recover 的自建 goroutine」（例如 `middleware.go:97` 的 `go func()`、WS 相關 goroutine）。

### F22 🟡 無 `http.Server` timeout、無 graceful shutdown
- **位置**：`server/cmd/server/main.go`（用 `http.ListenAndServe`）
- **問題**：無 `ReadTimeout`/`WriteTimeout`/`IdleTimeout`（slowloris 風險）；也沒有 graceful shutdown（signal handling + `srv.Shutdown`）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.1 韌性缺口」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`http.Server` 補上明確 timeout；加上 signal handling 與 `srv.Shutdown` 支援 graceful shutdown。
- **現況（2026-10-16 複核）**：仍未修復：`server/cmd/server/main.go:440` 仍是 `http.ListenAndServe(*addr, withLegacyDomainRedirect(mux))`，檔內沒有 `http.Server`、`ReadTimeout`/`WriteTimeout`/`IdleTimeout`、signal handling 或 `Shutdown`。

### F23 🟠 `AutoMigrate` 失敗不中止啟動，服務會降級啟動但外觀正常
- **位置**：`server/internal/store/store.go:78-82`（原 `:55`）
- **問題**：`AutoMigrate` 失敗時只設 `MigrationOK=false` 讓服務降級啟動，生產環境會出現 schema 不一致但服務看似健康；無版本化 migration、無 up/down、無 dry-run。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.2 資料層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。與 F20（健康檢查未涵蓋 DB）互相關聯——`/health` 目前不檢查 DB 也不回報 `MigrationOK`，兩者疊加會讓 schema 不一致的問題更難被及早發現。
- **建議修法**：換版本化 migration 工具（golang-migrate / atlas），`AutoMigrate` 失敗改成中止啟動而非降級。
- **現況（2026-10-16 複核）**：仍未修復，行號已更新：`store.go:78-81` 的 `db.AutoMigrate(...)` 失敗仍只 `log.Printf` 並設 `migrationOK = false`，`Open()` 照常回傳（:82）；程式註解（:64-72）把它定為刻意的降級策略。`/health`（`internal/api/api.go:933-935`）仍固定回 `{"status":"ok"}`。

### F24 🟡 無 connection pool 設定、store 層不用 `context.Context`、交易極少
- **位置**：`server/internal/store/`
- **問題**：
  - 無 `SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime` 設定，Cloud SQL 有連線上限，預設 unlimited 容易打爆。
  - store 層完全不用 `context.Context`，無法傳遞逾時/取消，慢查詢無法中斷。
  - 交易極少，僅 4 處 `db.Transaction`。entry 寫入 + trip 歸組 + message 關聯是多步驟寫入但未包在同一交易。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.2 資料層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 connection pool 設定；store 層全面加 `context.Context` 參數；多步驟寫入包進同一交易。
- **現況（2026-10-16 複核）**：仍未修復：全 repo 無 `SetMaxOpenConns`／`SetMaxIdleConns`／`SetConnMaxLifetime`；`store` 套件中只有 `Ping(ctx)`（`store.go:105`）使用 `context.Context`；交易目前只有 3 處（`geocache.go:214`、`geocache.go:245`、`channels.go:55`），原文「4 處」略有出入（entry/trip 歸組機制已移除，`channels.go` 註解提到 messages 已移至裝置端）。

### F25 🟡 無結構化 logging、無 metrics/tracing、`/health` 不檢查 DB
- **位置**：全專案 logging（僅 `log.Printf`）、`server/internal/api/`（`/health` 端點）
- **問題**：只有標準庫 `log.Printf`，無結構化 logging（無 `slog`）、無 request ID/trace ID、無 log level；logging middleware 不印 status code、不印錯誤。完全無 metrics、無 tracing。`/health` 不檢查 DB，直接回 `{"status":"ok"}`，也不回報 `MigrationOK`，Cloud Run liveness 會誤判健康（已新增 `store.Ping(ctx)` 方法但 `/health` 尚未使用它）。commit `dba5145` 正是「adminserver 漏設環境變數導致健康檢查失效」的真實事故，證明目前機制無法主動告警（與 F20 為同一事故的不同面向記錄）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.3 可觀測性」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：換成結構化 logging（Go 1.21+ 內建 `log/slog`），加 request ID；logging middleware 補印 status code、response size、錯誤；`/health` 改成真的呼叫 `store.Ping` 並回報 `MigrationOK`；設 uptime check + alert policy。
- **現況（2026-10-16 複核）**：部分改善：`internal/api/middleware.go:87-103` 的 `requestLogging` 現在會印 method／path／status／耗時，並非同步寫入 `LogAPIRequest`，所以「不印 status code」已過時。仍成立的部分：只有 `log.Printf`（無 `log/slog`）、無 request ID／trace ID、無 metrics／tracing；`handleHealth`（`api.go:933`）仍不檢查 DB、不回報 `MigrationOK`——`Store.Ping` 目前只被 `internal/adminconsole/health.go:111` 使用，主站 `/health` 沒用到。

### F26 ⚪ API 錯誤格式不一致、無統一 domain error type、設定散落
- **位置**：全 `server/internal/api/`
- **問題**：API 錯誤格式不一致（至少三種）：`writeErr` 的巢狀 `{"error":{"code","message"}}` vs `http.Error` 的扁平 `{"error","message"}`（且 Content-Type 是 `text/plain`）。無統一 domain error type，無法區分 400/403/404/500。設定散落：`os.Getenv` 分散在多個檔案，無集中 config struct，middleware 在函式內讀 env 導致測試難以注入。
- **首次記錄**：`docs/architecture-review-2026-07.md`「2.4 其他」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：收斂 API 錯誤格式成單一 schema，定義 domain error type 對應 HTTP status；集中設定管理成單一 config struct，啟動時驗證必要欄位。
- **現況（2026-10-16 複核）**：部分已改：`internal/api` 內已沒有任何 `http.Error(` 呼叫，API 錯誤格式已統一走 `writeErr`（`api.go:1407-1411`，巢狀 `{error:{code,message}}`），「至少三種格式」已過時（`internal/adminconsole/adminconsole.go:172` 的註解也記載該套件已改掉純文字 body）。仍成立：沒有 domain error type（錯誤碼都是各處手寫字串）；設定仍散落——`os.Getenv` 分佈在 18 個非測試 `.go` 檔案，無集中 config struct。

### F27 🟡 前端無狀態管理方案，prop drilling 明確存在
- **位置**：`web/src/`（`createContext`/`useContext`/`useReducer` 零命中）
- **問題**：完全沒有狀態管理方案，全靠 `useState` + props。`useAppState()` 回傳多個欄位的 `ContentProps`，透過 `{...props}` 一路灌到子元件，`cfg`/`user`/`token` 幾乎每層都要接一次。伺服器狀態全部手寫 `useState + useEffect + fetch`，無快取、無去重、無 stale 處理（沒有 TanStack Query 之類的資料層）。零 code splitting：`lazy`/`Suspense` 完全無命中，首頁 landing page 的訪客也得付大 bundle 的代價。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.1 結構與狀態管理」。文件同時記錄「幾乎完全平鋪」「無 router」的舊評估已不準確：目前已出現 domain 分層目錄（`admin/`、`clienttools/`、`geo-planning/`、`sdk-proposals/`、`trip/`），且已導入 `react-router-dom`，仍有大量檔案留在根目錄，並非嚴格分層。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：引入狀態管理（Context + useReducer 或 Zustand），消除 prop drilling；伺服器狀態改用 TanStack Query；加 code splitting（`lazy`/`Suspense`）。
- **現況（2026-10-16 複核）**：部分已改善：已導入 code splitting，`web/src/App.tsx:74-81` 起各頁面改用 `React.lazy`＋`Suspense`，「零 code splitting」已過時。仍成立：沒有全域狀態管理方案（`createContext` 只在 `ScrollTimeline`、`PhoneBottomSheet`、`plan-core/overlayDom.ts`（原 `plan-core/composerSlot.ts`，已併入）等局部使用），`App.tsx:181` 的 `useAppState()` 仍回傳大型 props 並以 `ContentProps`（`AppCommon.tsx` 定義，`phone/Content.tsx:80`；原 `PhoneContent.tsx:104`）逐層傳遞；`web/package.json` 沒有 TanStack Query／Zustand，伺服器狀態仍是手寫 fetch。

### F28 🟡 記憶化嚴重不足，`Timeline.tsx` 等元件零 `useMemo`/`useCallback`/`memo`
- **位置**：`web/src/timeline/Timeline.tsx`（記錄當時路徑為 `web/src/Timeline.tsx`，該檔案已搬到 `timeline/` 子目錄，539 行）等 7 個元件；`web/src/`（99 處 inline `style={{...}}`）
- **問題**：`Timeline.tsx` 零 `useMemo`/`useCallback`/`memo`，`MultiTrackTimeline` 每次 render 都重建整棵列表。`MessageBubble.tsx` 等 7 個元件同樣零記憶化，無 `React.memo`，每次 WS 事件更新 state，整棵 Timeline + 所有 MessageBubble 全部重繪。99 處 inline `style={{...}}` 每次 render 新建參考，破壞任何下游 memo 效果。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.2 效能」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`Timeline.tsx` 等熱點元件加 `useMemo`/`React.memo`；逐步把 inline style 抽成常數或 CSS class。
- **現況（2026-10-16 複核）**：仍成立：`web/src/timeline/Timeline.tsx`（現 573 行）與 `web/src/chat/MessageBubble.tsx` 內 `useMemo`／`useCallback`／`memo(` 均為 0；`web/src` 全專案沒有 `React.memo`；inline `style={{` 目前為 89 處（原 99 處）。

### F29 🟡 可近性（a11y）幾乎空白，15 處 `<div onClick>` 無鍵盤支援
- **位置**：`web/src/`
- **問題**：aria 屬性總共只有 4 個（1 個 `aria-hidden`、2 個 `aria-label`、1 個 `aria-live`）。15 處 `<div onClick={...}>` 無對應 `role`/`tabIndex`/`onKeyDown`——鍵盤與螢幕閱讀器完全無法操作。語意化 HTML 稀薄：全專案僅 1 個 `<main>`、1 個 `<header>`、1 個 `<nav>`、1 個 `<h1>`。無 focus trap（modal）、無 skip link、無系統化 `:focus-visible`。無 ESLint，自然也無 `eslint-plugin-jsx-a11y`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.3 可近性」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：建立 ESLint 設定（含 `eslint-plugin-jsx-a11y`），修不可鍵盤操作的 `div onClick`。
- **現況（2026-10-16 複核）**：部分改變：aria 屬性已大幅增加（`web/src` 非測試 `.tsx` 約 150 處 `aria-` 命中，原文僅 4 個），語意化標籤（`<main>`/`<nav>`/`<h1>`/`<header>`）約 68 處。但 `<div onClick>` 反而增加為 25 處，且全部沒有 `role`/`tabIndex`/`onKeyDown`（例如 `Timeline.tsx:338`、`PaceChart.tsx:348`、`DemoPanel.tsx:209`、`SettingsDialog.tsx:82`）；`web/package.json` 仍沒有 ESLint 或 `eslint-plugin-jsx-a11y`。

### F30 ⚪ 前後端型別靠手寫同步，無 OpenAPI/codegen，`request<T>()` 無執行期驗證
- **位置**：`web/src/api.ts`（`request<T>()`）、`web/src/types.ts`
- **問題**：`tsconfig.json` 有 `strict: true` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch`，`any` 用量極低（全專案僅 1 處且只在註解），零 `@ts-ignore`——型別安全本身做得好。但前後端型別靠手寫同步（`types.ts` 註解自承要手動對齊 Go 的 `model.go`），無 OpenAPI/codegen。後端改欄位前端不會有編譯錯誤——這是最大的型別風險。`request<T>()` 結尾 `return call.responseBody as T`，無執行期驗證（無 zod/valibot）。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.4 型別安全」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**（長期）：用 OpenAPI 當單一真實來源，前後端型別都從 spec codegen；前端 API 回應加 zod 執行期驗證。
- **現況（2026-10-16 複核）**：仍成立：`web/src/api.ts:213` 仍是 `return call.responseBody as T`，沒有執行期驗證（`web/package.json` 無 zod／valibot）；`web/src/types.ts:1` 仍註明要與 Go `model.go` 手動對齊，無 OpenAPI／codegen。

### F31 ⚪ 純全域 CSS，無 scope 隔離，斷點魔數重複
- **位置**：記錄當時是單一 `web/src/styles.css`（2,475 行）+ `landing.css` + `debug.css`；`web/src/App.tsx:76`（`DESKTOP_BREAKPOINT = 768`）。**`styles.css` 本身已不存在**——已拆分為 `base-ui.css` 加多個 CSS Module（commit `313a90a`，2026-08-16 前後），這項拆分本身可能已改善「純全域 CSS、無 scope 隔離」的問題核心，但本次未安排 verifier 覆核實際改善程度，僅確認檔案路徑已變動。
- **問題**：純全域 CSS，無 CSS Modules / Tailwind / CSS-in-JS，類名靠約定，無 scope 隔離。有初步 design token（12 個 CSS 變數），但無 spacing / typography / radius / shadow scale，大量硬編碼數值。斷點魔數重複：`App.tsx:76 DESKTOP_BREAKPOINT = 768` 註解自承「需與 styles.css 的 @media 一致」——手動同步的耦合。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.5 樣式」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。此章節與 [[313a90a]]（桌面版對話小匡與行程管理重構，CSS 依歸屬拆分為按需引入模組）commit 有部分重疊，下次稽核應確認該次重構是否已緩解「純全域 CSS」問題。
- **建議修法**：視重構進度評估是否需要引入 CSS Modules 或建立完整 design token scale。
- **現況（2026-10-16 複核）**：部分已改善：`web/src/styles.css` 已不存在，現在有 `base-ui.css` 加 85 個 `*.module.css`（CSS Modules），另有少量頁面級純 `.css`（`home/*.css`、`pace/PaceMap.css`、`blog/BlogArticle.css`、`components/zLayers.css`），「純全域 CSS、無 scope 隔離」已大幅緩解。仍成立：斷點魔數 `DESKTOP_BREAKPOINT = 768` 已搬到 `web/src/hooks/useIsDesktop.ts:4`，其註解（:3）仍寫「需與 styles.css 的 @media (min-width: 768px) 一致」——手動同步的耦合仍在，且註解指向的 `styles.css` 已不存在。

### F32 ⚪ API 層無重試/timeout/`AbortController`，`fetchPublicView` 繞過統一層
- **位置**：`web/src/api.ts`
- **問題**：`api.ts` 有統一的 `request<T>()` 封裝，集中處理 baseURL、Bearer header、JSON 序列化、`ApiError`，並用 pub/sub 把每筆交易餵給 DebugPanel——這部分設計良好。但無重試、無 timeout、無 `AbortController`（元件 unmount 後 setState 競態）。`fetchPublicView` 繞過統一層，直接用裸 `fetch`，不進 ApiCall 紀錄、錯誤型別不一致。loading/error 全靠各元件手寫：`setError`/`setLoading` 散落各處各自處理，無全域 error boundary，401 過期無集中攔截。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.6 API 層」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：`fetchPublicView` 改走統一 `request<T>()` 層；補上 `AbortController` 支援；建立全域 error boundary 與 401 集中攔截。
- **現況（2026-10-16 複核）**：部分改善：已有全域 `ErrorBoundary`（`web/src/ErrorBoundary.tsx`，於 `App.tsx:185` 包在最外層），401 也已由 `api.ts` 在唯一丟出 `ApiError` 的地方集中通知（`onUnauthorized`，`api.ts:79-87`）。仍成立：`api.ts` 內沒有 `AbortController`／timeout／重試；`fetchPublicView`（`api.ts:1235-1241`）仍直接用裸 `fetch`，不經 `request<T>()`。

### F33 ⚪ `web/admin` 與主專案完全解耦，工具鏈版本分岔，殘留誤建目錄
- **位置**：`web/admin/`、`web/src/admin/`（誤建的殘留目錄）
- **問題**：`web/admin` 是獨立的第二個 Vite SPA，有自己的 `package.json`、`tsconfig`、`node_modules`，與主專案完全解耦：不同身分系統（cookie session）、不同 API 前綴、不共用任何程式碼（連型別都各自手寫一份）。工具鏈版本分岔：admin 用 Vite 6.x + TypeScript 7.0.2，主專案用 Vite 5.4.11 + TypeScript 5.6.3（與 F17 同一問題的細節記錄）。無 monorepo 工具管理。admin 的 tsconfig 反而更嚴格（多了 `verbatimModuleSyntax`、`erasableSyntaxOnly`）。`web/src/admin/` 是誤建的殘留目錄（只含 `.env.local`、`dist/`、`node_modules/`，未被 git 追蹤），應刪除。
- **首次記錄**：`docs/architecture-review-2026-07.md`「3.8 web/admin 子專案」。
- **現況（2026-08-16）**：本次未覆核 `web/src/admin/` 殘留目錄是否仍存在，建議下次稽核順手確認並清理。
- **建議修法**：清理 `web/src/admin/` 殘留目錄；長期考慮收進 monorepo（pnpm workspace / turborepo）統一工具鏈版本。
- **現況（2026-10-16 複核）**：部分已解決：誤建的 `web/src/admin/` 殘留目錄已不存在（`web/src/` 下無 `admin`）。其餘仍成立：`web/admin/` 仍與主專案獨立，工具鏈版本分岔（TypeScript 7.0.x／Vite 6.x vs 5.6.x／5.4.x）。

### F34 🟠 CI 完全沒有跑測試，無 security scan
- **位置**：`.github/workflows/*`
- **問題**：CI 完全沒有跑測試：deploy workflow 只有 build → push → deploy，測試已存在卻完全沒接上，唯一的品質門檻是「能編譯過」（與 F16 為同一問題的不同記錄來源）。沒有任何 security scan：無 `govulncheck`、`npm audit`、Trivy/Grype、CodeQL、secret scanning。原文「push main 直接部署 prod」已不成立：`deploy-cloudrun.yml` 已改為 tag 觸發（`push: tags: ['v*']`）+ `workflow_dispatch`，但仍無正式 staging 環境或 required-reviewers 機制，打 tag 後仍是直接 100% 切換（無 `--no-traffic` + 逐步導流、無 smoke test、無自動 rollback）。無 PR 驗證 workflow：只有 `ios-build.yml` 有 `pull_request` 觸發，後端與前端的 PR 不跑任何檢查。`deploy-admin.yml` 的 `skip_build` 分支會部署 `:latest`，與 git SHA 脫鉤，難以追溯正在跑的是哪個 commit。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.2 CI/CD 缺口」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，與 F16 併同一輪處理效益最高。
- **建議修法**：建 CI workflow 跑 `go test` + `go vet` + `tsc --noEmit`（現有測試先接上，成本最低、立即見效）；加 `govulncheck` 與 `npm audit` 到 CI；加 PR 觸發的驗證 workflow。
- **現況（2026-10-16 複核）**：仍成立（部分細節已變動）：七個 workflow 中沒有任何測試或 security scan 步驟（無 `go test`／`govulncheck`／`npm audit`／CodeQL／Trivy）；`deploy-cloudrun.yml` 仍為 tag（`v*`）＋`workflow_dispatch` 觸發，且仍直接切 100% 流量（`deploy-with-migration.yml:14` 註解自承沒有 `--no-traffic`）；只有 `ios-build.yml` 有 `pull_request` 觸發；`deploy-admin.yml:68` 的 `skip_build` 仍會部署 `:latest`。新增了 `deploy-with-migration.yml` 與 `deploy-migrate-drop-photo-url.yml` 兩個維運 workflow（見 F36）。

### F35 🟠 只有一個環境（prod），跨專案資源錯配
- **位置**：GCP 專案設定、`server/scripts/setup.sh`（原 `server/deploy/setup.sh`）
- **問題**：只有一個環境（prod），無 dev/staging。跨專案資源錯配：Cloud Run 與 Secret Manager 在 `shuttle-045094509`，但 Cloud SQL 在 `onagent-prod`，`setup.sh` 自己有一大段警告說這是寫死的、腳本無法處理，是專案改名（Shuttle → Tripace）遺留的命名混亂。secret 全部釘 `:latest`，改版會在下次 revision 靜默改變行為，無版本追溯。`--allow-unauthenticated` 寫死在兩個 deploy workflow，管理後台也是公開的，僅靠應用層 session 保護。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.3 環境管理」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：建 staging 環境，人工確認後才升 prod；secret 改用明確版號而非 `:latest`；長期評估 GCP 資源改名從 `shuttle-045094509` 遷到 tripace 命名。
- **現況（2026-10-16 複核）**：仍成立，檔案路徑已更新：`setup.sh` 現位於 `server/scripts/setup.sh`（`server/deploy/` 已不存在），:25-26 仍有 `CLOUDSQL_INSTANCE` 寫死為 `onagent-prod:asia-east1:onagent-db` 的警告；`deploy-migrate.yml:37-52` 仍同時使用 `shuttle-045094509` 與 `onagent-prod` 兩個專案；`--allow-unauthenticated` 仍在 `deploy-admin.yml:70`、`deploy-cloudrun.yml:226`、`deploy-with-migration.yml:231`；secret 仍全部使用 `:latest`；仍只有單一 prod 環境。

### F36 🟠 資料庫維運：無備份策略文件、無 rollback 機制
- **位置**：`server/scripts/setup.sh`（原 `server/deploy/setup.sh`）、`scripts/rotate_db_password.sh`（原文另列的 `server/internal/store/maintenance.go` 已不存在，`DropLegacyEntryColumns` 全 repo 零命中）
- **問題**：無任何備份策略文件或設定：全 repo grep `backup`/`備份`/`PITR` 零結果，Cloud SQL 是否啟用自動備份與 PITR，在 `setup.sh` 中完全沒設定。無 rollback 機制：grep `rollback` 零結果，`AutoMigrate` 只增不減，schema 無法回退；Cloud Run 雖可手動切 revision，但無腳本或 runbook。破壞性維運操作無保護：`DropLegacyEntryColumns()` 會 DROP 欄位，雖有冪等檢查與充分註解，但無二次確認、無備份前置檢查，直接對 prod DB 操作。`scripts/rotate_db_password.sh` 直接對 prod 操作，無確認提示、無 dry-run，誤執行會立刻讓服務認證失敗（需重新 deploy 才讀到新 secret → 有服務中斷窗口），另外組出的 DSN 用 `sslmode=disable`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.4 資料庫維運」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：確認/啟用 Cloud SQL 自動備份與 PITR；`rotate_db_password.sh` 加確認提示與 dry-run 模式；`DSN` 改用 `sslmode=require` 或更嚴格設定。
- **現況（2026-10-16 複核）**：部分改變：新增了 `.github/workflows/deploy-with-migration.yml`，提供 `backup_first` 選項、將 Cloud SQL 匯出到 `tripace-db-backups` bucket（:32、:53、:78-120），算是「遷移前手動備份」的機制；但仍沒有 Cloud SQL 自動備份／PITR 的設定或文件，仍沒有 rollback 的腳本或 runbook。`DropLegacyEntryColumns()` 已隨 `store/maintenance.go` 移除，該項破壞性操作疑慮不再適用（改由 `cmd/migrate-drop-photo-url` 搭配 workflow 執行）。`scripts/rotate_db_password.sh` 仍成立：無確認提示、無 dry-run，:30 的 DSN 仍是 `sslmode=disable`。

### F37 🟠 完全沒有 error tracking/APM/tracing/uptime 監控
- **位置**：全專案
- **問題**：完全沒有 error tracking / APM / tracing：grep `sentry|opentelemetry|prometheus|datadog|newrelic` 全 repo 零結果。無 uptime 監控、無 alerting。Dockerfile 無 `HEALTHCHECK`，Cloud Run 也沒設 startup/liveness probe，儘管 `/health` 端點已經寫好——健康端點寫了但沒人用（與 F20/F25 為同一問題群的不同記錄角度）。唯一的健康機制是 admin 後台的 `GET /admin/api/health/external`，是 pull-based 且需要人主動查看。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.5 監控與告警」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，建議與 F20/F25/F23 一併規劃（都指向「健康檢查與可觀測性」這同一組根因）。
- **建議修法**：接 error tracking（Sentry 或 GCP Error Reporting）；設 Cloud Monitoring uptime check + alert policy（至少 5xx 率與 `/health` 失敗）；Dockerfile 加 `HEALTHCHECK`，Cloud Run deploy 加 startup/liveness probe。
- **現況（2026-10-16 複核）**：仍成立：全專案無 error tracking／APM；workflow 中搜尋 `probe` 零命中，Cloud Run 仍未設 startup／liveness probe；Dockerfile 仍無 `HEALTHCHECK`。

### F38 ⚪ 無 dependabot/renovate，`golang.org/x/crypto` 版本落後，無 IaC
- **位置**：`server/go.mod`、`server/scripts/`（原 `go.mod`、`server/deploy/`）
- **問題**：無 dependabot / renovate，無自動更新、無漏洞告警。`golang.org/x/crypto` 版本落後（對照同檔 `x/sys`、`x/text`），crypto 是安全敏感套件，建議定期核對。`server/deploy/` 只有一支 `setup.sh`（一次性 GCP bootstrap），無 Terraform/Pulumi，所有基礎設施靠 shell script + 手動 gcloud，無 state 追蹤、無 drift 偵測。
- **首次記錄**：`docs/architecture-review-2026-07.md`「4.6 依賴管理」「4.7 IaC」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**：加 dependabot 或 renovate；核對並升級 `golang.org/x/crypto`；長期評估導入 Terraform 管理 GCP 基礎設施。
- **現況（2026-10-16 複核）**：部分改變：仍無 dependabot／renovate（`.github/` 下只有 `workflows/`），仍無 Terraform／Pulumi，基礎設施仍靠 shell script＋手動 gcloud。但「`golang.org/x/crypto` 版本落後」已不成立：`server/go.mod:65-70` 現為 `x/crypto v0.55.0`，`x/sys v0.49.0`、`x/text v0.43.0`，crypto 版本號反而較高。

### F39 🟡 時間欄位用 string 而非 timestamp，缺複合索引，缺外鍵約束
- **位置**：`server/internal/store/entity.go`（`entries` 表：`Start`/`StartTime`/`End`/`EndTime` 全是 `string`）
- **問題**：
  - 時間欄位用 string 而非 date/timestamp，無法用 DB 做範圍查詢最佳化與正確排序（此問題與 `docs/audit-functional.md` F4「`ListEntriesByRange` 排除無日期 entry」屬於同一資料模型根因的不同表現）。**注意**：確實存在一個已完成的 timestamptz 遷移（改成 `time.Time`+時區+`AllDay`），但只在未合併的本地分支上，尚未進主線，不宜視為已解決。
  - 缺複合索引：`entries` 只有 `trip_id` 單欄索引。常見查詢 `WHERE trip_id=? AND start BETWEEN ?` 應建複合索引；`ORDER BY created_at DESC` 亦無索引。
  - 缺外鍵約束：無 `entries.trip_id → trips.id` 等 FK，全靠 `AutoMigrate`。刪行程會留下孤兒 entries/public_links，需手動級聯。
  - 全面 hard delete，無稽核軌跡：無 `deleted_at`，誤操作刪除的資料無法復原，也無操作歷史可追查。
  - N+1 風險：`ListTripsForUser`（`store/channels.go:14-30`）用相關子查詢做 `member_count` 與 `last_message_preview`，行程多時等同每列各跑兩次查詢。
  - PII 明文儲存：`email` 明文；`entries` 的 `location`/`lat`/`lng` 是使用者位置軌跡，屬敏感個資，全部明文無欄位級加密。
  - `entries.detail` 用 JSON serializer，無 schema 約束，Postgres 下未用 `jsonb`，無法索引。
  - **做得好的**：`public_links` 的 `trip_id` 與 `link_token` 皆有 `uniqueIndex`；`users.email`/`apple_sub` 有 `uniqueIndex`。
- **首次記錄**：`docs/architecture-review-2026-07.md`「五、資料模型」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄，建議下次稽核確認 timestamptz 遷移分支是否已合併主線。
- **建議修法**：評估合併既有的 timestamptz 遷移分支；`entries` 加複合索引；補上外鍵約束或至少級聯刪除邏輯；評估 soft delete + 稽核軌跡（B-5 建議 #97）。
- **現況（2026-10-16 複核）**：仍成立：`server/internal/store/entity.go:39-60` 的 `entryRow` 時間欄位仍是 `string`、只有 `trip_id` 單欄 `index`、無 FK、無 `deleted_at`，`Detail` 仍用 `serializer:json`；`ListTripsForUser`（`store/channels.go:14-33`）仍用兩個相關子查詢。F4 所指的 `ListEntriesByRange` 同源問題亦同（但其唯一呼叫端目前不可達，見 F4 現況）。timestamptz 遷移分支是否已合併仍未能驗證：`entryRow` 仍是 string，推測尚未進主線。

### F40 ⚪ 多人協作衝突處理基本上沒有，WS 只做無 payload 的廣播通知
- **位置**：WS Hub（`server/internal/api/ws.go` 一帶）
- **問題**：WS Hub 只做單向廣播，且只廣播 `{"event":"entries_updated"}` 這種無 payload 的通知，前端收到後自己重新 fetch。衝突處理基本上沒有：無版本號、etag、optimistic lock、CRDT 或 last-write-wins 標記。兩人同時編輯同一 entry 就是後寫覆蓋，對方只會收到「重新抓一次」的通知。角色只有 editor/viewer 兩級，無「可留言不可編輯」的中間態，也無轉移 owner。
- **首次記錄**：`docs/architecture-review-2026-07.md`「6.3 多人協作的薄弱處」。
- **現況（2026-08-16）**：本次未安排 verifier 覆核，狀態延續原記錄。
- **建議修法**（短期）：WS 廣播從「無 payload 通知 + 前端重抓」改成帶 delta payload，減少往返；（長期，B-1 建議 #55）評估 CRDT（Yjs/Automerge）做行程協作編輯。
- **現況（2026-10-16 複核）**：仍成立：`api.go` 內多處 `s.hub.Broadcast(tripID, map[string]any{"event": "entries_updated", "tripID": tripID})`（:1230、:1274、:1306、:1359 等）仍是無 delta payload 的通知；`UpdateEntry` 無版本號／etag；角色仍只有 `RoleEditor`／`RoleViewer`（`model/model.go:46-47`）。

### F41 ⚪ 功能缺口：無匯出、無通知、無離線支援、iOS 實質停止維護
- **位置**：產品功能層級，非特定檔案
- **問題**：搜尋（只有 LLM 語意查詢，慢/貴/不精確）、匯出（無 iCal/Google Calendar/PDF/CSV——行程 app 沒有日曆匯出是明顯缺口）、通知（零推播/email，邀請成員、行程變更、同行者編輯都不會通知）、離線支援（entries/trips 全靠 API，無 service worker/PWA manifest）、版本歷史與 undo、相片/附件、費用/分帳、整趟行程的地圖總覽（只有推薦景點有地圖）、交通/路線時間計算（有 geocode 但無點對點移動時間）。iOS 端最後兩次 commit 都是純改名/xcodegen 重生成，沒有任何功能 commit（此結論未重新複查，狀態可能未變），與後端的功能落差需要重新盤點。
- **首次記錄**：`docs/architecture-review-2026-07.md`「6.2 iOS」「6.4 功能缺口」。
- **現況（2026-08-16）**：本次未覆核，狀態延續原記錄，屬產品規劃層級，非程式碼 bug。
- **備註**：`docs/architecture-review-2026-07.md` 原文附有完整的 B-3 產品功能建議清單（iCal 匯出、地圖總覽、交通時間計算、全文檢索、推播通知、PWA、相片附件、費用分帳等 15 項），為避免重複記錄，此處不逐條複製，需要時請參照該文件的「B-3. 產品功能」章節（該文件本身已於本次稽核整理後標記為可移除的來源文件，內容已完整併入本檔案與 `docs/audit-security.md`，若日後需要查閱原文可從 git 歷史還原）。
- **現況（2026-10-16 複核）**：未能完整驗證（屬產品規劃層級）：抽查 `web/src`、`server` 未找到 iCal／CSV／PDF 匯出（`VCALENDAR`／`.ics` 零命中）；`web/public` 只有 `favicon.svg`／`robots.txt`／`sitemap.xml`，無 PWA manifest，且 `web/src/main.tsx:27-28` 反而會主動取消註冊 service worker；`ios/` 最近的 commit 仍是改名類（`85885f9` 等）。其餘功能缺口未逐項核對，保留。

### F10 ⚪ `geo_outline.go` 的 `attractionResponse` 仍用 `Landmark*` 命名，違反 terminology.md 統一用語規則
- **位置**：`server/internal/api/geo_outline.go`（`LandmarkName` 欄位，JSON tag `landmarkName`）
- **問題**：`docs/terminology.md` 規定正式用語統一為「景點區域」/`Attraction`，介面用語不應有同義詞變體；commit `3d8d300` 已在 `maintenance.go` 做過同一輪「landmark → attraction」改名清理，但同一 commit 觸及的 `geo_outline.go` 卻遺漏了這個欄位，且未被 `terminology.md` 已知的 `server/internal/geo/places.go` `District`/`Landmark` 待辦揭露涵蓋——屬於清理漏網之魚。
- **現況（2026-09）**：`LandmarkPhotoURL` 欄位已隨主題卡/景點介紹卡取圖策略重構移除（前端不再讀取，改一律查 `photo_assets`），`LandmarkName` 欄位仍存在、命名問題本身未解決，本條目範圍縮小為只涵蓋 `LandmarkName`。
- **現況（2026-10-16 複核）**：仍成立：`server/internal/api/geo_types.go:42` 的 `attractionResponse` 仍有 `LandmarkName string \`json:"landmarkName,omitempty"\``，`geo_outline.go:459` 仍在填它；前端 `web/src/api.ts:431`、`geoCandidateHelpers.ts:138` 仍讀 `landmarkName`；來源型別 `geo.District.LandmarkName`（`internal/geo/places.go:875`）亦未改名。

### F11 ⚪ `UpdateAttractionField` 白名單無法把 `summary` 清空為空字串
- **位置**：`server/internal/api/maintenance.go:470`（`handleMaintenanceAttractionUpdateField`），CLI 端同步限制於 `server/cmd/cli/main.go:435`
- **問題**：`in.Value == ""` 一律視為 `invalid_input` 拒絕，但 `summary` 是合法可更新欄位，使用者若想清空摘要沒有正常管道（僅能手動改 DB）。
- **現況（2026-08-16 複核）**：CONFIRMED，與 F5 屬同類「空字串當哨兵值」問題的另一個實例，可考慮一併處理。
- **現況（2026-10-16 複核）**：仍未修復，行號已更新：`server/internal/api/maintenance.go:426` 仍是 `if in.Field == "" || in.Value == ""` 拒絕；CLI 端 `server/cmd/cli/main.go:732` 仍要求 `-field` 與 `-value` 同時非空（原 :435）；handler 本體在 `maintenance.go:413`（原 :470）。

---

## 已複核為安全/已解決的項目

### 已排除：GORM `Detail` 欄位序列化路徑不一致疑慮
- **原始疑慮**：`InsertEntry` 透過 GORM `serializer:json` struct tag 寫入 `Detail`，`UpdateEntry` 則手動 `json.Marshal` 後以 map 形式 `Updates`，懷疑兩條路徑long-term可能產生不同編碼結果。
- **複核結果（2026-08-16）**：REFUTED。已追查 GORM `schema.JSONSerializer.Value()` 原始碼（`gorm.io/gorm@v1.31.2/schema/serializer.go:104-113`），確認其實作同樣是 `json.Marshal` + `string()` 轉換，與手動路徑位元對位元相同，無編碼落差。此路徑另有回歸測試 `TestEntryUpdateDetail`（`server/internal/store/entries_test.go`）鎖定既有正確行為，不需修復。

### 已排除：`photostorage.Uploader` 零值 client 的 nil pointer 疑慮
- **原始疑慮**：`New("")` 回傳的 `&Uploader{}` 其 `client` 為 `nil`，若未來重構移除或調換 `bucket == ""` 檢查順序，可能造成 `u.client.Bucket(...)` nil pointer dereference。
- **複核結果（2026-08-16）**：目前所有呼叫路徑都先經過 `bucket == ""` 檢查才會碰到 `client`，現況不可觸發，純屬潛在地雷、非現存 bug，暫不需修復，僅記錄提醒未來重構此檔案時留意此隱性耦合。
- **現況（2026-10-16 複核）**：結論仍正確。補充：`Uploader` 內部欄位已由 `client` 改為 `store`（`photostorage.go:96`），`Upload`／`UploadDataURI`／`Delete` 仍先檢查 `u.bucket == ""`（:184、:227、:310）才碰 `u.store`，`New("")` 回傳零值 `&Uploader{}` 的行為不變。

### 已解決（2026-10-22）：F47 `revealedAttractionNames` 變動時，地圖標記整批銷毀重建
- 原問題：`useAttractionOverlays.ts` 的 overlay 建立 effect 在 `filteredAttractions` 參照改變時對全部 overlay `setMap(null)` 再整批重建。
- 修復方式：首頁展示 `InteractiveExploreMap` 改走共用繪製層（`useSharedDrawLayer` 的 `attractionGlow`），`useAttractionOverlays.ts` 已刪除。宿主 `mapDrawLayer/diff.ts` 依景點 key 比對，只新增/移除真正變動的光暈，狀態（選取、候選、hover、隱藏、聚焦、主題照片收起）以 `stateKey` 原地套用。
- 確認方式：複核程式碼（`attractionGlowLayer.ts`、`mapDrawLayer/diff.ts`）與單元測試（`attractionGlowLayer.test.ts`）；尚未在瀏覽器實測大量景點的切換效能。

### 已解決：私有依賴 `github.com/tim72117/want v0.0.2`
- **原始問題**：私有依賴需要 `GH_PAT` 才能拉取，構成單點失效風險，並帶入 `go-rod/rod` 等間接依賴。
- **修復確認**：`server/internal/wanttools/` 對 `want/types` 的引用已改為本地定義（見該套件的 `wanttypes.go`），`want` 已從 `go.mod`/`go.sum` 完全移除。連帶讓 4 支 Dockerfile 的 `GH_PAT` build-arg、5 個 GitHub Actions workflow 的對應設定都不再需要。`internal/wanttools/` 本身沒有被任何 binary import（`go list -deps` 對 `cmd/server`/`cmd/adminserver`/`cmd/cli` 驗證過皆為空），是保留下來的舊 want 對話系統工具實作，未被刪除（`docs/PROJECT_HEALTH_REVIEW.md` 記錄確認日期 2026-08-14）。
- **確認方式**：程式碼複核，`go list -deps` 驗證。

### 已解決：`web/src/App.tsx`（1295 行）技術債
- **原始問題**：單一檔案 1295 行，是前端最大的技術債訊號。
- **修復確認**：`App.tsx` 目前只有 112 行。內容已拆成 `AppCommon`/`DesktopLayout`/`PhoneContent`/`PhoneNavDrawer`/`SettingsScreen` 等元件，且導入 React Router 後只剩路由骨架（`PhoneNavDrawer` 之後已整個移除，功能併入 `PhoneTabBar`/`PhoneSideTools`/`TripManageModal`，見 `docs/terminology.md`；此處記錄的是本次拆分確認當下的狀態。這些元件後來陸續改名：`DesktopLayout` → `desktop/Content.tsx`、`PhoneContent` → `phone/Content.tsx`、`PhoneTabBar` → `phone/Nav.tsx`）。
- **確認方式**：程式碼複核（`docs/PROJECT_HEALTH_REVIEW.md`）。
- **現況（2026-10-16 複核）**：「`App.tsx` 目前只有 112 行」已不準確——`web/src/App.tsx` 現為 423 行（新增 `React.lazy` 各頁面路由、`ErrorBoundary` 與大量說明註解），但 1295 行的單一巨檔問題仍然已解決（元件仍拆在 `AppCommon`/`DesktopLayout`/`PhoneContent` 等檔，現存最大的前端檔案是 `home/plan-ai-sim/AIPlanTimelinePage.tsx` 約 2022 行；2026-10-23 補註：該檔後來改名為 `home/plan-ai-sim/Content.tsx`，並把 `PlanAction`、`usePlanSimSocket`、`useSimulatedStopsView` 等抽出，現約 947 行，上述 `DesktopLayout` 也已改名為 `desktop/Content.tsx`）。

### 已解決：過時架構/API 文件（`docs/API.md`、`docs/ARCHITECTURE.md` 等）
- **原始問題**：`docs/API.md` 認證章節過時、`docs/ARCHITECTURE.md` 自專案第一天後未再更新，兩者連同 `docs/ROADMAP.md`、`server/README.md`、`docs/pace-demo-data-audit.md` 描述的是「iOS + Mock 後端 + 訊息分類 + RAG 向量檢索」的早期構想，與現行架構已非同一系統。
- **處理方式**：修補成本高於重寫，已於 2026-08-03 直接刪除。**目前專案缺少後端 API 規格與整體架構這兩類文件**，待重寫（此為遺留待辦，非本次稽核新項目，暫不單獨編號追蹤，待有人重寫文件時另行處理）。
- **確認方式**：`docs/PROJECT_HEALTH_REVIEW.md` 記錄。

### 已解決：缺少 `CLAUDE.md`
- **原始問題**：專案沒有 `CLAUDE.md`，AI 協作每次都要重新建立上下文。
- **修復確認**：已有 `.claude/CLAUDE.md`（目前內容精簡，僅記載對話語言慣例）。
- **確認方式**：檔案存在確認（`docs/PROJECT_HEALTH_REVIEW.md`）。

### 已解決：`docs/routing-architecture.md` 仍記載已改名的路由（原 F9，文件過時）
- **原始問題**：仍列出 `POST /internal/maintenance/landmarks/{id}/update-photo` → `handleMaintenanceLandmarkUpdatePhoto`，但 commit `3d8d300` 已改名為 `/internal/maintenance/attractions/{id}/update-photo` → `handleMaintenanceAttractionUpdatePhoto`（`CHANGELOG.md`、`tripace-cli` skill 文件都已同步更新，唯獨此文件遺漏）。
- **修復確認**：已對照 `server/internal/api/api.go:274`、`server/internal/api/maintenance.go:111` 驗證現行路由與 handler 名稱，並更新 `docs/routing-architecture.md` 第 109 行為 `POST /internal/maintenance/attractions/{id}/update-photo` → `handleMaintenanceAttractionUpdatePhoto`。全文掃描確認無其餘 `landmark` 舊命名殘留。
- **確認方式**：程式碼複核（`server/internal/api/api.go`、`server/internal/api/maintenance.go`），2026-08-30。
