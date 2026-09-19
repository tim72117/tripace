import { useEffect, useState } from 'react'
import type { ClientConfig, GeoGeocodeCandidate, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../api'
import { fetchEntries, fetchGeoGeocode, fetchGeoPlacePhoto, fetchGeoPlaceText, geocodeCandidateToSearchResult } from '../api'
import { useStableCallback } from '../hooks/useStableCallback'

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
        if (!cancelled) setTripCenter(null)
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
