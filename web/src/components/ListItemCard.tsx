import { useEffect, useRef } from 'react'
import type { ReactNode, Ref } from 'react'

// ListItemCard:帶左側視覺元素的清單項目卡片——全專案通用基礎元件,
// 2026-10 從 geo-planning/GeoListItemCard.tsx 抽出來(原名字帶 Geo
// 前綴,只給地圖地點清單用;使用者明確要求做成不限定模組、用通用命名
// 的共用元件)。視覺結構:可點擊卡片本體(leading 插槽 + 名稱/地址,可
// 截斷)+ 選取樣式 class + 右側插槽(badge/trailing)。
//
// 2026-10 二次修正:原本左側固定是「照片或佔位圖」兩態,內建
// IntersectionObserver 延遲載入邏輯,且耦合 geo-planning 專屬的
// ClientConfig/fetchGeoPlacePhoto——使用者進一步要求「左側可以放圖片
// 或 icon」,改成完全通用的 leading 插槽,呼叫端自己決定放 <img>、
// 佔位圖、還是 icon 圓圈,這個元件不再內建任何一種固定的左側視覺邏輯,
// 也不再認識任何 geo-planning 的型別或 API——延遲載入照片這件事(連同
// IntersectionObserver)完全變成呼叫端的責任:呼叫端自己決定 leading
// 插槽的內容要不要分階段載入,這個元件只負責排版「leading + 名稱/
// 地址 + badge + trailing」這個固定骨架。
//
// styles:呼叫端各自的 CSS Modules 物件——class 命名慣例固定(item/
// itemSelected/itemBody/itemInfo/itemName/itemAddress),只有視覺樣式
// 由呼叫端決定,這個元件不內建任何一份預設樣式,也不規定 leading 插槽
// 本身要用哪個 class(呼叫端自己決定 itemPhoto/itemPhotoPlaceholder 或
// 任何其他 class)。
export function ListItemCard({
  name,
  address,
  leading,
  selected,
  onSelect,
  onHoverChange,
  trailing,
  badge,
  styles,
}: {
  name: string
  address?: string
  // leading:卡片本體左側的視覺元素插槽——呼叫端自行決定放照片
  // (<img>)、佔位圖、還是分類 icon 圓圈,這個元件不限定內容也不內建
  // 任何載入邏輯。
  leading?: ReactNode
  selected: boolean
  onSelect: () => void
  // onHoverChange:桌面版用來驅動地圖對應 marker 等的暫時選取樣式。
  // 手機版清單沒有 hover 概念(觸控裝置無滑鼠懸停),optional、不傳時
  // 不會掛 onMouseEnter/onMouseLeave。
  onHoverChange?: (hovering: boolean) => void
  // trailing:卡片本體右側的插槽——呼叫端自行決定放什麼(加入候選按鈕、
  // 移除按鈕等任意按鈕),這個元件只負責預留插槽位置。
  trailing?: ReactNode
  // badge:卡片本體與 trailing 之間的額外標記插槽。
  badge?: ReactNode
  styles: Record<string, string>
}) {
  return (
    <div className={`${styles.item}${selected ? ` ${styles.itemSelected}` : ''}`}>
      <div
        role="button"
        tabIndex={0}
        className={styles.itemBody}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect() }}
        onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
        onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      >
        {leading}
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>{name}</span>
          {address && <span className={styles.itemAddress}>{address}</span>}
        </div>
      </div>
      {badge}
      {trailing}
    </div>
  )
}

// useLazyPhoto:延遲載入照片的共用 hook——原本內建在這個元件裡
// (IntersectionObserver,偵測 loadKey 捲進可視範圍才觸發查詢),抽成
// 獨立的 hook 讓呼叫端自己決定要不要用,搭配 leading 插槽傳入
// <img>/佔位圖。呼叫端仍要自己持有 photoUrl 的值(通常是一份
// Record<key, string | null> 快取 state)與實際查詢邏輯(onLoadPhoto),
// 這個 hook 只負責「什麼時候該觸發查詢」這件事。
export function useLazyPhotoObserver({
  loadKey,
  photoUrl,
  onLoadPhoto,
}: {
  // loadKey:觸發延遲查詢用的識別鍵(例如 Google Place ID)——未傳或
  // photoUrl 已經是已知值(非 undefined)時,不會啟動 IntersectionObserver。
  loadKey?: string
  // photoUrl:undefined 代表還沒查過(延遲載入的中繼狀態),null 代表
  // 查過但沒有照片,string 代表已知的照片網址。
  photoUrl?: string | null
  // onLoadPhoto:loadKey 真的捲進可視範圍時觸發一次,呼叫端自行決定怎麼
  // 查詢、把結果寫回自己持有的快取。
  onLoadPhoto?: (key: string) => void
}) {
  // HTMLElement(而非 HTMLDivElement)——這個 ref 同時要能掛在 <img>
  // (有照片時)或 <div>(佔位圖時)上,見下方 PhotoLeading 的用法。
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (photoUrl !== undefined || !loadKey || !onLoadPhoto) return
    const el = ref.current
    if (!el) return
    const key = loadKey
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        onLoadPhoto(key)
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, photoUrl])

  return ref
}

// PhotoLeading:leading 插槽最常見的用法——照片(已知時)或佔位圖
// (未知/查無時),搭配 useLazyPhotoObserver 的延遲載入。不是
// ListItemCard 本身的一部分,只是把「三個呼叫端都要重複寫一次 ref +
// <img>/佔位圖」這段樣板收斂成一個可選的輔助元件;呼叫端也可以完全不用
// 這個,直接傳自己的 icon 圓圈給 leading。className 由呼叫端傳入兩個
// class(photoClassName/placeholderClassName),對齊各自 CSS Modules 的
// itemPhoto/itemPhotoPlaceholder 命名慣例。
export function PhotoLeading({
  name,
  photoUrl,
  loadKey,
  onLoadPhoto,
  photoClassName,
  placeholderClassName,
}: {
  name: string
  photoUrl?: string | null
  loadKey?: string
  onLoadPhoto?: (key: string) => void
  photoClassName: string
  placeholderClassName: string
}) {
  const ref = useLazyPhotoObserver({ loadKey, photoUrl, onLoadPhoto })
  return photoUrl ? (
    <img ref={ref as Ref<HTMLImageElement>} className={photoClassName} src={photoUrl} alt={name} loading="lazy" />
  ) : (
    <div ref={ref as Ref<HTMLDivElement>} className={placeholderClassName} />
  )
}
