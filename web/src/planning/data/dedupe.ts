// dedupe.ts(planning/data,原 placeDetailsDedupe)— 資料來源層的 placeDetails 去重(2026-10 新增)。
//
// 背景:後端 place-details-any 每次請求都會累加該地點的點擊數(影響補圖
// 上限),沒命中快取時還會多打一次 Google。詢問頁(AskPage)為每張候選卡
// 查一次 placeDetails,使用者確認後時間軸的 resolveAttractionForStep 又對
// 同一個 placeId 查一次——同一個地點在短時間內被請求 2 次以上。
//
// 規則:
// 1. 進行中共用:同一個 placeId 同時有多個請求時共用同一個 Promise。
// 2. 成功結果短期記憶(TTL + 上限),期間內直接回傳,不發請求。
// 3. 失敗(reject:網路錯誤/429/5xx)絕不記憶——呼叫端的 429 重試必須能
//    真的重新發請求。進行中的 Promise 在 settle 後立刻從 inflight 移除。
// 4. photoRefreshPending === true 的結果「只做進行中共用,不記憶」。
//    理由:pending 代表「照片還在背景補,下一次查詢才看得到」,呼叫端
//    (TripPlanPage 的照片重試、其他重新查詢)依賴「之後再查一次會拿到
//    新照片」。若把 pending 結果記住 5 分鐘,期間再查只會拿到沒照片的舊
//    結果,照片就晚出現甚至不出現。不記憶的代價只是 pending 期間可能多
//    發幾次請求,可接受(而且 pending 本來就是少數、暫時的狀態)。
// 5. found === false 也不記憶。理由:它可能是暫時性的(剛建檔、後端
//    Google 查詢暫時查無),記住會把短暫的負面結果放大成 5 分鐘;且
//    查無結果不會出現在正常流程(placeId 來自候選清單),重查成本極低。
// 6. found:true 但沒有可用座標(lat/lng 任一缺)也不記憶(2026-10 修正)。
//    理由:呼叫端(resolveAttractionForStep 等)拿到沒座標的結果會判定失敗
//    並重試;若記住這份結果,5 分鐘內的重試(含重新掛載後的重試)都會拿到
//    同一份沒座標的快取,重試等於沒做。
//
// TTL 5 分鐘:涵蓋「詢問頁顯示候選 -> 使用者看完確認」的合理間隔,又短
// 到地點資料(名稱/簡介/照片網址)變更時不會久久看到舊值。
// 上限 100 筆:一次行程候選通常 < 30 筆,100 足夠;超過時淘汰最舊的。
//
// 共用範圍:AskPage 與時間軸不一定拿到同一個資料來源實例(例如展示頁的
// planning/preview/Content 自己 new 一個 askPageDataSource,LivePlanLayer 另外
// new 一個給時間軸),所以記憶體不放在工廠閉包裡,而是依 scopeKey
// (模組層級登錄表)共用——同一個後端 + 同一個身分(token)就共用同一份。

export interface PlaceDetailsLike {
  found?: boolean
  photoRefreshPending?: boolean
  lat?: number
  lng?: number
}

export const PLACE_DETAILS_TTL_MS = 5 * 60 * 1000
export const PLACE_DETAILS_MAX_ENTRIES = 100

export interface PlaceDetailsDedupeOptions {
  ttlMs?: number
  maxEntries?: number
  // shouldRemember:成功結果要不要記憶,預設規則是第 4、5、6 點(found === false、photoRefreshPending、沒有可用座標不記)。
  // 地圖光暈與詳情卡共用的快取(planning/data/cache.ts)用「一律記憶、不過期」的設定,兩邊是同一套機制、不同政策。
  shouldRemember?: (value: unknown) => boolean
}

const defaultShouldRemember = (value: unknown) => {
  const v = value as PlaceDetailsLike
  return v.found !== false && v.photoRefreshPending !== true && hasUsableCoords(v)
}

