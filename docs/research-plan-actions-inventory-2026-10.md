# 規劃狀態「所有動作」現況盤點(2026-10-25)

> 一次性研究筆記(`research-*`,帶日期,定案後不回頭改)。若決定執行統一,另開 `refactor-*` 承接。
> 行號以 2026-10-25 工作樹(含未提交改動)當下讀到的為準;同時有其他代理在改 `planning/conversation`(AskShell 等)、`planning/member`、`planning/place`,這些檔案的行號可能已漂移。**本文件只讀程式、不改程式。**

## 0. 目的與範圍

**目的**:作為下一步設計的依據——「每個呼叫對象一層同名 adapter,指令(往狀態走)與回應(從狀態回來)兩個方向都走同一層」。時間軸操作已統一命名並由 `PlanOperations` 約束(`timeline/operations.ts`),本文件把範圍擴大到 `web/src/planning` 內**所有會改變規劃狀態的動作**,盤點目前的名稱、定義位置、呼叫者、回傳與副作用,以及回應方向的各種傳遞方式。

**範圍**:時間軸、選取與 hover、對話、詢問頁、景點池/畫面狀態、鏡頭、目前位置、探索、草稿與交接、AI 連線與停止。`place/` 的資訊卡內部互動、`map/draw` 圖層內部渲染只在與上述動作接線時提及。

**呼叫對象代號**:
- **LLM**:onagent 工具(`conversation/tools.ts`、`conversation/asktools.ts`,經 `conversation/context.ts` 與 `usePlanAiChatBridge`)
- **模擬**:/ai-plan 播放態劇本(`preview/usePlanSimSocket.ts` 消費 `PlanSimSource` 的 `PlanAction`)
- **畫面-直**:縱向時間軸 `timeline/PlanTimelineView.tsx`(桌面)
- **畫面-橫**:橫向時間軸 `timeline/phone/HorizontalPlanTimeline.tsx`(手機)
- **畫面-問**:詢問頁 `conversation/AskPage.tsx` / `ScriptedAskPage.tsx`
- **畫面-其他**:Composer、新行程按鈕、SimComposer、側欄等
- **地圖**:`map/PlanMap.tsx`、`preview/PlanMap.tsx`、`map/phone/PlanPhoneView.tsx` 及其圖層

**檔案代稱**:`TPP` = `panel/TripPlanPage.tsx`;`core` = `timeline/usePlanTimelineCore.ts`;`sim` = `preview/usePlanSimSocket.ts`;`pvC` = `preview/Content.tsx`;`mdC` = `member/desktop/Content.tsx`;`mpC` = `member/phone/Content.tsx`;`PPV` = `map/phone/PlanPhoneView.tsx`;`PTV` = `timeline/PlanTimelineView.tsx`;`HPT` = `timeline/phone/HorizontalPlanTimeline.tsx`;`ctx` = `conversation/context.ts`。

---

## 1. 動作清單

### 1.1 時間軸(Stop / Day / Lodging)——已有 `PlanOperations` 約束

實作全部在 `core`;`PlanOperations` 介面在 `timeline/operations.ts:31-47`。

| 動作 | 定義 | 簽章摘要 | 呼叫者 | 回傳 | 副作用 |
|---|---|---|---|---|---|
| `addStop` | core:306 | `(anchorId\|null, newId, data) => InsertAfterResult` | LLM:`tools.ts:474` → `ctx:90-97`(ctx 內產生 newId)→ `TPP:345`;模擬:`sim:275`(骨架卡)、`sim:378` | 結構化結果;存檔失敗回 `save_failed` | 存檔(有 store);成功後 `followUpStop` 背景查地點/交通;觸發 `onStopInserted` |
| `removeStop` | core:427 | `(id) => boolean` | LLM:`tools.ts:590` → `ctx:106-117` → `TPP:349`;模擬:`sim:316`;畫面-直 `TPP:1590`;畫面-橫 `TPP:1537` | true=觸發移除 | 兩階段:標 removing → `setTimeout(320ms)` 摘除 → 存檔 → 重算下一站交通;`onBeforeMutate` ×2 |
| `setStopTime` | core:461 | `(stopId, HH:MM) => boolean` | 畫面-直 `TPP:1609`、`preview/SimPlanLayer.tsx:129`(皆受 `TIME_DRAG_ENABLED`) | 是否寫入 | 存檔;重算交通;`onBeforeMutate` |
| `setStopNote` | core:369 | `(anchorId, text, category) => InsertAfterResult` | LLM:`tools.ts:552` → `ctx:98-104` → `TPP:346` → `addNoteToTimeline`(TPP:961,補預設分類);模擬:`sim:336` | 結構化結果 | 存檔 |
| `retryStop` | core:330 | `(stopId) => void` | 畫面-直 `TPP:1593`、`SimPlanLayer:108`;畫面-橫 `TPP:1523`、`SimPlanLayer:183`;core 掛載自動重試 core:358-365 | 無 | 查地點 API(含 429 延遲重試)→ 重算交通 |
| `addDay` | core:482 | `(atDay?) => AddDayResult` | 僅 LLM:`tools.ts:670` → `ctx:118` → `TPP:350` | `{ok, day, dayCount}` | 存檔 |
| `moveDay` | core:495 | `(from, to) => MoveDayWithCountResult` | 僅 LLM:`tools.ts:699` → `ctx:126` → `TPP:351` | 含 dayCount | 存檔 |
| `setLodging` | core:510 | `(SetLodgingArgs) => SetLodgingByDaysResult` | 僅 LLM:`tools.ts:744` → `ctx:133` → `TPP:352` | 含 lodgingId/created/removed | 存檔 |
| `removeLodging` | core:522 | `(lodgingId) => LodgingResult` | 僅 LLM:`tools.ts:766` → `ctx:140` → `TPP:353` | 結構化結果 | 存檔 |
| 讀取 `getTimeline`(list_itinerary) | `ctx:85-89` | `() => PlanTimeline` | LLM:`tools.ts:627` | 時間軸 | 記下讀取簽名(新鮮度把關) |

