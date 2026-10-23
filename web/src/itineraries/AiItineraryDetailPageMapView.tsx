import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react'
import { PlanTimelineView } from '../planning/timeline/PlanTimelineView'
import { listNodes, lodgingsOf, type PlanTimeline } from '../planning/timeline/model'
import { lodgingMapMarkers } from '../planning/timeline/resolved'
import { useResolvedRefs } from '../planning/data/PlanDataProvider'
import { Lightbox } from '../planning/place/PhotoCarousel'
import type { MapHandle } from '../planning/map/NativeMapBase'
import { SIMPLE_MAP_ID } from '../planning/map/mapStyleIds'
import type { PlanStopMarker } from '../planning/map/marker/planStops'
import { useMapSafeArea } from '../planning/map/useMapSafeArea'
import { useStopCardClick } from '../planning/map/useStopPan'
import { useFirstStopAutoPan } from '../planning/map/useFirstStopAutoPan'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { createRenderOnsenAutumnStopCard } from './renderOnsenAutumnStopCard'
import { MAPLE_LEAF_PATH, MAPLE_STEM_PATH } from './mapleLeafPath'
import { renderAnchorIcon } from './renderAnchorIcon'
import { maskPlanStopsView, usePlanSelection } from '../planning/timeline/usePlanStopsState'
import { routeSegmentsFromTimeline } from '../planning/timeline/segments'
import { PlanLayout } from './PlanLayout'
import { PlanOverlayLayout } from './PlanOverlayLayout'
import { PlanMap } from './PlanMap'
import { FoodSpotPanel } from './FoodSpotPanel'
import { useFoodSpotDetails } from './useFoodSpotDetails'
import { ImportToPlanButton } from './ImportToPlanButton'
import { initialCenterOf } from './initialCenter'
import { useCityAttractionGlow } from './useCityAttractionGlow'
import { dayCountOf, stopCountOf } from './catalog'
import type { SampleItinerary } from './types'
import styles from './AiItineraryDetailPageMapView.module.css'

// TreasureScrollBorder/MapVignette——寶藏地圖風格的地圖裝飾(2026-10
// 數輪改版,取代最早的 CastleWallBorder 不規則城牆輪廓)。使用者分享
// 一張手繪尋寶地圖插畫當初始參考,原本做過捲軸造型(上下捲曲收邊+
// 左右撕裂邊),但使用者後續明確拍板「不要捲軸的部分,保留圖紙就好」
// ——撕裂邊(TornEdge)跟上下捲筒(scrollRoll)已整個移除,目前只保留:
//   1. 羊皮紙暈影(MapVignette,.scrollSheet,CSS linear-gradient)——
//      左右兩側往內漸淡的米黃色暈,把地圖底圖「染」成紙張質感,中央
//      保持透明不影響站點/路網可讀性,上下不淡化(見 .scrollSheet
//      的完整說明)。放在 .mapBackdrop 內部、跟地圖畫布同一層級。
//   2. 指北針(TreasureScrollBorder 僅剩 CompassRose,.scrollCompass,
//      SVG)——寶藏地圖的標準配件,擺在桌面版兩側面板之間的可見區域
//      下緣,低調不搶地圖本身的視覺焦點(這是功能頁面,不是純裝飾頁)。
//
// TreasureScrollBorder 是 .page 的直接子層(不在 .mapBackdrop 裡面),
// z-index 高於兩側面板,確保指北針貼在畫面最外緣、不被面板蓋住;
// MapVignette 則維持在 .mapBackdrop 內部。兩者都 pointer-events:none,
// 純裝飾不能擋住底下地圖的拖曳/縮放/點擊手勢。.mapBackdrop 本身已經
// 是 position:absolute,足以當子層的定位基準,絕對不要再給
// .mapBackdrop 疊加任何宣告 position 的 class(見 .module.css
// mapBackdropCastle 被移除的完整說明——那次就是這樣讓地圖塌縮的)。

