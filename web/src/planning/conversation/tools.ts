// tools.ts — /plan-ai 對話窗給 onagent 用的兩個工具:
// search_attraction(查詢任意地名,取得座標與鄰近候選)、add_attraction
// (把查到的地點插入時間軸)。沿用專案既有的 sdk-proposals/defineTool
// 模式(見 sdk-proposals/defineTool.ts 的完整設計說明;原 tripEntryAdd.ts 等範例已移除),
// 不是另起一套——parseArgs 負責把 unknown 的 raw args 轉成型別安全的
// 形狀,handle 只處理已經型別安全的 args + ctx,兩者透過 defineTool 綁定
// 不會不同步。
//
// 與模擬 WS 腳本路徑(plan-ai-sim 分支)的關係:完全獨立、不共用——
// 使用者已確認這兩條路徑不交集(見設計討論)。這裡的 add_attraction 直接
// 呼叫 ctx.addStop 異動時間軸,不透過 WS action 訊息協議,
// 因為 onagent bridge 本身就是即時雙向的工具呼叫通道,不需要再包一層
// 自訂的 WS 訊息格式去模擬同一件事。
//
// 2026-09 第一次重構:add_attraction 原本直接 ctx.setSteps((prev) =>
// [...prev, newStep]) 把新景點無條件 append 到陣列尾端——不管呼叫端
// (LLM)傳的 time 是幾點,新卡片一律排最後面,導致時間軸畫面上出現時間
// 忽前忽後的錯亂順序(見 timeline/model.ts 開頭的完整背景說明)。改成鏈結
// 串列資料結構(timeline/model.ts)後,插入操作收斂成「行程安排元件」
// (planning/preview/Content.tsx)透過 ctx.addStop 提供的單一
// 介面——這個工具不再自己組陣列、自己決定位置,而是明確指定 anchorId
// (要插在哪個既有節點後面,null 代表插在最前面),由該介面統一驗證時間
// 是否落在合理範圍、決定實際插入位置。
//
// 2026-09 第二次重構:search_attraction 原本查的是 attractionPool.ts
// 這個純前端固定假資料池(10 筆寫死的台南景點)——使用者明確要求改成
// 「前端打 attraction 節點取得鄰近清單」:先呼叫新增的公開端點
// fetchPlanAiPlaceSearch(GET /internal/geo/plan-ai/place-search,見後端
// handlePublicGeoPlaceSearch 的完整說明)查任意地名取得座標,再用這個
// 座標當錨點,呼叫既有的 fetchPublicGeoAttractions(查台南已建檔景點
// 清單)搭配 computeNearbyAttractions(散策羅盤/AttractionInfoPanel.tsx
// 附近景點清單共用的同一套純函式,見 geoNearbyAttractions.ts)算出鄰近
// 候選,依步行分鐘數由近到遠排序。add_attraction 隨之一併改成接受任意
// 查到的地點(不再限於 attractionPool.ts 那 10 筆假資料)。
// attractionPool.ts 這個假資料池整個不再使用(不刪除檔案,保留給之後
// 若想在真實地點池之外另外補充固定精選候選時參考,但目前的工具流程
// 完全不依賴它)。
//
// 2026-09 第三次重構:add_attraction 原本要求 LLM 傳 name/lat/lng(甚至
// summary)——使用者明確要求「不用送太多資訊,placeId 跟時間就可以,
// 其他資訊由前端再做查詢」。新增 fetchPlanAiPlaceDetailsAny(GET
// /internal/geo/plan-ai/place-details-any,見後端 handlePublicGeoPlaceDetailsAny
// 的完整說明——不受 publicPlaceDetailsAllowlist 固定白名單限制,可查
// search_attraction 查到的任意 placeId)後,add_attraction 只需要
// placeId + time(+ anchorId),插入當下由這裡重新查詢完整資料,LLM
// 不再需要把上一輪 search_attraction 回傳過的欄位原封不動複製貼回來
// (真實案例:同一批 name/lat/lng/summary 在兩次工具呼叫之間被完整
// 複製一次,徒增資料重複導致的錯誤風險)。
//
// 2026-09 第四次重構(短暫存在,已被下面第五次重構取代):曾經一度改成
// add_attraction 收 attractionId(資料庫景點區域 id),nearby 候選也改
// 回傳這個 id,而非 placeId——當時的動機是「LLM 只需要記住一個短 id,
// 資料本體由後端在插入當下重新查詢一次」。但 search_attraction 的鄰近
// 候選若要涵蓋資料庫沒有建檔的地點(見下面第五次重構),Google 查到的
// 候選沒有資料庫 id 可用,勢必要引入某種臨時 id 機制,這又違背了「id
// 是給後端統一查詢用的引用,不該讓前端/LLM 自己解析或另外維護一套對應
// 關係」這個更早的核心設計精神(見上面第三次重構的說明)。故撤回這次
// 重構,回到 placeId。
//
// 2026-09 第五次重構(這次):search_attraction 原本查的是
// fetchPublicGeoAttractions(純資料庫查詢,只涵蓋已人工建檔的固定景點,
// 見第二次重構的說明)——使用者明確要求「如果搜尋的 attraction 少於
// 10 個,則用 google search nearby 補上不重複的點」,新增後端端點
// fetchPlanAiAttractionSearch(GET /internal/geo/plan-ai/attraction-search,
// 見後端 handlePublicGeoAttractionSearch 的完整說明)取代它:資料庫
// 候選不足時後端自動用 Google Nearby Search 補齊,前端這裡不需要知道
// 候選來源。不論候選來自資料庫還是 Google,一律用同一個 placeId 當
// 識別碼回傳給 LLM——LLM 選中某個候選的 placeId 呼叫 add_attraction
// 時,後端 place-details-any 內部本來就會優先查一次資料庫 attraction
// (見 handlePublicGeoPlaceDetailsAny 的完整說明,查得到就優先用資料庫
// 資料,查不到才 fallback 查 Google),不需要這個檔案自己判斷來源、也
// 不需要維護任何額外的 id 對應機制。computeNearbyAttractions(依步行
// 分鐘數排序的純函式)不再需要,鄰近候選改由後端一次回傳,不再由前端
// 自己用座標算距離排序。

import type { ClientTool } from '../../sdk-proposals/arrayTools'
import { defineTool } from '../../sdk-proposals/defineTool'
import { fetchPlanAiAttractionSearch, fetchPlanAiPlaceSearch, type ClientConfig } from '../../api'
import { lodgingDayNumbers, lodgingsOf, type InsertAfterError, type PlanNodeData, type PlanTimeline } from '../timeline/model'
import type { PlanOperationNames } from '../timeline/operations'

