import type { IdeaDoc } from '../types'

export const RESEARCH_ROUTE_PATH_04: IdeaDoc = {
  id: 'research-route-path-04',
  group: 'research',
  order: 33,
  title: '路徑機制:後端角度(計算、存放發布、AI 參考)',
  summary: '路徑計算沿用既有 computeRouteByWaypoints,存放比照 content_pages 由 CLI 發布,AI 透過新工具 find_route_path 參考。',
  sections: [
    {
      heading: '路徑計算',
      paragraphs: [
        '沿用既有的 computeRouteByWaypoints()(server/internal/api/pace_route.go)——給 RoutePath.waypoints 當 origin/intermediates/destination,一樣打 Google Routes API 算出 encodedPolyline 與每段 leg 的起訖座標,計算邏輯不需要重新發明,只是輸入來源從「使用者行程裡的 entry 座標」換成「路徑自己登記的固定途經點」。',
      ],
    },
    {
      heading: '資料存放與發布',
      paragraphs: [
        '可以比照部落格 content_pages 那套模式:路徑本身是一種內容型態,由內部 CLI 建立/編輯/發布(不透過一般使用者介面寫入),存進資料庫一張 route_paths 表,themePoints/children 這類巢狀結構用 JSON 欄位存放(對齊 content_pages 的 JSON 內容區塊模式,不用把每一層都拆成獨立的關聯表)。',
        'CLI 指令大致是 cli route-path create/update/publish 這個方向,細節(欄位驗證、草稿/發布狀態機)留到實際要做的時候再比照 content_pages CLI 的既有慣例展開,這裡先點出「不是全新一套系統,是同一套內容發布模式的另一種內容型態」這個方向即可。',
      ],
    },
    {
      heading: 'AI 排行程時怎麼「參考」路徑',
      paragraphs: [
        '路徑資料本身可以當作 LLM 工具呼叫的一種查詢結果(類似現有的 attractionTools.ts 查詢機制),例如新增一個 find_route_path 工具,依使用者提及的地區/關鍵字找出匹配的已登記路徑,回傳給 LLM 當作排程的參考骨架,而不是要 LLM 自己憑空想像一條路徑該怎麼走。',
      ],
    },
  ],
  tags: ['路徑', '後端', 'Google Routes API', 'LLM 工具'],
  source: ['docs/research-route-path-planning-2026-10.md'],
}
