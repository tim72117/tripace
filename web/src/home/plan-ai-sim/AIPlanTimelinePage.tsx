import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TIME_DRAG_ENABLED } from '../../DesktopShared'
import { useThemeToggle } from '../../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../SiteNavButtons'
import { trackEvent } from '../../analytics'
import { useSyncedState } from '../../hooks/useSyncedState'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { createPlanAiPublicDataSource } from './planAiPublicDataSource'
import { BASE_URL } from '../../AppCommon'
import type { PlanAiDataSource } from './planAiDataSource'
import { createPlanSimFakeSource } from './planSimFakeSource'
import type { PlanSimSource } from './planSimSource'
import { PlanTimelineView } from '../../plan-core/PlanTimelineView'
import { Composer } from '../../components/Composer'
import { LivePlanLayer } from './LivePlanLayer'
import { PlanDemoLayout } from './PlanDemoLayout'
import { HorizontalPlanTimeline } from './HorizontalPlanTimeline'
import { ScriptedAskPage } from './ScriptedAskPage'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { useIsWide } from '../../hooks/useIsWide'
import { Lightbox } from '../../geo-planning/PhotoCarousel'
import type { AskPageCandidate } from '../../plan-core/askPageTools'
import { useAskPageBridge } from '../../plan-core/useAskPageBridge'
// planTimeline.ts——共用的時間軸領域層(純函式,不碰 UI 或任何後端
// 呼叫),直接 import plan-core/ 那份跟正式頁 trip-plan/TripPlanPage.tsx
// 共用,不維護 home/plan-ai-sim/ 底下重複的一份。這個目錄原本有一份幾乎
// 一模一樣的副本(唯一差異是死碼清理時拿掉的一個已確認恆為 no-op 的
// 判斷式,兩份行為完全等價),是從 plan-ai-sim 分支原封不動搬過來時一併
// 帶進來的重複檔案。
import {
  createEmptyTimeline,
  removeDay,
  getTimeDragBounds,
  insertAfter,
  removeNode,
  staleOtherAgentMessages,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanThemeChild,
  type PlanTimeline,
} from '../../plan-core/planTimeline'
import { NativeMapBase, type MapHandle } from '../../geo-planning/NativeMapBase'
// SafeAreaDebugOverlay——地圖安全區的除錯疊圖(開發工具,用
// ?debugSafeArea=1 開啟,見該檔案檔頭的完整說明)。
//
// 用 lazy 動態載入而不是靜態 import:DEBUG_SAFE_AREA 是執行期才知道的
// 值(讀 URL 參數),Vite 無法靜態判斷這段永遠用不到、搖不掉,靜態
// import 會讓這個純開發工具跟著進正式打包結果。改成 lazy 之後它自成
// 一個 chunk,沒帶那個 URL 參數的訪客完全不會下載。
const SafeAreaDebugOverlay = lazy(() =>
  import('./SafeAreaDebugOverlay').then((m) => ({ default: m.SafeAreaDebugOverlay })),
)
// WideLayoutDebugOverlay——wide 模式(見 PlanOverlayPanelWide 的完整
// 說明)側欄/composer 插槽的除錯疊圖,共用同一個 ?debugSafeArea=1 開關,
// 見該檔案檔頭的完整說明:標示的是不同的幾何,跟上面的
// SafeAreaDebugOverlay 互補、不是取代關係。同樣 lazy 載入,理由相同。
const WideLayoutDebugOverlay = lazy(() =>
  import('./WideLayoutDebugOverlay').then((m) => ({ default: m.WideLayoutDebugOverlay })),
)
import type { PlanStopMarker } from '../../geo-planning/usePlanStopMarkers'
import { useMapMarkerLayer, type MapMarkerPoint } from '../../geo-planning/mapMarkerLayer'
import { useMapSafeArea } from '../../geo-planning/useMapSafeArea'
import { SIDEBAR_WIDTH, SIDEBAR_TOP, COMPOSER_BAND_HEIGHT } from './planOverlayGeometry'
import styles from './AIPlanTimelinePage.module.css'

// LANDING_MAP_ID——主題介紹頁(home/InteractiveExploreMap.tsx)同名常數的
// 複製,不是 import 自那個檔案:兩邊都只是各自讀同一個環境變數
// VITE_GOOGLE_MAPS_LANDING_MAP_ID 的值,該檔案也沒有匯出這個常數,
// 讓這個純展示頁依賴另一個不相關頁面的模組內部細節不划算,直接各自
// 宣告一行比跨檔案耦合更乾淨。2026-10 使用者明確要求「/ai-plan 則用
// 主題介紹頁的地圖」,從 StaticMapBackdrop(Static Maps API 靜態圖)
// 換成這裡的 NativeMapBase(Maps JavaScript API 真實互動地圖),樣式
// 套用同一個 Cloud Style Map ID,視覺與主題介紹頁一致、且允許使用者
// 縮放/拖曳(使用者明確要求「允許互動,跟主題介紹頁一致的體驗」)。
const LANDING_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_LANDING_MAP_ID as string | undefined

// CENTER/ZOOM——地圖初始中心與縮放層級,數值沿用原本 StaticMapBackdrop.tsx
// 同名常數(對準「赤崁・府城」這個主題點所在的老城區,範圍涵蓋展示腳本
// planSimScript.ts 全部 14 個站點,詳細取捨理由見該檔案保留下來的完整
// 說明——StaticMapBackdrop.tsx 本身已不再是這個頁面的地圖來源,但常數
// 選值的理由仍然適用,故原樣沿用數字而非重新調整構圖)。
const CENTER = { lat: 22.9975, lng: 120.1900 }
const ZOOM = 14

// 地圖安全區除錯疊圖——開發工具,用 ?debugSafeArea=1 開啟(見
// SafeAreaDebugOverlay.tsx 檔頭的完整說明)。改成讀 URL 參數而不是
// 改程式碼的常數:不用動原始碼就能隨時開,也不會因為忘了改回 false
// 而誤上 production。
//
// 開啟時會一併停掉模擬播放(見下方 usePlanSimSocket 的呼叫)——驗證
// 中心點計算時畫面上不該有東西在動。
const DEBUG_SAFE_AREA =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSafeArea')
// DEBUG_TARGET——赤崁樓(劇本第一站的座標)。選它是因為它在初始地圖
// 中心(CENTER)的右上方,水平與垂直都有偏移,兩個軸的計算都能驗證到
// ——選一個剛好在中心正上方或正左方的點,會讓其中一軸的 delta 恆為 0,
// 那一軸算錯也看不出來。
const DEBUG_TARGET = { lat: 23.0009, lng: 120.2024 }

// AIPlanTimelinePage — 「AI 安排行程」時間軸展示原型的正式頁面版本。
// 原型先在 Artifact(Design Component 畫布)做過一輪,經 Fable 設計方案
// (版面/時間軸視覺/逐步生成節奏/配色皆出自該輪討論)驗證整體概念後,
// 這裡重寫成 TypeScript + CSS Module,整合進 tripace 專案。
//
// 資料流(2026-09 重構,取代原本純前端 setTimeout 排時序的版本):後端
// server/internal/api/plan_sim_ws.go 的 GET /public/plan-sim/ws 模擬
// 「AI 安排行程」推論過程逐步推播 action 訊息(新增景點/交通/注記/
// 刪除某一步),前端(見下方 usePlanSimSocket/planActionToInsert)收到後
// 直接 dispatch 更新 steps 這個 state 陣列,畫面即時反應——這是使用者
// 明確要求的「結構化前端結構,讓上面的元素可以被新增跟刪除,並反應在
// 畫面上」「提供接口讓 agent 傳進來的訊息可以異動結構資料」的具體實作:
// steps state + planActionToInsert/insertAttractionAfter 就是這個
// 「接口」,只要來源送對格式的 action 訊息(不論是這支模擬 WS、之後
// 真正接上的 LLM 推論,或甚至是手動測試時透過 devtools console 呼叫
// dispatch),都能驅動同一套畫面更新邏輯,不需要為不同來源另外寫一份
// 渲染程式碼。
//
// add_stop 訊息若帶 placeId(見 PlanAction 型別的完整說明),代表「AI
// 呼叫了查地點工具」——插入後 insertAttractionAfter 內部用這個 id 呼叫
// fetchPlanAiPlaceDetailsAny(GET /internal/geo/plan-ai/place-details-any)取得
// 真正的地點名稱/簡介/照片,這是「把 place_id 串到前端、前端用 id 呼叫
// 端點顯示景點」這個需求的具體落地,不是後端直接把完整資料內嵌進訊息裡。
//
// 目前是純模擬展示(見下方「模擬」相關說明),不接真實 AI/LLM——路由
// /plan-ai(見 App.tsx),獨立於 /app 底下的正式導覽系統之外(不套用
// DesktopLayout.tsx/PhoneContent.tsx 那套 panelMode 機制),因為這只是
// 給團隊內部/使用者測試看的功能雛形,尚未有真正的資料流可以接。日後
// 若要正式化,只需要把 usePlanSimSocket 換成真正的 agent 推論 WS 來源
// (訊息格式維持一致),不需要動 planActionToInsert 或下方渲染邏輯。
//
// 視覺語言採用登入後正式 App 的 --ios-* token(base-ui.css),不是
// home/ 底下城市介紹頁那套 --paper/--ink 紙感和風——這個頁面示範的是
// 產品核心功能,不是行銷頁,視覺應該跟真正做出來的樣子一致。
//
// 2026-09:日夜間模式的切換機制改用 home/ 城市介紹頁那套純前端
// useThemeToggle(不寫 localStorage,重新整理會重置),取代原本的
// getTheme()(theme.ts,登入後 App 的深色模式偏好)——使用者明確要求
// 「上方功能列採用跟首頁一樣的漂浮按鈕,要有功能介紹跟登入日夜間切換
// 按鈕」,首頁/城市頁的按鈕(SiteNavThemeToggle)是即時可點擊切換的,
// getTheme() 只是讀一次 localStorage 靜態值、沒有對應的 setter,無法
// 支援這種互動。--ios-* token 系統本身不受影響,一樣掛 app-theme-root
// + data-theme 屬性,只是這個屬性值現在來自可即時切換的 state,不是
// 讀一次就固定的值。

// PlanStep — 對外沿用的節點型別名稱(渲染邏輯/其餘函式仍稱呼它
// PlanStep,對齊既有命名),實際上就是 planTimeline.ts 的 PlanNode——
// 底層儲存已經改成 PlanTimeline(鏈結串列,見該檔案開頭的完整背景
// 說明),不再是普通陣列。這裡只是型別別名,不重新宣告欄位。
type PlanStep = PlanNode

// PlanAction — 後端 GET /public/plan-sim/ws(或日後任何真正的 agent
// 推論來源)推播的訊息形狀,對應 server/internal/api/plan_sim_ws.go 的
// planAction struct(欄位一一對應,JSON key 相同)。planActionToInsert
// 是新增類訊息的唯一轉換點,remove_step 的處理則直接寫在
// usePlanSimSocket 的 ws.onmessage 裡(見該處說明)。
export interface PlanAction {
  // thinking:每一筆實際 action 送出前的「思考中」信號(見
  // plan_sim_ws.go 的完整說明),前端收到時用來觸發/延續思考動畫、
  // 不對時間軸做任何異動(見 ws.onmessage 對這個 type 的處理——提早
  // return,不呼叫 planActionToInsert)。
  //
  // 2026-10 使用者明確要求「先分離推論中跟安排中的信號」,新增
  // nextType 欄位(只有 type === 'thinking' 時才有意義)——原本骨架卡
  // (isGenerating)只要收到任何 thinking 就顯示,但劇本裡 thinking
  // 前導的下一步不一定是 add_stop(也可能是 add_message 這種純旁白
  // 訊息、或 add_note),這種情況下骨架卡顯示了卻完全沒有對應的地點
  // 卡片可以轉場,使用者看到「骨架消失但畫面沒變化」會覺得困惑。改成
  // thinking 攜帶即將送出的下一步真正是什麼 type,接收端
  // (usePlanSimSocket)只在下一步是 add_stop 時才把 isGenerating 設
  // true、顯示骨架卡——「安排中」(骨架卡)跟「推論中」(任何 thinking
  // 都代表 AI 正在運作,但不一定可見)現在是兩個分開的概念,骨架卡只
  // 對應前者。
  nextType?: PlanAction['type']
  // nextId——2026-10 新增(使用者明確要求「安排中時就加入一張卡片,只是
  // 這張卡片沒有資料時就呈現骨架卡」):即將送出的下一步 action 的 id。
  // 骨架卡原本是獨立於 stops 之外、靠 isGenerating 旗標額外渲染的一塊
  // (見 HorizontalPlanTimeline.tsx 先前版本的完整說明),selectedStopId/
  // 自動捲動邏輯因此要另外處理「骨架卡還是地點卡」這個分支,多次踩坑
  // (捲動時機慢一拍、單卡滿版被撐歪等)。改成在 thinking 階段就真的
  // 插入一筆 loading:true、沒有任何資料的 stop 節點到 PlanTimeline
  // (見 ws.onmessage 的 thinking 分支),這個節點需要使用之後 add_stop
  // 訊息會用的同一個 id,之後才能用 updateNode 原地補上真實資料(而不是
  // 插入新節點、留下一個空節點孤兒)——nextId 就是為了讓 thinking 階段
  // 能預先知道「待會兒這個 id」。add_note 等後續動作的 afterId 也引用
  // 這個固定 id(見 planSimScript.ts 既有劇本),若骨架階段用不同的
  // 暫時 id,之後還要處理 id 置換,不如一開始就用對的 id。
  nextId?: string
  // reset——把時間軸清空、回到什麼都還沒排的狀態。
  //
  // 2026-10 為捲動驅動的展示(首頁 ScrollPlanDemo)新增:使用者往回捲時
  // 要看到行程一段一段退回去。PlanSimSource 是串流模型,無法「收回」
  // 已送出的訊息,所以回退的做法是「送一則 reset 清空、再重播到目標
  // 位置」(見 planSimScrollSource.ts 的 advanceTo)。計時器版永遠不會
  // 送這則,行為完全不受影響。
  //
  // reset_day——只清掉某一天(用 day 欄位指定),其餘天數保留。
  //
  // 2026-10 使用者明確要求「首頁展示,當往回滾到前一天時,清除當天的
  // 資料」:回捲跨過日界時,不該像 reset 那樣整個清空重播——那會讓
  // 已經看過的前幾天也跟著消失、再重捲一次才長回來。只清掉「正要退出
  // 的那一天」,前面幾天維持原樣,視覺上就是「這一天的安排被收回去」。
  // 搭配來源端把播放進度倒回那一天的第一步(見 planSimScrollSource.ts
  // advanceTo 的回退分支),再往下捲時這一天會重新一站一站排出來。
  type: 'thinking' | 'reset' | 'reset_day' | 'add_section' | 'add_stop' | 'add_transit' | 'add_note' | 'add_message' | 'remove_step' | 'open_ask_page' | 'done'
  label?: string
  id?: string
  time?: string
  // day——這個 stop 屬於行程的第幾天,對齊 planTimeline.ts PlanNodeData.day
  // 的完整說明(省略視為第 1 天)。使用者明確要求「排程元件加入日的
  // 概念」後新增,讓這個展示頁的固定劇本(planSimScript.ts)能表達兩天
  // 行程,不需要每站時間在整條扁平時間軸上嚴格遞增。
  day?: number
  duration?: string
  kind?: string
  name?: string
  desc?: string
  thumbBg?: string
  thumbIcon?: string
  tags?: string[]
  // placeId:有值時代表這一步「AI 用工具查真實地點資料」——見
  // planActionToInsert 對這個欄位的轉換說明。2026-09 曾經一度改名成
  // attractionId(資料庫景點區域 id),後來隨「回到 placeId」的整體重構
  // (見 attractionTools.ts 檔頭「第四/五/六次重構」的完整說明)改回
  // placeId,跟 onagent 對話路徑(attractionTools.ts 的 add_attraction)
  // 統一用同一套單段 place-details-any 查詢邏輯(見
  // resolveAttractionForStep 的完整說明),不再各自維護一份反查規則。
  placeId?: string
  lat?: number
  lng?: number
  // children——2026-10 新增(使用者明確要求「鄰近的景點不用每個都安排
  // 時間點,而是集合的概念」):這一站是一個「主題點」,底下包含多個
  // 不獨立佔用時間軸時間點的子景點,直接對齊 planTimeline.ts
  // PlanNodeData.children/PlanThemeChild 的完整說明——這裡只是讓
  // planSimScript.ts 能在劇本層表達這個欄位,planActionToInsert 原樣
  // 轉傳給 insertAttractionAfter 的 data,不做任何轉換。
  children?: PlanThemeChild[]
  // candidateCards——2026-10 新增(使用者明確要求「製作多個候選點的
  // 圖卡」「可選的狀態跟地點集合是不一樣的,原本的卡片要換成是多個
  // 小格子的樣子」),直接對齊 planTimeline.ts
  // PlanNodeData.candidateCards 的完整說明——這裡同樣只是讓
  // planSimScript.ts 能在劇本層表達這個欄位,planActionToInsert 原樣
  // 轉傳,不做任何轉換(跟 children 的既有做法一致)。
  candidateCards?: boolean
  icon?: string
  mode?: string
  minutes?: number
  distance?: string
  // category——add_note 專用,備註分類字串(對齊 AIPlanTimelinePage.tsx
  // 的 NOTE_STYLES 表,見該常數的完整說明)。2026-09 重構前這裡是
  // color/noteIcon(視覺樣式直接由後端決定),使用者明確要求「備註寫在
  // 景點的節點上」且分類→視覺樣式的對照權收斂在前端這一層(見
  // planTimeline.ts NoteInfo 的完整說明)後,後端(plan_sim_ws.go)改成
  // 送語意層級的 category,不再送 color/noteIcon。
  category?: string
  text?: string
  removedId?: string
  // afterId:插入位置——有值時插在該 id 對應節點的「後面」,而不是固定
  // append 到時間軸尾端(既有預設行為,省略這個欄位時維持不變)。這是給
  // 「移除某個節點、緊接著插入一個新節點取代同一個時間槽」這種情境用
  // 的(見 AIPlanTimelinePage 下方 removeWumiao 測試按鈕的完整說明)。
  // add_note 訊息(見下方 ws.onmessage 的完整說明)重用這個欄位表達
  // 「要把備註寫在哪個既有節點身上」,語意上等同 attractionTools.ts
  // AttractionStepsCtx.addNote 的 anchorId 參數。
  //
  // 2026-09:找不到對應節點時的行為改成跟 onagent 路徑(add_attraction
  // 的 anchorId)完全一致——直接讓 insertAttractionAfter 回傳
  // anchor_not_found 錯誤,由呼叫端(見 usePlanSimSocket 的 ws.onmessage)
  // 拋出例外。使用者明確要求「模擬的部分也完全走這個路徑,不要有
  // 例外」:原本這裡有一套「找不到就退回 append 到最後一筆」的寬容
  // 降級邏輯,是模擬腳本(plan_sim_ws.go)專屬的特例,現在拿掉——不管
  // 資料來源是模擬腳本還是 LLM 呼叫工具,「插入位置的錨點找不到」一律
  // 是需要被看見的錯誤,不是靜默吃掉繼續執行的正常情況(模擬腳本本身
  // 若送出無效的 afterId,那是腳本自己的 bug,應該讓它在這裡明確
  // 中斷、被發現,而不是悄悄插到錯的位置)。
  afterId?: string
  // candidates——2026-10 新增(使用者明確要求「播放畫面第一個先模擬送出
  // 一個 ask」),只有 type === 'open_ask_page' 時有意義:對齊真實
  // open_ask_page 工具的 candidates 參數(見 plan-core/askPageTools.ts
  // AskPageCandidate 的完整說明),劇本(planSimScript.ts)用這個欄位
  // 表達「這一步要顯示哪些候選景點卡片」。placeId 一律用
  // attractionPool.ts 的 id(跟劇本其餘 add_stop 的 placeId 慣例一致,
  // 見 planSimScript.ts 檔頭的完整說明),查詢完整資料時透過
  // dataSource.placeDetails 精確查找,不是真的打 Google API。
  candidates?: AskPageCandidate[]
  // picks——2026-10(使用者明確要求「ask page 內的感興趣的景點詢問,
  // 可以用挖洞的方式,再撥放態置換成可以由腳本控制的原件」),只有
  // type === 'open_ask_page' 時有意義:這一步要顯示成「已選取」的候選
  // placeId。
  //
  // 播放態是自動演示、不接受真實互動(見 docs/terminology.md),所以
  // 「使用者選了什麼」這件事也該由劇本表達,而不是等真人點——劇本原本
  // 已經能說「顯示哪些候選」(candidates),現在也能說「其中哪幾個被
  // 選中」。畫面上就是那幾張卡片帶勾,停留一下後自動收起、繼續播。
  //
  // 省略時視為一張都沒選(對應真人開了選單還沒點的那一刻)。值必須是
  // candidates 裡的 placeId,劇本自己負責對齊——這裡不做驗證,對齊
  // afterId 的既有處理方式(劇本送出無效的值是劇本自己的 bug,應該
  // 在畫面上看得出來,不是靜默吃掉)。
  picks?: string[]
}

