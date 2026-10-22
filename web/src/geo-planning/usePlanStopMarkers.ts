import { useEffect, useRef } from 'react'
import { useStableCallback } from '../hooks/useStableCallback'
import { planStopMarkerContent, type PlanStopMarkerState } from './mapMarkers'
import { getPlanStopOverlayClass, type PlanStopOverlayInstance } from './planStopOverlay'

// StopMapMarker——這支 hook 內部用的 marker 聯集型別:AdvancedMarkerElement
// 跟 PlanStopOverlay(見 planStopOverlay.ts)的 API 形狀不同——
// AdvancedMarkerElement 的 map/zIndex 是可直接賦值的屬性,content 放
// DOM Node;PlanStopOverlay 是 google.maps.OverlayView 子類別,map 要透過
// setMap() 方法設定,沒有原生 zIndex 屬性(改用 setZIndex() 這個自訂方法
// 寫 CSS z-index,見 planStopOverlay.ts 的完整說明)。用聯集型別讓建立/
// 同步兩個 effect 能在同一段邏輯裡處理兩種 marker,實際走哪一種由
// useAdvancedMarkers 參數決定(見下方完整說明),清除/設定這幾個形狀不同
// 的屬性時各自用對應的 API,不是逐一判斷每顆 marker 的型別去猜哪個欄位
// 存在。
//
// 2026-10 改版:原本這裡的另一種分支是舊版 google.maps.Marker(icon 用
// data:image/svg+xml 靜態圖片),已改成 PlanStopOverlay——理由是靜態圖片
// 內部的 SVG 節點不能套用 .ps-halo/.ps-ripple 這兩個外部 CSS keyframe
// 動畫(瀏覽器不會對 data URI 圖片內部節點套用外部樣式表),hand-drawn
// 行程(jozankei-1day)的強調態因此永遠是「直接顯示最終畫面」而非漸入,
// 跟 AdvancedMarkerElement 分支的視覺不一致。PlanStopOverlay 是真正的
// DOM(OverlayView 的 div),能完整套用這兩個動畫,且不要求地圖帶 mapId
// (跟 google.maps.Marker 一樣能在 inline MapTypeStyle 的地圖上運作),
// 兩個條件同時滿足。
type StopMapMarker = google.maps.marker.AdvancedMarkerElement | PlanStopOverlayInstance

// PlanStopMarker——這個圖層需要的最小資料形狀。刻意不直接收 PlanNode
// (plan-core/planTimeline.ts)而是這個結構性型別:geo-planning/ 不該為了
// 畫幾顆點就依賴 AI 規劃那一側的資料模型,呼叫端(desktop/Content.tsx)
// 負責把時間軸節點轉成這個形狀。lat/lng 在這裡是必填——沒有座標的節點
// (查詢中的佔位卡)本來就畫不出來,由呼叫端先濾掉,不讓這個 hook 承擔
// 「哪些節點還沒查到座標」這種屬於時間軸的狀態判斷。
export interface PlanStopMarker {
  id: string
  lat: number
  lng: number
  name?: string
  // glyph——選填,2026-10 新增(使用者明確要求「地圖上的食物小點顯示
  // 食物 icon」,只套用 itineraries 展示頁)。疊在圓點正中央的 SVG
  // fragment,直接轉傳給 planStopMarkerContent 的 glyphSvg 參數(見該
  // 函式的完整說明)。未傳時維持原本的純色圓點——PlanMap.tsx/
  // home/plan-ai-sim/Content.tsx 等正式規劃頁的呼叫端不傳這個欄位,完全不
  // 受影響。
  glyph?: string
  // size——選填,2026-10 新增(使用者回報「圖案太小了」,確認方向「讓
  // 美食 marker 整顆圓點放大」):整顆圓點(含 glyph)的渲染尺寸,直接
  // 轉傳給 planStopMarkerContent 的 size 參數(見該函式的完整說明)。
  // 未傳時維持原本的 14px——PlanMap.tsx/Content.tsx 等
  // 正式規劃頁的呼叫端不傳這個欄位,完全不受影響。
  size?: number
  // children——選填,2026-10 新增(使用者明確要求交接前後「套用相同的
  // 元件跟地圖互動」)。這一站底下的子景點(主題點展開後圍成一圈的
  // 那些點,見 planTimeline.ts PlanNodeData.children 的完整說明)。
  //
  // 在這之前 PlanStopMarker 不帶這個欄位,plan-ai-sim/Content 因此只能
  // 繞過站點檢視實例、直接讀 timelineRef 拿 children,而且只在
  // kind === 'simulated' 時讀——交接到真實 AI 之後 timeline 住在
  // TripPlanPage 內部、外層讀不到,主題點的展開能力整個消失。
  //
  // 改成由各自的投影實作填好這個欄位:兩種來源產出同一種形狀,地圖那側
  // 不再需要「這是模擬還是真實」的分支,交接前後行為一致。
  children?: { id: string; lat: number; lng: number; name?: string }[]
}

