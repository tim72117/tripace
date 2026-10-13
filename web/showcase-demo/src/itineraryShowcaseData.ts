// itineraryShowcaseData.ts——構想一(AI 排過的主題行程展示)的雛形假
// 資料。對應 brainstorm 文件裡提到的「唯讀時間軸預覽」「依地區/天數/
// 旅遊類型分類篩選」「行程品質分級」幾個延伸方案,這裡先用最小可行的
// 資料結構表達,不連真實後端——真要落地時,這份資料應該來自實際使用者
// 排過、且通過品質篩選機制(見文件「行程品質分級」段落)上架的行程。

export type ShowcaseCategory = '美食' | '文青' | '親子' | '購物' | '自然景觀'

export interface ShowcaseStop {
  time: string
  name: string
  note: string
}

export interface ShowcaseItinerary {
  id: string
  title: string
  region: string
  days: number
  categories: ShowcaseCategory[]
  coverEmoji: string
  summary: string
  // savedCount——對應文件提到的「使用者評分/收藏數/是否被套用過的次數」
  // 品質篩選機制,這裡只做展示用,不是真的可以收藏。
  savedCount: number
  stops: ShowcaseStop[]
}

export const SHOWCASE_ITINERARIES: ShowcaseItinerary[] = [
  {
    id: 'jiufen-1day',
    title: '九份一日散策',
    region: '台灣・九份',
    days: 1,
    categories: ['美食', '文青'],
    coverEmoji: '🏮',
    summary: '沿著老街階梯往上走，茶樓、山城夜景、手沖咖啡——不用精確到幾點幾分，隨興散步的一天。',
    savedCount: 482,
    stops: [
      { time: '10:00', name: '九份老街入口', note: '從輕便路開始，避開中午人潮高峰前先逛半小時' },
      { time: '10:30', name: '阿妹茶樓', note: '《神隱少女》取景地，建議拍照後再進去喝茶' },
      { time: '12:00', name: '九份芋圓', note: '在地排隊名店，建議外帶邊走邊吃' },
      { time: '14:00', name: '昇平戲院', note: '台灣現存最古老戲院之一，免費參觀' },
      { time: '16:30', name: '基山街小吃', note: '黃昏前的山城光線最適合拍照' },
      { time: '18:00', name: '豎崎路看夜景', note: '華燈初上，九份最經典的階梯夜景角度' },
    ],
  },
  {
    id: 'tainan-3day',
    title: '台南小吃三日遊',
    region: '台灣・台南',
    days: 3,
    categories: ['美食', '文青'],
    coverEmoji: '🍜',
    summary: '赤崁型行程，每天精確安排餐期與景點動線，吃遍在地人也認證的傳統小吃。',
    savedCount: 701,
    stops: [
      { time: 'Day1 08:00', name: '赤崁樓', note: '台南最具代表性的古蹟，建議一早避開團客' },
      { time: 'Day1 11:30', name: '度小月擔仔麵', note: '台南百年老店，午餐首選' },
      { time: 'Day1 15:00', name: '林百貨', note: '日治時期百貨建築，頂樓神社參拜' },
      { time: 'Day2 09:00', name: '安平古堡', note: '荷治時期城堡遺跡' },
      { time: 'Day2 12:00', name: '周氏蝦捲', note: '安平必吃，建議現場候位' },
      { time: 'Day3 10:00', name: '國立台灣文學館', note: '原台南州廳建築，冷氣房休息好去處' },
    ],
  },
  {
    id: 'kyoto-2day',
    title: '京都清水寺周邊兩日',
    region: '日本・京都',
    days: 2,
    categories: ['文青', '自然景觀'],
    coverEmoji: '⛩️',
    summary: '東山區散步路線，從清水寺一路走到八坂神社，適合喜歡慢慢走、拍照的旅人。',
    savedCount: 356,
    stops: [
      { time: 'Day1 09:00', name: '清水寺', note: '建議開門時間抵達，避開中午人潮' },
      { time: 'Day1 11:00', name: '二年坂・三年坂', note: '京都最具代表性的石坂路商店街' },
      { time: 'Day1 14:00', name: '高台寺', note: '賞楓/賞櫻名所，庭園造景精緻' },
      { time: 'Day2 10:00', name: '八坂神社', note: '祇園祭發源地' },
      { time: 'Day2 12:00', name: '花見小路', note: '傳統京町家建築群，可能遇見藝妓' },
    ],
  },
  {
    id: 'tokyo-shopping-2day',
    title: '東京購物兩日衝刺',
    region: '日本・東京',
    days: 2,
    categories: ['購物'],
    coverEmoji: '🛍️',
    summary: '澀谷到銀座，精確規劃每個時段該去哪個商場，適合有明確購物清單的旅人。',
    savedCount: 219,
    stops: [
      { time: 'Day1 10:00', name: '澀谷 SCRAMBLE SQUARE', note: '新開幕展望台，建議先上去拍照' },
      { time: 'Day1 13:00', name: '原宿竹下通', note: '年輕流行文化聚集地' },
      { time: 'Day2 10:00', name: '銀座三越', note: '高端精品購物首選' },
      { time: 'Day2 15:00', name: '秋葉原', note: '電器/動漫周邊愛好者必訪' },
    ],
  },
  {
    id: 'family-kyoto-4day',
    title: '親子京都四日慢遊',
    region: '日本・京都',
    days: 4,
    categories: ['親子', '自然景觀'],
    coverEmoji: '👨‍👩‍👧',
    summary: '每天安排充足的休息時間，景點之間不排太滿，適合帶小孩的家庭出遊。',
    savedCount: 128,
    stops: [
      { time: 'Day1 10:00', name: '京都鐵道博物館', note: '小孩最愛，建議預留 3 小時' },
      { time: 'Day2 09:30', name: '嵐山竹林', note: '建議推車可通行的步道段落' },
      { time: 'Day2 12:00', name: '嵐山公園野餐', note: '預留充分休息時間，不趕行程' },
      { time: 'Day3 10:00', name: '京都水族館', note: '雨天備案景點' },
    ],
  },
]

export const ALL_CATEGORIES: ShowcaseCategory[] = ['美食', '文青', '親子', '購物', '自然景觀']
