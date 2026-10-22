// layoutDebugFlag——UI layout 除錯疊圖的共用開關:網址帶 ?debugSafeArea=1
// 就開。與 /ai-plan(home/plan-ai-sim/Content.tsx 的 DEBUG_SAFE_AREA)
// 同一個參數,登入後的 /app 規劃面板(PlanOverlayLayout)也吃它——
// 讀 URL 參數而不是改程式碼的常數:不用動原始碼就能開,也不會因為忘了
// 改回去而誤上 production。
//
// 傳入 search 字串而不是直接讀 window:純函式才好測。呼叫端在渲染時傳
// window.location.search。
export function isLayoutDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).has('debugSafeArea')
}
