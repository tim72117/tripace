import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, type ButtonVariant } from './Button'
import styles from './ConfirmDialog.module.css'

// ConfirmDialog / useConfirmDialog——取代 window.confirm 的頁內確認對話框。原生 confirm 無法自訂文字與按鈕、
// 會凍結整個分頁、在部分內嵌環境還會被封鎖;這裡沿用 base-ui.css 的 .rp-modal* 置中卡片骨架(同 SettingsDialog)。
//
// 用法:
//   const { ask, dialog } = useConfirmDialog()
//   const choice = await ask({ title, message, choices: [{ id: 'delete', label: '刪除', variant: 'danger' }] })
//   if (choice === 'delete') ...
//   return <>{...}{dialog}</>
// 「取消」固定存在(按鈕、Esc、點背景都回傳 null);初始焦點在取消,避免 Enter 連按直接確認破壞性操作。
export interface ConfirmChoice {
  id: string
  label: string
  variant?: ButtonVariant
}

export interface ConfirmOptions {
  title: string
  message: ReactNode
  choices: ConfirmChoice[]
  cancelLabel?: string
}

function ConfirmDialog({ options, onResolve }: { options: ConfirmOptions; onResolve: (id: string | null) => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onResolve(null)
        return
      }
      // 焦點限制:Tab / Shift+Tab 只在對話框內的按鈕之間循環,不會跑到被遮住的頁面。
      if (e.key === 'Tab') {
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  return (
    <div className="rp-modal-backdrop" onClick={() => onResolve(null)}>
      <div
        ref={dialogRef}
        className="rp-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rp-modal-head">
          <span id="confirm-dialog-title" className="rp-modal-title">{options.title}</span>
        </div>
        <div className={`rp-modal-body ${styles.body}`}>
          <div className={styles.message}>{options.message}</div>
          <div className={styles.actions}>
            <Button ref={cancelRef} type="button" variant="secondary" onClick={() => onResolve(null)}>
              {options.cancelLabel ?? '取消'}
            </Button>
            {options.choices.map((c) => (
              <Button key={c.id} type="button" variant={c.variant ?? 'primary'} onClick={() => onResolve(c.id)}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((id: string | null) => void) | null>(null)

  const resolve = useCallback((id: string | null) => {
    resolverRef.current?.(id)
    resolverRef.current = null
    setOptions(null)
  }, [])

  const ask = useCallback((opts: ConfirmOptions) => {
    // 同時只會有一個對話框;若還有沒回應的,先當作取消。
    resolverRef.current?.(null)
    return new Promise<string | null>((res) => {
      resolverRef.current = res
      setOptions(opts)
    })
  }, [])

  // 元件卸載時把等待中的 Promise 以取消結案,避免呼叫端永遠 await 下去。
  useEffect(() => () => resolverRef.current?.(null), [])

  const dialog = options ? <ConfirmDialog options={options} onResolve={resolve} /> : null
  return { ask, dialog }
}
