// attractionTools.ts — /plan-ai 對話窗給 onagent 用的兩個工具:
// search_attraction(查詢景點池)、add_attraction(把查到的景點加入時間
// 軸)。沿用專案既有的 sdk-proposals/defineTool 模式(見 tripEntryAdd.ts/
// tripEntryList.ts 的既有寫法與完整設計說明),不是另起一套——parseArgs
// 負責把 unknown 的 raw args 轉成型別安全的形狀,handle 只處理已經型別
// 安全的 args + ctx,兩者透過 defineTool 綁定不會不同步。
//
// 這是使用者明確要求的「新增景點跟查詢景點兩個工具」「前端先做一個假的
// 景點池讓 agent 可以查詢」的落地——景點池本身在 attractionPool.ts(純
// 前端固定資料,不打任何後端 API),這裡是操作這份資料池、以及把結果
// 異動進 AIPlanTimelinePage 時間軸 state 的工具定義。
//
// 與既有 plan_sim_ws.go 模擬 WS 腳本路徑的關係:完全獨立、不共用——
// 使用者已確認這兩條路徑不交集(見設計討論)。這裡的 add_attraction 直接
// 呼叫 ctx.setSteps 異動時間軸陣列,不透過 WS action 訊息協議,因為
// onagent bridge 本身就是即時雙向的工具呼叫通道,不需要再包一層自訂的
// WS 訊息格式去模擬同一件事。

import type { ClientTool } from '../sdk-proposals/arrayTools'
import { defineTool } from '../sdk-proposals/defineTool'
import { ATTRACTION_POOL, findAttraction, getAttractionById } from './attractionPool'

// AttractionStepsCtx — add_attraction 需要的 context:一個能讀寫時間軸
// steps 陣列的口子。刻意不是完整的 AIPlanTimelinePage state(不含
// isGenerating/following 等其餘 UI state),只暴露這個工具真正需要的
// 最小介面,理由同 tripEntryAdd.ts 的 TripEntryAddCtx 設計說明——呼叫端
// (AIPlanTimelinePage.tsx)真正傳進來的物件可以帶更多欄位,這裡只讀取
// 用得到的那兩個。
//
// setSteps 簽章比照 React 的 Dispatch<SetStateAction<T>>(接受新陣列或
// updater 函式),這裡固定傳 updater 形式((prev) => [...prev, newStep]),
// 理由同 usePlanSimSocket 既有的 setSteps 呼叫慣例——用 updater 才能保證
// 基於最新的 prev 狀態疊加,不會因為 onagent 工具呼叫跟其他 state 更新
// (例如 WS 模擬腳本、使用者點擊測試按鈕)之間的時序競態而蓋掉彼此的
// 異動。
export interface AttractionStepsCtx {
  getSteps: () => PlanStepLike[]
  setSteps: (updater: (prev: PlanStepLike[]) => PlanStepLike[]) => void
}

// PlanStepLike — 這個檔案不 import AIPlanTimelinePage.tsx 的 PlanStep
// (避免循環依賴:AIPlanTimelinePage.tsx 需要 import 這裡定義的工具),
// 改宣告一個結構相容的最小子集——只列出 add_attraction 實際會寫入的
// 欄位。呼叫端(AIPlanTimelinePage.tsx)的 setSteps 實際操作的是完整的
// PlanStep[],但因為 TypeScript 結構化型別,傳一個「需要的比較少」的
// updater 型別進去,呼叫端只要在型別上相容(額外欄位視為 optional 或由
// 呼叫端自己補齊)就能接受,不需要這裡知道 PlanStep 完整的形狀。
export interface PlanStepLike {
  id: string
  type: 'section' | 'stop' | 'transit' | 'note'
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

// searchAttraction — 查詢工具,實作上不使用 ctx(這是純讀取景點池的
// 操作,不涉及時間軸 state),但型別上宣告成跟 addAttraction 同一個
// ClientTool<AttractionStepsCtx>——而不是留在 defineTool 的預設值
// void。理由:attractionToolsList 這個陣列要同時放兩個工具一起交給
// toAgentBridgeTools(見該函式簽章,單一呼叫只接受一種 Ctx 的
// ClientTool<Ctx>[]),陣列元素型別必須一致;宣告成 ClientTool<void> 在
// 單獨使用時沒問題,但放進混合陣列會被 TypeScript 拒絕(void 到
// AttractionStepsCtx 不是型別相容的方向,即使 handle 本身的 ctx 參數
// 逆變其實是安全的,TS 在陣列元素型別推導這裡不會自動做這個放寬)。
// handle 簽章仍是 (args) => ...,不寫 ctx 參數,呼叫端傳進來的 ctx 單純
// 被忽略,不影響行為。
export const searchAttraction: ClientTool<AttractionStepsCtx> = defineTool(
  'search_attraction',
  parseSearchAttractionArgs,
  (args) => {
    const matches = findAttraction(args.query)
    return matches.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      duration: a.duration,
      desc: a.desc,
      tags: a.tags,
      lat: a.lat,
      lng: a.lng,
    }))
  },
)

