import { Bike, Bus, Car, PersonStanding } from 'lucide-react'
import type { TransportMode } from './asktools'
import styles from './AskPage.module.css'

// TRANSPORT_META——每種交通方式固定的圖示與中文標籤(內容同 AskPage.tsx 的
// TRANSPORT_MODE_META,待接線時 AskPage.tsx 應改用這份)。
export const TRANSPORT_META: Record<TransportMode, { label: string; Icon: typeof Car }> = {
  walk: { label: '步行', Icon: PersonStanding },
  scooter: { label: '機車', Icon: Bike },
  car: { label: '開車', Icon: Car },
  transit: { label: '大眾運輸', Icon: Bus },
  bike: { label: '腳踏車', Icon: Bike },
}

export function TransportOption({ mode, stacked, onSelect }: { mode: TransportMode; stacked?: boolean; onSelect: () => void }) {
  const meta = TRANSPORT_META[mode]
  return (
    <button
      type="button"
      className={[styles.transportCard, stacked ? styles.transportCardStacked : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <meta.Icon size={22} strokeWidth={2} />
      <span className={styles.transportLabel}>{meta.label}</span>
    </button>
  )
}
