// planningModesData.ts——構想三(依地點特性分化規劃模式)的雛形假資料與
// 型別草稿。對應 brainstorm 文件「先定義模式分類的維度，而非窮舉地名」
// 的延伸方案:不用「九份模式」「赤崁模式」這種地名式命名當作程式碼裡的
// 分類依據,改成抽象出的判斷維度組合——這裡示範兩種維度組合各自對應的
// 呈現模式,UI 層依這組維度決定該用哪種卡片呈現,而非寫死地名對照表。

// PlanningDimensions——文件提到的三個判斷維度:景點密度、時間敏感度、
// 主要訴求。真正落地時,這應該是 LLM 幫每個節點打分數的輸出欄位,這裡
// 先用型別草稿表達「這組維度長什麼樣子」,不是最終定案的欄位名稱。
export interface PlanningDimensions {
  // density——景點密度:'sparse'(稀疏閒逛,例如一天只去 3-5 個點、路線
  // 本身就是體驗的一部分)或 'dense'(密集移動,一天排 6 個點以上)。
  density: 'sparse' | 'dense'
  // timeSensitivity——時間敏感度:'flexible'(不需要精確時刻,隨興走)
  // 或 'strict'(需要精確時刻,後面可能接餐廳訂位/交通時刻)。
  timeSensitivity: 'flexible' | 'strict'
  // focus——主要訴求,對應文件列出的四種類型。
  focus: 'photo' | 'food' | 'culture' | 'shopping'
}

// resolvePresentationMode——依維度組合決定呈現模式的規則草稿。這是雛形
// 階段最簡化的規則(density+timeSensitivity 兩軸決定),真正落地時應該由
// LLM 直接輸出呈現模式,不是前端用規則表硬推——這裡只是先驗證「同一份
// 維度資料可以對應到兩種完全不同的 UI 呈現」這個概念本身站不站得住腳。
export function resolvePresentationMode(dims: PlanningDimensions): 'highlight-map' | 'timeline-list' {
  if (dims.density === 'sparse' && dims.timeSensitivity === 'flexible') return 'highlight-map'
  return 'timeline-list'
}

export interface PlanningModeStop {
  name: string
  // time——'highlight-map' 模式下可能沒有精確時間,只有建議順序
  // (walkMinutesFromPrev),'timeline-list' 模式下才有明確時刻。
  time?: string
  walkMinutesFromPrev?: number
  reason: string
}

export interface PlanningModeExample {
  id: string
  title: string
  dims: PlanningDimensions
  stops: PlanningModeStop[]
}

export const PLANNING_MODE_EXAMPLES: PlanningModeExample[] = [
  {
    id: 'jiufen',
    title: '九份老街散策',
    dims: { density: 'sparse', timeSensitivity: 'flexible', focus: 'photo' },
    stops: [
      { name: '九份老街入口', walkMinutesFromPrev: 0, reason: '散步路線起點，階梯式老街最經典的視角' },
      { name: '阿妹茶樓', walkMinutesFromPrev: 5, reason: '《神隱少女》取景地，必拍打卡點' },
      { name: '九份芋圓', walkMinutesFromPrev: 10, reason: '在地排隊名店，邊走邊吃不耽誤行程' },
      { name: '豎崎路看夜景', walkMinutesFromPrev: 15, reason: '黃昏後最佳拍照時段，九份經典階梯夜景' },
    ],
  },
  {
    id: 'chikan',
    title: '台南赤崁文化半日',
    dims: { density: 'dense', timeSensitivity: 'strict', focus: 'culture' },
    stops: [
      { name: '赤崁樓', time: '08:30', reason: '一早抵達避開團客，門票含導覽約 1 小時' },
      { name: '度小月擔仔麵', time: '11:30', reason: '午餐時段訂位，避免等候超過 30 分鐘' },
      { name: '林百貨', time: '14:00', reason: '下午場次人潮較少，頂樓神社需預留 20 分鐘' },
      { name: '國立台灣文學館', time: '16:00', reason: '閉館前最後入場時段，需精確抓時間' },
    ],
  },
]
