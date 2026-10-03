import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ClientConfig, GeoAttraction } from '../api'
import { fetchGeoPlaceDetails, fetchPublicGeoPlaceDetails } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import {
  getAttractionOverlayClass,
  type AttractionOverlayInstance,
} from './geoAttractionOverlay'
import { isMarkerCandidate, isMarkerSelected } from './geoMarkerSelection'

// useAttractionOverlays——從 ExploreMap.tsx 抽出來的景點區域光暈圖層。
// 只讀 mapRef/mapReady/自己的資料(attractions)/selectedKey/hoverKey/
// candidateKeys,不寫入任何其他共享狀態,是這個地圖元件裡最自成一體的
// 一塊,故獨立成 hook 不影響其餘查詢/地圖生命週期邏輯。內部行為(含全部
// 原有註解說明)原封不動搬過來,搬動本身不改變任何行為。不再接收 zoom
// prop——原本只用來算 maxLevelForZoom 判斷主題點是否隨縮放層級隱藏,
// 但主題點(level===1)在該函式定義下恆通過,等於本來就是恆顯示,這層
// zoom 判斷已被移除(見下方 filteredAttractions 的完整說明),故不再
// 需要呼叫端傳入 zoom。
export function useAttractionOverlays({
  mapRef,
  mapReady,
  mapVersion = 0,
  attractions,
  selectedKey,
  hoverKey,
  candidateKeys,
  onAttractionSelect,
  revealedAttractionNames,
  hoveredCuratedId,
  cfg,
  usePublicPlaceDetails,
  hiddenAttractionId,
}: {
  mapRef: React.RefObject<google.maps.Map | null>
  mapReady: boolean
  // mapVersion:選填,只有呼叫端用 NativeMapBase.tsx(見該檔案
  // MapHandle.mapVersion 的完整說明)才會有意義地傳入——ExploreMap.tsx
  // 自己管理地圖生命週期,不經過 NativeMapBase,沒有這個概念,不傳時
  // 預設 0(下方 useEffect 的依賴陣列多一個恆定值,不影響既有行為)。
  // 存在的理由:單靠 mapReady 這個布林值,在地圖因 theme 改變而重建時,
  // 可能被 React 18 自動批次處理合併掉中間的 false 狀態,導致這個
  // effect 誤判成「沒有變化」而不重新執行,新地圖建好後 overlay 沒有
  // 被重新掛上去(見 NativeMapBase.tsx 對這個問題的完整說明)。
  mapVersion?: number
  attractions: GeoAttraction[]
  selectedKey?: GeoSelectedKey
  hoverKey?: GeoSelectedKey
  candidateKeys?: Set<string>
  onAttractionSelect?: (attraction: GeoAttraction) => void
  // hoveredCuratedId:使用者滑鼠移到 AttractionInfoPanel「附近景點」
  // 清單裡對應項目時,那個精選點的 id(見 DesktopLayout.tsx 的
  // hoveredNearbyAttraction 說明)——對應的地圖圓點暫時升級成完整照片
  // 呈現(見 geoAttractionOverlay.ts 的 setHovered/renderContent),滑開
  // 後收回圓點。跟 selectedKey/hoverKey 是不同概念:後兩者驅動的是
  // 「選取靶心」樣式(見 isMarkerSelected),這裡驅動的是「要不要顯示
  // 照片」這個 DOM 結構層級的切換,只對精選點有意義(主題點永遠顯示
  // 照片,見 setHovered 對 isTheme 的忽略邏輯)。
  // 2026-10 修正(code review 抓到):原本用 name 字串比對——跟
  // openThemeId(見 InteractiveExploreMap.tsx 的完整說明)同樣的理由,
  // name 不保證全域唯一(已知現有重複資料案例,見該處說明),改用 id
  // 當識別值才是真正穩固的做法,避免兩個同名景點被誤判成同一個而同時
  // 升級成照片呈現。
  // revealedAttractionNames:主題點/精選點分級(2026-08,使用者明確要求)
  // ——isTheme(model.Attraction.IsTheme,見該欄位完整說明)為 true 視為
  // 「主題點」,其餘視為「精選點」,精選點預設不在地圖上顯示,只有使用者
  // 點開某個主題點、呼叫端(DesktopLayout.tsx 的 revealedAttractionNames)
  // 依附近距離算出這個名稱集合後,對應的精選點才會出現在地圖上——見下方
  // filteredAttractions 的判斷式。undefined/null 代表目前沒有開啟任何
  // 主題,精選點一律不顯示。原本(2026-08 前)這個分級直接借用 level===1
  // 表達(見 docs/research-curated-attraction-relationships-2026-08.md
  // 的方向 C 結論),現已改用獨立的 isTheme 欄位,不再依賴 level 數字
  // ——level 保留給地圖 zoom 顯示門檻/知名度描述使用,兩種語意不再混在
  // 同一個欄位。
  revealedAttractionNames?: Set<string> | null
  hoveredCuratedId?: string | null
  // cfg/usePublicPlaceDetails:查詢地圖上地標圖示照片用(見下方
  // photoUrlCacheRef 的完整說明)——2026-09 使用者明確要求「不再使用
  // landmarkPhotoUrl,如果有 place id 則使用 photo_assets 第一張圖」,
  // 這兩個參數讓這個 hook 能跟 AttractionInfoPanel.tsx 走同一支端點
  // (fetchGeoPlaceDetails/fetchPublicGeoPlaceDetails)、同一套
  // cfg/usePublicPlaceDetails 判斷邏輯,不重新發明一份。usePublicPlaceDetails
  // 語意與該元件同名 prop 完全一致:true 時改打免登入版(供沒有真正登入態
  // 的公開展示頁使用,見 InteractiveExploreMap.tsx)。cfg 為 optional——
  // 沒有傳入時(理論上不該發生,呼叫端應該一律傳)視同沒有任何地標會查詢
  // 照片,全部顯示 placeholder,不拋錯。
  cfg?: ClientConfig
  usePublicPlaceDetails?: boolean
  // hiddenAttractionId:手機版點開主題點的 bottom sheet(見
  // InteractiveExploreMap.tsx 的 openThemeId)期間,地圖上對應該主題點
  // 的 overlay 本身要暫時隱藏——sheet 已經完整呈現該主題點的照片/資訊,
  // 地圖上同一個光暈+縮圖疊層同時存在會造成視覺重複、也容易被手指誤觸
  // 到。
  // 2026-10 修正:原本用 name 字串比對——使用者明確要求改用 id,理由
  // 同 InteractiveExploreMap.tsx openThemeId 的完整說明:name 理論上
  // 不保證全域唯一(先前已知現有重複資料案例,見該處說明),用 id 才是
  // 真正穩固的識別方式。主題點固定來自人工建檔資料,id 恆有值(見
  // GeoAttraction.id 的完整說明:只有即時查 Google Places 的後備路徑
  // 才沒有 id,這條路徑恆為 isTheme===false,不會出現在這裡)。桌面版
  // (AttractionInfoPanel 並存顯示,不走 bottom sheet)呼叫端固定傳
  // null/undefined,不受影響。
  hiddenAttractionId?: string | null
}) {
  const overlaysRef = useRef<AttractionOverlayInstance[]>([])
  // photoUrlCacheRef:placeId → 已查到的 photoUrl(或 undefined 代表查無/
  // 失敗)的快取,跨越 filteredAttractions 重新渲染仍然保留——地圖上同
  // 一批地標可能因為 selectedKey/candidateKeys 等其他狀態變動導致這個
  // hook 重新執行,若不快取,每次都要重新打一次 place-details 會造成
  // 大量重複、沒有必要的請求(尤其地圖上主題點數量可能有數十個)。
  // 只在整個 hook 生命週期內存在(不隨 mapVersion 重建清空)——即使地圖
  // 因 theme 改變重建,已經查過的照片網址不會過期到需要重新打一次
  // 這麼快的程度,沿用舊快取即可。
  const photoUrlCacheRef = useRef<Map<string, string | undefined>>(new Map())

  // filteredAttractions:主題點(isTheme===true)恆顯示,不受 zoom 影響
  // ——這點延續舊行為不變(舊版用 level===1 搭配 maxLevelForZoom 判斷,
  // 但 level 1 在該函式定義下恆通過,等於本來就是恆顯示,只是繞了一層
  // 數字比較,現在改用 isTheme 後這層繞路已無必要,一併移除)。精選點
  // (isTheme===false)不吃 zoom 分級,完全由 revealedAttractionNames 這個
  // 集合決定要不要顯示——只有揭露它的那個主題點被開啟時,這批精選點才會
  // 出現在地圖上,不受使用者當下 zoom 到哪一層影響(理由同呼叫端
  // nearbyAttractions 的說明:這是「進入主題後才依附近距離顯示精選點」,
  // 不是傳統的知名度分級揭露)。沒有 level 資訊的景點區域(即時查 Google
  // Places 的結果,同時 isTheme 固定是 false,見 GeoAttraction.isTheme 的
  // 完整說明)一律顯示,不受這整套主題/精選規則影響——這批資料沒有
  // 主題概念可言,無從歸類,故仍需保留 level == null 這個判斷式,不能只看
  // isTheme。用 useMemo 快取的理由(避免不必要的重畫/閃爍)同舊版說明,
  // 不變。
  const filteredAttractions = useMemo(
    () => attractions.filter((d) => {
      if (d.level == null) return true
      if (d.isTheme) return true
      return revealedAttractionNames?.has(d.name) ?? false
    }),
    [attractions, revealedAttractionNames],
  )

  // 點擊地標圖示只開介紹卡(見 onAttractionSelect),不移動/縮放地圖——
  // 原本會依 planAttractionClick 的決策 fitBounds/panTo/setZoom 到該景點
  // 區域的範圍,但這會打斷使用者原本瀏覽地圖的視角(尤其在已經手動調整過
  // 範圍的情況下),點擊圖示的意圖是「看這個地點的介紹」,不是「把我帶
  // 過去那裡」。地圖移動仍保留給明確以此為意圖的入口:AttractionInfoPanel
  // 「探索周邊」按鈕(見 ExploreMap 的 handleExploreAttraction,複用
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
  }, [mapReady, mapVersion, filteredAttractions])

  // 查詢地圖上地標圖示的實際照片(2026-09,使用者明確要求「不再使用
  // landmarkPhotoUrl,如果有 place id 則使用 photo_assets 第一張圖」)
  // ——對每個有 placeId 的地點,打 fetchGeoPlaceDetails/
  // fetchPublicGeoPlaceDetails(跟 AttractionInfoPanel.tsx 點開詳情卡
  // 走同一支端點/同一套 photo_assets 資料來源),查到後呼叫對應 overlay
  // 的 setPhotoUrl 只更新圖片本身,不重建整組 overlay。沒有 placeId 的
  // 地點(舊資料,尚未補上 place_id)固定顯示 placeholder,不查詢也不
  // 退回任何舊表資料。
  //
  // 依賴陣列跟上方建 overlay 的 effect 完全相同(mapReady/mapVersion/
  // filteredAttractions)——這個 effect 必須在 overlay 陣列剛建好、
  // 且對應到同一輪 filteredAttractions 時才查詢,兩個 effect 依賴一致
  // 才能保證 overlaysRef.current 與 filteredAttractions 的索引對應關係
  // 沒有被中途其他重繪打斷(React 保證同一次 render 週期內,依賴相同的
  // 多個 effect 會依原始程式碼順序依序執行,這裡緊接在建 overlay 的
  // effect 之後,讀到的一定是剛建好的那一批 overlay)。
  useEffect(() => {
    if (!cfg) return
    let cancelled = false
    const fetcher = usePublicPlaceDetails ? fetchPublicGeoPlaceDetails : fetchGeoPlaceDetails
    filteredAttractions.forEach((d, i) => {
      const overlay = overlaysRef.current[i]
      if (!overlay || !d.placeId) return
      const placeId = d.placeId
      const cache = photoUrlCacheRef.current
      if (cache.has(placeId)) {
        overlay.setPhotoUrl(cache.get(placeId))
        return
      }
      fetcher(cfg, placeId)
        .then((details) => {
          if (cancelled) return
          cache.set(placeId, details.photoUrl)
          overlay.setPhotoUrl(details.photoUrl)
        })
        .catch(() => {
          // 查詢失敗:比照 AttractionInfoPanel.tsx 的既有處理方式,不
          // 特別區分錯誤原因,靜默維持 placeholder,不快取失敗結果——
          // 失敗可能是暫時性的網路問題,下次這個 hook 重新執行時應該
          // 再試一次,不該永久卡在「這個 placeId 已知查不到」的狀態。
        })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapVersion, filteredAttractions, cfg, usePublicPlaceDetails])

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
      if (d) o.setHovered(d.id != null && d.id === hoveredCuratedId)
    })
  }, [hoveredCuratedId, filteredAttractions])

  // 同步主題點隱藏狀態:只切換既有 overlay 的 visibility(見
  // geoAttractionOverlay.ts 的 setHidden),理由同上方其他同步 effect。
  // 依賴陣列額外補上 mapReady/mapVersion(其餘同步 effect 不需要,因為
  // selectedKey/candidateKeys/hoveredCuratedId 這些狀態變動時地圖通常
  // 早已就緒)——2026-10 實測踩過:hiddenAttractionId 在地圖尚未就緒
  // 的那個空窗期就先變成有值(例如 defaultOpenTheme 自動開啟主題卡,常常
  // 跟地圖本身的 attractions 查詢、建圖幾乎同時發生),這個 effect 當下
  // 執行時 overlaysRef.current 還是空陣列,forEach 一次都不會跑;等地圖
  // 真的建好、上方重建 overlay 的 effect 跑完,這個 effect 的依賴
  // (hiddenAttractionId/filteredAttractions)並未改變,不會重新執行,
  // 隱藏狀態就永久遺漏。
  useEffect(() => {
    overlaysRef.current.forEach((o, i) => {
      const d = filteredAttractions[i]
      if (d) o.setHidden(d.id != null && d.id === hiddenAttractionId)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenAttractionId, filteredAttractions, mapReady, mapVersion])

  // resolveLabelCollisions:標籤避讓機制——2026-10 使用者實測回報「兩個
  // 景點標籤文字重疊」,之後再回報「縮圖還是被文字標籤覆蓋」「也都還是
  // 被小點蓋住」。我們自建的這套 HTML OverlayView 標籤沒有 Google 原生
  // POI 標籤內建的防重疊演算法,改用 getBoundingClientRect() 量測像素
  // 範圍,兩兩比對是否重疊。
  //
  // 避讓(誰被隱藏)與圖層(誰疊在上面)是兩件分開但互補的事,這裡兩者
  // 都要處理,缺一不可:
  // 1. 避讓:只有「標籤」可以被隱藏(見 setLabelHidden 的說明,圓點/
  //    縮圖本身必須維持可見可點擊,使用者明確要求過)。所以碰撞比對的
  //    「障礙物」範圍是每個景點的視覺元素(getVisualEl,縮圖/圓點)+
  //    標籤(getLabelEl)兩者合併——標籤若跟任何優先序更高(或排序
  //    在前)的障礙物(不論是對方的縮圖還是標籤)重疊,就隱藏自己的
  //    標籤。這是第一輪修正只比對「標籤跟標籤」時遺漏的情況:原本只有
  //    兩個標籤互相重疊才會觸發避讓,縮圖展開變大(56px)後跟鄰居標籤
  //    重疊、或縮圖跟縮圖重疊,完全沒被納入考慮。
  // 2. 圖層:縮圖跟縮圖重疊時,兩者都不能隱藏(避讓機制對縮圖不適用),
  //    只能靠 z-index 讓優先序高的疊在上面——這部分由 CSS 負責
  //    (ExploreMap.module.css 的 .geo-attraction-overlay-hovered 等
  //    規則,把 hovered/selected/candidate 狀態的縮圖與標籤 z-index
  //    一併拉高),這裡的 JS 碰撞偵測不處理視覺堆疊順序,只處理「標籤
  //    要不要顯示」這一件事,兩者分工不重疊。
  //
  // 觸發時機:地圖任何可能改變 overlay 位置或數量的操作都要重新計算——
  // mapRef 的 idle/bounds_changed/zoom_changed 原生事件涵蓋拖曳/縮放/
  // 任何程式呼叫 panTo/fitBounds 等操作結束後的最終穩定狀態(idle 是
  // Maps SDK 保證「這一輪所有重繪都已完成」的事件,比自己在每個 overlay
  // 的 draw() 裡個別回報更可靠,也不需要修改 getAttractionOverlayClass
  // 單例 class 的建構子簽名去塞一個 per-instance 回呼);filteredAttractions
  // 變動涵蓋 overlay 整批重建;selectedKey/hoverKey/candidateKeysToken/
  // hoveredCuratedId 變動涵蓋優先序本身改變(例如某個精選點被 hover
  // 後應該要贏過原本蓋住它標籤的鄰居)。用 requestAnimationFrame 節流
  // 而非直接同步執行——idle 等事件可能短時間內觸發多次,量測
  // getBoundingClientRect() 會強制瀏覽器同步 reflow,直接在每次事件裡都
  // 做一次會造成不必要的效能成本,節流成每個 frame 最多算一次。
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return

    let rafId: number | null = null
    function resolve() {
      rafId = null
      const overlays = overlaysRef.current
      // 依優先序由高到低排序——高優先序的先佔住位置,後面的只跟「已經
      // 確定顯示」的障礙物比對,不需要 O(n^2) 兩兩都比(一個標籤只要跟
      // 任何一個「贏過自己」的障礙物重疊,就該被隱藏;已經是最高優先序
      // 的彼此之間若也重疊,排在前面的視為「先到先得」,維持顯示)。
      const sorted = [...overlays].sort((a, b) => b.getLabelPriority() - a.getLabelPriority())
      // 寬高為 0 代表目前不可見(例如 display:none 的祖先容器)——不需要
      // 參與碰撞比對,也不應該被判定「重疊」而影響其他景點。isHidden()
      // 額外排除 setHidden(true) 收起的 overlay——這種情況是
      // visibility:hidden(不是 display:none,見 setHidden 的完整說明:
      // draw() 仍要持續更新 left/top),getBoundingClientRect() 寬高不會
      // 歸零,若不额外檢查 isHidden(),手機版 bottom sheet 開啟期間已經
      // 看不見的主題點仍會被當成障礙物,擠掉周邊精選點原本該正常顯示的
      // 標籤(2026-10 實測踩過)。
      function visibleRect(overlay: AttractionOverlayInstance, el: HTMLElement | null): DOMRect | null {
        if (!el || overlay.isHidden()) return null
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 ? rect : null
      }
      // 2026-10 修正:改成兩階段處理,不再邊登記邊比對——原本在同一個
      // for 迴圈裡,每個 overlay 自己的縮圖登記完就立刻拿目前為止已登記
      // 的障礙物去比對自己的標籤,若兩個 overlay 優先序相同,排在陣列
      // 後面的那個登記縮圖時,排在前面的那個標籤早已經比對完、來不及
      // 看到它,造成「同優先序時,先處理的標籤有機會被後處理的縮圖蓋住
      // 卻沒被偵測到」的漏洞(視覺上縮圖容器層級的 z-index 可能仍會蓋過
      // 標籤,但標籤避讓的判斷結果跟實際視覺層級對不上)。改成:第一階段
      // 收集所有(依優先序排序後)可見的縮圖/圓點(這些永遠不隱藏,見
      // 上方完整說明),第二階段才依序判斷每個標籤是否跟任何障礙物重疊
      // ——此時所有障礙物都已經到齊,不會有「晚到的看不到」的順序依賴。
      const visuals = sorted.map((overlay) => ({ overlay, rect: visibleRect(overlay, overlay.getVisualEl()) }))
      const obstacleRects: DOMRect[] = visuals.map((v) => v.rect).filter((r): r is DOMRect => r !== null)
      for (const { overlay, rect: visualRect } of visuals) {
        const labelRect = visibleRect(overlay, overlay.getLabelEl())
        if (!labelRect) continue
        // 標籤要先排除「跟自己的縮圖重疊」這個必然成立但不該算數的
        // 情況——每個景點的標籤本來就緊貼在自己的縮圖正下方(見
        // renderContent() 的 markup,margin-top: 6px 的間距通常不足以
        // 完全避開,尤其縮圖展開成 56px 時更明顯),若把自己的 visualRect
        // 也拿來比對,幾乎每個標籤都會被判定「重疊」而永遠隱藏。
        const othersRects = visualRect
          ? obstacleRects.filter((r) => r !== visualRect)
          : obstacleRects
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
  }, [mapReady, mapVersion, filteredAttractions, selectedKey, hoverKey, candidateKeysToken, hoveredCuratedId])

}
