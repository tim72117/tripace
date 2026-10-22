import type { GeoTripEntry } from '../../../api'
import { geoItemKey, isMarkerSelected, type GeoSelectedKey } from '../../geoSelectedKey'
import { tripEntryMarkerContent } from '../../mapMarkers'
import type { FeatureLayer, MarkerDrawable } from '../types'

// tripEntryLayer——行程 entry 旗子標記功能層(對應舊的 useTripEntryMarkers)。
//
// 行程本身已有座標的 entry,一筆一顆旗子(暖橘),語意是「這裡已經排進行程」。不吃可視範圍篩選:
// 這批點是行程固定的內容,全部顯示讓使用者看到完整的行程分布。不吃 candidateKeys:entry 已經有
// 自己的旗子圖示語意,不需要疊加候選籃徽章。不可點(舊 hook 也沒有點擊行為)。
//
// 選中或 hover 時放大並置頂(舊 hook 的 zIndex 999):放進 tripEntrySelected 群組,數值集中在
// zOrder.ts。顏色由呼叫端用 useAccentColor 取得後傳入,功能層本身不讀地圖(也不碰 google.maps)。
// id 用索引:entry 沒有保證唯一的穩定欄位(同名同座標的兩筆也要能並存),內容由 contentKey 驅動更新。
export function tripEntryLayer(input: {
  entries: Pick<GeoTripEntry, 'name' | 'lat' | 'lng'>[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  accentColor: string
}): FeatureLayer {
  const { entries, selectedKey, hoverKey, accentColor } = input
  const drawables: MarkerDrawable[] = entries.map((e, i) => {
    const selected = isMarkerSelected(geoItemKey('entry', e), selectedKey, hoverKey)
    return {
      id: `e${i}`,
      group: selected ? 'tripEntrySelected' : 'tripEntry',
      kind: 'marker',
      position: { lat: e.lat, lng: e.lng },
      title: e.name,
      contentKey: `${selected}|${accentColor}`,
      createContent: () => tripEntryMarkerContent(selected, accentColor),
    }
  })
  return { id: 'tripEntry', drawables }
}
