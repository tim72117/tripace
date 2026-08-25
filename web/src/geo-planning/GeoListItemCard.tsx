import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ClientConfig } from '../api'
import { fetchGeoPlacePhoto } from '../api'

// GeoListItemCard:飯店/推薦地點/搜尋結果清單項目的共用卡片外殼——桌面版
// GeoHotelSidebar.tsx、手機版 GeoOutlinePhoneListDrawer.tsx 原本各自重寫
// 一份幾乎相同的結構(可點擊卡片本體:照片/佔位圖 + 名稱/地址 + 選取
// 樣式 class,外加各自的加入候選按鈕),連同原本獨立的
// GeocodeCandidateItem(搜尋結果專用的延遲載入照片卡片)一併收斂到這
// 裡,呼叫端只需要提供資料與各自平台特有的部分(桌面版的
// onMouseEnter/onMouseLeave hover、手機版的候選籃徽章)當 slot/props。
//
// 延遲載入照片(placeId 有值、photoUrl 未知時才觸發)——理由同原本
// GeocodeCandidateItem 的說明:清單一次最多 20 筆,若每筆一出現就立刻
// 查照片,一次搜尋最多觸發 20 次額外查詢,成本太高;改成只在項目真的
// 捲進可視範圍時才查,配合呼叫端的 photoCache 避免同一筆候選重複進出
// 視窗時重複查詢。查詢用 fetchGeoPlacePhoto(後端 photoOnly 模式,見該
// 函式的說明)而非完整的 fetchGeoPlaceDetails——清單只需要照片,不需要
// rating/summary。飯店/地點本身已經有 eager photoUrl(查詢完成時就帶
// 照片),沒有 placeId,不會觸發這段延遲查詢邏輯。
//
// styles:桌面版/手機版各自的 CSS Modules 物件,理由同原本
// GeocodeCandidateItem 的同名 prop——class 命名慣例一致(item/
// itemSelected/itemBody/itemPhoto/itemPhotoPlaceholder/itemInfo/
// itemName/itemAddress),只有視覺樣式不同。
export function GeoListItemCard({
  cfg,
  name,
  address,
  photoUrl,
  placeId,
  onPhotoLoaded,
  selected,
  onSelect,
  onHoverChange,
  addSlot,
  badgeSlot,
  styles,
}: {
  // cfg/placeId/onPhotoLoaded:只有搜尋結果(geocode,見 api.ts
  // GeoSearchResult 的說明)需要延遲查照片才會用到——飯店/地點呼叫端
  // 不傳 placeId 即可,底下的 IntersectionObserver effect 會自然跳過。
  cfg?: ClientConfig
  name: string
  address?: string
  // photoUrl:undefined 代表還沒查過(搜尋結果延遲載入的中繼狀態),
  // null 代表查過但沒有照片,string 代表已知的照片網址(飯店/地點查詢
  // 完成時就帶著,或搜尋結果查完後由 onPhotoLoaded 回填)。
  photoUrl?: string | null
  placeId?: string
  // onPhotoLoaded:搜尋結果延遲查詢完成時往上回報,寫回呼叫端的
  // photoCache——快取集中存在呼叫端,同一個 placeId 才能在多次進出視窗
  // 時只查一次。
  onPhotoLoaded?: (placeId: string, url: string | null) => void
  selected: boolean
  onSelect: () => void
  // onHoverChange:桌面版用來驅動地圖對應 marker 的暫時選取樣式(見
  // GeoHotelSidebar.tsx 既有的 onHover 說明)。手機版清單沒有 hover 概念
  // (觸控裝置無滑鼠懸停),optional、不傳時不會掛 onMouseEnter/onMouseLeave。
  onHoverChange?: (hovering: boolean) => void
  // addSlot:卡片本體右側的加入候選 UI——桌面版是懸浮 popover
  // (AddCandidateButton),手機版是原地展開區塊(ItemAddButton),視覺
  // 外殼因觸控/滑鼠操作習慣不同而各自維護,這裡只負責預留插槽位置。
  // geocode 類型不能加入候選籃(見 GeoSearchResult 的說明),呼叫端傳
  // false/undefined 即可。
  addSlot?: ReactNode
  // badgeSlot:卡片本體與 addSlot 之間的額外標記——目前只有手機版用來
  // 顯示「已加入候選」小標籤(見 GeoOutlinePhoneListDrawer.tsx 的
  // candidateKeys 說明),桌面版沒有這個視覺標記、不傳即可。
  badgeSlot?: ReactNode
  styles: Record<string, string>
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // 已經查過(不論有沒有查到照片)、沒有 placeId(飯店/地點,不需要
    // 延遲查詢)、或呼叫端沒傳 cfg/onPhotoLoaded(理論上有 placeId 就會
    // 傳,保守起見仍檢查)就不需要 observe。
    if (photoUrl !== undefined || !placeId || !cfg || !onPhotoLoaded) return
    const el = ref.current
    if (!el) return
    const pid = placeId
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        // 一旦真的進入可視範圍就立刻停止觀察並查詢——不需要持續監看,
        // 這是一次性的「有沒有出現過」判斷,理由同 HomePage.tsx 的
        // IntersectionObserver 既有用法。
        observer.disconnect()
        fetchGeoPlacePhoto(cfg, pid, name)
          .then((result) => onPhotoLoaded(pid, result.photoUrl ?? null))
          .catch(() => onPhotoLoaded(pid, null))
      },
      // rootMargin 讓查詢提前一點觸發(捲動到剛好看到一半時圖片已經在
      // 路上了),但不用太大(200px 足夠涵蓋這份清單一般的捲動速度,
      // 不需要一次預載太多筆)。
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, photoUrl])

  return (
    <div
      ref={ref}
      className={`${styles.item}${selected ? ` ${styles.itemSelected}` : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.itemBody}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect() }}
        onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
        onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      >
        {photoUrl ? (
          <img className={styles.itemPhoto} src={photoUrl} alt={name} loading="lazy" />
        ) : (
          <div className={styles.itemPhotoPlaceholder} />
        )}
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>{name}</span>
          {address && <span className={styles.itemAddress}>{address}</span>}
        </div>
      </div>
      {badgeSlot}
      {addSlot}
    </div>
  )
}
