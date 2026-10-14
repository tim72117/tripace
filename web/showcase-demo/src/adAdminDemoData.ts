// adAdminDemoData.ts — 投放設定介面範例的假資料,對應
// docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md 的規劃內容。
// 全部是展示用的假資料,沒有真實後端串接,也沒有真的 web/admin 認證。

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended'
export type CampaignTier = 'sponsorship' | 'standard' | 'house'
export type AdvertiserStatus = 'active' | 'suspended'

export interface DemoAdvertiser {
  id: string
  name: string
  contactEmail: string
  contactName: string
  status: AdvertiserStatus
  createdAt: string
}

export interface DemoCreative {
  id: string
  title: string
  desc: string
  ctaLabel: string
  landingUrl: string
  coverEmoji: string
  status: 'active' | 'paused'
}

// DemoGroupTourCreative/DemoFlightCreative——「方案提供者」廣告主
// （賣的不是單一商品，而是團體行程 + 機票兩種性質不同的商品類型）的
// 素材型別。這兩個型別跟既有的 DemoCreative 是平行關係，不是取代它
// ——安平老街咖啡/九份山城民宿/京都和服體驗工作室這三個既有廣告主
// 維持「單一商品素材」的假設不變，繼續用 DemoCreative。
//
// 兩者欄位明顯不同，硬塞進同一個型別只會讓大部分欄位變成「這種商品
// 類型不適用」的 optional 欄位，所以拆成 union（見 DemoProductCreative）
// ，讓 TypeScript 可以用 category 這個 discriminant narrowing。
export interface DemoGroupTourCreative {
  id: string
  category: 'group_tour'
  title: string // 行程名稱，例如「北海道粉雪五日」
  departureDate: string // 固定出發日期
  days: number // 天數
  desc: string
  price: number
  registrationDeadline?: string // 報名截止日（選填，有些團到出發前都能報名）
  ctaLabel: string
  landingUrl: string // 固定的報名頁連結——這個行程專屬
  coverEmoji: string
  status: 'active' | 'paused'
}

export interface DemoFlightCreative {
  id: string
  category: 'flight'
  destination: string // 目的地，例如「東京」
  lowestPriceToday: number // 當天最低價（示意用假資料，不做成真的動態報價）
  priceUpdatedAt: string // 價格更新時間戳，提醒營運人員/使用者這是浮動價
  ctaLabel: string
  landingUrl: string // 導向業者的「出發日曆」頁本身，不是固定商品頁——
  // 機票沒有「一個固定連結對應一個固定價格」這種東西，使用者要自己
  // 在日曆頁挑出發日才會看到當天實際報價。
  coverEmoji: string
  status: 'active' | 'paused'
}

// DemoProductCreative——團體行程/機票兩種素材的 union type，讓
// DemoCampaign.productCreatives 可以用同一個陣列混放兩種類型，呼叫端
// 用 category 分辨該渲染哪種卡片。
export type DemoProductCreative = DemoGroupTourCreative | DemoFlightCreative

export interface DemoCampaign {
  id: string
  advertiserId: string
  name: string
  status: CampaignStatus
  startDate: string
  endDate: string
  placements: string[]
  tier: CampaignTier
  weight: number
  targetCities: string[]
  targetDevice: 'any' | 'mobile' | 'desktop'
  dailyCapImpressions: number | null
  creatives: DemoCreative[]
  // productCreatives——選填欄位，只有「方案提供者」這類廣告主（賣團體
  // 行程+機票兩種商品）的活動才會用到。保持選填、跟 creatives 分開，
  // 是為了不動既有三個廣告主案例的資料結構與既有程式碼路徑。
  productCreatives?: DemoProductCreative[]
}