// AttractionStepsCtx — add_attraction 需要的 context:一個能讀取時間軸
// 現況、並且插入新節點的口子。刻意不是完整的 planning/preview/Content state
// (不含 isGenerating/following 等其餘 UI state),只暴露這個工具真正
// 需要的最小介面,理由同原 tripEntryAdd.ts(已移除)的 TripEntryAddCtx 設計。
//
// addStop 是這裡唯一的寫入口——「機制跟介面由行程安排
// 元件提供」:鏈結串列的構建、時間驗證、prevId/nextId 維護全部收在
// planning/preview/Content.tsx(呼叫 timeline/model.ts 的 insertAfter),這個
// 工具檔案只負責把 args 轉成呼叫這個介面所需的形狀、以及把失敗結果轉成
// 拋給 LLM 的錯誤訊息,不自己碰鏈結細節。
// setStopNote——同樣由行程安排元件提供,但不是「插入新節點」這種操作,而是
// 語意層級的「把一則備註寫在某個既有景點節點上」方法(對齊
// planning/preview/Content.tsx 的 addNoteToTimeline)。這是使用者明確要求的
// 兩層架構:排程元件本身提供操作資料的方法(addNoteToTimeline),LLM 的
// 工具透過這些方法操作排程內的資料,不是工具自己組好 PlanNodeData 形狀
// 直接丟給底層的 addStop。
//
// 2026-09 重構(這次):使用者明確要求「備註寫在景點的節點上」——note
// 不再是鏈結串列裡獨立插入的節點,改成掛在既有節點自己身上的欄位(見
// timeline/model.ts NoteInfo 的完整說明)。
//
// 2026-09 再次修正:這裡原本用 stopId 這個獨立命名指稱「要附加備註的
// 既有節點 id」,跟 addStop 的 anchorId 是同一種東西——
// 都是「時間軸上某個既有節點的 id」,只是插入節點時代表「接在它後面」、
// 這裡代表「附加在它身上」。使用者明確要求「agent tool 發出的參數名稱
// 保持一致,像是要附加在節點上的就要用 anchorId,不要創造多餘的命名」
// ——統一改回 anchorId,不因為語意細節不同就另外發明一個名字,LLM 與
// 這個檔案的呼叫端只需要記住一種「指向既有節點」的參數名。
//
// 型別是 string(不像 addStop 的 anchorId 是
// string | null)——這裡沒有「插在時間軸最前面」這種語意,備註一定要有
// 明確的掛載對象,不存在「沒有目標節點的備註」這種情境,故不開放 null。
//
// category 決定備註顯示的顏色/圖示,對照表由元件這一層決定(元件內部的
// NOTE_STYLES,見 planning/preview/Content.tsx 的完整說明),這裡的工具檔案
// 只傳語意層級的 category 字串,不需要知道視覺樣式怎麼對照。回傳值不再
// 是新節點 id(沒有新節點被建立),而是被寫入備註的那個 anchorId 本身,
// 方便 LLM 確認操作對象。
// removeStop——讓 remove_attraction 工具能把時間軸上某個既有節點摘除。
// 跟 addStop/setStopNote 一樣是語意層級的方法,由行程安排元件
// (planning/timeline/usePlanTimelineCore)提供,這個工具檔案不自己碰
// 鏈結細節。
//
// 2026-10 新增:底層的移除函式(當時叫 removeStep、在 TripPlanPage.tsx,現為 usePlanTimelineCore.removeStop)原本是給 UI 之後接新
// 入口預留的能力,本身是 fire-and-forget(無回傳值,也不檢查 id 是否
// 存在——直接呼叫 removeNode,對不存在的 id 這個純函式本身會原樣返回、
// 靜默不做事,見 timeline/model.ts removeNode 的完整說明)。但工具呼叫
// 這一層需要能分辨「id 不存在」這種呼叫方式錯誤,回報清楚的錯誤訊息
// 給 LLM(對齊 setStopNote 對 anchor_not_found 的既有處理慣例),不能讓
// LLM 以為移除成功、但實際上什麼都沒發生。故這個方法的回傳型別複用
// InsertAfterError(沿用既有的 anchor_not_found 錯誤碼——「要操作的
// 節點 id 不存在」是同一種語意,不需要為 remove 另外發明一個錯誤碼),
// 呼叫端(TripPlanPage.tsx)在真的呼叫 removeStop 之前,要先自行檢查
// timelineRef.current.nodes.has(id),不存在就回傳 ok:false,存在才
// 觸發 removeStop 並立即回傳 ok:true——不等待 REMOVE_FADE_MS 淡出動畫
// 播完,因為 LLM 只需要知道「移除指令已受理」,不需要、也不該等待純
// 視覺動畫結束才收到工具回應。
//
// 命名約束(2026-10 操作層命名統一):寫入方法的名字必須與 timeline/operations.ts 的 PlanOperations 一致
// (extends PlanOperationNames<PlanAiOperationName> 在編譯期檢查),但簽章刻意比 PlanOperations 寬/不同,所以不直接 Pick:
//   - 全部回傳 Promise:工具層是 async,實作端(conversation/context.ts)還要先過「行動前先確認目前行程」與天數上限把關,
//     失敗用 throw 或 ok:false 回報給 LLM;
//   - addStop 不收 newId(新節點 id 由 ctx 實作端產生),回傳 { ok, id } 而不是整份 InsertAfterResult(不把時間軸回給工具);
//   - setStopNote 同理只回 { ok, id };removeStop 把 boolean 轉成 ok:false + anchor_not_found 錯誤;
//   - moveDay 只回 { ok, dayCount },setLodging 不回 timeline——LLM 只需要摘要。
// 底層(PlanAiCtxDeps)則直接 Pick<PlanOperations, PlanAiOperationName>,名稱與簽章都與 core 相同。
export type PlanAiOperationName = 'addStop' | 'setStopNote' | 'removeStop' | 'addDay' | 'moveDay' | 'setLodging' | 'removeLodging'

