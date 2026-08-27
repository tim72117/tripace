import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import styles from './DesktopMain.module.css'

// DesktopMain:桌面版右側主要區塊容器(原全域字串 class .desktop-main +
// 兩條 :has() 選擇器 .desktop-main:has(.pace-route-map-wrap)/
// .desktop-main:has(.geo-outline-panel-wrap))——寬螢幕時預設不拉滿,限制
// 最大寬度 860px 並置中,避免時間軸/聊天內容被拉得過寬;地圖類內容(配速
// 表路線圖、地理規劃輪廓底圖)則相反,應該拿掉這個上限、跟著容器一路
// 放大。
//
// 原本用 :has() 被動偵測子孫節點是否包含 .pace-route-map-wrap/
// .geo-outline-panel-wrap 來決定要不要拿掉寬度上限——改成明確的
// unbounded prop,理由:grep 過三處呼叫端(DesktopLayout.tsx/
// pace/PacePage.tsx/trip/PublicViewScreen.tsx 的 PublicPaceDrawerMap),
// 全部在渲染 <DesktopMain> 的當下就已經確定會不會放地圖類內容——
// DesktopLayout.tsx 由 panelSpec?.slot === 'main-replace' 這個既有分支
// 判斷式決定(main-replace 時渲染 RouteEditor/DemoPanelContent,不會有
// geo-outline-panel-wrap;其餘情況固定渲染 GeoOutlinePanel,一定有),
// PacePage.tsx/PublicViewScreen.tsx 則是無條件固定渲染 PaceRouteMap。
// 沒有任何一處是「渲染當下還不確定,要等巢狀路由/非同步資料才決定」的
// 情況,故不需要保留 :has() 這種被動偵測機制——prop 是更符合 React
// 明確傳遞資料慣例的作法,也讓「這個容器現在算不算滿版地圖模式」在型別
// 層級可見,不必透過 CSS 選擇器反推子樹結構。
//
// .pace-route-map-wrap/.geo-outline-panel-wrap 這兩個全域字串 class 原本
// 存在的唯一理由就是給這裡的 :has() 選擇器偵測——grep 確認過沒有其他
// CSS 規則依賴它們後,已經一併清掉(PaceRouteMap.module.css 的 wrap 改回
// 一般會被雜湊的 CSS Modules class,GeoOutlinePanel.tsx 的最外層 div
// 不再疊加這個字串 class),不留這種只服務單一已刪除規則的殘留固定命名。
export interface DesktopMainProps {
  children: ReactNode
  // unbounded:見上方元件說明——true 時拿掉 860px 寬度上限與置中,改成
  // 滿版鋪底;配速表路線圖額外需要自己接手垂直捲動(見 module.css 的
  // .unboundedScroll 說明),地理規劃輪廓底圖不需要(地圖本身用
  // position:absolute; inset:0 撐滿容器)。用兩個具名 prop 而非一個
  // boolean,因為兩者拿掉寬度上限後,捲動權的處理方式不同,合併成一個
  // prop 會逼著地理規劃輪廓底圖也背上不需要的 overflow-y:auto。
  unbounded?: boolean
  // unboundedScroll:僅在 unbounded 為 true 時有意義——配速表路線圖
  // (PaceRouteMap)需要 .desktop-main 本身接手垂直捲動(原
  // .pace-chart 改自然高度不再自己捲),地理規劃輪廓底圖(GeoOutlinePanel)
  // 用 position:absolute 撐滿,不需要這組 overflow 設定。
  unboundedScroll?: boolean
  className?: string
}

// forwardRef——比照 ScrollArea.tsx/Button.tsx 既有慣例保留轉發能力,目前
// 沒有呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const DesktopMain = forwardRef<HTMLElement, DesktopMainProps>(function DesktopMain(
  { children, unbounded, unboundedScroll, className },
  ref,
) {
  const classes = [styles.main]
  if (unbounded) classes.push(styles.unbounded)
  if (unbounded && unboundedScroll) classes.push(styles.unboundedScroll)
  if (className) classes.push(className)
  return (
    <main ref={ref} className={classes.join(' ')}>
      {children}
    </main>
  )
})
