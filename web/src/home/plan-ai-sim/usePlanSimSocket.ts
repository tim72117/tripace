import type { PlanAction } from './planAction'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSyncedState } from '../../hooks/useSyncedState'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import type { PlanAiDataSource } from './planAiDataSource'
import { createPlanSimFakeSource } from './planSimFakeSource'
import type { PlanSimSource } from './planSimSource'
import { createEmptyTimeline, removeDay, insertAfter, removeNode, staleOtherAgentMessages, toRenderList, updateNode, type PlanNodeData, type PlanTimeline } from '../../plan-core/planTimeline'

// STEP_ADD_TYPES——需要走 planActionToInsert(插入新節點)的訊息型別。
// 2026-09 重構:'add_note' 移出這個集合——note 不再是插入到時間軸裡的
// 獨立節點,改成掛在既有節點自己身上的欄位(見 planTimeline.ts NoteInfo
// 的完整說明),ws.onmessage 改成另外特判這個型別、直接呼叫
// setNoteForStop(見該處的完整說明),不再經過 planActionToInsert 這個
// 「組出插入用三元組」的轉換路徑——沒有新節點被插入,自然不需要它。
//
// 'add_message'——2026-09 加入這個集合,跟 add_note 的方向相反:LLM/
// 使用者的對話訊息(見 planTimeline.ts PlanNodeType 的 'message' 完整
// 說明)是真正插入時間軸的獨立節點,不是掛在某個既有節點身上的欄位,故
// 走跟 add_section/add_stop 完全一樣的插入路徑,不需要像 add_note 那樣
// 另外特判。
const STEP_ADD_TYPES: ReadonlySet<PlanAction['type']> = new Set(['add_section', 'add_stop', 'add_message'])

// planActionToInsert — 把一則新增類 PlanAction 轉成 insertAttractionAfter
// 需要的 (anchorId, newId, data) 三元組,不實際執行插入——純函式,呼叫端
// (usePlanSimSocket 的 ws.onmessage)拿到這三元組後統一呼叫
// insertAttractionAfter 完成插入與驗證,理由見 PlanAction.afterId 的
// 完整說明:模擬腳本與 onagent 對話兩條路徑現在共用同一個插入介面,
// 不再各自實作一份。
//
// 'add_transit' 型別上仍保留在 PlanAction.type 聯集裡(對齊後端
// plan_sim_ws.go 的 JSON 協定,理論上仍可能出現這個字串值),但不在
// STEP_ADD_TYPES 內——2026-09 起交通卡不再是獨立的節點型別(見
// planTimeline.ts TransitInfo 的完整說明,改掛在 stop 節點自己的
// transitFromPrev 欄位上),沒有對應的節點型別可以承接這則訊息,收到就
// 直接忽略(這裡的 !STEP_ADD_TYPES.has 判斷讓它自然落入 return null,
// 不需要另外寫一個分支特判)。planSimScript 本身已經不會送出這個訊息
// (見該變數的完整說明),這裡只是防禦性地不讓舊協定字串意外造成執行期
// 錯誤。
//
// anchorId 的決定:afterId 有值時直接採用(找不到對應節點是否算錯誤,
// 交給 insertAttractionAfter/insertAfter 判斷,這裡不做寬容降級,見
// PlanAction.afterId 的完整說明);未帶 afterId 時退回「目前時間軸最後
// 一個節點」,對齊模擬腳本固定劇本「新內容接在已生成內容之後」的預設
// 語意——這不是寬容降級,是這個欄位本來的預設行為(action.afterId 是
// 選填欄位,省略時的既有預設值本來就是「接在最後面」)。
function planActionToInsert(
  timeline: PlanTimeline,
  action: PlanAction,
): { anchorId: string | null; newId: string; data: PlanNodeData } | null {
  if (!STEP_ADD_TYPES.has(action.type)) return null
  const id = action.id ?? `${action.type}-${timeline.nodes.size}`
  // nodeType——'add_message' 對應 planTimeline.ts 的 'message' 節點型別
  // (見該型別的完整說明),不是 stop 也不是 section。
  const nodeType = action.type === 'add_section' ? 'section' : action.type === 'add_message' ? 'message' : 'stop'
  const data: PlanNodeData = {
    type: nodeType,
    label: action.label,
    // text——message 節點自己的訊息內容(見 PlanNodeData.text 的完整
    // 說明),沿用跟 add_note 相同的 action.text 欄位,不另外發明新欄位
    // 名稱。
    text: action.text,
    time: action.time,
    day: action.day,
    duration: action.duration,
    kind: action.kind,
    name: action.name,
    desc: action.desc,
    thumbBg: action.thumbBg,
    thumbIcon: action.thumbIcon,
    tags: action.tags,
    placeId: action.placeId,
    // loading:add_stop 訊息帶 placeId 時,這筆先以「查詢中」狀態
    // 掛進時間軸(縮圖/敘事文字用訊息本身的假資料佔位,見下方渲染邏輯),
    // insertAttractionAfter 內部另外用這個 placeId 查完真實資料後
    // (見 resolveAttractionForStep 的完整說明),再更新這筆節點把
    // loading 轉 false、photoUrl/desc 換成真實內容——這裡不是同步查完
    // 才 append,是「先掛佔位卡、查到再補上」,才能忠實呈現「AI 呼叫
    // 工具查詢中」這個過程本身,而不是讓使用者只看到查完的結果、跳過
    // 中間狀態。
    loading: action.type === 'add_stop' && !!action.placeId,
    lat: action.lat,
    lng: action.lng,
    children: action.children,
    candidateCards: action.candidateCards,
  }
  const renderedForAppend = toRenderList(timeline)
  const lastId = renderedForAppend.length > 0 ? renderedForAppend[renderedForAppend.length - 1].id : null
  const anchorId = action.afterId ?? lastId
  return { anchorId, newId: id, data }
}

// REMOVE_FADE_MS — 淡出動畫時長,前端(.module.css 的 removingFade)與
// 這裡的延遲時間必須一致:CSS 決定「看起來」的過渡時間,這個常數決定
// 「動畫播完後多久真的把節點從時間軸移除」,兩者對不上會出現「畫面還沒
// 淡完節點就消失」或「淡完了節點還占著版面空間」的落差。
const REMOVE_FADE_MS = 320