export interface AttractionStepsCtx extends PlanOperationNames<PlanAiOperationName> {
  // getTimeline——讀取目前的時間軸(依天分組的 PlanTimeline):list_itinerary 據此輸出依天分組的結構,structureSignature 據此算簽名。
  getTimeline: () => PlanTimeline
  addStop: (
    anchorId: string | null,
    step: NewStopInput,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: InsertAfterError }>
  setStopNote: (
    anchorId: string,
    text: string,
    category: string | undefined,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: InsertAfterError }>
  removeStop: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: InsertAfterError }>
  // addDay/moveDay——天的操作(見 timeline/model.ts addDay/moveDay):天是時間軸的結構(days 陣列),不是站點上的欄位,
  // 所以新增與調整順序各是獨立的操作。回傳目前的天數方便 LLM 接著規劃;moveDay 的天數超出範圍時 ok:false 並帶人類可讀的訊息。
  addDay: (
    atDay: number | undefined,
  ) => Promise<{ ok: true; day: number; dayCount: number } | { ok: false; error: { message: string } }>
  moveDay: (
    fromDay: number,
    toDay: number,
  ) => Promise<{ ok: true; dayCount: number } | { ok: false; error: { message: string } }>
  // setLodging/removeLodging——住宿的操作(見 timeline/model.ts PlanTimeline.lodgings 與 setLodgingByDays/removeLodging):住宿是獨立於
  // 天裡站點的另一份資料。AI 想的是「第幾天」,days 原樣交給 ctx,由 ctx 在「行動前先確認目前行程」把關之後,用當下最新的時間軸
  // 轉成天的 id 並 upsert(lodgingId 優先,沒給就依 placeId:同一間旅館已有記錄視為更新它的停留日;days 為空陣列代表移除)。
  // 天數超出範圍等失敗回 ok:false 帶人類可讀的訊息(工具層轉成 throw)。
  setLodging: (args: {
    placeId: string
    days: number[]
    name?: string
    lodgingId?: string
  }) => Promise<
    | { ok: true; lodgingId: string; created: boolean; removed: boolean; days: number[]; dayCount: number }
    | { ok: false; error: { message: string } }
  >
  removeLodging: (lodgingId: string) => Promise<{ ok: true } | { ok: false; error: { message: string } }>
}

// NewStopInput — add_attraction 透過 ctx.addStop 交給呼叫端的新站點資料:以領域層的 PlanNodeData 為基礎,
// 只開放工具實際會寫入的欄位(不含 id——id 由呼叫端產生;也不含 transitFromPrev/attractions/places 等由系統維護的欄位,
// AI 的工具路徑不該能直接寫入它們)。原本這裡自己宣告一份「結構相容的最小子集」(PlanStepLike),理由是避免循環依賴,
// 但 timeline/model.ts 是純領域層、並不依賴本檔案,那個理由早已過時,而且內容幾乎就是 PlanNodeData 的複本,改欄位要改兩處。
// day——放進第幾天(從 1 起算,時間軸依所在的天補上;list_itinerary 一併回傳)。placeId——addAttraction 插入佔位節點時標記
// 這筆需要背景反查(「查詢中」不是節點資料:由 ctx.addStop 的實作端在節點狀態表標 loading)。
export type NewStopInput = Pick<
  PlanNodeData,
  'type' | 'day' | 'time' | 'duration' | 'kind' | 'name' | 'desc' | 'thumbBg' | 'thumbIcon' | 'tags' | 'lat' | 'lng' | 'placeId' | 'note'
>

// structureSignature/STALE_READ_MESSAGE——「行動前先確認目前行程」的把關(使用者明確要求:每次行動前都要先確認目前行程)。
// 簽名只取 list_itinerary 讓 LLM 據以決定 anchorId/time/day 的結構資訊(天數、每個節點的 id、所在天、time,以及每筆旅館的 id 與停留的天),不含名稱與備註——背景補查地點
// 資料(名稱從「查詢中…」變成真名)不該讓簽名失效,否則 LLM 永遠追不上。呼叫端(TripPlanPage 的 ctx)在 list_itinerary 讀取時記下
// 簽名,之後每個會改動行程的工具(add_attraction/add_note/remove_attraction/add_day/move_day/set_lodging/remove_lodging)執行前比對:簽名不同(包含 LLM
// 自己剛插入的站、使用者刪站或拖曳改時間、一次都沒讀過)就拒絕並回 STALE_READ_MESSAGE,要求先呼叫 list_itinerary。
export function structureSignature(timeline: PlanTimeline): string {
  // 每一天先放一個天的標記(空的天也算結構:add_day/move_day 會讓簽名改變),再放該天每個節點的 id/所在天/time。
  const daysPart = timeline.days
    .map((d, i) => [`D${i + 1}`, ...d.nodes.map((n) => `${n.id}|${i + 1}|${n.time ?? ''}`)].join(';'))
    .join(';')
  // 旅館(id 與停留的第幾天,依位置算:改天順序或刪天都會讓簽名改變,LLM 得重讀才能再動旅館)。沒有旅館時不加任何內容,
  // 維持沒有住宿的時間軸簽名與過去相同(空時間軸仍是空字串)。
  const lodgings = lodgingsOf(timeline)
  if (lodgings.length === 0) return daysPart
  const lodgingPart = lodgings.map((l) => `L:${l.id}|${lodgingDayNumbers(timeline, l).join(',')}`).join(';')
  return `${daysPart};${lodgingPart}`
}
export const STALE_READ_MESSAGE =
  '行程在你上次查詢之後有變動（或你還沒查過），為避免用過期的資料操作，這次沒有執行。請先呼叫 list_itinerary 讀取目前的行程，再依最新的 id、day、time 重新呼叫這個工具。'

