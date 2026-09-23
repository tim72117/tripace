import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { AgentBridge } from '@onagent/bridge'
import { fetchPublicGeoPlaceDetailsAny, type ClientConfig } from '../api'
import { BASE_URL } from '../AppCommon'
import { getTheme } from '../theme'
import { NativeMapBase, type MapHandle } from '../geo-planning/NativeMapBase'
import { toAgentBridgeTools } from '../sdk-proposals/toAgentBridgeTools'
import { useSyncedState } from '../hooks/useSyncedState'
import { createAttractionToolsList, type AttractionStepsCtx, type PlanStepLike } from './attractionTools'
import {
  createEmptyTimeline,
  insertAfter,
  removeNode,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanTimeline,
} from './planTimeline'
import styles from './AIPlanTimelinePage.module.css'

// 台南安平區域的預設中心點——右上角小地圖初始顯示整個 Day 1 行程涵蓋的
// 大致範圍(赤崁樓/祀典武廟一帶到安平古堡一帶的中點),還沒點過任何卡片
// 時顯示這裡,而不是空白/未初始化狀態。
const DEFAULT_MAP_CENTER = { lat: 23.001, lng: 120.182 }
const DEFAULT_MAP_ZOOM = 13
const SELECTED_MAP_ZOOM = 16

// GUEST_CFG:免登入查詢用——這個頁面不接使用者的 JWT(見檔案開頭「純
// 前端假資料展示」的完整說明),沿用 AppCommon.tsx 的 BASE_URL(建置時
// VITE_API_BASE,或退回目前頁面 origin)。同時是 WebSocket 連線位址的
// 來源(見 usePlanSimSocket)。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

// AIPlanTimelinePage — 「AI 安排行程」時間軸展示原型的正式頁面版本。
// 原型先在 Artifact(Design Component 畫布)做過一輪,經 Fable 設計方案
// (版面/時間軸視覺/逐步生成節奏/配色皆出自該輪討論)驗證整體概念後,
// 這裡重寫成 TypeScript + CSS Module,整合進 tripace 專案。
//
// 資料流(2026-09 重構,取代原本純前端 setTimeout 排時序的版本):後端
// server/internal/api/plan_sim_ws.go 的 GET /public/plan-sim/ws 模擬
// 「AI 安排行程」推論過程逐步推播 action 訊息(新增景點/交通/注記/
// 刪除某一步),前端(見下方 usePlanSimSocket/planActionToInsert)收到後
// 直接 dispatch 更新 steps 這個 state 陣列,畫面即時反應——這是使用者
// 明確要求的「結構化前端結構,讓上面的元素可以被新增跟刪除,並反應在
// 畫面上」「提供接口讓 agent 傳進來的訊息可以異動結構資料」的具體實作:
// steps state + planActionToInsert/insertAttractionAfter 就是這個
// 「接口」,只要來源送對格式的 action 訊息(不論是這支模擬 WS、之後
// 真正接上的 LLM 推論,或甚至是手動測試時透過 devtools console 呼叫
// dispatch),都能驅動同一套畫面更新邏輯,不需要為不同來源另外寫一份
// 渲染程式碼。
//
// add_stop 訊息若帶 placeId(見 PlanAction 型別的完整說明),代表「AI
// 呼叫了查地點工具」——插入後 insertAttractionAfter 內部用這個 id 呼叫
// fetchPublicGeoPlaceDetailsAny(GET /public/geo/place-details-any)取得
// 真正的地點名稱/簡介/照片,這是「把 place_id 串到前端、前端用 id 呼叫
// 端點顯示景點」這個需求的具體落地,不是後端直接把完整資料內嵌進訊息裡。
//
// 目前是純模擬展示(見下方「模擬」相關說明),不接真實 AI/LLM——路由
// /plan-ai(見 App.tsx),獨立於 /app 底下的正式導覽系統之外(不套用
// DesktopLayout.tsx/PhoneContent.tsx 那套 panelMode 機制),因為這只是
// 給團隊內部/使用者測試看的功能雛形,尚未有真正的資料流可以接。日後
// 若要正式化,只需要把 usePlanSimSocket 換成真正的 agent 推論 WS 來源
// (訊息格式維持一致),不需要動 planActionToInsert 或下方渲染邏輯。
//
// 視覺語言採用登入後正式 App 的 --ios-* token(base-ui.css),不是
// home/ 底下城市介紹頁那套 --paper/--ink 紙感和風——這個頁面示範的是
// 產品核心功能,不是行銷頁,視覺應該跟真正做出來的樣子一致。套用
// getTheme()(theme.ts,登入後 App 的深色模式偏好,寫 localStorage)
// 而非 home/ 那套純記憶體的 useThemeToggle,是同一個理由的延伸——這裡
// 展示的雖然還沒接真後端,但情境設定上就是登入後的畫面。

// PlanStep — 對外沿用的節點型別名稱(渲染邏輯/其餘函式仍稱呼它
// PlanStep,對齊既有命名),實際上就是 planTimeline.ts 的 PlanNode——
// 底層儲存已經改成 PlanTimeline(鏈結串列,見該檔案開頭的完整背景
// 說明),不再是普通陣列。這裡只是型別別名,不重新宣告欄位。
type PlanStep = PlanNode

// PlanAction — 後端 GET /public/plan-sim/ws(或日後任何真正的 agent
// 推論來源)推播的訊息形狀,對應 server/internal/api/plan_sim_ws.go 的
// planAction struct(欄位一一對應,JSON key 相同)。planActionToInsert
// 是新增類訊息的唯一轉換點,remove_step 的處理則直接寫在
// usePlanSimSocket 的 ws.onmessage 裡(見該處說明)。
interface PlanAction {
  // thinking:每一筆實際 action 送出前的「思考中」信號(見
  // plan_sim_ws.go 的完整說明),不帶任何額外欄位——前端收到時只用來
  // 觸發/延續思考動畫(呼吸點+骨架卡),不對時間軸做任何異動(見
  // ws.onmessage 對這個 type 的處理——提早 return,不呼叫
  // planActionToInsert)。
  type: 'thinking' | 'add_section' | 'add_stop' | 'add_transit' | 'add_note' | 'remove_step' | 'done'
  label?: string
  id?: string
  time?: string
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  placeId?: string
  lat?: number
  lng?: number
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
  color?: string
  noteIcon?: string
  text?: string
  removedId?: string
  // afterId:插入位置——有值時插在該 id 對應節點的「後面」,而不是固定
  // append 到時間軸尾端(既有預設行為,省略這個欄位時維持不變)。這是給
  // 「移除某個節點、緊接著插入一個新節點取代同一個時間槽」這種情境用
  // 的(見 AIPlanTimelinePage 下方 removeWumiao 測試按鈕的完整說明)。
  //
  // 2026-09:找不到對應節點時的行為改成跟 onagent 路徑(add_attraction
  // 的 anchorId)完全一致——直接讓 insertAttractionAfter 回傳
  // anchor_not_found 錯誤,由呼叫端(見 usePlanSimSocket 的 ws.onmessage)
  // 拋出例外。使用者明確要求「模擬的部分也完全走這個路徑,不要有
  // 例外」:原本這裡有一套「找不到就退回 append 到最後一筆」的寬容
  // 降級邏輯,是模擬腳本(plan_sim_ws.go)專屬的特例,現在拿掉——不管
  // 資料來源是模擬腳本還是 LLM 呼叫工具,「插入位置的錨點找不到」一律
  // 是需要被看見的錯誤,不是靜默吃掉繼續執行的正常情況(模擬腳本本身
  // 若送出無效的 afterId,那是腳本自己的 bug,應該讓它在這裡明確
  // 中斷、被發現,而不是悄悄插到錯的位置)。
  afterId?: string
}

