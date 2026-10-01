import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Bike, Car, Footprints } from 'lucide-react'
import { useThemeToggle } from '../../hooks/useThemeToggle'
import { SiteNavBrand, SiteNavCta, SiteNavThemeToggle } from '../SiteNavButtons'
import { NativeMapBase, type MapHandle } from '../../geo-planning/NativeMapBase'
import { useSyncedState } from '../../hooks/useSyncedState'
import { planAiFakeDataSource } from './planAiFakeDataSource'
import { createPlanSimFakeSource } from './planSimFakeSource'
// planTimeline.ts——共用的時間軸資料層(純函式,不碰 UI 或任何後端
// 呼叫),直接 import plan-core/ 那份跟正式頁 trip-plan/TripPlanPage.tsx
// 共用,不維護 home/plan-ai-sim/ 底下重複的一份。這個目錄原本有一份幾乎
// 一模一樣的副本(唯一差異是死碼清理時拿掉的一個已確認恆為 no-op 的
// 判斷式,兩份行為完全等價),是從 plan-ai-sim 分支原封不動搬過來時一併
// 帶進來的重複檔案。
import {
  createEmptyTimeline,
  insertAfter,
  removeNode,
  staleOtherAgentMessages,
  toRenderList,
  updateNode,
  type PlanNode,
  type PlanNodeData,
  type PlanTimeline,
} from '../../plan-core/planTimeline'
import styles from './AIPlanTimelinePage.module.css'

// 台南市區的預設中心點——右上角小地圖初始顯示整個行程涵蓋的大致範圍
// (赤崁樓/祀典武廟一帶到孔廟一帶的中點),還沒點過任何卡片時顯示這裡,
// 而不是空白/未初始化狀態。
const DEFAULT_MAP_CENTER = { lat: 23.001, lng: 120.182 }
const DEFAULT_MAP_ZOOM = 13
const SELECTED_MAP_ZOOM = 16

// TRANSIT_MODE_ICONS——交通卡的圖示,使用者明確要求「不要用 emoji 要用
// icon」,改成 lucide-react 的 SVG 元件,取代原本
// planAiFakeDataSource.ts/api.ts 資料層回傳的 emoji 字元(🚶/🛵/🚗)。
// 資料層的 icon 欄位本身維持不動(見 planAiDataSource.ts
// PlanAiTransitEstimateResult 的完整說明:型別刻意對齊真後端回應結構,
// 不該為了這裡的顯示需求去改資料層型別語意),改用已經存在、人類可讀
// 的 mode 欄位(「步行」/「騎車」/「開車」)當 key 查這張表——falsy
// fallback 用 Footprints,理由同下方渲染處的說明:交通模式目前只有
// fakeTransitEstimate 回傳的這三種固定字串,不會有查無對應的情況,
// fallback 純粹是型別安全考量,不代表真的會被用到。
const TRANSIT_MODE_ICONS: Record<string, typeof Footprints> = {
  '步行': Footprints,
  '騎車': Bike,
  '開車': Car,
}

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
  fetchPlaceDetails: (placeId: string) => Promise<{ found?: boolean; name?: string; summary?: string; photoUrl?: string; lat?: number; lng?: number; attractionId?: string }>,
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
        photoUrl: details.photoUrl,
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

// MINI_MAP_ENABLED — 右上角固定小地圖是否掛載(見下方渲染處的完整
// 說明)。2026-09 暫時關閉:測試交通預估等新功能時,地圖本身持續發出的
// 圖磚/Places 請求會混進網路面板,干擾排查目標請求,測試完成後應改回
// true 恢復正常畫面。
const MINI_MAP_ENABLED = false

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
function usePlanSimSocket(start: boolean) {
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
          setTimeline((prev) => removeNode(prev, removedId))
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
    isGenerating,
    insertAttractionAfter,
    setNoteForStop,
  }
}

