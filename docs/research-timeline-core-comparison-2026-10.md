# 時間軸「改動邏輯」三份實作對照(2026-10-24)

> 一次性研究筆記(`research-*`,帶日期,定案後不回頭改)。若後續決定收斂,另開 `refactor-*` 承接。
> 以 2026-10-24 工作樹的實際程式為準(行號含未提交的改動)。**本文件只讀程式、不改程式。**

## 1. 目的與範圍

比對時間軸「改動邏輯」的三份實作:共用資料層 hook `usePlanTimelineCore`(已抽出、無使用端)、登入後與 /ai-plan 推論態使用的 `useTripPlanTimeline`(含同檔 `usePlanAiChatBridge` 的 AI 工具 ctx)、/ai-plan 模擬態使用的 `usePlanSimSocket`。目的是讓開發者決定「要不要收斂到 core」或「直接刪掉 core」。領域層 `plan-core/planTimeline.ts` 的純函式三者共用,不在比對範圍。

## 2. 三份實作一覽

| 項目 | usePlanTimelineCore | useTripPlanTimeline(+ AI ctx) | usePlanSimSocket |
|---|---|---|---|
| 檔案 | `web/src/plan-core/usePlanTimelineCore.ts`(179 行) | `web/src/trip-plan/TripPlanPage.tsx`:`useTripPlanTimeline` L154-541(約 390 行,多為註解);`usePlanAiChatBridge` L590-1044(約 455 行,ctx 在 L741-803) | `web/src/home/plan-ai-sim/usePlanSimSocket.ts`(690 行,另含 `planActionToInsert` L48-94 與劇本處理 effect L405-654) |
| 被誰使用 | 只有 `usePlanTimelineCore.test.tsx`(8 個 it:基本操作 4、persist 4)。全專案 grep 無其他 import | `TripPlanPage` 本體 L1349;`TripPlanPage` 又被 `phone/LivePlanLayer`、`desktop/LivePlanLayer`、`home/plan-ai-sim/LivePlanLayer`、`PlanPanelContent` 等入口掛載 | `home/plan-ai-sim/Content.tsx` L336(經 `SimPlanLayer` 接 timelineRef/dragStopTime/retryStopLookup,L749-751);`home/AiPlanPhoneDemoScreen.tsx` L104 |
| 持有狀態 | `useSyncedState<PlanTimeline>` L82 + `revRef` L85 | `useSyncedState` L185 + `revRef` L199 + `mountedRef` L275 + `retriedOnMountRef` L328 | `useSyncedState(createEmptyTimeline)` L222 + `isGenerating`/`source` state + `latestInsertedStopIdRef` L284 |
| 持久化 | 有,`persist` 布林(預設 false)直接呼叫 `loadTimelineWithRev/readRev/saveTimeline`(L79、L101、L119),只能用預設 key | 有,經注入的 `store: PlanTimelineStore`(L168;呼叫端傳 localStorage store 或草稿 store,`planTimelineStorage.ts` L404-433) | 無(純記憶體,展示用,Content.tsx 註解 L333 起、本檔 L656-664) |
| AI 工具 | 無 | 有(`usePlanAiChatBridge` 的 `AttractionStepsCtx`,L745-803,工具表 L881-887) | 無(由劇本 `PlanAction` 驅動,不走 onagent;L435-643) |
| 是否被 ctx 以外直接用 | `commitTimeline/setTimeline/clearTimeline/resyncFromStorage` 皆回傳 | 回傳 `setTimeline`(供交通方式手選,L2154、L2232)、`resyncFromStorage`(面板轉可見時,L1918) | 回傳 `clearTimeline`(交接用)、`retryStopLookup`、`dragStopTime` |

## 3. 逐項對照表