const STEP_ADD_TYPES: ReadonlySet<PlanAction['type']> = new Set(['add_section', 'add_stop', 'add_transit', 'add_note'])

// planActionToInsert — 把一則新增類 PlanAction 轉成 insertAttractionAfter
// 需要的 (anchorId, newId, data) 三元組,不實際執行插入——純函式,呼叫端
// (usePlanSimSocket 的 ws.onmessage)拿到這三元組後統一呼叫
// insertAttractionAfter 完成插入與驗證,理由見 PlanAction.afterId 的
// 完整說明:模擬腳本與 onagent 對話兩條路徑現在共用同一個插入介面,
// 不再各自實作一份。
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
  const data: PlanNodeData = {
    type: action.type === 'add_section' ? 'section' : action.type === 'add_stop' ? 'stop' : action.type === 'add_transit' ? 'transit' : 'note',
    label: action.label,
    time: action.time,
    duration: action.duration,
    kind: action.kind,
    name: action.name,
    desc: action.desc,
    thumbBg: action.thumbBg,
    thumbIcon: action.thumbIcon,
    tags: action.tags,
    placeId: action.placeId,
    // loading:add_stop 訊息帶 placeId 時,這筆先以「查詢中」狀態掛進
    // 時間軸(縮圖/敘事文字用訊息本身的假資料佔位,見下方渲染邏輯),
    // 呼叫端(usePlanSimSocket)另外用這個 placeId 查完真實資料後,再
    // dispatch 一次「更新」把 loading 轉 false、photoUrl/desc 換成
    // 真實內容——這裡不是同步查完才 append,是「先掛佔位卡、查到再
    // 補上」,才能忠實呈現「AI 呼叫工具查詢中」這個過程本身,而不是
    // 讓使用者只看到查完的結果、跳過中間狀態。
    loading: action.type === 'add_stop' && !!action.placeId,
    lat: action.lat,
    lng: action.lng,
    icon: action.icon,
    mode: action.mode,
    minutes: action.minutes,
    distance: action.distance,
    color: action.color,
    noteIcon: action.noteIcon,
    text: action.text,
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

// resolvePlaceForStep — add_stop 帶 placeId 時,呼叫傳入的查詢函式取得
// 真實地點資料,查完後用 updateNode 補上(見 PlanNodeData.loading 的
// 完整說明)。
//
// 2026-09:模擬 WS 路徑與 onagent 對話路徑現在唯一的呼叫點是
// insertAttractionAfter 內部(見該函式的完整說明)——不管 placeId 來自
// 固定腳本還是 LLM 呼叫工具,一律用 fetchPublicGeoPlaceDetailsAny(不受
// 白名單限制)。fetchDetails 仍保留成參數(而非寫死呼叫這支函式),是
// 讓這個函式本身維持跟具體端點解耦、方便測試,不代表目前還有兩個呼叫點
// 各自傳不同的 fetchDetails。
//
// isCancelled:呼叫端傳入,查詢完成時若已經是「這次已不算數」的狀態
// (例如 WS 連線已經斷線重建),就不寫回 state——理由同原本 WS 分支的
// cancelled旗標。
function resolvePlaceForStep(
  stepId: string,
  placeId: string,
  fetchDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; photoUrl?: string; lat?: number; lng?: number }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  isCancelled: () => boolean,
) {
  fetchDetails(placeId)
    .then((details) => {
      if (isCancelled()) return
      // found === false:查詢本身成功(HTTP 200),但這個 placeId 查無
      // 資料(見 fetchPublicGeoPlaceDetailsAny 的完整說明,這是它跟
      // fetchPublicGeoPlaceDetails 的行為差異——後者查無資料時是 HTTP
      // 錯誤、會落進下面的 .catch,前者是正常回應)。found 欄位在
      // fetchPublicGeoPlaceDetails 的回應形狀裡不存在(恆為
      // undefined),故這裡用 `=== false` 明確排除、不誤判
      // fetchPublicGeoPlaceDetails 的正常回應。兩種「查無/查詢失敗」
      // 情境最終走向同一個退化處理:把 loading 轉 false,不留在「查詢
      // 中」的狀態卡住,理由同下方 .catch 分支。
      if (details.found === false) {
        setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
        name: details.name || undefined,
        desc: details.summary || undefined,
        photoUrl: details.photoUrl,
        lat: details.lat,
        lng: details.lng,
      }))
    })
    .catch(() => {
      if (isCancelled()) return
      // 查詢失敗(白名單外/網路問題)——把這一筆的 loading 轉 false,退回
      // 訊息本身帶的假資料(desc/thumbBg/thumbIcon 都還在,只是沒有真實
      // photoUrl),不留在「查詢中」的狀態卡住。
      setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
    })
}

// PLAN_SIM_ENABLED — 開關:是否連上 plan_sim_ws.go 那條模擬 WS 自動播放
// 固定腳本。曾經短暫停用過(只保留 onagent 對話串接這條路徑),現在
// 重新接上——後端已改成每筆實際 action 前都先送一則 thinking 訊號、
// 停頓一下才送出實際內容(見 plan_sim_ws.go 的 sendWithThinking/
// AIPlanTimelinePage 的 thinking 分支處理),不是簡化前那種訊息一來
// 就直接是內容的版本。關閉時(设為 false):
//   - usePlanSimSocket 的連線 effect 完全不建立 WebSocket(見下方判斷),
//     steps 維持初始空陣列,由 onagent 對話動態新增。
//   - isGenerating 初始值改為 false(而非模擬腳本情境下的預設 true)
//     ——沒有腳本在自動播放,不該一開始就顯示「正在安排 Day 1…」這種
//     暗示自動生成中的狀態,對話框應該立刻可用、等待使用者輸入。
//   - restart(重播按鈕)/stop(終止按鈕)在關閉時呼叫仍是安全的
//     no-op(stopRef.current 恆為 null),不需要額外的條件判斷去藏起
//     這兩顆按鈕——見下方 UI 是否要隱藏「重播」則是另一個獨立的呈現
//     決策,這裡只處理資料流本身。
const PLAN_SIM_ENABLED = true

