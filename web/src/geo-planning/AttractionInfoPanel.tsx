import { useEffect, useState } from 'react'
import { Compass, MapPin, X } from 'lucide-react'
import type { ClientConfig, GeoAttraction, GeoAttractionTagNeighbor } from '../api'
import { fetchGeoAttractionTagNeighbors } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
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
  cfg,
  attraction,
  onClose,
  onExplore,
  shiftLeft,
  onHoverNeighbor,
}: {
  // cfg:查詢「周邊同標籤地點」要用(見 fetchGeoAttractionTagNeighbors),
  // 跟其他 geo-planning 元件一樣直接吃 ClientConfig,不另外包一層。
  cfg: ClientConfig
  attraction: GeoAttraction | null
  onClose: () => void
  // onExplore:「探索周邊」按鈕觸發——地圖縮放到這個景點區域的完整範圍
  // (見 DesktopLayout.tsx 的 handleExploreAttraction,複用
  // GeoOutlineMap.tsx handleAttractionClick 已有的 planAttractionClick
  // 決策邏輯,只是這次由按鈕觸發而非直接點地圖上的地標)。
  onExplore: (attraction: GeoAttraction) => void
  // shiftLeft:理由同 GeoInfoPanel.tsx 的同名 prop——GeoHotelSidebar
  // 有內容顯示時會漂浮在 .desktop-main 右緣之上,跟這張卡片預設定位
  // 重疊,由呼叫端判斷後傳入,把卡片推到它左側。
  shiftLeft?: boolean
  // onHoverNeighbor:滑鼠移到「周邊同標籤地點」清單裡的某一筆時回報,由
  // DesktopLayout 中介成 geoHoverKey(跟 GeoHotelSidebar/GeoCandidateSidebar
  // 的 onHover 是同一套機制,見這兩個檔案的說明)——GeoOutlineMap 的地圖
  // 圖示已經會依 hoverKey === geoItemKey('attraction', d) 套用高亮樣式
  // (見 GeoOutlineMap.tsx 的 selectedKey/hoverKey 合併判斷),這裡不需要
  // 另外實作高亮邏輯,只要用同一把 key 回報「目前 hover 哪一筆」即可。
  // 選填:這張卡片獨立於側欄之外掛載,呼叫端若還沒接上地圖高亮可以先不傳。
  onHoverNeighbor?: (key: GeoSelectedKey) => void
}) {
  // activeTag/neighbors:點擊某個標籤 chip 後,查詢並顯示同城市、同標籤
  // 的其他地點(見 fetchGeoAttractionTagNeighbors)。attraction 切換時
  // (使用者點了地圖上另一個地標)重置,避免殘留上一筆地點的查詢結果。
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<GeoAttractionTagNeighbor[]>([])
  const [neighborsLoading, setNeighborsLoading] = useState(false)

  useEffect(() => {
    setActiveTag(null)
    setNeighbors([])
    // 換了一個地點(或卡片關閉)時,清掉可能殘留的地圖高亮——避免上一筆
    // 地點清單裡 hover 過的地標,在切到下一個地點後仍停留在高亮樣式。
    onHoverNeighbor?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attraction?.id])

  useEffect(() => {
    if (!activeTag || !attraction?.id) {
      setNeighbors([])
      return
    }
    let cancelled = false
    setNeighborsLoading(true)
    fetchGeoAttractionTagNeighbors(cfg, attraction.id, activeTag)
      .then((res) => {
        if (!cancelled) setNeighbors(res.attractions)
      })
      .catch(() => {
        if (!cancelled) setNeighbors([])
      })
      .finally(() => {
        if (!cancelled) setNeighborsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cfg, attraction?.id, activeTag])

  if (!attraction) return null

  const badges = [
    ...(attraction.level != null ? [`知名度 L${attraction.level}`] : []),
    ...(attraction.placeCount != null ? [`${attraction.placeCount} 筆景點`] : []),
    ...(attraction.radiusMeters != null ? [`範圍約 ${Math.round(attraction.radiusMeters)} 公尺`] : []),
  ]

  return (
    <div className={`${styles.panel}${shiftLeft ? ` ${styles.shifted}` : ''}`}>
      <div className={styles.head}>
        <span className={styles.title}>地點介紹</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.body}>
        {attraction.landmarkPhotoUrl ? (
          <img className={styles.photo} src={attraction.landmarkPhotoUrl} alt={attraction.landmarkName ?? attraction.name} />
        ) : (
          <div className={styles.photoPlaceholder} />
        )}
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
          {attraction.tags && attraction.tags.length > 0 && (
            <div className={styles.tagRow}>
              {attraction.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`${styles.tagChip}${activeTag === tag ? ` ${styles.tagChipActive}` : ''}`}
                  onClick={() => setActiveTag((t) => (t === tag ? null : tag))}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          {activeTag && (
            <div className={styles.neighbors}>
              {neighborsLoading ? (
                <p className={styles.neighborsEmpty}>搜尋中…</p>
              ) : neighbors.length > 0 ? (
                neighbors.map((n) => (
                  <div
                    key={n.id}
                    className={styles.neighborItem}
                    onMouseEnter={() => onHoverNeighbor?.(geoItemKey('attraction', n))}
                    onMouseLeave={() => onHoverNeighbor?.(null)}
                  >
                    {n.landmarkPhotoUrl ? (
                      <img className={styles.neighborThumb} src={n.landmarkPhotoUrl} alt={n.name} />
                    ) : (
                      <div className={styles.neighborThumbPlaceholder}>
                        <MapPin size={12} strokeWidth={2} />
                      </div>
                    )}
                    <span className={styles.neighborName}>{n.name}</span>
                    <span className={styles.neighborDistance}>{n.distanceKm} 公里</span>
                  </div>
                ))
              ) : (
                <p className={styles.neighborsEmpty}>附近沒有其他「{activeTag}」地點。</p>
              )}
            </div>
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
