import type { ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import styles from './AskPage.module.css'
import { useHoverLock } from './useHoverLock'

// AskShell——詢問頁各面板共用的外殼:.wrap > .bubble > [返回圖示鈕] > <p .question> > [關閉圖示鈕] > children > .actions。
// stacked 的變體 class、換畫面後的 hover 鎖定(useHoverLock)都收在這裡,面板不必各自拼。
// loading 時標題換成 questionLoading + role="status",且不套 hoverLocked(與原本「查詢中」分支一致,
// 該分支沒有卡片可 hover);hook 仍在每次 render 呼叫,loading 轉成候選時鎖定狀態延續。
//
// onBack——選填,有傳才在氣泡左上角顯示「返回上一層」圖示鈕(向左箭頭,不帶文字;aria-label/title 給讀屏與滑鼠提示)。
// - DOM 放在標題之前:Tab 順序與視覺位置(左上角)一致,先到返回再到選項。
// - 絕對定位,點擊範圍 44×44;標題同時加上 .questionWithControls 左右各留空間,維持置中又不被箭頭蓋到。
// - 不參與換步驟的滑入動畫(見 AskPage.module.css .transition 的 :not(.backBtn):not(.closeBtn)),只有內容滑動。
//
// onClose——選填,有傳才在氣泡右上角顯示關閉圖示鈕(X,與返回鈕左右對稱)。語意同原本操作列的「不用了」文字鈕
// (呼叫端以 onDone([]) 結束詢問頁),所以 closeLabel 預設仍是「不用了」,讀屏與既有用名稱找按鈕的測試不受影響。
// - DOM 放在標題之後、選項之前:Tab 順序 返回 → 關閉 → 選項 → 操作列,與視覺上「頂列由左到右、再往下」的閱讀順序一致;
//   換步驟後焦點落在標題(見 AskPage),下一個 Tab 就是同一列右邊的關閉鈕。
// - 標題留空:只要任一角落有圖示鈕,標題左右都預留同寬(.questionWithControls)——國家頁只有關閉鈕也要留左邊,標題才維持置中。
// actionsPinned——寬螢幕側欄把操作列推到氣泡底部(見 AskPage.module.css 的 .actionsPinned)。原本的使用者
// DescribePanel(「我要直接說明」說明面板)已移除;目前沒有呼叫端傳 true,保留為選項。
export interface AskShellProps {
  stacked?: boolean
  question: ReactNode
  loading?: boolean
  onBack?: () => void
  backLabel?: string
  onClose?: () => void
  closeLabel?: string
  actionsPinned?: boolean
  children?: ReactNode
  actions?: ReactNode
}

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ')

export function AskShell({
  stacked,
  question,
  loading,
  onBack,
  backLabel = '返回上一層',
  onClose,
  closeLabel = '不用了',
  actionsPinned,
  children,
  actions,
}: AskShellProps) {
  const hoverLocked = useHoverLock()
  const questionClass = cx(styles.question, loading && styles.questionLoading, (onBack || onClose) && styles.questionWithControls)
  return (
    // data-ask-part——跨 CSS Module 的穩定掛點(雜湊 class 在別的 module 裡寫不出來):手機版詢問匡與輸入列融合
    // (planning/preview/PlanOverlayPanel.module.css .fuse)只認這兩個屬性,不依賴 DOM 層數。只放在一般詢問匡上,
    // 純文字對話氣泡(AskPage 的 messageBubble,不走 AskShell)與播放態 ScriptedAskPage 都沒有,刻意排除在融合之外。
    // AskPage 的轉場也用 [data-ask-part="bubble"] 判斷「.bubble 的直接子元素」的 animationend。
    <div
      className={cx(styles.wrap, stacked && styles.wrapStacked, !loading && hoverLocked && styles.hoverLocked)}
      data-ask-part="wrap"
    >
      <div className={cx(styles.bubble, stacked && styles.bubbleStacked)} data-ask-part="bubble">
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack} aria-label={backLabel} title={backLabel}>
            <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
        {loading ? (
          <p className={questionClass} role="status">
            {question}
          </p>
        ) : (
          <p className={questionClass}>{question}</p>
        )}
        {onClose && (
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <X size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
        {children}
        {actions != null && <div className={cx(styles.actions, actionsPinned && styles.actionsPinned)}>{actions}</div>}
      </div>
    </div>
  )
}