// usePlanSimSocket — 連上模擬 AI 推論輸出的 WebSocket(見上方檔案開頭
// 的完整說明),把收到的每則 PlanAction 轉成插入操作、交給
// insertAttractionAfter 統一處理(見該函式的完整說明);add_stop 訊息帶
// placeId 時,insertAttractionAfter 內部會額外觸發
// fetchPublicGeoPlaceDetailsAny 非同步查詢,查完後補上真實資料。回傳
// { steps, isGenerating, restart },restart 用於「重播」按鈕——重新建立
// 一個新的 WebSocket 連線
// (後端每個連線各自從頭播放同一份固定腳本,見 plan_sim_ws.go 的完整
// 說明),不是在前端重放已經收到的訊息紀錄。PLAN_SIM_ENABLED 為 false 時
// (見該常數說明)整個連線 effect 提早 return,不建立任何 WebSocket。
function usePlanSimSocket() {
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
  const [isGenerating, setIsGenerating] = useState(PLAN_SIM_ENABLED)
  // generation:遞增觸發下方 effect 重新建立連線,理由與既有的「重播」
  // 機制一致(見先前版本 generation 欄位的完整說明:StrictMode 下用
  // 穩定的 callback 直接操作跨渲染共享 ref 容易有競態,改用 state 驅動
  // 一個乾淨的 effect、cleanup 只處理這次 effect 自己建立的資源)。
  const [generation, setGeneration] = useState(0)
  // stopRef——讓 stop()(見下方)能拿到「目前這次 effect 建立的
  // WebSocket 連線」並主動關閉,同時把 cancelled 旗標翻成 true,阻止
  // 任何已經在飛行中的訊息處理/setTimeout 回呼繼續寫入 state(理由同
  // effect cleanup 既有的 cancelled 用法)。用 ref 而非直接依賴 effect
  // 內的區域變數,是因為 stop() 這個 callback 要能在 effect 範圍外(由
  // 使用者點擊「終止」按鈕觸發)呼叫到「目前這一次」的連線與旗標,ref
  // 是跨這個邊界仍能讀到最新值的唯一方式。
  const stopRef = useRef<{ ws: WebSocket; markCancelled: () => void } | null>(null)

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
  // fetchPublicGeoPlaceDetailsAny 補上完整資料,理由與寫法對稱既有的
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
        return inserted.ok ? { next: inserted.timeline, result: inserted } : { result: inserted }
      })
      if (result.ok && data.placeId && data.loading) {
        resolvePlaceForStep(
          newId,
          data.placeId,
          (placeId) => fetchPublicGeoPlaceDetailsAny(GUEST_CFG, placeId),
          setTimeline,
          () => false,
        )
      }
      return result
    },
    [commitTimeline, setTimeline],
  )

  useEffect(() => {
    if (!PLAN_SIM_ENABLED) return
    setTimeline(createEmptyTimeline())
    setIsGenerating(true)
    const wsURL = `${BASE_URL.replace(/^http/, 'ws')}/public/plan-sim/ws`
    const ws = new WebSocket(wsURL)
    let cancelled = false
    stopRef.current = { ws, markCancelled: () => { cancelled = true } }

    ws.onmessage = (ev) => {
      if (cancelled) return
      let action: PlanAction
      try {
        action = JSON.parse(ev.data)
      } catch {
        return
      }
      if (action.type === 'done') {
        setIsGenerating(false)
        return
      }
      // thinking:不異動 steps(這裡提早 return 純粹是省一次沒有意義的
      // setSteps 呼叫,
      // 語意上也更清楚——這則訊息唯一的作用是讓 isGenerating 維持
      // true、思考動畫(呼吸點+骨架卡)持續顯示,不需要對時間軸資料做
      // 任何事)。
      if (action.type === 'thinking') return
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
          setTimeline((prev) => removeNode(prev, removedId))
        }, REMOVE_FADE_MS)
        return
      }
      // 新增類 action:統一走 planActionToInsert + insertAttractionAfter
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
    }
    ws.onerror = () => {
      if (!cancelled) setIsGenerating(false)
    }

    return () => {
      cancelled = true
      ws.close()
      // 只清掉「仍然是這次 effect 建立的那個連線」——如果 stopRef 已經
      // 被更新一輪 effect(下一次 generation)換成新連線,不該讓這次
      // cleanup 誤清掉別人的 stopRef。
      if (stopRef.current?.ws === ws) stopRef.current = null
    }
  }, [generation])

  const restart = useCallback(() => { setGeneration((g) => g + 1) }, [])

  // stop — 使用者點擊「終止」按鈕時呼叫:主動關閉目前這條 WebSocket
  // 連線、標記 cancelled,讓所有已在飛行中的訊息處理與
  // resolvePlaceForStep 非同步回呼都不再寫入 state(理由同 effect
  // cleanup 的既有 cancelled 用法),並把 isGenerating 立刻轉 false——
  // 這是「推論中時輸入框送出鈕換成終止鈕,終止時停止輸出信號」這個需求
  // 的核心:不是單純隱藏 UI 上的生成中狀態,是真的斷開連線讓後端不再
  // 送出任何後續訊息(WS 斷線後,plan_sim_ws.go 的 conn.Write 會直接
  // 失敗、該連線的模擬播放迴圈隨之結束,見該檔案的完整說明)。
  const stop = useCallback(() => {
    if (!stopRef.current) return
    stopRef.current.markCancelled()
    stopRef.current.ws.close()
    stopRef.current = null
    setIsGenerating(false)
  }, [])

  // sendTrigger — 對目前這條 WebSocket 連線送出一則
  // {"trigger":"..."} 請求,由後端(見 plan_sim_ws.go 的
  // planSimTriggerActions)決定要不要、以及送出什麼樣的 action 訊息
  // 回來——前端測試按鈕不再自己組 PlanAction、直接改本地 steps state,
  // 而是純粹「請後端送出模擬信號」。真正的畫面更新完全走上方
  // ws.onmessage 收到 action 訊息後的既有處理路徑(planActionToInsert/
  // insertAttractionAfter/resolvePlaceForStep),跟腳本自動推播的訊息走同一套
  // 邏輯,沒有任何前端自行捏造資料的分支。連線還沒建立好或已經終止時
  // (stopRef.current 為 null)靜默忽略,不拋錯——理由同按鈕本身的
  // disabled 條件,呼叫端應該先用 wumiaoPresent 等旗標擋掉不合理的
  // 呼叫時機,這裡只是最後一層防禦。
  const sendTrigger = useCallback((trigger: string) => {
    const ws = stopRef.current?.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ trigger }))
  }, [])

  const steps = toRenderList(timeline)

  return { steps, timeline, isGenerating, restart, sendTrigger, stop, insertAttractionAfter }
}

