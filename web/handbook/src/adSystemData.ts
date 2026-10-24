// adSystemData.ts — 構想六(廣告投放系統)雛形的假資料,對應
// 構想頁 /ideas/product-direction-6-ad-system(構想六)的
// 內容。全部是展示用的假資料,沒有真實廣告主/後端串接。

export interface SponsoredCreative {
  id: string
  sponsorLabel: string // 固定顯示「贊助」,這裡額外帶廣告主名稱方便雛形辨識
  title: string
  desc: string
  ctaLabel: string
  coverEmoji: string
  accentColor: string
}

// PLACEMENT_DEMOS——對應 brainstorm 文件「延伸方案」裡列出的三個 MVP
// 候選版位:城市頁時間軸結束後、文章結尾、範例行程列表中插卡片。這裡
// 各自配一則假的贊助素材,示意在真實版面裡長什麼樣子。
export const PLACEMENT_DEMOS: {
  key: string
  pageLabel: string
  positionDesc: string
  creative: SponsoredCreative
}[] = [
  {
    key: 'city.after_timeline',
    pageLabel: '城市頁（例如 /tainan-anping）',
    positionDesc: '時間軸敘事結束後、「探索其他城市」之前',
    creative: {
      id: 'crv_demo_1',
      sponsorLabel: '贊助・安平老街咖啡',
      title: '安平老街咖啡',
      desc: '逛完安平古堡，走路 5 分鐘到我們家歇腳，出示這篇文章折抵 20 元。',
      ctaLabel: '看看菜單',
      coverEmoji: '☕',
      accentColor: 'var(--ios-sand)',
    },
  },
  {
    key: 'blog.article_end',
    pageLabel: '部落格文章頁',
    positionDesc: '文章內容結束後、城市頁 footer 之前',
    creative: {
      id: 'crv_demo_2',
      sponsorLabel: '贊助・九份山城民宿',
      title: '九份山城民宿',
      desc: '看完這篇九份遊記，想留下來看夜景嗎？步行到九份老街僅 8 分鐘。',
      ctaLabel: '查房價',
      coverEmoji: '🏮',
      accentColor: 'var(--ios-blue)',
    },
  },
  {
    key: 'itineraries.list_inline',
    pageLabel: '範例行程列表（/ai-itineraries）',
    positionDesc: '卡片牆第 3 張卡片的位置',
    creative: {
      id: 'crv_demo_3',
      sponsorLabel: '贊助・京都和服體驗工作室',
      title: '京都和服體驗工作室',
      desc: '規劃京都行程嗎？提前預約和服體驗，清水寺拍照更有氛圍。',
      ctaLabel: '立即預約',
      coverEmoji: '👘',
      accentColor: 'var(--ios-green)',
    },
  },
]

// KEY_DECISIONS——對應 Opus 子代理探索報告的「待確認清單」,只摘錄
// 跟版位/投放/計費直接相關、使用者會想一眼看到的幾項,完整清單仍在
// 子代理報告與這次對話紀錄裡,這裡不是取代完整報告的簡化版規格。
export const KEY_DECISIONS: { question: string; recommendation: string }[] = [
  {
    question: '計費模式？',
    recommendation: 'MVP 建議先只做固定檔期（flat），不做 CPM/CPC 即時計數與配速——流量規模還不需要。',
  },
  {
    question: '投放怎麼挑選？',
    recommendation: '依城市等頁面語境篩選候選素材，同一版位有多則時依優先層級＋權重隨機抽選，不做即時競價。',
  },
  {
    question: 'AI 推薦內容會不會被廣告影響？',
    recommendation: '不會——建議明訂「AI 生成的行程內容不受廣告影響」原則，贊助只出現在明確標示的獨立區塊。',
  },
  {
    question: '管理後台放哪？',
    recommendation: '沿用既有 Admin SPA 新增一個分頁，由內部營運人員代為上稿，第一階段不開放廣告主自助登入。',
  },
  {
    question: '隱私權政策呢？',
    recommendation: '目前文案（「不使用第三方廣告追蹤工具」）已經跟現況不符，做廣告前需要先更新。',
  },
]
