import { ApiError } from '../api'
import { hasAnyPhoto, PHOTO_RETRY_DELAY_MS, PHOTO_RETRY_MAX_ATTEMPTS } from '../photoRetry'
import { updateNode, type PlanTimeline } from './planTimeline'

// resolveAttractionForStep(plan-core)——「站點的真實地點資料」解析:依 placeId 經資料存取層(PlanAiDataSource.placeDetails)
// 查詢,把名稱、座標、摘要、照片寫回時間軸節點。/ai-plan 與登入後(trip-plan/TripPlanPage)、行程詳情頁(itineraries)
// 三處共用這一份,站點座標的取得路徑只有一條。原本寫在 TripPlanPage.tsx,2026-10 搬到這裡。
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
// home/plan-ai-sim/Content.tsx 同名函式的完整說明,邏輯原封不動搬過來,額外
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
export function resolveAttractionForStep(
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
  // keepContent——選填:true 時查到的名稱與摘要不覆蓋節點原本的 name/desc,只寫入座標、照片與 placeId。行程詳情頁用:
  // 站點的名稱與說明是行程作者寫的(例如「古城漫步」對應到的地點叫 Tha Phae Gate),地點資料只負責位置與照片。
  keepContent = false,
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
        // keepContent(行程詳情頁):節點本來就有完整的靜態內容,查不到只是沒有升級資料,不標 failed——標了卡片會把
        // 作者寫的名稱換成「未能取得地點資料」。
        if (!keepContent) setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
        // failed 明確清掉——這次(可能是重試)成功了,節點不該還留著
        // 上一次的失敗標記。
        failed: false,
        ...(keepContent ? {} : { name: details.name, desc: details.summary }),
        // keepContent 時查無照片不覆蓋行程原本寫的靜態 photos(undefined 會把它蓋掉)。
        ...(keepContent && !details.googlePhotoUrls?.length ? {} : { googlePhotoUrls: details.googlePhotoUrls }),
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
          resolveAttractionForStep(stepId, placeId, fetchPlaceDetails, setTimeline, isCancelled, onSettled, true, fetchPhotoAssets, keepContent)
        }, RATE_LIMIT_RETRY_DELAY_MS)
        return
      }
      if (!keepContent) setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
    })
}