// PLAN_AI_ONAGENT_APP_ID/PLAN_AI_ONAGENT_URL——/plan-ai 對話窗專用的
// onagent app,跟 ChatScreen 正式對話路徑(useOnagentChatBridge.ts 的
// APP_ID='tripace')是完全不同的兩個 app(各自的 tool 定義/apiKey/
// Allowed origin 互不相關)。獨立成自己的 app 而不是共用 tripace app,
// 理由:這個頁面是純展示原型(見檔案開頭「純前端假資料展示」的完整
// 說明),它的工具(search_attraction/add_attraction)操作的是
// attractionPool.ts 這個假景點池,跟 tripace app 底下 trip_entry_*
// 操作真實使用者行程資料是完全不同的業務範疇,混在同一個 app 底下會讓
// tool 清單混雜不同性質的操作,也不利於各自獨立調整 Allowed
// origin/thought 設定。
const PLAN_AI_ONAGENT_APP_ID = 'plan-ai-timeline'
const PLAN_AI_ONAGENT_WS_URL = (
  (import.meta.env.VITE_PLAN_AI_ONAGENT_URL as string | undefined) ?? 'http://localhost:8090'
).replace(/^http/, 'ws') + '/ws'

export type PlanAiChatStatus = 'connecting' | 'ready' | 'closed'

// usePlanAiChatBridge — 連上 plan-ai-timeline 這個 onagent app,註冊
// search_attraction/add_attraction 兩個工具(見 attractionTools.ts),讓
// 對話框輸入的文字能真的驅動 LLM 推論、呼叫工具、把結果異動進時間軸
// steps state。架構比照 useOnagentChatBridge.ts(ChatScreen 既有的
// onagent 串接 hook)——同一套 AgentBridge + toAgentBridgeTools 組合,
// 差別只在這裡接的是 plan-ai-timeline 這個獨立 app、工具換成這個頁面
// 專屬的兩個,而不是 trip_entry_* 那五個。
//
// getSteps/insertAttraction 用 ref 包一層(理由同 useOnagentChatBridge.ts
// 的 getAllBatchesRef/setAllBatchesRef 說明)——這兩個函式來自呼叫端
// (AIPlanTimelinePage 主體)每次 render 產生的新閉包,若直接放進下面
// useEffect 的依賴陣列,會導致每次重渲染都重新建立一次 WebSocket 連線,
// 連線只應該依 apiKey 是否存在變化,不該因為呼叫端重新渲染就重連。
function usePlanAiChatBridge(
  getSteps: () => PlanStepLike[],
  insertAttraction: (
    anchorId: string | null,
    newId: string,
    data: PlanNodeData,
  ) => ReturnType<typeof insertAfter>,
) {
  const apiKey = import.meta.env.VITE_PLAN_AI_ONAGENT_APP_KEY as string | undefined
  const [status, setStatus] = useState<PlanAiChatStatus>('connecting')
  const [messages, setMessages] = useState<{ id: string; text: string }[]>([])
  // isThinking——從 sendPrompt 呼叫那一刻開始 true,到收到第一個
  // onAssistantMessage 或 onError 為止轉回 false。這是接給呼吸點/骨架卡
  // 那組思考動畫用的狀態(見主元件 isGenerating 判斷式,原本只綁模擬 WS
  // 的 isGenerating,onagent 對話推論期間完全沒有視覺提示——使用者已
  // 確認要接上)。工具呼叫(tool_call/tool_result)本身不會觸發
  // onAssistantMessage,LLM 可能先呼叫工具、思考一陣子才送出文字回覆,
  // 這段「送出後、收到文字前」正是最需要視覺回饋的空窗期。
  const [isThinking, setIsThinking] = useState(false)
  const bridgeRef = useRef<AgentBridge | null>(null)
  const getStepsRef = useRef(getSteps)
  const insertAttractionRef = useRef(insertAttraction)
  useEffect(() => {
    getStepsRef.current = getSteps
    insertAttractionRef.current = insertAttraction
  })

  useEffect(() => {
    if (!apiKey) return
    // ctx.insertAttractionAfter 回傳型別是 Promise<...>(見
    // AttractionStepsCtx 的完整說明),但 insertAttractionRef.current(...)
    // 本身是同步函式——直接回傳同步值時,await 呼叫端(attractionTools.ts
    // 的 addAttraction)拿到的仍然是正確的已 resolve 結果,不需要這裡
    // 刻意包一層 Promise.resolve,JS 對「async 函式/Promise 型別位置
    // 回傳非 Promise 值」本來就會自動裝箱。這裡把 planTimeline.ts
    // InsertAfterResult 的 insertedId 欄位轉成 AttractionStepsCtx 期望
    // 的 id 欄位名稱——兩邊型別故意用不同欄位名(insertedId vs id),
    // 讓「這是插入操作的結果」跟「這是我拿到的新節點 id」在讀程式碼時
    // 语意各自獨立,不是隨便找了同名欄位就當作互相相容。
    //
    // newId 用 `agent-${crypto.randomUUID()}` 生成——不像原本 add_attraction
    // 自己組 id 時能拿到 attractionId(景點池固定 id)可用,這裡收到的
    // step 只是已經組好的 stop 資料(Omit<PlanStepLike, 'id'>),不含
    // attractionId 這個原始欄位,且不該依賴 step.name(景點名稱,含中文
    // 字元、可能重複、不適合當 id 的一部分)這種業務資料組 id。
    // randomUUID 保證唯一,不需要額外的時間戳記或業務欄位輔助。
    const ctx: AttractionStepsCtx = {
      getSteps: () => getStepsRef.current(),
      insertAttractionAfter: async (anchorId, step) => {
        const newId = `agent-${crypto.randomUUID()}`
        const result = insertAttractionRef.current(anchorId, newId, step)
        return result.ok ? { ok: true, id: result.insertedId } : { ok: false, error: result.error }
      },
    }
    const bridge = new AgentBridge({
      url: PLAN_AI_ONAGENT_WS_URL,
      appId: PLAN_AI_ONAGENT_APP_ID,
      apiKey,
      tools: toAgentBridgeTools(createAttractionToolsList(GUEST_CFG), ctx),
      onAssistantMessage: (text) => {
        setIsThinking(false)
        setMessages((prev) => [...prev, { id: `msg-${Date.now()}-${prev.length}`, text }])
      },
      onError: (err) => {
        setIsThinking(false)
        setMessages((prev) => [...prev, { id: `err-${Date.now()}-${prev.length}`, text: `(連線錯誤: ${err.message})` }])
      },
    })
    bridgeRef.current = bridge
    setStatus('connecting')
    // AgentBridge 沒有連線成功的 callback,用送出後短暫延遲樂觀顯示
    // ready(同 useOnagentChatBridge.ts 的既有做法)。
    const t = window.setTimeout(() => setStatus('ready'), 500)
    return () => {
      window.clearTimeout(t)
      bridge.close()
      bridgeRef.current = null
      setStatus('closed')
    }
  }, [apiKey])

  const sendPrompt = useCallback((text: string) => {
    if (!text.trim() || !bridgeRef.current) return
    setIsThinking(true)
    bridgeRef.current.prompt(text)
  }, [])

  return {
    apiKeyMissing: !apiKey,
    status,
    messages,
    isThinking,
    sendPrompt,
  }
}

