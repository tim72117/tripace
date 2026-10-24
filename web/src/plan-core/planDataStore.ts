import type { PlanAiDataSource } from './dataSource'
import { hasAnyPhoto, PHOTO_RETRY_DELAY_MS, PHOTO_RETRY_MAX_ATTEMPTS } from '../photoRetry'
import type { PlanThemeChild } from './planTimeline'

// planDataStore(plan-core)——「識別碼 → 名稱/座標/摘要/照片」的唯一資料來源,一個資料存取層實例對應一個 store,
// 全應用共用。
//
// 為什麼有這一層(2026-10):節點只存 id(PlanNodeData.attractions / places、站點 placeId、旅館 placeId),
// 顯示用的資料一律執行時用 id 查。原本這條路徑有三層生命週期不同的快取(資料存取層的去重快取 TTL 5 分鐘、
// useResolvedNodeRefs 模組層無期限的 promise 快取、每個 hook 實例各自的 state),同一頁又有五六個解析實例,
// 「失敗」也有好幾種表示(failedChildren WeakSet、節點狀態表、「有 placeId 沒座標」的判準),靠 settledKey 這種
// 暗號勾在一起。現在把資料來源往根部移:所有消費方(時間軸、地圖投影、行程詳情頁)向同一個 store 取同一份資料,
// 同一個 id 同頁只查一次、只有一份狀態。
//
// 與資料存取層去重快取(placeDetailsDedupe)的分工:去重快取在「請求層」避免同一個 placeId 短時間重複打後端
// (含詢問頁等不經 store 的呼叫端);store 在「資料層」記住每個 id 的結果狀態(pending / ok / failed)給所有畫面共用。
// 成功期限與去重快取對齊(PLAN_DATA_TTL_MS = PLACE_DETAILS_TTL_MS = 5 分鐘):照片網址有時效,過期後下一次有人需要時重新取。
// 「有人需要」不只節點組合改變:useResolvedRefs 另外在可見性回到前景與低頻計時器時重新 request(見 PlanDataProvider.tsx)。
//
// 每筆的狀態:
//   pending  查詢中(還沒有結果;snapshot 裡沒有這個 id,取用端退回只有 id 的最小項目)
//   ok       查到了(child 是完整結果)。過了 TTL 之後下次 request 會在背景重取、重取期間仍顯示舊結果;
//            重取失敗不降級,舊結果繼續用,稍後(PLAN_DATA_FAILED_RETRY_MS 後)才會再試
//   failed   查詢失敗(拋例外、found:false、資料來源沒實作 attractionByID)。child 是只有 id 的最小項目。
//            重試規則:下次有人 request 且距上次失敗超過 PLAN_DATA_FAILED_RETRY_MS 才重查,避免無限重試;
//            也可以 retry() 手動立即重查、或 request 時帶 retryFailedNow
// 查詢絕不丟例外——主題點底下少幾個名稱,不該讓整個時間軸壞掉。
//
// 非 React、可單獨測試:subscribe / getSnapshot 符合 React 內建的 useSyncExternalStore 契約
// (getSnapshot 在沒有變動時回傳同一個參照)。
//
// 不在這裡的:節點狀態表(planNodeStatus 的 loading/failed/removing)是「站點卡片的查詢進度」,與這裡的「id 解析狀態」
// 是兩回事,這次不併入(後續可考慮把 loading/failed 併進來,見回報)。

export type PlanDataRefKind = 'attraction' | 'place'
export type PlanDataRefState = 'pending' | 'ok' | 'failed'

export interface PlanDataEntry {
  state: PlanDataRefState
  // child——ok 時是完整結果;pending / failed 時是只有 id 的最小項目(failed)或 undefined 對應的最小項目(pending)。
  child: PlanThemeChild
  // fetchedAt——最近一次「有結論」(成功或失敗)的時間;pending 時是發出查詢的時間。TTL 與失敗重試都以它為準。
  fetchedAt: number
}

