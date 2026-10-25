import { MapPin } from 'lucide-react'
import styles from './AskPage.module.css'

// RegionOption——國家/城市卡片(key 由呼叫端給)。
export function RegionOption({ name, stacked, onSelect }: { name: string; stacked?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={[styles.regionCard, stacked ? styles.regionCardStacked : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <MapPin size={18} strokeWidth={2} className={styles.regionIcon} />
      <span className={[styles.regionName, stacked ? styles.regionNameStacked : ''].filter(Boolean).join(' ')}>{name}</span>
    </button>
  )
}
