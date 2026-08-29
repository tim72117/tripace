import { useCallback, useReducer, useState } from 'react'
import { ListPlus, Timeline } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import type { Theme } from '../theme'
import { Avatar } from '../AppCommon'
import { GeoOutlinePanel } from './GeoOutlinePanel'
import { useGeoPlanningState } from './useGeoPlanningState'
import type { GeoCandidate } from './geoCandidateHelpers'
import { GeoOutlinePhoneInfoSheet } from './GeoOutlinePhoneInfoSheet'
import { GeoOutlinePhoneDatePickerSheet } from './GeoOutlinePhoneDatePickerSheet'
import { GeoOutlinePhoneDateCalendarSheet } from './GeoOutlinePhoneDateCalendarSheet'
import { GeoOutlinePhoneCandidateDrawer } from './GeoOutlinePhoneCandidateDrawer'
import { GeoOutlinePhoneListDrawer } from './GeoOutlinePhoneListDrawer'
import { reduceListDrawerState, initialListDrawerState } from './geoListDrawerState'
import { reduceCategoryTagsState, initialCategoryTagsState } from './geoCategoryTagsState'
import { useSheetStack } from '../components/useSheetStack'
import styles from './GeoOutlinePhoneView.module.css'

// SheetEntry:2026-08 這次重構後,清單與資訊卡「該不該顯示」的真相來源
// 全部收斂進這個堆疊——不再有 listDrawerState.open 或 geo.infoContent
// 单独決定某個 sheet 是否顯示的舊機制(這兩者仍然存在,但語意各自窄化:
// listDrawerState 只剩 loading 這個查詢中動畫的語意,open 欄位不再被
// 讀取;geo.infoContent/attractionContent 只負責「選中的是什麼內容」,
// 不負責「該不該顯示」)。
//
// 為什麼清單也要進堆疊(舊版只有資訊卡會 push,清單開關另外交給
// listDrawerState.open):舊版有兩條真相來源並存,任何新增的「打開資訊卡」
// 入口(點地圖 marker、城市搜尋唯一解、候選籃選取)都繞過 sheetStack 直接
// 操作 geo.infoContent,導致 sheetStack 記錄的堆疊狀態跟畫面實際顯示的
// sheet 不同步,是使用者要求「開關 sheet 全部改由堆疊控制」的直接原因。
// 收斂成單一堆疊後,任何時刻畫面上該顯示哪些 sheet,只需要看
// sheetStack.stack 就能百分之百確定,不需要額外交叉比對另一個 state。
//
// 'list'  地點清單抽屜(GeoOutlinePhoneListDrawer)——由三個查詢入口
//         (onSearch/onSearchStart)push 進堆疊,結果回來後依筆數決定
//         維持不動或被 replace 成 'info'(唯一解,見下方 onSearchResultsChange
//         的說明),使用者手動關閉或重新搜尋時透過 closeAll 清空。
// 'info'  資訊卡(GeoOutlinePhoneInfoSheet)——由「點清單項目」push(在
//         清單之上多疊一層,關閉後 pop 回清單);由「點地圖 marker/
//         城市搜尋唯一解/候選籃選取」這幾個非清單來源的入口 replace
//         (換掉堆疊頂端,不增加深度——見下方各入口的說明,理由是這些
//         入口彼此互斥,連續觸發應該直接換內容,不該無限疊層,也對齊
//         使用者確認過的既有行為:連續點不同 marker 不需要按兩次關閉鍵)。
// 'date-picker'   日期清單 sheet(GeoOutlinePhoneDatePickerSheet)——
//         2026-08 新增,取代舊版資訊卡內部展開的 `.dateEdit` 區塊。由
//         資訊卡「加入行程」icon 按鈕觸發(候選沒有排定日期時,見下方
//         GeoOutlinePhoneInfoSheet 的 onOpenDatePicker 接線),疊在資訊卡
//         之上——只有在行程本身已有排定日期(geo.scheduledDates 非空)
//         時才會 push 這一層;完全沒有排定日期時直接跳過,push
//         'date-calendar'(見下方)。顯示既有日期的縱向清單讓使用者快速
//         挑一天,或點「其他日期」再 push 'date-calendar' 疊上一層。點
//         某個日期項目(onPickDate)完成排入後,用 popDateSheets()(見
//         handleScheduleFromDateSheet 的說明,不是 closeAll())只收掉
//         頂端連續的日期選擇層(這一層與可能疊在上面的 'date-calendar'),
//         保留底下的 'info'(以及可能更底下的 'list'),回到資訊卡——
//         理由是這個 sheet 存在的唯一目的就是「選一個日期」,選定後整段
//         選擇流程已經結束,沒有「退回上一層繼續選」的語意需要保留(跟
//         'info' 從 'list' pop 回去、'list' 本身還有事可做的情境不同),
//         但資訊卡本身不該被一併收掉。使用者主動關閉(拖到底/按關閉鈕)
//         則只 pop 這一層,回到資訊卡。
// 'date-calendar' 日曆 sheet(GeoOutlinePhoneDateCalendarSheet)——2026-08
//         新增,取代舊版 `.dateEdit` 區塊裡的 <input type="date"> +
//         確定按鈕(現改用 DatePickerPopover 月曆格線 UI,對齊桌面版
//         GeoInfoPanel.tsx 的既有升級,點選日期格子即視為確定)。兩條
//         push 路徑:(1) 候選沒有排定日期、行程本身也沒有排定日期時,
//         由資訊卡直接 push(跳過 'date-picker',見上方說明);(2)
//         'date-picker' 的「其他日期」按鈕 push,疊在 'date-picker' 之上,
//         此時堆疊深度達到三層(list 可能也在最底層,見下方
//         GeoOutlinePhoneInfoSheet 呼叫處的完整堆疊組合說明)。點選日期
//         (onConfirm)完成排入後,同樣用 popDateSheets() 只收掉頂端的
//         日期選擇層(不論底下疊的是 'info' 直接疊上來、還是還多疊了
//         一層 'date-picker'),回到資訊卡;使用者主動關閉則只 pop 這
//         一層。
type SheetEntry =
  | { type: 'list' }
  | { type: 'info' }
  | { type: 'date-picker' }
  | { type: 'date-calendar' }