| 行為 | usePlanTimelineCore | useTripPlanTimeline(+ AI ctx) | usePlanSimSocket |
|---|---|---|---|
| 狀態持有 | `useSyncedState` + `initialRef`(避免 Strict Mode 雙讀)L77-82 | 同,`store.loadTimelineWithRev()` L183-185 | `useSyncedState(createEmptyTimeline)` L222;`setTimeline` 包 `commitTimeline` L223-228 |
| 持久化與 rev 版次同步 | `resyncFromStorage` L99-106(persist 才作用);`commitTimeline` 寫入前先追磁碟、`saveTimeline` 回 null 則不推進 state L113-127 | 同邏輯 L225-258,差別只在走 `store.*`、且**無 persist 開關**(永遠寫 store) | 無;`commitTimeline` 即 `useSyncedState` 原生版 |
| 插入站點 insertAttractionAfter | L145-159:`insertAfter` → 非 ok 直接回 → `data.type==='stop'` 才 `staleOtherAgentMessages` → commit 後呼叫 `onStopInserted`(任何 stop 都觸發,含無 placeId、無座標的骨架) | L338-368:同樣 insert + stale;**背景查詢內建**:`placeId && loading` → `resolveAttractionForStep`(isCancelled 含 `mountedRef`+`hasNode`,帶 photoAssets),`onSettled` 走 `refreshTransitAround`;否則有座標 → `refreshTransitForStop` | L326-364:insert + stale 同上;背景查詢用**本檔私有的** `resolveAttractionForStep`(L132-171),`isCancelled` 恆 `() => false` L346,無 photoAssets;其餘分支同 TripPlan |
| 插入後的「原地補資料」 | 無 | 無(AI 路徑一律走 insert) | 有:`add_stop` 且 id 已有骨架節點時改 `updateNode` + `staleOtherAgentMessages`,並自己重做背景查詢/交通觸發,L586-618;`thinking` 先插空白 loading 骨架 L464-495 |
| 寫備註 setNoteForStop | 無 | L372-388(`hasNode` 檢查 → `updateNode(note)`,找不到回 `anchor_not_found`);呼叫端 `addNoteToTimeline` 補預設分類 `info`(L1377-1382) | L387-403,邏輯逐行相同;**不做**分類 fallback(L682-689 註解說明為刻意) |
| 移除站點(兩階段) | 無(檔頭註解 L34-36 明說留給呼叫端) | `removeStep` L455-475:先用 `removeNode` 預檢(不存在/已 removing 回 false)→ 標 removing → `REMOVE_FADE_MS`(L93)後 `removeNode(allowRemoving)` → 補 `refreshTransitForStop(nextId)`;**timer 無卸載/取消保護** | L532-560:標 removing(**無預檢**)→ `REMOVE_FADE_MS`(L100)後同樣摘除與補交通;有 `cancelled` 旗標保護(L536);常數另寫一份 |
| 拖曳改時間 dragStopTime | 無 | L494-515:`commitTimeline` 寫 time + 設 `suppressAutoScrollRef` + `refreshTransitForStop` | L236-242:`setTimeline` 寫 time + `refreshTransitForStop`;**無 suppress**;無 commit 持久化概念 |
| 重試地點查詢 retryStopLookup | 無 | L300-317:設 loading → `resolveAttractionForStep`(含 429 重試、photoAssets、`mountedRef`) | L254-266:設 loading → 私有版 `resolveAttractionForStep`;`isCancelled` 只看 `hasNode`,無 photoAssets |
| 掛載後自動重試 failed | 無 | L328-336:空依賴 effect,掃出 `stopLookupFailed` 逐一重試(因 failed 會被持久化) | 無(時間軸不持久化,重整即清空,故無殘留 failed) |
| 清空 | `clearTimeline` L166-168(persist 時連磁碟一併清,測試 L125) | 無獨立函式(由呼叫端換 store/key 重新掛載,`LivePlanLayer` mountKey) | `clearTimeline` L662-664;劇本 `reset` L512-515、`reset_day`(`removeDay`)L520-524;`start` 變 false 時清空 L411-416 |
| 新增/移動/刪除天 | 無 | `addDayToTimeline` L392-401、`moveDayInTimeline` L402-411(皆 `commitTimeline`);刪天無 AI 工具(僅有領域函式 `removeDay`) | 無新增/移動;只有劇本的 `reset_day` 呼叫 `removeDay` L520-524 |
| 住宿 set/remove_lodging | 無 | `setLodgingInTimeline` L416-424(`setLodgingByDays`)、`removeLodgingFromTimeline` L425-433(`removeLodging`) | 無 |
| 接在最後面 lastAppendTarget | 無 | 使用於 bridge 內:`onAssistantMessage` L903、`onError` L933、`sendPrompt` 失敗 L1003;AI 工具的 anchorId 由 LLM 給(ctx L751-756),不在這裡補 | `planActionToInsert` 未帶 afterId 時 L92;`thinking` 骨架錨點 L478(連 day 一起沿用,避免軸線跳回 Day 1) |
| 加站自動捲動抑制 suppressAutoScroll | 無 | 有:ref 由 `TripPlanPage` 建立(L1341)傳入;`removeStep` 兩處(L458、L462)、`dragStopTime`(L505)設旗標;消費端 L2007 | 無此機制;改用 `latestInsertedStopIdRef`(L284、L616、L641)讓 `useSimulatedStopsView` 同步選取(是「選取跟隨」而非「抑制捲動」) |
| 錯誤訊息(ephemeral message) | 無 | 有:`onError` L938、`sendPrompt` 失敗 L1016,插入 `{type:'message', ephemeral:true}`(存檔時被略過,`planTimelineStorage.ts` L163) | 無(劇本錯誤改為 `throw`:L492、L574、L632;`source.onError` 只關 isGenerating L644) |
| AI 把關 assertFreshRead / structureSignature | 無 | 有:`lastReadSignature`(L741)、`assertFreshRead` L742-744;`getTimeline` 讀取時記簽名 L746-750;insert/addNote/removeStep/addDay/moveDay/setLodging/removeLodging 皆先 assert(L752、758、771、782、786、792、799);詢問類工具透過 `ensureFreshRead` L840;簽名定義在 `attractionTools.ts` L219 | 無(劇本不是 LLM,沒有「讀過才能改」的前提) |
| 骨架(thinking)與 isGenerating | 無 | 無 | 有,L464-508(非 thinking/done 的每則訊息先關 isGenerating) |

