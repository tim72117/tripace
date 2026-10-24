import type { PlanAction } from './planAction'
import { useEffect, useRef, useState } from 'react'
import { usePlanTimelineCore } from '../../plan-core/usePlanTimelineCore'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import type { PlanAiDataSource } from './planAiDataSource'
import { createPlanSimFakeSource } from './planSimFakeSource'
import type { PlanSimSource } from './planSimSource'
import { usePlanConversation } from '../../plan-core/usePlanConversation'
import { createEmptyTimeline, removeDay, lastAppendTarget, updateNode, type PlanNodeData, type PlanTimeline, countNodes, hasNode } from '../../plan-core/planTimeline'

// STEP_ADD_TYPES——需要走 planActionToInsert(插入新節點)的訊息型別。
// 2026-09 重構:'add_note' 移出這個集合——note 不再是插入到時間軸裡的
// 獨立節點,改成掛在既有節點自己身上的欄位(見 planTimeline.ts NoteInfo
// 的完整說明),ws.onmessage 改成另外特判這個型別、直接呼叫
// setNoteForStop(見該處的完整說明),不再經過 planActionToInsert 這個
// 「組出插入用三元組」的轉換路徑——沒有新節點被插入,自然不需要它。
//
// 'add_message'——2026-10-24 移出這個集合:對話訊息不再是時間軸節點,改寫進獨立的對話狀態
// (plan-core/planConversation.ts,由這個 hook 內的 usePlanConversation 持有,模擬態不持久化),
// ws.onmessage 另外特判這個型別、直接 appendMessage,不經過 planActionToInsert。
const STEP_ADD_TYPES: ReadonlySet<PlanAction['type']> = new Set(['add_stop'])

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
  const id = action.id ?? `${action.type}-${countNodes(timeline)}`
  const data: PlanNodeData = {
    type: 'stop',
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
    // placeId:add_stop 訊息帶 placeId 時,insertAttractionAfter 內部另外用它查完真實資料
    // (見 plan-core/resolveAttractionForStep.ts),查詢期間在節點狀態表標 loading(縮圖/敘事文字先用訊息本身的
    // 假資料佔位)——是「先掛佔位卡、查到再補上」,才能忠實呈現「AI 呼叫工具查詢中」這個過程。節點本身不帶 loading。
    lat: action.lat,
    lng: action.lng,
    attractions: action.attractions,
    places: action.places,
    farFromNext: action.farFromNext,
    candidateCards: action.candidateCards,
  }
  // 沒帶 afterId 時接在整條時間軸最後面:錨點是最後一個節點(最後一天是空的就沒有錨點),
  // 天在劇本沒指定時沿用最後一天,這樣放進空的最後一天也不會掉回第 1 天。
  if (action.afterId != null) return { anchorId: action.afterId, newId: id, data }
  const tail = lastAppendTarget(timeline)
  return { anchorId: tail.anchorId, newId: id, data: { ...data, day: data.day ?? tail.day } }
}

// needsLookupForScript——模擬劇本的站點(add_stop)自帶座標與 placeId,仍要向(假)資料來源查一次地點,
// 呈現「AI 呼叫工具查詢中」的過程,所以只要有 placeId 就查;共用 core 的預設是「有 placeId 且沒座標」。
// 兩段淡出時長(REMOVE_FADE_MS)已搬到 plan-core/usePlanTimelineCore.ts,與 CSS 同值的說明在那裡。
function needsLookupForScript(data: PlanNodeData): boolean {
  return !!data.placeId
}

// CTA_AFTER_STOPS——模擬排到第幾站時,把輸入膠囊的送出鈕換成「立即
// 使用」行動呼籲按鈕(見下方 composerCollapsed 的完整說明)。
export const CTA_AFTER_STOPS = 5

