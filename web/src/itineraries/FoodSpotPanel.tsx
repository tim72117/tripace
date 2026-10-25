import type { CSSProperties } from 'react'
import { UtensilsCrossed } from 'lucide-react'
import { FramedImage } from '../components/FramedImage'
import type { SampleFoodSpot } from './types'
import type { FoodSpotDetails } from './useFoodSpotDetails'
import styles from './FoodSpotPanel.module.css'

// FoodSpotPanel——美食清單圖卡面板(2026-10 新增,見 types.ts
// SampleFoodSpot 的完整說明)。貼在地圖基底展示頁(AiItineraryDetailPageMapView.tsx)
// 左側,跟右側的時間軸側欄對稱,呼應「地圖置中、兩側各自疊一塊資訊面板」
// 的版面語言。
//
// 這個元件本身不知道清單資料從哪來,只負責把傳入的 SampleFoodSpot[]
// 畫成圖卡清單——呼叫端(AiItineraryDetailPageMapView.tsx)讀
// itinerary.foodSpots(itinerary_pages content JSON 的真實資料,見
// types.ts SampleFoodSpot 的完整說明)決定清單來源,這個元件不需要
// 知道資料實際存在哪裡。
//
// detailsById——2026-10 改版,使用者明確要求「地點要在地圖繪製圖點,
// 要跟圖卡點選關聯」:原本這個元件自己查詢每筆資料的照片(useFoodSpotPhoto),
// 改成由呼叫端統一查詢(useFoodSpotDetails.ts)並把結果往下傳——因為
// 同一次查詢結果(含 lat/lng)現在也要餵給地圖 marker 圖層,查詢邏輯
// 只能有一份共同的來源,不能兩邊(這個面板/地圖圖層)各自獨立查一次。
//
// selectedSpotId/onSelectSpot/onHoverSpot——雙向連動:點圖卡→地圖對應
// 圓點強調顯示,點地圖圓點→這裡對應卡片高亮,理由同時間軸站點既有的
// selectedStopId/onPanToStop 機制(見 AiItineraryDetailPageMapView.tsx
// 的完整說明),這裡是同一種互動模式套用在美食清單這組獨立實體上。
//
// isPlayful——2026-10 新增,使用者明確要求「圖卡加入一些手繪卡通樣式,
// 活潑一點」,但確認只套在走手繪地圖的行程(itinerary.mapStyle ===
// 'hand-drawn'),理由同 renderItineraryStopCard.tsx
// createRenderItineraryStopCard 的完整說明——呼叫端(AiItineraryDetailPageMapView.tsx)
// 依 itinerary.mapStyle 決定要不要傳 true,套用 .cardPlayful 系列樣式
// (見 .module.css 的完整說明)。
export function FoodSpotPanel({
  spots,
  detailsById,
  selectedSpotId,
  onSelectSpot,
  onHoverSpot,
  isPlayful = false,
}: {
  spots: SampleFoodSpot[]
  detailsById: Record<string, FoodSpotDetails>
  selectedSpotId: string | null
  onSelectSpot: (id: string) => void
  onHoverSpot: (id: string | null) => void
  isPlayful?: boolean
}) {
  if (spots.length === 0) return null
  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <UtensilsCrossed size={14} strokeWidth={2} />
        <span>美食清單</span>
      </div>
      <div className={styles.list}>
        {spots.map((spot) => {
          const photoUrl = detailsById[spot.id]?.photoUrl ?? null
          const isSelected = spot.id === selectedSpotId
          const cardClass = [
            styles.card,
            isPlayful ? styles.cardPlayful : '',
            isSelected ? (isPlayful ? styles.cardPlayfulSelected : styles.cardSelected) : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={spot.id}
              className={cardClass}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSpot(spot.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectSpot(spot.id)
              }}
              onMouseEnter={() => onHoverSpot(spot.id)}
              onMouseLeave={() => onHoverSpot(null)}
              onFocus={() => onHoverSpot(spot.id)}
              onBlur={() => onHoverSpot(null)}
            >
              {/* 縮圖(外框 .thumb 固定 80×80):圖片交給共用 FramedImage(絕對定位鋪滿外框)
                  ——照片還沒查到時顯示 🍽️ 佔位(靜態,不用 pending:查詢失敗時 detailsById
                  不會留下這筆,用「查無資料」判斷會永遠停在掃光),查到後掃光→淡入,載入
                  失敗顯示同尺寸失敗佔位。佔位底色沿用原本的 --ios-active。 */}
              <div className={styles.thumb}>
                <FramedImage
                  className={styles.thumbFrame}
                  style={{ '--skeleton-base': 'var(--ios-active)' } as CSSProperties}
                  src={photoUrl}
                  alt={spot.name}
                  placeholder={<span aria-hidden="true">🍽️</span>}
                />
                {isPlayful && <span className={styles.playfulBadge} aria-hidden="true">🍴</span>}
              </div>
              <div className={styles.body}>
                <div className={styles.cardHead}>
                  <span className={styles.name}>{spot.name}</span>
                  {spot.priceRange && <span className={styles.price}>{spot.priceRange}</span>}
                </div>
                <div className={styles.category}>{spot.category}</div>
                <p className={styles.desc}>{spot.desc}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
