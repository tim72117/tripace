import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_06: IdeaDoc = {
  id: 'research-storytelling-06',
  group: 'research',
  order: 6,
  title: '點子 6:深淺自適應介紹(旅程風格客製)',
  summary: '同一份定稿由 AI 改寫成不同深度版本,依使用者行程風格無感呈現,列為點子 1 的 v2 延伸。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        '同一份定稿內容(點子 1 產出)由 AI 改寫成 2–3 個版本:深度歷史版/親子白話版/快閃重點版。邊際成本低,但版本數 × 景點數的審稿量會膨脹,建議只對主題點做、且只做兩版(標準/深度)。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: ['不做顯性 tab 切換(選擇成本高),而是依使用者行程風格(行程密度、停留時間長短即可推斷,不用問卷)預設呈現對應深度,卡片角落留「切換深度」給不服氣的人。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['無感引導——使用者不需要做任何事,介紹深淺自動貼合。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「歷史控嫌太淺、快閃族嫌太長」的兩頭不討好。'],
    },
  ],
  verdict: '可行性/優先度:低。依賴點子 1 先落地,且「自動推斷風格」在資料量小時容易猜錯造成反感。列為點子 1 的 v2 延伸,不獨立做。',
  tags: ['景點介紹', 'AI 改寫', '個人化'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
