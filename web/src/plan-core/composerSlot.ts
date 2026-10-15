import { createContext } from 'react'

// ComposerSlotContext——版面外殼(home/plan-ai-sim/PlanOverlayPanel.tsx)
// 提供的「輸入框插槽」DOM 節點。
//
// 外殼只管版面(定位、事件穿透、安全區),輸入框的位置挖成一個 slot 讓各層
// 自己放進去。內容元件(TripPlanPage)不需要知道外殼長什麼樣,只看這個
// context 的三種值:
//   - undefined:不在任何外殼裡(/app 的浮動面板、手機 sheet、/trip-plan
//     全頁),輸入框維持原位渲染,行為跟加這個 context 之前完全一致。
//   - null:在外殼裡,但插槽節點還沒掛載(第一次 render),先不渲染輸入框,
//     等插槽就緒再傳送進去,避免先在錯誤位置閃一下。
//   - HTMLElement:把輸入框 portal 進這個節點。
export const ComposerSlotContext = createContext<HTMLElement | null | undefined>(undefined)
