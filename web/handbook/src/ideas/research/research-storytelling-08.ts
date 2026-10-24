import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_08: IdeaDoc = {
  id: 'research-storytelling-08',
  group: 'research',
  order: 8,
  title: '點子 8:問問導遊(AI 對話問答)',
  summary: '以景點已定稿內容為知識底的 RAG 問答,用預設問題 chips 降低開口成本。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: ['RAG——以該景點已定稿內容(點子 1)+Wikipedia 條目為知識底,範圍外問題誠實說不知道。推論成本按次計,需防漫談濫用(限每點每日次數)。'],
    },
    {
      heading: '如何介紹',
      paragraphs: ['介紹卡「問問導遊」入口,開對話 sheet;預設 3 顆問題 chips(「要爬很多樓梯嗎?」「帶 5 歲小孩適合嗎?」「清晨去人少嗎?」)降低開口成本。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['chips 是主要引導——多數人不會主動打字,但會點現成問題。回答尾端可接「加入行程」動作。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「簡介回答不了我的具體情境問題」。長尾問題(輪椅、雨天、營業時間細節)是靜態內容永遠寫不完的。'],
    },
  ],
  verdict: '可行性/優先度:中。技術直接,但答案品質受限於知識底的厚度——建議在點子 1 內容累積到一定量後再開,否則 AI 只能空談。',
  tags: ['景點介紹', 'RAG', 'AI 對話'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
