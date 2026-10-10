import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIME_DRAG_ENABLED } from '../../DesktopShared'
import { useThemeToggle } from '../../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../SiteNavButtons'
import { useSyncedState } from '../../hooks/useSyncedState'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { createPlanSimFakeSource } from './planSimFakeSource'
import { PlanTimelineView } from '../../plan-core/PlanTimelineView'
import { Lightbox } from '../../geo-planning/PhotoCarousel'
// planTimeline.ts——共用的時間軸資料層(純函式,不碰 UI 或任何後端
// 呼叫),直接 import plan-core/ 那份跟正式頁 trip-plan/TripPlanPage.tsx
// 共用,不維護 home/plan-ai-sim/ 底下重複的一份。這個目錄原本有一份幾乎
// 一模一樣的副本(唯一差異是死碼清理時拿掉的一個已確認恆為 no-op 的
// 判斷式,兩份行為完全等價),是從 plan-ai-sim 分支原封不動搬過來時一併
// 帶進來的重複檔案。
import {
  createEmptyTimeline,
  getTimeDragBounds,
  insertAfter,
  removeNode,
  staleOtherAgentMessages,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanTimeline,
} from '../../plan-core/planTimeline'
import { NativeMapBase, type MapHandle } from '../../geo-planning/NativeMapBase'
import { usePlanStopMarkers, type PlanStopMarker } from '../../geo-planning/usePlanStopMarkers'
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
  // plan_sim_ws.go 的完整說明),不帶任何額外欄位——前端收到時只用來
  // 觸發/延續思考動畫(呼吸點+骨架卡),不對時間軸做任何異動(見
  // ws.onmessage 對這個 type 的處理——提早 return,不呼叫
  // planActionToInsert)。
  type: 'thinking' | 'add_section' | 'add_stop' | 'add_transit' | 'add_note' | 'add_message' | 'remove_step' | 'done'
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
        setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
        return
      }
      setTimeline((prev) => updateNode(prev, stepId, {
        loading: false,
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
      setTimeline((prev) => updateNode(prev, stepId, { loading: false }))
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
  planAiFakeDataSource.transitEstimate(from, to)
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
export function usePlanSimSocket(start: boolean) {
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
    refreshTransitForStop(stopId, setTimeline, () => timelineRef.current)
    return true
  }, [setTimeline, timelineRef])
  // isGenerating 初始值為 false——要等 start 變 true(打字動畫播完、
  // 視同「使用者送出」)才開始安排,見上方 usePlanSimSocket 的完整說明。
  const [isGenerating, setIsGenerating] = useState(false)

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
          (placeId) => planAiFakeDataSource.placeDetails(placeId),
          setTimeline,
          () => false,
          // onSettled——onagent 路徑插入的佔位卡一開始沒有座標(座標要
          // 等這支函式查完才有),交通查詢要等查詢完成、座標確定之後
          // 才觸發。refreshTransitForStop 自己會從 timeline 重新讀取
          // 這個節點目前的座標,不需要 onSettled 傳入的 lat/lng(這裡
          // 忽略,只借用它「查詢已完成」這個時機訊號)。
          () => refreshTransitForStop(newId, setTimeline, () => timelineRef.current),
        )
      } else if (result.ok && data.type === 'stop' && data.lat != null && data.lng != null) {
        // 模擬 WS 腳本路徑(planActionToInsert)的固定資料本身就帶座標,
        // 插入當下即可同步觸發,不需要等任何背景查詢——理由同上方
        // onGotCoordinates 的完整說明,兩條路徑只是「座標何時可用」不同,
        // 觸發交通查詢這件事本身沒有差異。
        refreshTransitForStop(newId, setTimeline, () => timelineRef.current)
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
    if (!start) return
    setTimeline(createEmptyTimeline())
    setIsGenerating(true)
    // source——PlanSimSource(見該檔案開頭的完整說明)取代原本的
    // WebSocket 連線,建立後立即自動從頭播放固定劇本到 done,由 start
    // (見上方 usePlanSimSocket 的完整說明)決定何時建立。cancelled
    // 旗標理由同原本 WS 版本——避免 effect cleanup 之後,已經在飛行中的
    // setTimeout 回呼繼續寫入 state。
    const source = createPlanSimFakeSource()
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
      if (action.type === 'thinking') return
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
          if (nextId != null) refreshTransitForStop(nextId, setTimeline, () => timelineRef.current)
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

  return {
    steps,
    timeline,
    timelineRef,
    isGenerating,
    insertAttractionAfter,
    setNoteForStop,
    dragStopTime,
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

// isEmbedded——網址帶 ?embedded=1 時,代表這頁被當成 iframe 嵌進其他頁面
// (例如功能介紹頁的手機外框,見 home/AiPlanPhoneDemo.tsx):不渲染頂部漂浮
// 導覽(fixed 定位的一排按鈕會跟外框的動態島疊在一起)並隱藏捲軸把手。
// 用 iframe 而非直接嵌入元件,是因為版面的手機版斷點是 @media
// (max-width: 767px),只看視窗寬度——iframe 有獨立 viewport,手機外框內
// 才會吃到跟真實手機一模一樣的版面。預設行為(無參數)完全不變。
function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('embedded') === '1'
}

export function AIPlanTimelinePage() {
  const embedded = isEmbedded()
  const { theme, dark, toggleTheme } = useThemeToggle()
  const navigate = useNavigate()
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

  // 這個頁面固定「打字動畫播完才開始安排」(見上方 promptTyped 的完整
  // 說明),不再需要 simEnabled 開關——原始版本這裡還有
  // usePlanAiChatBridge(接真實 onagent 對話)與對應的 getStepsForBridge/
  // addNoteToTimeline 橋接函式,使用者明確要求這個頁面的輸入框改為
  // 純展示、不接受真的輸入,整條 onagent 對話路徑已一併移除。
  const { steps, isGenerating, timelineRef, dragStopTime } = usePlanSimSocket(promptTyped)

  // mapStops——要畫在地圖上的站點。只取 type==='stop' 且已經有座標的
  // 節點:section(AI 的敘述文字)本來就不是地點。腳本的站點是逐步送
  // 進來的,還沒送到的自然不在清單裡——地圖上的圓點因此會隨著時間軸
  // 一站一站長出來(見 usePlanStopMarkers 既有的進場動畫)。帶 name
  // (跟原本 PlotStop 只有 id/lat/lng 不同)——usePlanStopMarkers 拿它
  // 當 marker 的原生 title(滑鼠停在圓點上的 tooltip),見該 hook
  // PlanStopMarker 的完整說明。
  const mapStops = useMemo<PlanStopMarker[]>(
    () =>
      steps
        .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
        .map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, name: s.name })),
    [steps],
  )
  const stopCount = steps.filter((s) => s.type === 'stop').length

  // mapHandle——NativeMapBase 建圖完成後回報上來的控制代碼,見該元件
  // onHandleChange 的完整說明。usePlanStopMarkers 需要 mapRef/mapReady
  // 才能把站點 marker 掛到這個地圖實例上。
  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])

  // selectedStopId——目前被點選、卡片套用 .stopCardSelected 高亮樣式的
  // 站點。2026-10 移除右上角小地圖功能前,這個狀態同時也驅動小地圖
  // panTo+放大(見 panToStop),拿掉地圖後這裡純粹只剩「點了哪張卡片」
  // 的視覺回饋,不影響其餘行為。2026-10 地圖換成真實互動地圖
  // (NativeMapBase)後,這個 state 重新驅動地圖圓點強調(見下方
  // usePlanStopMarkers 呼叫處),回到原本「選取會連動地圖」的語意,
  // 只是不做 pan/放大(panToStop 維持不變,只設定這個 state)。
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)

  // hoverStopId——滑鼠正懸停在哪一張時間軸卡片上。2026-10 新增,對齊
  // 正式功能頁 DesktopLayout.tsx 的 hoverPlanStopId 既有模式(見該檔案
  // 同名 state 的完整說明)——這個展示頁先前只接了「點選」
  // (selectedStopId),卡片 hover 完全沒有對應的 state 可以更新,
  // usePlanStopMarkers 本身早就支援 hoverStopId 這個參數(見該 hook 的
  // 完整說明),只是這個頁面沒有建立對應的 state 餵給它,圓點因此完全
  // 是靜態的。跟 selectedStopId 分開存、不合併成單一「強調中的 id」,
  // 理由同 DesktopLayout.tsx hoverPlanStopId 的完整說明:兩者生命週期
  // 不同(hover 移出就消失,選取會留著),合併會讓「滑過另一張卡再移開」
  // 把先前點選的高亮一併清掉。
  //
  // 這裡只對齊「點選」跟「hover」這兩項(使用者明確要求「先不用全部
  // 對齊,先對齊點選跟 hover」),不跟進 DesktopLayout.tsx 的
  // hoverTransitPair(交通膠囊 hover 連線跨兩站的對齊)——那是另一個
  // 對齊項目,故下方 usePlanStopMarkers 呼叫處不傳 hoverTransitPair,
  // 讓它退回只看 hoverStopId 的既有預設行為(見該 hook 對這個參數的
  // 完整說明)。
  const [hoverStopId, setHoverStopId] = useState<string | null>(null)

  usePlanStopMarkers({
    mapRef: mapHandle.mapRef,
    mapReady: mapHandle.mapReady,
    stops: mapStops,
    // selectedStopId/hoverStopId——讓地圖圓點跟著時間軸卡片的點選/hover
    // 一起強調,對齊正式功能頁 DesktopLayout.tsx 呼叫 usePlanStopMarkers
    // 時的既有模式(完整傳入這兩個參數)。
    selectedStopId: selectedStopId,
    hoverStopId: hoverStopId,
    // onStopClick——點擊地圖上的圓點時反向高亮對應的時間軸卡片,這是
    // 雙向連動的另一半,對齊 DesktopLayout.tsx 的
    // onPlanStopClick={setSelectedPlanStopId} 同樣的模式。
    onStopClick: (id) => setSelectedStopId(id),
  })

  // composerCollapsed——排程結束後,漂浮輸入膠囊(.composer)裡原本的
  // 箭頭送出鈕(.sendBtn)切換成「立即使用」行動呼籲按鈕(.composerCta)。
  // 使用者原本要求「排程結束後,輸入匡做一個動畫轉場……縮成一顆
  // 按鈕」,試做後改要求「保留膠囊輸入外框,送出按鈕部分轉變為立即
  // 使用按鈕」——膠囊外框本身固定維持完整寬度,不再整體收縮,只有
  // .inputRow 裡送出鈕這個位置的按鈕內容改變(同一個 DOM 位置,見下方
  // JSX 依 composerCollapsed 切換渲染哪一顆按鈕)。
  //
  // 觸發時機是 isGenerating 從 true 翻成 false(劇本收到 done)那一刻,
  // 用 wasGeneratingRef 記住上一次的值來辨識這個「下降邊」——isGenerating
  // 初始值就是 false(打字動畫還沒播完、劇本尚未開始),不能單看「目前
  // 是 false」就切換,否則一進頁面就已經顯示「立即使用」。這個頁面固定
  // 只播放一次、不能重播,所以這個切換只會發生一次。
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) setComposerCollapsed(true)
    wasGeneratingRef.current = isGenerating
  }, [isGenerating])

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
  }, [])

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
  // 2026-10 補上 isGenerating 依賴(使用者截圖回報「立即使用」按鈕
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
  return (
    <>
    <div
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''} app-theme-root`}
      data-theme={theme ?? undefined}
    >
      {/* NativeMapBase——整頁的地圖底層,2026-10 從 StaticMapBackdrop
          (Static Maps API 靜態圖)換成這個真實互動地圖(使用者明確要求
          「/ai-plan 則用主題介紹頁的地圖」「换成真實互動地圖」「允許
          互動,跟主題介紹頁一致的體驗」)。外層 .mapBackdrop 是
          position:absolute 撐滿 .page 的容器(NativeMapBase 本身的
          .wrap/.map 是 width/height:100%,需要一個有明確定位的父層才能
          撐滿背景,理由同 ExploreMap.tsx 一貫的用法),取代原本
          StaticMapBackdrop 元件自帶 position:absolute 的 .backdrop。
          mapId 用跟主題介紹頁相同的 Cloud Style(LANDING_MAP_ID,關閉
          全部 POI 標籤),視覺語言一致。不再是 pointer-events:none——
          使用者明確要求允許縮放/拖曳,這個限制已經移除,時間軸側欄
          (.timelinePanel)本身有自己的 z-index 疊在地圖之上,兩者的
          互動範圍不會互相干擾。 */}
      <div className={styles.mapBackdrop}>
        <NativeMapBase
          center={CENTER}
          zoom={ZOOM}
          mapId={LANDING_MAP_ID}
          onHandleChange={handleMapHandleChange}
        />
      </div>
      {/* 上方漂浮按鈕——使用者明確要求「上方功能列採用跟首頁一樣的漂浮
          按鈕,要有功能介紹跟登入日夜間切換按鈕」,直接沿用
          home/SiteNavButtons.tsx 這份跨頁面共用元件(HomePage.tsx/
          ProductPage.tsx/城市介紹頁都是同一套),不是重新刻一份樣式。
          這幾個元件本身是 fixed 定位、疊在頁面最上層(見
          SiteNavButtons.css 的完整說明)。頁面本身不再有任何實體功能
          列(.header 已完全移除,使用者明確要求「不要有上方的實際功能
          列了」)。slot={2} 讓「功能介紹」往左讓開「登入」按鈕的寬度,
          理由同 HomePage.tsx 的既有用法。 */}
      {!embedded && (
        <>
        {/* statusPill(已安排幾站)2026-10 從這裡移到 .composer 的
            .inputRow 最前面(見下方該處的完整說明)——使用者先前要求
            「不要放在功能列上，要放在台南兩日遊右邊」,這次進一步要求
            移到輸入匡前面,SiteNavBrand 不再需要帶 extra prop。 */}
        <SiteNavBrand pageLabel="台南兩日遊" />
        <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
        <SiteNavCta href="/app">登入</SiteNavCta>
        <SiteNavCta href="/product" variant="accent" slot={2}>功能介紹</SiteNavCta>
        </>
      )}

      {/* timelinePanel——2026-10 使用者要求「將 /ai-plan 時間軸放到
          右側」:原本 PlanTimelineView 直接是 .page 的 flex 子項,
          時間軸內容靠 PlanTimelineView.module.css 自己的 .inner
          (max-width:640px; margin:0 auto)在整個視窗寬度置中,蓋住地圖
          正中央。改成固定寬度(560px)、貼齊視窗右緣的側欄容器——地圖
          (StaticMapBackdrop)因此左側完全露出不被內容遮擋,視覺語言
          改成「左地圖/右資訊欄」。這層需要 position:relative,取代
          原本掛在 .page 身上、給 jumpPillWrap 置中計算用的定位基準
          (見 .timelinePanel/.timelineJumpPillWrap 的完整說明:
          jumpPillWrap 現在要相對這個側欄本身置中,不是整個 .page)。
          composer(輸入膠囊)刻意「不」包進這個側欄——使用者明確要求
          「輸入匡位置不要動」,維持原本相對整個 .page 水平置中、固定
          貼在視窗底部的位置,不跟著時間軸一起搬到右側,見下方 composer
          仍在 .timelinePanel 外層、直接是 .page 子元素的結構。 */}
      <div className={styles.timelinePanel}>
      <PlanTimelineView
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
      </div>

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          {/* 輸入框是純展示用的假打字動畫(見 typedPrompt 的完整說明),
              不接受真的輸入、不會真的送出任何請求——這個頁面固定進頁就
              自動播放整段劇本(見 usePlanSimSocket),不再有 onagent 對話
              路徑,故這裡不是 <form>(沒有東西可以 submit)。膠囊外框
              (.composer)本身固定維持完整寬度,不做整體收縮動畫——使用者
              試過「整個膠囊縮成一顆按鈕」的版本後,改要求「保留膠囊輸入
              外框,送出按鈕部分轉變為立即使用按鈕」,並要求「要有按鈕
              展開動畫」:輸入框(顯示打好的那句話)留在原位不動,右側
              原本的箭頭送出鈕(sendBtn)在排程結束後展開成「立即使用」
              文字按鈕(composerCta)。這裡改成同一顆 <button>(不是條件
              渲染出兩顆不同的按鈕元素),靠 composerCollapsed 切換
              class/內容——同一個 DOM 節點才能讓瀏覽器對 width 做
              transition 展開動畫(見 .module.css 的 .composerCta 完整
              說明),條件渲染兩個獨立元素只會是瞬間切換、沒有動畫可言。
              未展開時維持 aria-label="送出"/disabled(對齊原本 sendBtn
              的假展示語意),展開後 aria-label 换成"立即使用",不再
              disabled(理由見下方 composerCta 完整說明)。 */}
          <div className={styles.inputRow}>
            {/* statusPill(已安排幾站)2026-10 從頂部 SiteNavBrand 旁邊
                移到這裡——使用者明確要求「放到輸入匡的前面」,具體是指
                輸入框膠囊內部最左側,跟輸入框/送出鈕同一排。.statusPill
                本身已經是 display:flex + flex:none(見 .module.css),
                直接搬進這個 flex 容器的第一個位置就能正確排列,
                .inputWrap 的 flex:1 繼續佔滿剩餘空間,不需要額外樣式
                調整。 */}
            <div className={styles.statusPill}>
              {isGenerating ? (
                <>
                  <span className={`${styles.statusDot} ${styles.statusDotGenerating}`} />
                  <span>正在安排行程…</span>
                </>
              ) : (
                <>
                  <span className={`${styles.statusDot} ${styles.statusDotDone}`} />
                  <span>已安排 {stopCount} 站</span>
                </>
              )}
            </div>
            <div className={styles.inputWrap}>
              <input
                type="text"
                aria-label="輸入指令(僅供展示)"
                className={styles.input}
                value={typedPrompt}
                readOnly
              />
            </div>
            {/* composerCta——排程結束後由送出鈕展開成的行動呼籲按鈕,
                使用者明確要求文案「立即使用」,點擊要導向登入頁面
                (/app,對齊首頁 SiteNavCta 的「登入」按鈕同樣指向
                /app——未登入時 /app 本身就會顯示登入畫面,見
                PhoneContent.tsx 的既有行為,不需要另外一個獨立的
                /login 路由)。用 <button onClick={navigate(...)}> 而非
                <Link>,是因為要維持跟未展開時的 <button>(送出鈕)是
                同一個 DOM 元素/同一種標籤,才能讓瀏覽器對 max-width 等
                屬性做 transition 展開動畫(見 .module.css 的完整說明)
                ——換成 <a>(Link 的底層標籤)會被視為全新元素,動畫
                會直接跳過。未展開時維持 disabled,onClick 不會被
                觸發,不需要額外判斷 composerCollapsed 才能呼叫
                navigate。 */}
            <button
              type="button"
              className={`${styles.sendBtn} ${composerCollapsed ? styles.composerCta : ''} ${
                // 打字動畫進行中(輸入框已經有字、但還沒打完那一刻)使用者
                // 明確要求送出鈕要「模擬送出的樣式,但是不能真的可以
                // 點選」——拿掉 disabled 平常的淺化/半透明樣式,改成完全
                // 不透明的深色圓鈕(見 .module.css 的 .sendBtnActive 完整
                // 說明),視覺上看起來像「有內容、可以送出」,呼應正在
                // 打字這個當下的狀態;disabled 屬性本身仍然保留、原生
                // 點擊行為依舊被瀏覽器擋下,只是視覺樣式改觀感,不是真的
                // 開放互動。打完字之後(promptTyped)排程已經開始跑,不再
                // 需要這個「看起來可送」的暗示,退回原本淡化的樣子。
                !composerCollapsed && typedPrompt && !promptTyped ? styles.sendBtnActive : ''
              }`}
              aria-label={composerCollapsed ? '立即使用' : '送出'}
              disabled={!composerCollapsed}
              onClick={() => navigate('/app')}
            >
              {composerCollapsed ? (
                '立即使用'
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ios-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
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
