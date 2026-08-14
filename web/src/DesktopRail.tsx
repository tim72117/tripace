import {
  List, Sparkles, GalleryHorizontal, Layers, Radio, Activity, Route, BookOpen,
} from 'lucide-react'
import { Timeline } from 'lucide-react'
import type { ClientConfig } from './api'
import type { User } from './types'
import { DesktopUserMenu } from './DesktopUserMenu'
import {
  type PanelMode, GEO_OUTLINE_ENABLED, TIMELINE_ENABLED, PACE_ENABLED,
  DEMO_CARDS_ENABLED, DEMO_ROW_ENABLED, DEMO_ONAGENT_ENABLED, DEBUG_PANEL_ENABLED,
  DEMO_ROUTE_EDITOR_ENABLED,
} from './DesktopShared'

// DesktopRail:桌面版最左側的導覽圖示列——從 DesktopLayout.tsx 抽出獨立
// 成檔案,原本就是完整獨立的函式,搬移純粹是移動程式碼位置,不涉及邏輯
// 重組。內部渲染 DesktopUserMenu(左下角使用者選單),兩者的耦合關係
// 維持不變。
export function DesktopRail({
  panelMode,
  onSelect,
  tripListOpen,
  onToggleTripList,
  timelineDisabled,
  user,
  isGuest,
  cfg,
  onAuthed,
  onLogout,
  onOpenSettings,
  showDebugPanel,
  onToggleDebugPanel,
}: {
  panelMode: PanelMode
  onSelect: (mode: Exclude<PanelMode, null>) => void
  // tripListOpen/onToggleTripList:「行程列表」按鈕改成獨立疊加面板後,不再
  // 走 onSelect('trips')/panelMode 這套機制(理由見 DesktopLayout.tsx 內
  // tripListOpen state 宣告處的說明),故 active 樣式與點擊行為都改吃這組
  // 獨立傳入的 boolean/toggle,不再從 panelMode 判斷。
  tripListOpen: boolean
  onToggleTripList: () => void
  timelineDisabled: boolean
  user: User
  isGuest: boolean
  cfg: ClientConfig
  onAuthed: (token: string, user: User, email: string) => void
  onLogout: () => void
  onOpenSettings: () => void
  // showDebugPanel/onToggleDebugPanel:API/WS 狀態面板(原 DebugApp.tsx 的
  // DebugPanel)的開關狀態——獨立於 panelMode 之外的一個 boolean,不是三態
  // 切換的一員,因為這個面板是疊加顯示、不取代 side panel 或 .desktop-main
  // 的內容(見 DesktopLayout.tsx 渲染邏輯裡 showDebugPanel 的用法)。
  showDebugPanel: boolean
  onToggleDebugPanel: () => void
}) {
  return (
    <nav className="desktop-rail">
      <div className="desktop-rail-buttons">
        <button
          className={`desktop-rail-btn${tripListOpen ? ' active' : ''}`}
          onClick={onToggleTripList}
          title="行程列表"
        >
          <List size={20} strokeWidth={1.8} />
        </button>
        {/* GEO_OUTLINE_ENABLED:這次部署刻意不開啟(見 DesktopShared.tsx
            對這個常數的說明),按鈕本身不渲染——不是只隱藏視覺,isPanelMode
            也不再承認 'geo-outline',兩者搭配才是「整個功能真的進不去」,
            不只是找不到入口。 */}
        {GEO_OUTLINE_ENABLED && (
          <button
            className={`desktop-rail-btn${panelMode === 'geo-outline' ? ' active' : ''}`}
            onClick={() => onSelect('geo-outline')}
            title="規劃"
          >
            <Layers size={20} strokeWidth={1.8} />
          </button>
        )}
        {/* TIMELINE_ENABLED/PACE_ENABLED:編譯時 feature flag(見
            DesktopShared.tsx 對這兩個常數的說明),關閉時按鈕不渲染,
            isPanelMode 也不再承認對應字串,同 GEO_OUTLINE_ENABLED 的機制。 */}
        {TIMELINE_ENABLED && (
          <button
            className={`desktop-rail-btn${panelMode === 'timeline' ? ' active' : ''}`}
            onClick={() => !timelineDisabled && onSelect('timeline')}
            disabled={timelineDisabled}
            title={timelineDisabled ? '請先選擇一個行程' : '時間軸'}
          >
            <Timeline size={20} strokeWidth={1.8} />
          </button>
        )}
        {PACE_ENABLED && (
          <button
            className={`desktop-rail-btn${panelMode === 'pace' ? ' active' : ''}`}
            onClick={() => onSelect('pace')}
            title="路徑"
          >
            <Route size={20} strokeWidth={1.8} />
          </button>
        )}
        {/* DEMO_*_ENABLED/DEBUG_PANEL_ENABLED:各自獨立的編譯時 feature flag
            (見 DesktopShared.tsx 對這幾個常數的說明),取代原本綁在網址參數
            ?demo 底下的單一 isDemo 開關——分隔線只在至少一項開啟時出現,
            避免試做項目跟正式功能混在一起難以分辨。 */}
        {(DEMO_CARDS_ENABLED || DEMO_ROW_ENABLED || DEMO_ONAGENT_ENABLED || DEBUG_PANEL_ENABLED) && (
          <div className="desktop-rail-divider" />
        )}
        {DEMO_CARDS_ENABLED && (
          <button
            className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-cards' ? ' active' : ''}`}
            onClick={() => onSelect('demo-cards')}
            title="推薦景點卡片(試做)"
          >
            <Sparkles size={20} strokeWidth={1.8} />
          </button>
        )}
        {DEMO_ROW_ENABLED && (
          <button
            className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-row' ? ' active' : ''}`}
            onClick={() => onSelect('demo-row')}
            title="推薦景點橫滑(試做)"
          >
            <GalleryHorizontal size={20} strokeWidth={1.8} />
          </button>
        )}
        {DEMO_ONAGENT_ENABLED && (
          <button
            className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-onagent' ? ' active' : ''}`}
            onClick={() => onSelect('demo-onagent')}
            title="onagent 平台串接試做"
          >
            <Radio size={20} strokeWidth={1.8} />
          </button>
        )}
        {DEBUG_PANEL_ENABLED && (
          <button
            className={`desktop-rail-btn desktop-rail-btn-demo${showDebugPanel ? ' active' : ''}`}
            onClick={onToggleDebugPanel}
            title="API / WS 狀態面板"
          >
            <Activity size={20} strokeWidth={1.8} />
          </button>
        )}
        {DEMO_ROUTE_EDITOR_ENABLED && (
          <button
            className={`desktop-rail-btn desktop-rail-btn-demo${panelMode === 'demo-route-editor' ? ' active' : ''}`}
            onClick={() => onSelect('demo-route-editor')}
            title="路徑編輯器(試做)"
          >
            <BookOpen size={20} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <DesktopUserMenu
        cfg={cfg}
        user={user}
        isGuest={isGuest}
        onAuthed={onAuthed}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
      />
    </nav>
  )
}
