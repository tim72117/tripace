import type { IdeaGroupId } from './ideas/types'

// categories.ts——handbook 首頁(/)的項目分類。首頁只列分類,點進分類頁
// (/category/:id)才列出該分類的文章清單。
//
// 分類只是「怎麼分組顯示」,不改文章本身的資料與網址:
//   - 系統維護、稽核文件、構想:內容是 ideas/ 底下的構想頁,用 groupIds 指到對應的
//     構想群組(ideas/groups.ts),清單由 IdeasIndexPage 依群組渲染。
//   - 點子開發、系統文件:內容是 HandbookIndex.tsx 的 ITEMS(雛形頁與內部文件)與封存區,
//     用 ITEM_MODE 指到 HandbookIndex 的顯示模式。
export type HandbookCategoryId = 'ideas' | 'prototypes' | 'system-docs' | 'system-maintenance' | 'audit'

export interface HandbookCategory {
  id: HandbookCategoryId
  title: string
  blurb: string
  // groupIds——這個分類包含哪些構想群組(ideas/groups.ts);沒有的分類內容不是構想頁。
  groupIds?: IdeaGroupId[]
}

// 顯示順序即陣列順序。
export const HANDBOOK_CATEGORIES: HandbookCategory[] = [
  {
    id: 'ideas',
    title: '構想',
    blurb: '產品構想、AI 排行程的多輪設計討論、行程規劃設計討論與研究發想。',
    groupIds: ['product', 'ai-planning-r1', 'ai-planning-r2', 'ai-planning-vision', 'design-discussion', 'research'],
  },
  {
    id: 'prototypes',
    title: '點子開發',
    blurb: '構想的雛形試做頁面:版面、互動與資料都是前端假資料,用來驗證點子。',
  },
  {
    id: 'system-docs',
    title: '系統文件',
    blurb: '已經長成這樣的現況整理:資料分層、地圖繪製層、時間軸結構,以及已實作功能的封存備查。',
  },
  {
    id: 'system-maintenance',
    title: '系統維護',
    blurb: '資料同步、維運操作與工具缺口的紀錄與構想,例如景點同步的選定欄位覆蓋。',
    groupIds: ['system-maintenance'],
  },
  {
    id: 'audit',
    title: '稽核文件',
    blurb: '程式碼盤點與稽核:成本控制、快取涵蓋範圍、一致性與安全性檢查。',
    groupIds: ['audit'],
  },
]

export function getCategory(id: string | undefined): HandbookCategory | undefined {
  return HANDBOOK_CATEGORIES.find((c) => c.id === id)
}

// categoryOfGroup——構想群組屬於哪個分類(構想頁的返回連結用)。
export function categoryOfGroup(group: IdeaGroupId): HandbookCategory | undefined {
  return HANDBOOK_CATEGORIES.find((c) => c.groupIds?.includes(group))
}
