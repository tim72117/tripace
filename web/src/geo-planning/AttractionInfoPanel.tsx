import { X } from 'lucide-react'
import type { GeoAttraction } from '../api'
import { attractionBadges } from './geoInfoContent'
import { curatedCategoryOf, CURATED_CATEGORY_ICONS, CURATED_CATEGORY_LABELS } from './geoCuratedCategoryStub'
import styles from './AttractionInfoPanel.module.css'

// AttractionInfoPanel:attraction(人工建檔的景點區域,見 model.Attraction)
// 專用的介紹圖卡,獨立於 GeoInfoPanel(飯店/推薦地點/Google 原生 POI 共用
// 的那個)之外——理由是這兩者的操作集合已經完全不同:GeoInfoPanel 的
// 「加入候選/加入行程」按鈕組是給還沒被選進行程規劃的地點用的,而
// attraction 本身不接受被加入候選籃或行程(見 DesktopLayout.tsx
// attractionInfoContent 不帶 candidate 欄位的說明)。與其在同一個元件裡
// 用 candidate 是否存在去判斷該渲染哪一組按鈕,拆成獨立元件讓兩邊各自的
// 操作集合單純、不互相污染,之後任一邊要新增/調整專屬按鈕也不需要擔心
// 波及另一邊。
//
// 2026-08:移除「探索周邊」按鈕(原本縮放地圖到這個景點區域的完整範圍,
// 對應的 handleExploreAttraction/placesQueryRadiusMeters 已一併從
// DesktopLayout.tsx/geoAttractionClick.ts 移除)——使用者要求拿掉,散策
// 羅盤的「附近景點」清單(見下方 nearby)已經是目前主要的延伸探索入口,
// 不需要另一顆會改變地圖視角的按鈕並存。
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
  shiftBy,
  nearby,
  onSelectNearby,
  onHoverNearby,
}: {
  attraction: GeoAttraction | null
  onClose: () => void
  // shiftBy:理由同 GeoInfoPanel.tsx 的同名 prop——右緣可能同時有
  // GeoHotelSidebar 與對話浮動小匡,由呼叫端判斷目前實際被哪個佔用後
  // 傳入對應值,把卡片推到它左側。
  shiftBy?: 'none' | 'hotel' | 'chat'
  // nearby:散策羅盤「附近景點」清單——目前地圖可視範圍內離這個錨點最近
  // 的候選景點,依距離由近到遠排序,由呼叫端(DesktopLayout.tsx)算好
  // 傳入(見該處 nearbyAttractions 的說明),這個元件不自己查詢/排序。
  // undefined 或空陣列時不顯示這個區塊——理由同 badges.length > 0 的既有
  // 判斷,沒有內容時不留一個空標題。
  nearby?: { attraction: GeoAttraction; minutes: number }[]
  // onSelectNearby:點擊清單項目觸發——呼叫端(DesktopLayout.tsx)開啟
  // 這個精選點自己的「地點」卡片(GeoInfoPanel,見 openedNearbyAttraction
  // 的完整說明),疊在這張主題卡左側,不是切換掉它。
  onSelectNearby?: (attraction: GeoAttraction) => void
  // onHoverNearby:滑鼠移入/移出清單項目時觸發(移出傳 null)——地圖上
  // 對應的精選點圓點會暫時升級成完整照片呈現(見
  // useAttractionOverlays.ts 的 hoveredCuratedName/setHovered 完整說明),
  // 讓使用者不用點擊就能先看一眼「這是哪裡」,滑開後地圖自動收回圓點。
  // 跟 onSelectNearby(點擊,開啟地點卡)是兩個獨立的互動:hover 是
  // 「順便看一眼」,click 才是「我要進一步看這個」的明確意圖。
  onHoverNearby?: (attraction: GeoAttraction | null) => void
}) {
  if (!attraction) return null

  const badges = attractionBadges(attraction)

  const shiftClass = shiftBy === 'chat' ? ` ${styles.shiftedChat}` : shiftBy === 'hotel' ? ` ${styles.shiftedHotel}` : ''
  return (
    <div className={`${styles.panel}${shiftClass}`}>
      <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
        <X size={16} strokeWidth={2} />
      </button>
      <div className={styles.body}>
        <div className={styles.imageWrap}>
          {attraction.landmarkPhotoUrl ? (
            <img className={styles.photo} src={attraction.landmarkPhotoUrl} alt={attraction.landmarkName ?? attraction.name} />
          ) : (
            <div className={styles.photoPlaceholder} />
          )}
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
          {nearby && nearby.length > 0 && (
            <div className={styles.nearbySection}>
              <p className={styles.nearbyTitle}>附近景點</p>
              <div className={styles.nearbyList}>
                {nearby.map(({ attraction: n, minutes }) => {
                  const category = curatedCategoryOf(n.name)
                  const CategoryIcon = category ? CURATED_CATEGORY_ICONS[category] : null
                  return (
                    <button
                      key={n.name}
                      type="button"
                      className={styles.nearbyItem}
                      onClick={() => onSelectNearby?.(n)}
                      onMouseEnter={() => onHoverNearby?.(n)}
                      onMouseLeave={() => onHoverNearby?.(null)}
                    >
                      <div className={styles.nearbyItemHead}>
                        {CategoryIcon && (
                          <CategoryIcon
                            size={13}
                            strokeWidth={2}
                            className={styles.nearbyCategoryIcon}
                            aria-label={CURATED_CATEGORY_LABELS[category!]}
                          />
                        )}
                        <span className={styles.nearbyName}>{n.name}</span>
                        <span className={styles.nearbyMinutes}>約 {minutes} 分</span>
                      </div>
                      {n.summary && <p className={styles.nearbySummary}>{n.summary}</p>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
