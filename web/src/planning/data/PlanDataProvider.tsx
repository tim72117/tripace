import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { PlanAiDataSource } from './source'
import { getPlanDataStore, type PlanDataRefKind, type PlanDataStore, type ResolvedNodeRefs } from './store'
import { nodeOwnPlaceId, nodeRefEntries } from '../timeline/resolved'
import type { PlanLodging, PlanNode } from '../timeline/model'

// PlanDataProvider(planning/data)——在「根部」決定一次資料存取層(PlanAiDataSource),並把它與對應的共用 store
// (store.ts)提供給整棵子樹。底下所有消費方(時間軸、地圖站點投影、行程詳情頁、詢問頁)都向這裡取資料,
// 不再各自收 dataSource / resolvedRefs prop、各自起解析 hook 實例。
//
// 各入口怎麼包(資料來源在根部決定一次):
//   登入後桌面/手機  planning/member/desktop/Content、planning/member/phone/Content 包住 LivePlanLayer,資料來源 getPlanAiApiDataSource(cfg)
//   /ai-plan         planning/preview/Content:模擬態整棵子樹在假資料的 Provider 底下(含 useSimulatedStopsView 與視圖,
//                    兩者用同一份);交接後的推論態子樹在公開版的 Provider 底下
//   行程詳情頁       itineraries/AiItineraryDetailPage(公開版)
//   首頁手機展示     home/AiPlanPhoneDemoScreen(假資料)
//
// 換資料來源實例(例如登入狀態改變、模擬態交接到推論態)時,getPlanDataStore 依實例取得另一個 store,
// 自然換一份全新的資料,不沿用舊身分的資料。

export interface PlanData {
  dataSource: PlanAiDataSource
  store: PlanDataStore
}

const PlanDataContext = createContext<PlanData | null>(null)

export function PlanDataProvider({ dataSource, children }: { dataSource: PlanAiDataSource; children: ReactNode }) {
  const value = useMemo<PlanData>(() => ({ dataSource, store: getPlanDataStore(dataSource) }), [dataSource])
  return <PlanDataContext.Provider value={value}>{children}</PlanDataContext.Provider>
}

// usePlanData——取得 { dataSource, store }。沒有 Provider 時直接丟明確的錯誤(不做靜默退路):
// 退路會讓某個入口漏包 Provider 時悄悄變成「另一份」資料來源與 store,正是這次重構要消滅的分歧;
// 測試請用 Provider 包住(見 planning/data/fixtures.tsx 的 withPlanData)。
export function usePlanData(): PlanData {
  const ctx = useContext(PlanDataContext)
  if (!ctx) throw new Error('usePlanData 需要在 <PlanDataProvider> 底下使用(資料存取層在入口根部決定一次)')
  return ctx
}

const NO_LODGINGS: readonly PlanLodging[] = []

