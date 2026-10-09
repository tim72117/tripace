import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { AgentBridge } from '@onagent/bridge'
import { ApiError, fetchGeoPlacePhotoAssets, fetchPlanAiPlaceDetailsAny, fetchPlanAiTransitEstimate, postPlanAiChat, postPlanAiChatReply, type ClientConfig } from '../api'
import { Lightbox } from '../geo-planning/PhotoCarousel'
import { hasAnyPhoto, PHOTO_RETRY_DELAY_MS, PHOTO_RETRY_MAX_ATTEMPTS } from '../photoRetry'
import { toAgentBridgeTools } from '../sdk-proposals/toAgentBridgeTools'
import { useStableCallback } from '../hooks/useStableCallback'
import { useSyncedState } from '../hooks/useSyncedState'
import { createAttractionToolsList, type AttractionStepsCtx, type PlanStepLike } from '../plan-core/attractionTools'
import { PlanTimelineView } from '../plan-core/PlanTimelineView'
import {
  insertAfter,
  removeNode,
  staleOtherAgentMessages,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanTimeline,
} from '../plan-core/planTimeline'
import { loadTimelineWithRev, readRev, saveTimeline } from '../plan-core/planTimelineStorage'
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

// PHOTO_RETRY_DELAY_MS/PHOTO_RETRY_MAX_ATTEMPTS/hasAnyPhoto 改從
// ../photoRetry 匯入(2026-10 code review 發現這裡跟地圖版
// useThemeAttractionSelection.ts 的 retryWithPhotoAssetsOnly 重複定義
// 同一套數值/判斷邏輯,見該模組檔頭的完整說明)——原本這裡的數值/理由
// 完全對齊地圖版(使用者明確要求「AI 規劃版採用一樣的補圖,前端也用
// 一樣的重試機制」:handlePublicGeoPlaceDetailsAny 也套用漸進補圖
// 機制,第一次查詢若剛好觸發背景補圖、這次回應不會等下載完成,故補一段
// 原地重查),現在改成真正共用同一份定義,不是各自複製後維持數值一致。
// 重試迴圈本身(下方 retryPhotoOnly)仍留在這裡,不抽成共用函式,理由
// 見 photoRetry.ts 檔頭說明。

