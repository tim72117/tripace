import { DayPicker } from 'react-day-picker'
import { zhTW } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import styles from './DatePickerPopover.module.css'

// DatePickerPopover:單日期選擇日曆,取代原本「補日期」情境下使用的原生
// <input type="date">(見 GeoInfoPanel.tsx 的 .dateEdit 分支、
// GeoCandidateSidebar.tsx 的 NoDateDayHead)——原生 date input 的樣式
// 完全交給瀏覽器/作業系統決定,無法客製化,使用者要求改成月曆格線 UI
// (月份切換+可點選日期網格+「今天」按鈕)。用 react-day-picker(v10,見
// package.json)而非自己刻——這是成熟、輕量(~19KB gzip,含 tree-shake 過的
// date-fns)、下載量最大的同類套件,且用純 CSS 變數(--rdp-*)暴露樣式,
// 不會像部分套件把樣式寫死在元件內部、難以覆蓋。
//
// 配色跟隨 app 既有的暖色系 token(--ios-*/--color-*),不是套件預設的
// 藍色系,也不是使用者原本參考截圖的深色主題——理由:這個 app 目前沒有
// 深色模式機制(見 PaceChart.module.css 開頭對這件事的說明),日曆若
// 自成一套深色視覺會跟其餘元件(GeoInfoPanel/GeoHotelSidebar 等)格格
// 不入,故只沿用截圖的「月曆格線」佈局形式,配色改用專案既有色票。
export function DatePickerPopover({
  value,
  onSelect,
}: {
  // value:目前選定的日期(YYYY-MM-DD 字串,對齊呼叫端 onSchedule/
  // handlePick 既有的日期格式),undefined 代表尚未選擇。
  value?: string
  // onSelect:使用者點選一個日期格子時觸發,回傳 YYYY-MM-DD 字串——呼叫端
  // (GeoInfoPanel.tsx/GeoCandidateSidebar.tsx)沿用原本 <input type="date">
  // onChange 拿到的同一種字串格式,不需要另外處理 Date 物件轉換。這個
  // 元件不含「確定」按鈕——選了就直接回報,呼叫端決定要不要額外要求
  // 二次確認(目前兩處呼叫端都是選了就直接視為確定,原本的「確定」按鈕
  // 是搭配原生 date input 沒有選取瞬間回饋才需要的中介步驟,月曆本身
  // 點下去就是明確的選取動作,不再需要這道額外確認)。
  onSelect: (date: string) => void
}) {
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined
  return (
    <div className={styles.wrap}>
      <DayPicker
        mode="single"
        locale={zhTW}
        selected={selectedDate}
        onSelect={(date) => {
          if (!date) return
          const y = date.getFullYear()
          const m = String(date.getMonth() + 1).padStart(2, '0')
          const d = String(date.getDate()).padStart(2, '0')
          onSelect(`${y}-${m}-${d}`)
        }}
        showOutsideDays
        classNames={{ root: styles.root }}
      />
    </div>
  )
}