**不在 `PlanOperations`、但同樣改變時間軸的動作**:

| 動作 | 定義 | 呼叫者 | 備註 |
|---|---|---|---|
| 換交通方式(`onSetStopTransitMode`) | **TPP:1538-1542 與 TPP:1625-1629 兩份相同的 inline 箭頭**,呼叫 `refreshTransitForStop({..., forceMode})` | 畫面-直、畫面-橫(受 `TRANSIT_MODE_SELECT_ENABLED`) | 沒傳 `isCancelled`(其他 refresh 呼叫都有傳 `isUnmounted`);`operations.ts:11-12` 已註明待納入 |
| `clearTimeline` | core:409 | `pvC:385`(交接 `handover`) | 與 `timeline/storage.ts:410` 的同名函式(清 localStorage,**無任何呼叫者**)撞名 |
| 劇本 `reset` | `sim:299-302`:`setTimeline(createEmptyTimeline())` + `clearConversation()` | 模擬 | 與 `clearTimeline` 重複語意,但走 `setTimeline` |
| 劇本 `reset_day` | `sim:308-311`:`setTimeline(prev => removeDay(prev, day))` | 模擬 | 直接用領域函式 `removeDay`,沒有對應操作名 |
| 骨架卡轉正式站 | `sim:351-366`:`setTimeline(updateNode)` + `staleAll()` + `followUpStop()` | 模擬 | 繞過 `addStop`,手動補做 `onStopInserted` 會做的事 |
| 骨架卡標 loading | `sim:280`:`setStatus(id, {loading:true})` | 模擬 | 直接寫節點狀態表 |
| `start` 切換清空 | `sim:195-201`:`setTimeline(createEmptyTimeline())` | 模擬(effect) | |
| `resyncFromStorage` | core:195 | `TPP:1302-1304`(`visible` 轉 true 的 effect) | 讀磁碟,不算寫入 |
| `followUpStop` / `setStatus` / `setTimeline` / `commitTimeline` / `removeStopNow` | core 回傳(core:535-557) | 見上 | core 專屬低階入口 |

### 1.2 選取與 hover

| 動作 | 定義 | 簽章 | 呼叫者 | 回傳/副作用 |
|---|---|---|---|---|
| `setSelectedStopId` | `timeline/usePlanStopsState.ts:20-24`(`usePlanSelection`,useState setter) | `(id\|null)` | 地圖:`mdC:821`、`mpC:447`(→ `PPV:580`)、`pvC:694`(`onStopClick`);模擬播放態卡片:`pvC:583`(經 `useStopCardClick`)、`SimPlanLayer:188-191, 202-204`;`useSimulatedStopsView.ts:115`(劇本插入新站自動選取) | 無 |
| `selectStop` | TPP:1222-1225(受控/非受控雙模式寫入口,`useStableCallback`) | `(id\|null)` | 畫面-橫 `TPP:1536`(`onSelectStop`);畫面-直經 `useStopCardClick`(TPP:1319) | 呼叫 `onSelectedStopChange` |
| `onSelectedStopChange` | TPP prop:722 | `(id\|null)` | 由 `selectStop` 觸發;接到 `tripPlanProps.onSelectedStopChange = setSelectedStopId`(usePlanStopsState.ts:55) | — |
| `onSelectStop` | HPT prop:78 | `(stopId)` | HPT 內部:點卡片 694、捲動置中偵測 814 | 選到空天時收到 `day.id`、旅館收到旅館 id(HPT:510-515) |
| `onSelectThemeChild` | HPT prop:86 | `(parentId, child)` | 只有 `SimPlanLayer:202` 接(選父站);TPP 橫向分支沒接 | |
| `setHoverStopId` | usePlanStopsState.ts:22 | `(id\|null)` | 畫面-直 `SimPlanLayer:119`(`onHoverStop`);`SimPlanLayer:190`(橫向選取時一併 hover);`useSimulatedStopsView.ts:116` | 無 |
| `onHoverStopChange` | TPP prop:732 | `(id\|null)` | 直接轉給 PTV `onHoverStop`(TPP:1610);接 `tripPlanProps.onHoverStopChange = setHoverStopId` | 面板 `display:none` 時收不到 mouseleave → 靠 `maskPlanStopsView` 遮蔽 |
| `onHoverTransitChange` | TPP prop:737 | `({fromId,toId}\|null)` | PTV `onHoverTransit`(TPP:1611) → `setHoverTransitPair`(usePlanStopsState.ts:48, 57) | |
| `maskPlanStopsView` | usePlanStopsState.ts:82 | `(view, visible) => view` | `mdC:544`、`mpC:378`、`pvC:455` | 純函式,面板關閉時遮蔽 |
| 主題點展開 `expandedThemeId` | 由地圖繪製層算出(`preview/PlanMap.tsx:70`),經 `onExpandedThemeIdChange`(prop:42,effect 84-87)回報 → `pvC:460` 的 `setExpandedThemeId` | `(id\|null)` | 地圖 → pvC | 只 /ai-plan 有;供 `usePhoneStopPan` 找子景點座標 |
| geo 選取(地點/搜尋結果/候選籃) | `member/usePlanningState.ts`:`dispatchGeoSelection` 62、`selectAttraction` 251、`selectSearchResult` 254、`selectPlaceContent` 269、`selectPoi` 280、`selectCandidateFromBasket` 412、`clearSelection` 426、`setHoverKey` 76 | | 地圖、側欄、資訊卡(登入後) | 與站點選取是**兩套獨立的選取系統**(`GeoSelectedKey` vs `selectedStopId`) |

### 1.3 對話(訊息)

`conversation/usePlanConversation.ts`,純記憶體。

