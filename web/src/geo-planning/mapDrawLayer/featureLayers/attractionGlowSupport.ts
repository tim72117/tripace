import { useCallback, useEffect, useRef } from 'react'
import type { GeoAttraction, GeoPlaceDetails } from '../../../api'
import { geoItemKey, type GeoSelectedKey } from '../../geoSelectedKey'
import type { AttractionOverlayInstance } from '../../geoAttractionOverlay'
import { scheduleOverlayPhotos, type PhotoTarget } from '../../scheduleOverlayPhotos'

// attractionGlowSupport——光暈的兩件「需要直接操作實例」的事,不屬於繪製宣告,所以不放在 attractionGlowLayer:
//   1. 照片查詢:每個有 placeId 的景點查地點詳情,把照片網址塞給實例(setPhotoUrls)。
//   2. 標籤避讓:標籤與別的光暈圖形/已顯示的標籤重疊時隱藏(依 getLabelPriority 高的優先)。
// 實例由引擎建立,透過 layer 的 onCreate / onDispose 登記進 registry(key → 景點與實例);這兩個 effect 必須宣告在
// useMapDrawLayer 之後,才會在同一次 commit 裡等引擎建好實例再跑。原本在 useAttractionOverlays.ts,行為不變。

type GlowEntry = { attraction: GeoAttraction; overlay: AttractionOverlayInstance }

export function useAttractionGlowRegistry() {
  const registry = useRef(new Map<string, GlowEntry>())
  const onCreate = useCallback((key: string, attraction: GeoAttraction, overlay: AttractionOverlayInstance) => {
    registry.current.set(key, { attraction, overlay })
  }, [])
  const onDispose = useCallback((key: string, overlay: AttractionOverlayInstance) => {
    // 同一個 key 可能已經被新實例取代(重建時先建新的再清舊的),只清自己登記的那個。
    if (registry.current.get(key)?.overlay === overlay) registry.current.delete(key)
  }, [])
  return { registry, onCreate, onDispose }
}

export function useAttractionGlowEffects({
  mapRef,
  mapReady,
  mapVersion,
  registry,
  attractions,
  selectedKey,
  hoverKey,
  candidateKeys,
  hoveredCuratedId,
  hiddenAttractionId,
  focusedAttractionId,
  themePhotoOnlyWhenFocused,
  focusedThemeId,
  placeDetails,
  photoAssets,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  mapVersion: number
  registry: { current: Map<string, GlowEntry> }
  attractions: GeoAttraction[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  hoveredCuratedId?: string | null
  // 隱藏、聚焦、主題照片收起:會改變光暈的大小與可見性,標籤避讓要跟著重算(見 attractionGlowLayer 對這組狀態的說明)。
  hiddenAttractionId?: string | null
  focusedAttractionId?: string | null
  themePhotoOnlyWhenFocused?: boolean
  focusedThemeId?: string | null
  // placeDetails、photoAssets:資料存取層實例的地點詳情與照片查詢(端點由實例決定:登入版 /internal、
  // 訪客版 /public)。沒傳 placeDetails 時不查詢照片。
  placeDetails?: (placeId: string) => Promise<GeoPlaceDetails>
  photoAssets?: (placeId: string) => Promise<{ googlePhotoUrls?: string[] }>
}) {
  // 放 ref:呼叫端每次 render 可能傳新參照,不該讓照片查詢 effect 重跑。
  const photoAssetsRef = useRef(photoAssets)
  photoAssetsRef.current = photoAssets
  const placeDetailsRef = useRef(placeDetails)
  placeDetailsRef.current = placeDetails
  // 照片查詢:已快取的立刻套;沒快取的排隊逐個查。重建後(mapVersion)新實例沒有照片,同樣由這裡補。
  useEffect(() => {
    if (!placeDetails) return
    const targets: PhotoTarget[] = []
    for (const d of attractions) {
      const overlay = registry.current.get(geoItemKey('attraction', d))?.overlay
      if (!overlay || !d.placeId) continue
      targets.push({ placeId: d.placeId, setPhotoUrls: (urls) => overlay.setPhotoUrls(urls) })
    }
    return scheduleOverlayPhotos(targets, (id) => placeDetailsRef.current!(id), photoAssetsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, attractions, !!placeDetails])

  // 標籤避讓:地圖移動/縮放後與狀態改變後各重算一次(rAF 合併)。
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''
  useEffect(() => {
    const map = mapRef.current
    // 沒有光暈時不需要掛地圖監聽(也讓沒用光暈的呼叫端不必提供 addListener)。
    if (!mapReady || !map || attractions.length === 0) return

    let rafId: number | null = null
    function resolve() {
      rafId = null
      const overlays = Array.from(registry.current.values(), (e) => e.overlay)
      const sorted = [...overlays].sort((a, b) => b.getLabelPriority() - a.getLabelPriority())
      function visibleRect(overlay: AttractionOverlayInstance, el: HTMLElement | null): DOMRect | null {
        if (!el || overlay.isHidden()) return null
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 ? rect : null
      }
      const visuals = sorted.map((overlay) => ({ overlay, rect: visibleRect(overlay, overlay.getVisualEl()) }))
      const obstacleRects: DOMRect[] = visuals.map((v) => v.rect).filter((r): r is DOMRect => r !== null)
      for (const { overlay, rect: visualRect } of visuals) {
        const labelRect = visibleRect(overlay, overlay.getLabelEl())
        if (!labelRect) continue
        const othersRects = visualRect ? obstacleRects.filter((r) => r !== visualRect) : obstacleRects
        const overlaps = othersRects.some(
          (r) => labelRect.left < r.right && labelRect.right > r.left && labelRect.top < r.bottom && labelRect.bottom > r.top,
        )
        overlay.setLabelHidden(overlaps)
        if (!overlaps) obstacleRects.push(labelRect)
      }
    }
    function scheduleResolve() {
      if (rafId != null) return
      rafId = requestAnimationFrame(resolve)
    }

    scheduleResolve()
    const listeners = [
      map.addListener('idle', scheduleResolve),
      map.addListener('bounds_changed', scheduleResolve),
      map.addListener('zoom_changed', scheduleResolve),
    ]
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      listeners.forEach((l) => l.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, attractions, selectedKey, hoverKey, candidateKeysToken, hoveredCuratedId, hiddenAttractionId, focusedAttractionId, themePhotoOnlyWhenFocused, focusedThemeId])
}
