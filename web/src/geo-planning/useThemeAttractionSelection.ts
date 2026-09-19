import { useCallback, useEffect, useState } from 'react'
import type { GeoAttraction, GeoPlaceDetails } from '../api'
import { attractionToInfoContent, poiInfoContent } from './geoInfoContent'
import type { PlaceInfoContent } from './PlacePanel'
import { useInfoCardStack, useInfoCardStackSync, type InfoCardStack } from './useInfoCardStack'
import type { CuratedCategory } from './geoCuratedCategoryStub'

// useThemeAttractionSelection:主題卡(AttractionInfoPanel)開著時,跟它
// 並存/附掛的一組狀態與 reset 邏輯——DesktopLayout.tsx(正式功能)與
// KiyomizuDemoPage.tsx(公開展示頁)原本各自獨立手寫了一份幾乎同構的
// 版本(poiContent/nearbyInfoContent、hoveredAttraction/
// hoveredNearbyAttraction、activeCategoryFilter、三個依主題切換 reset 的
// effect、infoCardStack 的 attraction/nearbyPlace 兩筆登記),這是先前
// 「兩邊行為容易不一致」的根本原因——2026-09 有一次實測踩到的 bug 就是
// 因為展示頁漏寫了其中一個 reset effect(見下方 useEffect 區塊的完整
// 說明)。
//
// 抽出邊界刻意收得很小,只包含「本質相同、且無參數化需求」的部分:
//   - poiContent state + openPoiContent(查詢邏輯,內文已再抽成下方獨立的
//     fetchPoiContent 函式,供不需要整支 hook 的呼叫端共用,見該函式說明)
//   - hoveredAttraction state
//   - categoryFilter state
//   - 三個 `[themeKey]` reset effect(清空上述三者)
//   - useInfoCardStack + 'attraction'/'nearbyPlace' 兩筆登記
//
// 刻意不收進來的部分(留在各自呼叫端):
//   - 主題卡開關本身(themeKey 只當唯讀輸入傳入,setter 留在呼叫端——
//     正式版是 geoSelection 互斥 reducer 的一個分支,展示頁是純本地
//     useState,若連 setter 都收進來,這支 hook 就要處理「受控/非受控」
//     兩種模式,參數會爆炸)。
//   - 手機版(GeoOutlinePhoneView.tsx)不接整支——手機版沒有
//     hoveredAttraction(觸控沒有 hover)、也沒有 infoCardStack 對應的並排
//     定位概念(手機版是 sheet 堆疊,顯示真相來源是 useSheetStack,兩套
//     互相獨立),硬接整支只會多出兩個沒人消費的死欄位。手機版只共用
//     下方的 fetchPoiContent 這段查詢邏輯本身。
//   - nearby 清單(nearbyAttractions/nearbyList)與 revealedAttractionNames
//     ——兩邊的 pool 來源、slice 上限、null vs 空 Set 語意本來就刻意不同
//     (正式版限制在地圖可視範圍查詢結果的前 5 筆,展示頁是固定城市查詢
//     的全部非主題點),硬抽會需要 excludeSelf/limit/revealMode 這類旗標,
//     反而讓呼叫端比原本的兩份各自 8-10 行 useMemo 更難讀。這兩塊沒有
//     effect、沒有時序問題,不會像 reset effect 那樣「忘了寫就出 bug」,
//     留在各自檔案更清楚。
//   - searchResults 登記/`geo.setGeocodeCandidates([])` 反向清空——正式
//     版獨有(搜尋框),展示頁沒有這個第三方卡片。
//   - shiftBy/attractionPanelRightPx——展示頁沒有對話小匡/飯店側欄。
//   - handleAttractionOpenPlaceDetails/handleAttractionOpenPlaceWithoutGoogle
//     的「主題卡開著→並存;沒開著→走 geo.selectPoi 互斥路徑」分岔——
//     展示頁刻意沒有互斥路徑(精選點一律走並存),這個分岔邏輯留在
//     DesktopLayout.tsx,只是分岔的兩個分支都改呼叫這支 hook 回傳的
//     setPoiContent。
// fetchPoiContent:「有 placeId 時查 fetchPlaceDetails,成功用
// poiInfoContent(details)當主要內容、附加 attraction.summary;沒有
// placeId 或查詢失敗時退回 attractionToInfoContent」這段查詢邏輯本身,
// 抽成不依賴 React state 的獨立函式——供這支 hook 的 openPoiContent
// (桌面版/展示頁的並存地點卡)與 GeoOutlinePhoneView.tsx(手機版附近
// 景點清單,push 一層新 sheet 顯示,見該檔案的完整說明)共用同一段查詢
// /fallback 規則,不需要手機版也接整支 useThemeAttractionSelection
// (手機版沒有 hoveredAttraction/infoCardStack 這兩個概念,見下方檔頭
// 說明,硬接會多出死欄位)。回傳 Promise 而非直接 setState,由呼叫端
// 決定內容要放進哪個 state(桌面版/展示頁是 poiContent,手機版是新的
// sheet 對應的 state)。
export function fetchPoiContent(
  attraction: GeoAttraction,
  fetchPlaceDetails: (placeId: string) => Promise<GeoPlaceDetails>,
): Promise<PlaceInfoContent> {
  if (!attraction.placeId) {
    return Promise.resolve(attractionToInfoContent(attraction))
  }
  return fetchPlaceDetails(attraction.placeId)
    .then((details) => {
      const content = poiInfoContent(details)
      content.attractionSummary = attraction.summary
      return content
    })
    .catch(() => attractionToInfoContent(attraction))
}

