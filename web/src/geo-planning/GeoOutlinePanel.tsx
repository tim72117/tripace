import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClientConfig, GeoAttraction, GeoGeocodeCandidate, GeoHotel, GeoPlace, GeoPlaceDetails, GeoPlaceText, GeoTripEntry } from '../api'
import { fetchEntries, fetchGeoGeocode, fetchGeoPlacePhoto, fetchGeoPlaceText } from '../api'
import { GeoOutlineMap } from './GeoOutlineMap'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import styles from './GeoOutlinePanel.module.css'

// mapLocatedTripEntries:把 fetchEntries 查回的完整 Entry 清單篩出有座標的
// 那批、轉成 GeoTripEntry 形狀——供下方「換行程」與「補上日期後刷新」
// 兩個 effect 共用同一份映射邏輯,避免其中一處修改欄位後忘記同步另一處。
function mapLocatedTripEntries(entries: Awaited<ReturnType<typeof fetchEntries>>): GeoTripEntry[] {
  const located = entries.filter(
    (e): e is typeof e & { lat: number; lng: number } => e.lat != null && e.lng != null,
  )
  return located.map((e) => ({
    id: e.id,
    name: e.title,
    lat: e.lat,
    lng: e.lng,
    location: e.location,
    kind: e.kind,
    start: e.start,
    startTime: e.startTime,
  }))
}

