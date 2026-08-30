import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoPlaceDetails, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../api'
import { deleteEntry, fetchGeoPlacePhoto, geocodeCandidateToSearchResult } from '../api'
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

  // geocodeCandidates/setGeocodeCandidates:2026-08 從 GeoOutlinePanel.tsx
  // 搬遷到這裡——原本是那個檔案的私有 state,但「手機版清單抽屜關閉時
  // 連動清空地圖 marker」這個需求的觸發點(GeoOutlinePhoneView.tsx 的
  // GeoOutlinePhoneListDrawer.onClose)活在比 GeoOutlinePanel 更外層,沒
  // 辦法碰到它內部的 state,只能把擁有權移到這個兩邊(桌面版/手機版)
  // 共用的狀態層,讓外層能直接呼叫 setter 清空。搬遷後 GeoOutlinePanel.tsx
  // 改為受控元件,經由 geocodeCandidates/setGeocodeCandidates props 讀寫
  // 這裡,語意/呼叫位置與原本完全相同(城市搜尋框查詢完成/類別標籤搜尋
  // 完成寫入、搜尋框文字清空時連動清空),只是「setState」換成「呼叫傳入
  // 的 setter」——見 GeoOutlinePanel.tsx 對應 prop 的完整說明,那裡有這份
  // state 更完整的背景(三個查詢入口共用、為什麼點擊候選後不清空等)。
  const [geocodeCandidates, setGeocodeCandidates] = useState<GeoGeocodeCandidate[]>([])
  // selectedCandidate/setSelectedCandidate:同上,一併從 GeoOutlinePanel.tsx
  // 搬過來——這份 state 驅動候選選定後平行補查文字/照片的 effect(仍然
  // 留在 GeoOutlinePanel.tsx 內,只是讀寫的 state 改成 props),跟
  // geocodeCandidates 概念上獨立但生命週期緊密相關(見該檔案原本的
  // 說明),搬遷時一併搬移,避免兩者分屬不同層造成日後維護時各自為政。
  const [selectedCandidate, setSelectedCandidate] = useState<GeoSearchResult | null>(null)

  // searchResults:飯店/推薦地點/搜尋結果三種來源統一後的清單資料——見
  // GeoOutlineMap.tsx 的 onSearchResultsChange prop 說明,取代原本各自
  // 獨立的 hotels/places/geocodeCandidates 三組 state。
  //
  // 2026-08 起改成用 useMemo 從上面的 geocodeCandidates 衍生,不再是獨立
  // 手動同步的 state——搬遷 geocodeCandidates 到這一層之前,兩者是分開
  // 維護的:GeoOutlinePanel.tsx 在城市搜尋框查詢完成、onGeocodeCandidatesChange
  // 兩處各自手動呼叫 setGeocodeCandidates 與 onSearchResultsChange(内部
  // 呼叫這裡的 setSearchResults),靠人工保證兩處呼叫永遠成對出現。確認
  // 過 onSearchResultsChange 在整個程式碼庫裡只有這兩處呼叫,且每次呼叫
  // 傳入的值都固定是 geocodeCandidates.map(geocodeCandidateToSearchResult)
  // ——也就是說 searchResults 從來就是 geocodeCandidates 的純轉型鏡像,
  // 不曾有過其他寫入路徑或額外資料,故改成 useMemo 衍生是安全的簡化,不
  // 是冒險的行為變更。
  //
  // 注意這裡刻意「不」用一個觀察 geocodeCandidates 變化的 useEffect 去算
  // searchResults 再 setState——直接用 useMemo 同步衍生,理由是這個專案
  // 先前吃過 level-triggered useEffect 的虧(見 GeoOutlinePanel.tsx/
  // GeoOutlineMap.tsx 對 edge-triggered 設計的完整說明):useMemo 只是
  // 「讀取時算一次值」,不是額外一個會在任何寫入 geocodeCandidates 的
  // 時機被誤觸發的副作用,不會重新引入同一類 bug。
  const searchResults = useMemo(
    () => geocodeCandidates.map(geocodeCandidateToSearchResult),
    [geocodeCandidates],
  )

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
  // patchGeocodeCandidateText/patchGeocodeCandidatePhoto 的 placeId 二次
  // 確認:原本只依賴 GeoOutlinePanel.tsx 的 useEffect + cancelled flag
  // 當唯一防線(呼叫端的 onGeocodeCandidateText/onGeocodeCandidatePhoto
  // callback 簽章雖然帶 placeId 參數,但兩個呼叫端(GeoOutlinePhoneView.tsx/
  // DesktopLayout.tsx)先前都用 `_placeId` 忽略未傳入)——這是單點防禦,
  // 不是縱深防禦:一旦 cancelled flag 邏輯本身有 bug(或未來新增一條
  // 繞過那個 effect、直接呼叫這兩個函式的路徑),連續快速點擊兩個不同
  // 候選(例如地圖上先點 A marker、還沒等文字/照片查完就點 B marker)時,
  // A 的查詢結果就可能在 B 已經顯示之後才回來、誤蓋掉 B 卡片的內容。
  // 這裡補上跟下方 infoContentPhotoFetch(同檔案,推薦地點資訊卡的照片
  // 補查)一致的雙重確認模式:patch 內部比對 prev.placeId !== placeId
  // 才套用,即使呼叫端的 cancelled flag 意外失效,這裡仍是最後一道防線。
  const patchGeocodeCandidateText = useCallback((placeId: string, text: GeoPlaceText) => {
    // 文字通常先回來,用 poiInfoContent 的形狀升級成完整文字版本(名稱/
    // 地址/評分/簡介),但不動 photoUrl(可能還沒查完,也可能是另一支
    // 請求已經先回來設好的值)。
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) =>
        prev.placeId !== placeId ? prev : { ...prev, ...poiInfoContent({ ...text, photoUrl: prev.photoUrl }) },
    })
  }, [])
  const patchGeocodeCandidatePhoto = useCallback((placeId: string, photoUrl: string | null) => {
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => (prev.placeId !== placeId ? prev : { ...prev, photoUrl: photoUrl ?? undefined }),
    })
  }, [])

  // infoContentPhotoFetch:推薦地點(GeoGeocodeCandidate)資訊卡開啟時的
  // 照片延遲補查——這支查詢不帶 eager photoUrl(後端照片查詢改成背景
  // 預熱快取,見 server 端 handleGeoPlacesNearby 的說明),這張卡片
  // (GeoInfoPanel/GeoOutlinePhoneInfoSheet)本身是純展示元件、沒有
  // IntersectionObserver 延遲載入機制(不像 GeoListItemCard,理由是資訊
  // 卡一開啟就整張可見,不需要捲動觸發的節流),故改在這裡用 useEffect
  // 主動補查一次。
  //
  // 條件:content.placeId 有值(見 GeoInfoContent.placeId 的完整說明,
  // 只有 place 來源才有)且 photoUrl 目前是 undefined(還沒查過)。用
  // fetchedPlaceIdsRef 記錄「這個 placeId 已經查過」(不論查到與否),
  // 避免同一張卡片因為其他欄位變動重新渲染時重複觸發查詢,也避免查到
  // 「沒有照片」的結果後,因為 photoUrl 維持 undefined 而無限重查。
  //
  // 競態保護:用 cancelled flag(同 GeoOutlinePanel.tsx 既有的
  // selectedCandidate effect 手法)——使用者若在查詢完成前已經切換到
  // 另一張卡片,查詢結果不應該誤植到新卡片上;patch 內部再用 placeId
  // 比對目前實際顯示的卡片(而非只靠 cancelled flag)雙重確認,理由同
  // patchGeocodeCandidatePhoto 系列 callback 一貫的保守寫法。
  const fetchedPlaceIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const placeId = infoContent?.placeId
    if (!placeId || infoContent.photoUrl !== undefined) return
    if (fetchedPlaceIdsRef.current.has(placeId)) return
    fetchedPlaceIdsRef.current.add(placeId)
    let cancelled = false
    fetchGeoPlacePhoto(cfg, placeId, infoContent.name)
      .then((result) => {
        if (cancelled) return
        dispatchGeoSelection({
          type: 'PATCH_INFO_CONTENT',
          patch: (prev) => (prev.placeId !== placeId ? prev : { ...prev, photoUrl: result.photoUrl ?? undefined }),
        })
      })
      .catch(() => {
        // 查詢失敗不視為錯誤,維持無圖——理由同這個檔案其餘查詢失敗的
        // 既有慣例,靜默處理即可,使用者不會因此看到任何錯誤訊息。
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoContent?.placeId, infoContent?.photoUrl, cfg])

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
    // 搜尋結果原始資料(geocode 查詢的唯一資料來源)——見上方宣告處的
    // 完整說明,搬遷自 GeoOutlinePanel.tsx。
    geocodeCandidates,
    setGeocodeCandidates,
    selectedCandidate,
    setSelectedCandidate,
    // 飯店/推薦地點/搜尋結果統一後的清單——現在是 geocodeCandidates 的
    // 衍生值(見上方 useMemo 的說明),不再提供 setSearchResults:任何想
    // 清空/改變搜尋結果的呼叫端都應該改動 geocodeCandidates(唯一資料
    // 來源),而不是繞過它直接改這份鏡像——那樣會讓兩者不同步。
    searchResults,
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