## 4. 已共用與仍重複

### 已共用(三者或兩者共用同一份)

| 項目 | 位置 | 使用者 |
|---|---|---|
| 領域純函式 `insertAfter/removeNode/updateNode/staleOtherAgentMessages/lastAppendTarget/addDay/moveDay/setLodgingByDays/removeLodging/removeDay` | `plan-core/planTimeline.ts` | 三者(Sim 未用 day/lodging 類操作) |
| `refreshTransitForStop/refreshTransitAround` | `plan-core/refreshTransit.ts` L46、L91(檔頭 L5 註明由 Sim 與 TripPlan 兩份合併而來) | TripPlan、Sim(core 不呼叫,交由 `onStopInserted`) |
| `resolveAttractionForStep`(plan-core 版) | `plan-core/resolveAttractionForStep.ts` L58 | TripPlan(L305、L347)、`itineraries/useResolvedItineraryTimeline.ts` L32(`keepContent=true`)。**Sim 沒有用** |
| `useResolvedNodeRefs` | `plan-core/useResolvedNodeRefs.ts` L204 | `TripPlanPage` L1852、`SimPlanLayer` L81、`useSimulatedStopsView` L39、`HorizontalPlanTimeline` L517、行程詳情頁 |
| `useSyncedState` | `hooks/useSyncedState.ts` | 三者 |
| `PlanAiDataSource` 讀取層(真/假資料) | `planAiDataSource.ts` | TripPlan(注入真或公開)、Sim(預設假資料 L212) |