// STEP_ADD_TYPES——需要走 planActionToInsert(插入新節點)的訊息型別。
// 2026-09 重構:'add_note' 移出這個集合——note 不再是插入到時間軸裡的
// 獨立節點,改成掛在既有節點自己身上的欄位(見 planTimeline.ts NoteInfo
// 的完整說明),ws.onmessage 改成另外特判這個型別、直接呼叫
// setNoteForStop(見該處的完整說明),不再經過 planActionToInsert 這個
// 「組出插入用三元組」的轉換路徑——沒有新節點被插入,自然不需要它。
//
// 'add_message'——2026-09 加入這個集合,跟 add_note 的方向相反:LLM/
// 使用者的對話訊息(見 planTimeline.ts PlanNodeType 的 'message' 完整
// 說明)是真正插入時間軸的獨立節點,不是掛在某個既有節點身上的欄位,故
// 走跟 add_section/add_stop 完全一樣的插入路徑,不需要像 add_note 那樣
// 另外特判。
const STEP_ADD_TYPES: ReadonlySet<PlanAction['type']> = new Set(['add_section', 'add_stop', 'add_message'])

// ASK_PAGE_CONFIRM_DELAY_MS——最後一張候選被「點」完之後,再停多久才演出
// 按下「確認選擇」(見 ScriptedAskPage.tsx confirmAfterMs 的完整說明)。
//
// 2026-10(使用者明確要求「點完後大幅減少停頓」):原本這個常數叫
// ASK_PAGE_AUTO_PICK_MS、值 2800ms,語意是「選單在畫面上停留多久」
// ——那是還沒有點擊演出時的設計,當時整段詢問就只有「開著讓人看」
// 這件事,需要一段長停留才讀得完。
//
// 加上點擊演出之後,「讓人看清候選」這件事已經由那 2 次點擊
// (2 × PICK_INTERVAL_MS = 1040ms,期間還有勾選與特效逐張出現)承擔了,
// 這個常數剩下的意義只是「點完到按確認之間的一拍」。維持 2800ms 會變成
// 點完之後畫面完全不動將近 3 秒,看起來像播放卡住。
//
// 600ms 的取法:比單次點擊的間隔(520ms)略長一點,讓「點完了」跟「按下
// 確認」讀得出是兩個獨立動作,而不是連在一起的一下;又遠短於單則劇本
// 動作的 randomDelayMs(900~1500ms),因為這一拍只是同一步內的收尾。
const ASK_PAGE_CONFIRM_DELAY_MS = 600

// planActionToInsert — 把一則新增類 PlanAction 轉成 insertAttractionAfter
// 需要的 (anchorId, newId, data) 三元組,不實際執行插入——純函式,呼叫端
// (usePlanSimSocket 的 ws.onmessage)拿到這三元組後統一呼叫
// insertAttractionAfter 完成插入與驗證,理由見 PlanAction.afterId 的
// 完整說明:模擬腳本與 onagent 對話兩條路徑現在共用同一個插入介面,
// 不再各自實作一份。
//
// 'add_transit' 型別上仍保留在 PlanAction.type 聯集裡(對齊後端
// plan_sim_ws.go 的 JSON 協定,理論上仍可能出現這個字串值),但不在
// STEP_ADD_TYPES 內——2026-09 起交通卡不再是獨立的節點型別(見
// planTimeline.ts TransitInfo 的完整說明,改掛在 stop 節點自己的
// transitFromPrev 欄位上),沒有對應的節點型別可以承接這則訊息,收到就
// 直接忽略(這裡的 !STEP_ADD_TYPES.has 判斷讓它自然落入 return null,
// 不需要另外寫一個分支特判)。planSimScript 本身已經不會送出這個訊息
// (見該變數的完整說明),這裡只是防禦性地不讓舊協定字串意外造成執行期
// 錯誤。
//
// anchorId 的決定:afterId 有值時直接採用(找不到對應節點是否算錯誤,
// 交給 insertAttractionAfter/insertAfter 判斷,這裡不做寬容降級,見
// PlanAction.afterId 的完整說明);未帶 afterId 時退回「目前時間軸最後
// 一個節點」,對齊模擬腳本固定劇本「新內容接在已生成內容之後」的預設
// 語意——這不是寬容降級,是這個欄位本來的預設行為(action.afterId 是
// 選填欄位,省略時的既有預設值本來就是「接在最後面」)。
function planActionToInsert(
  timeline: PlanTimeline,
  action: PlanAction,
): { anchorId: string | null; newId: string; data: PlanNodeData } | null {
  if (!STEP_ADD_TYPES.has(action.type)) return null
  const id = action.id ?? `${action.type}-${timeline.nodes.size}`
  // nodeType——'add_message' 對應 planTimeline.ts 的 'message' 節點型別
  // (見該型別的完整說明),不是 stop 也不是 section。
  const nodeType = action.type === 'add_section' ? 'section' : action.type === 'add_message' ? 'message' : 'stop'
  const data: PlanNodeData = {
    type: nodeType,
    label: action.label,
    // text——message 節點自己的訊息內容(見 PlanNodeData.text 的完整
    // 說明),沿用跟 add_note 相同的 action.text 欄位,不另外發明新欄位
    // 名稱。
    text: action.text,
    time: action.time,
    day: action.day,
    duration: action.duration,
    kind: action.kind,
    name: action.name,
    desc: action.desc,
    thumbBg: action.thumbBg,
    thumbIcon: action.thumbIcon,
    tags: action.tags,
    placeId: action.placeId,
    // loading:add_stop 訊息帶 placeId 時,這筆先以「查詢中」狀態
    // 掛進時間軸(縮圖/敘事文字用訊息本身的假資料佔位,見下方渲染邏輯),
    // insertAttractionAfter 內部另外用這個 placeId 查完真實資料後
    // (見 resolveAttractionForStep 的完整說明),再更新這筆節點把
    // loading 轉 false、photoUrl/desc 換成真實內容——這裡不是同步查完
    // 才 append,是「先掛佔位卡、查到再補上」,才能忠實呈現「AI 呼叫
    // 工具查詢中」這個過程本身,而不是讓使用者只看到查完的結果、跳過
    // 中間狀態。
    loading: action.type === 'add_stop' && !!action.placeId,
    lat: action.lat,
    lng: action.lng,
    children: action.children,
    candidateCards: action.candidateCards,
  }
  const renderedForAppend = toRenderList(timeline)
  const lastId = renderedForAppend.length > 0 ? renderedForAppend[renderedForAppend.length - 1].id : null
  const anchorId = action.afterId ?? lastId
  return { anchorId, newId: id, data }
}

// REMOVE_FADE_MS — 淡出動畫時長,前端(.module.css 的 removingFade)與
// 這裡的延遲時間必須一致:CSS 決定「看起來」的過渡時間,這個常數決定
// 「動畫播完後多久真的把節點從時間軸移除」,兩者對不上會出現「畫面還沒
// 淡完節點就消失」或「淡完了節點還占著版面空間」的落差。
const REMOVE_FADE_MS = 320

// CTA_AFTER_STOPS——模擬排到第幾站時,把輸入膠囊的送出鈕換成「立即
// 使用」行動呼籲按鈕(見下方 composerCollapsed 的完整說明)。
const CTA_AFTER_STOPS = 5

// resolveAttractionForStep — add_attraction 帶 placeId 時,單段查詢取得
// 真實地點資料:呼叫 GET /internal/geo/plan-ai/place-details-any(fetchPlaceDetails,
// 見 handlePublicGeoPlaceDetailsAny 的完整說明)取得 name/summary/
// photoUrl/lat/lng。
//
// 2026-09 這是「回到 placeId」重構的一部分(見 attractionTools.ts 檔頭
// 「第四/五/六次重構」的完整說明)——原本(短暫存在過)的兩段式查詢
// (先查資料庫 attraction、若帶 place_id 再疊加查 Google 補強)已經不
// 需要:place-details-any 端點內部本來就會優先查一次資料庫 attraction
// (查得到就優先用資料庫資料,查不到才 fallback 查 Google),這支函式
// 因此簡化成單一次查詢,不再需要 fetchAttraction 參數或任何「疊加」
// 邏輯。
//
// isCancelled:呼叫端傳入,查詢完成時若已經是「這次已不算數」的狀態
// 就不寫回 state,理由同 resolvePlaceForStep 的同名參數。
//
// onSettled:2026-09 真實踩坑記錄——add_attraction(onagent 對話路徑)
// 插入的佔位卡一開始不帶 lat/lng(座標要等這支函式查完才有,對比模擬
// WS 腳本路徑 planActionToInsert 的固定資料本身就帶座標),若
// maybeInsertTransitBefore(現已改名 refreshTransitForStop,見該函式的
// 完整說明)的觸發判斷留在 insertAttractionAfter 插入當下同步檢查
// data.lat/data.lng,onagent 路徑插入的節點必然沒有座標、判斷恆為
// false,導致交通卡從未被觸發過——這裡改成在這次查詢完成(不論成功或
// 失敗)之後才呼叫這個 callback,讓呼叫端(insertAttractionAfter)在
// 這個時間點才觸發交通查詢。單段查詢下「查詢完成」就等同「座標定案」,
// 不再需要區分「所有查詢動作都做完」這種多段情境。
function resolveAttractionForStep(
  stepId: string,
  placeId: string,
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; googlePhotoUrls?: string[]; lat?: number; lng?: number; attractionId?: string }>,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  isCancelled: () => boolean,
  onSettled: (lat: number, lng: number) => void,
) {
  fetchPlaceDetails(placeId)
    .then((details) => {
      if (isCancelled()) return
      if (details.found === false || details.lat == null || details.lng == null) {
        // 查無此地(理論上不該發生,placeId 應該總是有效——來自
        // search_attraction 查到的候選或使用者剛查過的地名)——退回
        // 訊息本身帶的假資料,不留在「查詢中」的狀態卡住,理由同
        // resolvePlaceForStep 的同類分支。這裡沒有可用的座標,不呼叫
        // onSettled——沒有座標就無從估算交通時間,理由同
        // refreshTransitForStop 本身「沒有座標就清空」的既有判斷。
        setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
        // failed 明確清掉——這次(可能是重試)成功了,節點不該還留著
        // 上一次的失敗標記。
        failed: false,
        name: details.name,
        desc: details.summary,
        googlePhotoUrls: details.googlePhotoUrls,
        lat: details.lat,
        lng: details.lng,
        placeId,
      }))
      onSettled(details.lat, details.lng)
    })
    .catch(() => {
      if (isCancelled()) return
      setTimeline((prev) => updateNode(prev, stepId, { loading: false, failed: true }))
    })
}

// refreshTransitForStop — 重新計算 stopId 這個 stop 節點的
// transitFromPrev(見 planTimeline.ts TransitInfo 的完整說明)。
//
// 2026-09 取代原本的 maybeInsertTransitBefore:原本交通卡是獨立插入
// 鏈結的 'transit' 節點,靠鏈結位置隱含表達「這張卡屬於哪兩站」,移除
// 中間站時會讓兩張舊交通卡黏在一起、都指向已經消失的站(見
// planTimeline.ts TransitInfo 開頭引用的完整踩坑記錄)。改成資料直接掛
// 在「到達站」(stopId 這一站)身上後,「這張交通卡屬於哪兩站」變成
// stopId 本身與它目前的 prevId,關係顯式且唯一,不再需要另一個節點
// 型別。
//
// 呼叫時機——任何造成 stopId 這一站「前一站」改變的操作之後都要呼叫:
//   1. 插入新 stop 節點成功、座標定案時(原 maybeInsertTransitBefore 的
//      觸發點)——呼叫 refreshTransitForStop(newId, ...)。
//   2. 移除一個 stop 節點後,若它的 nextId 也是 stop——那一站的前一站
//      變了(removeNode 已經同步清空它的 transitFromPrev,見該函式的
//      完整說明),呼叫 refreshTransitForStop(nextId, ...) 重新查一次
//      新的兩站之間的交通。
//   3. 前一站座標更新時(resolveAttractionForStep 第二段 place 查詢
//      覆蓋座標)——若這一站的 nextId 是 stop,它的 transitFromPrev 是
//      基於舊座標算的,同樣需要重新查(使用者明確要求「當前一個站點有
//      異動時,要觸發重新推估」)。
//
// 用 getTimeline()(而非讀取某個 React state)取得呼叫當下的最新鏈結,
// 理由同原 maybeInsertTransitBefore 對 timelineRef.current 的既有說明:
// 呼叫這個函式的時間點通常是 commitTimeline 已經完成之後,需要讀到最新
// 結果,不能仰賴可能還沒 flush 的 React state。
//
// 前一站不是 stop(例如是 section/note,或沒有前一站)或沒有座標(反查
// 地點資料尚未完成的 loading 中節點),直接把 transitFromPrev 清成
// undefined,不查詢——沒有兩個明確座標就無從估算,不勉強留著一張資料
// 不全的卡片或殘留舊資料。
function refreshTransitForStop(
  stopId: string,
  setTimeline: React.Dispatch<React.SetStateAction<PlanTimeline>>,
  getTimeline: () => PlanTimeline,
  // dataSource——讀取層(見 planAiDataSource.ts 的完整說明)。2026-10
  // 從寫死的 planAiFakeDataSource import 改成參數注入,讓這條路徑跟
  // 推論層一樣可以整個抽換:公開展示頁注入假資料實作,登入後的自動
  // 播放注入真後端實作。
  dataSource: PlanAiDataSource,
) {
  const timeline = getTimeline()
  const stopNode = timeline.nodes.get(stopId)
  if (!stopNode || stopNode.type !== 'stop' || stopNode.lat == null || stopNode.lng == null) return
  const prevNode = stopNode.prevId != null ? timeline.nodes.get(stopNode.prevId) : null
  // (prevNode.day ?? 1) !== (stopNode.day ?? 1)——使用者明確要求「排程
  // 元件加入日的概念」後,跨天(day 不同)的前後兩站不該顯示交通卡:
  // 中間隔了一夜,不是使用者會實際移動的路線,「走路 X 分鐘」這種數字
  // 沒有意義。跟「前一站不是 stop/沒有座標」同樣視為沒有可比較的前一
  // 站,直接清空 transitFromPrev、不查詢。省略 day 視為第 1 天,理由同
  // planTimeline.ts PlanNodeData.day 的完整說明。
  if (
    !prevNode ||
    prevNode.type !== 'stop' ||
    prevNode.lat == null ||
    prevNode.lng == null ||
    (prevNode.day ?? 1) !== (stopNode.day ?? 1)
  ) {
    setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: undefined }))
    return
  }

  // 2026-09:先掛 loading:true 的佔位狀態再背景查詢,是使用者明確要求
  // 「路程推估前端載入中要做一點動畫」的直接落地——後端加了
  // 800~1500ms 的故意延遲(見 plan_sim_ws.go transitEstimateMinDelay/
  // transitEstimateMaxDelay 的完整說明)讓查詢感更真實,若不先掛佔位,
  // 使用者會看著站點卡片插入後有一段空白等待期,不知道系統正在做什麼
  // ——這跟 stop 節點本身「先掛查詢中佔位卡、查完再補上真實資料」(見
  // resolveAttractionForStep 的完整說明)是同一種使用者體感設計。
  const prevId = prevNode.id
  setTimeline((prev) => updateNode(prev, stopId, { transitFromPrev: { loading: true } }))

  const from = { lat: prevNode.lat, lng: prevNode.lng }
  const to = { lat: stopNode.lat, lng: stopNode.lng }
  dataSource.transitEstimate(from, to)
    .then((estimate) => {
      setTimeline((prev) => {
        // 這一站可能已經被使用者操作移除,或它的前一站在查詢期間又
        // 再次變動(見上方呼叫時機第 2/3 點——若查詢期間又觸發了一次
        // 新的 refreshTransitForStop,這次的結果已經過時),此時直接
        // 放棄更新,理由同其餘背景查詢完成後的既有「重新確認節點仍
        // 存在」慣例(見 resolveAttractionForStep 的完整說明)。
        const current = prev.nodes.get(stopId)
        if (!current || current.prevId !== prevId) return prev
        return updateNode(prev, stopId, {
          transitFromPrev: {
            loading: false,
            icon: estimate.icon,
            mode: estimate.mode,
            minutes: estimate.minutes,
            distance: estimate.distance,
          },
        })
      })
    })
    .catch(() => {
      // 查詢失敗(網路問題)——清空 transitFromPrev,不留一張永遠轉圈的
      // 交通卡卡住畫面。理由同其餘背景查詢失敗時的既有降級慣例:交通卡
      // 是加值資訊,查不到就維持沒有這張卡的狀態,不阻塞或干擾主要的
      // 行程安排流程。同樣先確認這一站與前一站的關係沒有在查詢期間變動
      // 過,理由同上方 .then 分支。
      setTimeline((prev) => {
        const current = prev.nodes.get(stopId)
        if (!current || current.prevId !== prevId) return prev
        return updateNode(prev, stopId, { transitFromPrev: undefined })
      })
    })
}

