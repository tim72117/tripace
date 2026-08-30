import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS, SheetHead } from '../components/PhoneBottomSheet'
import { DatePickerPopover } from './DatePickerPopover'
import styles from './GeoOutlinePhoneDateCalendarSheet.module.css'

// SHEET_SNAP_POINTS:單段模式,理由同 GeoOutlinePhoneDatePickerSheet.tsx
// ——月曆格線(DatePickerPopover,見下方元件說明)本身需要的高度比原生
// <input type="date"> 大很多,估算基準比照 GeoInfoPanel.tsx
// estimatedCalendarHeight 的既有算法(32 導覽列 + 28 星期列 + 6 週 × 34
// 格高 + 16 內距 + 6 邊界 ≈ 286px),再加上這個 sheet 的 head 標頭高度
// (約 40px)與上下 padding,取 360px。
const SHEET_SNAP_POINTS = [360]

// GeoOutlinePhoneDateCalendarSheet:「加入行程」流程裡的日曆 sheet——由
// 兩條路徑之一 push 進堆疊:
//   1. 候選沒有排定日期、行程本身也沒有排定日期(scheduledDates 為空)
//      ——直接由資訊卡的 onOpenDatePicker 開啟這一層,跳過日期清單 sheet
//      (見 GeoOutlinePhoneView.tsx 的接線,空清單沒有任何 chip 可以選,
//      多疊一層日期清單 sheet 只會讓使用者多一次無意義的點擊)。
//   2. 日期清單 sheet(GeoOutlinePhoneDatePickerSheet.tsx)點「其他日期」
//      ——疊在日期清單 sheet 之上,兩層同時存在。
//
// 這個元件延續同一套職責邊界(只負責顯示與轉發事件,不知道 sheetStack
// 概念存在)——open 由呼叫端 gate,onConfirm 帶著使用者選定的日期字串
// 讓呼叫端決定怎麼寫入(對應舊版 handleConfirmDate),onClose 純粹是
// 「使用者主動關掉這一層」的轉發。
//
// 2026-08 之前,這裡是原生 <input type="date"> + 確定按鈕,內嵌在
// GeoOutlinePhoneInfoSheet.tsx 的 `.dateEdit` 區塊裡,輸入值存在
// geoAddCandidateState.ts 的 addUi.dateValue——這次改成獨立 sheet 時
// 先搬到這個元件自己的 useState。使用者接著明確要求「日曆要用跟桌面版
// 的日曆一樣」,改用 DatePickerPopover(react-day-picker 月曆格線 UI,
// 見 GeoInfoPanel.tsx/GeoCandidateSidebar.tsx 已經在用的同一個共用元件,
// 平台無關、不是桌面版專屬——原本因為手機版尚未有這個元件才暫時退回
// 原生 date input,不是刻意要跟桌面版呈現不同的日期選擇體驗)。
// DatePickerPopover 本身點選日期格子即視為確定(見該檔案 onSelect 的
// 說明,不需要額外的「確定」按鈕),故這個元件不再需要自己持有
// dateValue 這個中介 state——選了就直接呼叫 onConfirm,收斂成一個更
// 精簡的無狀態轉發。
export function GeoOutlinePhoneDateCalendarSheet({
  open,
  onConfirm,
  onClose,
  isTopmost,
  stackOffsetPx,
}: {
  open: boolean
  // onConfirm:按下確定——帶著目前輸入框選定的日期字串回報給呼叫端,由
  // 它決定怎麼寫入(呼叫「選定日期、寫入候選」的邏輯,對應舊版
  // handleConfirmDate),完成後呼叫端會收掉這一層(以及底下的日期清單
  // sheet,若存在)——只收日期選擇這幾層,不動更底下的資訊卡,見
  // GeoOutlinePhoneView.tsx 的 popDateSheets 說明。
  onConfirm: (date: string) => void
  // onClose:使用者主動關閉這一層——呼叫端會 sheetStack.pop(),只關掉
  // 這一層本身。若底下疊著日期清單 sheet,pop 後會重新
  // 露出那一層;若是跳過日期清單 sheet 直接開啟這一層的路徑(見上方
  // 元件說明的路徑 1),pop 後堆疊變空,回到資訊卡。
  onClose: () => void
  isTopmost?: boolean
  stackOffsetPx?: number
}) {
  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      // zIndex 39:比日期清單 sheet(GeoOutlinePhoneDatePickerSheet.tsx)的
      // 38 高一階——這一層永遠疊在日期清單 sheet 之上(不論是直接開啟、
      // 或由日期清單 sheet 的「其他日期」疊上來),理由同該檔案 zIndex 的
      // 說明。
      panelStyle={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 39 }}
      backdropStyle={{ position: 'fixed', inset: 0, zIndex: 35, background: 'rgba(0, 0, 0, 0.32)' }}
      isTopmost={isTopmost}
      stackOffsetPx={stackOffsetPx}
      // exitDurationMs:理由同 GeoOutlinePhoneDatePickerSheet.tsx 的說明
      // ——原本遺漏,關閉時瞬間消失、沒有退場滑出動畫,跟資訊卡/清單/
      // 候選籃的節奏不一致。
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      head={<SheetHead title="選擇日期" onClose={onClose} />}
    >
      <div className={styles.body}>
        <DatePickerPopover onSelect={onConfirm} />
      </div>
    </PhoneBottomSheet>
  )
}
