import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { AssistLang } from './assistLang'
import { RecommendedPlacesList, RecommendedPlacesRow, FAKE_RECOMMENDED_PLACES } from './RecommendedPlaces'
import { ClientToolsDemo } from './clienttools/bridge/ClientToolsDemo'
import { OnagentBridgeDemo } from './clienttools/OnagentBridgeDemo'
import langSelectStyles from './LangSelect.module.css'

// DesktopShared:桌面版與手機版都會用到的 UI 小塊,從 App.tsx 拆出來獨立成
// 檔案——這些東西不屬於「純桌面版佈局」(見 DesktopLayout.tsx),因為手機版
// 的 PhoneNavDrawer/SettingsScreen(見 PhoneNavDrawer.tsx/PhoneScreens.tsx)
// 也需要引用它們;若整批併入 DesktopLayout.tsx,會讓手機版檔案跟
// DesktopLayout.tsx 互相 import 對方,形成循環依賴。獨立成第三份檔案,
// 兩邊都單向 import 這裡,不互相依賴。

// PanelMode:桌面版 side panel 目前顯示的內容;null 代表收合(主區全寬)。
// 'demo-cards'/'demo-row':試做用的推薦景點呈現方式(假資料,見
// RecommendedPlaces.tsx)。'demo-clienttools'/'demo-onagent':「LLM 呼叫
// 前端 tool」試做的兩條資料流(前者走 tripace 自己的
// ClientToolsBridge/clienttools_ws.go,後者走 onagent 平台,見
// clienttools/ClientToolsDemo.tsx / OnagentBridgeDemo.tsx 的說明)。這 4 個
// 模式各自由獨立的 DEMO_*_ENABLED 編譯時 feature flag 控制是否出現(見
// 下方說明),不是綁在同一個開關底下。(原本還有 'demo-map'——推薦景點
// 地圖試做,見 RecommendedPlacesMap.tsx——已整個移除,含入口與實作。)
// 'trips'/'timeline'/'pace'/'geo-outline':正式導覽項目,所有使用者都能在
// rail 上看到(依各自的 *_ENABLED flag),渲染邏輯直接使用 DesktopTripList/
// MultiTrackTimeline/PaceChart+PaceRouteMap、GeoCandidateSidebar/
// GeoOutlinePanel,見 DesktopLayout.tsx / PhoneContent.tsx /
// PhoneNavDrawer.tsx,不屬於這組共用的 demo 面板(DemoPanelContent)。
export type PanelMode =
  | 'trips' | 'timeline' | 'pace' | 'geo-outline'
  | 'demo-cards' | 'demo-row' | 'demo-clienttools' | 'demo-onagent'
  | null

// GEO_OUTLINE_ENABLED:地理輪廓底圖(規劃分頁)功能開關——目前是唯一
// 預設開啟的正式功能(未設定部署環境變數 VITE_FEATURE_GEO_OUTLINE 時,
// 一律視為開啟),只有明確設為字串 "false" 才關閉。開啟時 DesktopRail
// 渲染「規劃」按鈕(見該元件),isPanelMode 承認 'geo-outline' 是合法值;
// 關閉時兩者都會擋下,即使手動打 /app/geo-outline 網址也會 fallback 回
// 'trips'(對齊 DesktopContent 對不合法 panelMode 字串的既有 fallback
// 行為,見該處說明)——整套關閉是「進不去這個功能」而不只是「rail 上看
// 不到按鈕」。
export const GEO_OUTLINE_ENABLED = import.meta.env.VITE_FEATURE_GEO_OUTLINE !== 'false'

// TIMELINE_ENABLED/PACE_ENABLED:「時間軸」/「路徑」(配速表)rail 按鈕各自
// 獨立的開關,同 GEO_OUTLINE_ENABLED 的擋法(見上方說明),但預設值相反
// ——兩者預設關閉,只在明確設為字串 "true" 時才啟用。關閉時 rail 不渲染
// 對應按鈕,isPanelMode 也不再承認該字串是合法值,即使手動打 /app/timeline
// 或 /app/pace 網址也會 fallback 回 'trips',不只是找不到入口。兩者分開
// 成獨立旗標(而非合併成一個),是因為兩個功能彼此獨立,部署時可能只想開
// 其中一個。
export const TIMELINE_ENABLED = import.meta.env.VITE_FEATURE_TIMELINE === 'true'
export const PACE_ENABLED = import.meta.env.VITE_FEATURE_PACE === 'true'

// DEMO_CARDS_ENABLED/DEMO_ROW_ENABLED/DEMO_CLIENTTOOLS_ENABLED/
// DEMO_ONAGENT_ENABLED/DEBUG_PANEL_ENABLED:原本綁在網址參數 ?demo(見
// main.tsx 的 isDemo)底下的試做用導覽項目(推薦景點卡片/橫滑兩種呈現
// 方式、ClientToolsBridge/onagent 兩條 LLM 呼叫前端 tool 資料流試做、
// API/WS 狀態除錯面板),改成跟 TIMELINE_ENABLED/PACE_ENABLED 同一種編譯
// 時 feature flag 機制——各自獨立開關而非沿用單一 isDemo 布林值,是因為
// 部署時可能只想開放其中幾項給特定環境驗證,不是全開或全關兩種選擇。同
// TIMELINE_ENABLED/PACE_ENABLED,預設關閉,只在明確設為字串 "true" 時
// 才啟用。
export const DEMO_CARDS_ENABLED = import.meta.env.VITE_FEATURE_DEMO_CARDS === 'true'
export const DEMO_ROW_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ROW === 'true'
export const DEMO_CLIENTTOOLS_ENABLED = import.meta.env.VITE_FEATURE_DEMO_CLIENTTOOLS === 'true'
export const DEMO_ONAGENT_ENABLED = import.meta.env.VITE_FEATURE_DEMO_ONAGENT === 'true'
export const DEBUG_PANEL_ENABLED = import.meta.env.VITE_FEATURE_DEBUG_PANEL === 'true'