export interface ThemeAttractionSelection {
  poiContent: PlaceInfoContent | null
  setPoiContent: (content: PlaceInfoContent | null) => void
  // openPoiContent:對稱兩邊原本各自的 handleSelectNearbyAttraction/
  // openPoiContent——有 placeId 時查 fetchPlaceDetails,成功用
  // poiInfoContent(details)當主要內容、附加 attraction.summary;沒有
  // placeId 或查詢失敗時退回 attractionToInfoContent。
  openPoiContent: (attraction: GeoAttraction) => void
  hoveredAttraction: GeoAttraction | null
  setHoveredAttraction: (attraction: GeoAttraction | null) => void
  categoryFilter: CuratedCategory | null
  setCategoryFilter: (category: CuratedCategory | null) => void
  infoCardStack: InfoCardStack
}

export function useThemeAttractionSelection(
  // themeKey:目前開著哪張主題卡的唯讀識別——依賴陣列直接比較這個值本身
  // (React 用 Object.is),故呼叫端要自己決定「什麼樣的值變動才代表換了
  // 一個主題點」:
  //   - 正式版(DesktopLayout.tsx)傳 geoAttractionContent 這個物件本身
  //     (不是 .name 字串)——geoSelection reducer 每次 SELECT_ATTRACTION
  //     都會 dispatch 一個新物件(見 useGeoPlanningState.ts 的完整說明),
  //     用物件參照比對才能保留「使用者重新點擊同一個主題點地標,也要
  //     清空左側並存卡回到乾淨狀態」這個原本的行為,同時避免「兩個不同
  //     地點但同名」被誤判成同一個主題(用 .name 字串比對會撞名)。
  //   - 展示頁(KiyomizuDemoPage.tsx)傳 openThemeName 字串——展示頁的
  //     主題點是本地 useState,只在使用者真的換一個主題時才會變動,不會
  //     重複觸發同一個字串,且固定城市查詢範圍內沒有同名主題點的疑慮,
  //     字串比對已經足夠、不需要額外維護物件參照。
  // 2026-09:曾經一度統一改成一律用 .name 字串,結果讓正式版意外失去
  // 「重複點同一主題點清空並存卡」的行為、也讓同名主題點有誤判風險
  // ——問題不在「該不該清空」,而在「用什麼識別同一個主題」,故改回讓
  // 呼叫端自行決定識別值,不在這支 hook 裡假設任何一種型別。
  themeKey: unknown,
  // fetchPlaceDetails:呼叫端已經 bind 好 cfg 的查詢函式——正式版傳
  // (placeId) => fetchGeoPlaceDetails(cfg, placeId),展示頁傳
  // (placeId) => fetchPublicGeoPlaceDetails(GUEST_CFG, placeId)。
  fetchPlaceDetails: (placeId: string) => Promise<GeoPlaceDetails>,
  // extraAttractionPresent:'attraction' order 0 這個位置,除了 themeKey
  // 本身之外還有沒有其他分支也算「這個位置有卡片」——正式版
  // (DesktopLayout.tsx)的 geoInfoContent(PlacePanel)跟 geoAttractionContent
  // (AttractionInfoPanel)是同一個 geoSelection 互斥狀態機的兩個分支(見
  // geoSelection.ts 開頭說明),渲染的是同一個「主題卡這個位置」,只是這支
  // hook 只認得 themeKey(對應 geoAttractionContent),不知道呼叫端還有
  // geoInfoContent 這個分支存在。
  //
  // 2026-09 前的版本沒有這個參數,呼叫端(DesktopLayout.tsx)改成自己
  // 對同一個 id 'attraction' 再呼叫一次 useInfoCardStackSync、傳入涵蓋
  // 兩個分支的布林值,靠「後呼叫的 useInfoCardStackSync 覆蓋先呼叫的」
  // 這個未明文保證的 effect 執行順序讓自己的登記「贏過」這支 hook 內部
  // 的登記——這個寫法能動,但把「同一個 id 只能有一個登記來源」這個不
  // 變量寄託在呼叫順序上,之後若調整 hook 呼叫順序、或其他呼叫端使用這支
  // hook 卻沒複製同一個補登記的寫法,會在沒有任何錯誤訊息的情況下悄悄
  // 壞掉。改成這個參數後,'attraction' 的登記只由這支 hook 內部發生
  // 一次,呼叫端只需要把完整的 present 條件算好傳進來,不需要自己再呼叫
  // 一次 useInfoCardStackSync 补登記。
  //
  // 未帶時預設 false(等同沒有額外分支)——展示頁(KiyomizuDemoPage.tsx)
  // 沒有 geoInfoContent 這種第二種主題卡分支,不需要傳。
  extraAttractionPresent = false,
  // onAttractionPresent:'attraction' 這張 exclusive 卡片從不存在→存在時
  // 額外要做的事(見 useInfoCardStackSync 的 onExclusivePresent 完整
  // 說明)——正式版用來在搜尋結果側欄登記進來、把這張卡片的登記清空時,
  // 額外呼叫 geo.setGeocodeCandidates([]) 清掉搜尋候選(理由同呼叫端的
  // 完整說明)。跟 extraAttractionPresent 一樣未帶時預設不做任何事。
  onAttractionPresent?: () => void,
): ThemeAttractionSelection {
  const [poiContent, setPoiContent] = useState<PlaceInfoContent | null>(null)
  const [hoveredAttraction, setHoveredAttraction] = useState<GeoAttraction | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CuratedCategory | null>(null)

  const openPoiContent = useCallback((attraction: GeoAttraction) => {
    fetchPoiContent(attraction, fetchPlaceDetails).then(setPoiContent)
  }, [fetchPlaceDetails])

  // 主題卡切換(themeKey 變動,含關閉整張主題卡回到 null)時一併清掉
  // poiContent/hoveredAttraction/categoryFilter——三者都是依附在目前
  // 開著的主題點底下的暫時性狀態,換一個主題點/關掉主題卡後,原本疊在
  // 舊主題卡左側的地點卡、地圖上展開成照片的圓點、篩選條件都沒有繼續
  // 存在的意義,避免殘留舊主題底下留下的狀態污染新主題。
  //
  // 這正是抽出這支 hook 要解決的核心問題:原本展示頁(KiyomizuDemoPage.tsx)
  // 漏寫了 hoveredAttraction 的 reset(靠 AttractionInfoPanel 元件掛載
  // 方式差異意外沒觸發問題,但 categoryFilter 的 reset 因為展示頁把
  // AttractionInfoPanel 條件掛載、正式版常駐掛載,兩邊對「切換主題點時
  // 分類篩選要不要清空」實際上依賴不同機制,曾經因此出現「切換主題點瞬間
  // 地圖圓點先閃一下舊篩選」的 bug)。三個 reset 收在同一支 hook 裡,兩邊
  // 呼叫端不可能再各自漏掉其中一個。
  useEffect(() => {
    setPoiContent(null)
  }, [themeKey])
  useEffect(() => {
    setHoveredAttraction(null)
  }, [themeKey])
  useEffect(() => {
    setCategoryFilter(null)
  }, [themeKey])

  // infoCardStack:'attraction' 固定順位 0(exclusive),'nearbyPlace' 固定
  // 順位 1(stacked)——兩邊呼叫端共同的最小登記集合。正式版還需要額外
  // 登記 'searchResults'(搜尋框結果側欄),由呼叫端在拿到這支 hook 回傳的
  // infoCardStack 後自行再呼叫一次 useInfoCardStackSync 補登記,不需要
  // 這支 hook 認識搜尋框的存在。
  const infoCardStack = useInfoCardStack()
  useInfoCardStackSync(
    infoCardStack,
    'attraction',
    0,
    'exclusive',
    !!themeKey || extraAttractionPresent,
    onAttractionPresent,
  )
  useInfoCardStackSync(infoCardStack, 'nearbyPlace', 1, 'stacked', !!poiContent)

  return {
    poiContent,
    setPoiContent,
    openPoiContent,
    hoveredAttraction,
    setHoveredAttraction,
    categoryFilter,
    setCategoryFilter,
    infoCardStack,
  }
}
