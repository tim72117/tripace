import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_09: IdeaDoc = {
  id: 'research-storytelling-09',
  group: 'research',
  order: 9,
  title: '點子 9:時令橫幅(季節與即時脈絡)',
  summary: '依使用者的旅行日期,在介紹卡顯示花期、紅葉、祭典等時令橫幅,讓介紹跟著旅程活起來。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: ['混合——花期/紅葉見頃用公開預測資訊(日本 Weathernews 系列每年發布、台灣各風景區公告)人工季度性維護;活動祭典抓官方觀光網站;不追求即時 API 串接,先用「策展人每季更新一次」的低科技版。'],
    },
    {
      heading: '如何介紹',
      paragraphs: ['介紹卡照片下方一條時令橫幅:「11 月中—12 月初 夜間特別拜觀,紅葉見頃」,依「使用者的旅行日期」(行程已有日期資料)而非今天日期顯示。'],
    },
    {
      heading: '如何引導',
      paragraphs: ['只在旅行日期落在時令窗口 ±2 週時出現,平時不佔版面;點橫幅展開該季節的一段補充敘事(夜楓怎麼排、清晨躲人潮)。'],
    },
    {
      heading: '增強使用者感受',
      paragraphs: ['解決「介紹是永恆罐頭、跟我這趟無關」。同一個清水寺在 4 月與 11 月該講的話不一樣——這是「介紹跟著旅程活起來」最便宜的做法。'],
    },
  ],
  verdict: '可行性/優先度:中高。資料維護是季度級不是即時級,成本可控;與行程日期的整合是 tripace 相對 Google Maps 的天然優勢位。',
  tags: ['景點介紹', '季節', '行程日期'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
