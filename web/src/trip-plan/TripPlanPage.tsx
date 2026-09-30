import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { AgentBridge } from '@onagent/bridge'
import { ApiError, fetchPlanAiPlaceDetailsAny, fetchPlanAiTransitEstimate, type ClientConfig } from '../api'
import { getTheme } from '../theme'
import { NativeMapBase, type MapHandle } from '../geo-planning/NativeMapBase'
import { toAgentBridgeTools } from '../sdk-proposals/toAgentBridgeTools'
import { useSyncedState } from '../hooks/useSyncedState'
import { createAttractionToolsList, type AttractionStepsCtx, type PlanStepLike } from '../plan-core/attractionTools'
import {
  createEmptyTimeline,
  insertAfter,
  removeNode,
  staleOtherAgentMessages,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanTimeline,
} from '../plan-core/planTimeline'
import styles from './TripPlanPage.module.css'

// TripPlanPage — 「AI 安排行程」正式功能頁面,對應 /app 底下的正式導覽
// 系統(有真實登入態,見下方 cfg 參數的完整說明)。
//
// 這個檔案是從 plan-ai/AIPlanTimelinePage.tsx(展示原型,對應獨立路由
// /plan-ai,使用者明確要求不要修改那份檔案)拆分出來的正式版本——原型
// 混雜了兩種東西:(1) 真正可複用的邏輯:onagent 對話橋接、時間軸 JSX
// 渲染、右上角小地圖、planTimeline.ts/attractionTools.ts 這兩個純函式
// 資料層;(2) 只服務展示原型的東西:usePlanSimSocket(模擬 WS,逐步播放
// 後端固定腳本)、simEnabled 開關、重播/下一步/測試按鈕、寫死的「台南
// 安平兩日遊」行程名稱與 Day 1/Day 2 分頁。
//
// 這裡只保留 (1),完全不包含 (2)——這是一個使用者實際會用的功能,不是
// 給團隊內部展示雛形用的原型。時間軸的資料層(planTimeline.ts/
// attractionTools.ts)直接 import 既有檔案共用,不複製貼上一份。
//
// 分天(Day 1/Day 2)概念——原型的分頁按鈕本身是純展示假資料(只有
// Day 1 有內容,Day 2 按鈕點了沒有任何作用),這裡先整個拿掉,不用假的
// 分頁 UI 硬撐出「有這個功能」的樣子。若日後要支援多天行程,應該是
// timeline 資料層本身先長出「屬於哪一天」的欄位與後端資料流,再回頭做
// UI,不是先做一個沒有資料支撐的分頁殼子——這裡先用單一連續時間軸涵蓋
// 整趟行程,是刻意的簡化取捨,不是遺漏。

const DEFAULT_MAP_CENTER = { lat: 23.001, lng: 120.182 }
const DEFAULT_MAP_ZOOM = 13
const SELECTED_MAP_ZOOM = 16

// MINI_MAP_ENABLED — 右上角固定小地圖是否掛載。跟原型一樣先暫時關閉
// (見原型 AIPlanTimelinePage.tsx 同名常數的完整說明:地圖本身持續發出
// 的圖磚/Places 請求會混進網路面板,干擾其餘功能的請求排查),正式收尾
// 時應改回 true 恢復地圖顯示。
const MINI_MAP_ENABLED = false

// REMOVE_FADE_MS — 淡出動畫時長,必須跟 .module.css 的 .removingFade
// 過渡時間一致(理由同原型同名常數的完整說明)。
const REMOVE_FADE_MS = 320

// NOTE_STYLES — 備註分類 → 顏色/圖示的固定對照表,直接沿用原型的既有
// 設計(見 AIPlanTimelinePage.tsx 同名常數的完整說明:視覺樣式怎麼對應
// 分類是行程安排元件自己的決定,不是 attractionTools.ts 的 add_note 工具
// 該內建的邏輯)。
const NOTE_STYLES: Record<string, { color: string; noteIcon: string }> = {
  consideration: { color: 'var(--ios-gray)', noteIcon: '✦' },
  info: { color: 'var(--ios-sand)', noteIcon: 'ⓘ' },
  cost: { color: 'var(--ios-green)', noteIcon: '💰' },
  weather: { color: 'var(--ios-blue)', noteIcon: '☁︎' },
}
const DEFAULT_NOTE_CATEGORY = 'info'

// PlanStep — 對外沿用的節點型別名稱,實際上就是 planTimeline.ts 的
// PlanNode(見該檔案的完整背景說明),這裡只是型別別名,不重新宣告欄位。
type PlanStep = PlanNode

// RATE_LIMIT_RETRY_DELAY_MS——place-details-any 回報「查詢過於頻繁」
// (見下方 isRateLimitedError 的完整說明)時,等待後單次重查的延遲時間。
// 使用者明確要求「過三秒後重查一次」——固定延遲、只重試一次,不是無限
// 重試或指數退避:這支端點的限流是後端 apigateway 的固定視窗式限流器
// (見 server/internal/geo/places.go 的 defaultRateLimiter),3 秒後視窗
// 通常已經讓額度恢復,重試一次沒有排到的機率不高;若還是失敗,直接照
// 既有行為靜默放棄,不無止盡重試造成更多請求堆積。
const RATE_LIMIT_RETRY_DELAY_MS = 3000

