import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import { AgentBridge } from '@onagent/bridge'
import { TIME_DRAG_ENABLED, TRANSIT_MODE_SELECT_ENABLED } from '../../DesktopShared'
import { ApiError, fetchPlanAiAttractionSearch, postPlanAiChat, postPlanAiChatReply, type ClientConfig } from '../../api'
import { Lightbox } from '../place/PhotoCarousel'
import { toAgentBridgeTools } from '../../sdk-proposals/toAgentBridgeTools'
import { useStableCallback } from '../../hooks/useStableCallback'
import { useIsWide } from '../../hooks/useIsWide'
import { createAttractionToolsList } from '../conversation/tools'
import { createPlanAiCtx } from '../conversation/context'
import { resolveNoteCategory } from '../timeline/presentation'
import { createBridgeGuard, createSendSequence, guardCallback, guardCtx, type BridgeGuard } from '../conversation/guard'
import {
  createAskPageToolsList,
  type AskPageCtx,
  type AskPageInput,
  type UserSelectionRecord,
  type AskPageSelection,
} from '../conversation/asktools'
import { useAskPageBridge } from '../conversation/useAskPageBridge'
import { buildAskMapView, type AskMapPoint, type AskMapView } from '../conversation/askMapView'
import { PICK_ASK_REASON, REPLACE_ASK_REASON, candidatesFromAttractions, nearbyAskInput, pickBaseStop, shouldConfirmFromComposer } from './askStarters'
import { PICKED_INTERESTS_PROMPT, useAskPageFlow } from './useAskPageFlow'
import { lodgingMapMarkers, resolveMapChildren } from '../timeline/resolved'
import { useResolvedRefs } from '../data/PlanDataProvider'
import { refreshTransitForStop } from '../timeline/transit'
import { usePlanTimelineCore } from '../timeline/usePlanTimelineCore'
import { useStopCardClick, resolveStopPanTarget } from '../map/useStopPan'
import { AskPage } from '../conversation/AskPage'
import { PlanTimelineView } from '../timeline/PlanTimelineView'
import { usePlanConversation } from '../conversation/usePlanConversation'
import type { PlanMessage } from '../conversation/messages'
// HorizontalPlanTimeline——2026-10(手機版共用時間軸重構):原本只給
// /ai-plan 展示頁「模擬層」用的橫向卡片時間軸,現在也供這個元件的
// horizontalTimeline 分支使用(見該 prop 的完整說明)——使用者明確要求
// 「兩個不同的層,時間軸要共用相同的,只有資料層不一樣」,手機版情境下
// 不管是模擬中還是交接後都要是同一個橫向渲染元件,不要維護兩份視覺上
// 等價但程式碼各自獨立的實作。這裡只是多一個呼叫端,不影響
// planning/preview/ 那邊的既有呼叫方式。
import { HorizontalPlanTimeline } from '../timeline/phone/HorizontalPlanTimeline'
import type { PlanStopMarker } from '../map/marker/planStops'
import type { PlanAiDataSource } from '../data/source'
import { listTravelCities, listTravelCountries } from '../conversation/travelRegionData'
import { uiStateStore } from '../conversation/uiStateStore'
import { createAttractionPoolStore, type AttractionPoolStore } from '../conversation/attractionPoolStore'
import { Composer } from '../../components/Composer'
import { ComposerPortal } from './ComposerPortal'
import { COMPOSER_PLACEHOLDER_UNAVAILABLE, composerModeFor, routeComposerSubmit } from './composerMode'
import { ComposerSlotContext } from '../shared/overlayDom'
import {
  getNode,
  getTimeDragBounds,
  insertAfter,
  listNodes,
  lodgingsOf,
  type PlanTimeline,
} from '../timeline/model'
import type { PlanOperations } from '../timeline/operations'
import { routeSegmentsFromTimeline, type RouteSegment } from '../timeline/segments'
import type { PlanTimelineStore } from '../timeline/storage'
import styles from './TripPlanPage.module.css'

// TripPlanPage — 「AI 安排行程」正式功能頁面,對應 /app 底下的正式導覽
// 系統(有真實登入態,見下方 cfg 參數的完整說明)。
//
// 這個檔案是從 plan-ai/Content.tsx(展示原型,對應獨立路由
// /plan-ai,使用者明確要求不要修改那份檔案)拆分出來的正式版本——原型
// 混雜了兩種東西:(1) 真正可複用的邏輯:onagent 對話橋接、時間軸 JSX
// 渲染、右上角小地圖、timeline/model.ts/conversation/tools.ts 這兩個純函式
// 領域層;(2) 只服務展示原型的東西:usePlanSimSocket(模擬 WS,逐步播放
// 後端固定腳本)、simEnabled 開關、重播/下一步/測試按鈕、寫死的「台南
// 安平兩日遊」行程名稱與 Day 1/Day 2 分頁。
//
// 這裡只保留 (1),完全不包含 (2)——這是一個使用者實際會用的功能,不是
// 給團隊內部展示雛形用的原型。時間軸的領域層(planning/timeline/model.ts/
// planning/conversation/tools.ts)直接 import 既有檔案共用,不複製貼上一份。
//
// 分天(Day 1/Day 2)概念——原型的分頁按鈕本身是純展示假資料(只有
// Day 1 有內容,Day 2 按鈕點了沒有任何作用),這裡先整個拿掉,不用假的
// 分頁 UI 硬撐出「有這個功能」的樣子。若日後要支援多天行程,應該是
// timeline 領域層本身先長出「屬於哪一天」的欄位與後端資料流,再回頭做
// UI,不是先做一個沒有資料支撐的分頁殼子——這裡先用單一連續時間軸涵蓋
// 整趟行程,是刻意的簡化取捨,不是遺漏。

// 備註分類(NOTE_STYLES/DEFAULT_NOTE_CATEGORY)已抽到 planning/timeline/presentation.ts,與兩個時間軸視圖共用同一份。

// PlanStep — 對外沿用的節點型別名稱,實際上就是 planning/timeline/model.ts 的
// PlanNode(見該檔案的完整背景說明),這裡只是型別別名,不重新宣告欄位。

// CITY_ATTRACTION_TYPES——「選完城市 → 自動查該城市附近候選」那一步要查
// 哪些地點類型(見下方 useAskPageFlow 的 searchCityAttractions)。
//
// 2026-10 新增(使用者明確要求「自動的只查詢觀光地點」):在這之前這次
// 呼叫完全不帶 types,等於不篩類型——Google Nearby Search 回的是該座標
// 附近「最相關的任何地點」,實測台北拿到的候選包含「市政府」與「台北
// 世界貿易中心 展覽大樓」,那不是景點。而這張選單的標題正是「選擇感
// 興趣的景點」,顯示非觀光地點跟它自己的提問對不上。
//
// 值取自後端 allowedNearbyAttractionTypes 白名單(見
// server/internal/api/geo_plan_ai.go 該常數)裡「景點/文化」那一類中,
// 觀光情境最常見的四種。刻意不含:
//   - 餐飲/購物/住宿——那三類在白名單裡自成分類,是「排行程時另外要問
//     的事」,不屬於「有興趣的景點」這個問題。
//   - zoo/amusement_park/art_gallery/place_of_worship——都是合法的觀光
//     類型,但在多數城市的查詢結果裡數量稀少,加進來對候選組成影響很小,
//     卻會稀釋掉前四類的名額(後端只取 10 筆)。需要時再加。
//
// 不在白名單內的值會被後端靜默忽略(不是回錯誤,見該常數的完整說明),
// 所以這份清單若有拼錯,症狀是「那個類型沒生效」而不是查詢失敗——改動
// 時要對照後端白名單,不能只看字串看起來合不合理。
const CITY_ATTRACTION_TYPES = ['tourist_attraction', 'historical_landmark', 'museum', 'park']


// 時間軸的 state 與全部「改動邏輯」(插入與插入後的背景查詢、備註、兩階段移除、拖拉改時間、重試與掛載重試、
// 天與住宿操作、store 持久化與多實例版次同步)2026-10 收斂到共用的 planning/timeline/usePlanTimelineCore,本檔不再有自己的一份
// (原 useTripPlanTimeline 與 /ai-plan 模擬態的 usePlanSimSocket 逐行重複,見 docs/research-timeline-core-comparison-2026-10.md)。
// 本檔在呼叫處(TripPlanPage 本體)傳入的選項:store(永遠寫存檔)、dataSource、retryFailedOnMount(狀態表不持久化,
// 重整後由資料判斷要重查的站)、onBeforeMutate(接 suppressNextAutoScrollRef:刪除/拖拉時間不是新內容,不要自動捲動)、
// onStopInserted(新增站點代表話題推進,把對話裡還新鮮的訊息淡化)。

// PLAN_AI_ONAGENT_APP_ID/PLAN_AI_ONAGENT_URL——正式功能對話窗專用的
// onagent app,對齊原型的既有設定(見 planning/preview/Content.tsx 同名常數的
// 完整說明)。維持跟原型相同的 app id/url 設定來源——這兩個檔案目前共用
// 同一個 onagent app(工具清單相同:search_attraction/add_attraction/
// add_note/list_itinerary),若日後正式功能要有自己獨立的 app(例如要
// 接不同的工具集,或不希望正式流量與原型測試流量混在同一個 app
// 用量統計裡),再另外切分。
const PLAN_AI_ONAGENT_APP_ID = 'plan-ai-timeline'

// PLAN_AI_ONAGENT_WS_URL——2026-09 使用者明確要求「不要回退,沒有回應要
// 在畫面上顯示」:原本這裡在 URL 未設定時靜默退回 'http://localhost:8090',
// 正式環境若漏設這個環境變數,對話框看起來一切正常(狀態顯示已就緒、
// 輸入框可用),但每次送出的訊息都會連到一個正式環境上根本不存在的
// 本機位址,永遠沒有回應,使用者無從得知是設定錯誤。拿掉這個 fallback,
// 改成 undefined——呼叫端(usePlanAiChatBridge)據此判斷 urlMissing,
// 不嘗試建立一個注定連不上的連線,並讓 TripPlanPage 顯示提示、鎖定輸入框,
// 對稱既有的 apiKeyMissing 處理方式,不是又一種靜默失敗的樣態。使用者
// 明確要求提示文案不要暴露「未設定」這種技術性字眼,對使用者統一顯示成
// 「功能調整中」,不透露這是環境設定缺漏的內部細節。
//
// 2026-09:讀 VITE_ONAGENT_URL——原本這裡是獨立的 VITE_PLAN_AI_ONAGENT_URL,
// 使用者明確要求合併成同一個環境變數名稱(正式環境兩個 onagent app
// 目前剛好指向同一個平台網址,見 deploy-cloudrun.yml 的
// ONAGENT_PLATFORM_URL 說明)。apiKey(VITE_PLAN_AI_ONAGENT_APP_KEY,見
// 下方)維持獨立,不受這次合併影響——兩個 app 的 apiKey 本來就不相同,
// 不能合併。
const PLAN_AI_ONAGENT_HTTP_URL = import.meta.env.VITE_ONAGENT_URL as string | undefined
const PLAN_AI_ONAGENT_WS_URL = PLAN_AI_ONAGENT_HTTP_URL ? PLAN_AI_ONAGENT_HTTP_URL.replace(/^http/, 'ws') + '/ws' : undefined

export type PlanAiChatStatus = 'connecting' | 'ready' | 'closed'

// ToolCallLogEntry——見 usePlanAiChatBridge 內 toolCallLog state 的完整
// 說明:AI 推論過程中每次工具呼叫的紀錄,給外層(onToolCallLogChange prop)
// 回報用。獨立命名成模組層級型別,而非寫在 hook 內部當行內匿名型別,
// 是因為 TripPlanPageProps 的 onToolCallLogChange 也需要引用同一個形狀。
export type ToolCallLogEntry = { id: string; name: string; args: Record<string, unknown>; result: unknown; at: number }

// 工具呼叫紀錄上限:只保留最近這麼多筆,避免長對話記憶體無限增長。
export const MAX_TOOL_CALL_LOG = 200
// 模組層級遞增計數器產生 id(不用 crypto.randomUUID:http 區網 IP 等非安全環境不存在,會在 onToolResult 丟錯)。
let toolCallSeq = 0
// appendToolCallLog——把一筆工具呼叫結果附加到紀錄尾端,超過上限時丟掉最舊的。
export function appendToolCallLog(
  log: ToolCallLogEntry[],
  info: { name: string; args: Record<string, unknown>; result: unknown },
): ToolCallLogEntry[] {
  const next = [...log, { id: `tool-call-${++toolCallSeq}`, at: Date.now(), ...info }]
  return next.length > MAX_TOOL_CALL_LOG ? next.slice(next.length - MAX_TOOL_CALL_LOG) : next
}

// resolvePhonePanToStop——手機版時間軸以 onPanToStop 是否有值決定顯示「移動到此」按鈕,
// 所以呼叫端沒提供 onPanToStop 時必須傳 undefined,不能固定傳函式(否則按鈕顯示卻點了沒反應)。
export function resolvePhonePanToStop<F>(onPanToStop: unknown, panToStopId: F): F | undefined {
  return onPanToStop ? panToStopId : undefined
}

// usePlanAiChatBridge — 連上 plan-ai-timeline 這個 onagent app,註冊
// search_attraction/add_attraction 等工具(見 conversation/tools.ts),讓
// 對話框輸入的文字能真的驅動 LLM 推論、呼叫工具、把結果異動進時間軸。
// 邏輯整段對齊原型 planning/preview/Content.tsx 同名 hook(見該處的完整
// 說明),差別只在:
//   - 不再需要跟 usePlanSimSocket 共享同一組 addStop/
//     setStopNote——這裡改成呼叫端(TripPlanPage 主體,透過
//     usePlanTimelineCore)自己提供,原型裡兩條路徑共用同一組函式的
//     說明在這裡已經不適用(正式功能只有這一條路徑)。
//   - createAttractionToolsList(cfg) 的 cfg 改成呼叫端傳入的真實登入態
//     設定(見下方 TripPlanPage 對 cfg 參數的完整說明),不是原型的
//     GUEST_CFG 免登入假資料查詢路徑。
//
// getSteps/addStop/setStopNote 用 ref 包一層(理由同原型的完整
// 說明)——這幾個函式來自呼叫端每次 render 產生的新閉包,若直接放進
// useEffect 依賴陣列會導致每次重渲染都重新建立一次 WebSocket 連線。
// resetBridgeTurnState——丟棄「目前這一輪推論」的前端狀態:思考中(ref 與 state 同步寫)、待配對佇列、還在等 postPlanAiChat 的送出。
// 連線 effect 的 cleanup(cfg 換參照/按停止/卸載,舊世代已 expire)與 stopPrompt 都呼叫它:舊世代 expire 之後它的回覆與 onError
// 都會被 guardCallback 丟掉、永遠不會來,不在這裡收回思考中,輸入框就會一直卡在「AI 思考中」。
// sendSeq.invalidate() 讓 await 中的送出回來後不再 push 佇列、不轉發到重建後的新連線(否則新連線收到舊送出,狀態又對不上)。
// 抽成獨立函式方便單獨測試(見 bridgeReconnectReset.test.ts)。
export function resetBridgeTurnState(s: {
  isThinkingRef: { current: boolean }
  pendingChatRef: { current: number[] }
  sendSeq: { invalidate(): void }
  setIsThinking: (v: boolean) => void
}) {
  s.sendSeq.invalidate()
  s.pendingChatRef.current = []
  s.isThinkingRef.current = false
  s.setIsThinking(false)
}

