import type { IdeaGroupMeta } from './types'

// 顯示順序即陣列順序。
export const IDEA_GROUPS: IdeaGroupMeta[] = [
  {
    id: 'product',
    title: '產品構想',
    blurb: '產品方向的腦力激盪、功能構想與優先序、使用者視角的期待、廣告投放介面規劃。',
  },
  {
    id: 'ai-planning-r1',
    title: 'AI 排行程討論．第一輪',
    blurb: '在地基尚未補齊的現況下,三方角色(新手旅行者、老手旅行者、行程規劃師)對 AI 主動規劃行程的 15 項構想所做的設計討論與定案。',
  },
  {
    id: 'ai-planning-r2',
    title: 'AI 排行程討論．第二輪',
    blurb: '交通時間與營業時間查詢補齊後,重新檢視同一批議題:哪些結論變了、哪些風險反而更明顯。',
  },
  {
    id: 'ai-planning-vision',
    title: 'AI 排行程討論．願景篇',
    blurb: '反過來問:AI 把候選整理做到極致時,能為三種角色帶來什麼新價值,以及專業角色會被推向哪裡。',
  },
  {
    id: 'design-discussion',
    title: '行程規劃設計討論',
    blurb: '規劃介面的設計討論:候選籃、旅伴提問、日層架、行前底氣卡等,以及行程 UX 設計文件。',
  },
  {
    id: 'audit',
    title: '稽核報告',
    blurb: '程式碼盤點與稽核:成本控制、快取涵蓋範圍、一致性與安全性檢查。這個分類的頁面本身就是原始文件(2026-10 起稽核文件統一存放在 showcase-demo)。',
  },
  {
    id: 'research',
    title: '研究發想',
    blurb: '景點敘事、路徑規劃、旅伴媒合等主題的研究與點子整理。',
  },
]
