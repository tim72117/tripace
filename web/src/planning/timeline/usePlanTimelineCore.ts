import { useCallback, useEffect, useRef } from 'react'
import { useSyncedState } from '../../hooks/useSyncedState'
import type { PlanAiDataSource } from '../data/source'
import { usePlanNodeStatus } from './usePlanNodeStatus'
import { resolveAttractionForStep } from './resolveAttractionForStep'
import { refreshTransitAround, refreshTransitForStop } from './transit'
import type { AddDayResult, MoveDayWithCountResult, PlanOperations, SetLodgingArgs } from './operations'
// 領域層的 addDay/moveDay/removeLodging 以別名匯入:本 hook 對外的操作方法依 PlanOperations 命名,與它們同名。
import {
  addDay as modelAddDay,
  createEmptyTimeline,
  getNode,
  hasNode,
  insertAfter,
  listNodes,
  moveDay as modelMoveDay,
  nextStopOf,
  removeLodging as modelRemoveLodging,
  removeNode,
  setLodgingByDays,
  stopLookupFailed,
  updateNode,
  type InsertAfterError,
  type LodgingError,
  type LodgingResult,
  type PlanNodeData,
  type PlanTimeline,
  type RemoveNodeError,
  type RemoveNodeResult,
  type SetLodgingByDaysResult,
} from './model'
import type { PlanTimelineStore } from './storage'

// REMOVE_FADE_MS — 兩階段移除的淡出時長。必須跟 PlanTimelineView.module.css 的 .removingFade
// (transition 0.32s)一致:CSS 決定「看起來」的過渡時間,這個常數決定「動畫播完後多久真的把節點摘除」,
// 對不上會出現「畫面還沒淡完節點就消失」或「淡完了節點還占著版面」。(橫向卡片視圖目前沒有淡出樣式,
// 只是延遲這段時間後消失。)TripPlanPage 搬入前仍有自己的一份同值常數。
export const REMOVE_FADE_MS = 320

// HH:MM(00:00~23:59),與 model.ts 內部 isValidTimeFormat 同一個判準(那個函式未匯出)。
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

// SAVE_FAILED_CODE/saveFailedError——有 store 時存檔失敗(saveTimeline 回 null)的結構化錯誤。各包裝方法在這種情況回
// ok:false 帶這個錯誤,呼叫端(planning/conversation/context.ts 的 AI 工具)既有的 ok:false 分支就會如實回報失敗,不會謊稱成功。
// 領域層各結果型別的 code 聯集(model.ts 的 InsertAfterErrorCode/RemoveNodeErrorCode/LodgingErrorCode)目前還沒有
// 'save_failed',這裡以型別斷言帶入(執行期的值是真的);之後把它加進那些聯集即可拿掉斷言。
export const SAVE_FAILED_CODE = 'save_failed'
const SAVE_FAILED_MESSAGE = '行程存檔失敗(可能是瀏覽器儲存空間已滿、無痕模式或儲存被停用),這次變更沒有生效,請稍後再試。'
function saveFailedError<E>(): E {
  return { code: SAVE_FAILED_CODE, message: SAVE_FAILED_MESSAGE } as E
}

// PlanTimelineCoreDataSource——結構相容的最小資料來源:core 只用到地點詳情與交通估算,呼叫端傳完整的資料存取層實例也可以。
export type PlanTimelineCoreDataSource = Pick<PlanAiDataSource, 'placeDetails' | 'transitEstimate'>