### 仍重複(具體函式與差異)

| 重複項 | 位置 A | 位置 B | 差異 |
|---|---|---|---|
| `insertAttractionAfter`(insert → stale → 背景查詢/交通) | TripPlan L338-368 | Sim L326-364(core L145-159 是只含前半段的第三份) | TripPlan 的 isCancelled 含 mountedRef、傳 photoAssets;Sim 恆 false、不傳 photoAssets。core 把背景查詢外包給 `onStopInserted` 且對**所有** stop 觸發 |
| `resolveAttractionForStep` | `plan-core/resolveAttractionForStep.ts` L58-146 | `usePlanSimSocket.ts` L132-171 私有版 | 私有版缺:429 限流單次延遲重試、`photoRefreshPending` 補圖重試、`keepContent`、`fetchPhotoAssets`。成功/失敗寫回邏輯其餘相同。**這是最明確且可低風險收斂的重複** |
| `setNoteForStop` | TripPlan L372-388 | Sim L387-403 | 逐行相同(分類 fallback 在呼叫端 L1377,不在函式內) |
| `commitTimeline/setTimeline` 包裝 + rev 同步 | TripPlan L225-265 | core L99-137 | 邏輯相同;core 多 `persist` 開關、TripPlan 多 `store` 注入。Sim 只有 `setTimeline` 包裝(L223-228) |
| `removeStep` 兩階段 | TripPlan L455-475 | Sim L532-560 | `REMOVE_FADE_MS` 各定義一份(TripPlan L93、Sim L100,皆 320,CSS 也要同值);Sim 無預檢、無 suppress,TripPlan 無取消保護 |
| `dragStopTime` | TripPlan L494-515 | Sim L236-242 | TripPlan 用 `commitTimeline` + suppress;Sim 用 `setTimeline`、無 suppress |
| `retryStopLookup` | TripPlan L300-317 | Sim L254-266 | 差異同上(cancelled 條件、photoAssets) |
| `clearTimeline` | core L166-168 | Sim L662-664 | 完全相同 |

## 5. 行為差異清單

