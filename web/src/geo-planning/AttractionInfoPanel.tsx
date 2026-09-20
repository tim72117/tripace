import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails } from '../api'
import { fetchGeoPlaceDetails, fetchPublicGeoPlaceDetails } from '../api'
import { attractionBadges } from './geoInfoContent'
import {
  curatedCategoryOf,
  CURATED_CATEGORY_ICONS,
  CURATED_CATEGORY_LABELS,
  CURATED_CATEGORY_MAP_CLASS,
  type CuratedCategory,
} from './geoCuratedCategoryStub'
import { nearbyCategoriesPresent, filterNearbyByCategory } from './geoNearbyAttractions'
import { PhotoCarousel } from './PhotoCarousel'
import { DesktopInfoCard } from './DesktopInfoCard'
import styles from './AttractionInfoPanel.module.css'

// AttractionInfoPanel:attraction(人工建檔的景點區域,見 model.Attraction)
// 專用的介紹圖卡,獨立於 PlacePanel(飯店/推薦地點/Google 原生 POI 共用
// 的那個)之外——理由是這兩者的操作集合已經完全不同:PlacePanel 的
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
// 版面(浮動卡片疊在地圖上方,標題/關閉鍵/照片/名稱/badges/簡介)外框
// (定位/避讓/關閉鍵/捲動容器)共用 DesktopInfoCard(見該元件開頭的完整
// 說明——level 4/5 地標點擊需要讓「地點卡」跟這張主題卡並存疊放,兩者
// 的定位規則必須保持精確同步,逐字複製一份容易漏改其中一邊),內容本身
// (照片/名稱/badges/簡介/附近景點清單)仍各自獨立實作,attraction 之後
// 若要加上「知名度/景點數量/範圍半徑」以外的專屬呈現(例如底下景點清單
// 預覽),不需要先拆解共用外框的職責邊界。
export function AttractionInfoPanel({
  attraction,
  cfg,
  onClose,
  shiftBy,
  nearby,
  onSelectNearby,
  onHoverNearby,
  usePublicPlaceDetails,
  onCategoryFilterChange,
}: {
  attraction: GeoAttraction | null
  // cfg:attraction.placeId 有值時,用來呼叫 fetchGeoPlaceDetails 補查
  // 「地點照片漸進補圖機制」的雙來源照片(見下方 placeDetails effect 的
  // 完整說明)——沒有 placeId 的 attraction(舊資料,尚未補上 place_id)
  // 不會用到這個 prop,但型別上仍列為必填,理由同 PlacePanel 系列元件
  // 一貫要求呼叫端傳入 cfg 的既有慣例,不做成 optional 讓「忘記傳」這種
  // 情況能在編譯期被抓到,而不是等到執行期才發現查詢悄悄被跳過。
  cfg: ClientConfig
  onClose: () => void
  // shiftBy:理由同 PlacePanel.tsx 的同名 prop——右緣可能同時有
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
  // 這個精選點自己的「地點」卡片(PlacePanel,見 openedNearbyAttraction
  // 的完整說明),疊在這張主題卡左側,不是切換掉它。
  onSelectNearby?: (attraction: GeoAttraction) => void
  // onHoverNearby:滑鼠移入/移出清單項目時觸發(移出傳 null)——地圖上
  // 對應的精選點圓點會暫時升級成完整照片呈現(見
  // useAttractionOverlays.ts 的 hoveredCuratedName/setHovered 完整說明),
  // 讓使用者不用點擊就能先看一眼「這是哪裡」,滑開後地圖自動收回圓點。
  // 跟 onSelectNearby(點擊,開啟地點卡)是兩個獨立的互動:hover 是
  // 「順便看一眼」,click 才是「我要進一步看這個」的明確意圖。
  onHoverNearby?: (attraction: GeoAttraction | null) => void
  // usePublicPlaceDetails:true 時改打 fetchPublicGeoPlaceDetails(免登入
  // 版,見該函式與後端 handlePublicGeoPlaceDetails/
  // publicPlaceDetailsAllowlist 的完整說明)而非 fetchGeoPlaceDetails——
  // 供沒有真正登入態的公開展示頁使用(見
  // web/src/home/InteractiveExploreMap.tsx 的完整說明),讓固定示範資料也能
  // 顯示 Google/Pexels 雙來源照片輪播,不會像一般的 fetchGeoPlaceDetails
  // 那樣打 /internal/* 必定被 internalAuth 拒絕。由呼叫端明確指定要用
  // 哪支端點,這個元件不自己依 cfg.token 是否為 null 猜測——避免把
  // 「訪客」跟「公開展示頁」這兩個目前恰好重疊、但概念上不同的情境
  // 混為一談(訪客也可能出現在其他將來會走一般端點的情境)。預設 false
  // (或不傳),維持原本走 fetchGeoPlaceDetails 的行為。
  usePublicPlaceDetails?: boolean
  // onCategoryFilterChange:「附近景點」分類篩選變動時觸發(含清單本身
  // 因切換 attraction 被重置回 null)——讓呼叫端(DesktopLayout.tsx/
  // InteractiveExploreMap.tsx)能把地圖上精選點圓點的顯示範圍(見
  // useAttractionOverlays.ts 的 revealedAttractionNames)同步套用同一個
  // 篩選條件,使用者選「甜點/茶屋」時,地圖上應該只看得到甜點/茶屋類的
  // 圓點,跟清單篩選結果一致,不是清單篩了、地圖卻仍顯示全部精選點。
  onCategoryFilterChange?: (category: CuratedCategory | null) => void
}) {
  // placeDetails:attraction.placeId 有值時,補查一次「地點照片漸進補圖
  // 機制」的雙來源照片(Google/Pexels,見 handleGeoPlaceDetails 的完整
  // 說明)——不重新發明呼叫邏輯,直接沿用 PlacePanel/
  // GeoOutlinePhoneInfoSheet 走的同一支 fetchGeoPlaceDetails 端點,取回
  // 的 googlePhotoUrls/pexelsPhotoUrls 交給 PhotoCarousel 顯示,兩份清單
  // 皆空(或查詢失敗、尚未查完)時 PhotoCarousel 的 fallbackUrl 機制會
  // 自動退回 attraction.landmarkPhotoUrl 單張圖,這裡不需要另外處理
  // 「查詢失敗怎麼辦」的分支。
  //
  // 用 placeId 而非整個 attraction 物件當 effect 依賴——nearby 清單點擊
  // 切換到另一個 attraction 時(見呼叫端 onSelectNearby 的說明)placeId
  // 會跟著換一個值,理當重新查詢;同一個 attraction 因為其他 props
  // (如 nearby 清單本身)變動重新渲染時,placeId 不變不需要重查。
  // cancelled flag 防止查詢完成前使用者已經切換到另一個 attraction(或
  // 關閉卡片)時,結果誤植到目前顯示的卡片上——理由同
  // useGeoPlanningState.ts 的 infoContentPhotoFetch effect 一貫的競態
  // 保護寫法。
  const placeId = attraction?.placeId
  const [placeDetails, setPlaceDetails] = useState<GeoPlaceDetails | null>(null)
  useEffect(() => {
    setPlaceDetails(null)
    if (!placeId) return
    let cancelled = false
    const fetcher = usePublicPlaceDetails ? fetchPublicGeoPlaceDetails : fetchGeoPlaceDetails
    fetcher(cfg, placeId)
      .then((details) => {
        if (!cancelled) setPlaceDetails(details)
      })
      .catch(() => {
        // 查詢失敗不視為錯誤,維持 null——PhotoCarousel 的 fallbackUrl
        // 會退回 landmarkPhotoUrl,理由同上方 effect 說明的整體策略。
        // 公開展示頁若查到不在後端白名單內的 placeId(理論上不會發生,
        // 因為展示頁固定資料本身就是白名單的來源,見
        // fetchPublicGeoPlaceDetails 的完整說明)也會落到這裡,同樣靜默
        // 退回單張 landmarkPhotoUrl,不特別區分錯誤原因。
      })
    return () => {
      cancelled = true
    }
  }, [cfg, placeId, usePublicPlaceDetails])

  // activeCategoryFilter:「附近景點」清單上方分類下拉選單目前選中的
  // 分類——null 代表不篩選(顯示全部)。attraction 切換(nearby 清單整批
  // 換掉)時要重置回不篩選,否則使用者在清水寺選了「甜點/茶屋」,切到
  // 八坂神社時篩選條件會沿用,可能篩出空清單卻看不出原因。
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<CuratedCategory | null>(null)
  useEffect(() => {
    setActiveCategoryFilter(null)
  }, [attraction?.name])
  // 通知呼叫端目前的篩選狀態(見 onCategoryFilterChange 的完整說明)——
  // 用單獨的 effect 而非在 setActiveCategoryFilter 的每個呼叫點手動觸發,
  // 這樣不論篩選是使用者點下拉選單改變、還是上面那個 attraction 切換
  // 重置,都會經過同一個出口通知,不會漏掉任何一種改變來源。
  useEffect(() => {
    onCategoryFilterChange?.(activeCategoryFilter)
  }, [activeCategoryFilter, onCategoryFilterChange])

  // categoryDropdownOpen:分類下拉選單的展開狀態——單一膠囊按鈕顯示目前
  // 選中的分類(或「全部」),點擊展開清單選一個分類(一次只能選一個,
  // 對齊 <select> 的既有語意,不是先前多選標籤那種可複選/可個別取消的
  // 互動)。點按鈕本身切換開關,點清單外任何地方(含清單裡的選項本身,
  // 選完就該收合)關閉。
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!categoryDropdownOpen) return
    function handlePointerDown(e: PointerEvent) {
      if (categoryDropdownRef.current?.contains(e.target as Node)) return
      setCategoryDropdownOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [categoryDropdownOpen])

  // nearbyCategoryPresent:這批 nearby 清單裡實際出現過的分類集合——標籤
  // 列只顯示這些分類,不列出用不到的標籤(例如目前顯示的主題點精選點
  // 清單裡沒有「工藝/伴手禮」,就不該讓使用者點一個永遠篩不出東西的
  // 死標籤)。curatedCategoryOf 讀後端 category 欄位(見該函式的完整
  // 說明),沒有設定過分類的項目不計入任何分類、也不受篩選影響(見下方
  // filteredNearby 的說明)。
  const nearbyCategoryPresent = useMemo(() => nearbyCategoriesPresent(nearby ?? []), [nearby])

  // filteredNearby:套用 activeCategoryFilter 後實際顯示的清單——沒有
  // 分類資料的項目(curatedCategoryOf 回傳 null)在任何篩選條件下都不
  // 顯示,理由是「篩選」的語意是「只看這個分類」,無法歸類的項目不屬於
  // 使用者選中的任何分類,顯示出來反而混淆篩選結果;不篩選(null)時則
  // 正常顯示全部項目,含無分類的。
  const filteredNearby = useMemo(
    () => filterNearbyByCategory(nearby ?? [], activeCategoryFilter),
    [nearby, activeCategoryFilter],
  )

  if (!attraction) return null

  const badges = attractionBadges(attraction)

  return (
    <DesktopInfoCard onClose={onClose} shiftBy={shiftBy}>
      <div className={styles.imageWrap}>
        <PhotoCarousel
          googlePhotoUrls={placeId ? placeDetails?.googlePhotoUrls : undefined}
          pexelsPhotoUrls={placeId ? placeDetails?.pexelsPhotoUrls : undefined}
          fallbackUrl={attraction.landmarkPhotoUrl}
          alt={attraction.landmarkName ?? attraction.name}
        />
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
            <div className={styles.nearbyHeaderRow}>
              <p className={styles.nearbyTitle}>附近景點</p>
              {nearbyCategoryPresent.size > 0 && (
                <div className={styles.nearbyCategoryDropdown} ref={categoryDropdownRef}>
                <button
                  type="button"
                  className={styles.nearbyCategoryTag}
                  aria-haspopup="listbox"
                  aria-expanded={categoryDropdownOpen}
                  onClick={() => setCategoryDropdownOpen((v) => !v)}
                >
                  {activeCategoryFilter ? (
                    <>
                      {(() => {
                        const ActiveIcon = CURATED_CATEGORY_ICONS[activeCategoryFilter]
                        return (
                          <ActiveIcon
                            size={13}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        )
                      })()}
                      {CURATED_CATEGORY_LABELS[activeCategoryFilter]}
                      <span
                        className={`${styles.nearbyCategoryDot} ${CURATED_CATEGORY_MAP_CLASS[activeCategoryFilter]}`}
                        aria-hidden="true"
                      />
                    </>
                  ) : '全部分類'}
                  <ChevronDown
                    size={13}
                    strokeWidth={2}
                    aria-hidden="true"
                    className={`${styles.nearbyCategoryDropdownChevron}${categoryDropdownOpen ? ` ${styles.nearbyCategoryDropdownChevronOpen}` : ''}`}
                  />
                </button>
                {categoryDropdownOpen && (
                  <div className={styles.nearbyCategoryDropdownMenu} role="listbox">
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeCategoryFilter === null}
                      className={`${styles.nearbyCategoryDropdownItem}${activeCategoryFilter === null ? ` ${styles.nearbyCategoryDropdownItemActive}` : ''}`}
                      onClick={() => {
                        setActiveCategoryFilter(null)
                        setCategoryDropdownOpen(false)
                      }}
                    >
                      全部分類
                    </button>
                    {Array.from(nearbyCategoryPresent).map((category) => {
                      const CategoryIcon = CURATED_CATEGORY_ICONS[category]
                      const active = activeCategoryFilter === category
                      return (
                        <button
                          key={category}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`${styles.nearbyCategoryDropdownItem}${active ? ` ${styles.nearbyCategoryDropdownItemActive}` : ''}`}
                          onClick={() => {
                            setActiveCategoryFilter(category)
                            setCategoryDropdownOpen(false)
                          }}
                        >
                          <CategoryIcon
                            size={13}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className={styles.nearbyCategoryDropdownItemLabel}>
                            {CURATED_CATEGORY_LABELS[category]}
                          </span>
                          <span
                            className={`${styles.nearbyCategoryDot} ${CURATED_CATEGORY_MAP_CLASS[category]}`}
                            aria-hidden="true"
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
                </div>
              )}
            </div>
            <div className={styles.nearbyList}>
              {filteredNearby.map(({ attraction: n, minutes }) => {
                const category = curatedCategoryOf(n.category)
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
    </DesktopInfoCard>
  )
}