export function AIPlanTimelinePage() {
  const theme = getTheme()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const [showJumpPill, setShowJumpPill] = useState(false)
  const { steps, isGenerating, restart, sendTrigger, stop, insertAttractionAfter } = usePlanSimSocket()
  const stopCount = steps.filter((s) => s.type === 'stop').length

  // stepsRef——usePlanAiChatBridge 的 getSteps 需要讀到「當下最新」的
  // steps,不能綁死成某一次 render 時的閉包(對話框的 onagent 連線本身
  // 是長壽命的,建立連線那一刻的 steps 閉包很快就會過期)。這裡用 ref
  // 同步鏡射 steps,理由同 mountedIdsRef 等其餘 xxxRef 用法。
  const stepsRef = useRef(steps)
  useEffect(() => { stepsRef.current = steps }, [steps])

  // getStepsForBridge——把 usePlanSimSocket 提供的 PlanStep[](即
  // PlanNode[],見 planTimeline.ts)轉接成 usePlanAiChatBridge 期望的
  // PlanStepLike[] 介面(見 attractionTools.ts 的 PlanStepLike 說明:
  // 結構化型別下,完整的 PlanNode 物件本來就滿足 PlanStepLike 的較窄
  // 形狀,多出來的欄位在讀取端被忽略)。insertAttractionAfter 本身已經
  // 是 usePlanSimSocket 提供、簽章對齊 usePlanAiChatBridge 期望的介面
  // (見該函式的完整說明),不需要像原本 setStepsForBridge 那樣另外包一層
  // 轉接——這是使用者明確要求的「機制跟介面由行程安排元件提供」的直接
  // 體現:元件提供的介面形狀,對話橋接層直接拿去用,不需要中間再插一層
  // adapter。
  const getStepsForBridge = useCallback((): PlanStepLike[] => stepsRef.current, [])
  const planAiChat = usePlanAiChatBridge(getStepsForBridge, insertAttractionAfter)
  const [chatInput, setChatInput] = useState('')

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,用來正確判斷
  // 下方渲染迴圈裡的 justMounted。原本 justMounted 是用
  // `idx === steps.length - 1`(是不是陣列最後一個元素)判斷,這在
  // steps 只會 append 到尾端時沒問題,但「插入到中間」的節點(見
  // PlanAction.afterId/planActionToInsert 的完整說明——例如測試按鈕
  // insert_anping_mazu 插在 note-1 之後,不是陣列最後一個)永遠不會是
  // 最後一個元素,導致完全沒有進場動畫(cardSlide/thumbPop/pillExpand/
  // anchorPop/noteFade 全部沒套上),這是實際發生過的 bug——使用者要求
  // 「子代理處理插入時,要跟新增有一樣的動畫效果」。改成用這個 ref 記錄
  // 每個 id 是否已經出現過:第一次出現時判定為 justMounted(不論它在
  // 陣列中的位置是不是最後一個),渲染完當下就把 id 記進 ref,之後即使
  // steps 陣列因為其他節點增減而重新渲染,這個 id 也不會被誤判為又一次
  // 新掛載。用 ref 而非 state,是因為這個記錄本身不需要觸發重渲染——它
  // 只是渲染過程中順手更新的旁路狀態(理由同其餘 xxxRef 用法)。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // removeWumiao/insertAnpingMazu — 對話框下方兩顆獨立的測試按鈕,分別
  // 對後端送出 "remove_wumiao"/"insert_anping_mazu" 這兩個獨立的觸發
  // 請求(見 usePlanSimSocket 的 sendTrigger 說明)。前端這裡不組任何
  // action 訊息內容——id/座標/文案等全部由後端的 planSimTriggerActions
  // 決定,前端只表達「我要哪一種操作」,真正的畫面更新是等後端推播回
  // action 訊息、走 ws.onmessage 的既有處理路徑才會發生,不是點下按鈕
  // 當下就更新畫面。
  //
  // 刻意拆成兩顆按鈕、各自由使用者手動點擊才送出——不是點一次「移除」
  // 就自動接著送出「插入」,每個觸發請求都要對應到一次明確的使用者
  // 操作,不能有任何一個訊息是被程式自動代為觸發的。
  //
  // 找不到祀典武廟這一站時(還沒生成到/已經被移除過)「移除」按鈕用
  // disabled 擋掉;安平天后宮已經插入過時「插入」按鈕同樣 disabled,
  // 避免重複點擊送出兩次插入而出現重複 id 的節點——這裡的 guard 是
  // 前端這側的防禦,後端目前沒有另外檢查重複插入。
  const removeWumiao = useCallback(() => {
    sendTrigger('remove_wumiao')
  }, [sendTrigger])
  const insertAnpingMazu = useCallback(() => {
    sendTrigger('insert_anping_mazu')
  }, [sendTrigger])
  const wumiaoPresent = steps.some((s) => s.id === 'stop-wumiao')
  const anpingMazuPresent = steps.some((s) => s.id === 'stop-anping-mazu')

  // ---------- 右上角固定小地圖 ----------
  // 只掛載單一 NativeMapBase 實例(理由見使用者原始需求:「掛載地圖是不是
  // 很吃資源且會變慢,所以我想說只掛載單一地圖」),點擊任一張 stop 卡片
  // 時呼叫 mapRef.current.panTo + setZoom,而不是每張卡片各自掛一個地圖
  // ——這裡選的是「固定側欄地圖」方案(使用者確認:「先做旁邊固定的地圖
  // 好了」「一直存在於右上角,點卡片就 pan 過去+放大」),不是「地圖跟著
  // 移動到被點的卡片旁邊」那個需要 Portal/DOM 搬移的方案(已明確擱置,
  // 見對話討論——Google Maps SDK 沒有官方 API 能把建好的地圖實例搬到
  // 別的 DOM 容器,只能重建,CSS 視覺位移則不需要搬移,直接維持固定位置
  // 最單純)。
  const mapHandleRef = useRef<MapHandle | null>(null)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)

  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    mapHandleRef.current = handle
  }, [])

  const panToStop = useCallback((step: PlanStep) => {
    if (step.lat == null || step.lng == null) return
    setSelectedStopId(step.id)
    const map = mapHandleRef.current?.mapRef.current
    if (!map) return
    map.panTo({ lat: step.lat, lng: step.lng })
    map.setZoom(SELECTED_MAP_ZOOM)
  }, [])

  // scrollToLatest — 對齊目前生成位置(呼吸點提示,或已生成完畢時的
  // 最後一個節點),而非直接捲到容器 scrollHeight 最底部——後者會讓
  // 卡片下緣卡在視窗邊界,看不出「還有留白空間」的餘裕感,也對不準
  // 「AI 現在正在安排到哪」這個位置。等兩幀才量測,確保剛掛載的節點
  // 已經完成排版,量到的 offsetTop 才準確。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollRef.current
        if (!scroller) return
        const nodes = scroller.querySelectorAll<HTMLElement>('[data-tl-node]')
        const target = scroller.querySelector<HTMLElement>('[data-tl-tip]')
          ?? (nodes.length > 0 ? nodes[nodes.length - 1] : undefined)
        if (!target) {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
          return
        }
        const targetRect = target.getBoundingClientRect()
        const scrollerRect = scroller.getBoundingClientRect()
        const targetTopInScroller = targetRect.top - scrollerRect.top + scroller.scrollTop
        const desiredTop = targetTopInScroller - scroller.clientHeight + 160
        // 夾在 [0, scrollHeight - clientHeight] 之間,避免短時間內連續
        // 多個節點快速掛載時算出超出實際可捲動範圍的值,把畫面捲出視窗
        // 外(見這個機制先前版本踩過的實測問題)。
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        scroller.scrollTo({ top: Math.min(maxTop, Math.max(0, desiredTop)), behavior: 'smooth' })
      })
    })
  }, [])

  // 每次 steps 改變(新節點掛載/被移除)都嘗試捲動跟隨。
  useEffect(() => {
    if (!following) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, following, scrollToLatest])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const distFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    const nowFollowing = distFromBottom < 80
    setFollowing((prev) => {
      if (nowFollowing === prev) return prev
      setShowJumpPill(!nowFollowing && isGenerating)
      return nowFollowing
    })
  }, [isGenerating])

  const jumpToLatest = useCallback(() => {
    setFollowing(true)
    setShowJumpPill(false)
    scrollToLatest()
  }, [scrollToLatest])

  const restartAndFollow = useCallback(() => {
    setFollowing(true)
    setShowJumpPill(false)
    // 重播時 usePlanSimSocket 會把 steps 清空重新從頭播放(見 restart 的
    // 完整說明)——mountedIdsRef 記錄的是「已經播過進場動畫的 id」,清空
    // steps 後這些 id 會以同樣的內容重新出現,若不清掉 ref,會被誤判為
    // 「已經出現過」而完全不播放進場動畫,整個重播過程看起來像是瞬間
    // 貼上而非逐步生成。
    mountedIdsRef.current.clear()
    restart()
  }, [restart])

  // lastAiMessage/placeholder——PLAN_SIM_ENABLED 為 false 時 isGenerating
  // 恆為 false,但 stopCount 也可能是 0(還沒透過對話新增任何景點)——
  // 原本「好,Day 1 安排好了,共 0 站」這句話在這個情境下語意矛盾(沒有
  // 安排好任何東西,只是還沒開始),改成依 stopCount 是否為 0 分岔文案。
  const lastAiMessage = isGenerating
    ? '正在依你的喜好安排 Day 1 的行程順序……'
    : stopCount > 0
      ? `目前已安排 ${stopCount} 站。想調整哪裡都可以直接說。`
      : '想去哪裡玩？跟我說說你的想法，我可以幫你查景點、安排行程。'
  const placeholder = isGenerating ? '可以隨時打斷，例如：下午不要排太滿' : '想調整哪裡？'

  // app-theme-root:base-ui.css 的深色模式規則掛在這個全域 class 上
  // (.app-theme-root:not([data-theme="light"]) 搭配
  // prefers-color-scheme、.app-theme-root[data-theme="dark"]),見
  // App.tsx 的 /app 路由同樣疊加這個 class。少了它,無論系統偏好或
  // data-theme 屬性值是什麼,這個頁面都只會顯示淺色 token。
  return (
    <div className={`${styles.page} app-theme-root`} data-theme={theme ?? undefined}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.tripName}>台南安平兩日遊</span>
          <div className={styles.dayTabs}>
            <button type="button" className={`${styles.dayTab} ${styles.dayTabActive}`}>Day 1</button>
            <button type="button" className={styles.dayTab}>Day 2</button>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.statusPill}>
            {isGenerating ? (
              <>
                <span className={`${styles.statusDot} ${styles.statusDotGenerating}`} />
                <span>正在安排 Day 1…</span>
              </>
            ) : (
              <>
                <span className={`${styles.statusDot} ${styles.statusDotDone}`} />
                <span>已安排 {stopCount} 站</span>
              </>
            )}
          </div>
          {/* 重播按鈕只在模擬後端有接上時才有意義——PLAN_SIM_ENABLED 為
              false 時 restart() 呼叫的 usePlanSimSocket effect 提早
              return,不會真的重新連線播放,留著這顆按鈕會讓使用者點了
              沒反應,一併隱藏。 */}
          {PLAN_SIM_ENABLED && (
            <button type="button" className={styles.replayBtn} onClick={restartAndFollow}>↻ 重播</button>
          )}
        </div>
      </header>

      {/* 右上角固定小地圖——position: fixed(見 .module.css 的完整說明),
          不佔版面空間、不隨時間軸捲動。單一 NativeMapBase 實例,點擊
          stop 卡片時呼叫 panToStop 讓它 panTo+放大,不是每張卡片各自
          掛一個地圖(效能考量,見上方 panToStop 的完整說明)。 */}
      <div className={styles.miniMapWrap}>
        <NativeMapBase
          center={DEFAULT_MAP_CENTER}
          zoom={DEFAULT_MAP_ZOOM}
          theme={theme}
          showZoomControl={false}
          onHandleChange={handleMapHandleChange}
        />
      </div>

      <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
        <div className={styles.inner}>
          {steps.map((p, idx) => {
            // justMounted:這個節點是不是「第一次」出現在畫面上(見上方
            // mountedIdsRef 的完整說明)——用 id 是否已經記錄過判斷,不是
            // 用陣列 index,插入到中間的節點才能正確觸發進場動畫。渲染
            // 當下就同步寫入 ref(不是等 useEffect),因為這個判斷結果
            // 本身要在這一輪 render 就決定要不要套用動畫 class,寫入時機
            // 跟讀取時機必須是同一輪。
            const justMounted = !mountedIdsRef.current.has(p.id)
            if (justMounted) mountedIdsRef.current.add(p.id)
            const mountedClass = styles.mountFadeIn
            // removingClass:套在每個節點最外層的 .row 容器上——CSS
            // 同時做透明度淡出跟高度塌縮(見 .module.css 的 .removingFade
            // 完整說明),讓移除的節點不是瞬間消失、下面的節點也是跟著
            // 高度縮小一起往上滑,而不是版面突然跳一格。
            const removingClass = p.removing ? styles.removingFade : ''

            if (p.type === 'section') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.sectionRow} ${mountedClass} ${removingClass}`}>
                  <div className={styles.sectionBand}>
                    <span className={styles.sectionLabel}>{p.label}</span>
                  </div>
                </div>
              )
            }

            if (p.type === 'stop') {
              return (
                <div key={p.id} data-tl-node className={`${styles.row} ${styles.stopRow} ${removingClass}`}>
                  <div className={`${styles.stopTime} ${mountedClass}`}>
                    <div className={styles.stopTimeText}>{p.time}</div>
                  </div>
                  <div className={styles.axisCol}>
                    {idx > 0 && <div className={styles.axisLineAbove} />}
                    {/* axisLineBelow 原本只在「還有下一個節點」時畫
                        (idx < steps.length - 1),但這個節點是陣列最後
                        一個、且仍在生成中(isGenerating)時,後面其實
                        還接著呼吸點/骨架卡(.tipRow,見下方渲染邏輯)要
                        銜接——只看陣列位置不看生成狀態,會讓「目前正在
                        生成下一站」這個當下,最後一張卡片下方到呼吸點
                        之間完全沒有任何軸線元素覆蓋,出現一大段斷裂
                        (2026-09 實測:「大天后宮」卡片下方到呼吸點之間
                        整段空白)。補上 isGenerating 這個條件,讓它在
                        「還有下一個節點」或「正在生成中」任一成立時都
                        畫出來。 */}
                    {(idx < steps.length - 1 || isGenerating) && <div className={styles.axisLineBelow} />}
                    <div className={`${styles.anchorDot} ${mountedClass} ${justMounted ? styles.anchorPop : ''}`} />
                  </div>
                  <div className={`${styles.stopCardWrap} ${mountedClass} ${justMounted ? styles.cardSlide : ''}`}>
                    <div
                      className={`${styles.stopCard} ${p.id === selectedStopId ? styles.stopCardSelected : ''}`}
                      role={p.lat != null && p.lng != null ? 'button' : undefined}
                      tabIndex={p.lat != null && p.lng != null ? 0 : undefined}
                      onClick={() => panToStop(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') panToStop(p)
                      }}
                    >
                      <div
                        className={`${styles.stopThumb} ${justMounted ? styles.thumbPop : ''}`}
                        style={{ background: p.photoUrl ? undefined : p.thumbBg }}
                      >
                        {p.loading ? (
                          <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
                        ) : p.photoUrl ? (
                          <img src={p.photoUrl} alt={p.name} className={styles.stopThumbImg} />
                        ) : p.thumbIcon}
                      </div>
                      <div className={styles.stopBody}>
                        <div className={styles.stopMeta}>
                          {p.duration} · {p.kind}
                          {p.loading && <span className={styles.loadingTag}>查詢地點中…</span>}
                        </div>
                        <div className={styles.stopName}>{p.name}</div>
                        <div className={styles.stopDesc}>{p.desc}</div>
                        {p.tags && p.tags.length > 0 && (
                          <div className={styles.stopTags}>
                            {p.tags.map((tag) => (
                              <span key={tag} className={styles.stopTag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            }

            if (p.type === 'transit') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.transitRow} ${removingClass}`}>
                  <div />
                  <div className={styles.transitAxis}>
                    <div className={styles.transitDashAbove} />
                    <div className={styles.transitDashBelow} />
                    <div className={`${mountedClass} ${justMounted ? styles.pillExpand : ''} ${styles.transitPill}`}>
                      <span>{p.icon}</span>
                      <span>{p.mode} {p.minutes} 分 · {p.distance}</span>
                    </div>
                  </div>
                  <div />
                </div>
              )
            }

            // note——中間欄補上貫穿整行的軸線(.noteAxisLine),否則時間軸
            // 主軸線在注記這一列會斷開(這一列原本中間/右欄都是空的
            // <div />,沒有任何元素延續上下相鄰 stop/transit 列畫出的
            // 軸線,造成視覺上斷裂——見 .module.css 的 .noteAxisLine 完整
            // 說明)。
            return (
              <div key={p.id} className={`${styles.row} ${styles.noteRow} ${removingClass}`}>
                <div className={`${styles.noteLeft} ${mountedClass} ${justMounted ? styles.noteFade : ''}`}>
                  <div className={styles.noteInner}>
                    <div className={styles.noteBar} style={{ background: p.color }} />
                    <div className={styles.noteText}>
                      <span style={{ marginRight: 4 }}>{p.noteIcon}</span>{p.text}
                    </div>
                  </div>
                </div>
                <div className={styles.noteAxisCol}>
                  <div className={styles.noteAxisLine} />
                </div>
                <div />
              </div>
            )
          })}

          {/* isGenerating(模擬 WS 腳本自動播放中)|| planAiChat.isThinking
              (onagent 對話推論中,見 usePlanAiChatBridge 的 isThinking
              說明)——兩條各自獨立的「AI 正在做事」訊號,任一個成立就顯示
              思考動畫(呼吸點+骨架卡)。原本這裡只綁 isGenerating,關閉
              PLAN_SIM_ENABLED 後 onagent 對話推論期間完全沒有視覺提示,
              使用者已確認要接上。 */}
          {isGenerating || planAiChat.isThinking ? (
            // key 綁「目前最後一個節點的 id」:tipRow 是 steps.map 之後的
            // 固定兄弟元素,React 每次重渲染都會把它視為「同一個既有元素、
            // 只是被往下推了一格」,DOM 節點不會重建——結果是掛在
            // .tipLineAbove 上的軸線生長動畫(見 .module.css 的 growDown
            // 說明)只會在頁面第一次出現呼吸點時播一次,之後每個新節點掛
            // 上來、呼吸點移到新位置時完全沒有「從上一個錨點延伸下來」的
            // 動態感。用 key 讓「最後一個節點變了」等同「呼吸點換了位置」,
            // 強制 React 卸掉舊的 tipRow 重新掛一個,CSS animation 才會隨
            // 之重播。這跟 mountedIdsRef 追蹤 justMounted 的機制是互補的:
            // 那個負責「節點本身」的進場動畫,這裡負責「節點之後的預告區」
            // 的重播——兩者都依賴 id、不依賴陣列 index,插入到中間的節點
            // 不會改變最後一個 id,呼吸點位置也確實沒變,不該重播,行為
            // 一致。骨架卡跟 tipRow 共用同一個 key 的 fragment,理由相同:
            // 它是呼吸點的延伸,一起重掛才能跟軸線生長同步淡入。
            <Fragment key={`tip-after-${steps.length > 0 ? steps[steps.length - 1].id : 'empty'}`}>
              <div data-tl-tip className={`${styles.row} ${styles.tipRow}`}>
                <div />
                <div className={styles.tipAxis}>
                  <div className={styles.tipLineAbove} />
                  <div className={styles.tipDot} />
                  <div className={styles.tipLineBelow} />
                </div>
                <div />
              </div>
              {/* 骨架卡——呼吸點下方的「即將出現的內容」預告(見 .module.css
                  的 .skeletonRow/.skeletonCard 完整說明)。不對應任何真實
                  PlanStep、沒有資料,純粹是視覺佔位:先前呼吸點下面是一整片
                  空白,看起來像「已經結束」而不是「還在生成」。只在已經有
                  節點之後才顯示——steps 還是空的(WS 剛連上、第一則訊息還
                  沒到)時只有呼吸點,沒有「上一個錨點」可以延伸,骨架卡孤
                  零零掛在最上面反而奇怪。沿用 .row/.stopRow/.axisCol/
                  .stopCardWrap 既有 class 讓它落在跟真實 stop 卡片同一個
                  右欄、同樣的縮排,只疊加 skeleton 專屬 modifier 調整外觀,
                  不另建一套 grid。aria-hidden:對輔助技術而言這裡沒有任何
                  內容,不該被朗讀成一個空卡片。 */}
              {steps.length > 0 && (
                <div aria-hidden="true" className={`${styles.row} ${styles.stopRow} ${styles.skeletonRow}`}>
                  <div />
                  <div className={styles.axisCol}>
                    <div className={styles.skeletonAnchor} />
                  </div>
                  <div className={styles.stopCardWrap}>
                    <div className={styles.skeletonCard}>
                      <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
                      <div className={styles.skeletonBody}>
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineDesc} ${styles.shimmer}`} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          ) : steps.length > 0 ? (
            <div className={`${styles.endMarker} ${styles.endFade}`}>── Day 1 結束 ──</div>
          ) : null}
        </div>
      </div>

      {showJumpPill && (
        <div className={styles.jumpPillWrap}>
          <button type="button" className={styles.jumpPill} onClick={jumpToLatest}>↓ 回到最新</button>
        </div>
      )}

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          {/* planAiChat.messages——onagent 回覆的自然語言訊息(見
              usePlanAiChatBridge 的 onAssistantMessage 說明),疊在既有
              lastAiMessage(模擬腳本狀態列)上方顯示。這是「對話窗串接」
              的核心呈現:使用者在輸入框打字問問題/下指令,LLM 呼叫
              search_attraction/add_attraction 工具後,文字回覆顯示在
              這裡,不是只有時間軸本身在動。 */}
          {planAiChat.messages.length > 0 && (
            <div className={styles.chatMessages}>
              {planAiChat.messages.map((m) => (
                <div key={m.id} className={styles.aiLine}>
                  <span className={styles.aiLineIcon}>✦</span>
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
          )}
          <div className={styles.aiLine}>
            <span className={styles.aiLineIcon}>✦</span>
            <span>{lastAiMessage}</span>
          </div>
          <form
            className={styles.inputRow}
            onSubmit={(e) => {
              e.preventDefault()
              if (!chatInput.trim()) return
              planAiChat.sendPrompt(chatInput)
              setChatInput('')
            }}
          >
            <div className={styles.inputWrap}>
              <input
                type="text"
                placeholder={planAiChat.apiKeyMissing ? '對話功能未設定(缺少 apiKey)' : placeholder}
                aria-label="輸入指令"
                className={styles.input}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={planAiChat.apiKeyMissing}
              />
            </div>
            {/* 推論中(isGenerating,模擬腳本狀態)時,送出鈕換成終止鈕
                ——點擊呼叫 stop()(見 usePlanSimSocket 的完整說明),真的
                關閉 WebSocket 連線讓後端停止推播,不只是切換 UI 顯示。
                這顆按鈕原本只服務模擬腳本的生成中/終止狀態,現在同一顆
                輸入框也接了 onagent 對話(見 planAiChat)——兩者是各自
                獨立的功能(模擬腳本的自動演示 vs. 使用者主動輸入文字驅動
                LLM),isGenerating 為 false 時送出鈕固定送出對話框文字,
                不受模擬腳本狀態影響。 */}
            {isGenerating ? (
              <button type="button" aria-label="終止生成" className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={stop}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--ios-bg)">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              </button>
            ) : (
              <button type="submit" aria-label="送出" className={styles.sendBtn} disabled={planAiChat.apiKeyMissing}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ios-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </form>
          <div className={styles.quickChips}>
            {['少走一點路', '加一個咖啡廳', '改成半日行程'].map((label) => (
              <span key={label} className={styles.quickChip}>{label}</span>
            ))}
          </div>
          {/* 測試用按鈕組——各自對後端送出獨立的觸發請求(見
              removeWumiao/insertAnpingMazu/sendTrigger 的完整說明),不是
              點一顆按鈕就自動連續做兩件事:「移除」只送移除請求,「插入」
              只送插入請求,兩者是各自獨立的使用者操作,用來手動驗證
              結構化資料可以被異動並即時反應在畫面上,不需要每次都等 WS
              腳本播到對應位置。PLAN_SIM_ENABLED 為 false 時整組隱藏——
              這兩顆按鈕靠 sendTrigger 對模擬 WS 連線送出請求,模擬後端
              沒接上時它們恆為 no-op(disabled 條件 wumiaoPresent 也會
              恆假,因為 steps 裡永遠不會出現 stop-wumiao 這個模擬腳本
              專屬的 id),與其留著一排永遠按不動的按鈕當視覺雜訊,不如
              直接藏起來。 */}
          {PLAN_SIM_ENABLED && (
            <div className={styles.testBtnGroup}>
              <button
                type="button"
                className={styles.testRemoveBtn}
                onClick={removeWumiao}
                disabled={!wumiaoPresent}
              >
                🧪 模擬移除「祀典武廟」
              </button>
              <button
                type="button"
                className={styles.testRemoveBtn}
                onClick={insertAnpingMazu}
                disabled={anpingMazuPresent}
              >
                🧪 模擬插入「安平天后宮」
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