// ResolvedNodeRefs——id → 解析結果。attractions 與 places 的 id 空間不同(lmk_… 對 placeId),
// 合併在同一張表不會衝突。尚未查到(pending)或失敗的 id 不在表裡,取用端請用 resolveNodeRefChildren 取得
// 退回最小項目的結果。
export type ResolvedNodeRefs = ReadonlyMap<string, PlanThemeChild>

// 與 home/plan-ai-sim/placeDetailsDedupe.ts 的 PLACE_DETAILS_TTL_MS 對齊(5 分鐘;plan-core 不反向依賴展示頁目錄,
// 所以在這裡重述數值,planDataStore.test.ts 有一條測試守住兩者相等)。
export const PLAN_DATA_TTL_MS = 5 * 60 * 1000
// 失敗後多久才允許「下次有人需要」時重查。30 秒:涵蓋後端限流視窗(見 resolveAttractionForStep 的 429 重試),
// 又短到使用者切換畫面時不會久久看不到補上的資料。
export const PLAN_DATA_FAILED_RETRY_MS = 30 * 1000

export interface PlanDataRequestOptions {
  // retryFailedNow——失敗中的項目不等 PLAN_DATA_FAILED_RETRY_MS、立即重查。呼叫端有「現在查得到了」的證據時用
  // (例如站點的座標已經由地點資料查詢寫進節點:代表資料存取層現在是通的)。
  retryFailedNow?: boolean
}

export interface PlanDataStore {
  // request——確保這個 id 有資料(或正在查):沒查過就查、進行中就共用、ok 且過期就背景重取、failed 依重試規則。
  // 冪等:同一頁多個消費者重複呼叫只會查一次。
  request(kind: PlanDataRefKind, id: string, opts?: PlanDataRequestOptions): void
  // retry——手動重試:不論 ok / failed,進行中的以外一律立即重查。
  retry(kind: PlanDataRefKind, id: string): void
  getEntry(kind: PlanDataRefKind, id: string): PlanDataEntry | undefined
  subscribe(listener: () => void): () => void
  // getSnapshot——id → 解析結果(只有 ok 的項目)。只有內容真的變動時才換參照。
  getSnapshot(): ResolvedNodeRefs
}

const EMPTY_SNAPSHOT: ResolvedNodeRefs = new Map()

// minimalChild——查不到(查詢中/失敗)時的最小項目:只有 id,名稱由畫面退回顯示 id。
export function minimalChild(id: string, kind: PlanDataRefKind): PlanThemeChild {
  return kind === 'attraction' ? { id, attractionId: id } : { id, placeId: id }
}

interface FetchResult {
  ok: boolean
  child: PlanThemeChild
  photoPending?: boolean
}

async function fetchRef(ds: PlanAiDataSource, id: string, kind: PlanDataRefKind): Promise<FetchResult> {
  try {
    if (kind === 'attraction') {
      if (!ds.attractionByID) return { ok: false, child: minimalChild(id, kind) }
      const a = await ds.attractionByID(id)
      return {
        ok: true,
        child: {
          id,
          attractionId: id,
          name: a.name,
          desc: a.summary,
          lat: a.lat,
          lng: a.lng,
          googlePhotoUrls: a.googlePhotoUrls,
        },
      }
    }
    const d = await ds.placeDetails(id)
    if (!d.found) return { ok: false, child: minimalChild(id, kind) }
    let photos = d.googlePhotoUrls
    // 詳情沒帶照片時,若資料來源有獨立的純讀照片端點就補一次(失敗略過,照片是輔助欄位)。
    if ((!photos || photos.length === 0) && ds.photoAssets) {
      try {
        photos = (await ds.photoAssets(id)).googlePhotoUrls ?? photos
      } catch {
        // 補照片失敗不影響其餘欄位。
      }
    }
    return {
      ok: true,
      // 補查之後仍沒有照片、且後端說還在補:交給 store 起背景重試。
      photoPending: d.photoRefreshPending === true && (!photos || photos.length === 0),
      child: {
        id,
        placeId: id,
        attractionId: d.attractionId,
        name: d.name,
        desc: d.summary,
        lat: d.lat,
        lng: d.lng,
        googlePhotoUrls: photos,
        thumbBg: d.thumbBg,
        thumbIcon: d.thumbIcon,
      },
    }
  } catch {
    return { ok: false, child: minimalChild(id, kind) }
  }
}

