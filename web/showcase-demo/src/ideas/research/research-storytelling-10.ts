import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_10: IdeaDoc = {
  id: 'research-storytelling-10',
  group: 'research',
  order: 10,
  title: '點子 10:共筆勘誤與補充(社群協作品質迴路)',
  summary: '讓使用者回報歇業、價格變動或補充資訊,經審核採用並署名,本質是資料品質機制。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: ['使用者回報(「已歇業」「價格變了」「補充:這家有素食」)進審核佇列,策展人用 CLI 批准;貢獻採用後在卡片 footer 署名。本質是資料品質機制而非內容來源。'],
    },
    {
      heading: '如何介紹',
      paragraphs: ['介紹卡 footer 極輕的「回報或補充 ›」;採用後的補充以「旅人補充」小節呈現,與官方內容視覺區隔。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['入口常駐但極低調;使用者剛結束該點行程後的回訪時稍微抬高入口可見度(此時最可能發現資訊過時)。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「手打資料會腐敗、使用者發現錯誤卻無處說」的信任問題;署名給貢獻者參與感。'],
    },
  ],
  verdict: '可行性/優先度:低(但建議早埋入口)。審核流程有持續人力成本,冷啟動期回報量少;不過「回報」按鈕本身很便宜,建議先做入口收集訊號,共筆機制等量到了再說。',
  tags: ['景點介紹', '社群協作', '資料品質'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
