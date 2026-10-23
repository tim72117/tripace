import { createContext } from 'react'

// overlayDom——「地圖加疊加 UI」外殼的共同 DOM 骨架(slot 契約)。
//
// 三個入口:/ai-plan(home/plan-ai-sim/PlanLayout + PlanOverlayLayout)、登入後手機版(phone/PlanOverlayLayout)、
// 登入後桌面版(desktop/PlanOverlayLayout)各自實作自己的版面元件與 CSS,但用同一套 DOM 配置:容器底下依序是
//
//   container         最外層容器(/ai-plan:PlanLayout 的 .container;登入後:phone/Content 的 .container)
//   ├─ map-layer      地圖層(最底層,放地圖)
//   ├─ controls-slot  地圖控制項插槽(搜尋框、類別標籤等 portal 進來;沒有內容時是空的)
//   └─ overlay        疊加層(規劃面板的外殼,可整個 hidden)
//     ├─ safe-area     安全區洞(看不見、不佔版面,只用來標「地圖主顯示區」的範圍;在 overlay 的座標系裡,各入口用自己的 CSS 標出)
//     └─ panel        規劃面板
//             │  (內容)        時間軸等,不屬於骨架
//             └─ composer-slot 輸入列插槽(內容元件用 ComposerSlotContext portal 進來)
//
// 每個節點用 data-slot 屬性標示(不靠 class 名稱,各自的 CSS Module 會編成不同雜湊)。
// 各入口的 DOM 是否一致由 overlayDom.contract.test.tsx 把關。位置、尺寸、z-index 由各自的 CSS
// 決定,不在契約內(例如 /ai-plan 的 map-layer 自成 stacking context,登入後的則刻意不是,
// 因為地圖層裡的資訊卡 sheet 要能蓋過疊加層)。
export const OVERLAY_SLOT = {
  container: 'container',
  mapLayer: 'map-layer',
  controlsSlot: 'controls-slot',
  overlay: 'overlay',
  panel: 'panel',
  safeArea: 'safe-area',
  composerSlot: 'composer-slot',
} as const

export type OverlaySlot = (typeof OVERLAY_SLOT)[keyof typeof OVERLAY_SLOT]

export const slotAttr = (name: OverlaySlot) => ({ 'data-slot': name }) as const

// 把容器底下帶 data-slot 的節點依巢狀關係整理成字串(沒有 data-slot 的元素略過,往下展開),供契約測試比對。
export function describeSlotTree(root: Element): string {
  const walk = (el: Element): string[] =>
    [...el.children].flatMap((child) => {
      const name = child.getAttribute('data-slot')
      const inner = walk(child)
      if (!name) return inner
      return [inner.length ? `${name}(${inner.join(',')})` : name]
    })
  return walk(root).join(',')
}

// 面板裡第一個「真正的內容元素」(時間軸等,TripPlanPage 根元素):略過 composer-slot 這類帶 data-slot 的骨架節點
// (safe-area 在 overlay 底下、不在 panel 裡,舊版本曾排在 panel 最前面,所以這裡仍一併略過任何帶 data-slot 的節點)。
// 除錯疊圖要靠它量時間軸範圍,不能用 panel.firstElementChild 當內容根。
export function panelContentRoot(panel: Element | null | undefined): Element | null {
  if (!panel) return null
  return [...panel.children].find((c) => !c.hasAttribute('data-slot')) ?? null
}

// ComposerSlotContext——版面外殼(home/plan-ai-sim/desktop、wide 的 PlanOverlayPanel.tsx)
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
