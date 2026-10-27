import { useState } from 'react'

interface DateInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  ariaLabel?: string
  disabled?: boolean
}

// normalizeDate 把 2026/1/5、2026.01.05、20260105 這類常見寫法統一成
// YYYY-MM-DD;認不出來就原樣回傳,交給 isValidDate 判定。
function normalizeDate(raw: string): string {
  const s = raw.trim()
  if (s === '') return ''
  const m = s.match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})$/)
  if (!m) return s
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function isValidDate(s: string): boolean {
  if (s === '') return true
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// DateInput——取代原生 <input type="date">(其彈出月曆無法用 CSS 改樣式)。
// 改成純文字輸入 YYYY-MM-DD,失焦時自動正規化,格式不對就以
// setCustomValidity 擋住表單送出並顯示提示文字。
export default function DateInput({ value, onChange, id, ariaLabel, disabled }: DateInputProps) {
  const [touched, setTouched] = useState(false)
  const invalid = touched && !isValidDate(value)
  const hintId = id ? `${id}-hint` : undefined

  return (
    <div className="date-input">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? hintId : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          e.target.setCustomValidity('')
        }}
        onBlur={(e) => {
          const next = normalizeDate(e.target.value)
          if (next !== value) onChange(next)
          setTouched(true)
          e.target.setCustomValidity(isValidDate(next) ? '' : '請輸入 YYYY-MM-DD 格式的日期')
        }}
      />
      {invalid && (
        <span className="date-input-hint" id={hintId} role="alert">
          請輸入 YYYY-MM-DD 格式的有效日期
        </span>
      )}
    </div>
  )
}