function usePlanAiChatBridge(
  cfg: ClientConfig,
  getTimeline: () => PlanTimeline,
  // addStop/setStopNote/removeStop——站點操作,名稱與型別取自 PlanOperations(見 timeline/operations.ts)。
  addStop: PlanOperations['addStop'],
  setStopNote: PlanOperations['setStopNote'],
  removeStop: PlanOperations['removeStop'],
  // addDay/moveDay——天的操作(add_day/move_day 工具的底層,見 usePlanTimelineCore)。
  addDay: PlanOperations['addDay'],
  moveDay: PlanOperations['moveDay'],
  // setLodging/removeLodging——住宿的操作(set_lodging/remove_lodging 工具的底層,見 usePlanTimelineCore)。
  setLodging: PlanOperations['setLodging'],
  removeLodging: PlanOperations['removeLodging'],
  // userSelectionRef——使用者最近一次在詢問頁的選擇(見
  // planning/conversation/asktools.ts UserSelectionRecord 的完整說明)。
  //
  // 由呼叫端(元件)持有並寫入(handleAskPageDone),這裡只負責讀——
  // 寫入的時機在元件的事件處理裡,讀取的時機在這個 hook 組出來的
  // askPageCtx 被工具呼叫時,兩邊透過同一個 ref 物件共用。
  userSelectionRef: MutableRefObject<UserSelectionRecord | null>,
  // attractionPool——這次對話出現過的景點(見
  // planning/conversation/attractionPoolStore.ts 的完整說明)。這個 hook 兩邊都用
  // 到:search_attraction 查到候選時寫進去,get_attraction_pool 被呼叫
  // 時讀出來。
  attractionPool: AttractionPoolStore,
  // openAskPage——2026-10 新增(使用者明確要求「詢問頁的內容跟啟動,要
  // 可以透過程式自己啟動,也要讓 AI 的工具來啟動」),2026-10(第二輪,
  // 使用者明確要求「open_ask_page 要可以輸出 attraction id 與
  // place id」)改成非同步、帶候選清單、回傳選擇結果:讓這個 hook 內部
  // 組裝的 AgentBridge 工具表(見下方 askPageCtx)能呼叫呼叫端
  // (TripPlanPage 本體)的「開詢問頁並等待使用者選擇」邏輯,對齊
  // addStop/setStopNote/removeStop 這幾個既有參數的同一個模式——
  // 這個 hook 不自己持有詢問頁顯示狀態或候選清單,只是把呼叫端傳進來的
  // 函式接到 open_ask_page 工具的 ctx 上。
  //
  // 2026-10(第三輪,使用者明確要求「open_ask_page 輸入支援一個模式,
  // 探查模式」)參數從單純的候選清單改成 candidates 或 explore 其中
  // 一種(見 planning/conversation/asktools.ts AskPageCtx.openAskPage 的完整
  // 說明)。
  //
  // 2026-10(第四輪,使用者明確要求「後端的純文字對話也統一在 ask page
  // 裡面顯示對話氣泡」)型別再加上 { text },見下方 onAssistantMessage
  // 呼叫處的完整說明——這個分支不是透過 open_ask_page 工具觸發,是
  // onAssistantMessage 收到純文字回覆時直接呼叫,但共用同一個
  // openAskPage 函式(本質上都是「切到詢問頁顯示某個 input」),不需要
  // 另外開一個參數或另一條路徑。
  //
  // 2026-10(第五輪)型別改用 AskPageInput(見該型別的完整說明:集中
  // 定義,不在這裡重複列舉聯集成員)——新增的 region/transport 兩種
  // 不經過這個參數本身的型別擴充就能支援,因為 AskPageInput 已經涵蓋,
  // 這裡不需要另外改動,只有下方 askPageCtx 組裝處需要新增對應的
  // wrapper(見該處的完整說明)。
  openAskPage: (input: AskPageInput) => Promise<AskPageSelection[]>,
  // resolveAskPage——useAskPageBridge 的 handleAskPageDone。使用者改用
  // 文字輸入框送出新訊息時,視為放棄目前畫面上還沒操作完的詢問頁(城市
  // 選單、景點候選等),用空陣列 resolve 掉它(等同按下「不用了」)。
  //
  // 為什麼需要這一步:useAskPageBridge.openAskPage 在「已有 pending」時
  // 會直接忽略新的呼叫(見該檔案「2026-10 訂正」的完整說明)——這個保護
  // 原本是為了不讓背景的文字回覆打斷使用者正在操作的候選卡片,但沒考慮
  // 到使用者也可能主動放棄畫面上的詢問頁、改用文字告訴 LLM 下一步要做
  // 什麼。這種情況下舊的 pending resolve 永遠不會被清掉,导致 LLM 之後
  // 呼叫的任何 ask_*/open_ask_page 都會被同一個保護機制靜默吞掉,而
  // conversation/asktools.ts 的回傳訊息仍然宣稱「已顯示」,LLM 完全無法得知畫面
  // 其實沒有更新(實機重現:城市選單還開著時直接打字「我要去大阪」,
  // LLM 查完景點呼叫 open_ask_page 卻被吞掉,畫面卡在舊的城市選單)。
  resolveAskPage: (selected: AskPageSelection[]) => void,
  // appendMessage——把一則訊息寫進獨立的對話狀態(planning/conversation/usePlanConversation.ts)。AI 的純文字回覆、
  // onError 與 sendPrompt 失敗的連線錯誤訊息都走這裡,不再插入時間軸節點(訊息只依發生順序、沒有位置)。
  appendMessage: (message: PlanMessage) => void,
  // collectToolCallLog——呼叫端是否有人讀 toolCallLog(傳了 onToolCallLogChange 才為 true)。
  // false 時不傳 onToolResult 給 toAgentBridgeTools、也不 setState。
  collectToolCallLog: boolean,
) {
  const apiKey = import.meta.env.VITE_PLAN_AI_ONAGENT_APP_KEY as string | undefined
  const [status, setStatus] = useState<PlanAiChatStatus>('connecting')
  // isThinking——從 sendPrompt 呼叫那一刻開始 true,到收到第一個
  // onAssistantMessage 或 onError、或連線重建(停止/cfg 換參照/卸載,見 resetBridgeTurnState)為止轉回 false,接給呼吸點/骨架卡那組
  // 思考動畫用(理由同原型的完整說明)。
  const [isThinking, setIsThinking] = useState(false)
  // isThinkingRef——sendPrompt(useCallback,依賴陣列只有 [cfg])需要讀到
  // isThinking 的「當下最新值」來擋併發送出,但不能把 isThinking 放進
  // 依賴陣列(那會讓每次 isThinking 變動都重建 sendPrompt 這個函式參照,
  // 牽連呼叫端的 effect/記憶化),改用 ref 代替。
  //
  // 每個設定 isThinking state 的地方(sendPrompt/onAssistantMessage/
  // onError)都「同步」一併寫入 isThinkingRef.current,不依賴下面這個
  // useEffect 去鏡射——state 更新到 effect 真正執行之間有 React 排程/
  // commit 的真實時間差,若只靠 effect 更新 ref,這個時間差就是併發保護
  // 可以被繞過的窗口(兩次幾乎同時的 sendPrompt 呼叫都可能在 ref 還沒
  // 追上前讀到舊值、雙雙通過守門)。這個 effect 只是補一道保險(例如萬一
  // 之後有新增的狀態轉換路徑漏寫同步賦值),不是這個 ref 的主要更新
  // 來源。
  const isThinkingRef = useRef(false)
  useEffect(() => {
    isThinkingRef.current = isThinking
  }, [isThinking])
  // toolCallLog——AI 推論過程中每次工具呼叫的紀錄(工具名稱/參數/回傳值),
  // 給 /ai-plan 的 debugSafeArea 疊圖面板顯示用(見 toAgentBridgeTools 的
  // onToolResult 參數的完整說明:@onagent/bridge SDK 本身不提供工具呼叫
  // 層級的回呼,只能在我們自己註冊給 SDK 的 tool handler 外面包一層)。
  // 只有呼叫端傳了 onToolCallLogChange(collectToolCallLog=true)才收集,
  // 且最多保留最近 MAX_TOOL_CALL_LOG 筆(見 appendToolCallLog)。
  const [toolCallLog, setToolCallLog] = useState<ToolCallLogEntry[]>([])
  const recordToolCall = (info: { name: string; args: Record<string, unknown>; result: unknown }) =>
    setToolCallLog((log) => appendToolCallLog(log, info))
  const bridgeRef = useRef<AgentBridge | null>(null)
  // bridgeEpoch/sendSeqRef——「停止」用(見 stopPrompt):AgentBridge 沒有取消單次推論的協議(只有 prompt 與 close),
  // 所以停止的做法是丟棄這次推論——關掉目前的連線(推論中的工具呼叫與回覆不再進來)並用 bridgeEpoch 觸發 effect 重連;
  // sendSeqRef 讓還在等 postPlanAiChat 的送出在停止後不再轉發給 onagent。
  const [bridgeEpoch, setBridgeEpoch] = useState(0)
  const sendSeqRef = useRef(createSendSequence())
  // guardRef——目前這個 bridge 世代的防護(見 planning/conversation/guard.ts)。stopPrompt 要「立刻」expire 它:
  // setBridgeEpoch 之後 effect cleanup 要等下一次 commit 才跑,中間這段視窗舊世代的事件不能還有效。
  const guardRef = useRef<BridgeGuard | null>(null)
  const getTimelineRef = useRef(getTimeline)
  const addStopRef = useRef(addStop)
  const setStopNoteRef = useRef(setStopNote)
  const removeStopRef = useRef(removeStop)
  const addDayRef = useRef(addDay)
  const moveDayRef = useRef(moveDay)
  const setLodgingRef = useRef(setLodging)
  const removeLodgingRef = useRef(removeLodging)
  const openAskPageRef = useRef(openAskPage)
  const appendMessageRef = useRef(appendMessage)
  useEffect(() => {
    getTimelineRef.current = getTimeline
    addStopRef.current = addStop
    setStopNoteRef.current = setStopNote
    removeStopRef.current = removeStop
    addDayRef.current = addDay
    moveDayRef.current = moveDay
    setLodgingRef.current = setLodging
    removeLodgingRef.current = removeLodging
    openAskPageRef.current = openAskPage
    appendMessageRef.current = appendMessage
  })

  // conversationIDRef——這個對話在整個 TripPlanPage 掛載期間延用同一個
  // conversationID:第一次呼叫 postPlanAiChat 時不帶 conversationID,後端
  // 生成一個新的並透過回應帶回,這裡記下來,之後每次送訊息都帶著同一個,
  // 不會每次都被當成開新對話。用 ref 而非 state——這個值不需要觸發重渲染,
  // 純粹給 sendPrompt 讀寫。
  const conversationIDRef = useRef<string | undefined>(undefined)

  // pendingChatRef——追蹤「已經呼叫過 postPlanAiChat、轉發給 onagent、但
  // 還沒收到 onagent 回覆」的訊息 messageID,用一個 FIFO 佇列而非單一值
  // (理論上現在併發已經被 sendPrompt/isThinkingRef 擋住,任何時刻這個
  // 佇列最多只會有一筆,見 sendPrompt 的完整說明——仍保留陣列型態而非
  // 單一值,是為了在未來萬一又放寬併發限制時,不需要重新設計這個佇列的
  // 資料結構)。只存 messageID,不重複存 conversationID——同一個 bridge
  // 實例終身只對應同一個 conversationID(見 conversationIDRef 的完整
  // 說明),每筆佇列項目各自存一份沒有額外資訊,直接共用
  // conversationIDRef.current 即可。
  const pendingChatRef = useRef<number[]>([])

  useEffect(() => {
    // urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明:URL 缺失時不再
    // 嘗試建立一個注定連不上的連線,直接不執行這個 effect,呼叫端據下方
    // 回傳的 urlMissing 顯示明確提示,不是留一個看起來正常、實際永遠沒有
    // 回應的連線狀態。
    if (!apiKey || !PLAN_AI_ONAGENT_WS_URL) return
    // ctx——同原型的完整說明:addStop/setStopNote 轉接同步
    // 回傳值成這個 ctx 介面期望的 Promise 形狀(async 函式回傳非 Promise
    // 值會被自動裝箱,不需要刻意包 Promise.resolve)。
    // guard——這個 effect(一個 bridge 實例)的世代防護,見 planning/conversation/guard.ts 的完整說明(含 @onagent/bridge close() 語意的結論)。
    // 之後所有 bridge 回呼與 ctx 方法都要經過它:停止/重連/卸載後留下的舊世代事件與還在跑的工具一律失效。
    const guard = createBridgeGuard()
    guardRef.current = guard
    // 行動前先確認目前行程、AI 自己的寫入算已讀、天數上限——全部收在 createPlanAiCtx(見 planning/conversation/context.ts 的完整說明,可單獨測試)。
    // 底層函式用 ref 間接呼叫(理由見上方各 ref),getTimeline 讀 getTimelineRef(同步反映剛 commit 的內容,不經過 render)。
    // getTimeline 只有 list_itinerary 用(記下簽名),內部流程(交通重算、背景補查)讀的是 getTimelineRef,不會誤記讀取。
    const { ctx: rawCtx, ensureFreshRead } = createPlanAiCtx({
      getTimeline: () => getTimelineRef.current(),
      addStop: (anchorId, newId, data) => addStopRef.current(anchorId, newId, data),
      setStopNote: (anchorId, text, category) => setStopNoteRef.current(anchorId, text, category),
      // removeStop——見 AttractionStepsCtx.removeStop 的完整說明:底層回傳 boolean,內部用 removeNode 的結構化結果同時判斷
      // 「id 不存在」與「id 已經在移除中(淡出動畫播放期間)」兩種情況(見 usePlanTimelineCore.removeStop)。
      removeStop: (id) => removeStopRef.current(id),
      addDay: (atDay) => addDayRef.current(atDay),
      moveDay: (fromDay, toDay) => moveDayRef.current(fromDay, toDay),
      setLodging: (args) => setLodgingRef.current(args),
      removeLodging: (lodgingId) => removeLodgingRef.current(lodgingId),
    })
    // guardCtx——過期的世代呼叫任何 ctx 方法都 throw,晚到的工具呼叫失敗而不是寫入時間軸。
    const ctx = guardCtx(guard, rawCtx)
    // askPageCtx——見 planning/conversation/asktools.ts 開頭的完整說明:獨立於
    // 上方 ctx(AttractionStepsCtx,時間軸資料操作)之外的另一個 ctx,
    // 職責分離(UI 顯示狀態控制 + 等待使用者輸入)。openAskPage 是呼叫端
    // (TripPlanPage 本體)傳入的函式,參照可能隨每次 render 改變,透過
    // openAskPageRef 間接呼叫(理由同 addStopRef 等其餘 ctx
    // 方法:這個 effect 的依賴陣列只有 [apiKey, cfg],不能把會隨 render
    // 變動的函式參照直接寫進 closure)。
    //
    // askTravelCountry/askTravelCity/askTransportMode——2026-10 新增
    // (見 conversation/asktools.ts AskPageCtx 開頭「第五輪」的完整說明:工具
    // 共用同一個底層 openAskPageRef,這裡各自包一層轉換單選值
    // <-> AskPageSelection[] 的 wrapper)。askTransportMode 是:呼叫底層
    // openAskPage({ transport })顯示對應的詢問頁內部元件,等待使用者
    // 選完後拿到 AskPageSelection[],取第一筆的 placeId 當選中值(借用
    // 這個欄位表達「這次選中項目的識別碼」,不是真的 Google Place ID,
    // 見 useAskPageBridge.ts「2026-10 第五輪」對這個 trade-off 的完整
    // 說明);空陣列(使用者按「不用了」)回傳 null,不是拋錯——跟
    // open_ask_page 對「不用了」的既有語意一致。
    //
    // askTravelCountry/askTravelCity——2026-10(第十輪,使用者明確要求
    // 「將國家與地區的工具分開,並做自動串接」)從原本單一的
    // askTravelRegion 拆成兩個獨立 wrapper,對應
    // ask_travel_country/ask_travel_city 兩支獨立工具(見
    // AskPageCountryInput/AskPageCityInput 的完整說明)。兩者都只是
    // 「開啟選單就回傳」,不等使用者選完(使用者明確要求「都不需要
    // 等待」,理由見 planning/conversation/asktools.ts 檔頭第三輪的完整說明:
    // 等待模式會讓一輪推論的生命週期綁在使用者的操作節奏上)。
    //
    // 「選完國家 → 自動顯示城市清單」「選完城市 → 自動查鄰近候選 →
    // 再開景點選單」這兩段串接都不在這裡做,而是在 handleAskPageDone
    // (使用者按下選擇的那一刻,見該函式的完整說明)——串接本來就不需要
    // LLM 參與,它全部發生在前端,LLM 在開啟第一個選單時這一輪就已經
    // 結束了。
    const askPageCtx: AskPageCtx = guardCtx(guard, {
      // 詢問工具(open_ask_page/ask_*)同樣要先確認目前行程:詢問的內容常常取決於已經排了什麼。檢查放在工具層(ensureFreshRead,
      // 見 AskPageCtx.ensureFreshRead:ask_* 是 fire-and-forget,在這些方法裡 throw 不會讓工具失敗)。
      ensureFreshRead,
      openAskPage: (input) => openAskPageRef.current(input),
      askTravelCountry: async (input) => {
        void openAskPageRef.current({ country: input })
        return null
      },
      askTravelCity: async (input) => {
        void openAskPageRef.current({ city: input })
        return null
      },
      askTransportMode: async (modes, reason) => {
        // reason 要轉傳(2026-10 修正):AskPage 的 TransportPanel 會用它
        // 取代寫死的標題「這段要怎麼移動?」。漏掉的話 LLM 不管傳什麼
        // 文案都不會顯示——open_ask_page 原樣轉交整個 input、
        // ask_travel_region 的 reason 包在 AskPageRegionInput 裡一起帶
        // 進去,只有這一支是逐個欄位重組,所以漏了。
        void openAskPageRef.current({ transport: modes, reason })
        return null
      },
      // getUserSelection——見 userSelectionRef 的完整說明。透過 ref
      // 讀取,不是閉包捕捉當下的值:這個 ctx 物件只在建立 AgentBridge
      // 時組一次,直接讀值會永遠拿到掛載當下的 null。
      getUserSelection: () => userSelectionRef.current,
      getAttractionPool: () => attractionPool.list(),
      // getUiState——使用者目前在哪一個畫面(見 planning/conversation/uiStateStore.ts
      // 的完整說明)。讀 module 單例而非 React state,理由同上方
      // getUserSelection 的 ref:這個 ctx 只在建立 AgentBridge 時組一次。
      getUiState: () => uiStateStore.get(),
    } satisfies AskPageCtx)
    const bridge = new AgentBridge({
      url: PLAN_AI_ONAGENT_WS_URL,
      appId: PLAN_AI_ONAGENT_APP_ID,
      apiKey,
      // SSE 傳輸(@onagent/bridge 0.2.0 起):下行 Server-Sent Events、上行 HTTP POST,過得了會擋 WebSocket Upgrade 的代理;sseUrl 預設由
      // url 換算(ws→http、結尾 /ws→/sse)。
      transport: 'sse',
      // tools——合併兩份各自獨立的工具表(各自搭配各自的 ctx 型別,見
      // toAgentBridgeTools<Ctx> 的泛型簽名與 conversation/asktools.ts 開頭的完整
      // 說明):conversation/tools.ts 負責時間軸資料操作,conversation/asktools.ts 負責
      // UI 顯示狀態控制。LLM 眼中這兩批工具完全無法區分、可以在同一次
      // 對話裡混用,只是前端這一層的程式碼組織各自獨立。
      tools: {
        // onPlacesFound——search_attraction 查到候選時寫進景點池(見
        // planning/conversation/attractionPoolStore.ts 的完整說明),之後 LLM 用
        // get_attraction_pool 就能把 placeId 對照成名稱。
        //
        // onToolResult(第三個參數)——見上方 toolCallLog 的完整說明,兩份
        // 工具表共用同一個記錄 callback,append 進同一份陣列(依呼叫完成
        // 順序排列,不分工具表來源)。
        ...toAgentBridgeTools(createAttractionToolsList(cfg, (places) => attractionPool.put(places)), ctx, collectToolCallLog ? recordToolCall : undefined),
        ...toAgentBridgeTools(createAskPageToolsList(), askPageCtx, collectToolCallLog ? recordToolCall : undefined),
      },
      // onAssistantMessage/onError——把文字寫進獨立的對話狀態(planning/conversation/messages.ts,
      // 2026-10-24 起不再是時間軸裡的 message 節點:對話有自己的狀態、只在記憶體,訊息只依發生順序、沒有所在天或站點),
      // 桌面時間軸把它們渲染在最下方。
      //
      // 2026-10(使用者明確要求「後端的純文字對話也統一在 ask page 裡面
      // 顯示對話氣泡」):除了寫進對話,額外呼叫
      // openAskPage({ text }) 讓畫面自動切到 AskPage 顯示這則文字——
      // 對齊 LLM 呼叫 open_ask_page 工具時的同一條「切到詢問頁」路徑,
      // 只是這裡是元件自己直接觸發,不經過工具呼叫。不 await 這個呼叫:
      // openAskPage 回傳的 Promise 要等使用者關閉氣泡(onDone)才會
      // resolve,但這裡只是要「顯示」,不需要像 open_ask_page 工具那樣
      // 等待結果再做下一步。
      // 兩個回呼都包 guardCallback:過期世代(使用者已按停止)的晚到事件直接丟掉,不 append、不開詢問頁、不碰 pendingChatRef
      // (stopPrompt 剛清空它,過期回呼再 shift 會讓下一輪回覆錯位配對)。
      onAssistantMessage: guardCallback(guard, (text: string) => {
        isThinkingRef.current = false
        setIsThinking(false)
        appendMessageRef.current({ id: `agent-msg-${crypto.randomUUID()}`, text })
        openAskPageRef.current({ text })

        // postPlanAiChatReply——fire-and-forget:把 onagent 這則回覆存檔。
        // 不 await、不讓失敗影響上面已經完成的訊息顯示邏輯,只在失敗時
        // console.warn(見 postPlanAiChatReply 的完整說明)。
        // 從 pendingChatRef 佇列取出最早一筆 messageID(與 sendPrompt 成功
        // 時 push 的順序一致,理由見 pendingChatRef 的完整說明)——
        // conversationID 直接用 conversationIDRef.current(整個 bridge
        // 實例終身只有一個,不需要跟著佇列項目各自記錄,見 pendingChatRef
        // 的完整說明)。若佇列是空的(理論上不該發生,但保險起見判斷一下,
        // 例如 postPlanAiChat 失敗後仍收到 onagent 回覆這種邊界狀況),
        // 就不呼叫這支端點。
        const messageID = pendingChatRef.current.shift()
        if (messageID !== undefined && conversationIDRef.current) {
          postPlanAiChatReply(cfg, conversationIDRef.current, messageID, text).catch((err) => {
            console.warn('postPlanAiChatReply 失敗(不影響對話顯示):', err)
          })
        }
      }),
      onError: guardCallback(guard, (err: { message: string }) => {
        isThinkingRef.current = false
        setIsThinking(false)
        // 跟 onAssistantMessage 一樣要 shift 掉佇列最早一筆——bridge
        // 回呼錯誤代表這次 prompt() 不會再有 assistant_message 進來,
        // 若不清掉,這筆 pending 會永遠卡在佇列最前面,後續每一則真正
        // 收到的回覆都會錯位配對到它(見 pendingChatRef 的完整說明)。
        pendingChatRef.current.shift()
        appendMessageRef.current({ id: `agent-msg-${crypto.randomUUID()}`, text: `(連線錯誤: ${err.message})` })
      }),
    })
    bridgeRef.current = bridge
    setStatus('connecting')
    // AgentBridge 沒有連線成功的 callback,用送出後短暫延遲樂觀顯示
    // ready(對齊原型 useOnagentChatBridge.ts(已移除)的做法)。
    const t = window.setTimeout(() => setStatus('ready'), 500)
    return () => {
      window.clearTimeout(t)
      // 先 expire 再 close:close() 不會取消已在跑的工具(見 conversation/guard.ts),世代標記過期才擋得住它們後續的 ctx 呼叫。
      guard.expire()
      if (guardRef.current === guard) guardRef.current = null
      // 世代過期後這一輪的回覆不會再來(被 guardCallback 丟掉),一併收回思考中與待配對佇列——cfg 換參照(換 token、重新登入)
      // 時 effect 也會重建,不只停止;漏掉的話輸入框會卡在「AI 思考中」(見 resetBridgeTurnState)。
      resetBridgeTurnState({ isThinkingRef, pendingChatRef, sendSeq: sendSeqRef.current, setIsThinking })
      bridge.close()
      bridgeRef.current = null
      setStatus('closed')
    }
  }, [apiKey, cfg, bridgeEpoch])

  // sendPrompt——送出訊息前先呼叫自家後端 postPlanAiChat(見該函式與
  // server/internal/api/plan_ai_chat.go 的完整說明):後端驗證、
  // rate-limit、存記錄,回傳正規化後的 content。只有這一步成功,才把
  // 「後端回傳的 content」(不是使用者原始輸入)轉發給 onagent——這一步
  // 失敗(429 rate_limited/400 content_too_long 等)時不轉發,改用跟
  // onError 相同的機制(寫進對話的一則訊息)顯示錯誤,讓使用者看到
  // 合理的提示,不是靜默吞掉或讓對話卡住。
  //
  // 並發保護:isThinking 期間直接拒絕新的 sendPrompt(呼叫端的 input/
  // button 也會在 isThinking 時 disabled,這裡是第二層防線,理由同——
  // pendingChatRef 的 FIFO 配對完全依賴「任何時刻最多一筆 pending」這個
  // 前提才成立。AgentBridge 的 onAssistantMessage 回呼協議本身不帶
  // request id(無法得知某個回覆對應哪一次 prompt() 呼叫),一旦允許並發
  // 送出,只要兩則訊息的 onagent 處理時間不同導致回覆抵達順序跟送出順序
  // 不一致,shift() 就會取出錯誤配對,把 A 訊息的回覆存成 B 訊息的回覆。
  // 與其在協議層面補 request id(改動範圍涉及 onagent 平台本身,不是這次
  // 範圍能做的),更務實的做法是從源頭擋住並發,讓佇列最多只有一筆。
  // 回傳值(boolean):true 代表已成功送到後端並轉發給 onagent,呼叫端
  // (下方 onSubmit)據此決定要不要清空輸入框——失敗時回 false,呼叫端
  // 保留使用者原本打的文字,不會因為後端拒絕(429/400)或網路錯誤而憑空
  // 消失、需要重打一次。
  const sendPrompt = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !bridgeRef.current || isThinkingRef.current) return false
    // 放棄目前畫面上還沒操作完的詢問頁——見上方 resolveAskPage 參數的
    // 完整說明。對沒有 pending 的情況是安全的 no-op(useAskPageBridge
    // 內部用 ?. 保護過)。
    resolveAskPage([])
    // isThinkingRef.current 在這裡同步設成 true,不只靠下面的 setIsThinking
    // 觸發 useEffect 鏡射——state 更新到 effect 真正執行之間有 React
    // 排程/commit 的真實時間差,若只靠 effect 更新 ref,這個時間差就是
    // 併發保護可以被繞過的窗口(兩次幾乎同時的呼叫都會在 ref 還沒追上前
    // 讀到舊值、雙雙通過上面的判斷),等於併發保護本身又重新引入了它原本
    // 要避免的時序依賴。同步寫入才是真正對時序不敏感的第二層防線。
    isThinkingRef.current = true
    setIsThinking(true)
    const seq = sendSeqRef.current.begin()
    try {
      const result = await postPlanAiChat(cfg, trimmed, conversationIDRef.current)
      conversationIDRef.current = result.conversationID
      // 等後端回應期間使用者按了停止(stopPrompt 已遞增 sendSeqRef):訊息已存檔但不再轉發給 onagent。
      if (!sendSeqRef.current.isCurrent(seq)) return false
      pendingChatRef.current.push(result.messageID)
      bridgeRef.current?.prompt(result.content)
      return true
    } catch (err) {
      if (!sendSeqRef.current.isCurrent(seq)) return false
      isThinkingRef.current = false
      setIsThinking(false)
      // 錯誤文案:ApiError.message 本身就是後端已經給好的繁體中文訊息
      // (例如 rate_limited→「訊息送得太快了,請稍後再試」、
      // content_too_long→「訊息內容過長,最多 500 字」,見
      // handlePlanAiChat 的完整說明),直接顯示即可,不需要自己依 code
      // 重新組文案;非 ApiError(連線層級失敗,例如網路斷線)才用通用的
      // 連線錯誤措辭,對齊既有 onError 的措辭風格。
      const errText = err instanceof ApiError ? err.message : '(訊息送出失敗,請檢查網路連線後再試一次)'
      appendMessageRef.current({ id: `agent-msg-${crypto.randomUUID()}`, text: errText })
      return false
    }
  }, [cfg, resolveAskPage])

  // stopPrompt——推論中按「停止」:丟棄這次推論,回到可以再送出的狀態。沒有在推論時什麼都不做。
  // 清掉 pending 佇列(這次的回覆不會再來,不清會讓下一則回覆錯位配對)、放棄畫面上未操作完的詢問頁(同 sendPrompt),
  // 再遞增 bridgeEpoch 讓連線 effect 關掉舊連線並重連;conversationIDRef 保留,對話仍是同一個。
  const stopPrompt = useCallback(() => {
    if (!isThinkingRef.current) return
    // 立刻讓舊世代過期:之後舊 bridge 的回呼與還在跑的工具都失效,不等 effect cleanup(見 guardRef)。
    guardRef.current?.expire()
    // bridgeRef 先清掉:到下一次 effect 建好新 bridge 之前,sendPrompt 不會把訊息送到這個即將關閉的舊連線。
    bridgeRef.current = null
    // 同步重設(不等 cleanup):停止鈕按下的當下輸入框就要恢復;cleanup 之後再重設一次是冪等的。
    resetBridgeTurnState({ isThinkingRef, pendingChatRef, sendSeq: sendSeqRef.current, setIsThinking })
    resolveAskPage([])
    setBridgeEpoch((e) => e + 1)
  }, [resolveAskPage])

  return {
    apiKeyMissing: !apiKey,
    // urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明,呼叫端據此顯示
    // 提示、鎖定輸入框,對稱 apiKeyMissing 的既有處理方式。
    urlMissing: !PLAN_AI_ONAGENT_WS_URL,
    status,
    isThinking,
    sendPrompt,
    stopPrompt,
    toolCallLog,
  }
}