// PLACEMENT_OPTIONS——對應 docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md
// 第 3.2 節「投放版位」核取方塊清單,positionDesc 文字直接對齊
// showcase-demo/adSystemData.ts 的 PLACEMENT_DEMOS,呼應規劃文件第 6 節
// 待確認項「版位說明文字的共用來源」——這裡先各自維護一份,內容保持一致。
export const PLACEMENT_OPTIONS: { key: string; label: string; positionDesc: string }[] = [
  {
    key: 'city.after_timeline',
    label: '城市頁・時間軸結束後',
    positionDesc: '時間軸敘事結束後、「探索其他城市」之前',
  },
  {
    key: 'blog.article_end',
    label: '部落格文章・文章結尾',
    positionDesc: '文章內容結束後、城市頁 footer 之前',
  },
  {
    key: 'itineraries.list_inline',
    label: '範例行程列表・中插卡片',
    positionDesc: '卡片牆第 3 張卡片的位置',
  },
  // 下面兩個版位是呼應「方案提供者」廣告主（團體行程 + 機票兩種商品）
  // 的構想：團體行程是「固定出發日期、固定內容」的商品，適合出現在
  // 使用者已經鎖定某個城市、正在看這個城市有什麼玩法的情境（城市頁）；
  // 機票是「依出發日動態浮動」的商品，適合出現在使用者正在規劃「我
  // 哪天出發」這個決策點的情境（出發日期/排期規劃相關頁面），這兩種
  // 商品的「使用者決策情境」本質不同，所以拆成兩個版位而不是沿用同
  // 一個。
  {
    key: 'city.group_tour_recommend',
    label: '城市頁・團體行程推薦區',
    positionDesc: '城市頁「其他玩法」區塊，推薦這個城市近期可出發的團體行程（呼應固定出發日期/固定內容的商品特性）',
  },
  {
    key: 'itineraries.departure_planning',
    label: '行程規劃・出發日期選擇情境',
    positionDesc: '使用者正在挑選/調整出發日期的畫面（例如行程草稿的日期欄位附近），適合推「這個目的地今天的最低機票價」這類會隨日期變動的資訊',
  },
]

export const DEMO_ADVERTISERS: DemoAdvertiser[] = [
  {
    id: 'adv_001',
    name: '安平老街咖啡',
    contactEmail: 'owner@anping-coffee.example',
    contactName: '陳小姐',
    status: 'active',
    createdAt: '2026-09-02',
  },
  {
    id: 'adv_002',
    name: '九份山城民宿',
    contactEmail: 'booking@jiufen-inn.example',
    contactName: '林先生',
    status: 'active',
    createdAt: '2026-09-15',
  },
  {
    id: 'adv_003',
    name: '京都和服體驗工作室',
    contactEmail: 'info@kyoto-kimono.example',
    contactName: '佐藤様',
    status: 'active',
    createdAt: '2026-10-01',
  },
  {
    id: 'adv_004',
    name: '台南小吃導覽（已結束合作）',
    contactEmail: 'old-contact@example.com',
    contactName: '—',
    status: 'suspended',
    createdAt: '2026-06-10',
  },
  // adv_005——「方案提供者」案例，參考使用者分享的一個真實旅行社網站
  // 案例（不具名）：網站有「出發日曆」頁面，查某天可出發的團體行程
  // 跟各目的地機票最低價。這類廣告主賣的不是單一商品，底下活動會混用
  // DemoGroupTourCreative/DemoFlightCreative 兩種素材（見 cmp_005）。
  // 2026-10 使用者明確要求「不要提到姓名」,廣告主名稱/聯絡人全部改成
  // 匿名化的通用假資料,不保留原始案例的業者名稱或真實姓名。
  {
    id: 'adv_005',
    name: '日本線旅行社',
    contactEmail: 'contact@demo-travel.example',
    contactName: '業務窗口',
    status: 'active',
    createdAt: '2026-10-05',
  },
]

