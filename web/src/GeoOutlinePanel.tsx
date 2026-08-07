import { useEffect, useMemo, useState } from 'react'
import type { ClientConfig, GeoAttraction, GeoHotel, GeoPlace, GeoPlaceDetails, GeoTripEntry } from './api'
import { fetchEntries, fetchGeoGeocode } from './api'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import styles from './GeoOutlinePanel.module.css'

// mapLocatedTripEntries:把 fetchEntries 查回的完整 Entry 清單篩出有座標的
// 那批、轉成 GeoTripEntry 形狀——供下方「換行程」與「補上日期後刷新」
// 兩個 effect 共用同一份映射邏輯,避免其中一處修改欄位後忘記同步另一處。
function mapLocatedTripEntries(entries: Awaited<ReturnType<typeof fetchEntries>>): GeoTripEntry[] {
  const located = entries.filter(
    (e): e is typeof e & { lat: number; lng: number } => e.lat != null && e.lng != null,
  )
  return located.map((e) => ({
    id: e.id,
    name: e.title,
    lat: e.lat,
    lng: e.lng,
    location: e.location,
    kind: e.kind,
    start: e.start,
    startTime: e.startTime,
  }))
}

// GeoOutlinePanel:地理輪廓底圖(構想 6)的桌面版試做承載元件——目前 Trip
// 型別沒有目的地城市欄位(見 types.ts),故用一個暫時的城市搜尋讓使用者
// 手動觸發查詢,驗證視覺與互動是否對齊設計討論的定案,之後 Trip 補上目的地
// 城市欄位時,這裡可以直接換成從 Trip 帶出、不需要使用者手動輸入。
//
// 城市搜尋的輸入框/按鈕 UI 本身渲染在 GeoCandidateSidebar(左側候選籃
// 側欄最上方,見 DesktopLayout.tsx 的接線),不是這個元件的 JSX——但
// 查詢邏輯(呼叫 fetchGeoGeocode、算 panTarget)留在這裡,透過
// onCitySearched 這個 callback 讓外部(DesktopLayout.tsx)觸發查詢、
// 這裡才是唯一持有 cfg、知道怎麼呼叫 API 的地方。這個切分理由同
// onHotelsChange 等既有 callback 模式:UI 呈現與資料查詢分別交給
// 「離使用者比較近」與「離 API 比較近」的元件負責。
//
// 這個元件本身不再查詢景點/飯店資料——「搜尋只負責定位」:輸入城市名
// 後只呼叫 fetchGeoGeocode(GET /internal/geo/geocode)拿到一組座標,轉成
// panTarget 讓 GeoOutlineMap 把地圖平移過去;地圖到了新位置後,會依它
// 當時的可視範圍自己向 GET /internal/geo/attractions/nearby 查詢該顯示
// 什麼景點/飯店(見 GeoOutlineMap.tsx 的說明),查詢責任完全收在地圖
// 元件內部,這裡不再重複維護一份 attractions/hotels state。
//
// onHotelsChange/onAttractionsChange 原封不動轉傳給 GeoOutlineMap——飯店/
// 地點清單改由 DesktopLayout.tsx 在「整個桌面版介面最外側」渲染(比照
// DemoPanel debug 面板的固定寬度側欄模式,跟 .desktop-main 平行,而非
// 塞在 main 內部),兩者是分開掛載的 sibling,只能靠這兩個 callback 往上
// 回報。
//
// externalPanTarget:使用者在 GeoHotelSidebar 點擊某個飯店/地點項目時要
// 移動地圖到的座標,由 DesktopLayout.tsx 往下傳——跟這裡搜尋查到的
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
// onAttractionsChange。
export function GeoOutlinePanel({
  cfg,
  tripID,
  city,
  onSearchStateChange,
  onHotelsChange,
  onAttractionsChange,
  onPlacesNearby,
  onActiveCategoryChange,
  onTripEntriesChange,
  onAttractionSelect,
  onHotelSelect,
  onPlaceSelect,
  onPoiSelect,
  panTarget: externalPanTarget,
  selectedKey,
  candidateKeys,
  hoverKey,
  searchTrigger,
  refetchTripEntriesTrigger,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // city:目前城市搜尋框的輸入值,由 DesktopLayout.tsx 中介(UI 渲染在
  // GeoCandidateSidebar,見上方元件註解)——這個元件用它觸發
  // fetchGeoGeocode 查詢,查詢時機由 searchTrigger 遞增驅動(見下方
  // useEffect),不是每次 city 變動就查(那樣會在使用者打字打到一半時
  // 就發送請求)。
  city: string
  // onSearchStateChange:查詢中/錯誤狀態往上回報給 GeoCandidateSidebar
  // 顯示(loading 文字、錯誤訊息),搜尋按鈕本身觸發查詢的方式是遞增
  // searchTrigger prop(見下方)。
  onSearchStateChange?: (state: { searching: boolean; error: string | null }) => void
  onHotelsChange?: (hotels: GeoHotel[]) => void
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  onPlacesNearby?: (places: GeoPlace[]) => void
  // onActiveCategoryChange:原封不動轉傳給 GeoOutlineMap——理由同
  // onPlacesNearby,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  onActiveCategoryChange?: (category: string | null) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  // onAttractionSelect/onHotelSelect/onPlaceSelect/onPoiSelect:原封不動
  // 轉傳給 GeoOutlineMap——理由同 onHotelsChange 等既有 callback,見
  // GeoOutlineMap.tsx 對這幾個 prop 的說明。
  onAttractionSelect?: (attraction: GeoAttraction) => void
  onHotelSelect?: (hotel: GeoHotel) => void
  onPlaceSelect?: (place: GeoPlace) => void
  onPoiSelect?: (details: GeoPlaceDetails) => void
  panTarget?: { lat: number; lng: number; level?: number } | null
  selectedKey?: GeoSelectedKey
  // candidateKeys/hoverKey:原封不動轉傳給 GeoOutlineMap——理由同
  // selectedKey,見 GeoOutlineMap.tsx 對這兩個 prop 的完整說明。
  candidateKeys?: Set<string>
  hoverKey?: GeoSelectedKey
  // searchTrigger:每次遞增時觸發一次城市搜尋(用目前的 city prop 值)
  // ——用遞增計數器而非直接暴露一個「查詢」函式給外部呼叫,是因為這個
  // 元件本身沒有 ref,外部(GeoCandidateSidebar 的搜尋按鈕)無法直接呼叫
  // 內部方法,改用「外部改變一個 prop 值 → 這裡的 useEffect 偵測到變化
  // 才查詢」的單向資料流,對齊這個檔案其餘 panTarget/tripID 等 prop 的
  // 既有慣例(見下方 useEffect 的依賴陣列)。
  searchTrigger?: number
  // refetchTripEntriesTrigger:每次遞增時重新查一次目前行程的 entries、
  // 更新 tripEntries/onTripEntriesChange,但不動 tripCenter(不重新判斷
  // 地圖初始中心、也不讓 GeoOutlineMap 重新等待)——供
  // GeoCandidateSidebar 幫「未排定日期」的候選補上日期後,通知這裡刷新
  // 一份新的 tripEntries,好讓該候選從「未排定日期」分組移到正確的日期
  // 分組。跟 searchTrigger 是同一種「外部改變一個 prop 值 → 這裡的
  // useEffect 偵測到變化才動作」模式,理由同該 prop 的說明。0(初始值)
  // 不觸發。
  refetchTripEntriesTrigger?: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // searchPanTarget:搜尋查到城市座標後要移動地圖到的目標——跟
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

  // 每次 searchTrigger 遞增(GeoCandidateSidebar 的搜尋按鈕/Enter 觸發,
  // 見 DesktopLayout.tsx 的接線)就查一次目前的 city 值——用 effect 而非
  // 直接在按鈕 onClick 裡呼叫這個元件的方法,因為 UI 在另一個元件裡(見
  // 上方元件註解),這是唯一能讓外部觸發這裡查詢邏輯的方式。0(初始值)
  // 不觸發查詢,只有真的遞增過至少一次才查。
  useEffect(() => {
    if (!searchTrigger) return
    const trimmed = city.trim()
    if (!trimmed) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetchGeoGeocode(cfg, trimmed)
      .then((result) => {
        if (cancelled) return
        setSearchPanTarget({ lat: result.lat, lng: result.lng })
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger])

  // 查詢中/錯誤狀態往上回報給 GeoCandidateSidebar 顯示——這個元件自己
  // 不畫任何搜尋 UI(見上方元件註解),loading/err 這兩個 state 純粹是
  // 內部查詢邏輯的副產品,真正要顯示什麼交給接住這個 callback 的一方。
  useEffect(() => {
    onSearchStateChange?.({ searching: loading, error: err })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, err])

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
        // 順便把完整的帶座標 entry 清單(不只是算完就丟的平均座標)存下來
        // 並往上回報——這批點要畫在地圖上(見下方 <GeoOutlineMap
        // tripEntries={...}>)、也要自動帶進候選籃(見 DesktopLayout.tsx),
        // 不是只用來算初始定位。
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
        if (mapped.length === 0) {
          setTripCenter(null)
          return
        }
        const latSum = mapped.reduce((sum, e) => sum + e.lat, 0)
        const lngSum = mapped.reduce((sum, e) => sum + e.lng, 0)
        setTripCenter({ lat: latSum / mapped.length, lng: lngSum / mapped.length })
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

  // 補上日期後刷新 tripEntries:refetchTripEntriesTrigger 遞增時重新查一次
  // entries、更新 tripEntries/onTripEntriesChange,但不動 tripCenter——見
  // 該 prop 的說明。0(初始值)不觸發,避免掛載當下跟上面那個 effect
  // 重複查一次。
  useEffect(() => {
    if (!refetchTripEntriesTrigger || !tripID) return
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,不彈錯誤
        // 訊息打斷瀏覽,理由同其餘查詢失敗處理方式。
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTripEntriesTrigger])

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
  // 重新呼叫 panTo。而 onAttractionsChange/onHotelsChange 查詢完成後會
  // 觸發 DesktopLayout 的 setGeoAttractions/setGeoHotels、連鎖讓這個元件
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
    // geo-outline-panel-wrap:固定字串 class(與 CSS Modules 的 styles.wrap
    // 並存),供 styles-desktop.css 的 .desktop-main:has(...) 全域選擇器
    // 偵測——理由同 PaceRouteMap.tsx 的 pace-route-map-wrap(見該檔案
    // module.css 的說明):CSS Modules 雜湊過的名稱編譯時不固定,外部
    // 全域 CSS 選擇器無法可靠指到它,故需要一個不受雜湊影響的固定名稱。
    <div className={`${styles.wrap} geo-outline-panel-wrap`}>
      <div className={styles.mapArea}>
        <GeoOutlineMap
          cfg={cfg}
          initialCenter={tripCenter}
          tripEntries={tripEntries}
          onAttractionsChange={onAttractionsChange}
          onVisibleHotelsChange={onHotelsChange}
          onPlacesNearby={onPlacesNearby}
          onActiveCategoryChange={onActiveCategoryChange}
          onAttractionSelect={onAttractionSelect}
          onHotelSelect={onHotelSelect}
          onPlaceSelect={onPlaceSelect}
          onPoiSelect={onPoiSelect}
          panTarget={effectivePanTarget}
          selectedKey={selectedKey}
          candidateKeys={candidateKeys}
          hoverKey={hoverKey}
        />
      </div>
    </div>
  )
}
