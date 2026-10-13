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
