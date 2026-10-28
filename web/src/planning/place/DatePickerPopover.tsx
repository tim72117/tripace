import { useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { zhTW } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import styles from './DatePickerPopover.module.css'

// DatePickerPopover:單日期選擇日曆,取代原本「補日期」情境下使用的原生
// <input type="date">(見 PlacePanel.tsx 的 .dateEdit 分支、
// planning/place/desktop/CandidateList.tsx 的 NoDateDayHead)——原生 date input 的樣式
// 完全交給瀏覽器/作業系統決定,無法客製化,使用者要求改成月曆格線 UI
// (月份切換+可點選日期網格+「今天」按鈕)。用 react-day-picker(v10,見
// package.json)而非自己刻——這是成熟、輕量(~19KB gzip,含 tree-shake 過的
// date-fns)、下載量最大的同類套件,且用純 CSS 變數(--rdp-*)暴露樣式,
// 不會像部分套件把樣式寫死在元件內部、難以覆蓋。
//
// 配色跟隨 app 既有的暖色系 token(--ios-*/--color-*),不是套件預設的
// 藍色系,也不是使用者原本參考截圖的深色主題——理由:這個 app 目前沒有
// 深色模式機制,日曆若
// 自成一套深色視覺會跟其餘元件(PlacePanel/desktop/ResultList 等)格格
// 不入,故只沿用截圖的「月曆格線」佈局形式,配色改用專案既有色票。
export function DatePickerPopover({
  value,
  onSelect,
}: {
  // value:目前選定的日期(YYYY-MM-DD 字串,對齊呼叫端 onSchedule/
  // handlePick 既有的日期格式),undefined 代表尚未選擇。
  value?: string
  // onSelect:使用者點選一個日期格子時觸發,回傳 YYYY-MM-DD 字串——呼叫端
  // (PlacePanel.tsx/desktop/CandidateList.tsx)沿用原本 <input type="date">
  // onChange 拿到的同一種字串格式,不需要另外處理 Date 物件轉換。這個
  // 元件不含「確定」按鈕——選了就直接回報,呼叫端決定要不要額外要求
  // 二次確認(目前兩處呼叫端都是選了就直接視為確定,原本的「確定」按鈕
  // 是搭配原生 date input 沒有選取瞬間回饋才需要的中介步驟,月曆本身
  // 點下去就是明確的選取動作,不再需要這道額外確認)。
  onSelect: (date: string) => void
}) {
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined
  // month:目前顯示的月份(受控)——用來判斷哪些格子是前後月份的補位日期。
  // 初始顯示已選日期所在月份,沒有就是本月(同 DayPicker 未受控時的預設)。
  const [month, setMonth] = useState<Date>(() => selectedDate ?? new Date())
  const isOutsideDay = (date: Date) =>
    date.getFullYear() !== month.getFullYear() || date.getMonth() !== month.getMonth()
  return (
    <div className={styles.wrap}>
      <DayPicker
        mode="single"
        locale={zhTW}
        selected={selectedDate}
        month={month}
        onMonthChange={setMonth}
        onSelect={(date) => {
          if (!date) return
          const y = date.getFullYear()
          const m = String(date.getMonth() + 1).padStart(2, '0')
          const d = String(date.getDate()).padStart(2, '0')
          onSelect(`${y}-${m}-${d}`)
        }}
        showOutsideDays
        // fixedWeeks:每個月一律畫 6 週——不同月份跨 4~6 週,不固定的話切換
        // 月份時日曆外框高度會變,往上展開的浮層(PlacePanel 的
        // calendarPopoverOpenUp)上緣跟著跳,翻月按鈕也會從滑鼠底下跑掉。
        // PlacePanel 估算浮層高度時本來就是用 6 週算。
        fixedWeeks
        // 補位日期不可點(2026-10):fixedWeeks + showOutsideDays 讓 4~5 週的月份
        // 也畫滿 6 列,多出來的前後月份日期只是站位;若可點,一次點選就可能選到
        // 下個月(或上個月)。設成 disabled 保留原本淡色外觀與 6 列高度,只是不能點
        // ——要選那個月的日期請先翻月。手機版 PlanPhoneDateCalendarSheet 用同一個
        // 元件,行為一致。
        disabled={isOutsideDay}
        classNames={{ root: styles.root }}
      />
    </div>
  )
}
