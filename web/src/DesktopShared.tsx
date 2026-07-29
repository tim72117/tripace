import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { AssistLang } from './assistLang'
import { RecommendedPlacesList, RecommendedPlacesRow, FAKE_RECOMMENDED_PLACES } from './RecommendedPlaces'
import { RecommendedPlacesMap } from './RecommendedPlacesMap'
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
// 'demo-cards'/'demo-row'/'demo-map':試做用的推薦景點呈現方式(假資料,見
// RecommendedPlaces.tsx/RecommendedPlacesMap.tsx)。'demo-clienttools'/
// 'demo-onagent':「LLM 呼叫前端 tool」試做的兩條資料流(前者走 tripace 自己的
// ClientToolsBridge/clienttools_ws.go,後者走 onagent 平台,見
// clienttools/ClientToolsDemo.tsx / OnagentBridgeDemo.tsx 的說明),原本只能
// 從獨立的 ?debug 工作台(DebugApp.tsx)進入,現在併入這裡統一用 ?demo 存取。
// 'pace':單車配速表(真實路線里程/時刻表,見 PaceChart.tsx),已從
// ?demo 限定的試做功能轉為正式導覽項目,所有使用者都能在 rail 上看到。
export type PanelMode =
  | 'channels' | 'timeline' | 'pace'
  | 'demo-cards' | 'demo-row' | 'demo-map' | 'demo-clienttools' | 'demo-onagent'
  | null

// PANEL_MODES:PanelMode 扣掉 null 之後的合法字串值列表——給 isPanelMode()
// 在執行期驗證用(型別系統只在編譯期擋得住,URL 路徑參數是使用者可任意
// 輸入的字串,需要執行期白名單檢查)。
const PANEL_MODES = [
  'channels', 'timeline', 'pace',
  'demo-cards', 'demo-row', 'demo-map', 'demo-clienttools', 'demo-onagent',
] as const

// isPanelMode:驗證 URL 路徑參數(/app/:panelMode,見 App.tsx)是不是合法的
// PanelMode 字串。使用者可能手動輸入或分享一個帶著錯字/過期參數的網址
// (例如改名前的 'demo-pace' 或亂打的字串),這種不合法輸入不能直接當作
// PanelMode 使用,否則後面 panelMode === 'xxx' 的判斷全部落空、side panel
// 卡在一個「看起來選了某個 rail 按鈕、實際上什麼都不顯示」的中間態。
export function isPanelMode(v: string | undefined): v is Exclude<PanelMode, null> {
  return v != null && (PANEL_MODES as readonly string[]).includes(v)
}

// DemoPanelMode:PanelMode 扣掉 channels/timeline/pace/null 之後只剩的 5 種
// demo 面板——channels/timeline/pace 在桌面版是 side panel 的正式功能,
// 手機版則是 PhoneNavDrawer(見該檔案)裡對應的分頁,兩邊各自處理,不算在
// 這組共用的 demo 面板裡。
export type DemoPanelMode = Exclude<PanelMode, 'channels' | 'timeline' | 'pace' | null>

// DemoPanelContent:5 個 demo 面板的內容渲染,供桌面版 DesktopContent 的
// <main>(見 DesktopLayout.tsx)與手機版 PhoneNavDrawer(見該檔案)共用,
// 避免同一段 JSX 兩處各寫一份、之後改一邊忘了改另一邊。(配速表已轉為正式
// 功能 'pace',不再屬於這組 demo 面板,渲染邏輯改為直接使用 PaceChart/
// PaceRouteMap,見 DesktopLayout.tsx / PhoneContent.tsx / PhoneNavDrawer.tsx。)
export function DemoPanelContent({ mode }: { mode: DemoPanelMode }) {
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
  if (mode === 'demo-map') {
    return (
      <div className="desktop-demo-panel">
        <div className="desktop-sidebar-head">
          <span className="desktop-sidebar-title">推薦景點地圖(試做)</span>
        </div>
        <div className="desktop-timeline-scroll" style={{ padding: 0 }}>
          <RecommendedPlacesMap places={FAKE_RECOMMENDED_PLACES} />
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
