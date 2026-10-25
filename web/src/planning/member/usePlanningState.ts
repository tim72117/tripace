import { requirePlacePhoto, requirePlaceText, type PlanAiDataSource } from '../data/source'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoPlaceDetails, GeoPlaceText, GeoSearchResult, GeoTripEntry } from '../../api'
import { deleteEntry, geocodeCandidateToSearchResult } from '../../api'
import { itemKey, type GeoSelectedKey } from '../explore/selectedKey'
import type { PlaceInfoContent } from '../place/PlacePanel'
import {
  poiInfoContent,
  candidateInfoContent,
  searchResultInfoContent,
} from '../place/infoContent'
import { type GeoCandidate, createEntryFromCandidate } from '../place/candidateHelpers'
import { selectionReducer, GEO_SELECTION_NONE, type GeoPanTarget } from '../explore/selection'

// usePlanningState:桌面版(planning/member/desktop/Content.tsx)/手機版
// (PlanPhoneView.tsx)共用的「地理規劃地圖」狀態與互動邏輯——原本
// 兩邊各自實作一份形狀高度相似的 state/handler(選取 reducer(explore/selection.ts)、
// candidateKeys/addGeoCandidate/removeGeoCandidate/geoScheduledDates 的
// useMemo/useCallback、onTripEntriesChange 的候選籃合併邏輯、
// handleScheduleCandidate/handleRemoveCandidate),曾經因為各自維護而
// 出現不一致(例如 handleScheduleCandidate/handleRemoveCandidate 只有
// console.error 前綴字串不同)。收斂到這裡統一實作,兩邊呼叫同一份
// 邏輯,之後只需要改一處。
//
// 2026-10 修正:移除 onReturnToCandidate/handleReturnToCandidate(「返回
// 候選」功能)——使用者明確要求拿掉這個操作,連同桌面版/手機版對應的
// UI 按鈕一併移除。
//
// 平台差異的處理方式:這個 hook 回傳「聯集」——桌面版才用得到的部分
// (draggingCandidate/geoHoverKey,見各自欄位的說明,理由是桌面版支援
// 側欄項目 hover 高亮與拖放改期,手機版候選籃合併成單一抽屜元件不需要
// 這些中介 state)手機版呼叫端單純不解構、不使用即可,不需要在這個
// hook 內部用 platform 參數做條件判斷——那樣反而會讓這個 hook 內部長出
// 兩條分支邏輯,增加閱讀與測試的心智負擔,不如讓「回傳值裡有哪些東西」
// 直接反映「支援哪些功能」,呼叫端各自取用自己要的子集合。
//
// onSelectGeocodeCandidate 的統一決策:桌面版原本走
// geoGeocodeCandidateSelect 中介 state,讓地圖資料邏輯(現在是 useMapState.ts)重新執行
// 完整的 handleGeocodeCandidateSelect(含 suppressQuery:false、重新查詢
// 新範圍的景點/飯店資料),跟直接點地圖上的 candidate marker 行為一致;
// 手機版原本繞過這條路徑,直接 dispatch + setPanTarget,不會重新查詢
// ——這是先前發現的真實行為不一致(桌面版清單點候選會更新附近景點/
// 飯店資料,手機版不會),已決議統一成桌面版的完整查詢行為,故這個 hook
// 也回傳 searchResultSelect state 供兩邊 useMapState 的
// externalGeocodeCandidateSelect 參數使用,不提供直接 dispatch 的簡化
// 版本。
// PlaceInfoMemory:同一個資料存取層內,以 placeId 記住「已經查到的地點文字與
// 照片」,並讓同一個 placeId 的進行中請求共用同一個 Promise(2026-10)。
//
// 為什麼放在 hook 裡而不是資料存取層(data/api.ts)的模組層去重:重開卡片時
// 要「同步」把已查到的簡介/照片帶回卡片內容(開卡當下就不是骨架/掃光),這
// 需要同步讀取已記住的結果;資料存取層介面只有回傳 Promise 的方法,模組層
// 去重只能省請求、省不了那一格骨架。實例跟著 dataSource 換(useMemo),登入
// 身分改變不會讀到上一個身分的結果。
//
// 記憶規則(對齊 data/dedupe.ts 的原則):
// - 進行中共用:同一個 placeId 同時只發一個請求(也擋掉 StrictMode 開發模式
//   effect 跑兩次的重複請求)。settle 後立刻移除。
// - 只記「有內容」的成功結果:文字要有簡介或評分、照片要真的有網址。失敗
//   與空結果不記——失敗要能重開重試;沒照片可能是後端還在背景補,下次再查
//   可能就有。
// - 上限 PLACE_INFO_MEMORY_MAX 筆,超過淘汰最舊的;不設 TTL——頁面存活期間
//   同一地點的簡介/評分/照片不會變到需要重查。
const PLACE_INFO_MEMORY_MAX = 100