| 動作 | 定義 | 簽章 | 呼叫者 | 副作用 |
|---|---|---|---|---|
| `appendMessage` | :38 | `(PlanMessage)` | LLM 回呼:`TPP:458`(onAssistantMessage)、`TPP:486`(onError);AI 連線:`TPP:564`(sendPrompt 失敗);模擬:`sim:323`(`add_message`) | 無;id 格式不一(`agent-msg-<uuid>` vs `msg-<n>`) |
| `staleAll` | :41 | `()` | core `onStopInserted`(`TPP:932`、`sim:168`);模擬手動 `sim:357` | 無 |
| `clearConversation` | :44 | `()` | 模擬:`sim:301`(reset);交接:`pvC:387` | 無 |
| 草稿切換清空 | 隱性:`preview/LivePlanLayer.tsx:122,147` 以 key 重新掛載 TPP | — | 新行程 | 整個實例重建 |

### 1.4 詢問頁

狀態機 `conversation/useAskPageBridge.ts`(兩個實例:`TPP:993` 與 `pvC:238`),串接流程 `panel/useAskPageFlow.ts`(只有 TPP 用)。

| 動作 | 定義 | 簽章 | 呼叫者 | 回傳/副作用 |
|---|---|---|---|---|
| `openAskPage` | useAskPageBridge.ts:120 | `(input) => Promise<AskPageSelection[]>`;已有 pending 時直接 resolve `[]`(忽略) | LLM:`asktools.ts` `open_ask_page`(443/447)→ `TPP:394`;`ask_travel_country/city/transport_mode` → `TPP:395-411` 三個 wrapper(fire-and-forget,回 null);AI 純文字回覆 `TPP:459`(`{text}`);`initialAskPage` effect `TPP:1126-1131`(stopCount 歸零就再開);流程 `useAskPageFlow:160, 250`;模擬:`planSimFakeSource.ts:109`(經 `pvC:287` 注入,**會 await**) | Promise 等使用者完成 |
| `handleAskPageDone`(底層,TPP 改名 `resolveAskPage`) | useAskPageBridge.ts:129 | `(selected)` | `sendPrompt` 開頭 `TPP:535`、`stopPrompt` `TPP:580`、`useAskPageFlow` 內多處(108, 198, 232, 273);模擬播放態:`ScriptedAskPage onDone`(`pvC:327`)、`SimPlanLayer:776`→HPT | resolve pending、關閉 |
| `replaceAskPage` | :136 | `(input) => boolean` | `useAskPageFlow:201, 248` | 只換內容不換 pending |
| `advanceAskPage` | :142 | `(selected, input) => Promise` | `useAskPageFlow:207, 235` | resolve 舊的、開新的 |
| `pendingId` | :150 | `() => number\|null` | `useAskPageFlow` | 讀 |
| `handleAskPageDone`(流程,與底層**同名**) | useAskPageFlow.ts:101 | `(selected)` | 畫面-問:`TPP:1562`(AskPage `onDone`);畫面-橫:`TPP:1518`(`onAskPageDone`) | 寫 `userSelectionRef`(:124);選完景點自動 `sendPrompt`(:152);國家→城市(:160);城市→查景點(`fetchPlanAiAttractionSearch`,TPP:1179-1184)+ 計時器(:204-213,150ms/300ms) |
| `handleAskPageBack` | useAskPageFlow.ts:245 | `(countryIds?)` | `TPP:1519, 1563` | |
| `handleAskPageDescribe` | useAskPageFlow.ts:269 | `(text)` | `TPP:1520, 1564` | 推論中先排隊,`isThinking` 轉 false 時 effect(:282-288)送出;送不出 → `onDescribeNotSent`(TPP:1188 放回輸入框) |
| 畫面狀態同步(uiStateStore) | `TPP:1020-1073` effect 盯 `showAskPage/askPageInput` | — | 自動 | 寫 module 單例 `uiStateStore.set/reset` |
| 使用者選擇記錄 | `userSelectionRef`(TPP:1137) | — | 寫:`useAskPageFlow:124`;讀:LLM `get_user_selection`(TPP:415) | ref 共享 |

### 1.5 景點池與畫面狀態(LLM 的工作記憶)

| 動作 | 定義 | 呼叫者 | 備註 |
|---|---|---|---|
| `attractionPool.put` | `conversation/attractionPoolStore.ts:56` | LLM:`search_attraction` 的 `onPlacesFound`(`tools.ts:306`)→ `TPP:438` | 實例:`TPP:1142`(useMemo,跟 TPP 生命週期) |
| `attractionPool.list` | :63 | LLM:`get_attraction_pool` → `TPP:416` | |
| `attractionPool.get` / `.clear` | :67 / :70 | **無呼叫者**(除測試) | 交接/新對話時並沒有清,靠重新掛載 |
| `uiStateStore.set` / `.reset` | `conversation/uiStateStore.ts:83 / :93` | `TPP:1022-1072` | **module 單例**,不是每個 TPP 實例一份 |
| `uiStateStore.setSelected` | :89 | **無呼叫者** | 註解說「逐張勾選時用」,實際沒接 |
| `uiStateStore.get` | :96 | LLM:`get_ui_state` → `TPP:420` | |
| `uiStateStore.clear` | :101 | 測試專用 | |

### 1.6 鏡頭(平移)

