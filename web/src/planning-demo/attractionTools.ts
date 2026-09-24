// attractionTools.ts — /plan-ai 對話窗給 onagent 用的兩個工具:
// search_attraction(查詢任意地名,取得座標與鄰近候選)、add_attraction
// (把查到的地點插入時間軸)。沿用專案既有的 sdk-proposals/defineTool
// 模式(見 tripEntryAdd.ts/tripEntryList.ts 的既有寫法與完整設計說明),
// 不是另起一套——parseArgs 負責把 unknown 的 raw args 轉成型別安全的
// 形狀,handle 只處理已經型別安全的 args + ctx,兩者透過 defineTool 綁定
// 不會不同步。
//
// 與既有 plan_sim_ws.go 模擬 WS 腳本路徑的關係:完全獨立、不共用——
// 使用者已確認這兩條路徑不交集(見設計討論)。這裡的 add_attraction 直接
// 呼叫 ctx.insertAttractionAfter 異動時間軸,不透過 WS action 訊息協議,
// 因為 onagent bridge 本身就是即時雙向的工具呼叫通道,不需要再包一層
// 自訂的 WS 訊息格式去模擬同一件事。
//
// 2026-09 第一次重構:add_attraction 原本直接 ctx.setSteps((prev) =>
// [...prev, newStep]) 把新景點無條件 append 到陣列尾端——不管呼叫端
// (LLM)傳的 time 是幾點,新卡片一律排最後面,導致時間軸畫面上出現時間
// 忽前忽後的錯亂順序(見 planTimeline.ts 開頭的完整背景說明)。改成鏈結
// 串列資料結構(planTimeline.ts)後,插入操作收斂成「行程安排元件」
// (AIPlanTimelinePage.tsx)透過 ctx.insertAttractionAfter 提供的單一
// 介面——這個工具不再自己組陣列、自己決定位置,而是明確指定 anchorId
// (要插在哪個既有節點後面,null 代表插在最前面),由該介面統一驗證時間
// 是否落在合理範圍、決定實際插入位置。
//
// 2026-09 第二次重構:search_attraction 原本查的是 attractionPool.ts
// 這個純前端固定假資料池(10 筆寫死的台南景點)——使用者明確要求改成
// 「前端打 attraction 節點取得鄰近清單」:先呼叫新增的公開端點
// fetchPublicGeoPlaceSearch(GET /public/geo/place-search,見後端
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
// 其他資訊由前端再做查詢」。新增 fetchPublicGeoPlaceDetailsAny(GET
// /public/geo/place-details-any,見後端 handlePublicGeoPlaceDetailsAny
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
// fetchPublicGeoAttractionSearch(GET /public/geo/attraction-search,
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

import type { ClientTool } from '../sdk-proposals/arrayTools'
import { defineTool } from '../sdk-proposals/defineTool'
import { fetchPublicGeoAttractionSearch, fetchPublicGeoPlaceSearch, type ClientConfig } from '../api'
import type { InsertAfterError } from './planTimeline'