export const DEMO_CAMPAIGNS: DemoCampaign[] = [
  {
    id: 'cmp_001',
    advertiserId: 'adv_001',
    name: '安平古堡周邊・秋季檔期',
    status: 'active',
    startDate: '2026-10-01',
    endDate: '2026-11-30',
    placements: ['city.after_timeline'],
    tier: 'standard',
    weight: 5,
    targetCities: ['台南'],
    targetDevice: 'any',
    dailyCapImpressions: 500,
    creatives: [
      {
        id: 'crv_001',
        title: '安平老街咖啡',
        desc: '逛完安平古堡，走路 5 分鐘到我們家歇腳，出示這篇文章折抵 20 元。',
        ctaLabel: '看看菜單',
        landingUrl: 'https://anping-coffee.example/menu',
        coverEmoji: '☕',
        status: 'active',
      },
    ],
  },
  {
    id: 'cmp_002',
    advertiserId: 'adv_002',
    name: '九份夜景住宿推廣',
    status: 'active',
    startDate: '2026-09-20',
    endDate: '2026-12-31',
    placements: ['blog.article_end'],
    tier: 'standard',
    weight: 5,
    targetCities: ['九份'],
    targetDevice: 'mobile',
    dailyCapImpressions: null,
    creatives: [
      {
        id: 'crv_002',
        title: '九份山城民宿',
        desc: '看完這篇九份遊記，想留下來看夜景嗎？步行到九份老街僅 8 分鐘。',
        ctaLabel: '查房價',
        landingUrl: 'https://jiufen-inn.example',
        coverEmoji: '🏮',
        status: 'active',
      },
    ],
  },
  {
    id: 'cmp_003',
    advertiserId: 'adv_003',
    name: '京都行程推薦・和服體驗',
    status: 'scheduled',
    startDate: '2026-11-01',
    endDate: '2027-01-31',
    placements: ['itineraries.list_inline'],
    tier: 'sponsorship',
    weight: 10,
    targetCities: ['京都'],
    targetDevice: 'any',
    dailyCapImpressions: 300,
    creatives: [
      {
        id: 'crv_003',
        title: '京都和服體驗工作室',
        desc: '規劃京都行程嗎？提前預約和服體驗，清水寺拍照更有氛圍。',
        ctaLabel: '立即預約',
        landingUrl: 'https://kyoto-kimono.example/booking',
        coverEmoji: '👘',
        status: 'active',
      },
    ],
  },
  {
    id: 'cmp_004',
    advertiserId: 'adv_001',
    name: '安平古堡周邊・草稿（素材尚未備齊）',
    status: 'draft',
    startDate: '2026-12-01',
    endDate: '2027-01-15',
    placements: [],
    tier: 'standard',
    weight: 5,
    targetCities: ['台南'],
    targetDevice: 'any',
    dailyCapImpressions: null,
    creatives: [],
  },
  // cmp_005——「方案提供者」範例活動，混用兩種版位跟兩種素材類型：
  // 團體行程投放在城市頁推薦區（固定出發日期/內容，適合使用者已鎖定
  // 城市的情境），機票投放在出發日期規劃情境（浮動最低價，適合使用者
  // 正在決定「哪天出發」的情境）。creatives 留空陣列，只用
  // productCreatives，呼應資料結構的設計意圖。
  {
    id: 'cmp_005',
    advertiserId: 'adv_005',
    name: '日本線出發日曆推廣',
    status: 'active',
    startDate: '2026-10-10',
    endDate: '2027-02-28',
    placements: ['city.group_tour_recommend', 'itineraries.departure_planning'],
    tier: 'standard',
    weight: 6,
    targetCities: ['京都'],
    targetDevice: 'any',
    dailyCapImpressions: 800,
    creatives: [],
    productCreatives: [
      {
        id: 'crv_tour_001',
        category: 'group_tour',
        title: '北海道粉雪五日',
        departureDate: '2026-12-18',
        days: 5,
        desc: '小樽運河、白色戀人工廠、二世谷滑雪初體驗，含三餐溫泉飯店。',
        price: 32900,
        registrationDeadline: '2026-12-01',
        ctaLabel: '立即報名',
        landingUrl: 'https://demo-travel.example/tours/hokkaido-powder-5d',
        coverEmoji: '🗻',
        status: 'active',
      },
      {
        id: 'crv_tour_002',
        category: 'group_tour',
        title: '京都紅葉賞楓四日',
        departureDate: '2026-11-22',
        days: 4,
        desc: '清水寺、嵐山渡月橋、伏見稻荷千本鳥居，賞楓專車接送。',
        price: 28500,
        registrationDeadline: '2026-11-10',
        ctaLabel: '立即報名',
        landingUrl: 'https://demo-travel.example/tours/kyoto-autumn-4d',
        coverEmoji: '🍁',
        status: 'active',
      },
      {
        id: 'crv_flight_001',
        category: 'flight',
        destination: '東京',
        lowestPriceToday: 6280,
        priceUpdatedAt: '2026-10-14 09:00',
        ctaLabel: '查出發日曆',
        // 導向「出發日曆」頁本身，不是固定商品頁——機票沒有固定
        // landingUrl+固定價格這種東西，使用者要自己選日期才看到報價。
        landingUrl: 'https://demo-travel.example/departure-calendar?dest=tokyo',
        coverEmoji: '✈️',
        status: 'active',
      },
      {
        id: 'crv_flight_002',
        category: 'flight',
        destination: '大阪',
        lowestPriceToday: 5990,
        priceUpdatedAt: '2026-10-14 09:00',
        ctaLabel: '查出發日曆',
        landingUrl: 'https://demo-travel.example/departure-calendar?dest=osaka',
        coverEmoji: '✈️',
        status: 'active',
      },
    ],
  },
]