// CTA_AFTER_STOPS——模擬排到第幾站時,把輸入膠囊的送出鈕換成「立即
// 使用」行動呼籲按鈕(見下方 composerCollapsed 的完整說明)。
export const CTA_AFTER_STOPS = 5

// resolveAttractionForStep — add_attraction 帶 placeId 時,單段查詢取得
// 真實地點資料:呼叫 GET /internal/geo/plan-ai/place-details-any(fetchPlaceDetails,
// 見 handlePublicGeoPlaceDetailsAny 的完整說明)取得 name/summary/
// photoUrl/lat/lng。
//
// 2026-09 這是「回到 placeId」重構的一部分(見 attractionTools.ts 檔頭
// 「第四/五/六次重構」的完整說明)——原本(短暫存在過)的兩段式查詢
// (先查資料庫 attraction、若帶 place_id 再疊加查 Google 補強)已經不
// 需要:place-details-any 端點內部本來就會優先查一次資料庫 attraction
// (查得到就優先用資料庫資料,查不到才 fallback 查 Google),這支函式
// 因此簡化成單一次查詢,不再需要 fetchAttraction 參數或任何「疊加」
// 邏輯。
//
// isCancelled:呼叫端傳入,查詢完成時若已經是「這次已不算數」的狀態
// 就不寫回 state,理由同 resolvePlaceForStep 的同名參數。
//
// onSettled:2026-09 真實踩坑記錄——add_attraction(onagent 對話路徑)
// 插入的佔位卡一開始不帶 lat/lng(座標要等這支函式查完才有,對比模擬
// WS 腳本路徑 planActionToInsert 的固定資料本身就帶座標),若
// maybeInsertTransitBefore(現已改名 refreshTransitForStop,見該函式的
// 完整說明)的觸發判斷留在 insertAttractionAfter 插入當下同步檢查
// data.lat/data.lng,onagent 路徑插入的節點必然沒有座標、判斷恆為
// false,導致交通卡從未被觸發過——這裡改成在這次查詢完成(不論成功或
// 失敗)之後才呼叫這個 callback,讓呼叫端(insertAttractionAfter)在
// 這個時間點才觸發交通查詢。單段查詢下「查詢完成」就等同「座標定案」,
// 不再需要區分「所有查詢動作都做完」這種多段情境。
function resolveAttractionForStep(
  stepId: string,
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; googlePhotoUrls?: string[]; lat?: number; lng?: number; attractionId?: string }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  isCancelled: () => boolean,
  onSettled: (lat: number, lng: number) => void,
) {
  fetchPlaceDetails(placeId)
    .then((details) => {
      if (isCancelled()) return
      if (details.found === false || details.lat == null || details.lng == null) {
        // 查無此地(理論上不該發生,placeId 應該總是有效——來自
        // search_attraction 查到的候選或使用者剛查過的地名)——退回
        // 訊息本身帶的假資料,不留在「查詢中」的狀態卡住,理由同
        // resolvePlaceForStep 的同類分支。這裡沒有可用的座標,不呼叫
        // onSettled——沒有座標就無從估算交通時間,理由同
        // refreshTransitForStop 本身「沒有座標就清空」的既有判斷。
        setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
        // failed 明確清掉——這次(可能是重試)成功了,節點不該還留著
        // 上一次的失敗標記。
        failed: false,
        name: details.name,
        desc: details.summary,
        googlePhotoUrls: details.googlePhotoUrls,
        lat: details.lat,
        lng: details.lng,
        placeId,
      }))
      onSettled(details.lat, details.lng)
    })
    .catch(() => {
      if (isCancelled()) return
      setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
    })
}