// AttractionStepsCtx — add_attraction 需要的 context:一個能讀取時間軸
// 現況、並且插入新節點的口子。刻意不是完整的 AIPlanTimelinePage state
// (不含 isGenerating/following 等其餘 UI state),只暴露這個工具真正
// 需要的最小介面,理由同 tripEntryAdd.ts 的 TripEntryAddCtx 設計說明。
//
// insertAttractionAfter 是這裡唯一的寫入口——「機制跟介面由行程安排
// 元件提供」:鏈結串列的構建、時間驗證、prevId/nextId 維護全部收在
// AIPlanTimelinePage.tsx(呼叫 planTimeline.ts 的 insertAfter),這個
// 工具檔案只負責把 args 轉成呼叫這個介面所需的形狀、以及把失敗結果轉成
// 拋給 LLM 的錯誤訊息,不自己碰鏈結細節。
// addNote——同樣由行程安排元件提供,但不是「插入新節點」這種操作,而是
// 語意層級的「把一則備註寫在某個既有景點節點上」方法(對齊
// AIPlanTimelinePage.tsx 的 addNoteToTimeline)。這是使用者明確要求的
// 兩層架構:排程元件本身提供操作資料的方法(addNoteToTimeline),LLM 的
// 工具透過這些方法操作排程內的資料,不是工具自己組好 PlanNodeData 形狀
// 直接丟給底層的 insertAttractionAfter。
//
// 2026-09 重構(這次):使用者明確要求「備註寫在景點的節點上」——note
// 不再是鏈結串列裡獨立插入的節點,改成掛在既有節點自己身上的欄位(見
// planTimeline.ts NoteInfo 的完整說明)。
//
// 2026-09 再次修正:這裡原本用 stopId 這個獨立命名指稱「要附加備註的
// 既有節點 id」,跟 insertAttractionAfter 的 anchorId 是同一種東西——
// 都是「時間軸上某個既有節點的 id」,只是插入節點時代表「接在它後面」、
// 這裡代表「附加在它身上」。使用者明確要求「agent tool 發出的參數名稱
// 保持一致,像是要附加在節點上的就要用 anchorId,不要創造多餘的命名」
// ——統一改回 anchorId,不因為語意細節不同就另外發明一個名字,LLM 與
// 這個檔案的呼叫端只需要記住一種「指向既有節點」的參數名。
//
// 型別是 string(不像 insertAttractionAfter 的 anchorId 是
// string | null)——這裡沒有「插在時間軸最前面」這種語意,備註一定要有
// 明確的掛載對象,不存在「沒有目標節點的備註」這種情境,故不開放 null。
//
// category 決定備註顯示的顏色/圖示,對照表由元件這一層決定(元件內部的
// NOTE_STYLES,見 AIPlanTimelinePage.tsx 的完整說明),這裡的工具檔案
// 只傳語意層級的 category 字串,不需要知道視覺樣式怎麼對照。回傳值不再
// 是新節點 id(沒有新節點被建立),而是被寫入備註的那個 anchorId 本身,
// 方便 LLM 確認操作對象。
export interface AttractionStepsCtx {
  getSteps: () => PlanStepLike[]
  insertAttractionAfter: (
    anchorId: string | null,
    step: Omit<PlanStepLike, 'id'>,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: InsertAfterError }>
  addNote: (
    anchorId: string,
    text: string,
    category: string | undefined,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: InsertAfterError }>
}

// PlanStepLike — 這個檔案不 import AIPlanTimelinePage.tsx 的 PlanStep
// (避免循環依賴:AIPlanTimelinePage.tsx 需要 import 這裡定義的工具),
// 改宣告一個結構相容的最小子集——只列出 add_attraction 實際會寫入的
// 欄位。呼叫端(AIPlanTimelinePage.tsx)實際操作的是完整的 PlanStep,
// 但因為 TypeScript 結構化型別,傳一個「需要的比較少」的型別進去,
// 呼叫端只要在型別上相容(額外欄位視為 optional 或由呼叫端自己補齊)
// 就能接受,不需要這裡知道 PlanStep 完整的形狀。
export interface PlanStepLike {
  id: string
  type: 'section' | 'stop'
  time?: string
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  lat?: number
  lng?: number
  // placeId/loading——addAttraction(見該常數的完整說明)插入佔位節點
  // 時需要的兩個欄位:placeId 標記這筆需要背景反查,loading 驅動 UI
  // 顯示查詢中狀態(見 AIPlanTimelinePage.tsx PlanNodeData 對應欄位的
  // 完整說明)。
  placeId?: string
  loading?: boolean
  // note——這個節點自己的備註(見 planTimeline.ts NoteInfo 的完整說明),
  // addNote(見該常數的完整說明)透過 ctx.addNote 寫入既有節點的這個
  // 欄位,不是插入新節點。
  note?: { text: string; category?: string }
}

// SearchAttractionArgs/parseSearchAttractionArgs — search_attraction 的
// args 型別與 runtime 驗證,對齊 onagent tool 定義(search_attraction.yaml)
// 的 parameters schema(query 必填字串)。
interface SearchAttractionArgs {
  query: string
}
function parseSearchAttractionArgs(raw: unknown): SearchAttractionArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return { query: typeof r.query === 'string' ? r.query : '' }
}