// SearchAttractionArgs/parseSearchAttractionArgs — search_attraction 的
// args 型別與 runtime 驗證,對齊 onagent 平台的 tool schema——這個 schema
// 不在這個檔案裡維護,權威來源是 web/tools/plan-ai/search_attraction.yaml
// (見該檔案開頭的完整說明:app/tool 定義的推送方式、為何拆成獨立檔案),
// 這裡的 TS interface 只是跟那份 yaml 的 parameters 對齊的型別鏡射,
// 修改參數時兩邊都要同步更新。
//
// 2026-09 真實踩坑記錄(已修正,見 search_attraction.yaml 目前生效的
// query description):後台原本設定的 query 參數 description 只強調
// 「地名」,沒有點出這個字串會被送進 Google Places Text Search 取座標
// (見 createSearchAttraction 實際呼叫的 fetchPlanAiPlaceSearch →
// 後端 handlePublicGeoPlaceSearch,MaxResults:1,只取最相關的一筆
// 結果),結果 LLM 曾經傳過「台南中西區景點」這種類別性描述語句當
// query(見 server/tmp/logs 底下實際對話紀錄),這種模糊描述對 Text
// Search 而言不是一個可靠解析的地名。search_attraction.yaml 已經改寫
// query description 並推送生效。
//
// 2026-09 第二次調整(這次):使用者明確要求「query 要給兩個參數,一個
// 是取得定位點的查詢文字,另一個是推薦景點的查詢文字」——原本 query
// 這個單一參數身兼兩用(定位錨點 + 篩選候選依據),但後端 nearby 候選
// 查詢(fetchPlanAiAttractionSearch → handlePublicGeoAttractionSearch)
// 完全沒有任何依類型/關鍵字篩選的機制,候選只由座標半徑決定,LLM 無法
// 透過 query 影響「附近有哪些類型的景點」這件事。新增 types 參數(見
// NEARBY_ATTRACTION_TYPES 的完整說明)對應後端新增的 types 查詢參數,
// 只影響 Google Nearby Search 補點那段是否依類型限縮搜尋範圍。
// NEARBY_ATTRACTION_TYPES — search_attraction 的 types 參數合法值白名單,
// 對齊後端 allowedNearbyAttractionTypes(見該常數的完整說明:使用者明確
// 要求「排幾個觀光會用到的類別讓 LLM 選」「用固定選單讓 LLM 選」,這裡
// 收斂成旅遊規劃情境常用的固定子集,不是 Google 官方將近 200 種類型
// 全部開放)。前端這裡重複維護同一份白名單,理由是要在送出 API 請求前
// 就先過濾掉不合法的值——後端雖然也會過濾(不在白名單內的值直接忽略,
// 不視為錯誤),但讓不合法的值連同請求一起送出去,是把本可以在本地
// 完成的驗證延後到網路往返之後才生效,沒有必要。
const NEARBY_ATTRACTION_TYPES = new Set([
  'tourist_attraction', 'museum', 'art_gallery', 'park', 'place_of_worship',
  'historical_landmark', 'zoo', 'amusement_park',
  'restaurant', 'cafe', 'bakery', 'bar',
  'shopping_mall', 'market',
  'lodging',
])

// SearchAttractionArgs/parseSearchAttractionArgs — types 在 onagent 平台
// 的 tool schema 上是必填(2026-09 改為必填,見 search_attraction.yaml
// 的完整說明:要求 LLM 每次都依語境判斷一個類型組合,不要省略這個
// 決策),但這裡的 runtime 解析刻意保持容錯,不因為 LLM 偶爾漏帶而直接
// 丟錯——rawTypes 缺省或格式不對時退回空陣列,行為同「不限制類型」
// (見 NEARBY_ATTRACTION_TYPES 的完整說明,只在 nearby 候選數量不足、
// 觸發後端 Google Nearby Search 補點時才會影響結果,資料庫候選不受這個
// 參數篩選)。傳入陣列中不在白名單內的值直接過濾掉,不因為其中夾雜不
// 合法值就整個 types 參數失效——理由同這個檔案其餘欄位驗證一貫的寬鬆
// 處理慣例(例如 anchorId 的 null/空字串/字面 "null" 統一處理)。
interface SearchAttractionArgs {
  query: string
  types: string[]
}
function parseSearchAttractionArgs(raw: unknown): SearchAttractionArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  const rawTypes = Array.isArray(r.types) ? r.types : []
  const types = rawTypes.filter((t): t is string => typeof t === 'string' && NEARBY_ATTRACTION_TYPES.has(t))
  return { query: typeof r.query === 'string' ? r.query : '', types }
}

// searchAttraction — 查詢工具:先呼叫 fetchPlanAiPlaceSearch 查
// query 這個地名的座標(任意地名,不限資料庫已建檔的固定景點),查到後
// 用這個座標呼叫 fetchPlanAiAttractionSearch(GET
// /internal/geo/plan-ai/attraction-search,見後端 handlePublicGeoAttractionSearch
// 的完整說明)取得附近的景點候選——資料庫已建檔候選不足 10 筆時,後端
// 會自動用 Google Nearby Search 補上不重複的點,前端這裡不需要知道
// 候選來源,也不需要自己算距離排序(不再需要 computeNearbyAttractions,
// 見檔頭「第五次重構」的完整說明)。
//
// 回傳形狀刻意把「查到的地點本身」跟「附近候選」分開兩個欄位,不是
// 把錨點也塞進 nearby 陣列裡——LLM 呼叫這個工具的意圖通常是「使用者
// 剛提到的這個地點」本身就要考慮加入行程,鄰近候選只是額外的建議,
// 兩者的角色不同,分開回傳讓 LLM 更容易組出「已加入 XX,順便附近還有
// YY/ZZ 可以參考」這類自然語言回覆,而不用自己從一份扁平清單裡猜測
// 哪一筆是主要查詢結果。
//
// query 查無結果時(found:false)回傳一個帶 found:false 的物件而非
// throw——這是正常的「查無此地」情境(理由同後端 handlePublicGeoPlaceSearch
// 的完整說明),讓 LLM 能自然接續對話(例如請使用者換個關鍵字),不是
// 系統錯誤。
// onPlacesFound——查到候選時的回報(選填)。呼叫端用它把候選寫進景點池
// (見 planning/conversation/attractionPoolStore.ts 的完整說明)。選填是為了不強迫
// 每個呼叫端都要準備一個池子——展示頁的假資料路徑就不需要。
export function createSearchAttraction(
  cfg: ClientConfig,
  onPlacesFound?: (places: { placeId: string; name: string; summary?: string; category?: string; lat?: number; lng?: number; source: 'search' | 'preset' }[]) => void,
): ClientTool<AttractionStepsCtx> {
  return defineTool(
    'search_attraction',
    parseSearchAttractionArgs,
    async (args) => {
      const result = await fetchPlanAiPlaceSearch(cfg, args.query)
      if (!result.found || result.lat == null || result.lng == null) {
        return { found: false }
      }

      // 鄰近候選查詢失敗(例如網路問題)不該讓整個查詢結果失敗——這個
      // 工具的核心價值是「查到座標」,鄰近候選是加值資訊,查不到就回傳
      // 空陣列,理由同 tools.ts 其餘查詢失敗時的既有降級慣例。
      //
      // 2026-09 使用者明確要求「LLM 選擇的時候用 placeId」——這裡回傳
      // placeId(給 add_attraction 用來查詢完整資料)、name/summary/
      // category(給 LLM 判斷要不要推薦、怎麼用自然語言描述這個候選),
      // 拿掉 lat/lng——這些欄位插入行程時由 addStop 呼叫
      // fetchPlanAiPlaceDetailsAny 反查取得,不需要 LLM 中途攜帶。
      // 沒有 placeId 的候選(理論上不該出現,後端已經在
      // handlePublicGeoAttractionSearch 內部過濾掉沒有 place_id 的
      // 資料庫紀錄,見該函式的完整說明)直接過濾掉——沒有 placeId 就
      // 無法讓 LLM 之後引用來加入行程,回傳這種候選只會誤導 LLM 以為
      // 推薦了一個可以加入的地點。
      let nearby: { placeId: string; name: string; summary?: string; category?: string }[] = []
      try {
        const { attractions } = await fetchPlanAiAttractionSearch(cfg, result.lat, result.lng, args.types)
        nearby = attractions
          .filter((a) => !!a.placeId)
          .map((a) => ({
            placeId: a.placeId!,
            name: a.name,
            summary: a.summary,
            category: a.category,
          }))
      } catch {
        nearby = []
      }

      // 把查到的候選寫進景點池(2026-10,使用者明確要求「中間都會觸發
      // attraction-search 這是一個景點池,AI 也可以取用,應該要先讓 AI
      // 存取景點池自行對照」)。
      //
      // 之後 LLM 用 get_attraction_pool 就能把一個 placeId 對照成名稱
      // 與摘要,不需要為了查一個名稱重新呼叫這支工具(那會多打一次
      // Google Places,而且回來的候選不保證跟這次一樣)。
      //
      // 連同錨點本身一起寫入:使用者說「幫我排赤崁樓附近」時,赤崁樓
      // 本身也是個可以被加入行程的地點,不只是用來定位的座標。
      onPlacesFound?.([
        ...(result.placeId
          ? [{ placeId: result.placeId, name: result.name ?? '', lat: result.lat, lng: result.lng, source: 'search' as const }]
          : []),
        ...nearby.map((n) => ({ ...n, source: 'search' as const })),
      ])

      return {
        found: true,
        name: result.name,
        address: result.address,
        placeId: result.placeId,
        lat: result.lat,
        lng: result.lng,
        nearby,
      }
    },
  )
}

