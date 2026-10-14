import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, MapPin, Sparkles } from 'lucide-react'
import { coverPhotoOf, deriveFilters, filterItineraries } from './catalog'
import type { SampleItinerary } from './types'
import styles from './AiItineraryListPage.module.css'

// AiItineraryListPage — 範例行程清單:篩選列 + 卡片牆,點卡片進詳細頁。
//
// items 由外部傳入(而不是直接 import registry)——頁面本身不知道資料從哪來,
// 方便測試與日後換成後端資料來源。篩選選項由 deriveFilters 從資料算出,範例
// 行程增加時自動跟著變。
//
// 篩選條件放在網址參數(?region=…&category=…)而不是元件 state:從詳細頁按
// 瀏覽器返回時,篩選仍然在;網址也可以直接分享。
export function AiItineraryListPage({ items }: { items: SampleItinerary[] }) {
  const [params, setParams] = useSearchParams()
  const region = params.get('region')
  const category = params.get('category')

  const filters = useMemo(() => deriveFilters(items), [items])
  const visible = useMemo(() => filterItineraries(items, { region, category }), [items, region, category])

  // 點已選中的選項再點一次 = 取消(回到「全部」);用 replace 避免每點一次篩選就
  // 往瀏覽器歷史堆一筆,導致返回鍵要按很多次。
  function toggle(key: 'region' | 'category', value: string | null) {
    const next = new URLSearchParams(params)
    if (value === null || params.get(key) === value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>精選行程</h1>
      <p className={styles.subheading}>看看 AI 能排出什麼樣的行程——點卡片查看完整時間軸。</p>

      {items.length > 0 && (
        <div className={styles.filters}>
          <FilterRow label="地區" options={filters.regions} active={region} onToggle={(v) => toggle('region', v)} />
          <FilterRow label="類型" options={filters.categories} active={category} onToggle={(v) => toggle('category', v)} />
        </div>
      )}

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <Sparkles size={26} strokeWidth={1.5} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>{items.length === 0 ? '還沒有範例行程' : '沒有符合條件的行程'}</p>
          {items.length > 0 && (
            <button type="button" className={styles.clear} onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              清除篩選
            </button>
          )}
        </div>
      ) : (
        <>
          <p className={styles.count}>{visible.length} 份行程</p>
          <ul className={styles.grid}>
            {visible.map((it) => {
              const cover = coverPhotoOf(it)
              return (
                <li key={it.id}>
                  <Link to={`/itineraries/${it.id}`} className={styles.card}>
                    <div className={styles.cover}>
                      {cover ? (
                        <img src={cover} alt="" className={styles.coverImg} loading="lazy" />
                      ) : (
                        <MapPin size={28} strokeWidth={1.5} className={styles.coverFallback} />
                      )}
                    </div>
                    <div className={styles.body}>
                      <div className={styles.title}>{it.title}</div>
                      <div className={styles.meta}>
                        <span className={styles.metaItem}><MapPin size={12} strokeWidth={2} />{it.region}</span>
                        <span className={styles.metaItem}><CalendarDays size={12} strokeWidth={2} />{it.days} 天 · {it.stops.length} 站</span>
                      </div>
                      <p className={styles.summary}>{it.summary}</p>
                      <div className={styles.tags}>
                        {it.categories.map((c) => <span key={c} className={styles.tag}>{c}</span>)}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}

function FilterRow({ label, options, active, onToggle }: {
  label: string
  options: { value: string; count: number }[]
  active: string | null
  onToggle: (value: string | null) => void
}) {
  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}</span>
      <button type="button" aria-pressed={active === null} className={`${styles.chip} ${active === null ? styles.chipActive : ''}`} onClick={() => onToggle(null)}>
        全部
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={active === o.value}
          className={`${styles.chip} ${active === o.value ? styles.chipActive : ''}`}
          onClick={() => onToggle(o.value)}
        >
          {o.value}
          <span className={styles.chipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}
