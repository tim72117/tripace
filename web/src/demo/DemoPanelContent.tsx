import { RecommendedPlacesList, RecommendedPlacesRow, FAKE_RECOMMENDED_PLACES } from '../recommended-places/RecommendedPlaces'
import { OnagentBridgeDemo } from '../clienttools/OnagentBridgeDemo'
import type { DemoPanelMode } from '../DesktopShared'

// DemoPanelContent:3 個 demo 面板的內容渲染,供桌面版 DesktopContent 的
// <main>(見 DesktopLayout.tsx)與手機版 PhoneNavDrawer(見該檔案)共用,
// 避免同一段 JSX 兩處各寫一份、之後改一邊忘了改另一邊。(配速表/地理輪廓
// 底圖已轉為正式功能'pace'/'geo-outline',不再屬於這組 demo 面板,渲染
// 邏輯改為直接使用 PaceChart/PaceRouteMap、GeoCandidateSidebar/
// GeoOutlinePanel,見 DesktopLayout.tsx / PhoneContent.tsx /
// PhoneNavDrawer.tsx。這 3 種 demo 模式都不需要 cfg,故不接這個 prop。)
//
// DemoPanelMode 型別留在 DesktopShared.tsx(從 PanelMode 衍生,被
// PANEL_REGISTRY/isPanelMode 等桌面/手機共用的正式邏輯依賴),只有這個
// 渲染函式本體移到 demo/ 目錄——理由同 RouteEditor.tsx 移到 demo/:
// DemoPanelContent 渲染的三種模式(demo-cards/demo-row/demo-onagent)都是
// 預設關閉的試做功能(見 DEMO_*_ENABLED),不是正式功能。
export function DemoPanelContent({
  mode,
}: {
  mode: DemoPanelMode
}) {
  if (mode === 'demo-cards') {
    return (
      <div className="desktop-demo-panel">
        <div className="desktop-sidebar-head">
          <span className="desktop-sidebar-title">推薦景點卡片(試做)</span>
        </div>
        <div className="desktop-timeline-scroll">
          <RecommendedPlacesList places={FAKE_RECOMMENDED_PLACES} />
        </div>
      </div>
    )
  }
  if (mode === 'demo-row') {
    return (
      <div className="desktop-demo-panel">
        <div className="desktop-sidebar-head">
          <span className="desktop-sidebar-title">推薦景點橫滑(試做)</span>
        </div>
        <div className="desktop-timeline-scroll">
          <RecommendedPlacesRow places={FAKE_RECOMMENDED_PLACES} />
        </div>
      </div>
    )
  }
  return <OnagentBridgeDemo />
}