| 動作 | 定義 | 簽章 | 呼叫者 | 備註 |
|---|---|---|---|---|
| `useStopCardClick` | `map/useStopPan.ts:63` | 回傳 `(step:{id,lat?,lng?}) => void` = select + pan | TPP:1319(→ PTV `onPanToStop`,TPP:1578);`pvC:583`(→ `SimPlanLayer` PTV) | 沒座標不做任何事 |
| `usePhoneStopPan().panToStop` | useStopPan.ts:23 | `(stopId)` | `pvC:504` → `SimPlanLayer:216` → HPT「移動到此」按鈕 | 只 /ai-plan 播放態手機(`enabled: !isDesktop && !handedOver`) |
| `useDesktopStopPan().panToStop` | useStopPan.ts:49 | `({lat,lng})` | `pvC:579`(→ `useStopCardClick` 與交接後 `LivePlanLayer onPanToStop`,pvC:744);`mdC:177`(→ `geo.setPanTarget`,mdC:975) | 名為 panToStop,實際收座標 |
| `useFirstStopAutoPan` | `map/useFirstStopAutoPan.ts:16` | effect,一次性 | `pvC:492, 498`(模擬/推論各一);`PPV:270` | 不是指令,是政策 |
| `usePanWithFirstStopPriority` | useFirstStopAutoPan.ts:41 | 回 `{panToFirstStop, panToLocation}` | `PPV:269` | 首站優先於定位 |
| `geo.setPanTarget` | `member/usePlanningState.ts:70` | `({lat,lng,nonce})` 宣告式 | `mdC:174`、`PPV:265`、`selectCandidateFromBasket`(:420) | 經 `useMapState` 轉 `panRequest`(useMapState.ts:85)→ 地圖 `panTarget` prop |
| `mapSafeArea.panToWithinSafeArea` | `map/useMapSafeArea.ts` | `({lat,lng})` 命令式 | pvC 各處 | /ai-plan 專用 |
| TPP prop `onPanToStop` | TPP:659 | `({lat,lng})` | 由 LivePlanLayer 注入 | 第三種同名簽章(見 §3) |

### 1.7 目前位置

| 動作 | 定義 | 呼叫者 | 備註 |
|---|---|---|---|
| `useCurrentLocation`(/ai-plan) | `preview/useCurrentLocation.ts:29` | `pvC:450`(`wanted: handedOver`,不傳 onLocated) | 只查已授權,不跳提示 |
| `useCurrentLocation`(登入後桌面) | `member/desktop/useCurrentLocation.ts:7` | `mdC:447`(不平移) | |
| `useCurrentLocation`(登入後手機) | `member/phone/useCurrentLocation.ts:7` | `PPV:503`(`onLocated: panToLocation`) | 與桌面版**逐字相同** |
| `request()` | `shared/currentLocation.ts:89` 回傳 | **無呼叫者** | 「主動定位」動作尚未接任何 UI |
| `locationWanted` | `member/useMapState.ts:97` | 登入後兩入口 | 旅程無座標時才要 |

### 1.8 探索(地圖查詢、候選籃)

| 動作 | 定義 | 呼叫者 | 副作用 |
|---|---|---|---|
| `handleCategoryClick` | `explore/useExploreQueries.ts:132` | 地圖控制項(`map/PlanMap.tsx:268` 取用);`exploreTrigger` 遞增計數器 effect(:160-163) | 查附近景點/地點 API |
| `handleSearchThisArea` | :167 | 「搜尋這個區域」按鈕 | 查詢 |
| `handleMapIdle` / `suppressNextIdle` | :54 / :62 | 地圖 idle 事件 | 狀態 |
| `useAttractionGlow` | `explore/useAttractionGlow.tsx:39` | /ai-plan 地圖 | 第二個 useExploreQueries 實例 |
| `addCandidate` / `removeCandidate` | `member/usePlanningState.ts:91 / :109` | 側欄、資訊卡 | 記憶體 |
| `handleRemoveCandidate` | :164 | 同上 | `deleteEntry` API |
| `handleScheduleCandidate` | :179 | 日期選單 | `createEntryFromCandidate` API + `refetchTripEntriesTrigger` 遞增 |
| 搜尋 / 旅程 entry | `member/useMapState.ts:41`(`searchTrigger`、`refetchTripEntriesTrigger`) | 登入後兩入口 | API |

註:探索/候選籃屬於 `member/`、`place/`、`explore/`,目前**與規劃時間軸沒有共用動作**(LLM 也碰不到),觸發方式大量使用「遞增計數器 prop」(`exploreTrigger`、`searchTrigger`、`tripListDrawerTrigger`、`refetchTripEntriesTrigger`)。

### 1.9 草稿與交接

| 動作 | 定義 | 呼叫者 | 副作用 |
|---|---|---|---|
| `startNewDraft` | `timeline/drafts.ts:133` | `preview/LivePlanLayer.tsx:109-113`(`handleNewDraft`) | 寫 localStorage 草稿索引;回傳新 id |
| `createDraftPlanTimelineStore` | drafts.ts:159 | `preview/LivePlanLayer.tsx:97-100` | |
| 切換 = 重新掛載 | `mountKey`(LivePlanLayer.tsx:122)當 `key`(:147) | 隱性 | 時間軸、對話、景點池、詢問頁、AI 連線全部重建 |
| 「新行程」按鈕 | TPP prop `onNewDraft`(:834),按鈕 TPP:1660-1673 | 畫面-其他(只在 horizontalTimeline,受 `NEW_TRIP_DRAFT_ENABLED`) | |
| `handover`(模擬→推論交接) | `pvC:384-389`:`clearTimeline()` + `clearConversation()` + `setHandedOver(true)` | `SimComposer`(pvC:760)、`?skipDemo=1` effect(pvC:400-406) | 換掉整個 selection 實例(`view = handedOver ? live : simulated`,pvC:372) |

### 1.10 AI 連線與停止

全部在 `usePlanAiChatBridge`(TPP:183-594,檔內私有函式)。

