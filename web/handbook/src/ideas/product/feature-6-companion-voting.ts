import type { IdeaDoc } from '../types'

export const FEATURE_6: IdeaDoc = {
  id: 'product-feature-6-companion-voting',
  group: 'product',
  order: 45,
  title: '功能構想 6:旅伴共決(候選池 + 投票 + AI 折衷)',
  summary: '旅伴把想去的店丟進共享候選池並滑卡片表態,AI 彙整衝突、提出折衷方案給全員表決,高票項目由 AI 塞進合適時段。雙視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['旅伴把想去的店丟進共享候選池,滑卡片表態(想去/不想/都可);每人也可私下跟 AI 說雷點,AI 彙整衝突(A 要逛街、B 要爬山)提出折衷方案(分頭兩小時、輪流主場日)給全員表決,高票項目由 AI 塞進合適時段。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['「LINE 群組丟連結 → 沒人整理 → 回頭翻不到」;群組裡不好意思說「我不想去」的社交成本。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['團體的決策發生在哪裡,行程就留在哪裡。Wanderlog 只有留言沒有表決。'],
    },
    {
      heading: '可行性',
      paragraphs: [
        '多人成員與權限機制已有,補候選清單資料表與即時同步(WebSocket 已有);AI 折衷是對話框架的延伸。',
        '候選池與構想 1(靈感收件匣,見構想 1(/ideas/product-feature-1-inspiration-inbox))共用。',
      ],
    },
  ],
  tags: ['功能腦力激盪', '多人協作', '投票', '雙視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