| # | 差異 | 判斷 | 依據 |
|---|---|---|---|
| D1 | Sim 私有版 `resolveAttractionForStep` 沒有 429 重試與補圖重試,TripPlan 版有 | **疑似遺漏** | plan-core 版檔頭(L1-5)明說是「/ai-plan 與登入後與詳情頁三處共用」,但 Sim 並未改用;Sim 預設資料源是假資料(`planAiFakeDataSource`),所以目前不會踩到 429,屬於「現在無症狀」。若首頁/展示頁改接真 dataSource(L208-212 註解預留了),就會落差 |
| D2 | Sim `insertAttractionAfter` 的 isCancelled 恆 false(L346);Sim `retryStopLookup` 用 `hasNode`(L263);TripPlan 兩處都含 `mountedRef` | 疑似遺漏(輕微) | TripPlan 的 mountedRef 是 review 發現的修補(L267-279);Sim 的 `start=false` 會清空時間軸(L411-416),節點消失後 `updateNode` 對不存在 id 預期為 no-op,風險較低 |
| D3 | TripPlan `removeStep` 的 `setTimeout` 無取消/卸載保護;Sim 有 `cancelled` | 疑似遺漏(TripPlan 側) | 卸載後 320ms 才觸發 `setTimeline`(寫入 store)與 `refreshTransitForStop`;Sim L536 已防。需確認卸載後 `commitTimeline` 的副作用是否可接受(見未決問題) |
| D4 | Sim `removeStep` 邏輯無 `removeNode` 預檢(對不存在/已 removing 的 id 仍標 removing) | 刻意(劇本保證 id 合法) | L525-531 註解說「移除邏輯只有這一條路徑」;TripPlan 的預檢是為了回報 LLM 成功與否(L441-448) |
| D5 | Sim `dragStopTime` 無 `suppressAutoScroll`,TripPlan 有 | 刻意 | 該旗標只服務 TripPlan 的 scrollToLatest(L2001-2018);Sim 用 `useSimulatedStopsView` 選取跟隨,捲動機制不同。**需另行確認** Sim 拖曳後橫向軸是否會誤捲(本次未追到 `HorizontalPlanTimeline` 捲動邏輯) |
| D6 | Sim 無掛載後自動重試 failed | 刻意 | Sim 不持久化,重整後 failed 不會殘留(TripPlan L321-327 的理由是 failed 會持久化) |
| D7 | Sim 備註不做分類 fallback,TripPlan 做 | 刻意 | Sim L682-689 註解明載;使用者要求模擬「不要有例外」 |
| D8 | 只有 TripPlan 把連線/送出錯誤插成 `ephemeral` message | 刻意 | Sim 沒有連線與送出;劇本錯誤用 throw(L492 等)。但 Sim 的 throw 發生在 `source.onMessage` 回呼內,是否被 source 吞掉未追(見未決問題) |
| D9 | core 的 `onStopInserted` 對**所有** stop 觸發(含骨架);TripPlan/Sim 只在 `placeId&&loading` 或有座標時觸發 | **疑似遺漏(core 側)** | 若直接把兩邊的分支搬進 `onStopInserted`,需要在回呼內重做判斷(它收得到 `data`,可行);但骨架 stop(`{loading:true}` 無 placeId)在 core 也會觸發回呼,呼叫端必須自行過濾。core 沒有任何地方說明這點 |
| D10 | core 以 `persist: boolean` 決定持久化,只能用預設 key;TripPlan 用注入的 `PlanTimelineStore`,支援草稿 store(`createDraftPlanTimelineStore`,`LivePlanLayer.tsx` L97-100) | **疑似遺漏(core 側)** | `planTimelineStorage.ts` L390-403 註解明說原本考慮 persist 開關、後來**刻意改成介面**,理由是「不持久化」的語意容易各自詮釋。core(2026-10 後寫)走回了被否決的方案,且無法支援多份草稿 |
| D11 | `noopPlanTimelineStore.saveTimeline` 回 null,而 commit 遇到 null 會「不推進 state」(TripPlan L243-251、core L120)→ 若拿 noop store 給 TripPlan,**記憶體時間軸永遠不會被更新** | **疑似 bug(潛在)** | `planTimelineStorage.ts` L429-433 的 noop store 註解說「呼叫端不會推進 revRef」,但沒意識到同時也不會推進 state。目前沒有呼叫端使用(註解 L424-428),所以無症狀;core 的 `persist:false` 路徑不經 store,不受此影響 |
| D12 | core 檔頭 TODO 與現況不符 | 文件過期 | L15-20、L38-45 寫「模擬層為 `plan-ai-sim/Content`」、「/app」;實際模擬時間軸狀態在 `usePlanSimSocket`,且 `/trip-plan` 頁面已移除(最近 commit fe65e6e) |
| D13 | Sim 的插入有「骨架節點原地補資料」特例(L586-618),會重複 insert 路徑的 stale + 背景查詢 + 交通觸發 | 刻意(但是第四份重複) | L577-585 註解:避免孤兒節點與兩張卡;與 `insertAttractionAfter` 的後半段是複製貼上。若收斂,這段需要變成 core 的 `fillStopInPlace` 之類 |
| D14 | Sim effect 依賴 `[start]`(L654),閉包捕捉掛載時的 `dataSource`/`insertAttractionAfter` | 疑似遺漏(輕微) | `dataSource` 實際上由呼叫端固定傳常數,未造成問題;若改成可變 dataSource 會 stale closure(TripPlan 曾因此修過,見 L160-165) |

## 6. 收斂方案

### 方案 A:兩個使用端改用 usePlanTimelineCore

**core 需要補什麼**