// FOOD_MARKER_GLYPH——2026-10 新增,使用者明確要求「地圖上的食物小點
// 顯示食物 icon」,後續回報「地圖上顯示美食 icon 還沒做」(實機確認
// 圓點本身有畫出來,只是圖示完全看不見):原本的叉匙組合用
// stroke-width:0.7 的雙線條+小橢圓,在 14x14 畫布實際渲染到螢幕上
// (AdvancedMarkerElement 不會放大這個 SVG,marker 整體只有約 14~20px)
// 幾乎等於消失,抗鋸齒後線條細到不可辨識——改成單一個實心圓形餐盤
// + 一根粗直線刀叉符號,線寬拉高到 1.6(原本的兩倍以上),形狀也從
// 「精細線稿」簡化成「單一色塊圖樣」,在這個極小尺度下更容易被辨識
// 出「這是食物相關的點」,不追求精確還原真實餐具輪廓。座標系配合
// planStopMarkerContent 固定的 14x14 畫布、圓心 (7,7),圖示整體控制
// 在半徑 5.5~6.5px 的圓點範圍內,線條用白色(跟圓點內的彩色填色形成
// 對比,呼應其餘 marker 圖示一律白線的既有慣例,見 PLACE_CATEGORY_GLYPHS
// 的完整說明)。
const FOOD_MARKER_GLYPH =
  '<g stroke="#FDFCFA" stroke-width="1.6" stroke-linecap="round" fill="none">' +
  '<line x1="7" y1="4" x2="7" y2="10"/><line x1="4.6" y1="4" x2="4.6" y2="6.2"/><line x1="9.4" y1="4" x2="9.4" y2="6.2"/>' +
  '</g>'

// FOOD_MARKER_SIZE——2026-10 新增,使用者回報「圖案太小了」:美食
// marker 整顆圓點(含上方的 FOOD_MARKER_GLYPH)放大到 22px(預設
// 14px 的約 1.6 倍),傳給統一繪製層的 PlanStopMarker.size
// (見該欄位與 mapMarkers.ts planStopMarkerContent size 參數的完整
// 說明)——viewBox 固定不變,只放大 <svg> 外層的 width/height,圓點
// 本體跟 glyph 會一起等比縮放,不需要重新調整任何座標。時間軸站點
// marker(stopMarkers)不傳這個欄位,維持原本 14px,只有美食清單的點
// 放大,呼應使用者「只影響美食點」的確認。
const FOOD_MARKER_SIZE = 22

// CompassRose——指北針(見 TreasureScrollBorder 的完整說明)。固定
// 正方形 viewBox,四個主方位的菱形尖角 + 四個次方位的短尖角 + 外圈,
// N 用路徑畫一個小三角旗標在頂端而不是文字——避免字型差異讓這個小
// 裝飾在不同平台長得不一樣。
function CompassRose() {
  return (
    <svg className={styles.scrollCompass} viewBox="0 0 80 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="40" cy="40" r="34" className={styles.compassDisc} />
      <circle cx="40" cy="40" r="34" className={styles.compassRing} />
      <circle cx="40" cy="40" r="26" className={styles.compassRingInner} />
      <path d="M 40 40 L 32 32 L 40 12 Z M 40 40 L 48 32 L 68 40 Z M 40 40 L 48 48 L 40 68 Z M 40 40 L 32 48 L 12 40 Z" className={styles.compassStarDark} />
      <path d="M 40 40 L 48 32 L 40 12 Z M 40 40 L 48 48 L 68 40 Z M 40 40 L 32 48 L 40 68 Z M 40 40 L 32 32 L 12 40 Z" className={styles.compassStarLight} />
      <path d="M 40 40 L 54 26 M 40 40 L 54 54 M 40 40 L 26 54 M 40 40 L 26 26" className={styles.compassMinor} />
      <circle cx="40" cy="40" r="3" className={styles.compassPin} />
      <path d="M 36 9 L 40 3 L 44 9 Z" className={styles.compassNorth} />
    </svg>
  )
}

// TreasureScrollBorder——2026-10 改版,使用者連續回報「左右兩邊上下
// 的捲軸都沒出現」「外框就給一個容器,淡化坐在容器內部」,接著明確
// 拍板「不要捲軸的部分,保留圖紙就好」:移除撕裂邊(TornEdge)跟上下
// 捲筒(scrollRoll)——這兩者原本是「紙張捲成一卷」這個造型隱喻的主體,
// 使用者確認不需要這層造型,只保留「圖紙」質感本身:
//   - MapVignette(見下方):羊皮紙暈影,左右淡化,維持不變。
//   - CompassRose:寶藏地圖的指北針裝飾,使用者確認保留。
// z-index 仍要高於兩側面板(見 .scrollFrame 的完整說明),確保指北針
// 不被面板蓋住。
function TreasureScrollBorder() {
  return (
    <div className={styles.scrollFrame} aria-hidden="true">
      <CompassRose />
    </div>
  )
}

