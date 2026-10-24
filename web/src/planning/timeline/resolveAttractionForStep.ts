import { ApiError } from '../../api'
import type { NodeStatus } from './status'
import { updateNode, type PlanTimeline } from './model'

// resolveAttractionForStep(planning/timeline)——「站點的真實地點資料」解析:依 placeId 經資料存取層(PlanAiDataSource.placeDetails)
// 查詢,把名稱、說明、座標寫回時間軸節點(它們是行程資料:list_itinerary、地圖、存檔都需要)。/ai-plan 與登入後
// (planning/panel/TripPlanPage)、行程詳情頁(itineraries)三處共用這一份,站點座標的取得路徑只有一條。
// 原本寫在 TripPlanPage.tsx,2026-10 搬到這裡。
//
// 2026-10:執行狀態與照片搬出節點。
//   - loading/failed 不再寫進節點,改寫進節點狀態表(status.ts)——經 setStatus 回呼,由呼叫端接到
//     usePlanNodeStatus。沒給 setStatus 的呼叫端(行程詳情頁:卡片是唯讀的、不顯示查詢中/失敗)完全不寫狀態。
//   - 照片不再寫回節點:站點卡片用 placeId 從 useResolvedRefs(planning/data/PlanDataProvider.tsx)解析出的表取照片
//     (含「後端還在背景補圖」的重試,見 planning/data/store.ts 的 startPhotoRetry)。所以這裡不再有照片重試,也不需要 fetchPhotoAssets。
//
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
export function isRateLimitedError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.call.status !== 429) return false
  const body = err.call.responseBody as { error?: { code?: string } } | null
  return body?.error?.code === 'rate_limited'
}

// ResolveAttractionOptions——resolveAttractionForStep 的參數(原本是一串位置參數,拿掉照片與重試旗標後改成物件)。
export interface ResolveAttractionOptions {
  stepId: string
  placeId: string
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; lat?: number; lng?: number }>
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>
  // setStatus——選填:寫節點狀態表(usePlanNodeStatus 的 setStatus)。開始查詢時標 { loading: true, failed: false }
  // (卡片立刻回到「查詢中」、清掉上次失敗),成功清掉兩個旗標,失敗標 { loading: false, failed: true }。
  // 429 限流等待重試期間維持 loading。
  setStatus?: (id: string, patch: NodeStatus) => void
  // isCancelled——查詢回來時若節點已被移除、元件已卸載就放棄寫入(競態保護)。重試計時器回呼裡會再檢查一次。
  isCancelled: () => boolean
  // onSettled——插入當下的佔位卡不帶 lat/lng(座標要等這支函式查完才有),交通卡查詢要等這裡查詢完成、座標
  // 確定之後才觸發。只在查到座標時呼叫(沒座標無從估算交通)。
  onSettled: (lat: number, lng: number) => void
  // keepContent——選填:true 時查到的名稱與摘要不覆蓋節點原本的 name/desc,只寫入座標與 placeId;查不到也不標 failed。
  // 行程詳情頁用:站點的名稱與說明是行程作者寫的(例如「古城漫步」對應到的地點叫 Tha Phae Gate),地點資料只負責位置,
  // 查不到只是沒有升級資料,標了 failed 卡片會把作者寫的名稱換成「未能取得地點資料」。
  keepContent?: boolean
  // isRetry——內部遞迴呼叫用的旗標,不對外公開:限定最多重試一次,不論重試那次結果如何(含再次被限流)都不再繼續重試,
  // 避免遇到持續限流的情況時無限延遲下去。
  isRetry?: boolean
}

// resolveAttractionForStep — 站點帶 placeId 時,查詢真實地點資料並寫回節點(單段查詢
// GET /internal/geo/plan-ai/place-details-any,見原型 planning/preview/Content.tsx 同名函式的完整說明),
// 額外加上 429 限流時的單次延遲重試,見 isRateLimitedError 的完整說明。
export function resolveAttractionForStep(opts: ResolveAttractionOptions) {
  const { stepId, placeId, fetchPlaceDetails, setTimeline, setStatus, isCancelled, onSettled, keepContent = false, isRetry = false } = opts

  // 重試入口(使用者按重試、掛載時自動重試)與首次查詢走同一條路,開始時一律標成查詢中並清掉上次的失敗。
  // 第二次(限流後的單次重試)本來就維持 loading,不重複寫。
  if (!isRetry) setStatus?.(stepId, { loading: true, failed: false })

  // markFailed——keepContent(行程詳情頁)不標 failed,只收掉 loading。
  const markFailed = () => setStatus?.(stepId, keepContent ? { loading: false } : { loading: false, failed: true })

  fetchPlaceDetails(placeId)
    .then((details) => {
      if (isCancelled()) return
      if (details.found === false || details.lat == null || details.lng == null) {
        // 查無此地(理論上不該發生,placeId 應該總是有效——來自 search_attraction 查到的候選)——標成失敗,
        // 不留在「查詢中」卡住;沒有座標就無從估算交通時間,不呼叫 onSettled。
        markFailed()
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        ...(keepContent ? {} : { name: details.name, desc: details.summary }),
        lat: details.lat,
        lng: details.lng,
        placeId,
      }))
      // 成功:查詢中與(上一次的)失敗標記一併清掉。
      setStatus?.(stepId, { loading: false, failed: false })
      onSettled(details.lat, details.lng)
    })
    .catch((err) => {
      if (isCancelled()) return
      if (!isRetry && isRateLimitedError(err)) {
        // 維持 loading(卡片繼續顯示「查詢中」),不提早切回——3 秒後這個節點若還存在(isCancelled 會在重試回呼裡
        // 再次檢查),才真的觸發第二次查詢。
        window.setTimeout(() => {
          if (isCancelled()) return
          resolveAttractionForStep({ ...opts, isRetry: true })
        }, RATE_LIMIT_RETRY_DELAY_MS)
        return
      }
      markFailed()
    })
}
