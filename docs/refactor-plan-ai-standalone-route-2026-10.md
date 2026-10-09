# plan-ai 獨立路由重構（2026-10）

> 狀態：已實作（未 commit 前請以 git diff 為準）。下方「已確認的決策」與「研究階段已查明的關鍵事實」保留作為決策紀錄；「下一步」是實作前的計畫，已不適用。
>
> ## 實作結果（2026-10）
>
> **與原決策的差異:對話小匡保留,與 `/trip-plan` 並存**(使用者確認「兩個要並存」)。原決策表「地圖右上角 AI 小匡也一併移除」作廢。
>
> - 新增 `/trip-plan`：`web/src/trip-plan/TripPlanRoute.tsx`（外殼自己管 `app-theme-root`/捲動，訪客內嵌 `LoginForm`），`App.tsx` 加路由，`static.go` 白名單加 `/trip-plan`。
> - 舊網址 `/app/plan-ai` 轉址到 `/trip-plan`（`App.tsx` 的 `<Navigate>`）。
> - 移除 `/app/plan-ai` 面板本身：`DesktopRail` 的「規劃」按鈕與 `.betaTag`、`PanelMode`/`PANEL_REGISTRY`/`DrawerMode` 的 `plan-ai`、`DesktopLayout` 的全頁版渲染與 `desktopMainRef`、`unbounded`/`unboundedScroll` 的 plan-ai 特例。
> - **保留**：地圖右上角對話小匡（`TripPlanPage compact`）、站點小圓點與雙向同步（`planStops` 等三個 state、`usePlanStopMarkers`）、`TripPlanPage` 的 `compact`/`visible`/選取受控模式等 props 與 CSS、`PlanTimelineView` 的 `jumpPill*` props、`selectedStopSync.test.tsx`。「開啟對話」按鈕仍是開小匡。
> - 手機版（`PhoneContent` 底部「規劃」sheet）完全沒動。
> - 驗證：`tsc --noEmit` 通過；vitest 有 33 個失敗，與未改動的 `m/4` worktree 基準相同（localStorage/jsdom 環境問題）。**尚未做瀏覽器手動驗證**。
> - 待辦:`TripPlanPage` 內提到「`/app/plan-ai` 全頁」的註解已過期（現在全頁版只剩 `/trip-plan` 與手機 sheet）；`planTimelineStorage` 的多實例 `rev` 機制現在要涵蓋小匡 + `/trip-plan` 同時存在（同一分頁內不會，但可能不同分頁），未另外驗證。

## 背景

登入後的「AI 規劃」正式功能目前掛在 `/app/plan-ai`（共用的 `/app/:panelMode?` 動態路由，左側功能列 `DesktopRail` 裡的一個選項，`panelMode === 'plan-ai'` 時在 `DesktopMain` 裡 `main-replace`）。使用者要求把這個功能改成一個**完全獨立的網址路徑**，不再掛在 `/app` 底下、也從左側功能列移除。

## 已確認的決策

| 項目 | 決定 |
|---|---|
| 新路徑 | `/trip-plan`（獨立的 `<Route>`，不是 `/app` 底下的 panelMode）。已排除 `/plan-ai`（舊棄用路徑，之前改名成 `/ai-plan`）、`/plan`、`/ai-planner` |
| 新頁面外殼 | **完全獨立**，仿照 `web/src/home/plan-ai-sim/AIPlanTimelinePage.tsx` 的模式——自己管 header、深色模式（需自己掛 `app-theme-root` + `data-theme`）、捲動容器，**不依賴** `DesktopLayout`/`DesktopMain`/`FloatingPanel` 任何版面機制 |
| 登入模式 | 仿照 `web/src/home/CliAuthPage.tsx`/`DeviceAuthPage.tsx` 的既有模式——訪客可到達這個路徑，頁面內部自己呼叫 `useAppState()` 取得 `cfg`/`isGuest`/`onAuthed`，`isGuest` 時內嵌顯示 `LoginForm`，登入後才顯示 `TripPlanPage` 本體（**不是**「未登入就擋下來/導轉」這種新模式） |
| DesktopRail 左側功能列 | 移除 `plan-ai` 這顆按鈕（約 144-162 行） |
| 地圖右上角 AI 小匡（`chatPopoverOpen`） | **也一併移除**——這代表 `DesktopLayout.tsx` 裡小匡版 `TripPlanPage`（約 1033-1051 行）、以及跟地圖雙向同步規劃站點的整套機制（`planStops`/`selectedPlanStopId`/`hoverPlanStopId` 三個 state、傳給 `ExploreMap` 的對應 props、約 134-169 行的三個回調）都要清除 |
| 手機版 | **完全不動**。`PhoneContent.tsx` 底部列「規劃」按鈕開關 `chatSheetOpen` bottom sheet 呼出 `TripPlanPage` 的既有機制維持原樣 |
| `PanelMode`/`PANEL_REGISTRY` | `plan-ai` 成員整個移除 |