// useResolvedRefs——輸入一批節點(通常是 toRenderList 或 listNodes 的結果)與旅館,輸出 id → PlanThemeChild
// (與舊 useResolvedNodeRefs hook 同形,planning/timeline/resolved.ts 的 resolveNodeRefChildren / resolveMapChildren / resolveLodging / lodgingMapMarkers
// 照舊可用)。內部向 store 請求需要的 id(同一個 id 全頁只查一次)並用 useSyncExternalStore 訂閱變化;
// 結果參照只在 store 有新結果時才換,方便下游當 memo 依賴。
//
// 回傳的是 store 的全域快照(含別的消費者請求的 id):取用端一律 .get(id),多的項目無害。
export function useResolvedRefs(nodes: readonly PlanNode[], lodgings: readonly PlanLodging[] = NO_LODGINGS): ResolvedNodeRefs {
  const { store } = usePlanData()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  // 需要的 id 清單。用字串 key 當依賴:nodes 每次 render 常是新陣列參照,內容沒變就不該重跑 effect。
  // settledKey——站點自己的 placeId 當中「節點上已經有座標」的那些:站點的地點資料查詢(resolveAttractionForStep)
  // 成功時才會寫座標,所以座標出現代表「資料存取層現在查得到了」。此時 store 內若該筆是 failed,
  // 允許不等重試間隔立即重查(retryFailedNow),照片才補得回來。這是「有證據才提早重試」的輸入,
  // 失敗狀態本身與重試規則都由 store 持有。
  const { wantedKey, settledKey } = useMemo(() => {
    const parts: string[] = []
    const settled: string[] = []
    for (const n of nodes) {
      for (const e of nodeRefEntries(n)) parts.push(`${e.kind}:${e.id}`)
      const own = nodeOwnPlaceId(n)
      if (own) {
        parts.push(`place:${own}`)
        if (n.lat != null) settled.push(own)
      }
    }
    for (const l of lodgings) {
      if (l.placeId) parts.push(`place:${l.placeId}`)
    }
    return { wantedKey: [...new Set(parts)].join(','), settledKey: [...new Set(settled)].join(',') }
  }, [nodes, lodgings])

  // wantedRef——給計時器與可見性監聽讀「目前需要的 id」(它們只依 store 掛一次,不隨節點組合重掛)。
  const wantedRef = useRef(wantedKey)

  useEffect(() => {
    wantedRef.current = wantedKey
    const settled = new Set(settledKey ? settledKey.split(',') : [])
    for (const { kind, id } of parseWantedKey(wantedKey)) {
      store.request(kind, id, { retryFailedNow: kind === 'place' && settled.has(id) })
    }
  }, [store, wantedKey, settledKey])

  // TTL 真的生效(2026-10 修正):上面的 effect 只在節點組合改變時才跑,頁面開著、組合不變時不會再 request,
  // 過期的照片網址會一直顯示。這裡補兩個「重新對目前需要的 id 呼叫 request」的時機(request 冪等,
  // 未過期什麼都不做、過期才在背景重取,重取期間仍顯示舊結果):
  //   1. 可見性回到前景:分頁在背景放久了,回來時立刻把過期的換新。這裡照一般 request 規則(failed 也依
  //      PLAN_DATA_FAILED_RETRY_MS 重查),由使用者切回分頁觸發,不會形成迴圈。
  //   2. 低頻計時器(PLAN_DATA_REFRESH_CHECK_MS):只處理 ok 且已過期的項目,分頁在背景時跳過。
  //      刻意不碰 failed——否則失敗的 id 會每隔一段時間被永遠重打(無限重試);失敗的重查仍走原本的時機
  //      (節點組合改變、retryFailedNow、回到前景)。
  // 卸載時清掉計時器與監聽。
  useEffect(() => {
    const refreshExpired = (okOnly: boolean) => {
      for (const { kind, id } of parseWantedKey(wantedRef.current)) {
        if (okOnly && store.getEntry(kind, id)?.state !== 'ok') continue
        store.request(kind, id)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshExpired(false)
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshExpired(true)
    }, PLAN_DATA_REFRESH_CHECK_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [store])

  return snapshot
}

// PLAN_DATA_REFRESH_CHECK_MS——useResolvedRefs 檢查過期項目的間隔。1 分鐘:比 TTL(5 分鐘)短,過期後最多晚
// 1 分鐘換新(若每 TTL 才檢查一次,最壞要等將近兩個 TTL);每次檢查只是讀記憶體裡的狀態,未過期不發請求。
export const PLAN_DATA_REFRESH_CHECK_MS = 60 * 1000

function parseWantedKey(wantedKey: string): { kind: PlanDataRefKind; id: string }[] {
  if (!wantedKey) return []
  return wantedKey.split(',').map((key) => {
    const sep = key.indexOf(':')
    return { kind: key.slice(0, sep) as PlanDataRefKind, id: key.slice(sep + 1) }
  })
}
