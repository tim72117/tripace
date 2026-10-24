import type { GeoAttraction } from '../../../../api'
import { itemKey, isMarkerCandidate, isMarkerSelected, type GeoSelectedKey } from '../../../explore/selectedKey'
import { getAttractionOverlayClass, type AttractionOverlayInstance } from '../../../place/attractionOverlay'
import type { FeatureLayer } from '../types'

// attractionGlowLayer——景點區域光暈(地圖上帶照片的自訂 DOM 疊圖)的功能層。
//
// 光暈是 google.maps.OverlayView 子類(planning/place/attractionOverlay.ts),有自己的 DOM 與一組狀態方法,所以用 overlay
// 繪製項目:引擎負責建立/掛載/清理/地圖重建後重掛,這裡只宣告「畫哪些景點」與「各自的狀態」。
// 狀態(選取、候選、hover)寫進 stateKey,改變時引擎呼叫 update,對同一個實例套用;不重建。
// onCreate / onDispose 讓照片查詢與標籤避讓(attractionGlowSupport)拿到實例。
// 另外三組狀態是 ScrollTimeline 嵌入式小地圖與手機主題卡專用(原本只有 InteractiveExploreMap 自己的光暈 hook 有,
// 2026-10 併進共用層),不傳就等同全部關閉:
//   hiddenAttractionId   手機版主題卡(bottom sheet)開啟時,地圖上對應主題點的光暈暫時隱藏(setHidden)
//   focusedAttractionId  時間軸聚焦的錨點剛好是這個精選點時,畫成素色小圓點(setFocused)
//   themePhotoOnlyWhenFocused / focusedThemeId  開啟時只有聚焦的主題點顯示照片,其餘主題點收成小圓點(setThemePhotoCollapsed)
// 都用景點 id 比對(name 不保證全域唯一)。

export const ATTRACTION_GLOW_LAYER_ID = 'attractionGlow'

// 有等級的景點區域要在「已揭露名單」內才畫;沒有等級的、主題點一律畫。
export function filterRevealedAttractions(attractions: GeoAttraction[], revealed: Set<string> | null | undefined): GeoAttraction[] {
  return attractions.filter((d) => {
    if (d.level == null) return true
    if (d.isTheme) return true
    return revealed?.has(d.name) ?? false
  })
}

export function attractionGlowLayer({
  attractions,
  selectedKey,
  hoverKey,
  candidateKeys,
  hoveredCuratedId,
  hiddenAttractionId,
  focusedAttractionId,
  themePhotoOnlyWhenFocused,
  focusedThemeId,
  onSelect,
  onCreate,
  onDispose,
}: {
  attractions: GeoAttraction[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  hoveredCuratedId?: string | null
  hiddenAttractionId?: string | null
  focusedAttractionId?: string | null
  themePhotoOnlyWhenFocused?: boolean
  focusedThemeId?: string | null
  onSelect: (attraction: GeoAttraction) => void
  onCreate: (key: string, attraction: GeoAttraction, overlay: AttractionOverlayInstance) => void
  onDispose: (key: string, overlay: AttractionOverlayInstance) => void
}): FeatureLayer {
  const seen = new Set<string>()
  const drawables: FeatureLayer['drawables'] = []
  for (const d of attractions) {
    const key = itemKey('attraction', d)
    if (seen.has(key)) continue
    seen.add(key)
    const selected = isMarkerSelected(key, selectedKey, hoverKey)
    const candidate = isMarkerCandidate(key, candidateKeys)
    const hovered = d.id != null && d.id === hoveredCuratedId
    const hidden = d.id != null && d.id === hiddenAttractionId
    const focused = d.id != null && d.id === focusedAttractionId
    const themeCollapsed = !!themePhotoOnlyWhenFocused && !!d.isTheme && !(d.id != null && d.id === focusedThemeId)
    const apply = (o: AttractionOverlayInstance) => {
      o.setSelected(selected)
      o.setCandidate(candidate)
      o.setHovered(hovered)
      o.setHidden(hidden)
      o.setFocused(focused)
      o.setThemePhotoCollapsed(themeCollapsed)
    }
    drawables.push({
      id: key,
      group: 'attractionGlow',
      kind: 'overlay',
      stateKey: `${selected ? 1 : 0}${candidate ? 1 : 0}${hovered ? 1 : 0}${hidden ? 1 : 0}${focused ? 1 : 0}${themeCollapsed ? 1 : 0}`,
      create: () => {
        const Overlay = getAttractionOverlayClass()
        const o = new Overlay(d, new google.maps.LatLng(d.lat, d.lng), selected, candidate, onSelect)
        apply(o)
        return o
      },
      update: apply,
      onCreate: (o: AttractionOverlayInstance) => onCreate(key, d, o),
      onDispose: (o: AttractionOverlayInstance) => onDispose(key, o),
    })
  }
  return { id: ATTRACTION_GLOW_LAYER_ID, drawables }
}
