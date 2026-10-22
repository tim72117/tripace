import type { GeoSearchResult } from '../../../api'
import { geoItemKey, isMarkerCandidate, isMarkerSelected, type GeoSelectedKey } from '../../geoSelectedKey'
import { searchResultMarkerContent } from '../../mapMarkers'
import type { FeatureLayer, MarkerDrawable } from '../types'

// searchResultLayer——搜尋結果標記功能層(對應舊的 useSearchResultMarkers)。
//
// 一筆結果一顆 marker,外觀依種類(飯店、地點、定位)不同;選中/hover 與「已加入候選」是兩種狀態,
// 定位結果(geocode)額外帶編號(第幾個定位結果,只算定位結果、其他種類不佔編號)。可點:點了回報
// 原本的那筆結果(onSelect)。
//
// 疊放(舊 hook 的 zIndex):選中或 hover 最上(999)→ searchResultSelected;定位結果次之(998)→
// searchResultGeocode;其餘 → searchResult。數值集中在 zOrder.ts。
//
// 不含舊 hook 裡的 fitBounds:那是鏡頭動作、不是繪製,功能層是純資料、拿不到地圖,拆成獨立的
// useFitToGeocodeResults 由呼叫端(PlanMap)掛。
//
// id 用索引:結果沒有保證唯一的穩定欄位(同種類同名同座標的兩筆也要能並存);位置、標題、內容由
// diff 原地更新。contentKey 涵蓋內容會用到的一切:種類、類別、選中、候選、定位編號。
export function searchResultLayer(input: {
  results: GeoSearchResult[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onSelect?: (result: GeoSearchResult) => void
}): FeatureLayer {
  const { results, selectedKey, hoverKey, candidateKeys, onSelect } = input
  let geocodeCount = 0
  const drawables: MarkerDrawable[] = results.map((r, i) => {
    const key = geoItemKey(r.kind, r)
    const selected = isMarkerSelected(key, selectedKey, hoverKey)
    const candidate = isMarkerCandidate(key, candidateKeys)
    const index = r.kind === 'geocode' ? ++geocodeCount : undefined
    return {
      id: `r${i}`,
      group: selected ? 'searchResultSelected' : r.kind === 'geocode' ? 'searchResultGeocode' : 'searchResult',
      kind: 'marker',
      position: { lat: r.lat, lng: r.lng },
      title: r.name,
      contentKey: `${r.kind}|${r.category ?? ''}|${selected}|${candidate}|${index ?? ''}`,
      createContent: () => searchResultMarkerContent(r, selected, candidate, index),
      clickable: true,
      onClick: () => onSelect?.(r),
    }
  })
  return { id: 'searchResult', drawables }
}
