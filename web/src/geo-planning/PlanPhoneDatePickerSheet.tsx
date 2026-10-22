import { dayGroupLabel } from './geoCandidateHelpers'
import { StackedSheet, SheetBody, SheetHead } from '../components/PhoneBottomSheet'
import { PLAN_SHEET_STACK, PLAN_SHEET_BACKDROP } from '../components/zLayers'
import styles from './PlanPhoneDatePickerSheet.module.css'

// SHEET_SNAP_POINTS:單段模式(只有一個值)——這層 sheet 的內容是一份
// 可捲動的日期清單,不需要像資訊卡那樣多段吸附展開/收合,對齊
// geo-planning/phone/ResultList.tsx/trip/phone/TripList.tsx 這類「單段、往下拖
// 到底就整個關閉」的既有用法(見 PhoneBottomSheet.tsx 對 isSingleStop 的
// 說明,單段模式下 atMaxExpansion 恆為 true,.body 自動可原生捲動,見
// PlanPhoneDatePickerSheet.module.css 的說明)。離頂部 420px——
// 粗估容納標頭 + 數列日期項目 + 「其他日期」選項後還留一截可視的地圖
// 背景,不需要跟資訊卡的 SHEET_SNAP_POINTS 對齊(兩者呈現的內容量體
// 不同)。
const SHEET_SNAP_POINTS = [420]