// usePlanSimSocket — 連上模擬 AI 推論輸出的 WebSocket(見上方檔案開頭
// 的完整說明),把收到的每則 PlanAction 轉成插入操作、交給
// insertAttractionAfter 統一處理(見該函式的完整說明);add_stop 訊息帶
// placeId 時,insertAttractionAfter 內部會額外觸發
// fetchPlanAiPlaceDetailsAny 非同步查詢,查完後補上真實資料。回傳
// { steps, isGenerating },掛載時自動建立一次 PlanSimSource(見該檔案
// 開頭的完整說明)從頭播到 done——使用者明確要求這個頁面「預設進入會
// 全部播放,用來展示功能用的」,不是原始版本那種可開關/重播/單步推進/
// 測試按鈕觸發額外訊息的互動模擬器,故不再需要 simEnabled 參數、
// restart/stop/sendTrigger 這幾個控制函式,以及呼叫端對應的「開啟模擬」
// 「重播」「下一步」「測試按鈕」UI(見 AIPlanTimelinePage 主體對這批
// 按鈕的移除說明)。
//
// start——是否已經可以開始播放,由呼叫端(AIPlanTimelinePage 主體)傳入。
// 使用者明確要求「輸入文字送出後,才觸發開始安排」:假打字動畫(見
// typedPrompt 的完整說明)先模擬使用者輸入完成、「送出」這個動作,
// 播放劇本要等這個動作發生後才開始,不是一進頁面兩件事同時跑,不然會
// 看起來像是行程在使用者話都還沒打完就自己生成了。false 時 effect
// 提早 return,不建立 PlanSimSource,steps 維持空陣列。
// export——供 AiPlanPhoneDemoScreen.tsx(2026-10 新增,見該檔案檔頭的
// 完整說明:功能介紹頁的手機展示框改成直接嵌入一個寫死手機版面的獨立
// 元件,不再透過 iframe 嵌入這個頁面本身)共用同一套劇本模擬邏輯,不
// 需要複製貼上一份——這個 hook 內部只呼叫同檔案的私有輔助函式
// (planActionToInsert/resolveAttractionForStep/refreshTransitForStop
// 等),這些函式不需要跟著一起 export,JS 模組內部呼叫不受影響。
// createSource——選填的來源工廠,讓呼叫端注入不同的播放節奏。
// 省略時用 createPlanSimFakeSource(計時器自動播完,/ai-plan 展示頁的
// 既有行為);首頁的捲動展示傳 createPlanSimScrollSource,改由捲動位置
// 推進(見 planSimScrollSource.ts 的完整說明)。
//
// 回傳值裡額外帶出 source——捲動版需要拿到它才能呼叫 advanceTo(),
// 計時器版的呼叫端忽略即可。
export function usePlanSimSocket(
  start: boolean,
  createSource: () => PlanSimSource = createPlanSimFakeSource,
  // dataSource——讀取層,預設假資料(見 planAiDataSource.ts 的完整
  // 說明)。公開展示頁(/ai-plan、首頁小展示)不需要登入就能看,打
  // /internal/ 端點只會拿到 401,所以預設值必須是假資料;要接真後端
  // 的呼叫端自己注入 createPlanAiApiDataSource(cfg)。
  dataSource: PlanAiDataSource = planAiFakeDataSource,
) {
  // timeline 改用 useSyncedState(見該 hook 開頭的完整背景說明)取代單純
  // 的 useState——insertAttractionAfter(下方)呼叫來源是 AgentBridge 的
  // 原生 WebSocket onmessage,完全在 React 事件系統之外,需要「commit
  // 呼叫當下就同步拿到結果」這個保證,而不是仰賴 useState 的 updater
  // 會同步執行(這個假設在這個呼叫場景下不成立,見該 hook 開頭引用的
  // 真實踩坑記錄)。setTimeline 仍保留給不需要同步讀結果的異動(remove_step
  // 標記 removing、resolvePlaceForStep 背景補資料),用回原生 setState
  // 語意即可,不需要 commit 那一層。
  const [timelineRef, timeline, commitTimeline] = useSyncedState<PlanTimeline>(createEmptyTimeline)
  const setTimeline = useCallback((updater: PlanTimeline | ((prev: PlanTimeline) => PlanTimeline)) => {
    commitTimeline((current) => ({
      next: typeof updater === 'function' ? (updater as (prev: PlanTimeline) => PlanTimeline)(current) : updater,
      result: undefined,
    }))
  }, [commitTimeline])

  // dragStopTime——時間軸小圓點拖拉調整時間(使用者明確要求「時間軸的
  // 小圓點可以拖拉,上下拉動時調整時間,半小時為刻度」,原本只在正式頁
  // trip-plan/TripPlanPage.tsx 實作,這份展示原型檔案刻意沒有跟進——
  // 使用者後續明確要求「解除之前不改的限制」,把這個互動能力補到展示頁
  // 也能體驗)。寫法對齊 TripPlanPage.tsx 同名函式的設計,差異只在這份
  // 檔案沒有 cfg/後端呼叫,refreshTransitForStop 的簽名少一個參數(見
  // 該函式在這個檔案的完整說明)。
  const dragStopTime = useCallback((stopId: string, newTime: string): boolean => {
    const node = timelineRef.current.nodes.get(stopId)
    if (!node || node.type !== 'stop') return false
    setTimeline((prev) => updateNode(prev, stopId, { time: newTime }))
    refreshTransitForStop(stopId, setTimeline, () => timelineRef.current, dataSource)
    return true
  }, [setTimeline, timelineRef, dataSource])
  // retryStopLookup——地點查詢失敗的站點重新查詢。
  //
  // 2026-10（review 發現）：這個檔案的 resolveAttractionForStep 失敗分支
  // 跟 TripPlanPage 一樣標記 failed(兩邊逐行一致),但這裡原本**沒有任何
  // 消化路徑**——沒有重試入口、也沒有掛載重試,節點就永久停在錯誤狀態。
  // 那讓 failed 標記變成淨負面:改動前至少還會顯示劇本自帶的假資料名稱
  // (見 resolveAttractionForStep 失敗分支的既有註解「退回訊息本身帶的
  // 假資料」),標了 failed 卻無從恢復反而更糟。
  //
  // 寫法對齊 TripPlanPage 的同名函式:先把節點設回 loading 讓使用者看得出
  // 按鈕有反應,查詢結果由 resolveAttractionForStep 自己寫回。
  const retryStopLookup = useCallback((stopId: string) => {
    const node = timelineRef.current.nodes.get(stopId)
    if (!node || node.type !== 'stop' || !node.placeId) return
    setTimeline((prev) => updateNode(prev, stopId, { loading: true, failed: false }))
    resolveAttractionForStep(
      stopId,
      node.placeId,
      (placeId) => dataSource.placeDetails(placeId),
      setTimeline,
      () => !timelineRef.current.nodes.has(stopId),
      () => refreshTransitForStop(stopId, setTimeline, () => timelineRef.current, dataSource),
    )
  }, [setTimeline, timelineRef, dataSource])

  // isGenerating 初始值為 false——要等 start 變 true(打字動畫播完、
  // 視同「使用者送出」)才開始安排,見上方 usePlanSimSocket 的完整說明。
  const [isGenerating, setIsGenerating] = useState(false)
  // source——目前這次播放的來源實例,對外暴露讓捲動版呼叫 advanceTo()。
  const [source, setSource] = useState<PlanSimSource | null>(null)
  // latestInsertedStopIdRef——2026-10 新增(使用者明確回報「骨架卡轉成
  // 地點時就要拉到中間,目前是要等下一個骨架時才拉往中間」):這個
  // hook 本身不持有 selectedStopId(那是下游 useSimulatedStopsView 的
  // state,見該函式的完整說明),插入新地點站後無法直接呼叫對應的
  // setSelectedStopId。改用 ref 記下「最新插入的地點站 id 是誰」,讓
  // useSimulatedStopsView 在 steps 更新時讀取並同步選取,不需要把
  // selectedStopId 這個 state 整個搬到這個 hook 來。用 ref 而非回傳值
  // 直接驅動 state,是因為這個賦值跟 setTimeline 不在同一個 React
  // 批次更新時機保證內(insertAttractionAfter 呼叫來源可能是原生
  // WebSocket onmessage,見上方 useSyncedState 的完整說明),ref 讀寫
  // 本身沒有這個時機疑慮。
  const latestInsertedStopIdRef = useRef<string | null>(null)

  // insertAttractionAfter — 這是使用者明確要求的「機制跟介面由行程
  // 安排元件提供」的落地:不管是 add_attraction 工具(attractionTools.ts)
  // 還是下方模擬 WS 腳本路徑(ws.onmessage),都不自己組節點、自己呼叫
  // insertAfter,而是統一呼叫這裡暴露的介面,把 anchorId/節點資料交給
  // planTimeline.ts 的 insertAfter 統一驗證與插入(時間是否落在合理
  // 範圍、錨點是否存在,見該函式的完整說明)。這是使用者要求「模擬的
  // 部分也完全走這個路徑,不要有例外」的直接體現——兩條路徑不再各自
  // 維護一份插入邏輯,驗證失敗時的行為也完全一致(見下方呼叫端如何
  // 處理 result.ok === false)。
  //
  // 用 commitTimeline(useSyncedState 提供,見該 hook 的完整背景說明)
  // 取代手寫的「讀 ref → 算 → 寫 ref → setState」四步——這個 hook 就是
  // 把這四步收斂成的固定寫法,存在的理由正是這裡先前踩過的真實 bug
  // (add_attraction 曾經每次呼叫都以「Cannot read properties of
  // undefined (reading 'ok')」失敗,根因是誤以為 setState(updater) 的
  // updater 會同步執行)。compute 函式直接讀 current(保證是目前為止
  // 所有已提交更新疊加後的最新 timeline)同步算出 insertAfter 的結果,
  // 驗證失敗時不給 next(對應 useSyncedState 的「compute 不給 next 就不
  // 寫入」語意),commitTimeline 保證回傳值就是這次呼叫當下算出的
  // InsertAfterResult,不會是 undefined。
  //
  // id 由呼叫端決定並傳進來,這裡不重新生成——這個介面只負責「插入到
  // 哪裡、驗不驗證得過」,不負責「這個節點該叫什麼 id」這種跟呼叫端
  // 資料來源相關的細節(onagent 路徑用 agent-${attractionId}-
  // ${Date.now()},模擬 WS 路徑沿用後端腳本給的 action.id)。
  //
  // 插入成功後,若這筆帶 placeId 且是 loading 佔位狀態(見
  // attractionTools.ts addAttraction 的完整背景說明——LLM 只傳
  // placeId,不等任何後端查詢完成就回覆成功),在這裡背景觸發
  // fetchPlanAiPlaceDetailsAny 補上完整資料,理由與寫法對稱既有的
  // resolvePlaceForStep(模擬 WS 路徑原本自己觸發的同類邏輯,現在收斂
  // 到這裡統一處理,兩條路徑不用各自記得要觸發)——差別只在這裡查的是
  // 不受白名單限制的 place-details-any,且查詢完成後用 setTimeline
  // (而非 commitTimeline)寫回,因為這個背景更新不需要任何呼叫端同步
  // 拿到結果。
  //
  // 故意不 await 這個背景查詢、也不讓它影響 insertAttractionAfter 的
  // 回傳值——插入本身只做本地鏈結運算,立即返回,不因為等待或觸發
  // Google API 查詢而受限流影響,查詢延遲對使用者體感是卡片從佔位轉成
  // 完整內容,不是整個呼叫失敗。
  const insertAttractionAfter = useCallback(
    (anchorId: string | null, newId: string, data: PlanNodeData): ReturnType<typeof insertAfter> => {
      const result = commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        const inserted = insertAfter(current, anchorId, data, newId)
        if (!inserted.ok) return { result: inserted }
        // 新增一個景點(stop)就代表話題已經推進——把時間軸上其他還
        // 「新鮮」的對話訊息節點(message,見 planTimeline.ts PlanNodeType
        // 的完整說明)一併淡化(見 staleOtherAgentMessages 的完整說明,
        // 使用者明確要求「新景點加入後要淡化」)。只在新插入的是 stop
        // 時才觸發——插入 message 節點本身不代表話題推進,不該讓其他
        // message(包括它自己)跟著被標記成 stale。
        if (data.type !== 'stop') return { next: inserted.timeline, result: inserted }
        return { next: staleOtherAgentMessages(inserted.timeline, newId), result: inserted }
      })
      if (result.ok && data.placeId && data.loading) {
        resolveAttractionForStep(
          newId,
          data.placeId,
          (placeId) => dataSource.placeDetails(placeId),
          setTimeline,
          () => false,
          // onSettled——onagent 路徑插入的佔位卡一開始沒有座標(座標要
          // 等這支函式查完才有),交通查詢要等查詢完成、座標確定之後
          // 才觸發。refreshTransitForStop 自己會從 timeline 重新讀取
          // 這個節點目前的座標,不需要 onSettled 傳入的 lat/lng(這裡
          // 忽略,只借用它「查詢已完成」這個時機訊號)。
          () => refreshTransitForStop(newId, setTimeline, () => timelineRef.current, dataSource),
        )
      } else if (result.ok && data.type === 'stop' && data.lat != null && data.lng != null) {
        // 模擬 WS 腳本路徑(planActionToInsert)的固定資料本身就帶座標,
        // 插入當下即可同步觸發,不需要等任何背景查詢——理由同上方
        // onGotCoordinates 的完整說明,兩條路徑只是「座標何時可用」不同,
        // 觸發交通查詢這件事本身沒有差異。
        refreshTransitForStop(newId, setTimeline, () => timelineRef.current, dataSource)
      }
      return result
    },
    [commitTimeline, setTimeline],
  )

  // setNoteForStop — 把一則備註寫在某個既有節點自己身上(見 planTimeline.ts
  // NoteInfo 的完整說明),不是插入新節點——使用者明確要求「備註寫在
  // 景點的節點上」。用 commitTimeline(而非 setTimeline)取得跟
  // insertAttractionAfter 一致的「呼叫當下同步拿到結果」保證,理由同該
  // 函式的完整說明(呼叫來源同樣可能來自 AgentBridge 原生事件,完全在
  // React 事件系統之外)。
  //
  // 參數命名 anchorId(而非原本的 stopId)——使用者明確要求「agent tool
  // 發出的參數名稱保持一致,像是要附加在節點上的就要用 anchorId,不要
  // 創造多餘的命名」:這裡跟 insertAttractionAfter 的 anchorId 是同一種
  // 東西,都是「時間軸上某個既有節點的 id」,只是這裡是必填(不是
  // string | null——沒有「插在最前面」這種語意,備註一定要有明確的
  // 掛載對象),不因為語意細節不同就另外發明命名。
  //
  // 回傳型別對齊 insertAttractionAfter(ReturnType<typeof insertAfter>)
  // ——沒有新節點被建立,insertedId 這裡填入被寫入備註的 anchorId 本身,
  // 讓呼叫端(attractionTools.ts 的 add_note 工具)能用同一種「id 代表
  // 這次操作影響了哪個節點」的語意回報給 LLM,不需要為了這個操作另外
  // 發明一種結果形狀。anchorId 不是時間軸上既有節點時,回傳
  // anchor_not_found(語意上就是「找不到指定的節點」,沿用既有的
  // InsertAfterErrorCode,不需要為這裡另外新增一個錯誤代碼)。
  const setNoteForStop = useCallback(
    (anchorId: string, text: string, category: string | undefined): ReturnType<typeof insertAfter> => {
      return commitTimeline<ReturnType<typeof insertAfter>>((current) => {
        if (!current.nodes.has(anchorId)) {
          return {
            result: {
              ok: false,
              error: { code: 'anchor_not_found', message: `找不到 id 為 "${anchorId}" 的節點,無法在它身上寫入備註。` },
            },
          }
        }
        const next = updateNode(current, anchorId, { note: { text, category } })
        return { next, result: { ok: true, timeline: next, insertedId: anchorId } }
      })
    },
    [commitTimeline],
  )

  useEffect(() => {
    // start 轉 false 時清空並停止——原本是直接 return(不清),因為
    // /ai-plan 的 start 只會 false→true 一次、不會再回去。捲動驅動的
    // 展示(首頁 ScrollPlanDemo)則會在使用者捲出視窗時把 start 設回
    // false,期待行程整個清掉、捲回來重新演一次(使用者明確要求「上滾的
    // 時候不用停留,做清除安排的動作」),所以這裡要真的重置。
    if (!start) {
      setTimeline(createEmptyTimeline())
      setIsGenerating(false)
      setSource(null)
      return
    }
    setTimeline(createEmptyTimeline())
    // isGenerating 不在這裡設 true——改由第一則 thinking 訊息驅動
    // (見下方 onMessage 的 thinking 分支)。
    //
    // 計時器版(createPlanSimFakeSource)建立後立刻開始播,兩種寫法的
    // 結果幾乎相同;但捲動版(createPlanSimScrollSource)要等使用者捲動
    // 才送出第一則,若在這裡就設 true,使用者還沒捲到時畫面會顯示
    // 「正在安排行程…」卻什麼都沒發生。改成由實際的 thinking 訊息驅動,
    // 兩種節奏都正確。
    // source——PlanSimSource(見該檔案開頭的完整說明)取代原本的
    // WebSocket 連線,建立後立即自動從頭播放固定劇本到 done,由 start
    // (見上方 usePlanSimSocket 的完整說明)決定何時建立。cancelled
    // 旗標理由同原本 WS 版本——避免 effect cleanup 之後,已經在飛行中的
    // setTimeout 回呼繼續寫入 state。
    const source = createSource()
    setSource(source)
    let cancelled = false

    const unsubscribeMessage = source.onMessage((action) => {
      if (cancelled) return
      if (action.type === 'done') {
        setIsGenerating(false)
        return
      }
      // thinking:不異動 steps(這裡提早 return 純粹是省一次沒有意義的
      // setSteps 呼叫,
      // 語意上也更清楚——這則訊息唯一的作用是讓 isGenerating 維持
      // true、思考動畫(呼吸點+骨架卡)持續顯示,不需要對時間軸資料做
      // 任何事)。
      // 2026-10:改成真的在這裡設 isGenerating(原本只是 return,
      // 由上方建立 source 時一次設 true)——捲動驅動的來源
      // (createPlanSimScrollSource)要等使用者捲動才送出第一則,
      // 在建立當下就設 true 會讓畫面顯示「正在安排」卻什麼都沒發生。
      // 改由實際的 thinking 訊息驅動,計時器版與捲動版都正確。
      //
      // 2026-10(第二輪,使用者明確要求「先分離推論中跟安排中的
      // 信號」):原本只要收到任何 thinking 就顯示骨架卡(isGenerating
      // = true),但劇本裡 thinking 前導的下一步不一定是 add_stop
      // (也可能是 add_message 這種純旁白訊息、或 add_note)——這種
      // 情況下骨架卡顯示了,下一步送達後卻完全沒有對應的地點卡片可以
      // 轉場(add_message/add_note 不會被 HorizontalPlanTimeline
      // 渲染成卡片,見該元件 stops 過濾邏輯的完整說明),使用者看到的
      // 是「骨架消失但畫面沒變化」,誤以為插入失敗。改成只在
      // action.nextType === 'add_stop'(見 PlanAction.nextType 的完整
      // 說明)時才設 isGenerating(true)——「安排中」(骨架卡)現在只
      // 對應「真的要安排一個新地點」,跟「推論中」(任何 thinking,
      // AI 正在運作但不一定產生可見的地點卡片)分開。
      if (action.type === 'thinking') {
        if (action.nextType === 'add_stop' && action.nextId) {
          setIsGenerating(true)
          // 2026-10 使用者明確要求「安排中時就加入一張卡片,只是這張
          // 卡片沒有資料時就呈現骨架卡」:插入一筆空白的 loading stop
          // 節點,id 用 action.nextId(即將到達的 add_stop 訊息會用的
          // 同一個 id,見 PlanAction.nextId 的完整說明)——之後真正的
          // add_stop 訊息到達時(見下方),改用 updateNode 原地把這筆
          // 節點補上完整資料,而不是插入另一筆新節點。沒有 name/time/
          // placeId/lat/lng,HorizontalPlanTimeline 依 node.loading 且
          // 沒有資料的狀態自然渲染成骨架卡樣式(見該元件對 loading 節點
          // 的渲染邏輯),不需要額外的 isGenerating 分支渲染一塊獨立的
          // 骨架卡。錨點用目前時間軸最後一筆(跟 planActionToInsert 預設
          // 行為一致),接在已生成內容之後。
          const rendered = toRenderList(timelineRef.current)
          const anchorNode = rendered.length > 0 ? rendered[rendered.length - 1] : null
          const anchorId = anchorNode?.id ?? null
          // day——2026-10 使用者明確回報「第二天時,時間軸線會一直換成
          // 第一日又回來」:這筆空白佔位節點原本沒有帶 day,渲染層
          // (HorizontalPlanTimeline.tsx currentDay)用 node.day ?? 1
          // 退回預設值——若這個骨架卡出現在第二天行程正要開始排的時機
          // (前一筆錨點節點 day 是 2),骨架階段會被誤判成第一天,時間
          // 軸線先跳回 Day 1,等真正的 add_stop 資料(帶正確 day)透過
          // updateNode 補上才又跳回 Day 2,造成軸線來回跳動。改成延續
          // 錨點節點的 day(錨點通常就是上一個已完成的站點,新站點理論
          // 上屬於同一天,除非劇本本身的 add_stop.day 指定換天——那種
          // 情況下等真正資料到達時 updateNode 會覆蓋這裡的暫定值,不會
          // 錯誤停留在舊的 day)。沒有錨點(時間軸完全空白)時沿用原本
          // 預設第一天的語意。
          const anchorDay = (anchorNode && anchorNode.type === 'stop' ? anchorNode.day : undefined) ?? 1
          const result = insertAttractionAfter(anchorId, action.nextId, { type: 'stop', loading: true, day: anchorDay })
          if (!result.ok) {
            throw new Error(result.error.message)
          }
        }
        return
      }
      // 2026-10 使用者明確回報「第一個骨架下一個,直接就出現第一張卡跟
      // 第二個骨架,我要有只有第一個卡的狀態」:原本 isGenerating 只有
      // 整段劇本播完(done)才會變 false,每一站完成後它仍然是 true
      // (因為緊接著的下一則 thinking 往往馬上送到),骨架卡因此永遠
      // 跟著顯示,畫面上從來沒有「只有一張完整卡、沒有任何推論中信號」
      // 的穩定狀態。這裡非 thinking/done 的每一則訊息(代表某個具體動作
      // 真正完成,例如這一站/這則備註/這次移除處理完畢)處理前都先讓
      // isGenerating 變 false,骨架卡立即消失,只留這張剛完成的卡片,
      // 直到下一則 thinking 送達才重新變 true、骨架卡再次出現——讓
      // 「完成→停留→下一輪推論開始」這個節奏在畫面上真正看得到。
      setIsGenerating(false)
      // reset:清空時間軸(見 PlanAction.type 對這則訊息的完整說明)。
      // 來源在「使用者往回捲」時先送這則,再重播到目標進度。isGenerating
      // 已經在上面統一設成 false,這裡不需要重複設定。
      if (action.type === 'reset') {
        setTimeline(createEmptyTimeline())
        return
      }
      // reset_day:只清掉指定的那一天(見 PlanAction.type 的完整說明)。
      // 用 plan-core 的 removeDay——走訪鏈結、重接 prevId/nextId、處理
      // headId 都在那支純函式裡(資料操作統一在領域層,頁面層只呼叫,
      // 不自己改資料結構)。
      if (action.type === 'reset_day') {
        const day = action.day ?? 1
        setTimeline((prev) => removeDay(prev, day))
        return
      }
      // remove_step:先標記 removing(觸發 CSS 淡出),真正從鏈結摘除
      // 延遲到動畫播完後才做(見 removeNode/REMOVE_FADE_MS 的完整
      // 說明)——不然節點會瞬間消失,看不到淡出過程。這段標記邏輯不透過
      // insertAttractionAfter(那個介面只負責插入),直接用 setTimeline
      // 呼叫 updateNode,理由同模擬路徑其餘非插入類異動(移除本來就不是
      // 「機制跟介面由行程安排元件提供」這個要求要收斂的對象——那個要求
      // 針對的是插入邏輯不能有兩份,移除邏輯只有這一條路徑,沒有重複可言)。
      if (action.type === 'remove_step' && action.removedId) {
        const removedId = action.removedId
        setTimeline((prev) => updateNode(prev, removedId, { removing: true }))
        setTimeout(() => {
          if (cancelled) return
          // 移除前記下 nextId——removeNode 本身已經同步清空這個節點(若
          // 是 stop)的 transitFromPrev(見該函式的完整說明),這裡摘除
          // 後還要背景重新查一次「新的前一站→這一站」的交通,理由同
          // refreshTransitForStop 開頭列出的呼叫時機第 2 點(使用者明確
          // 要求「當前一個站點有異動時,要觸發重新推估」)。
          const nextId = timelineRef.current.nodes.get(removedId)?.nextId
          // removeNode 現在回傳結構化結果(見該函式/RemoveNodeResult 的
          // 完整說明,這份原型檔案本身不受那次異動影響,純粹配合新的
          // 回傳型別簽名)——找不到節點或已被移除時原樣保留 prev,不是
          // 行為變更。allowRemoving:true 是必要的:這裡呼叫的節點必然
          // 是上面那行剛標記的 removing:true,是這個兩段式流程「完成
          // 移除」的第二步,不帶這個旗標會被新版 removeNode 的
          // already_removing 檢查誤判成重複移除而拒絕,導致節點永遠
          // 卡在 removing:true 佔位不消失(見 removeNode
          // opts.allowRemoving 的完整說明,這是曾經實際發生過的
          // regression)。
          setTimeline((prev) => {
            const result = removeNode(prev, removedId, { allowRemoving: true })
            return result.ok ? result.timeline : prev
          })
          if (nextId != null) refreshTransitForStop(nextId, setTimeline, () => timelineRef.current, dataSource)
        }, REMOVE_FADE_MS)
        return
      }
      // add_note:不再插入新節點(見 STEP_ADD_TYPES 的完整說明,note 已
      // 移出 planActionToInsert 的處理範圍),直接呼叫 setNoteForStop 把
      // 備註寫在 action.afterId 指定的既有節點身上——語意對齊
      // attractionTools.ts AttractionStepsCtx.addNote 的 anchorId 參數
      // (見該介面的完整說明),afterId 缺漏時代表腳本本身沒有指定要
      // 寫在哪個節點上,同 toInsert.anchorId 找不到節點的處理原則(使用者
      // 明確要求「模擬的部分也完全走這個路徑,不要有例外」),讓
      // setNoteForStop 因找不到節點而回傳 anchor_not_found、直接拋錯,
      // 不做寬容降級。
      if (action.type === 'add_note') {
        const result = setNoteForStop(action.afterId ?? '', action.text ?? '', action.category)
        if (!result.ok) {
          throw new Error(result.error.message)
        }
        return
      }
      // 2026-10 使用者明確要求「安排中時就加入一張卡片,只是這張卡片
      // 沒有資料時就呈現骨架卡」:add_stop 訊息到達時,通常前面的
      // thinking 已經用這個 action.id 當 id 插入過一筆空白的 loading
      // 佔位節點(見上方 thinking 分支)——這裡改用 updateNode 原地
      // 補上完整資料,不再呼叫 insertAttractionAfter 插入另一筆新節點
      // (那樣會留下一個永遠空白的孤兒節點,且畫面上會出現兩張卡)。
      // 只有在真的找不到對應佔位節點時(理論上不該發生,thinking 一定
      // 先於對應的 action 送達,但防禦性地保留 fallback,避免未來劇本
      // 資料若有 thinking 被跳過的情況時整個卡住)才退回原本的插入路徑。
      if (action.type === 'add_stop' && action.id && timelineRef.current.nodes.has(action.id)) {
        const toUpdate = planActionToInsert(timelineRef.current, action)
        if (!toUpdate) return
        // staleOtherAgentMessages——理由同 insertAttractionAfter 對新插入
        // stop 的既有處理(見該函式呼叫處的完整說明):佔位節點原地轉成
        // 真正的地點站,同樣代表話題已經推進,其他還「新鮮」的對話訊息
        // 節點要一併淡化,不能因為這裡走的是 updateNode 而非插入新節點
        // 就漏掉這個效果。
        setTimeline((prev) => staleOtherAgentMessages(updateNode(prev, action.id!, toUpdate.data), action.id!))
        // insertAttractionAfter 原本插入成功後,若帶 placeId 且是 loading
        // 佔位狀態會背景觸發 resolveAttractionForStep 補資料(見該函式
        // 的完整說明)——這裡繞過 insertAttractionAfter 直接 updateNode,
        // 需要自己重做這一段背景查詢觸發,否則帶 placeId 的佔位卡永遠
        // 不會真的查到完整資料。
        if (toUpdate.data.placeId && toUpdate.data.loading) {
          resolveAttractionForStep(
            action.id,
            toUpdate.data.placeId,
            (placeId) => dataSource.placeDetails(placeId),
            setTimeline,
            () => false,
            () => refreshTransitForStop(action.id!, setTimeline, () => timelineRef.current, dataSource),
          )
        } else if (toUpdate.data.lat != null && toUpdate.data.lng != null) {
          refreshTransitForStop(action.id, setTimeline, () => timelineRef.current, dataSource)
        }
        // 2026-10 使用者明確回報「骨架卡轉成地點時就要拉到中間,目前是
        // 要等下一個骨架時才拉往中間」:見下方 latestInsertedStopIdRef
        // 的完整說明——這裡原地補資料,id 本來就沒變,同樣要記下來讓
        // useSimulatedStopsView 同步選取。
        latestInsertedStopIdRef.current = action.id
        return
      }
      // 新增類 action(含 add_message,見 STEP_ADD_TYPES 的完整說明):
      // 統一走 planActionToInsert + insertAttractionAfter
      // (見兩者的完整說明)——不再有模擬路徑專屬的 insertAfter 呼叫或
      // 「錨點找不到就退回 append 到最後一筆」的寬容降級,驗證失敗時
      // 的行為跟 onagent 對話路徑完全一致:真的拋錯中斷,不是靜默放棄
      // (使用者已確認選擇這個處理方式)。add_stop 帶 placeId 時的背景
      // 反查已經內建在 insertAttractionAfter 內部,這裡不需要再自己
      // 觸發一次 resolvePlaceForStep。
      const toInsert = planActionToInsert(timelineRef.current, action)
      if (!toInsert) return
      const result = insertAttractionAfter(toInsert.anchorId, toInsert.newId, toInsert.data)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      // 2026-10 使用者明確回報「骨架卡轉成地點時就要拉到中間,目前是
      // 要等下一個骨架時才拉往中間」:新插入的地點站 id 記下來,讓
      // useSimulatedStopsView(見該函式的完整說明)能在同一個 stops
      // 更新週期裡把 selectedStopId 同步指過去——這個 effect 所在的
      // usePlanSimSocket 本身不持有 selectedStopId 這個 state(它屬於
      // 下游的 useSimulatedStopsView),不能在這裡直接呼叫對應的
      // setter,只能先記錄「最新插入的站點是誰」。
      if (action.type === 'add_stop') {
        latestInsertedStopIdRef.current = toInsert.newId
      }
    })
    const unsubscribeError = source.onError(() => {
      if (!cancelled) setIsGenerating(false)
    })

    return () => {
      cancelled = true
      unsubscribeMessage()
      unsubscribeError()
      source.close()
    }
  }, [start])

  const steps = toRenderList(timeline)

  // clearTimeline——把時間軸清空。
  //
  // 「讓我試看看」按鈕用(使用者明確要求交接時清空時間軸):模擬跑完
  // 幾站之後使用者決定自己試,展示用的那幾站要先清掉,不能讓他以為
  // 那是自己排的。這個頁面的時間軸不持久化(純展示),所以只要清掉
  // 記憶體這份即可。
  const clearTimeline = useCallback(() => {
    commitTimeline(() => ({ next: createEmptyTimeline(), result: undefined }))
  }, [commitTimeline])

  return {
    steps,
    timeline,
    timelineRef,
    isGenerating,
    insertAttractionAfter,
    setNoteForStop,
    dragStopTime,
    clearTimeline,
    source,
    latestInsertedStopIdRef,
    // retryStopLookup——見該函式的完整說明。匯出給呼叫端接到
    // PlanTimelineView 的 onRetryStop。
    retryStopLookup,
  }
}