// isRateLimitedError——判斷 fetchPlaceDetails 拋出的例外是不是後端
// place-details-any 端點的限流拒絕(HTTP 429、code "rate_limited",見
// handlePublicGeoPlaceDetailsAny 的完整說明)。其餘錯誤(502 下游查詢
// 失敗、網路層失敗等)不重試,維持原本靜默放棄的既有行為——只有「確定
// 是被限流擋下、稍等就可能成功」這一種情況才值得重試。
function isRateLimitedError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.call.status !== 429) return false
  const body = err.call.responseBody as { error?: { code?: string } } | null
  return body?.error?.code === 'rate_limited'
}

// resolveAttractionForStep — add_attraction 帶 placeId 時,查詢真實地點
// 資料並寫回節點(單段查詢 GET /internal/geo/plan-ai/place-details-any,見原型
// AIPlanTimelinePage.tsx 同名函式的完整說明,邏輯原封不動搬過來,額外
// 加上 429 限流時的單次延遲重試,見 isRateLimitedError 的完整說明)。
//
// onSettled——插入當下的佔位卡不帶 lat/lng(座標要等這支函式查完才有),
// 交通卡查詢要等這裡查詢完成、座標確定之後才觸發,理由同原型同名函式的
// 完整說明。
function resolveAttractionForStep(
  stepId: string,
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; photoUrl?: string; lat?: number; lng?: number; attractionId?: string }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  isCancelled: () => boolean,
  onSettled: (lat: number, lng: number) => void,
  // isRetry——內部遞迴呼叫用的旗標,不對外公開:限定最多重試一次,不論
  // 重試那次結果如何(含再次被限流)都不再繼續重試,避免遇到持續限流的
  // 情況時無限延遲下去。
  isRetry = false,
) {
  fetchPlaceDetails(placeId)
    .then((details) => {
      if (isCancelled()) return
      if (details.found === false || details.lat == null || details.lng == null) {
        // 查無此地(理論上不該發生,placeId 應該總是有效——來自
        // search_attraction 查到的候選)——退回不帶完整資料的狀態,不留在
        // 「查詢中」卡住;沒有座標就無從估算交通時間,不呼叫 onSettled。
        setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
        name: details.name,
        desc: details.summary,
        photoUrl: details.photoUrl,
        lat: details.lat,
        lng: details.lng,
        placeId,
      }))
      onSettled(details.lat, details.lng)
    })
    .catch((err) => {
      if (isCancelled()) return
      if (!isRetry && isRateLimitedError(err)) {
        // 維持 loading:true(卡片繼續顯示「查詢中」),不提早切回
        // false——3 秒後這個節點若還存在(isCancelled 會在重試回呼裡
        // 再次檢查),才真的觸發第二次查詢。
        window.setTimeout(() => {
          if (isCancelled()) return
          resolveAttractionForStep(stepId, placeId, fetchPlaceDetails, setTimeline, isCancelled, onSettled, true)
        }, RATE_LIMIT_RETRY_DELAY_MS)
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
    })
}