| 動作 | 定義 | 簽章 | 呼叫者 | 副作用 |
|---|---|---|---|---|
| 建立連線 | TPP:327-506 effect(依賴 `[apiKey, cfg, bridgeEpoch]`) | — | 掛載、cfg 換、停止後 | `new AgentBridge`(SSE);500ms 計時器樂觀 ready;guard 世代 |
| `sendPrompt` | TPP:529 | `(text) => Promise<boolean>` | Composer `onSubmit`(TPP:1716-1728);`useAskPageFlow`(:152 選完景點、submitAskPageText:詢問頁開著時輸入匡送出,2026-10 取代「我要直接說明」);`onSendPromptReady`(TPP:1164-1169,**無呼叫端傳入**) | `resolveAskPage([])`;`postPlanAiChat`(HTTP,後端存檔/限流);`bridge.prompt` |
| `stopPrompt` | TPP:572 | `()` | Composer `onStop`(TPP:1715) | guard expire、`resetBridgeTurnState`、`resolveAskPage([])`、`bridgeEpoch+1` 觸發重連 |
| `resetBridgeTurnState` | TPP:171(export) | | stopPrompt、effect cleanup | |
| 回覆存檔 | TPP:471-476 | | onAssistantMessage | `postPlanAiChatReply`(fire-and-forget) |
| 狀態輸出 | `status`、`isThinking`、`apiKeyMissing`、`urlMissing`(TPP:584-593) | | Composer、PTV `isThinking`、HPT `isGenerating`、useAskPageFlow | |
| 模擬對應 | `sim` 的 `start` 參數(`pvC:351`)、`isGenerating`(sim:173) | | | 模擬沒有 stop |

---

## 2. 回應方向現況

「回應」= 狀態變化或結果從擁有者回到呼叫者/其他消費者。目前至少有九種傳遞方式並存:

| # | 方式 | 定義處 | 使用處 | 資料形狀 | 觸發時機 |
|---|---|---|---|---|---|
| R1 | **同步回傳值** | core 各操作(§1.1) | ctx 轉成 `{ok,id}`/throw(ctx:90-146)→ 工具 return(tools.ts)→ onagent;視圖丟棄(PTV prop 宣告成 void,PTV:259, 271, 287) | `InsertAfterResult`、`boolean`、`AddDayResult` 等 | 呼叫當下 |
| R2 | **工具回傳(對 LLM)** | tools.ts / asktools.ts handler | AgentBridge | JSON 或中文字串;詢問類固定回 `askPageOpenedResult` | 工具結束 |
| R3 | **core 選項回呼** | `onStopInserted`(core:109)、`onBeforeMutate`(core:113) | `staleAll`(TPP:932、sim:168);`suppressNextAutoScrollRef`(TPP:929) | `(id, data)` / `()` | 同步,commit 後 |
| R4 | **useEffect 回報資料** | TPP:1276-1279 `onStopsChange`;TPP:1283-1286 `onRouteSegmentsChange`;TPP:1167-1169 `onSendPromptReady`;`preview/PlanMap.tsx:84-87` `onExpandedThemeIdChange`;`HPT:1010` `onHeightChange` | `useReportedStops` 的 setState(usePlanStopsState.ts:53-54);pvC:460 | `PlanStopMarker[]`、`RouteSegment[]`、函式參照、id | render 之後 |
| R5 | **事件回呼(直接轉發)** | `onSelectedStopChange`(TPP:722,由 selectStop 觸發)、`onHoverStopChange`(732)、`onHoverTransitChange`(737)、`onStopClick`(地圖)、`onSelectStop`(HPT) | `tripPlanProps`(usePlanStopsState.ts:51-60)→ `setSelectedStopId/setHoverStopId/setHoverTransitPair` | `id\|null`、`{fromId,toId}\|null` | 使用者事件當下 |
| R6 | **打包 props 傳遞** | `tripPlanProps`(usePlanStopsState.ts:51)、`PlanPanelStopsBinding`(:93)、`LivePlanLayerContract`(`shared/layerContracts.ts:48`) | 三個 LivePlanLayer spread 進 PlanPanelContent → TPP | 5 個回呼 + 受控 `selectedStopId` | — |
| R7 | **AgentBridge 回呼** | `onAssistantMessage`(TPP:455)、`onError`(TPP:478),皆 `guardCallback` | `appendMessage` + `openAskPage({text})` + `postPlanAiChatReply` | `string` / `{message}` | SSE 事件 |
| R8 | **Promise resolve** | `openAskPage` 回傳(useAskPageBridge.ts:120);`useAskPageFlow` 的 `sendPrompt().then` | 模擬 `planSimFakeSource.ts:109` await;LLM 端多半 `void` 不等;`onDescribeNotSent` | `AskPageSelection[]`、`boolean` | 使用者完成/送出結束 |
| R9 | **共享可變物件(ref / module 單例)** | `userSelectionRef`(TPP:1137)、`attractionPool`(TPP:1142)、`uiStateStore`(module)、`latestInsertedStopIdRef`(sim:187)、`timelineRef` | LLM 讀(TPP:415-420);`useSimulatedStopsView.ts:106-117` effect 讀 ref 自動選取 | 各種 | 讀的人自己來拿 |
| R10 | **狀態值 props(下行)** | `isThinking`/`isGenerating`、`nodeStatus`、`messages`、`showAskPage`/`askPageInput`、`currentPosition`、`panTarget` | 視圖與地圖 | — | render |
| R11 | **遞增計數器 prop(指令偽裝成狀態)** | `exploreTrigger`、`searchTrigger`、`tripListDrawerTrigger`、`refetchTripEntriesTrigger`、`panTarget.nonce` | 地圖、PPV | number | effect 偵測變化 |
| R12 | **入口外接訊息源訂閱** | `PlanSimSource.onMessage/onError`(sim:219, 393) | sim 的大 switch | `PlanAction` | 劇本計時器 |

觀察:
- 同一件事「站點改變後通知地圖」走 R4(effect),「選取」走 R5(事件),兩者理由都有註解(TPP:1266-1292),但呼叫端看不出差異。
- LLM 的寫入結果走 R1+R2,但 LLM 讀「畫面狀態」走 R9(module 單例),讀「使用者選擇」也走 R9(ref)——同一個 ctx 內混用。
- 模擬播放態的「選取跟著最新站」是 R9(ref)+ effect,推論態沒有這個行為。

---

## 3. 命名不一致與重複

### 3.1 同一動作在不同層的名稱對照

