import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { GeoAttraction } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import {
  getAttractionOverlayClass,
  maxLevelForZoom,
  type AttractionOverlayInstance,
} from './geoAttractionOverlay'
import { isMarkerCandidate, isMarkerSelected } from './geoMarkerSelection'

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
  revealedAttractionNames,
  hoveredCuratedName,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  attractions: GeoAttraction[]
  zoom: number
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onAttractionSelect?: (attraction: GeoAttraction) => void
  // hoveredCuratedName:使用者滑鼠移到 AttractionInfoPanel「附近景點」
  // 清單裡對應項目時,那個精選點的名稱(見 DesktopLayout.tsx 的
  // hoveredNearbyAttraction 說明)——對應的地圖圓點暫時升級成完整照片
  // 呈現(見 geoAttractionOverlay.ts 的 setHovered/renderContent),滑開
  // 後收回圓點。跟 selectedKey/hoverKey 是不同概念:後兩者驅動的是
  // 「選取靶心」樣式(見 isMarkerSelected),這裡驅動的是「要不要顯示
  // 照片」這個 DOM 結構層級的切換,只對精選點有意義(主題點永遠顯示
  // 照片,見 setHovered 對 isTheme 的忽略邏輯)。
  // revealedAttractionNames:主題點/精選點分級(2026-08,使用者明確要求)
  // ——level === 1 視為「主題點」,其餘(2/3/…)視為「精選點」,精選點
  // 預設不在地圖上顯示,只有使用者點開某個主題點、呼叫端(DesktopLayout.tsx
  // 的 revealedAttractionNames)依附近距離算出這個名稱集合後,對應的精選
  // 點才會出現在地圖上——見下方 filteredAttractions 的判斷式。undefined/
  // null 代表目前沒有開啟任何主題,精選點一律不顯示。暫不新增後端欄位
  // 區分主題/精選(見 docs/research-curated-attraction-relationships-2026-08.md
  // 的方向 C 結論:先用既有 level 表達,之後若證明不夠用再考慮專屬欄位)。
  revealedAttractionNames?: Set<string> | null
  hoveredCuratedName?: string | null
}) {
  const overlaysRef = useRef<AttractionOverlayInstance[]>([])
  const radiusCirclesRef = useRef<google.maps.Circle[]>([])

  // filteredAttractions:主題點(level === 1)維持原本「依 zoom 對應的
  // 知名度分級上限」規則——level 1 在 maxLevelForZoom 的定義下恆通過
  // (見該函式說明),等於主題點不論 zoom 都顯示,這點沒有改變舊行為。
  // 精選點(level 不是 1、也不是 null)不再吃 zoom 分級,改成完全由
  // revealedAttractionNames 這個集合決定要不要顯示——只有揭露它的那個
  // 主題點被開啟時,這批精選點才會出現在地圖上,不受使用者當下 zoom
  // 到哪一層影響(理由同呼叫端 nearbyAttractions 的說明:這是「進入
  // 主題後才依附近距離顯示精選點」,不是傳統的知名度分級揭露)。沒有
  // level 資訊的景點區域(即時查 Google Places 的結果)一律顯示,不受
  // 這整套主題/精選規則影響——這批資料沒有分級可言,無從歸類。用
  // useMemo 快取的理由(避免不必要的重畫/閃爍)同舊版說明,不變。
  const maxLevel = maxLevelForZoom(zoom)
  const filteredAttractions = useMemo(
    () => attractions.filter((d) => {
      if (d.level == null) return true
      if (d.level === 1) return d.level <= maxLevel
      return revealedAttractionNames?.has(d.name) ?? false
    }),
    [attractions, maxLevel, revealedAttractionNames],
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
        isMarkerSelected(key, selectedKey, hoverKey),
        isMarkerCandidate(key, candidateKeys),
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
        o.setSelected(isMarkerSelected(key, selectedKey, hoverKey))
      }
    })
  }, [selectedKey, hoverKey, filteredAttractions])

  // 同步候選籃狀態:只切換既有 overlay 的 class,理由同上方同步選取狀態
  // 的 effect——加入/移出候選籃不該讓其他沒被動到的景點區域跟著重畫。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredAttractions[i]
      if (d) o.setCandidate(isMarkerCandidate(geoItemKey('attraction', d), candidateKeys))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKeysToken, filteredAttractions])

  // 同步精選點的照片展開狀態:只切換既有 overlay 的 innerHTML(見
  // geoAttractionOverlay.ts 的 setHovered/renderContent),不重建整批
  // overlay——理由同上方同步選取/候選籃狀態的 effect,使用者在「附近
  // 景點」清單裡滑過不同項目時,不該讓其他沒被滑到的精選點跟著重畫。
  // setHovered 內部對 isTheme 的 no-op 與 hovered 值未變的提早跳出,已經
  // 確保主題點與非目標精選點不會被無謂觸發。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredAttractions[i]
      if (d) o.setHovered(d.name === hoveredCuratedName)
    })
  }, [hoveredCuratedName, filteredAttractions])

  // 範圍圓圈:只有帶 radiusMeters 的景點區域(手動整理的觀光慣稱分區,如
  // 清邁的古城區/尼曼區,見 server/internal/geo/district_aliases.go)
  // 才畫——這類區域沒有官方邊界資料,圓圈只是「大概這一帶」的粗略
  // 示意,故用低透明度填色+淡邊框,刻意不搶過光暈與標籤的視覺焦點。
  //
  // 顏色改成執行期讀取 --ios-sand 這個 CSS token(見 base-ui.css
  // 的完整說明),取代原本硬寫的 '#C4956A'——google.maps.Circle 是原生
  // Google Maps 物件,fillColor/strokeColor 只吃真正的色碼字串,不能直接
  // 傳 CSS 變數,故用 getComputedStyle 在建立圓圈的當下讀取實際解析到的
  // token 值。讀取目標是 mapRef.current.getDiv()(地圖本身的 DOM 容器),
  // 不是 document.documentElement——--ios-sand 這個 token 掛在
  // App.tsx 的 .app-theme-root(見該檔案的說明),是 .webApp 容器 div 上
  // 的 class,不是 <html> 元素,CSS 變數不會從子孫節點反向繼承到祖先,
  // 讀 document.documentElement 只會拿到未定義的空字串(退回硬寫的
  // fallback,等於白改)。地圖容器本身在 DOM 樹上是 .app-theme-root 的
  // 子孫,讀它的 computed style 才能拿到正確覆寫後的深/淺色版本,不需要
  // 這個 hook 自己另外接收 theme prop 或重新判斷主題邏輯。這個 effect
  // 本來就依賴 filteredAttractions 重新執行(新一批景點區域資料進來就
  // 重畫圓圈),不需要額外的 theme 依賴——使用者切換主題不會立即重畫
  // 既有圓圈,但下一次資料變動(例如重新搜尋、切換地圖範圍)自然會用
  // 當下的主題色重建,對齊這批圓圈本身「資料驅動、非常駐」的既有設計,
  // 不需要為了即時切換主題這個次要情境額外監聽 data-theme 變化。
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const mapDiv = mapRef.current.getDiv()
    const attractionColor =
      getComputedStyle(mapDiv).getPropertyValue('--ios-sand').trim() || '#C4956A'
    radiusCirclesRef.current.forEach((c) => c.setMap(null))
    radiusCirclesRef.current = filteredAttractions
      .filter((d) => d.radiusMeters && d.radiusMeters > 0)
      .map(
        (d) =>
          new google.maps.Circle({
            center: { lat: d.lat, lng: d.lng },
            radius: d.radiusMeters,
            map: mapRef.current!,
            fillColor: attractionColor,
            fillOpacity: 0.08,
            strokeColor: attractionColor,
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