// NOTE_STYLES — 備註分類 → 顏色/圖示的固定對照表。這是使用者明確要求
// 兩層架構的直接體現:「排程元件提供操作資料的方法,LLM 的工具透過這些
// 方法操作排程內的資料」——視覺樣式怎麼對應分類是行程安排元件自己的
// 決定,不是 attractionTools.ts 的 add_note 工具該內建的邏輯(該工具現在
// 只轉呼叫 addNoteToTimeline,不自己碰 color/noteIcon,見該工具的完整
// 說明)。value 對齊 plan_sim_ws.go 既有模擬腳本示範的用法(consideration
// 用 --ios-gray/✦ 表示「取捨考量」、info 用 --ios-sand/ⓘ 表示「一般
// 提醒」、weather 用 --ios-blue/☁︎ 表示「天氣考量」)。cost(💰「花費
// 估算」)目前劇本沒有實際使用的備註,但對照表本身仍保留這個分類——
// 使用者之前明確要求移除的是劇本裡「上午累計預估花費 $220」那一則
// 備註本身,不是整個花費分類的視覺定義,之後若要再加花費相關備註可以
// 直接沿用。
const NOTE_STYLES: Record<string, { color: string; noteIcon: string }> = {
  consideration: { color: 'var(--ios-gray)', noteIcon: '✦' },
  info: { color: 'var(--ios-sand)', noteIcon: 'ⓘ' },
  cost: { color: 'var(--ios-green)', noteIcon: '💰' },
  weather: { color: 'var(--ios-blue)', noteIcon: '☁︎' },
}
const DEFAULT_NOTE_CATEGORY = 'info'

// isRecordMode——讀一次 ?recordMode=1(與 planSimFakeSource.ts
// RECORD_DELAY_MS 讀的是同一個參數),不用 state/effect 包——這是純粹
// 依網址決定的渲染分支,不是會隨時間變化的值,元件存活期間不會改變。
// 宣告在元件外層,import 當下只算一次,不是每次 render 都重新 parse。
function isRecordMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('recordMode') === '1'
}

