import { useEffect, useRef } from 'react'
import { useStableCallback } from '../hooks/useStableCallback'
import { planStopMarkerContent, type PlanStopMarkerState } from './mapMarkers'

// PlanStopMarker——這個圖層需要的最小資料形狀。刻意不直接收 PlanNode
// (plan-core/planTimeline.ts)而是這個結構性型別:geo-planning/ 不該為了
// 畫幾顆點就依賴 AI 規劃那一側的資料模型,呼叫端(DesktopLayout.tsx)
// 負責把時間軸節點轉成這個形狀。lat/lng 在這裡是必填——沒有座標的節點
// (查詢中的佔位卡)本來就畫不出來,由呼叫端先濾掉,不讓這個 hook 承擔
// 「哪些節點還沒查到座標」這種屬於時間軸的狀態判斷。
export interface PlanStopMarker {
  id: string
  lat: number
  lng: number
  name?: string
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
  stops,
  selectedStopId,
  hoverStopId,
  onStopClick,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  stops: PlanStopMarker[]
  selectedStopId?: string | null
  // hoverStopId——滑鼠正懸停在哪一張時間軸卡片上(2026-10 新增,使用者
  // 明確要求「滑鼠移動到介紹卡時,地圖圓加強顯示」)。跟 selectedStopId
  // 共用同一副靶心與漣漪,但外環墨濃度與光暈大小刻意不同(selected 環實
  // 暈收斂、hover 環虛暈擴散)——見 planStopMarkerContent 對 state 參數
  // 的完整說明。selected 優先:兩者同時指向同一顆時視覺等同 selected。
  hoverStopId?: string | null
  // onStopClick——點擊地圖上的小圓點時回報是哪一站。選填:省略時圓點
  // 純粹是顯示用,不可點擊。
  //
  // 這支 hook 只負責回報「哪一顆被點了」,收到之後要做什麼由呼叫端決定。
  // DesktopLayout 把它接到 selectedPlanStopId(地圖與時間軸共用的唯一事實
  // 來源),所以點圓點時對應的時間軸卡片也會跟著高亮。時間軸不會自動捲動
  // 到那張卡片——目前沒有這個需求,要做的話是呼叫端的事,不是這裡。
  onStopClick?: (id: string) => void
}) {
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  // stateRef——每顆 marker 目前套用的視覺狀態,索引對齊 markersRef/stops。
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
  // onStopClick 可能是 undefined(選填 prop),包一層固定呼叫 ?. 的函式,
  // 讓 useStableCallback 永遠拿到一個真的函式。
  const handleStopClick = useStableCallback((id: string) => { onStopClick?.(id) })
  // hasStopClick 單獨留著給下方 gmpClickable 用——那個旗標只在建立 marker
  // 當下讀一次,需要知道的是「呼叫端到底有沒有提供 onStopClick」這件事
  // 本身,而 handleStopClick 永遠是個函式、問不出這個資訊。
  const hasStopClick = !!onStopClick

  // stopsKey:stops 的內容摘要,供下方 effect 依賴——理由同
  // useTripEntryMarkers 的 tripEntriesKey(陣列本身每次 render 都是新的
  // 參照,直接放進依賴陣列會讓 marker 每次重建)。
  //
  // 含 name:那是 marker 的 title(滑鼠停在圓點上的原生 tooltip)。少了它
  // 的話,背景查詢把站點名稱從佔位文字回填成真實名稱時(座標先到、名稱
  // 後到的情況)key 不變、marker 不重建,tooltip 會一直停在舊名。
  const stopsKey = stops.map((s) => `${s.id}|${s.lat}|${s.lng}|${s.name ?? ''}`).join(',')

  // resolveState——把「這一站在當下是什麼視覺狀態」的規則收斂成一處,
  // 建立 effect 與同步 effect 共用,避免兩邊各寫一次 selected 優先的判斷
  // 而漂移。
  //
  // 建立 effect 直接呼叫它就能拿到最新值,不需要 ref 包一層:effect 的
  // 函式每輪 render 都會重新建立(捕獲當輪的 selectedStopId/hoverStopId),
  // 依賴陣列只決定「要不要執行」,不影響「執行的是哪一輪的閉包」——真的
  // 執行時跑的必然是最後一輪。同資料夾 useSearchResultMarkers 的建立
  // effect 也是直接讀 selectedKey/hoverKey,同一個道理。
  const resolveState = (id: string): PlanStopMarkerState =>
    id === selectedStopId ? 'selected' : id === hoverStopId ? 'hover' : 'base'

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
    // 了站點 id 與回調。這個圖層的重建頻率很高(stopsKey 在 AI 串流期間
    // 每新增一站、每筆背景回填座標都會變),不清的話一趟規劃就會累積數十批
    // 棄置但仍被引用的 marker。理由同 ExploreMap.tsx 對地圖實例本身做
    // clearInstanceListeners 的既有做法。
    markersRef.current.forEach((m) => {
      google.maps.event.clearInstanceListeners(m)
      m.map = null
    })
    // 建立時就套用當下的狀態,而不是一律建成 base 再讓同步 effect 修正
    // ——後者會讓「已選取的點」在每次 stopsKey 變動時重播一次漣漪:
    // 重建後 stateRef 是 'base'、實際狀態是 'selected',同步 effect 判定
    // 成「從 base 進入強調態」(entering=true)而播放進場動畫。而
    // stopsKey 變動在 AI 串流期間很頻繁(每新增一站、每筆背景回填座標
    // 都算),使用者會看到已經選好的那顆點莫名其妙一直擴散。
    //
    // stateRef 跟著寫入相同的值,兩者必須一致:同步 effect 用
    // 「prev === state 就跳過」判斷,記錄與實際畫面不符會讓該更新的
    // 不更新(或反之)。比照 useSearchResultMarkers 的既有做法。
    stateRef.current = stops.map((s) => resolveState(s.id))
    markersRef.current = stops.map((s, i) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: s.lat, lng: s.lng },
        map: mapRef.current!,
        title: s.name,
        // entering=false:這是重建,不是使用者剛把注意力移過來,不該播
        // 進場動畫(見 planStopMarkerContent 對 entering 參數的說明)。
        //
        // 已知取捨:重建會中斷正在播放的漣漪(新 content 不含 .ps-ripple
        // 元素),所以「hover 某張卡片的同時 AI 剛好新增一站」會讓擴散
        // 動畫中途消失。這是刻意選的——另一邊是每次重建都重播一次漣漪,
        // 而 stopsKey 在 AI 串流期間變動得很頻繁,持續重播比偶爾中斷
        // 干擾大得多。
        content: planStopMarkerContent(stateRef.current[i], accentColor, false),
        // zIndex 必須在建立時就帶上,不能只靠下方同步 effect 指派:那個
        // effect 在 prev === state 時會提早 return,而重建後 stateRef 已經
        // 寫入當下狀態(見上方),兩者相同就直接跳過 → 強調中的圓點
        // zIndex 永遠停在預設值,會被重疊的 base 圓點蓋住。stopsKey 在
        // AI 串流期間變動頻繁,這個情境很容易發生。對齊
        // useSearchResultMarkers 在 constructor 就帶 zIndex 的既有做法。
        zIndex: zIndexForState(stateRef.current[i]),
        // gmpClickable 必須明確開啟,AdvancedMarkerElement 預設不接受
        // 點擊事件(跟舊版 Marker 的預設行為不同)。
        //
        // 注意這個旗標只在建立當下決定:呼叫端若在 stopsKey 不變的情況下
        // 從「不傳 onStopClick」切換成「傳」(或反之),不會重新套用——
        // 目前唯一的呼叫端(ExploreMap)固定傳入,不觸發這個限制。
        gmpClickable: hasStopClick,
      })
      // 'gmp-click' 而非 'click':AdvancedMarkerElement 的正式事件名,
      // 對齊同資料夾 useSearchResultMarkers 的既有寫法(其測試的 mock 也
      // 只認這個名稱)。'click' 目前仍是可用的相容別名,但走在棄用路徑上。
      marker.addListener('gmp-click', () => handleStopClick(s.id))
      return marker
    })
    return () => {
      // 同上:解除 listener 再 detach,兩者都要做(見上方的完整說明)。
      markersRef.current.forEach((m) => {
        google.maps.event.clearInstanceListeners(m)
        m.map = null
      })
      markersRef.current = []
      // stateRef 跟著清空,維持「索引永遠對齊 markersRef」這個不變量——
      // 留著舊紀錄的話,若下次建立 effect 因為 !mapReady 提早 return,
      // 同步 effect 會拿殘留的狀態去比對一批已經不存在的 marker。
      stateRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, stopsKey])

  // 選取樣式同步成獨立 effect,不跟建立 marker 那個合併:選取狀態變動
  // (使用者點了另一張卡片)不該讓整批 marker 重建,那會造成明顯的閃爍。
  // 理由同 useTripEntryMarkers 的既有做法。
  useEffect(() => {
    // 同時檢查 mapReady——跟建立 effect 的條件對稱。marker 尚未建立時
    // 這個 effect 沒有東西可同步,雖然下方 `if (!marker) return` 也擋得住,
    // 但那是巧合而非設計(靠陣列剛好是空的),條件寫齊比較不會在日後
    // 調整任一邊時失衡。
    if (!mapReady || !mapRef.current) return
    // 索引對齊檢查:下方用 stops[i] ↔ markersRef.current[i] ↔
    // stateRef.current[i] 三者同索引配對。同一次 commit 內建立 effect
    // 先於這個 effect 執行(宣告順序),所以 stopsKey 變動時兩邊必然已經
    // 同步——但那是靠執行順序保證的隱性不變量,長度對不上就代表這個假設
    // 在某個未預期的路徑下被打破了,此時整批跳過比拿錯位的索引去改 marker
    // 安全(下一次建立 effect 會重新同步)。
    if (markersRef.current.length !== stops.length || stateRef.current.length !== stops.length) return
    const mapDiv = mapRef.current.getDiv()
    const accentColor = getComputedStyle(mapDiv).getPropertyValue('--color-accent').trim() || '#8B3A2F'
    stops.forEach((s, i) => {
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
      // (hoverStopId 每次變動都會跑這個 effect)重複播放漣漪。
      // 這跟 useAttractionOverlays.ts「只切 class 不重建 DOM,避免
      // fadeIn 重播」是同一個理由,也順便省下無謂的 DOM 替換。
      if (prev === state) return
      stateRef.current[i] = state
      // entering 只在「從 base 進入強調態」時為 true。hover→selected
      // (桌機最常見的點擊路徑)屬於強調態之間的切換,只換靜態外觀、
      // 不重播漣漪與光暈進場,見 planStopMarkerContent 的完整說明。
      marker.content = planStopMarkerContent(state, accentColor, prev === 'base')
      // hover 疊在 selected 之上:當選取的 A 與滑過的 B 在地圖上重疊時,
      // 使用者此刻指著的是 B,該讓 B 可見。
      marker.zIndex = zIndexForState(state)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, selectedStopId, hoverStopId, stopsKey])
}
