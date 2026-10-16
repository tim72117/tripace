import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_01: IdeaDoc = {
  id: 'research-storytelling-01',
  group: 'research',
  order: 1,
  title: '點子 1:三幕式分層敘事(一句話 → 為什麼值得 → 深度故事)',
  summary: '把現有介紹卡展開成三層:一句話、為什麼值得來、深度故事,由 AI 起草、人審發布。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        'AI 生成初稿(以 Wikipedia/官方觀光網站為底的 RAG,避免幻覺)+策展人用既有 CLI 流程審稿定稿。生產成本低、可批量;品質風險在幻覺與腔調一致性,靠「AI 起草、人審發布」流程控管,發布欄位標注審稿人與日期。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: [
        '介紹卡保留現有一句話為第一幕;新增「為什麼值得來」第二幕(2–3 段、每段一個具體理由,如清水舞台的懸造工法「不用一根釘子」);第三幕「深度故事」給歷史控(創建緣起、火災重建史)。三幕漸進展開,不逼所有人讀長文。',
      ],
    },
    {
      heading: '如何引導',
      paragraphs: [
        '介紹卡簡介文字尾端放「為什麼值得來 ›」輕量入口;第二幕讀完再給「還想知道更多」。與現況銜接零成本——只是把現有卡片變成可展開。',
      ],
    },
    {
      heading: '增強使用者感受',
      paragraphs: [
        '直接解決「罐頭簡介很無聊」「不知道為什麼要排這個點」。第二幕是行前決策的說服層,第三幕滿足深度需求而不干擾快閃族。',
      ],
    },
  ],
  verdict: '可行性/優先度:高(第一優先)。資料生產流程與現有 CLI 相容,前端只是卡片展開,是所有點子中投入產出比最好的。已做 artifact。',
  tags: ['景點介紹', 'AI 生成', '第一優先'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