// MapVignette——左右淡化暈影,獨立於 TreasureScrollBorder 之外(見上方
// 完整說明),疊在地圖畫布正上方、兩側面板之下。
// dark——夜間模式時改用暗色暈影(淺米色的羊皮紙漸層疊在暗色地圖上會變成一條
// 突兀的亮邊)。
function MapVignette({ dark = false }: { dark?: boolean }) {
  return <div className={dark ? `${styles.scrollSheet} ${styles.scrollSheetDark}` : styles.scrollSheet} aria-hidden="true" />
}

// ===== 楓葉相框(borderStyle:'maple-leaf',2026-10 新增)。使用者要求
// 定山溪溫泉街紅葉散策一日遊(jozankei-1day)的地圖外框改成「楓葉相框」
// ——這份行程的主題是紅葉季散策(紅色吊橋、免費足湯、山洞觀音),寶藏
// 地圖的指北針/羊皮紙跟它的氣氛不搭。架構完全比照 TreasureScrollBorder/
// MapVignette 這一對(見上方完整說明),只換主題:
//   1. MapleVignette(.mapleSheet)——暖橘色左右暈影,同樣只淡化左右、
//      上下不淡化,放在 .mapBackdrop 內部跟地圖畫布同一層級。
//   2. MapleLeafBorder(.mapleFrame)——四個角落各一叢楓葉(MapleLeafCorner,
//      SVG),取代指北針;是 .page 的直接子層、z-index 高於兩側面板,
//      pointer-events:none,跟 .scrollFrame 同一套定位/堆疊規則。
// 走哪一對由 itinerary.borderStyle 決定(見 types.ts 的完整說明),未設定
// 時退回寶藏地圖那一對,其餘行程完全不受影響。

// MAPLE_LEAF_PATH/MAPLE_STEM_PATH——楓葉輪廓常數,2026-10 抽到
// mapleLeafPath.ts 跟秋日泡湯卡片主題共用(見該檔案的完整說明)。

// MapleLeaf——一片楓葉,呼叫端用 SVG transform 決定位置/角度/大小,
// 顏色由 className 決定(.mapleLeafRed/.mapleLeafOrange/.mapleLeafGold,
// 紅/橘/金三種秋色,見 .module.css 的完整說明)。
function MapleLeaf({ className, transform }: { className: string; transform: string }) {
  return (
    <g className={className} transform={transform}>
      <path d={MAPLE_LEAF_PATH} />
      <path d={MAPLE_STEM_PATH} className={styles.mapleStem} />
    </g>
  )
}

// MapleLeafCorner——一叢楓葉(四片:一大三小,紅橘金交錯),畫在
// 160x160 viewBox、以左上角 (0,0) 為根部向外散開。四個角落共用同一組
// 幾何,右上/左下/右下靠 CSS transform 鏡射(.mapleCornerTr 等),不
// 另外畫三套座標——鏡射後的葉片方向在這個尺度下看不出「不自然」,
// 維護成本低很多。preserveAspectRatio 用 xMidYMid slice 而非 none,
// 跟 CompassRose 的慣例一致,避免寬螢幕下被拉扁。
function MapleLeafCorner({ cornerClassName }: { cornerClassName: string }) {
  return (
    <svg className={`${styles.mapleCorner} ${cornerClassName}`} viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <MapleLeaf className={styles.mapleLeafGold} transform="translate(112 44) rotate(70) scale(0.5) translate(-50 -50)" />
      <MapleLeaf className={styles.mapleLeafOrange} transform="translate(90 20) rotate(35) scale(0.62) translate(-50 -50)" />
      <MapleLeaf className={styles.mapleLeafGold} transform="translate(26 104) rotate(-75) scale(0.58) translate(-50 -50)" />
      <MapleLeaf className={styles.mapleLeafOrange} transform="translate(52 72) rotate(-20) scale(0.5) translate(-50 -50)" />
      <MapleLeaf className={styles.mapleLeafRed} transform="translate(40 36) rotate(-35) scale(0.9) translate(-50 -50)" />
    </svg>
  )
}

