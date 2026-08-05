import { useEffect, useMemo, useState } from 'react'
import type { ClientConfig, GeoDistrict, GeoHotel, GeoPlace, GeoPlaceDetails, GeoTripEntry } from './api'
import { fetchEntries, fetchGeoGeocode } from './api'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import { isSubmitEnter } from './AppCommon'
import styles from './GeoOutlineDemo.module.css'

// GeoOutlineDemo:地理輪廓底圖(構想 6)的桌面版試做承載元件——目前 Trip
// 型別沒有目的地城市欄位(見 types.ts),故用一個暫時的城市輸入框讓使用者
// 手動觸發查詢,驗證視覺與互動是否對齊設計討論的定案,之後 Trip 補上目的地
// 城市欄位時,這裡的輸入框可以直接換成從 Trip 帶出、不需要使用者手動輸入。
//
// 這個元件本身不再查詢景點/飯店資料——「搜尋只負責定位」:輸入城市名
// 後只呼叫 fetchGeoGeocode(GET /internal/geo/geocode)拿到一組座標,轉成
// panTarget 讓 GeoOutlineMap 把地圖平移過去;地圖到了新位置後,會依它
// 當時的可視範圍自己向 GET /internal/geo/districts/nearby 查詢該顯示
// 什麼景點/飯店(見 GeoOutlineMap.tsx 的說明),查詢責任完全收在地圖
// 元件內部,這裡不再重複維護一份 districts/hotels state。
//
// onHotelsChange/onDistrictsChange 原封不動轉傳給 GeoOutlineMap——飯店/
// 地點清單改由 DesktopLayout.tsx 在「整個桌面版介面最外側」渲染(比照
// DemoPanel debug 面板的固定寬度側欄模式,跟 .desktop-main 平行,而非
// 塞在 main 內部),兩者是分開掛載的 sibling,只能靠這兩個 callback 往上
// 回報。
//
// externalPanTarget:使用者在 GeoHotelSidebar 點擊某個飯店/地點項目時要
// 移動地圖到的座標,由 DesktopLayout.tsx 往下傳——跟這裡搜尋框查到的
// panTarget 是兩個獨立來源,合併邏輯見下方 effectivePanTarget。
// selectedKey:由 DesktopLayout.tsx 往下傳,原封不動轉傳給 GeoOutlineMap,
// 讓地圖上的地標/飯店圖示能標記出目前選中的是哪一個。
// tripID:目前選中的行程 ID——切到規劃分頁、或切換行程時,若這個行程底下
// 已經有帶座標的 entry(如老手回來繼續規劃、或搬過去用等機制搬進來的
// 候選點),應該優先以這些點的中心當地圖初始位置,而不是固定顯示東京。
// 見下方 tripCenterPanTarget 的查詢與 effectivePanTarget 的優先序。
// onTripEntriesChange:同 onHotelsChange 等,把行程本身已有座標的 entry
// (見下方查詢 tripCenter 的同一個 useEffect,順便保留完整清單而不只是
// 平均座標)往上回報,供 DesktopLayout.tsx 在整個桌面版介面最外側渲染
// (地圖上畫 marker、候選籃自動帶入)——理由同 onHotelsChange/
// onDistrictsChange。
export function GeoOutlineDemo({
  cfg,
  tripID,
  onHotelsChange,
  onDistrictsChange,
  onPlacesNearby,
  onTripEntriesChange,
  onDistrictSelect,
  onHotelSelect,
  onPlaceSelect,
  onPoiSelect,
  panTarget: externalPanTarget,
  selectedKey,
}: {
  cfg: ClientConfig
  tripID?: string | null
  onHotelsChange?: (hotels: GeoHotel[]) => void
  onDistrictsChange?: (districts: GeoDistrict[]) => void
  onPlacesNearby?: (places: GeoPlace[]) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  // onDistrictSelect/onHotelSelect/onPlaceSelect/onPoiSelect:原封不動
  // 轉傳給 GeoOutlineMap——理由同 onHotelsChange 等既有 callback,見
  // GeoOutlineMap.tsx 對這幾個 prop 的說明。
  onDistrictSelect?: (district: GeoDistrict) => void
  onHotelSelect?: (hotel: GeoHotel) => void
  onPlaceSelect?: (place: GeoPlace) => void
  onPoiSelect?: (details: GeoPlaceDetails) => void
  panTarget?: { lat: number; lng: number; level?: number } | null
  selectedKey?: GeoSelectedKey
}) {
  const [city, setCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // searchPanTarget:搜尋框查到城市座標後要移動地圖到的目標——跟
  // externalPanTarget(側欄點擊)是兩個獨立來源,見下方 effectivePanTarget
  // 的合併方式。每次查詢成功都建立新物件參照,即使連續搜尋同一個城市
  // 也能讓 GeoOutlineMap 偵測到「這是一次新的移動請求」(理由同
  // GeoOutlineMap.tsx 對 panTarget 的說明)。
  const [searchPanTarget, setSearchPanTarget] = useState<{ lat: number; lng: number } | null>(null)
  // tripCenter:目前行程底下已有座標的 entry 算出來的中心點,見下方
  // useEffect,傳給 GeoOutlineMap 當地圖第一次建立時的初始中心(見該
  // 元件 initialCenter prop 的完整說明)——三態:undefined 代表「還在
  // 查、尚未確定」(初始值,地圖建立要等待這個狀態解除);null 代表
  // 「已確定查無可用資料」(沒有 tripID、或行程沒有帶座標的既有地點、
  // 或查詢失敗),退回地圖內建的預設起點;物件代表確定要用這組座標。
  // 每次 tripID 變動就重新設回 undefined、重新查一次——換行程後舊行程
  // 的中心點不該繼續生效。
  const [tripCenter, setTripCenter] = useState<{ lat: number; lng: number } | null | undefined>(undefined)
  // tripEntries:同 tripCenter 查詢流程一併算出的完整帶座標 entry 清單
  // ——這個元件自己也要留一份(不只是往外 callback),才能傳給
  // GeoOutlineMap 畫 marker(見下方 <GeoOutlineMap tripEntries={...}>)。
  const [tripEntries, setTripEntries] = useState<GeoTripEntry[]>([])

  const search = async () => {
    const trimmed = city.trim()
    if (!trimmed) return
    setLoading(true)
    setErr(null)
    try {
      const result = await fetchGeoGeocode(cfg, trimmed)
      setSearchPanTarget({ lat: result.lat, lng: result.lng })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // 切到這個分頁或換行程時,若行程底下已有帶座標的 entry,算出這些點的
  // 平均座標當地圖初始中心——只在 tripID 變動時查一次,不是每次都重查:
  // 這裡只負責「一開始該看哪裡」,之後使用者搜尋/拖曳地圖的移動不該被
  // 這份初始定位持續蓋過。重設回 undefined(而非直接設 null)是關鍵:
  // 讓 GeoOutlineMap 知道「還在查、地圖建立要等」,查完(不論有沒有查到
  // 可用資料)才轉成確定的 null 或物件,避免地圖搶先用預設值建好、之後
  // 才發現其實該建在別的地方,造成先查一次沒用的資料。
  useEffect(() => {
    setTripCenter(undefined)
    setTripEntries([])
    onTripEntriesChange?.([])
    if (!tripID) {
      setTripCenter(null)
      return
    }
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        const located = entries.filter(
          (e): e is typeof e & { lat: number; lng: number } => e.lat != null && e.lng != null,
        )
        // 順便把完整的帶座標 entry 清單(不只是算完就丟的平均座標)存下來
        // 並往上回報——這批點要畫在地圖上(見下方 <GeoOutlineMap
        // tripEntries={...}>)、也要自動帶進候選籃(見 DesktopLayout.tsx),
        // 不是只用來算初始定位。
        const mapped = located.map((e) => ({
          id: e.id,
          name: e.title,
          lat: e.lat,
          lng: e.lng,
          location: e.location,
          kind: e.kind,
        }))
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
        if (located.length === 0) {
          setTripCenter(null)
          return
        }
        const latSum = located.reduce((sum, e) => sum + e.lat, 0)
        const lngSum = located.reduce((sum, e) => sum + e.lng, 0)
        setTripCenter({ lat: latSum / located.length, lng: lngSum / located.length })
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤,但仍要轉成確定的 null——讓地圖不再
        // 繼續等待,退回預設起點,而不是永遠卡在 undefined 不建圖。
        if (!cancelled) setTripCenter(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID])

  // effectivePanTarget:地圖已經建立之後,後續移動的優先序——搜尋框查到
  // 的座標 > 側欄點擊。使用者主動搜尋或點側欄項目,代表當下明確想看
  // 哪裡。行程中心點(tripCenter)不在這條鏈裡——它只負責地圖「第一次
  // 建立時」該長在哪裡,透過下方獨立的 initialCenter prop 傳給
  // GeoOutlineMap,一步到位建圖在正確位置,不需要「先建圖、再 panTo
  // 移動過去」這道多餘手續(那樣還會查一次移動前那個位置的資料)。
  //
  // suppressQuery 依來源分開設定(見 GeoOutlineMap.tsx 對這個欄位的完整
  // 說明):searchPanTarget 是使用者明確按下「查看」要換一個地方看,
  // 移動後必須查詢新範圍的資料,不能抑制,否則會出現「移動地圖後沒有
  // 取得資料、要再手動縮放才觸發查詢」的問題;externalPanTarget(側欄
  // 點擊)只是想對齊看清楚一個已知項目,範圍通常沒有實質改變,該抑制
  // 以避免所有點清空重畫。
  //
  // 用 useMemo 快取,依實際座標值(而非物件參照)當依賴——{...x, suppressQuery}
  // 這種 spread 若每次 render 都重新求值,會產生新物件參照,即使座標
  // 完全沒變,GeoOutlineMap 的 panTarget useEffect(依參照判斷「是否為
  // 新的移動請求」,見該檔案的說明)也會被誤判成「有新的移動要執行」而
  // 重新呼叫 panTo。而 onDistrictsChange/onHotelsChange 查詢完成後會
  // 觸發 DesktopLayout 的 setGeoDistricts/setGeoHotels、連鎖讓這個元件
  // 重新渲染——若沒有 useMemo,「渲染產生新物件→panTo→idle→查詢→
  // 觸發渲染」會形成真正的無限迴圈(即使地圖靜止不動、使用者沒有任何
  // 互動,也會持續發送查詢請求)。
  const searchLat = searchPanTarget?.lat
  const searchLng = searchPanTarget?.lng
  const externalLat = externalPanTarget?.lat
  const externalLng = externalPanTarget?.lng
  const externalLevel = externalPanTarget?.level
  const effectivePanTarget = useMemo(() => {
    if (searchLat != null && searchLng != null) {
      return { lat: searchLat, lng: searchLng, suppressQuery: false }
    }
    if (externalLat != null && externalLng != null) {
      return { lat: externalLat, lng: externalLng, level: externalLevel, suppressQuery: true }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLat, searchLng, externalLat, externalLng, externalLevel])

  return (
    // geo-outline-demo-wrap:固定字串 class(與 CSS Modules 的 styles.wrap
    // 並存),供 styles-desktop.css 的 .desktop-main:has(...) 全域選擇器
    // 偵測——理由同 PaceRouteMap.tsx 的 pace-route-map-wrap(見該檔案
    // module.css 的說明):CSS Modules 雜湊過的名稱編譯時不固定,外部
    // 全域 CSS 選擇器無法可靠指到它,故需要一個不受雜湊影響的固定名稱。
    <div className={`${styles.wrap} geo-outline-demo-wrap`}>
      <div className={styles.mapArea}>
        <GeoOutlineMap
          cfg={cfg}
          initialCenter={tripCenter}
          tripEntries={tripEntries}
          onDistrictsChange={onDistrictsChange}
          onVisibleHotelsChange={onHotelsChange}
          onPlacesNearby={onPlacesNearby}
          onDistrictSelect={onDistrictSelect}
          onHotelSelect={onHotelSelect}
          onPlaceSelect={onPlaceSelect}
          onPoiSelect={onPoiSelect}
          panTarget={effectivePanTarget}
          selectedKey={selectedKey}
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
          onKeyDown={(e) => { if (isSubmitEnter(e)) search() }}
        />
        <button className={styles.searchBtn} onClick={search} disabled={loading || !city.trim()}>
          {loading ? '查詢中...' : '查看'}
        </button>
      </div>
      {err && <div className={styles.errBanner}>{err}</div>}
    </div>
  )
}