| 補項 | 內容 | 理由 |
|---|---|---|
| 持久化改注入 store | 以 `store?: PlanTimelineStore` 取代 `persist: boolean`(沒傳 = 不持久化,內部用不經 store 的路徑,避開 D11) | 對齊 `planTimelineStorage.ts` L390 既有決策;支援草稿 store;避免 D10 |
| `onStopInserted` 契約 | 文件化「所有 stop 都觸發」或在 core 內部只對「需要補查」的 stop 觸發;並提供 `resolveAttractionForStep + refreshTransit` 的預設實作(吃 `dataSource`) | 消除 D9 與「兩份 insert 後半段」 |
| 暴露 `commitTimeline`(已有) | AI ctx 的 addDay/moveDay/setLodging 都需要同步拿到結果,core 已匯出 `commitTimeline`,可直接在使用端或 core 內加薄包裝 | 目前 TripPlan 的天/住宿函式(L392-433)是純 `commitTimeline` + 領域函式,可原樣搬入 core |
| `removeStep` 兩階段 | 新增,參數:`fadeMs`、`onBeforeMutate?`(供 suppressAutoScroll)、卸載/取消保護 | core 檔頭刻意不含;若不補,TripPlan/Sim 仍各留一份 |
| `dragStopTime` | 新增,同樣帶 `onBeforeMutate?` 與交通重算 | 兩邊近乎相同,可收成一份 |
| `retryStopLookup` + 掛載重試 | 新增(掛載重試用 option 控制,Sim 關閉) | 兩邊差異只有 photoAssets/mountedRef |
| `setNoteForStop` | 新增(逐行相同) | 見 §4 |
| 內建 `mountedRef` | isCancelled 統一含 mountedRef | 解 D2、D3 |
| AI ctx 介面 | 不放進 core;core 只提供上述操作,ctx 與 `assertFreshRead` 仍留在 `usePlanAiChatBridge`,因為它依賴 onagent 與 `lastReadSignature` 閉包 | assertFreshRead 屬於「AI 工具把關」,Sim 沒有對應需求 |

**兩邊各自保留**

| 使用端 | 保留 |
|---|---|
| TripPlan | `usePlanAiChatBridge` 整段(bridge、ctx、`assertFreshRead`、message/ephemeral 插入、`sendPrompt/stopPrompt`)、`suppressAutoScrollRef` 的消費端、`addNoteToTimeline` 分類 fallback、`PlanTimelineStore` 的選擇(由 LivePlanLayer 決定) |
| Sim | `planActionToInsert`、劇本處理 effect(thinking 骨架、原地補資料 L586-618、reset/reset_day、isGenerating、`latestInsertedStopIdRef`)、`start` 生命週期 |

**建議分段順序**

| 段 | 內容 | 風險 | 預估改檔 |
|---|---|---|---|
| 0 | 先做不依賴 core 的小收斂:刪掉 Sim 私有 `resolveAttractionForStep`,改 import plan-core 版(補傳 isCancelled 與 photoAssets 與否由 dataSource 決定) | 低(假資料源下行為幾乎不變;`dataSource.photoAssets` 為選填) | `usePlanSimSocket.ts` |
| 1 | core 改為 `store` 注入、補 `setNoteForStop/clearTimeline/mountedRef`,更新 core 測試 | 低(core 無使用端) | `usePlanTimelineCore.ts`、`.test.tsx` |
| 2 | Sim 改用 core(無 store、`onStopInserted` 接 resolve/refresh;骨架補資料特例暫留在 Sim) | 中:劇本節奏、`getTimeline` 同步性、Strict Mode 雙掛載 | `usePlanSimSocket.ts`、`planSim*.test`、`useSimulatedStopsView.test` |
| 3 | core 補 `removeStep/dragStopTime/retryStopLookup`,Sim 切過去 | 中:`REMOVE_FADE_MS` 與 CSS 必須同值;Sim 的 removing 預檢行為變嚴格 | `usePlanTimelineCore.ts`、`usePlanSimSocket.ts` |
| 4 | TripPlan 改用 core(含 store 注入、suppress hook、天/住宿操作搬入),`usePlanAiChatBridge` 只改參數來源 | 高:面積最大、持久化與多實例 rev 同步、AI 把關順序;需跑 `PlanPanelContent.test`、`LivePlanLayer.test`、AI ctx 相關測試與實機驗證 | `TripPlanPage.tsx`、`usePlanTimelineCore.ts`、相關測試 |

