import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_05: IdeaDoc = {
  id: 'research-route-path-05',
  group: 'research',
  order: 34,
  title: '路徑機制・場景一:AI 提議一條路徑',
  summary: 'AI 不立刻條列景點,而是先彈出橫向捲動的路徑卡,讓使用者選一條已鋪好的真實路線。',
  sections: [
    {
      heading: '前端介面層構想說明',
      paragraphs: [
        '這部分不寫規格條列,而是描繪使用者實際會看到、會點、會停下來多看一眼的畫面(Fable 風格發想,對應 web/handbook/src/RoutePathPlanningPage.tsx 的視覺化版本)。',
      ],
    },
    {
      heading: '場景描繪',
      paragraphs: [
        '使用者在對話框打了「想去花蓮玩三天,喜歡騎腳踏車」。AI 的回覆不是立刻條列景點,而是先彈出一張橫向捲動的「路徑卡」——卡片上半是一張小地圖縮圖,一條淺棕色的線沿著河岸蜿蜒,線上標著三、四個半透明的圓點;卡片下半寫著「花東縱谷平地森林自行車道・建議 2 天・適合單車/步行」。卡片右下角一顆按鈕:「套用這條路徑規劃」。',
        '使用者一看就懂——這不是 AI 臨時編的,是一條真實存在、被很多人走過的路,他只是在選一條已經鋪好的路,不是從一張空白地圖開始。',
      ],
    },
  ],
  tags: ['路徑', '前端', '場景'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
