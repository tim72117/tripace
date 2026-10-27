import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  id?: string
  ariaLabel?: string
  labelId?: string
  className?: string
}

// Select——取代原生 <select> 的自訂下拉選單(原生 <select> 的彈出清單
// 無法用 CSS 改樣式,跟設計系統對不上)。採 WAI-ARIA「select-only
// combobox」模式:觸發鈕 role=combobox + 彈出 role=listbox,焦點始終
// 留在觸發鈕上,以 aria-activedescendant 指向鍵盤游標所在的選項。
export default function Select({ value, onChange, options, disabled, id, ariaLabel, labelId, className }: SelectProps) {
  const reactId = useId()
  const triggerId = id ?? `select-${reactId}`
  const listId = `${triggerId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  function openMenu() {
    if (disabled || options.length === 0) return
    const rect = rootRef.current?.getBoundingClientRect()
    // 下方空間不夠就往上展開,避免選單被視窗底部切掉。
    setPlacement(rect && window.innerHeight - rect.bottom < 240 && rect.top > 240 ? 'top' : 'bottom')
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
    setActiveIndex(-1)
  }

  function commit(index: number) {
    const opt = options[index]
    if (opt && opt.value !== value) onChange(opt.value)
    closeMenu()
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
      case 'Tab':
        closeMenu()
        break
    }
  }

  const rootClass = ['select', className, open ? 'select-open' : '', disabled ? 'select-disabled' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} ref={rootRef} data-value={value}>
      <button
        type="button"
        id={triggerId}
        className="select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">{selected?.label ?? value}</span>
        <span className="select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul
          className="select-menu"
          role="listbox"
          id={listId}
          ref={listRef}
          aria-label={ariaLabel}
          aria-labelledby={labelId}
          data-placement={placement}
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={opt.value === value}
              className={['select-option', i === activeIndex ? 'select-option-active' : ''].filter(Boolean).join(' ')}
              onPointerMove={() => setActiveIndex(i)}
              onClick={() => commit(i)}
            >
              <span className="select-option-label">{opt.label}</span>
              {opt.value === value && (
                <span className="select-option-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
