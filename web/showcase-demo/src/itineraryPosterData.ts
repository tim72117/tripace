// itineraryPosterData.ts — 構想一附錄二「版面化行程懶人包」雛形假資料。
//
// 緣起(2026-10):使用者分享一張「J人做的西班牙攻略」圖文懶人包截圖
// (插畫地圖+編號路線+城市色卡),問能不能做出類似效果,並指出重點是
// 「CLI 可以加入圖卡、標註、路線、時間軸....不同的呈現方式」——這不是
// 要重現插畫風格本身,而是要驗證「同一份行程資料,能不能用區塊化的
// 方式組出一張總覽式懶人包版面」,呼應部落格 content_pages 的 blocks
// 機制(見 .claude/skills/blog-article-content)。
//
// 這裡刻意用台灣真實路線(不是西班牙),避免讓人誤以為在模仿/重製那張
// 圖本身的插畫美術——驗證的是版面機制,不是美術風格。
//
// POSTER_BLOCKS 模擬「未來 itinerary_pages content JSON 可能長的樣子」
// 的一種可能分支:陣列裡每個區塊有 kind,渲染端依 kind 決定排版,
// 對齊部落格 blocks 扁平陣列、不分巢狀容器的既有設計哲學。這裡只定義
// 這次雛形用得到的四種 kind(route-map/stop-card/timeline-day/callout),
// 不是定案的正式 schema——實際要收斂成幾種 kind、欄位怎麼定,留待這份
// 雛形驗證過後再回頭設計。

export interface PosterStop {
  id: string
  index: number
  city: string
  days: string
  accentColor: string
  highlights: string[]
  photoEmoji: string
  photoCaption: string
}

export interface RouteMapBlock {
  kind: 'route-map'
  title: string
  stops: { id: string; index: number; city: string; xPct: number; yPct: number; accentColor: string }[]
}

export interface StopCardBlock {
  kind: 'stop-card'
  stop: PosterStop
}

export interface TimelineDayBlock {
  kind: 'timeline-day'
  day: number
  city: string
  items: { time: string; activity: string }[]
}

export interface CalloutBlock {
  kind: 'callout'
  text: string
}

export type PosterBlock = RouteMapBlock | StopCardBlock | TimelineDayBlock | CalloutBlock

export const POSTER_TITLE = 'AI 排的台灣西部五城攻略'
export const POSTER_SUBTITLE = '台北（2天）→ 台中（1天）→ 嘉義（1天）→ 台南（2天）→ 高雄（2天）'

const STOPS: PosterStop[] = [
  {
    id: 'taipei',
    index: 1,
    city: '台北（2天）',
    days: '2天',
    accentColor: '#d14b4b',
    highlights: ['故宮博物院', '九份老街', '象山夜景', '饒河夜市'],
    photoEmoji: '🏯',
    photoCaption: '故宮博物院',
  },
  {
    id: 'taichung',
    index: 2,
    city: '台中（1天）',
    days: '1天',
    accentColor: '#3f8f5f',
    highlights: ['彩虹眷村', '宮原眼科', '高美濕地'],
    photoEmoji: '🌈',
    photoCaption: '彩虹眷村',
  },
  {
    id: 'chiayi',
    index: 3,
    city: '嘉義（1天）',
    days: '1天',
    accentColor: '#c47a2c',
    highlights: ['阿里山森林鐵路', '檜意森活村', '文化路夜市'],
    photoEmoji: '🚃',
    photoCaption: '阿里山森林鐵路',
  },
  {
    id: 'tainan',
    index: 4,
    city: '台南（2天）',
    days: '2天',
    accentColor: '#8e4fc2',
    highlights: ['赤崁樓', '安平古堡', '神農街', '花園夜市'],
    photoEmoji: '🏮',
    photoCaption: '赤崁樓',
  },
  {
    id: 'kaohsiung',
    index: 5,
    city: '高雄（2天）',
    days: '2天',
    accentColor: '#2c6fc4',
    highlights: ['駁二藝術特區', '蓮池潭', '旗津老街', '六合夜市'],
    photoEmoji: '🚢',
    photoCaption: '駁二藝術特區',
  },
]

// xPct/yPct——沿台灣西部縱向概略分佈,0~100 對應地圖畫布百分比座標,
// 跟 RoutePathMapSkeletonPage.tsx 同一種「座標直接對齊 viewBox 百分比」
// 的簡化做法,不是精確地理投影。
const ROUTE_MAP: RouteMapBlock = {
  kind: 'route-map',
  title: '五城路線',
  stops: STOPS.map((s, i) => ({
    id: s.id,
    index: s.index,
    city: s.city.replace(/（.+）/, ''),
    xPct: [30, 38, 42, 48, 46][i],
    yPct: [12, 32, 48, 66, 86][i],
    accentColor: s.accentColor,
  })),
}

export const POSTER_BLOCKS: PosterBlock[] = [
  ROUTE_MAP,
  ...STOPS.map((stop): StopCardBlock => ({ kind: 'stop-card', stop })),
  {
    kind: 'timeline-day',
    day: 4,
    city: '台南 Day 1',
    items: [
      { time: '09:00', activity: '赤崁樓・祀典大天后宮' },
      { time: '12:00', activity: '度小月擔仔麵（午餐）' },
      { time: '14:00', activity: '安平古堡・安平老街' },
      { time: '18:00', activity: '花園夜市（晚餐 + 逛街）' },
    ],
  },
  {
    kind: 'callout',
    text: '收藏這份攻略，開啟你的台灣西部之旅！',
  },
]
