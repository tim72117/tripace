import { dayGroupLabel } from './geoCandidateHelpers'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS, SheetHead } from '../components/PhoneBottomSheet'
import styles from './GeoOutlinePhoneDatePickerSheet.module.css'

// SHEET_SNAP_POINTS:單段模式(只有一個值)——這層 sheet 的內容是一份
// 可捲動的日期清單,不需要像資訊卡那樣多段吸附展開/收合,對齊
// GeoOutlinePhoneListDrawer.tsx/PhoneTripsDrawer.tsx 這類「單段、往下拖
// 到底就整個關閉」的既有用法(見 PhoneBottomSheet.tsx 對 isSingleStop 的
// 說明,單段模式下 atMaxExpansion 恆為 true,.body 自動可原生捲動,見
// GeoOutlinePhoneDatePickerSheet.module.css 的說明)。離頂部 420px——
// 粗估容納標頭 + 數列日期項目 + 「其他日期」選項後還留一截可視的地圖
// 背景,不需要跟資訊卡的 SHEET_SNAP_POINTS 對齊(兩者呈現的內容量體
// 不同)。
const SHEET_SNAP_POINTS = [420]

// GeoOutlinePhoneDatePickerSheet:「加入行程」流程裡的第一層 sheet——
// 候選沒有排定日期、但行程本身已有排定日期(scheduledDates 非空)時,
// 呼叫端(GeoOutlinePhoneView.tsx)會 push 這一層,顯示既有日期的縱向
// 可捲動清單讓使用者快速挑一天,或點「其他日期」再疊一層日曆 sheet
// (GeoOutlinePhoneDateCalendarSheet.tsx)手動輸入。
//
// 這個元件延續 GeoOutlinePhoneInfoSheet.tsx 的職責邊界——只負責「給定
// 資料就顯示、給定 callback 就觸發」,完全不知道 sheetStack 這個更上層的
// 堆疊概念存在:open 由呼叫端 gate(堆疊裡是否有 {type:'date-picker'}
// 這一項),onPickDate/onOtherDate/onClose 純粹是事件轉發,呼叫端才是
// 真正決定要 push/pop 的地方。
//
// 2026-08 之前,這份日期清單是內嵌在 GeoOutlinePhoneInfoSheet.tsx 的
// `.dateEdit` 區塊裡(`addUi.mode === 'open'` 才顯示),當時是橫向
// flex-wrap 排列的 chips——這次改成獨立 sheet 疊在資訊卡之上時,同時
// 改成縱向可捲動清單(使用者明確要求「選擇日期改成用清單可以上下滾動
// 的」,見 GeoOutlinePhoneDatePickerSheet.module.css 的 .dateList 說明:
// 既有日期一多,chips 換行排列不利於快速掃視/點選),dayGroupLabel 格式化
// 邏輯不變,只是排版與 class 名稱換成 .dateList/.dateListItem。
export function GeoOutlinePhoneDatePickerSheet({
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
  // 理由同 GeoOutlinePhoneInfoSheet.tsx 的同名 prop。這一層 sheet 只有在
  // 這份清單非空時才會被呼叫端打開(見 GeoOutlinePhoneView.tsx 的
  // onOpenDatePicker 接線:scheduledDates.length === 0 時直接跳過這一層,
  // 改開日曆 sheet),但這裡仍接受空陣列而不假設非空,理由是 open 本身
  // 已經是呼叫端 gate 過的結果,這個元件不需要重複假設呼叫端一定會遵守
  // 這個前提,防呆處理空陣列時單純不渲染日期清單區塊。
  scheduledDates: string[]
  // onPickDate:點某個既有日期清單項目——呼叫端收到後會呼叫「選定日期、
  // 寫入候選」的邏輯(對應舊版 handlePickScheduledDate),完成後收掉
  // 這一層(以及可能疊在上面的日曆 sheet)一起關閉,回到資訊卡——只收
  // 日期選擇這幾層,不動更底下的資訊卡,見 GeoOutlinePhoneView.tsx 的
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
  isTopmost?: boolean
  stackOffsetPx?: number
}) {
  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      // zIndex 38:比資訊卡(GeoOutlinePhoneInfoSheet.tsx)的 37 高一階
      // ——這一層疊在資訊卡之上,對齊資訊卡相對清單抽屜(36)高一階的既有
      // 模式(見該檔案 panelStyle 的說明)。日曆 sheet 又要比這一層更高
      // (見 GeoOutlinePhoneDateCalendarSheet.tsx 的 39),形成
      // 清單(36) < 資訊卡(37) < 日期清單(38) < 日曆(39) 的完整疊放順序。
      panelStyle={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 38 }}
      backdropStyle={{ position: 'fixed', inset: 0, zIndex: 35, background: 'rgba(0, 0, 0, 0.32)' }}
      isTopmost={isTopmost}
      stackOffsetPx={stackOffsetPx}
      // exitDurationMs:原本遺漏,導致關閉時是瞬間消失、沒有退場滑出
      // 動畫,跟資訊卡/地點清單抽屜/候選籃(三者都有帶這個 prop)的節奏
      // 不一致(使用者實測回報「資訊卡與其他卡片動畫節奏不一樣」)——這個
      // 呼叫端是容器常駐掛載(open 由 sheetStack gate,不是資料驅動卸載,
      // 見上方元件說明),不帶這個 prop 時 shouldRender 會在 open 變
      // false 的當下就同步變 false,PhoneBottomSheet.tsx 直接不渲染
      // panel,退場動畫完全沒有機會播放。
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      head={<SheetHead title="選擇日期" onClose={onClose} />}
    >
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
    </PhoneBottomSheet>
  )
}
