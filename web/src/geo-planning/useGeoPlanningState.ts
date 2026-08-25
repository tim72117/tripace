import { useCallback, useMemo, useReducer, useState } from 'react'
import type { ClientConfig, GeoAttraction, GeoPlaceDetails, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../api'
import { deleteEntry } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import {
  poiInfoContent,
  candidateInfoContent,
  searchResultInfoContent,
} from './geoInfoContent'
import { type GeoCandidate, createEntryFromCandidate } from './geoCandidateHelpers'
import { geoSelectionReducer, GEO_SELECTION_NONE, type GeoPanTarget } from './geoSelection'

// useGeoPlanningState:桌面版(DesktopLayout.tsx)/手機版
// (GeoOutlinePhoneView.tsx)共用的「地理規劃地圖」狀態與互動邏輯——原本
// 兩邊各自實作一份形狀高度相似的 state/handler(geoSelection reducer、
// candidateKeys/addGeoCandidate/removeGeoCandidate/geoScheduledDates 的
// useMemo/useCallback、onTripEntriesChange 的候選籃合併邏輯、
// handleScheduleCandidate/handleReturnToCandidate/handleRemoveCandidate),
// 曾經因為各自維護而出現不一致(例如 onReturnToCandidate 一邊用穩定 id
// 比對、另一邊用物件參照比對;handleScheduleCandidate/
// handleReturnToCandidate/handleRemoveCandidate 都只有 console.error
// 前綴字串不同)。收斂到這裡統一實作,兩邊呼叫同一份邏輯,之後只需要改
// 一處。
//
// 平台差異的處理方式:這個 hook 回傳「聯集」——桌面版才用得到的部分
// (pickingDayKey/onlyGeoCandidate/draggingCandidate/geoHoverKey,見各自
// 欄位的說明,理由是桌面版有第二張浮動側欄 AddFromCandidateSidebar、
// 手機版候選籃合併成單一抽屜元件不需要這些中介 state)手機版呼叫端
// 單純不解構、不使用即可,不需要在這個 hook 內部用 platform 參數做條件
// 判斷——那樣反而會讓這個 hook 內部長出兩條分支邏輯,增加閱讀與測試
// 的心智負擔,不如讓「回傳值裡有哪些東西」直接反映「支援哪些功能」,
// 呼叫端各自取用自己要的子集合。
//
// onSelectGeocodeCandidate 的統一決策:桌面版原本走
// geoGeocodeCandidateSelect 中介 state,讓 GeoOutlinePanel 內部重新執行
// 完整的 handleGeocodeCandidateSelect(含 suppressQuery:false、重新查詢
// 新範圍的景點/飯店資料),跟直接點地圖上的 candidate marker 行為一致;
// 手機版原本繞過這條路徑,直接 dispatch + setPanTarget,不會重新查詢
// ——這是先前發現的真實行為不一致(桌面版清單點候選會更新附近景點/
// 飯店資料,手機版不會),已決議統一成桌面版的完整查詢行為,故這個 hook
// 也回傳 geocodeCandidateSelect state 供兩邊 GeoOutlinePanel 的
// externalGeocodeCandidateSelect prop 使用,不提供直接 dispatch 的簡化
// 版本。
export function useGeoPlanningState({
  cfg,
  tripID,
}: {
  cfg: ClientConfig
  // tripID:寫入 entry 用(createEntryFromCandidate)——理由同
  // DesktopLayout.tsx/GeoOutlinePhoneView.tsx 原本個別持有的 activeTrip?.id。
  tripID?: string | null
}) {
  // geoSelection:目前選中要顯示哪張卡片(GeoInfoPanel/AttractionInfoPanel,
  // 或手機版對應的 GeoOutlinePhoneInfoSheet)與哪個識別鍵該標記選取樣式
  // ——見 geo-planning/geoSelection.ts 的完整說明。
  const [geoSelection, dispatchGeoSelection] = useReducer(geoSelectionReducer, GEO_SELECTION_NONE)
  const selectedKey: GeoSelectedKey =
    geoSelection.kind === 'attraction' || geoSelection.kind === 'info' ? (geoSelection.key ?? null) : null
  const infoContent = geoSelection.kind === 'info' ? geoSelection.content : null
  const attractionContent = geoSelection.kind === 'attraction' ? geoSelection.data : null

  // geoPanTarget:候選籃/清單點擊/探索周邊要移動地圖到的目標——見
  // geo-planning/geoSelection.ts 的 GeoPanTarget 型別說明。
  const [panTarget, setPanTarget] = useState<GeoPanTarget | null>(null)

  // geoHoverKey:滑鼠移到側欄項目上時的臨時識別鍵(見 GeoOutlineMap.tsx
  // 的 hoverKey prop 說明)——只有桌面版側欄(GeoHotelSidebar/
  // GeoCandidateSidebar)支援滑鼠 hover,手機版觸控裝置沒有這個互動,
  // 呼叫端不使用即可。
  const [hoverKey, setHoverKey] = useState<GeoSelectedKey>(null)

  // geoCandidates/geoCandidateKeys/addGeoCandidate/removeGeoCandidate/
  // geoScheduledDates:候選籃資料流——理由見各自函式的說明,兩邊完全
  //共用同一份去重規則/分組邏輯。
  const [candidates, setCandidates] = useState<GeoCandidate[]>([])
  const candidateKeys = useMemo(
    () =>
      new Set(
        candidates
          .filter((c): c is Extract<GeoCandidate, { kind: 'hotel' | 'attraction' | 'place' }> => c.kind !== 'entry')
          .map((c) => geoItemKey(c.kind, c)),
      ),
    [candidates],
  )
  const addCandidate = useCallback((c: GeoCandidate) => {
    setCandidates((prev) =>
      prev.some((p) => p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)
        ? prev
        : [...prev, c],
    )
  }, [])
  // removeCandidate:「×」按鈕觸發,純前端從 candidates 移除——entry 類型
  // 一定要用穩定的 id 比對,不能沿用 hotel/place/attraction 這幾種沒有
  // id、只能靠「名稱+座標」辨識身分的候選共用的比對條件。理由:使用者
  // 明確要求「同一個地點可以排入行程多次」(例如同一景點在不同天各去
  // 一次),這種情況下會出現多筆 kind/name/lat/lng 完全相同、但 id 不同
  // 的 entry 候選——若沿用「名稱+座標」比對,刪除其中任何一筆會被誤判
  // 成同時符合刪除條件的全部都要移除,實際發生過的 bug:使用者點刪除
  // 其中一筆,畫面上這個地點的全部項目(即使後端只有那一筆真的被
  // deleteEntry 刪除)瞬間一起消失。entry 類型比對 id;其餘沒有 id 的
  // 候選類型維持原本「名稱+座標」比對(hotel/place/attraction 本來就
  // 不該同一個地點出現兩筆重複候選,addCandidate 的去重邏輯已經擋掉)。
  const removeCandidate = useCallback((c: GeoCandidate) => {
    setCandidates((prev) =>
      prev.filter((p) =>
        c.kind === 'entry' && p.kind === 'entry'
          ? p.id !== c.id
          : !(p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng),
      ),
    )
  }, [])
  const scheduledDates = useMemo(
    () =>
      Array.from(
        new Set(
          candidates
            .filter((c): c is GeoCandidate & { kind: 'entry'; inTrip: true } => c.kind === 'entry' && c.inTrip && !!c.start)
            .map((c) => c.start as string),
        ),
      ).sort(),
    [candidates],
  )

  // refetchTripEntriesTrigger:每次遞增觸發 GeoOutlinePanel 重新查一次
  // tripEntries——理由見 GeoOutlinePanel.tsx 的 refetchTripEntriesTrigger
  // prop 說明,補上日期後用來讓候選籃「已排入行程」分組即時反映新日期。
  const [refetchTripEntriesTrigger, setRefetchTripEntriesTrigger] = useState(0)

  // onTripEntriesChange:行程本身已有座標的 entry 自動併入候選籃——
  // 兩邊原本逐字相同的合併邏輯(見各自檔案曾經的說明),包含「這批新的
  // entries 一律直接覆蓋掉同 id 的舊候選,而非只在 id 不存在時才新增」
  // 這個曾經修過的真實 bug(舊寫法會讓補日期後畫面繼續顯示舊的 start,
  // 看起來像沒生效)。
  const onTripEntriesChange = useCallback((entries: GeoTripEntry[]) => {
    setCandidates((prev) => {
      const keptCandidates = prev.filter((p) => !(p.kind === 'entry' && p.inTrip))
      const freshEntries = entries.map((e): GeoCandidate => ({
        ...e,
        kind: 'entry',
        inTrip: true,
        entryKind: e.kind,
      }))
      return [...keptCandidates, ...freshEntries]
    })
  }, [])

  // onReturnToCandidate:候選籃「已排入行程」項目按「返回候選」——用
  // 穩定的 id 比對(而非物件參照相等),理由:呼叫端傳入的候選物件不一定
  // 是目前 candidates 陣列裡當下那個物件的同一參照(例如經過展開/複製),
  // 物件參照比對在這種情況下會靜默失敗、選中項目不會真的返回候選——這
  // 是先前手機版 GeoOutlinePhoneCandidateDrawer 用 `p === c` 比對時的
  // 實際風險,統一改用跟桌面版一致的 id 比對後不再有這個問題。
  const onReturnToCandidate = useCallback((c: GeoCandidate & { kind: 'entry' }) => {
    setCandidates((prev) =>
      prev.map((p) => (p.kind === 'entry' && p.id === c.id ? { ...p, inTrip: false } : p)),
    )
  }, [])

  // handleReturnToCandidate:「返回候選」按鈕觸發——先呼叫 api.deleteEntry
  // 真的把後端那筆 entry 刪除(不像 removeCandidate 只從前端候選籃清單
  // 移除、後端資料仍在),成功後呼叫 onReturnToCandidate 把這個物件的
  // inTrip 改成 false、繼續留在 candidates 裡。刪除失敗不彈錯誤訊息打斷
  // 瀏覽,理由同其餘拖放/日期寫入失敗的既有處理方式,印 console 供除錯
  // 即可,使用者可以再按一次重試。logTag 參數化,理由同
  // handleScheduleCandidate。
  const handleReturnToCandidate = useCallback(async (c: GeoCandidate & { kind: 'entry' }, logTag: string) => {
    try {
      await deleteEntry(cfg, c.id)
      onReturnToCandidate(c)
    } catch (err) {
      console.error(`[${logTag}] 返回候選失敗:`, err)
    }
  }, [cfg, onReturnToCandidate])

  // handleRemoveCandidate:「×」按鈕觸發——真正已排入行程的項目
  // (kind==='entry' && inTrip===true)點「×」時,要先呼叫 api.deleteEntry
  // 把後端那筆 entry 真的刪除,成功才呼叫 removeCandidate 讓上游把它從
  // candidates 移除;過去「×」對這種項目只從前端畫面移除、完全沒動後端
  // 資料,重新整理頁面或任何情境觸發 onTripEntriesChange 重新查詢時,
  // 這筆資料會重新出現在候選籃,使用者會誤以為「刪除」沒有生效(實際
  // 發生過的 bug)。其餘情況(候選中的 hotel/attraction/place,或
  // inTrip===false 的 entry——後端那筆已經在先前「返回候選」時被刪除,
  // 這裡沒有東西可刪)本來就沒有對應的後端資料,維持原本「只從前端移除」
  // 的行為,不需要呼叫任何 API。刪除失敗時不從前端移除(避免畫面顯示跟
  // 後端狀態不一致),只印 console 供除錯,使用者可以再按一次重試。
  const handleRemoveCandidate = useCallback(async (c: GeoCandidate, logTag: string) => {
    if (c.kind === 'entry' && c.inTrip) {
      try {
        await deleteEntry(cfg, c.id)
      } catch (err) {
        console.error(`[${logTag}] 刪除已排入行程項目失敗:`, err)
        return
      }
    }
    removeCandidate(c)
  }, [cfg, removeCandidate])

  // handleScheduleCandidate:候選沒有排定日期、選好日期後觸發——把候選
  // 建立成真正的行程 entry。兩邊原本只有 console.error 的前綴字串不同,
  // 改成參數化的 logTag,呼叫端各自傳入慣用的識別字串。
  const handleScheduleCandidate = useCallback(async (c: GeoCandidate, date: string, logTag: string) => {
    if (!tripID) return
    try {
      await createEntryFromCandidate(cfg, tripID, c, date)
      setRefetchTripEntriesTrigger((n) => n + 1)
    } catch (err) {
      console.error(`[${logTag}] 加入行程(選定日期)失敗:`, err)
    }
  }, [tripID, cfg])

  // searchResultSelect:清單點擊飯店/推薦地點/搜尋結果項目時設值,原封
  // 不動傳給 GeoOutlinePanel 的 externalGeocodeCandidateSelect prop 邏輯
  // ——不能直接 dispatch+setPanTarget(那樣會跳過 GeoOutlinePanel 內部
  // handleGeocodeCandidateSelect 的 suppressQuery:false/重新查詢新範圍
  // 景點飯店資料的完整流程),兩邊清單點擊都必須走這條路徑,理由見本檔案
  // 開頭「onSelectGeocodeCandidate 的統一決策」的完整說明——這個決策現在
  // 對飯店/推薦地點/搜尋結果三者一視同仁,不再只限 geocode 類型。
  const [searchResultSelect, setSearchResultSelect] = useState<GeoSearchResult | null>(null)
  const selectSearchResultFromList = useCallback((r: GeoSearchResult) => {
    setSearchResultSelect({ ...r })
  }, [])

  // searchResults/setSearchResults:飯店/推薦地點/搜尋結果三種來源統一後
  // 的清單資料——見 GeoOutlineMap.tsx 的 onSearchResultsChange prop 說明,
  // 取代原本各自獨立的 hotels/places/geocodeCandidates 三組 state。
  const [searchResults, setSearchResults] = useState<GeoSearchResult[]>([])

  // selectAttraction/selectSearchResult/selectPoi(地圖直接點擊/
  // GeoOutlinePanel 回呼版本):GeoOutlinePanel 的
  // onAttractionSelect/onSearchResultSelect/onPoiSelect 直接呼叫的版本
  // ——這一組是「地圖上直接點擊 marker/POI」的入口,跟上面
  // selectSearchResultFromList(側欄清單點擊)不同層級:地圖 marker 點擊
  // 本身已經在 GeoOutlinePanel 內部完整處理過查詢流程,這裡只需要
  // dispatch 更新要顯示的卡片內容,不需要再中介一次。
  const selectAttraction = useCallback((a: GeoAttraction) => {
    dispatchGeoSelection({ type: 'SELECT_ATTRACTION', key: geoItemKey('attraction', a), data: a })
  }, [])
  const selectSearchResult = useCallback((r: GeoSearchResult) => {
    dispatchGeoSelection({ type: 'SELECT_INFO', key: geoItemKey(r.kind, r), content: searchResultInfoContent(r) })
  }, [])
  const selectPoi = useCallback((details: GeoPlaceDetails) => {
    // 刻意不帶 key——沒有對應的自建 hotel/place/attraction 資料,沒有
    // 側欄清單項目需要同步標記選取樣式,理由見 GeoSelection 型別的說明。
    dispatchGeoSelection({ type: 'SELECT_INFO', content: poiInfoContent(details) })
  }, [])
  const patchGeocodeCandidateText = useCallback((text: GeoPlaceText) => {
    // 文字通常先回來,用 poiInfoContent 的形狀升級成完整文字版本(名稱/
    // 地址/評分/簡介),但不動 photoUrl(可能還沒查完,也可能是另一支
    // 請求已經先回來設好的值)。不需要比對 placeId 是否還對應目前顯示
    // 的卡片——GeoOutlinePanel.tsx 內部已經用 useEffect + cancelled flag
    // 保護過這個競態,只要這個 callback 被呼叫,保證是目前有效的候選。
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, ...poiInfoContent({ ...text, photoUrl: prev.photoUrl }) }),
    })
  }, [])
  const patchGeocodeCandidatePhoto = useCallback((photoUrl: string | null) => {
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => ({ ...prev, photoUrl: photoUrl ?? undefined }),
    })
  }, [])

  // selectCandidateFromBasket:候選籃/清單抽屜裡任何一項被點擊——開資訊
  // 卡並移動地圖到該點為中心(見兩邊原本 selectGeoCandidate/onSelect 的
  // 說明,呼叫端要求候選相關清單點擊要有移動地圖的行為,跟純瀏覽清單
  // 只開資訊卡不移動地圖不同)。attraction 沒有候選籃入口,呼叫端理應
  // 不會傳入 kind==='attraction' 的候選,這裡仍保留防呆直接忽略。
  const selectCandidateFromBasket = useCallback((c: GeoCandidate) => {
    if (c.kind === 'attraction') return
    dispatchGeoSelection({
      type: 'SELECT_INFO',
      key: c.kind === 'entry' ? null : geoItemKey(c.kind, c),
      content: candidateInfoContent(c),
    })
    setPanTarget({ lat: c.lat, lng: c.lng })
  }, [])

  const clearSelection = useCallback(() => {
    dispatchGeoSelection({ type: 'CLEAR' })
  }, [])

  // pickingDayKey/onlyCandidates/draggingCandidate:桌面版第二張浮動側欄
  // (AddFromCandidateSidebar)專用的中介 state——手機版候選籃合併成
  // 單一抽屜元件,「候選中」清單直接由抽屜元件自己用 candidates prop
  // 篩出,不需要這些,呼叫端不解構即可(見本檔案開頭「平台差異的處理
  // 方式」的說明)。
  const [pickingDayKey, setPickingDayKey] = useState<string | null>(null)
  const onlyCandidates = useMemo(
    () => candidates.filter((c) => !(c.kind === 'entry' && c.inTrip)),
    [candidates],
  )
  const [draggingCandidate, setDraggingCandidate] = useState<GeoCandidate | null>(null)
  const handlePickFromCandidate = useCallback(async (c: GeoCandidate) => {
    if (!pickingDayKey || !tripID) return
    try {
      await createEntryFromCandidate(cfg, tripID, c, pickingDayKey)
      setCandidates((prev) =>
        prev.filter((p) => !(p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)),
      )
      setRefetchTripEntriesTrigger((n) => n + 1)
    } catch (err) {
      console.error('[useGeoPlanningState] 從候選加入失敗:', err)
    }
  }, [pickingDayKey, tripID, cfg])

  return {
    // 選取狀態
    selectedKey,
    infoContent,
    attractionContent,
    dispatchGeoSelection,
    clearSelection,
    selectAttraction,
    selectSearchResult,
    selectPoi,
    patchGeocodeCandidateText,
    patchGeocodeCandidatePhoto,
    // 地圖移動目標
    panTarget,
    setPanTarget,
    // hover(僅桌面版使用)
    hoverKey,
    setHoverKey,
    // 候選籃
    candidates,
    setCandidates,
    candidateKeys,
    addCandidate,
    removeCandidate,
    scheduledDates,
    onTripEntriesChange,
    onReturnToCandidate,
    handleReturnToCandidate,
    handleRemoveCandidate,
    handleScheduleCandidate,
    selectCandidateFromBasket,
    // 飯店/推薦地點/搜尋結果統一後的清單
    searchResults,
    setSearchResults,
    searchResultSelect,
    selectSearchResultFromList,
    // 行程 entry 重新查詢觸發
    refetchTripEntriesTrigger,
    setRefetchTripEntriesTrigger,
    // 第二側欄相關(僅桌面版使用)
    pickingDayKey,
    setPickingDayKey,
    onlyCandidates,
    draggingCandidate,
    setDraggingCandidate,
    handlePickFromCandidate,
  }
}
