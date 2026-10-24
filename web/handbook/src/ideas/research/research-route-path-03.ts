import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_03: IdeaDoc = {
  id: 'research-route-path-03',
  group: 'research',
  order: 32,
  title: '路徑機制:資料結構草案(RoutePath / RouteThemePoint)',
  summary: '路徑是具名路線,可掛多個主題點,主題點底下再掛子景點,複用既有 PlanThemeChild 型別。',
  sections: [
    {
      heading: '設計原則',
      paragraphs: [
        '路徑(RoutePath,暫定名稱)需要能表達「一條具名的路線」,並且能掛多個主題點,對齊既有的主題點/子景點概念(web/src/plan-core/planTimeline.ts 的 PlanThemeChild,該檔案說明:「鄰近的景點不用每個都安排時間點,而是集合的概念」),而不是另外發明一套平行的資料模型。',
      ],
    },
    {
      heading: 'RoutePath 欄位',
      bullets: [
        'id: string',
        'name: string——「花東縱谷自行車道」「九份金瓜石老街線」',
        'desc?: string——這條路徑適合誰、適合什麼心情走',
        'waypoints: RouteWaypoint[]——途經點序列,決定線怎麼畫',
        'themePoints?: RouteThemePoint[]——沿線的主題點(可選)',
        'suggestedDays?: number——建議天數(走完整條路大致需要幾天)',
        'travelModes?: 「walk」「bike」「drive」「transit」的陣列——適合的交通方式',
        'sourceBlogPostId?: string——若這條路徑是從某篇部落格文章萃取/連結而來',
        'encodedPolyline?: string——快取 Google Routes API 算出的路徑線(對齊 PaceRouteMap.tsx 的 RouteCache.encoded)',
      ],
    },
    {
      heading: 'RouteWaypoint 欄位',
      bullets: [
        'lat: number',
        'lng: number',
        'label?: string——給 Routes API intermediates 用的輔助標籤',
      ],
    },
    {
      heading: 'RouteThemePoint 欄位',
      paragraphs: [
        'RouteThemePoint 直接複用 PlanThemeChild 的欄位子集概念——一條路徑上掛的「主題點」跟時間軸上的主題節點是同一種展示單位,只是容器從「時間軸節點」換成「路徑上的一個定錨點」。',
      ],
      bullets: [
        'id: string',
        'name?: string',
        'desc?: string',
        'placeId?: string',
        'lat?: number、lng?: number',
        'googlePhotoUrls?: string[]',
        'children?: PlanThemeChild[]——這個主題點底下還可以再掛多個子景點,完全沿用既有型別,不重新定義',
      ],
    },
    {
      heading: '關鍵設計決定',
      paragraphs: [
        '一條路徑底下能掛多個主題點,一個主題點底下又能掛多個子景點——三層結構(路徑 → 主題點 → 子景點)對應「這條路線 → 沿途幾個值得停的區域 → 每個區域裡具體的景點」這個自然的心智模型。',
        'AI 排行程時可以選擇在「主題點」這一層粒度安排(整個區域排一個時段),也可以下探到「子景點」這一層(區域裡特定幾個點各自安排),彈性留給排程邏輯決定,不是資料結構本身的限制。',
      ],
    },
  ],
  tags: ['路徑', '資料結構', 'PlanThemeChild'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