// usePlanTimelineCore — 時間軸的「資料層」框架:state、同步提交機制、(選用的)注入式持久化、
// 卸載保護、基本時間軸操作。刻意不碰任何 API、不吃 ClientConfig,也不管對話
// (對話已獨立成 planning/conversation/messages*.ts,2026-10-24 起時間軸這層不知道對話存在)。
//
// 背景:時間軸「改動邏輯」曾有三份實作——本檔(無使用端)、TripPlanPage 內的 useTripPlanTimeline、
// usePlanSimSocket。使用者決定把兩個使用端都收斂到這支 hook(見
// docs/research-timeline-core-comparison-2026-10.md §6 方案 A),分步驟進行:
// 先搭框架(本檔現況)→ 使用端把狀態持有換成它 → 一個方法一個方法搬入 → 最後刪除重複。
//
// 與 PlanTimelineView(純渲染)的分工:那邊負責「把時間軸畫出來」,這邊負責「時間軸怎麼變動」。
// 兩者都不知道訊號來自計時器腳本還是 onagent WebSocket——那是最外層各自的事。
//
// 操作方法的命名與簽章由 operations.ts 的 PlanOperations 約束(回傳型別 PlanTimelineCore 延伸它),AI ctx、模擬態、
// 視圖 props 都用同一組名字。
//
// 目前已提供:commitTimeline、setTimeline、addStop(含插入後的背景查詢預設流程)、
// followUpStop、setStopNote、clearTimeline、removeStopNow、removeStop(兩階段)、setStopTime、
// retryStop(含選用的掛載重試)、resyncFromStorage,以及伴生的節點狀態表
// (nodeStatus/nodeStatusRef/setStatus,見 usePlanNodeStatus)。
//
// 天與住宿操作(addDay/moveDay/setLodging/removeLodging)是
// commitTimeline + 領域函式的薄包裝,AI 的 add_day/move_day/set_lodging/remove_lodging 工具的底層。
// AI ctx 的 assertFreshRead 等把關留在 usePlanAiChatBridge,不進這裡;對話是獨立的 hook(usePlanConversation),
// 由使用端自己組合,core 只提供 onStopInserted 這個接線點讓呼叫端做「新增站點讓舊訊息淡化」。

export interface PlanTimelineCoreOptions {
  // store — 持久化後端(見 storage.ts 的 PlanTimelineStore:localStorage 版、per-draft 版、含 rev 版次)。
  //
  // 沒傳 = 純記憶體:提交路徑完全不經過任何 store(刻意不內部套「不存檔的 store」——存檔回 null
  // 的語意是「存檔失敗不推進 state」,會讓記憶體時間軸永遠不更新,即研究筆記的 D11;該 noop store 已刪除)。
  // 模擬展示(/ai-plan 的自動播放腳本)就該是這種模式,不能污染使用者在正式功能排好的草稿。
  //
  // 傳了 = 初值由 store.loadTimelineWithRev() 讀回,每次提交前先追上磁碟(多實例 rev 同步),
  // 存檔失敗(回 null)時不推進記憶體 state。
  //
  // 只在掛載時決定一次:要換 store(例如切換草稿)請用 key 讓元件重新掛載,與 TripPlanPage 現況一致。
  // 內部以 ref 持有最新的 store,所以呼叫端每次 render 傳新物件也不會讓回傳的函式換參照。
  store?: PlanTimelineStore
  // dataSource — 地點詳情/交通估算的存取層(真 API 或假資料,見 planning/data/source.ts)。省略 = 不做任何背景查詢
  // (插入只是純本地運算)。用 ref 持有最新值:換 dataSource 不會讓回傳的函式換參照,也不會有舊閉包打到舊的存取層。
  dataSource?: PlanTimelineCoreDataSource
  // needsLookup — 插入/補資料後,這個節點是否要向 dataSource 反查地點資料(resolveAttractionForStep)。
  // 預設:有 placeId 但沒座標(add_attraction 只給 placeId 的佔位卡,對齊 TripPlanPage)。
  // 模擬態傳 (d) => !!d.placeId:劇本的站點自帶座標,但仍要走一次查詢呈現「AI 查地點」的過程。
  // 不需要反查、但有座標時,改為直接重算交通。
  needsLookup?: (data: PlanNodeData) => boolean
  // onStopInserted — 每一個「成功插入」的 stop 節點都會觸發(契約如下):
  //   - 觸發對象是所有成功插入的 stop,包含骨架節點(無 placeId、無座標的佔位卡)。
  //     插入失敗(anchor 不存在、時間不合法)不觸發。
  //   - 順序:commit 完成 → 預設的插入後流程(有 dataSource 才有:反查地點或重算交通,見 followUpStop)→ 這個回呼。
  //     回呼內讀 timelineRef 一定看得到剛插入的節點。
  //   - 這是呼叫端的接線點:對話淡化(staleAll,話題推進、舊訊息淡化)放這裡;core 不知道對話存在。
  //   - 呼叫是同步的,回呼內丟例外會讓 addStop 往外丟(插入本身已生效)。
  onStopInserted?: (id: string, data: PlanNodeData) => void
  // onBeforeMutate — removeStop/setStopTime 在「即將讓時間軸/狀態變動」前同步呼叫(removeStop 兩次:標 removing 當下、
  // 淡出後摘除當下)。TripPlanPage 用它設 suppressAutoScrollRef(這次變動不是新內容,不要自動捲到最新);
  // 不需要的使用端(模擬態)不傳。
  onBeforeMutate?: () => void
  // removeFadeMs — removeStop 的淡出時長,預設 REMOVE_FADE_MS(與 CSS 同值)。測試或不同視圖要不同節奏時才傳。
  removeFadeMs?: number
  // retryFailedOnMount — 掛載後自動重查「沒拿到地點資料」的站點(stopLookupFailed:有 placeId 但沒座標),只跑一次。
  // 因為節點狀態表不持久化,重整後 failed 旗標沒了,靠資料本身判斷。需要持久化(store)的使用端(TripPlanPage)開;
  // 純記憶體的模擬態不需要(重整即清空),預設關。沒有 dataSource 時不會作用。
  retryFailedOnMount?: boolean
}