## 研究階段已查明的關鍵事實（不用重查）

### 路由與面板系統現況
- `App.tsx` 的 `/app/:panelMode?` 整條只渲染 `<KeyboardShrinkGuard><PhoneContent {...props} /></KeyboardShrinkGuard>`，真正解析 `panelMode` 的地方是 `DesktopLayout.tsx:118-120`（`useParams` + `isPanelMode()` 白名單）
- `DesktopShared.tsx:26-29` `PanelMode` type：`'trips' | 'timeline' | 'pace' | 'geo-outline' | 'plan-ai' | 'demo-route-editor' | 'demo-chat' | null`
- `PANEL_REGISTRY`（`DesktopShared.tsx:105-116`）的 `plan-ai` 項：`{ enabled: true, slot: 'main-replace' }`
- `DrawerMode`（`DesktopShared.tsx:148`）已經排除 `plan-ai`，但排除理由註解已過期（提到「手機版還沒設計」，實際上手機版已經用 bottom sheet 機制接上了，只是不走 panelMode）——這份過期註解不影響這次重構，但重構時可順手更新

### DesktopLayout.tsx 裡 TripPlanPage 的兩處渲染
- **全頁版**（約 673 行）：`<TripPlanPage cfg={cfg} scrollContainerRef={desktopMainRef} />`
- **小匡版**（約 1033-1051 行）：`<TripPlanPage cfg={cfg} compact visible={chatPopoverVisible} onPanToStop={...} onStopsChange={setPlanStops} selectedStopId={selectedPlanStopId} onSelectedStopChange={setSelectedPlanStopId} onHoverStopChange={setHoverPlanStopId} />`
- `selectedPlanStopId` 是雙向受控的唯一事實來源（地圖點圓點、時間軸點卡片寫同一個 state）
- `desktopMainRef`（約 541-556 行）：只給全頁版用，解決 `TripPlanPage` 內部「捲到底」機制抓錯捲動容器的真實 bug（小匡版用自己的 `scrollRef`）
- 版面耦合：`DesktopLayout.tsx:642` 的 `<DesktopMain unbounded={panelSpec?.slot !== 'main-replace' || panelMode === 'plan-ai'} unboundedScroll={panelMode === 'plan-ai'}>`——`plan-ai` 是 `main-replace` 裡唯一額外加回 `unbounded`/`unboundedScroll` 的特例
- `ExploreMap.tsx:818-824` 有一段記錄「桌面版從 `/app/plan-ai` 切回 `/app` 時地圖不顯示」的真實 bug 修復說明，邏輯綁 `panelMode === 'plan-ai'`——若小匡/全頁版都移除，這段邏輯與註解需要一併檢視是否還需要

### TripPlanPage.tsx 本身需要確認的點（尚未深入讀）
- `compact`/`visible`/`onPanToStop`/`onStopsChange`/`selectedStopId`/`onSelectedStopChange`/`onHoverStopChange` 這些 props，在小匡版整個移除後會變成死碼——需要評估是否清理，以及手機版呼叫端（`PhoneContent.tsx` 只傳 `cfg`）是否受影響
- `TripPlanPage.tsx:997-1004` 註解提到「`app-theme-root` 刻意不掛載，因為 `/app` 路由外層已經掛了」——新的獨立路由不在 `/app` 底下，這個假設會失效，需要讓新外殼自己補掛，而不是改 `TripPlanPage.tsx` 本身（手機版呼叫端仍在 `/app` 底下、仍依賴這個假設）

### 共用時間軸資料（需評估，可能不受影響）
- `src/plan-core/planTimelineStorage.ts` 的 `rev` 欄位機制，防止多份 `TripPlanPage` 實例同時掛載時互相覆寫 localStorage。手機版 bottom sheet 版與新獨立路由版很可能同時掛載存在（使用者手機開著底部規劃 sheet，同時另一分頁開 `/trip-plan`）——需要確認這個機制在新架構下是否還正確運作

### DesktopRail.tsx 的 plan-ai 按鈕（約 144-162 行，要整個移除）
```tsx
<button
  className={panelMode === 'plan-ai' ? `${styles.btn} ${styles.active}` : styles.btn}
  onClick={() => onSelect('plan-ai')}
  title="規劃(Beta)"
>
  <Sparkles size={20} strokeWidth={1.8} />
  {expanded && <span className={styles.btnLabel}>規劃</span>}
  <span className={styles.betaTag}>BETA</span>
</button>
```

