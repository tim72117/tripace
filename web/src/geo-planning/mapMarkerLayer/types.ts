// types.ts——useMapMarkerLayer(見同資料夾 index.ts)的公開型別。
//
// 這整個資料夾取代原本分散在 usePlanStopMarkers.ts/useThemeRadiusCircle.ts
// 兩個獨立 hook、由各呼叫端(ExploreMap.tsx/AIPlanTimelinePage.tsx/
// AiItineraryDetailPageMapView.tsx 等)各自維護 selectedStopId/hoverStopId/
// expandedThemeId 多個獨立 state、再各自傳進不同 hook 的做法——那種「多個
// state 來源 + 多道非同步 effect 組成的隱性狀態機」正是「點 A 卻標示 B」
// 這類 bug 的根因(沒有單一事實來源)。
//
// 設計原則(見 docs/ 這次重構討論的完整脈絡,使用者明確要求):
//   1. 手機/桌面共用同一套核心邏輯,只有少數行為是特例(例如手機沒有滑鼠
//      hover)——用 supportsHover 這類開關表達特例,不是另外重寫一份平行
//      邏輯。
//   2. 事件雙向:點擊地圖上的點要能反向通知外部(onPointClick/
//      onSelectedChange),外部傳入新的 selectedId 也要讓地圖對應更新
//      (含 panTo)——兩個方向都走同一組介面,不像原本 ExploreMap 用
//      onPlanStopClick、AIPlanTimelinePage 用 onStopClick 兩套命名各自
//      接線。
//   3. 2026-10 改版(無限重渲染迴圈修正,取代原本的 useReducer 內部
//      自主管理設計):selectedId/hoverId 完全交給外部管理,這個 hook
//      內部不再持有、也不再 dispatch 任何「選取/hover 結果」state。
//      只保留 expandedThemeId 作為純衍生值(用 selectedId+points 算
//      出,不是 state)。
//
//      改版理由——原本的設計是「外部受控 prop 進來→同步進內部
//      reducer→reducer 改變又觸發 onSelectedChange 通知外部→呼叫端
//      把通知結果寫回同一個 selectedId prop」,這個雙向同步圈只要
//      呼叫端把 onSelectedChange 收到的值原樣 setState 回去(最常見、
//      最自然的用法),就形成了「受控 prop 進→內部改→通知出→呼叫端寫
//      回同一個 prop→又被當成新的受控輸入」的環,在複合情境下(例如
//      這個值同時驅動另一個獨立 effect 的副作用)很容易被放大成無限
//      重渲染(React 報 "Maximum update depth exceeded")。修正辦法
//      不是繼續疊加 ref 去標記「這次改變是不是來自同步」(那只是用
//      時序去補救架構缺陷,脆弱且難驗證),而是從根本消除「內部也留一份
//      state 又跟外部雙向同步」這個設計——改成跟 <input value={x}
//      onChange={...}> 同一種 fully controlled component 模式:
//      selectedId/hoverId 永遠由外部的單一事實來源决定,這個 hook 只负责
//      「根據目前的 selectedId/hoverId 算出每個點該長什麼樣子」+
//      「使用者點擊/hover 時回報意圖(不是回報結果)」,兩個方向永遠
//      不會互相觸發對方,從結構上消滅這類環,不需要靠任何時序假設去
//      防堵。

/** MapPointKind——統一的點類型軸,取代原本 mapMarkers.ts
 *  searchResultMarkerContent 用 kind: 'hotel'|'place'|'geocode' 分流、
 *  但 usePlanStopMarkers 的 PlanStopMarker 完全沒有 kind 概念(靠逐點
 *  附加 glyph/size 客製,AiItineraryDetailPageMapView.tsx 把「美食點」
 *  跟「一般站點」混在同一個陣列裡的不一致做法)。
 *
 *  - 'attraction':一般站點/景點,三態(base/hover/selected)。
 *  - 'theme':主題點/聚合點——選中時展開範圍圓圈+children 顯示
 *    (取代原本 useThemeRadiusCircle 需要外部另外算 expandedThemeNode
 *    再傳 center/children 進來的做法,這裡只要點本身帶 children,內部
 *    用 selectedId 衍生判斷要不要展開)。
 *  - 'themeChild':主題點展開後的子景點——純展示小點,無法獨立被選取/
 *    hover(對齊 useThemeRadiusCircle 原本「子景點小點完全是純展示用
 *    途,沒有 onClick」的既有限制,這裡延續而非擴大範圍)。
 *  - 'featured':精選點(itineraries/AiItineraryDetailPageMapView.tsx
 *    美食清單點的語意延伸,跟一般站點共用選取焦點但可能需要視覺區分)。
 *  - 'custom':保留給未來擴充、這份型別還沒預先命名的點類型,搭配
 *    glyph/size 客製化,不需要為每個新用途都先修改這份列舉。
 */