// refreshTransitForStop — 重新計算 stopId 這個 stop 節點的
// transitFromPrev(見 planTimeline.ts TransitInfo 的完整說明),邏輯原封
// 不動搬自原型 AIPlanTimelinePage.tsx 同名函式——呼叫時機、先掛 loading
// 佔位狀態再背景查詢的理由,完整說明見該處。
function refreshTransitForStop(
  stopId: string,
  cfg: ClientConfig,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  getTimeline: () => PlanTimeline,
) {
  const timeline = getTimeline()
  const stopNode = timeline.nodes.get(stopId)
  if (!stopNode || stopNode.type !== 'stop' || stopNode.lat == null || stopNode.lng == null) return
  const prevNode = stopNode.prevId != null ? timeline.nodes.get(stopNode.prevId) : null
  if (!prevNode || prevNode.type !== 'stop' || prevNode.lat == null || prevNode.lng == null) {
    setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: undefined }))
    return
  }

  const prevId = prevNode.id
  setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: { loading: true } }))

  const from = { lat: prevNode.lat, lng: prevNode.lng }
  const to = { lat: stopNode.lat, lng: stopNode.lng }
  fetchPlanAiTransitEstimate(cfg, from, to)
    .then((estimate) => {
      setTimeline((prev) => {
        // 這一站可能已經被移除,或它的前一站在查詢期間又再次變動——此時
        // 直接放棄更新,理由同原型同名函式的完整說明。
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
      // 查詢失敗——清空 transitFromPrev,不留一張永遠轉圈的交通卡卡住
      // 畫面,理由同原型同名函式的完整說明。
      setTimeline((prev) => {
        const current = prev.nodes.get(stopId)
        if (!current || current.prevId !== prevId) return prev
        return updateNode(prev, stopId, { transitFromPrev: undefined })
      })
    })
}

// useTripPlanTimeline — 時間軸的 state 管理:插入/更新/移除節點、備註,
// 完全由使用者跟 onagent 對話後才逐步產生內容。
//
// 這是原型 usePlanSimSocket 拿掉模擬 WebSocket 連線(不連任何
// /public/plan-sim/ws,不播放固定腳本)之後剩下的部分——insertAttractionAfter/
// setNoteForStop 這兩個「機制跟介面由行程安排元件提供」的核心介面原封
// 保留,只是不再有 usePlanSimSocket 那個 simEnabled 分支與 ws.onmessage
// 的訊息轉譯邏輯。時間軸永遠從空的 createEmptyTimeline() 起點開始,沒有
// 任何預設節點或固定劇本可以「開啟模擬」重播。
//
// timeline 用 useSyncedState(理由同原型的完整說明)取代單純的
// useState——insertAttractionAfter/setNoteForStop 的呼叫來源是 AgentBridge
// 的原生事件,完全在 React 事件系統之外,需要「commit 呼叫當下就同步
// 拿到結果」這個保證。
function useTripPlanTimeline(cfg: ClientConfig) {
  const [timelineRef, timeline, commitTimeline] = useSyncedState<PlanTimeline>(createEmptyTimeline)
  const setTimeline = useCallback((updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => {
    commitTimeline((current) => ({
      next: typeof updater === 'function' ? (updater as (prev: PlanTimeline) => PlanTimeline)(current) : updater,
      result: undefined,
    }))
  }, [commitTimeline])

  // mountedRef——resolveAttractionForStep 的 429 限流重試(見該函式的
  // 完整說明)用 window.setTimeout 延後 3 秒才重查,若這段等待期間
  // 使用者切到其他 rail 分頁(這個元件整個卸載),原本沒有任何機制阻止
  // 計時器照常觸發、對已卸載元件多打一次沒有消費者在等的 API 請求
  // ——用 fable 審閱時發現的問題。只檢查「節點是否還存在於 timeline
  // 裡」(見 insertAttractionAfter 呼叫 resolveAttractionForStep 時傳入
  // 的 isCancelled)沒辦法涵蓋這個情況,因為元件卸載後 timelineRef 指向
  // 的內容不會被清空、節點依然「存在」。
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // insertAttractionAfter — 對齊原型 usePlanSimSocket 同名函式的介面與
  // 邏輯(見該處的完整說明):統一呼叫 planTimeline.ts 的 insertAfter 做
  // 驗證與插入,新插入的是 stop 節點時順帶淡化其他對話訊息節點
  // (staleOtherAgentMessages),插入成功且帶 placeId 佔位時背景查詢真實
  // 地點資料,查完後觸發交通卡重新計算。
  const insertAttractionAfter = useCallback(
    (anchorId: string | null, newId: string, data: PlanNodeData): ReturnType<typeof insertAfter> => {
      const result = commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        const inserted = insertAfter(current, anchorId, data, newId)
        if (!inserted.ok) return { result: inserted }
        if (data.type !== 'stop') return { next: inserted.timeline, result: inserted }
        return { next: staleOtherAgentMessages(inserted.timeline, newId), result: inserted }
      })
      if (result.ok && data.placeId && data.loading) {
        resolveAttractionForStep(
          newId,
          data.placeId,
          (placeId) => fetchPlanAiPlaceDetailsAny(cfg, placeId),
          setTimeline,
          // isCancelled——用 fable 審閱時發現這裡原本固定回傳 false,
          // 429 限流重試新增的 3 秒延遲視窗被打開後,若這個節點在等待
          // 期間已經被移除(removeStep)查不到、或整個元件已卸載
          // (mountedRef,見該處的完整說明),就不該再觸發重試,避免對
          // 已經沒有意義的節點多打一次 API、或寫入已卸載元件的 state。
          () => !mountedRef.current || !timelineRef.current.nodes.has(newId),
          () => refreshTransitForStop(newId, cfg, setTimeline, () => timelineRef.current),
        )
      } else if (result.ok && data.type === 'stop' && data.lat != null && data.lng != null) {
        refreshTransitForStop(newId, cfg, setTimeline, () => timelineRef.current)
      }
      return result
    },
    [cfg, commitTimeline, setTimeline, timelineRef],
  )

  // setNoteForStop — 對齊原型同名函式的介面與邏輯(見該處的完整說明):
  // 把備註寫在既有節點自己身上,不是插入新節點。
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

  // removeStep — 移除一個節點,先標記 removing 觸發 CSS 淡出動畫,真正
  // 從鏈結摘除延遲到動畫播完後才做(理由同原型 REMOVE_FADE_MS 的完整
  // 說明)。正式功能目前沒有任何 UI 入口會呼叫這個函式(原型的兩顆測試
  // 按鈕已經整個拿掉),先保留這個能力給 onagent 之後若要加上「移除某一
  // 站」的工具時使用——時間軸資料層本來就支援這個操作,不需要等加新
  // 工具時才回頭補。
  const removeStep = useCallback((removedId: string) => {
    setTimeline((prev) => updateNode(prev, removedId, { removing: true }))
    setTimeout(() => {
      const nextId = timelineRef.current.nodes.get(removedId)?.nextId
      setTimeline((prev) => removeNode(prev, removedId))
      if (nextId != null) refreshTransitForStop(nextId, cfg, setTimeline, () => timelineRef.current)
    }, REMOVE_FADE_MS)
  }, [cfg, setTimeline, timelineRef])

  // useMemo——toRenderList 每次呼叫都回傳新陣列(見 planTimeline.ts 的
  // 實作,沿著鏈結走訪重新 push 一次),若不做 memo,每次 render(含跟
  // 時間軸內容完全無關的 re-render,例如使用者在輸入框打字造成的
  // chatInput state 變化)都會產生新的 steps 參考,連帶讓依賴它的
  // useEffect(下方 scrollToLatest 的自動捲動邏輯)誤判「時間軸內容
  // 變了」而觸發——用 fable 審閱時發現的實際症狀:使用者停在最底部
  // 打字時,畫面會被强制 smooth-scroll 往上跳一段,並因此被踢出跟隨
  // 模式。只有 timeline 這個真正的資料本身改變時才需要重新攤平。
  const steps = useMemo(() => toRenderList(timeline), [timeline])

  return {
    steps,
    timeline,
    timelineRef,
    insertAttractionAfter,
    setNoteForStop,
    removeStep,
  }
}