// NOTE_STYLES/DEFAULT_NOTE_CATEGORY——2026-10 移除:備註分類→顏色/圖示
// 的對照表現在收在 plan-core/PlanTimelineView.tsx 裡(改用該共用元件
// 渲染時間軸後,這裡不再自己畫備註列,見該檔案同名常數的完整說明)。
// action.category 仍直接原樣傳給 setNoteForStop,不在這裡做合法性
// fallback——跟正式頁 TripPlanPage.tsx 的 addNoteToTimeline 不同,
// 那裡會 fallback 成 DEFAULT_NOTE_CATEGORY,但使用者對模擬腳本的既有
// 要求是「不要有例外」(見下方 add_note 分支的完整說明),劇本本身保證
// category 合法,不需要呼叫端介入。

// isEmbedded——網址帶 ?embedded=1 時,代表這頁被當成 iframe 嵌進其他頁面:
// 不渲染頂部漂浮導覽(fixed 定位的一排按鈕會跟外框的動態島疊在一起)並
// 隱藏捲軸把手。預設行為(無參數)完全不變。
// 2026-10:功能介紹頁的手機小展示已改用 AiPlanPhoneDemoScreen 直接渲染
// (見 home/AiPlanPhoneDemo.tsx),不再 iframe 這一頁,目前沒有呼叫端
// 使用這個參數;保留作為日後需要把本頁整頁嵌進其他版面時的入口。
function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('embedded') === '1'
}

// shouldSkipDemo——2026-10 新增(使用者明確要求「網址加入一個參數,進去
// 的已略過播放態」):網址帶 ?skipDemo=1 時,掛載後直接呼叫 handover()
// (見該函式的完整說明)跳過整段劇本播放,一進頁面就是推論態——適合
// 需要反覆測試推論行為(例如本次 search_attraction/open_ask_page 相關
// 的實機驗證)的情境,不用每次都等劇本播完、點「不用了」跳過開場候選
// 卡片才能進到推論態。寫法比照 isEmbedded 的既有慣例,不是另外發明
// 一套參數解析方式。
function shouldSkipDemo(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('skipDemo') === '1'
}

// PlanStopsView — 「地圖要顯示哪些站點」這份投影的統一介面。
//
// 2026-10 改名(原本叫 PlanInferenceSource,「推論來源」):那個名字誤導
// ——真正的推論(AI 決定排哪些站)發生在更上游,是 PlanSimSource 的劇本
// 播放、或 onagent 的工具呼叫。這個介面做的是投影:把 PlanTimeline 這份
// 真相,篩成地圖需要的形狀(只留有座標的 stop 節點、只取 id/lat/lng/name,
// 丟掉備註、交通、removing 標記、children)。
//
// 「投影」= 單向、唯讀、可重算的衍生。丟掉重算一次,結果一樣——它不持有
// 任何東西(toRenderList(timeline) → steps 是另一個投影,給時間軸 UI 用,
// 那個反而會加東西:插入 Day 分隔線)。
//
// kind 欄位說的是「這份站點來自模擬還是真實」,給 JSX 決定渲染哪個時間軸
// 層用(`view.kind === 'live' ? <LivePlanLayer> : <PlanTimelineView>`),
// 不是「推論方式」。刻意不把「要渲染哪個元件」這件事做成介面的方法——那是
// 版面層級的分支,跟「站點資料從哪來」是兩個獨立的關注點。
//
// 這個介面取代原本到處寫 `handedOver ? liveXxx : mapXxx` 的三元判斷
// (2026-10,使用者明確要求「現在就重構成介面(與模擬層/真實層統一父
// 介面)」,設計上參考 plan-core/planTimelineStorage.ts PlanTimelineStore
// 的既有模式)。
//
// 檢視狀態(selectedStopId/hoverStopId)不在這裡——它不是投影出來的,是
// 獨立的 state,見下方 PlanSelection 的完整說明。
//
// 「交接」不是這個介面的方法——交接的語意是「把目前這份投影整個換成另一
// 種 kind」,不是某個實例對自己做的操作(模擬投影沒有能力把自己變成真實
// 投影,反之亦然)。這個動作留在 AIPlanTimelinePage 元件本身:它用一個
// state(planSource)持有「目前用哪一份」,handover() 就是改寫它。
export interface PlanStopsView {
  kind: 'simulated' | 'live'
  stops: PlanStopMarker[]
}