// PlanPhoneDatePickerSheet:「加入行程」流程裡的第一層 sheet——
//
// 2026-10 改名(原檔名 GeoOutlinePhoneDatePickerSheet,見 PlanPhoneView.tsx
// 檔頭的完整說明)。
//
// 候選沒有排定日期、但行程本身已有排定日期(scheduledDates 非空)時,
// 呼叫端(PlanPhoneView.tsx)會 push 這一層,顯示既有日期的縱向
// 可捲動清單讓使用者快速挑一天,或點「其他日期」再疊一層日曆 sheet
// (PlanPhoneDateCalendarSheet.tsx)手動輸入。
//
// 這個元件延續 PlanPhoneInfoSheet.tsx 的職責邊界——只負責「給定
// 資料就顯示、給定 callback 就觸發」,完全不知道 sheetStack 這個更上層的
// 堆疊概念存在:open 由呼叫端 gate(堆疊裡是否有 {type:'date-picker'}
// 這一項),onPickDate/onOtherDate/onClose 純粹是事件轉發,呼叫端才是
// 真正決定要 push/pop 的地方。
//
// 2026-08 之前,這份日期清單是內嵌在 PlanPhoneInfoSheet.tsx 的
// `.dateEdit` 區塊裡(`addUi.mode === 'open'` 才顯示),當時是橫向
// flex-wrap 排列的 chips——這次改成獨立 sheet 疊在資訊卡之上時,同時
// 改成縱向可捲動清單(使用者明確要求「選擇日期改成用清單可以上下滾動
// 的」,見 PlanPhoneDatePickerSheet.module.css 的 .dateList 說明:
// 既有日期一多,chips 換行排列不利於快速掃視/點選),dayGroupLabel 格式化
// 邏輯不變,只是排版與 class 名稱換成 .dateList/.dateListItem。
export function PlanPhoneDatePickerSheet({
  open,
  scheduledDates,
  onPickDate,
  onOtherDate,
  onClose,
  isTopmost,
  stackOffsetPx,
}: {
  open: boolean
  // scheduledDates:行程本身目前已排定的日期清單,由呼叫端算好傳入——
  // 理由同 PlanPhoneInfoSheet.tsx 的同名 prop。這一層 sheet 只有在
  // 這份清單非空時才會被呼叫端打開(見 PlanPhoneView.tsx 的
  // onOpenDatePicker 接線:scheduledDates.length === 0 時直接跳過這一層,
  // 改開日曆 sheet),但這裡仍接受空陣列而不假設非空,理由是 open 本身
  // 已經是呼叫端 gate 過的結果,這個元件不需要重複假設呼叫端一定會遵守
  // 這個前提,防呆處理空陣列時單純不渲染日期清單區塊。
  scheduledDates: string[]
  // onPickDate:點某個既有日期清單項目——呼叫端收到後會呼叫「選定日期、
  // 寫入候選」的邏輯(對應舊版 handlePickScheduledDate),完成後收掉
  // 這一層(以及可能疊在上面的日曆 sheet)一起關閉,回到資訊卡——只收
  // 日期選擇這幾層,不動更底下的資訊卡,見 PlanPhoneView.tsx 的
  // popDateSheets 說明。
  onPickDate: (date: string) => void
  // onOtherDate:點「其他日期」——呼叫端會 sheetStack.push({type:
  // 'date-calendar'}),在這一層之上再疊一層日曆 sheet,讓使用者手動輸入
  // 不在 scheduledDates 清單裡的日期。
  onOtherDate: () => void
  // onClose:使用者主動關閉這一層(拖到底/按關閉鈕)——呼叫端會
  // sheetStack.pop(),只關掉這一層本身,回到資訊卡。
  onClose: () => void
  // isTopmost/stackOffsetPx:原封不動轉傳給 PhoneBottomSheet——這一層
  // sheet 是否目前是堆疊最上層、被壓在下層時要露出多少邊緣,見
  // PhoneBottomSheet.tsx 對應 prop 的說明。日曆 sheet 疊上來的當下,這一層
  // 會變成 isTopmost=false。
  //
  // isTopmost 改成必填(code review 發現:原本選填+內部 ?? true 補預設
  // 值,等於在 StackedSheet 刻意把 isTopmost 設計成必填、防止被意外
  // 忽略的保護之外,又重新開了一個後門——這個元件唯一的呼叫端
  // PlanPhoneView.tsx 其實一直都有明確傳值,選填只是個從未被用到、但
  // 一旦有新呼叫端漏傳就會靜默吃到「永遠當作頂層」這種錯誤預設值的
  // 潛在風險,見 StackedSheet 原始設計的完整說明)。
  isTopmost: boolean
  stackOffsetPx?: number
}) {
  return (
    <StackedSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      // zIndex 改引用 PLAN_SHEET_STACK.datePicker(2026-10,見 zLayers.ts
      // 的完整說明,取代原本寫死的 38)——這一層疊在資訊卡之上,日曆
      // sheet 又要比這一層更高(PLAN_SHEET_STACK.dateCalendar),形成
      // 清單 < 資訊卡 < 日期清單 < 日曆的完整疊放順序,見 zLayers.ts
      // PLAN_SHEET_STACK 的完整說明。
      panelStyle={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: PLAN_SHEET_STACK.datePicker }}
      backdropStyle={{ position: 'fixed', inset: 0, zIndex: PLAN_SHEET_BACKDROP, background: 'rgba(0, 0, 0, 0.32)' }}
      isTopmost={isTopmost}
      stackOffsetPx={stackOffsetPx}
      head={<SheetHead title="選擇日期" onClose={onClose} />}
    >
      {/* SheetBody 取代原本「PhoneBottomSheet 自動幫 children 包一層
          可捲動 .body」的舊行為(見該元件檔頭/module.css 原本對
          「.body 自動可原生捲動」的完整說明)——這次重構後 children 不再
          自動被包住,這個檔案的內容(日期清單,可能超出可視高度需要捲動)
          需要明確用 SheetBody 包起來,才能維持原本捲動+拖拉交接到頂收合
          的行為,不這樣做的話會是一次真實的功能回歸。 */}
      <SheetBody>
        <div className={styles.body}>
          {scheduledDates.length > 0 && (
            <div className={styles.dateList}>
              {scheduledDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  className={styles.dateListItem}
                  onClick={() => onPickDate(date)}
                >
                  {dayGroupLabel(date)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={styles.otherDateBtn} onClick={onOtherDate}>
            其他日期
          </button>
        </div>
      </SheetBody>
    </StackedSheet>
  )
}
