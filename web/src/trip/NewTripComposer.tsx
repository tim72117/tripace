import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import { isSubmitEnter } from '../AppCommon'
import { Button } from '../components/Button'
import styles from './NewTripComposer.module.css'

// NewTripComposer:「新增旅程」輸入列——DesktopTripList.tsx(桌面版側欄)、
// PhoneTripsDrawer.tsx(手機版抽屜)原本各自把這段 <input>+<Button> 結構、
// isSubmitEnter/Escape 取消判斷複製貼上一份(唯一差異只有外層容器的
// className,兩處視覺與行為完全一致),收斂成這個共用元件,不屬於
// components/ 底下的全站基礎元件(不是任何地方都用得到的通用元件),
// 語意上專屬旅程列表這個領域,故放在 trip/ 目錄。
export interface NewTripComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  // className/style:比照 ScrollArea/Button 等其餘共用元件的既有慣例,
  // 保留一次性覆寫的逃生口——目前沒有呼叫端需要,但沒有理由讓這個共用
  // 元件成為擋住未來需求的瓶頸。
  className?: string
  style?: CSSProperties
}

// forwardRef——比照 ScrollArea.tsx 等既有慣例保留轉發能力,目前沒有
// 呼叫端需要,但沒有理由讓這個共用元件成為擋住未來需求的瓶頸。
export const NewTripComposer = forwardRef<HTMLDivElement, NewTripComposerProps>(function NewTripComposer(
  { value, onChange, onSubmit, onCancel, className, style },
  ref,
) {
  return (
    <div ref={ref} className={className ? `${styles.composer} ${className}` : styles.composer} style={style}>
      <input
        autoFocus
        value={value}
        placeholder="新旅程名稱…"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitEnter(e)) onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <Button variant="primary" compact onClick={onSubmit} disabled={!value.trim()}>
        建立
      </Button>
    </div>
  )
})