### 方案 B:不收斂,直接刪掉 core

| 項目 | 內容 |
|---|---|
| 要做 | 刪 `usePlanTimelineCore.ts`、`.test.tsx`;順手只做「段 0」(刪 Sim 私有 `resolveAttractionForStep`)與必要的文件更正 |
| 優點 | 少一份「沒有使用端的程式」(目前是第四份拷貝,且因 D9/D10/D11 與現況已有分歧,留著反而誤導);零行為風險;改檔 2-3 個 |
| 缺點 | `insertAttractionAfter`、`setNoteForStop`、`removeStep`、`dragStopTime`、`retryStopLookup`、commit 包裝仍各有兩份,日後每次改動要雙邊同步(本文件 §5 的 D1-D3 就是這種落差的實例) |
| 折衷 | 不刪 core,但依 §6 步驟 1 修正後掛為「兩邊逐步採用的目標」;或把 core 退成只含 `commitTimeline/rev` 的 `useCommittedTimeline`(最小共用面),不碰插入/移除語意 |

## 7. 未決問題

1. 要走方案 A(完整收斂)、方案 B(刪掉 core),還是折衷(只共用 commit/rev 層)?
2. 若採 A,持久化是否一律改成注入 `PlanTimelineStore`(對齊既有決策),捨棄 core 的 `persist` 布林?
3. `usePlanSimSocket` 預期哪天要接真 dataSource(L208-212 的註解預留)?若會,D1/D2 就該優先處理;若永遠是假資料,段 0 仍建議做(消除重複),但優先度可降。
4. `noopPlanTimelineStore` 目前無使用端,要不要順手修成「記憶體可寫、磁碟不寫」(D11),或直接刪除?
5. TripPlan `removeStep` 的 timer 在元件卸載後仍會 `setTimeline`(寫 store)(D3):是否視為需修的 bug?本次沒有實測卸載後的實際影響。
6. Sim 的 throw(劇本 insert 失敗)是否被 `PlanSimSource` 的 onMessage 呼叫端吞掉?(L492、L574、L632 抛出後的實際行為本次未追到 `planSimFakeSource/planSimScrollSource`。)
7. `HorizontalPlanTimeline` 在 Sim 路徑下拖曳改時間後是否會出現不期望的捲動(D5):本次沒有讀該元件的捲動邏輯,需實機或另查。
8. core 檔頭 TODO/背景說明(D12)是否同步更正,或隨決議一併刪除?

## 附:查證範圍

已完整讀過:`usePlanTimelineCore.ts`、`usePlanSimSocket.ts`、`TripPlanPage.tsx` L85-1044(`useTripPlanTimeline` 與 `usePlanAiChatBridge`)。僅局部讀取:`TripPlanPage.tsx` 其餘段落(L1205-1380、1778-1800 等,用於確認呼叫方式與 suppress 消費端)、`Content.tsx`(L320-400)、`SimPlanLayer.tsx`(grep)、`LivePlanLayer.tsx`(L85-125)、`resolveAttractionForStep.ts`、`refreshTransit.ts`、`planTimelineStorage.ts` 的 store 段、`planTimeline.ts` 的 `removeNode/lastAppendTarget`、`attractionTools.ts` 的 `structureSignature`。未讀:`useSimulatedStopsView.ts`、`HorizontalPlanTimeline.tsx` 的捲動邏輯、`planSimFakeSource/planSimScrollSource`。