// MapleLeafBorder——楓葉相框的邊框裝飾容器(對應 TreasureScrollBorder),
// 四角各一叢楓葉。z-index/pointer-events 規則同 .scrollFrame(見
// .mapleFrame 的完整說明)。
function MapleLeafBorder() {
  return (
    <div className={styles.mapleFrame} aria-hidden="true">
      <MapleLeafCorner cornerClassName={styles.mapleCornerTl} />
      <MapleLeafCorner cornerClassName={styles.mapleCornerTr} />
      <MapleLeafCorner cornerClassName={styles.mapleCornerBl} />
      <MapleLeafCorner cornerClassName={styles.mapleCornerBr} />
    </div>
  )
}

// MapleVignette——暖橘色左右暈影(對應 MapVignette),疊在地圖畫布正
// 上方、兩側面板之下。
function MapleVignette({ dark = false }: { dark?: boolean }) {
  return <div className={dark ? `${styles.mapleSheet} ${styles.mapleSheetDark}` : styles.mapleSheet} aria-hidden="true" />
}

// AiItineraryDetailPageMapView — 「台南赤崁兩日遊」試作用的地圖基底展示版面
// (2026-10 新增)。使用者明確要求「先在其中一份行程試作一個加入地圖基底的
// 展示頁」,設計方向比照 /ai-plan 展示頁(planning/preview/Content.tsx)
// 的版面語言:整頁地圖全幅背景 + 側欄式時間軸,不是原本
// AiItineraryDetailPage.tsx 那種單欄唱讀排版。
//
// 由 AiItineraryDetailPage.tsx 依 id === 'tainan-chikan-2day' 條件分支渲染
// 這個元件,其餘 5 份行程完全不受影響、仍走原本的版面(見該檔案的分支
// 說明)。這裡刻意不建立獨立路由——使用者已確認「不要新建獨立路由/檔案」
// 的實作方式,只是把這個版本拆成同目錄的獨立檔案,讓兩種版面各自的 JSX
// 不互相糾纏,純粹是程式組織考量,不是路由層級的分流。
//
// 地圖基底沿用 planning/preview/Content.tsx 的標準用法:NativeMapBase 只建立地圖
// 實例(center/zoom/mapId/onHandleChange),統一繪製層(useSharedDrawLayer 的 planStopLayer)把站點畫成
// 圓點並處理選取/hover 視覺——這兩者都是「只做原生配置/圖層」的最小元件,
// 這裡的職責只是組裝,不重新實作地圖邏輯。
//
// 時間軸直接重用 PlanTimelineView(跟唯讀版本、/ai-plan、登入後 /app 都是
// 同一份渲染邏輯),疊成側欄面板蓋在地圖上方——對齊 planning/preview/Content.tsx
// 桌面版「左地圖/右資訊欄」的做法,但這裡沒有該頁面複雜的串流生成/拖拉/
// 備註等機制,是純讀展示,所以不傳 onRemoveStop/getStopTimeDragBounds 等
// 編輯類 props,跟 AiItineraryDetailPage.tsx 原本唯讀版本的取捨一致。

const ZOOM = 15