// PlanSelection — 「使用者現在在看哪一站」這組檢視狀態,2026-10 從
// PlanStopsView 裡抽出來(使用者明確指出「推論不應該持有 UI 狀態
// 的,這樣要替換控制來源,或是不同控制來源操作時才不會產生不同步」)。
//
// 原本這兩個值住在每個來源實作各自的 useState 裡。那樣做有三個實際
// 問題,都是「來源實例跟檢視狀態綁在一起」造成的:
//
//   1. 來源物件會隨選取改變而變成新參照——選取只是「使用者點了哪張
//      卡」,卻讓整個 source 物件換新,下游任何以 source 為依賴的
//      effect 都會跟著重跑。AIPlanTimelinePage 因此需要一個 effect 把
//      simulatedSource 同步回 planSource state,而那個 effect 踩過
//      「Maximum update depth exceeded」的無限迴圈(見該處的完整說明,
//      修法是改成依賴 stops/selectedStopId/hoverStopId 三個值而不是
//      整個物件——那是在補這個設計的破口)。
//   2. 替換來源時兩份狀態不同步:模擬層跟真實層各持有一份選取,交接
//      時從一份換成另一份。目前看起來「天然正確」(新的那份是 null),
//      但那是因為剛好只有單向、一次性的交接;只要之後出現「切回模擬」
//      或「同時有兩個控制來源」,就會變成兩份狀態互相覆蓋。
//   3. 語意不對:選取不是推論的產物。AI 排出哪些站是推論結果,使用者
//      在看哪一站不是——它不持久化、不進 AI 的工具、重新整理後不該
//      還在。放在推論來源裡等於宣稱它跟 stops 是同一種東西。
//
// 抽出來之後,選取狀態跟「目前用哪個來源」完全無關,這讓兩件事都做得到:
//   - 交接時「要清空選取」變成明確的一行呼叫(見 handover),而不是靠
//     「換掉實例」的副作用隱含達成——後者讀程式碼看不出來。
//   - 反過來,「替換推論層但不改變現況」也成立(使用者明確指出的情境):
//     使用者正選中某一站,此時把推論來源換掉(模擬版換成接真實後端、
//     計時器版換捲動版),選取可以原封不動留著。綁在來源裡的話這件事
//     根本做不到——換來源就等於選取被丟掉。
export interface PlanSelection {
  selectedStopId: string | null
  hoverStopId: string | null
  setSelectedStopId: (id: string | null) => void
  setHoverStopId: (id: string | null) => void
  // clear——交接/重置時清空選取。等同連續呼叫兩個 setter 傳 null,
  // 收成一個具名方法讓呼叫端的意圖一眼可見。
  clear: () => void
}

// usePlanSelection — PlanSelection 的唯一實作。沒有第二種實作,也不預期
// 會有:這就是兩個 useState,抽成 hook 只是為了讓「這組狀態是一個整體」
// 這件事在型別上成立,並給它一個可以被兩個消費端共用的身分。
export function usePlanSelection(): PlanSelection {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [hoverStopId, setHoverStopId] = useState<string | null>(null)
  const clear = useCallback(() => {
    setSelectedStopId(null)
    setHoverStopId(null)
  }, [])
  return { selectedStopId, hoverStopId, setSelectedStopId, setHoverStopId, clear }
}

// useSimulatedStopsView — 「模擬來源」的具體實作:包裝模擬層自己的
// mapStops/selectedStopId/hoverStopId 這幾個 state 與其 setter,原樣對應
// 既有行為,不是重新設計一套。steps 由呼叫端(usePlanSimSocket 的回傳值)
// 傳入,這個 hook 只負責從中篩出站點、管理選取/hover 這兩個 state。
//
// latestInsertedStopIdRef——2026-10 新增(見 usePlanSimSocket 同名 ref
// 的完整說明):新地點站插入後,這裡同步把 selectedStopId/hoverStopId
// 指過去,修正 HorizontalPlanTimeline 的自動捲動 effect 因為
// selectedStopId 一直停在舊卡、要等下一輪才追上的「慢一拍」問題。
//
function useSimulatedStopsView(
  steps: PlanStep[],
  latestInsertedStopIdRef: { current: string | null },
  // selection——檢視狀態由外部注入,這個來源不持有(見 PlanSelection 的
  // 完整說明)。模擬來源仍然需要「寫入」選取:新站點排出來時自動選中它
  // (見下方 lastAutoSyncedStopIdRef 的 effect),那是推論的行為(排出
  // 新站 → 把焦點帶過去),不是持有狀態。
  selection: PlanSelection,
): PlanStopsView {
  const { setSelectedStopId, setHoverStopId } = selection
  // 2026-10 修正無限重渲染迴圈:steps 是 toRenderList(timeline) 的回傳值
  // (見 usePlanSimSocket),每次呼叫都是新陣列參照,即使 timeline 內容
  // 沒變——直接把 steps 放進 useMemo 依賴陣列,等於這個 memo 永遠判定
  // 「依賴變了」而重新計算出新的 stops 陣列,導致呼叫端(見下方 return)
  // 回傳的 PlanStopsView.stops 也永遠是新參照,使 AIPlanTimelinePage
  // 裡依賴 simulatedSource.stops 的 effect 永遠判定變動、無限重新執行
  // (見該 effect 的完整說明)。改用內容摘要字串當依賴(理由同
  // usePlanStopMarkers.ts 的 stopsKey),只有篩選/映射後的實際結果真的
  // 不同時,stops 才換新參照。
  //
  // 2026-10(第二輪,使用者明確要求「點選聚合點時,原本的點變成一個範圍
  // 圈圈,顯示圈圈內的地點小點」):子景點不再混進這份清單跟主題點用
  // 同一套圓點樣式——改成獨立的範圍圓圈+子景點小點圖層(見下方
  // useThemeRadiusCircle 的完整說明),視覺上明確區分「主題點本身」跟
  // 「展開後的範圍與子景點」,不是把子景點偽裝成跟其他站點一樣的一般
  // marker。這份清單維持只放「真正獨立佔用時間軸時間點的站點」,主題
  // 點本身(不論是否展開)仍然只在這裡佔一筆。
  // stopsKey——把 children 的座標也編進去(2026-10):子景點的座標是
  // 非同步查回來的,晚於父節點插入。不編進 key 的話,children 從空的
  // 變成有內容時 stopsKey 不變,stops 不重算,主題點永遠展不開。
  const stopsKey = steps
    .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
    .map((s) => {
      const childrenKey = (s.children ?? [])
        .map((c) => `${c.id}:${c.lat ?? ''}:${c.lng ?? ''}`)
        .join(';')
      return `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}|${childrenKey}`
    })
    .join(',')
  const stops = useMemo<PlanStopMarker[]>(
    () =>
      steps
        .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
        .map((s) => {
          // children——只收已經查到座標的子景點(見 PlanStopMarker.children
          // 的完整說明)。沒有任何有效子景點時不帶這個欄位,讓下游的
          // 「有沒有 children」判斷單純看它在不在。
          const children = (s.children ?? [])
            .filter((c) => c.lat != null && c.lng != null)
            .map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, name: c.name }))
          return {
            id: s.id,
            lat: s.lat!,
            lng: s.lng!,
            name: s.name,
            ...(children.length > 0 ? { children } : {}),
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopsKey],
  )
  // lastAutoSyncedStopIdRef——2026-10 修正(使用者實機回報「自動播放
  // 結束後,點其他卡片會被拉回最後一個」):記錄「這個 latestId 已經
  // 自動同步過選取了」,不是只看 selectedStopId 現在是不是等於
  // latestId。原本的判斷式 `if (selectedStopId === latestId) return`
  // 沒有分辨「selectedStopId 還沒追上最新插入的站(該自動同步)」跟
  // 「使用者後來手動點了別的站,selectedStopId 刻意不等於 latestId」
  // 這兩種情況——只要 selectedStopId 不等於 latestId 就一律覆蓋,導致
  // 自動播放結束(latestInsertedStopIdRef.current 停在最後一站不再變)
  // 後,使用者點任何其他卡片觸發 setSelectedStopId(otherId),這個
  // effect 因為依賴陣列裡的 selectedStopId 改變而重新執行,又把選取
  // 強制拉回最後一站,使用者點哪張卡都沒有反應。
  const lastAutoSyncedStopIdRef = useRef<string | null>(null)
  useEffect(() => {
    const latestId = latestInsertedStopIdRef.current
    if (latestId == null) return
    if (!stops.some((s) => s.id === latestId)) return
    // 這個 latestId 已經自動同步過一次了——不管 selectedStopId 現在是
    // 不是等於它,都不再重複同步,讓使用者之後手動選別的卡片時這裡
    // 不會把選取搶回來。
    if (lastAutoSyncedStopIdRef.current === latestId) return
    lastAutoSyncedStopIdRef.current = latestId
    setSelectedStopId(latestId)
    setHoverStopId(latestId)
  }, [stops, latestInsertedStopIdRef, setSelectedStopId, setHoverStopId])
  return { kind: 'simulated', stops }
}

// useLiveStopsView — 「真實來源」的具體實作:包裝 LivePlanLayer 透傳上來
// 的 liveStops/liveSelectedStopId/liveHoverStopId 這幾個 state 與其
// setter,原樣對應既有行為(2026-10 前這幾個 state 直接宣告在
// AIPlanTimelinePage 裡,這裡只是把它們連同對應的 onStopsChange/
// onSelectedStopChange/onHoverStopChange 回調一起收進這個 hook,呼叫端
// 不再需要自己管理這組 state)。
//
// 回傳值裡額外帶出 onStopsChange/onSelectedStopChange/onHoverStopChange
// 三個回調(不屬於 PlanStopsView 介面本身)——這三個回調要原樣轉給
// <LivePlanLayer>,是這個來源「怎麼被餵資料」的實作細節,不是其他呼叫端
// (例如 usePlanStopMarkers)需要透過 PlanStopsView 介面讀取的資料,
// 混進介面本身只會讓它背上跟「渲染 LivePlanLayer」綁死的職責。
function useLiveStopsView(selection: PlanSelection) {
  const [stops, setStops] = useState<PlanStopMarker[]>([])
  const handleStopsChange = useCallback(
    (next: PlanStopMarker[]) => setStops(next),
    [],
  )
  const source: PlanStopsView = { kind: 'live', stops }
  // onSelectedStopChange/onHoverStopChange 直接轉給共用的 selection——
  // LivePlanLayer 內部的 TripPlanPage 選中某一站時,寫入的是跟模擬層、
  // 地圖層同一份檢視狀態(見 PlanSelection 的完整說明),不是這個來源
  // 自己的一份。
  return {
    source,
    onStopsChange: handleStopsChange,
    onSelectedStopChange: selection.setSelectedStopId,
    onHoverStopChange: selection.setHoverStopId,
  }
}