### 可參考的既有先例
- `web/src/home/plan-ai-sim/AIPlanTimelinePage.tsx`：完全自管外殼的獨立頁面寫法（自己 import `SiteNavBrand`/`SiteNavCta`/`SiteNavThemeToggle`、自己掛 `app-theme-root` + `data-theme`）——但那是**訪客頁面**的日夜切換（純前端、不寫 localStorage），新頁面是**登入後功能**，日夜模式應該沿用登入後 App 本身的機制，只借鏡「自己管外殼」這個架構模式，不要照抄訪客版的主題切換邏輯
- `web/src/home/CliAuthPage.tsx`、`web/src/home/DeviceAuthPage.tsx`：`isGuest` 時內嵌 `<LoginForm baseURL={cfg.baseURL} onAuthed={onAuthed} pill />` 的既有模式，新頁面要仿照同樣的「`useAppState()` 自取 cfg + isGuest 判斷」寫法

### 需要同步修改的檔案清單（尚未逐一確認行號，下一步要做）
1. **新增**：新的獨立路由頁面元件（檔案路徑待定，可能是 `web/src/trip-plan/TripPlanRoute.tsx` 或類似命名）
2. `App.tsx`：新增 `<Route path="/trip-plan" element={...} />`
3. `DesktopRail.tsx`：移除 plan-ai 按鈕（約 144-162 行）
4. `DesktopShared.tsx`：`PanelMode`/`PANEL_REGISTRY`/`DrawerMode` 移除 `plan-ai` 成員
5. `DesktopLayout.tsx`：移除全頁版渲染（約 673 行）、小匡版渲染（約 1033-1051 行）、三個回調與對應 state（約 134-169 行）、`desktopMainRef` 若只給 plan-ai 用則評估是否也移除、`unbounded`/`unboundedScroll` 的 `panelMode === 'plan-ai'` 特例、`chatPopoverVisible` 排除 `main-replace` 的邏輯是否還需要
6. `ExploreMap.tsx`：移除傳給它的 `planStops`/`selectedPlanStopId`/`hoverPlanStopId` 相關 props 與畫小圓點的邏輯、清理約 818-824 行的過期 bug 註解
7. `TripPlanPage.tsx`：評估 `compact`/`visible`/`onPanToStop`/`onStopsChange`/`selectedStopId`/`onSelectedStopChange`/`onHoverStopChange` 是否變死碼並清理；確認 `app-theme-root` 假設的處理方式
8. `server/cmd/server/static.go`：`knownRoutePatterns` 新增 `/trip-plan`（**容易忘記的一步，過去真實踩過正式環境 404 的坑**）
9. 文字/註解同步（非邏輯）：`planTimelineStorage.ts:46`、`planTimelineStorage.rev.test.ts:9`、`selectedStopSync.test.tsx:120` 的 `/app/plan-ai` 字樣

### 明確排除、不要動的地方
- 後端 `/internal/geo/plan-ai/*` API 端點——完全不同的東西，只是同名詞根，不要混淆或誤改
- `web/src/home/plan-ai-sim/` 整個目錄（展示原型 `/ai-plan`），保持原樣
- `PhoneContent.tsx`/`PhoneTabBar.tsx` 手機版相關程式碼

## 下一步

1. 派 Plan agent（或自行）產出逐檔案、逐行號的詳細實作計畫（這份文件已完成到「決策確認」階段，尚未到「可直接執行的計畫」階段）
2. 讀完整 `TripPlanPage.tsx`、`DesktopLayout.tsx`、`ExploreMap.tsx` 的相關區塊確認精確行號（之前只讀過摘要）
3. 決定執行順序：建議先讓新路由能獨立跑起來（新增，不刪舊的），驗證過後再移除舊的 `DesktopRail`/`DesktopLayout`/`ExploreMap` 相關程式碼，避免中間狀態完全不可用
4. 驗證方式：`tsc -b --noEmit`、相關既有測試（`selectedStopSync.test.tsx`、`sheetStack` 相關）、手動測試新路徑的登入/訪客兩種狀態、手機版回歸測試（確認完全不受影響）、`server/cmd/server/static.go` 白名單是否正確（避免正式環境 404）

## 本次 session 其他已完成的改動（與此重構無關，已在同一分支）

- `web/src/geo-planning/ExploreMap.tsx`、`ExploreMap.module.css`：規劃地圖「開啟對話」按鈕加上 BETA 標籤（`.citySearchAiBtnBetaTag`，仿照 `DesktopRail.module.css` 的 `.betaTag` 既有先例）。`tsc -b --noEmit` 已驗證通過。
