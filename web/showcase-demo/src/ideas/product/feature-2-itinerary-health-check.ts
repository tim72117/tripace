import type { IdeaDoc } from '../types'

export const FEATURE_2: IdeaDoc = {
  id: 'product-feature-2-itinerary-health-check',
  group: 'product',
  order: 41,
  title: '功能構想 2:行程健檢(合理性檢查)',
  summary: '自動掃描整份行程,標出休館日、車程塞不下、末班車、步行過長、六小時沒吃飯等問題並附一鍵修正建議;誤報率是命門。三視角命中。',
  sections: [
    {
      heading: '做什麼',
      paragraphs: ['自動掃描整份行程,標紅「這天週一休館」「兩點之間車程 90 分鐘塞不下」「末班車 22:10」「這天走 12 公里」「六小時沒排吃飯」,每項附一鍵修正建議。'],
    },
    {
      heading: '取代的繁瑣流程',
      paragraphs: ['一個個景點開 Google Maps 查營業時間對照星期幾、自己一段段查交通心算出發時間;週一排了三個休館的博物館,到現場才發現。'],
    },
    {
      heading: '為什麼吸引人',
      paragraphs: ['AI 行程產生器最常被罵的就是排出地理亂跳、踩到休館日的行程;第一次看到 app 主動抓出「你這天根本走不完」,信任感立刻建立。'],
    },
    {
      heading: 'AI 角色',
      paragraphs: ['單項檢查是規則(不需 AI);「發現問題 → 結合情境解釋嚴重性 → 提出具體修法」的閉環需要 LLM。'],
    },
    {
      heading: '可行性',
      paragraphs: ['Places Details 營業時間現成已接(速贏);交通需 Routes/Distance Matrix API(有成本,需快取)。'],
      note: '誤報率是命門——狼來了幾次使用者就永久關掉。',
    },
  ],
  tags: ['功能腦力激盪', '行程健檢', '信任', '三視角命中'],
  source: ['docs/feature-brainstorm.md'],
}
