import { useState } from 'react'
import { Hotel, MapPin, Plus } from 'lucide-react'
import type { GeoDistrict, GeoHotel } from './api'
import type { GeoCandidate } from './GeoCandidateSidebar'
import styles from './GeoHotelSidebar.module.css'

// GeoHotelSidebar:地理輪廓底圖(構想 6)查詢到的飯店/地點清單,顯示在
// 整個桌面版介面(rail+side panel+main)最外側——比照 DesktopLayout.tsx
// 既有的 DemoPanel(debug 面板)固定寬度側欄模式,跟 .desktop-main
// 平行,而非塞在 main 內部的某一欄。只在使用者實際查看地理輪廓底圖
// (panelMode === 'geo-outline')時才顯示,見 DesktopLayout.tsx
// 的掛載條件。
//
// 頂部分頁標籤(飯店/地點)切換要顯示哪一份清單,視覺語言比照左側
// DesktopRail 的 active 態(左緣 accent 豎條 + 淡底色),讓使用者一眼
// 認出這是同一套導覽介面慣例,不是另一套新樣式。
//
// onSelectHotel/onSelectDistrict:點擊清單項目本體時觸發,把該項目座標
// 往上回報——這個側欄跟實際的地圖(GeoOutlineMap)是分開掛載的
// sibling(側欄在 DesktopLayout 最外側,地圖在 main 內部的
// GeoOutlineDemo 裡),點擊「移動地圖到這個座標」的意圖只能靠
// DesktopLayout 中介,往下傳給 GeoOutlineDemo 再傳給 GeoOutlineMap
// 執行實際的 panTo。
//
// onAddCandidate:卡片右側的「+」按鈕觸發,把該項目加入候選籃
// (GeoCandidateSidebar,見該元件的說明)——跟 onSelectHotel/
// onSelectDistrict(移動地圖)是兩個獨立的動作,故卡片本體不能整張都是
// <button>(HTML 不允許 button 巢狀 button),改成卡片本體是可點擊的
// <div role="button">,「+」是卡片內獨立的 <button>。
type Tab = 'hotels' | 'districts'

export function GeoHotelSidebar({
  hotels,
  districts,
  onSelectHotel,
  onSelectDistrict,
  onAddCandidate,
}: {
  hotels: GeoHotel[]
  districts: GeoDistrict[]
  onSelectHotel?: (hotel: GeoHotel) => void
  onSelectDistrict?: (district: GeoDistrict) => void
  onAddCandidate?: (candidate: GeoCandidate) => void
}) {
  const [tab, setTab] = useState<Tab>('hotels')

  return (
    <aside className={styles.sidebar}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab}${tab === 'hotels' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('hotels')}
          title="飯店"
        >
          <Hotel size={18} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`${styles.tab}${tab === 'districts' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('districts')}
          title="地點"
        >
          <MapPin size={18} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.list}>
        {tab === 'hotels' ? (
          hotels.length === 0 ? (
            <div className={styles.empty}>還沒有飯店資料——查詢一個城市後,附近的住宿會列在這裡。</div>
          ) : (
            hotels.map((h) => (
              <div key={`${h.name}-${h.lat}-${h.lng}`} className={styles.item}>
                <div
                  role="button"
                  tabIndex={0}
                  className={styles.itemBody}
                  onClick={() => onSelectHotel?.(h)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelectHotel?.(h) }}
                >
                  {h.photoUrl ? (
                    <img className={styles.itemPhoto} src={h.photoUrl} alt={h.name} loading="lazy" />
                  ) : (
                    <div className={styles.itemPhotoPlaceholder} />
                  )}
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{h.name}</span>
                    <span className={styles.itemAddress}>{h.address}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.addBtn}
                  title="加入候選"
                  onClick={() => onAddCandidate?.({ kind: 'hotel', ...h })}
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
              </div>
            ))
          )
        ) : districts.length === 0 ? (
          <div className={styles.empty}>還沒有地點資料——查詢一個城市後,分區/地標會列在這裡。</div>
        ) : (
          districts.map((d) => (
            <div key={d.name} className={styles.item}>
              <div
                role="button"
                tabIndex={0}
                className={styles.itemBody}
                onClick={() => onSelectDistrict?.(d)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelectDistrict?.(d) }}
              >
                {d.landmarkPhotoUrl ? (
                  <img className={styles.itemPhoto} src={d.landmarkPhotoUrl} alt={d.landmarkName ?? d.name} loading="lazy" />
                ) : (
                  <div className={styles.itemPhotoPlaceholder} />
                )}
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{d.name}</span>
                  <span className={styles.itemAddress}>
                    {d.placeCount ? `${d.placeCount} 筆景點` : d.landmarkName ?? ''}
                  </span>
                  {d.summary && <p className={styles.itemSummary}>{d.summary}</p>}
                </div>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                title="加入候選"
                onClick={() => onAddCandidate?.({ kind: 'district', ...d })}
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
