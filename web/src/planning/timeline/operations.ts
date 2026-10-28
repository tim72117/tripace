// operations.ts —「操作層」的統一命名契約:呼叫時間軸操作狀態 hook 的膠合層(usePlanTimelineCore 的回傳值、
// AI ctx 的 PlanAiCtxDeps/AttractionStepsCtx、模擬態 usePlanSimSocket、各入口接到視圖的 props)一律用這裡的方法名。
//
// 命名規則:站點名詞一律用 Stop(不再混用 Step/Node/Attraction);動詞用 add/remove/set/retry/move,
// 不帶 ToTimeline/InTimeline 這類後綴——這些方法本來就都在操作時間軸。
//
// 不在這份契約內的:
//   - 領域層 model.ts 的純函式(insertAfter、removeNode、updateNode、addDay、moveDay、removeLodging…)是資料結構操作,
//     保留原名(core 內部以別名匯入,避免與這裡的同名方法相撞)。
//   - LLM 工具名稱(conversation/tools.ts 的 add_attraction、remove_attraction、add_note…)是對外協議,不跟著改。
//   - 視圖的 onSetStopTransitMode(換交通方式)名字像操作,但目前不在契約內:簽章手寫成 (stopId, mode) => void,
//     實作是 TripPlanPage 內的 setTimeline 包裝;之後若要納入,補進 PlanOperations 即可(不要讓名字看起來被約束卻沒有)。
//   - 視圖的 onRemoveStop、onSetStopTime 只衍生「參數」型別,回傳刻意宣告成 void(視圖不使用結果);實作 removeStop、
//     setStopTime 回 boolean,存檔失敗時視圖看不到結果,與改名前行為相同。
//
// 簽章以 usePlanTimelineCore 的實作為準(同步、直接回傳結構化結果)。AI ctx 的 AttractionStepsCtx 方法名與這裡一致,
// 但因為要過「行動前先確認目前行程」把關、回傳 Promise 給工具層,簽章較寬,見 PlanOperationNames 與 tools.ts 的說明。

import type { InsertAfterResult, LodgingResult, MoveDayResult, PlanNodeData, SetLodgingByDaysResult } from './model'

// AddDayResult——addDay 的結果:day 是領域層 addDay 回報的「實際插入的第幾天」(呼叫端不要自己再算),
// dayCount 是新增後的總天數。
export type AddDayResult = { ok: true; day: number; dayCount: number } | { ok: false; error: { message: string } }

// MoveDayWithCountResult——moveDay 的結果:領域層 MoveDayResult 再附上當下總天數(失敗時是未改動的天數)。
export type MoveDayWithCountResult = MoveDayResult & { dayCount: number }

// SetLodgingArgs——setLodging 的參數:AI 想的是「第幾天」,天數轉天 id 與 upsert 在領域層 setLodgingByDays。
export type SetLodgingArgs = { placeId: string; days: number[]; name?: string; lodgingId?: string }

export interface PlanOperations {
  // addStop——在 anchorId 之後插入一個節點(anchorId 為 null 時插在最前面);成功的 stop 會觸發插入後的背景查詢。
  addStop: (anchorId: string | null, newId: string, data: PlanNodeData) => InsertAfterResult
  // removeStop——兩階段移除(先標 removing 淡出、稍後才摘除)。true = 這次真的觸發了移除;
  // false = 節點不存在,或已在移除中。
  removeStop: (id: string) => boolean
  // setStopTime——提交某一站的新時間(HH:MM)。格式不合、節點不存在/不是 stop、或存檔失敗回 false。
  setStopTime: (stopId: string, newTime: string) => boolean
  // setStopNote——把備註寫在既有節點自己身上;找不到節點回 anchor_not_found。insertedId 是 anchorId 本身。
  setStopNote: (anchorId: string, text: string, category: string | undefined) => InsertAfterResult
  // replaceStop——把某一站換成另一個地點:保留這一站的 id、所在天與順序、時間、停留時長與備註,換掉地點(placeId、名稱)
  // 並清掉舊地點的說明/座標/交通/標籤/縮圖/子景點(attractions、places),接著走與插入後相同的背景查詢補回新地點資料(卡片回到「查詢中」),
  // 座標落地後重算它與下一站的交通。節點不存在或不是 stop、存檔失敗回 false。
  replaceStop: (stopId: string, place: { placeId: string; name?: string }) => boolean
  // retryStop——重新查詢某一站的地點資料(卡片的「重試」)。
  retryStop: (stopId: string) => void
  addDay: (atDay: number | undefined) => AddDayResult
  moveDay: (fromDay: number, toDay: number) => MoveDayWithCountResult
  setLodging: (args: SetLodgingArgs) => SetLodgingByDaysResult
  removeLodging: (lodgingId: string) => LodgingResult
}

// PlanOperationNames——只約束「方法名」的形狀:K 必須是 PlanOperations 的鍵,實作者必須以這些名字提供方法,
// 簽章不限(⚠️ 這是名稱約束、不是簽章保護:型別是 (...args: any[]) => unknown,只檢查「有沒有這個鍵」,
// 包裝層若刪掉自己的重新宣告,簽章會默默變成 any;簽章要靠包裝層自己的介面宣告)。給簽章刻意與 PlanOperations 不同的包裝層(AI ctx 的 AttractionStepsCtx:非同步、經過新鮮度把關、
// addStop 不收 newId)用——名字不能各叫各的,簽章則由它自己的介面宣告。
export type PlanOperationNames<K extends keyof PlanOperations> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [P in K]: (...args: any[]) => unknown
}
