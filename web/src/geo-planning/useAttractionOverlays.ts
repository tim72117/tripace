import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { GeoAttraction } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import {
  getAttractionOverlayClass,
  maxLevelForZoom,
  type AttractionOverlayInstance,
} from './geoAttractionOverlay'

// useAttractionOverlays——從 GeoOutlineMap.tsx 抽出來的景點區域光暈圖層。
// 只讀 mapRef/mapReady/自己的資料(attractions)/selectedKey/hoverKey/
// candidateKeys/zoom,不寫入任何其他共享狀態,是這個地圖元件裡最自成
// 一體的一塊,故獨立成 hook 不影響其餘查詢/地圖生命週期邏輯。內部行為
// (含全部原有註解說明)原封不動搬過來,搬動本身不改變任何行為。
export function useAttractionOverlays({
  mapRef,
  mapReady,
  attractions,
  zoom,
  selectedKey,
  hoverKey,
  candidateKeys,
  onAttractionSelect,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  attractions: GeoAttraction[]
  zoom: number
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onAttractionSelect?: (attraction: GeoAttraction) => void
}) {
  const overlaysRef = useRef<AttractionOverlayInstance[]>([])
  const radiusCirclesRef = useRef<google.maps.Circle[]>([])

  // filteredAttractions:依目前 zoom 對應的知名度分級上限篩選——只篩選
  // 「有 level 資訊」的景點區域(人工建檔的資料,見 model.Attraction);
  // 沒有 level 的景點區域(即時查 Google Places 的結果)一律顯示,不受
  // 縮放層級篩選影響(這批資料沒有分級可言,無從篩起)。用 useMemo 快取,
  // 理由同 hotel/place/tripEntry 各自的內容摘要 pattern:.filter() 若每次
  // render 都重算,會產生新陣列參照,讓依賴它的 useEffect(畫景點區域
  // 光暈/範圍圓圈)誤判成「內容變了」而重複清除重畫——即使這裡本身不會
  // 形成無限迴圈(filteredAttractions 沒有驅動任何 setState),但仍會在
  // sibling state(如 visibleHotels 變動連鎖傳回的新 hotels/attractions
  // prop)造成這個元件重渲染時,讓光暈/圓圈動畫不必要地重播、閃爍。
  const maxLevel = maxLevelForZoom(zoom)
  const filteredAttractions = useMemo(
    () => attractions.filter((d) => d.level == null || d.level <= maxLevel),
    [attractions, maxLevel],
  )

  // 點擊地標圖示只開介紹卡(見 onAttractionSelect),不移動/縮放地圖——
  // 原本會依 planAttractionClick 的決策 fitBounds/panTo/setZoom 到該景點
  // 區域的範圍,但這會打斷使用者原本瀏覽地圖的視角(尤其在已經手動調整過
  // 範圍的情況下),點擊圖示的意圖是「看這個地點的介紹」,不是「把我帶
  // 過去那裡」。地圖移動仍保留給明確以此為意圖的入口:AttractionInfoPanel
  // 「探索周邊」按鈕(見 GeoOutlineMap 的 handleExploreAttraction,複用
  // planAttractionClick 的同一套決策邏輯)。
  const handleAttractionClick = useCallback((d: GeoAttraction) => {
    onAttractionSelect?.(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAttractionSelect])

  // 候選籃內容摘要(排序後 join),供下方同步候選籃狀態的 effect 依賴——
  // candidateKeys 是 DesktopLayout.tsx 用 useMemo 從 geoCandidates 陣列
  // 算出的 Set,理論上內容沒變時參照應該穩定,但用內容摘要當依賴陣列
  // 項目更保險(理由同 visibleHotelsKey 等既有的內容摘要 pattern),不
  // 依賴上游一定記得做好參照穩定化。
  const candidateKeysToken = candidateKeys ? Array.from(candidateKeys).sort().join(',') : ''

  // 畫景點區域光暈疊層:地圖就緒或 filteredAttractions 變動時重畫,先清掉舊的。
  // selected 初始值直接讀當下的 selectedKey/hoverKey(重畫當下若剛好是
  // 選中/hover 項目,一開始就該是選中樣式,不必等下面那個獨立的
  // setSelected effect 補上)。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    overlaysRef.current.forEach((o) => o.setMap(null))
    const OverlayClass = getAttractionOverlayClass()
    overlaysRef.current = filteredAttractions.map((d) => {
      const key = geoItemKey('attraction', d)
      const overlay = new OverlayClass(
        d,
        new google.maps.LatLng(d.lat, d.lng),
        selectedKey === key || hoverKey === key,
        candidateKeys?.has(key) ?? false,
        handleAttractionClick,
      )
      overlay.setMap(mapRef.current!)
      return overlay
    })
    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null))
      overlaysRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filteredAttractions])

  // 同步選取狀態:只切換既有 overlay 的 class,不重建 DOM(重建會讓光暈/
  // 照片的 fadeIn 動畫重播,側欄點擊選取時地圖上的地標會不必要地閃一下)。
  // selectedKey/hoverKey 用 || 合併(見 hoverKey prop 的說明)。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredAttractions[i]
      if (d) {
        const key = geoItemKey('attraction', d)
        o.setSelected(selectedKey === key || hoverKey === key)
      }
    })
  }, [selectedKey, hoverKey, filteredAttractions])

  // 同步候選籃狀態:只切換既有 overlay 的 class,理由同上方同步選取狀態
  // 的 effect——加入/移出候選籃不該讓其他沒被動到的景點區域跟著重畫。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredAttractions[i]
      if (d) o.setCandidate(candidateKeys?.has(geoItemKey('attraction', d)) ?? false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKeysToken, filteredAttractions])

  // 範圍圓圈:只有帶 radiusMeters 的景點區域(手動整理的觀光慣稱分區,如
  // 清邁的古城區/尼曼區,見 server/internal/geo/district_aliases.go)
  // 才畫——這類區域沒有官方邊界資料,圓圈只是「大概這一帶」的粗略
  // 示意,故用低透明度填色+淡邊框,刻意不搶過光暈與標籤的視覺焦點。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    radiusCirclesRef.current.forEach((c) => c.setMap(null))
    radiusCirclesRef.current = filteredAttractions
      .filter((d) => d.radiusMeters && d.radiusMeters > 0)
      .map(
        (d) =>
          new google.maps.Circle({
            center: { lat: d.lat, lng: d.lng },
            radius: d.radiusMeters,
            map: mapRef.current!,
            fillColor: '#C4956A',
            fillOpacity: 0.08,
            strokeColor: '#C4956A',
            strokeOpacity: 0.35,
            strokeWeight: 1,
            clickable: false,
          }),
      )
    return () => {
      radiusCirclesRef.current.forEach((c) => c.setMap(null))
      radiusCirclesRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filteredAttractions])
}