// searchAttraction — 查詢工具:先呼叫 fetchPublicGeoPlaceSearch 查
// query 這個地名的座標(任意地名,不限資料庫已建檔的固定景點),查到後
// 用這個座標呼叫 fetchPublicGeoAttractionSearch(GET
// /public/geo/attraction-search,見後端 handlePublicGeoAttractionSearch
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
export function createSearchAttraction(cfg: ClientConfig): ClientTool<AttractionStepsCtx> {
  return defineTool(
    'search_attraction',
    parseSearchAttractionArgs,
    async (args) => {
      const result = await fetchPublicGeoPlaceSearch(cfg, args.query)
      if (!result.found || result.lat == null || result.lng == null) {
        return { found: false }
      }

      // 鄰近候選查詢失敗(例如網路問題)不該讓整個查詢結果失敗——這個
      // 工具的核心價值是「查到座標」,鄰近候選是加值資訊,查不到就回傳
      // 空陣列,理由同 attractionTools.ts 其餘查詢失敗時的既有降級慣例。
      //
      // 2026-09 使用者明確要求「LLM 選擇的時候用 placeId」——這裡回傳
      // placeId(給 add_attraction 用來查詢完整資料)、name/summary/
      // category(給 LLM 判斷要不要推薦、怎麼用自然語言描述這個候選),
      // 拿掉 lat/lng——這些欄位插入行程時由 insertAttractionAfter 呼叫
      // fetchPublicGeoPlaceDetailsAny 反查取得,不需要 LLM 中途攜帶。
      // 沒有 placeId 的候選(理論上不該出現,後端已經在
      // handlePublicGeoAttractionSearch 內部過濾掉沒有 place_id 的
      // 資料庫紀錄,見該函式的完整說明)直接過濾掉——沒有 placeId 就
      // 無法讓 LLM 之後引用來加入行程,回傳這種候選只會誤導 LLM 以為
      // 推薦了一個可以加入的地點。
      let nearby: { placeId: string; name: string; summary?: string; category?: string }[] = []
      try {
        const { attractions } = await fetchPublicGeoAttractionSearch(cfg, result.lat, result.lng)
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
// fetchPublicGeoPlaceDetailsAny 查完整資料才插入——但這代表每次
// add_attraction 呼叫都會多觸發一次 Google Place Details API 呼叫,
// 而這支端點共用既有的全域 "places.get" 限流(10 秒視窗內最多 1 次,見
// handlePublicGeoPlaceDetailsAny 的完整說明),真實使用情境「一次連續
// 加入多個景點」必然在數百毫秒內連續呼叫 add_attraction 好幾次,直接
// 撞上這個限流導致後面的呼叫全部失敗(見這次真實 log:兩次 add_attraction
// 間隔僅 602ms,第二次以「查詢過於頻繁」失敗)。
//
// 2026-09 第四次重構:使用者進一步釐清「不用帶其他資訊,只要加入檢查
// 通過就回覆 LLM,前端再接著做反查,只是 LLM 不用管後半段」——這裡不再
// await 任何後端查詢,只用 placeId 插入一個 loading:true 的佔位節點,
// 立刻回傳成功。反查完全移到 ctx.insertAttractionAfter 內部背景執行,
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
// 2026-09 第六次重構(這次,回到 placeId):插入後 insertAttractionAfter
// 直接呼叫 fetchPublicGeoPlaceDetailsAny(placeId)單段查詢——該端點內部
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
  }
}

// addAttraction — 新增工具:只用 placeId 插入一個 loading:true 的
// 佔位節點(見 ctx.insertAttractionAfter 的完整說明——這裡傳入的 data
// 不含 name/lat/lng,呼叫端負責識別「有 placeId 但沒有 name」代表
// 需要背景反查並補上 loading 狀態),不 await 任何後端查詢,立刻透過
// ctx.insertAttractionAfter(anchorId 指定的位置)插入時間軸並回傳。
//
// placeId 缺漏時直接 throw——這代表 LLM 沒有先呼叫 search_attraction
// 查到有效 placeId 就直接猜測呼叫,是使用方式錯誤,讓錯誤透過 defineTool
// 既有的錯誤處理路徑往上拋,回報給 LLM 知道需要先查詢。
//
// insertAttractionAfter 回傳 ok:false 時(anchor_not_found/
// invalid_time_format/time_out_of_range,見 planTimeline.ts 的
// InsertAfterErrorCode)同樣直接 throw,把該介面組好的人類可讀錯誤
// 訊息原樣帶出去——LLM 收到這個錯誤後,該知道要嘛換一個錨點、要嘛調整
// 時間再重試一次 add_attraction,不會出現「工具呼叫看起來成功、但
// 實際上什麼都沒插入」這種靜默失敗。這個檢查(anchorId 是否存在、時間
// 是否落在合理範圍)是純本地鏈結運算,不涉及任何網路呼叫,可以安全地
// 立即同步完成、不受限流影響。
//
// 不再需要 cfg(ClientConfig)才能建立——這個工具本身不再直接打任何
// API,故改回模組層級的固定常數,不是工廠函式(對比 createSearchAttraction
// 仍需要 cfg 呼叫 fetchPublicGeoPlaceSearch/fetchPublicGeoAttractions)。
export const addAttraction: ClientTool<AttractionStepsCtx> = defineTool(
  'add_attraction',
  parseAddAttractionArgs,
  async (args, ctx) => {
    if (!args.placeId) {
      throw new Error('缺少 placeId,請先用 search_attraction 查詢地點資料。')
    }
    const result = await ctx.insertAttractionAfter(args.anchorId, {
      type: 'stop',
      time: args.time,
      placeId: args.placeId,
      loading: true,
      // name 給一個通用佔位文字(而非留 undefined)——卡片標題
      // (.stopName,見 AIPlanTimelinePage.tsx 的渲染邏輯)直接輸出
      // p.name,留空會讓卡片顯示一個沒有標題、只有底下「查詢地點中…」
      // 小標籤的空白狀態,體驗不佳。查詢完成後(見
      // AIPlanTimelinePage.tsx insertAttractionAfter 觸發的
      // resolveAttractionForStep)這個佔位值會被真實地點名稱覆蓋。
      name: '查詢中…',
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { id: result.id, time: args.time, anchorId: args.anchorId }
  },
)

// AddNoteArgs/parseAddNoteArgs — add_note 的 args 型別與 runtime 驗證。
// anchorId 必填(要把備註寫在哪個既有景點節點上——某次 add_attraction
// 呼叫成功後回傳的 id;命名對齊 AddAttractionArgs.anchorId,見
// AttractionStepsCtx.addNote 的完整說明:兩者都是「時間軸上某個既有
// 節點的 id」,不因為插入節點/附加在節點上這個語意差異另外發明命名。
// 這裡沒有「省略代表插在最前面」這種語意,備註一定要有明確的掛載
// 對象,故型別是必填的 string,不像 add_attraction 的 anchorId 允許
// null);text 必填(備註內容本身,LLM 用來解釋「為什麼這樣安排」的
// 自然語言說明);category 選填,語意層級的分類字串(例如「取捨考量/
// 一般提醒/花費估算/天氣考量」,實際合法值與對應的顏色/圖示由
// ctx.addNote 的實作端——行程安排元件——決定,見
// AttractionStepsCtx.addNote 的完整說明,這個檔案不內建、不驗證
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
// 組 PlanNodeData 丟給 ctx.insertAttractionAfter 插入獨立節點),改成
// 呼叫 ctx.addNote(語意層級的方法,由 AIPlanTimelinePage.tsx 的
// addNoteToTimeline 提供,見該函式的完整說明)——「把備註寫在哪個節點
// 上、分類要怎麼轉譯成視覺樣式」完全交給行程安排元件決定,這個工具
// 檔案只負責把 LLM 的 args 轉成呼叫這個語意層級方法所需的形狀,不自己
// 碰任何 PlanNodeData 欄位或視覺樣式細節——對稱 add_attraction 早已
// 不自己組陣列/插入邏輯,只呼叫元件提供的介面的既有設計原則。
//
// anchorId/text 缺漏時直接 throw——沒有掛載對象或空白備註都沒有意義,
// 讓錯誤透過 defineTool 既有的錯誤處理路徑往上拋,回報給 LLM 知道需要
// 補齊參數再重試。ctx.addNote 回傳 ok:false 時(anchor_not_found,
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
    const result = await ctx.addNote(args.anchorId, args.text, args.category)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    return { id: result.id }
  },
)

// createAttractionToolsList — 方便呼叫端一次拿到這個檔案定義的所有
// 工具,對齊 tools/index.ts 的 defaultClientTools 既有慣例。
// search_attraction 需要 cfg(ClientConfig,呼叫公開端點用)才能建立,
// add_attraction/add_note(已不再/從不直接打 API)不需要——這裡仍維持
// 工廠函式的形狀,是為了讓呼叫端(AIPlanTimelinePage.tsx)統一用同一種
// 方式取得完整工具清單,不需要知道各工具是否需要 cfg 這種實作細節。
export function createAttractionToolsList(cfg: ClientConfig): ClientTool<AttractionStepsCtx>[] {
  return [createSearchAttraction(cfg), addAttraction, addNote]
}