// 站點的真實地點資料查詢(resolveAttractionForStep)用 plan-core 共用的那一份:2026-10 之前這裡有一份私有副本
// (沒有 429 限流重試、不保留內容),現在與 /app、行程詳情頁同一條路徑。loading/failed 寫進本 hook 持有的節點狀態表
// (usePlanNodeStatus),名稱/說明/座標寫回節點,照片由視圖經 useResolvedNodeRefs 以 placeId 解析。

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
  // 對話(模擬劇本的 add_message)——獨立於時間軸的狀態,不傳 store = 純記憶體不持久化
  // (公開頁的自動播放腳本不該污染使用者真實的對話存檔,理由同這裡的時間軸不持久化)。
  // 宣告在時間軸之前:新增站點讓舊訊息淡化(staleAll)要接進時間軸 core 的 onStopInserted。
  const { messages, conversationRef, appendMessage, staleAll, clearConversation } = usePlanConversation()

  // 時間軸狀態與鏈結操作全部由共用的 usePlanTimelineCore 持有(2026-10 收斂:原本這裡自己有一份 useSyncedState、
  // insertAttractionAfter、setNoteForStop、removeStep、dragStopTime、retryStopLookup、clearTimeline,與 /app 的
  // TripPlanPage 逐行重複,見 docs/research-timeline-core-comparison-2026-10.md)。
  //   - 不傳 store = 純記憶體不持久化(公開頁的自動播放腳本不該蓋掉使用者在 /app 排好的真實草稿);
  //   - dataSource:地點詳情/交通估算用假資料(預設 planAiFakeDataSource),要接真後端的呼叫端自己注入;
  //   - needsLookup:劇本的站點自帶座標與 placeId,仍要走一次查詢呈現「AI 查地點」的過程,所以只要有 placeId 就查
  //     (core 預設是「有 placeId 且沒座標」);
  //   - onStopInserted:新增站點代表話題已經推進,把還「新鮮」的對話訊息淡化(使用者明確要求「新景點加入後要淡化」);
  //   - 不傳 onBeforeMutate(模擬態沒有自動捲動抑制,橫向軸用 useSimulatedStopsView 的選取跟隨)、不開 retryFailedOnMount
  //     (不持久化,重整即清空,沒有殘留的失敗站點)。
  const {
    timeline,
    timelineRef,
    nodeStatus,
    setStatus,
    setTimeline,
    insertAttractionAfter,
    followUpStop,
    setNoteForStop,
    removeStep,
    dragStopTime,
    retryStopLookup,
    clearTimeline,
  } = usePlanTimelineCore({
    dataSource,
    needsLookup: needsLookupForScript,
    onStopInserted: staleAll,
  })

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
          // placeId/lat/lng,HorizontalPlanTimeline 依狀態表的 loading 且
          // 沒有資料的狀態自然渲染成骨架卡樣式(見該元件對 loading 節點
          // 的渲染邏輯),不需要額外的 isGenerating 分支渲染一塊獨立的
          // 骨架卡。錨點用目前時間軸最後一筆(跟 planActionToInsert 預設
          // 行為一致),接在已生成內容之後。
          const { anchorId, day: anchorDay } = lastAppendTarget(timelineRef.current)
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
          const result = insertAttractionAfter(anchorId, action.nextId, { type: 'stop', day: anchorDay })
          if (!result.ok) {
            throw new Error(result.error.message)
          }
          // 骨架卡:在狀態表標 loading(節點本身只是空的行程資料)。等真正的 add_stop 資料補上後清掉。
          setStatus(action.nextId, { loading: true })
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
      // 對話也一併清空:往回捲重播時訊息會依劇本重新出現,留著舊的會殘留「還沒播到」的訊息。
      if (action.type === 'reset') {
        setTimeline(createEmptyTimeline())
        clearConversation()
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
      // remove_step:兩階段移除(標 removing 觸發淡出,動畫播完才摘除並補算下一站交通)由共用 core 的 removeStep 負責,
      // 內含重複指示擋下、卸載保護與 reset 後同 id 重播不誤殺;劇本保證 id 合法,回傳值不需要處理。
      if (action.type === 'remove_step' && action.removedId) {
        removeStep(action.removedId)
        return
      }
      // add_message:對話訊息寫進獨立的對話狀態(見 STEP_ADD_TYPES 的說明),不動時間軸。id 重複(reset_day 重播同一段劇本)
      // 時 appendMessage 原樣忽略——訊息沒有所在天的資訊(使用者決定只依時間順序),reset_day 清不掉「那一天的訊息」,
      // 重播時同一則訊息是 no-op;這只影響模擬態桌面對話氣泡的淡化狀態,不會重複顯示。
      if (action.type === 'add_message') {
        appendMessage({ id: action.id ?? `msg-${conversationRef.current.messages.length}`, text: action.text ?? '' })
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
      if (action.type === 'add_stop' && action.id && hasNode(timelineRef.current, action.id)) {
        const toUpdate = planActionToInsert(timelineRef.current, action)
        if (!toUpdate) return
        setTimeline((prev) => updateNode(prev, action.id!, toUpdate.data))
        // 淡化對話訊息——理由同 insertAttractionAfter 對新插入 stop 的既有處理:佔位節點原地轉成真正的地點站,
        // 同樣代表話題已經推進,不能因為這裡走的是 updateNode 而非插入新節點就漏掉這個效果。
        staleAll()
        // 繞過 insertAttractionAfter 原地補資料,需要自己接上插入後的背景流程(反查地點/重算交通/收掉骨架的 loading):
        // 用 core 的 followUpStop,與插入路徑同一段邏輯,否則帶 placeId 的佔位卡永遠不會查到完整資料。
        followUpStop(action.id, toUpdate.data)
        // 2026-10 使用者明確回報「骨架卡轉成地點時就要拉到中間,目前是
        // 要等下一個骨架時才拉往中間」:見下方 latestInsertedStopIdRef
        // 的完整說明——這裡原地補資料,id 本來就沒變,同樣要記下來讓
        // useSimulatedStopsView 同步選取。
        latestInsertedStopIdRef.current = action.id
        return
      }
      // 新增類 action(目前只有 add_stop,見 STEP_ADD_TYPES 的完整說明):
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

  return {
    timeline,
    timelineRef,
    // nodeStatus——節點執行狀態表,傳給時間軸視圖(PlanTimelineView/HorizontalPlanTimeline 的 nodeStatus prop)。
    nodeStatus,
    // messages/clearConversation——模擬劇本 add_message 寫進的對話(獨立於時間軸、不持久化,
    // 交接給推論層時由呼叫端 clearConversation,對應 clearTimeline)。
    messages,
    clearConversation,
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