// AddAttractionArgs/parseAddAttractionArgs — add_attraction 的 args 型別
// 與 runtime 驗證,對齊 add_attraction.yaml(attractionId 必填、
// anchorId/time 選填)。
//
// 2026-09 第三次重構(使用者要求「add_attraction 不用送太多資訊,placeId
// 跟時間就可以,其他資訊由前端再做查詢」)一度讓這裡直接 await
// fetchPlanAiPlaceDetailsAny 查完整資料才插入——但這代表每次
// add_attraction 呼叫都會多觸發一次 Google Place Details API 呼叫,
// 而這支端點共用既有的全域 "places.get" 限流(10 秒視窗內最多 1 次,見
// handlePublicGeoPlaceDetailsAny 的完整說明),真實使用情境「一次連續
// 加入多個景點」必然在數百毫秒內連續呼叫 add_attraction 好幾次,直接
// 撞上這個限流導致後面的呼叫全部失敗(見這次真實 log:兩次 add_attraction
// 間隔僅 602ms,第二次以「查詢過於頻繁」失敗)。
//
// 2026-09 第四次重構:使用者進一步釐清「不用帶其他資訊,只要加入檢查
// 通過就回覆 LLM,前端再接著做反查,只是 LLM 不用管後半段」——這裡不再
// await 任何後端查詢,只用 placeId 插入一個佔位節點,
// 立刻回傳成功。反查完全移到 ctx.addStop 內部背景執行,
// 這個工具呼叫本身的耗時只剩「鏈結插入 + 時間範圍驗證」這個同步、免費
// 的本地運算,不再受任何 Google API 限流影響,LLM 可以放心連續呼叫多次
// add_attraction 而不會遇到限流錯誤。
//
// 2026-09 第五次重構(曾經存在,已撤回):曾經一度把 placeId 改成
// attractionId(資料庫景點區域 id),插入後兩段式查詢(先查資料庫
// attraction、再視情況查 Google 補強)。後來因為 search_attraction 的
// 鄰近候選要涵蓋資料庫沒有建檔的地點(Google Nearby Search 補上的點沒有
// 資料庫 id 可用),這個設計撐不住,撤回改回 placeId(見檔頭「第四/五次
// 重構」的完整說明)。
//
// 2026-09 第六次重構(這次,回到 placeId):插入後 addStop
// 直接呼叫 fetchPlanAiPlaceDetailsAny(placeId)單段查詢——該端點內部
// 本來就會優先查一次資料庫 attraction(見 handlePublicGeoPlaceDetailsAny
// 的完整說明,查得到就優先用資料庫資料,查不到才 fallback 查 Google),
// 不需要這個工具檔案或前端呼叫端自己判斷要不要查 Google、也不需要兩段
// 式查詢。
//
// anchorId——要插在哪個既有時間軸節點的「後面」。若要插在時間軸最前面
// (例如這是行程的第一站),傳 null 或省略這個欄位——省略不等於「接在
// 最後面」。若要接在某個已加入的站點之後,傳那個站點的 id(該 id 就是
// 這個工具先前呼叫成功時回傳結果裡的 id 欄位)。schema 裡 anchorId 是
// 選填字串,但允許傳字面上的 "null"(字串)來表達「插在最前面」——LLM
// 產生的工具呼叫參數是 JSON,無法保證一定會正確傳遞 JSON null 而非省略
// 欄位或傳空字串,這裡統一寬鬆處理:未提供、空字串、或字面 "null" 都
// 視為插在最前面。
interface AddAttractionArgs {
  placeId: string
  anchorId: string | null
  time?: string
  // day——選填,放進第幾天(從 1 起算,不夠會補空的天);省略時放進錨點所在的那天(沒有錨點是第 1 天)。
  day?: number
}
function parseAddAttractionArgs(raw: unknown): AddAttractionArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  const rawAnchor = r.anchorId
  const anchorId =
    typeof rawAnchor === 'string' && rawAnchor !== '' && rawAnchor !== 'null' ? rawAnchor : null
  return {
    placeId: typeof r.placeId === 'string' ? r.placeId : '',
    anchorId,
    time: typeof r.time === 'string' && r.time ? r.time : undefined,
    day: (() => {
      const n = typeof r.day === 'string' ? Number(r.day) : r.day
      return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined
    })(),
  }
}