// createPlanDataStore——建立一個 store。一般程式不直接呼叫,用 getPlanDataStore(ds) 取得該資料來源的共用實例;
// 測試要隔離時可直接 create(可指定 now 以控制時間)。
export function createPlanDataStore(ds: PlanAiDataSource, opts: { now?: () => number } = {}): PlanDataStore {
  const now = opts.now ?? (() => Date.now())
  const entries = new Map<string, PlanDataEntry>()
  // inflight——正在查的 key。同一個 id 同時只有一個請求;結果回來時若 generation 已變(目前沒有 clear,保留給 entry 被取代的情況)
  // 以 entry 物件參照判斷是否仍是自己那一筆。
  const inflight = new Set<string>()
  // photoRetrying——key → 目前有效的補照片迴圈代號。同一個 id 同時只有一個迴圈在跑:新的 photoPending 結果
  // (例如 TTL 重取回來仍在補圖)會起新迴圈並取代舊的(舊迴圈下一步發現代號不符就停),
  // 新迴圈拿到完整的重試次數。
  const photoRetrying = new Map<string, number>()
  let photoLoopSeq = 0
  const listeners = new Set<() => void>()
  let snapshot: ResolvedNodeRefs = EMPTY_SNAPSHOT

  const keyOf = (kind: PlanDataRefKind, id: string) => `${kind}:${id}`

  function rebuildSnapshot() {
    const m = new Map<string, PlanThemeChild>()
    for (const [key, e] of entries) {
      if (e.state !== 'ok') continue
      m.set(key.slice(key.indexOf(':') + 1), e.child)
    }
    snapshot = m
    for (const fn of [...listeners]) fn()
  }

  // retryPhotosLater——詳情回應說「照片還在背景補」(photoRefreshPending)而當下沒照片時,隔一段時間用純讀的
  // photoAssets 重查,最多 PHOTO_RETRY_MAX_ATTEMPTS 次(數值與判斷同 photoRetry.ts,與地圖版一致):
  // 不能重複呼叫 placeDetails,每次呼叫都會累加後端的點擊數、推進補圖節奏。查到照片就更新該筆並通知;
  // 查詢失敗視同這次沒查到,繼續下一次。
  //
  // 迴圈不綁定特定 entry 物件(2026-10 修正):原本只在「這筆還是起迴圈時那一份」才寫回,而 TTL 重取會把 entry
  // 換成新物件——若新結果仍 photoPending,新迴圈被「已有迴圈」擋下、舊迴圈又因物件不同丟掉結果,照片要等下個 TTL。
  // 現在改成:迴圈以代號識別(新的 photoPending 結果取代舊迴圈),查到照片時寫進「目前那一筆」——
  // 只要目前那筆仍是 ok 且還沒有照片(有照片代表較新的結果已補上,不蓋回去,迴圈直接停)。
  function startPhotoRetry(key: string, id: string) {
    if (!ds.photoAssets) return
    const token = ++photoLoopSeq
    photoRetrying.set(key, token)
    schedulePhotoRetry(key, id, token, PHOTO_RETRY_MAX_ATTEMPTS)
  }

  // stillNeedsPhotos——這個迴圈仍有效、且目前那筆 ok 但沒照片;否則迴圈結束(並在仍持有代號時釋放)。
  function stillNeedsPhotos(key: string, token: number): PlanDataEntry | null {
    if (photoRetrying.get(key) !== token) return null
    const cur = entries.get(key)
    if (!cur || cur.state !== 'ok' || hasAnyPhoto(cur.child)) {
      photoRetrying.delete(key)
      return null
    }
    return cur
  }

  function schedulePhotoRetry(key: string, id: string, token: number, remaining: number) {
    const next = () => {
      if (photoRetrying.get(key) !== token) return
      if (remaining - 1 <= 0) photoRetrying.delete(key)
      else schedulePhotoRetry(key, id, token, remaining - 1)
    }
    window.setTimeout(() => {
      if (!stillNeedsPhotos(key, token)) return
      ds.photoAssets!(id)
        .then((assets) => {
          if (!hasAnyPhoto(assets)) {
            next()
            return
          }
          const cur = stillNeedsPhotos(key, token)
          if (!cur) return
          photoRetrying.delete(key)
          entries.set(key, { ...cur, child: { ...cur.child, googlePhotoUrls: assets.googlePhotoUrls } })
          rebuildSnapshot()
        })
        .catch(next)
    }, PHOTO_RETRY_DELAY_MS)
  }

  function startFetch(kind: PlanDataRefKind, id: string) {
    const key = keyOf(kind, id)
    if (inflight.has(key)) return
    inflight.add(key)
    const prev = entries.get(key)
    // 第一次查(沒有舊資料)才建 pending;重取(ok 過期 / failed 重試)沿用舊資料,畫面不閃回最小項目。
    if (!prev) entries.set(key, { state: 'pending', child: minimalChild(id, kind), fetchedAt: now() })
    void fetchRef(ds, id, kind).then((r) => {
      inflight.delete(key)
      const cur = entries.get(key)
      if (r.ok) {
        const entry: PlanDataEntry = { state: 'ok', child: r.child, fetchedAt: now() }
        entries.set(key, entry)
        if (r.photoPending) startPhotoRetry(key, id)
        rebuildSnapshot()
        return
      }
      if (cur && cur.state === 'ok') {
        // 重取失敗:保留舊的成功結果(不降級成最小項目),把 fetchedAt 推到「PLAN_DATA_FAILED_RETRY_MS 後再過期」,
        // 避免每次 request 都重打。
        entries.set(key, { ...cur, fetchedAt: now() - PLAN_DATA_TTL_MS + PLAN_DATA_FAILED_RETRY_MS })
        return
      }
      entries.set(key, { state: 'failed', child: r.child, fetchedAt: now() })
      // 失敗不影響 snapshot(snapshot 只含 ok),但若原本就是 pending 也沒有可通知的變動;狀態表給 getEntry 讀。
    })
  }

  return {
    request(kind, id, o) {
      const key = keyOf(kind, id)
      const e = entries.get(key)
      if (!e) return startFetch(kind, id)
      if (inflight.has(key)) return
      const age = now() - e.fetchedAt
      if (e.state === 'ok' && age >= PLAN_DATA_TTL_MS) startFetch(kind, id)
      else if (e.state === 'failed' && (o?.retryFailedNow || age >= PLAN_DATA_FAILED_RETRY_MS)) startFetch(kind, id)
    },
    retry(kind, id) {
      startFetch(kind, id)
    },
    getEntry(kind, id) {
      return entries.get(keyOf(kind, id))
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot() {
      return snapshot
    },
  }
}

// getPlanDataStore——依資料來源實例取得共用的 store(WeakMap:實例被丟掉時整份一起回收)。
// 訪客版 / 登入版 / 假資料各自一份;登入狀態變化換資料來源實例(getPlanAiApiDataSource 依 token 換實例)時,
// 自然換一個全新的 store,不沿用舊身分的資料。只放記憶體(屬於執行時狀態),重新整理頁面就清掉。
const stores = new WeakMap<PlanAiDataSource, PlanDataStore>()

export function getPlanDataStore(ds: PlanAiDataSource): PlanDataStore {
  let s = stores.get(ds)
  if (!s) {
    s = createPlanDataStore(ds)
    stores.set(ds, s)
  }
  return s
}