| 概念 | 狀態擁有者 | 入口/包裝層 | 視圖 prop | 地圖 prop | LLM / 劇本 |
|---|---|---|---|---|---|
| 選取站點 | `setSelectedStopId`(usePlanSelection) | `selectStop`(TPP)、`onSelectedStopChange`(TPP prop) | `onSelectStop`(HPT)、PTV 用 `onPanToStop`(!) | `onStopClick` | (無) |
| hover 站點 | `setHoverStopId` | `onHoverStopChange`(TPP prop) | `onHoverStop`(PTV);HPT 無 | (只讀 `hoverStopId`) | (無) |
| hover 交通 | `setHoverTransitPair` | `onHoverTransitChange` | `onHoverTransit` | `hoverTransitPair` | (無) |
| 平移到站 | — | TPP `onPanToStop({lat,lng})`、`useDesktopStopPan().panToStop({lat,lng})`、`usePhoneStopPan().panToStop(stopId)` | PTV `onPanToStop(step)`=**選取+平移**;HPT `onPanToStop(stopId)`=**只平移** | `panTarget`(宣告式) | (無) |
| 換交通方式 | (core 無) | inline `refreshTransitForStop` ×2 | `onSetStopTransitMode` | — | (無) |
| 新增站點 | `addStop` | `addStop`(ctx) | — | — | `add_attraction`;劇本 `add_stop` |
| 移除站點 | `removeStop` | 同 | `onRemoveStop` | — | `remove_attraction`;劇本 `remove_step`(Step 殘留) |
| 備註 | `setStopNote` | `addNoteToTimeline`(TPP:961,舊名) | — | — | `add_note`;劇本 `add_note` |
| 清空時間軸 | `clearTimeline`(core) | `handover` | — | — | 劇本 `reset`(走 setTimeline);`storage.clearTimeline`(死碼,同名不同義) |
| 新增訊息 | `appendMessage` | — | — | — | 劇本 `add_message` |
| 淡化訊息 | `staleAll`(TPP 改名 `staleAllMessages`) | — | — | — | — |
| 詢問頁完成 | `handleAskPageDone`(bridge) | TPP 改名 `resolveAskPage`;`useAskPageFlow` 又輸出同名 `handleAskPageDone` | `onAskPageDone`(HPT)、`onDone`(AskPage) | — | — |
| 詢問頁開啟 | `openAskPage` | `askTravelCountry/City/TransportMode` wrapper | — | — | `open_ask_page`、`ask_*`;劇本 `open_ask_page` |
| AI 生成中 | `isThinking`(bridge) | — | PTV `isThinking`、HPT `isGenerating` | — | 模擬 `isGenerating` |
| 停止 | `stopPrompt` | — | Composer `onStop` | — | — |

### 3.2 可合併的重複實作

| 重複 | 位置 | 說明 |
|---|---|---|
| 換交通方式 inline 箭頭 | TPP:1538-1542、TPP:1625-1629 | 逐字相同,應成為 core 的 `setStopTransit` |
| 地圖站點投影(stops + 子景點 + 旅館) | TPP:1247-1264 vs `useSimulatedStopsView.ts:72-93` | 同一份投影兩份,後者多了內容 key 去抖 |
| 連線段 | TPP:1282 vs `useSimulatedStopsView.ts:119` | 同一行 `routeSegmentsFromTimeline` |
| 跟隨最新捲動(scrollToLatest/handleScroll/jumpToLatest) | TPP:1362-1433 vs pvC:590-645 | 幾乎相同 |
| 清空時間軸 | core `clearTimeline`、sim reset `setTimeline(createEmptyTimeline())`(sim:196, 201, 300)、`storage.clearTimeline` | 三種寫法 |
| 登入後 `useCurrentLocation` | `member/desktop/useCurrentLocation.ts` 與 `member/phone/useCurrentLocation.ts` | 內容逐字相同(依「同名不同目錄」慣例保留,但政策可共用一份) |
| 詢問頁狀態機實例 | TPP:993(完整 AskPageInput)、pvC:238(只 candidates+picks) | 已共用 hook,但 openAskPage 接線各自寫 |
| 骨架卡轉正 | sim:351-366 手動做 `staleAll + followUpStop` | 等同「addStop 的插入後流程」,可成為 core 的 `fillStop`(原地補資料) |
| 受控/非受控選取 | TPP:1213-1225 | 三個入口都傳受控 `selectedStopId`,非受控分支已無使用端 |

### 3.3 散在多處的同類接線

| 類型 | 散落位置 |
|---|---|
| ref 包最新函式避免重建 | TPP:286-307(10 個 ref)、useAskPageFlow.ts:58-65、core:151-162、`useStableCallback` 多處 |
| 「放棄目前詢問頁」 | `sendPrompt`(TPP:535)、`stopPrompt`(TPP:580)、`handleAskPageDescribe`(useAskPageFlow:273) |
| 平移注入 | mdC:173-177、PPV:264-270、pvC:492-511, 579-583、TPP:1319 |
| 回報 `tripPlanProps` 接線 | usePlanStopsState.ts:51 → 三個 LivePlanLayer → PlanPanelContent → TPP props 解構 |
| 計數器觸發 | mpC:157-165、mdC:442、PPV:210-230、useExploreQueries:160 |
| 死碼/無呼叫者 | `storage.clearTimeline`(storage.ts:410)、`uiStateStore.setSelected`、`attractionPool.get/clear`、TPP `onSendPromptReady`、`useLocateWhenWanted().request`、sim 回傳的 `addStop/setStopNote`(pvC 未取用) |

---

## 4. 建議的統一名稱草案

風格延續 `addStop/removeStop/setStopTime`:動詞(add/remove/set/move/retry/open/close/clear/select/hover/pan)+ 單一名詞。✅=已完成,⬜=待做,❓=需決定。

### 4.1 各領域名稱

