import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_01: IdeaDoc = {
  id: 'research-route-path-01',
  group: 'research',
  order: 30,
  title: '路徑機制:核心問題與背景',
  summary: '把「路徑」從行程排完後才算出的衍生結果,升級成 AI 排行程前就能參考、甚至直接套用的既有資料。',
  sections: [
    {
      heading: '文件定位',
      paragraphs: [
        '本文為產品方向腦力激盪七項構想中的「構想七:路徑機制」的研究筆記,與 web/handbook/src/RoutePathPlanningPage.tsx(視覺化構想稿雛形頁,路由 /route-path-planning)內容同步。',
        '這是一次性研究筆記(2026-10),若之後這份構想定案要推進成實作規劃,另開 refactor 類文件承接。構想七原本在產品方向腦力激盪文件中只登記為「構想登記中,內容尚未撰寫」的佔位項目,本筆記補完內容。',
      ],
    },
    {
      heading: '核心問題',
      paragraphs: [
        'AI 現在排行程時,是把一堆單獨的景點(entry)丟進時間軸,靠座標距離跟營業時間湊出合理順序。這種做法對「景點彼此沒有強烈地理關聯」的情境沒問題,但對某些旅遊型態——沿著一條溪流、一段海岸線、一條老街、一條花東縱谷的脈絡——這種「順著走」本身就是體驗的一部分,單點湊順序湊不出這種感覺。',
        '現有的「路徑」功能(web/src/pace/PaceRouteMap.tsx + server/internal/api/pace_route.go)已經證明「給一批有座標的點,串 Google Routes API 算出一條沿真實路網走的路徑」這件事能做。但它目前只是配速表的輔助視覺(畫出使用者已經排好的行程點之間怎麼走),路徑本身不是一個可以被預先定義、命名、重複使用的實體。',
        '這正是構想七要補的缺口:把「路徑」從「行程排完後才算出來的衍生結果」,升級成「AI 排行程前就可以參考、甚至直接套用的既有資料」。',
      ],
    },
  ],
  tags: ['路徑', 'AI 排程', '構想七'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
