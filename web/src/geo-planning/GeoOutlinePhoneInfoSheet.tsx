import { useEffect, useReducer, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../api'
import { fetchGeoPlaceDetails } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { attractionBadges } from './geoInfoContent'
import { candidateHasScheduledDate, type GeoCandidate } from './geoCandidateHelpers'
import { reduceAddCandidateUiState, initialAddCandidateUiState } from './geoAddCandidateState'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS } from '../components/PhoneBottomSheet'
import { PhotoCarousel } from './PhotoCarousel'
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
// 半部——桌面版對應的 GeoInfoPanel/AttractionInfoPanel 是絕對定位疊在
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
// 註解)——「加入候選」按鈕行為對齊桌面版 GeoInfoPanel.tsx 的
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
//     UI,對齊桌面版 GeoInfoPanel.tsx 的既有升級)。
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
  addFlashTrigger,
  onDraggingDownChange,
  onSnapIndexChange,
}: {
  content: GeoInfoContent | null
  attraction: GeoAttraction | null
  // cfg:attraction.placeId 有值時,用來呼叫 fetchGeoPlaceDetails 補查
  // 「地點照片漸進補圖機制」的雙來源照片——理由同桌面版
  // AttractionInfoPanel.tsx 的同名 prop,兩邊是同一套邏輯的桌面/手機版
  // 各自實作(手機版走 bottom sheet,無法直接共用同一個元件),見下方
  // placeDetails effect 的完整說明。
  cfg: ClientConfig
  onClose: () => void
  // onAddCandidate:候選已有排定日期時直接加入候選籃(純前端,不寫入
  // 後端)——理由同桌面版 GeoInfoPanel.tsx 的同名 prop。這條路徑完全不
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
}) {
  // addUi:「加入行程」成功後短暫提示這件事,收斂成 reduceAddCandidateUiState
  // 這個純 reducer 統一管理(見 geoAddCandidateState.ts 的完整說明)——
  // 2026-08 日期選擇 UI 搬進獨立 sheet 後,這個 reducer 已簡化成只剩
  // 'closed'/'added' 兩態,不再持有「日期編輯區塊展開中」這個 UI 狀態
  // (那件事完全交給呼叫端的 sheetStack 決定,見上方元件說明)。
  const [addUi, dispatchAddUi] = useReducer(reduceAddCandidateUiState, initialAddCandidateUiState)
  // activeSnapIndex:卡片高度狀態,對應 SHEET_SNAP_POINTS 三段式索引
  // (0 = 最小/收合,1 = 中間,2 = 滿版/展開)——使用者明確要求卡片開啟
  // 時的初始狀態是中間(不是滿版),每次換一張新卡片(content/attraction
  // 變動)都重設回中間,不延續上一張卡片被拖曳到其他段的狀態(比照
  // 下方 addUi 同一個 useEffect 依賴)。這個 state 語意上是純 UI 展示
  // 位置,跟 addUi 涉及的候選加入行程資料流程性質不同,不收進同一個
  // reducer——換卡片時兩者剛好都要重置,靠同一個 useEffect 觸發即可,
  // 不代表它們是同一份狀態。
  const [activeSnapIndex, setActiveSnapIndex] = useState(1)
  useEffect(() => {
    dispatchAddUi({ type: 'reset' })
    setActiveSnapIndex(1)
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
  // 同名 effect(不重新發明呼叫邏輯,同一支 fetchGeoPlaceDetails 端點),
  // 這裡放在 open 判斷之前(所有 early return 之前),遵守 Hooks 規則。
  const attractionPlaceId = attraction?.placeId
  const [placeDetails, setPlaceDetails] = useState<GeoPlaceDetails | null>(null)
  useEffect(() => {
    setPlaceDetails(null)
    if (!attractionPlaceId) return
    let cancelled = false
    fetchGeoPlaceDetails(cfg, attractionPlaceId)
      .then((details) => {
        if (!cancelled) setPlaceDetails(details)
      })
      .catch(() => {
        // 查詢失敗不視為錯誤,維持 null——PhotoCarousel 的 fallbackUrl
        // 會退回 landmarkPhotoUrl,理由同 AttractionInfoPanel.tsx。
      })
    return () => {
      cancelled = true
    }
  }, [cfg, attractionPlaceId])

  const open = content != null || attraction != null

  if (!open) return null

  const name = attraction ? attraction.name : content!.name
  // photoUrl/googlePhotoUrls/pexelsPhotoUrls:attraction(人工建檔景點)
  // 有 placeId 時改用上方 placeDetails effect 查回的雙來源照片(見該
  // effect 的完整說明),沒有 placeId 時維持只有單一 landmarkPhotoUrl——
  // PhotoCarousel 收到兩份清單皆為 undefined(或查詢中/查無結果)時會
  // fallback 回 photoUrl 顯示單張,理由同 AttractionInfoPanel.tsx/
  // GeoInfoPanel.tsx 的既有慣例。
  const photoUrl = attraction ? attraction.landmarkPhotoUrl : content!.photoUrl
  const googlePhotoUrls = attraction ? (attractionPlaceId ? placeDetails?.googlePhotoUrls : undefined) : content!.googlePhotoUrls
  const pexelsPhotoUrls = attraction ? (attractionPlaceId ? placeDetails?.pexelsPhotoUrls : undefined) : content!.pexelsPhotoUrls
  const subtitle = attraction
    ? attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined
    : content!.subtitle
  const summary = attraction ? attraction.summary : content!.summary
  const badges = attraction ? attractionBadges(attraction) : content!.badges
  const candidate = attraction ? undefined : content!.candidate

  // handleAddClick:「加入 {tripName}」按下時的分岔——理由同桌面版
  // GeoInfoPanel.tsx 的 handleAddClick,見上方元件說明。候選已有排定
  // 日期這條分支直接算「加入成功」,dispatch 'added' 顯示提示;候選沒有
  // 日期的分支不再由這個元件自己展開內部區塊,改成呼叫 onOpenDatePicker
  // 通知呼叫端——實際選定日期、呼叫 onSchedule 寫入候選的邏輯(對應舊版
  // handlePickScheduledDate/handleConfirmDate)已經搬到
  // GeoOutlinePhoneView.tsx,由新的兩層 sheet 觸發,完成後透過
  // addFlashTrigger 這個計數器(見上方 prop 說明)通知這裡 dispatch
  // 'added',不是這個元件自己直接呼叫。
  const handleAddClick = () => {
    if (!candidate) return
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
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            {badges.length > 0 && (
              <div className={styles.metaRow}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>{b}</span>
                ))}
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
      {/* imageWrap:placeholder/單張圖片情境維持左右留白+圓角(見
          .imageWrap 的說明,使用者明確要求);isMobileSwipe 為 true
          (手機版多圖橫滑)時改套 .imageWrapSwipe,拿掉留白與容器圓角,
          讓橫滑軌道整體真正貼齊卡片外緣——使用者明確要求「有圖片的
          邊邊軌道不能有空隙」。多圖情境下每張圖片各自的圓角+間距改由
          PhotoCarousel 自己的 .swipeItem 逐張處理(像相簿卡片一張張
          滑,同樣是使用者明確要求),不是這層容器的職責。 */}
      <div className={`${styles.imageWrap}${isMobileSwipe ? ` ${styles.imageWrapSwipe}` : ''}`}>
        <PhotoCarousel
          googlePhotoUrls={googlePhotoUrls}
          pexelsPhotoUrls={pexelsPhotoUrls}
          fallbackUrl={photoUrl}
          alt={name}
          onLayoutChange={setIsMobileSwipe}
        />
      </div>
      <div className={styles.content}>
        {summary ? (
          <p className={styles.summary}>{summary}</p>
        ) : (
          <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
        )}
      </div>
    </PhoneBottomSheet>
  )
}
