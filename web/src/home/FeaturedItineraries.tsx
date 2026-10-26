import { useListItineraries } from '../itineraries/useListItineraries'
import { dayCountOf, stopCountOf } from '../itineraries/catalog'
import { SkeletonBlock } from '../components/Skeleton'
import { trackEvent } from '../analytics'
import './FeaturedItineraries.css'

// FeaturedItineraries——首頁「目的地」區塊下方的精選行程(2026-10-27 新增)。
//
// 資料:useListItineraries(與 /itineraries 清單頁同一個來源:資料庫已發布的行程,視 VITE_FEATURE_SHOW_EXAMPLE_ITINERARIES
// 併入靜態範例;已依上架日期由新到舊排序,格式不合 isSampleItineraryShape 的會被濾掉),取前 FEATURED_MAX 筆。
// 版型:文字列表,沿用首頁目的地清單的 .destinations/.destination-item 樣式(標題、天數標籤、簡介、箭頭,不放封面圖——
// 目前沒有行程設定 coverPhoto),底下一個「看全部精選行程」連到 /itineraries。
//
// 載入中:顯示一列與真實項目同高的骨架(資料到了換成內容;只有一列,讓只有 1 筆或載入失敗時版面變動最小),
// 「載入中」由外層列表容器的 role=status 宣告一次;載入結束後沒有任何行程就整節不畫(沒有東西可展示時
// 不留一個空標題)。載入失敗或逾時 useListItineraries 會收尾成「沒有 API 行程」,同樣整節不畫,不影響首頁其他部分。
// 點擊事件 landing_featured_itinerary_click 帶行程 id,用來看首頁精選行程的點擊率。
export const FEATURED_MAX = 3

export function FeaturedItineraries() {
  const { items, loading } = useListItineraries()
  const featured = items.slice(0, FEATURED_MAX)
  if (!loading && featured.length === 0) return null
  const showSkeleton = loading && featured.length === 0

  return (
    <section className="destinations featured-itineraries" id="featured-itineraries" aria-labelledby="featured-itineraries-title">
      <div className="destinations-inner">
        <div className="explore-eyebrow">精選行程</div>
        <h2 className="explore-title" id="featured-itineraries-title">看看 AI 排好的行程</h2>
        <div
          className="destination-list"
          {...(showSkeleton ? { role: 'status', 'aria-label': '精選行程載入中', 'aria-busy': true } : {})}
        >
          {showSkeleton
            ? (
                <div className="destination-item featured-itinerary-skeleton">
                  <SkeletonBlock width="46%" height={22} />
                  <SkeletonBlock width="92%" height={16} />
                </div>
              )
            : featured.map((it) => (
                <a
                  className="destination-item"
                  key={it.id}
                  href={`/itineraries/${it.id}`}
                  onClick={() => trackEvent('landing_featured_itinerary_click', { itinerary: it.id })}
                >
                  <span className="destination-row">
                    <span className="destination-name">
                      {it.title}
                      <span className="destination-tag">{dayCountOf(it)} 天 · {stopCountOf(it)} 站</span>
                    </span>
                    <svg className="destination-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="destination-desc">{it.summary}</span>
                </a>
              ))}
        </div>
        <a className="featured-itineraries-all" href="/itineraries" onClick={() => trackEvent('landing_featured_itinerary_all_click')}>
          看全部精選行程
        </a>
      </div>
    </section>
  )
}