// AddAttractionArgs/parseAddAttractionArgs — add_attraction 的 args 型別
// 與 runtime 驗證,對齊 add_attraction.yaml(attractionId 必填、time 選填)。
interface AddAttractionArgs {
  attractionId: string
  time?: string
}
function parseAddAttractionArgs(raw: unknown): AddAttractionArgs {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    attractionId: typeof r.attractionId === 'string' ? r.attractionId : '',
    time: typeof r.time === 'string' && r.time ? r.time : undefined,
  }
}

// addAttraction — 新增工具,依 attractionId 從景點池取出完整資料,組成
// 一筆 stop 型別的 PlanStepLike 附加到時間軸陣列尾端。找不到對應
// attractionId 時直接 throw——這代表 LLM 沒有先呼叫 search_attraction
// 查到有效 id 就直接猜測呼叫,是使用方式錯誤,不是「查無結果」這種正常
// 情境(那是 search_attraction 回空陣列的責任),讓錯誤透過 defineTool
// 既有的錯誤處理路徑往上拋,回報給 LLM 知道這個 id 無效、需要重新查詢。
//
// id 用 `agent-${attractionId}-${Date.now()}` 組成,不是直接沿用
// attractionPool 裡的固定 id——同一個景點池項目理論上可以被呼叫多次加入
// 時間軸(例如使用者先加一次、後來改變心意又要求加同一個地點在不同
// 時段),若直接複用 attractionId 當 PlanStep.id,第二次呼叫會產生
// 重複 id,違反 PlanStep.id 必須在陣列內唯一的既有假設(見
// AIPlanTimelinePage.tsx 的 PlanStep.id 說明——用它做 React key、
// mountedIdsRef 追蹤、selectedStopId 比對等,重複 id 會讓這些機制全部
// 錯亂)。
export const addAttraction: ClientTool<AttractionStepsCtx> = defineTool(
  'add_attraction',
  parseAddAttractionArgs,
  (args, ctx) => {
    const attraction = getAttractionById(args.attractionId)
    if (!attraction) {
      throw new Error(`找不到 id 為 "${args.attractionId}" 的景點,請先用 search_attraction 查詢。`)
    }
    const newStep: PlanStepLike = {
      id: `agent-${attraction.id}-${Date.now()}`,
      type: 'stop',
      time: args.time,
      duration: attraction.duration,
      kind: attraction.kind,
      name: attraction.name,
      desc: attraction.desc,
      thumbBg: attraction.thumbBg,
      thumbIcon: attraction.thumbIcon,
      tags: attraction.tags,
      lat: attraction.lat,
      lng: attraction.lng,
    }
    ctx.setSteps((prev) => [...prev, newStep])
    return { id: newStep.id, name: attraction.name, time: args.time }
  },
)

// attractionToolsList — 方便呼叫端一次拿到這個檔案定義的所有工具,對齊
// tools/index.ts 的 defaultClientTools 既有慣例(雖然這裡目前只有兩個
// 工具、呼叫端也可以直接各自 import,但保留這個陣列讓之後若新增第三個
// 景點相關工具時,呼叫端不需要多改一行 import)。
export const attractionToolsList = [searchAttraction, addAttraction]

// 純粹重新匯出景點池筆數,供偵錯/畫面上顯示「目前景點池共 N 筆」之類的
// 輕量用途,不需要呼叫端另外 import attractionPool.ts。
export const ATTRACTION_POOL_SIZE = ATTRACTION_POOL.length