// addAttraction — 新增工具:只用 placeId 插入一個
// 佔位節點(見 ctx.addStop 的完整說明——這裡傳入的 data
// 不含 name/lat/lng,呼叫端負責識別「有 placeId 但沒有 name」代表
// 需要背景反查,並在節點狀態表標 loading),不 await 任何後端查詢,立刻透過
// ctx.addStop(anchorId 指定的位置)插入時間軸並回傳。
//
// placeId 缺漏時直接 throw——這代表 LLM 沒有先呼叫 search_attraction
// 查到有效 placeId 就直接猜測呼叫,是使用方式錯誤,讓錯誤透過 defineTool
// 既有的錯誤處理路徑往上拋,回報給 LLM 知道需要先查詢。
//
// addStop 回傳 ok:false 時(anchor_not_found/
// invalid_time_format/time_out_of_range,見 timeline/model.ts 的
// InsertAfterErrorCode)同樣直接 throw,把該介面組好的人類可讀錯誤
// 訊息原樣帶出去——LLM 收到這個錯誤後,該知道要嘛換一個錨點、要嘛調整
// 時間再重試一次 add_attraction,不會出現「工具呼叫看起來成功、但
// 實際上什麼都沒插入」這種靜默失敗。這個檢查(anchorId 是否存在、時間
// 是否落在合理範圍)是純本地鏈結運算,不涉及任何網路呼叫,可以安全地
// 立即同步完成、不受限流影響。
//
// 不再需要 cfg(ClientConfig)才能建立——這個工具本身不再直接打任何
// API,故改回模組層級的固定常數,不是工廠函式(對比 createSearchAttraction
// 仍需要 cfg 呼叫 fetchPlanAiPlaceSearch/fetchPublicGeoAttractions)。
export const addAttraction: ClientTool<AttractionStepsCtx> = defineTool(
  'add_attraction',
  parseAddAttractionArgs,
  async (args, ctx) => {
    if (!args.placeId) {
      throw new Error('缺少 placeId,請先用 search_attraction 查詢地點資料。')
    }
    const result = await ctx.addStop(args.anchorId, {
      type: 'stop',
      time: args.time,
      day: args.day,
      placeId: args.placeId,
      // name 給一個通用佔位文字(而非留 undefined)——卡片標題
      // (.stopName,見 planning/preview/Content.tsx 的渲染邏輯)直接輸出
      // p.name,留空會讓卡片顯示一個沒有標題、只有底下「查詢地點中…」
      // 小標籤的空白狀態,體驗不佳。查詢完成後(見
      // planning/preview/Content.tsx addStop 觸發的
      // resolveAttractionForStep)這個佔位值會被真實地點名稱覆蓋。
      name: '查詢中…',
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { id: result.id, time: args.time, anchorId: args.anchorId, day: args.day }
  },
)

// AddNoteArgs/parseAddNoteArgs — add_note 的 args 型別與 runtime 驗證。
// anchorId 必填(要把備註寫在哪個既有景點節點上——某次 add_attraction
// 呼叫成功後回傳的 id;命名對齊 AddAttractionArgs.anchorId,見
// AttractionStepsCtx.setStopNote 的完整說明:兩者都是「時間軸上某個既有
// 節點的 id」,不因為插入節點/附加在節點上這個語意差異另外發明命名。
// 這裡沒有「省略代表插在最前面」這種語意,備註一定要有明確的掛載
// 對象,故型別是必填的 string,不像 add_attraction 的 anchorId 允許
// null);text 必填(備註內容本身,LLM 用來解釋「為什麼這樣安排」的
// 自然語言說明);category 選填,語意層級的分類字串(例如「取捨考量/
// 一般提醒/花費估算/天氣考量」,實際合法值與對應的顏色/圖示由
// ctx.setStopNote 的實作端——行程安排元件——決定,見
// AttractionStepsCtx.setStopNote 的完整說明,這個檔案不內建、不驗證
// 分類表)。
interface AddNoteArgs {
  anchorId: string
  text: string
  category?: string
}
function parseAddNoteArgs(raw: unknown): AddNoteArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    anchorId: typeof r.anchorId === 'string' ? r.anchorId : '',
    text: typeof r.text === 'string' ? r.text : '',
    category: typeof r.category === 'string' ? r.category : undefined,
  }
}

// addNote — 新增工具:讓 LLM 能把一則文字備註寫在時間軸上某個既有景點
// 節點自己身上,用來說明「為什麼這樣安排行程」這類考量或建議——例如
// 取捨理由、花費估算、天氣影響、一般提醒。對齊使用者需求「備註寫在
// 景點的節點上」。
//
// 2026-09 重構(這次):使用者明確要求「排程元件提供一個操作資料的
// 方法,LLM 的工具透過這些方法操作排程內的資料」——這個工具本身不再
// 決定 note 該對應什麼顏色/圖示(原本內建一份 NOTE_STYLES 對照表直接
// 組 PlanNodeData 丟給 ctx.addStop 插入獨立節點),改成
// 呼叫 ctx.setStopNote(語意層級的方法,由 planning/preview/Content.tsx 的
// addNoteToTimeline 提供,見該函式的完整說明)——「把備註寫在哪個節點
// 上、分類要怎麼轉譯成視覺樣式」完全交給行程安排元件決定,這個工具
// 檔案只負責把 LLM 的 args 轉成呼叫這個語意層級方法所需的形狀,不自己
// 碰任何 PlanNodeData 欄位或視覺樣式細節——對稱 add_attraction 早已
// 不自己組陣列/插入邏輯,只呼叫元件提供的介面的既有設計原則。
//
// anchorId/text 缺漏時直接 throw——沒有掛載對象或空白備註都沒有意義,
// 讓錯誤透過 defineTool 既有的錯誤處理路徑往上拋,回報給 LLM 知道需要
// 補齊參數再重試。ctx.setStopNote 回傳 ok:false 時(anchor_not_found,
// anchorId 不是時間軸上既有節點的 id)同樣直接 throw,原樣帶出人類可讀
// 錯誤訊息。
export const addNote: ClientTool<AttractionStepsCtx> = defineTool(
  'add_note',
  parseAddNoteArgs,
  async (args, ctx) => {
    if (!args.anchorId) {
      throw new Error('缺少 anchorId,請提供要寫入備註的景點節點 id。')
    }
    if (!args.text) {
      throw new Error('缺少備註內容(text),請提供要顯示的說明文字。')
    }
    const result = await ctx.setStopNote(args.anchorId, args.text, args.category)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { id: result.id }
  },
)