// zIndexForState——強調中的圓點要疊在其他圓點之上。建立 marker 與同步
// effect 兩處共用這一份規則,避免各寫一次而漂移(數值分層對齊
// useSearchResultMarkers 的既有慣例)。
//
// hover 高於 selected:當選取的 A 與滑過的 B 在地圖上重疊時,使用者此刻
// 指著的是 B,該讓 B 可見。
function zIndexForState(state: PlanStopMarkerState | undefined): number | null {
  if (state === 'hover') return 999
  if (state === 'selected') return 998
  return null
}

// detachStopMarker/setStopMarkerZIndex——AdvancedMarkerElement 的 map/
// zIndex 是可直接賦值的屬性,PlanStopOverlay(OverlayView 子類別)要透過
// setMap()/setZIndex() 方法(見 StopMapMarker 型別的完整說明)。這兩個
// 小工具把「兩種 marker API 形狀不同」收斂成一處判斷,建立/清除/同步
// 三個地方都呼叫這裡,不要逐一各寫一次 'setMap' in marker 判斷而彼此
// 漂移。
//
// 'setZIndex' in marker 這個判斷能分辨兩者,是因為 AdvancedMarkerElement
// 原生沒有 setZIndex 方法(zIndex 是直接賦值的屬性)——PlanStopOverlay
// 刻意取同名方法只是巧合方便判斷,並非兩者共用介面。
function detachStopMarker(marker: StopMapMarker) {
  if ('setZIndex' in marker) marker.setMap(null)
  else marker.map = null
}
function setStopMarkerZIndex(marker: StopMapMarker, zIndex: number | null) {
  if ('setZIndex' in marker) marker.setZIndex(zIndex)
  else marker.zIndex = zIndex
}