// TripPlanPage — /app 底下正式的「AI 安排行程」功能頁面。
//
// cfg 是必填——這是正式功能,操作的是真實使用者的行程資料,
// 不應該有「沒登入也能用」的路徑。onagent 對話部分原本(原型)用
// GUEST_CFG 的地方,這裡全部改成用這裡傳入的 cfg。
//
// 不接 tripID——這個功能不依附在特定旅程上:onagent 對話工具集
// (conversation/tools.ts)操作的是這個元件內部的 timeline state,不是
// 後端的 trip_entry_* 資料,沒有「寫入哪一個真實行程」這個概念,使用者
// 明確要求「plan ai 不需要 trip id」,不必先選定一趟旅程才能使用這個
// 功能(呼叫端 desktop/Nav.tsx 對應拿掉 requiresTrip)。原本還有獨立的
// tripName prop 顯示行程名稱/「未命名行程」,使用者明確要求不要顯示
// (外層桌面版 rail、手機版 sheet 標頭已經各自有行程情境,這裡不需要
// 再重複),連同 prop 一併移除,呼叫端不再傳入。
export function TripPlanPage(props: {
  cfg: ClientConfig
  // compact——2026-10 新增:這個元件原本有兩個使用情境,版面需求不同。
  //   - 預設(compact 省略):整頁顯示,捲動權在外層
  //     DesktopMain(unboundedScroll),.page 自己是自然高度。原本給 /trip-plan
  //     全頁用,該頁已移除(2026-10-23),目前所有呼叫端都經 PlanPanelContent 帶 compact。
  //   - 地圖規劃的規劃面板(compact):沒有任何祖先在管捲動,且
  //     FloatingPanel 的 .panel 是 overflow:hidden——.page 必須自己變成
  //     固定高度的 flex 容器、讓時間軸區塊接手捲動,否則內容會一路往下
  //     撐、超出的部分被裁掉且完全捲不動(使用者實際回報的 bug)。
  // 用明確的 prop 而非偵測容器尺寸:呼叫端在渲染當下就知道自己把這個
  // 元件放進哪種容器,不需要執行期量測,理由同 DesktopMain 的 unbounded
  // prop 取代原本 :has() 被動偵測的既有決定。
  compact?: boolean
  // visible——這個實例此刻在畫面上看不看得見。只有 compact(規劃面板)
  // 需要傳:那張規劃面板是常駐掛載、用 display:none 隱藏的,元件不會因為
  // 「關閉」而卸載,所以無從用掛載時機去重讀持久化內容。
  //
  // 從隱藏轉為可見時,把共用同一份 localStorage 的其他實例在這期間寫入的
  // (原本主要是已移除的 /trip-plan 全頁版)
  // 內容讀回來——否則規劃面板會一直顯示它掛載當下的舊時間軸(見
  // usePlanTimelineCore 的 resyncFromStorage 與 revRef 的完整說明)。
  // 省略時視為永遠可見,維持原本行為(全頁版靠掛載/卸載就足夠)。
  visible?: boolean
  // scrollContainerRef——2026-10 新增:真正接手捲動的 DOM 節點,取代原本
  // 用 scrollRef.current?.closest('main') 從內部往上爬著猜的做法(見
  // scrollToLatest/handleScroll 的完整說明)。
  //   - 非 compact 全頁(原本的 /trip-plan,已移除):呼叫端傳入指向 DesktopMain(<main>)的 ref,
  //     捲動權在那個撐滿視窗的外層容器(unboundedScroll)。目前沒有呼叫端傳這個 prop。
  //   - 地圖規劃的規劃面板(compact):不傳——元件內部的 scrollRef
  //     (指向 .scroll,compact 模式下疊加 .compactScroll 接手捲動)本身
  //     就是真正的捲動容器,fallback 用它自己。
  // 選填且不要求呼叫端一定要配 compact 傳——兩者語意不同,compact 決定
  // 版面/樣式,scrollContainerRef 單純告知「量測與監聽事件要對著哪個
  // 節點」,理論上未來若有第三種容器情境,兩者可以獨立變化。
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  // onPanToStop——2026-10 新增:點擊站點卡時,把該站的座標交給呼叫端,
  // 讓外層的地圖移動過去。
  //
  // 為什麼是選填、而且由呼叫端決定怎麼移動:這個元件本身沒有地圖
  // (原本 /trip-plan 全頁的右上角小地圖已移除,見下方 panToStop 的說明),
  // 不同使用情境對「點了卡片之後該發生什麼」的答案不同——
  //   - 沒有外層地圖的情境(例如原本的 /trip-plan 全頁,已移除):省略這個 prop,
  //     只做卡片高亮。
  //   - 地圖規劃的規劃面板:外面就是整張地圖,傳入後點卡片會把地圖
  //     平移到該站(見 planning/member/desktop/Content.tsx 傳入時的完整說明)。
  // 元件自己不 import 任何地圖模組,維持「時間軸就只是時間軸」,不因為
  // 其中一個使用情境多了地圖就把地圖依賴帶進所有情境。
  onPanToStop?: (stop: { lat: number; lng: number }) => void
  // onStopsChange——2026-10 新增:時間軸上「已經查到座標」的站點清單有
  // 變動時回報給呼叫端,讓外層的地圖畫出對應的小圓點(使用者明確要求
  // 「開啟對話若是有安排景點,地圖上出現小圓點」)。
  //
  // 選填,理由同 onPanToStop:沒有外層地圖的情境省略即可。
  //
  // 注意這個元件在規劃面板裡是常駐掛載的(FloatingPanel 只用 display:none
  // 隱藏,見 planning/member/desktop/Content.tsx 對那個設計的完整說明——為的是避免每次開關
  // 都重建 WebSocket 連線)。所以規劃面板「關閉」期間這裡仍會持續回報(AI 還
  // 在串流、背景座標回填都會讓清單變動),呼叫端收到的 state 也不會歸零。
  // 圓點要不要顯示因此完全由呼叫端決定(見 planning/member/desktop/Content.tsx 傳給
  // PlanMap 時的顯示判斷),這個元件不負責那件事。
  //
  // 這些回調不需要穩定的 identity:元件內部已用 useStableCallback 隔離
  // (見下方 reportStops 與 selectStop),呼叫端的函式參照不會進任何
  // 依賴陣列,傳 inline 箭頭函式是安全的。
  onStopsChange?: (stops: PlanStopMarker[]) => void
  // onRouteSegmentsChange——2026-10-24 新增:地圖上站點之間要畫的連線段(有交通膠囊的那一段才畫,規則在
  // planning/timeline/segments.ts,三個入口共用)有變動時回報,呼叫端依功能開關決定要不要傳給 PlanMap 畫。
  // 回報時機與 onStopsChange 相同(資料變動而非單一事件,走 useEffect),同樣用 useStableCallback 隔離呼叫端的函式參照。
  onRouteSegmentsChange?: (segments: RouteSegment[]) => void
  // dataSource——地點查詢的存取層(見 planning/data/source.ts
  // 的完整說明)。必填(2026-10):原本選填、省略時內部預設用需登入的真後端實作(/app 的既有行為),但靠隱藏預設值
  // 決定打哪個端點容易在新入口漏傳(訪客入口漏傳就會連噴 401),改成每個入口(各自的 LivePlanLayer)明確傳。
  //
  // 2026-10 新增(使用者明確要求「把存取層定義介面,用不同的實作抽換」、
  // 「展示內用公開的」):/ai-plan 展示頁交接後走的是這個元件,但那是
  // 未登入的訪客——原本固定用 createPlanAiApiDataSource 打 /internal/*,
  // 實機連噴 401(照片 8 次、交通 2 次),卡片的照片與交通時間全部補不
  // 上來。改由呼叫端注入:/ai-plan 的 LivePlanLayer 傳公開實作,登入後的 LivePlanLayer 傳登入版實作。
  //
  // 三份實作各自對應一種情境,不是一份實作內部判斷 cfg.token:
  //   planAiFakeDataSource           展示頁播放態(純前端劇本)
  //   createPlanAiPublicDataSource   展示頁推論態(訪客,/public/*)
  //   createPlanAiApiDataSource      /app(需登入,/internal/*)
  dataSource: PlanAiDataSource
  // selectedStopId/onSelectedStopChange——目前選中哪一站。三種合法組合:
  //   - 兩個都傳:受控。以 selectedStopId 為準,元件自己不存狀態,每次
  //     使用者點選都呼叫 onSelectedStopChange(地圖規劃面板用這個)。
  //   - 兩個都不傳:非受控,元件用內部 state 自理(原本 /trip-plan 全頁用,該頁已移除)。
  //   - 只傳 onSelectedStopChange:非受控但通知呼叫端——元件自己管狀態,
  //     呼叫端只是想知道。語意同 <input onChange> 不給 value。
  // (只傳 selectedStopId 不傳 callback 也能跑,但那樣使用者點了沒人處理,
  //  畫面不會有任何反應,實務上沒有意義。)
  //
  // selectedStopId 傳 null 仍算受控——null 是「沒有選任何一站」的合法值,
  // 判斷用 !== undefined 而不是 != null。
  //
  // 2026-10 從「元件自己管理 + 單向上報」改成受控:原本的寫法讓呼叫端
  // (planning/member/desktop/Content)另外存一份 selectedPlanStopId 給地圖用,兩份之間只有
  // 子→父的單向同步,而地圖那側點圓點時是直接寫父層那份——製造出一個
  // 回不來的狀態:
  //   點卡片 A(兩份都 A)→ 點地圖圓點 B(父=B、子仍 A,畫面同時兩個
  //   選中)→ 再點卡片 A:setSelectedStopId('A') 本身正常執行,但子元件
  //   的值本來就是 'A',React bail out、上報 effect 的依賴沒變、不重跑,
  //   父層永遠停在 B。
  // 這個情境與受控/非受控兩種模式的行為都有回歸測試覆蓋,見同資料夾的
  // selectedStopSync.test.tsx。受控之後只有一份事實來源,地圖與卡片不可能
  // 不同步,「點圓點 → 卡片高亮」也自然成立(原本那條路徑是斷的)。
  //
  // 不傳這兩個 prop 時走內部 state,行為與先前相同(selectedStopSync.test.tsx 仍覆蓋這條路徑)。
  selectedStopId?: string | null
  onSelectedStopChange?: (id: string | null) => void
  // onHoverStopChange——滑鼠移到站點卡上時回報(移出傳 null),讓地圖把
  // 對應的小圓點加強顯示。不存成這個元件自己的 state 再上報:hover 狀態
  // 在這裡沒有任何用途(卡片本身的 hover 樣式由 CSS :hover 處理,不需要
  // 經過 React),純粹是轉發給呼叫端,多存一份只會造成不必要的重渲染。
  //
  // 注意:這個回調直接接到 PlanTimelineView 的 onHoverStop,「滑鼠離開」
  // 以外的任何方式讓卡片消失都不會補送一次 null——元素被 display:none
  // 隱藏(規劃面板關閉時就是這樣,見上方 onStopsChange 的說明)不產生
  // onMouseLeave。呼叫端若把它存成 state,需要自己處理這個殘留。
  onHoverStopChange?: (id: string | null) => void
  // onHoverTransitChange——滑鼠移到時間軸「交通膠囊」上時回報這段交通
  // 連接的兩個站點 id(移出傳 null),使用者明確要求「移動到交通的膠囊
  // 上,地圖上讓連接的兩個點都顯示 hover 狀態,並用虛線做連線」。跟
  // onHoverStopChange 同一種轉發模式,不存成這個元件自己的 state。
  onHoverTransitChange?: (pair: { fromId: string; toId: string } | null) => void
  // onAskMapViewChange——詢問頁(選擇感興趣景點、更換地點)的候選點與勾選回報,給入口畫在地圖上(見 conversation/askMapView.ts);
  // 詢問頁關閉或換頁時回報空檢視。選填:不傳就不回報。
  onAskMapViewChange?: (view: AskMapView) => void
  // onToolCallLogChange——見 ToolCallLogEntry 的完整說明:AI 推論過程中
  // 每次工具呼叫的紀錄,隨 usePlanAiChatBridge 內部 state 累積而變動,
  // 跟 onStopsChange/onRouteSegmentsChange 同一種「資料可能由多條路徑
  // 變動,沒有單一事件可掛」的回報模式(用 useEffect 監聽,不是事件驅動)。
  // 給 /ai-plan 的 debugSafeArea 疊圖面板顯示用,呼叫端通常不需要這個
  // callback,不傳就不會有任何額外開銷(toolCallLog 本身在 hook 內部
  // 照樣持續收集,只是沒有人讀)。
  onToolCallLogChange?: (log: ToolCallLogEntry[]) => void
  // onSendPromptReady——2026-10 新增:把這個實例內部的 sendPrompt(見
  // usePlanAiChatBridge 同名函式的完整說明:送出一句話進既有的 onagent
  // 對話/時間軸機制,效果等同使用者自己在輸入框打字送出)函式參照交給
  // 呼叫端保管。
  //
  // 存在的理由:這個元件以外的獨立 UI(原本是地圖右上角「想去哪裡?」
  // 對話氣泡)可能需要觸發「送出這句話」這個動作,但不該自己重新實作
  // 一套送出邏輯(那樣會跟這裡的 postPlanAiChat/conversationID/並發保護
  // 等邏輯脫鉤,使用者會看到兩種不一致的行為)。透過這個 callback 拿到
  // 同一份 sendPrompt,外部觸發跟「手動打字送出」就走完全相同的路徑。
  //
  // 2026-10:那個氣泡功能已整個移除,目前沒有任何呼叫端傳這個 prop。
  // 保留它而不刪除——它是選填的通用出口,而「外部 UI 要送出一句話」
  // 這個需求本身沒有消失(選完景點自動送 prompt 就是同一類動作,只是
  // 那條走的是元件內部的 useAskPageFlow)。
  //
  // 用 callback 而非把 sendPrompt 放進某個呼叫端能讀到的 ref/context:
  // 這個元件目前對外的既有模式都是「呼叫端傳 callback 進來、這裡在對的
  // 時機呼叫它」(onStopsChange/onPanToStop 等),沒有既有的「元件主動把
  // 內部函式外露」機制,這裡延續同一種模式,不引入新的耦合方式。
  //
  // 用 useEffect 呼叫(而非在 render 期間直接呼叫):sendPrompt 來自
  // usePlanAiChatBridge,其 identity 只在依賴 [cfg] 變動時才會改變(見
  // 該 hook 的完整說明),不會每次 render 都換一個新函式參照,搭配
  // useStableCallback 包一層呼叫端傳入的 callback(理由同 reportStops
  // 的完整說明:避免呼叫端傳 inline 箭頭函式造成無窮迴圈),只在真正
  // 需要時才通知一次。
  onSendPromptReady?: (sendPrompt: (text: string) => Promise<boolean>) => void
  // store——2026-10 新增:時間軸持久化的落地方式,取代原本直接 import
  // planning/timeline/storage.ts 三個函式呼叫的寫法(見 PlanTimelineStore 介面
  // 的完整說明)。必填(2026-10):原本選填、省略時內部預設用 localStoragePlanTimelineStore,但靠隱藏預設值決定
  // 存在哪裡容易在新入口漏傳(跟 dataSource 同樣的理由),改成每個入口(各自的 LivePlanLayer)明確傳。登入後兩個入口傳 localStoragePlanTimelineStore,/ai-plan 依有沒有
  // 草稿傳 localStoragePlanTimelineStore 或草稿專屬的 store——全部共用同一份 localStorage 草稿
  // (/ai-plan 排的內容,之後打開 /app 看得到同一份,使用者明確要求的行為)。這個元件本身不需要知道背後實際怎麼存,只需要
  // 呼叫 store.readRev()/loadTimelineWithRev()/saveTimeline() 這三個
  // 介面方法,實際讀寫邏輯(含既有的 rev 機制、失敗語意)完全收斂在
  // store 實作裡。這個元件永遠會寫存檔;沒有「不持久化」的 store(曾有的 noopPlanTimelineStore 存檔回 null
  // 會讓記憶體時間軸永遠不更新,已刪除)——要純記憶體的時間軸用 usePlanTimelineCore 不傳 store 的模式。
  store: PlanTimelineStore
  // transparentBackground——2026-10 新增:讓 .page 的實色背景
  // (var(--ios-bg))變透明,疊加在呼叫端自己的背景之上。
  //
  // 存在的理由:/ai-plan 展示頁的 LivePlanLayer 把這個元件塞進
  // .timelinePanel(刻意「浮空」、沒有自己背景色的側欄,見該 class 的
  // 完整說明,讓底下的 NativeMapBase 透出來)——但 .page 原本預設帶
  // 實色背景(給 /app 整頁、或 planning/member/desktop/Content.tsx 規劃面板 規劃面板
  // 這類情境使用,那裡需要一塊不透明的卡片底色),交接後整個蓋住了
  // 底下的地圖,只看得到這個元件自己的空狀態提示文字(實機回報「試試
  // 看時背景是空白的」,背景其實是這段文字,不是真的空白)。
  //
  // 預設 false(維持原本不透明背景)——/app、planning/member/desktop/Content.tsx 等既有
  // 呼叫端不用改、不用傳這個 prop,行為完全不變。只有 LivePlanLayer
  // 這個呼叫端需要透明背景,不要把這個行為改成 compact 的隱含效果
  // (compact 本身是「放進固定高度容器」的版面語意,跟「背景要不要
  // 透明」是兩件互相獨立的事,混在一起會讓規劃面板那個情境意外跟著
  // 變透明)。
  transparentBackground?: boolean
  // hideEmptyState——透傳給內部 PlanTimelineView 同名 prop(見該元件該
  // prop 的完整說明)。預設 false(顯示 emptyStateMessage 那段「想去哪
  // 裡玩?」文案)——/app、planning/member/desktop/Content.tsx 等既有呼叫端不用改、行為
  // 不變。/ai-plan 展示頁的 LivePlanLayer 傳 true:地圖已經在交接前
  // 用模擬腳本畫出過站點,交接後時間軸從空狀態重新開始時,這段對一般
  // /app 使用者合理的引導文案在這裡反而多餘(使用者剛看完展示、直接
  // 想繼續排,不需要被告知「可以查景點、安排行程」這種新手引導)。
  hideEmptyState?: boolean
  // horizontalTimeline——2026-10 新增(使用者明確要求「兩個不同的層,
  // 時間軸要共用相同的,只有資料層不一樣」):true 時內部改渲染
  // HorizontalPlanTimeline(/ai-plan 展示頁模擬層原本專用的橫向卡片
  // 時間軸),取代預設的縱向 PlanTimelineView——兩個元件背後接的資料
  // (removeStop/getTimeDragBounds/setStopTime/refreshTransitForStop
  // 等既有邏輯,見下方渲染區塊的完整說明)完全相同,只是改用橫向視覺
  // 呈現,不是另外接一套資料邏輯。
  //
  // 預設 false(維持現狀渲染 PlanTimelineView)——/app、
  // planning/member/desktop/Content.tsx 等既有呼叫端不用改、不用傳這個 prop,行為完全
  // 不變。目前唯一會傳 true 的呼叫端是 planning/preview/LivePlanLayer.tsx
  // (手機版時傳入,見該檔案的完整說明),對應 /ai-plan 展示頁交接後的
  // 真實層手機版畫面。
  horizontalTimeline?: boolean
  // onNewDraft——選填:2026-10 新增(「新行程」按鈕,見
  // planning/timeline/drafts.ts 的完整背景說明)。有傳這個 callback
  // 時,橫向時間軸(horizontalTimeline)的 composer 上方會多出一顆
  // 「新行程」按鈕,點擊時直接呼叫這裡,不做任何事前確認或清空動作——
  // 「清空目前時間軸、切到新草稿」是呼叫端(LivePlanLayer.tsx)的職責:
  // 它決定新草稿要用哪個 store(createDraftPlanTimelineStore)、並透過
  // React key 讓這個元件整個重新掛載(見該檔案的完整說明),這個元件
  // 自己不需要知道「草稿」這個概念存在,只負責在使用者點擊時通知。
  //
  // 選填且預設不出現:/app、planning/member/desktop/Content.tsx 等既有
  // 呼叫端都不傳,行為完全不變——這顆按鈕目前只服務 /ai-plan 這一個
  // 入口(見呼叫端 LivePlanLayer.tsx 的 NEW_TRIP_DRAFT_ENABLED feature
  // flag,預設關閉,定義在 DesktopShared.tsx)。不只看 horizontalTimeline
  // 是否為 true 就決定要不要渲染按鈕——即使日後其他呼叫端也採用
  // horizontalTimeline,沒有傳這個 callback 就不會意外多出這顆按鈕,
  // 兩個 prop 各自獨立判斷(見下方渲染區塊:horizontalTimeline && onNewDraft
  // 兩者同時成立才渲染)。
  onNewDraft?: () => void
  // initialAskPage——選填:掛載時立刻顯示的詢問頁(見
  // planning/conversation/asktools.ts AskPageInput 的完整說明)。
  //
  // 2026-10 新增(使用者明確要求「進入推論態一開始就顯示詢問要去那裡的
  // 國家清單」):交接到推論態之後,原本畫面是一片空的時間軸、等使用者
  // 自己打字描述需求。但「要去哪個國家」這個問題每一趟規劃都必然要問,
  // 而且前端自己就有固定的國家清單(travelRegionData.ts),不需要等 LLM
  // 呼叫 ask_travel_country 才問得出來——一進來就把選單擺上,使用者點
  // 一下就能往下走,不用先想出一句話。
  //
  // 傳的是完整的 AskPageInput 而不是一個 showCountryPicker 布林:詢問頁
  // 本來就支援六種形態(候選景點/探查/國家/城市/交通/文字),把「開哪
  // 一種」交給呼叫端決定,這個元件只負責在掛載時把它顯示出來。日後若
  // 有情境需要一進來就問交通方式或顯示一則文字,不需要再加第二個 prop。
  //
  // 選填且預設不顯示——/app、planning/member/desktop/Content.tsx 等既有
  // 呼叫端都不傳,行為完全不變(/app 的使用者是自己主動來排行程的,
  // 一進來就被塞一張選單並不合理;/ai-plan 的使用者剛看完展示、正在
  // 「換我試試看」的當下,那張選單才是接得上的下一步)。
  //
  // 只在掛載時讀一次(見下方 effect 的空依賴陣列):這是「初始」狀態,
  // 不是受控 prop——之後的詢問頁一律由 LLM 的工具呼叫或使用者互動驅動,
  // 呼叫端改變這個值不會重新開啟選單。語意同 React 的
  // defaultValue/useState 初值。
  initialAskPage?: AskPageInput
}) {
  const {
    cfg, compact, visible = true, scrollContainerRef, onPanToStop, onStopsChange, onRouteSegmentsChange, dataSource,
    selectedStopId: controlledSelectedStopId, onSelectedStopChange,
    onHoverStopChange, onHoverTransitChange, onAskMapViewChange, onSendPromptReady, onToolCallLogChange,
    store,
    transparentBackground = false,
    hideEmptyState = false,
    horizontalTimeline = false,
    onNewDraft,
    initialAskPage,
  } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)
  // isWide——寬螢幕(>=1024px)斷點(見 useIsWide 的完整說明),決定
  // 下方 AskPage 的 stacked prop:桌面縱向分支(非 horizontalTimeline)
  // 側欄改用縱向堆疊的候選/選項列表,取代橫向捲動(使用者明確要求「所有
  // 的詢問項目都要換」,2026-10 新增)。這個元件本身目前沒有獨立的
  // 寬螢幕側欄外殼(那是 /ai-plan 展示頁 PlanLayout 經 PlanOverlayLayout
  // 渲染的 PlanOverlayPanel wide 分支),只影響 AskPage 內部候選卡片的排列方式。
  const isWide = useIsWide()

  // suppressNextAutoScrollRef——使用者明確要求「刪除的時候不要自動移動
  // 到最新」:下方 scrollToLatest 的 effect 只依賴 steps 陣列本身是否
  // 變動(見該處完整說明),刪除景點時 usePlanTimelineCore 的 removeStop
  // 會讓 steps 重新計算兩次(標記 removing:true 當下一次、320ms 後真正
  // 摘除一次,見該函式完整說明),這個 effect 本來分辨不出「這次 steps
  // 變動是刪除造成的,還是 AI 新增內容造成的」,一律視為「有新內容,跟隨
  // 到底」而觸發捲動——對刪除這個動作而言是不想要的副作用(使用者可能
  // 正在瀏覽中段內容點擊刪除,刪完卻被強制捲到最底,失去原本瀏覽的
  // 位置)。這個 ref 建立在這裡(呼叫端),傳給 usePlanTimelineCore,讓
  // 它在每次因為刪除而呼叫 setTimeline 之前都主動設定,effect 讀到後
  // 消費掉、跳過這一次——不用「時間差」猜測兩次 setTimeline 的順序
  // (那種做法在不同瀏覽器的排程下不可靠),而是讓真正觸發 setTimeline
  // 的那段程式碼自己同步設定旗標,保證順序正確。
  const suppressNextAutoScrollRef = useRef(false)

  // planAiDataSource——存取層實例(見 dataSource prop 的完整說明)。
  // 宣告在 usePlanTimelineCore 之前:那支 hook 現在要收它當參數。
  // useMemo 避免每次 render 都建立新物件——它會進 HorizontalPlanTimeline
  // 內部 effect 的依賴陣列(AskPage 用 dataSource 當依賴),參照不穩定
  // 會讓那個 effect 每次 render 都重跑。
  const planAiDataSource = dataSource
  // 對話狀態——獨立於時間軸、純記憶體不持久化(元件卸載/換草稿重新掛載即清空),桌面時間軸渲染在最下方。
  // 宣告在時間軸之前:staleAll 要接進時間軸 core 的 onStopInserted(新增站點讓舊訊息淡化;兩個資料層彼此不知道對方存在,
  // 唯一的連動就在這個接線點)。
  const { messages, appendMessage, staleAll: staleAllMessages } = usePlanConversation()

  const {
    timeline,
    timelineRef,
    nodeStatus,
    addStop,
    setStopNote,
    removeStop,
    addDay,
    moveDay,
    setLodging,
    removeLodging,
    setStopTime,
    resyncFromStorage,
    retryStop,
    replaceStop,
    setTimeline,
  } = usePlanTimelineCore({
    store,
    dataSource: planAiDataSource,
    retryFailedOnMount: true,
    onBeforeMutate: () => {
      suppressNextAutoScrollRef.current = true
    },
    onStopInserted: staleAllMessages,
  })

  // getTimelineForBridge——usePlanAiChatBridge 的 getTimeline 需要讀到「當下
  // 最新」的節點清單,不能綁死成某一次 render 時的閉包。
  //
  // 2026-09 修正(code review 發現):原本這裡讀一個額外的 stepsRef,靠
  // useEffect(() => { stepsRef.current = steps }, [steps]) 同步——這個
  // useEffect 要等 React commit 完成才會執行,而 addStop/
  // setStopNote 是透過 useSyncedState 的 commitTimeline 同步寫入
  // timelineRef(見該 hook 開頭的完整說明:這正是它存在的理由,避免
  // 「setState 呼叫完緊接著讀,結果還沒算好」這類真實踩過的 bug)。
  // 兩者之間有一個 render/commit 的時間差:LLM 連續呼叫 add_attraction
  // 後緊接著呼叫 list_itinerary(或 onAssistantMessage 緊接著前一個
  // 工具呼叫觸發),都可能發生在 React 完成該次 re-render 之前——這時
  // stepsRef 還沒同步到剛寫入的節點,list_itinerary 回傳漏掉剛插入的
  // 站點,onAssistantMessage 也會把新訊息接在錯誤(已過期)的最後節點
  // 之後。list_itinerary 這個工具當初就是為了讓 LLM 不必依賴可能過期
  // 的記憶去猜時間軸現況才新增的(見 conversation/tools.ts 的完整說明),
  // 若它自己讀到的也是過期資料,等於沒有真正解決那個問題。
  //
  // 改成直接讀 timelineRef.current——timelineRef 是
  // useSyncedState 保證同步寫入的 ref,不經過 useEffect 這個中間層,
  // 沒有這個時間差。
  const getTimelineForBridge = useCallback((): PlanTimeline => timelineRef.current, [timelineRef])

  // addNoteToTimeline — 對齊原型同名函式的介面與邏輯(見該處的完整
  // 說明):對外暴露的「把一則備註寫在既有節點上」程式介面,category
  // 未提供或不在 NOTE_STYLES 表列範圍內時 fallback 成 DEFAULT_NOTE_CATEGORY。
  const addNoteToTimeline = useCallback(
    (anchorId: string, text: string, category?: string): ReturnType<typeof insertAfter> => {
      const resolvedCategory = resolveNoteCategory(category)
      return setStopNote(anchorId, text, resolvedCategory)
    },
    [setStopNote],
  )

  // showAskPage/askPageInput/openAskPage/handleAskPageDone——2026-10
  // 新增(使用者明確要求「詢問頁的內容跟啟動,要可以透過程式自己啟動,
  // 也要讓 AI 的工具來啟動」):從 HorizontalPlanTimeline.tsx 內部提升
  // 到這裡,讓程式(這裡的使用者互動路徑)跟 AI 工具
  // (usePlanAiChatBridge 內部組裝的 open_ask_page)共用同一份狀態,
  // 不會出現兩條互相不同步的觸發路徑。縱向版(PlanTimelineView)不
  // 使用這組狀態——詢問頁/軸線頁互斥顯示是橫向版(手機版交接後)專屬
  // 的版面安排,見 HorizontalPlanTimeline.tsx showAskPage prop 的完整
  // 說明。
  //
  // 狀態機本身(顯示詢問頁、等待使用者選完才 resolve 的 Promise)抽成
  // 共用 hook useAskPageBridge(見該檔案開頭的完整設計理由)——這裡跟
  // planning/preview/Content.tsx 原本各自內嵌一份幾乎相同的邏輯,現在改成
  // 呼叫同一份實作,差異只在 Input 泛型:這裡用完整的 AskPageInput(見
  // 該型別的完整說明),展示頁劇本固定只給 { candidates }。text 形態見
  // 下方 onAssistantMessage 呼叫處與 AskPage.tsx input 聯集「第四輪」
  // 的完整說明——純文字回覆不經過 AI 工具,是這個元件直接呼叫
  // openAskPage 觸發,跟 candidates/explore/region/transport 這幾種
  // 「由 LLM 呼叫對應工具觸發」不同路徑。
  //
  // 宣告位置在 usePlanAiChatBridge 呼叫之前(而不是跟其餘大多數 state
  // 一起宣告在後面)——這個 hook 需要在呼叫當下就拿到 openAskPage 當
  // 第六個參數,JavaScript 變數必須先宣告才能在同一個函式作用域的
  // 後續程式碼裡使用,順序不能顛倒。
  const askPageBridge = useAskPageBridge<AskPageInput>({ candidates: [] })
  const { showAskPage, askPageInput, openAskPage, handleAskPageDone: resolveAskPage } = askPageBridge


  // uiStateStore 同步——把「使用者目前在哪一個畫面、畫面上有哪些選項」
  // 寫進那份 LLM 可讀的狀態(見 planning/conversation/uiStateStore.ts 的完整說明)。
  //
  // 用一個 effect 盯著 showAskPage/askPageInput,而不是在每個
  // openAskPage 呼叫點旁邊各寫一次 uiStateStore.set():開啟詢問頁的
  // 入口有五、六處(LLM 的四支工具、handleAskPageDone 的兩段自動串接、
  // initialAskPage、onAssistantMessage 的文字氣泡),每處都手動同步
  // 一定會漏,而漏掉的那一處會讓 LLM 讀到前一個畫面的殘留狀態——比
  // 完全沒有這份資訊更糟。這兩個值是「畫面現在長什麼樣」的唯一事實
  // 來源,盯著它們就不可能不同步。
  //
  // selected 目前一律是空陣列,沒有「勾選到一半」的中間狀態:使用者在
  // 景點畫面逐張勾選時 askPageInput 不會變(選取狀態是 AskPage 元件
  // 自己的 state,見該檔案 selectedPlaceIds 的說明),這一層讀不到。
  //
  // 刻意不為此加一個 onSelectionChange prop 把那份 state 鏡射出來:
  // 「勾到一半」是短暫的過渡狀態,LLM 在那個瞬間不會被叫起來(它要等
  // 使用者按下確認、送出 prompt 才會有下一輪),而「選完了哪些」已經由
  // get_user_selection 回答。真的需要中間狀態時再加,現在加只是多一條
  // 要維護的同步路徑。
  //
  // screen/options 仍然完整:LLM 讀得到「使用者正在景點畫面、畫面上有
  // 這幾個候選」,那才是它判斷「使用者卡在哪一步」需要的資訊。
  useEffect(() => {
    if (!showAskPage) {
      uiStateStore.reset()
      return
    }
    const input = askPageInput
    if ('text' in input) {
      uiStateStore.set({ screen: 'message', title: input.text, options: [], selected: [] })
      return
    }
    if ('country' in input) {
      uiStateStore.set({
        screen: 'country',
        title: input.country.reason,
        // 選項是前端那份固定清單(travelRegionData.ts),countryIds 有帶
        // 就是篩選過的子集——跟 RegionPanel 實際顯示的內容用同一個來源
        // 算出來,不是另外猜一份。
        options: listTravelCountries(input.country.countryIds).map((c) => ({ id: c.id, name: c.name })),
        selected: [],
      })
      return
    }
    if ('city' in input) {
      uiStateStore.set({
        screen: 'city',
        title: input.city.reason,
        options: listTravelCities(input.city.countryId, input.city.cityIds).map((c) => ({ id: c.id, name: c.name })),
        selected: [],
      })
      return
    }
    if ('transport' in input) {
      uiStateStore.set({
        screen: 'transport',
        title: input.reason,
        options: input.transport.map((m) => ({ id: m, name: m })),
        selected: [],
      })
      return
    }
    if ('candidates' in input) {
      uiStateStore.set({
        screen: 'attractions',
        title: input.reason,
        options: input.candidates.map((c) => ({ id: c.placeId, name: c.name })),
        selected: [],
      })
      return
    }
    // explore——候選是 AskPage 內部自己查的,這一層拿不到(同
    // handleAskPageDone 對 explore 的既有限制說明)。畫面形態仍然要
    // 記下來:LLM 至少知道「使用者正在看景點候選、還在查詢中」。
    uiStateStore.set({ screen: 'attractions', title: input.reason, options: [], selected: [] })
  }, [showAskPage, askPageInput])

  // initialAskPage——掛載時立刻開啟呼叫端指定的詢問頁(見該 prop 的
  // 完整說明)。
  //
  // 不 await 這個 Promise:openAskPage 回傳的 Promise 要等使用者選完才
  // resolve,而這裡沒有「選完之後要接著做什麼」——後續動作一律由
  // handleAskPageDone 處理(使用者選完國家會自動串到城市層、選完城市
  // 送出一句話給 LLM,見該函式的完整說明),跟這次開啟的呼叫端無關。
  // 寫法對齊 askPageCtx 裡那幾支 void openAskPageRef.current(...) 的
  // 既有慣例。
  //
  // 空依賴陣列:這是「初始」詢問頁,只在掛載時開一次(見該 prop 說明的
  // 最後一段)。openAskPage 本身來自 useAskPageBridge 的 useCallback、
  // 參照穩定,但即使它變動也不該重新開啟選單——使用者可能已經選完、
  // 或正在看另一個 LLM 開的詢問頁,再開一次會把那個狀態蓋掉。
  // 已經有行程時不開這個詢問頁(2026-10,使用者明確要求「初始狀態如果
  // 已經有行程了就不要出現詢問視窗」)。
  //
  // 這個詢問頁的用途是「還不知道要去哪裡,先問個方向」——時間軸裡已經
  // 有站點時那個前提不成立:使用者是回來繼續看/調整既有行程的,一進來
  // 就被一張「要去哪個國家?」的全幅選單蓋住,還得先關掉才看得到自己
  // 排好的東西。
  //
  // 判斷用「有沒有 stop 節點」:只有對話訊息(2026-10-24 起獨立成
  // PlanConversation,不在時間軸裡)、沒有任何站點時仍然算「還沒有行程」,
  // 該照常開這個詢問頁。
  //
  // 2026-10(第二輪,使用者明確要求「全部行程都刪除時要觸發開啟選擇」):
  // 這個 effect 原本只在掛載時跑一次,改成盯著「目前有幾個站點」。
  //
  // 它該出現的條件其實不是「剛掛載」,而是「目前沒有行程」——兩種情況
  // 都符合:
  //   - 掛載時時間軸是空的(全新使用者,或上次沒排任何東西)
  //   - 使用者把所有站點刪掉了(UI 上逐站刪、AI 的 remove_attraction、
  //     或整個清空,三條路徑都會讓 stopCount 歸零,不需要在每一處各自
  //     加一次觸發)
  // 「刪到空」跟「一開始就空」對使用者來說是同一件事,沒有理由只處理
  // 其中一種。
  //
  // 判斷用「有沒有 stop 節點」:只有對話訊息、沒有任何站點時仍然算「還沒有行程」
  // (對話已獨立於時間軸,見 planning/conversation/messages.ts)。
  //
  // 已經有詢問頁開著時不會被搶佔:useAskPageBridge.openAskPage 對
  // 「已有 pending」直接忽略(見該函式的完整說明),所以使用者正在看
  // LLM 開的某個選單時,這裡不會把它蓋掉。
  //
  // 刪到空之後使用者自己按「不用了」關掉選單,不會再被開啟一次:
  // stopCount 維持 0、依賴沒有變動,effect 不重跑。只有再次從「有站點」
  // 變成 0 才會再觸發。
  // allNodes——依序列出全部節點(不含天的標題),給「查節點」類用途(是否有站點、解析主題點引用、地圖站點)。
  const allNodes = useMemo(() => listNodes(timeline), [timeline])
  const stopCount = useMemo(() => allNodes.filter((s) => s.type === 'stop').length, [allNodes])
  useEffect(() => {
    if (!initialAskPage) return
    if (stopCount > 0) return
    void openAskPage(initialAskPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopCount])

  // userSelectionRef——使用者最近一次在詢問頁的選擇(見
  // planning/conversation/asktools.ts UserSelectionRecord 的完整說明)。寫入在
  // 下方 handleAskPageDone,讀取在 usePlanAiChatBridge 組出來的
  // askPageCtx.getUserSelection。
  const userSelectionRef = useRef<UserSelectionRecord | null>(null)
  // attractionPool——這次對話出現過的景點(見
  // planning/conversation/attractionPoolStore.ts 的完整說明)。useMemo 讓它跟著這個
  // 元件實例活著:重新掛載(例如交接後換 draft)就是一份新的池子,對齊
  // 「這次對話的工作記憶」這個定位。
  const attractionPool = useMemo(() => createAttractionPoolStore(), [])

  const planAiChat = usePlanAiChatBridge(
    cfg,
    getTimelineForBridge,
    addStop,
    addNoteToTimeline,
    removeStop,
    addDay,
    moveDay,
    setLodging,
    removeLodging,
    userSelectionRef,
    attractionPool,
    openAskPage,
    resolveAskPage,
    appendMessage,
    !!onToolCallLogChange,
  )

  // reportSendPromptReady——見 onSendPromptReady 參數的完整說明,
  // useStableCallback 包一層讓依賴陣列只剩真正該追蹤的值
  // (planAiChat.sendPrompt),理由同上方 reportStops 的完整說明。
  const reportSendPromptReady = useStableCallback(
    (sendPrompt: (text: string) => Promise<boolean>) => { onSendPromptReady?.(sendPrompt) },
  )
  useEffect(() => {
    reportSendPromptReady(planAiChat.sendPrompt)
  }, [planAiChat.sendPrompt, reportSendPromptReady])

  // reportToolCallLog——見 onToolCallLogChange 參數的完整說明,
  // useStableCallback 包一層,理由同上方 reportSendPromptReady/
  // reportStops:呼叫端若傳 inline 箭頭函式,不能讓它進 effect 依賴陣列。
  const reportToolCallLog = useStableCallback((log: ToolCallLogEntry[]) => { onToolCallLogChange?.(log) })
  useEffect(() => {
    reportToolCallLog(planAiChat.toolCallLog)
  }, [planAiChat.toolCallLog, reportToolCallLog])

  const [chatInput, setChatInput] = useState('')
  // askSelection——景點候選頁目前勾選的項目(AskPage confirmViaComposer 回報)。輸入框空白時按送出鈕就是「確認選擇」。
  const [askSelection, setAskSelection] = useState<AskPageSelection[]>([])
  // askPoints/askToggleRef——候選頁回報的地圖點與「切換勾選」函式;與 askSelection 合成 AskMapView 回報給入口(見 onAskMapViewChange)。
  const [askPoints, setAskPoints] = useState<AskMapPoint[]>([])
  // markInItinerary——「更換地點」的詢問頁開著時為 true:候選裡已經排在行程中的地點加「已在行程」標記(結束時由 startAsk 的回呼清掉)。
  // searchNearbyCandidates——以座標查附近觀光地點,轉成詢問頁候選(選完城市那一步同樣的類型篩選)。
  const searchNearbyCandidates = async (lat: number, lng: number, excludePlaceId?: string) => {
    const { attractions } = await fetchPlanAiAttractionSearch(cfg, lat, lng, CITY_ATTRACTION_TYPES)
    return candidatesFromAttractions(attractions, excludePlaceId)
  }
  const [markInItinerary, setMarkInItinerary] = useState(false)
  const itineraryPlaceIds = useMemo(() => new Set(allNodes.flatMap((n) => (n.type === 'stop' && n.placeId ? [n.placeId] : []))), [allNodes])
  const badgedPlaceIds = markInItinerary ? itineraryPlaceIds : undefined
  const askToggleRef = useRef<((placeId: string) => void) | null>(null)
  const setAskToggle = useCallback((toggle: ((placeId: string) => void) | null) => {
    askToggleRef.current = toggle
  }, [])
  const askToggle = useCallback((placeId: string) => askToggleRef.current?.(placeId), [])
  const reportAskMapView = useStableCallback((view: AskMapView) => { onAskMapViewChange?.(view) })
  useEffect(() => {
    reportAskMapView(buildAskMapView(askPoints, askSelection.map((s) => s.placeId), askToggle))
  }, [askPoints, askSelection, askToggle, reportAskMapView])

  // 詢問頁「使用者操作之後」的串接(選完國家 → 城市、選完城市 → 查景點、選完景點 → 請 AI 排行程、返回上一層、
  // 詢問頁開著時用下方輸入匡直接說明)——見 useAskPageFlow.ts 的完整說明(2026-10 從這裡抽出去,才能單獨測試)。
  // 詢問頁開著時從輸入匡送出的文字(submitAskPageText)最後沒送出去(後端拒絕、網路錯誤)時放回輸入框(輸入框已有內容
  // 就不覆蓋),使用者不用重打;推論中則由 useAskPageFlow 先記下、這一輪結束後自動送出(見該檔案 submitAskPageText 的說明)。
  const { handleAskPageDone, handleAskPageBack, submitAskPageText, startAsk } = useAskPageFlow({
    bridge: askPageBridge,
    searchCityAttractions: async (city) => {
      const { attractions } = await fetchPlanAiAttractionSearch(cfg, city.lat, city.lng, CITY_ATTRACTION_TYPES)
      return attractions
        .filter((a) => !!a.placeId)
        .map((a) => ({ placeId: a.placeId!, name: a.name, summary: a.summary, lat: a.lat, lng: a.lng }))
    },
    sendPrompt: planAiChat.sendPrompt,
    isThinking: planAiChat.isThinking,
    userSelectionRef,
    onAskPageTextNotSent: (text) => setChatInput((current) => (current.trim() ? current : text)),
  })

  // composerSlot——版面外殼提供的輸入框插槽(見 planning/shared/overlayDom.ts)。
  // 不在外殼裡時是 undefined,輸入框維持原位渲染,行為不變。
  const composerSlot = useContext(ComposerSlotContext)
  // latestAgentMessage state 已撤回 HorizontalPlanTimeline.tsx 內部
  // (2026-10,使用者明確指出泡泡「不應該放在輸入匡區」)——見
  // ComposerPortal 呼叫處的完整說明。

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,理由同原型的完整
  // 說明:用 id 而非陣列 index 判斷 justMounted,插入到中間的節點才能
  // 正確觸發進場動畫。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // selectedStopId——目前被點選、卡片套用 .stopCardSelected 高亮樣式的
  // 站點。
  //
  // 受控/非受控雙模式(見上方 props 對這兩個欄位的完整說明):呼叫端傳了
  // selectedStopId 就以它為準(地圖規劃面板,狀態住在 planning/member/desktop/Content,
  // 地圖與時間軸共用同一份),沒傳就用這個內部 state(非受控;原本給已移除的 /trip-plan 全頁)。
  //
  // 這個狀態現在同時驅動地圖上對應小圓點的強調樣式——2026-10 之前曾經
  // 短暫只剩「點了哪張卡片」的視覺回饋(右上角小地圖移除後),現在它又
  // 有了地圖這個消費端,只是地圖不再是這個元件自己的。
  const [internalSelectedStopId, setInternalSelectedStopId] = useState<string | null>(null)
  const isSelectionControlled = controlledSelectedStopId !== undefined
  const selectedStopId = isSelectionControlled ? controlledSelectedStopId : internalSelectedStopId
  // selectStop——統一的寫入口。受控模式下只通知呼叫端(不碰內部 state,
  // 避免兩份值在模式切換時殘留不一致);非受控模式下寫內部 state,並且
  // 仍然通知呼叫端(呼叫端可能只想知道、不想接管)。
  // useStableCallback:理由同下方 reportStops——呼叫端傳 inline 箭頭函式
  // 時,這個函式的 identity 不該跟著變(它會進 panToStop 的 useCallback
  // 依賴,再往下傳給 PlanTimelineView)。
  const selectStop = useStableCallback((id: string | null) => {
    if (!isSelectionControlled) setInternalSelectedStopId(id)
    onSelectedStopChange?.(id)
  })

  // resolvedRefs——主題點底下的 attractions/places id 經資料存取層解析的結果(只在執行時,不存回節點)。
  // 旅館(PlanTimeline.lodgings)的 placeId 一併解析:名稱給住宿橫幅/住宿卡,座標給下方 mapStops 的旅館圓點。
  const lodgings = lodgingsOf(timeline)
  const resolvedRefs = useResolvedRefs(allNodes, lodgings)
  // mapStops——回報給外層地圖畫小圓點的站點清單(見 onStopsChange 參數的
  // 完整說明)。
  //
  // 只取 type === 'stop' 且已經有座標的節點:section(AI 的敘述文字)
  // 本來就不是地點,而查詢中的 stop 佔位卡要等 resolveAttractionForStep
  // 查完才有 lat/lng,在那之前畫不出來——濾在這裡而不是讓地圖那側判斷,
  // 是因為「哪些節點還沒查到座標」屬於時間軸自己的狀態,不該外流給
  // 只負責畫點的圖層(見 map/marker/planStops.ts 對 PlanStopMarker.lat/lng
  // 必填的說明)。
  //
  // 2026-10 補上 children(執行時解析結果,使用者明確要求交接前後「套用相同的元件跟
  // 地圖互動」):主題點展開後的子景點。原本這裡不回報,所以 /ai-plan
  // 交接到真實層之後,地圖上所有站點都變成單純的景點圓點,主題點
  // 展開的能力消失——那不是刻意的設計,是這份投影漏了一個欄位。
  // 只收已經查到座標的子景點,理由同上方對父節點的處理。
  // 旅館的圓點(lodgingMapMarkers):座標由 placeId 執行時查,查到才有;排在站點之後;連線由時間軸節點切段(planning/timeline/segments.ts),旅館不是節點,自然不在線上。
  const mapStops = useMemo(
    () => [
      ...allNodes
        .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
        .map((s) => {
          const children = resolveMapChildren(s, resolvedRefs)
          return {
            id: s.id,
            lat: s.lat!,
            lng: s.lng!,
            name: s.name,
            ...(children.length > 0 ? { children } : {}),
          }
        }),
      ...lodgingMapMarkers(lodgings, resolvedRefs),
    ],
    [allNodes, resolvedRefs, lodgings],
  )

  // 把站點清單往上報。這一個必須走 useEffect(不像選取狀態改成事件驅動,
  // 見下方說明):站點可能由多條路徑變動(agent 的 add_attraction、背景
  // 查詢回填座標、使用者移除節點、重整後從 localStorage 恢復),是資料
  // 變動而非單一使用者動作,沒有一個「事件」可以掛。
  //
  // useStableCallback 包一層,讓依賴陣列只剩真正的資料(mapStops)——呼叫端
  // 若傳 inline 箭頭函式(planning/member/desktop/Content 這個檔案的既有風格就是這樣寫,
  // 例如 onPanToStop),每次 render 的新 identity 會讓 effect 重跑 →
  // setState → 父層 render → 又是新 identity,形成無窮迴圈。包過之後
  // 呼叫端傳什麼都安全,不需要依賴「恰好傳了 setState」這個隱性契約。
  const reportStops = useStableCallback((stops: typeof mapStops) => { onStopsChange?.(stops) })
  useEffect(() => {
    reportStops(mapStops)
  }, [mapStops, reportStops])

  // routeSegments——地圖連線段(見 onRouteSegmentsChange 的說明):直接從時間軸切,座標來自節點本身(與 mapStops 同一份)。
  const routeSegments = useMemo(() => routeSegmentsFromTimeline(timeline), [timeline])
  const reportRouteSegments = useStableCallback((segments: RouteSegment[]) => { onRouteSegmentsChange?.(segments) })
  useEffect(() => {
    reportRouteSegments(routeSegments)
  }, [routeSegments, reportRouteSegments])

  // 選取狀態不走 useEffect 上報(站點清單那個仍然走,見上方說明)——
  // 改在 selectStop 裡直接通知。原本用 effect 依賴 [selectedStopId] 上報,
  // 那正是「點卡片 A → 點地圖圓點 B → 再點卡片 A 回不去」那個 bug 的
  // 成因:值沒變就不觸發,而外部可能已經把呼叫端那份改掉了。事件驅動的
  // 通知沒有這個問題——使用者每點一次就通知一次,不管值變不變。

  // lightboxPhotos——2026-10 新增,比照地圖版景點介紹卡的多圖瀏覽需求
  // (見 PhotoCarousel.tsx 的 Lightbox):點擊帶有多張 googlePhotoUrls 的
  // 縮圖時開啟全螢幕瀏覽,null 代表未開啟。縮圖本身維持 64px 圓形版型
  // 不變,只在點擊時另開這個全螢幕層,理由見下方縮圖 onClick 的完整說明。
  // visible 從 false 轉 true 時重讀持久化內容——見 visible prop 與
  // usePlanTimelineCore 的 resyncFromStorage 的完整說明。依賴只有 visible:
  // resyncFromStorage 自己會先比對版次,沒有更新就直接 return,重複呼叫
  // 無副作用。
  useEffect(() => {
    if (visible) resyncFromStorage()
  }, [visible, resyncFromStorage])

  const [lightboxPhotos, setLightboxPhotos] = useState<{ photos: string[]; alt: string } | null>(null)

  // panToStop——點擊站點卡:高亮該卡片,並(呼叫端有提供 onPanToStop 時)
  // 請外層把地圖移動到這一站。
  //
  // 2026-10:原本這裡只做選取——當時 /trip-plan 全頁(現已移除)右上角的小地圖移除後,
  // 「pan」這個動作就沒有對象了,函式名稱留著但實際上不再移動任何東西。
  // 現在這個元件嵌進地圖規劃的規劃面板,外面就是整張地圖,名稱重新名實
  // 相符:座標交給呼叫端,由它決定怎麼移動(見 onPanToStop 參數的完整
  // 說明)。
  //
  // 實作在 planning/map/useStopPan.ts 的 useStopCardClick(/ai-plan 模擬態共用同一份)。沒有座標的節點(查詢中的
  // 佔位卡)點了不該有任何反應,連高亮都不做。
  const panToStop = useStopCardClick({ select: selectStop, pan: onPanToStop })

  // panToStopId——手機版橫向時間軸(HorizontalPlanTimeline)的「移動到此」
  // 按鈕專用,見該元件 onPanToStop prop 的完整說明。那個按鈕傳回的是
  // stopId(卡片本身已經靠點擊/onSelectStop 處理選取,按鈕只負責平移),
  // 跟上面 panToStop(縱向版用,點整張卡片=選取+平移合一)收的參數形狀
  // 不同,所以需要各自一份,不是共用同一個函式。
  //
  // 2026-10 補上(原本這個按鈕在推論態手機版完全沒接上,見該元件說明):
  // 用 mapStops 查座標(跟地圖圓點、縱向版共用同一份衍生資料),查不到
  // 就略過(理由同 resolveStopPanTarget 的既有說明)。mapStops 的 children
  // 是巢狀掛在各自站點底下,這裡攤平成一份給 resolveStopPanTarget 查。
  const panToStopId = useCallback(
    (stopId: string) => {
      if (!onPanToStop) return
      const target = resolveStopPanTarget(
        stopId,
        mapStops,
        mapStops.flatMap((s) => (s as { children?: { id: string; lat: number; lng: number }[] }).children ?? []),
      )
      if (target) onPanToStop(target)
    },
    [onPanToStop, mapStops],
  )

  // getScroller——「回到最新」整套機制(自動捲到底/跟隨判斷/事件監聽)
  // 共用的捲動容器取得函式。
  //
  // 2026-10 修正(code review 發現的實際 bug):原本三處(scrollToLatest/
  // handleScroll/下方掛原生事件監聽器的 effect)各自寫
  // scrollRef.current?.closest('main'),從 scrollRef(指向 .scroll,見
  // 下方)往上爬,靠「找到的 <main> 就是真正在捲動的那個」這個假設找
  // 捲動容器——這個假設只在當時的 /trip-plan 全頁(現已移除)成立。
  // (2026-10 code review 二次修正:這裡原本誤寫成「地圖規劃的對話
  // 規劃面板完全沒有 <main> 祖先,closest('main') 永遠回傳 null」——
  // 實際上 FloatingPanel 是 DesktopMain 的子孫,DOM 樹裡確實有
  // <main> 祖先,closest('main') 抓得到它,不是回傳 null。真正的
  // 問題是那個 <main> 的 unboundedScroll 只在 panelMode==='plan-ai'
  // 時才為 true,規劃面板存在的其餘 panelMode 下,這個 <main> 不會
  // 真正接手捲動、scroll 事件不會在它身上觸發——closest('main') 抓到
  // 的是「存在但錯的」捲動容器,不是抓不到。結論跟修法不變:這組
  // 機制(自動捲到底、跟隨判斷、按鈕顯示)在規劃面板裡一樣會失效,只是
  // 失效的具體原因不是「找不到 main」,而是「找到的 main 不會動」。)
  // 改成優先讀呼叫端傳入的 scrollContainerRef(見該 prop 的完整說明):
  // 全頁版傳 DesktopMain 的 <main> ref,規劃面板版不傳、fallback 用
  // scrollRef.current 本身(compact 模式下就是真正接手捲動的
  // .compactScroll,見該 class 的完整說明)——兩條路徑各自對應自己
  // 真正的捲動容器,不再靠 closest 猜。
  //
  // scrollContainerRef?.current ?? scrollRef.current——code review 時
  // 曾經認為這種 nullish coalescing 寫法有「React 尚未完成 commit、
  // .current 還是初始值 null 的極短暫窗口會被誤判」的風險,改寫成
  // scrollContainerRef !== undefined ? ... : ... 這種看 prop 存不存在
  // 的寫法。後來請 Opus 複查:兩種寫法實際上等價——ref 在 commit 的
  // layout 階段就掛好,早於所有 effect 執行,這個「窗口」根本不存在;
  // 就算真的命中那個窗口,兩種寫法的結果都是「fallback 到
  // scrollRef.current」,不會造成任何錯誤行為。保留 ?? 這個更簡短
  // 的寫法,不需要額外的 !== undefined 分支——這裡不是「哪種寫法更
  // 安全」的問題,是同一件事的兩種等價表達,選簡短的那個。
  //
  // 型別層面上這裡沒有強制「compact 為 false 時必須傳
  // scrollContainerRef」(props 物件欄位很多,改成 discriminated
  // union 會讓每個欄位都要在兩個分支各寫一次,改動成本不成比例)——
  // 目前只有 planning/member/desktop/Content.tsx 兩處呼叫,全頁版已經正確傳入,若之後
  // 新增第三個呼叫端忘記傳,後果是悄悄 fallback 到 .scroll(不會捲動
  // 的那個),不是編譯期錯誤,屬於已知、可接受的設計取捨,留意即可。
  const getScroller = useCallback((): HTMLElement | null => {
    return scrollContainerRef?.current ?? scrollRef.current
  }, [scrollContainerRef])

  // scrollToLatest — 對齊目前生成位置(呼吸點提示,或已生成完畢時的
  // 最後一個節點),理由同原型的完整說明。
  //
  // 直接捲到最底,不再用「目標節點頂端距視窗底 160px」的舊算法:那是
  // 輸入膠囊還是 absolute、不佔版面時的設計,改成 sticky 佔版面後,那個
  // 位置比真正的底部高約 100px,捲到底會被拉回去。最新的節點/呼吸點
  // 本來就在內容最末端,捲到底就會出現在膠囊正上方。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = getScroller()
        if (!scroller) return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      })
    })
  }, [getScroller])

  // 只在 steps 改變時跟隨,不把跟隨狀態放進依賴:否則使用者手動捲到底、
  // 跟隨狀態從 false 翻成 true 的那一刻,這個 effect 也會被觸發去捲動。
  //
  // suppressNextAutoScrollRef——消費掉就立刻歸零(見該 ref 宣告處/
  // usePlanTimelineCore removeStop 的完整說明):只跳過「這一次」被標記
  // 的 steps 變動,不是整段期間都不捲動——旗標只在 removeStop 真正呼叫
  // setTimeline 前才會被設成 true,消費後立刻清掉,才能讓再下一次真正
  // 的新內容(例如使用者緊接著送出訊息、AI 新增了景點)照常觸發捲動。
  useEffect(() => {
    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false
      return
    }
    if (!followingRef.current) return
    if (timeline.days.length === 0 && messages.length === 0) return
    scrollToLatest()
  }, [timeline, messages, scrollToLatest])

  // 只有「使用者往上捲、且離底部超過 80px」才退出跟隨。程式觸發的平滑
  // 捲動(往下)與新節點撐高內容(scrollTop 不變)都不會讓它誤判成離開。
  const handleScroll = useCallback(() => {
    const scroller = getScroller()
    if (!scroller) return
    const { scrollTop, scrollHeight, clientHeight } = scroller
    const distFromBottom = scrollHeight - scrollTop - clientHeight
    const scrolledUp = scrollTop < lastScrollTopRef.current
    lastScrollTopRef.current = scrollTop
    let nowFollowing = followingRef.current
    if (distFromBottom < 80) nowFollowing = true
    else if (scrolledUp) nowFollowing = false
    if (nowFollowing === followingRef.current) return
    followingRef.current = nowFollowing
    setShowJumpPill(!nowFollowing && planAiChat.isThinking)
  }, [getScroller, planAiChat.isThinking])

  // 捲動事件發生在 getScroller() 回傳的容器上,不是 .scroll 本身(全頁版
  // 是外層 <main>,規劃面板版是 .compactScroll 自己——見 getScroller 的完整
  // 說明)。JSX 沒辦法直接在父層元件渲染的 <main> 上掛 onScroll,兩種
  // 情況都統一改用 effect 手動加/移除原生事件監聽器,邏輯一致不分支。
  useEffect(() => {
    const scroller = getScroller()
    if (!scroller) return
    scroller.addEventListener('scroll', handleScroll)
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [getScroller, handleScroll])

  const jumpToLatest = useCallback(() => {
    followingRef.current = true
    setShowJumpPill(false)
    scrollToLatest()
  }, [scrollToLatest])

  // emptyStateMessage——對齊原型的既有文案與設計取捨(見該
  // 處的完整說明):漂浮膠囊只留 input 本身,時間軸完全空白時的引導
  // 文字放進主顯示區(.scroll/.inner)當空狀態文案。isGenerating(原型
  // 的模擬腳本生成中狀態)在這裡不存在——正式功能只有 onagent 對話一種
  // 「AI 正在做事」的訊號來源,即 planAiChat.isThinking。
  const emptyStateMessage = '想去哪裡玩？跟我說說你的想法，我可以幫你查景點、安排行程。'
  // composerMode——輸入框的提示文字、是否鎖住、送出路徑,依目前畫面決定(規則與測試見 composerMode.ts)。
  // isThinking 期間鎖定輸入框(sendPrompt 的完整說明:pendingChatRef 的 FIFO 配對依賴「任何時刻最多
  // 一筆 pending」才成立,AgentBridge 的回呼協議本身不帶 requestId,允許並發送出會讓佇列配對錯位);
  // 例外是「有等待使用者的詢問頁」(國家/城市/交通/景點候選/探查):LLM 開詢問頁時推論仍在進行,但使用者要能
  // 直接打字回答,送出改走 submitAskPageText(結束詢問頁、推論中排隊等這一輪結束再送,不會並發)。
  // 2026-10 起取代景點候選頁的「我要直接說明」按鈕與說明面板。
  const composerMode = composerModeFor({ isThinking: planAiChat.isThinking, ask: showAskPage ? askPageInput : null })

  // app-theme-root——這裡刻意不掛載:/app 路由本身(App.tsx 的
  // <Route path="/app/:panelMode?">)外層已經透過 KeyboardShrinkGuard
  // 疊加了這個全域 class(見 App.tsx 該處的完整說明),深色模式 token
  // (base-ui.css)已經生效。這個元件是掛在 /app 底下的正式功能頁面,
  // 不像原型 planning/preview/Content.tsx 是完全獨立於 /app 之外的路由
  // (/plan-ai,不經過那層外層 wrapper)——在這裡重複掛一次會變成巢狀
  // 兩層 .app-theme-root,徒增混淆(兩層各自的 data-theme 屬性若不同步
  // 還可能出現不一致的深色模式判斷)。
  return (
    <>
    <div
      className={[
        styles.page,
        compact ? styles.compact : '',
        compact && horizontalTimeline ? styles.compactBottom : '',
        transparentBackground ? styles.pageTransparentBackground : '',
      ].filter(Boolean).join(' ')}
    >
      {/* 2026-10 整個 header 已移除(使用者明確要求「原本安排幾站的工具列
          移除」)。它最後只剩一顆狀態藥丸,而藥丸裡的兩種內容都已經失去
          存在理由:
            - 「已安排 N 站」:站數在時間軸上一目了然,重複報一次數字。
            - 「正在安排行程…」:時間軸底部本來就有骨架卡與呼吸點在表達
              同一件事,且那個表達出現在「正在生成的位置」,比固定在頂端的
              一行字更精準。
          原本 header 還放過行程名稱(tripName),更早之前已另外移除——
          外層桌面版 rail、手機版 sheet 標頭各自已有行程情境。至此這一列
          沒有任何內容,整個拿掉而不是留一條空的 56px 橫槓。
          .header/.headerInner/.headerRight/.statusPill/.statusDot* 等樣式
          一併從 TripPlanPage.module.css 移除(展示頁 planning/preview/
          有自己獨立的一份,不受影響)。 */}
      {/* horizontalTimeline——見該 prop 的完整說明:true 時改渲染
          HorizontalPlanTimeline(橫向卡片時間軸,原本是 /ai-plan 展示頁
          模擬層專用),false(預設)維持現狀渲染縱向 PlanTimelineView。
          兩個分支背後接的互動邏輯(removeStop/refreshTransitForStop)
          大致相同,只是其中一部分（showJumpPill/jumpPillContent 等
          「回到最新」相關的 UI、onHoverTransit/mountedIdsRef 進場動畫、
          getTimeDragBounds/setStopTime 拖拉調時間)是縱向版專屬、沒有
          對應概念的互動,HorizontalPlanTimeline 本身沒有這些 prop(見該
          元件檔頭的完整說明:它刻意不處理這類縱向專屬的版面語意——
          2026-10 使用者明確要求「圖卡上不要時間」,把卡片上原本對齊
          縱向版的時間微調彈層整套互動也一併移除了)。 */}
      {horizontalTimeline ? (
        <HorizontalPlanTimeline
          // onLatestMessageChange/dimmed 已移除——2026-10 使用者明確
          // 指出對話泡泡「不應該放在輸入匡區」:泡泡的渲染跟「有新鮮
          // 泡泡時淡化時間軸」的判斷,現在都搬回
          // HorizontalPlanTimeline 內部自己處理(它本來就自己算出
          // latestMessage,之前只是把結果送出去給這裡渲染,現在不需要
          // 這段繞路),見該檔案的完整說明。
          // showAskPage/onAskPageDone/askPageInput——見
          // 上方 state 宣告處的完整說明:提升到這一層,讓程式與 AI 工具
          // 共用同一份狀態。資料存取層(詢問頁候選查詢、id 解析)由入口根部的
          // PlanDataProvider 提供,不再傳 dataSource prop;這個頁面的 dataSource
          // prop 只剩交通預估、站點地點查詢等「寫回節點」的用途,與 Provider 是同一個實例。
          // isGenerating——2026-10(使用者明確指出「推論態推論中是不是
          // 動畫沒有對齊播放態」後查出的真實落差):這裡原本完全沒傳這個
          // prop,預設 false,AI 思考中時卡片列尾端的呼吸點+骨架卡
          // shimmer(見 HorizontalPlanTimeline.tsx 該 prop 的完整說明)
          // 永遠不會出現,只有 composer 的 placeholder 文字會變成「AI
          // 思考中」(見下方 composerMode),跟 /ai-plan 展示頁播放態
          // (usePlanSimSocket 的 isGenerating,見該函式的完整說明)視覺
          // 不對齊。直接沿用 planAiChat.isThinking——語意範圍比模擬來源
          // 的 isGenerating 略寬(後者只在下一步確定是 add_stop 時才設
          // true,這裡是從送出到收到第一個回覆整段期間都 true),但作為
          // 「系統正在處理」的視覺回饋這個寬度是合理的,不會比播放態的
          // 語意更窄。
          isGenerating={planAiChat.isThinking}
          showAskPage={showAskPage}
          askPageInput={askPageInput}
          onAskPageDone={handleAskPageDone}
          onAskPageBack={handleAskPageBack}
          askPageConfirmViaComposer
          onAskPageSelectionChange={setAskSelection}
          onAskPageMapPointsChange={setAskPoints}
          onAskPageToggleReady={setAskToggle}
          askPageBadgedPlaceIds={badgedPlaceIds}
          // onRetryStop——手機版橫向時間軸也要有重試入口(review 發現:
          // /app 手機版走的是這條路徑,原本拿不到按鈕)。
          onRetryStop={retryStop}
          timeline={timeline}
          nodeStatus={nodeStatus}
          selectedStopId={selectedStopId}
          // onSelectStop——對齊 planning/preview/Content.tsx
          // 既有呼叫端的用法(見該處的完整說明):點卡片/捲動置中視同
          // 「選取」,這裡只需要通知 selectStop(受控/非受控雙模式的
          // 統一寫入口,見該函式的完整說明),不需要額外同步 hoverStopId
          // ——這個元件沒有獨立的 hover state,onHoverStopChange 仍然
          // 只掛在縱向版 PlanTimelineView 身上(見下方模板字面上這個
          // prop 沒有出現在這個分支的理由:HorizontalPlanTimeline 沒有
          // onHoverStop/onHoverTransit 這組 prop,手機版橫向卡片列本來
          // 就沒有滑鼠 hover 這件事,對齊該元件檔頭說明)。
          onSelectStop={selectStop}
          onRemoveStop={removeStop}
          onPanToStop={resolvePhonePanToStop(onPanToStop, panToStopId)}
          // onReplaceStop——上滑操作列的「更換地點」:用統一入口 startAsk 開「選擇感興趣的景點」詢問頁——以這一站座標查附近觀光
          // 地點(排除這一站自己,類型篩選同選城市那一步);沒有座標就退回探查模式用站名。選完由 onDone 直接
          // replaceStop(保留這一站的時間與順序,只換地點;選了多個只取第一個)。選擇一樣寫入 userSelectionRef。
          // AI 思考中、已有詢問頁開著或對話不可用時不提供(AI 正在改行程時不該同時被前端改)。
          onReplaceStop={
            planAiChat.isThinking || showAskPage || planAiChat.apiKeyMissing || planAiChat.urlMissing
              ? undefined
              : (stopId) => {
                  const node = getNode(timeline, stopId)
                  if (!node) return
                  const input = nearbyAskInput({ node, reason: REPLACE_ASK_REASON, search: (lat, lng) => searchNearbyCandidates(lat, lng, node.placeId) })
                  if (!input) return
                  const started = startAsk({
                    input,
                    onDone: ([picked]) => {
                      setMarkInItinerary(false)
                      if (picked) replaceStop(stopId, { placeId: picked.placeId, name: picked.name })
                    },
                    onCancel: () => setMarkInItinerary(false),
                  })
                  if (started) setMarkInItinerary(true)
                }
          }
          onSetStopTransitMode={
            TRANSIT_MODE_SELECT_ENABLED
              ? (stopId, mode) => refreshTransitForStop({ stopId, dataSource: planAiDataSource, setTimeline, getTimeline: () => timelineRef.current, forceMode: mode })
              : undefined
          }
          onOpenPhotos={setLightboxPhotos}
        />
      ) : showAskPage ? (
        /* 縱向(桌面)版的詢問頁——2026-10 新增(使用者明確要求「進入
           推論態一開始就顯示詢問要去那裡的國家清單」時實機發現):
           showAskPage 原本只有上方 horizontalTimeline(手機版)那個分支
           在消費,縱向版完全沒有渲染 AskPage 的位置。後果是桌面版只要
           有任何東西開啟詢問頁(LLM 呼叫 ask_travel_country 等工具、或
           initialAskPage),state 翻成 true 了但畫面上什麼都不會出現——
           使用者看不到任何可以點的東西,而開啟方那側若在等 Promise
           (工具呼叫的既有路徑)就永遠等不到結果。
           跟 /ai-plan 播放態桌面分支先前踩過的是同一類問題(見
           planning/preview/Content.tsx 該分支的完整說明:
           桌面不渲染 AskPage 導致整段劇本停在第 0 步)。
           處理方式也對齊手機版與那一頁:詢問頁與時間軸互斥顯示,同一塊
           版面空間用條件渲染切換,不需要額外的過場或狀態。 */
        <AskPage
          dataSource={planAiDataSource}
          input={askPageInput}
          onDone={handleAskPageDone}
          onBack={handleAskPageBack}
          stacked={isWide}
          confirmViaComposer
          onSelectionChange={setAskSelection}
          onMapPointsChange={setAskPoints}
          onToggleReady={setAskToggle}
          badgedPlaceIds={badgedPlaceIds}
        />
      ) : (
      <PlanTimelineView
        timeline={timeline}
        // messages——對話訊息,時間軸最下方渲染(見 PlanTimelineView messages prop);手機橫向時間軸不渲染對話。
        messages={messages}
        isThinking={planAiChat.isThinking}
        emptyStateMessage={emptyStateMessage}
        hideEmptyState={hideEmptyState}
        selectedStopId={selectedStopId}
        showJumpPill={showJumpPill}
        onJumpToLatest={jumpToLatest}
        onPanToStop={panToStop}
        // onSelectThemeChild——桌面預設卡的子景點 chip:選中主題卡本身(展開範圍圓圈與子景點小點),與手機版同語意。
        onSelectThemeChild={(parentId) => selectStop(parentId)}
        // onRemoveStop——介面上直接刪除景點的入口(使用者明確要求「之前
        // 做的景點刪除,也要可以從介面上刪除」,之前只有透過 AI 對話下
        // 指令觸發 remove_attraction 工具這一條路徑)。直接呼叫同一個
        // removeStop(usePlanTimelineCore),跟 remove_attraction 工具走
        // 的是同一條底層路徑,不是另外做一套——不需要額外的 existence
        // 檢查,因為這裡的 id 一定來自目前畫面上正在渲染的 steps,不會
        // 是使用者手打、可能不存在的任意字串(對齊 ctx.removeStop 那邊
        // 才需要防呆的理由:那邊的 id 來自 LLM,可能瞎猜或引用已經不
        // 存在的舊 id)。回傳值(是否真的觸發移除)在這裡不需要特別
        // 處理——理論上不會是 false,就算是,使用者再點一次也沒有副
        // 作用。
        onRemoveStop={removeStop}
        // onRetryStop——地點查詢失敗的站點上那顆「重試」按鈕(見
        // retryStop 與 PlanTimelineView 該 prop 的完整說明)。
        onRetryStop={retryStop}
        nodeStatus={nodeStatus}
        // getStopTimeDragBounds/onSetStopTime——時間軸小圓點拖拉調整
        // 時間的入口(使用者明確要求「時間軸的小圓點可以拖拉,上下拉動
        // 時調整時間,半小時為刻度」)。getStopTimeDragBounds 直接讀
        // timelineRef.current(理由同 getTimelineForBridge 等其餘讀取「當下
        // 最新」時間軸狀態的既有模式——拖拉手勢本身在 PlanTimelineView
        // 內部管理,每次拖拉開始時才查一次範圍,不需要訂閱 state 變化)。
        //
        // TIME_DRAG_ENABLED——feature flag(見 DesktopShared.tsx 同名
        // 常數的完整說明,使用者明確要求「前端使用 feature flag 控制
        // 功能開啟,控制時間拉動功能」)。關閉時兩個 prop 都不傳
        // (undefined),PlanTimelineView 的 handlePointerDown 本身就
        // 判斷「兩者都存在才啟用拖拉」(見該函式開頭的判斷),不需要在
        // 這裡另外包一層條件邏輯。
        getStopTimeDragBounds={TIME_DRAG_ENABLED ? (stopId) => getTimeDragBounds(timelineRef.current, stopId) : undefined}
        onSetStopTime={TIME_DRAG_ENABLED ? setStopTime : undefined}
        onHoverStop={onHoverStopChange}
        onHoverTransit={onHoverTransitChange}
        // onSetStopTransitMode——使用者點開交通膠囊的選單、選了另一種交通
        // 方式時觸發(使用者明確要求「交通時間的膠囊可以選擇交通方式」)。
        // 重新呼叫 refreshTransitForStop,帶上使用者選定的 mode(forceMode
        // 參數,見該函式的完整說明)——沿用跟「插入新站」「前一站更新」
        // 等既有呼叫時機完全相同的查詢/loading 佔位/失敗清空邏輯,不需要
        // 另外寫一套。
        //
        // TRANSIT_MODE_SELECT_ENABLED——feature flag(見 DesktopShared.tsx
        // 同名常數的完整說明)。關閉時不傳這個 prop(undefined),
        // PlanTimelineView 的 canPickMode 判斷本身就會讓膠囊維持原本
        // 純展示、不可點擊(見該元件 render 區塊的完整說明),不需要在
        // 這裡另外包一層條件邏輯,對齊 TIME_DRAG_ENABLED 兩個 prop 的既有
        // 寫法。
        onSetStopTransitMode={
          TRANSIT_MODE_SELECT_ENABLED
            ? (stopId, mode) => refreshTransitForStop({ stopId, dataSource: planAiDataSource, setTimeline, getTimeline: () => timelineRef.current, forceMode: mode })
            : undefined
        }
        onOpenPhotos={setLightboxPhotos}
        mountedIdsRef={mountedIdsRef}
        scrollRef={scrollRef}
        // compact 模式下讓時間軸區塊自己接手捲動(見 .compactScroll 的
        // 完整說明)——整頁模式維持不傳,捲動權留在外層 DesktopMain。
        scrollClassName={compact ? styles.compactScroll : undefined}
        // compact 模式下改用 absolute 定位覆寫共用元件預設的 sticky
        // (見 .compactJumpPillWrap 的完整說明:sticky 在規劃面板裡會黏錯
        // 容器,導致「回到最新」按鈕位置跑掉)——整頁模式維持不傳,
        // 沿用共用元件本身 sticky 相對 <main> 貼齊的既有行為。
        jumpPillWrapClassName={compact ? styles.compactJumpPillWrap : undefined}
        // compact 模式下按鈕本身也要覆寫——使用者先要求「太扁太寬,
        // 且要用 icon 不要用文字的箭頭」,後又要求「要有文字跟icon」
        // (兩者都要,不是純 icon)。改成 icon+文字的縮小版膠囊(見
        // .compactJumpPill 的完整說明),全頁版維持原樣不受影響。
        jumpPillClassName={compact ? styles.compactJumpPill : undefined}
        jumpPillContent={compact ? (
          <>
            <ArrowDown size={14} strokeWidth={2.2} />
            回到最新
          </>
        ) : undefined}
      />
      )}

      <ComposerPortal
        slot={composerSlot}
        wrapperClassName={[compact ? styles.compact : '', styles.inSlot].filter(Boolean).join(' ')}
      >
        {/* agentBubbleWrap(對話泡泡)已搬離這裡——2026-10 使用者明確
            指出「不應該放在輸入匡區」:原本放在 ComposerPortal 內部是
            因為「輸入框是透過 portal 傳送到版面外殼插槽的,泡泡要貼著
            它就得在同一個 portal 裡」,但這個插槽
            (PlanOverlayPanel.module.css 的 .composerSlot)是絕對定位,
            泡泡跟輸入框共用同一個插槽導致插槽整體高度隨泡泡內容變動,
            衍生出「卡片跟輸入匡重疊」的問題(上一輪只能靠加大
            HorizontalPlanTimeline.module.css .wrap 的 padding-bottom
            固定留白硬撐空間彌補)。現在泡泡搬回
            planning/timeline/phone/HorizontalPlanTimeline.tsx 內部,跟卡片列
            同層、走正常文件流排列,不再跟輸入框共用插槽,從根本上不會
            再發生這個問題,也不需要那段留白補償(見該檔案 .wrap 的
            完整說明)。
            latestAgentMessage 這個 state 連帶整個撤回
            HorizontalPlanTimeline 內部——它原本就是在那裡用 useMemo
            算出來的,之前透過 onLatestMessageChange 回報給這裡只是為了
            讓這裡渲染泡泡,現在泡泡搬回去了,不再需要這段「算出來→
            送出去→傳回來渲染」的繞路,HorizontalPlanTimeline 自己算
            自己用即可。 */}
        {/* Composer——共用輸入膠囊外框(components/Composer.tsx,見該檔頭
            的完整背景說明:原本這裡跟展示頁 planning/preview/Content.tsx 各自
            維護一份膠囊 CSS,查證「播放態跟推論態輸入匡文字樣式有沒有
            一樣」時發現字級不一致,抽成共用元件避免未來再次不同步)。
            這裡只傳真實業務邏輯需要的 props,膠囊造型/輸入框/送出鈕的
            基礎樣式交給共用元件負責,不重複定義。 */}
        <Composer
          className={styles.composer}
          value={chatInput}
          onChange={setChatInput}
          placeholder={
            planAiChat.apiKeyMissing || planAiChat.urlMissing
              ? COMPOSER_PLACEHOLDER_UNAVAILABLE
              : showAskPage && askSelection.length > 0
                ? `按送出確認選擇(${askSelection.length})`
                : composerMode.placeholder
          }
          // urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明:跟
          // apiKeyMissing 一樣視為「對話功能目前無法使用」,一起鎖定
          // 輸入框。
          disabled={planAiChat.apiKeyMissing || planAiChat.urlMissing}
          // 推論中:輸入框鎖住,送出鈕換成「停止」(見 Composer 的 busy/onStop)。有等待使用者的詢問頁時不鎖
          // (composerMode.busy 為 false),此時送出鈕是一般的送出、沒有停止鈕。
          busy={composerMode.busy}
          onStop={planAiChat.stopPrompt}
          // extraButton——「選擇景點」:開啟選擇感興趣景點的詢問頁。行程是空的 → 從國家頁開始(與一開始相同的流程);
          // 已有站點 → 以目前選中的那一站(沒選就用最後一站)為中心查附近觀光地點,選完請 AI 排進行程。
          // AI 思考中、已有詢問頁開著或對話不可用時停用。
          // statusIcon——輸入框左側的星芒圖示:AI 推論中帶旋轉光環與脈動特效,平時是安靜的靜態圖示。
          statusIcon={{ active: planAiChat.isThinking }}
          extraButton={[
            ...(onNewDraft
              ? [
                  {
                    label: '新行程',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    ),
                    // AI 思考中不建立新行程(推論還在寫目前這一份)。
                    disabled: planAiChat.isThinking,
                    onClick: onNewDraft,
                  },
                ]
              : []),
            {
            label: '選擇景點',
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            ),
            disabled: planAiChat.isThinking || showAskPage || planAiChat.apiKeyMissing || planAiChat.urlMissing,
            onClick: () => {
              const base = pickBaseStop(allNodes, selectedStopId ? getNode(timeline, selectedStopId) : undefined)
              const input = base ? nearbyAskInput({ node: base, reason: PICK_ASK_REASON, search: (lat, lng) => searchNearbyCandidates(lat, lng) }) : null
              if (!input) {
                void openAskPage({ country: {} })
                return
              }
              // 已經在行程裡的候選加「已在行程」標記(不阻擋選取),詢問頁結束時關掉。
              const started = startAsk({
                input,
                onDone: () => {
                  setMarkInItinerary(false)
                  void planAiChat.sendPrompt(PICKED_INTERESTS_PROMPT)
                },
                onCancel: () => setMarkInItinerary(false),
              })
              if (started) setMarkInItinerary(true)
            },
            },
          ]}
          onSubmit={() => {
            // routeComposerSubmit(見 composerMode.ts):空白或鎖住時不處理(即使按鈕已換成停止,form 仍可能
            // 被 Enter 鍵觸發 submit,這裡是跟 busy 對齊的第二道防線,理由同 sendPrompt 內部的併發保護說明)。
            const route = routeComposerSubmit(chatInput, composerMode)
            // 景點候選頁有勾選、輸入框空白:送出鈕 = 確認選擇(與按「確認選擇」相同,走 handleAskPageDone)。
            if (shouldConfirmFromComposer({ route, text: chatInput, showAskPage, selectionCount: askSelection.length })) {
              handleAskPageDone(askSelection)
              return
            }
            if (route === 'ignore') return
            if (route === 'askPage') {
              // 詢問頁開著:先清空輸入框,沒送出去時由 onAskPageTextNotSent 放回。
              const text = chatInput
              setChatInput('')
              submitAskPageText(text)
              return
            }
            // 等 sendPrompt 的結果決定要不要清空輸入框(見該函式回傳值
            // 的完整說明)——不再送出後立刻同步清空,避免後端拒絕
            // (429/400)或網路錯誤時使用者剛打的文字憑空消失。
            const text = chatInput
            void planAiChat.sendPrompt(text).then((sent) => {
              if (sent) setChatInput('')
            })
          }}
        />
      </ComposerPortal>
    </div>
    {lightboxPhotos && (
      <Lightbox
        photos={lightboxPhotos.photos}
        alt={lightboxPhotos.alt}
        onClose={() => setLightboxPhotos(null)}
      />
    )}
    </>
  )
}
