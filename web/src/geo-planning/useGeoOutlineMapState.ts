import { useEffect, useState } from 'react'
import type { ClientConfig, GeoGeocodeCandidate, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../api'
import { fetchEntries, fetchGeoGeocode, fetchGeoPlacePhoto, fetchGeoPlaceText, geocodeCandidateToSearchResult } from '../api'
import { useStableCallback } from '../hooks/useStableCallback'

// GEOLOCATION_TIMEOUT_MS:向瀏覽器要求目前位置的逾時上限——這是地圖初始
// 中心點的輔助功能,不是核心操作路徑,不該讓使用者等太久看不到地圖。
const GEOLOCATION_TIMEOUT_MS = 5000

// tryGetCurrentPosition:2026-09 新增——旅程還沒有任何帶座標的 entry
// (tripCenter 原本會是 null,地圖退回寫死的東京座標)時,改成先嘗試問
// 瀏覽器要目前位置,問得到就用使用者實際所在地當初始中心點,問不到(拒絕
// 授權、瀏覽器不支援、逾時等)才維持原本退回東京座標的行為——這是純粹
// 錦上添花的體驗改善,任何一種失敗都不該讓地圖打不開或卡住,故一律吞掉
// error 回傳 null,不往上拋。只在真的查無旅程既有座標時才觸發(見下方
// 呼叫端),不是每次進入規劃地圖都問,避免旅程已經有座標時還打擾使用者
// 一次沒必要的授權詢問。
function tryGetCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      // maximumAge:允許瀏覽器/作業系統回傳「最近一次已經有的定位結果」,
      // 不強制每次都重新定位——預設值是 0(必須全新定位),在室內/GPS
      // 冷啟動較慢的裝置上更容易撞到 GEOLOCATION_TIMEOUT_MS 逾時,即使
      // 作業系統其實握有幾秒前的可用座標。這裡允許用 1 分鐘內的舊結果,
      // 换取更高機率在逾時前拿到座標——理由同 GEOLOCATION_TIMEOUT_MS 的
      // 說明,這是錦上添花的體驗改善,能成功的次數越多越好。
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    )
  })
}

// mapLocatedTripEntries:把 fetchEntries 查回的完整 Entry 清單篩出有座標的
// 那批、轉成 GeoTripEntry 形狀——供下方「換旅程」與「補上日期後刷新」
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

