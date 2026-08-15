import {
  List, Sparkles, GalleryHorizontal, Layers, Radio, Activity, Route, BookOpen, PanelLeft,
} from 'lucide-react'
import { Timeline } from 'lucide-react'
import type { ClientConfig } from './api'
import type { User } from './types'
import { DesktopUserMenu } from './DesktopUserMenu'
import {
  type PanelMode, GEO_OUTLINE_ENABLED, TIMELINE_ENABLED, PACE_ENABLED,
  DEMO_CARDS_ENABLED, DEMO_ROW_ENABLED, DEMO_ONAGENT_ENABLED, DEBUG_PANEL_ENABLED,
  DEMO_ROUTE_EDITOR_ENABLED, PANEL_REGISTRY,
} from './DesktopShared'

// DesktopRail:桌面版最左側的導覽圖示列——從 DesktopLayout.tsx 抽出獨立
// 成檔案,原本就是完整獨立的函式,搬移純粹是移動程式碼位置,不涉及邏輯
// 重組。內部渲染 DesktopUserMenu(左下角使用者選單),兩者的耦合關係
// 維持不變。
export function DesktopRail({
  panelMode,
  onSelect,
  activeTrip,
  chatCollapsed,
  onToggleChat,
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
  // activeTrip:是否已選定行程——只用來決定 requiresTrip 的按鈕(目前是
  // 時間軸)要不要 disabled,判斷本身統一從 PANEL_REGISTRY 讀
  // (見下方 requiresTrip 用法),不再各別硬寫 timelineDisabled 這種
  // 單一按鈕專屬的 prop。
  activeTrip: boolean
  // chatCollapsed/onToggleChat:左側常駐對話欄(見 DesktopLayout.tsx 的
  // chatCollapsed state)自己的收合開關,獨立於 panelMode 之外。
  chatCollapsed: boolean
  onToggleChat: () => void
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
          className={`desktop-rail-btn${chatCollapsed ? '' : ' active'}`}
          onClick={onToggleChat}
          title={chatCollapsed ? '展開對話欄' : '收合對話欄'}
        >
          <PanelLeft size={20} strokeWidth={1.8} />
        </button>
        <button
          className={`desktop-rail-btn${panelMode === 'trips' ? ' active' : ''}`}
          onClick={() => onSelect('trips')}
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
        {TIMELINE_ENABLED && (() => {
          const disabled = !!PANEL_REGISTRY.timeline.requiresTrip && !activeTrip
          return (
            <button
              className={`desktop-rail-btn${panelMode === 'timeline' ? ' active' : ''}`}
              onClick={() => !disabled && onSelect('timeline')}
              disabled={disabled}
              title={disabled ? '請先選擇一個行程' : '時間軸'}
            >
              <Timeline size={20} strokeWidth={1.8} />
            </button>
          )
        })()}
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
