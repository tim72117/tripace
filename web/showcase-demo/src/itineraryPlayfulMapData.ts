// itineraryPlayfulMapData.ts — 構想一附錄四「尋寶手帳攤開頁」雛形假資料。
//
// 緣起(2026-10):正式功能 web/src/ai-itineraries/AiItineraryDetailPageMapView.tsx
// 最近做了一輪「活潑化」(手繪貼紙卡片、古城風格地圖邊框),但那些都是在
// 「地圖全幅背景 + 左右兩側面板」這個固定版面上做局部裝飾。使用者想看的是
// 「整體版面構圖本身」能不能有更活潑的安排——這份雛形嘗試的隱喻是
// 「攤開的旅行手帳」:左頁是手繪尋寶地圖,右頁是貼滿拍立得與和紙膠帶的
// 日記頁,下緣再掛一排護照戳章當作「走到第幾站」的進度列。資料仍是一份
// 普通的兩日行程,跟正式功能同樣用台南赤崁・府城兩日遊當範例(精神相近,
// 不需逐字對齊)。
//
// 座標用 xPct/yPct 百分比(對齊 RoutePathMapSkeletonPage 的做法),因為
// 尋寶地圖上的站點是依「大致地理相對位置」自由擺放的,不是規則網格;
// 第一天(赤崁周邊)集中在畫布右上,第二天(安平)集中在左下,兩天之間的
// 路徑線用更淡的點線連起來,呼應「隔天移動到另一區」的感覺。

export type PlayfulStopKind = 'spot' | 'food'

export interface PlayfulStop {
  id: string
  day: 1 | 2
  // order——整份行程的第幾站(1-based,跨天連續編號),護照戳章列與地圖
  // 圖釘上的號碼都用這個,不用「當天第幾站」——瀏覽整趟旅程時跨天連續
  // 編號比較能表達「走到第幾站了」的進度感。
  order: number
  time: string
  name: string
  kind: PlayfulStopKind
  emoji: string
  // note——手帳上拍立得下方的手寫註記(一句話),不是完整介紹。
  note: string
  stayMinutes: number
  xPct: number
  yPct: number
}

// 美食清單——對齊正式功能「左側美食清單面板」的概念:這些是「行程沿線
// 順路可以吃」的口袋名單,不佔時間軸站點,在手帳右頁用「夾在頁面裡的
// 收據」樣式呈現。
export interface PlayfulFoodPick {
  id: string
  name: string
  emoji: string
  hint: string
  price: string
  nearStopId: string
}

export interface PlayfulItinerary {
  id: string
  title: string
  subtitle: string
  days: { day: 1 | 2; label: string; theme: string }[]
  stops: PlayfulStop[]
  foodPicks: PlayfulFoodPick[]
}

export const PLAYFUL_ITINERARY: PlayfulItinerary = {
  id: 'tainan-chikan-2day-journal',
  title: '台南赤崁・府城兩日遊',
  subtitle: '第一天走赤崁老城區，第二天往安平海邊——兩天八站，順路再塞幾口小吃。',
  days: [
    { day: 1, label: 'Day 1', theme: '赤崁老城・廟口巡禮' },
    { day: 2, label: 'Day 2', theme: '安平海風・老屋散步' },
  ],
  stops: [
    {
      id: 'd1-chikan',
      day: 1,
      order: 1,
      time: '09:30',
      name: '赤崁樓',
      kind: 'spot',
      emoji: '🏯',
      note: '一早人少，先拍到沒人的石碑跟贔屭。',
      stayMinutes: 60,
      xPct: 66,
      yPct: 22,
    },
    {
      id: 'd1-wumiao',
      day: 1,
      order: 2,
      time: '11:00',
      name: '祀典武廟',
      kind: 'spot',
      emoji: '⛩️',
      note: '紅牆超好拍，記得抬頭看屋脊剪黏。',
      stayMinutes: 40,
      xPct: 76,
      yPct: 30,
    },
    {
      id: 'd1-dsy',
      day: 1,
      order: 3,
      time: '12:00',
      name: '度小月擔仔麵',
      kind: 'food',
      emoji: '🍜',
      note: '小碗就好，留肚子給下午的水果。',
      stayMinutes: 50,
      xPct: 70,
      yPct: 42,
    },
    {
      id: 'd1-shennong',
      day: 1,
      order: 4,
      time: '14:30',
      name: '神農街',
      kind: 'spot',
      emoji: '🏮',
      note: '黃昏點燈前後各走一趟，完全是兩條街。',
      stayMinutes: 90,
      xPct: 56,
      yPct: 36,
    },
    {
      id: 'd2-fort',
      day: 2,
      order: 5,
      time: '09:30',
      name: '安平古堡',
      kind: 'spot',
      emoji: '🏰',
      note: '瞭望台上可以看到整片安平港。',
      stayMinutes: 70,
      xPct: 24,
      yPct: 52,
    },
    {
      id: 'd2-shrimp',
      day: 2,
      order: 6,
      time: '12:00',
      name: '周氏蝦捲',
      kind: 'food',
      emoji: '🍤',
      note: '剛炸好的最酥，拿到手別等。',
      stayMinutes: 45,
      xPct: 18,
      yPct: 64,
    },
    {
      id: 'd2-treehouse',
      day: 2,
      order: 7,
      time: '14:00',
      name: '安平樹屋',
      kind: 'spot',
      emoji: '🌳',
      note: '榕樹吞掉整棟倉庫，天橋步道走一圈。',
      stayMinutes: 60,
      xPct: 32,
      yPct: 68,
    },
    {
      id: 'd2-hayashi',
      day: 2,
      order: 8,
      time: '16:30',
      name: '林百貨',
      kind: 'spot',
      emoji: '🛗',
      note: '搭老電梯上頂樓神社，再買伴手禮收尾。',
      stayMinutes: 60,
      xPct: 62,
      yPct: 56,
    },
  ],
  foodPicks: [
    { id: 'f-atang', name: '阿堂鹹粥', emoji: '🐟', hint: '赤崁樓前先吃早餐', price: 'NT$ 120', nearStopId: 'd1-chikan' },
    { id: 'f-lily', name: '莉莉水果店', emoji: '🍧', hint: '神農街前的下午茶', price: 'NT$ 90', nearStopId: 'd1-shennong' },
    { id: 'f-yifeng', name: '義豐冬瓜茶', emoji: '🧋', hint: '武廟旁邊走路兩分鐘', price: 'NT$ 35', nearStopId: 'd1-wumiao' },
    { id: 'f-tofu', name: '安平豆花', emoji: '🥣', hint: '樹屋出來剛好一碗', price: 'NT$ 45', nearStopId: 'd2-treehouse' },
  ],
}