// GeoOutlinePanel:地理輪廓底圖(構想 6)的桌面版試做承載元件——目前 Trip
// 型別沒有目的地城市欄位(見 types.ts),故用一個暫時的城市搜尋讓使用者
// 手動觸發查詢,驗證視覺與互動是否對齊設計討論的定案,之後 Trip 補上目的地
// 城市欄位時,這裡可以直接換成從 Trip 帶出、不需要使用者手動輸入。
//
// 城市搜尋的輸入框/按鈕 UI 本身渲染在 GeoCandidateSidebar(左側候選籃
// 側欄最上方,見 DesktopLayout.tsx 的接線),不是這個元件的 JSX——但
// 查詢邏輯(呼叫 fetchGeoGeocode、算 panTarget)留在這裡,透過
// onCitySearched 這個 callback 讓外部(DesktopLayout.tsx)觸發查詢、
// 這裡才是唯一持有 cfg、知道怎麼呼叫 API 的地方。這個切分理由同
// onHotelsChange 等既有 callback 模式:UI 呈現與資料查詢分別交給
// 「離使用者比較近」與「離 API 比較近」的元件負責。
//
// 這個元件本身不再查詢景點/飯店資料:輸入內容後只呼叫 fetchGeoGeocode
// (GET /internal/geo/geocode)拿到一組候選座標,轉成 panTarget 讓
// GeoOutlineMap 把地圖平移過去;地圖到了新位置後,會依它當時的可視範圍
// 自己向 GET /internal/geo/attractions/nearby 查詢該顯示什麼景點/飯店
// (見 GeoOutlineMap.tsx 的說明),查詢責任完全收在地圖元件內部,這裡
// 不再重複維護一份 attractions/hotels state。
//
// 這個搜尋框最初的設計是「輸入城市/地標名稱,把地圖移過去」的純定位
// 用途,但實際使用上已經不只如此——使用者也會直接輸入「甜點」「拉麵」
// 這類泛用關鍵字,期待查到目前地圖所在區域附近的結果。fetchGeoGeocode
// 底層的 Text Search 目前不知道地圖當下在哪裡(純文字查詢,沒有座標
// 概念),這種關鍵字查詢會依 Google 全球相關性排序回傳結果,不會偏向
// 地圖目前的可視範圍——查到離目前位置很遠的地點是預期中的既有限制,
// 見後端 handleGeoGeocode 的完整說明。
//
// onHotelsChange/onAttractionsChange 原封不動轉傳給 GeoOutlineMap——飯店/
// 地點清單改由 DesktopLayout.tsx 在「整個桌面版介面最外側」渲染(比照
// DemoPanel debug 面板的固定寬度側欄模式,跟 .desktop-main 平行,而非
// 塞在 main 內部),兩者是分開掛載的 sibling,只能靠這兩個 callback 往上
// 回報。
//
// externalPanTarget:使用者在 GeoHotelSidebar/GeoCandidateSidebar 點擊某個
// 飯店/地點/已排入行程項目時要移動地圖到的座標,由 DesktopLayout.tsx
// 往下傳——跟這裡搜尋查到的座標共用同一個 panRequest state,「誰最後
// 觸發就用誰」,見下方 panRequest 的完整說明。
// selectedKey:由 DesktopLayout.tsx 往下傳,原封不動轉傳給 GeoOutlineMap,
// 讓地圖上的地標/飯店圖示能標記出目前選中的是哪一個。
// tripID:目前選中的行程 ID——切到規劃分頁、或切換行程時,若這個行程底下
// 已經有帶座標的 entry(如老手回來繼續規劃、或搬過去用等機制搬進來的
// 候選點),應該優先以這些點的中心當地圖初始位置,而不是固定顯示東京。
// 見下方 tripCenter 的查詢。
// onTripEntriesChange:同 onHotelsChange 等,把行程本身已有座標的 entry
// (見下方查詢 tripCenter 的同一個 useEffect,順便保留完整清單而不只是
// 平均座標)往上回報,供 DesktopLayout.tsx 在整個桌面版介面最外側渲染
// (地圖上畫 marker、候選籃自動帶入)——理由同 onHotelsChange/
// onAttractionsChange。
export function GeoOutlinePanel({
  cfg,
  tripID,
  city,
  onCityChange,
  onSearch,
  onOpenChat,
  showZoomControl,
  searchRightSlot,
  onHotelsChange,
  onAttractionsChange,
  onPlacesNearby,
  onActiveCategoryChange,
  onTripEntriesChange,
  onAttractionSelect,
  onHotelSelect,
  onPlaceSelect,
  onPoiSelect,
  onGeocodeCandidateSelect,
  onGeocodeCandidateText,
  onGeocodeCandidatePhoto,
  onGeocodeCandidatesChange,
  externalGeocodeCandidateSelect,
  panTarget: externalPanTarget,
  selectedKey,
  candidateKeys,
  hoverKey,
  searchTrigger,
  refetchTripEntriesTrigger,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // city:目前城市搜尋框的輸入值,由 DesktopLayout.tsx 中介(UI 渲染在
  // GeoCandidateSidebar,見上方元件註解)——這個元件用它觸發
  // fetchGeoGeocode 查詢,查詢時機由 searchTrigger 遞增驅動(見下方
  // useEffect),不是每次 city 變動就查(那樣會在使用者打字打到一半時
  // 就發送請求)。
  city: string
  // onCityChange/onSearch:原封不動轉傳給 GeoOutlineMap,渲染在地圖上方
  // (類別標籤旁)的城市搜尋框——DesktopLayout.tsx 的 geoSearchCity state
  // 是唯一持有這份輸入值的地方。查詢中/錯誤狀態(searching/error)直接
  // 由下方的 loading/err state 轉給 GeoOutlineMap 顯示,不需要另外往上
  // 層回報,搜尋按鈕本身觸發查詢的方式是遞增 searchTrigger prop(見
  // 下方)。
  onCityChange?: (city: string) => void
  onSearch?: () => void
  // onOpenChat:原封不動轉傳給 GeoOutlineMap——搜尋框膠囊左側的 AI
  // 按鈕,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  onOpenChat?: () => void
  // showZoomControl:原封不動轉傳給 GeoOutlineMap——地圖右下角縮放按鈕
  // 開關,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  showZoomControl?: boolean
  // searchRightSlot:原封不動轉傳給 GeoOutlineMap——搜尋框膠囊最右側的
  // 額外內容(手機版放使用者頭像),見 GeoOutlineMap.tsx 對這個 prop 的
  // 完整說明。
  searchRightSlot?: ReactNode
  onHotelsChange?: (hotels: GeoHotel[]) => void
  onAttractionsChange?: (attractions: GeoAttraction[]) => void
  onPlacesNearby?: (places: GeoPlace[]) => void
  // onActiveCategoryChange:原封不動轉傳給 GeoOutlineMap——理由同
  // onPlacesNearby,見 GeoOutlineMap.tsx 對這個 prop 的完整說明。
  onActiveCategoryChange?: (category: string | null) => void
  onTripEntriesChange?: (entries: GeoTripEntry[]) => void
  // onAttractionSelect/onHotelSelect/onPlaceSelect/onPoiSelect:原封不動
  // 轉傳給 GeoOutlineMap——理由同 onHotelsChange 等既有 callback,見
  // GeoOutlineMap.tsx 對這幾個 prop 的說明。
  onAttractionSelect?: (attraction: GeoAttraction) => void
  onHotelSelect?: (hotel: GeoHotel) => void
  onPlaceSelect?: (place: GeoPlace) => void
  onPoiSelect?: (details: GeoPlaceDetails) => void
  // onGeocodeCandidateSelect:使用者點擊地圖上的搜尋候選 marker(或側欄
  // 清單裡的候選項目)時立即觸發——只帶 Text Search 查到的輕量資料
  // (名稱/地址/座標,不含照片,理由見 GeoGeocodeCandidate 型別的說明),
  // 讓呼叫端(DesktopLayout.tsx)先開 GeoInfoPanel 顯示基本資訊,不必
  // 等待下方 onGeocodeCandidateText/onGeocodeCandidatePhoto 的補查完成
  // 才有畫面反應。
  onGeocodeCandidateSelect?: (candidate: GeoGeocodeCandidate) => void
  // onGeocodeCandidateText/onGeocodeCandidatePhoto:候選有 placeId 時,
  // 選定後這個元件會平行呼叫 fetchGeoPlaceText(文字:名稱/地址/評分/
  // 簡介)與 fetchGeoPlacePhoto(照片,Pexels-first + GCS 落地),兩支
  // 請求互不等待——文字通常先回來,讓呼叫端能立刻把資訊卡升級成完整
  // 文字版本(此時 photoUrl 仍未知,畫面顯示佔位圖,使用者不需要等
  // 照片查完才看到名稱/地址/簡介這些內容,見下方
  // handleGeocodeCandidateSelect 的說明);照片查到後再單獨補上,不影響
  // 已經顯示的文字內容。這樣拆分後就不能再直接沿用 onPoiSelect 那樣
  // 「一次拿到完整 GeoPlaceDetails 才觸發」的既有慣例,呼叫端需要自行
  // 用 useState 或類似機制,把文字/照片兩次回呼的結果合併成同一張
  // 資訊卡(見 DesktopLayout.tsx 的接線)。查詢失敗、或候選沒有 placeId
  // (理論上不該發生,見該型別的說明)時不會觸發,不視為錯誤。
  onGeocodeCandidateText?: (placeId: string, text: GeoPlaceText) => void
  onGeocodeCandidatePhoto?: (placeId: string, photoUrl: string | null) => void
  // onGeocodeCandidatesChange:同 onHotelsChange 等既有 callback 模式——
  // geocodeCandidates 只有這個元件自己留一份(供 GeoOutlineMap 畫
  // marker),使用者要求搜尋到多筆候選時也要能在 GeoHotelSidebar(整個
  // 桌面版介面最外側的合併清單)裡直接看到、點選,而不是只能在地圖上
  // 辨認 marker——側欄跟這個元件是分開掛載的 sibling,只能靠這個
  // callback 往上回報,理由完全同 onHotelsChange。
  onGeocodeCandidatesChange?: (candidates: GeoGeocodeCandidate[]) => void
  // externalGeocodeCandidateSelect:GeoHotelSidebar 合併清單裡的候選項目
  // 被點擊時,由 DesktopLayout.tsx 傳入同一個候選物件——不能直接沿用
  // externalPanTarget(那個機制固定 suppressQuery:true,是刻意給「只是
  // 想對齊看清楚一個已知項目」的候選籃/探索周邊用的,見該 prop 的完整
  // 說明),候選是使用者剛主動搜尋、意圖是「移動並查詢新範圍」,必須走
  // 跟地圖上點 candidate marker 完全相同的 handleGeocodeCandidateSelect
  // (suppressQuery:false),兩種入口(地圖 marker/側欄清單)才會有一致
  // 的行為,不會出現「清單點候選,地圖有移動但景點/飯店清單卻沒有跟著
  // 更新」的落差(這是實際發生過的 bug)。用物件參照(而非純座標)當
  // useEffect 依賴,理由同下方 handleGeocodeCandidateSelect 的呼叫時機
  // ——每次點擊呼叫端都會建立新物件參照,即使連續點同一筆候選也能觸發。
  externalGeocodeCandidateSelect?: GeoGeocodeCandidate | null
  panTarget?: { lat: number; lng: number; level?: number; radiusMeters?: number } | null
  selectedKey?: GeoSelectedKey
  // candidateKeys/hoverKey:原封不動轉傳給 GeoOutlineMap——理由同
  // selectedKey,見 GeoOutlineMap.tsx 對這兩個 prop 的完整說明。
  candidateKeys?: Set<string>
  hoverKey?: GeoSelectedKey
  // searchTrigger:每次遞增時觸發一次城市搜尋(用目前的 city prop 值)
  // ——用遞增計數器而非直接暴露一個「查詢」函式給外部呼叫,是因為這個
  // 元件本身沒有 ref,外部(GeoCandidateSidebar 的搜尋按鈕)無法直接呼叫
  // 內部方法,改用「外部改變一個 prop 值 → 這裡的 useEffect 偵測到變化
  // 才查詢」的單向資料流,對齊這個檔案其餘 panTarget/tripID 等 prop 的
  // 既有慣例(見下方 useEffect 的依賴陣列)。
  searchTrigger?: number
  // refetchTripEntriesTrigger:每次遞增時重新查一次目前行程的 entries、
  // 更新 tripEntries/onTripEntriesChange,但不動 tripCenter(不重新判斷
  // 地圖初始中心、也不讓 GeoOutlineMap 重新等待)——供
  // GeoCandidateSidebar 幫「未排定日期」的候選補上日期後,通知這裡刷新
  // 一份新的 tripEntries,好讓該候選從「未排定日期」分組移到正確的日期
  // 分組。跟 searchTrigger 是同一種「外部改變一個 prop 值 → 這裡的
  // useEffect 偵測到變化才動作」模式,理由同該 prop 的說明。0(初始值)
  // 不觸發。
  refetchTripEntriesTrigger?: number
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // mapCenter:GeoOutlineMap 每次 idle 回報的目前地圖中心座標(見該元件
  // onCenterChange prop 的說明)——供下方 searchTrigger 的 effect 當
  // locationBias 使用,讓「甜點」「apple」這類沒有明確指向單一地點的
  // 泛用關鍵字查詢優先偏向目前地圖所在區域(見 handleGeoGeocode 的完整
  // 說明)。初始值 null 代表地圖尚未 idle 過一次(理論上進入這個分頁、
  // 地圖建立完成後很快就會有第一次 idle),此時查詢不帶位置偏向,不視為
  // 錯誤。
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  // panRequest:目前要移動地圖到的目標,兩個獨立來源(搜尋框查到的座標/
  // externalPanTarget 側欄點擊)共用同一個 state,誰最後觸發就用誰——
  // 取代原本「搜尋 > 側欄點擊」寫死優先序的舊寫法(見下方 effectivePanTarget
  // 的說明,那個寫法有實際發生過的 bug:searchPanTarget 只有查詢成功時
  // 會設值,從來不會被清空,一旦使用者用過一次城市搜尋,之後所有側欄
  // 點擊——包含候選籃「已排入行程」項目點擊要移動地圖到該點——都會被
  // 這個過時的搜尋座標永久蓋掉,地圖只會不斷被拉回最後一次搜尋的地方,
  // 使用者會觀察到「資訊欄有正確顯示點擊的項目,但地圖完全不會動」)。
  // 每次設值都建立新物件參照,即使連續觸發同一個座標也能讓 GeoOutlineMap
  // 偵測到「這是一次新的移動請求」(理由同 GeoOutlineMap.tsx 對 panTarget
  // 的說明)。
  const [panRequest, setPanRequest] = useState<{ lat: number; lng: number; level?: number; radiusMeters?: number; suppressQuery: boolean } | null>(null)
  // geocodeCandidates:fetchGeoGeocode 查到多筆候選時(見上方
  // searchTrigger 的 effect)暫存在這裡,傳給 GeoOutlineMap 畫成可點擊
  // 的候選 marker、並 fitBounds 縮放到能同時看見所有候選的範圍——
  // 使用者自己從地圖上辨認、點選正確的那一筆,不再像過去只回一組座標、
  // 猜錯了無從挑選。點擊確認後不清空(見 handleGeocodeCandidateSelect
  // 的說明),讓使用者能隨時回頭比較/改選別的候選;只有觸發新一次搜尋
  // 才會換成新的候選清單(見上方 searchTrigger 的 effect)。
  const [geocodeCandidates, setGeocodeCandidates] = useState<GeoGeocodeCandidate[]>([])
  // selectedGeocodeCandidateKey:目前選中的候選識別鍵(geoItemKey 同一套
  // 「名稱+座標」規則,見 GeoHotelSidebar.tsx 的說明),供 GeoOutlineMap
  // 判斷該把哪一個候選 marker 畫成選取樣式——null 代表尚未選過、或剛
  // 觸發新搜尋重置。
  const [selectedGeocodeCandidateKey, setSelectedGeocodeCandidateKey] = useState<string | null>(null)
  // tripCenter:目前行程底下已有座標的 entry 算出來的中心點,見下方
  // useEffect,傳給 GeoOutlineMap 當地圖第一次建立時的初始中心(見該
  // 元件 initialCenter prop 的完整說明)——三態:undefined 代表「還在
  // 查、尚未確定」(初始值,地圖建立要等待這個狀態解除);null 代表
  // 「已確定查無可用資料」(沒有 tripID、或行程沒有帶座標的既有地點、
  // 或查詢失敗),退回地圖內建的預設起點;物件代表確定要用這組座標。
  // 每次 tripID 變動就重新設回 undefined、重新查一次——換行程後舊行程
  // 的中心點不該繼續生效。
  const [tripCenter, setTripCenter] = useState<{ lat: number; lng: number } | null | undefined>(undefined)
  // tripEntries:同 tripCenter 查詢流程一併算出的完整帶座標 entry 清單
  // ——這個元件自己也要留一份(不只是往外 callback),才能傳給
  // GeoOutlineMap 畫 marker(見下方 <GeoOutlineMap tripEntries={...}>)。
  const [tripEntries, setTripEntries] = useState<GeoTripEntry[]>([])

  // 每次 searchTrigger 遞增(GeoCandidateSidebar 的搜尋按鈕/Enter 觸發,
  // 見 DesktopLayout.tsx 的接線)就查一次目前的 city 值——用 effect 而非
  // 直接在按鈕 onClick 裡呼叫這個元件的方法,因為 UI 在另一個元件裡(見
  // 上方元件註解),這是唯一能讓外部觸發這裡查詢邏輯的方式。0(初始值)
  // 不觸發查詢,只有真的遞增過至少一次才查。
  useEffect(() => {
    if (!searchTrigger) return
    const trimmed = city.trim()
    if (!trimmed) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    setGeocodeCandidates([])
    onGeocodeCandidatesChange?.([])
    fetchGeoGeocode(cfg, trimmed, mapCenter ?? undefined)
      .then((result) => {
        if (cancelled) return
        // 只有一筆候選時不需要使用者再點一次確認——直接沿用原本
        // 「查完就 pan 過去」的行為;多筆候選才交給地圖標出來讓使用者
        // 自己選(見下方 geocodeCandidates 的完整說明與
        // handleGeocodeCandidateSelect)。使用者明確要求:即使只有一筆
        // 也要自動顯示這個地點的資訊卡(理由同 handleGeocodeCandidateSelect
        // 對多筆候選點選後的既有行為)——原本這裡只 setPanRequest、不呼叫
        // onGeocodeCandidateSelect,搜尋整座城市這類唯一解查詢時地圖會
        // 移動過去,但完全沒有任何資訊卡跳出來,使用者容易誤以為搜尋沒有
        // 生效。
        setSelectedGeocodeCandidateKey(null)
        if (result.candidates.length === 1) {
          const only = result.candidates[0]
          setPanRequest({ lat: only.lat, lng: only.lng, suppressQuery: false })
          onGeocodeCandidateSelect?.(only)
          // 平行補查文字/照片——理由/失敗處理同 handleGeocodeCandidateSelect
          // 的說明,這裡不直接呼叫該函式是因為它定義在這個 effect 之後
          // (避免打亂既有函式宣告順序),故重複這幾行呼叫邏輯,而非改成
          // 互相呼叫。
          if (only.placeId) {
            const placeId = only.placeId
            fetchGeoPlaceText(cfg, placeId)
              .then((text) => onGeocodeCandidateText?.(placeId, text))
              .catch(() => {})
            fetchGeoPlacePhoto(cfg, placeId, only.name)
              .then((result) => onGeocodeCandidatePhoto?.(placeId, result.photoUrl ?? null))
              .catch(() => {})
          }
        } else {
          setGeocodeCandidates(result.candidates)
          onGeocodeCandidatesChange?.(result.candidates)
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger])

  // handleGeocodeCandidateSelect:使用者在地圖上點擊某個候選 marker
  // 確認選定——不再清空候選圖層(先前版本會清空,但這樣使用者選錯後
  // 沒辦法直接點另一個候選重選,得重新搜尋一次;改成其餘候選繼續留在
  // 地圖上,只用 selectedGeocodeCandidateKey 標記目前選中的是哪一個,
  // 讓呼叫端能把它畫成明顯的選取樣式,理由同其餘圖層 selectedKey 的
  // 既有機制)。用該候選的座標觸發原本「搜尋定位」的 panRequest 流程,
  // 並把完整候選資料往上回報(見 onGeocodeCandidateSelect),讓呼叫端
  // 開啟 GeoInfoPanel 顯示這個候選的資訊——跟其餘圖層(飯店/推薦地點)
  // 點擊 marker 的既有行為一致。
  const handleGeocodeCandidateSelect = (c: GeoGeocodeCandidate) => {
    setSelectedGeocodeCandidateKey(`${c.name}|${c.lat}|${c.lng}`)
    setPanRequest({ lat: c.lat, lng: c.lng, suppressQuery: false })
    onGeocodeCandidateSelect?.(c)
    // 有 placeId 才補查(理論上 Text Search 每筆結果都會有,見
    // GeoGeocodeCandidate 型別的說明;沒有就維持只顯示輕量版內容,不視為
    // 錯誤)。使用者明確要求把文字/照片拆成兩個平行請求:文字
    // (fetchGeoPlaceText)通常先回來,能讓資訊卡提早顯示完整名稱/地址/
    // 簡介,不必等照片查完才有反應,照片還沒到之前畫面顯示佔位圖(見
    // onGeocodeCandidatePhoto 的說明)。兩支請求彼此獨立、不互相等待,
    // 也各自的 .catch 靜默放棄失敗——理由同這支端點其餘呼叫端「照片/
    // 詳細資訊是加值,查不到不算整體失敗」的既有慣例。不設 cancelled
    // flag:使用者短時間內連續切換候選是可能的(見上方「其餘候選繼續
    // 留在地圖上」的說明),但因為每次呼叫都是獨立 fetch、結果各自對應
    // 各自的候選物件,即使前一次還沒回來、後一次已經觸發,兩次回呼都
    // 只是「更新成含更多資訊的版本」,不會互相覆蓋錯誤的內容——不像
    // searchTrigger 那個 effect 需要 cancelled(那裡是換掉整個
    // candidates 清單,舊查詢回來會覆蓋新查詢的結果)。
    if (c.placeId) {
      const placeId = c.placeId
      fetchGeoPlaceText(cfg, placeId)
        .then((text) => onGeocodeCandidateText?.(placeId, text))
        .catch(() => {})
      fetchGeoPlacePhoto(cfg, placeId, c.name)
        .then((result) => onGeocodeCandidatePhoto?.(placeId, result.photoUrl ?? null))
        .catch(() => {})
    }
  }

  // externalGeocodeCandidateSelect(GeoHotelSidebar 合併清單裡的候選項目
  // 被點擊,見該 prop 的說明)變動時,直接呼叫跟地圖上點 candidate
  // marker 完全相同的 handleGeocodeCandidateSelect——兩種入口共用同一份
  // 邏輯,不重新實作一份跳過 suppressQuery:false 的簡化版。
  useEffect(() => {
    if (!externalGeocodeCandidateSelect) return
    handleGeocodeCandidateSelect(externalGeocodeCandidateSelect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalGeocodeCandidateSelect])

  // 切到這個分頁或換行程時,若行程底下已有帶座標的 entry,算出這些點的
  // 平均座標當地圖初始中心——只在 tripID 變動時查一次,不是每次都重查:
  // 這裡只負責「一開始該看哪裡」,之後使用者搜尋/拖曳地圖的移動不該被
  // 這份初始定位持續蓋過。重設回 undefined(而非直接設 null)是關鍵:
  // 讓 GeoOutlineMap 知道「還在查、地圖建立要等」,查完(不論有沒有查到
  // 可用資料)才轉成確定的 null 或物件,避免地圖搶先用預設值建好、之後
  // 才發現其實該建在別的地方,造成先查一次沒用的資料。
  useEffect(() => {
    setTripCenter(undefined)
    setTripEntries([])
    onTripEntriesChange?.([])
    if (!tripID) {
      setTripCenter(null)
      return
    }
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        // 順便把完整的帶座標 entry 清單(不只是算完就丟的平均座標)存下來
        // 並往上回報——這批點要畫在地圖上(見下方 <GeoOutlineMap
        // tripEntries={...}>)、也要自動帶進候選籃(見 DesktopLayout.tsx),
        // 不是只用來算初始定位。
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
        if (mapped.length === 0) {
          setTripCenter(null)
          return
        }
        const latSum = mapped.reduce((sum, e) => sum + e.lat, 0)
        const lngSum = mapped.reduce((sum, e) => sum + e.lng, 0)
        setTripCenter({ lat: latSum / mapped.length, lng: lngSum / mapped.length })
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤,但仍要轉成確定的 null——讓地圖不再
        // 繼續等待,退回預設起點,而不是永遠卡在 undefined 不建圖。
        if (!cancelled) setTripCenter(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID])

  // 補上日期後刷新 tripEntries:refetchTripEntriesTrigger 遞增時重新查一次
  // entries、更新 tripEntries/onTripEntriesChange,但不動 tripCenter——見
  // 該 prop 的說明。0(初始值)不觸發,避免掛載當下跟上面那個 effect
  // 重複查一次。
  useEffect(() => {
    if (!refetchTripEntriesTrigger || !tripID) return
    let cancelled = false
    fetchEntries(cfg, tripID)
      .then((entries) => {
        if (cancelled) return
        const mapped = mapLocatedTripEntries(entries)
        setTripEntries(mapped)
        onTripEntriesChange?.(mapped)
      })
      .catch(() => {
        // 查詢失敗不視為致命錯誤——維持上一次查到的內容即可,不彈錯誤
        // 訊息打斷瀏覽,理由同其餘查詢失敗處理方式。
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTripEntriesTrigger])

  // externalPanTarget(側欄點擊,含候選籃「已排入行程」項目)變動時,
  // 更新成新的 panRequest——跟上面 searchTrigger 成功時直接 setPanRequest
  // 是同一份 state,「誰最後觸發就用誰」,不再有寫死的來源優先序(理由見
  // panRequest 宣告處的說明)。suppressQuery 固定為 true:側欄點擊只是想
  // 對齊看清楚一個已知項目,範圍通常沒有實質改變,該抑制以避免所有點
  // 清空重畫(對比搜尋框查到的座標,使用者明確按下「查看」要換一個地方
  // 看,移動後必須查詢新範圍的資料,不能抑制,見 setPanRequest 呼叫處)。
  // 依實際座標值(而非物件參照)當依賴,避免呼叫端每次重渲染都產生新的
  // externalPanTarget 物件參照時,這裡跟著誤判成「有新的移動要執行」。
  const externalLat = externalPanTarget?.lat
  const externalLng = externalPanTarget?.lng
  const externalLevel = externalPanTarget?.level
  const externalRadiusMeters = externalPanTarget?.radiusMeters
  useEffect(() => {
    if (externalLat == null || externalLng == null) return
    setPanRequest({
      lat: externalLat,
      lng: externalLng,
      level: externalLevel,
      radiusMeters: externalRadiusMeters,
      suppressQuery: true,
    })
  }, [externalLat, externalLng, externalLevel, externalRadiusMeters])

  return (
    // geo-outline-panel-wrap:固定字串 class(與 CSS Modules 的 styles.wrap
    // 並存),供 styles-desktop.css 的 .desktop-main:has(...) 全域選擇器
    // 偵測——理由同 PaceRouteMap.tsx 的 pace-route-map-wrap(見該檔案
    // module.css 的說明):CSS Modules 雜湊過的名稱編譯時不固定,外部
    // 全域 CSS 選擇器無法可靠指到它,故需要一個不受雜湊影響的固定名稱。
    <div className={`${styles.wrap} geo-outline-panel-wrap`}>
      <div className={styles.mapArea}>
        <GeoOutlineMap
          cfg={cfg}
          initialCenter={tripCenter}
          tripEntries={tripEntries}
          city={city}
          onCityChange={onCityChange}
          onSearch={onSearch}
          onOpenChat={onOpenChat}
          showZoomControl={showZoomControl}
          searchRightSlot={searchRightSlot}
          searching={loading}
          searchError={err}
          onAttractionsChange={onAttractionsChange}
          onVisibleHotelsChange={onHotelsChange}
          onPlacesNearby={onPlacesNearby}
          onActiveCategoryChange={onActiveCategoryChange}
          onAttractionSelect={onAttractionSelect}
          onHotelSelect={onHotelSelect}
          onPlaceSelect={onPlaceSelect}
          onPoiSelect={onPoiSelect}
          onCenterChange={setMapCenter}
          panTarget={panRequest}
          selectedKey={selectedKey}
          candidateKeys={candidateKeys}
          hoverKey={hoverKey}
          geocodeCandidates={geocodeCandidates}
          selectedGeocodeCandidateKey={selectedGeocodeCandidateKey}
          onGeocodeCandidateSelect={handleGeocodeCandidateSelect}
        />
      </div>
    </div>
  )
}