// RemoveAttractionArgs/parseRemoveAttractionArgs — remove_attraction 的
// args 型別與 runtime 驗證,對齊 remove_attraction.yaml。id 必填——這個
// id 跟 add_attraction 回傳、list_itinerary 查詢結果裡每個節點的 id 是
// 同一種識別碼(時間軸節點 id),不是 placeId,理由同 AddNoteArgs.anchorId
// 的既有說明(命名不同是因為語意不同:這裡代表「要整個移除的目標節點」,
// 不是「接在誰後面/附加在誰身上」),但指向的都是同一份節點 id 空間。
interface RemoveAttractionArgs {
  id: string
}
function parseRemoveAttractionArgs(raw: unknown): RemoveAttractionArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return { id: typeof r.id === 'string' ? r.id : '' }
}

// removeAttraction — 新增工具:讓 LLM 能把時間軸上某一站整個移除(對齊
// 使用者需求「刪除已經排入時間軸的景點」)。id 缺漏時直接 throw(同其餘
// 工具對必填參數缺漏的既有處理慣例)。ctx.removeStop 回傳 ok:false 時
// (anchor_not_found,id 不是時間軸上既有節點的 id)同樣直接 throw,把
// 人類可讀錯誤訊息原樣帶出去——不讓 LLM 誤以為移除已經生效。
//
// 立即回傳(不等待 REMOVE_FADE_MS 淡出動畫播完)——見
// AttractionStepsCtx.removeStop 的完整說明,LLM 只需要知道移除指令已經
// 受理,不需要、也不該等待純視覺動畫結束。
export const removeAttraction: ClientTool<AttractionStepsCtx> = defineTool(
  'remove_attraction',
  parseRemoveAttractionArgs,
  async (args, ctx) => {
    if (!args.id) {
      throw new Error('缺少 id,請提供要移除的景點節點 id(add_attraction 回傳的 id,或 list_itinerary 查詢結果裡的 id)。')
    }
    const result = await ctx.removeStop(args.id)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { id: args.id, removed: true }
  },
)

// listItinerary — 新增工具:讓 LLM 能查詢目前時間軸上已經排入的完整
// 節點清單(依現有順序,含每個 stop 的 id/time/name/note)。
//
// 2026-09 真實踩坑記錄(見 server/tmp/logs 底下實際對話紀錄):LLM 在
// 完全不知道時間軸現況的情況下,單靠自己記住的對話上下文猜測某個節點
// 的 anchorId 與其後一站的時間關係——一次真實案例裡,LLM 已經呼叫
// add_attraction 插入「台南孔廟」(10:00,插在最前面,成為新的 head),
// 但它不知道原本的 head「赤崁樓」(10:00,屬於它在對話裡認知的「第一
// 天」)因此變成孔廟的下一站,之後想在孔廟後面插入「林百貨」
// (14:00,它認知的「第二天下午」)時,連續 4 次收到一模一樣的
// time_out_of_range 錯誤(insertAfter 判定 14:00 晚於下一站赤崁樓的
// 10:00),因為它沒有能力自己查詢「孔廟後面接的到底是哪一站」,只能
// 不斷用同樣的參數重試——這個工具就是要補上這個查詢現況的能力,讓 LLM
// 在呼叫 add_attraction/add_note 前,或收到 anchor_not_found/
// time_out_of_range 這類需要對照現況才能修正的錯誤後,能主動查一次
// 現有時間軸,而不是憑對話記憶猜測、或反覆用同樣的錯誤參數重試。
//
// 回傳是依天分組的結構(對應時間軸本身的 days):每一天一個 { day, steps },day 從 1 起算,空的天也會出現(steps 為空陣列),
// LLM 因此能直接看到「第幾天有哪些站」,不必從 time 欄位或對話脈絡推斷;要在空的天加站就用 add_attraction 的 day 參數
// (anchorId 省略或 null),要接在某一站後面就帶那一站的 id。
//
// 回傳形狀只挑 LLM 真正需要拿來組下一次工具呼叫參數的欄位(id/type/
// time/kind/duration/placeId/name/note),不是把 PlanStepLike 完整欄位(thumbBg/thumbIcon/
// tags/lat/lng 等純視覺呈現用的欄位)都吐出去——那些欄位對 LLM 決定
// anchorId、判斷時間順序毫無幫助,徒增回應大小與 LLM 需要解析的雜訊。
export const listItinerary: ClientTool<AttractionStepsCtx> = defineTool(
  'list_itinerary',
  () => ({}),
  async (_args, ctx) => {
    const timeline = ctx.getTimeline()
    return {
      // lodgings——住宿(獨立於各天的站點):每筆旅館的 id、placeId、name 與停留的第幾天(含入住日與退房日,由天的位置推算)。
      // 要改停留日用 set_lodging(帶這裡的 id 或同一個 placeId),要移除用 remove_lodging。
      lodgings: lodgingsOf(timeline).map((l) => ({
        id: l.id,
        placeId: l.placeId,
        name: l.name,
        days: lodgingDayNumbers(timeline, l),
      })),
      days: timeline.days.map((d, i) => ({
        day: i + 1,
        steps: d.nodes.map((s) => ({
          id: s.id,
          time: s.time,
          // kind/duration/placeId——讓 LLM「理解現有安排」:每站是什麼性質(景點/美食/住宿)、排多久,以及 placeId 用來避免重複加入同一個地點。
          kind: s.kind,
          duration: s.duration,
          placeId: s.placeId,
          name: s.name,
          note: s.note,
        })),
      })),
    }
  },
)

// AddDayArgs/parseAddDayArgs — add_day 的 args:atDay 選填(從 1 起算,新的一天要成為第幾天,原本那天與之後順延;
// 省略、0、空字串、非整數或超過「目前天數 + 1」都視為加在最後面,寬鬆處理的理由同 add_attraction 的 anchorId)。
interface AddDayArgs {
  atDay?: number
}
function parseAddDayArgs(raw: unknown): AddDayArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  const n = typeof r.atDay === 'string' ? Number(r.atDay) : r.atDay
  return { atDay: typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined }
}

// addDayTool — 新增一個空的天(之後用 add_attraction 的 day 參數把景點排進去)。回傳新的一天是第幾天與目前總天數。
export const addDayTool: ClientTool<AttractionStepsCtx> = defineTool(
  'add_day',
  parseAddDayArgs,
  async (args, ctx) => {
    const result = await ctx.addDay(args.atDay)
    if (!result.ok) throw new Error(result.error.message)
    return { day: result.day, dayCount: result.dayCount }
  },
)

