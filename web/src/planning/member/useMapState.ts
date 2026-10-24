import type { GeoPlanningState } from './usePlanningState'
import { centerOfPoints } from '../map/mapCenter'
import { requireGeocode, requirePlacePhoto, requirePlaceText, type PlanAiDataSource } from '../data/source'
import { useEffect, useState } from 'react'
import type { ClientConfig, GeoGeocodeCandidate, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../../api'
import { fetchEntries, geocodeCandidateToSearchResult } from '../../api'
import { useStableCallback } from '../../hooks/useStableCallback'
import type { GeoPanTarget } from '../explore/selection'

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

// useMapState:從原本的 GeoOutlinePanel.tsx(已退役,其餘職責併入 planning/member/desktop/Content.tsx)拆出來的純資料邏輯——原本
// GeoOutlinePanel 混合了「城市搜尋/旅程座標查詢」這類資料邏輯,以及
// 「包一層 div 再渲染 <PlanMap>」這層 UI 職責,兩者拆開後,呼叫端
// (planning/member/desktop/Content.tsx/PlanPhoneView.tsx)可以直接使用 <PlanMap>,
// 不需要再透過一層只做轉傳的包裝元件——這也讓「把卡片用 children 掛入
// PlanMap」不必再穿透這層包裝。
//
// 這個 hook 只負責計算「傳給 PlanMap 的那些值」,不管 PlanMap 之外
// 呼叫端還想額外傳的 props(city/onCityChange、theme、children 等)——
// 那些本來就是呼叫端自己持有的值,原封不動轉傳,不需要繞經這個 hook,見
// GeoOutlinePanel.tsx 原本型別定義裡「原封不動轉傳給 PlanMap」那些
// 註解的完整說明(已隨該檔案一併移除,語意保留在這裡)。
export function useMapState({
  cfg,
  dataSource,
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
  // cfg:查旅程 entry 用;地點搜尋與搜尋結果補照片、補文字走 dataSource(資料存取層實例)。
  cfg: ClientConfig
  dataSource: PlanAiDataSource
  tripID?: string | null
  city: string
  onSearchResultSelect?: (result: GeoSearchResult) => void
  onSearchResultsChange?: (results: GeoSearchResult[]) => void
  onGeocodeCandidateText?: (placeId: string, text: GeoPlaceText) => void
  onGeocodeCandidatePhoto?: (placeId: string, photoUrl: string | null) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  externalGeocodeCandidateSelect?: GeoSearchResult | null
  // GeoPanTarget(planning/explore/selection.ts)——2026-10 改用共用型別,不再在這裡
  // 行內宣告一份:那正是該型別註解警告過的「各自宣告一次、新增欄位時
  // 漏改一邊」,而且已經真的發生過(level 在這裡有、共用型別沒有;
  // nonce 加在共用型別時這裡又漏了)。level 不在 GeoPanTarget 裡,
  // 單獨列出來。
  panTarget?: (GeoPanTarget & { level?: number }) | null
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
  // locationWanted:旅程查無既有座標(沒有旅程、旅程沒有任何帶座標的行程、或查詢失敗)時為 true,表示「地圖沒有可用的
  // 旅程中心,可以試著取使用者目前位置」。這個 hook 只負責判斷「要不要」,不碰瀏覽器定位:入口把它傳給自己的
  // useCurrentLocation(phone/、desktop/ 各一份,同名同介面,見 planning/shared/currentLocationContract.ts),取到座標後由入口
  // 畫藍點、經 geo.setPanTarget 平移過去(平移走 externalPanTarget,一樣是 suppressQuery: true)。
  //
  // 為什麼 initialCenter 不等定位:tripCenter 同時是 <PlanMap> initialCenter 的來源,該元件的建圖 effect 有
  // `if (initialCenter === undefined) return` 這道 guard(地圖要等呼叫端確定好初始中心才建立),若讓它等瀏覽器定位,
  // 最長要等 GEOLOCATION_TIMEOUT_MS(5 秒)或使用者遲遲不理會授權彈窗,地圖完全不會出現。所以 tripCenter 立刻同步決議成
  // null(地圖用東京座標建立),定位是不阻塞的背景任務;平移後的額外查詢由 suppressQuery 抑制,避免對東京座標查一次、
  // 平移後又對使用者實際位置再查一次。
  const [locationWanted, setLocationWanted] = useState(false)
  const [tripEntries, setTripEntries] = useState<GeoTripEntry[]>([])

  useEffect(() => {
    if (!searchTrigger) return
    const trimmed = city.trim()
    if (!trimmed) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    requireGeocode(dataSource, trimmed, mapCenter ?? undefined)
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
        // search-started 已經讓 planning/member/desktop/Content.tsx/PlanPhoneView.tsx
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
    requirePlaceText(dataSource, placeId)
      .then((text) => {
        if (cancelled) return
        onGeocodeCandidateText?.(placeId, text)
      })
      .catch(() => {})
    requirePlacePhoto(dataSource, placeId, name)
      .then((result) => {
        if (cancelled) return
        onGeocodeCandidatePhoto?.(placeId, result.googlePhotoUrls?.[0] ?? null)
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
    setLocationWanted(false)
    setTripEntries([])
    onTripEntriesChange?.([])
    let cancelled = false
    if (!tripID) {
      setTripCenter(null)
      setLocationWanted(true)
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
          setLocationWanted(true)
          return
        }
        setTripCenter(centerOfPoints(mapped))
      })
      .catch(() => {
        if (cancelled) return
        setTripCenter(null)
        setLocationWanted(true)
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
  // externalNonce 一併進依賴:呼叫端要求「同一個座標再移動一次」時,
  // 其餘純量都沒變,只有這個值會換(見 GeoPanTarget 對這個欄位的完整
  // 說明)。不帶 nonce 的呼叫端行為不變。
  const externalNonce = externalPanTarget?.nonce
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
  }, [externalLat, externalLng, externalLevel, externalRadiusMeters, externalOnlyIfOutOfView, externalNonce])

  // handleGeocodeCandidatesChange:類別標籤/「搜尋這個區域」按鈕觸發的
  // 查詢完成時,PlanMap.tsx 透過這個 callback 通知這裡更新
  // geocodeCandidates(理由見該 state 宣告處的完整說明)——這裡是
  // geocodeCandidates 唯一的資料來源,PlanMap 本身不再自己持有一份
  // 平行的 state。同時在這個查詢真正完成的位置直接呼叫
  // onSearchResultsChange(edge-triggered),理由同上方城市搜尋框
  // fetchGeoGeocode.then() 裡的說明。
  const handleGeocodeCandidatesChange = useStableCallback((candidates: GeoGeocodeCandidate[]) => {
    setGeocodeCandidates(candidates)
    onSearchResultsChange?.(candidates.map(geocodeCandidateToSearchResult))
  })

  return {
    // 直接對應 <PlanMap> props,呼叫端原封不動接上。
    initialCenter: tripCenter,
    locationWanted,
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

// outlineBindingFrom——useMapState 與 usePlanningState 之間固定的接線(2026-10 從桌面
// planning/member/desktop/Content.tsx 與手機 PlanPhoneView.tsx 各一份相同的十行欄位抽出):搜尋結果補文字/補照片寫回 geo、旅程 entry 與
// 地圖移動目標、候選清單與選取狀態都是 geo(usePlanningState)持有的,兩個入口對這組的接法完全一樣。呼叫端展開這個
// 物件,再補各自不同的欄位(tripID、city、searchTrigger、onSearchResultSelect/onSearchResultsChange 的入口特有行為)。
export function outlineBindingFrom(geo: GeoPlanningState) {
  return {
    onGeocodeCandidateText: (placeId: string, text: GeoPlaceText) => geo.patchGeocodeCandidateText(placeId, text),
    onGeocodeCandidatePhoto: (placeId: string, photoUrl: string | null) =>
      geo.patchGeocodeCandidatePhoto(placeId, photoUrl),
    onTripEntriesChange: geo.onTripEntriesChange,
    externalGeocodeCandidateSelect: geo.searchResultSelect,
    panTarget: geo.panTarget,
    refetchTripEntriesTrigger: geo.refetchTripEntriesTrigger,
    geocodeCandidates: geo.geocodeCandidates,
    setGeocodeCandidates: geo.setGeocodeCandidates,
    selectedCandidate: geo.selectedCandidate,
    setSelectedCandidate: geo.setSelectedCandidate,
  }
}
