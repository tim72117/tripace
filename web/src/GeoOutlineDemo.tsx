import { useEffect, useState } from 'react'
import type { ClientConfig, GeoDistrict, GeoHotel } from './api'
import { fetchGeoDistricts } from './api'
import { GeoOutlineMap } from './GeoOutlineMap'
import styles from './GeoOutlineDemo.module.css'

// GeoOutlineDemo:地理輪廓底圖(構想 6)的桌面版試做承載元件——目前 Trip
// 型別沒有目的地城市欄位(見 types.ts),故用一個暫時的城市輸入框讓使用者
// 手動觸發查詢,驗證視覺與互動是否對齊設計討論的定案,之後 Trip 補上目的地
// 城市欄位時,這裡的輸入框可以直接換成從 Trip 帶出、不需要使用者手動輸入。
//
// landmarkPhotoUrl 是後端已經編碼好的 data: URI(base64,含 MIME type,
// 見 server/internal/geo/places.go 的 fetchPhotoAsDataURI),圖片資料
// 直接內嵌在 fetchGeoDistricts 的 JSON 回應裡,不需要另外組網址或發
// 第二次請求就能直接當 <img src> 用。
//
// onHotelsChange:飯店清單改由 DesktopLayout.tsx 在「整個桌面版介面
// 最外側」渲染(比照 DemoPanel debug 面板的固定寬度側欄模式,跟
// .desktop-main 平行,而非塞在 main 內部),故 hotels 這份 state 的
// 「顯示」責任移出這個元件,但「查詢」責任仍在這裡(城市輸入框、
// 觸發查詢的按鈕都在這裡)。這裡不是查完就直接回報全部——GeoOutlineMap
// 內部依地圖目前可視範圍(bounds)篩選後,才透過 onVisibleHotelsChange
// 往上通知「目前畫面上看得到的飯店」,這裡原封不動轉呼叫 onHotelsChange,
// 讓側欄清單跟著地圖拖曳/縮放同步更新,而非固定顯示查詢當下的全部結果。
// panTarget:使用者在 GeoHotelSidebar 點擊某間飯店時要移動地圖到的
// 座標,由 DesktopLayout.tsx 往下傳,這裡原封不動轉傳給 GeoOutlineMap
// 執行實際的 panTo(見該元件的說明)。
export function GeoOutlineDemo({
  cfg,
  onHotelsChange,
  onDistrictsChange,
  panTarget,
}: {
  cfg: ClientConfig
  onHotelsChange?: (hotels: GeoHotel[]) => void
  onDistrictsChange?: (districts: GeoDistrict[]) => void
  panTarget?: { lat: number; lng: number; level?: number } | null
}) {
  const [city, setCity] = useState('')
  const [districts, setDistricts] = useState<GeoDistrict[]>([])
  const [hotels, setHotels] = useState<GeoHotel[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 元件卸載時(切換離開地理輪廓底圖分頁)清空外部的飯店/地點清單——
  // 側欄只在這個分頁顯示,離開後不該留著上次查詢的殘留資料。
  useEffect(() => {
    return () => {
      onHotelsChange?.([])
      onDistrictsChange?.([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async () => {
    const trimmed = city.trim()
    if (!trimmed) return
    setLoading(true)
    setErr(null)
    try {
      const result = await fetchGeoDistricts(cfg, trimmed)
      setDistricts(result.districts)
      setHotels(result.hotels)
      onDistrictsChange?.(result.districts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setDistricts([])
      setHotels([])
      onHotelsChange?.([])
      onDistrictsChange?.([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.mapArea}>
        <GeoOutlineMap
          districts={districts}
          hotels={hotels}
          onVisibleHotelsChange={onHotelsChange}
          panTarget={panTarget}
        />
      </div>
      {/* 浮動搜尋列:毛玻璃 sticky 疊在地圖上方,對齊構想 1「資深設計師
          視角」定案的既有 iOS header 視覺語言(--ios-bg 毛玻璃)——地圖
          滿版鋪底當第一層,搜尋是疊在上面的操作層,不是跟地圖平分版面
          的獨立區塊。 */}
      <div className={styles.floatingSearch}>
        <input
          className={styles.input}
          type="text"
          placeholder="輸入目的地城市,如「東京」"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
        />
        <button className={styles.searchBtn} onClick={search} disabled={loading || !city.trim()}>
          {loading ? '查詢中...' : '查看'}
        </button>
      </div>
      {err && <div className={styles.errBanner}>{err}</div>}
    </div>
  )
}
