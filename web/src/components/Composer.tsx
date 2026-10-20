import type { ReactNode } from 'react'
import styles from './Composer.module.css'

// Composer——漂浮輸入膠囊的共用外框:膠囊造型(背景/邊框/陰影/圓角)、
// 輸入框基礎樣式、送出鈕基礎圓形造型。
//
// 放在 components/(跨領域共用 UI 元件,如 Button/IconButton/
// FloatingPanel 所在的目錄),不是 plan-core/——plan-core/ 收納的是
// 行程規劃領域的資料結構與邏輯(planTimeline.ts、PlanTimelineView 等),
// 這個元件本身不含任何 plan 領域的業務邏輯,純粹是輸入膠囊的視覺外框,
// 跟其他通用 UI 元件性質一致。
//
// 背景:這組樣式原本在 trip-plan/TripPlanPage.tsx(正式頁,真實對話)
// 跟 home/plan-ai-sim/AIPlanTimelinePage.tsx(/ai-plan 展示頁,假打字
// 動畫)各自維護一份 CSS,靠人工對齊數值——2026-10 使用者查證「播放態
// 跟推論態的輸入匡文字樣式有沒有一樣」時,發現兩邊的 font-size 不一致
// (展示頁 14px、正式頁 16px),根因正是其中一邊後來改了、沒人想到要
// 同步改另一邊。抽成這個共用元件,兩邊呼叫端改成呼叫它,未來只要動一處
// 就不會再有「改一邊忘了改另一邊」的問題。
//
// 刻意不包含的部分:
//   - composerCta(展示頁「讓我試看看」CTA 的圓鈕展開成寬條的轉場
//     動畫)——這套邏輯只有展示頁需要,且牽涉複雜的 max-width transition
//     與 composerCollapsed 狀態機,硬塞進共用元件會讓它背上一個只有單一
//     呼叫端用得到的複雜分支。展示頁自己在 sendButtonClassName 疊加
//     額外的 class 達成這個轉場,見 AIPlanTimelinePage.tsx 呼叫處。
//   - 假打字動畫邏輯——展示頁自己算出 typedPrompt 字串當 value 傳進來,
//     這個元件不知道、也不需要知道文字是真的使用者輸入還是模擬出來的。
//   - 表單送出的業務邏輯(sendPrompt/onagent 呼叫)——onSubmit 由呼叫端
//     自己決定要做什麼,這個元件只負責在使用者按下送出時呼叫它。
export interface ComposerProps {
  // value/onChange——受控輸入框。展示頁傳入 typedPrompt(唯讀假動畫進度)
  // 時不需要 onChange(readOnly 時使用者改不了值,但 React 仍要求受控
  // input 要有 onChange,呼叫端傳一個 no-op 即可)。
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  readOnly?: boolean
  // disabled——真的不能用的狀態(正式頁的既有行為:apiKeyMissing/
  // urlMissing/isThinking 時鎖定輸入框與送出鈕,兩者視覺上一起淡化,
  // 這才是「disabled」這個字該表達的意思——使用者點了會發現按鈕是灰
  // 的、不能點)。
  disabled?: boolean
  // presentational——整個 composer 是純展示用的(2026-10 新增,使用者
  // 明確要求:「composer 應該用一個展示態來表達,而不是單純關閉送出,
  // 展示態的時候送出樣式要正常,但是不能點送出」)。跟 disabled 是兩種
  // 不同的語意,不能互相取代:
  //   - disabled:樣式淡化 + 不能點,表達「現在不能用」(例如功能調整
  //     中、對話進行中)。
  //   - presentational:樣式維持正常(不淡化,看起來完全像「可以送出」
  //     的狀態),但按下送出鈕/輸入框按 Enter 不會觸發 onSubmit,表達
  //     「這整顆 composer 本來就是展示用的,不是真的輸入框」(展示頁
  //     /ai-plan 的假打字動畫就是這個情境——訪客看到的應該是一個外觀
  //     完全正常、看起來能用的輸入框,而不是一眼就能看出「這是灰掉的
  //     假東西」)。
  //   實作上不是靠原生 disabled 屬性(它會同時觸發 :disabled 偽類淡化
  //   樣式,沒辦法只攔截點擊、不影響外觀),而是讓 onSubmit 內部直接
  //   不呼叫呼叫端傳入的 onSubmit。
  presentational?: boolean
  // onSubmit——使用者按下送出鈕或在輸入框按 Enter。省略時、或
  // presentational 為 true 時,<form> 的 submit 事件仍會被攔截(避免
  // 瀏覽器真的送出表單跳轉頁面),但不會呼叫這個 callback。
  onSubmit?: () => void
  // bare——拿掉膠囊外觀(背景/邊框/陰影/padding),只留送出鈕/內容本身。
  // 對齊展示頁原本 .composerBare 的語意:「讓我試看看」CTA 獨自出現時
  // 不該裝在一個實色容器裡。
  bare?: boolean
  // sendButton——送出鈕要顯示什麼內容,預設是基礎的箭頭 icon。展示頁的
  // 「讓我試看看」文字 CTA 透過這個 prop 換掉內容,外觀上的展開轉場則
  // 靠 sendButtonClassName 疊加呼叫端自己的 class。
  sendButton?: ReactNode
  sendButtonAriaLabel?: string
  sendButtonClassName?: string
  inputWrapClassName?: string
  // inputRowClassName——疊加在 <form>(輸入框+送出鈕所在的那一列)上。
  // 展示頁需要用這個疊加 justify-content: center(hideInput 時 <form>
  // 只剩送出鈕一個子元素,預設 flex-start 會貼左,見
  // AIPlanTimelinePage.module.css .inputRow 的完整說明)。
  inputRowClassName?: string
  // hideInput——展示頁「讓我試看看」CTA 獨自出現時,輸入框整個從 DOM
  // 移除(不是用 CSS 隱藏),見 AIPlanTimelinePage.tsx composerCollapsed
  // 處的完整說明。
  hideInput?: boolean
  className?: string
}

export function Composer({
  value,
  onChange,
  placeholder,
  ariaLabel = '輸入指令',
  readOnly = false,
  disabled = false,
  presentational = false,
  onSubmit,
  bare = false,
  sendButton,
  sendButtonAriaLabel = '送出',
  sendButtonClassName,
  inputWrapClassName,
  inputRowClassName,
  hideInput = false,
  className,
}: ComposerProps) {
  return (
    <div className={[styles.composer, bare ? styles.composerBare : '', className].filter(Boolean).join(' ')}>
      <div className={styles.composerInner}>
        <form
          className={[styles.inputRow, inputRowClassName].filter(Boolean).join(' ')}
          onSubmit={(e) => {
            e.preventDefault()
            // presentational 時不呼叫 onSubmit(見該 prop 的完整說明:
            // 樣式維持正常,只在行為層面擋下送出)。
            if (presentational) return
            onSubmit?.()
          }}
        >
          {!hideInput && (
            <div className={[styles.inputWrap, inputWrapClassName].filter(Boolean).join(' ')}>
              <input
                type="text"
                placeholder={placeholder}
                aria-label={ariaLabel}
                className={styles.input}
                value={value}
                onChange={onChange ? (e) => onChange(e.target.value) : undefined}
                readOnly={readOnly}
                disabled={disabled}
              />
            </div>
          )}
          <button
            type="submit"
            aria-label={sendButtonAriaLabel}
            className={[styles.sendBtn, sendButtonClassName].filter(Boolean).join(' ')}
            disabled={disabled}
          >
            {sendButton ?? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ios-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
