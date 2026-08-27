import { useState } from 'react'
import {
  List, Layers, Radio, Activity, Route, BookOpen, PanelLeft,
} from 'lucide-react'
import { Timeline } from 'lucide-react'
import type { ClientConfig } from './api'
import type { User } from './user/types'
import { DesktopUserMenu } from './user/DesktopUserMenu'
import {
  type PanelMode, TIMELINE_ENABLED, PACE_ENABLED,
  DEMO_ONAGENT_ENABLED, DEBUG_PANEL_ENABLED,
  DEMO_ROUTE_EDITOR_ENABLED, PANEL_REGISTRY,
} from './DesktopShared'
import styles from './DesktopRail.module.css'
import './desktop-layout-shell.css'

// DesktopRail:桌面版最左側的導覽圖示列——從 DesktopLayout.tsx 抽出獨立
// 成檔案,原本就是完整獨立的函式,搬移純粹是移動程式碼位置,不涉及邏輯
// 重組。內部渲染 DesktopUserMenu(左下角使用者選單),兩者的耦合關係
// 維持不變。
export function DesktopRail({
  panelMode,
  onSelect,
  activeTrip,
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
  // activeTrip:是否已選定旅程——只用來決定 requiresTrip 的按鈕(目前是
  // 時間軸)要不要 disabled,判斷本身統一從 PANEL_REGISTRY 讀
  // (見下方 requiresTrip 用法),不再各別硬寫 timelineDisabled 這種
  // 單一按鈕專屬的 prop。
  activeTrip: boolean
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
  // expanded:rail 從純 icon(48px)展開成帶文字標籤的寬版——純 UI 狀態,
  // 跟對話功能完全無關(對話小匡的開關由地圖上的 AI 按鈕獨立控制,見
  // GeoOutlineMap.tsx 的 onOpenChat),不提升到 DesktopLayout.tsx,
  // 留在這個元件自己管理。展開時每顆按鈕在 icon 旁多顯示一個文字標籤
  // (.desktop-rail-btn-label),讓使用者不需要靠 title 提示 hover 才知道
  // 每顆圖示的功能——理由同一般 IDE/工具列「圖示列可展開成帶標籤側欄」
  // 的既有慣例(如 VSCode 的 activity bar 搭配可展開的側欄標題)。
  const [expanded, setExpanded] = useState(false)

  return (
    <nav className={`desktop-rail${expanded ? ' expanded' : ''}`}>
      <div className={styles.buttons}>
        {/* 展開/收合 rail 本身的開關,固定用 PanelLeft 圖示(不隨 expanded
            切換圖示)——跟其餘功能按鈕排在同一組列表最上方,不是獨立區塊,
            對話功能已完全不在 rail 上(見 GeoOutlineMap.tsx 的 AI 按鈕,
            對話浮動小匡由地圖上的 onOpenChat 觸發,與這裡的 rail 展開/
            收合無關)。 */}
        <button
          type="button"
          className={styles.btn}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? '收合導覽列' : '展開導覽列'}
        >
          <PanelLeft size={20} strokeWidth={1.8} />
          {expanded && <span className={styles.btnLabel}>收合導覽列</span>}
        </button>
        <button
          className={panelMode === 'trips' ? `${styles.btn} ${styles.active}` : styles.btn}
          onClick={() => onSelect('trips')}
          title="旅程列表"
        >
          <List size={20} strokeWidth={1.8} />
          {expanded && <span className={styles.btnLabel}>旅程列表</span>}
        </button>
        {/* 規劃地圖已不再有獨立 feature flag(使用者明確要求——見
            DesktopShared.tsx 對這件事的說明),按鈕永遠渲染,不再用條件式
            包住。 */}
        <button
          className={panelMode === 'geo-outline' ? `${styles.btn} ${styles.active}` : styles.btn}
          onClick={() => onSelect('geo-outline')}
          title="規劃"
        >
          <Layers size={20} strokeWidth={1.8} />
          {expanded && <span className={styles.btnLabel}>規劃</span>}
        </button>
        {/* TIMELINE_ENABLED/PACE_ENABLED:編譯時 feature flag(見
            DesktopShared.tsx 對這兩個常數的說明),關閉時按鈕不渲染,
            isPanelMode 也不再承認對應字串,同理。 */}
        {TIMELINE_ENABLED && (() => {
          const disabled = !!PANEL_REGISTRY.timeline.requiresTrip && !activeTrip
          return (
            <button
              className={panelMode === 'timeline' ? `${styles.btn} ${styles.active}` : styles.btn}
              onClick={() => !disabled && onSelect('timeline')}
              disabled={disabled}
              title={disabled ? '請先選擇一趟旅程' : '時間軸'}
            >
              <Timeline size={20} strokeWidth={1.8} />
              {expanded && <span className={styles.btnLabel}>時間軸</span>}
            </button>
          )
        })()}
        {PACE_ENABLED && (
          <button
            className={panelMode === 'pace' ? `${styles.btn} ${styles.active}` : styles.btn}
            onClick={() => onSelect('pace')}
            title="路徑"
          >
            <Route size={20} strokeWidth={1.8} />
            {expanded && <span className={styles.btnLabel}>路徑</span>}
          </button>
        )}
        {/* DEMO_*_ENABLED/DEBUG_PANEL_ENABLED:各自獨立的編譯時 feature flag
            (見 DesktopShared.tsx 對這幾個常數的說明),取代原本綁在網址參數
            ?demo 底下的單一 isDemo 開關——分隔線只在至少一項開啟時出現,
            避免試做項目跟正式功能混在一起難以分辨。(原本還有推薦景點
            卡片/橫滑兩顆試做按鈕,已整個移除,含入口與實作。) */}
        {(DEMO_ONAGENT_ENABLED || DEBUG_PANEL_ENABLED) && (
          <div className={styles.divider} />
        )}
        {DEMO_ONAGENT_ENABLED && (
          <button
            className={panelMode === 'demo-onagent' ? `${styles.btn} ${styles.btnDemo} ${styles.active}` : `${styles.btn} ${styles.btnDemo}`}
            onClick={() => onSelect('demo-onagent')}
            title="onagent 平台串接試做"
          >
            <Radio size={20} strokeWidth={1.8} />
            {expanded && <span className={styles.btnLabel}>onagent 平台串接試做</span>}
          </button>
        )}
        {DEBUG_PANEL_ENABLED && (
          <button
            className={showDebugPanel ? `${styles.btn} ${styles.btnDemo} ${styles.active}` : `${styles.btn} ${styles.btnDemo}`}
            onClick={onToggleDebugPanel}
            title="API / WS 狀態面板"
          >
            <Activity size={20} strokeWidth={1.8} />
            {expanded && <span className={styles.btnLabel}>API / WS 狀態面板</span>}
          </button>
        )}
        {DEMO_ROUTE_EDITOR_ENABLED && (
          <button
            className={panelMode === 'demo-route-editor' ? `${styles.btn} ${styles.btnDemo} ${styles.active}` : `${styles.btn} ${styles.btnDemo}`}
            onClick={() => onSelect('demo-route-editor')}
            title="路徑編輯器(試做)"
          >
            <BookOpen size={20} strokeWidth={1.8} />
            {expanded && <span className={styles.btnLabel}>路徑編輯器(試做)</span>}
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
