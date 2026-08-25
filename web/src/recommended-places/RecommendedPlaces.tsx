import { Star, MapPin, ImageOff } from 'lucide-react'
import styles from './RecommendedPlaces.module.css'

// 推薦景點卡片(UI 試做,假資料展示用)。
//
// 資料形狀對齊後端 want 工具 recommend_nearby(server/internal/wanttools/recommend_nearby.go)
// 目前回傳的欄位(name/address/lat/lng/rating/userRatingCount/primaryType)。
// photoUrl、summary 兩個欄位後端還沒接(Places API New 的 photos / editorialSummary),
// 先在型別上留好位置,UI 做好「沒有這兩個欄位時」的空狀態處理,之後後端補上就能直接吃。
export type RecommendedPlace = {
  name: string
  address: string
  lat: number
  lng: number
  rating: number // 0 表示無評分
  userRatingCount: number
  primaryType: string // 如 "tourist_attraction"、"restaurant"、"cafe"
  photoUrl?: string // 之後才有,先用假圖或漸層色塊佔位
  summary?: string // 景點介紹文字,之後才有,先寫假範例
}

// primaryType(Google Places 英文代碼)→ 中文標籤,對照 recommend_nearby.go 的 categoryToPlaceType。
const TYPE_LABELS: Record<string, string> = {
  tourist_attraction: '觀光景點',
  museum: '博物館',
  art_gallery: '美術館',
  restaurant: '餐廳',
  cafe: '咖啡廳',
  lodging: '住宿',
  park: '公園',
  shopping_mall: '購物',
  night_club: '夜生活',
  bar: '酒吧',
}

function typeLabel(primaryType: string): string {
  if (!primaryType) return '其他'
  return TYPE_LABELS[primaryType] ?? primaryType
}

// 依景點名稱挑一個穩定的漸層(同一張卡每次渲染顏色一致),當作沒有 photoUrl 時的佔位視覺。
const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg, #C4956A, #7C6F5B)',
  'linear-gradient(135deg, #5A8A6A, #9E9488)',
  'linear-gradient(135deg, #C0604A, #C4956A)',
  'linear-gradient(135deg, #7C6F5B, #3D3530)',
]

function placeholderGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const idx = Math.abs(hash) % PLACEHOLDER_GRADIENTS.length
  return PLACEHOLDER_GRADIENTS[idx]
}

// 星星評分:滿分 5 顆,無評分(rating === 0)時不畫星星,改顯示「尚無評分」文字,
// 避免出現 0 顆星或 NaN 之類看起來像 bug 的畫面。
function RatingStars({ rating, userRatingCount }: { rating: number; userRatingCount: number }) {
  if (!rating || rating <= 0) {
    return <span className={`${styles.rating} ${styles.ratingEmpty}`}>尚無評分</span>
  }
  const rounded = Math.round(rating)
  return (
    <span className={styles.rating}>
      <span className={styles.stars} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={13}
            strokeWidth={1.5}
            className={i < rounded ? `${styles.star} ${styles.filled}` : styles.star}
          />
        ))}
      </span>
      <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
      {userRatingCount > 0 && (
        <span className={styles.ratingCount}>({userRatingCount.toLocaleString('zh-Hant')})</span>
      )}
    </span>
  )
}

export function RecommendedPlaceCard({ place }: { place: RecommendedPlace }) {
  return (
    <div className={styles.card}>
      <div className={styles.photo} style={place.photoUrl ? undefined : { background: placeholderGradient(place.name) }}>
        {place.photoUrl ? (
          <img src={place.photoUrl} alt={place.name} loading="lazy" />
        ) : (
          <div className={styles.photoPlaceholder}>
            <ImageOff size={20} strokeWidth={1.5} />
            <span>佔位圖</span>
          </div>
        )}
        <span className={styles.typeBadge}>{typeLabel(place.primaryType)}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.name}>{place.name}</div>
        <RatingStars rating={place.rating} userRatingCount={place.userRatingCount} />
        <div className={styles.address}>
          <MapPin size={12} strokeWidth={1.8} />
          <span>{place.address}</span>
        </div>
        {place.summary ? (
          <p className={styles.summary}>{place.summary}</p>
        ) : (
          <p className={`${styles.summary} ${styles.summaryEmpty}`}>尚無景點介紹</p>
        )}
      </div>
    </div>
  )
}

export function RecommendedPlacesList({ places }: { places: RecommendedPlace[] }) {
  if (places.length === 0) {
    return <div className="empty">目前沒有推薦景點。</div>
  }
  return (
    <div className={styles.list}>
      {places.map((p, i) => (
        <RecommendedPlaceCard key={`${p.name}-${i}`} place={p} />
      ))}
    </div>
  )
}