export type MapPointKind = 'attraction' | 'theme' | 'themeChild' | 'featured' | 'custom'

/** MapMarkerPoint——單一個點的完整資料。children 只在 kind:'theme' 時
 *  有意義,驅動範圍圓圈+子景點小點(取代 useThemeRadiusCircle.ts
 *  ThemeChildPoint 的獨立型別,子景點直接巢狀在父點底下,不需要外部
 *  另外維護一份「目前展開到哪個主題點」的狀態去關聯兩者)。 */
export interface MapMarkerPoint {
  id: string
  lat: number
  lng: number
  name?: string
  kind: MapPointKind
  /** 疊在圓點正中央的 SVG fragment(食物 icon 等用途)——對齊
   *  usePlanStopMarkers.ts PlanStopMarker.glyph 的既有用法。 */
  glyph?: string
  /** 整顆圓點渲染尺寸,預設 14px——對齊 PlanStopMarker.size 的既有用法。 */
  size?: number
  /** 只在 kind:'theme' 時有意義。選中這個點時,若 children 非空,
   *  expandedThemeId 這個衍生值會指向這個點(見 index.ts 的完整
   *  說明,取代 useThemeRadiusCircle.ts THEME_RADIUS_METERS 固定半徑
   *  的既有設計,這裡延續)。 */
  children?: MapMarkerChildPoint[]
}

/** MapMarkerChildPoint——主題點展開後的子景點,純展示用,見 MapPointKind
 *  'themeChild' 的完整說明。 */
export interface MapMarkerChildPoint {
  id: string
  lat: number
  lng: number
  name?: string
}

/** HoverTransitPair——交通膠囊 hover 時,兩端站點同時進入 hover 視覺的
 *  訊號(取代 usePlanStopMarkers.ts hoverTransitPair 參數的既有用法,
 *  見 isHoverViaTransitPair 的完整說明:兩者同時命中同一個 id 時最終
 *  呈現 selected 優先)。只在 supportsHover 為 true 時有意義——手機版
 *  (supportsHover:false)完全不支援這個訊號,見下方 props 的完整說明。 */
export interface HoverTransitPair {
  fromId: string
  toId: string
}

/** MapMarkerLayerProps——useMapMarkerLayer 的輸入介面。
 *
 *  2026-10 改版為完全受控(fully controlled,見本檔開頭的完整說明):
 *  selectedId/hoverId 是這個 hook 唯一的事實來源輸入,不是「選填的
 *  受控覆寫」——省略時視為 null(沒有任何點被選取/hover),不會有
 *  「內部自主管理」這個分支。使用者點擊/hover 地圖上的點,只會透過
 *  onPointClick/onSelectedChange/onHoverChange 把意圖回報出去,呼叫端
 *  決定要不要真的更新 selectedId/hoverId 傳回來——這個 hook 本身永遠
 *  不會自己改變這兩個值,所以不可能形成「內部改→通知外部→外部寫回→
 *  又被當成新輸入」的環。 */
export interface MapMarkerLayerProps {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  points: MapMarkerPoint[]
  /** 選填,預設 true——hand-drawn 地圖樣式(不帶 mapId)無法使用
   *  AdvancedMarkerElement,見 planStopOverlay.ts 的完整說明,改走
   *  PlanStopOverlay(OverlayView 子類別)。對齊 usePlanStopMarkers.ts
   *  useAdvancedMarkers 參數的既有用法,這裡延續同一個切換機制,不是
   *  重新設計。 */
  useAdvancedMarkers?: boolean

  /** 目前被選取的點 id,null 代表沒有任何點被選取。完全受控——這個
   *  hook 不會自己改變這個值,只會透過 onPointClick/onSelectedChange
   *  回報「使用者想選哪個點」這個意圖,呼叫端決定是否採納、並把新值
   *  傳回來。省略視同 null。 */
  selectedId?: string | null
  /** 目前 hover 中的點 id。只在 supportsHover 為 true 時有意義,
   *  supportsHover:false 時這個值被完全忽略,視覺上恆為 base
   *  (非 selected 時)。完全受控,語意同 selectedId。省略視同
   *  null。 */
  hoverId?: string | null
  /** 只在 supportsHover 為 true 時有意義。 */
  hoverTransitPair?: HoverTransitPair | null