// PLAN_AI_ONAGENT_APP_ID/PLAN_AI_ONAGENT_URL——正式功能對話窗專用的
// onagent app,對齊原型的既有設定(見 AIPlanTimelinePage.tsx 同名常數的
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

// usePlanAiChatBridge — 連上 plan-ai-timeline 這個 onagent app,註冊
// search_attraction/add_attraction 等工具(見 attractionTools.ts),讓
// 對話框輸入的文字能真的驅動 LLM 推論、呼叫工具、把結果異動進時間軸。
// 邏輯整段對齊原型 AIPlanTimelinePage.tsx 同名 hook(見該處的完整
// 說明),差別只在:
//   - 不再需要跟 usePlanSimSocket 共享同一組 insertAttractionAfter/
//     setNoteForStop——這裡改成呼叫端(TripPlanPage 主體,透過
//     useTripPlanTimeline)自己提供,原型裡兩條路徑共用同一組函式的
//     說明在這裡已經不適用(正式功能只有這一條路徑)。
//   - createAttractionToolsList(cfg) 的 cfg 改成呼叫端傳入的真實登入態
//     設定(見下方 TripPlanPage 對 cfg 參數的完整說明),不是原型的
//     GUEST_CFG 免登入假資料查詢路徑。
//
// getSteps/insertAttraction/addNote 用 ref 包一層(理由同原型的完整
// 說明)——這幾個函式來自呼叫端每次 render 產生的新閉包,若直接放進
// useEffect 依賴陣列會導致每次重渲染都重新建立一次 WebSocket 連線。
function usePlanAiChatBridge(
  cfg: ClientConfig,
  getSteps: () => PlanStepLike[],
  insertAttraction: (
    anchorId: string | null,
    newId: string,
    data: PlanNodeData,
  ) => ReturnType<typeof insertAfter>,
  addNote: (anchorId: string, text: string, category: string | undefined) => ReturnType<typeof insertAfter>,
) {
  const apiKey = import.meta.env.VITE_PLAN_AI_ONAGENT_APP_KEY as string | undefined
  const [status, setStatus] = useState<PlanAiChatStatus>('connecting')
  // isThinking——從 sendPrompt 呼叫那一刻開始 true,到收到第一個
  // onAssistantMessage 或 onError 為止轉回 false,接給呼吸點/骨架卡那組
  // 思考動畫用(理由同原型的完整說明)。
  const [isThinking, setIsThinking] = useState(false)
  const bridgeRef = useRef<AgentBridge | null>(null)
  const getStepsRef = useRef(getSteps)
  const insertAttractionRef = useRef(insertAttraction)
  const addNoteRef = useRef(addNote)
  useEffect(() => {
    getStepsRef.current = getSteps
    insertAttractionRef.current = insertAttraction
    addNoteRef.current = addNote
  })

  useEffect(() => {
    // urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明:URL 缺失時不再
    // 嘗試建立一個注定連不上的連線,直接不執行這個 effect,呼叫端據下方
    // 回傳的 urlMissing 顯示明確提示,不是留一個看起來正常、實際永遠沒有
    // 回應的連線狀態。
    if (!apiKey || !PLAN_AI_ONAGENT_WS_URL) return
    // ctx——同原型的完整說明:insertAttractionAfter/addNote 轉接同步
    // 回傳值成這個 ctx 介面期望的 Promise 形狀(async 函式回傳非 Promise
    // 值會被自動裝箱,不需要刻意包 Promise.resolve)。
    const ctx: AttractionStepsCtx = {
      getSteps: () => getStepsRef.current(),
      insertAttractionAfter: async (anchorId, step) => {
        const newId = `agent-${crypto.randomUUID()}`
        const result = insertAttractionRef.current(anchorId, newId, step)
        return result.ok ? { ok: true, id: result.insertedId } : { ok: false, error: result.error }
      },
      addNote: async (anchorId, text, category) => {
        const result = addNoteRef.current(anchorId, text, category)
        return result.ok ? { ok: true, id: result.insertedId } : { ok: false, error: result.error }
      },
    }
    const bridge = new AgentBridge({
      url: PLAN_AI_ONAGENT_WS_URL,
      appId: PLAN_AI_ONAGENT_APP_ID,
      apiKey,
      tools: toAgentBridgeTools(createAttractionToolsList(cfg), ctx),
      // onAssistantMessage/onError——把文字插入成獨立的 message 節點(見
      // planTimeline.ts PlanNodeType 的完整說明),不是附屬在某個景點卡上
      // 的引言,對齊原型的既有設計(理由見該處的完整說明)。
      onAssistantMessage: (text) => {
        setIsThinking(false)
        const steps = getStepsRef.current()
        const lastId = steps.length > 0 ? steps[steps.length - 1].id : null
        const newId = `agent-msg-${crypto.randomUUID()}`
        insertAttractionRef.current(lastId, newId, { type: 'message', text })
      },
      onError: (err) => {
        setIsThinking(false)
        const steps = getStepsRef.current()
        const lastId = steps.length > 0 ? steps[steps.length - 1].id : null
        const newId = `agent-msg-${crypto.randomUUID()}`
        insertAttractionRef.current(lastId, newId, { type: 'message', text: `(連線錯誤: ${err.message})` })
      },
    })
    bridgeRef.current = bridge
    setStatus('connecting')
    // AgentBridge 沒有連線成功的 callback,用送出後短暫延遲樂觀顯示
    // ready(對齊原型/useOnagentChatBridge.ts 的既有做法)。
    const t = window.setTimeout(() => setStatus('ready'), 500)
    return () => {
      window.clearTimeout(t)
      bridge.close()
      bridgeRef.current = null
      setStatus('closed')
    }
  }, [apiKey, cfg])

  const sendPrompt = useCallback((text: string) => {
    if (!text.trim() || !bridgeRef.current) return
    setIsThinking(true)
    bridgeRef.current.prompt(text)
  }, [])

  return {
    apiKeyMissing: !apiKey,
    // urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明,呼叫端據此顯示
    // 提示、鎖定輸入框,對稱 apiKeyMissing 的既有處理方式。
    urlMissing: !PLAN_AI_ONAGENT_WS_URL,
    status,
    isThinking,
    sendPrompt,
  }
}

