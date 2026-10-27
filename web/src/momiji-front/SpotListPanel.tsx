import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { SpotListEntry } from './spotList'
import styles from './SpotListPanel.module.css'

// SpotListPanel——紅葉前線頁右側的賞楓景點清單。點一列讓地圖移到該景點;有精選行程
// 的景點多一個「查看行程」連結(連到 /itineraries/<id>)。窄螢幕預設收合成一顆按鈕,
// 避免蓋住地圖;寬螢幕預設展開。

// 寬度達到這個值才算「寬螢幕」:預設展開,選取景點後不自動收合(窄螢幕清單貼在控制列上方,見 .module.css)。
const WIDE_MIN_WIDTH_PX = 768

interface Props {
  entries: ReadonlyArray<SpotListEntry>
  activeId: string | null
  onSelect: (id: string) => void
  onOpenItinerary: (id: string) => void
}

export function SpotListPanel({ entries, activeId, onSelect, onOpenItinerary }: Props) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= WIDE_MIN_WIDTH_PX)
  const listId = 'momiji-spot-list'
  // 窄螢幕選取後收合清單,地圖移到的景點才不會被清單擋住。
  const select = (id: string) => {
    onSelect(id)
    if (window.innerWidth < WIDE_MIN_WIDTH_PX) setOpen(false)
  }

  return (
    <aside className={styles.panel} aria-label="賞楓景點清單">
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.title}>賞楓景點</span>
        <span className={styles.count}>{entries.length}</span>
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {open && (
        <ul id={listId} className={styles.list}>
          {entries.map((e) => (
            <li key={e.id} className={styles.item}>
              <button
                type="button"
                className={styles.row}
                aria-current={activeId === e.id ? 'true' : undefined}
                onClick={() => select(e.id)}
              >
                <span className={styles.name}>{e.name}</span>
                <span className={styles.meta}>{e.area} · {e.kind}</span>
              </button>
              {e.href && (
                <a className={styles.link} href={e.href} onClick={() => onOpenItinerary(e.id)}>
                  查看行程
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