// refreshTransitForStop — 重新計算 stopId 這個 stop 節點的
// transitFromPrev(見 planTimeline.ts TransitInfo 的完整說明)。
//
// 2026-09 取代原本的 maybeInsertTransitBefore:原本交通卡是獨立插入
// 鏈結的 'transit' 節點,靠鏈結位置隱含表達「這張卡屬於哪兩站」,移除
// 中間站時會讓兩張舊交通卡黏在一起、都指向已經消失的站(見
// planTimeline.ts TransitInfo 開頭引用的完整踩坑記錄)。改成資料直接掛
// 在「到達站」(stopId 這一站)身上後,「這張交通卡屬於哪兩站」變成
// stopId 本身與它目前的 prevId,關係顯式且唯一,不再需要另一個節點
// 型別。
//
// 呼叫時機——任何造成 stopId 這一站「前一站」改變的操作之後都要呼叫:
//   1. 插入新 stop 節點成功、座標定案時(原 maybeInsertTransitBefore 的
//      觸發點)——呼叫 refreshTransitForStop(newId, ...)。
//   2. 移除一個 stop 節點後,若它的 nextId 也是 stop——那一站的前一站
//      變了(removeNode 已經同步清空它的 transitFromPrev,見該函式的
//      完整說明),呼叫 refreshTransitForStop(nextId, ...) 重新查一次
//      新的兩站之間的交通。
//   3. 前一站座標更新時(resolveAttractionForStep 第二段 place 查詢
//      覆蓋座標)——若這一站的 nextId 是 stop,它的 transitFromPrev 是
//      基於舊座標算的,同樣需要重新查(使用者明確要求「當前一個站點有
//      異動時,要觸發重新推估」)。
//
// 用 getTimeline()(而非讀取某個 React state)取得呼叫當下的最新鏈結,
// 理由同原 maybeInsertTransitBefore 對 timelineRef.current 的既有說明:
// 呼叫這個函式的時間點通常是 commitTimeline 已經完成之後,需要讀到最新
// 結果,不能仰賴可能還沒 flush 的 React state。
//
// 前一站不是 stop(例如是 section/note,或沒有前一站)或沒有座標(反查
// 地點資料尚未完成的 loading 中節點),直接把 transitFromPrev 清成
// undefined,不查詢——沒有兩個明確座標就無從估算,不勉強留著一張資料
// 不全的卡片或殘留舊資料。
function refreshTransitForStop(
  stopId: string,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  getTimeline: () => PlanTimeline,
  // dataSource——讀取層(見 planAiDataSource.ts 的完整說明)。2026-10
  // 從寫死的 planAiFakeDataSource import 改成參數注入,讓這條路徑跟
  // 推論層一樣可以整個抽換:公開展示頁注入假資料實作,登入後的自動
  // 播放注入真後端實作。
  dataSource: PlanAiDataSource,
) {
  const timeline = getTimeline()
  const stopNode = timeline.nodes.get(stopId)
  if (!stopNode || stopNode.type !== 'stop' || stopNode.lat == null || stopNode.lng == null) return
  const prevNode = stopNode.prevId != null ? timeline.nodes.get(stopNode.prevId) : null
  // (prevNode.day ?? 1) !== (stopNode.day ?? 1)——使用者明確要求「排程
  // 元件加入日的概念」後,跨天(day 不同)的前後兩站不該顯示交通卡:
  // 中間隔了一夜,不是使用者會實際移動的路線,「走路 X 分鐘」這種數字
  // 沒有意義。跟「前一站不是 stop/沒有座標」同樣視為沒有可比較的前一
  // 站,直接清空 transitFromPrev、不查詢。省略 day 視為第 1 天,理由同
  // planTimeline.ts PlanNodeData.day 的完整說明。
  if (
    !prevNode ||
    prevNode.type !== 'stop' ||
    prevNode.lat == null ||
    prevNode.lng == null ||
    (prevNode.day ?? 1) !== (stopNode.day ?? 1)
  ) {
    setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: undefined }))
    return
  }

  // 2026-09:先掛 loading:true 的佔位狀態再背景查詢,是使用者明確要求
  // 「路程推估前端載入中要做一點動畫」的直接落地——後端加了
  // 800~1500ms 的故意延遲(見 plan_sim_ws.go transitEstimateMinDelay/
  // transitEstimateMaxDelay 的完整說明)讓查詢感更真實,若不先掛佔位,
  // 使用者會看著站點卡片插入後有一段空白等待期,不知道系統正在做什麼
  // ——這跟 stop 節點本身「先掛查詢中佔位卡、查完再補上真實資料」(見
  // resolveAttractionForStep 的完整說明)是同一種使用者體感設計。
  const prevId = prevNode.id
  setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: { loading: true } }))

  const from = { lat: prevNode.lat, lng: prevNode.lng }
  const to = { lat: stopNode.lat, lng: stopNode.lng }
  dataSource.transitEstimate(from, to)
    .then((estimate) => {
      setTimeline((prev) => {
        // 這一站可能已經被使用者操作移除,或它的前一站在查詢期間又
        // 再次變動(見上方呼叫時機第 2/3 點——若查詢期間又觸發了一次
        // 新的 refreshTransitForStop,這次的結果已經過時),此時直接
        // 放棄更新,理由同其餘背景查詢完成後的既有「重新確認節點仍
        // 存在」慣例(見 resolveAttractionForStep 的完整說明)。
        const current = prev.nodes.get(stopId)
        if (!current || current.prevId !== prevId) return prev
        return updateNode(prev, stopId, {
          transitFromPrev: {
            loading: false,
            icon: estimate.icon,
            mode: estimate.mode,
            minutes: estimate.minutes,
            distance: estimate.distance,
          },
        })
      })
    })
    .catch(() => {
      // 查詢失敗(網路問題)——清空 transitFromPrev,不留一張永遠轉圈的
      // 交通卡卡住畫面。理由同其餘背景查詢失敗時的既有降級慣例:交通卡
      // 是加值資訊,查不到就維持沒有這張卡的狀態,不阻塞或干擾主要的
      // 行程安排流程。同樣先確認這一站與前一站的關係沒有在查詢期間變動
      // 過,理由同上方 .then 分支。
      setTimeline((prev) => {
        const current = prev.nodes.get(stopId)
        if (!current || current.prevId !== prevId) return prev
        return updateNode(prev, stopId, { transitFromPrev: undefined })
      })
    })
}

