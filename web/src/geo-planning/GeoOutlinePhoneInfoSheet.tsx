import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../api'
import { fetchGeoPlaceDetails, fetchPublicGeoPlaceDetails } from '../api'
import type { PlaceInfoContent } from './PlacePanel'
import { attractionBadges } from './geoInfoContent'
import { candidateHasScheduledDate, type GeoCandidate } from './geoCandidateHelpers'
import { reduceAddCandidateUiState, initialAddCandidateUiState } from './geoAddCandidateState'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS } from '../components/PhoneBottomSheet'
import { PhotoCarousel } from './PhotoCarousel'
import { nearbyCategoriesPresent, filterNearbyByCategory, type NearbyAttraction } from './geoNearbyAttractions'
import {
  curatedCategoryOf,
  CURATED_CATEGORY_ICONS,
  CURATED_CATEGORY_LABELS,
  CURATED_CATEGORY_MAP_CLASS,
  type CuratedCategory,
} from './geoCuratedCategoryStub'
import styles from './GeoOutlinePhoneInfoSheet.module.css'

// ADDED_HINT_MS:「加入行程」icon 按鈕成功後短暫變成打勾圖示的顯示時長
// ——使用者明確要求加入行程要有提示,選按鈕本身文字/圖示短暫變化(而非
// 額外的浮動 toast),故不需要另外佔用畫面空間。1200ms 足夠讓使用者
// 注意到變化,又不會長到讓人以為卡住。
const ADDED_HINT_MS = 1200

// SHEET_MIN_HEIGHT/SHEET_SNAP_POINTS:三段式吸附,見
// components/PhoneBottomSheet.tsx 的說明(minHeightPx + snapPoints 兩個
// 參數合起來決定段落,不再用 vh 高度百分比,改用固定 px——SHEET_MIN_HEIGHT
// 是收合段的固定高度,SHEET_SNAP_POINTS 是其餘展開段的離頂部距離,由大到
// 小排序)——
// SHEET_MIN_HEIGHT:最小/收合狀態的固定高度,只顯示標頭。TODO(使用者
// 稍後決定合理數值):暫時估算,先讓編譯通過。
// SHEET_SNAP_POINTS:
// [0] 中間狀態:能看到圖片+標頭,簡介文字部分被截斷(卡片高度不夠完整
//     顯示,使用者可以再往上拉到 SHEET_SNAP_POINTS[1] 或靠 .body 的
//     overflow-y: auto 捲動看更多)。
// [1] 滿版/展開狀態:完整內容,離頂部距離比索引 0 更小(展開更多)。
// TODO(使用者稍後決定合理數值):暫時估算。
const SHEET_MIN_HEIGHT = 100
const SHEET_SNAP_POINTS = [400, 80]