// hasUsableCoords——lat/lng 兩者都是有限數字才算「可用座標」(規則第 6 點)。
function hasUsableCoords(v: PlaceDetailsLike): boolean {
  return typeof v.lat === 'number' && Number.isFinite(v.lat) && typeof v.lng === 'number' && Number.isFinite(v.lng)
}

export class PlaceDetailsDedupe {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly shouldRemember: (value: unknown) => boolean
  private readonly done = new Map<string, { value: unknown; expiresAt: number }>()
  private readonly inflight = new Map<string, Promise<unknown>>()
  // generation:clear() 時遞增,讓 clear 之前就發出的請求完成後不會寫回記憶。
  private generation = 0

  constructor(opts: PlaceDetailsDedupeOptions = {}) {
    this.ttlMs = opts.ttlMs ?? PLACE_DETAILS_TTL_MS
    this.maxEntries = opts.maxEntries ?? PLACE_DETAILS_MAX_ENTRIES
    this.shouldRemember = opts.shouldRemember ?? defaultShouldRemember
  }

  // peek:同步讀已記憶且未過期的結果(不發請求),沒有回 undefined。
  peek<T>(placeId: string): T | undefined {
    const hit = this.done.get(placeId)
    if (!hit) return undefined
    if (hit.expiresAt > Date.now()) return hit.value as T
    this.done.delete(placeId)
    return undefined
  }

  // replace:只在已記憶時覆寫(例如照片重試查到新結果寫回);沒記憶過就不動,避免把沒查過的資料塞進來。
  replace(placeId: string, value: unknown) {
    if (this.done.has(placeId)) this.remember(placeId, value)
  }

  get<T extends PlaceDetailsLike>(placeId: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.done.get(placeId)
    if (hit) {
      if (hit.expiresAt > Date.now()) return Promise.resolve(hit.value as T)
      this.done.delete(placeId)
    }
    const pending = this.inflight.get(placeId)
    if (pending) return pending as Promise<T>

    const gen = this.generation
    const p = fetcher().then(
      (value) => {
        if (this.inflight.get(placeId) === p) this.inflight.delete(placeId)
        if (gen === this.generation && this.shouldRemember(value)) {
          this.remember(placeId, value)
        }
        return value
      },
      (err) => {
        if (this.inflight.get(placeId) === p) this.inflight.delete(placeId)
        throw err
      },
    )
    this.inflight.set(placeId, p)
    return p
  }

  clear() {
    this.generation++
    this.done.clear()
    this.inflight.clear()
  }

  private remember(placeId: string, value: unknown) {
    this.done.delete(placeId) // 重新插入以更新插入順序
    this.done.set(placeId, { value, expiresAt: Date.now() + this.ttlMs })
    while (this.done.size > this.maxEntries) {
      const oldest = this.done.keys().next().value
      if (oldest === undefined) break
      this.done.delete(oldest)
    }
  }
}

const MAX_SCOPES = 8
const registry = new Map<string, PlaceDetailsDedupe>()

// getSharedPlaceDetailsDedupe — 依 scopeKey 取得(或建立)共用的去重實例。
// scopeKey 應包含 baseURL 與身分(token),登出/換帳號就不會讀到上一個身分的
// 記憶。登錄表本身有上限,避免 token 輪替造成無限成長。
export function getSharedPlaceDetailsDedupe(scopeKey: string): PlaceDetailsDedupe {
  let d = registry.get(scopeKey)
  if (!d) {
    d = new PlaceDetailsDedupe()
    registry.set(scopeKey, d)
    while (registry.size > MAX_SCOPES) {
      const oldest = registry.keys().next().value
      if (oldest === undefined) break
      registry.delete(oldest)
    }
  }
  return d
}

// 測試用:清空整個登錄表。
export function resetSharedPlaceDetailsDedupe() {
  registry.clear()
}