interface PlaceInfoMemory {
  text: Map<string, GeoPlaceText>
  textInflight: Map<string, Promise<GeoPlaceText>>
  photo: Map<string, string>
  photoInflight: Map<string, Promise<string | null>>
}

function createPlaceInfoMemory(): PlaceInfoMemory {
  return { text: new Map(), textInflight: new Map(), photo: new Map(), photoInflight: new Map() }
}

function rememberBounded<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key)
  map.set(key, value)
  while (map.size > PLACE_INFO_MEMORY_MAX) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

// sharedFetch:進行中共用 + 成功且 shouldRemember 才記憶,失敗原樣往上拋。
function sharedFetch<V>(
  inflight: Map<string, Promise<V>>,
  done: Map<string, V>,
  key: string,
  fetcher: () => Promise<V>,
  shouldRemember: (v: V) => boolean,
): Promise<V> {
  const pending = inflight.get(key)
  if (pending) return pending
  const p = fetcher().then(
    (value) => {
      if (inflight.get(key) === p) inflight.delete(key)
      if (shouldRemember(value)) rememberBounded(done, key, value)
      return value
    },
    (err) => {
      if (inflight.get(key) === p) inflight.delete(key)
      throw err
    },
  )
  inflight.set(key, p)
  return p
}

// textPatchOf:文字查詢結果只補簡介與評分徽章(沿用 poiInfoContent 的組裝
// 規則),名稱/地址/candidate/照片維持開卡時的值——見 patchGeocodeCandidateText 的說明。
function textPatchOf(text: GeoPlaceText): Pick<PlaceInfoContent, 'summary' | 'badges'> {
  const { summary, badges } = poiInfoContent(text)
  return { summary, badges }
}

function hasTextContent(text: GeoPlaceText): boolean {
  return !!text.summary || text.rating != null
}

