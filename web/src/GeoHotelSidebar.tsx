import { useState } from 'react'
import { Compass, Hotel, MapPin, Plus } from 'lucide-react'
import type { GeoDistrict, GeoHotel, GeoPlace } from './api'
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
//
// selectedKey:目前被選中的項目識別鍵(見下方 itemKey),由 DesktopLayout
// 中介(理由同 geoPanTarget——側欄與地圖是分開掛載的 sibling)。點擊項目
// 本體時「移動地圖」與「標記選取」是同一個使用者意圖,故沿用
// onSelectHotel/onSelectDistrict 這兩個既有 callback 觸發,不另外新增
// onSelect 系列 prop。
export type GeoSelectedKey = string | null

// itemKey:飯店/地點/推薦地點都沒有穩定的 id(飯店/推薦地點是即時查詢
// 結果,地點可能來自三種不同來源,見 api.ts 的 GeoDistrict 說明),用
// 「名稱+座標」組合當識別鍵——同一份查詢結果內足以識別惟一項目,不需要
// 额外引入 id 欄位。entry(行程本身已有座標的 entry,見 GeoTripEntry)
// 雖然有穩定 id,仍沿用同一套「名稱+座標」規則,跟其他三種來源保持
// 一致,不需要為它另外分岔一套識別邏輯。
export function geoItemKey(
  kind: 'hotel' | 'district' | 'place' | 'entry',
  item: { name: string; lat: number; lng: number },
) {
  return `${kind}:${item.name}:${item.lat}:${item.lng}`
}

type Tab = 'hotels' | 'districts' | 'places'

// places:點擊地圖上的地標(見 GeoOutlineMap.tsx 的 handleDistrictClick)
// 時,即時查詢該地標附近的推薦地點(景點/餐廳/商店等,不限類型,對齊
// server 的 GET /internal/geo/places/nearby)——跟飯店/地點兩個分頁是
// 常駐、跟著地圖範圍持續更新的圖層不同,這個分頁是「使用者點了某個
// 地標才會有內容」的一次性查詢結果,查無資料或還沒點過任何地標時顯示
// 對應的空狀態提示。
// onSelectPlace:同 onSelectHotel/onSelectDistrict,點擊項目本體時把
// 座標往上回報以移動地圖。
export function GeoHotelSidebar({
  hotels,
  districts,
  places = [],
  selectedKey,
  onSelectHotel,
  onSelectDistrict,
  onSelectPlace,
  onAddCandidate,
}: {
  hotels: GeoHotel[]
  districts: GeoDistrict[]
  places?: GeoPlace[]
  selectedKey?: GeoSelectedKey
  onSelectHotel?: (hotel: GeoHotel) => void
  onSelectDistrict?: (district: GeoDistrict) => void
  onSelectPlace?: (place: GeoPlace) => void
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
        <button
          type="button"
          className={`${styles.tab}${tab === 'places' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('places')}
          title="附近推薦"
        >
          <Compass size={18} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.list}>
        {tab === 'hotels' ? (
          hotels.length === 0 ? (
            <div className={styles.empty}>還沒有飯店資料——查詢一個城市後,附近的住宿會列在這裡。</div>
          ) : (
            hotels.map((h) => (
              <div
                key={`${h.name}-${h.lat}-${h.lng}`}
                className={`${styles.item}${selectedKey === geoItemKey('hotel', h) ? ` ${styles.itemSelected}` : ''}`}
              >
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
        ) : tab === 'districts' ? (
          districts.length === 0 ? (
            <div className={styles.empty}>還沒有地點資料——查詢一個城市後,分區/地標會列在這裡。</div>
          ) : (
            districts.map((d) => (
              <div
                key={d.name}
                className={`${styles.item}${selectedKey === geoItemKey('district', d) ? ` ${styles.itemSelected}` : ''}`}
              >
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
          )
        ) : places.length === 0 ? (
          <div className={styles.empty}>還沒有附近推薦——點地圖上的地標圖示,附近的推薦地點會列在這裡。</div>
        ) : (
          places.map((p) => (
            <div
              key={`${p.name}-${p.lat}-${p.lng}`}
              className={`${styles.item}${selectedKey === geoItemKey('place', p) ? ` ${styles.itemSelected}` : ''}`}
            >
              <div
                role="button"
                tabIndex={0}
                className={styles.itemBody}
                onClick={() => onSelectPlace?.(p)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelectPlace?.(p) }}
              >
                {p.photoUrl ? (
                  <img className={styles.itemPhoto} src={p.photoUrl} alt={p.name} loading="lazy" />
                ) : (
                  <div className={styles.itemPhotoPlaceholder} />
                )}
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{p.name}</span>
                  <span className={styles.itemAddress}>{p.address}</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                title="加入候選"
                onClick={() => onAddCandidate?.({ kind: 'place', ...p })}
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