export function AIPlanTimelinePage() {
  const { theme, dark, toggleTheme } = useThemeToggle()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showJumpPill, setShowJumpPill] = useState(false)
  // recordMode——錄製手機外框素材時(見 home/record/RecordAiPlanPage.tsx
  // 的完整說明),整排頂部漂浮按鈕(SiteNavBrand 品牌名+狀態膠囊、
  // SiteNavThemeToggle 日夜切換、「登入」「功能介紹」)會跟手機外框的
  // 動態島裝飾疊在一起(實測發現的真實問題:這整排都是 fixed 定位
  // 貼齊頁面最頂端,動態島也懸浮在同一個區域,全部擠成一團)。這整排
  // 按鈕在「畫面裡只是一支正在展示的手機」這個情境下也沒有意義——
  // 「登入」「功能介紹」點了會跳轉頁面但沒有人會真的點,品牌名/狀態
  // 膠囊這類資訊在最終影片會改由錄製頁外部的字卡承擔(見廣告企劃對
  // 「字卡」的設計),不需要網頁自己再疊一層。recordMode 下整排都不
  // 渲染,讓動態島區域保持乾淨。
  const recordMode = isRecordMode()

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
    // typeSpeedMs/startDelayMs——網址 ?typeSpeedMs=/?startDelayMs= 可覆寫
    // 打字速度(預設 90ms/字)與開場定格秒數(預設 0,立即開始打字)。
    // 這是給 scripts/record/record-ai-plan.ts 這類自動化錄製腳本用的
    // 參數(見廣告企劃對「開頭 3 秒要快速抓住觀眾」「15 秒剪輯版建議
    // 60ms/字」的節奏建議),一般展示(無參數時)完全不受影響,維持原本
    // 90ms/字、不定格的既有行為。理由同 planSimFakeSource.ts
    // RECORD_DELAY_MS 的完整說明:錄製素材需要精確可調的節奏,不該
    // 為了配合廣告剪輯去動一般展示頁的預設體驗。
    const params = new URLSearchParams(window.location.search)
    const typeSpeedMs = Number(params.get('typeSpeedMs')) || 90
    const startDelayMs = Number(params.get('startDelayMs')) || 0

    let i = 0
    let timer: ReturnType<typeof setInterval> | null = null
    const startTimer = setTimeout(() => {
      timer = setInterval(() => {
        i += 1
        setTypedPrompt(fullText.slice(0, i))
        if (i >= fullText.length) {
          if (timer) clearInterval(timer)
          setPromptTyped(true)
        }
      }, typeSpeedMs)
    }, startDelayMs)
    return () => {
      clearTimeout(startTimer)
      if (timer) clearInterval(timer)
    }
  }, [])

  // 這個頁面固定「打字動畫播完才開始安排」(見上方 promptTyped 的完整
  // 說明),不再需要 simEnabled 開關——原始版本這裡還有
  // usePlanAiChatBridge(接真實 onagent 對話)與對應的 getStepsForBridge/
  // addNoteToTimeline 橋接函式,使用者明確要求這個頁面的輸入框改為
  // 純展示、不接受真的輸入,整條 onagent 對話路徑已一併移除。
  const { steps, isGenerating } = usePlanSimSocket(promptTyped)
  const stopCount = steps.filter((s) => s.type === 'stop').length

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
    if (wasGeneratingRef.current && !isGenerating) {
      setComposerCollapsed(true)
      // data-plan-sim-done——腳本播放完成的訊號,掛在 <body> 上供外部
      // 自動化腳本(Playwright 等)輪詢偵測,取代「固定等待 N 秒」這種
      // 容易跟實際播放時長(腳本內容調整後可能變長/變短)脫節的做法。
      // 只是一個無害的 DOM 屬性,不影響任何樣式/渲染行為,頁面本身完全
      // 不依賴它。見 home/record/RecordAiPlanPage.tsx 的使用情境說明。
      document.body.setAttribute('data-plan-sim-done', 'true')
    }
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

  // ---------- 右上角固定小地圖 ----------
  // 只掛載單一 NativeMapBase 實例(理由見使用者原始需求:「掛載地圖是不是
  // 很吃資源且會變慢,所以我想說只掛載單一地圖」),點擊任一張 stop 卡片
  // 時呼叫 mapRef.current.panTo + setZoom,而不是每張卡片各自掛一個地圖
  // ——這裡選的是「固定側欄地圖」方案(使用者確認:「先做旁邊固定的地圖
  // 好了」「一直存在於右上角,點卡片就 pan 過去+放大」),不是「地圖跟著
  // 移動到被點的卡片旁邊」那個需要 Portal/DOM 搬移的方案(已明確擱置,
  // 見對話討論——Google Maps SDK 沒有官方 API 能把建好的地圖實例搬到
  // 別的 DOM 容器,只能重建,CSS 視覺位移則不需要搬移,直接維持固定位置
  // 最單純)。
  const mapHandleRef = useRef<MapHandle | null>(null)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)

  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    mapHandleRef.current = handle
  }, [])

  const panToStop = useCallback((step: PlanStep) => {
    if (step.lat == null || step.lng == null) return
    setSelectedStopId(step.id)
    const map = mapHandleRef.current?.mapRef.current
    if (!map) return
    map.panTo({ lat: step.lat, lng: step.lng })
    map.setZoom(SELECTED_MAP_ZOOM)
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

  // 只在 steps 改變時跟隨,不把跟隨狀態放進依賴:否則使用者手動捲到底、
  // 跟隨狀態從 false 翻成 true 的那一刻,這個 effect 也會被觸發去捲動。
  useEffect(() => {
    if (!followingRef.current) return
    if (steps.length === 0) return
    scrollToLatest()
  }, [steps, scrollToLatest])

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
  // 使用者明確要求改放進主顯示區(.scroll/.inner)當空狀態引導文字——
  // 其餘兩種狀態已經有畫面上別的提示(header 的 .statusPill、input 的
  // placeholder),不需要再額外佔一行常駐文字重複表達同樣的意思。
  const emptyStateMessage = '想去哪裡玩？跟我說說你的想法，我可以幫你查景點、安排行程。'

  // app-theme-root:base-ui.css 的深色模式規則掛在這個全域 class 上
  // (.app-theme-root:not([data-theme="light"]) 搭配
  // prefers-color-scheme、.app-theme-root[data-theme="dark"]),見
  // App.tsx 的 /app 路由同樣疊加這個 class。少了它,無論系統偏好或
  // data-theme 屬性值是什麼,這個頁面都只會顯示淺色 token。
  return (
    <div className={`${styles.page} app-theme-root`} data-theme={theme ?? undefined}>
      {/* 上方漂浮按鈕——使用者明確要求「上方功能列採用跟首頁一樣的漂浮
          按鈕,要有功能介紹跟登入日夜間切換按鈕」,直接沿用
          home/SiteNavButtons.tsx 這份跨頁面共用元件(HomePage.tsx/
          ProductPage.tsx/城市介紹頁都是同一套),不是重新刻一份樣式。
          這幾個元件本身是 fixed 定位、疊在頁面最上層(見
          SiteNavButtons.css 的完整說明)。頁面本身不再有任何實體功能
          列(.header 已完全移除,使用者明確要求「不要有上方的實際功能
          列了」)。slot={2} 讓「功能介紹」往左讓開「登入」按鈕的寬度,
          理由同 HomePage.tsx 的既有用法。
          !recordMode——見 recordMode 宣告處的完整說明:手機外框錄製時
          這整排會跟動態島裝飾疊在一起,且在「只是展示用」的情境下沒有
          實際功能,整排不渲染。 */}
      {!recordMode && (
        <>
          <SiteNavBrand
            pageLabel="台南兩日遊"
            extra={
              // statusPill——原本獨立用一個估算座標的 fixed 容器疊在
              // SiteNavBrand 旁邊,使用者明確要求「不要放在功能列上，要放
              // 在台南兩日遊右邊」,改用 SiteNavBrand 新增的 extra prop
              // 直接插進同一個 .site-nav-brand-row 裡跟著 flex 排列,不需要
              // 再手動估算/對齊座標。
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
            }
          />
          <SiteNavThemeToggle dark={dark} onToggle={toggleTheme} />
          <SiteNavCta href="/app">登入</SiteNavCta>
          <SiteNavCta href="/product" variant="accent" slot={2}>功能介紹</SiteNavCta>
        </>
      )}

      {/* 右上角固定小地圖——position: fixed(見 .module.css 的完整說明),
          不佔版面空間、不隨時間軸捲動。單一 NativeMapBase 實例,點擊
          stop 卡片時呼叫 panToStop 讓它 panTo+放大,不是每張卡片各自
          掛一個地圖(效能考量,見上方 panToStop 的完整說明)。
          2026-09:暫時停用掛載(MINI_MAP_ENABLED=false,見該常數的完整
          說明)——開發中測試交通預估等功能時,地圖本身的圖磚/Places
          請求會混進網路面板,干擾排查,先關閉、測試完再打開。 */}
      {MINI_MAP_ENABLED && (
        <div className={styles.miniMapWrap}>
          <NativeMapBase
            center={DEFAULT_MAP_CENTER}
            zoom={DEFAULT_MAP_ZOOM}
            theme={theme}
            showZoomControl={false}
            onHandleChange={handleMapHandleChange}
          />
        </div>
      )}

      <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
        <div className={styles.inner}>
          {/* emptyState——時間軸完全空白、也還沒開始生成時的引導文字
              (見 emptyStateMessage 的完整說明),使用者明確要求把它從
              漂浮膠囊移到這個主顯示區置中呈現,而不是常駐在輸入框上方
              佔一行。isGenerating 為 true 時不顯示——那個情況下面已經
              有呼吸點/骨架卡(.tipRow)傳達「正在安排」的狀態,不需要
              空狀態文字跟生成動畫同時出現互相干擾。 */}
          {steps.length === 0 && !isGenerating && (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateIcon}>✦</span>
              <p className={styles.emptyStateText}>{emptyStateMessage}</p>
            </div>
          )}
          {steps.map((p, idx) => {
            // justMounted:這個節點是不是「第一次」出現在畫面上(見上方
            // mountedIdsRef 的完整說明)——用 id 是否已經記錄過判斷,不是
            // 用陣列 index,插入到中間的節點才能正確觸發進場動畫。渲染
            // 當下就同步寫入 ref(不是等 useEffect),因為這個判斷結果
            // 本身要在這一輪 render 就決定要不要套用動畫 class,寫入時機
            // 跟讀取時機必須是同一輪。
            const justMounted = !mountedIdsRef.current.has(p.id)
            if (justMounted) mountedIdsRef.current.add(p.id)
            const mountedClass = styles.mountFadeIn
            // removingClass:套在每個節點最外層的 .row 容器上——CSS
            // 同時做透明度淡出跟高度塌縮(見 .module.css 的 .removingFade
            // 完整說明),讓移除的節點不是瞬間消失、下面的節點也是跟著
            // 高度縮小一起往上滑,而不是版面突然跳一格。
            const removingClass = p.removing ? styles.removingFade : ''

            if (p.type === 'section') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.sectionRow} ${mountedClass} ${removingClass}`}>
                  <div className={styles.sectionBand}>
                    <span className={styles.sectionLabel}>{p.label}</span>
                  </div>
                </div>
              )
            }

            if (p.type === 'stop') {
              // transitFromPrev(見 planTimeline.ts TransitInfo 的完整
              // 說明)掛在到達站自己身上,不再是獨立插入鏈結的 'transit'
              // 節點——渲染時在這張 stop 卡片「之前」多畫一列交通卡,
              // key 加 "transit-" 前綴避免跟下面 stop 本身的 key(p.id)
              // 衝突。沒有 transitFromPrev(第一站,或前一站不是帶座標的
              // stop)時完全不畫這一列。
              const transit = p.transitFromPrev
              // note——這個節點自己的備註(見 planTimeline.ts NoteInfo 的
              // 完整說明),不再是鏈結串列裡獨立插入的節點,改成掛在這張
              // stop 卡片自己身上的欄位,渲染時在卡片之前多畫一列(保留
              // 使用者原本熟悉的「左窄欄獨立一列」視覺,同交通卡列的作法
              // ——只是資料來源從獨立節點換成 p.note)。中間欄補上貫穿
              // 整行的軸線(.noteAxisLine),否則時間軸主軸線在這一列會
              // 斷開(理由同交通卡列 .transitAxis 需要銜接軸線的說明)。
              const note = p.note
              const noteStyle = note ? NOTE_STYLES[note.category ?? ''] ?? NOTE_STYLES[DEFAULT_NOTE_CATEGORY] : null
              return (
                <Fragment key={p.id}>
                  {note && noteStyle && (
                    <div className={`${styles.row} ${styles.noteRow}`}>
                      <div className={`${styles.noteLeft} ${mountedClass} ${justMounted ? styles.noteFade : ''}`}>
                        <div className={styles.noteInner}>
                          <div className={styles.noteBar} style={{ background: noteStyle.color }} />
                          <div className={styles.noteText}>
                            <span style={{ marginRight: 4 }}>{noteStyle.noteIcon}</span>{note.text}
                          </div>
                        </div>
                      </div>
                      <div className={styles.noteAxisCol}>
                        <div className={styles.noteAxisLine} />
                      </div>
                      <div />
                    </div>
                  )}
                  {transit && (
                    <div className={`${styles.row} ${styles.transitRow}`}>
                      <div />
                      <div className={styles.transitAxis}>
                        <div className={styles.transitDashAbove} />
                        <div className={styles.transitDashBelow} />
                        <div className={`${mountedClass} ${justMounted ? styles.pillExpand : ''} ${styles.transitPill}`}>
                          {/* 查詢中(loading:true,見 refreshTransitForStop
                              的完整說明)只顯示轉圈動畫,不顯示任何文字
                              ——使用者明確要求「不要用文字用 icon」,重用
                              stop 卡片查詢中狀態既有的 thumbSpinner 動畫,
                              不另外設計一套。查詢完成後
                              icon/mode/minutes/distance 才會有值,此時
                              才換成正常的文字呈現。 */}
                          {transit.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢交通資訊中" />
                          ) : (
                            <>
                              {(() => {
                                const TransitIcon = (transit.mode && TRANSIT_MODE_ICONS[transit.mode]) || Footprints
                                return <TransitIcon size={13} strokeWidth={2} aria-hidden="true" />
                              })()}
                              <span>
                                {transit.mode} {transit.minutes} 分
                                {/* transitSep——分隔點降權(見 Fable 模型
                                    精緻化方案):跟文字同色同權重時顯得
                                    偏硬,降到 50% 透明度更柔和。 */}
                                <span className={styles.transitSep}>·</span>
                                {transit.distance}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div />
                    </div>
                  )}
                  <div data-tl-node className={`${styles.row} ${styles.stopRow} ${removingClass}`}>
                    <div className={`${styles.stopTime} ${mountedClass}`}>
                      <div className={styles.stopTimeText}>{p.time}</div>
                    </div>
                    <div className={styles.axisCol}>
                      {idx > 0 && <div className={styles.axisLineAbove} />}
                      {/* axisLineBelow 原本只在「還有下一個節點」時畫
                          (idx < steps.length - 1),但這個節點是陣列最後
                          一個、且仍在生成中(isGenerating)時,後面其實
                          還接著呼吸點/骨架卡(.tipRow,見下方渲染邏輯)要
                          銜接——只看陣列位置不看生成狀態,會讓「目前正在
                          生成下一站」這個當下,最後一張卡片下方到呼吸點
                          之間完全沒有任何軸線元素覆蓋,出現一大段斷裂
                          (2026-09 實測:「大天后宮」卡片下方到呼吸點之間
                          整段空白)。補上 isGenerating 這個條件,讓它在
                          「還有下一個節點」或「正在生成中」任一成立時都
                          畫出來。 */}
                      {(idx < steps.length - 1 || isGenerating) && <div className={styles.axisLineBelow} />}
                      <div className={`${styles.anchorDot} ${mountedClass} ${justMounted ? styles.anchorPop : ''}`} />
                    </div>
                    <div className={`${styles.stopCardWrap} ${mountedClass} ${justMounted ? styles.cardSlide : ''}`}>
                      <div
                        className={`${styles.stopCard} ${p.id === selectedStopId ? styles.stopCardSelected : ''}`}
                        role={p.lat != null && p.lng != null ? 'button' : undefined}
                        tabIndex={p.lat != null && p.lng != null ? 0 : undefined}
                        onClick={() => panToStop(p)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') panToStop(p)
                        }}
                      >
                        <div
                          className={`${styles.stopThumb} ${justMounted ? styles.thumbPop : ''}`}
                          style={{ background: p.photoUrl ? undefined : p.thumbBg }}
                        >
                          {p.loading ? (
                            <span className={styles.thumbSpinner} aria-label="查詢地點資料中" />
                          ) : p.photoUrl ? (
                            <img src={p.photoUrl} alt={p.name} className={styles.stopThumbImg} />
                          ) : p.thumbIcon}
                        </div>
                        <div className={styles.stopBody}>
                          <div className={styles.stopMeta}>
                            {p.duration} · {p.kind}
                            {p.loading && <span className={styles.loadingTag}>查詢地點中…</span>}
                          </div>
                          <div className={styles.stopName}>{p.name}</div>
                          <div className={styles.stopDesc}>{p.desc}</div>
                          {p.tags && p.tags.length > 0 && (
                            <div className={styles.stopTags}>
                              {p.tags.map((tag) => (
                                <span key={tag} className={styles.stopTag}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Fragment>
              )
            }

            // message——LLM/使用者的對話訊息(見 planTimeline.ts
            // PlanNodeType 的完整說明),時間軸上自己獨立的一列,不依附
            // 任何 stop 卡片。使用者明確指出「他不是引言,是對話」,也
            // 明確否決過「放在 note 區」的方向——這裡用對話氣泡樣式
            // (.messageBubble),視覺上跟 note(左側色條+文字,語意是
            // 行程備註)、stopCard(景點卡本體)都刻意區隔開,讓使用者
            // 一眼認出「這是 AI/我說的一句話」。新的 stop 節點插入後
            // (p.stale === true,由 staleOtherAgentMessages 統一標記),
            // 不整個移除,收合成一行淡化的小字——它依然是時間軸上自己
            // 的節點,只是不再搶當下的注意力。
            if (p.type === 'message') {
              return (
                <div key={p.id} className={`${styles.row} ${styles.messageRow} ${mountedClass} ${removingClass}`}>
                  <div />
                  <div className={styles.messageAxisCol}>
                    <div className={styles.messageAxisLine} />
                  </div>
                  <div className={styles.messageWrap}>
                    <div className={`${styles.messageBubble} ${p.stale ? styles.messageBubbleStale : ''}`}>
                      {/* stale(收合淡化態)是單行省略號截斷的純文字——
                          markdown 排版(換行、清單、粗體)在那個高度/寬度
                          下沒有意義,維持純文字即可。新鮮態才用
                          ReactMarkdown 渲染完整內容,對齊 chat/MessageBubble.tsx
                          既有對 LLM 回覆文字的處理方式,不另外手刻一套
                          markdown 解析。 */}
                      {p.stale ? (
                        p.text
                      ) : (
                        <div className={styles.messageMarkdown}>
                          <ReactMarkdown>{p.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          {/* isGenerating——固定劇本自動播放中(見 usePlanSimSocket 的
              完整說明),true 時顯示思考動畫(呼吸點+骨架卡)。這個頁面
              不再有 onagent 對話路徑,不需要額外的 isThinking 訊號來源。 */}
          {isGenerating ? (
            // key 綁「目前最後一個節點的 id」:tipRow 是 steps.map 之後的
            // 固定兄弟元素,React 每次重渲染都會把它視為「同一個既有元素、
            // 只是被往下推了一格」,DOM 節點不會重建——結果是掛在
            // .tipLineAbove 上的軸線生長動畫(見 .module.css 的 growDown
            // 說明)只會在頁面第一次出現呼吸點時播一次,之後每個新節點掛
            // 上來、呼吸點移到新位置時完全沒有「從上一個錨點延伸下來」的
            // 動態感。用 key 讓「最後一個節點變了」等同「呼吸點換了位置」,
            // 強制 React 卸掉舊的 tipRow 重新掛一個,CSS animation 才會隨
            // 之重播。這跟 mountedIdsRef 追蹤 justMounted 的機制是互補的:
            // 那個負責「節點本身」的進場動畫,這裡負責「節點之後的預告區」
            // 的重播——兩者都依賴 id、不依賴陣列 index,插入到中間的節點
            // 不會改變最後一個 id,呼吸點位置也確實沒變,不該重播,行為
            // 一致。骨架卡跟 tipRow 共用同一個 key 的 fragment,理由相同:
            // 它是呼吸點的延伸,一起重掛才能跟軸線生長同步淡入。
            <Fragment key={`tip-after-${steps.length > 0 ? steps[steps.length - 1].id : 'empty'}`}>
              <div data-tl-tip className={`${styles.row} ${styles.tipRow}`}>
                <div />
                <div className={styles.tipAxis}>
                  <div className={styles.tipLineAbove} />
                  <div className={styles.tipDot} />
                  <div className={styles.tipLineBelow} />
                </div>
                <div />
              </div>
              {/* 骨架卡——呼吸點下方的「即將出現的內容」預告(見 .module.css
                  的 .skeletonRow/.skeletonCard 完整說明)。不對應任何真實
                  PlanStep、沒有資料,純粹是視覺佔位:先前呼吸點下面是一整片
                  空白,看起來像「已經結束」而不是「還在生成」。只在已經有
                  節點之後才顯示——steps 還是空的(WS 剛連上、第一則訊息還
                  沒到)時只有呼吸點,沒有「上一個錨點」可以延伸,骨架卡孤
                  零零掛在最上面反而奇怪。沿用 .row/.stopRow/.axisCol/
                  .stopCardWrap 既有 class 讓它落在跟真實 stop 卡片同一個
                  右欄、同樣的縮排,只疊加 skeleton 專屬 modifier 調整外觀,
                  不另建一套 grid。aria-hidden:對輔助技術而言這裡沒有任何
                  內容,不該被朗讀成一個空卡片。 */}
              {steps.length > 0 && (
                <div aria-hidden="true" className={`${styles.row} ${styles.stopRow} ${styles.skeletonRow}`}>
                  <div />
                  <div className={styles.axisCol}>
                    {/* skeletonAxisAbove——骨架卡列自己補一段貫穿到
                        .skeletonAnchor 中點的虛線,銜接上方 .tipRow 的
                        .tipLineBelow,兩段視覺上連成一條完整貫穿呼吸點到
                        骨架卡的軸線,不依賴跨列的絕對定位假設(同步
                        trip-plan/TripPlanPage.module.css 正式頁修過的
                        「時間軸斷裂」bug——原本骨架卡列高度用魔術數字
                        猜測,實際高度跟猜測值不同就會斷裂或超出)。 */}
                    <div className={styles.skeletonAxisAbove} />
                    <div className={styles.skeletonAnchor} />
                  </div>
                  <div className={styles.stopCardWrap}>
                    <div className={styles.skeletonCard}>
                      <div className={`${styles.skeletonThumb} ${styles.shimmer}`} />
                      <div className={styles.skeletonBody}>
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle} ${styles.shimmer}`} />
                        <div className={`${styles.skeletonLine} ${styles.skeletonLineDesc} ${styles.shimmer}`} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          ) : steps.length > 0 ? (
            <div className={`${styles.endMarker} ${styles.endFade}`}>── 行程結束 ──</div>
          ) : null}
        </div>
      </div>

      {showJumpPill && (
        <div className={styles.jumpPillWrap}>
          <button type="button" className={styles.jumpPill} onClick={jumpToLatest}>↓ 回到最新</button>
        </div>
      )}

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
  )
}