// PlanTimelineCore——usePlanTimelineCore 的回傳型別:操作方法(addStop/removeStop/setStopTime…)由 PlanOperations 約束
// (見 operations.ts:各層同名、簽章以這裡為準),其餘是狀態、節點狀態表與 core 專屬的低階入口。
type SyncedTimeline = ReturnType<typeof useSyncedState<PlanTimeline>>
type NodeStatusApi = ReturnType<typeof usePlanNodeStatus>
export interface PlanTimelineCore extends PlanOperations {
  timeline: PlanTimeline
  timelineRef: SyncedTimeline[0]
  // nodeStatus/nodeStatusRef/setStatus — 節點執行狀態表及其寫入函式(見 usePlanNodeStatus)。
  nodeStatus: NodeStatusApi['nodeStatus']
  nodeStatusRef: NodeStatusApi['nodeStatusRef']
  setStatus: NodeStatusApi['setStatus']
  commitTimeline: <R>(
    compute: (current: PlanTimeline) => { next?: PlanTimeline; result: R },
    onSaveFailed?: (result: R, current: PlanTimeline) => R,
  ) => R
  setTimeline: (updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => void
  followUpStop: (id: string, data: PlanNodeData) => void
  clearTimeline: () => void
  // removeStopNow——removeStop 的第二階段(同步摘除、無淡出),不在 PlanOperations:UI/AI 一律走兩階段的 removeStop。
  removeStopNow: (id: string) => RemoveNodeResult
  resyncFromStorage: () => void
}

export function usePlanTimelineCore(options: PlanTimelineCoreOptions = {}): PlanTimelineCore {
  const { store, onStopInserted, retryFailedOnMount = false } = options

  // 用 ref 持有最新的 store、dataSource 與回呼:避免呼叫端每次 render 的新參照讓下面的 useCallback 全部換新
  // (它們會往下傳給視圖元件),同時讓非同步回呼永遠用最新的存取層(TripPlanPage 曾因閉包捕捉掛載時那一份而踩過 stale closure)。
  // 理由同 hooks/useStableCallback.ts(地圖等處既有的用法)。
  const storeRef = useRef(store)
  storeRef.current = store
  const onStopInsertedRef = useRef(onStopInserted)
  onStopInsertedRef.current = onStopInserted
  const dataSourceRef = useRef(options.dataSource)
  dataSourceRef.current = options.dataSource
  const needsLookupRef = useRef(options.needsLookup)
  needsLookupRef.current = options.needsLookup
  const onBeforeMutateRef = useRef(options.onBeforeMutate)
  onBeforeMutateRef.current = options.onBeforeMutate
  const removeFadeMsRef = useRef(options.removeFadeMs ?? REMOVE_FADE_MS)
  removeFadeMsRef.current = options.removeFadeMs ?? REMOVE_FADE_MS

  // 初值:有 store 時讀回(內容與版次用同一次讀取,見 loadTimelineWithRev 的說明),否則空時間軸。
  // 用 ref 保存只是讓後續 render 不再重讀。Strict Mode 初次掛載會雙重 render,第二次 render 會重新初始化
  // ref,所以這裡實際會讀兩次、第二份被丟棄(無害:讀取沒有副作用,且兩次結果相同)。
  const initialRef = useRef<{ timeline: PlanTimeline; rev: number } | null>(null)
  if (initialRef.current === null) {
    initialRef.current = store ? store.loadTimelineWithRev() : { timeline: createEmptyTimeline(), rev: 0 }
  }

  const [timelineRef, timeline, rawCommitTimeline] = useSyncedState<PlanTimeline>(initialRef.current.timeline)
  // revRef — 這個實例手上這份對應的持久化版次;沒有 store 時不會用到。
  const revRef = useRef(initialRef.current.rev)

  // mountedRef — 供背景查詢(地點補查的 429 延遲重試、removeStop 的淡出計時器)判斷「元件是否已卸載」。
  // 只檢查節點是否還在時間軸沒辦法涵蓋卸載:卸載後 timelineRef 不會被清空,節點依然「存在」。
  // Strict Mode 的 mount → cleanup → mount 會讓它先 false 再回 true,最終維持 true。
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // isUnmounted——給 refreshTransit 的 isCancelled:交通估算回來時元件已卸載(例如 /ai-plan「新行程」用 key 重新掛載),
  // 就不再寫入,避免舊實例把結果寫進舊 store。
  const isUnmounted = useCallback(() => !mountedRef.current, [])

  // resyncFromStorage — 把另一個實例寫入的較新內容讀回來。沒有 store 時什麼都不做。
  //
  // 兩個呼叫時機:(a) commitTimeline 寫入前,確保以最新內容為基準;(b) 面板從隱藏轉可見時
  // (純顯示的情境沒有寫入可攔截)。用 rawCommitTimeline 而非 commitTimeline:語意是「把磁碟讀進記憶體」,
  // 走 commitTimeline 會原封不動寫回並讓 rev +1,害另一個實例無端判定過期、兩邊互相推高版次。
  const resyncFromStorage = useCallback(() => {
    const s = storeRef.current
    if (!s) return
    if (s.readRev() <= revRef.current) return
    const { timeline: fresh, rev } = s.loadTimelineWithRev()
    revRef.current = rev
    rawCommitTimeline<void>(() => ({ next: fresh, result: undefined }))
  }, [rawCommitTimeline])

  // commitTimeline — 所有寫入的單一攔截點,順手處理持久化。
  //
  // 同步:compute(current) → { next?, result },回傳 result。timelineRef 隨之同步更新(useSyncedState 保證),
  // 所以同一個 tick 連續兩次 commit,第二次一定讀得到第一次的結果,不會有「setState 完立刻讀」的時序問題。
  // next 不給 = 不寫入(例如 insertAfter 驗證失敗)。
  //
  // 有 store:寫入前先追上磁碟;存檔失敗(回 null:配額/無痕/停用)時刻意不推進 state——若讓記憶體套用
  // 而磁碟沒有,版次會謊稱一致,之後被另一個實例靜默抹掉。寧可這次操作沒生效讓使用者重試。
  // 無 store:純記憶體,直接套用。
  //
  // onSaveFailed(選填)——存檔失敗時把 compute 的 result 換成「反映失敗」的版本(第二個參數是沒被改動的當下時間軸)。
  // 不傳就原樣回傳 compute 的 result:這時呼叫端拿到的 result 可能是 ok:true,卻其實沒生效——所以凡是結果會往外回報
  // (AI 工具、需要據此決定後續動作)的包裝方法都要傳,本檔的 addStop/天與住宿操作等皆已處理。
  const commitTimeline = useCallback(
    <R,>(
      compute: (current: PlanTimeline) => { next?: PlanTimeline; result: R },
      onSaveFailed?: (result: R, current: PlanTimeline) => R,
    ): R => {
      const s = storeRef.current
      if (!s) return rawCommitTimeline<R>(compute)
      resyncFromStorage()
      return rawCommitTimeline<R>((current) => {
        const outcome = compute(current)
        if (outcome.next !== undefined) {
          const saved = s.saveTimeline(outcome.next, revRef.current)
          if (saved === null) return { result: onSaveFailed ? onSaveFailed(outcome.result, current) : outcome.result }
          revRef.current = saved
        }
        return outcome
      })
    },
    [rawCommitTimeline, resyncFromStorage],
  )

  // setTimeline — 給「注入式 state 更新」用(背景查詢回填、交通估算寫回等收到 setState 風格 updater 的函式)。
  // 一律走 commitTimeline,所以也會持久化。
  const setTimeline = useCallback(
    (updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => {
      commitTimeline((current) => ({
        next: typeof updater === 'function' ? (updater as (prev: PlanTimeline) => PlanTimeline)(current) : updater,
        result: undefined,
      }))
    },
    [commitTimeline],
  )

  // nodeStatus — 節點執行狀態表(loading/failed/removing,不持久化),時間軸的伴生狀態,所以由 core 組合。
  // 修剪(節點消失就丟掉對應狀態)由 usePlanNodeStatus 內部負責。
  const { nodeStatus, nodeStatusRef, setStatus } = usePlanNodeStatus(timeline, timelineRef)

  // isStopGone — 背景查詢的競態保護:元件已卸載、或節點已不在時間軸,就放棄寫入。
  const isStopGone = useCallback(
    (id: string) => !mountedRef.current || !hasNode(timelineRef.current, id),
    [timelineRef],
  )

  // followUpStop — 「某個 stop 的資料剛寫進時間軸(插入,或呼叫端原地補資料)」之後的背景流程:
  //   1. needsLookup(預設:有 placeId 且沒座標)→ resolveAttractionForStep 反查地點(開始時在狀態表標 loading,
  //      成功寫回名稱/說明/座標,座標落地後 refreshTransitAround 連同下一站一起重算交通);
  //   2. 否則有座標 → 直接 refreshTransitAround(自己與下一站一起重算,理由見該處註解);
  //   3. 否則什麼都不查,順手把狀態表的 loading 收掉(骨架卡原地補成完整資料時需要;插入新節點時本來就沒有 loading,是 no-op)。
  // 沒有 dataSource 時整段略過。故意不 await、不影響呼叫端回傳值:插入本身立即返回,查詢延遲只體現在卡片從佔位轉成完整內容。
  // 匯出給「繞過 addStop 原地補資料」的呼叫端(模擬態的骨架卡轉正式站點)重用同一段流程。
  const followUpStop = useCallback(
    (id: string, data: PlanNodeData) => {
      const ds = dataSourceRef.current
      if (!ds || data.type !== 'stop') return
      const needsLookup = needsLookupRef.current ?? ((d: PlanNodeData) => !!d.placeId && d.lat == null)
      if (data.placeId && needsLookup(data)) {
        resolveAttractionForStep({
          stepId: id,
          placeId: data.placeId,
          fetchPlaceDetails: (placeId) => dataSourceRef.current!.placeDetails(placeId),
          setTimeline,
          setStatus,
          // 429 限流的 3 秒延遲重試期間,節點可能已被移除、或元件已卸載,不該再多打一次沒有消費者的 API。
          isCancelled: () => isStopGone(id),
          // 佔位卡一開始沒座標,等查完座標確定才算交通;refreshTransitAround 自己重讀節點座標,這裡只借「查完了」的時機。
          onSettled: () =>
            refreshTransitAround({
              stopId: id,
              dataSource: dataSourceRef.current!,
              setTimeline,
              getTimeline: () => timelineRef.current,
              isCancelled: isUnmounted,
            }),
        })
        return
      }
      setStatus(id, { loading: false })
      if (data.lat != null && data.lng != null) {
        // 用 refreshTransitAround 而非只算自己:插入到兩站之間時 insertAfter 已清掉下一站的 transitFromPrev
        // (它的上一站變成新站),只算自己會讓「新站→下一站」那段永遠缺著(地圖線也跟著消失)。與上面反查成功路徑一致。
        refreshTransitAround({ stopId: id, dataSource: ds, setTimeline, getTimeline: () => timelineRef.current, isCancelled: isUnmounted })
      }
    },
    [setTimeline, setStatus, isStopGone, isUnmounted, timelineRef],
  )

  // addStop — 在 anchorId 之後插入一個節點。成功才進入插入後流程:
  // 預設背景查詢(followUpStop,有 dataSource 才有)→ onStopInserted(契約見該選項)。
  // 純粹是時間軸操作;新增景點讓舊訊息淡化是對話的事,由呼叫端經 onStopInserted 自己處理。
  const addStop = useCallback(
    (anchorId: string | null, newId: string, data: PlanNodeData): ReturnType<typeof insertAfter> => {
      const result = commitTimeline<ReturnType<typeof insertAfter>>(
        (current) => {
          const inserted = insertAfter(current, anchorId, data, newId)
          if (!inserted.ok) return { result: inserted }
          return { next: inserted.timeline, result: inserted }
        },
        // 存檔失敗:節點沒進時間軸,回 ok:false,下面的背景查詢與 onStopInserted 也就不會跑。
        () => ({ ok: false, error: saveFailedError<InsertAfterError>() }),
      )
      // 刻意在 commit 完成之後才呼叫:插入本身是純本地運算、立即返回,不該被背景查詢拖住。
      if (result.ok && data.type === 'stop') {
        followUpStop(newId, data)
        onStopInsertedRef.current?.(newId, data)
      }
      return result
    },
    [commitTimeline, followUpStop],
  )

  // retryStop — 重新查詢某一站的地點資料(使用者點卡片的「重試」、掛載後自動重試共用)。
  // 走跟插入當下完全相同的 resolveAttractionForStep(含 429 單次延遲重試),開始時它會在狀態表標
  // { loading: true, failed: false },卡片立刻回到「查詢中」。沒有 dataSource、節點不存在/不是 stop/沒 placeId 時不做事。
  const retryStop = useCallback(
    (stopId: string) => {
      const ds = dataSourceRef.current
      const node = getNode(timelineRef.current, stopId)
      if (!ds || !node || node.type !== 'stop' || !node.placeId) return
      resolveAttractionForStep({
        stepId: stopId,
        placeId: node.placeId,
        fetchPlaceDetails: (placeId) => dataSourceRef.current!.placeDetails(placeId),
        setTimeline,
        setStatus,
        isCancelled: () => isStopGone(stopId),
        onSettled: () =>
          refreshTransitAround({
            stopId,
            dataSource: dataSourceRef.current!,
            setTimeline,
            getTimeline: () => timelineRef.current,
            isCancelled: isUnmounted,
          }),
      })
    },
    [setTimeline, setStatus, isStopGone, isUnmounted, timelineRef],
  )

  // replaceStop — 換地點(見 PlanOperations.replaceStop)。節點原地更新、不經過 removeStop/addStop,所以 id、順序、時間不變,
  // 也沒有淡出/插入動畫;之後走 followUpStop(placeId 有值且沒座標 → 反查地點、落地後重算交通)。
  const replaceStop = useCallback(
    (stopId: string, place: { placeId: string; name?: string }): boolean => {
      const node = getNode(timelineRef.current, stopId)
      if (!node || node.type !== 'stop' || !place.placeId) return false
      onBeforeMutateRef.current?.()
      const patch: Partial<PlanNodeData> = {
        placeId: place.placeId,
        name: place.name,
        desc: undefined,
        lat: undefined,
        lng: undefined,
        transitFromPrev: undefined,
        tags: undefined,
        thumbBg: undefined,
        thumbIcon: undefined,
        // 主題點/候選卡底下的子景點屬於舊地點,換地點後不該留著。
        attractions: undefined,
        places: undefined,
      }
      const committed = commitTimeline<boolean>(
        (current) => ({ next: updateNode(current, stopId, patch), result: true }),
        () => false,
      )
      if (!committed) return false
      // 下一站的交通是以舊座標算的,先清掉,座標落地後由 refreshTransitAround 重算(連同下一站)。
      const next = nextStopOf(timelineRef.current, stopId)
      if (next) setTimeline((prev) => updateNode(prev, next.id, { transitFromPrev: undefined }))
      const updated = getNode(timelineRef.current, stopId)
      if (updated) followUpStop(stopId, updated)
      return true
    },
    [commitTimeline, followUpStop, setTimeline, timelineRef],
  )

  // 掛載後自動重試(選項 retryFailedOnMount):空依賴、只跑一次——是「掛載時的補救」不是持續監看,
  // 否則一個持續失敗的站點會變成無限重試迴圈。Strict Mode 的二次 effect 以 ref 擋下。
  const retriedOnMountRef = useRef(false)
  useEffect(() => {
    if (!retryFailedOnMount || retriedOnMountRef.current) return
    retriedOnMountRef.current = true
    for (const node of listNodes(timelineRef.current)) {
      if (stopLookupFailed(node, nodeStatusRef.current.get(node.id))) retryStop(node.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // setStopNote — 把備註寫在既有節點自己身上(不是插入新節點)。找不到節點回 anchor_not_found。
  // 分類 fallback(例如預設 info)屬於呼叫端的決定,這裡原樣寫入。
  const setStopNote = useCallback(
    (anchorId: string, text: string, category: string | undefined): ReturnType<typeof insertAfter> => {
      return commitTimeline<ReturnType<typeof insertAfter>>(
        (current) => {
          if (!hasNode(current, anchorId)) {
            return {
              result: {
                ok: false,
                error: { code: 'anchor_not_found', message: `找不到 id 為 "${anchorId}" 的節點,無法在它身上寫入備註。` },
              },
            }
          }
          const next = updateNode(current, anchorId, { note: { text, category } })
          return { next, result: { ok: true, timeline: next, insertedId: anchorId } }
        },
        () => ({ ok: false, error: saveFailedError<InsertAfterError>() }),
      )
    },
    [commitTimeline],
  )

  // removeStopNow — 同步摘除節點,不含淡出動畫。
  // 是兩階段 removeStop 的第二階段:第一階段標 removing(節點狀態表)、淡出結束後呼叫這支真正摘除。
  // 找不到節點、或有 store 時存檔失敗(code save_failed)回 { ok: false }(state 不變)。
  const removeStopNow = useCallback(
    (id: string): ReturnType<typeof removeNode> => {
      return commitTimeline<ReturnType<typeof removeNode>>(
        (current) => {
          const removed = removeNode(current, id)
          if (!removed.ok) return { result: removed }
          return { next: removed.timeline, result: removed }
        },
        () => ({ ok: false, error: saveFailedError<RemoveNodeError>() }),
      )
    },
    [commitTimeline],
  )

  // clearTimeline — 清空成空時間軸(有 store 時連持久化內容一併覆寫成空)。
  // 存在的理由是「模擬交接給真實 AI」:交接時要清掉展示用的站點,不能讓使用者以為那些是自己排的。
  const clearTimeline = useCallback(() => {
    commitTimeline(() => ({ next: createEmptyTimeline(), result: undefined }))
  }, [commitTimeline])

  // removeStop — 移除節點的兩階段流程:先在狀態表標 removing 觸發 CSS 淡出,等 removeFadeMs 後才真的摘除
  // (removeStopNow 的同步摘除是第二階段),摘除後補算下一站的交通(它的上一站變了,removeNode 已清掉舊的
  // transitFromPrev,這裡重查新的兩站之間)。
  //
  // 回傳 true = 這次呼叫真的觸發了移除;false = 節點不存在,或狀態表已標 removing(淡出期間重複呼叫擋下)。
  // 呼叫端(AI 的 remove_attraction 工具)據此決定要不要回報成功。
  // 劇本型呼叫端不在乎回傳值,重複指示被擋下正是想要的語意。
  //
  // 競態保護(計時器回呼觸發時重新檢查):
  //   - 元件已卸載 → 放棄(原 TripPlanPage 沒有這道保護,卸載後仍會寫 store,即研究筆記 D3);
  //   - 狀態表已不再標 removing → 放棄。節點在淡出期間被別的路徑移除或時間軸被 reset 清空時,狀態會被修剪掉;
  //     reset 後劇本以同一個 id 重播時,若不擋,舊計時器會誤殺新節點。
  // onBeforeMutate 在兩個時間點都會呼叫(標 removing 當下、摘除當下):這兩次更新各自會讓畫面重算一次,
  // 呼叫端的自動捲動 effect 就會跑兩次,兩次都要告訴它「這不是新內容」。
  const removeStop = useCallback(
    (removedId: string): boolean => {
      if (!hasNode(timelineRef.current, removedId)) return false
      if (nodeStatusRef.current.get(removedId)?.removing) return false
      onBeforeMutateRef.current?.()
      setStatus(removedId, { removing: true })
      window.setTimeout(() => {
        if (!mountedRef.current) return
        if (!nodeStatusRef.current.get(removedId)?.removing) return
        const nextId = nextStopOf(timelineRef.current, removedId)?.id
        onBeforeMutateRef.current?.()
        const removed = removeStopNow(removedId)
        if (!removed.ok) {
          // 摘除沒生效(有 store 時存檔失敗):節點還在時間軸,必須收掉 removing,否則它會一直維持淡出後看不見、
          // 又因「已在移除中」被擋下而移不掉的狀態。收掉後使用者/AI 可以再試一次。
          setStatus(removedId, { removing: false })
          return
        }
        // 成功時狀態表的 removing 由 usePlanNodeStatus 在節點消失後修剪掉,這裡不用另外清。
        const ds = dataSourceRef.current
        if (nextId != null && ds) {
          refreshTransitForStop({ stopId: nextId, dataSource: ds, setTimeline, getTimeline: () => timelineRef.current, isCancelled: isUnmounted })
        }
      }, removeFadeMsRef.current)
      return true
    },
    [nodeStatusRef, removeStopNow, setStatus, setTimeline, isUnmounted, timelineRef],
  )

  // setStopTime — 時間軸小圓點拖拉後「真正提交」某一站的新時間。拖拉中的即時預覽、clamp 在合法範圍、
  // 吸附 30 分鐘刻度都在視圖的拖拉手勢裡完成,這裡不重複檢查前後站的範圍(拖拉中範圍不變,呼叫端手勢層負責在外部變動時
  // 結束手勢);只擋「格式不是 HH:MM」與「節點不存在/不是 stop」這兩種防禦性情況,回傳 false(有 store 時存檔失敗也回 false)。
  // 寫入後這一站與前一站的交通重新估算(同其他「前一站關聯有變動就重查」的慣例,沒有 dataSource 則略過)。
  // onBeforeMutate 在寫入前呼叫(TripPlanPage 用來抑制自動捲動)。
  const setStopTime = useCallback(
    (stopId: string, newTime: string): boolean => {
      const node = getNode(timelineRef.current, stopId)
      if (!node || node.type !== 'stop' || !TIME_PATTERN.test(newTime)) return false
      onBeforeMutateRef.current?.()
      const committed = commitTimeline<boolean>(
        (current) => ({ next: updateNode(current, stopId, { time: newTime }), result: true }),
        () => false,
      )
      // 存檔失敗:時間沒寫入,回 false,也不必重算交通。
      if (!committed) return false
      const ds = dataSourceRef.current
      if (ds) refreshTransitForStop({ stopId, dataSource: ds, setTimeline, getTimeline: () => timelineRef.current, isCancelled: isUnmounted })
      return true
    },
    [commitTimeline, setTimeline, isUnmounted, timelineRef],
  )

  // addDay/moveDay——天的操作(領域層 modelAddDay/modelMoveDay 的薄包裝,即 model.ts 的 addDay/moveDay)。走 commitTimeline(有 store 時寫入前追上磁碟、存檔失敗不推進記憶體),
  // 用的是「當下最新」的時間軸而不是呼叫端(AI)讀到的舊快照。atDay 不合法或 moveDay 超出範圍時不改動並回傳錯誤;
// 存檔失敗同樣回 ok:false(code save_failed),住宿操作亦同。
  const addDay = useCallback(
    (atDay: number | undefined): AddDayResult => {
      return commitTimeline<AddDayResult>(
        (current) => {
          const added = modelAddDay(current, atDay)
          if (!added.ok) return { result: { ok: false, error: added.error } }
          return { next: added.timeline, result: { ok: true, day: added.day, dayCount: added.timeline.days.length } }
        },
        () => ({ ok: false, error: saveFailedError<{ message: string }>() }),
      )
    },
    [commitTimeline],
  )
  const moveDay = useCallback(
    (fromDay: number, toDay: number): MoveDayWithCountResult => {
      return commitTimeline<MoveDayWithCountResult>(
        (current) => {
          const moved = modelMoveDay(current, fromDay, toDay)
          if (!moved.ok) return { result: { ...moved, dayCount: current.days.length } }
          return { next: moved.timeline, result: { ...moved, dayCount: moved.timeline.days.length } }
        },
        (_result, current) => ({ ok: false, error: saveFailedError<{ message: string }>(), dayCount: current.days.length }),
      )
    },
    [commitTimeline],
  )

  // setLodging/removeLodging——住宿操作。天數轉天 id 與 upsert 在領域層 setLodgingByDays;失敗時不改動。
  const setLodging = useCallback(
    (args: SetLodgingArgs): SetLodgingByDaysResult => {
      return commitTimeline<SetLodgingByDaysResult>(
        (current) => {
          const result = setLodgingByDays(current, args)
          return result.ok ? { next: result.timeline, result } : { result }
        },
        () => ({ ok: false, error: saveFailedError<LodgingError>() }),
      )
    },
    [commitTimeline],
  )
  const removeLodging = useCallback(
    (lodgingId: string): LodgingResult => {
      return commitTimeline<LodgingResult>(
        (current) => {
          const result = modelRemoveLodging(current, lodgingId)
          return result.ok ? { next: result.timeline, result } : { result }
        },
        () => ({ ok: false, error: saveFailedError<LodgingError>() }),
      )
    },
    [commitTimeline],
  )

  return {
    timeline,
    timelineRef,
    // nodeStatus/nodeStatusRef/setStatus — 節點執行狀態表及其寫入函式(見 usePlanNodeStatus)。
    nodeStatus,
    nodeStatusRef,
    setStatus,
    commitTimeline,
    setTimeline,
    addStop,
    followUpStop,
    setStopNote,
    clearTimeline,
    removeStopNow,
    removeStop,
    setStopTime,
    retryStop,
    replaceStop,
    addDay,
    moveDay,
    setLodging,
    removeLodging,
    resyncFromStorage,
  }
}