| 領域 | 建議名稱 | 現名 | 狀態 |
|---|---|---|---|
| 時間軸 | `addStop` `removeStop` `setStopTime` `setStopNote` `retryStop` `addDay` `moveDay` `setLodging` `removeLodging` | 同 | ✅ |
| 時間軸 | `setStopTransit(stopId, mode)` | `onSetStopTransitMode` + inline | ⬜ |
| 時間軸 | `removeDay(day)` | 劇本 `reset_day` 直接 setTimeline | ⬜ |
| 時間軸 | `clearPlan()`(或保留 `clearTimeline`) | core `clearTimeline` / 劇本 reset / storage 死碼 | ⬜❓ |
| 時間軸 | `fillStop(id, data)`(骨架卡原地補資料,含插入後流程) | sim:351-366 手寫 | ⬜❓(只有模擬用,也可留在模擬 adapter) |
| 選取 | `selectStop(id\|null)` | `setSelectedStopId` / `selectStop` / `onSelectedStopChange` / `onSelectStop` / `onStopClick` | ⬜ |
| hover | `hoverStop(id\|null)`、`hoverTransit(pair\|null)` | `setHoverStopId` / `onHoverStopChange` / `onHoverStop`… | ⬜ |
| 主題點 | `expandTheme(id\|null)` | `onExpandedThemeIdChange`(地圖算出) | ⬜❓ |
| 鏡頭 | `panToStop(stopId)`、`panTo(latLng)` | 三種同名 `onPanToStop` + `setPanTarget` + `panToWithinSafeArea` | ⬜ |
| 對話 | `addMessage` `staleMessages` `clearMessages` | `appendMessage` `staleAll` `clearConversation` | ⬜(或維持 append,❓) |
| 詢問頁 | `openAsk(input)` `answerAsk(selected)` `backAsk(countryIds?)` `describeAsk(text)` `closeAsk()`(=answer []) | `openAskPage` / 兩個 `handleAskPageDone` / `handleAskPageBack` / `handleAskPageDescribe` / `resolveAskPage([])` | ⬜ |
| 景點池 | `putPlaces` `listPlaces` | `put` `list`(`get` `clear` 無人用) | ⬜(低優先) |
| 畫面狀態 | `setScreen` `resetScreen` | `uiStateStore.set/reset` | ⬜(低優先,先決定是否改實例) |
| 使用者選擇 | `recordSelection` | 直接寫 `userSelectionRef.current` | ⬜ |
| 目前位置 | `locate()` | `request()`(無人用) | ⬜(等產品決定定位按鈕) |
| 探索 | `toggleCategory` `searchArea` | `handleCategoryClick` `handleSearchThisArea` + 計數器 | ⬜❓(與規劃狀態無交集,可不納入第一輪) |
| 草稿 | `newDraft()` | `handleNewDraft` + key 重新掛載 | ⬜❓ |
| 交接 | `handover()` | 同 | ✅(名稱已一致,行為待決) |
| AI 連線 | `sendPrompt(text)` `stopPrompt()` | 同 | ✅(名稱);⬜ 抽出 TPP |

### 4.2 需要使用者決定的設計問題

1. **`selectStop` 與 `panToStop` 是否合併?** 目前桌面點卡片 = 選取+平移(`useStopCardClick`),點地圖圓點 = 只選取,手機橫向「移動到此」= 只平移,首站 = 自動平移。選項:(a) 兩個獨立動作,由各呼叫者 adapter 組合;(b) 加一個組合動作 `focusStop` = select + pan,PTV 的 `onPanToStop` 改名成 `onFocusStop`。
2. **PTV 的 `onPanToStop(step)` 要不要改名?** 它實際是「點卡片」,名字與 TPP 的 `onPanToStop(latLng)`、HPT 的 `onPanToStop(stopId)` 撞名但語意不同,是目前最容易誤用的一處。
3. **選取的「通知方向」要統一成什麼?** 保留受控 `selectedStopId` + 事件 `selectStop`(現況),還是把選取/hover 也放進共用 store(像時間軸資料源上移那樣),讓地圖與時間軸直接訂閱、不再經 `tripPlanProps` 五個回呼?
4. **TPP 的非受控選取模式要不要刪?** 三個入口都傳受控值,非受控只剩 `selectedStopSync.test.tsx` 覆蓋。
5. **草稿切換是否改成明確動作?** 現在靠 React key 重建整個 TPP(時間軸、對話、景點池、詢問頁、AI 連線一起重來)。改成 `newDraft()` 要決定:對話/景點池/AI 連線(conversationID)要不要跟著換?若「是」,維持 key 重建最簡單,只是把它包成具名動作;若「否」,core 要支援換 store。
6. **交接(handover)要不要也變成 adapter 層的動作?** 它目前是「換掉整個 selection 實例 + 清模擬時間軸/對話」,和草稿重建是同一類「實例置換」。
7. **領域介面如何組合成總介面?** 選項:(a) 每領域一個介面(`PlanOperations`、`PlanSelectionOps`、`PlanCameraOps`、`PlanConversationOps`、`PlanAskOps`、`PlanAiOps`),總介面 = 交集型別 `PlanActions = A & B & …`;(b) 巢狀命名空間 `actions.timeline.addStop`。現有 `PlanOperations` 是扁平的,(a) 與它相容、(b) 要改所有呼叫點。
8. **LLM 工具名(`add_attraction`、`remove_attraction`…)與劇本 `PlanAction.type`(`add_stop`、`remove_step`…)要不要跟著改?** 前者是對外協議(operations.ts 已決定不改);後者是內部格式,可改成與操作同名(`removeStop`),但劇本資料要一起遷移。
9. **回應方向要不要統一成「事件」或「狀態訂閱」二選一?** 目前 R4(effect 回報)與 R5(事件)混用,R9(ref/單例)給 LLM 讀。若採「同一層 adapter 雙向」,需要決定 adapter 對外回應的形狀:回傳值 + 訂閱(store)為主,還是回呼 props。
10. **`uiStateStore` 由 module 單例改為每個 TPP 實例一份?** 目前同頁只有一個 TPP 實例所以沒出事;若之後有兩個面板同時掛載會互相覆寫。
11. **對話動作改名(`appendMessage` → `addMessage`)值不值得?** `append` 語意(接在最後)比 `add` 精確,可視為例外保留。
12. **探索/候選籃要不要納入第一輪?** 它和規劃時間軸、LLM 沒有交集,也正被其他代理修改中。

