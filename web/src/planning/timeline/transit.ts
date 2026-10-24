import type { Dispatch, SetStateAction } from 'react'
import type { PlanAiDataSource } from '../data/source'
import { getNode, nextStopOf, prevStopOf, updateNode, type PlanTimeline } from './model'

// transit.ts(planning/timeline)——「交通膠囊 transitFromPrev 的重算」唯一入口。
//
// 2026-10 由兩份幾乎相同的實作合併而來:planning/preview/usePlanSimSocket.ts(展示頁)與
// planning/panel/TripPlanPage.tsx(/app 正式頁,多一個 forceMode)。兩份各自演進,任何一邊修了競態或失敗處理,另一邊
// 就會悄悄落後,所以收斂成這一份;兩個呼叫端只負責「在哪個時機呼叫」,不再各自知道「怎麼算」。
//
// 與 itineraries/estimateTransit.ts 的分工:那邊是行程詳情頁(靜態範例)的同步「直線距離粗估」,不打 API、
// 人工填的 transitFromPrev 優先,兩條路徑不會同時作用在同一份時間軸上(詳情頁不會呼叫這裡),
// 所以沒有衝突,也刻意不合併。
//
// transitFromPrev 描述「同一天裡上一個 stop → 這個 stop」(見 model.ts TransitInfo 的完整說明),
// 資料掛在「到達站」身上,「這張卡屬於哪兩站」就是 stopId 與它目前的 prevStopOf,關係顯式且唯一。

interface RefreshTransitParams {
  stopId: string
  // dataSource——讀取層(見 planning/data/source.ts 的完整說明),只用到 transitEstimate。展示頁注入假資料實作,
  // 登入後注入真後端實作;放在這裡讓這條路徑跟推論層一樣可以整個抽換。
  dataSource: Pick<PlanAiDataSource, 'transitEstimate'>
  setTimeline: Dispatch<SetStateAction<PlanTimeline>>
  // getTimeline——呼叫當下的最新時間軸。呼叫時機通常在 commitTimeline 之後,不能仰賴可能還沒 flush 的 React state。
  getTimeline: () => PlanTimeline
  // forceMode——選填。使用者在交通膠囊手動選交通方式時指定,省略則由 dataSource 實作自己決定
  // (真後端依直線距離自動決定)。
  forceMode?: string
  // isCancelled——選填。回 true 代表呼叫端已不再消費結果(元件已卸載),估算回來後一律不寫入。
  // 必要性:/ai-plan「新行程」用 key 重新掛載,舊實例的 setTimeline 仍綁著舊 store,估算晚到會寫進舊草稿;
  // 「這一站還在、上一站沒變」的檢查涵蓋不了卸載(卸載後時間軸不會被清空)。比照 resolveAttractionForStep 的同名參數。
  isCancelled?: () => boolean
}

// refreshTransitForStop——重新計算 stopId 這一站的 transitFromPrev。
//
// 呼叫時機:任何造成「stopId 的前一站」或「前一站座標」改變的操作之後——插入站點、座標解析完成、移除前一站
// (removeNode 已同步清空它的 transitFromPrev,這裡重查新的兩站之間)、拖拉時間、使用者改交通方式。
//
// 流程:
//   1. 這一站不存在/不是 stop/沒座標:什麼都不做(沒座標的是查詢中的佔位卡,座標落地時會由
//      refreshTransitAround 再觸發一次,不需要在這裡動它)。
//   2. 沒有上一站(每天第一站)或上一站沒座標:清空 transitFromPrev,不查詢——
//      沒有兩個明確座標就無從估算,不勉強留著資料不全的卡或殘留舊資料。跨天不算上一站(prevStopOf 不跨天):
//      中間隔了一夜,不是實際移動的路線。
//   3. 否則先掛 { loading: true } 再背景查詢——後端有故意的延遲(plan_sim_ws.go transitEstimateMinDelay/
//      MaxDelay),不先掛佔位,使用者會看著卡片插入後一段空白、不知道系統在做什麼。
//   0. 有傳 isCancelled 且已取消(呼叫端已卸載):一開始與估算回來時都直接放棄,不寫入。
//   4. 查完寫回前確認「這一站還在、且上一站沒變」,否則放棄(競態保護:查詢期間可能被移除、或又觸發了新的
//      重算,這次結果已過時)。失敗同理確認後清空,不留永遠轉圈的卡;交通卡是加值資訊,查不到就維持沒有。
export function refreshTransitForStop({ stopId, dataSource, setTimeline, getTimeline, forceMode, isCancelled }: RefreshTransitParams): void {
  if (isCancelled?.()) return
  const timeline = getTimeline()
  const stopNode = getNode(timeline, stopId)
  if (!stopNode || stopNode.type !== 'stop' || stopNode.lat == null || stopNode.lng == null) return
  const prevNode = prevStopOf(timeline, stopId)
  if (!prevNode || prevNode.type !== 'stop' || prevNode.lat == null || prevNode.lng == null) {
    setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: undefined }))
    return
  }

  const prevId = prevNode.id
  setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: { loading: true } }))

  const from = { lat: prevNode.lat, lng: prevNode.lng }
  const to = { lat: stopNode.lat, lng: stopNode.lng }
  dataSource
    .transitEstimate(from, to, forceMode)
    .then((estimate) => {
      if (isCancelled?.()) return
      setTimeline((prev) => {
        if (!getNode(prev, stopId) || prevStopOf(prev, stopId)?.id !== prevId) return prev
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
      if (isCancelled?.()) return
      setTimeline((prev) => {
        if (!getNode(prev, stopId) || prevStopOf(prev, stopId)?.id !== prevId) return prev
        return updateNode(prev, stopId, { transitFromPrev: undefined })
      })
    })
}

// refreshTransitAround——stopId 的座標剛落地(resolveAttractionForStep 的 onSettled)或剛變動時用:
// 重算它自己(它與上一站之間),同時重算它的下一站(下一站與它之間)。
//
// 為什麼要連下一站:佔位卡先插入、座標後到。若下一站在這一站還沒座標時就已插入,它當時的 refreshTransitForStop
// 因「上一站沒座標」把 transitFromPrev 清空;座標落地後只重算自己的話,下一站會永遠缺這張卡。
// 座標被第二次查詢覆蓋時,下一站原本基於舊座標算的結果也同樣過時。
export function refreshTransitAround(params: RefreshTransitParams): void {
  refreshTransitForStop(params)
  const next = nextStopOf(params.getTimeline(), params.stopId)
  // 下一站是使用者手動選過的交通方式時不帶 forceMode(目前不保存該選擇,與既有行為一致),交給 dataSource 決定。
  if (next) refreshTransitForStop({ ...params, stopId: next.id, forceMode: undefined })
}
