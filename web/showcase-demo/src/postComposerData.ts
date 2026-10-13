// postComposerData.ts——構想五(發文工具)的雛形假資料。對應 brainstorm
// 文件「圖片處理 + AI 產文」延伸方案:使用者上傳照片 → AI 去重/排序 →
// 比對行程資料(景點名稱/時間)→ 產生初稿遊記。這裡全部用假資料模擬
// 流程,沒有真的接圖片辨識/AI 產文服務。

export interface MockPhoto {
  id: string
  emoji: string
  // isDuplicate——模擬「去重模糊/重複照片」這個圖片處理步驟的判定結果。
  isDuplicate: boolean
}

export const MOCK_PHOTOS: MockPhoto[] = [
  { id: 'p1', emoji: '🏮', isDuplicate: false },
  { id: 'p2', emoji: '🏮', isDuplicate: true },
  { id: 'p3', emoji: '🍵', isDuplicate: false },
  { id: 'p4', emoji: '🌆', isDuplicate: false },
  { id: 'p5', emoji: '🌆', isDuplicate: true },
  { id: 'p6', emoji: '🍡', isDuplicate: false },
]

export interface MockMatch {
  photoId: string
  // place——AI 分析照片內容後，對照這趟旅程既有行程資料比對出的地點。
  place: string
  time: string
}

export const MOCK_MATCHES: MockMatch[] = [
  { photoId: 'p1', place: '阿妹茶樓', time: '10:30' },
  { photoId: 'p3', place: '阿妹茶樓', time: '10:45' },
  { photoId: 'p4', place: '豎崎路夜景', time: '18:00' },
  { photoId: 'p6', place: '九份芋圓', time: '12:00' },
]

export type DraftStyle = 'concise' | 'lyrical' | 'food-review'

export const DRAFT_STYLE_LABEL: Record<DraftStyle, string> = {
  concise: '簡潔攻略型',
  lyrical: '抒情遊記型',
  'food-review': '美食評論型',
}

export const MOCK_DRAFTS: Record<DraftStyle, { title: string; body: string }> = {
  concise: {
    title: '九份一日散策攻略｜交通＋景點＋美食全整理',
    body: `九份一日遊重點整理：

10:30 阿妹茶樓——必拍打卡點，建議開門後半小時內抵達避開人潮。
12:00 九份芋圓——在地排隊名店，建議外帶邊走邊吃，節省排隊時間。
18:00 豎崎路——黃昏後最佳拍照時段，經典階梯夜景角度在中段平台。

交通建議：從台北車站搭客運約 1 小時，建議避開假日中午時段上山。`,
  },
  lyrical: {
    title: '九份，一座在雲霧裡發光的山城',
    body: `午後的茶樓裡，熱氣從茶壺口緩緩升起，窗外是層疊的屋瓦與遠方的海。
阿妹茶樓的紅燈籠映著天光，彷彿走進了那個熟悉的動畫場景。

沿著石階往下，芋圓的甜香混著海風的鹹味，是九份獨有的味道。

直到華燈初上，整座山城的輪廓才真正顯現——
豎崎路的階梯彷彿永無止盡地向上延伸，每一盞燈都是旅人駐足的理由。`,
  },
  'food-review': {
    title: '九份必吃美食評比｜芋圓、茶樓甜點實測',
    body: `【九份芋圓】★★★★☆
Q 彈有嚼勁，芋頭味明顯不死甜，配料豐富度中上。排隊約 15 分鐘，
建議外帶邊走邊吃更有效率。

【阿妹茶樓・茶點套餐】★★★☆☆
茶的品質中規中矩，但環境與景觀是真正的賣點——
如果只是為了喝茶，CP 值普通；如果想拍照兼休息，非常值得。

總結：九份美食整體偏向「氛圍加分」型，單純論口味精緻度不是最頂尖，
但搭配山城景觀的整體體驗分數很高。`,
  },
}
