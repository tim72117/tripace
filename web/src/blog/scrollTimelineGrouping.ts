// scrollTimelineGrouping.ts——把 ThemePageContent.blocks 扁平陣列裡的
// 'scroll-timeline-start'/'scroll-timeline-anchor'/'scroll-timeline-end'
// 標記點收斂成可渲染的分組結構。見 types.ts ScrollTimelineStartBlock
// 開頭的完整設計說明:這三種標記不帶巢狀 Block 陣列,靠這支純函式在
// 渲染前做「一次線性掃描」動態分組,型別本身維持扁平、不需要遞迴引用。
//
// 獨立成檔案(而非留在 BlogArticlePage.tsx 元件內部)的理由:這是
// 純粹的資料轉換邏輯(輸入扁平陣列、輸出分組結構),不涉及 DOM/React
// 渲染,拆開才能直接寫單元測試覆蓋容錯分支(落單 anchor、巢狀 start、
// 未閉合 start),對齊 plan-core/planTimeline.ts 把純資料邏輯獨立出來
// 測試的既有慣例。
import type { ScrollTimelineAnchorBlock, ScrollTimelineStartBlock, ThemePageBlock } from './types'

/** 分組後的單一 ScrollTimeline 區塊——start 標記的設定值 + 依序收集到
 *  的錨點(每個錨點各自帶自己的 content:從這個 anchor 標記之後、到
 *  下一個 anchor 或 end 之前,收集到的一般 block)。 */
export interface ScrollTimelineGroup {
  start: ScrollTimelineStartBlock
  anchors: Array<{ meta: ScrollTimelineAnchorBlock; content: ThemePageBlock[] }>
}

export type RenderItem =
  | { type: 'block'; block: ThemePageBlock; index: number }
  | { type: 'scroll-timeline'; group: ScrollTimelineGroup; key: string }

// groupScrollTimelineBlocks:把扁平 blocks 陣列轉成 RenderItem 清單。
// 容錯規則(對齊 types.ts 第 6 點「未知/不合法內容不中斷渲染」的一貫
// 態度,這裡的錯誤不是來自讀者的瀏覽器環境,而是來自 CLI 編輯者手寫
// JSON 時可能寫錯順序或漏寫邊界,兩者都不該讓整頁渲染中斷或拋錯):
//   - 'scroll-timeline-anchor' 出現在 start 之前(落單的 anchor)——
//     整個忽略這個標記本身(它沒有外層 ScrollTimeline 可以歸屬),但
//     不中斷其餘 block 的渲染。
//   - 遇到巢狀的 'scroll-timeline-start'(start 還沒遇到對應的 end,
//     又出現下一個 start)——視為前一組「忘記寫 end」,直接在這裡結束
//     前一組、開始收集新的一組,而不是拋錯或互相覆蓋。
//   - 陣列結尾前仍有未閉合的 start(忘記寫 end)——視為「直到陣列結尾
//     都算這一組」,正常輸出,不因為缺少明確的 end 標記就整組捨棄
//     (編輯者少打一個 end block 不該讓整個 ScrollTimeline 區塊消失)。
export function groupScrollTimelineBlocks(blocks: ThemePageBlock[]): RenderItem[] {
  const items: RenderItem[] = []
  let current: ScrollTimelineGroup | null = null
  let groupSeq = 0

  const flushCurrent = () => {
    if (current) {
      items.push({ type: 'scroll-timeline', group: current, key: `scroll-timeline-${groupSeq++}` })
      current = null
    }
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'scroll-timeline-start') {
      // 巢狀 start(前一組忘記寫 end)——先結束前一組,再開新的一組。
      flushCurrent()
      current = { start: block, anchors: [] }
      return
    }
    if (block.kind === 'scroll-timeline-anchor') {
      if (current) {
        current.anchors.push({ meta: block, content: [] })
      }
      // 落單的 anchor(還沒遇到 start)——忽略這個標記本身,不輸出任何
      // RenderItem,也不影響其餘 block 的收集。
      return
    }
    if (block.kind === 'scroll-timeline-end') {
      flushCurrent()
      return
    }
    // 一般 block:目前若正在收集某一組,且已經遇到至少一個 anchor,就
    // 歸進最近那個 anchor 的 content;否則(還沒進入任何 scroll-timeline
    // 區段,或 start 之後、第一個 anchor 之前)當成普通 block 輸出。
    if (current && current.anchors.length > 0) {
      current.anchors[current.anchors.length - 1].content.push(block)
      return
    }
    items.push({ type: 'block', block, index })
  })

  flushCurrent()
  return items
}