// useGeoOutlineMapState:從 GeoOutlinePanel.tsx 拆出來的純資料邏輯——原本
// GeoOutlinePanel 混合了「城市搜尋/旅程座標查詢」這類資料邏輯,以及
// 「包一層 div 再渲染 <ExploreMap>」這層 UI 職責,兩者拆開後,呼叫端
// (DesktopLayout.tsx/GeoOutlinePhoneView.tsx)可以直接使用 <ExploreMap>,
// 不需要再透過一層只做轉傳的包裝元件——這也讓「把卡片用 children 掛入
// ExploreMap」不必再穿透這層包裝。
//
// 這個 hook 只負責計算「傳給 ExploreMap 的那些值」,不管 ExploreMap 之外
// 呼叫端還想額外傳的 props(city/onCityChange、theme、children 等)——
// 那些本來就是呼叫端自己持有的值,原封不動轉傳,不需要繞經這個 hook,見
// GeoOutlinePanel.tsx 原本型別定義裡「原封不動轉傳給 ExploreMap」那些
// 註解的完整說明(已隨該檔案一併移除,語意保留在這裡)。
export function useGeoOutlineMapState({
  cfg,
  tripID,
  city,
  onSearchResultSelect,
  onSearchResultsChange,
  onGeocodeCandidateText,
  onGeocodeCandidatePhoto,
  onTripEntriesChange,
  externalGeocodeCandidateSelect,
  panTarget: externalPanTarget,
  searchTrigger,
  refetchTripEntriesTrigger,
  geocodeCandidates,
  setGeocodeCandidates,
  selectedCandidate,
  setSelectedCandidate,
}: {
  cfg: ClientConfig
  tripID?: string | null
  city: string
  onSearchResultSelect?: (result: GeoSearchResult) => void
  onSearchResultsChange?: (results: GeoSearchResult[]) => void
  onGeocodeCandidateText?: (placeId: string, text: GeoPlaceText) => void
  onGeocodeCandidatePhoto?: (placeId: string, photoUrl: string | null) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  externalGeocodeCandidateSelect?: GeoSearchResult | null
  panTarget?: { lat: number; lng: number; level?: number; radiusMeters?: number; onlyIfOutOfView?: boolean } | null
  searchTrigger?: number
  refetchTripEntriesTrigger?: number
  geocodeCandidates: GeoGeocodeCandidate[]
  setGeocodeCandidates: (candidates: GeoGeocodeCandidate[]) => void
  selectedCandidate: GeoSearchResult | null
  setSelectedCandidate: (candidate: GeoSearchResult | null) => void
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [panRequest, setPanRequest] = useState<{ lat: number; lng: number; level?: number; radiusMeters?: number; suppressQuery: boolean; onlyIfOutOfView?: boolean } | null>(null)
  const [tripCenter, setTripCenter] = useState<{ lat: number; lng: number } | null | undefined>(undefined)
  // currentPosition:tryGetCurrentPosition 定位成功時的座標,供
  // useCurrentLocationMarker.ts 畫藍點——跟 tripCenter 是完全獨立的兩份
  // 資料,不是同一份資料的兩種呈現:tripCenter 決定 <ExploreMap> 的
  // initialCenter(地圖建立當下的中心點,立即同步決議,不等定位結果,見
  // 下方 tryLocateCurrentPosition 呼叫處的完整說明),currentPosition
  // 只用來畫這顆點、並驅動定位成功後的 panTarget 平移,兩者的更新時機
  // 完全不同步也是合理的(旅程有既有座標時 tripCenter 立即有值,
  // currentPosition 維持 null 直到定位完成,兩者這段期間本來就不一致)。
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [tripEntries, setTripEntries] = useState<GeoTripEntry[]>([])

  useEffect(() => {
    if (!searchTrigger) return
    const trimmed = city.trim()
    if (!trimmed) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetchGeoGeocode(cfg, trimmed, mapCenter ?? undefined)
      .then((result) => {
        if (cancelled) return
        if (result.candidates.length === 1) {
          const only = result.candidates[0]
          setPanRequest({ lat: only.lat, lng: only.lng, suppressQuery: false })
          const onlyResult = geocodeCandidateToSearchResult(only)
          onSearchResultSelect?.(onlyResult)
          setSelectedCandidate(onlyResult)
          setGeocodeCandidates(result.candidates)
        } else {
          setGeocodeCandidates(result.candidates)
        }
        onSearchResultsChange?.(result.candidates.map(geocodeCandidateToSearchResult))
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
        // 查詢失敗也要通知 onSearchResultsChange(視同零筆結果)——
        // search-started 已經讓 DesktopLayout.tsx/GeoOutlinePhoneView.tsx
        // 的 categoryTagsState 隱藏標籤列,若失敗時不呼叫這個
        // callback,標籤列永遠等不到 results-arrived 事件,會卡在隱藏
        // 狀態(見 geoCategoryTagsState.ts 的完整說明)。
        onSearchResultsChange?.([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger])

  useEffect(() => {
    if (city.trim() === '') setGeocodeCandidates([])
  }, [city])

  const handleGeocodeCandidateSelect = useStableCallback((r: GeoSearchResult) => {
    onSearchResultSelect?.(r)
    setPanRequest({ lat: r.lat, lng: r.lng, suppressQuery: false, onlyIfOutOfView: true })
    setSelectedCandidate(r)
  })

  useEffect(() => {
    const placeId = selectedCandidate?.placeId
    if (!placeId) return
    const name = selectedCandidate.name
    let cancelled = false
    fetchGeoPlaceText(cfg, placeId)
      .then((text) => {
        if (cancelled) return
        onGeocodeCandidateText?.(placeId, text)
      })
      .catch(() => {})
    fetchGeoPlacePhoto(cfg, placeId, name)
      .then((result) => {
        if (cancelled) return
        onGeocodeCandidatePhoto?.(placeId, result.photoUrl ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidate?.placeId])

  useEffect(() => {
    if (!externalGeocodeCandidateSelect) return
    handleGeocodeCandidateSelect(externalGeocodeCandidateSelect)
  }, [externalGeocodeCandidateSelect, handleGeocodeCandidateSelect])

  useEffect(() => {
    setTripCenter(undefined)
    setCurrentPosition(null)
    setTripEntries([])
    onTripEntriesChange?.([])
    let cancelled = false
    // tryLocateCurrentPosition:查無旅程既有座標(!tripID,或這個旅程一筆
    // 帶座標的 entry 都沒有)時,額外試著問一次瀏覽器目前位置——2026-09
    // 初版曾經直接把這個非同步結果餵給 setTripCenter,但 tripCenter 同時
    // 也是 <ExploreMap> initialCenter 的來源,該元件的建圖 effect 有
    // `if (initialCenter === undefined) return` 這道 guard(見該處的完整
    // 說明:地圖要等呼叫端確定好初始中心才建立),等於讓「地圖何時能
    // 建立」被綁在「瀏覽器定位何時回應」上——定位最長要等
    // GEOLOCATION_TIMEOUT_MS(5 秒)或使用者遲遲不理會授權彈窗,這段
    // 期間地圖完全不會出現,是嚴重的體驗回歸(這個 effect 原本的既有
    // 假設就是 tripCenter 幾乎同步就能決議成 null,見建圖 effect 內
    // 對這個 race 的既有註解)。故改回讓 tripCenter 立刻同步決議成 null
    // (地圖立刻用東京座標建立,行為對齊改動前),定位改成不阻塞的背景
    // 任務——真的定位成功時,透過既有的 panRequest 機制(對齊
    // externalPanTarget 的 setPanRequest 用法)把已經建好的地圖平移過去,
    // 同時寫入 currentPosition 供 useCurrentLocationMarker.ts 畫藍點。
    // suppressQuery:true——理由同 tripCenter 用 entries 平均值當中心時
    // 那次「一步到位查一次正確範圍」的既有設計初衷已經無法適用(地圖
    // 已經用東京座標查過一次),這裡改用 suppressQuery 抑制平移後的額外
    // 查詢,避免對東京座標查一次、平移後又對使用者實際位置再查一次,
    // 造成重複、且第一次查到的東京資料使用者根本沒看到就被丟棄。
    const tryLocateCurrentPosition = () => {
      tryGetCurrentPosition().then((pos) => {
        if (cancelled || !pos) return
        setCurrentPosition(pos)
        setPanRequest({ ...pos, suppressQuery: true })
      })
    }
    if (!tripID) {
      setTripCenter(null)
      tryLocateCurrentPosition()
      return
    }
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
        if (mapped.length === 0) {
          setTripCenter(null)
          tryLocateCurrentPosition()
          return
        }
        const latSum = mapped.reduce((sum, e) => sum + e.lat, 0)
        const lngSum = mapped.reduce((sum, e) => sum + e.lng, 0)
        setTripCenter({ lat: latSum / mapped.length, lng: lngSum / mapped.length })
      })
      .catch(() => {
        if (cancelled) return
        setTripCenter(null)
        tryLocateCurrentPosition()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID])

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
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTripEntriesTrigger])

  const externalLat = externalPanTarget?.lat
  const externalLng = externalPanTarget?.lng
  const externalLevel = externalPanTarget?.level
  const externalRadiusMeters = externalPanTarget?.radiusMeters
  const externalOnlyIfOutOfView = externalPanTarget?.onlyIfOutOfView
  useEffect(() => {
    if (externalLat == null || externalLng == null) return
    setPanRequest({
      lat: externalLat,
      lng: externalLng,
      level: externalLevel,
      radiusMeters: externalRadiusMeters,
      suppressQuery: true,
      onlyIfOutOfView: externalOnlyIfOutOfView,
    })
  }, [externalLat, externalLng, externalLevel, externalRadiusMeters, externalOnlyIfOutOfView])

  // handleGeocodeCandidatesChange:類別標籤/「搜尋這個區域」按鈕觸發的
  // 查詢完成時,ExploreMap.tsx 透過這個 callback 通知這裡更新
  // geocodeCandidates(理由見該 state 宣告處的完整說明)——這裡是
  // geocodeCandidates 唯一的資料來源,ExploreMap 本身不再自己持有一份
  // 平行的 state。同時在這個查詢真正完成的位置直接呼叫
  // onSearchResultsChange(edge-triggered),理由同上方城市搜尋框
  // fetchGeoGeocode.then() 裡的說明。
  const handleGeocodeCandidatesChange = useStableCallback((candidates: GeoGeocodeCandidate[]) => {
    setGeocodeCandidates(candidates)
    onSearchResultsChange?.(candidates.map(geocodeCandidateToSearchResult))
  })

  return {
    // 直接對應 <ExploreMap> props,呼叫端原封不動接上。
    initialCenter: tripCenter,
    currentPosition,
    tripEntries,
    searching: loading,
    searchError: err,
    onGeocodeCandidatesChange: handleGeocodeCandidatesChange,
    onSearchResultSelect: handleGeocodeCandidateSelect,
    onCenterChange: setMapCenter,
    panTarget: panRequest,
    geocodeCandidates,
  }
}
