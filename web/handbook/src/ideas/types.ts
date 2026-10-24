// ideas/types.ts——「構想」頁面的共用資料格式。
//
// 背景:原本散在 docs/ 的產品構想、多輪設計討論、研究發想,改寫成
// handbook 的頁面,一個構想一個網址(/ideas/:id),由同一份版型
// (IdeaPage.tsx)依這個格式渲染。原始文件已從 docs/ 移除,細節以這裡的
// 資料為準;每筆資料的 source 欄位記錄原始檔案的歷史路徑,需要追溯原文時
// 查 git 歷史。

export type IdeaGroupId =
  | 'product'            // 產品構想類(原 docs/brainstorm、功能腦力激盪等)
  | 'ai-planning-r1'     // AI 排行程多輪討論——第一輪(地基未補齊的現況)
  | 'ai-planning-r2'     // AI 排行程多輪討論——第二輪(補齊交通/營業時間查詢後)
  | 'ai-planning-vision' // AI 排行程多輪討論——願景篇(AI 做得好時的新價值)
  | 'design-discussion'  // 行程規劃設計討論(三方角色討論、UX 設計)
  | 'research'           // 研究類發想
  | 'audit'              // 稽核報告(程式碼盤點、成本/安全/一致性檢查;本頁即原始文件)

export interface IdeaGroupMeta {
  id: IdeaGroupId
  title: string
  blurb: string
}

// 一個段落區塊。四種內容欄位可以任意組合,依序渲染:
// paragraphs → bullets → table → note。
export interface IdeaSection {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
  // 原文是表格的內容(例如優先度總表、方案比較)。每列長度要等於 headers。
  table?: { headers: string[]; rows: string[][] }
  // 需要特別標出的提醒/前提/待確認事項。
  note?: string
}

// 多輪討論中的一則發言。speaker 是原文的角色名稱(例如「新手旅行者」
// 「行程規劃師」「老手旅行者」「設計師」「仲裁(主代理)」),text 是改寫後
// 保留實質論點的內容,不是逐字複製。
export interface IdeaDiscussionTurn {
  speaker: string
  text: string
}

export interface IdeaDoc {
  // 網址用識別碼,小寫英數與連字號,全部構想不可重複:
  // `${group 簡稱}-${兩位數編號}`,例如 'ai-r1-01'、'vision-07'、'design-12'。
  // 產品構想與研究類用語意化短名,例如 'product-ad-placement-admin-ui'。
  id: string
  group: IdeaGroupId
  // 組內排序(由小到大)。討論類沿用原文構想編號。
  order: number
  title: string
  // 提出者的角色(原文有寫才填),例如「新手旅行者」「行程規劃師」。
  proposer?: string
  // 一到兩句話的摘要,列表頁顯示。
  summary: string
  sections: IdeaSection[]
  // 多輪討論的過程(有逐輪原始稿的構想才填)。
  discussion?: IdeaDiscussionTurn[]
  // 最後的結論/仲裁判定/建議做法。
  verdict?: string
  tags?: string[]
  // 原始檔案的歷史路徑(docs/ 下的路徑)。改寫自舊 docs/ 文件的構想至少一筆;
  // 稽核報告(group: 'audit')直接以這個頁面為原始文件,不填。
  source?: string[]
}