// resolveAttractionForStep — add_attraction 帶 placeId 時,查詢真實地點
// 資料並寫回節點(單段查詢 GET /internal/geo/plan-ai/place-details-any,見原型
// AIPlanTimelinePage.tsx 同名函式的完整說明,邏輯原封不動搬過來,額外
// 加上 429 限流時的單次延遲重試,見 isRateLimitedError 的完整說明)。
//
// onSettled——插入當下的佔位卡不帶 lat/lng(座標要等這支函式查完才有),
// 交通卡查詢要等這裡查詢完成、座標確定之後才觸發,理由同原型同名函式的
// 完整說明。
//
// fetchPhotoAssets——選填:查到資料但 googlePhotoUrls 為空時,進入跟
// 地圖版 fetchPoiContent/retryWithPhotoAssetsOnly 完全一致的重試迴圈
// (見 PHOTO_RETRY_* 的完整說明),改呼叫這支純讀端點(對應後端
// GET .../geo/place-photo-assets),不能重複呼叫 fetchPlaceDetails——
// 後者每次呼叫都會觸發 IncrementPlaceClickCount,連續重試會重複推進
// 漸進補圖的點擊節奏判斷,這是地圖版同樣的既有限制(見
// useThemeAttractionSelection.ts 檔頭的完整說明)。省略這個參數時完全
// 不重試,維持原本行為(例如未來若有呼叫端不需要這段重試)。
function resolveAttractionForStep(
  stepId: string,
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; googlePhotoUrls?: string[]; lat?: number; lng?: number; attractionId?: string; photoRefreshPending?: boolean }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  isCancelled: () => boolean,
  onSettled: (lat: number, lng: number) => void,
  // isRetry——內部遞迴呼叫用的旗標,不對外公開:限定最多重試一次,不論
  // 重試那次結果如何(含再次被限流)都不再繼續重試,避免遇到持續限流的
  // 情況時無限延遲下去。
  isRetry = false,
  fetchPhotoAssets?: (placeId: string) => Promise<{ googlePhotoUrls?: string[] }>,
) {
  // retryPhotoOnly——見上方 fetchPhotoAssets 參數的完整說明,遞迴重試
  // 迴圈,只更新 googlePhotoUrls 欄位,不動節點其餘已經確定的資料
  // (name/desc/lat/lng 等在第一次查詢就已經寫入,不該因為照片重試而
  // 重複覆寫或退回舊值)。
  function retryPhotoOnly(remainingRetries: number) {
    if (remainingRetries <= 0 || !fetchPhotoAssets) return
    window.setTimeout(() => {
      if (isCancelled()) return
      fetchPhotoAssets(placeId)
        .then((assets) => {
          if (isCancelled()) return
          if (!hasAnyPhoto(assets)) {
            retryPhotoOnly(remainingRetries - 1)
            return
          }
          setTimeline((prev) => updateNode(prev, stepId, {
            googlePhotoUrls: assets.googlePhotoUrls,
          }))
        })
        // 純讀端點查詢失敗(網路問題等)時,視同這次沒查到圖,不中斷
        // 剩餘重試次數,理由同地圖版 retryWithPhotoAssetsOnly 的完整
        // 說明。
        .catch(() => retryPhotoOnly(remainingRetries - 1))
    }, PHOTO_RETRY_DELAY_MS)
  }

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
        googlePhotoUrls: details.googlePhotoUrls,
        lat: details.lat,
        lng: details.lng,
        placeId,
      }))
      onSettled(details.lat, details.lng)
      // 2026-10 使用者明確要求「全部都用旗標判斷」:改用
      // details.photoRefreshPending(後端這次查詢是否真的觸發了背景
      // 補圖)取代原本的「查無照片就重試」(!hasAnyPhoto(details)),
      // 理由同 photoRetry.ts fetchPlaceDetailsWithPhotoRetry 的完整
      // 說明——沒有觸發補圖時重試注定沒有結果,只是白白發送最多 3 次
      // 沒意義的查詢。
      if (details.photoRefreshPending) {
        retryPhotoOnly(PHOTO_RETRY_MAX_ATTEMPTS)
      }
    })
    .catch((err) => {
      if (isCancelled()) return
      if (!isRetry && isRateLimitedError(err)) {
        // 維持 loading:true(卡片繼續顯示「查詢中」),不提早切回
        // false——3 秒後這個節點若還存在(isCancelled 會在重試回呼裡
        // 再次檢查),才真的觸發第二次查詢。
        window.setTimeout(() => {
          if (isCancelled()) return
          resolveAttractionForStep(stepId, placeId, fetchPlaceDetails, setTimeline, isCancelled, onSettled, true, fetchPhotoAssets)
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
  // 初值改成 loadTimeline(見 plan-core/planTimelineStorage.ts 的完整
  // 說明)——2026-10 使用者明確要求規劃內容要持久化到前端。useSyncedState
  // 接受 lazy initializer,直接傳函式參照即可(只在第一次掛載時執行一次,
  // 不會每次 render 都讀一次 localStorage)。沒存過/資料損毀時 loadTimeline
  // 自己會回傳空時間軸,行為跟原本的 createEmptyTimeline 一致。
  // 初始內容與版次用同一次讀取取得(loadTimelineWithRev),不是分別呼叫
  // loadTimeline() 與 readRev()——後者是兩次獨立的 localStorage 讀取,
  // 理論上另一實例可在兩者之間寫入,於是讀到「舊 timeline + 新 rev」,
  // 這份實例會誤判自己最新、下次寫入直接覆蓋。見該函式的完整說明。
  //
  // 用 ref 保存初值:Strict Mode 會雙重 render,放進 useState/useRef 的
  // initializer 參數會被求值兩次(第二次的結果丟棄),這裡讓它確實只讀
  // 一次。
  const initialRef = useRef<{ timeline: PlanTimeline; rev: number } | null>(null)
  if (initialRef.current === null) initialRef.current = loadTimelineWithRev()
  const [timelineRef, timeline, rawCommitTimeline] = useSyncedState<PlanTimeline>(initialRef.current.timeline)

  // revRef——這個實例手上這份 timeline 對應的持久化版次(見
  // planTimelineStorage.ts 的 PersistedTimeline.rev)。
  //
  // 存在的理由:TripPlanPage 會同時有兩份實例掛載——地圖對話小匡是常駐
  // 掛載的(FloatingPanel 只用 display:none 隱藏,為的是不重建 WebSocket
  // 連線),而切到 /trip-plan 時全頁版也會掛上來。兩份各自在掛載當下
  // 讀一次 localStorage 之後就不再重讀,於是:在全頁版規劃完切回地圖,
  // 小匡那份仍是掛載時的舊內容(常常是空的),它下一次寫入就會把剛剛
  // 規劃好的內容整個蓋掉——實際會遺失使用者資料。
  //
  // 用版次而非 storage 事件:storage 事件只在「其他分頁」觸發,同一個
  // 分頁內的兩份實例互相寫入是收不到的,正好不涵蓋這個情境。
  const revRef = useRef(initialRef.current.rev)

  // commitTimeline——包一層 rawCommitTimeline,在每次「真的有寫入」時
  // 順手存檔。選在這一層攔截而非各個呼叫端自己記得存,理由:時間軸的
  // 所有異動(insertAttractionAfter/setNoteForStop/removeStep/背景查詢
  // 回填 resolveAttractionForStep、refreshTransitForStop 等)最終都經過
  // 這個函式,是唯一能涵蓋全部寫入路徑的單一攔截點——漏接任何一條都會
  // 出現「畫面有、重整後不見」的不一致。
  //
  // 只在 next !== undefined(compute 真的要求寫入)時存檔:insertAfter
  // 驗證失敗那類「算完發現不該寫」的呼叫不會給 next(見 useSyncedState
  // 的完整說明),那種情況 state 沒變,不需要重複存一份一樣的內容。
  //
  // 不動 useSyncedState 本身——那是多處共用的通用 hook,把持久化塞進去
  // 會讓所有使用者都背上這個跟它無關的職責。
  // resyncFromStorage——把另一份實例寫入的較新內容讀回來,並讓版次跟上。
  //
  // 兩個呼叫時機:(a) commitTimeline 寫入前(確保以最新內容為基準計算);
  // (b) 小匡從隱藏轉為可見時(純顯示的情境沒有寫入可攔截——小匡被
  // display:none 隱藏期間使用者在全頁版規劃了幾站,重新顯示時畫面會
  // 一直停在舊內容)。
  //
  // 用 rawCommitTimeline 而非 commitTimeline:這裡的語意是「把磁碟內容
  // 讀進記憶體」,不是「產生新內容」。走 commitTimeline 會把剛讀回來的
  // 東西原封不動寫回去並讓 rev +1,害另一份實例無端判定自己過期、觸發
  // 一次無意義的重讀,兩份實例可能互相推高版次。
  const resyncFromStorage = useCallback(() => {
    const diskRev = readRev()
    if (diskRev <= revRef.current) return
    const { timeline: fresh, rev } = loadTimelineWithRev()
    revRef.current = rev
    rawCommitTimeline<void>(() => ({ next: fresh, result: undefined }))
  }, [rawCommitTimeline])

  const commitTimeline = useCallback(
    <R,>(compute: (current: PlanTimeline) => { next?: PlanTimeline; result: R }): R => {
      // 寫入前先無條件追上磁碟——跟 resyncFromStorage 走同一條路徑,只是
      // 這裡的觸發時機是「即將寫入」。這樣下面的 current 保證已經是最新,
      // 不需要在 compute 內部分「用自己的還是用磁碟的」兩種 base。
      resyncFromStorage()
      return rawCommitTimeline<R>((current) => {
        const outcome = compute(current)
        if (outcome.next !== undefined) {
          const saved = saveTimeline(outcome.next, revRef.current)
          if (saved === null) {
            // 存檔失敗(配額/無痕/localStorage 被停用)。刻意不推進 state:
            // 若讓記憶體套用這次異動而磁碟沒有,版次會宣稱「我跟磁碟一致」,
            // 實際上記憶體多了一筆沒存到的內容——之後另一個實例寫入時,
            // 這份會以它為基準重算,那筆異動就靜默消失了。寧可這次操作
            // 看起來沒生效(使用者會重試),也不要製造一個會在實例間
            // 互相抹掉內容的不一致狀態。
            return { result: outcome.result }
          }
          revRef.current = saved
        }
        return outcome
      })
    },
    [rawCommitTimeline, resyncFromStorage],
  )

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
          false,
          (placeId) => fetchGeoPlacePhotoAssets(cfg, placeId),
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
  // 說明)。正式功能目前沒有任何 UI 入口會直接呼叫這個函式(原型的兩顆
  // 測試按鈕已經整個拿掉),給 onagent 的 remove_attraction 工具使用
  // (見 ctx.removeStep 的完整說明)。
  //
  // 回傳值:true 代表這次呼叫真的有觸發移除(節點存在且尚未在移除中),
  // false 代表節點不存在或已經 removing:true——呼叫端(ctx.removeStep)
  // 據此判斷要不要回報成功給 LLM,不再自己用 getSteps().some() 另外猜測
  // 一次(那樣的外部檢查看不到 removing:true 這個中間狀態,見
  // removeNode/RemoveNodeResult 的完整說明)。這裡呼叫 removeNode 純粹是
  // 為了借用它的「是否存在/是否已在移除中」判斷,實際摘除鏈結的動作仍在
  // 下方 setTimeout 裡才真正發生——這裡只先標記 removing,不把 removeNode
  // 回傳的 timeline 拿來用。
  const removeStep = useCallback((removedId: string): boolean => {
    const check = removeNode(timelineRef.current, removedId)
    if (!check.ok) return false
    setTimeline((prev) => updateNode(prev, removedId, { removing: true }))
    setTimeout(() => {
      const nextId = timelineRef.current.nodes.get(removedId)?.nextId
      setTimeline((prev) => {
        const result = removeNode(prev, removedId)
        return result.ok ? result.timeline : prev
      })
      if (nextId != null) refreshTransitForStop(nextId, cfg, setTimeline, () => timelineRef.current)
    }, REMOVE_FADE_MS)
    return true
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
    resyncFromStorage,
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
  removeStep: (removedId: string) => boolean,
) {
  const apiKey = import.meta.env.VITE_PLAN_AI_ONAGENT_APP_KEY as string | undefined
  const [status, setStatus] = useState<PlanAiChatStatus>('connecting')
  // isThinking——從 sendPrompt 呼叫那一刻開始 true,到收到第一個
  // onAssistantMessage 或 onError 為止轉回 false,接給呼吸點/骨架卡那組
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
  const bridgeRef = useRef<AgentBridge | null>(null)
  const getStepsRef = useRef(getSteps)
  const insertAttractionRef = useRef(insertAttraction)
  const addNoteRef = useRef(addNote)
  const removeStepRef = useRef(removeStep)
  useEffect(() => {
    getStepsRef.current = getSteps
    insertAttractionRef.current = insertAttraction
    addNoteRef.current = addNote
    removeStepRef.current = removeStep
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
      // removeStep——見 AttractionStepsCtx.removeStep 的完整說明:底層
      // removeStep(useTripPlanTimeline)現在回傳 boolean(見該函式的完整
      // 說明),內部用 removeNode 的結構化結果同時判斷「id 不存在」與
      // 「id 已經在移除中(removing:true,淡出動畫播放期間)」兩種情況,
      // 這裡不再自己用 getStepsRef().some() 另外猜測一次——舊寫法只檢查
      // 「是否還是時間軸上的既有節點」,看不到 removing:true 這個中間
      // 狀態,導致動畫播放期間對同一 id 重複呼叫 remove_attraction 都會
      // 誤判成功(見 removeNode/RemoveNodeResult 的完整說明)。
      removeStep: async (id) => {
        const removed = removeStepRef.current(id)
        if (!removed) {
          return {
            ok: false,
            error: { code: 'anchor_not_found', message: `找不到 id 為 "${id}" 的節點,無法移除(可能不存在,或正在移除中)。` },
          }
        }
        return { ok: true }
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
        isThinkingRef.current = false
        setIsThinking(false)
        const steps = getStepsRef.current()
        const lastId = steps.length > 0 ? steps[steps.length - 1].id : null
        const newId = `agent-msg-${crypto.randomUUID()}`
        insertAttractionRef.current(lastId, newId, { type: 'message', text })

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
      },
      onError: (err) => {
        isThinkingRef.current = false
        setIsThinking(false)
        // 跟 onAssistantMessage 一樣要 shift 掉佇列最早一筆——bridge
        // 回呼錯誤代表這次 prompt() 不會再有 assistant_message 進來,
        // 若不清掉,這筆 pending 會永遠卡在佇列最前面,後續每一則真正
        // 收到的回覆都會錯位配對到它(見 pendingChatRef 的完整說明)。
        pendingChatRef.current.shift()
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

  // sendPrompt——送出訊息前先呼叫自家後端 postPlanAiChat(見該函式與
  // server/internal/api/plan_ai_chat.go 的完整說明):後端驗證、
  // rate-limit、存記錄,回傳正規化後的 content。只有這一步成功,才把
  // 「後端回傳的 content」(不是使用者原始輸入)轉發給 onagent——這一步
  // 失敗(429 rate_limited/400 content_too_long 等)時不轉發,改用跟
  // onError 相同的機制(插入一則 message 節點)顯示錯誤,讓使用者看到
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
    // isThinkingRef.current 在這裡同步設成 true,不只靠下面的 setIsThinking
    // 觸發 useEffect 鏡射——state 更新到 effect 真正執行之間有 React
    // 排程/commit 的真實時間差,若只靠 effect 更新 ref,這個時間差就是
    // 併發保護可以被繞過的窗口(兩次幾乎同時的呼叫都會在 ref 還沒追上前
    // 讀到舊值、雙雙通過上面的判斷),等於併發保護本身又重新引入了它原本
    // 要避免的時序依賴。同步寫入才是真正對時序不敏感的第二層防線。
    isThinkingRef.current = true
    setIsThinking(true)
    try {
      const result = await postPlanAiChat(cfg, trimmed, conversationIDRef.current)
      conversationIDRef.current = result.conversationID
      pendingChatRef.current.push(result.messageID)
      bridgeRef.current?.prompt(result.content)
      return true
    } catch (err) {
      isThinkingRef.current = false
      setIsThinking(false)
      const steps = getStepsRef.current()
      const lastId = steps.length > 0 ? steps[steps.length - 1].id : null
      const newId = `agent-msg-${crypto.randomUUID()}`
      // 錯誤文案:ApiError.message 本身就是後端已經給好的繁體中文訊息
      // (例如 rate_limited→「訊息送得太快了,請稍後再試」、
      // content_too_long→「訊息內容過長,最多 500 字」,見
      // handlePlanAiChat 的完整說明),直接顯示即可,不需要自己依 code
      // 重新組文案;非 ApiError(連線層級失敗,例如網路斷線)才用通用的
      // 連線錯誤措辭,對齊既有 onError 的措辭風格。
      const errText = err instanceof ApiError ? err.message : '(訊息送出失敗,請檢查網路連線後再試一次)'
      insertAttractionRef.current(lastId, newId, { type: 'message', text: errText })
      return false
    }
  }, [cfg])

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
  // compact——2026-10 新增:這個元件現在有兩個使用情境,版面需求不同。
  //   - /trip-plan(預設,compact 省略):整頁顯示,捲動權在外層
  //     DesktopMain(unboundedScroll),.page 自己是自然高度。
  //   - 地圖規劃的對話浮動小匡(compact):沒有任何祖先在管捲動,且
  //     FloatingPanel 的 .panel 是 overflow:hidden——.page 必須自己變成
  //     固定高度的 flex 容器、讓時間軸區塊接手捲動,否則內容會一路往下
  //     撐、超出的部分被裁掉且完全捲不動(使用者實際回報的 bug)。
  // 用明確的 prop 而非偵測容器尺寸:呼叫端在渲染當下就知道自己把這個
  // 元件放進哪種容器,不需要執行期量測,理由同 DesktopMain 的 unbounded
  // prop 取代原本 :has() 被動偵測的既有決定。
  compact?: boolean
  // visible——這個實例此刻在畫面上看不看得見。只有 compact(對話小匡)
  // 需要傳:那張小匡是常駐掛載、用 display:none 隱藏的,元件不會因為
  // 「關閉」而卸載,所以無從用掛載時機去重讀持久化內容。
  //
  // 從隱藏轉為可見時,把另一份實例(/trip-plan 全頁版)在這期間寫入的
  // 內容讀回來——否則小匡會一直顯示它掛載當下的舊時間軸(見
  // useTripPlanTimeline 的 resyncFromStorage 與 revRef 的完整說明)。
  // 省略時視為永遠可見,維持原本行為(全頁版靠掛載/卸載就足夠)。
  visible?: boolean
  // scrollContainerRef——2026-10 新增:真正接手捲動的 DOM 節點,取代原本
  // 用 scrollRef.current?.closest('main') 從內部往上爬著猜的做法(見
  // scrollToLatest/handleScroll 的完整說明)。
  //   - /trip-plan 全頁:呼叫端傳入指向 DesktopMain(<main>)的 ref,
  //     捲動權在那個撐滿視窗的外層容器(unboundedScroll)。
  //   - 地圖規劃的對話小匡(compact):不傳——元件內部的 scrollRef
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
  // (/trip-plan 全頁的右上角小地圖已移除,見下方 panToStop 的說明),
  // 兩個使用情境對「點了卡片之後該發生什麼」的答案不同——
  //   - /trip-plan 全頁:沒有地圖可移動,省略這個 prop,行為維持原樣
  //     (只做卡片高亮)。
  //   - 地圖規劃的對話小匡:外面就是整張地圖,傳入後點卡片會把地圖
  //     平移到該站(見 DesktopLayout.tsx 傳入時的完整說明)。
  // 元件自己不 import 任何地圖模組,維持「時間軸就只是時間軸」,不因為
  // 其中一個使用情境多了地圖就把地圖依賴帶進所有情境。
  onPanToStop?: (stop: { lat: number; lng: number }) => void
  // onStopsChange——2026-10 新增:時間軸上「已經查到座標」的站點清單有
  // 變動時回報給呼叫端,讓外層的地圖畫出對應的小圓點(使用者明確要求
  // 「開啟對話若是有安排景點,地圖上出現小圓點」)。
  //
  // 選填,理由同 onPanToStop:/trip-plan 全頁沒有地圖,省略即可。
  //
  // 注意這個元件在對話小匡裡是常駐掛載的(FloatingPanel 只用 display:none
  // 隱藏,見 DesktopLayout.tsx 對那個設計的完整說明——為的是避免每次開關
  // 都重建 WebSocket 連線)。所以小匡「關閉」期間這裡仍會持續回報(AI 還
  // 在串流、背景座標回填都會讓清單變動),呼叫端收到的 state 也不會歸零。
  // 圓點要不要顯示因此完全由呼叫端決定(見 DesktopLayout.tsx 傳給
  // ExploreMap 時的顯示判斷),這個元件不負責那件事。
  //
  // 這些回調不需要穩定的 identity:元件內部已用 useStableCallback 隔離
  // (見下方 reportStops 與 selectStop),呼叫端的函式參照不會進任何
  // 依賴陣列,傳 inline 箭頭函式是安全的。
  onStopsChange?: (stops: { id: string; lat: number; lng: number; name?: string }[]) => void
  // selectedStopId/onSelectedStopChange——目前選中哪一站。三種合法組合:
  //   - 兩個都傳:受控。以 selectedStopId 為準,元件自己不存狀態,每次
  //     使用者點選都呼叫 onSelectedStopChange(地圖對話小匡用這個)。
  //   - 兩個都不傳:非受控,元件用內部 state 自理(/trip-plan 全頁)。
  //   - 只傳 onSelectedStopChange:非受控但通知呼叫端——元件自己管狀態,
  //     呼叫端只是想知道。語意同 <input onChange> 不給 value。
  // (只傳 selectedStopId 不傳 callback 也能跑,但那樣使用者點了沒人處理,
  //  畫面不會有任何反應,實務上沒有意義。)
  //
  // selectedStopId 傳 null 仍算受控——null 是「沒有選任何一站」的合法值,
  // 判斷用 !== undefined 而不是 != null。
  //
  // 2026-10 從「元件自己管理 + 單向上報」改成受控:原本的寫法讓呼叫端
  // (DesktopLayout)另外存一份 selectedPlanStopId 給地圖用,兩份之間只有
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
  // /trip-plan 全頁不傳這兩個 prop,走內部 state,行為與先前相同。
  selectedStopId?: string | null
  onSelectedStopChange?: (id: string | null) => void
  // onHoverStopChange——滑鼠移到站點卡上時回報(移出傳 null),讓地圖把
  // 對應的小圓點加強顯示。不存成這個元件自己的 state 再上報:hover 狀態
  // 在這裡沒有任何用途(卡片本身的 hover 樣式由 CSS :hover 處理,不需要
  // 經過 React),純粹是轉發給呼叫端,多存一份只會造成不必要的重渲染。
  //
  // 注意:這個回調直接接到 PlanTimelineView 的 onHoverStop,「滑鼠離開」
  // 以外的任何方式讓卡片消失都不會補送一次 null——元素被 display:none
  // 隱藏(小匡關閉時就是這樣,見上方 onStopsChange 的說明)不產生
  // onMouseLeave。呼叫端若把它存成 state,需要自己處理這個殘留。
  onHoverStopChange?: (id: string | null) => void
}) {
  const {
    cfg, compact, visible = true, scrollContainerRef, onPanToStop, onStopsChange,
    selectedStopId: controlledSelectedStopId, onSelectedStopChange,
    onHoverStopChange,
  } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)

  const { steps, timelineRef, insertAttractionAfter, setNoteForStop, removeStep, resyncFromStorage } = useTripPlanTimeline(cfg)

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

  const planAiChat = usePlanAiChatBridge(cfg, getStepsForBridge, insertAttractionAfter, addNoteToTimeline, removeStep)
  const [chatInput, setChatInput] = useState('')

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,理由同原型的完整
  // 說明:用 id 而非陣列 index 判斷 justMounted,插入到中間的節點才能
  // 正確觸發進場動畫。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // selectedStopId——目前被點選、卡片套用 .stopCardSelected 高亮樣式的
  // 站點。
  //
  // 受控/非受控雙模式(見上方 props 對這兩個欄位的完整說明):呼叫端傳了
  // selectedStopId 就以它為準(地圖對話小匡,狀態住在 DesktopLayout,
  // 地圖與時間軸共用同一份),沒傳就用這個內部 state(/trip-plan 全頁)。
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

  // mapStops——回報給外層地圖畫小圓點的站點清單(見 onStopsChange 參數的
  // 完整說明)。
  //
  // 只取 type === 'stop' 且已經有座標的節點:section(AI 的敘述文字)
  // 本來就不是地點,而查詢中的 stop 佔位卡要等 resolveAttractionForStep
  // 查完才有 lat/lng,在那之前畫不出來——濾在這裡而不是讓地圖那側判斷,
  // 是因為「哪些節點還沒查到座標」屬於時間軸自己的狀態,不該外流給
  // 只負責畫點的圖層(見 usePlanStopMarkers 對 PlanStopMarker.lat/lng
  // 必填的說明)。
  const mapStops = useMemo(
    () =>
      steps
        .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
        .map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, name: s.name })),
    [steps],
  )

  // 把站點清單往上報。這一個必須走 useEffect(不像選取狀態改成事件驅動,
  // 見下方說明):站點可能由多條路徑變動(agent 的 add_attraction、背景
  // 查詢回填座標、使用者移除節點、重整後從 localStorage 恢復),是資料
  // 變動而非單一使用者動作,沒有一個「事件」可以掛。
  //
  // useStableCallback 包一層,讓依賴陣列只剩真正的資料(mapStops)——呼叫端
  // 若傳 inline 箭頭函式(DesktopLayout 這個檔案的既有風格就是這樣寫,
  // 例如 onPanToStop),每次 render 的新 identity 會讓 effect 重跑 →
  // setState → 父層 render → 又是新 identity,形成無窮迴圈。包過之後
  // 呼叫端傳什麼都安全,不需要依賴「恰好傳了 setState」這個隱性契約。
  const reportStops = useStableCallback((stops: typeof mapStops) => { onStopsChange?.(stops) })
  useEffect(() => {
    reportStops(mapStops)
  }, [mapStops, reportStops])

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
  // useTripPlanTimeline 的 resyncFromStorage 的完整說明。依賴只有 visible:
  // resyncFromStorage 自己會先比對版次,沒有更新就直接 return,重複呼叫
  // 無副作用。
  useEffect(() => {
    if (visible) resyncFromStorage()
  }, [visible, resyncFromStorage])

  const [lightboxPhotos, setLightboxPhotos] = useState<{ photos: string[]; alt: string } | null>(null)

  // panToStop——點擊站點卡:高亮該卡片,並(呼叫端有提供 onPanToStop 時)
  // 請外層把地圖移動到這一站。
  //
  // 2026-10:原本這裡只做選取——/trip-plan 全頁右上角的小地圖移除後,
  // 「pan」這個動作就沒有對象了,函式名稱留著但實際上不再移動任何東西。
  // 現在這個元件嵌進地圖規劃的對話小匡,外面就是整張地圖,名稱重新名實
  // 相符:座標交給呼叫端,由它決定怎麼移動(見 onPanToStop 參數的完整
  // 說明)。
  //
  // 沒有座標的節點直接 return、連高亮都不做——維持既有行為:查詢中的
  // 佔位卡(lat/lng 要等 resolveAttractionForStep 查完才有)點了不該有
  // 任何反應,不是高亮一張還不知道在哪裡的卡片。
  const panToStop = useCallback((step: PlanStep) => {
    if (step.lat == null || step.lng == null) return
    selectStop(step.id)
    onPanToStop?.({ lat: step.lat, lng: step.lng })
  }, [onPanToStop, selectStop])

  // getScroller——「回到最新」整套機制(自動捲到底/跟隨判斷/事件監聽)
  // 共用的捲動容器取得函式。
  //
  // 2026-10 修正(code review 發現的實際 bug):原本三處(scrollToLatest/
  // handleScroll/下方掛原生事件監聽器的 effect)各自寫
  // scrollRef.current?.closest('main'),從 scrollRef(指向 .scroll,見
  // 下方)往上爬,靠「找到的 <main> 就是真正在捲動的那個」這個假設找
  // 捲動容器——這個假設只在 /trip-plan 全頁成立。
  // (2026-10 code review 二次修正:這裡原本誤寫成「地圖規劃的對話
  // 小匡完全沒有 <main> 祖先,closest('main') 永遠回傳 null」——
  // 實際上 FloatingPanel 是 DesktopMain 的子孫,DOM 樹裡確實有
  // <main> 祖先,closest('main') 抓得到它,不是回傳 null。真正的
  // 問題是那個 <main> 的 unboundedScroll 只在 panelMode==='plan-ai'
  // 時才為 true,對話小匡存在的其餘 panelMode 下,這個 <main> 不會
  // 真正接手捲動、scroll 事件不會在它身上觸發——closest('main') 抓到
  // 的是「存在但錯的」捲動容器,不是抓不到。結論跟修法不變:這組
  // 機制(自動捲到底、跟隨判斷、按鈕顯示)在小匡裡一樣會失效,只是
  // 失效的具體原因不是「找不到 main」,而是「找到的 main 不會動」。)
  // 改成優先讀呼叫端傳入的 scrollContainerRef(見該 prop 的完整說明):
  // 全頁版傳 DesktopMain 的 <main> ref,小匡版不傳、fallback 用
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
  // 目前只有 DesktopLayout.tsx 兩處呼叫,全頁版已經正確傳入,若之後
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
  useEffect(() => {
    if (!followingRef.current) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, scrollToLatest])

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
  // 是外層 <main>,小匡版是 .compactScroll 自己——見 getScroller 的完整
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

  // emptyStateMessage/placeholder——對齊原型的既有文案與設計取捨(見該
  // 處的完整說明):漂浮膠囊只留 input 本身,時間軸完全空白時的引導
  // 文字放進主顯示區(.scroll/.inner)當空狀態文案。isGenerating(原型
  // 的模擬腳本生成中狀態)在這裡不存在——正式功能只有 onagent 對話一種
  // 「AI 正在做事」的訊號來源,即 planAiChat.isThinking。
  const emptyStateMessage = '想去哪裡玩？跟我說說你的想法，我可以幫你查景點、安排行程。'
  // isThinking 期間鎖定輸入框(見下方 input/button 的 disabled 與
  // sendPrompt 的完整說明:pendingChatRef 的 FIFO 配對依賴「任何時刻最多
  // 一筆 pending」才成立,AgentBridge 的回呼協議本身不帶 requestId,
  // 允許並發送出會讓佇列配對錯位),文案對齊這個限制,不再鼓勵「隨時
  // 打斷」。
  const placeholder = planAiChat.isThinking ? 'AI 思考中，請稍候…' : '想調整哪裡？'

  // app-theme-root——這裡刻意不掛載:/app 路由本身(App.tsx 的
  // <Route path="/app/:panelMode?">)外層已經透過 KeyboardShrinkGuard
  // 疊加了這個全域 class(見 App.tsx 該處的完整說明),深色模式 token
  // (base-ui.css)已經生效。這個元件是掛在 /app 底下的正式功能頁面,
  // 不像原型 AIPlanTimelinePage.tsx 是完全獨立於 /app 之外的路由
  // (/plan-ai,不經過那層外層 wrapper)——在這裡重複掛一次會變成巢狀
  // 兩層 .app-theme-root,徒增混淆(兩層各自的 data-theme 屬性若不同步
  // 還可能出現不一致的深色模式判斷)。
  return (
    <>
    <div className={compact ? `${styles.page} ${styles.compact}` : styles.page}>
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
          一併從 TripPlanPage.module.css 移除(展示頁 home/plan-ai-sim/
          有自己獨立的一份,不受影響)。 */}
      <PlanTimelineView
        steps={steps}
        isThinking={planAiChat.isThinking}
        emptyStateMessage={emptyStateMessage}
        selectedStopId={selectedStopId}
        showJumpPill={showJumpPill}
        onJumpToLatest={jumpToLatest}
        onPanToStop={panToStop}
        onHoverStop={onHoverStopChange}
        onOpenPhotos={setLightboxPhotos}
        mountedIdsRef={mountedIdsRef}
        scrollRef={scrollRef}
        // compact 模式下讓時間軸區塊自己接手捲動(見 .compactScroll 的
        // 完整說明)——整頁模式維持不傳,捲動權留在外層 DesktopMain。
        scrollClassName={compact ? styles.compactScroll : undefined}
        // compact 模式下改用 absolute 定位覆寫共用元件預設的 sticky
        // (見 .compactJumpPillWrap 的完整說明:sticky 在小匡裡會黏錯
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

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          <form
            className={styles.inputRow}
            onSubmit={(e) => {
              e.preventDefault()
              // isThinking 時直接不處理(即使按鈕已 disabled,form 仍可能
              // 被 Enter 鍵觸發 submit,這裡是跟按鈕 disabled 對齊的第二
              // 道防線,理由同 sendPrompt 內部的併發保護說明)。
              if (!chatInput.trim() || planAiChat.isThinking) return
              // 等 sendPrompt 的結果決定要不要清空輸入框(見該函式回傳值
              // 的完整說明)——不再送出後立刻同步清空,避免後端拒絕
              // (429/400)或網路錯誤時使用者剛打的文字憑空消失。
              const text = chatInput
              void planAiChat.sendPrompt(text).then((sent) => {
                if (sent) setChatInput('')
              })
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
                呼叫通常很快完成,不像模擬腳本會長時間持續推播)。
                isThinking 時額外 disabled(見 sendPrompt 的完整說明):
                UI 層級擋住並發送出,是 sendPrompt 內部併發保護之外的
                第一層防線,避免使用者在等待回覆時又點一次送出。 */}
            <button
              type="submit"
              aria-label="送出"
              className={styles.sendBtn}
              disabled={planAiChat.apiKeyMissing || planAiChat.urlMissing || planAiChat.isThinking}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ios-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
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