  /** supportsHover——預設 true。false 時(例如
   *  HorizontalPlanTimeline.tsx 手機版橫向卡片列,捲動置中即等同選取,
   *  沒有滑鼠 hover 這件事,見該元件 handleScroll 的既有說明)
   *  hoverId/hoverTransitPair 被完全忽略、onHoverChange 不會被觸發——
   *  徹底消除「有 hover 概念但永遠不觸發」的空轉邏輯,而不是維持一套
   *  永遠用不到的分支。這是本次重構「手機/桌面共用核心邏輯,只有少數
   *  行為是特例」的具體落實方式:共用同一份邏輯,用這個旗標關閉其中
   *  一部分行為,不是另外寫一份平行邏輯。 */
  supportsHover?: boolean

  /** panTo 行為——selectedId 改變(不論是受控輸入還是使用者點擊 marker
   *  觸發)時,是否要移動地圖中心過去。預設 false(對齊
   *  AiItineraryDetailPageMapView.tsx「center/ZOOM 固定不變,沒有
   *  panTo/panBy 行為」的既有情境,不是每個呼叫端都需要自動移動視角)。
   *  使用者手動拖曳地圖/捲動卡片列期間(見 pauseAutoPan 的完整說明)
   *  這個自動 panTo 會暫停,不會搶走使用者正在操作的畫面。
   *
   *  範圍邊界(2026-10 差異比對報告的結論,接線 ExploreMap.tsx 前必讀):
   *  這裡的 panTo 只對應 AIPlanTimelinePage.tsx 原本「只依
   *  selectedStopId、無節流」那條 panTo effect 的語意。ExploreMap.tsx
   *  自己的 panTarget 機制(onlyIfOutOfView、suppressQuery,跟地圖
   *  idle→查詢→渲染生命週期深度耦合)跟 AIPlanTimelinePage 手機版的
   *  panBy 位移補償(跟選取完全無關,是時間軸高度變化的防抖)是另外
   *  兩套完全不同語意的平移邏輯,這個 hook 刻意不嘗試吸收它們——
   *  ExploreMap.tsx 接線這個 hook 時應該維持 autoPanOnSelect:false,
   *  自己監聽 onSelectedChange 後用既有的 panTarget 機制決定要不要
   *  移動地圖,不要同時啟用這裡的 autoPanOnSelect,否則會重複觸發
   *  panTo、甚至重現「渲染→panTo→idle→觸發查詢→又渲染」的迴圈。 */
  autoPanOnSelect?: boolean
  /** pauseAutoPan——呼叫端告知「使用者目前正在手動操作,暫停自動
   *  panTo」的受控旗標(例如 HorizontalPlanTimeline.tsx 使用者手指
   *  按著卡片列拖曳中、或選取了非最新那張卡片正在回看)。取代原本
   *  usePlanStopMarkers.ts 沒有這層防護、且 AIPlanTimelinePage.tsx
   *  panTo effect 本身也沒有這道防線的狀態——見本次重構討論的完整
   *  脈絡(使用者明確要求「選擇群組卡片時」「使用者拉動到其他卡片時,
   *  不要自動捲到最新」這類情境都需要暫停自動對焦)。 */
  pauseAutoPan?: boolean

  // 雙向事件——使用者操作地圖上的點時向外回報,對齊「事件雙向」的設計
  // 要求,統一用這組介面,取代原本 ExploreMap.tsx 的 onPlanStopClick、
  // AIPlanTimelinePage.tsx 的 onStopClick 兩套不同命名各自接線的做法。
  //
  // 2026-10 改版:這三個回調全部是「意圖通知」,不是「結果回報」——
  // 呼叫這個 hook 的當下不代表內部任何狀態已經改變(這個 hook 根本
  // 沒有可以改變的內部選取/hover state 了),純粹是「使用者對這個點
  // 做了一個操作,呼叫端自行決定要不要更新 selectedId/hoverId 傳回
  // 來」。
  /** 使用者點擊地圖上的一個點時觸發(不分 kind,themeChild 目前不可
   *  點擊,見 MapPointKind 的完整說明,不會觸發這個事件)。 */
  onPointClick?: (id: string, point: MapMarkerPoint) => void
  /** 使用者點擊地圖上的點時觸發(與 onPointClick 同時觸發,只是簽名
   *  更單純、只帶 id)——取代原本「內部 reducer 改變時才通知」的語意,
   *  現在單純是「使用者想選這個點」的意圖通知,呼叫端決定要不要真的
   *  把這個值寫回 selectedId 傳回來。 */
  onSelectedChange?: (id: string | null) => void
  /** 使用者 hover 進入/離開地圖上的點時觸發(只在 supportsHover 為
   *  true 時會被呼叫)。語意同 onSelectedChange,純粹是意圖通知。 */
  onHoverChange?: (id: string | null) => void
}