// DEMO_DAILY_STATS——Stats 分頁用的假每日彙總資料(對齊規劃文件第 4 節
// 「依活動、依版位、依日期區間」篩選),這裡只給 cmp_001/cmp_002 兩個
// active 活動各 7 天份資料示意折線走勢,不做成真正隨機以保持畫面穩定
// 可預期。
export interface DemoDailyStat {
  date: string
  campaignId: string
  impressions: number
  clicks: number
}

export const DEMO_DAILY_STATS: DemoDailyStat[] = [
  { date: '10/07', campaignId: 'cmp_001', impressions: 182, clicks: 6 },
  { date: '10/08', campaignId: 'cmp_001', impressions: 201, clicks: 9 },
  { date: '10/09', campaignId: 'cmp_001', impressions: 176, clicks: 5 },
  { date: '10/10', campaignId: 'cmp_001', impressions: 223, clicks: 11 },
  { date: '10/11', campaignId: 'cmp_001', impressions: 198, clicks: 7 },
  { date: '10/12', campaignId: 'cmp_001', impressions: 241, clicks: 13 },
  { date: '10/13', campaignId: 'cmp_001', impressions: 215, clicks: 8 },
  { date: '10/07', campaignId: 'cmp_002', impressions: 95, clicks: 2 },
  { date: '10/08', campaignId: 'cmp_002', impressions: 110, clicks: 4 },
  { date: '10/09', campaignId: 'cmp_002', impressions: 88, clicks: 3 },
  { date: '10/10', campaignId: 'cmp_002', impressions: 132, clicks: 6 },
  { date: '10/11', campaignId: 'cmp_002', impressions: 121, clicks: 5 },
  { date: '10/12', campaignId: 'cmp_002', impressions: 145, clicks: 7 },
  { date: '10/13', campaignId: 'cmp_002', impressions: 128, clicks: 6 },
]

export const CITY_OPTIONS = ['台南', '九份', '京都']

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: '草稿',
  scheduled: '已排程',
  active: '投放中',
  paused: '已暫停',
  ended: '已結束',
}

export const TIER_LABEL: Record<CampaignTier, string> = {
  sponsorship: '獨佔贊助',
  standard: '一般',
  house: '自家推廣',
}
