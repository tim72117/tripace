import { Compass, X } from 'lucide-react'
import type { GeoAttraction } from '../api'
import styles from './AttractionInfoPanel.module.css'

// AttractionInfoPanel:attraction(人工建檔的景點區域,見 model.Attraction)
// 專用的介紹圖卡,獨立於 GeoInfoPanel(飯店/推薦地點/Google 原生 POI 共用
// 的那個)之外——理由是這兩者的操作集合已經完全不同:GeoInfoPanel 的
// 「加入候選/加入行程」按鈕組是給還沒被選進行程規劃的地點用的,而
// attraction 本身不接受被加入候選籃或行程(見 DesktopLayout.tsx
// attractionInfoContent 不帶 candidate 欄位的說明),它反而需要一個
// GeoInfoPanel 完全沒有的動作:「探索周邊」(縮放地圖到這個區域的完整
// 範圍,見下方 onExplore)。與其在同一個元件裡用 candidate 是否存在去
// 判斷該渲染哪一組按鈕,拆成獨立元件讓兩邊各自的操作集合單純、不互相
// 污染,之後任一邊要新增/調整專屬按鈕也不需要擔心波及另一邊。
//
// 版面(浮動卡片疊在地圖上方,標題/關閉鍵/照片/名稱/badges/簡介)刻意
// 沿用跟 GeoInfoPanel 相同的視覺語言(見 AttractionInfoPanel.module.css
// 與 GeoInfoPanel.module.css 的對應規則),只是各自獨立一份、不共用
// class——兩份卡片的內容結構目前剛好相同,但這是巧合不是保證,attraction
// 之後若要加上「知名度/景點數量/範圍半徑」以外的專屬呈現(例如底下景點
// 清單預覽),不需要先拆解一個共用元件的職責邊界。
export function AttractionInfoPanel({
  attraction,
  onClose,
  onExplore,
  shiftBy,
}: {
  attraction: GeoAttraction | null
  onClose: () => void
  // onExplore:「探索周邊」按鈕觸發——地圖縮放到這個景點區域的完整範圍
  // (見 DesktopLayout.tsx 的 handleExploreAttraction,複用
  // GeoOutlineMap.tsx handleAttractionClick 已有的 planAttractionClick
  // 決策邏輯,只是這次由按鈕觸發而非直接點地圖上的地標)。
  onExplore: (attraction: GeoAttraction) => void
  // shiftBy:理由同 GeoInfoPanel.tsx 的同名 prop——右緣可能同時有
  // GeoHotelSidebar 與對話浮動小匡,由呼叫端判斷目前實際被哪個佔用後
  // 傳入對應值,把卡片推到它左側。
  shiftBy?: 'none' | 'hotel' | 'chat'
}) {
  if (!attraction) return null

  const badges = [
    ...(attraction.level != null ? [`知名度 L${attraction.level}`] : []),
    ...(attraction.placeCount != null ? [`${attraction.placeCount} 筆景點`] : []),
    ...(attraction.radiusMeters != null ? [`範圍約 ${Math.round(attraction.radiusMeters)} 公尺`] : []),
  ]

  const shiftClass = shiftBy === 'chat' ? ` ${styles.shiftedChat}` : shiftBy === 'hotel' ? ` ${styles.shiftedHotel}` : ''
  return (
    <div className={`${styles.panel}${shiftClass}`}>
      <div className={styles.body}>
        <div className={styles.imageWrap}>
          {attraction.landmarkPhotoUrl ? (
            <img className={styles.photo} src={attraction.landmarkPhotoUrl} alt={attraction.landmarkName ?? attraction.name} />
          ) : (
            <div className={styles.photoPlaceholder} />
          )}
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.content}>
          <h2 className={styles.name}>{attraction.name}</h2>
          {attraction.landmarkName && attraction.landmarkName !== attraction.name && (
            <span className={styles.landmarkName}>{attraction.landmarkName}</span>
          )}
          {badges.length > 0 && (
            <div className={styles.metaRow}>
              {badges.map((b) => (
                <span key={b} className={styles.badge}>{b}</span>
              ))}
            </div>
          )}
          {attraction.summary ? (
            <p className={styles.summary}>{attraction.summary}</p>
          ) : (
            <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
          )}
          <button
            type="button"
            className={styles.exploreBtn}
            onClick={() => onExplore(attraction)}
          >
            <Compass size={14} strokeWidth={2} />
            探索周邊
          </button>
        </div>
      </div>
    </div>
  )
}