// GeoOutlinePhoneView:手機版規劃地圖(geo-outline)主容器。第一階段是
// 地圖瀏覽 + 唯讀資訊卡;第二階段(這次)新增候選籃——讓使用者能把地圖上
// 瀏覽到的飯店/景點/地點加入候選籃,並排入行程的某一天。地圖引擎
// (GeoOutlinePanel/GeoOutlineMap)與桌面版共用同一份,平台無關,這裡只
// 負責手機版排版與候選籃資料流。
//
// 候選籃 UI 選用「從右側滑入的抽屜」(GeoOutlinePhoneCandidateDrawer),
// 不是再開一層 bottom sheet——理由見該元件開頭的說明:手機螢幕放不下
// 桌面版並排的兩張側欄(GeoCandidateSidebar+AddFromCandidateSidebar),
// 抽屜可以佔滿畫面高度,比 bottom sheet(必須跟地圖並存可見、高度受限
// 60vh)更適合放得下「候選中」+「已排入行程日層架」兩段內容。地圖固定
// 不動的底層 + 側邊滑入抽屜,對齊 pace/PacePhoneSwipe.tsx 的既有先例。
//
// 候選籃相關 state 對照桌面版 DesktopLayout.tsx 的同名 geo* state,只是
// 拿掉桌面版「兩個獨立浮動側欄」才需要的中介 state(pickingDayKey/
// onlyGeoCandidate/draggingCandidate——手機版候選籃合併成一個抽屜元件,
// 「候選中」清單直接由抽屜元件自己用 candidates prop 篩出,不需要呼叫端
// 另外算一份;不支援拖曳排期,見 GeoOutlinePhoneCandidateDrawer.tsx 的
// 說明)。純邏輯(GeoCandidate 型別/分組/建立 entry)完全複用
// geoCandidateHelpers.ts,與桌面版共用同一份,不重新實作。
//
// 第三階段新增「飯店/推薦地點」清單(GeoOutlinePhoneListDrawer)——同樣是
// 從一側滑入的抽屜,選左側(候選籃已佔用右側滑入語意,見
// GeoOutlinePhoneListDrawer.tsx 的說明)。資料來源對照桌面版
// DesktopLayout.tsx 的 geo.searchResults——GeoOutlinePanel 本來就已經
// 把 onSearchResultsChange 轉傳給 GeoOutlineMap(第一、二階段的
// 手機版容器沒有接這個 callback,地圖仍會查詢,只是查到的結果沒有
// 清單可以顯示,這次補上)。清單合併顯示飯店/推薦地點/搜尋結果,不分頁
// 切換——對齊桌面版 GeoHotelSidebar.tsx 現行的合併清單設計,原本這裡
// 分成 hotels/places 兩個 tab 的設計已移除(見 GeoOutlinePhoneListDrawer.tsx
// 的說明)。
//
// 2026-08:移除獨立的「飯店/推薦地點」手動開啟按鈕(原本的 .listBtn,
// MapPinned 圖示)——清單唯一入口改成「搜尋觸發時自動打開」。開關/
// 載入中狀態收斂成 geoListDrawerState.ts 的 reduceListDrawerState 純
// reducer 統一管理(listDrawerState/dispatchListDrawer,見下方宣告處與
// 該檔案開頭的完整說明)——三個查詢入口(城市搜尋框的 onSearch、地圖上方
// 類別標籤/「搜尋這個區域」按鈕共用的 onSearchStart)都必須明確 dispatch
// 'search-started',查詢結果回來時(onSearchResultsChange)dispatch
// 'results-arrived',使用者手動關閉時 dispatch 'user-closed'。
export function GeoOutlinePhoneView({
  cfg,
  tripID,
  activeTrip,
  user,
  onOpenSettings,
  onOpenTimeline,
  onOpenTrips,
  theme,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // activeTrip:判斷使用者是否已選定旅程——為空時「加入行程」按下要先
  // 導向旅程列表(見下方 onOpenTrips),理由同桌面版 DesktopLayout.tsx
  // 的 pendingSchedule 機制。
  activeTrip?: Trip | null
  user: User
  // onOpenTimeline:左下角「時間軸」按鈕觸發,由 PhoneContent.tsx 傳入
  // (呼叫 setDrawerMode('timeline')切換主畫面)——這個元件本身不管全域
  // drawerMode 導航,只負責觸發。使用者要求「時間軸放左側」,原本是
  // PhoneTabBar.tsx 底部常駐三分頁之一,改成規劃地圖專屬、併入候選籃/
  // 清單所在的 candidateGroup(見下方 JSX)——時間軸入口從此只在規劃
  // 地圖畫面才看得到,已與使用者確認其他主畫面(配速表/對話)不再需要
  // 直接切到時間軸的入口。
  onOpenTimeline?: () => void
  onOpenSettings: () => void
  // onOpenTrips:候選籃「加入行程」流程裡,使用者還沒選定任何旅程
  // (activeTrip 為空,見上方 activeTrip 的說明——這個畫面本身允許不選
  // 旅程就瀏覽)時觸發,由呼叫端(PhoneContent.tsx)切到旅程列表分頁,
  // 引導使用者先選一個旅程。原本沒有這個 prop 時,geo.handleScheduleCandidate
  // 內部的 tripID guard 會直接靜默 no-op——使用者點了日期、資訊卡正常
  // 關閉,卻完全沒有任何提示告訴他「因為沒有選旅程所以沒加成功」,是
  // 實際發生過的 bug(桌面版 DesktopLayout.tsx 對應改成開啟旅程列表
  // 浮動卡,這裡是同一個修法的手機版對應)。
  onOpenTrips: () => void
  // theme:這個 App 的深色/淺色模式偏好(useAppState() 的 theme,見
  // theme.ts),由 PhoneContent.tsx 中介(props.theme)——原封不動轉傳給
  // GeoOutlinePanel → GeoOutlineMap 決定建圖時的 colorScheme,見
  // GeoOutlineMap.tsx 對這個 prop 的完整說明。這個元件本身不消費 theme,
  // 純轉傳。
  theme?: Theme
}) {
  const [searchCity, setSearchCity] = useState('')
  const [searchTrigger, setSearchTrigger] = useState(0)
  // geo:選取狀態/候選籃/搜尋候選等地理規劃共用邏輯,與桌面版
  // DesktopLayout.tsx 共用同一個 hook(geo-planning/useGeoPlanningState.ts),
  // 不是各自實作一份形狀相同但獨立維護的版本。
  const geo = useGeoPlanningState({ cfg, tripID })

  // candidateDrawerOpen/candidateFlashTrigger:候選籃抽屜開關與「剛加入
  // 東西了」的短暫提示——理由同桌面版 geoCandidateFlashTrigger,見
  // GeoOutlinePhoneCandidateDrawer.module.css 的 .panelFlash。
  const [candidateDrawerOpen, setCandidateDrawerOpen] = useState(false)
  const [candidateFlashTrigger, setCandidateFlashTrigger] = useState(0)

  // listDrawerState:清單抽屜開關/載入中狀態,收斂成 reduceListDrawerState
  // 這個純 reducer 統一管理(見 geoListDrawerState.ts 的完整說明)——這是
  // 第二次因為「多個查詢入口需要同步打開清單」這件事出 bug 才抽出來的
  // 設計:第一次是子代理重構搜尋路徑時繞開了背負隱藏副作用的 onSearch,
  // 第二次是掛在 onSearchResultsChange 卻踩到 useEffect 掛載時必定執行
  // 一次的陷阱。用顯式的 dispatch(search-started/results-arrived/
  // user-closed)取代分散在各處的 setListDrawerOpen(true/false),每個
  // 查詢入口都必須明確回報「查詢開始了」,不再是某個 callback 字面命名
  // 底下容易被忽略的隱藏副作用。
  const [listDrawerState, dispatchListDrawer] = useReducer(reduceListDrawerState, initialListDrawerState)
  // categoryTagsState:地圖上方類別標籤列該不該隱藏,收斂成
  // reduceCategoryTagsState 這個純 reducer 統一管理(見
  // geoCategoryTagsState.ts 的完整說明)——跟 listDrawerState 是兩個
  // 獨立的狀態機(理由同上),但共用完全相同的三個查詢入口,故下方每個
  // 查詢入口的 callback 都會同時 dispatch 這兩個 reducer,不是先後
  // 兩次分開觸發。手機版/桌面版(DesktopLayout.tsx)共用同一個
  // reduceCategoryTagsState,取代原本兩邊各自一套判斷式的做法。
  const [categoryTagsState, dispatchCategoryTags] = useReducer(reduceCategoryTagsState, initialCategoryTagsState)
  // sheetStack:清單/資訊卡「該不該顯示」的唯一真相來源(見上方
  // SheetEntry 的說明與 useSheetStack.ts 開頭的完整背景)——
  // listDrawerState 仍然存在,但只保留 loading(查詢中動畫)這個語意,
  // open 欄位不再被下方任何地方讀取(清單的 open prop 改成從
  // sheetStack.stack 衍生,見下方 GeoOutlinePhoneListDrawer 的說明)。
  const sheetStack = useSheetStack<SheetEntry>()
  // infoSheetDraggingDown/infoSheetSnapIndex:資訊卡目前是否正在被使用者
  // 往下拖曳、以及目前停在哪一段——使用者明確要求「前一層比後層高時,
  // 往下拉後層也要跟著往下」,這裡簡化成「頂層(資訊卡)一開始往下拖,
  // 後層(清單)就立刻縮到最小段」(使用者確認的行為,不做逐 px 精確跟手
  // 位移)。兩個訊號合起來才能正確判斷「清單該不該維持縮小」(見下方
  // forceCollapsed 傳入處的說明)——只看 infoSheetDraggingDown 有 bug:
  // 鬆手瞬間這個值會變 false,即使資訊卡最終停在最小段,清單也會跟著
  // 立刻恢復原大小(使用者實測回報「資訊卡最小時,地點就恢復大小」)。
  // 只有資訊卡是疊在清單上面(sheetStack.top?.type === 'info',即清單
  // 本身也在畫面上)這個情境才有意義——資訊卡若是由其他入口(點 marker、
  // 城市搜尋單一候選)打開、清單根本沒有疊在下面,這個訊號也不會造成
  // 任何影響(下方傳給 GeoOutlinePhoneListDrawer 的 forceCollapsed 只在
  // listDrawerState.open 為 true 時才有渲染出來的 sheet 可以被強制收合)。
  const [infoSheetDraggingDown, setInfoSheetDraggingDown] = useState(false)
  const [infoSheetSnapIndex, setInfoSheetSnapIndex] = useState(1)
  // addFlashTrigger:候選透過日期清單/日曆 sheet 成功排入某天後遞增,
  // 通知 GeoOutlinePhoneInfoSheet 觸發「已加入」短暫打勾提示(見該檔案
  // addFlashTrigger prop 的完整說明)——「候選已有日期,按下加入行程直接
  // 算成功」這條路徑不經過這個計數器,那是 GeoOutlinePhoneInfoSheet.tsx
  // 內部自己知道候選已有日期、自己 dispatch 的既有行為(見該檔案
  // handleAddClick),完全發生在那個元件內部、不涉及這一層,不需要繞經
  // 這裡的計數器。這裡的計數器只負責「選定日期」這個動作發生在
  // GeoOutlinePhoneView.tsx(而非資訊卡內部)的那兩條路徑——資訊卡本身
  // 已經不知道使用者透過哪個 sheet、選了哪一天,只能被動接收這個訊號。
  const [addFlashTrigger, setAddFlashTrigger] = useState(0)
  // handleScheduleFromDateSheet:日期清單 sheet(onPickDate)/日曆 sheet
  // (onConfirm)共用的「選定日期、寫入候選」邏輯——對應舊版
  // handlePickScheduledDate/handleConfirmDate 兩個各自獨立的函式,現在
  // 收斂成一個(兩者原本的邏輯完全相同:候選是否存在的 guard、呼叫
  // geo.handleScheduleCandidate、收掉日期選擇 sheet,唯一差異只在觸發
  // 來源,沒有理由維持兩份重複程式碼)。candidate 由呼叫端(下方兩個
  // sheet 的 onPickDate/onConfirm)傳入——這兩層 sheet 本身不持有候選
  // 資料,候選來自資訊卡目前顯示的 geo.infoContent.candidate,由這裡
  // 統一從 geo 讀取,呼叫端只需要傳日期字串。tripID 為空時導向旅程列表
  // (理由同資訊卡 onSchedule 的既有 guard),不寫入、也不觸發打勾提示或
  // 關閉堆疊——使用者應該先選定旅程,這次操作視為未完成。
  //
  // popDateSheets(取代原本誤用的 sheetStack.closeAll()):選定日期後只
  // 收掉堆疊頂端連續的 'date-picker'/'date-calendar' 這幾層,不是清空
  // 整個堆疊——closeAll() 會連同底下的 'info'(甚至更底下的 'list')一併
  // 清掉,跟需求「兩層 sheet 都關閉,回到資訊卡」矛盾(資訊卡本身也在
  // 堆疊裡,見 onAttractionSelect 等入口的 sheetStack.replace({type:
  // 'info'})),回到資訊卡代表堆疊裡的 'info' 這一層要保留,只是它上面
  // 疊的日期選擇層(1~2 層,視是否經過 'date-picker')要收掉。
  //
  // 用 sheetStack.stack 算出「頂端連續幾層是日期選擇 sheet」再呼叫對應
  // 次數的 pop(),而不是寫一個 while(sheetStack.top === ...) 迴圈——
  // sheetStack.pop() 底下是 setStack(s => s.slice(0,-1)) 這種功能式
  // update,連續呼叫兩次會正確疊加(React 依序套用每個 updater),但
  // sheetStack.top 是這次 render 當下算好的衍生值,在同一個事件處理常式
  // 裡連續呼叫 pop() 不會讓 top 跟著「即時」改變(要等下一次 render 才會
  // 反映最新的 stack),用它當 while 迴圈的終止條件會讀到永遠不變的
  // 過期值,不會如預期般只跑 1~2 次就停止。改成先用目前這次 render 拿到
  // 的 stack 陣列(不是會過期的 top)倒著數有幾層是日期選擇 sheet,算出
  // 一個固定次數再呼叫對應次數的 pop(),就不會有這個問題。
  const popDateSheets = useCallback(() => {
    let count = 0
    for (let i = sheetStack.stack.length - 1; i >= 0; i--) {
      const t = sheetStack.stack[i].type
      if (t !== 'date-picker' && t !== 'date-calendar') break
      count++
    }
    for (let i = 0; i < count; i++) sheetStack.pop()
  }, [sheetStack])
  const handleScheduleFromDateSheet = useCallback((date: string) => {
    const candidate = geo.infoContent?.candidate
    if (!candidate) return
    if (!activeTrip) {
      onOpenTrips()
      return
    }
    geo.handleScheduleCandidate(candidate, date, 'GeoOutlinePhoneView')
    setAddFlashTrigger((n) => n + 1)
    popDateSheets()
  }, [geo, activeTrip, onOpenTrips, popDateSheets])
  // handleAddCandidateAndReveal:資訊卡「加入候選」按鈕(候選已有排定
  // 日期,直接加入)成功後順便打開候選籃抽屜給使用者看——手機版沒有
  // 桌面版「側欄本來就常駐展開」的前提(側欄本身可收合,見
  // candidateDrawerOpen),故這裡不像桌面版分成 onAddCandidate/
  // onAddAndReveal 兩顆按鈕,加入候選這個單一動作統一都順便打開抽屜、
  // 觸發一次 flash 提示,讓使用者確實看到剛加的項目,不需要使用者自己
  // 再多按一次「候選籃」圖示才看得到結果。
  const handleAddCandidate = useCallback((c: GeoCandidate) => {
    geo.addCandidate(c)
    setCandidateDrawerOpen(true)
    setCandidateFlashTrigger((n) => n + 1)
  }, [geo])

  return (
    <div className={styles.wrap}>
      <div className={styles.candidateGroup}>
        <button
          type="button"
          className={styles.candidateBtn}
          onClick={() => setCandidateDrawerOpen(true)}
          title="候選籃"
        >
          <ListPlus size={20} strokeWidth={1.8} />
          {geo.candidates.length > 0 && <span className={styles.candidateBadge}>{geo.candidates.length}</span>}
        </button>
        {onOpenTimeline && (
          <button
            type="button"
            className={styles.listBtn}
            onClick={onOpenTimeline}
            title="時間軸"
          >
            <Timeline size={20} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <GeoOutlinePanel
        cfg={cfg}
        tripID={tripID}
        city={searchCity}
        onCityChange={setSearchCity}
        onSearch={() => {
          // 重新搜尋時清空目前選取的地點,關閉正在顯示的地點介紹卡——
          // 理由同 DesktopLayout.tsx 對應的 onSearch 說明。城市搜尋框
          // 這個入口的「查詢開始」時機——dispatchListDrawer/dispatchCategoryTags
          // 的 search-started 語意保留(loading 動畫、標籤列隱藏,見
          // geoListDrawerState.ts/geoCategoryTagsState.ts 的說明),但清單
          // 「該不該顯示」這件事現在改由 sheetStack 表達:sheetStack.closeAll()
          // 先清空整個堆疊(不管之前疊了什麼——可能還顯示著上一次查詢
          // 選中的資訊卡,新一次搜尋是全新的操作循環,不需要延續舊的堆疊
          // 狀態,這是使用者明確確認的設計決策),再 push({type:'list'})
          // 讓清單重新以「堆疊底層」的姿態打開。
          geo.clearSelection()
          setSearchTrigger((n) => n + 1)
          dispatchListDrawer({ type: 'search-started' })
          dispatchCategoryTags({ type: 'search-started' })
          sheetStack.closeAll()
          sheetStack.push({ type: 'list' })
        }}
        onSearchStart={() => {
          // 類別標籤/「搜尋這個區域」按鈕這兩個入口的「查詢開始」時機
          // ——見 GeoOutlineMap.tsx onSearchStart 的完整說明,這兩個入口
          // 不經過上面的 onSearch,故需要各自接這個獨立的 callback 才能
          // 涵蓋全部三個入口。sheetStack 的操作跟上面 onSearch 完全對稱
          // (closeAll 再 push 'list')——理由相同:三個查詢入口都代表
          // 「使用者開始了一次全新的搜尋操作」,不該讓舊堆疊殘留。
          dispatchListDrawer({ type: 'search-started' })
          dispatchCategoryTags({ type: 'search-started' })
          sheetStack.closeAll()
          sheetStack.push({ type: 'list' })
        }}
        hideCategoryTags={categoryTagsState.hidden}
        searchTrigger={searchTrigger}
        showZoomControl={false}
        searchRightSlot={
          <button type="button" className={styles.avatarBtn} onClick={onOpenSettings} title="設定">
            <Avatar user={user} />
          </button>
        }
        refetchTripEntriesTrigger={geo.refetchTripEntriesTrigger}
        geocodeCandidates={geo.geocodeCandidates}
        setGeocodeCandidates={geo.setGeocodeCandidates}
        selectedCandidate={geo.selectedCandidate}
        setSelectedCandidate={geo.setSelectedCandidate}
        onSearchResultsChange={(results) => {
          // 查詢結果回來時——dispatchListDrawer({type:'results-arrived'})
          // 這個 dispatch 保留,但不再依賴它回傳的 open 欄位(那個欄位
          // 已經沒有任何地方讀取,見上方 SheetEntry 的說明)——這裡只需要
          // 它的 loading:false 語意(結束查詢中動畫)。標籤列的顯示/隱藏
          // 邏輯不受這次改動影響(依結果是否為空決定,見
          // geoCategoryTagsState.ts 的說明)。
          //
          // 「唯一解時清單不顯示、資訊卡自動顯示」這條規則現在改用
          // sheetStack.replace 表達:resultCount === 1 時,把堆疊頂端
          // 換成 {type:'info'}——查詢入口(onSearch/onSearchStart)已經
          // 在「查詢開始」的當下 push 過 {type:'list'},此刻堆疊頂端必然
          // 是 'list',replace 換成 'info' 精準對應「清單不需要了,直接
          // 顯示資訊卡」這個語意,不增加堆疊深度(此時堆疊仍只有一層)。
          // 這裡不需要知道是哪個查詢入口觸發的——三個入口對堆疊的操作
          // 完全一致,replace 邏輯天然正確。
          //
          // resultCount 為 0 或多筆時,堆疊維持不動(頂端仍是 'list',
          // 查詢開始時 push 的那一層,讓清單顯示結果或空狀態文案)。
          dispatchListDrawer({ type: 'results-arrived', resultCount: results.length })
          dispatchCategoryTags({ type: 'results-arrived', hasResults: results.length > 0 })
          if (results.length === 1) {
            sheetStack.replace({ type: 'info' })
          }
        }}
        externalGeocodeCandidateSelect={geo.searchResultSelect}
        onTripEntriesChange={geo.onTripEntriesChange}
        // onAttractionSelect/onSearchResultSelect/onPoiSelect:點地圖上的
        // 自建景點/飯店與推薦地點/POI marker,由 GeoOutlineMap 內部觸發
        // ——這三個入口跟清單 onSelect(下方)不同,沒有「從清單點進來」
        // 這件事,故用 sheetStack.replace(而非 push)——理由見上方
        // SheetEntry 的說明:連續點不同 marker 應該直接換資訊卡內容,
        // 不增加堆疊深度(使用者明確確認的行為,關閉鍵不需要按兩次)。
        // 這也是 onSearchResultSelect 唯一解自動選中(GeoOutlinePanel.tsx
        // 內部呼叫,見該檔案 onlyResult 分支)共用的同一個 callback——
        // 唯一解時堆疊頂端已經被上方 onSearchResultsChange 的 replace
        // 換成 'info' 了,這裡再 replace 一次是 no-op(頂端本來就是
        // 'info',語意上不會出錯)。
        onAttractionSelect={(attraction) => {
          geo.selectAttraction(attraction)
          sheetStack.replace({ type: 'info' })
        }}
        onSearchResultSelect={(result) => {
          geo.selectSearchResult(result)
          sheetStack.replace({ type: 'info' })
        }}
        onPoiSelect={(details) => {
          geo.selectPoi(details)
          sheetStack.replace({ type: 'info' })
        }}
        onGeocodeCandidateText={(_placeId, text) => geo.patchGeocodeCandidateText(text)}
        onGeocodeCandidatePhoto={(_placeId, photoUrl) => geo.patchGeocodeCandidatePhoto(photoUrl)}
        selectedKey={geo.selectedKey}
        candidateKeys={geo.candidateKeys}
        panTarget={geo.panTarget}
        theme={theme}
      />
      <GeoOutlinePhoneInfoSheet
        // content/attraction:GeoOutlinePhoneInfoSheet 元件本身的職責只是
        // 「有內容就顯示」(content!=null || attraction!=null),不知道
        // 也不該知道 sheetStack 這個更上層的堆疊概念(職責邊界維持不動,
        // 見這次重構的說明)——「該不該顯示」現在由呼叫端(這裡)做
        // gate:只有堆疊裡確實有 {type:'info'} 這一項時,才把 geo 算出來
        // 的真正內容傳進去,否則傳 null,讓元件自然判斷不渲染。這樣即使
        // geo.infoContent/attractionContent 有殘留值(例如資訊卡剛被
        // sheetStack.pop() 關閉,但 geo.clearSelection() 的 state 更新
        // 還沒反映),畫面也不會誤顯示——sheetStack 才是唯一真相來源。
        content={sheetStack.stack.some((e) => e.type === 'info') ? geo.infoContent : null}
        attraction={sheetStack.stack.some((e) => e.type === 'info') ? geo.attractionContent : null}
        onClose={() => {
          // pop 移除堆疊頂層的 'info'——若下面疊著 'list'(從清單點進來
          // 的路徑),清單自動露出重新變回頂層;若堆疊裡沒有 'list'(由
          // 點 marker/唯一解/候選籃選取這幾個用 replace 打開的路徑),
          // pop 後堆疊變空,回到「沒有上一層就什麼都不開」——這是使用者
          // 先前確認過的既有行為,這次重構後依然成立,不需要特別處理。
          // geo.clearSelection() 清空 infoContent/attractionContent 本身
          // (內容清空),兩者合起來才是「資訊卡真正消失」的完整動作。
          sheetStack.pop()
          geo.clearSelection()
        }}
        onAddCandidate={handleAddCandidate}
        // onOpenDatePicker:候選沒有排定日期時觸發(見
        // GeoOutlinePhoneInfoSheet.tsx handleAddClick 的說明)——依
        // geo.scheduledDates 是否為空決定 push 哪一層:非空時先顯示日期
        // 清單 sheet 讓使用者快速挑既有日期,完全沒有排定日期時直接跳過
        // 清單、開日曆 sheet(空清單沒有任何 chip 可選,見上方 SheetEntry
        // 的說明)。
        onOpenDatePicker={() => {
          sheetStack.push(geo.scheduledDates.length === 0 ? { type: 'date-calendar' } : { type: 'date-picker' })
        }}
        onDraggingDownChange={setInfoSheetDraggingDown}
        onSnapIndexChange={setInfoSheetSnapIndex}
        addFlashTrigger={addFlashTrigger}
      />
      <GeoOutlinePhoneDatePickerSheet
        open={sheetStack.stack.some((e) => e.type === 'date-picker')}
        scheduledDates={geo.scheduledDates}
        onPickDate={handleScheduleFromDateSheet}
        onOtherDate={() => sheetStack.push({ type: 'date-calendar' })}
        onClose={() => sheetStack.pop()}
        isTopmost={sheetStack.top?.type === 'date-picker'}
        stackOffsetPx={sheetStack.top?.type === 'date-calendar' ? 16 : 0}
      />
      <GeoOutlinePhoneDateCalendarSheet
        open={sheetStack.stack.some((e) => e.type === 'date-calendar')}
        onConfirm={handleScheduleFromDateSheet}
        onClose={() => sheetStack.pop()}
        isTopmost={sheetStack.top?.type === 'date-calendar'}
      />
      <GeoOutlinePhoneCandidateDrawer
        cfg={cfg}
        tripID={tripID}
        open={candidateDrawerOpen}
        onClose={() => setCandidateDrawerOpen(false)}
        candidates={geo.candidates}
        scheduledDates={geo.scheduledDates}
        onRemove={(c) => geo.handleRemoveCandidate(c, 'GeoOutlinePhoneCandidateDrawer')}
        onSelect={(c) => {
          // 候選籃選取候選項目——跟點地圖 marker 一樣是非清單來源的入口,
          // 用 replace 不用 push(理由見上方 onAttractionSelect 等的說明)。
          geo.selectCandidateFromBasket(c)
          setCandidateDrawerOpen(false)
          sheetStack.replace({ type: 'info' })
        }}
        onReturnToCandidate={(c) => geo.handleReturnToCandidate(c, 'GeoOutlinePhoneCandidateDrawer')}
        onScheduled={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
        flashTrigger={candidateFlashTrigger}
      />
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID={tripID}
        // open:改成從 sheetStack 衍生——堆疊裡任何位置(不限頂層)存在
        // {type:'list'} 就算開啟。「不限頂層」是關鍵:資訊卡疊在清單上面
        // 時('list' 在下、'info' 在頂),清單仍要維持掛載顯示(只是套用
        // 退縮視覺,見下方 isTopmost/forceCollapsed),不能因為它不是
        // 堆疊頂層就整個消失——舊版 listDrawerState.open 這個獨立布林值
        // 已經不再是真相來源(仍保留 loading 語意)。
        open={sheetStack.stack.some((e) => e.type === 'list')}
        onClose={() => {
          // 使用者手動關閉清單(拖到底/按關閉鈕)——sheetStack.closeAll()
          // 現在是真正決定清單(跟可能疊在上面的資訊卡)一起消失的動作,
          // 不再只是「清空堆疊記錄」這種輔助語意(舊版清單開關的真相
          // 來源是 listDrawerState.open,closeAll 只是順便清掉堆疊記錄
          // 避免資訊卡之後 pop 到不存在的清單;現在 open 本身就是從
          // sheetStack 衍生,closeAll 直接讓 open 變 false)。同時
          // dispatch user-closed 給標籤列狀態機,重新顯示標籤列(見
          // geoCategoryTagsState.ts 的說明)。
          //
          // 清空 geo.geocodeCandidates——使用者主動關閉清單是明確的「不想
          // 再看這批搜尋結果」訊號,地圖上對應的候選 marker 若繼續留著,
          // 會跟「已經關閉清單」的預期不符(清單抽屜關閉了,地圖卻還留著
          // 一堆跟這批已關閉清單對應的點)。geo.searchResults 是
          // geocodeCandidates 衍生出來的鏡像(見 useGeoPlanningState.ts 的
          // 說明),清空這裡會讓兩者一起變空陣列,不需要分別呼叫兩個
          // setter。
          //
          // 一併清空 searchCity(城市搜尋框文字)——理由同上,清單已經
          // 代表「這批搜尋結果不要了」,搜尋框若還留著上次查詢的文字,
          // 使用者容易誤以為「還在查這個」,或下次開啟清單時忽然看到
          // 上次搜尋的殘留文字。這裡直接清空是單一動作的直接副作用(不是
          // 多個入口共同影響同一狀態的複合互動),不需要额外的狀態機,
          // 對齊 GeoOutlinePanel.tsx 既有「搜尋框文字清空時連動清空
          // geocodeCandidates」規則的反向對應。
          setSearchCity('')
          geo.setGeocodeCandidates([])
          dispatchListDrawer({ type: 'user-closed' })
          dispatchCategoryTags({ type: 'user-closed' })
          sheetStack.closeAll()
        }}
        loading={listDrawerState.loading}
        results={geo.searchResults}
        selectedKey={geo.selectedKey}
        candidateKeys={geo.candidateKeys}
        scheduledDates={geo.scheduledDates}
        // isTopmost:改成直接檢查堆疊頂端是否確實是 'list'——比舊版
        // 「頂端不是 info」更直接精準(舊版在只有 'info' 這種可能疊項的
        // 年代兩者等價,但現在堆疊裡可能有其他組合,直接判斷 top 是不是
        // 'list' 本身語意更清楚,不用靠排除法)。
        isTopmost={sheetStack.top?.type === 'list'}
        // forceCollapsed:資訊卡正在往下拖、或已經停在最小段時,清單一併
        // 縮到最小段(見上方 infoSheetDraggingDown/infoSheetSnapIndex 的
        // 說明)——只看「正在拖曳中」不夠,鬆手瞬間 infoSheetDraggingDown
        // 會歸零,即使資訊卡最終停在最小段(infoSheetSnapIndex === 0),
        // 若不額外檢查段落,清單會在鬆手那一刻立刻恢復原大小,跟已經縮到
        // 最小的資訊卡視覺不符。只有資訊卡確實疊在這個清單上面時才有
        // 意義,故額外檢查 sheetStack.top?.type === 'info'(資訊卡是從
        // 清單點進來的那條路徑),避免資訊卡由其他入口打開、清單根本沒有
        // 一起顯示時,這個訊號誤觸發清單收合。
        forceCollapsed={
          (infoSheetDraggingDown || infoSheetSnapIndex === 0) && sheetStack.top?.type === 'info'
        }
        onSelect={(r) => {
          // 三種來源(飯店/地點/搜尋結果)既然合併成同一份清單,點擊行為
          // 一律走 selectSearchResultFromList,對齊桌面版
          // GeoHotelSidebar——讓 GeoOutlinePanel 觸發完整查詢(含
          // onlyIfOutOfView 移動地圖,見 useGeoPlanningState.ts 對這個
          // 函式的說明),不在這裡重新實作一份簡化版邏輯。
          //
          // 不再關閉清單(dispatchListDrawer user-closed)——改成把資訊卡
          // push 進堆疊,疊在清單上面(isTopmost 變 false,清單套用退縮
          // 視覺、停用手勢,見上方 isTopmost prop)。資訊卡關閉時
          // sheetStack.pop() 讓清單自動重新變回頂層,不需要「重新打開」
          // 清單這個動作,因為它從未真正關閉過。這是這次 useSheetStack
          // 接線要解決的具體 bug(見 useSheetStack.ts 開頭說明)。
          geo.selectSearchResultFromList(r)
          sheetStack.push({ type: 'info' })
        }}
        onAddCandidate={handleAddCandidate}
        onCandidateCreated={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
      />
    </div>
  )
}