// GeoOutlinePhoneInfoSheet:手機版規劃地圖資訊卡,從畫面下方滑入蓋住下
// 半部——桌面版對應的 PlacePanel/AttractionInfoPanel 是絕對定位疊在
// 地圖右緣的浮動卡片,手機螢幕沒有那個空間,改用 bottom sheet(同 iOS/
// Material Design 地圖 App 的資訊卡呈現方式)。
//
// 外殼(backdrop/panel/dragHandle)與拖曳手勢改用共用容器
// components/PhoneBottomSheet.tsx(mode="snap"),對齊 GeoOutlinePhoneListDrawer.tsx
// 「整張卡片都能拖曳,不限頂部把手」的觸控區域(使用者明確要求),但
// 「拖曳到底」的語意跟地點清單不同,不是滑出畫面消失,而是收合成只剩
// head 標題列並保留在畫面上(使用者明確要求)——用 SHEET_SNAP_POINTS
// 兩段式吸附高度表達:
//  - 往下拖:吸附到索引 0(收合成標題列),卡片仍留在畫面上,不觸發
//    onClose。
//  - 收合狀態下往上拖:吸附到索引 1(展開回完整卡片)。
//  - 點 .closeBtn(X):不分展開/收合狀態,一律呼叫 onClose 真正關閉
//    (卡片從畫面消失,下次選新地點才再出現)。
// 卡片高度固定為 snap point 的值,不再支援「往上拖曳展開高度」,內容
// 過長時交給 body 的 overflow-y: auto 原生捲動——這是舊版「往上拖曳
// 展開卡片高度、到頂後接手捲動內容」複雜手勢邏輯的來源問題(使用者實測
// 回報拖到頂後完全沒反應,根因是同一個 touchmove 事件裡先 setState 改
// 高度、緊接著讀 DOM 量測捲動空間,state 更新的非同步特性導致讀到舊的
// 版面),改成固定高度後不再有這個問題。
//
// 第二階段新增候選籃相關按鈕與互動(第一階段唯讀瀏覽時特意拿掉,見舊版
// 註解)——「加入候選」按鈕行為對齊桌面版 PlacePanel.tsx 的
// handleAddClick 分岔邏輯,但簡化掉「懸浮選單 vs 展開日曆」的位置量測
// (dateMenuOpenUp,桌面版是因為卡片可能出現在視窗下半部、選單需要
// 動態翻轉方向;這裡的 bottom sheet 本身已經是從下滑入、卡片內容本來就
// 會自然被 sheet 自己的 overflow-y: auto 捲動接住,不需要另外翻轉選單
// 方向)。三路分岔:
//  1. 候選已有排定日期(candidateHasScheduledDate)→ 直接呼叫 onAddCandidate,
//     完全不經過日期選擇 sheet(見 handleAddClick)。
//  2. 候選沒有日期 → 呼叫 onOpenDatePicker,交給呼叫端
//     (GeoOutlinePhoneView.tsx)決定開哪一層 sheet:行程本身已有排定日期
//     (scheduledDates 非空)開日期清單 sheet
//     (GeoOutlinePhoneDatePickerSheet.tsx,顯示既有日期的縱向可捲動清單
//     + 「其他日期」選項);完全沒有排定日期則跳過清單、直接開日曆 sheet
//     (GeoOutlinePhoneDateCalendarSheet.tsx,DatePickerPopover 月曆格線
//     UI,對齊桌面版 PlacePanel.tsx 的既有升級)。
//
// 2026-08 之前,這兩層日期選擇 UI(既有日期 chips/日期輸入)是內嵌在這個
// 元件的 `.dateEdit` 區塊裡,由 addUi.mode==='open' 控制展開——這次改成
// 兩層獨立的 bottom sheet 疊在資訊卡之上(見 GeoOutlinePhoneView.tsx
// 開頭 SheetEntry 型別的說明,'date-picker'/'date-calendar' 兩個新型別),
// 「該不該顯示」完全交給呼叫端的 sheetStack 決定,這個元件因此不再需要
// 自己持有「日期編輯區塊展開中」這個 UI 狀態(addUi 因此簡化成只剩
// 'closed'/'added' 兩態,見 geoAddCandidateState.ts 的完整說明)——這是
// 使用者明確要求的原則:「開關 sheet 一律由堆疊控制,不能自己另外用一個
// useState 管開關」。實際選定日期、呼叫 onSchedule 寫入候選的邏輯也一併
// 搬到 GeoOutlinePhoneView.tsx(見該檔案 handlePickScheduledDate/
// handleConfirmDate 對應的接線),這個元件只保留「加入成功後短暫顯示打勾
// 提示」這件事——呼叫端透過 addFlashTrigger 這個計數器 prop(比照
// GeoOutlinePhoneCandidateDrawer.tsx 的 flashTrigger 既有模式)通知這個
// 元件「剛剛成功排入某天了」,由這裡統一 dispatch 'added',不論觸發來源
// 是候選已有日期直接加入、還是透過兩層 sheet 選定日期,都走同一個入口,
// 不會有「同一段業務邏輯在兩個地方各寫一份」的問題。
//
// attraction 沒有候選籃入口(理由同桌面版:AttractionInfoPanel.tsx 沒有
// 加入候選按鈕,自建景點區域本身沒有座標點以外的入口,見該檔案說明)。
export function GeoOutlinePhoneInfoSheet({
  content,
  attraction,
  cfg,
  onClose,
  onAddCandidate,
  onOpenDatePicker,
  requireAuth,
  addFlashTrigger,
  onDraggingDownChange,
  onSnapIndexChange,
  usePublicPlaceDetails,
  nearby,
  onSelectNearby,
  onHoverNearby,
  categoryFilter,
  onCategoryFilterChange,
}: {
  content: PlaceInfoContent | null
  attraction: GeoAttraction | null
  // cfg:attraction.placeId 有值時,用來呼叫 fetchGeoPlaceDetails 補查
  // 「地點照片漸進補圖機制」的雙來源照片——理由同桌面版
  // AttractionInfoPanel.tsx 的同名 prop,兩邊是同一套邏輯的桌面/手機版
  // 各自實作(手機版走 bottom sheet,無法直接共用同一個元件),見下方
  // placeDetails effect 的完整說明。
  cfg: ClientConfig
  onClose: () => void
  // onAddCandidate:候選已有排定日期時直接加入候選籃(純前端,不寫入
  // 後端)——理由同桌面版 PlacePanel.tsx 的同名 prop。這條路徑完全不
  // 經過日期選擇 sheet,維持這次改動前的既有行為不動(見 handleAddClick
  // 的說明)。
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onOpenDatePicker:候選沒有排定日期時,「加入行程」icon 按鈕按下觸發
  // ——取代舊版 dispatchAddUi({type:'open-picker'})展開內部日期編輯區塊
  // 的做法。這個元件本身不知道該開日期清單 sheet 還是日曆 sheet(那要看
  // 行程本身 scheduledDates 是否為空,這個元件沒有這份資料,見上方元件
  // 說明移除 scheduledDates prop 的理由),純粹通知呼叫端「使用者想選
  // 日期了」,由 GeoOutlinePhoneView.tsx 判斷後 push 對應的 SheetEntry。
  onOpenDatePicker?: () => void
  // requireAuth:公開展示頁(InteractiveExploreMap.tsx)專用的登入導轉,
  // 理由同桌面版 PlacePanel.tsx 同名 prop 的完整說明——有值時
  // handleAddClick 一開始就呼叫這個 callback 並直接 return,略過原本
  // 的 onAddCandidate/onOpenDatePicker 分岔;未傳(undefined,正式版的
  // 既有呼叫方式 GeoOutlinePhoneView.tsx)時完全不影響原本行為。
  requireAuth?: () => void
  // addFlashTrigger:呼叫端(GeoOutlinePhoneView.tsx)每次候選成功排入
  // 某天後遞增這個計數器,通知這個元件觸發「已加入」的短暫打勾提示——
  // 比照 GeoOutlinePhoneCandidateDrawer.tsx 的 flashTrigger 既有模式。
  // 選定日期、呼叫 onSchedule 寫入候選這段邏輯已經搬到
  // GeoOutlinePhoneView.tsx(由日期清單 sheet/日曆 sheet 的 callback
  // 觸發,見該檔案 handlePickScheduledDate/handleConfirmDate 對應的
  // 接線),這個元件不再是「選定日期」這個動作的發生地,只能透過這個
  // 計數器被動得知「剛剛成功了,該顯示提示了」——用計數器(而非布林值)
  // 是因為使用者可能連續快速排入同一張卡片好幾次(理論上少見,但計數器
  // 遞增天生保證每次遞增都會被 useEffect 偵測到,不會有「布林值從 true
  // 又設回 true」不觸發 effect 的邊界問題,對齊 candidateFlashTrigger
  // 既有的設計理由)。
  addFlashTrigger?: number
  // onDraggingDownChange:原封不動轉傳給 PhoneBottomSheet——這張資訊卡
  // 是否正在被使用者往下拖曳,見該 prop 的完整說明。GeoOutlinePhoneView.tsx
  // 用這個訊號決定堆疊在它下面的地點清單「開始」連動縮到最小段(使用者
  // 明確要求「前一層比後層高時,往下拉後層也要跟著往下」)。
  onDraggingDownChange?: (draggingDown: boolean) => void
  // onSnapIndexChange:這張資訊卡目前停在哪一段(見下方 activeSnapIndex
  // 的說明)的觀察用回報——不是把 activeSnapIndex 提升成受控(這個元件
  // 仍自己持有並決定這個 state,呼叫端不能反過來指定),只是額外通知
  // 呼叫端。GeoOutlinePhoneView.tsx 用這個訊號判斷資訊卡「鬆手後是否
  // 停在最小段」,搭配 onDraggingDownChange 一起決定清單要不要維持縮小
  // ——只看 onDraggingDownChange 會有 bug:鬆手瞬間 draggingRef 變
  // false,即使資訊卡最終停在最小段,清單也會立刻恢復原大小,跟「已經
  // 縮到最小」的資訊卡視覺不符(使用者實測回報「資訊卡最小時,地點就
  // 恢復大小」)。
  onSnapIndexChange?: (index: number) => void
  // usePublicPlaceDetails:true 時改打 fetchPublicGeoPlaceDetails(免登入
  // 版,見該函式與後端 handlePublicGeoPlaceDetails/
  // publicPlaceDetailsAllowlist 的完整說明)而非 fetchGeoPlaceDetails——
  // 理由與用法同桌面版 AttractionInfoPanel.tsx 的同名 prop:供沒有真正
  // 登入態的公開展示頁(手機螢幕寬度下的 InteractiveExploreMap.tsx)使用,
  // 讓固定示範資料也能顯示 Google/Pexels 雙來源照片輪播,不會像一般的
  // fetchGeoPlaceDetails 那樣打 /internal/* 必定被 internalAuth 拒絕。
  // 由呼叫端明確指定要用哪支端點,這個元件不自己依 cfg.token 是否為
  // null 猜測。預設 false(或不傳),維持原本走 fetchGeoPlaceDetails 的
  // 行為。
  usePublicPlaceDetails?: boolean
  // nearby:「附近景點」清單——只有主題卡(attraction 有值且 isTheme 為
  // true)才有意義,理由與資料形狀對稱桌面版 AttractionInfoPanel.tsx 的
  // 同名 prop(由呼叫端 GeoOutlinePhoneView.tsx 算好傳入,見該檔案
  // nearbyAttractions 的完整說明,這個元件不自己查詢/排序)。undefined
  // 或空陣列時不顯示這個區塊。
  nearby?: NearbyAttraction[]
  // onSelectNearby:點擊清單項目觸發——呼叫端(GeoOutlinePhoneView.tsx)
  // push 一層新的 {type:'nearby-place'} sheet 疊在這張卡片之上(手機版
  // 沒有桌面版並排疊放的空間,見該檔案 SheetEntry 'nearby-place' 的完整
  // 說明),對稱桌面版 onSelectNearby 的角色,但手機版是疊一層 sheet 而
  // 非開一張並存的側邊卡片。
  onSelectNearby?: (attraction: GeoAttraction) => void
  // onHoverNearby:目前橫滑清單中「停留/捲動經過」的那一張卡片變動時
  // 觸發(捲動到底、清單為空等情況傳 null)——對稱桌面版
  // AttractionInfoPanel.tsx 的同名 prop(該處由滑鼠 onMouseEnter/
  // onMouseLeave 觸發,見其完整說明),地圖上對應的精選點 overlay 會暫時
  // 升級成完整照片呈現(見 geoAttractionOverlay.ts 的 setHovered)。手機版
  // 沒有滑鼠 hover,2026-10 使用者明確要求「滑動停留的項目,與滑動中
  // 通過段落點的項目,地圖中顯示縮圖」——判斷規則是「以左側為依據,滑過
  // 卡片的 2/3 後就換下一個點」(見下方 nearbyListNodeRef 的完整說明,
  // 用 scroll 事件量測每張卡片左邊緣位置,不是 IntersectionObserver 的
  // 可視面積比例),不論是使用者手指還按著慢慢滑過、還是放開手指後最終
  // 停在哪一張,只要捲動位置改變就會持續觸發,涵蓋「停留」與「通過」
  // 兩種情境,不需要分開判斷。
  onHoverNearby?: (attraction: GeoAttraction | null) => void
  // categoryFilter/onCategoryFilterChange:分類篩選——對稱桌面版
  // AttractionInfoPanel.tsx 的 activeCategoryFilter/onCategoryFilterChange,
  // 但這個元件不像桌面版那樣自己持有 activeCategoryFilter 這個 state
  // (受控,由呼叫端持有並透過 [geo.attractionContent] reset effect 清空,
  // 見 GeoOutlinePhoneView.tsx 的完整說明)——理由是手機版沒有
  // useThemeAttractionSelection 那套 reset 機制(見該檔案檔頭對手機版
  // 的說明),若這個元件自己再管一份 categoryFilter state,會變成兩處
  // 各自維護、容易漏同步,不如直接受控,單一真相來源在呼叫端。
  categoryFilter?: CuratedCategory | null
  onCategoryFilterChange?: (category: CuratedCategory | null) => void
}) {
  // addUi:「加入行程」成功後短暫提示這件事,收斂成 reduceAddCandidateUiState
  // 這個純 reducer 統一管理(見 geoAddCandidateState.ts 的完整說明)——
  // 2026-08 日期選擇 UI 搬進獨立 sheet 後,這個 reducer 已簡化成只剩
  // 'closed'/'added' 兩態,不再持有「日期編輯區塊展開中」這個 UI 狀態
  // (那件事完全交給呼叫端的 sheetStack 決定,見上方元件說明)。
  const [addUi, dispatchAddUi] = useReducer(reduceAddCandidateUiState, initialAddCandidateUiState)
  // activeSnapIndex:卡片高度狀態,索引空間對應 PhoneBottomSheet.tsx 合併
  // minHeightPx + SHEET_SNAP_POINTS 後的 stops 陣列(由大到小排序的離
  // 頂部距離),不是 SHEET_SNAP_POINTS 常數本身的索引——這裡有傳
  // minHeightPx(見下方 JSX 的 minHeightPx={SHEET_MIN_HEIGHT}),所以
  // stops[0] 是 minHeightPx 換算出的收合段(最小段),stops[1] 才是
  // SHEET_SNAP_POINTS[0]=400(中間段),stops[2] 是 SHEET_SNAP_POINTS[1]=80
  // (滿版段)。2026-10:這個固定索引語意曾經是用「排序」間接保證,量測
  // 失敗時(容器隱藏導致 clientHeight=0)會整個洗牌錯位,現已改成直接按
  // 固定順序建構陣列、不再排序(見 PhoneBottomSheet.tsx stops 合併邏輯
  // 的完整說明),索引語意永遠穩定。
  //
  // 使用者明確要求:主題點(attraction 有值)預設收合到最小段,精選點
  // (attraction 為 null,靠 content 顯示)預設中間段——兩者在地圖上的
  // 角色不同,主題點旁通常還有多個鄰近點可選,先縮到最小段讓地圖可見
  // 範圍最大;精選點是使用者直接點選的單一地點,預設展開到中間段方便
  // 馬上看到圖片與標頭。每次換一張新卡片(content/attraction 變動)都
  // 重新套用這個預設,不延續上一張卡片被拖曳到其他段的狀態(比照下方
  // addUi 同一個 useEffect 依賴)。
  //
  // 2026-10 修正:這裡原本寫 useState(1)/setActiveSnapIndex(1),對應
  // stops 索引 1(中間段),兩種卡片不分——後來發現主題點跟精選點的
  // 預期段位其實不同(見上方說明),改成依 attraction 是否有值分流。
  //
  // 2026-10 再次修正(使用者明確指出):原本用 useState(defaultSnapIndex)
  // 設初始值、搭配下方 useEffect 在 content/attraction 變動時才修正——
  // 但這個元件是常駐掛載(呼叫端如 InteractiveExploreMap.tsx 無條件渲染
  // <GeoOutlinePhoneInfoSheet attraction={openTheme?.attraction ?? null}
  // .../>,不會因為切換主題點而重新 mount),useState 的初始值只在第一次
  // 掛載套用一次,之後每次切換卡片都是先用「上一張卡片的 activeSnapIndex
  // 舊值」render 一輪,下一輪才被 useEffect 的 setActiveSnapIndex 修正過
  // 來——這段落差先前沒被發現,只是恰好被 PhoneBottomSheet.tsx 的進場
  // 動畫(entered 從 false 開始,面板先在畫面外)蓋住:只要是「重新開啟」
  // 這張卡片(open 從 false 變 true),使用者本來就看不到第一幀。但這個
  // 巧合只在 open 本身也跟著變動時成立——若使用者在卡片已經 open 且
  // entered(面板已經在畫面上)時,直接點地圖上另一個主題點(open 全程
  // 維持 true,只有 attraction 內容換掉),這段落差會被直接看見:卡片會
  // 先閃一下舊的高度,下一輪 render 才跳到正確高度。
  //
  // 改成在 render 期間直接比對前一次的 content/attraction(React 官方
  // 建議的「調整 state 時機」模式,而非透過 useEffect 事後修正)——
  // 若本次 render 發現跟上一次記住的值不一致,在這次 render 內就同步
  // 呼叫 setActiveSnapIndex,讓這次 render 直接產出正確結果重新跑一輪
  // (React 會在提交前就處理完這次重新渲染,使用者不會看到任何中間態),
  // 不需要等到 commit 後的 useEffect 才觸發下一輪。
  //
  // 2026-10 修正(實測踩過):「上一次的值」必須存在 state 裡,不能用
  // useRef——React 18 StrictMode 下,同一個 fiber 的 render 會被刻意
  // 重跑一次以檢測副作用(見 react-dom 的 renderWithHooks 雙重呼叫)。
  // 若「上一次的值」存在 ref:第一次 render 發現不一致、把 ref 改寫成
  // 新值並呼叫 setActiveSnapIndex,這個 render-phase update 在同一輪
  // 重跑裡就被處理掉、不會留在 current 的 state queue;第二次 render
  // 重新從 current 取 state(拿到的仍是舊值),但 ref 已經是新值了,
  // if 判斷式不再成立,不會再呼叫一次 setActiveSnapIndex——最終 commit
  // 出來的 activeSnapIndex 停在舊值(使用者實測回報「起始的主題點又變
  // 中間段」,根因就是這裡:0 這個正確值在 StrictMode 第二輪 render 被
  // 吃掉)。改用 useState 存「上一次的值」後,第二次 render 會重新從
  // current 取得這個 state(不像 ref 是同一個可變物件、不受渲染輪次
  // 影響),兩次 render 比對結果一致,不會再被 StrictMode 的重跑影響。
  const [prevSelection, setPrevSelection] = useState({ content, attraction })
  const [activeSnapIndex, setActiveSnapIndex] = useState(() => (attraction ? 0 : 1))
  if (prevSelection.content !== content || prevSelection.attraction !== attraction) {
    setPrevSelection({ content, attraction })
    setActiveSnapIndex(attraction ? 0 : 1)
  }
  // addUi 的 reset 維持 useEffect——這是非同步的候選加入行程流程狀態
  // (見上方 addUi 宣告處的說明),跟 activeSnapIndex 不同,沒有「初始
  // render 就必須是對的值」這種視覺時序要求,保留原本的事後重置方式即可。
  useEffect(() => {
    dispatchAddUi({ type: 'reset' })
  }, [content, attraction])

  // isMobileSwipe:PhotoCarousel 目前是否渲染成手機版多圖橫滑軌道——
  // 見下方 .imageWrap 的說明,單張圖片/placeholder 情境維持左右留白
  // +圓角(使用者明確要求的既有視覺),多圖橫滑情境改成滿版無留白貼齊
  // 卡片外緣(使用者明確要求「有圖片的邊邊軌道不能有空隙」),圓角+
  // 間距改由 PhotoCarousel 內部每張 .swipeItem 各自處理(像相簿卡片
  // 一張張滑)。靠 PhotoCarousel 的 onLayoutChange 回呼(見該元件的
  // 完整說明)得知目前是哪一種,不在這個元件自己重新判斷一次
  // photos.length(避免兩處各自判斷卻不小心寫出不一致的條件)。
  const [isMobileSwipe, setIsMobileSwipe] = useState(false)

  // 往外回報目前停在哪一段(見 onSnapIndexChange prop 的說明)——不是
  // 提升成完全受控(activeSnapIndex 仍是這個元件自己的 state,呼叫端
  // 不能反過來指定),單純讓呼叫端能「觀察」目前段落,理由同
  // onDraggingDownChange:GeoOutlinePhoneView.tsx 需要知道資訊卡「鬆手後
  // 停在最小段」這件事(不只是「正在拖曳中」),才能讓清單縮小狀態在鬆手
  // 後持續生效,不會一鬆手就恢復原大小(這是實際發生過的 bug——原本只
  // 靠 onDraggingDownChange,鬆手瞬間 draggingRef 變 false 導致清單
  // 立刻恢復,即使資訊卡最終停在最小段)。
  useEffect(() => {
    onSnapIndexChange?.(activeSnapIndex)
  }, [activeSnapIndex, onSnapIndexChange])

  // added 狀態顯示 ADDED_HINT_MS 後自動收斂回 closed——讓「加入行程」
  // icon 按鈕的打勾提示只是短暫變化,不需要使用者手動點掉。用
  // setTimeout(而非另一個狀態機事件)是因為這是純時間驅動,沒有使用者
  // 互動或外部資料變化參與,不需要额外抽成事件——真正的狀態轉換規則
  // (added/reset 兩種事件)已經收斂在 reduceAddCandidateUiState 裡,這裡
  // 只是安排一次性的計時器去 dispatch 既有的 'reset' 事件。
  useEffect(() => {
    if (addUi.mode !== 'added') return
    const timer = setTimeout(() => dispatchAddUi({ type: 'reset' }), ADDED_HINT_MS)
    return () => clearTimeout(timer)
  }, [addUi.mode])

  // addFlashTrigger 遞增時 dispatch 'added'——見上方 addFlashTrigger prop
  // 的說明:候選成功排入某天(不論是候選本身已有日期直接加入、還是透過
  // 兩層日期選擇 sheet 選定日期)後,呼叫端統一透過遞增這個計數器通知這
  // 裡觸發打勾提示,取代舊版三條路徑各自在自己的 handler 裡直接
  // dispatch({type:'added'})的做法——「候選已有日期直接加入」這條路徑
  // (見下方 handleAddClick)仍然發生在這個元件內部,理論上可以直接
  // dispatch,但統一都透過這個計數器單一入口,避免「同一個目的地(打勾
  // 提示)有多個觸發管道各自維護」的分裂寫法,也讓三條路徑(候選已有
  // 日期/日期清單 sheet 選日期/日曆 sheet 選日期)的提示行為一定同步、
  // 不會因為之後改動其中一條路徑而遺漏 dispatch。初次渲染(trigger 為
  // undefined 或 0)不觸發,只在真正遞增(呼叫端明確通知一次「加入
  // 成功」)時才 dispatch。
  useEffect(() => {
    if (!addFlashTrigger) return
    dispatchAddUi({ type: 'added' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFlashTrigger])

  // placeDetails:attraction.placeId 有值時,補查一次「地點照片漸進補圖
  // 機制」的雙來源照片——理由與寫法同桌面版 AttractionInfoPanel.tsx 的
  // 同名 effect(不重新發明呼叫邏輯,只是依 usePublicPlaceDetails 切換
  // 打哪一支端點,見該 prop 的完整說明),這裡放在 open 判斷之前(所有
  // early return 之前),遵守 Hooks 規則。
  const attractionPlaceId = attraction?.placeId
  const [placeDetails, setPlaceDetails] = useState<GeoPlaceDetails | null>(null)
  useEffect(() => {
    setPlaceDetails(null)
    if (!attractionPlaceId) return
    let cancelled = false
    const fetcher = usePublicPlaceDetails ? fetchPublicGeoPlaceDetails : fetchGeoPlaceDetails
    fetcher(cfg, attractionPlaceId)
      .then((details) => {
        if (!cancelled) setPlaceDetails(details)
      })
      .catch(() => {
        // 查詢失敗不視為錯誤,維持 null——PhotoCarousel 沒有 fallbackUrl
        // 可退,查詢失敗就是顯示 placeholder,理由同 AttractionInfoPanel.tsx
        // (2026-09 使用者明確要求「不再使用 landmarkPhotoUrl」,不用
        // 資料庫舊圖墊底)。
      })
    return () => {
      cancelled = true
    }
  }, [cfg, attractionPlaceId, usePublicPlaceDetails])

  // nearbyCategoryPresent/filteredNearby:分類篩選——沿用
  // geoNearbyAttractions.ts 的共用純函式(見該檔案開頭說明),邏輯與
  // 桌面版 AttractionInfoPanel.tsx 完全一致,只是這裡放在所有 early
  // return 之前(遵守 Hooks 規則,理由同上方 placeDetails effect)。
  const nearbyCategoryPresent = useMemo(() => nearbyCategoriesPresent(nearby ?? []), [nearby])
  const filteredNearby = useMemo(
    () => filterNearbyByCategory(nearby ?? [], categoryFilter ?? null),
    [nearby, categoryFilter],
  )

  // nearbyListNodeRef/nearbyItemRefs:橫滑清單捲動時觸發 onHoverNearby
  // (見該 prop 的完整說明)。
  //
  // 2026-10 修正:原本用 IntersectionObserver 比較所有卡片的交集比例
  // (面積),取比例最高的一張——但使用者明確要求判斷規則是「以左側為
  // 依據,滑過卡片的 2/3 後就換下一個點」,這是一個跟卡片左邊緣位置
  // 直接掛鉤的明確規則,不是「哪張佔的可視面積比較大」這種間接推論
  // (兩者在大多數情況下结果相近,但規則語意不同,邊界情況——例如兩張
  // 卡片剛好各半可見時——行為沒有保證一致)。改用 scroll 事件 +
  // getBoundingClientRect() 直接量測每張卡片左邊緣相對清單容器左邊界
  // 的位置:「卡片左邊緣已經滑過容器左邊界、且滑過的距離超過卡片自身
  // 寬度的 2/3」才視為「這張已經劃過去,換下一個」,否則維持目前這張
  // 還算在顯示——用由右到左掃描、取第一張仍滿足「還沒滑過 2/3」的卡片
  // (也就是最靠右側、但尚未被判定划过的那張),等同「目前主要显示的是
  // 这一张」。
  const nearbyListNodeRef = useRef<HTMLDivElement | null>(null)
  const nearbyItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    const root = nearbyListNodeRef.current
    if (!root) return

    function resolveActiveIndex() {
      const rootRect = root!.getBoundingClientRect()
      const items = nearbyItemRefs.current
      // 2026-10 修正:原本「由後往前找,第一個滑過距離小於 2/3 寬度的就
      // 回傳」——但還沒被滑到的卡片(清單右側、尚未進入可視範圍)
      // rect.left 遠大於 rootRect.left,scrolledPast(= rootRect.left -
      // rect.left)會是很大的負數,恆小於 rect.width*2/3,導致從最後一張
      // 開始找,第一次檢查就命中、直接回傳清單最後一個索引——跟實際捲動
      // 位置完全無關,等同恆回傳最後一張(使用者實測回報「滑動時中心點
      // 一直跑到其他區域」,根因就是這裡算出的 index 其實是固定的)。
      // 改成由前往後找:找到「左邊緣已經滑過容器左邊界、且滑過距離還沒
      // 超過自身寬度 2/3」的第一張——卡片由左到右排列,捲動時左側卡片
      // 的 scrolledPast 由大變小(尚未捲到時是負數,捲到時變正數、隨
      // 繼續捲動持續增加),第一張「已經開始滑過去但還沒超過 2/3」的
      // 卡片,就是目前主要顯示的那張;若所有卡片都還沒被滑過(清單在最
      // 開頭),回傳第一張。
      //
      // 2026-10 第二次修正(code review 抓到):地圖容器在
      // MobileMapReveal.tsx 展開前是 display:none,這個 sheet 本身可能
      // 在那段期間就已經掛載(見呼叫端的完整說明),此時所有卡片的
      // getBoundingClientRect() 寬高都是 0、rootRect 的 left 也跟每張
      // 卡片的 left 一樣是 0,scrolledPast 恆為 0,0 < 0*(2/3)=0 不成立,
      // 迴圈一樣找不到命中項、落到「回傳最後一張」這個 fallback,跟
      // 上面要修的那個 bug 殊途同歸(使用者實測回報過這個症狀)。容器
      // 尺寸是 0 時代表目前根本不可見,不該算出任何有意義的 index,回傳
      // -1 讓呼叫端視為「沒有可顯示的卡片」。
      if (rootRect.width === 0) return -1
      for (let i = 0; i < items.length; i++) {
        const el = items[i]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0) continue
        const scrolledPast = rootRect.left - rect.left
        if (scrolledPast < rect.width * (2 / 3)) {
          return i
        }
      }
      return items.length > 0 ? items.length - 1 : -1
    }

    // rafId 節流——scroll 事件觸發頻率很高(拖曳中幾乎每個 frame 都會
    // 觸發),resolveActiveIndex() 內的 getBoundingClientRect() 會強制
    // 瀏覽器同步 reflow,直接在每次 scroll 事件裡都算一次會造成不必要的
    // 效能成本,節流成每個 frame 最多算一次(理由同
    // useAttractionOverlays.ts 的 resolveLabelCollisions)。
    let rafId: number | null = null
    function handleScroll() {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const idx = resolveActiveIndex()
        onHoverNearby?.(idx !== -1 ? (filteredNearby[idx]?.attraction ?? null) : null)
      })
    }

    handleScroll()
    root.addEventListener('scroll', handleScroll, { passive: true })
    // ResizeObserver:補上「容器從不可見(寬度 0)變成可見」這個時機點
    // 重新計算一次——resolveActiveIndex() 在容器寬度為 0 時會直接回傳
    // -1(見該處的完整說明),這個 sheet 若在 MobileMapReveal.tsx 的地圖
    // 展開前就已經掛載,初次 handleScroll() 執行當下容器還是 0 寬度,
    // 之後使用者點縮圖展開地圖,容器尺寸才變成正常值,但這段期間完全
    // 沒有任何 scroll 事件發生(使用者還沒有滑動過這個清單),
    // onHoverNearby 會一直停在 null、不會自動補上正確的 index,地圖上
    // 不會顯示任何精選點的照片縮圖,直到使用者真的手動滑動一下清單
    // 才會被動修正。改用 ResizeObserver 監看容器本身的尺寸變化,寬度
    // 一旦變成非 0 就重新算一次,不需要依賴使用者先滑動。
    const resizeObserver = new ResizeObserver(() => {
      if (root.getBoundingClientRect().width > 0) handleScroll()
    })
    resizeObserver.observe(root)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      root.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
      onHoverNearby?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNearby])

  const open = content != null || attraction != null

  if (!open) return null

  const name = attraction ? attraction.name : content!.name
  // photoUrl/googlePhotoUrls:attraction(人工建檔景點)一律改用上方
  // placeDetails effect 查回的照片(見該 effect 的完整說明)——2026-09
  // 使用者明確要求「完全不要使用 landmarkPhotoUrl」,沒有 placeId 或
  // 查詢中/查無結果時 photoUrl 固定 undefined,PhotoCarousel 顯示
  // placeholder,不回退任何舊表資料。content(PlaceInfoContent,飯店/
  // 推薦地點等非 attraction 來源)不受影響,繼續用它自己的 photoUrl
  // 欄位。2026-09 已移除 Pexels 讀圖來源,照片只會來自 Google。
  const photoUrl = attraction ? undefined : content!.photoUrl
  const googlePhotoUrls = attraction ? (attractionPlaceId ? placeDetails?.googlePhotoUrls : undefined) : content!.googlePhotoUrls
  const subtitle = attraction
    ? attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined
    : content!.subtitle
  const summary = attraction ? attraction.summary : content!.summary
  const badges = attraction ? attractionBadges(attraction) : content!.badges
  const candidate = attraction ? undefined : content!.candidate

  // handleAddClick:「加入 {tripName}」按下時的分岔——理由同桌面版
  // PlacePanel.tsx 的 handleAddClick,見上方元件說明。候選已有排定
  // 日期這條分支直接算「加入成功」,dispatch 'added' 顯示提示;候選沒有
  // 日期的分支不再由這個元件自己展開內部區塊,改成呼叫 onOpenDatePicker
  // 通知呼叫端——實際選定日期、呼叫 onSchedule 寫入候選的邏輯(對應舊版
  // handlePickScheduledDate/handleConfirmDate)已經搬到
  // GeoOutlinePhoneView.tsx,由新的兩層 sheet 觸發,完成後透過
  // addFlashTrigger 這個計數器(見上方 prop 說明)通知這裡 dispatch
  // 'added',不是這個元件自己直接呼叫。
  const handleAddClick = () => {
    if (!candidate) return
    if (requireAuth) {
      requireAuth()
      return
    }
    if (candidateHasScheduledDate(candidate)) {
      onAddCandidate?.(candidate)
      dispatchAddUi({ type: 'added' })
      return
    }
    onOpenDatePicker?.()
  }

  // panelStyle 的 zIndex 37:比 PhoneTabBar.module.css 的 .bar
  // (z-index: 35)高一階,使用者明確要求資訊卡(不論展開或收合)要疊在
  // 底部常駐導覽列上面、蓋住它,不是讓開空間避開——維持 bottom: 0 貼齊
  // 螢幕最底,兩者本來就該重疊,只是疊放順序要反過來(資訊卡在上)。
  // 比 GeoOutlinePhoneListDrawer.tsx 的 zIndex 36 高一階——點清單項目
  // 打開資訊卡時(useSheetStack 接線,見 GeoOutlinePhoneView.tsx 的
  // sheetStack 說明),兩者會同時 open,zIndex 需要明確排序資訊卡在
  // 清單之上,不能只靠 JSX 渲染順序(兩者原本同值 36 時,靠 DOM 順序
  // 決定疊放,清單排在資訊卡之後反而會蓋住它)。
  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      minHeightPx={SHEET_MIN_HEIGHT}
      activeSnapIndex={activeSnapIndex}
      onSnapIndexChange={setActiveSnapIndex}
      panelStyle={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 37 }}
      backdropStyle={{ position: 'fixed', inset: 0, zIndex: 35, background: 'rgba(0, 0, 0, 0.32)' }}
      showBackdrop={false}
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      onDraggingDownChange={onDraggingDownChange}
      head={
        /* head:標頭區塊(名稱/副標/badges),使用者明確要求放在圖片
           上方——原本圖片在最上面、關閉按鈕疊在圖片右上角,改成標頭先
           顯示基本資訊,關閉按鈕跟著移到標頭這裡(見 .head 的說明)。
           candidate 存在時,「加入行程」也改成放在關閉按鈕左邊的純
           icon 按鈕(使用者明確要求),不再是圖片下方帶文字的按鈕——
           按下去若候選沒有排定日期,不再像 2026-08 之前那樣在這張卡片
           內部展開日期選擇區塊,改成呼叫 onOpenDatePicker 開啟獨立的
           bottom sheet(見上方元件說明、handleAddClick 的完整說明)。 */
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.name}>{name}</h2>
            {/* subtitle 只在主題點(attraction 有值)時顯示在這裡——這種
                情況下 subtitle 是 landmarkName(見上方該常數的完整說明,
                跟地址無關),維持原本「名稱下方」的既有位置。精選點
                (attraction 為 null,靠 content 顯示)的 subtitle 是地址
                (見 geoInfoContent.ts 組裝 PlaceInfoContent 時的欄位來源),
                2026-10 使用者明確要求搬到圖片下面(見下方 imageWrap 之後
                的渲染處),不在這裡顯示,避免同一個 subtitle 欄位在兩種
                卡片類型上語意不同、卻共用同一個渲染位置造成混淆。 */}
            {attraction && subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            {badges.length > 0 && (
              <div className={styles.metaRow}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>{b}</span>
                ))}
              </div>
            )}
            {/* nearbyCategoryChips:2026-10 使用者明確要求「主題點最小段時,
                標頭下面緊接著附近景點的過濾標籤」——原本這組 chip 列跟
                「附近景點」清單本身一起放在 content(可捲動內容區),卡片
                收合到最小段時 content 整個被 .panelCollapsed 隱藏(見
                components/PhoneBottomSheet.tsx 的說明),連帶讓 chip 列
                也消失,使用者收合到最小段後完全看不到任何分類篩選入口。
                搬進 head(標頭,不受收合影響、永遠顯示)後,即使卡片收合
                到只剩標頭這條,使用者仍能直接點 chip 篩選,不需要先展開
                卡片。渲染條件/內容本身不變,只是移動 JSX 位置——下方
                content 裡的「附近景點」區塊不再重複渲染這組 chip,只保留
                標題文字與清單本身。 */}
            {nearby && nearby.length > 0 && nearbyCategoryPresent.size > 0 && (
              <div className={styles.nearbyCategoryChips} role="listbox" aria-label="附近景點分類篩選">
                {Array.from(nearbyCategoryPresent).map((category) => {
                  const CategoryIcon = CURATED_CATEGORY_ICONS[category]
                  const active = categoryFilter === category
                  return (
                    <button
                      key={category}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`${styles.nearbyCategoryChip}${active ? ` ${styles.nearbyCategoryChipActive}` : ''}`}
                      onClick={() => onCategoryFilterChange?.(active ? null : category)}
                    >
                      <CategoryIcon size={13} strokeWidth={2} aria-hidden="true" />
                      {CURATED_CATEGORY_LABELS[category]}
                      <span
                        className={`${styles.nearbyCategoryDot} ${CURATED_CATEGORY_MAP_CLASS[category]}`}
                        aria-hidden="true"
                      />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {candidate && (
            // added 狀態下按鈕本身短暫變成打勾圖示——使用者明確要求加入
            // 行程要有提示,選按鈕文字/圖示短暫變化而非額外的浮動 toast
            // (見 ADDED_HINT_MS 的說明)。disabled 避免 ADDED_HINT_MS
            // 這段時間內使用者又快速點一次,重複觸發 onAddCandidate/
            // onSchedule。
            <button
              type="button"
              className={styles.addCandidateIconBtn}
              onClick={handleAddClick}
              disabled={addUi.mode === 'added'}
              title={addUi.mode === 'added' ? '已加入' : '加入行程'}
              aria-label={addUi.mode === 'added' ? '已加入' : '加入行程'}
            >
              {addUi.mode === 'added' ? <Check size={16} strokeWidth={2} /> : <Plus size={16} strokeWidth={2} />}
            </button>
          )}
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      }
    >
      <div className={styles.content}>
        {/* 「附近景點」清單——只有主題卡(nearby 有值且非空)才會顯示,
            理由見上方 nearby prop 的說明。分類篩選 chip 列本身已搬到
            head(標頭,見該處的完整說明,2026-10 使用者明確要求「主題點
            最小段時,標頭下面緊接著附近景點的過濾標籤」),這裡只保留
            標題文字與清單本身,不重複渲染 chip——原本外層包的
            .nearbySection wrapper div 已無樣式需要承載,一併移除(見
            module.css 對應說明)。
            2026-10 使用者明確要求手機版主題卡的順序改成「附近景點 →
            照片 → 簡介」(原本是「照片 → 簡介 → 附近景點」),故這個
            區塊搬到 content 最前面,PhotoCarousel(見下方 imageWrap)
            次之,summary 移到最後面。 */}
        {nearby && nearby.length > 0 && (
          <>
            <p className={styles.nearbyTitle}>附近景點</p>
            <div className={styles.nearbyList} ref={nearbyListNodeRef}>
              {filteredNearby.map(({ attraction: n, minutes }, i) => {
                const category = curatedCategoryOf(n.category)
                const CategoryIcon = category ? CURATED_CATEGORY_ICONS[category] : null
                return (
                  <button
                    // key={n.id ?? n.name}:對齊桌面版 AttractionInfoPanel.tsx
                    // 的同一處寫法(2026-10 code review 抓到不一致)——id
                    // 優先,資料庫裡已知存在同名不同 id 的重複記錄案例
                    // (見 CHANGELOG 相關條目),用 name 當 key 在這種情況下
                    // 會撞 key、React 警告,也可能讓重複記錄之一的互動狀態
                    // 被錯誤共用;name 只在真的沒有 id 時(理論上不該發生,
                    // nearby 清單來源是人工建檔資料)當 fallback。
                    key={n.id ?? n.name}
                    ref={(el) => { nearbyItemRefs.current[i] = el }}
                    type="button"
                    className={styles.nearbyItem}
                    onClick={() => onSelectNearby?.(n)}
                  >
                    <div className={styles.nearbyItemHead}>
                      {CategoryIcon && <CategoryIcon size={14} strokeWidth={2} aria-hidden="true" />}
                      <span className={styles.nearbyName}>{n.name}</span>
                      <span className={styles.nearbyMinutes}>約 {minutes} 分</span>
                    </div>
                    {n.summary && <p className={styles.nearbySummary}>{n.summary}</p>}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {/* imageWrap:placeholder/單張圖片情境維持左右留白+圓角(見
            .imageWrap 的說明,使用者明確要求);isMobileSwipe 為 true
            (手機版多圖橫滑)時改套 .imageWrapSwipe,拿掉留白與容器圓角,
            讓橫滑軌道整體真正貼齊卡片外緣——使用者明確要求「有圖片的
            邊邊軌道不能有空隙」。多圖情境下每張圖片各自的圓角+間距改由
            PhotoCarousel 自己的 .swipeItem 逐張處理(像相簿卡片一張張
            滑,同樣是使用者明確要求),不是這層容器的職責。
            2026-10 使用者明確要求手機版主題卡順序改成「附近景點 → 照片
            → 簡介」,故照片搬到附近景點之後、簡介之前。 */}
        <div className={`${styles.imageWrap}${isMobileSwipe ? ` ${styles.imageWrapSwipe}` : ''}`}>
          <PhotoCarousel
            googlePhotoUrls={googlePhotoUrls}
            fallbackUrl={photoUrl}
            alt={name}
            onLayoutChange={setIsMobileSwipe}
          />
        </div>
        {summary ? (
          <p className={styles.summary}>{summary}</p>
        ) : (
          <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
        )}
        {/* 精選點(attraction 為 null)的地址——2026-10 使用者明確要求從
            標頭(名稱下方)搬到簡介下面。只有這個分支會顯示(主題點的
            subtitle 是 landmarkName,仍維持在標頭,見上方 head 區塊的
            完整說明)。 */}
        {!attraction && subtitle && <p className={styles.placeAddress}>{subtitle}</p>}
      </div>
    </PhoneBottomSheet>
  )
}