export function AIPlanTimelinePage() {
  const embedded = isEmbedded()
  const { theme, dark, toggleTheme } = useThemeToggle()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)

  // typedPrompt——輸入框的假打字動畫,展示「使用者輸入這句話,AI 據此
  // 安排行程」的敘事開場,呼應下方自動播放的劇本(planSimScript.ts 第
  // 一則就是赤崁樓開場)。輸入框本身是唯讀展示(見下方 JSX 的完整說明),
  // 不是真的等使用者打字,純粹用逐字附加模擬打字節奏。掛載時執行一次,
  // 不需要清理殘留計時器以外的邏輯(這個頁面不會重新播放)。
  //
  // promptTyped——打完最後一個字那一刻視同「使用者送出」,使用者明確
  // 要求「輸入文字送出後,才觸發開始安排」:傳給 usePlanSimSocket 當
  // start 參數,打字動畫播完前劇本不會開始播放,兩件事不再同時發生。
  // 宣告在 usePlanSimSocket 呼叫之前——後者的 start 參數直接讀這個值。
  const [typedPrompt, setTypedPrompt] = useState('')
  const [promptTyped, setPromptTyped] = useState(false)
  useEffect(() => {
    const fullText = '幫我排台南兩天一夜的行程'
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setTypedPrompt(fullText.slice(0, i))
      if (i >= fullText.length) {
        clearInterval(timer)
        setPromptTyped(true)
      }
    }, 90)
    return () => clearInterval(timer)
  }, [])

  // showAskPage/askPageInput/openAskPage/handleAskPageDone——2026-10
  // 新增(使用者明確要求「播放畫面第一個先模擬送出一個 ask」)。狀態機
  // 本身抽成共用 hook useAskPageBridge(見該檔案開頭的完整設計理由),
  // 跟 TripPlanPage.tsx 的同名機制共用同一份實作,差異只在 Input 泛型:
  // 這裡的劇本固定只給 { candidates }(劇本內容是寫死的,不適合依賴
  // 即時地圖中心/使用者位置的探查模式),不像 TripPlanPage.tsx 還支援
  // { explore }。openAskPage 會被傳給 createPlanSimFakeSource(見該
  // 函式的完整說明)當建立參數,劇本播到 open_ask_page 這則時會直接
  // 呼叫它、await 它——跟真實 AgentBridge 呼叫 open_ask_page 工具
  // handle 的形狀完全對應,這個元件(劇本的消費端)不需要額外做任何事。
  //
  // 宣告位置在 usePlanSimSocket 呼叫之前(而不是跟其餘大多數 state
  // 一起宣告在後面)——下方 createSource 的 useCallback 需要在呼叫
  // usePlanSimSocket 當下就拿到 openAskPage,JavaScript 變數必須先
  // 宣告才能在同一個函式作用域的後續程式碼裡使用,順序不能顛倒。
  const { showAskPage, askPageInput, openAskPage, handleAskPageDone } = useAskPageBridge<{
    candidates: AskPageCandidate[]
    // picks——劇本指定這一步哪幾個候選顯示成已選取(見 PlanAction.picks
    // 的完整說明)。播放態用它讓 AskPage 走腳本模式,不等真人點選。
    picks?: string[]
  }>({ candidates: [] })
  // isDesktop——決定兩件事:
  //   1. 模擬層的手機版要不要換成橫向卡片時間軸(HorizontalPlanTimeline,
  //      見該元件檔頭的完整說明);桌面版繼續渲染 PlanTimelineView。
  //   2. 劇本播到 open_ask_page 時要不要等使用者選擇(見下方
  //      createPlanSimSource 的完整說明)。
  // 宣告位置提前到這裡(原本在 mapHandle 附近)——createPlanSimSource
  // 要用到它,JavaScript 變數必須先宣告才能在後續程式碼裡使用。
  const isDesktop = useIsDesktop()
  // isWide——是否達到 PlanDemoLayout wide 模式的斷點(1024px,見
  // useIsWide 的完整說明)。獨立於 isDesktop 的判斷,只決定要不要把
  // wide prop 傳給 PlanDemoLayout,不影響上面 isDesktop 原本的兩個
  // 既有用途。
  const isWide = useIsWide()

  // createPlanSimSource——用 useCallback 包一層穩定參照:
  // usePlanSimSocket 的 createSource 參數若每次 render 都是新函式,
  // 底下的 effect(建立來源的那個)會每次 render 都重新執行,意外地
  // 重播整段劇本。
  //
  // openAskPage 兩種版面都傳(2026-10 使用者明確要求「桌面版的要顯示
  // ask page」):劇本第一則就是 open_ask_page,planSimFakeSource 會
  // await 它才繼續播下一則。
  //
  // 曾經一度改成「桌面版不傳,直接跳過等待」——那是因為 AskPage 原本
  // 只渲染在手機版的 HorizontalPlanTimeline 裡,桌面版渲染
  // PlanTimelineView、沒有這個元件,整段劇本停在第 0 步(實機確認過:
  // 桌面版時間軸全空、一張卡片都沒有)。跳過等待雖然解開了卡死,
  // 但桌面使用者也就永遠看不到候選選單。改成桌面分支也渲染 AskPage
  // (見下方 JSX),兩種版面都看得到。
  //
  // 2026-10(使用者明確定調「播放態不會有真實互動」):先前這裡的
  // openAskPage 交給 source 之後,那個 Promise 只有使用者真的在 AskPage
  // 上點選、觸發 handleAskPageDone 才會 resolve——等於整段劇本的推進被
  // 綁在一次真人互動上,跟「預設進入會全部播放」這個既有定調矛盾
  // (見 planSimFakeSource.ts 檔頭)。也正是桌面卡死那個 bug 的根因:
  // 沒人可以點,就永遠播不下去。
  //
  // 現在改由 AskPage 的腳本模式負責(見 AskPage.tsx AskPageProps.scripted
  // 的完整說明):劇本帶 picks 指定哪幾個候選顯示成已選取,AskPage 不渲染
  // 按鈕列、演出按下確認後自己送出,Promise 照常 resolve、
  // 劇本繼續。這一層只要把 openAskPage 原樣交出去就好,不需要再包一層
  // 計時器——「不等真人」這件事屬於那個面板怎麼渲染,不屬於這裡怎麼
  // 橋接 Promise。
  const createPlanSimSource = useCallback(() => createPlanSimFakeSource(openAskPage), [openAskPage])

  // renderScriptedAskPage——置換用的詢問頁(見 ScriptedAskPage.tsx 檔頭
  // 的完整說明),同時給桌面與手機兩個分支用。
  //
  // 必須用 useCallback 包,而且依賴要精確到「劇本這一步的實際內容」:
  // HorizontalPlanTimeline 收到的是一個會被它直接呼叫的函式,每次父元件
  // render 若都傳一個新函式進去,它回傳的 element 每次都是新的,React
  // 對應不到同一個元件實例,於是每次 render 都把 ScriptedAskPage 整個
  // 重新掛載。
  //
  // 實機踩過(用 DevTools 追 960ms、57 個取樣確認):劇本播放期間父元件
  // 每則訊息都會 render,內嵌的箭頭函式讓詢問頁被反覆重掛,
  // getAnimations() 回報 5 個同名動畫、currentTime 全程停在 0——點擊
  // 特效每一格都在重新開始,所以完全看不到動畫,卡片只是突然變成已勾選。
  //
  // 依賴列 candidates/picks 而不是整個 askPageInput:後者是 bridge 的
  // state,open_ask_page 之外的 render 也可能換掉它的參照。
  const askPageCandidates = askPageInput.candidates
  const askPagePicks = askPageInput.picks
  // askPageDataSource——2026-10 使用者明確要求「播放態用固定的 attraction
  // id,但是資料跟圖片與推論態用一樣的方式取得」:詢問頁候選卡片的名稱與
  // 照片不再查假資料池(那邊只有 REAL_PHOTOS 登記過的 id 才有圖,其餘卡片
  // 上半部空白),改走跟推論態(訪客)同一條 createPlanAiPublicDataSource
  // → /public/geo/plan-ai/place-details-any,由後端依 placeId 回資料庫
  // 既有景點的真名稱與照片。劇本裡的候選 placeId 是固定的(見
  // planSimScript.ts open_ask_page 的完整說明),所以畫面內容穩定,不會
  // 因為查詢而變動。只有詢問頁這一處換;時間軸站點的背景反查仍是假資料
  // (planAiFakeDataSource),那是劇本逐站排出來的另一條路徑。
  // 用公開端點而不是依登入狀態切換:播放態本來就是給未登入訪客看的展示,
  // 公開端點登入後也能用,不需要分兩套。查詢失敗時 ScriptedAskPage 會降級
  // 成劇本自己帶的名稱、沒有照片(見它的 catch),不會整頁壞掉。
  const askPageDataSource = useMemo(() => createPlanAiPublicDataSource(BASE_URL), [])
  const renderScriptedAskPage = useCallback(
    () => (
      <ScriptedAskPage
        dataSource={askPageDataSource}
        candidates={askPageCandidates}
        picks={askPagePicks ?? []}
        confirmAfterMs={ASK_PAGE_CONFIRM_DELAY_MS}
        onDone={handleAskPageDone}
        // stacked——寬螢幕(>=1024px)側欄改用縱向堆疊的候選卡片列表,
        // 取代橫向捲動(見 ScriptedAskPage.tsx stacked prop 的完整說明,
        // 2026-10 使用者明確要求)。這個 callback 同時服務手機版
        // (horizontalTimeline 分支)與桌面版(isDesktop 分支)兩處呼叫,
        // isWide 在手機版恆為 false,不會影響手機版既有的橫向捲動。
        stacked={isWide}
      />
    ),
    [askPageCandidates, askPagePicks, askPageDataSource, handleAskPageDone, isWide],
  )

  // 這個頁面固定「打字動畫播完才開始安排」(見上方 promptTyped 的完整
  // 說明),不再需要 simEnabled 開關——原始版本這裡還有
  // usePlanAiChatBridge(接真實 onagent 對話)與對應的 getStepsForBridge/
  // addNoteToTimeline 橋接函式,使用者明確要求這個頁面的輸入框改為
  // 純展示、不接受真的輸入,整條 onagent 對話路徑已一併移除。
  // DEBUG_SAFE_AREA 開啟時傳 false,不建立來源、不播放——驗證中心點
  // 計算時畫面上不該有東西在動(見該常數的完整說明)。沒帶那個 URL
  // 參數時這個判斷恆為 false,播放行為跟平常完全一樣。
  const { steps, isGenerating, timelineRef, dragStopTime, clearTimeline, latestInsertedStopIdRef, retryStopLookup } = usePlanSimSocket(
    DEBUG_SAFE_AREA ? false : promptTyped,
    createPlanSimSource,
  )
  const stopCount = steps.filter((s) => s.type === 'stop').length

  // expandedThemeId——2026-10 改成由 useMapMarkerLayer 內部 reducer 自己
  // 判斷(見下方該 hook 呼叫處的完整說明),不再是這裡自己宣告的獨立
  // state、也不再需要另外讀 timelineRef.current.nodes 算一次——原本
  // 「選中的站點若帶 children 就展開」這個判斷邏輯已經收斂進
  // mapMarkerLayer/reducer.ts 的 applySelection,這裡只需要把 children
  // 資訊帶進 points 陣列(見下方 mapMarkerPoints 的完整說明)。

  // simulatedSource/liveSource——兩種具體的 PlanStopsView 實作(見
  // 該介面與這兩個 hook 的完整說明),各自原樣包裝先前直接宣告在這個
  // 元件裡的 mapStops/selectedStopId/hoverStopId 與
  // liveStops/liveSelectedStopId/liveHoverStopId 這兩組 state。兩個 hook
  // 都無條件呼叫(不因為目前用哪一個就跳過另一個的 state 宣告)——這是
  // React hooks 規則的既有要求,呼叫次數/順序不能依條件變動,跟原本
  // mapStops/liveStops 兩組 state 本來就都無條件宣告是同一種既有模式,
  // 不是這次重構才新增的限制。
  // selection——「使用者在看哪一站」這組檢視狀態,跟「目前用哪個推論
  // 來源」完全分開(見 PlanSelection 的完整說明)。宣告在兩個來源之前,
  // 因為兩者都要用同一份。
  const selection = usePlanSelection()
  const simulatedSource = useSimulatedStopsView(steps, latestInsertedStopIdRef, selection)
  const { source: liveSource, onStopsChange: handleLiveStopsChange, onSelectedStopChange: setLiveSelectedStopId, onHoverStopChange: setLiveHoverStopId } = useLiveStopsView(selection)

  // planSource——目前使用中的來源實例(型別是 PlanStopsView),
  // 取代原本的 handedOver 布林值。這是這個元件唯一需要持有的「目前用
  // 哪一個來源」狀態——其餘呼叫端(usePlanStopMarkers、JSX 渲染判斷)
  // 一律讀 planSource.kind/stops/selectedStopId/... 或呼叫
  // planSource.setSelectedStopId(...) 等方法,不再各自寫
  // `handedOver ? A : B` 這種三元判斷。
  //
  // 初值是 simulatedSource——頁面一開始一定是模擬層,交接是單向的(見
  // handover 的完整說明)。
  const [planSource, setPlanSource] = useState<PlanStopsView>(simulatedSource)
  // 模擬來源的 stops 會隨著劇本播放持續更新,simulatedSource 因此每次
  // render 都是新的物件參照——交接前(planSource.kind === 'simulated')
  // 要讓 planSource 跟著最新的內容走,不能卡在掛載當下那一份陳舊的快照。
  // 交接後這個 effect 不再做任何事:handover() 當下已經把 planSource
  // 換成 liveSource,之後條件恆為 false,不會換回模擬來源。
  //
  // 2026-10 修正無限重渲染迴圈:simulatedSource 是物件 literal,每次
  // render 都是新參照,若依賴陣列直接放它本身,effect 會在每次 render
  // 後都判定「依賴變了」而重新執行——執行時又 setPlanSource 換成另一個
  // 新物件,觸發下一次 render,形成自我餵養的無限迴圈(console 報
  // "Maximum update depth exceeded")。改成依賴實際內容打斷迴圈。
  //
  // 2026-10(檢視狀態抽出後):依賴從三個值縮回一個 stops。原本
  // selectedStopId/hoverStopId 也在裡面,代表「使用者點一張卡」會讓
  // 整個來源物件換新、這個 effect 重跑一次——那是把檢視狀態綁在來源上
  // 的直接代價(見 PlanSelection 的完整說明)。現在選取改變完全不碰
  // 這條路徑。
  useEffect(() => {
    setPlanSource((prev) => (prev.kind === 'simulated' ? simulatedSource : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulatedSource.stops])

  // 真實來源的同步——2026-10 修正(使用者實機回報「真實推論還是沒有
  // 出現地圖點」)。
  //
  // handover() 只做 setPlanSource(liveSource),存進 state 的是交接當下
  // 那個快照,而那一刻 stops 必然是空的(使用者還沒跟 AI 說任何話)。
  // 之後 LivePlanLayer 回報站點、useLiveStopsView 的 stops 更新、
  // liveSource 變成新物件,但 planSource 還指著那個 stops: [] 的舊快照
  // ——地圖永遠拿到空陣列,一個點都畫不出來。
  //
  // 模擬來源早就有對應的同步 effect(見上方),真實來源漏了。兩者現在
  // 對稱:各自在自己是當前來源時,讓 planSource 跟著最新內容走。
  // 依賴只放 stops 的理由同上方——liveSource 是物件 literal,每次 render
  // 都是新參照,直接放它會形成自我餵養的無限迴圈。
  useEffect(() => {
    setPlanSource((prev) => (prev.kind === 'live' ? liveSource : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSource.stops])

  // handover——「交接」這個動作本身,取代原本單純的 setHandedOver(true)
  // 布林翻轉:把目前的來源實例整個換成 liveSource(真實來源)。
  //
  // 2026-10 改動(使用者明確要求「按鈕按下去不能進入 app,是要替換掉
  // 時間軸層」):原本這顆按鈕是 navigate('/app') 跳到正式功能頁,現在
  // 留在同一頁替換內容——模擬的時間軸清空,換成讓使用者自己描述需求的
  // 介面。這樣做的理由是連續性:使用者剛看完一段「AI 自動排行程」的
  // 展示,當下最想做的是「換我試試看」,跳轉到另一個頁面(還可能撞上
  // 登入牆)會把那個當下打斷。
  //
  // 單向、不可逆——交接後沒有「回到模擬」的路徑(見 LivePlanLayer.tsx
  // 檔頭 TODO 第 3 點的完整說明:模擬的腳本播放是一次性的,重播需要
  // 另外設計)。
  const handover = useCallback(() => {
    clearTimeline()
    // 清空選取——2026-10 檢視狀態從推論來源抽出來之後(見 PlanSelection
    // 的完整說明),這件事必須明確做。原本是靠「換掉來源實例」的副作用
    // 隱含達成:新實例的 useState 初值是 null,所以看起來自動清空了。
    // 那個隱含行為有兩個問題——讀程式碼看不出來,而且反過來的情境
    // (替換推論層但要保留現況)做不到。現在兩種都只是要不要呼叫這一行。
    selection.clear()
    setPlanSource(liveSource)
  }, [clearTimeline, liveSource, selection])

  // skipDemo——見 shouldSkipDemo 的完整說明:網址帶 ?skipDemo=1 時,
  // 掛載後立即呼叫 handover() 跳過劇本播放。用 ref 記錄「已經觸發過」
  // 而非只靠依賴陣列,是因為 handover 本身的參照會隨 liveSource/
  // selection 改變而重新產生(見上方 useCallback 依賴陣列)——若直接把
  // handover 放進 effect 依賴陣列,每次 handover 參照變動都會讓這個
  // effect 重新執行,對已經交接過的頁面重複呼叫 handover()(雖然
  // handover 本身冪等、不會造成實際問題,但語意上這個 effect 应该只在
  // 「掛載時」判斷一次,不該隨 handover 參照變動反覆觸發)。
  const skipDemoTriggeredRef = useRef(false)
  useEffect(() => {
    if (skipDemoTriggeredRef.current) return
    if (!shouldSkipDemo()) return
    skipDemoTriggeredRef.current = true
    handover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // handedOver——衍生值,不是獨立 state:純粹讓下方大量既有的「交接後
  // 要不要做某件事」判斷(JSX 渲染分支、地圖偏移 effect 等)不必逐一
  // 改寫成 `planSource.kind === 'live'`,維持原本的閱讀習慣。
  const handedOver = planSource.kind === 'live'

  // mapHandle——NativeMapBase 建圖完成後回報上來的控制代碼,見該元件
  // onHandleChange 的完整說明。usePlanStopMarkers 需要 mapRef/mapReady
  // 才能把站點 marker 掛到這個地圖實例上。
  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])

  // mapSafeArea——2026-10 新增(使用者構想:「底下是地圖層,上方是一層
  // UI 層,UI 層把各個元素都配置好,像地圖主顯示區就配出一個區塊,只是
  // 不用顯示,那自然就可以得知主顯示區的範圍」,見 useMapSafeArea.ts/
  // AIPlanTimelinePage.module.css .mapSafeArea 的完整說明)。取代原本
  // 「手算 timelineHeight / 2 再呼叫 panBy」的土法地圖視覺中心偏移
  // ——那套作法要自己推導 panBy 的方向語意、踩過一次方向寫反的實機
  // bug,且只能做「初始置中校正」這一件事,沒辦法判斷之後每次移動到
  // 特定地點時目標是否落在安全範圍內。
  //
  // panToWithinSafeArea 取代所有原本直接呼叫 mapHandle.mapRef.current.
  // panTo(target) 的地方(見下方 panToStopId/panToStop/
  // hasAutoPannedToFirstStopRef 的完整說明):目標點在 UI 層配置的
  // 安全區塊範圍內就用 panTo(維持平滑移動、zoom 不變的既有體驗),超出
  // 範圍才改用 fitBounds 確保目標點移動後真的落在可視範圍內(使用者
  // 明確要求「如果移動範圍在可視區就用 panTo,以外則用 fitBounds」)。
  const mapSafeArea = useMapSafeArea(mapHandle.mapRef)

  // selectedStopId/setSelectedStopId——改讀/寫 planSource(見該變數的
  // 完整說明),不再各自宣告 state——交接前這組方法呼叫的是
  // simulatedSource 包裝的 setSelectedStopId/setHoverStopId,交接後呼叫
  // 的是 liveSource 包裝的那組,planSource 本身已經指向正確的實例,呼叫
  // 端(下方 usePlanStopMarkers 呼叫處、JSX 裡 panToStop 等)不需要知道
  // 這個差異。
  //
  // 2026-10 移除右上角小地圖功能前,這個狀態同時也驅動小地圖 panTo+
  // 放大(見 panToStop),拿掉地圖後這裡純粹只剩「點了哪張卡片」的視覺
  // 回饋,不影響其餘行為。2026-10 地圖換成真實互動地圖(NativeMapBase)
  // 後,這個狀態重新驅動地圖圓點強調(見下方 usePlanStopMarkers 呼叫
  // 處),回到原本「選取會連動地圖」的語意,只是不做 pan/放大
  // (panToStop 維持不變,只設定這個狀態)。
  const { selectedStopId, hoverStopId, setSelectedStopId, setHoverStopId } = selection

  // mapMarkerPoints——把 planSource.stops(PlanStopMarker[])轉成
  // useMapMarkerLayer 要的 MapMarkerPoint[]。2026-10 改用共用元件取代
  // usePlanStopMarkers+useThemeRadiusCircle+這裡自己手寫的
  // expandedThemeId effect(原本三處各自維護一部分「主題點該不該展開」
  // 的判斷,現在整個收斂進 mapMarkerLayer/reducer.ts 的 applySelection,
  // 見該檔案完整說明)。
  //
  // kind——只有 simulated 來源的時間軸節點才可能帶 children(見
  // planTimeline.ts PlanNodeData.children 的完整說明;交接後的真實
  // 行程節點 liveSource.stops 本身就不帶這個概念,恆為 undefined,
  // 不需要像原本的 expandedThemeId effect 那樣額外用
  // planSource.kind !== 'simulated' 顯式防護,這裡的 kind 判斷已經
  // 完全由「這個節點實際有沒有 children」決定,行為等價)。
  //
  // stopsKey——同 useSimulatedStopsView 的 stopsKey 慣例,避免每次
  // render 都是新陣列參照讓下游 effect 誤判變動;這裡額外把 children
  // 內容也編進去(對齊 mapMarkerLayer/index.ts pointsKey 2026-10 修正
  // 的完整說明:children 非同步晚到也要能被偵測到)。
  // 2026-10(使用者明確要求交接前後「套用相同的元件跟地圖互動」):
  // children 現在由 PlanStopsView 的各自實作填好(見 PlanStopMarker.children
  // 的完整說明),這裡不再需要 `planSource.kind === 'simulated' ?
  // timelineRef.current.nodes.get(s.id) : undefined` 那個分支——那個寫法
  // 繞過介面直接讀 timeline,而且交接後恆為 undefined,主題點的展開能力
  // 在真實層整個消失。現在兩種來源產出同一種形狀,這裡只做一件事:
  // 有 children 就是主題點,沒有就是一般景點。
  const mapMarkerPointsKey = planSource.stops
    .map((s) => {
      const childrenKey = (s.children ?? []).map((c) => `${c.id}:${c.lat}:${c.lng}`).join(';')
      return `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}|${childrenKey}`
    })
    .join(',')
  const mapMarkerPoints = useMemo<MapMarkerPoint[]>(
    () =>
      planSource.stops.map((s) =>
        s.children && s.children.length > 0
          ? { id: s.id, lat: s.lat, lng: s.lng, name: s.name, kind: 'theme', children: s.children }
          : { id: s.id, lat: s.lat, lng: s.lng, name: s.name, kind: 'attraction' },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapMarkerPointsKey],
  )

  // useMapMarkerLayer——取代原本 usePlanStopMarkers+useThemeRadiusCircle
  // 兩次呼叫(見該共用元件 types.ts/index.ts 開頭的完整設計說明:完全
  // 受控,取代原本分散在這個元件跟兩個獨立 hook 之間、互相靠 effect
  // 同步的做法)。
  //
  // 2026-10 改版(無限重渲染迴圈修正):selectedStopId/hoverStopId 是
  // 唯一的事實來源,直接傳給 selectedId/hoverId——這個 hook 內部完全
  // 不會自己改變這兩個值,onSelectedChange 純粹是「使用者點了地圖上的
  // 點」這個意圖通知,接 setSelectedStopId 就是直接採納這個意圖當作
  // 新的選取,不會形成雙向同步環(見 mapMarkerLayer/types.ts 開頭對
  // 這次改版理由的完整說明)。
  //
  // autoPanOnSelect 刻意維持 false——這個頁面自己下方已經有
  // panToStopId(透過 useMapSafeArea.panToWithinSafeArea 移動地圖,
  // 見該處的完整說明)這套跟 mapMarkerLayer 完全無關的 pan 機制,不要
  // 同時啟用兩套 pan 邏輯重複觸發(見 mapMarkerLayer/types.ts
  // autoPanOnSelect 2026-10 補充的範圍邊界說明)。
  //
  // onPointClick 省略——原本 onStopClick 只做一件事:把點擊結果寫回
  // selectedStopId,這件事已經由 onSelectedChange 涵蓋,不需要額外監聽
  // onPointClick 重複處理同一個意圖。
  const mapMarkerLayer = useMapMarkerLayer({
    mapRef: mapHandle.mapRef,
    mapReady: mapHandle.mapReady,
    points: mapMarkerPoints,
    selectedId: selectedStopId,
    hoverId: hoverStopId,
    onSelectedChange: setSelectedStopId,
  })
  const expandedThemeId = mapMarkerLayer.expandedThemeId

  // expandedThemeNode——expandedThemeId 目前指向的完整時間軸節點,下方
  // panTo effect 查詢子景點座標時仍會用到(見該 effect 的完整說明)。
  const expandedThemeNode = expandedThemeId != null ? timelineRef.current.nodes.get(expandedThemeId) : undefined

  // panToStopId——2026-10(第三輪,使用者明確要求「選擇圖卡時不要移動
  // 地圖中心,標誌地點就好,另外做一個 icon,移動到該點」):原本是一個
  // 無條件跟著 selectedStopId 自動觸發的 useEffect(「選中卡片→地圖
  // 自動 panTo」),改成只在使用者明確點擊卡片上新增的「移動到此」
  // 按鈕時才呼叫的命令式函式——選取本身(selectedStopId 改變、地圖
  // marker 高亮)跟「要不要移動地圖視角」現在是兩個分開的動作,不再
  // 綁死在一起。保留原本查詢座標的邏輯(一般站點查 planSource.stops,
  // 查不到再查 expandedThemeNode.children,涵蓋子景點 id 的情況,理由
  // 同先前版本的完整說明),只是觸發時機從「selectedStopId 改變」
  // 換成「呼叫這個函式」。只在手機版+模擬中有意義(桌面版縱向側欄/
  // 交接後版面語意不同,理由同上方 mapSafeArea 的完整說明),呼叫端
  // (HorizontalPlanTimeline.tsx 卡片上的按鈕)只在這個情境下會渲染
  // 這顆按鈕,這裡的 isDesktop/handedOver 判斷是雙重保險,不是唯一
  // 防線。
  //
  // 2026-10(第四輪):改呼叫 mapSafeArea.panToWithinSafeArea 取代原本
  // 直接呼叫 mapRef.current.panTo——見 mapSafeArea 的完整說明,會先
  // 判斷目標是否落在 UI 層配置的安全區塊內,再決定 panTo 或 fitBounds。
  const panToStopId = useCallback(
    (stopId: string) => {
      if (isDesktop || handedOver) return
      if (!mapHandle.mapReady || !mapHandle.mapRef.current) return
      const stop = planSource.stops.find((s) => s.id === stopId)
      const target = stop
        ? { lat: stop.lat, lng: stop.lng }
        : (() => {
            const child = expandedThemeNode?.children?.find((c) => c.id === stopId)
            return child && child.lat != null && child.lng != null ? { lat: child.lat, lng: child.lng } : null
          })()
      if (!target) return
      mapSafeArea.panToWithinSafeArea(target)
    },
    // mapSafeArea.panToWithinSafeArea 本身是 useMapSafeArea 內部
    // useCallback 包過的穩定參照(依賴只有 mapRef),但 useMapSafeArea()
    // 每次呼叫回傳的外層物件 { safeAreaElRef, panToWithinSafeArea }
    // 都是新的物件 literal——依賴陣列放整個 mapSafeArea 會讓這個
    // useCallback 每次 render 都判定「依賴變了」而重新建立,直接放
    // 真正穩定的那個函式本身即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesktop, handedOver, mapHandle.mapReady, mapHandle.mapRef, planSource.stops, expandedThemeNode, mapSafeArea.panToWithinSafeArea],
  )

  // hasAutoPannedToFirstStopRef——2026-10 使用者明確要求「只有第一個
  // 點出現時要移動到該點」:行程第一站被插入時(不管那一刻它是否剛好
  // 是 selectedStopId),自動 panTo 一次,讓使用者一開始就能看到行程
  // 起點對應的地圖位置——之後新增的站點、或選取其他已存在的站點,
  // 都改成使用者自己按卡片上的「移動到此」按鈕(見 panToStopId 的完整
  // 說明),不再自動觸發。這個 ref 記錄「有沒有已經自動 panTo 過第一
  // 站」,只在還沒有的情況下、且這一刻 planSource.stops 真的有內容時
  // 才觸發一次,之後恆為 true,不受任何後續的 stops 變動影響——跟
  // useSimulatedStopsView.ts latestInsertedStopIdRef 那種「只同步
  // 一次,不要每次變動都搶回」的既有設計原則一致(見該處的完整說明)。
  //
  // 2026-10(第五輪,使用者明確要求「桌面版第一個點要出現在安全區
  // 中心」):不透過 panToStopId(那個函式內部 `isDesktop ||
  // handedOver` 就直接 return,見該函式的完整說明:它只服務手機版
  // 卡片上「移動到此」這顆按鈕,原本連同這個初始置中一起被擋掉,是因為
  // 當初桌面疊加版面(PlanOverlayPanel)從未渲染過安全區元素,
  // mapSafeArea.safeAreaElRef 在桌面恆為 null,呼叫了也只會退化成
  // 普通 panTo,索性整個排除)。isWide 模式(見 PlanOverlayPanelWide
  // 的完整說明)現在會接上一塊排除右側側欄範圍的矩形,桌面寬螢幕下
  // panToWithinSafeArea 已經具備正確運作的前提——這裡改成直接呼叫它,
  // 不經過 panToStopId 的 isDesktop 排除,讓桌面 wide 版也享有「移動
  // 完成後落在安全區中心」的效果,同時完全不影響 panToStopId 本身
  // (手機版「移動到此」按鈕的既有行為不變)。非 wide 的桌面疊加版面
  // (768px~1023px)跟手機版/交接後維持原行為不受影響——safeAreaEl 為
  // null 時 panToWithinSafeArea 本身就會退化成普通 panTo(見該函式的
  // 完整說明),不會出錯,只是沒有「排除側欄」的效果。
  //
  // 2026-10(code review 發現、修正第二輪):上一版的 guard 只寫
  // `if (handedOver) return`,把非 wide 的桌面疊加版面(768px~1023px,
  // isDesktop 為 true、isWide 為 false)漏掉了——這個版面區間過去是
  // 透過 panToStopId 的 `isDesktop || handedOver` 整個排除掉的,從未
  // 自動 panTo 過;這裡少了 `isDesktop && !isWide` 這個條件,會讓這個
  // 區間意外開始觸發一次 panTo(雖然 safeAreaEl 是 null、退化成普通
  // panTo,不會出錯,但仍是一個新出現的、未經設計確認的鏡頭移動),
  // 跟上面註解宣稱的「語意上維持跟改動前一致」矛盾。補回這個排除條件,
  // 讓這個版面區間真正維持原行為不受影響。
  //
  // 同一輪 review 也發現這裡拿掉了 panToStopId 原有的
  // `!mapHandle.mapReady || !mapHandle.mapRef.current` 明確就緒檢查,
  // 只靠 panToWithinSafeArea 內部對 map/projection/zoom/center 的 null
  // 檢查頂著——這個 effect 是一次性 ref-latch(hasAutoPannedToFirstStopRef
  // 一旦設成 true 就不會再重試),若剛好撞上 mapRef.current 已經非
  // null、但 mapReady 還沒真正翻成 true 的時間窗口(NativeMapBase.tsx
  // 描述過這個 React 雙重 commit 的邊界情況),這次呼叫就會在地圖還沒
  // 完全初始化好時發生,且永遠不會補一次。補回明確的就緒檢查,等到
  // mapReady 真正翻成 true 才消費這個一次性 ref。
  const hasAutoPannedToFirstStopRef = useRef(false)
  useEffect(() => {
    if (hasAutoPannedToFirstStopRef.current) return
    if (planSource.stops.length === 0) return
    if (handedOver) return
    if (isDesktop && !isWide) return
    if (!mapHandle.mapReady || !mapHandle.mapRef.current) return
    hasAutoPannedToFirstStopRef.current = true
    const first = planSource.stops[0]
    mapSafeArea.panToWithinSafeArea({ lat: first.lat, lng: first.lng })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSource.stops, handedOver, isDesktop, isWide, mapHandle.mapReady, mapHandle.mapRef, mapSafeArea.panToWithinSafeArea])

  // composerCollapsed——排程結束後,漂浮輸入膠囊(.composer)裡原本的
  // 箭頭送出鈕(.sendBtn)切換成「讓我試看看」行動呼籲按鈕(.composerCta)。
  // 使用者原本要求「排程結束後,輸入匡做一個動畫轉場……縮成一顆
  // 按鈕」,試做後改要求「保留膠囊輸入外框,送出按鈕部分轉變為立即
  // 使用按鈕」——膠囊外框本身固定維持完整寬度,不再整體收縮,只有
  // .inputRow 裡送出鈕這個位置的按鈕內容改變(同一個 DOM 位置,見下方
  // JSX 依 composerCollapsed 切換渲染哪一顆按鈕)。
  //
  // 觸發時機是 isGenerating 從 true 翻成 false(劇本收到 done)那一刻,
  // 用 wasGeneratingRef 記住上一次的值來辨識這個「下降邊」——isGenerating
  // 初始值就是 false(打字動畫還沒播完、劇本尚未開始),不能單看「目前
  // 是 false」就切換,否則一進頁面就已經顯示「讓我試看看」。這個頁面固定
  // 只播放一次、不能重播,所以這個切換只會發生一次。
  //
  // 2026-10 改成「排到第 CTA_AFTER_STOPS 站就切換」,不再等整段劇本播完
  // (使用者明確要求「播放到第 5 個景點就加入按鈕」)——整段腳本有 14
  // 站、跑完要好幾十秒,而使用者通常看個幾站就知道這個功能在做什麼,
  // 把行動呼籲壓在最後等於讓最有意願的那批人也得枯等。第 5 站時已經
  // 排出完整的上午行程,足夠展示「AI 真的會連續安排」。
  //
  // 原本的「isGenerating 下降邊」條件保留當後備:腳本日後若改短到不足
  // 5 站,播完仍然會顯示按鈕,不會變成永遠不出現。
  //
  // 只進不退(setComposerCollapsed(true) 重複寫入同值不觸發重渲染):
  // 切換之後後續站點繼續插入時,按鈕不該閃回箭頭送出鈕。
  // userPrompt——交接之後使用者自己打的內容。跟 typedPrompt(假打字
  // 動畫的進度)是兩個獨立的 state:後者是展示用的、唯讀,前者才是
  // 真的使用者輸入。
  const [userPrompt, setUserPrompt] = useState('')

  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (stopCount >= CTA_AFTER_STOPS) setComposerCollapsed(true)
    else if (wasGeneratingRef.current && !isGenerating) setComposerCollapsed(true)
    wasGeneratingRef.current = isGenerating
  }, [isGenerating, stopCount])

  // mountedIdsRef——追蹤「已經播過進場動畫的節點 id」,用來正確判斷
  // 下方渲染迴圈裡的 justMounted。原本 justMounted 是用
  // `idx === steps.length - 1`(是不是陣列最後一個元素)判斷,這在
  // steps 只會 append 到尾端時沒問題,但「插入到中間」的節點(見
  // PlanAction.afterId/planActionToInsert 的完整說明——例如測試按鈕
  // insert_anping_mazu 插在 note-1 之後,不是陣列最後一個)永遠不會是
  // 最後一個元素,導致完全沒有進場動畫(cardSlide/thumbPop/pillExpand/
  // anchorPop/noteFade 全部沒套上),這是實際發生過的 bug——使用者要求
  // 「子代理處理插入時,要跟新增有一樣的動畫效果」。改成用這個 ref 記錄
  // 每個 id 是否已經出現過:第一次出現時判定為 justMounted(不論它在
  // 陣列中的位置是不是最後一個),渲染完當下就把 id 記進 ref,之後即使
  // steps 陣列因為其他節點增減而重新渲染,這個 id 也不會被誤判為又一次
  // 新掛載。用 ref 而非 state,是因為這個記錄本身不需要觸發重渲染——它
  // 只是渲染過程中順手更新的旁路狀態(理由同其餘 xxxRef 用法)。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // 這個頁面固定進頁就自動播放一次固定劇本到底,不需要測試按鈕手動
  // 觸發移除/插入額外訊息(原始版本的 removeWumiao/insertAnpingMazu 與
  // 對應 UI 已一併移除,見 usePlanSimSocket 的完整說明)。

  // lightboxPhotos——比照正式頁 TripPlanPage.tsx 的多圖瀏覽機制(見
  // PlanTimelineView.tsx 的完整說明),改用該共用元件後這個 state 一併
  // 需要。模擬腳本(planSimFakeSource.ts)目前沒有任何節點帶
  // googlePhotoUrls,縮圖實際上不會出現多圖按鈕、onOpenPhotos 也就不會
  // 被觸發,但 PlanTimelineView 的 props 介面要求提供這個 callback,故
  // 仍需要這個 state 讓介面完整,不是只為了展示頁去改共用元件的介面。
  const [lightboxPhotos, setLightboxPhotos] = useState<{ photos: string[]; alt: string } | null>(null)

  const panToStop = useCallback((step: PlanStep) => {
    if (step.lat == null || step.lng == null) return
    setSelectedStopId(step.id)
  }, [setSelectedStopId])

  // scrollToLatest — 直接捲到最底。.scroll 底部已留 128px 給漂浮膠囊,
  // 捲到底時最新的節點/呼吸點會停在膠囊上方,不會卡在視窗邊緣。原本
  // 「目標節點頂端距視窗底 160px」的算法,在捲到底時比真正的底部高約
  // 140px,使用者捲到底會被拉回去。等兩幀再捲,確保剛掛載的節點已經
  // 完成排版、scrollHeight 已更新。
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = scrollRef.current
        if (!scroller) return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      })
    })
  }, [])

  // 在 steps 改變、或 isGenerating 改變時都要重新跟隨——不把跟隨狀態
  // (followingRef)放進依賴,否則使用者手動捲到底、跟隨狀態從 false
  // 翻成 true 的那一刻,這個 effect 也會被觸發去捲動。
  //
  // 2026-10 補上 isGenerating 依賴(使用者截圖回報「讓我試看看」按鈕
  // 展開那一刻,composer 直接疊在時間軸中段內容上,不是停在底部)——
  // 根因:固定劇本播完觸發的「done」事件只翻轉 isGenerating(true→
  // false),不一定伴隨新的 steps 更新;而 isGenerating 翻 false 的
  // 瞬間,PlanTimelineView 會整段拿掉呼吸點+骨架卡(見該元件
  // isThinking 的渲染邏輯),讓 .timelineScroll 的內容高度瞬間變矮。
  // 這個 effect 原本只監聽 steps,沒有偵測到這次「內容變矮但沒有新
  // 節點」的變化,畫面因此停在生成途中最後一次捲動的位置,沒有跟著
  // 內容收斂重新捲到底——composer 本身固定貼在 .page 底部 20px(見
  // .composer 的完整說明),內容沒捲到底時,它就疊在當下停留位置的
  // 中段內容上。正式頁 TripPlanPage.tsx 的 planAiChat.isThinking 由
  // 真實 onagent 對話驅動,isThinking 翻 false 的時機點通常剛好伴隨
  // 一次 steps 更新(例如最後一句 agent 訊息寫入時間軸),兩者同時
  // 發生掩蓋了這個問題,但邏輯上同樣的風險存在,一併補上這個依賴。
  useEffect(() => {
    if (!followingRef.current) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, isGenerating, scrollToLatest])

  // 只有「使用者往上捲、且離底部超過 80px」才退出跟隨。程式觸發的平滑
  // 捲動(往下)與新節點撐高內容(scrollTop 不變)都不會讓它誤判成離開。
  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const { scrollTop, scrollHeight, clientHeight } = scroller
    const distFromBottom = scrollHeight - scrollTop - clientHeight
    const scrolledUp = scrollTop < lastScrollTopRef.current
    lastScrollTopRef.current = scrollTop
    let nowFollowing = followingRef.current
    if (distFromBottom < 80) nowFollowing = true
    else if (scrolledUp) nowFollowing = false
    if (nowFollowing === followingRef.current) return
    followingRef.current = nowFollowing
    setShowJumpPill(!nowFollowing && isGenerating)
  }, [isGenerating])

  const jumpToLatest = useCallback(() => {
    followingRef.current = true
    setShowJumpPill(false)
    scrollToLatest()
  }, [scrollToLatest])

  // emptyStateMessage——2026-09:漂浮膠囊(.composer,見該 class 的完整
  // 說明)只留 input 本身,不再常駐顯示一行狀態提示文字。原本「生成中/
  // 已安排 N 站/想去哪裡玩」三種文案裡,只有「時間軸完全空白」這一句
  // 使用者明確要求改放進主顯示區(.scroll/.inner)當空狀態引導文字。
  // 2026-10:使用者進一步要求「移除還沒開始對話的空畫面」,改用
  // PlanTimelineView 的 hideEmptyState prop 整段隱藏這塊區域(見該
  // prop 的完整說明)——PlanTimelineViewProps.emptyStateMessage 目前
  // 仍是必填 string(共用元件型別未變,/app 正式頁仍然需要這個文案),
  // 傳一個空字串滿足型別即可,反正 hideEmptyState 為 true 時這段文字
  // 根本不會被渲染,不需要保留原本那句引導文案的字串常數。
  const emptyStateMessage = ''

  // app-theme-root:base-ui.css 的深色模式規則掛在這個全域 class 上
  // (.app-theme-root:not([data-theme="light"]) 搭配
  // prefers-color-scheme、.app-theme-root[data-theme="dark"]),見
  // App.tsx 的 /app 路由同樣疊加這個 class。少了它,無論系統偏好或
  // data-theme 屬性值是什麼,這個頁面都只會顯示淺色 token。
  // navButtons——上方漂浮按鈕列插槽內容(見原本「上方漂浮按鈕」的完整
  // 說明,邏輯不變,只是現在當成 PlanDemoLayout 的 nav 插槽傳入,而不是
  // 直接寫在這個元件的根容器 JSX 裡)。SiteNavBrand 等元件本身是 fixed
  // 定位,放進哪個 DOM 位置不影響視覺,純粹是程式碼組織上收進插槽。
  // 2026-10 使用者明確要求「展示頁面不要功能介紹按鈕」——移除原本的
  // 「功能介紹」CTA(連到 /product),只留登入。
  const navButtons = (
    <>
    <SiteNavBrand pageLabel="台南兩日遊" />
    <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
    <SiteNavCta href="/app" onClick={() => trackEvent('landing_cta_click', { page: 'plan-ai-sim', position: 'nav' })}>登入</SiteNavCta>
    </>
  )

  // mapBackground——地圖背景插槽內容(見原本「NativeMapBase」區塊的
  // 完整說明,邏輯不變)。
  const mapBackground = (
    <>
      <NativeMapBase
        center={CENTER}
        zoom={ZOOM}
        mapId={LANDING_MAP_ID}
        onHandleChange={handleMapHandleChange}
      />
      {/* wide 模式的安全區——使用者明確指出「安全區是左側剩餘空間」:
          地圖容器本身仍是 absolute 鋪滿整個 .page(使用者明確要求「地圖
          一樣要滿版」,見 PlanDemoLayout.module.css .mapBackdrop 的完整
          說明),側欄(PlanOverlayPanelWide 的 .panel)疊加貼在右側,寬度
          固定 560px(跟 PlanOverlayPanel 桌面版同一個數字,見該檔案
          .panel 的完整說明)。這個看不見的 div right 留出那 560px、
          左側其餘部分才是「沒被側欄蓋住」的安全可視區,接上跟手機版
          同一個 mapSafeArea.safeAreaElRef——useMapSafeArea 的計算邏輯
          本來就只依賴這個 ref 指向的元素範圍,不關心是哪種版面產生的,
          這裡接一塊排除右側側欄範圍的矩形上去,算出來的安全區自然就是
          左側剩餘空間,跟手機版用同一套 solveSafeAreaCenter 不需要改。
          手機版的安全區元素在 PlanOverlayPanel.tsx 的 .safeArea(只在
          isDesktop=false 時渲染),跟這裡互斥:wide 必然是桌面版面,
          兩者不會同時掛載,不會有同一個 ref 被兩處元素搶著賦值的問題。

          top: 72(2026-10,使用者明確指出「有跟地圖安全區還有側欄重疊
          嗎」後查出的真實 bug):漂浮導覽列(SiteNavButtons,position:
          fixed)橫跨整個頁面頂部,頁面頂部 72px 這段範圍實際上被它佔用
          (跟 PlanOverlayPanelWide.module.css .panel 的 top: 72px 同一個
          數字,見該 class 的完整說明),之前這裡維持 top: 0,導致安全區
          矩形把那段被導覽列佔用的範圍也算進「可視安全區」——地圖平移
          計算出的目標點可能落在導覽列底下被蓋住的位置,使用者看起來
          像是地圖沒有真的移到該去的地方。改成 top: 72 後,安全區矩形
          才真正等於「扣掉導覽列、扣掉右側側欄之後剩下的可視範圍」。

          bottom: COMPOSER_BAND_HEIGHT(2026-10,使用者明確要求「composer
          區也要一整列」「也是不要重疊」):同樣的道理套用在底部——
          composer 插槽(PlanOverlayPanelWide.module.css .composerSlot)
          貼底置中,COMPOSER_BOTTOM + COMPOSER_HEIGHT(實機量測得到的
          66px,不是 CSS 寫死的值,因為 .composerSlot 本身沒有設 height,
          見 planOverlayGeometry.ts 的完整說明)合計這條底部範圍實際上
          是給 composer 保留的。

          2026-10(code review 發現):top/right/bottom 這三個數字原本
          各自寫死在這裡(72/560/86),跟 WideLayoutDebugOverlay.tsx 的
          除錯框線各自一份、互相手動對照,這份重複已經在同一輪改動裡
          造成過兩次真實漂移(SIDEBAR_TOP 漏改一次、bottom 的計算基準
          跟除錯框線不同步)。改成從 planOverlayGeometry.ts 匯入同一份
          常數,這兩個消費者不會再各自算出不一致的數字;CSS Module
          (PlanOverlayPanelWide.module.css 的 .panel)仍然要手動對照這份
          數值,見該模組開頭的完整說明。 */}
      {isWide && (
        <div
          ref={mapSafeArea.safeAreaElRef}
          // pointer-events: none——純粹的量測用矩形,不是真實可見的 UI
          // 元素(對齊 PlanOverlayPanel.module.css .safeArea 的既有寫法:
          // 同樣是 position absolute + pointer-events none)。漏掉這個
          // 屬性的後果是這塊矩形疊在地圖上方攔截所有滑鼠事件,地圖完全
          // 拖不動(實機回報過的真實 bug,不是臆測的風險)。
          style={{ position: 'absolute', top: SIDEBAR_TOP, left: 0, bottom: COMPOSER_BAND_HEIGHT, right: SIDEBAR_WIDTH, pointerEvents: 'none' }}
          aria-hidden="true"
        />
      )}
      {DEBUG_SAFE_AREA && (
        <Suspense fallback={null}>
          <SafeAreaDebugOverlay
            target={DEBUG_TARGET}
            safeAreaElRef={mapSafeArea.safeAreaElRef}
            mapRef={mapHandle.mapRef}
            mapReady={mapHandle.mapReady}
            onPan={mapSafeArea.panToWithinSafeArea}
            resetView={{ center: CENTER, zoom: ZOOM }}
          />
        </Suspense>
      )}
    </>
  )

  // wideDebugOverlay——跟 mapBackground 分開組裝,不塞進那個插槽裡:
  // 見 PlanDemoLayout.tsx debugOverlay prop 的完整說明——mapBackground
  // 最終被包進 .mapBackdrop(z-index: 0),composer 插槽是 z-index: 20,
  // 兩者是 .page 的手足,子層級的 z-index 再高也蓋不過父層級已經輸掉的
  // 比較結果,標示 composer 範圍的疊圖必須跟 composer 插槽同層級。
  // 只在 wide 模式下才有側欄/composer 插槽可標示,isDesktop 的桌面疊加
  // 版面(PlanOverlayPanel)跟手機版都不渲染這個疊圖。
  const wideDebugOverlay = DEBUG_SAFE_AREA && isWide ? (
    <Suspense fallback={null}>
      <WideLayoutDebugOverlay />
    </Suspense>
  ) : undefined

  return (
    <>
    {/* PlanDemoLayout——版面骨架(根容器+地圖背景+上方 nav+既有的
        PlanOverlayPanel),見該元件開頭的完整設計理由。時間軸層的二選一
        (模擬 vs 真實 AI,見下方 handedOver 判斷的完整說明)決定要傳哪組
        passThrough/composer/children,layout 本身不關心這個決策。 */}
    {handedOver ? (
      <PlanDemoLayout
        embedded={embedded}
        theme={theme}
        mapBackground={mapBackground}
        nav={navButtons}
        wide={isWide}
        debugOverlay={wideDebugOverlay}
        isDesktop={isDesktop}
        safeAreaRef={mapSafeArea.safeAreaElRef}
        passThrough
      >
        <LivePlanLayer
          onStopsChange={handleLiveStopsChange}
          onSelectedStopChange={setLiveSelectedStopId}
          onHoverStopChange={setLiveHoverStopId}
        />
      </PlanDemoLayout>
    ) : (
      <PlanDemoLayout
        embedded={embedded}
        theme={theme}
        mapBackground={mapBackground}
        nav={navButtons}
        wide={isWide}
        debugOverlay={wideDebugOverlay}
        isDesktop={isDesktop}
        safeAreaRef={mapSafeArea.safeAreaElRef}
        composer={(
          // Composer——共用輸入膠囊外框(components/Composer.tsx,見該檔頭
          // 的完整背景說明)。這個展示頁的特有邏輯(假打字動畫唯讀、
          // composerCollapsed 後整個切換成「讓我試看看」CTA)留在這裡
          // 透過 props 組裝,共用元件不知道這些概念。
          //
          // presentational——2026-10 使用者明確要求:「composer 應該用
          // 一個展示態來表達,而不是單純關閉送出,展示態的時候送出樣式
          // 要正常,但是不能點送出」(見 Composer.tsx 該 prop 的完整
          // 說明)。這個展示頁從「打字動畫進行中」到「排完一站都還沒到
          // 第 5 站」整段期間,送出鈕全程都是這個狀態——輸入框是純展示
          // 用的假打字動畫(見 typedPrompt 的完整說明),不接受真的輸入、
          // 不會真的送出任何請求,但視覺上應該完全像一個「正常、能用」
          // 的輸入框,不該讓訪客一眼看出「這是灰掉的假東西」。取代先前
          // 「預設 disabled 淡化,打字中那一刻另外疊加 sendBtnActive
          // 抵銷淡化樣式」的拼湊寫法——那個寫法只覆蓋了「打字中」這一
          // 個特例,排完第一站後到第 5 站之前這段期間其實仍然是淡化的,
          // 跟「送出鈕全程該是正常樣式」的真正意圖不符,改用
          // presentational 後不再需要特例判斷,整段期間自然一致。
          //
          // 2026-10(第三輪):「讓我試看看」出現時(composerCollapsed 且
          // 尚未 handedOver)輸入框整個從 DOM 移除、按鈕置中顯示(使用者
          // 明確要求「按鈕置中,移除輸入匡」)——取代先前「輸入框收合
          // 讓位、按鈕展開動畫」的版本(見 .module.css .composerCta 的
          // 完整說明:那一版同一顆 <button> 疊加 class 做 width
          // transition,這版輸入框是條件渲染、不是 class 切換,沒有連續
          // 的寬度狀態可以 transition,改用 opacity 淡入)。交接後
          // (handedOver)輸入框恢復渲染、開放輸入,不再是 presentational
          // ——這時是正式功能,真的要能送出。
          <Composer
            bare={composerCollapsed && !handedOver}
            hideInput={composerCollapsed && !handedOver}
            inputRowClassName={styles.inputRow}
            ariaLabel={handedOver ? '描述你想要的行程' : '輸入指令(僅供展示)'}
            placeholder={handedOver ? '想去哪裡玩?例如:台南兩天一夜' : undefined}
            value={handedOver ? userPrompt : typedPrompt}
            onChange={handedOver ? setUserPrompt : undefined}
            readOnly={!handedOver}
            presentational={!handedOver && !composerCollapsed}
            // composerCta——排程結束後出現的行動呼籲按鈕,文案「讓我試
            // 看看」(2026-10 從「立即使用」改,使用者明確要求),點擊要
            // 導向登入頁面(/app,對齊首頁 SiteNavCta 的「登入」按鈕同樣
            // 指向 /app——未登入時 /app 本身就會顯示登入畫面,見
            // PhoneContent.tsx 的既有行為,不需要另外一個獨立的 /login
            // 路由)。仍是同一顆送出鈕(進行中是箭頭 icon,結束後疊上
            // .composerCta 變成文字按鈕)——這顆按鈕本身的身分沒有變,
            // 只有旁邊的輸入框從「收合」改成「整個移除」(見上方完整
            // 說明)。排到第 5 站前透過 presentational 擋下 onSubmit,
            // 不需要額外判斷 composerCollapsed 才能呼叫 navigate——
            // onSubmit 只有在不是 presentational 時才會真的被呼叫。
            onSubmit={handover}
            sendButtonAriaLabel={composerCollapsed ? '讓我試看看' : '送出'}
            sendButtonClassName={composerCollapsed ? styles.composerCta : ''}
            sendButton={composerCollapsed ? '讓我試看看' : undefined}
          />
        )}
      >
      {isDesktop ? (
      /* 桌面版的詢問頁(2026-10 使用者明確要求「桌面版的要顯示 ask
         page」):劇本播到 open_ask_page 時取代縱向時間軸,跟手機版
         「顯示 AskPage 時取代卡片列」是同一種處理(見
         HorizontalPlanTimeline.tsx showAskPage 分支)。
         在這之前桌面版完全沒有渲染 AskPage,而劇本第一則就是
         open_ask_page——planSimFakeSource 等著使用者選擇,畫面上卻沒有
         任何可以點的東西,整段劇本停在第 0 步(實機確認:桌面版時間軸
         全空、一張卡片都沒有)。
         dataSource 用假資料實作,理由同下方手機版分支的完整說明。

         2026-10 改成置換 ScriptedAskPage(使用者明確定調「播放態不會有
         真實互動」、「所以是要做在被置換的原件上,與正式使用的不一樣」):
         這一頁是播放態,渲染的是播放態專用那一份(見 ScriptedAskPage.tsx
         檔頭的完整說明:劇本指定選哪幾張、依序演出點擊特效、時間到自己
         送出),不是正式的 AskPage。正式那一份完全沒有為了展示而加的
         分支,它只服務真實互動。
         兩者的 onDone 形狀一致,所以在這裡是直接互換,呼叫端其餘程式碼
         不需要知道換了哪一份。 */
      showAskPage ? (
      renderScriptedAskPage()
      ) : (
      <PlanTimelineView
        // onRetryStop——見上方 retryStopLookup 的完整說明:標了 failed
        // 就要給得出脫離的路。
        onRetryStop={retryStopLookup}
        steps={steps}
        isThinking={isGenerating}
        emptyStateMessage={emptyStateMessage}
        hideEmptyState
        endMarkerMessage="行程結束"
        selectedStopId={selectedStopId}
        // onHoverStop——卡片 hover/移出時更新 hoverStopId,讓地圖圓點能
        // 跟著 hover 強調(見上方 hoverStopId state 的完整說明)。
        onHoverStop={setHoverStopId}
        showJumpPill={showJumpPill}
        onJumpToLatest={jumpToLatest}
        onPanToStop={panToStop}
        // getStopTimeDragBounds/onDragStopTime——見 dragStopTime 的完整
        // 說明。這兩個 prop 同時存在才會啟用拖拉手勢(見
        // PlanTimelineView.tsx handlePointerDown 開頭的判斷)。
        // TIME_DRAG_ENABLED——feature flag(見 DesktopShared.tsx 同名
        // 常數的完整說明),關閉時兩個 prop 都不傳。
        getStopTimeDragBounds={TIME_DRAG_ENABLED ? (stopId) => getTimeDragBounds(timelineRef.current, stopId) : undefined}
        onDragStopTime={TIME_DRAG_ENABLED ? dragStopTime : undefined}
        onOpenPhotos={setLightboxPhotos}
        mountedIdsRef={mountedIdsRef}
        scrollRef={scrollRef}
        onScroll={handleScroll}
        scrollClassName={styles.timelineScroll}
        jumpPillWrapClassName={styles.timelineJumpPillWrap}
        endMarkerClassName={styles.timelineEndMarker}
      />
      )
      ) : (
      // 手機版(模擬中)——改用橫向卡片時間軸(方案二設計稿的落地,見
      // HorizontalPlanTimeline.tsx 檔頭的完整說明),取代縱向
      // PlanTimelineView。onSelectStop 同時寫入 selectedStopId 跟
      // hoverStopId(而不是只設 selectedStopId)——這兩個 state 一起餵給
      // 上方 useMapMarkerLayer(見該處呼叫的完整說明),地圖圓點的
      // 「選取」樣式實際上同時看這兩個值的其中之一命中(見 mapMarkers.ts/
      // PlanStopMarkerState 的既有邏輯),縱向版本原本是「點擊卡片→
      // selectedStopId」「hover 卡片→hoverStopId」各自觸發,手機版橫向
      // 卡片沒有滑鼠 hover 這件事,只有「捲到/點到哪一站」這一種事件。
      // mapMarkerLayer/mapMarkers.ts 的三態邏輯是 selected 優先於
      // hover(見 PlanStopMarkerState 的完整說明:兩者同時命中同一個 id
      // 時最終呈現 'selected'),只設 selectedStopId 其實已經足夠讓地圖
      // 圓點呈現「選取」高亮;這裡連同 hoverStopId 一併更新純粹是為了
      // 不留下舊的 hoverStopId 殘留(例如使用者先前在桌面寬度下 hover
      // 過某一站、之後縮小視窗切換成手機版橫向卡片,殘留的 hoverStopId
      // 理論上不該發生但避免有這種邊界情況殘留失準的圓點狀態)。
      // focusLatest(2026-10 修正,使用者實機回報「自動播放時第二個
      // 景點後沒有自動往下一個滑動」):這個 prop 名稱雖然原本是為了
      // 「第一張卡滿版、後面壓縮堆疊」這組視覺效果設計的,但那組卡片
      // 寬度縮放邏輯後來已經被取代(見 HorizontalPlanTimeline.tsx
      // isSingleCard 的完整說明:目前只有「只剩一張卡」這個寬度例外,
      // 其餘卡片一律固定寬度,焦點改用捲動位置表達,不是寬度差異)——
      // focusLatest 現在的唯一實際作用,只剩下開關「骨架轉正式卡時
      // 自動捲動到最新站點」這個自動捲動 effect(見該檔案
      // justFinishedGenerating 的完整說明),不會再帶來任何卡片縮放的
      // 副作用。原本這裡沒有傳這個 prop,套用元件預設值 false,整個
      // 自動捲動 effect 的第一行 `if (!focusLatest) return` 直接讓
      // 自動捲動在這個完整展示頁上完全不會啟動——不是只影響第二站
      // 以後,是從第一站就沒有自動捲動,只是使用者在只有一張卡時不易
      // 察覺,到第二站需要真正捲動才會注意到。改成跟首頁 demo
      // (AiPlanPhoneDemoScreen.tsx)一致,啟用自動捲動到最新完成站點。
      <>
      <HorizontalPlanTimeline
        // showAskPage/askPageInput/onAskPageDone/dataSource——見
        // 上方 state 宣告處的完整說明。dataSource 用假資料實作(預設值
        // planAiFakeDataSource,這裡顯式傳入對齊 usePlanSimSocket 呼叫處
        // 的同一份實例,理由同該處說明:這個展示頁不需要登入就能看,
        // 不能打需要登入的後端端點)。
        showAskPage={showAskPage}
        askPageInput={askPageInput}
        onAskPageDone={handleAskPageDone}
        dataSource={planAiFakeDataSource}
        // renderAskPage——置換成播放態專用那一份(見
        // HorizontalPlanTimeline.tsx 該 prop 與 ScriptedAskPage.tsx 檔頭
        // 的完整說明)。桌面分支也是同一份,兩種版面一致。
        renderAskPage={renderScriptedAskPage}
        onRetryStop={retryStopLookup}
        steps={steps}
        selectedStopId={selectedStopId}
        focusLatest
        onSelectStop={(stopId) => {
          setSelectedStopId(stopId)
          setHoverStopId(stopId)
        }}
        // onSelectThemeChild——2026-10 新增(見 HorizontalPlanTimeline.tsx
        // 該 prop 的完整說明)。只設定 selectedStopId(選中主題卡本身,
        // 連帶觸發 expandedThemeId 的 effect 展開範圍圓圈+子景點小點,見
        // 該 effect 的完整說明)。
        //
        // 2026-10(第二輪,使用者明確要求「手機板觸發地圖中心移動跟標示
        // 目標點都要用捲動中心點觸發,不要用點選觸發」):不再呼叫
        // setHoverStopId(child.id)——地圖 panTo 的 effect 已經改成只讀
        // selectedStopId(見該 effect 的完整說明),hoverStopId 不再驅動
        // 任何地圖行為,這裡設定它只會是沒有視覺效果的殘留狀態,拿掉。
        onSelectThemeChild={(parentId) => {
          setSelectedStopId(parentId)
        }}
        // onOpenPhotos——跟桌面版 PlanTimelineView 共用同一個 Lightbox
        // 覆蓋層(見上方 lightboxPhotos state 的完整說明),兩個時間軸
        // 元件都只負責「觸發開啟」,實際渲染/關閉邏輯統一收在這個頁面
        // 層級,不重複實作。
        onOpenPhotos={setLightboxPhotos}
        isGenerating={isGenerating}
        // onPanToStop——2026-10 新增(使用者明確要求「選擇圖卡時不要
        // 移動地圖中心,標誌地點就好,另外做一個 icon,移動到該點」):
        // 卡片角落新增的「移動到此」按鈕觸發,見 panToStopId 的完整
        // 說明。選填 prop,省略時卡片不會渲染這顆按鈕(對齊
        // onRemoveStop/onTransitModeChange 等既有選填 prop 的慣例)。
        onPanToStop={panToStopId}
      />
      </>
      )}
      </PlanDemoLayout>
    )}
    {lightboxPhotos && (
      <Lightbox
        photos={lightboxPhotos.photos}
        alt={lightboxPhotos.alt}
        onClose={() => setLightboxPhotos(null)}
      />
    )}
    </>
  )
}
