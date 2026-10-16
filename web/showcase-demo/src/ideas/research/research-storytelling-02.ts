import type { IdeaDoc } from '../types'

export const RESEARCH_STORYTELLING_02: IdeaDoc = {
  id: 'research-storytelling-02',
  group: 'research',
  order: 2,
  title: '點子 2:事實膠囊(Wikidata 結構化知識切片)',
  summary: '把介紹卡的 badges 升級成可點開的事實膠囊,資料來自 Wikidata 結構化事實。',
  sections: [
    {
      heading: '資料取得',
      paragraphs: [
        'Wikidata SPARQL 抓結構化事實——創建年份、建築樣式、文化財指定、關聯人物、海拔/高度等,CC0 授權無法務風險。可行性高但覆蓋不均:清水寺這級地標欄位齊全,小店幾乎沒有 → 只適用主題點,精選點不硬套。建檔時 CLI 加一個 wikidata-id 欄位即可批次同步。',
      ],
    },
    {
      heading: '如何介紹',
      paragraphs: [
        '介紹卡 badges 區升級為「事實膠囊」——「778 年創建」「懸造工法」「世界遺產 1994」,每顆可點開一張小知識卡(一個事實+一句白話解釋)。',
      ],
    },
    {
      heading: '如何引導',
      paragraphs: [
        '膠囊就在現有 badges 位置,不新增入口;點膠囊是好奇心驅動的微互動,讀完即關,不打斷地圖流程。',
      ],
    },
    {
      heading: '增強使用者感受',
      paragraphs: [
        '解決「簡介沒有可信度、沒有記憶點」。結構化事實比形容詞可信,「快閃族 10 秒掌握這裡為什麼重要」。',
      ],
    },
  ],
  verdict: '可行性/優先度:高(第二優先)。資料免費、自動化程度高,與點子 1 是同一張卡的兩層,建議打包成「介紹卡 2.0」一起做。已做 artifact(與點子 1 合併示範)。',
  tags: ['景點介紹', 'Wikidata', '第二優先'],
  source: ['docs/research-attraction-storytelling-ideas-2026-09.md'],
}