// dark——頁面目前是不是夜間模式(由 AiItinerariesRoute 的 useThemeToggle 決定,
// 經 AiItineraryDetailPage 傳進來)。必須明確傳給 NativeMapBase 的 theme:
// 不傳的話它拿到 null,走 mapId 的地圖會永遠用預設淺色。
export function AiItineraryDetailPageMapView({ itinerary, timeline, dark = false }: { itinerary: SampleItinerary; timeline: PlanTimeline; dark?: boolean }) {
  // timeline——頁面(AiItineraryDetailPage)那一份唯一的時間軸:站點座標已從共用 store 蓋上,見 useResolvedItineraryTimeline.ts。
  // steps——依序列出全部節點(不含天的標題),給地圖標記、鏡頭、路線這些「查節點」用途;視圖本身吃 timeline。
  const steps = useMemo(() => listNodes(timeline), [timeline])
  // lodgings/lodgingRefs——住宿(PlanTimeline.lodgings)的 placeId 經訪客版資料存取層解析(與站點座標同一條路徑):
  // 名稱給時間軸的住宿橫幅,座標給下方 mapStops 的旅館圓點。
  const lodgings = lodgingsOf(timeline)
  const lodgingRefs = useResolvedRefs(steps, lodgings)
  // center——依這份行程自己的站點動態算(見 initialCenter.ts)。依賴整個 itinerary 物件:同 id 的內容換版(靜態版換成資料庫版)
  // 時中心要跟著更新;呼叫端(AiItineraryDetailPage)給的是穩定參照,不會每次 render 重算。
  const center = useMemo(() => initialCenterOf(itinerary), [itinerary])
  // isHandDrawn——行程資料的 mapStyle 欄位(見 types.ts)是否為 'hand-drawn'。地圖底圖一律用 SIMPLE_MAP_ID,
  // 這個值不再換底圖,只當 isPlayfulUI 的預設值。
  const isHandDrawn = itinerary.mapStyle === 'hand-drawn'
  // isPlayfulUI——2026-10 新增,使用者明確要求「圖卡加入一些手繪卡通
  // 樣式,活潑一點」「外框做得像古城風格的遊戲地圖邊框」,後續明確拍板
  // 「tainan-chikan-2day 要套用,但地圖底圖配色仍維持簡化版」:這是獨立
  // 於 isHandDrawn(只控制地圖底圖配色)的另一個維度,見 types.ts
  // SampleItinerary.playfulUI 的完整說明。優先讀行程資料自己宣告的
  // playfulUI,未設定時退回 isHandDrawn 當預設值——這是為了讓
  // erziping-1day(目前只設定了 mapStyle:'hand-drawn',沒有另外設定
  // playfulUI)維持原本「手繪地圖配色自動連帶活潑卡片/邊框」的既有
  // 行為不被這次改動破壞,新加入的行程則可以兩個欄位各自獨立宣告。
  const isPlayfulUI = itinerary.playfulUI ?? isHandDrawn
  // isMapleBorder——2026-10 新增,地圖外框裝飾走楓葉相框還是寶藏地圖
  // (見 types.ts SampleItinerary.borderStyle 與上方「楓葉相框」的完整
  // 說明)。只有明確設定 'maple-leaf' 才走楓葉那一對;未設定或
  // 'treasure-map' 都走原本的 TreasureScrollBorder/MapVignette,確保
  // 沒設定這個欄位的既有行程行為不變。是否渲染仍由 isPlayfulUI 把關,
  // borderStyle 只決定主題。
  const isMapleBorder = itinerary.borderStyle === 'maple-leaf'
  // renderStopCard——一般行程不傳,直接用 PlanTimelineView 的預設景點卡(與 /ai-plan、登入後同一張卡);
  // 只有行程資料宣告 cardTheme:'onsen-autumn'(目前只有 jozankei-1day)時才換成秋日泡湯主題卡。
  const cardTheme = itinerary.cardTheme
  const renderStopCard = useMemo(
    () => (cardTheme === 'onsen-autumn' ? createRenderOnsenAutumnStopCard() : undefined),
    [cardTheme],
  )
  // foodSpots——2026-10 改版,使用者明確要求「將目前模擬的資料改成串接
  // 真的 API 資料」:小豪洲沙茶爐中山店/阿蓮牛肉湯這兩筆已經用 CLI
  // (itinerary-page set)寫進 tainan-chikan-2day 的 itinerary_pages
  // content JSON(見 types.ts SampleFoodSpot 的完整說明),這裡直接讀
  // API 回傳的 itinerary.foodSpots,不再有前端模擬資料 fallback——
  // foodSpotFixtures.ts 已刪除。沒有這個欄位的行程(itinerary.foodSpots
  // 為 undefined)退回空陣列,FoodSpotPanel 在空陣列時不渲染任何東西。
  const foodSpots = itinerary.foodSpots ?? []
  // foodSpotDetails——美食清單各筆的照片/座標查詢結果(見 useFoodSpotDetails.ts
  // 的完整說明),同一份結果同時餵給下方 FoodSpotPanel(縮圖)跟
  // mapStops(座標,見該處的完整說明)。
  const foodSpotDetails = useFoodSpotDetails(foodSpots)
  // selectedStopId/hoverStopId——2026-10 改版,使用者明確要求「地點要在
  // 地圖繪製圖點,要跟圖卡點選關聯」:時間軸站點跟美食清單圖卡共用同一組
  // 選取/hover state,不是分開兩組各自獨立——理由是整個頁面只有一張地圖,
  // 選取焦點本來就該是單一的(點了一張美食圖卡,時間軸站點的高亮理應
  // 隨之清除,反之亦然),而不是「地圖上同時有一顆時間軸選取點跟一顆
  // 美食選取點並存」。兩種 id 命名空間天然不衝突(時間軸站點 id 是
  // `${itinerary.id}-s${i}`,美食清單 id 是 content JSON foodSpots 裡的
  // `food-1`/`food-2` 等),PlanTimelineView 用這個值跟時間軸卡片自己的
  // id 比對時,美食清單的 id 不會誤命中任何時間軸卡片,FoodSpotPanel 同理。
  // 選取與 hover 用共用的 usePlanSelection(planning/timeline/usePlanStopsState,/ai-plan 模擬態、登入後也是它的同一份狀態形狀)。
  const { selectedStopId, hoverStopId, setSelectedStopId, setHoverStopId } = usePlanSelection()
  const [lightbox, setLightbox] = useState<{ photos: string[]; alt: string } | null>(null)
  const mountedIdsRef = useRef<Set<string>>(new Set())

  // 光暈資料:依行程所在城市查已建檔的景點區域(獨立 hook,見 useCityAttractionGlow.ts)。
  const { attractionGlow } = useCityAttractionGlow(itinerary.region)

  // mapHandle——NativeMapBase 建圖完成後回報的控制代碼,統一繪製層需要 mapRef/mapReady
  // 才能把站點 marker 掛到這個地圖實例上,寫法對齊 planning/preview/Content.tsx 的既有用法。
  const [mapHandle, setMapHandle] = useState<MapHandle>({ mapRef: { current: null }, mapReady: false, mapVersion: 0 })
  const handleMapHandleChange = useCallback((handle: MapHandle) => {
    setMapHandle(handle)
  }, [])
  // 點選圖卡的鏡頭移動:與 /ai-plan、登入後桌面同一個共用處理(planning/map/useStopPan.ts 的 useStopCardClick)——選取該站並平移到
  // 沒被面板蓋住的地圖範圍中心(PlanOverlayLayout 的 safe-area 節點,經 useMapSafeArea 讀)。
  const mapSafeArea = useMapSafeArea(mapHandle.mapRef)
  const panToStop = useStopCardClick({ select: setSelectedStopId, pan: mapSafeArea.panToWithinSafeArea })
  // 首站自動平移:手機才有(桌面的鏡頭統一只由點選圖卡移動,規則同 /ai-plan、登入後);與其他入口同一個共用 hook,
  // 依安全區把第一站移到沒被面板蓋住的地圖中心。stops 取時間軸第一個有座標的站(不含美食清單)。
  const isDesktop = useIsDesktop()
  const firstStopTargets = useMemo(() => {
    const first = steps.find((s) => s.type === 'stop' && s.lat != null && s.lng != null)
    return first ? [{ lat: first.lat!, lng: first.lng! }] : []
  }, [steps])
  useFirstStopAutoPan({
    stops: firstStopTargets,
    enabled: !isDesktop,
    ready: mapHandle.mapReady && !!mapHandle.mapRef.current,
    pan: mapSafeArea.panToWithinSafeArea,
  })

  // mapStops——只取已經有座標的 stop 節點,理由同 planning/preview/Content.tsx
  // 的 mapStops:section/message 本來就不是地點,沒有座標的節點畫不出來。
  // 2026-10 擴充:美食清單各筆若已查到座標(foodSpotDetails,見
  // useFoodSpotDetails.ts 的完整說明),一併併入同一個陣列,用同一個
  // 站點圖層(planStopLayer)畫出來——不建立第二個 marker 圖層,理由同上方
  // selectedStopId 的完整說明,這兩種點本質上是「同一張地圖上可被選取
  // 的地點」,沒有必要拆成兩套獨立的畫點/選取邏輯。
  const mapStops = useMemo<PlanStopMarker[]>(() => {
    const stopMarkers = steps
      .filter((s) => s.type === 'stop' && s.lat != null && s.lng != null)
      .map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, name: s.name }))
    const foodMarkers: PlanStopMarker[] = []
    for (const spot of foodSpots) {
      const d = foodSpotDetails[spot.id]
      if (d?.lat != null && d?.lng != null) {
        foodMarkers.push({ id: spot.id, lat: d.lat, lng: d.lng, name: spot.name, glyph: FOOD_MARKER_GLYPH, size: FOOD_MARKER_SIZE })
      }
    }
    // 旅館圓點:座標由 placeId 查到才有,樣式見 LODGING_MARKER_GLYPH;連線只由行程節點切段,旅館不在線上。
    return [...stopMarkers, ...lodgingMapMarkers(lodgings, lodgingRefs), ...foodMarkers]
  }, [steps, lodgings, lodgingRefs, foodSpots, foodSpotDetails])

  // routeSegments——站點之間的連線:有交通膠囊的那一段才畫,規則在 planning/timeline/segments.ts(三個入口共用,
  // 2026-10-24 起與 /ai-plan、登入後同一個 routeLineLayer、同一個主題強調色;原本這頁依天換色的 routePolylineLayer 已移除)。
  // 這頁沒有功能開關,一律傳給 PlanMap。
  const routeSegments = useMemo(() => routeSegmentsFromTimeline(timeline), [timeline])

  // 站點圓點與連線都由統一繪製層畫出:站點圓點走 useSharedDrawLayer 的 planStopLayer、連線走 routeLineLayer
  // (與 /ai-plan、登入後同一個宿主與功能層)。
  //   - 站點(含美食清單的 glyph 與 size)、選取、hover 都由這頁自己持有(受控),點地圓點只回報意圖
  //     (onPointClick):點時間軸卡片 → setSelectedStopId(見下方 onPanToStop);點地圖圓點 → 同一個 state,
  //     兩個方向共用同一份事實來源(使用者要求的雙向連動)。
  // stopsView——站點檢視,與其他入口同一種帶入方式:站點、選取、hover、轉乘配對四個欄位(欄位名與 PlanMap 的 prop 同名),
  // 經 maskPlanStopsView 遮蔽後直接展開給 PlanMap。這頁的站點是靜態行程(解析後的行程轉出的 mapStops),面板永遠顯示,
  // 所以 visible 恆為 true;沒有轉乘膠囊 hover 的來源(hoverTransitPair 恆為 null)。
  const stopsView = useMemo(
    () => maskPlanStopsView({ stops: mapStops, selectedStopId, hoverStopId, hoverTransitPair: null }, true),
    [mapStops, selectedStopId, hoverStopId],
  )

  return (
    <PlanLayout>
      <PlanOverlayLayout
        safeAreaRef={mapSafeArea.safeAreaElRef}
        passThrough
        mapBackground={
          <div className={styles.mapBackdrop}>
            <PlanMap
              initialCenter={center}
              zoom={ZOOM}
              theme={dark ? 'dark' : 'light'}
              mapId={SIMPLE_MAP_ID}
              {...stopsView}
              onStopClick={setSelectedStopId}
              attractionGlow={attractionGlow}
              routeSegments={routeSegments}
              onHandleChange={handleMapHandleChange}
            >
              {isPlayfulUI && (isMapleBorder ? <MapleVignette dark={dark} /> : <MapVignette dark={dark} />)}
            </PlanMap>
          </div>
        }
      >
        <header className={styles.header}>
          <h1 className={styles.title}>{itinerary.title}</h1>
          <div className={styles.meta}>
            <span className={styles.metaItem}><MapPin size={13} strokeWidth={2} />{itinerary.region}</span>
            <span className={styles.metaItem}><CalendarDays size={13} strokeWidth={2} />{dayCountOf(itinerary)} 天 · {stopCountOf(itinerary)} 站</span>
          </div>
          <p className={styles.summary}>{itinerary.summary}</p>
          <ImportToPlanButton timeline={timeline} />
        </header>
        <PlanTimelineView
          timeline={timeline}
          isThinking={false}
          emptyStateMessage=""
          hideEmptyState
          endMarkerMessage="行程結束"
          selectedStopId={selectedStopId}
          onHoverStop={setHoverStopId}
          showJumpPill={false}
          onJumpToLatest={() => {}}
          onPanToStop={panToStop}
          onOpenPhotos={setLightbox}
          mountedIdsRef={mountedIdsRef}
          scrollClassName={styles.timelineScroll}
          endMarkerClassName={styles.timelineEndMarker}
          renderStopCard={renderStopCard}
          renderAnchorIcon={renderAnchorIcon}
          anchorDotSize={22}
        />
      </PlanOverlayLayout>
      {isPlayfulUI && (isMapleBorder ? <MapleLeafBorder /> : <TreasureScrollBorder />)}

      <Link to="/itineraries" className={styles.back}><ArrowLeft size={14} strokeWidth={2} />所有範例行程</Link>

      <FoodSpotPanel
        spots={foodSpots}
        detailsById={foodSpotDetails}
        selectedSpotId={selectedStopId}
        onSelectSpot={setSelectedStopId}
        onHoverSpot={setHoverStopId}
        isPlayful={isPlayfulUI}
      />

      {lightbox && <Lightbox photos={lightbox.photos} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </PlanLayout>
  )
}
