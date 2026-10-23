import type { ReactNode, Ref } from 'react'
import type { PlanPanelStopsBinding } from './usePlanStopsState'

// layerContracts——規劃地圖「較大分層元件」的共同介面(2026-10)。
//
// 規劃地圖有三個入口(/ai-plan、登入後手機、登入後桌面),每個入口都是同一組分層,每一層有一個同名元件、放在各自的目錄
// (同層同功能同檔名):
//
//   第 1 層  Content            狀態擁有者(入口元件)       home/plan-ai-sim/、phone/、desktop/
//   第 2 層  PlanLayout         最外層容器(data-slot="container")
//   第 3 層  PlanOverlayLayout  地圖層加疊加層外殼(OverlayShell 的薄包裝)
//   第 4 層  LivePlanLayer      推論層:把規劃面板內容(PlanPanelContent)接上這個入口
//   第 5 層  PlanMap            地圖元件(NativeMapBase + 統一繪製層),/ai-plan 一份、登入後手機與桌面共用一份
//
// 行程詳情頁(itineraries/)也有第 2、3、5 層的同名元件(PlanLayout、PlanOverlayLayout、PlanMap),沒有第 4 層(不接真實 AI)。
// 這個檔案定義各層「所有入口都必須滿足」的最小介面(Contract)。各入口的元件 props 以它為基礎再補入口特有的欄位:
// 共同的部分只有一份定義,新入口或日後調整時,TypeScript 會在不符合契約的實作上直接報錯,不必靠註解維持一致。
// 契約只定義「跨入口一致」的欄位;入口特有的欄位(例如手機的 tabBarHeight、桌面的 shifted、/ai-plan 的 wide)留在各自的 Props。
// plan-core/layerContracts.test.tsx 以型別層級的斷言確認每個實作都滿足對應的契約。

// 第 5 層 PlanMap:兩份 PlanMap 共同的 props 已在 geo-planning/planMapShared.ts 的 PlanMapSharedProps(站點檢視、theme、
// currentPosition、整條路線旗標),不重複定義。
//
// 第 1 層 Content:入口元件沒有跨入口共同的 props(/ai-plan 的 Content 不收 props;登入後兩個入口共用 AppCommon 的
// ContentProps,由 App 依螢幕寬度擇一渲染)。這一層的契約是「它持有該入口的狀態,並渲染第 2~4 層」,見各檔檔頭。

// 第 2 層 PlanLayout:最外層容器,渲染 data-slot="container"(見 overlayDom.ts),children 放在容器裡。
export interface PlanLayoutContract {
  children: ReactNode
}

// 第 3 層 PlanOverlayLayout:地圖當 mapBackground 放進 map-layer,內容放進疊加層的 panel(見 OverlayShell)。
export interface PlanOverlayLayoutContract {
  // 地圖層內容(NativeMapBase 與地圖元件 PlanMap 就放這裡);沒傳就不渲染 map-layer。
  mapBackground?: ReactNode
  // 安全區節點的 ref(safe-area:沒被面板蓋住的地圖範圍)。必填:每個入口的鏡頭平移(首站、搜尋、點選圖卡)都要避開面板,
  // 讀這個節點算落點(useMapSafeArea、PlanMap 的 panTarget)。沒面積時(overlay 收起)平移退回直接 panTo。
  safeAreaRef: Ref<HTMLDivElement>
  // passThrough——疊加層(面板)不接收指標事件,讓空白處的拖曳/縮放穿透到底下的地圖;要互動的內容自己把 pointer-events 設回 auto。
  // 統一用這個參數控制(不寫死在樣式裡):不傳就是會攔截。登入後手機、桌面與行程詳情頁一律傳 true;/ai-plan 推論態傳 true,
  // 模擬態不傳(內容沒有為穿透做準備)。wide 側欄(桌面滑鼠操作,不覆蓋地圖)收下但不使用。
  passThrough?: boolean
  children: ReactNode
}

// 第 4 層 LivePlanLayer:站點檢視接線——受控的 selectedStopId(時間軸卡片與地圖圓點共用同一份選取,雙向同步)加四個
// 回報回呼(tripPlanProps)。cfg、visible、onPanToStop 等入口特有的欄位由各入口自己補。
export type LivePlanLayerContract = PlanPanelStopsBinding