// usePlanStopMarkers——AI 規劃時間軸上已安排站點的 marker 圖層
// (2026-10 新增,使用者明確要求「開啟對話若是有安排景點,地圖上出現
// 小圓點」)。
//
// 結構比照 useTripEntryMarkers/useSearchResultMarkers(同樣是「把一組已知
// 座標的點畫在地圖上、並同步選取樣式」這件事)——只讀 mapRef/mapReady/
// 自己的資料,不寫入任何其他共享狀態。
//
// 現階段不抽成三者共用的泛型 hook,理由不是「選取判斷來源不同」(那其實
// 是最容易參數化的部分,一個 getState(item) 回調就解決),而是三個 hook
// 目前的行為基準還沒收斂:
//   - useTripEntryMarkers 沒有「值沒變就跳過重繪」那層(每次 hoverKey
//     變動就無條件重繪全部 marker,正是 useSearchResultMarkers 註解裡
//     記錄過的「滑鼠移到清單時地圖上所有圖標一起閃動」那個 bug)。
//   - 只有這支有三態與一次性動畫,其餘兩支是 selected 布林。
//   - 只有這支畫布尺寸固定(見 planStopMarkerContent 對錨點跳位的說明),
//     其餘兩支的 marker 會隨狀態改變尺寸。
// 在這種情況下抽出來的泛型 hook 會是三者的最大公倍數,比重複更難維護。
// 要抽的話,正確順序是先把 useTripEntryMarkers 補上跳過重繪那層、讓三者
// 行為一致,再談共用。
//
// 這批點不受地圖可視範圍篩選,理由同 useTripEntryMarkers:是使用者已經
// 排定的內容,不是依範圍查詢的圖層,全部顯示讓他看到完整的規劃分布。
export function usePlanStopMarkers({
  mapRef,
  mapReady,
  mapVersion = 0,
  points,
  selectedId,
  hoverId,
  hoverTransitPair,
  onPointClick,
  useAdvancedMarkers = true,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  // mapVersion:地圖實例每重建一次(例如明暗模式切換)就遞增,見
  // NativeMapBase MapHandle.mapVersion。必須列進 effect 依賴——重建後
  // mapRef.current 是新實例,舊實例上的圖層隨之失效,但 mapReady 不一定
  // 出現 false→true 的邊緣,只靠 mapReady 會讓路徑/站點不會重畫到新地圖上。
  mapVersion?: number
  points: PlanStopMarker[]
  selectedId?: string | null
  // hoverId——滑鼠正懸停在哪一張時間軸卡片上(2026-10 新增,使用者
  // 明確要求「滑鼠移動到介紹卡時,地圖圓加強顯示」)。跟 selectedId
  // 共用同一副靶心與漣漪,但外環墨濃度與光暈大小刻意不同(selected 環實
  // 暈收斂、hover 環虛暈擴散)——見 planStopMarkerContent 對 state 參數
  // 的完整說明。selected 優先:兩者同時指向同一顆時視覺等同 selected。
  hoverId?: string | null
  // hoverTransitPair——滑鼠懸停在時間軸「交通膠囊」上時,這段交通連接的
  // 兩個站點 id(使用者明確要求「移動到交通的膠囊上,地圖上讓連接的兩個
  // 點都顯示 hover 狀態」)。跟 hoverId 是互補而非互斥的兩種來源:
  // hoverId 是「滑鼠在單一張站點卡上」,這個是「滑鼠在兩站之間的
  // 交通膠囊上」——兩者都會讓對應的點進入 hover 視覺,resolveState 裡
  // 用「屬於其中任一來源」判斷,不需要呼叫端自己合併成單一清單。選填:
  // 省略時這個圖層的 hover 判斷退回只看 hoverId,行為等同新增這個
  // 參數之前。
  hoverTransitPair?: { fromId: string; toId: string } | null
  // onPointClick——點擊地圖上的小圓點時回報是哪一站。選填:省略時圓點
  // 純粹是顯示用,不可點擊。
  //
  // 這支 hook 只負責回報「哪一顆被點了」,收到之後要做什麼由呼叫端決定。
  // desktop/Content 把它接到 selectedPlanStopId(地圖與時間軸共用的唯一事實
  // 來源),所以點圓點時對應的時間軸卡片也會跟著高亮。時間軸不會自動捲動
  // 到那張卡片——目前沒有這個需求,要做的話是呼叫端的事,不是這裡。
  onPointClick?: (id: string, point: PlanStopMarker) => void
  // useAdvancedMarkers——選填,預設 true,2026-10 新增(使用者明確要求
  // 「hand-drawn 改用普通標記(非 Advanced Marker)」,且強調「不能影響
  // 其他功能」,故設計成預設 true、不傳就是原本的行為)。
  //
  // 背景:AdvancedMarkerElement 強制要求地圖帶 mapId(vector map 渲染
  // 管線)才能顯示,這是 Google Maps 平台本身的限制——地圖沒有 mapId 時
  // console 會印「地圖在初始化時未使用有效的地圖 ID,因此將無法使用
  // 進階標記」,marker 完全不會出現。itineraries/handDrawnMapStyle.ts
  // 的手繪可愛風樣式用的是 inline MapTypeStyle(legacy raster map,見
  // NativeMapBase.tsx styles prop 的完整說明——styles 有值時完全不帶
  // mapId),兩者在平台層級互斥,故這類地圖必須傳 false,改走
  // PlanStopOverlay(google.maps.OverlayView 子類別,見 planStopOverlay.ts
  // 的完整說明)。
  //
  // 2026-10 二次改版:false 分支原本走舊版 google.maps.Marker(icon 用
  // data:image/svg+xml 靜態圖片),使用者比較 jozankei-1day(這個分支)
  // 跟 tainan-chikan-2day(simple 樣式、帶 mapId、走 AdvancedMarkerElement)
  // 的地圖標記視覺後,明確要求兩者看起來要一樣——但靜態 icon 圖片內部的
  // SVG 節點不能套用 .ps-halo/.ps-ripple 這兩個外部 CSS keyframe 動畫
  // (瀏覽器不會對 data URI 圖片內部節點套用外部樣式表),強調態的進場
  // 動畫在舊版 Marker 底下只能「直接顯示最終畫面」而非漸入,跟
  // AdvancedMarkerElement 分支不一致。改用 OverlayView 後這個差異已經
  // 消除:OverlayView 的 div 是真正的 DOM,能完整套用這兩個動畫,同時
  // 跟舊版 Marker 一樣不要求地圖帶 mapId。
  //
  // false 時現在唯一的行為差異是 marker 的底層實作(AdvancedMarkerElement
  // 的 content 指派 vs OverlayView 的 div.replaceChildren),視覺輸出
  // (靶心/光暈/漣漪 SVG,含進場動畫)與點擊回報完全相同——兩條路徑
  // 共用同一份 planStopMarkerSvgString 繪圖邏輯與 svgStringToElement 轉換,
  // 不是重新設計一套簡化版樣式。已知的次要落差:OverlayView 沒有原生
  // title 屬性,改用 div.title 模擬(見 planStopOverlay.ts onAdd() 的
  // 完整說明),行為跟原生 <title> tooltip 一致,不是真的遺失。
  useAdvancedMarkers?: boolean
}) {
  const markersRef = useRef<StopMapMarker[]>([])
  // stateRef——每顆 marker 目前套用的視覺狀態,索引對齊 markersRef/points。
  // 兩個用途:(1) 跳過「值沒變」的 content 指派;(2) 判斷這次切換是不是
  // 「從 base 進入強調態」,只有那種情況才播進場動畫(見
  // planStopMarkerContent 的 entering 參數)。見下方同步 effect 的說明。
  const stateRef = useRef<PlanStopMarkerState[]>([])
  // useStableCallback——避免呼叫端每次 render 產生的新閉包進到下方 effect
  // 的依賴陣列裡、導致整批 marker 被反覆重建(見 hooks/useStableCallback.ts
  // 的完整說明,那裡記錄了 useSearchResultMarkers 曾因此出現「拖曳地圖會
  // 自動彈回原位」的真實 bug)。geo-planning/ 底下的 marker 點擊 callback
  // 都用這支,不各自手搓 xxxRef 樣板。
  //
  // onPointClick 可能是 undefined(選填 prop),包一層固定呼叫 ?. 的函式,
  // 讓 useStableCallback 永遠拿到一個真的函式。
  const handlePointClick = useStableCallback((point: PlanStopMarker) => { onPointClick?.(point.id, point) })
  // hasPointClick 單獨留著給下方 gmpClickable 用——那個旗標只在建立 marker
  // 當下讀一次,需要知道的是「呼叫端到底有沒有提供 onPointClick」這件事
  // 本身,而 handlePointClick 永遠是個函式、問不出這個資訊。
  const hasPointClick = !!onPointClick

  // pointsKey:points 的內容摘要,供下方 effect 依賴——理由同
  // useTripEntryMarkers 的 tripEntriesKey(陣列本身每次 render 都是新的
  // 參照,直接放進依賴陣列會讓 marker 每次重建)。
  //
  // 含 name:那是 marker 的 title(滑鼠停在圓點上的原生 tooltip)。少了它
  // 的話,背景查詢把站點名稱從佔位文字回填成真實名稱時(座標先到、名稱
  // 後到的情況)key 不變、marker 不重建,tooltip 會一直停在舊名。
  const pointsKey = points.map((s) => `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}`).join(',')

  // hoverTransitPairKey——hoverTransitPair 每次 render 都是新物件參照
  // (即使內容相同,呼叫端通常是 onHoverTransit(pair) 直接 setState 一個
  // 字面量),直接放進依賴陣列會讓同步 effect 誤判「變了」而每次 render
  // 都重跑——理由同 pointsKey。
  const hoverTransitPairKey = hoverTransitPair ? `${hoverTransitPair.fromId}|${hoverTransitPair.toId}` : ''

  // resolveState——把「這一站在當下是什麼視覺狀態」的規則收斂成一處,
  // 建立 effect 與同步 effect 共用,避免兩邊各寫一次 selected 優先的判斷
  // 而漂移。
  //
  // 建立 effect 直接呼叫它就能拿到最新值,不需要 ref 包一層:effect 的
  // 函式每輪 render 都會重新建立(捕獲當輪的 selectedId/hoverId),
  // 依賴陣列只決定「要不要執行」,不影響「執行的是哪一輪的閉包」——真的
  // 執行時跑的必然是最後一輪。同資料夾 useSearchResultMarkers 的建立
  // effect 也是直接讀 selectedKey/hoverKey,同一個道理。
  const isHoverViaTransitPair = (id: string): boolean =>
    hoverTransitPair?.fromId === id || hoverTransitPair?.toId === id
  const resolveState = (id: string): PlanStopMarkerState =>
    id === selectedId ? 'selected' : id === hoverId || isHoverViaTransitPair(id) ? 'hover' : 'base'

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const mapDiv = mapRef.current.getDiv()
    // --color-accent 的讀取方式同 useTripEntryMarkers 的完整說明:這個
    // token 掛在 .app-theme-root 上,必須讀地圖容器(它的子孫節點)的
    // computed style 才拿得到主題覆寫後的值。
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'
    // clearInstanceListeners——m.map = null 只是把 marker 從地圖上 detach,
    // 不會解除 addListener 註冊的 handler;Google Maps 內部對註冊過 listener
    // 的實例持有強引用(這正是官方提供這支 API 的原因),每個閉包又 capture
    // 了站點 id 與回調。這個圖層的重建頻率很高(pointsKey 在 AI 串流期間
    // 每新增一站、每筆背景回填座標都會變),不清的話一趟規劃就會累積數十批
    // 棄置但仍被引用的 marker。理由同 PlanMap.tsx 對地圖實例本身做
    // clearInstanceListeners 的既有做法。
    markersRef.current.forEach((m) => {
      google.maps.event.clearInstanceListeners(m)
      detachStopMarker(m)
    })
    // 建立時就套用當下的狀態,而不是一律建成 base 再讓同步 effect 修正
    // ——後者會讓「已選取的點」在每次 pointsKey 變動時重播一次漣漪:
    // 重建後 stateRef 是 'base'、實際狀態是 'selected',同步 effect 判定
    // 成「從 base 進入強調態」(entering=true)而播放進場動畫。而
    // pointsKey 變動在 AI 串流期間很頻繁(每新增一站、每筆背景回填座標
    // 都算),使用者會看到已經選好的那顆點莫名其妙一直擴散。
    //
    // stateRef 跟著寫入相同的值,兩者必須一致:同步 effect 用
    // 「prev === state 就跳過」判斷,記錄與實際畫面不符會讓該更新的
    // 不更新(或反之)。比照 useSearchResultMarkers 的既有做法。
    stateRef.current = points.map((s) => resolveState(s.id))
    markersRef.current = points.map((s, i) => {
      // entering=false:這是重建,不是使用者剛把注意力移過來,不該播
      // 進場動畫(見 planStopMarkerContent 對 entering 參數的說明)。
      //
      // 已知取捨:重建會中斷正在播放的漣漪(新 content/icon 不含
      // .ps-ripple 元素),所以「hover 某張卡片的同時 AI 剛好新增一站」
      // 會讓擴散動畫中途消失。這是刻意選的——另一邊是每次重建都重播一次
      // 漣漪,而 pointsKey 在 AI 串流期間變動得很頻繁,持續重播比偶爾
      // 中斷干擾大得多。
      if (!useAdvancedMarkers) {
        // PlanStopOverlay 分支——見 useAdvancedMarkers 參數的完整說明:
        // 不帶 mapId 的地圖(itineraries/handDrawnMapStyle.ts 手繪可愛風)
        // 無法使用 AdvancedMarkerElement,改用 google.maps.OverlayView
        // 子類別(見 planStopOverlay.ts),讓 .ps-halo/.ps-ripple 這兩個
        // CSS 動畫能跟 AdvancedMarkerElement 分支一樣正常套用。
        const OverlayClass = getPlanStopOverlayClass()
        const marker = new OverlayClass(
          new google.maps.LatLng(s.lat, s.lng),
          s.name,
          hasPointClick ? () => handlePointClick(s) : undefined,
        )
        // setState 建立時就套用當下的狀態,entering=false 理由同下方
        // AdvancedMarkerElement 分支的 content 參數——見上方「建立時就
        // 套用當下的狀態」的完整說明:這是重建,不是使用者剛把注意力移
        // 過來,不該播進場動畫。
        marker.setState(stateRef.current[i], false, accentColor, s.glyph, s.size ?? 14)
        marker.setZIndex(zIndexForState(stateRef.current[i]))
        marker.setMap(mapRef.current!)
        return marker
      }
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: s.lat, lng: s.lng },
        map: mapRef.current!,
        title: s.name,
        content: planStopMarkerContent(stateRef.current[i], accentColor, false, s.glyph, s.size),
        // zIndex 必須在建立時就帶上,不能只靠下方同步 effect 指派:那個
        // effect 在 prev === state 時會提早 return,而重建後 stateRef 已經
        // 寫入當下狀態(見上方),兩者相同就直接跳過 → 強調中的圓點
        // zIndex 永遠停在預設值,會被重疊的 base 圓點蓋住。pointsKey 在
        // AI 串流期間變動頻繁,這個情境很容易發生。對齊
        // useSearchResultMarkers 在 constructor 就帶 zIndex 的既有做法。
        zIndex: zIndexForState(stateRef.current[i]),
        // gmpClickable 必須明確開啟,AdvancedMarkerElement 預設不接受
        // 點擊事件(跟舊版 Marker 的預設行為不同)。
        //
        // 注意這個旗標只在建立當下決定:呼叫端若在 pointsKey 不變的情況下
        // 從「不傳 onPointClick」切換成「傳」(或反之),不會重新套用——
        // 目前唯一的呼叫端(PlanMap)固定傳入,不觸發這個限制。
        gmpClickable: hasPointClick,
      })
      // 'gmp-click' 而非 'click':AdvancedMarkerElement 的正式事件名,
      // 對齊同資料夾 useSearchResultMarkers 的既有寫法(其測試的 mock 也
      // 只認這個名稱)。'click' 目前仍是可用的相容別名,但走在棄用路徑上。
      marker.addListener('gmp-click', () => handlePointClick(s))
      return marker
    })
    return () => {
      // 同上:解除 listener 再 detach,兩者都要做(見上方的完整說明)。
      markersRef.current.forEach((m) => {
        google.maps.event.clearInstanceListeners(m)
        detachStopMarker(m)
      })
      markersRef.current = []
      // stateRef 跟著清空,維持「索引永遠對齊 markersRef」這個不變量——
      // 留著舊紀錄的話,若下次建立 effect 因為 !mapReady 提早 return,
      // 同步 effect 會拿殘留的狀態去比對一批已經不存在的 marker。
      stateRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, pointsKey, useAdvancedMarkers])

  // 選取樣式同步成獨立 effect,不跟建立 marker 那個合併:選取狀態變動
  // (使用者點了另一張卡片)不該讓整批 marker 重建,那會造成明顯的閃爍。
  // 理由同 useTripEntryMarkers 的既有做法。
  useEffect(() => {
    // 同時檢查 mapReady——跟建立 effect 的條件對稱。marker 尚未建立時
    // 這個 effect 沒有東西可同步,雖然下方 `if (!marker) return` 也擋得住,
    // 但那是巧合而非設計(靠陣列剛好是空的),條件寫齊比較不會在日後
    // 調整任一邊時失衡。
    if (!mapReady || !mapRef.current) return
    // 索引對齊檢查:下方用 points[i] ↔ markersRef.current[i] ↔
    // stateRef.current[i] 三者同索引配對。同一次 commit 內建立 effect
    // 先於這個 effect 執行(宣告順序),所以 pointsKey 變動時兩邊必然已經
    // 同步——但那是靠執行順序保證的隱性不變量,長度對不上就代表這個假設
    // 在某個未預期的路徑下被打破了,此時整批跳過比拿錯位的索引去改 marker
    // 安全(下一次建立 effect 會重新同步)。
    if (markersRef.current.length !== points.length || stateRef.current.length !== points.length) return
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'
    points.forEach((s, i) => {
      const marker = markersRef.current[i]
      if (!marker) return
      // selected 優先於 hover(規則收斂在 resolveState):滑鼠移回已經選取
      // 的那張卡片時,狀態仍然是 'selected'、跟 ref 裡的相同,下面直接
      // 跳過——已經錨定的東西不該因為滑鼠經過而有任何反應(見
      // planStopMarkerContent 對四種邏輯組合如何對應到三種視覺的說明)。
      const state = resolveState(s.id)
      const prev = stateRef.current[i] ?? 'base'
      // 值沒變就跳過:強調態的 SVG 內含一次性漣漪動畫,而
      // AdvancedMarkerElement 每次指派 content 都會重建元素、讓動畫從頭
      // 播——不做這個檢查的話,已選取的那顆點會在滑鼠掃過其他卡片時
      // (hoverId 每次變動都會跑這個 effect)重複播放漣漪。
      // 這跟 useAttractionOverlays.ts「只切 class 不重建 DOM,避免
      // fadeIn 重播」是同一個理由,也順便省下無謂的 DOM 替換。
      if (prev === state) return
      stateRef.current[i] = state
      // entering 只在「從 base 進入強調態」時為 true。hover→selected
      // (桌機最常見的點擊路徑)屬於強調態之間的切換,只換靜態外觀、
      // 不重播漣漪與光暈進場,見 planStopMarkerContent 的完整說明。
      if (useAdvancedMarkers) {
        ;(marker as google.maps.marker.AdvancedMarkerElement).content = planStopMarkerContent(
          state,
          accentColor,
          prev === 'base',
          s.glyph,
          s.size,
        )
      } else {
        ;(marker as PlanStopOverlayInstance).setState(state, prev === 'base', accentColor, s.glyph, s.size ?? 14)
      }
      // hover 疊在 selected 之上:當選取的 A 與滑過的 B 在地圖上重疊時,
      // 使用者此刻指著的是 B,該讓 B 可見。
      setStopMarkerZIndex(marker, zIndexForState(state))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, selectedId, hoverId, hoverTransitPairKey, pointsKey, useAdvancedMarkers])
}