export function usePlanningState({
  cfg,
  dataSource,
  tripID,
}: {
  // cfg:建立/刪除 entry 用;查照片走 dataSource(資料存取層實例)。
  cfg: ClientConfig
  dataSource: PlanAiDataSource
  // tripID:寫入 entry 用(createEntryFromCandidate)——理由同
  // planning/member/desktop/Content.tsx/PlanPhoneView.tsx 原本個別持有的 activeTrip?.id。
  tripID?: string | null
}) {
  // geoSelection:目前選中要顯示哪張卡片(PlacePanel/AttractionInfoPanel,
  // 或手機版對應的 PlanPhoneInfoSheet)與哪個識別鍵該標記選取樣式
  // ——見 planning/explore/selection.ts 的完整說明。
  const [geoSelection, dispatchGeoSelection] = useReducer(selectionReducer, GEO_SELECTION_NONE)
  const selectedKey: GeoSelectedKey =
    geoSelection.kind === 'attraction' || geoSelection.kind === 'info' ? (geoSelection.key ?? null) : null
  const infoContent = geoSelection.kind === 'info' ? geoSelection.content : null
  const attractionContent = geoSelection.kind === 'attraction' ? geoSelection.data : null

  // placeInfoMemory/hydrateContent:開卡時先用已記住的文字與照片補齊卡片內容
  // (見上方 PlaceInfoMemory 的說明)——同一地點重開時簡介、評分、照片當下就在,
  // 不再先退回骨架/掃光;資料存取層根本沒有實作 placeText/placePhoto(訪客版)
  // 時,把對應旗標直接清成 undefined,開卡第一個畫面就不出現永遠不會結束的骨架。
  // 只處理旗標仍是 'pending' 的欄位,同步帶齊內容的來源不受影響。
  const placeInfoMemory = useMemo(() => createPlaceInfoMemory(), [dataSource])
  const hydrateContent = useCallback(
    (c: PlaceInfoContent): PlaceInfoContent => {
      const placeId = c.placeId
      if (!placeId) return c
      let next = c
      if (c.textStatus === 'pending') {
        const text = placeInfoMemory.text.get(placeId)
        if (!dataSource.placeText) next = { ...next, textStatus: undefined }
        else if (text) next = { ...next, ...textPatchOf(text), textStatus: undefined }
      }
      if (c.photoStatus === 'pending') {
        const url = placeInfoMemory.photo.get(placeId)
        if (!dataSource.placePhoto) next = { ...next, photoStatus: undefined }
        else if (url) next = { ...next, photoUrl: url, photoStatus: undefined }
      }
      return next
    },
    [placeInfoMemory, dataSource],
  )

  // geoPanTarget:候選籃/清單點擊/探索周邊要移動地圖到的目標——見
  // planning/explore/selection.ts 的 GeoPanTarget 型別說明。
  const [panTarget, setPanTarget] = useState<GeoPanTarget | null>(null)

  // geoHoverKey:滑鼠移到側欄項目上時的臨時識別鍵(見 PlanMap.tsx
  // 的 hoverKey prop 說明)——只有桌面版側欄(planning/place/desktop/ResultList/
  // planning/place/desktop/CandidateList)支援滑鼠 hover,手機版觸控裝置沒有這個互動,
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
          .map((c) => itemKey(c.kind, c)),
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

  // refetchTripEntriesTrigger:每次遞增觸發 useMapState 重新查一次
  // tripEntries——見 useMapState.ts 的 refetchTripEntriesTrigger
  // 參數與對應 effect,補上日期後用來讓候選籃「已排入行程」分組即時反映新日期。
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
  // 不動傳給 useMapState 的 externalGeocodeCandidateSelect 參數
  // ——不能直接 dispatch+setPanTarget(那樣會跳過 useMapState 內部
  // handleGeocodeCandidateSelect 的 suppressQuery:false/重新查詢新範圍
  // 景點飯店資料的完整流程),兩邊清單點擊都必須走這條路徑,理由見本檔案
  // 開頭「onSelectGeocodeCandidate 的統一決策」的完整說明——這個決策現在
  // 對飯店/推薦地點/搜尋結果三者一視同仁,不再只限 geocode 類型。
  const [searchResultSelect, setSearchResultSelect] = useState<GeoSearchResult | null>(null)
  const selectSearchResultFromList = useCallback((r: GeoSearchResult) => {
    setSearchResultSelect({ ...r })
  }, [])

  // geocodeCandidates/setGeocodeCandidates:2026-08 從當時的 GeoOutlinePanel.tsx
  // (已退役)搬遷到這裡——原本是那個檔案的私有 state,但「手機版清單抽屜關閉時
  // 連動清空地圖 marker」這個需求的觸發點(PlanPhoneView.tsx 的
  // phone/ResultList.onClose)活在比它更外層,沒
  // 辦法碰到它內部的 state,只能把擁有權移到這個兩邊(桌面版/手機版)
  // 共用的狀態層,讓外層能直接呼叫 setter 清空。現在讀寫這份 state 的
  // 資料邏輯在 useMapState.ts(經 geocodeCandidates/setGeocodeCandidates 參數),
  // 語意/呼叫位置與原本相同(城市搜尋框查詢完成/類別標籤搜尋
  // 完成寫入、搜尋框文字清空時連動清空),只是「setState」換成「呼叫傳入
  // 的 setter」。
  const [geocodeCandidates, setGeocodeCandidates] = useState<GeoGeocodeCandidate[]>([])
  // selectedCandidate/setSelectedCandidate:同上,一併從當時的 GeoOutlinePanel.tsx
  // 搬過來——這份 state 驅動候選選定後平行補查文字/照片的 effect(現在在
  // useMapState.ts 內,讀寫的 state 由參數傳入),跟
  // geocodeCandidates 概念上獨立但生命週期緊密相關,搬遷時一併搬移,避免兩者分屬不同層造成日後維護時各自為政。
  const [selectedCandidate, setSelectedCandidate] = useState<GeoSearchResult | null>(null)

  // searchResults:飯店/推薦地點/搜尋結果三種來源統一後的清單資料——見
  // PlanMap.tsx 的 onSearchResultsChange prop 說明,取代原本各自
  // 獨立的 hotels/places/geocodeCandidates 三組 state。
  //
  // 2026-08 起改成用 useMemo 從上面的 geocodeCandidates 衍生,不再是獨立
  // 手動同步的 state——搬遷 geocodeCandidates 到這一層之前,兩者是分開
  // 維護的:當時的 GeoOutlinePanel.tsx 在城市搜尋框查詢完成、onGeocodeCandidatesChange
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
  // 先前吃過 level-triggered useEffect 的虧(見 PlanMap.tsx 對
  // edge-triggered 設計的完整說明):useMemo 只是
  // 「讀取時算一次值」,不是額外一個會在任何寫入 geocodeCandidates 的
  // 時機被誤觸發的副作用,不會重新引入同一類 bug。
  const searchResults = useMemo(
    () => geocodeCandidates.map(geocodeCandidateToSearchResult),
    [geocodeCandidates],
  )

  // selectAttraction/selectSearchResult/selectPoi(地圖直接點擊/
  // PlanMap 回呼版本):PlanMap 的 onAttractionSelect/onPoiSelect 與
  // useMapState 的 onSearchResultSelect 直接呼叫的版本
  // ——這一組是「地圖上直接點擊 marker/POI」的入口,跟上面
  // selectSearchResultFromList(側欄清單點擊)不同層級:地圖 marker 點擊
  // 本身已經在地圖那一側(PlanMap/useMapState)完整處理過查詢流程,這裡只需要
  // dispatch 更新要顯示的卡片內容,不需要再中介一次。
  const selectAttraction = useCallback((a: GeoAttraction) => {
    dispatchGeoSelection({ type: 'SELECT_ATTRACTION', key: itemKey('attraction', a), data: a })
  }, [])
  const selectSearchResult = useCallback((r: GeoSearchResult) => {
    dispatchGeoSelection({ type: 'SELECT_INFO', key: itemKey(r.kind, r), content: hydrateContent(searchResultInfoContent(r)) })
  }, [hydrateContent])
  // selectPoi 的第二參數 attraction:有值時代表這次點擊來源同時也是地圖
  // 上的景點區域地標(見 PlanMap.tsx 的 onAttractionOpenPlaceDetails
  // 完整說明),把 attraction.summary 附加到 PlaceInfoContent.attractionSummary
  // 上並存顯示(見 PlacePanel.tsx 對這個欄位的完整說明)——沒有主題卡
  // 開著、直接點擊非主題點地標退回這條互斥路徑時,同樣需要保留這份人工
  // 整理過的介紹文字,不能因為改走 selectPoi 就悄悄遺失。
  // selectPlaceContent:直接用呼叫端已經組好的 PlaceInfoContent 開地點卡
  // ——供沒有 GeoPlaceDetails 可查(如非主題點地標沒有 placeId、或查詢
  // 失敗)但仍要開地點卡的情境使用(見 planning/member/desktop/Content.tsx 的
  // handleAttractionOpenPlaceWithoutGoogle),不像 selectPoi 那樣強制要求
  // 先有一筆 GeoPlaceDetails 才能組出內容。selectPoi 內部改呼叫這支,
  // 避免兩處重複同一行 dispatch。
  const selectPlaceContent = useCallback((content: PlaceInfoContent) => {
    // 刻意不帶 key——沒有對應的自建 hotel/place/attraction 資料,沒有
    // 側欄清單項目需要同步標記選取樣式,理由見 GeoSelection 型別的說明。
    dispatchGeoSelection({ type: 'SELECT_INFO', content: hydrateContent(content) })
  }, [hydrateContent])
  // selectPoi 的第二參數 attraction:有值時代表這次點擊來源同時也是地圖
  // 上的景點區域地標(見 PlanMap.tsx 的 onAttractionOpenPlaceDetails
  // 完整說明),把 attraction.summary 附加到 PlaceInfoContent.attractionSummary
  // 上並存顯示(見 PlacePanel.tsx 對這個欄位的完整說明)——沒有主題卡
  // 開著、直接點擊非主題點地標退回這條互斥路徑時,同樣需要保留這份人工
  // 整理過的介紹文字,不能因為改走 selectPoi 就悄悄遺失。
  const selectPoi = useCallback((details: GeoPlaceDetails, attraction?: GeoAttraction) => {
    const content = poiInfoContent(details)
    if (attraction) content.attractionSummary = attraction.summary
    selectPlaceContent(content)
  }, [selectPlaceContent])
  // patchGeocodeCandidateText/patchGeocodeCandidatePhoto 的 placeId 二次
  // 確認:原本只依賴當時 GeoOutlinePanel.tsx(現在是 useMapState.ts)的 useEffect + cancelled flag
  // 當唯一防線(呼叫端的 onGeocodeCandidateText/onGeocodeCandidatePhoto
  // callback 簽章雖然帶 placeId 參數,但兩個呼叫端(PlanPhoneView.tsx/
  // planning/member/desktop/Content.tsx)先前都用 `_placeId` 忽略未傳入)——這是單點防禦,
  // 不是縱深防禦:一旦 cancelled flag 邏輯本身有 bug(或未來新增一條
  // 繞過那個 effect、直接呼叫這兩個函式的路徑),連續快速點擊兩個不同
  // 候選(例如地圖上先點 A marker、還沒等文字/照片查完就點 B marker)時,
  // A 的查詢結果就可能在 B 已經顯示之後才回來、誤蓋掉 B 卡片的內容。
  // 這裡補上跟下方 placePhotoFetch(同檔案,資訊卡的照片補查)一致的雙重確認模式:patch 內部比對 prev.placeId !== placeId
  // 才套用,即使呼叫端的 cancelled flag 意外失效,這裡仍是最後一道防線。
  const patchGeocodeCandidateText = useCallback((placeId: string, text: GeoPlaceText) => {
    // 文字查詢回來:只補簡介與評分徽章(沿用 poiInfoContent 的組裝規則),
    // 並把 textStatus 清成 undefined(查詢完成,見 PlaceInfoContent.textStatus)。
    // 名稱/地址/candidate/照片維持開卡時的值——2026-10 起不再整包展開
    // poiInfoContent:那會用 Places 文字查詢組出的簡化 candidate(沒有
    // placeId/primaryType)蓋掉搜尋結果原本較完整的 candidate,而候選籃
    // 項目(candidateInfoContent 刻意不帶 candidate,見該函式說明)也會因此
    // 冒出「加入候選」按鈕。
    //
    // 除了 placeId,也要求卡片的 textStatus 仍是 'pending'(2026-10 補上,與
    // markPlaceTextFailed 對稱):同一個 placeId 的卡片若已被換成同步就帶齊文字
    // 的內容(例如改點同一地點的 Google POI),晚到的查詢結果不能蓋掉它。
    const patch = textPatchOf(text)
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) =>
        prev.placeId !== placeId || prev.textStatus !== 'pending' ? prev : { ...prev, ...patch, textStatus: undefined },
    })
  }, [])
  // markPlaceTextFailed:文字查詢失敗——textStatus 設成 'failed',卡片改顯示
  // 「簡介載入失敗。」,不永遠停在骨架。placeId 二次確認理由同上。
  const markPlaceTextFailed = useCallback((placeId: string) => {
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) => (prev.placeId !== placeId || prev.textStatus !== 'pending' ? prev : { ...prev, textStatus: 'failed' }),
    })
  }, [])
  // patchGeocodeCandidatePhoto:手動補照片(查到網址 → photoUrl,photoStatus 清成
  // undefined;null → 'none')。2026-10 起照片改由下方 placePhotoFetch effect 依
  // 卡片內容驅動,useMapState 不再呼叫這支,保留供呼叫端/測試直接補照片。
  const patchGeocodeCandidatePhoto = useCallback((placeId: string, photoUrl: string | null) => {
    dispatchGeoSelection({
      type: 'PATCH_INFO_CONTENT',
      patch: (prev) =>
        prev.placeId !== placeId
          ? prev
          : photoUrl
            ? { ...prev, photoUrl, photoStatus: undefined }
            : { ...prev, photoStatus: prev.photoUrl || prev.googlePhotoUrls?.length ? undefined : 'none' },
    })
  }, [])

  // placePhotoFetch:地點資訊卡的照片補查——卡片內容的 photoStatus==='pending'
  // (見 PlaceInfoContent.photoStatus 與 infoContent.ts 哪些來源會設成 pending)
  // 就查一次 place-photo:查到 → photoUrl + undefined、查到但沒有 → 'none'、
  // 失敗 → 'failed'。
  //
  // 2026-10 改寫(取代原本的 infoContentPhotoFetch + fetchedPlaceIdsRef,以及
  // useMapState.ts 依 selectedCandidate.placeId 變動才查的照片 effect):舊寫法用
  // fetchedPlaceIdsRef 記「這個 placeId 查過了」就不再查,但重開同一地點時卡片
  // 內容重新組出來、photoUrl 又是 undefined,結果永遠掃光。現在跟文字一樣「由
  // 卡片內容本身說還在等照片」驅動,旗標與查詢一定成對;查到的網址記在
  // placeInfoMemory,重開時 hydrateContent 直接帶回,不重打請求。
  //
  // 依賴 placeId+photoStatus:同一個 pending 地點重複開卡沿用同一次查詢(進行
  // 中共用,StrictMode 也只打一次);關卡或換地點時 cleanup 取消,patch 內部再
  // 比對 placeId 與 photoStatus 雙重確認。
  const pendingPhotoPlaceId = infoContent?.photoStatus === 'pending' ? infoContent.placeId : undefined
  const pendingPhotoName = infoContent?.name ?? ''
  useEffect(() => {
    if (!pendingPhotoPlaceId) return
    const placeId = pendingPhotoPlaceId
    const settle = (next: Pick<PlaceInfoContent, 'photoUrl' | 'photoStatus'>) =>
      dispatchGeoSelection({
        type: 'PATCH_INFO_CONTENT',
        patch: (prev) => (prev.placeId !== placeId || prev.photoStatus !== 'pending' ? prev : { ...prev, ...next }),
      })
    if (!dataSource.placePhoto) {
      settle({ photoStatus: undefined })
      return
    }
    let cancelled = false
    sharedFetch(
      placeInfoMemory.photoInflight,
      placeInfoMemory.photo,
      placeId,
      () => requirePlacePhoto(dataSource, placeId, pendingPhotoName).then((r) => r.googlePhotoUrls?.[0] ?? null),
      (url) => url != null,
    ).then(
      (url) => {
        if (cancelled) return
        settle(url ? { photoUrl: url, photoStatus: undefined } : { photoStatus: 'none' })
      },
      () => {
        if (!cancelled) settle({ photoStatus: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
    // 名稱只是查詢參數,不需要因為名稱變動重查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPhotoPlaceId, dataSource, placeInfoMemory])

  // placeTextFetch:Google 地點資訊卡的文字(簡介、評分)補查——開卡時
  // textStatus==='pending'(見 PlaceInfoContent.textStatus 與 infoContent.ts
  // 哪些來源會設成 pending)就查一次 place-text,成功 patchGeocodeCandidateText
  // (清成 undefined)、失敗 markPlaceTextFailed('failed')。資料存取層沒有
  // 實作 placeText(訪客版)時,hydrateContent 開卡當下就清成 undefined;這裡
  // 的同一個判斷只是給直接 dispatch SELECT_INFO、沒經過 hydrateContent 的路徑。
  //
  // 2026-10 從 useMapState.ts 的 selectedCandidate effect 搬過來:那邊只在
  // selectedCandidate.placeId 變動時查,同一個地點關卡後重開(placeId 沒變)
  // 不會再查、候選籃點開的 Google 地點也從來不查,卡片若帶著 pending 旗標
  // 就會永遠停在骨架。改成由「卡片內容本身說還在等文字」驅動,旗標與查詢
  // 一定成對。依賴 placeId+textStatus:同一個 pending 地點重複開卡(內容
  // 物件換了、兩者都沒變)沿用進行中的那次查詢;關卡(infoContent 變 null)
  // 或換地點時 cleanup 取消舊查詢,patch 內部再比對 placeId 與 textStatus 雙重確認。
  //
  // 查詢經 placeInfoMemory 去重:同一個 placeId 進行中的請求共用(StrictMode
  // 雙重 effect、A→B→A 往返時 A 還沒回來都不重打——第二次開 A 拿到的就是同一個
  // 地點同一次查詢的結果);有內容的結果記住,重開時 hydrateContent 直接帶回。
  const pendingTextPlaceId = infoContent?.textStatus === 'pending' ? infoContent.placeId : undefined
  useEffect(() => {
    if (!pendingTextPlaceId) return
    const placeId = pendingTextPlaceId
    if (!dataSource.placeText) {
      dispatchGeoSelection({
        type: 'PATCH_INFO_CONTENT',
        patch: (prev) => (prev.placeId !== placeId || prev.textStatus !== 'pending' ? prev : { ...prev, textStatus: undefined }),
      })
      return
    }
    let cancelled = false
    sharedFetch(
      placeInfoMemory.textInflight,
      placeInfoMemory.text,
      placeId,
      () => requirePlaceText(dataSource, placeId),
      hasTextContent,
    ).then(
      (text) => {
        if (!cancelled) patchGeocodeCandidateText(placeId, text)
      },
      () => {
        if (!cancelled) markPlaceTextFailed(placeId)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pendingTextPlaceId, dataSource, placeInfoMemory, patchGeocodeCandidateText, markPlaceTextFailed])

  // selectCandidateFromBasket:候選籃/清單抽屜裡任何一項被點擊——開資訊
  // 卡並移動地圖到該點為中心(見兩邊原本 selectGeoCandidate/onSelect 的
  // 說明,呼叫端要求候選相關清單點擊要有移動地圖的行為,跟純瀏覽清單
  // 只開資訊卡不移動地圖不同)。attraction 沒有候選籃入口,呼叫端理應
  // 不會傳入 kind==='attraction' 的候選,這裡仍保留防呆直接忽略。
  const selectCandidateFromBasket = useCallback((c: GeoCandidate) => {
    if (c.kind === 'attraction') return
    dispatchGeoSelection({
      type: 'SELECT_INFO',
      key: c.kind === 'entry' ? null : itemKey(c.kind, c),
      content: hydrateContent(candidateInfoContent(c)),
    })
    // nonce:點清單項目是明確的使用者動作,連續點同一項(例如中間手動
    // 拖曳過地圖、想回到原位)每次都該移動。少了它的話座標沒變、消費端
    // 的 effect 依賴全都沒變,地圖不會動——見 GeoPanTarget 對這個欄位的
    // 完整說明。
    setPanTarget({ lat: c.lat, lng: c.lng, nonce: Date.now() })
  }, [hydrateContent])

  const clearSelection = useCallback(() => {
    dispatchGeoSelection({ type: 'CLEAR' })
  }, [])

  // draggingCandidate:桌面版拖放改期功能用的中介 state——拖的是「已
  // 排入行程」的卡片,放開目標是日期分組,見 planning/place/desktop/CandidateList.tsx
  // handleDropOnDay 的完整說明。
  //
  // 2026-10 修正:原本這裡還有 pickingDayKey/onlyCandidates/
  // handlePickFromCandidate 三個供桌面版第二張浮動側欄
  // (AddFromCandidateSidebar,「從候選加入」彈出的候選匡)使用的中介
  // state/函式——使用者明確要求移除整套候選籃候選中清單與候選匡流程,
  // AddFromCandidateSidebar.tsx 本身已經整個刪除,這三者連帶也已移除,
  // 不再是死碼。
  const [draggingCandidate, setDraggingCandidate] = useState<GeoCandidate | null>(null)

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
    selectPlaceContent,
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
    handleRemoveCandidate,
    handleScheduleCandidate,
    selectCandidateFromBasket,
    // 搜尋結果原始資料(geocode 查詢的唯一資料來源)——見上方宣告處的
    // 完整說明,搬遷自當時的 GeoOutlinePanel.tsx(已退役)。
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
    // 拖放改期相關(僅桌面版使用)
    draggingCandidate,
    setDraggingCandidate,
  }
}

// GeoPlanningState:usePlanningState 的回傳型別(供 useMapState 的 outlineBindingFrom 等型別引用)。
export type GeoPlanningState = ReturnType<typeof usePlanningState>