// usePlanSimSocket — 連上模擬 AI 推論輸出的 WebSocket(見上方檔案開頭
// 的完整說明),把收到的每則 PlanAction 轉成插入操作、交給
// insertAttractionAfter 統一處理(見該函式的完整說明);add_stop 訊息帶
// placeId 時,insertAttractionAfter 內部會額外觸發
// fetchPlanAiPlaceDetailsAny 非同步查詢,查完後補上真實資料。回傳
// { steps, isGenerating },掛載時自動建立一次 PlanSimSource(見該檔案
// 開頭的完整說明)從頭播到 done——使用者明確要求這個頁面「預設進入會
// 全部播放,用來展示功能用的」,不是原始版本那種可開關/重播/單步推進/
// 測試按鈕觸發額外訊息的互動模擬器,故不再需要 simEnabled 參數、
// restart/stop/sendTrigger 這幾個控制函式,以及呼叫端對應的「開啟模擬」
// 「重播」「下一步」「測試按鈕」UI(見 plan-ai-sim/Content 主體對這批
// 按鈕的移除說明)。
//
// start——是否已經可以開始播放,由呼叫端(plan-ai-sim/Content 主體)傳入。
// 使用者明確要求「輸入文字送出後,才觸發開始安排」:假打字動畫(見
// typedPrompt 的完整說明)先模擬使用者輸入完成、「送出」這個動作,
// 播放劇本要等這個動作發生後才開始,不是一進頁面兩件事同時跑,不然會
// 看起來像是行程在使用者話都還沒打完就自己生成了。false 時 effect
// 提早 return,不建立 PlanSimSource,steps 維持空陣列。
// export——供 AiPlanPhoneDemoScreen.tsx(2026-10 新增,見該檔案檔頭的
// 完整說明:功能介紹頁的手機展示框改成直接嵌入一個寫死手機版面的獨立
// 元件,不再透過 iframe 嵌入這個頁面本身)共用同一套劇本模擬邏輯,不
// 需要複製貼上一份——這個 hook 內部只呼叫同檔案的私有輔助函式
// (planActionToInsert/resolveAttractionForStep/refreshTransitForStop
// 等),這些函式不需要跟著一起 export,JS 模組內部呼叫不受影響。
// createSource——選填的來源工廠,讓呼叫端注入不同的播放節奏。
// 省略時用 createPlanSimFakeSource(計時器自動播完,/ai-plan 展示頁的
// 既有行為);首頁的捲動展示傳 createPlanSimScrollSource,改由捲動位置
// 推進(見 planSimScrollSource.ts 的完整說明)。
//
// 回傳值裡額外帶出 source——捲動版需要拿到它才能呼叫 advanceTo(),
// 計時器版的呼叫端忽略即可。
export function usePlanSimSocket(
  start: boolean,
  createSource: () => PlanSimSource = createPlanSimFakeSource,
  // dataSource——讀取層,預設假資料(見 planAiDataSource.ts 的完整
  // 說明)。公開展示頁(/ai-plan、首頁小展示)不需要登入就能看,打
  // /internal/ 端點只會拿到 401,所以預設值必須是假資料;要接真後端
  // 的呼叫端自己注入 createPlanAiApiDataSource(cfg)。
  dataSource: PlanAiDataSource = planAiFakeDataSource,
) {
  // timeline 改用 useSyncedState(見該 hook 開頭的完整背景說明)取代單純
  // 的 useState——insertAttractionAfter(下方)呼叫來源是 AgentBridge 的
  // 原生 WebSocket onmessage,完全在 React 事件系統之外,需要「commit
  // 呼叫當下就同步拿到結果」這個保證,而不是仰賴 useState 的 updater
  // 會同步執行(這個假設在這個呼叫場景下不成立,見該 hook 開頭引用的
  // 真實踩坑記錄)。setTimeline 仍保留給不需要同步讀結果的異動(remove_step
  // 標記 removing、resolvePlaceForStep 背景補資料),用回原生 setState
  // 語意即可,不需要 commit 那一層。
  const [timelineRef, timeline, commitTimeline] = useSyncedState<PlanTimeline>(createEmptyTimeline)
  const setTimeline = useCallback((updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => {
    commitTimeline((current) => ({
      next: typeof updater === 'function' ? (updater as (prev: PlanTimeline) => PlanTimeline)(current) : updater,
      result: undefined,
    }))
  }, [commitTimeline])

  // dragStopTime——時間軸小圓點拖拉調整時間(使用者明確要求「時間軸的
  // 小圓點可以拖拉,上下拉動時調整時間,半小時為刻度」,原本只在正式頁
  // trip-plan/TripPlanPage.tsx 實作,這份展示原型檔案刻意沒有跟進——
  // 使用者後續明確要求「解除之前不改的限制」,把這個互動能力補到展示頁
  // 也能體驗)。寫法對齊 TripPlanPage.tsx 同名函式的設計,差異只在這份
  // 檔案沒有 cfg/後端呼叫,refreshTransitForStop 的簽名少一個參數(見
  // 該函式在這個檔案的完整說明)。
  const dragStopTime = useCallback((stopId: string, newTime: string): boolean => {
    const node = timelineRef.current.nodes.get(stopId)
    if (!node || node.type !== 'stop') return false
    setTimeline((prev) => updateNode(prev, stopId, { time: newTime }))
    refreshTransitForStop(stopId, setTimeline, () => timelineRef.current, dataSource)
    return true
  }, [setTimeline, timelineRef, dataSource])
  // retryStopLookup——地點查詢失敗的站點重新查詢。
  //
  // 2026-10（review 發現）：這個檔案的 resolveAttractionForStep 失敗分支
  // 跟 TripPlanPage 一樣標記 failed(兩邊逐行一致),但這裡原本**沒有任何
  // 消化路徑**——沒有重試入口、也沒有掛載重試,節點就永久停在錯誤狀態。
  // 那讓 failed 標記變成淨負面:改動前至少還會顯示劇本自帶的假資料名稱
  // (見 resolveAttractionForStep 失敗分支的既有註解「退回訊息本身帶的
  // 假資料」),標了 failed 卻無從恢復反而更糟。
  //
  // 寫法對齊 TripPlanPage 的同名函式:先把節點設回 loading 讓使用者看得出
  // 按鈕有反應,查詢結果由 resolveAttractionForStep 自己寫回。
  const retryStopLookup = useCallback((stopId: string) => {
    const node = timelineRef.current.nodes.get(stopId)
    if (!node || node.type !== 'stop' || !node.placeId) return
    setTimeline((prev) => updateNode(prev, stopId, { loading: true, failed: false }))
    resolveAttractionForStep(
      stopId,
      node.placeId,
      (placeId) => dataSource.placeDetails(placeId),
      setTimeline,
      () => !timelineRef.current.nodes.has(stopId),
      () => refreshTransitForStop(stopId, setTimeline, () => timelineRef.current, dataSource),
    )
  }, [setTimeline, timelineRef, dataSource])

  // isGenerating 初始值為 false——要等 start 變 true(打字動畫播完、
  // 視同「使用者送出」)才開始安排,見上方 usePlanSimSocket 的完整說明。
  const [isGenerating, setIsGenerating] = useState(false)
  // source——目前這次播放的來源實例,對外暴露讓捲動版呼叫 advanceTo()。
  const [source, setSource] = useState<PlanSimSource | null>(null)
  // latestInsertedStopIdRef——2026-10 新增(使用者明確回報「骨架卡轉成
  // 地點時就要拉到中間,目前是要等下一個骨架時才拉往中間」):這個
  // hook 本身不持有 selectedStopId(那是下游 useSimulatedStopsView 的
  // state,見該函式的完整說明),插入新地點站後無法直接呼叫對應的
  // setSelectedStopId。改用 ref 記下「最新插入的地點站 id 是誰」,讓
  // useSimulatedStopsView 在 steps 更新時讀取並同步選取,不需要把
  // selectedStopId 這個 state 整個搬到這個 hook 來。用 ref 而非回傳值
  // 直接驅動 state,是因為這個賦值跟 setTimeline 不在同一個 React
  // 批次更新時機保證內(insertAttractionAfter 呼叫來源可能是原生
  // WebSocket onmessage,見上方 useSyncedState 的完整說明),ref 讀寫
  // 本身沒有這個時機疑慮。
  const latestInsertedStopIdRef = useRef<string | null>(null)

  // insertAttractionAfter — 這是使用者明確要求的「機制跟介面由行程
  // 安排元件提供」的落地:不管是 add_attraction 工具(attractionTools.ts)
  // 還是下方模擬 WS 腳本路徑(ws.onmessage),都不自己組節點、自己呼叫
  // insertAfter,而是統一呼叫這裡暴露的介面,把 anchorId/節點資料交給
  // planTimeline.ts 的 insertAfter 統一驗證與插入(時間是否落在合理
  // 範圍、錨點是否存在,見該函式的完整說明)。這是使用者要求「模擬的
  // 部分也完全走這個路徑,不要有例外」的直接體現——兩條路徑不再各自
  // 維護一份插入邏輯,驗證失敗時的行為也完全一致(見下方呼叫端如何
  // 處理 result.ok === false)。
  //
  // 用 commitTimeline(useSyncedState 提供,見該 hook 的完整背景說明)
  // 取代手寫的「讀 ref → 算 → 寫 ref → setState」四步——這個 hook 就是
  // 把這四步收斂成的固定寫法,存在的理由正是這裡先前踩過的真實 bug
  // (add_attraction 曾經每次呼叫都以「Cannot read properties of
  // undefined (reading 'ok')」失敗,根因是誤以為 setState(updater) 的
  // updater 會同步執行)。compute 函式直接讀 current(保證是目前為止
  // 所有已提交更新疊加後的最新 timeline)同步算出 insertAfter 的結果,
  // 驗證失敗時不給 next(對應 useSyncedState 的「compute 不給 next 就不
  // 寫入」語意),commitTimeline 保證回傳值就是這次呼叫當下算出的
  // InsertAfterResult,不會是 undefined。
  //
  // id 由呼叫端決定並傳進來,這裡不重新生成——這個介面只負責「插入到
  // 哪裡、驗不驗證得過」,不負責「這個節點該叫什麼 id」這種跟呼叫端
  // 資料來源相關的細節(onagent 路徑用 agent-${attractionId}-
  // ${Date.now()},模擬 WS 路徑沿用後端腳本給的 action.id)。
  //
  // 插入成功後,若這筆帶 placeId 且是 loading 佔位狀態(見
  // attractionTools.ts addAttraction 的完整背景說明——LLM 只傳
  // placeId,不等任何後端查詢完成就回覆成功),在這裡背景觸發
  // fetchPlanAiPlaceDetailsAny 補上完整資料,理由與寫法對稱既有的
  // resolvePlaceForStep(模擬 WS 路徑原本自己觸發的同類邏輯,現在收斂
  // 到這裡統一處理,兩條路徑不用各自記得要觸發)——差別只在這裡查的是
  // 不受白名單限制的 place-details-any,且查詢完成後用 setTimeline
  // (而非 commitTimeline)寫回,因為這個背景更新不需要任何呼叫端同步
  // 拿到結果。
  //
  // 故意不 await 這個背景查詢、也不讓它影響 insertAttractionAfter 的
  // 回傳值——插入本身只做本地鏈結運算,立即返回,不因為等待或觸發
  // Google API 查詢而受限流影響,查詢延遲對使用者體感是卡片從佔位轉成
  // 完整內容,不是整個呼叫失敗。
  const insertAttractionAfter = useCallback(
    (anchorId: string | null, newId: string, data: PlanNodeData): ReturnType<typeof insertAfter> => {
      const result = commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        const inserted = insertAfter(current, anchorId, data, newId)
        if (!inserted.ok) return { result: inserted }
        // 新增一個景點(stop)就代表話題已經推進——把時間軸上其他還
        // 「新鮮」的對話訊息節點(message,見 planTimeline.ts PlanNodeType
        // 的完整說明)一併淡化(見 staleOtherAgentMessages 的完整說明,
        // 使用者明確要求「新景點加入後要淡化」)。只在新插入的是 stop
        // 時才觸發——插入 message 節點本身不代表話題推進,不該讓其他
        // message(包括它自己)跟著被標記成 stale。
        if (data.type !== 'stop') return { next: inserted.timeline, result: inserted }
        return { next: staleOtherAgentMessages(inserted.timeline, newId), result: inserted }
      })
      if (result.ok && data.placeId && data.loading) {
        resolveAttractionForStep(
          newId,
          data.placeId,
          (placeId) => dataSource.placeDetails(placeId),
          setTimeline,
          () => false,
          // onSettled——onagent 路徑插入的佔位卡一開始沒有座標(座標要
          // 等這支函式查完才有),交通查詢要等查詢完成、座標確定之後
          // 才觸發。refreshTransitForStop 自己會從 timeline 重新讀取
          // 這個節點目前的座標,不需要 onSettled 傳入的 lat/lng(這裡
          // 忽略,只借用它「查詢已完成」這個時機訊號)。
          () => refreshTransitForStop(newId, setTimeline, () => timelineRef.current, dataSource),
        )
      } else if (result.ok && data.type === 'stop' && data.lat != null && data.lng != null) {
        // 模擬 WS 腳本路徑(planActionToInsert)的固定資料本身就帶座標,
        // 插入當下即可同步觸發,不需要等任何背景查詢——理由同上方
        // onGotCoordinates 的完整說明,兩條路徑只是「座標何時可用」不同,
        // 觸發交通查詢這件事本身沒有差異。
        refreshTransitForStop(newId, setTimeline, () => timelineRef.current, dataSource)
      }
      return result
    },
    [commitTimeline, setTimeline],
  )

  // setNoteForStop — 把一則備註寫在某個既有節點自己身上(見 planTimeline.ts
  // NoteInfo 的完整說明),不是插入新節點——使用者明確要求「備註寫在
  // 景點的節點上」。用 commitTimeline(而非 setTimeline)取得跟
  // insertAttractionAfter 一致的「呼叫當下同步拿到結果」保證,理由同該
  // 函式的完整說明(呼叫來源同樣可能來自 AgentBridge 原生事件,完全在
  // React 事件系統之外)。
  //
  // 參數命名 anchorId(而非原本的 stopId)——使用者明確要求「agent tool
  // 發出的參數名稱保持一致,像是要附加在節點上的就要用 anchorId,不要
  // 創造多餘的命名」:這裡跟 insertAttractionAfter 的 anchorId 是同一種
  // 東西,都是「時間軸上某個既有節點的 id」,只是這裡是必填(不是
  // string | null——沒有「插在最前面」這種語意,備註一定要有明確的
  // 掛載對象),不因為語意細節不同就另外發明命名。
  //
  // 回傳型別對齊 insertAttractionAfter(ReturnType<typeof insertAfter>)
  // ——沒有新節點被建立,insertedId 這裡填入被寫入備註的 anchorId 本身,
  // 讓呼叫端(attractionTools.ts 的 add_note 工具)能用同一種「id 代表
  // 這次操作影響了哪個節點」的語意回報給 LLM,不需要為了這個操作另外
  // 發明一種結果形狀。anchorId 不是時間軸上既有節點時,回傳
  // anchor_not_found(語意上就是「找不到指定的節點」,沿用既有的
  // InsertAfterErrorCode,不需要為這裡另外新增一個錯誤代碼)。
  const setNoteForStop = useCallback(
    (anchorId: string, text: string, category: string | undefined): ReturnType<typeof insertAfter> => {
      return commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        if (!current.nodes.has(anchorId)) {
          return {
            result: {
              ok: false,
              error: { code: 'anchor_not_found', message: `找不到 id 為 "${anchorId}" 的節點,無法在它身上寫入備註。` },
            },
          }
        }
        const next = updateNode(current, anchorId, { note: { text, category } })
        return { next, result: { ok: true, timeline: next, insertedId: anchorId } }
      })
    },
    [commitTimeline],
  )

  useEffect(() => {
    // start 轉 false 時清空並停止——原本是直接 return(不清),因為
    // /ai-plan 的 start 只會 false→true 一次、不會再回去。捲動驅動的
    // 展示(首頁 ScrollPlanDemo)則會在使用者捲出視窗時把 start 設回
    // false,期待行程整個清掉、捲回來重新演一次(使用者明確要求「上滾的
    // 時候不用停留,做清除安排的動作」),所以這裡要真的重置。
    if (!start) {
      setTimeline(createEmptyTimeline())
      setIsGenerating(false)
      setSource(null)
      return
    }
    setTimeline(createEmptyTimeline())
    // isGenerating 不在這裡設 true——改由第一則 thinking 訊息驅動
    // (見下方 onMessage 的 thinking 分支)。
    //
    // 計時器版(createPlanSimFakeSource)建立後立刻開始播,兩種寫法的
    // 結果幾乎相同;但捲動版(createPlanSimScrollSource)要等使用者捲動
    // 才送出第一則,若在這裡就設 true,使用者還沒捲到時畫面會顯示
    // 「正在安排行程…」卻什麼都沒發生。改成由實際的 thinking 訊息驅動,
    // 兩種節奏都正確。
    // source——PlanSimSource(見該檔案開頭的完整說明)取代原本的
    // WebSocket 連線,建立後立即自動從頭播放固定劇本到 done,由 start
    // (見上方 usePlanSimSocket 的完整說明)決定何時建立。cancelled
    // 旗標理由同原本 WS 版本——避免 effect cleanup 之後,已經在飛行中的
    // setTimeout 回呼繼續寫入 state。
    const source = createSource()
    setSource(source)
    let cancelled = false

    const unsubscribeMessage = source.onMessage((action) => {
      if (cancelled) return
      if (action.type === 'done') {
        setIsGenerating(false)
        return
      }
      // thinking:不異動 steps(這裡提早 return 純粹是省一次沒有意義的
      // setSteps 呼叫,
      // 語意上也更清楚——這則訊息唯一的作用是讓 isGenerating 維持
      // true、思考動畫(呼吸點+骨架卡)持續顯示,不需要對時間軸資料做
      // 任何事)。
      // 2026-10:改成真的在這裡設 isGenerating(原本只是 return,
      // 由上方建立 source 時一次設 true)——捲動驅動的來源
      // (createPlanSimScrollSource)要等使用者捲動才送出第一則,
      // 在建立當下就設 true 會讓畫面顯示「正在安排」卻什麼都沒發生。
      // 改由實際的 thinking 訊息驅動,計時器版與捲動版都正確。
      //
      // 2026-10(第二輪,使用者明確要求「先分離推論中跟安排中的
      // 信號」):原本只要收到任何 thinking 就顯示骨架卡(isGenerating
      // = true),但劇本裡 thinking 前導的下一步不一定是 add_stop
      // (也可能是 add_message 這種純旁白訊息、或 add_note)——這種
      // 情況下骨架卡顯示了,下一步送達後卻完全沒有對應的地點卡片可以
      // 轉場(add_message/add_note 不會被 HorizontalPlanTimeline
      // 渲染成卡片,見該元件 stops 過濾邏輯的完整說明),使用者看到的
      // 是「骨架消失但畫面沒變化」,誤以為插入失敗。改成只在
      // action.nextType === 'add_stop'(見 PlanAction.nextType 的完整
      // 說明)時才設 isGenerating(true)——「安排中」(骨架卡)現在只
      // 對應「真的要安排一個新地點」,跟「推論中」(任何 thinking,
      // AI 正在運作但不一定產生可見的地點卡片)分開。
      if (action.type === 'thinking') {
        if (action.nextType === 'add_stop' && action.nextId) {
          setIsGenerating(true)
          // 2026-10 使用者明確要求「安排中時就加入一張卡片,只是這張
          // 卡片沒有資料時就呈現骨架卡」:插入一筆空白的 loading stop
          // 節點,id 用 action.nextId(即將到達的 add_stop 訊息會用的
          // 同一個 id,見 PlanAction.nextId 的完整說明)——之後真正的
          // add_stop 訊息到達時(見下方),改用 updateNode 原地把這筆
          // 節點補上完整資料,而不是插入另一筆新節點。沒有 name/time/
          // placeId/lat/lng,HorizontalPlanTimeline 依 node.loading 且
          // 沒有資料的狀態自然渲染成骨架卡樣式(見該元件對 loading 節點
          // 的渲染邏輯),不需要額外的 isGenerating 分支渲染一塊獨立的
          // 骨架卡。錨點用目前時間軸最後一筆(跟 planActionToInsert 預設
          // 行為一致),接在已生成內容之後。
          const rendered = toRenderList(timelineRef.current)
          const anchorNode = rendered.length > 0 ? rendered[rendered.length - 1] : null
          const anchorId = anchorNode?.id ?? null
          // day——2026-10 使用者明確回報「第二天時,時間軸線會一直換成
          // 第一日又回來」:這筆空白佔位節點原本沒有帶 day,渲染層
          // (HorizontalPlanTimeline.tsx currentDay)用 node.day ?? 1
          // 退回預設值——若這個骨架卡出現在第二天行程正要開始排的時機
          // (前一筆錨點節點 day 是 2),骨架階段會被誤判成第一天,時間
          // 軸線先跳回 Day 1,等真正的 add_stop 資料(帶正確 day)透過
          // updateNode 補上才又跳回 Day 2,造成軸線來回跳動。改成延續
          // 錨點節點的 day(錨點通常就是上一個已完成的站點,新站點理論
          // 上屬於同一天,除非劇本本身的 add_stop.day 指定換天——那種
          // 情況下等真正資料到達時 updateNode 會覆蓋這裡的暫定值,不會
          // 錯誤停留在舊的 day)。沒有錨點(時間軸完全空白)時沿用原本
          // 預設第一天的語意。
          const anchorDay = (anchorNode && anchorNode.type === 'stop' ? anchorNode.day : undefined) ?? 1
          const result = insertAttractionAfter(anchorId, action.nextId, { type: 'stop', loading: true, day: anchorDay })
          if (!result.ok) {
            throw new Error(result.error.message)
          }
        }
        return
      }
      // 2026-10 使用者明確回報「第一個骨架下一個,直接就出現第一張卡跟
      // 第二個骨架,我要有只有第一個卡的狀態」:原本 isGenerating 只有
      // 整段劇本播完(done)才會變 false,每一站完成後它仍然是 true
      // (因為緊接著的下一則 thinking 往往馬上送到),骨架卡因此永遠
      // 跟著顯示,畫面上從來沒有「只有一張完整卡、沒有任何推論中信號」
      // 的穩定狀態。這裡非 thinking/done 的每一則訊息(代表某個具體動作
      // 真正完成,例如這一站/這則備註/這次移除處理完畢)處理前都先讓
      // isGenerating 變 false,骨架卡立即消失,只留這張剛完成的卡片,
      // 直到下一則 thinking 送達才重新變 true、骨架卡再次出現——讓
      // 「完成→停留→下一輪推論開始」這個節奏在畫面上真正看得到。
      setIsGenerating(false)
      // reset:清空時間軸(見 PlanAction.type 對這則訊息的完整說明)。
      // 來源在「使用者往回捲」時先送這則,再重播到目標進度。isGenerating
      // 已經在上面統一設成 false,這裡不需要重複設定。
      if (action.type === 'reset') {
        setTimeline(createEmptyTimeline())
        return
      }
      // reset_day:只清掉指定的那一天(見 PlanAction.type 的完整說明)。
      // 用 plan-core 的 removeDay——走訪鏈結、重接 prevId/nextId、處理
      // headId 都在那支純函式裡(資料操作統一在領域層,頁面層只呼叫,
      // 不自己改資料結構)。
      if (action.type === 'reset_day') {
        const day = action.day ?? 1
        setTimeline((prev) => removeDay(prev, day))
        return
      }
      // remove_step:先標記 removing(觸發 CSS 淡出),真正從鏈結摘除
      // 延遲到動畫播完後才做(見 removeNode/REMOVE_FADE_MS 的完整
      // 說明)——不然節點會瞬間消失,看不到淡出過程。這段標記邏輯不透過
      // insertAttractionAfter(那個介面只負責插入),直接用 setTimeline
      // 呼叫 updateNode,理由同模擬路徑其餘非插入類異動(移除本來就不是
      // 「機制跟介面由行程安排元件提供」這個要求要收斂的對象——那個要求
      // 針對的是插入邏輯不能有兩份,移除邏輯只有這一條路徑,沒有重複可言)。
      if (action.type === 'remove_step' && action.removedId) {
        const removedId = action.removedId
        setTimeline((prev) => updateNode(prev, removedId, { removing: true }))
        setTimeout(() => {
          if (cancelled) return
          // 移除前記下 nextId——removeNode 本身已經同步清空這個節點(若
          // 是 stop)的 transitFromPrev(見該函式的完整說明),這裡摘除
          // 後還要背景重新查一次「新的前一站→這一站」的交通,理由同
          // refreshTransitForStop 開頭列出的呼叫時機第 2 點(使用者明確
          // 要求「當前一個站點有異動時,要觸發重新推估」)。
          const nextId = timelineRef.current.nodes.get(removedId)?.nextId
          // removeNode 現在回傳結構化結果(見該函式/RemoveNodeResult 的
          // 完整說明,這份原型檔案本身不受那次異動影響,純粹配合新的
          // 回傳型別簽名)——找不到節點或已被移除時原樣保留 prev,不是
          // 行為變更。allowRemoving:true 是必要的:這裡呼叫的節點必然
          // 是上面那行剛標記的 removing:true,是這個兩段式流程「完成
          // 移除」的第二步,不帶這個旗標會被新版 removeNode 的
          // already_removing 檢查誤判成重複移除而拒絕,導致節點永遠
          // 卡在 removing:true 佔位不消失(見 removeNode
          // opts.allowRemoving 的完整說明,這是曾經實際發生過的
          // regression)。
          setTimeline((prev) => {
            const result = removeNode(prev, removedId, { allowRemoving: true })
            return result.ok ? result.timeline : prev
          })
          if (nextId != null) refreshTransitForStop(nextId, setTimeline, () => timelineRef.current, dataSource)
        }, REMOVE_FADE_MS)
        return
      }
      // add_note:不再插入新節點(見 STEP_ADD_TYPES 的完整說明,note 已
      // 移出 planActionToInsert 的處理範圍),直接呼叫 setNoteForStop 把
      // 備註寫在 action.afterId 指定的既有節點身上——語意對齊
      // attractionTools.ts AttractionStepsCtx.addNote 的 anchorId 參數
      // (見該介面的完整說明),afterId 缺漏時代表腳本本身沒有指定要
      // 寫在哪個節點上,同 toInsert.anchorId 找不到節點的處理原則(使用者
      // 明確要求「模擬的部分也完全走這個路徑,不要有例外」),讓
      // setNoteForStop 因找不到節點而回傳 anchor_not_found、直接拋錯,
      // 不做寬容降級。
      if (action.type === 'add_note') {
        const result = setNoteForStop(action.afterId ?? '', action.text ?? '', action.category)
        if (!result.ok) {
          throw new Error(result.error.message)
        }
        return
      }
      // 2026-10 使用者明確要求「安排中時就加入一張卡片,只是這張卡片
      // 沒有資料時就呈現骨架卡」:add_stop 訊息到達時,通常前面的
      // thinking 已經用這個 action.id 當 id 插入過一筆空白的 loading
      // 佔位節點(見上方 thinking 分支)——這裡改用 updateNode 原地
      // 補上完整資料,不再呼叫 insertAttractionAfter 插入另一筆新節點
      // (那樣會留下一個永遠空白的孤兒節點,且畫面上會出現兩張卡)。
      // 只有在真的找不到對應佔位節點時(理論上不該發生,thinking 一定
      // 先於對應的 action 送達,但防禦性地保留 fallback,避免未來劇本
      // 資料若有 thinking 被跳過的情況時整個卡住)才退回原本的插入路徑。
      if (action.type === 'add_stop' && action.id && timelineRef.current.nodes.has(action.id)) {
        const toUpdate = planActionToInsert(timelineRef.current, action)
        if (!toUpdate) return
        // staleOtherAgentMessages——理由同 insertAttractionAfter 對新插入
        // stop 的既有處理(見該函式呼叫處的完整說明):佔位節點原地轉成
        // 真正的地點站,同樣代表話題已經推進,其他還「新鮮」的對話訊息
        // 節點要一併淡化,不能因為這裡走的是 updateNode 而非插入新節點
        // 就漏掉這個效果。
        setTimeline((prev) => staleOtherAgentMessages(updateNode(prev, action.id!, toUpdate.data), action.id!))
        // insertAttractionAfter 原本插入成功後,若帶 placeId 且是 loading
        // 佔位狀態會背景觸發 resolveAttractionForStep 補資料(見該函式
        // 的完整說明)——這裡繞過 insertAttractionAfter 直接 updateNode,
        // 需要自己重做這一段背景查詢觸發,否則帶 placeId 的佔位卡永遠
        // 不會真的查到完整資料。
        if (toUpdate.data.placeId && toUpdate.data.loading) {
          resolveAttractionForStep(
            action.id,
            toUpdate.data.placeId,
            (placeId) => dataSource.placeDetails(placeId),
            setTimeline,
            () => false,
            () => refreshTransitForStop(action.id!, setTimeline, () => timelineRef.current, dataSource),
          )
        } else if (toUpdate.data.lat != null && toUpdate.data.lng != null) {
          refreshTransitForStop(action.id, setTimeline, () => timelineRef.current, dataSource)
        }
        // 2026-10 使用者明確回報「骨架卡轉成地點時就要拉到中間,目前是
        // 要等下一個骨架時才拉往中間」:見下方 latestInsertedStopIdRef
        // 的完整說明——這裡原地補資料,id 本來就沒變,同樣要記下來讓
        // useSimulatedStopsView 同步選取。
        latestInsertedStopIdRef.current = action.id
        return
      }
      // 新增類 action(含 add_message,見 STEP_ADD_TYPES 的完整說明):
      // 統一走 planActionToInsert + insertAttractionAfter
      // (見兩者的完整說明)——不再有模擬路徑專屬的 insertAfter 呼叫或
      // 「錨點找不到就退回 append 到最後一筆」的寬容降級,驗證失敗時
      // 的行為跟 onagent 對話路徑完全一致:真的拋錯中斷,不是靜默放棄
      // (使用者已確認選擇這個處理方式)。add_stop 帶 placeId 時的背景
      // 反查已經內建在 insertAttractionAfter 內部,這裡不需要再自己
      // 觸發一次 resolvePlaceForStep。
      const toInsert = planActionToInsert(timelineRef.current, action)
      if (!toInsert) return
      const result = insertAttractionAfter(toInsert.anchorId, toInsert.newId, toInsert.data)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      // 2026-10 使用者明確回報「骨架卡轉成地點時就要拉到中間,目前是
      // 要等下一個骨架時才拉往中間」:新插入的地點站 id 記下來,讓
      // useSimulatedStopsView(見該函式的完整說明)能在同一個 stops
      // 更新週期裡把 selectedStopId 同步指過去——這個 effect 所在的
      // usePlanSimSocket 本身不持有 selectedStopId 這個 state(它屬於
      // 下游的 useSimulatedStopsView),不能在這裡直接呼叫對應的
      // setter,只能先記錄「最新插入的站點是誰」。
      if (action.type === 'add_stop') {
        latestInsertedStopIdRef.current = toInsert.newId
      }
    })
    const unsubscribeError = source.onError(() => {
      if (!cancelled) setIsGenerating(false)
    })

    return () => {
      cancelled = true
      unsubscribeMessage()
      unsubscribeError()
      source.close()
    }
  }, [start])

  const steps = toRenderList(timeline)

  // clearTimeline——把時間軸清空。
  //
  // 「讓我試看看」按鈕用(使用者明確要求交接時清空時間軸):模擬跑完
  // 幾站之後使用者決定自己試,展示用的那幾站要先清掉,不能讓他以為
  // 那是自己排的。這個頁面的時間軸不持久化(純展示),所以只要清掉
  // 記憶體這份即可。
  const clearTimeline = useCallback(() => {
    commitTimeline(() => ({ next: createEmptyTimeline(), result: undefined }))
  }, [commitTimeline])

  return {
    steps,
    timeline,
    timelineRef,
    isGenerating,
    insertAttractionAfter,
    setNoteForStop,
    dragStopTime,
    clearTimeline,
    source,
    latestInsertedStopIdRef,
    // retryStopLookup——見該函式的完整說明。匯出給呼叫端接到
    // PlanTimelineView 的 onRetryStop。
    retryStopLookup,
  }
}

// NOTE_STYLES/DEFAULT_NOTE_CATEGORY——2026-10 移除:備註分類→顏色/圖示
// 的對照表現在收在 plan-core/PlanTimelineView.tsx 裡(改用該共用元件
// 渲染時間軸後,這裡不再自己畫備註列,見該檔案同名常數的完整說明)。
// action.category 仍直接原樣傳給 setNoteForStop,不在這裡做合法性
// fallback——跟正式頁 TripPlanPage.tsx 的 addNoteToTimeline 不同,
// 那裡會 fallback 成 DEFAULT_NOTE_CATEGORY,但使用者對模擬腳本的既有
// 要求是「不要有例外」(見下方 add_note 分支的完整說明),劇本本身保證
// category 合法,不需要呼叫端介入。