---

## 5. 風險與建議的分階段順序

### 5.1 主要風險

| 風險 | 說明 |
|---|---|
| TPP 體積 | 1741 行,`usePlanAiChatBridge` 是檔內私有函式,動任何 AI 連線動作都要碰它;註解密度高,改名容易漏改註解 |
| 並行修改 | `conversation/`(AskShell)、`member/`、`place/` 正在被其他代理改,這些檔案的改名要等那邊落地 |
| 函式參照穩定性 | 大量 ref/useStableCallback 是為了不讓 effect 重建 WebSocket 或無窮迴圈;改成 adapter 物件時若每次 render 產生新物件,會重演這些 bug |
| 受控選取的歷史 bug | 「點卡片 A → 點圓點 B → 再點 A 回不去」(TPP:708-718)——選取通知必須維持事件驅動 |
| 詢問頁 pending 保護 | 已有 pending 時 `openAskPage` 靜默忽略;「放棄詢問頁」散在三處,合併時漏一處就會讓 LLM 的開啟被吞掉 |
| LLM 協議 | 工具名與回傳形狀是對外協議,adapter 改動不能改變 LLM 看到的內容 |
| 模擬交接 | 交接是整個實例置換(使用者明確要求),統一 selection 介面時不能讓兩個實例共用 state |
| feature flag | `TIME_DRAG_ENABLED`、`TRANSIT_MODE_SELECT_ENABLED`、`NEW_TRIP_DRAFT_ENABLED`、`ROUTE_LINE_ENABLED` 決定 prop 傳不傳,adapter 化後要保留「關閉 = 不提供動作」的語意 |

### 5.2 建議順序

| 階段 | 內容 | 影響範圍 | 測試安全網 |
|---|---|---|---|
| 0. 清死碼 | 刪 `storage.clearTimeline`、`uiStateStore.setSelected`、`attractionPool.get/clear`(或確認保留理由)、TPP `onSendPromptReady`、sim 未被取用的回傳;TPP 非受控選取(若決議刪) | timeline/storage、conversation stores、TPP props | `tsc -b`;`storage.test`、`uiStateStore.test`、`selectedStopSync.test`、`usePlanSimSocket.conversation.test` |
| 1. 時間軸補齊 | `setStopTransit` 進 `PlanOperations`(合併 TPP 兩份 inline,補 `isCancelled`);劇本 `reset`/`reset_day` 改走 `clearTimeline`/`removeDay`;`addNoteToTimeline` 改名 | core、operations、TPP、sim | `usePlanTimelineCore.test`、`usePlanTimelineCore.tripPlanWiring.test`、`transit.test`、`usePlanSimSocket.conversation.test`、`planSimScript.refs.test` |
| 2. 選取與 hover 介面 | 定義 `PlanSelectionOps { selectStop, hoverStop, hoverTransit }`,`usePlanSelection` 直接回這組名字;TPP props 與 `tripPlanProps` 改名;HPT `onSelectStop`、PTV `onHoverStop` 對齊 | timeline/usePlanStopsState、TPP、三個 LivePlanLayer、SimPlanLayer、PTV/HPT props、地圖 `onStopClick` | `usePlanStopsState.test`、`selectedStopSync.test`、`useSimulatedStopsView.test`、`SimPlanLayer.test`、`LivePlanLayer.test`(三份)、`layerContracts.test`、HPT/PTV 測試 |
| 3. 鏡頭 | 解開三個 `onPanToStop`:PTV 改 `onFocusStop`(或依決議),TPP 改 `onPanTo`,`useDesktopStopPan` 回傳改 `panTo`;定義 `PlanCameraOps` | map/useStopPan、TPP、PTV、mdC、pvC | `useStopPan.test`、`useFirstStopAutoPan.test`、`PlanTimelineView.panToCenter.test`、`usePanTarget*.test` |
| 4. 對話與詢問頁 | 定義 `PlanConversationOps`、`PlanAskOps`;拆開兩個同名 `handleAskPageDone`(底層 `answerAsk` vs 流程);「放棄詢問頁」收成單一 `closeAsk` | conversation/useAskPageBridge、panel/useAskPageFlow、TPP、pvC(**等 conversation/ 其他代理落地後**) | `useAskPageBridge.test`、`useAskPageFlow.test`、`AskPage*.test`、`ScriptedAskPage.test`、`usePlanConversation.test`、`messages.test` |
| 5. 抽出 AI 連線 | `usePlanAiChatBridge` 搬到 `conversation/`(獨立檔),輸入改收「各領域介面」而非 14 個位置參數;`PlanAiOps { sendPrompt, stopPrompt }` | TPP 大幅縮小 | `bridgeReconnectReset.test`、`context.test`、`guard.test`、`tools.test`、`asktools.test` |
| 6. 每個呼叫對象一層 adapter | LLM adapter(現 `ctx` + askPageCtx 合併)、模擬 adapter(sim 的 action switch 改成「PlanAction → 總介面」映射)、畫面 adapter(PTV/HPT/AskPage props 從總介面衍生,像 `Parameters<PlanOperations[...]>` 那樣)、地圖 adapter(`onStopClick`、`onExpandedThemeIdChange`);回應方向依 §4.2 第 9 題決議統一 | 全部入口 | 以上全部 + 新增「adapter 契約」測試(類似 `layerContracts.test`) |
| 7. 草稿/交接/探索(依決議) | `newDraft`、`handover` 具名化;探索是否納入另議 | preview/LivePlanLayer、pvC、member/explore | `LivePlanLayer.draftConversation.test`、`drafts.test`、`useExploreQueries.test` |

建議每一階段都維持「先改名、行為不變」與「改行為」分開提交,並沿用 `PlanOperationNames` 這類編譯期名稱約束,讓 adapter 層名字不能各叫各的。