// MoveDayArgs/parseMoveDayArgs — move_day 的 args:fromDay、toDay 必填(都從 1 起算的整數)。缺漏或不是整數直接 throw。
interface MoveDayArgs {
  fromDay: number
  toDay: number
}
function parseMoveDayArgs(raw: unknown): MoveDayArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  const toInt = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v) : v
    return typeof n === 'number' && Number.isInteger(n) ? n : NaN
  }
  return { fromDay: toInt(r.fromDay), toDay: toInt(r.toDay) }
}

// moveDayTool — 調整天的順序:把第 fromDay 天整天(含所有站點)移到第 toDay 天的位置,中間的天順延。
// 天數缺漏或超出範圍時 throw,訊息說明目前有幾天,讓 LLM 先用 list_itinerary 確認再重試。
export const moveDayTool: ClientTool<AttractionStepsCtx> = defineTool(
  'move_day',
  parseMoveDayArgs,
  async (args, ctx) => {
    if (Number.isNaN(args.fromDay) || Number.isNaN(args.toDay)) {
      throw new Error('缺少或不合法的 fromDay/toDay,兩個都必須是從 1 起算的整數(第幾天)。')
    }
    const result = await ctx.moveDay(args.fromDay, args.toDay)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { fromDay: args.fromDay, toDay: args.toDay, dayCount: result.dayCount }
  },
)

// SetLodgingArgs/parseSetLodgingArgs — set_lodging 的 args:placeId 必填(旅館的 Google Place ID)、days 必填(從 1 起算的第幾天,
// 含入住日與退房日,可以不連續;空陣列代表移除這筆旅館)、name/lodgingId 選填。缺漏或型別不對由 handler throw,訊息直接告訴 LLM 怎麼改。
interface SetLodgingArgs {
  placeId: string
  days: number[] | null
  name?: string
  lodgingId?: string
}
function parseSetLodgingArgs(raw: unknown): SetLodgingArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  const days = Array.isArray(r.days)
    ? r.days.map((d) => {
        const n = typeof d === 'string' ? Number(d) : d
        return typeof n === 'number' && Number.isInteger(n) ? n : NaN
      })
    : null
  return {
    placeId: typeof r.placeId === 'string' ? r.placeId.trim() : '',
    days,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : undefined,
    lodgingId: typeof r.lodgingId === 'string' && r.lodgingId.trim() ? r.lodgingId.trim() : undefined,
  }
}

// setLodgingTool — 設定住宿(旅館住哪幾天)。住宿是獨立的資料,不是天裡的站點:不要用 add_attraction 加住宿站。
// 同一個 placeId(或 lodgingId)已有旅館時是更新它的停留日(upsert);days 傳空陣列代表移除。
// 天數超出範圍時 throw,訊息說明目前有幾天(同 move_day),讓 LLM 先用 list_itinerary 確認再重試。
export const setLodgingTool: ClientTool<AttractionStepsCtx> = defineTool(
  'set_lodging',
  parseSetLodgingArgs,
  async (args, ctx) => {
    if (!args.placeId) {
      throw new Error('缺少 placeId,請提供旅館的 Google Place ID(search_attraction 查到的 placeId)。')
    }
    if (args.days === null || args.days.some((d) => Number.isNaN(d))) {
      throw new Error('缺少或不合法的 days,必須是從 1 起算的整數陣列(第幾天,含入住日與退房日);傳空陣列代表移除這筆旅館。')
    }
    const result = await ctx.setLodging({ placeId: args.placeId, days: args.days, name: args.name, lodgingId: args.lodgingId })
    if (!result.ok) throw new Error(result.error.message)
    if (result.removed) return { removed: true, lodgingId: result.lodgingId }
    return { lodgingId: result.lodgingId, days: result.days, updated: !result.created, dayCount: result.dayCount }
  },
)

// RemoveLodgingArgs — remove_lodging 的 args:lodgingId 必填(list_itinerary 的 lodgings 裡的 id)。
interface RemoveLodgingArgs {
  lodgingId: string
}
function parseRemoveLodgingArgs(raw: unknown): RemoveLodgingArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return { lodgingId: typeof r.lodgingId === 'string' ? r.lodgingId.trim() : '' }
}

// removeLodgingTool — 移除一筆住宿。id 不存在時 throw,訊息列出目前的住宿 id。
export const removeLodgingTool: ClientTool<AttractionStepsCtx> = defineTool(
  'remove_lodging',
  parseRemoveLodgingArgs,
  async (args, ctx) => {
    if (!args.lodgingId) throw new Error('缺少 lodgingId,請提供要移除的住宿 id(list_itinerary 回傳的 lodgings 裡的 id)。')
    const result = await ctx.removeLodging(args.lodgingId)
    if (!result.ok) throw new Error(result.error.message)
    return { removed: true, lodgingId: args.lodgingId }
  },
)

// createAttractionToolsList — 方便呼叫端一次拿到這個檔案定義的所有
// 工具,對齊 tools/index.ts 的 defaultClientTools 既有慣例。
// search_attraction 需要 cfg(ClientConfig)才能建立,
// add_attraction/add_note/list_itinerary(已不再/從不直接打 API)不
// 需要——這裡仍維持工廠函式的形狀,是為了讓呼叫端統一用同一種方式取得
// 完整工具清單,不需要知道各工具是否需要 cfg 這種實作細節。
//
// 唯一呼叫端是 planning/panel/TripPlanPage.tsx(正式功能)——
// planning/preview/Content.tsx(展示原型,使用者明確要求不要修改那份檔案,見
// TripPlanPage.tsx 檔頭的完整說明)完全沒有引用這個函式,不是第二個
// 呼叫端,不要被下面「2026-09」這則歷史註解誤導。
//
// 2026-09:**cfg 必須帶有效的登入 token**——這批工具呼叫的後端端點已從
// 免登入的 /public/geo/* 搬到需登入的 /internal/geo/plan-ai/*(見
// api.ts 的 fetchPlanAi* 系列與後端 geo_plan_ai.go 的完整說明),傳
// token: null 的訪客 cfg 會讓每次工具呼叫都拿到 401。
export function createAttractionToolsList(
  cfg: ClientConfig,
  // onPlacesFound——見 createSearchAttraction 同名參數的完整說明。
  onPlacesFound?: Parameters<typeof createSearchAttraction>[1],
): ClientTool<AttractionStepsCtx>[] {
  return [createSearchAttraction(cfg, onPlacesFound), addAttraction, addNote, removeAttraction, addDayTool, moveDayTool, setLodgingTool, removeLodgingTool, listItinerary]
}