// PANEL_MODES:PanelMode 扣掉 null 之後的合法字串值列表——給 isPanelMode()
// 在執行期驗證用(型別系統只在編譯期擋得住,URL 路徑參數是使用者可任意
// 輸入的字串,需要執行期白名單檢查)。'geo-outline' 依 GEO_OUTLINE_ENABLED
// 動態決定要不要列入合法值,理由見該常數的說明。
const PANEL_MODES = [
  'trips',
  ...(TIMELINE_ENABLED ? (['timeline'] as const) : []),
  ...(PACE_ENABLED ? (['pace'] as const) : []),
  ...(GEO_OUTLINE_ENABLED ? (['geo-outline'] as const) : []),
  ...(DEMO_CARDS_ENABLED ? (['demo-cards'] as const) : []),
  ...(DEMO_ROW_ENABLED ? (['demo-row'] as const) : []),
  ...(DEMO_CLIENTTOOLS_ENABLED ? (['demo-clienttools'] as const) : []),
  ...(DEMO_ONAGENT_ENABLED ? (['demo-onagent'] as const) : []),
] as const

// isPanelMode:驗證 URL 路徑參數(/app/:panelMode,見 App.tsx)是不是合法的
// PanelMode 字串。使用者可能手動輸入或分享一個帶著錯字/過期參數的網址
// (例如改名前的 'demo-pace' 或亂打的字串),這種不合法輸入不能直接當作
// PanelMode 使用,否則後面 panelMode === 'xxx' 的判斷全部落空、side panel
// 卡在一個「看起來選了某個 rail 按鈕、實際上什麼都不顯示」的中間態。
export function isPanelMode(v: string | undefined): v is Exclude<PanelMode, null> {
  return v != null && (PANEL_MODES as readonly string[]).includes(v)
}

// DemoPanelMode:PanelMode 扣掉 trips/timeline/pace/geo-outline/null 之後
// 只剩的 4 種 demo 面板——正式功能(trips/timeline/pace/geo-outline)在
// 桌面版是 side panel 的正式功能,手機版則是 PhoneNavDrawer(見該檔案)
// 裡對應的分頁,兩邊各自處理,不算在這組共用的 demo 面板裡。
export type DemoPanelMode = Exclude<PanelMode, 'trips' | 'timeline' | 'pace' | 'geo-outline' | null>

// DemoPanelContent:4 個 demo 面板的內容渲染,供桌面版 DesktopContent 的
// <main>(見 DesktopLayout.tsx)與手機版 PhoneNavDrawer(見該檔案)共用,
// 避免同一段 JSX 兩處各寫一份、之後改一邊忘了改另一邊。(配速表/地理輪廓
// 底圖已轉為正式功能'pace'/'geo-outline',不再屬於這組 demo 面板,渲染
// 邏輯改為直接使用 PaceChart/PaceRouteMap、GeoCandidateSidebar/
// GeoOutlinePanel,見 DesktopLayout.tsx / PhoneContent.tsx /
// PhoneNavDrawer.tsx。這 4 種 demo 模式都不需要 cfg,故不接這個 prop。)
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
  if (mode === 'demo-clienttools') return <ClientToolsDemo />
  return <OnagentBridgeDemo />
}

// LLM 回答語言下拉選單:自訂觸發列 + 選項清單,取代原生 <select>,樣式與互動
// 比照 iOS 風格(觸發列排版沿用 .field input,選項清單沿用 .desktop-user-popover
// 的浮層視覺——卡片背景、圓角、陰影)。SettingsDialog(桌面版,見
// DesktopLayout.tsx)/SettingsScreen(手機版,見 App.tsx)共用同一份實作,
// 只各自傳入目前值與 onChange;兩處容器寬度不同但元件本身以 width: 100%
// 撐滿父層 .field,不需要為此分開兩份程式碼。點擊外部關閉的實作模式沿用
// DesktopUserMenu:useRef 抓容器 + mousedown 監聽判斷點擊處是否在容器內。
const ASSIST_LANG_OPTIONS: { value: AssistLang; label: string }[] = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: '英文' },
]

export function LangSelect({
  value,
  onChange,
}: {
  value: AssistLang
  onChange: (v: AssistLang) => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = ASSIST_LANG_OPTIONS.find((o) => o.value === value)

  return (
    <div className={langSelectStyles.select} ref={boxRef}>
      <button
        type="button"
        className={langSelectStyles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown size={16} strokeWidth={1.8} color="var(--ios-gray)" />
      </button>
      {open && (
        <div className={langSelectStyles.popover}>
          {ASSIST_LANG_OPTIONS.map((o) => (
            <button
              type="button"
              key={o.value}
              className={langSelectStyles.option}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={16} strokeWidth={2} color="var(--ios-blue)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// TokenDisplay:API Token 顯示 + 複製按鈕,SettingsDialog(桌面版)/
// SettingsScreen(手機版)共用,理由同 LangSelect。
export function TokenDisplay({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false)

  const copyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  if (!token) return null

  const displayToken = token.substring(0, 20) + '...' + token.substring(token.length - 10)

  return (
    <>
      <div className="token-box">{displayToken}</div>
      <div style={{ padding: '0 16px 12px' }}>
        <button className={`btn-secondary${copied ? ' success' : ''}`} onClick={copyToken}>
          {copied ? '✅ 已複製' : '複製 Token'}
        </button>
      </div>
    </>
  )
}