// TripPlanPage — /app 底下正式的「AI 安排行程」功能頁面。
//
// cfg 是必填(不像 pace/PaceChart.tsx 那樣把 cfg 設成選填、走訪客模式
// 免登入假資料查詢路徑)——這是正式功能,操作的是真實使用者的行程資料,
// 不應該有「沒登入也能用」的路徑。onagent 對話部分原本(原型)用
// GUEST_CFG 的地方,這裡全部改成用這裡傳入的 cfg。
//
// 不接 tripID——這個功能不依附在特定旅程上:onagent 對話工具集
// (attractionTools.ts)操作的是這個元件內部的 timeline state,不是
// 後端的 trip_entry_* 資料,沒有「寫入哪一個真實行程」這個概念,使用者
// 明確要求「plan ai 不需要 trip id」,不必先選定一趟旅程才能使用這個
// 功能(呼叫端 DesktopRail.tsx 對應拿掉 requiresTrip)。原本還有獨立的
// tripName prop 顯示行程名稱/「未命名行程」,使用者明確要求不要顯示
// (外層桌面版 rail、手機版 sheet 標頭已經各自有行程情境,這裡不需要
// 再重複),連同 prop 一併移除,呼叫端不再傳入。
export function TripPlanPage(props: {
  cfg: ClientConfig
}) {
  const { cfg } = props
  const theme = getTheme()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)

  const { steps, timelineRef, insertAttractionAfter, setNoteForStop } = useTripPlanTimeline(cfg)
  const stopCount = steps.filter((s) => s.type === 'stop').length

  // getStepsForBridge——usePlanAiChatBridge 的 getSteps 需要讀到「當下
  // 最新」的節點清單,不能綁死成某一次 render 時的閉包。
  //
  // 2026-09 修正(code review 發現):原本這裡讀一個額外的 stepsRef,靠
  // useEffect(() => { stepsRef.current = steps }, [steps]) 同步——這個
  // useEffect 要等 React commit 完成才會執行,而 insertAttractionAfter/
  // setNoteForStop 是透過 useSyncedState 的 commitTimeline 同步寫入
  // timelineRef(見該 hook 開頭的完整說明:這正是它存在的理由,避免
  // 「setState 呼叫完緊接著讀,結果還沒算好」這類真實踩過的 bug)。
  // 兩者之間有一個 render/commit 的時間差:LLM 連續呼叫 add_attraction
  // 後緊接著呼叫 list_itinerary(或 onAssistantMessage 緊接著前一個
  // 工具呼叫觸發),都可能發生在 React 完成該次 re-render 之前——這時
  // stepsRef 還沒同步到剛寫入的節點,list_itinerary 回傳漏掉剛插入的
  // 站點,onAssistantMessage 也會把新訊息接在錯誤(已過期)的最後節點
  // 之後。list_itinerary 這個工具當初就是為了讓 LLM 不必依賴可能過期
  // 的記憶去猜時間軸現況才新增的(見 attractionTools.ts 的完整說明),
  // 若它自己讀到的也是過期資料,等於沒有真正解決那個問題。
  //
  // 改成直接讀 timelineRef.current 即時算 toRenderList——timelineRef 是
  // useSyncedState 保證同步寫入的 ref,不經過 useEffect 這個中間層,
  // 沒有這個時間差。
  const getStepsForBridge = useCallback((): PlanStepLike[] => toRenderList(timelineRef.current), [timelineRef])

  // addNoteToTimeline — 對齊原型同名函式的介面與邏輯(見該處的完整
  // 說明):對外暴露的「把一則備註寫在既有節點上」程式介面,category
  // 未提供或不在 NOTE_STYLES 表列範圍內時 fallback 成 DEFAULT_NOTE_CATEGORY。
  const addNoteToTimeline = useCallback(
    (anchorId: string, text: string, category?: string): ReturnType<typeof insertAfter> => {
      const resolvedCategory = category && NOTE_STYLES[category] ? category : DEFAULT_NOTE_CATEGORY
      return setNoteForStop(anchorId, text, resolvedCategory)
    },
    [setNoteForStop],
  )

  const planAiChat = usePlanAiChatBridge(cfg, getStepsForBridge, insertAttractionAfter, addNoteToTimeline)
  const [chatInput, setChatInput] = useState('')

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,理由同原型的完整
  // 說明:用 id 而非陣列 index 判斷 justMounted,插入到中間的節點才能
  // 正確觸發進場動畫。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // ---------- 右上角固定小地圖 ----------
  // 只掛載單一 NativeMapBase 實例,點擊任一張 stop 卡片時呼叫
  // panTo + setZoom,理由同原型的完整說明(避免每張卡片各自掛一個地圖
  // 造成效能負擔)。
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
  // 最後一個節點),理由同原型的完整說明。
  //
  // 2026-09:真正的捲動容器不再是 scrollRef 指向的 .scroll 本身——改用
  // DesktopMain 的 unboundedScroll 後(見 DesktopLayout.tsx 對 plan-ai
  // 傳入這兩個 prop 的完整說明,理由是使用者回報「捲軸要貼在視窗」),
  // 捲動權收到外層 <main>(DesktopMain.tsx 渲染出的原生 HTML 標籤,
  // 用標籤選取而不是 CSS Modules 的雜湊 class 名稱,不會因為樣式檔
  // 調整而跟著失效),.scroll 只是流動的內容區塊。用 closest('main')
  // 從 scrollRef(仍指向 .scroll,方便量測節點位置)往上找到這個真正
  // 會捲動的祖先元素。
  // 直接捲到最底,不再用「目標節點頂端距視窗底 160px」的舊算法:那是
  // 輸入膠囊還是 absolute、不佔版面時的設計,改成 sticky 佔版面後,那個
  // 位置比真正的底部高約 100px,捲到底會被拉回去。最新的節點/呼吸點
  // 本來就在內容最末端,捲到底就會出現在膠囊正上方。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollRef.current?.closest('main')
        if (!scroller) return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      })
    })
  }, [])

  // 只在 steps 改變時跟隨,不把跟隨狀態放進依賴:否則使用者手動捲到底、
  // 跟隨狀態從 false 翻成 true 的那一刻,這個 effect 也會被觸發去捲動。
  useEffect(() => {
    if (!followingRef.current) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, scrollToLatest])

  // 只有「使用者往上捲、且離底部超過 80px」才退出跟隨。程式觸發的平滑
  // 捲動(往下)與新節點撐高內容(scrollTop 不變)都不會讓它誤判成離開。
  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current?.closest('main')
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
  }, [planAiChat.isThinking])

  // 2026-09:捲動事件現在發生在外層 <main>(見 scrollToLatest 的完整
  // 說明),不是 .scroll 本身——JSX 沒辦法直接在父層元件渲染的 <main>
  // 上掛 onScroll,改用 effect 手動加/移除原生事件監聽器。
  useEffect(() => {
    const scroller = scrollRef.current?.closest('main')
    if (!scroller) return
    scroller.addEventListener('scroll', handleScroll)
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const jumpToLatest = useCallback(() => {
    followingRef.current = true
    setShowJumpPill(false)
    scrollToLatest()
  }, [scrollToLatest])

  // emptyStateMessage/placeholder——對齊原型的既有文案與設計取捨(見該
  // 處的完整說明):漂浮膠囊只留 input 本身,時間軸完全空白時的引導
  // 文字放進主顯示區(.scroll/.inner)當空狀態文案。isGenerating(原型
  // 的模擬腳本生成中狀態)在這裡不存在——正式功能只有 onagent 對話一種
  // 「AI 正在做事」的訊號來源,即 planAiChat.isThinking。
  const emptyStateMessage = '想去哪裡玩？跟我說說你的想法，我可以幫你查景點、安排行程。'
  const placeholder = planAiChat.isThinking ? '可以隨時打斷，例如：下午不要排太滿' : '想調整哪裡？'

  // app-theme-root——這裡刻意不掛載:/app 路由本身(App.tsx 的
  // <Route path="/app/:panelMode?">)外層已經透過 KeyboardShrinkGuard
  // 疊加了這個全域 class(見 App.tsx 該處的完整說明),深色模式 token
  // (base-ui.css)已經生效。這個元件是掛在 /app 底下的正式功能頁面,
  // 不像原型 AIPlanTimelinePage.tsx 是完全獨立於 /app 之外的路由
  // (/plan-ai,不經過那層外層 wrapper)——在這裡重複掛一次會變成巢狀
  // 兩層 .app-theme-root,徒增混淆(兩層各自的 data-theme 屬性若不同步
  // 還可能出現不一致的深色模式判斷)。
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* headerInner——2026-09 新增:改用 DesktopMain 的 unboundedScroll
            後(見 scrollToLatest 上方的完整說明),.page 不再被限制在
            860px 容器裡,.header 背景需要撐滿整個視窗寬度(視覺一致,
            跟時間軸/漂浮膠囊所在的區域同寬同色),但內容(狀態藥丸)
            仍要維持跟 .inner(時間軸內容)一樣的 640px 置中對齊,不能讓
            文字貼到視窗最左最右——這層負責「背景滿版、內容置中」的
            拆分,理由同 fable 審閱時發現 header 若整個 unbounded 卻不做
            這個拆分,左右兩側元素會懸空脫節的問題。原本這裡還有一個
            .headerLeft 放行程名稱,使用者明確要求不顯示行程名稱/
            「未命名行程」(外層桌面版 rail、手機版 sheet 標頭已經各自
            有行程情境,這裡不需要再重複)——連同 tripName prop 一併
            移除(見上方元件簽名的完整說明),.headerRight 改靠
            margin-left: auto 頂到最右側,取代原本兩端對齊
            (justify-content: space-between)靠左邊 .headerLeft 撐開的
            版面。 */}
        <div className={styles.headerInner}>
          <div className={styles.headerRight}>
            <div className={styles.statusPill}>
              {planAiChat.isThinking ? (
                <>
                  <span className={`${styles.statusDot} ${styles.statusDotGenerating}`} />
                  <span>正在安排行程…</span>
                </>
              ) : (
                <>
                  <span className={`${styles.statusDot} ${styles.statusDotDone}`} />
                  <span>已安排 {stopCount} 站</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 右上角固定小地圖——position: fixed(見 .module.css 的完整說明),
          不佔版面空間、不隨時間軸捲動。單一 NativeMapBase 實例,點擊
          stop 卡片時呼叫 panToStop 讓它 panTo+放大(理由同上方
          panToStop 的完整說明)。MINI_MAP_ENABLED 暫時關閉,理由同該
          常數的完整說明。 */}
      {MINI_MAP_ENABLED && (
        <div className={styles.miniMapWrap}>
          <NativeMapBase
            center={DEFAULT_MAP_CENTER}
            zoom={DEFAULT_MAP_ZOOM}
            theme={theme}
            showZoomControl={false}
            onHandleChange={handleMapHandleChange}
          />
        </div>
      )}

      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.inner}>
          {/* emptyState——時間軸完全空白、也還沒開始生成時的引導文字,
              理由同原型的完整說明。planAiChat.isThinking 為 true 時不
              顯示——那個情況下面已經有呼吸點/骨架卡(.tipRow)傳達「正在
              安排」的狀態,不需要空狀態文字跟生成動畫同時出現互相干擾。 */}
          {steps.length === 0 && !planAiChat.isThinking && (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateIcon}>✦</span>
              <p className={styles.emptyStateText}>{emptyStateMessage}</p>
            </div>
          )}
          {steps.map((p, idx) => {
            // justMounted:這個節點是不是「第一次」出現在畫面上(理由同
            // 原型的完整說明)——用 id 是否已經記錄過判斷,不是用陣列
            // index,插入到中間的節點才能正確觸發進場動畫。
            const justMounted = !mountedIdsRef.current.has(p.id)
            if (justMounted) mountedIdsRef.current.add(p.id)
            const mountedClass = styles.mountFadeIn
            // removingClass:套在每個節點最外層的 .row 容器上,CSS 同時
            // 做透明度淡出跟高度塌縮(理由同原型的完整說明)。
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
              // transitFromPrev(見 planTimeline.ts TransitInfo 的完整
              // 說明)掛在到達站自己身上——渲染時在這張 stop 卡片「之前」
              // 多畫一列交通卡,key 加 "transit-" 前綴避免跟下面 stop
              // 本身的 key(p.id)衝突。
              const transit = p.transitFromPrev
              // note——這個節點自己的備註(見 planTimeline.ts NoteInfo
              // 的完整說明),掛在這張 stop 卡片自己身上的欄位,渲染時在
              // 卡片之前多畫一列。
              const note = p.note
              const noteStyle = note ? NOTE_STYLES[note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY] : null
              return (
                <Fragment key={p.id}>
                  {note && noteStyle && (
                    <div className={`${styles.row} ${styles.noteRow}`}>
                      <div className={`${styles.noteLeft} ${mountedClass} ${justMounted ? styles.noteFade : ''}`}>
                        <div className={styles.noteInner}>
                          <div className={styles.noteBar} style={{ background: noteStyle.color }} />
                          <div className={styles.noteText}>
                            <span style={{ marginRight: 4 }}>{noteStyle.noteIcon}</span>{note.text}
                          </div>
                        </div>
                      </div>
                      <div className={styles.noteAxisCol}>
                        <div className={styles.noteAxisLine} />
                      </div>
                      <div />
                    </div>
                  )}
                  {transit && (
                    <div className={`${styles.row} ${styles.transitRow}`}>
                      <div />
                      <div className={styles.transitAxis}>
                        <div className={styles.transitDashAbove} />
                        <div className={styles.transitDashBelow} />
                        <div className={`${mountedClass} ${justMounted ? styles.pillExpand : ''} ${styles.transitPill}`}>
                          {/* 查詢中(loading:true)只顯示轉圈動畫,不顯示
                              任何文字,重用 stop 卡片查詢中狀態既有的
                              thumbSpinner 動畫,理由同原型的完整說明。 */}
                          {transit.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢交通資訊中" />
                          ) : (
                            <>
                              <span>{transit.icon}</span>
                              <span>{transit.mode} {transit.minutes} 分 · {transit.distance}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div />
                    </div>
                  )}
                  <div data-tl-node className={`${styles.row} ${styles.stopRow} ${removingClass}`}>
                    <div className={`${styles.stopTime} ${mountedClass}`}>
                      <div className={styles.stopTimeText}>{p.time}</div>
                    </div>
                    <div className={styles.axisCol}>
                      {idx > 0 && <div className={styles.axisLineAbove} />}
                      {/* axisLineBelow——「還有下一個節點」或「正在生成中」
                          任一成立時都畫出來,理由同原型的完整說明(避免
                          最後一張卡片下方到呼吸點之間出現斷裂)。 */}
                      {(idx < steps.length - 1 || planAiChat.isThinking) && <div className={styles.axisLineBelow} />}
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
                </Fragment>
              )
            }

            // message——LLM/使用者的對話訊息(見 planTimeline.ts
            // PlanNodeType 的完整說明),時間軸上自己獨立的一列,不依附
            // 任何 stop 卡片,理由同原型的完整說明。新的 stop 節點插入後
            // (p.stale === true)收合成一行淡化的小字,不整個移除。
            if (p.type === 'message') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.messageRow} ${mountedClass} ${removingClass}`}>
                  <div />
                  <div className={styles.messageAxisCol}>
                    <div className={styles.messageAxisLine} />
                  </div>
                  <div className={styles.messageWrap}>
                    <div className={`${styles.messageBubble} ${p.stale ? styles.messageBubbleStale : ''}`}>
                      {/* stale(收合淡化態)是單行省略號截斷的純文字——
                          markdown 排版在那個高度/寬度下沒有意義。新鮮態
                          才用 ReactMarkdown 渲染完整內容,理由同原型的
                          完整說明。 */}
                      {p.stale ? (
                        p.text
                      ) : (
                        <div className={styles.messageMarkdown}>
                          <ReactMarkdown>{p.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          {/* planAiChat.isThinking——onagent 對話推論中(唯一的「AI 正在
              做事」訊號來源,理由見上方檔案開頭的完整說明)。 */}
          {planAiChat.isThinking ? (
            // key 綁「目前最後一個節點的 id」,理由同原型的完整說明:讓
            // 「最後一個節點變了」等同「呼吸點換了位置」,強制 React
            // 卸掉舊的 tipRow 重新掛一個,CSS 動畫才會隨之重播。
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
              {/* 骨架卡——呼吸點下方的「即將出現的內容」預告,理由同原型
                  的完整說明。只在已經有節點之後才顯示。 */}
              {steps.length > 0 && (
                <div aria-hidden="true" className={`${styles.row} ${styles.stopRow} ${styles.skeletonRow}`}>
                  <div />
                  <div className={styles.axisCol}>
                    {/* skeletonAxisAbove——骨架卡列自己補一段貫穿到
                        .skeletonAnchor 中點的虛線,不依賴上一列
                        .tipLineBelow 用魔術數字(bottom: -160px)猜測骨架
                        卡列高度往下穿透——那個寫法一旦骨架卡實際高度
                        跟猜測值不同就會斷裂或超出(使用者實際回報過
                        「時間軸斷裂」,卡片下方到呼吸點之間出現一段沒有
                        任何軸線元素的空白)。理由同 .axisLineAbove 讓每一
                        列自己負責自己範圍內的軸線銜接。 */}
                    <div className={styles.skeletonAxisAbove} />
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
            <div className={`${styles.endMarker} ${styles.endFade}`}>── 目前安排到這裡 ──</div>
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
              {/* urlMissing——見 PLAN_AI_ONAGENT_WS_URL 的完整說明:跟
                  apiKeyMissing 一樣視為「對話功能目前無法使用」,一起
                  鎖定輸入框,但提示文案刻意不暴露「URL 未設定」這種
                  環境設定層級的內部細節,對使用者統一顯示成「功能調整
                  中」——使用者明確要求提示文案不要用「未設定」這類
                  字眼。 */}
              <input
                type="text"
                placeholder={planAiChat.apiKeyMissing || planAiChat.urlMissing ? '對話功能調整中，請稍後再試' : placeholder}
                aria-label="輸入指令"
                className={styles.input}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={planAiChat.apiKeyMissing || planAiChat.urlMissing}
              />
            </div>
            {/* 正式功能不再有模擬腳本的生成中/終止狀態(原型的「終止」按鈕
                整個拿掉,見檔案開頭的完整說明)——送出鈕固定送出對話框
                文字,onagent 對話本身沒有使用者主動中斷推論的需求(工具
                呼叫通常很快完成,不像模擬腳本會長時間持續推播)。 */}
            <button type="submit" aria-label="送出" className={styles.sendBtn} disabled={planAiChat.apiKeyMissing || planAiChat.urlMissing}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ios-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
