import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, MapPin, Sparkles } from 'lucide-react'
import { coverPhotoOf, dayCountOf, deriveFilters, filterItineraries, stopCountOf } from './catalog'
import type { SampleItinerary } from './types'
import { FramedImage } from '../components/FramedImage'
import { SKELETON_KEEP_CLASS, SkeletonMask } from '../components/Skeleton'
import styles from './AiItineraryListPage.module.css'

// AiItineraryListPage — 範例行程清單:篩選列 + 卡片牆,點卡片進詳細頁。
//
// items 由外部傳入(而不是直接 import registry)——頁面本身不知道資料從哪來,
// 方便測試與日後換成後端資料來源。篩選選項由 deriveFilters 從資料算出,範例
// 行程增加時自動跟著變。
//
// 篩選條件放在網址參數(?region=…&category=…)而不是元件 state:從詳細頁按
// 瀏覽器返回時,篩選仍然在;網址也可以直接分享。
//
// loading——清單資料還在查詢(見 AiItinerariesRoute 的 useListItineraries)。只在「手上
// 一份行程都沒有」時才有作用:畫跟真卡片同一組 class 的骨架(篩選列、份數、卡片牆),
// 資料到了直接換成真內容,外框尺寸不變;不先閃「還沒有範例行程」的空狀態。
export function AiItineraryListPage({ items, loading = false }: { items: SampleItinerary[]; loading?: boolean }) {
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

  if (loading && items.length === 0) return <ListSkeleton />

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
            {visible.map((it) => (
              <li key={it.id}>
                <Link to={`/itineraries/${it.id}`} className={styles.card}>
                  <CardContent
                    cover={coverPhotoOf(it)}
                    title={it.title}
                    region={it.region}
                    stats={`${dayCountOf(it)} 天 · ${stopCountOf(it)} 站`}
                    summary={it.summary}
                    tags={it.categories}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

// CardContent——卡片內容(封面+文字區),真卡片與骨架卡片共用同一份 JSX,外框
// 尺寸因此必然一致。封面用共用 FramedImage:外框由 .cover 的 16:9 決定,照片載入
// 完成才淡入,沒照片顯示地圖釘佔位,載入失敗顯示同尺寸失敗佔位;pending 給骨架用
// (還不知道有沒有照片,顯示掃光)。meta 文字各包一層 <span>,讓 SkeletonMask 遮罩
// 時呈現長條而不是只剩圖示色塊(對真卡片排版沒有影響)。
function CardContent({ cover, title, region, stats, summary, tags, pending = false }: {
  cover?: string | null
  title: string
  region: string
  stats: string
  summary: string
  tags: string[]
  pending?: boolean
}) {
  return (
    <>
      <FramedImage
        className={styles.cover}
        aspectRatio="16 / 9"
        src={cover}
        alt=""
        loading="lazy"
        pending={pending}
        placeholder={<MapPin size={28} strokeWidth={1.5} className={styles.coverFallback} aria-hidden="true" />}
      />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        <div className={styles.meta}>
          <span className={styles.metaItem}><MapPin size={12} strokeWidth={2} /><span>{region}</span></span>
          <span className={styles.metaItem}><CalendarDays size={12} strokeWidth={2} /><span>{stats}</span></span>
        </div>
        <p className={styles.summary}>{summary}</p>
        <div className={styles.tags}>
          {tags.map((c, i) => <span key={`${c}-${i}`} className={styles.tag}>{c}</span>)}
        </div>
      </div>
    </>
  )
}

// ListSkeleton——清單資料到之前的骨架:用 SkeletonMask 包住跟真內容同一組結構
// (篩選列、份數、CardContent),佔位文字撐出跟真卡片相同的高度,遮罩只改顏色
// 不改盒模型,資料到了換成真內容時外框尺寸不變。
// <main> 刻意不加 aria-busy:aria-busy 會壓住子樹裡 live region 的通知,SkeletonMask
// 自己的 role="status"(延後填入「行程清單載入中」)就不會被唸;載入中的宣告交給它。
// 篩選膠囊用 <span class={chip}> 站位(不用 <button>:骨架不該是可聚焦的按鈕),
// .chip 明確設定 font/line-height,span 與 button 的字型、行高才會一樣。
const SKELETON_CARD_COUNT = 6
const SKELETON_SUMMARY = '行程簡介載入中,這段文字只用來撐出跟真實簡介相同的三行高度,不會被看見。這段文字只用來撐出跟真實簡介相同的三行高度。'

function ListSkeleton() {
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>精選行程</h1>
      <p className={styles.subheading}>看看 AI 能排出什麼樣的行程——點卡片查看完整時間軸。</p>
      <SkeletonMask loading label="行程清單載入中">
        <div className={styles.filters}>
          {['地區', '類型'].map((label) => (
            <div key={label} className={styles.filterRow}>
              <span className={`${styles.filterLabel} ${SKELETON_KEEP_CLASS}`}>{label}</span>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={styles.chip}>{'\u3000\u3000\u3000'}</span>
              ))}
            </div>
          ))}
        </div>
        <p className={styles.count}>00 份行程</p>
        <ul className={styles.grid}>
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
            <li key={i} data-testid="itinerary-card-skeleton">
              <div className={styles.card}>
                <CardContent
                  pending
                  title="行程標題載入中"
                  region="地區"
                  stats="0 天 · 0 站"
                  summary={SKELETON_SUMMARY}
                  tags={['類型', '類型']}
                />
              </div>
            </li>
          ))}
        </ul>
      </SkeletonMask>
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
