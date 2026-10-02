import { useCallback, useEffect, useState } from 'react'
import type { GeoAttraction, GeoPlaceDetails, GeoPlacePhotoAssets } from '../api'
import { attractionToInfoContent, poiInfoContent } from './geoInfoContent'
import { hasAnyPhoto, PHOTO_RETRY_DELAY_MS, PHOTO_RETRY_MAX_ATTEMPTS } from '../photoRetry'
import type { PlaceInfoContent } from './PlacePanel'
import { useInfoCardStack, useInfoCardStackSync, type InfoCardStack } from './useInfoCardStack'
import type { CuratedCategory } from './geoCuratedCategoryStub'

// useThemeAttractionSelection:主題卡(AttractionInfoPanel)開著時,跟它
// 並存/附掛的一組狀態與 reset 邏輯——DesktopLayout.tsx(正式功能)與
// InteractiveExploreMap.tsx(公開展示頁)原本各自獨立手寫了一份幾乎同構的
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
//     ——兩邊的 pool 來源、null vs 空 Set 語意本來就刻意不同(正式版是
//     地圖可視範圍查詢結果,展示頁是固定城市查詢的全部非主題點;2026-09
//     以前正式版還會額外 slice 前 5 筆,現已拿掉這個上限,見
//     DesktopLayout.tsx NEARBY_ATTRACTION_LIMIT 的完整說明,兩邊現在都是
//     不限筆數、只依距離排序),硬抽會需要 excludeSelf/revealMode 這類
//     旗標,反而讓呼叫端比原本的兩份各自 8-10 行 useMemo 更難讀。這兩塊
//     沒有 effect、沒有時序問題,不會像 reset effect 那樣「忘了寫就出
//     bug」,留在各自檔案更清楚。
//   - searchResults 登記/`geo.setGeocodeCandidates([])` 反向清空——正式
//     版獨有(搜尋框),展示頁沒有這個第三方卡片。
//   - shiftBy/attractionPanelRightPx——展示頁沒有對話小匡/飯店側欄。
//   - handleAttractionOpenPlaceDetails/handleAttractionOpenPlaceWithoutGoogle
//     的「主題卡開著→並存;沒開著→走 geo.selectPoi 互斥路徑」分岔——
//     展示頁刻意沒有互斥路徑(精選點一律走並存),這個分岔邏輯留在
//     DesktopLayout.tsx,只是分岔的兩個分支都改呼叫這支 hook 回傳的
//     setPoiContent。
// PHOTO_RETRY_DELAY_MS/PHOTO_RETRY_MAX_ATTEMPTS:後端 handleGeoPlaceDetails
// 的漸進補圖是背景 goroutine(見該函式的完整說明),這次查詢的回應不會
// 等下載完成,新照片要等下一次查詢才看得到——若這次查回來三個照片欄位
// (photoUrl/googlePhotoUrls/pexelsPhotoUrls)都是空的,很可能是背景補圖
// 剛好還沒做完(尤其是這個 placeId 第一次被查詢的情況,見該函式說明「初次
// 查詢幾乎必定觸發背景下載」),故在前端補一段「原地重查」:每隔 2 秒
// 重新查一次目前的照片狀態,最多重試 3 次,查到任一張圖就停止。不是
// 無限重試——重試次數用完後仍然沒圖,就維持顯示 placeholder(理由同
// attractionToInfoContent 的「不回退任何舊表資料」設計,寧可暫時無圖也
// 不假造資料),使用者可以手動重新開卡觸發下一輪查詢。
//
// 這段重試只針對「照片」,不影響卡片本身的顯示時機——見下方
// fetchPoiContent 的 onUpdate 參數說明,卡片名稱/地址/簡介等文字內容
// 第一次查詢完就交給呼叫端顯示,不會被這裡的重試拖慢。
//
// 重試不能重複呼叫 fetchPlaceDetails(2026-09 使用者明確要求「重試時
// 只能取圖,不能觸發補圖」)——fetchGeoPlaceDetails/fetchPublicGeoPlaceDetails
// 對應的後端 handleGeoPlaceDetails 每次呼叫都會執行
// IncrementPlaceClickCount,連續重試會重複推進漸進補圖節奏判斷(見該
// 函式 shouldAddGooglePlacePhoto 的完整說明),不是單純的唯讀查詢。故
// 只有第一次查詢用 fetchPlaceDetails,之後的重試改呼叫下方
// fetchPlaceDetails 的第三個參數 fetchPhotoAssets(對應後端
// GET .../geo/place-photo-assets,純讀 photo_assets,不觸發任何點擊計數
// /補圖決策,見該端點的完整說明)。
//
// PHOTO_RETRY_DELAY_MS/PHOTO_RETRY_MAX_ATTEMPTS/hasAnyPhoto 改從
// ../photoRetry 匯入(2026-10 code review 發現這裡跟
// trip-plan/TripPlanPage.tsx 的 retryPhotoOnly 重複定義同一套數值/
// 判斷邏輯,見該模組檔頭的完整說明)——重試迴圈本身(下方
// retryWithPhotoAssetsOnly)仍留在這裡,不抽成共用函式,理由同樣見
// photoRetry.ts 檔頭說明。
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// fetchPoiContent:「有 placeId 時查 fetchPlaceDetails,成功用
// poiInfoContent(details)當主要內容、附加 attraction.summary;沒有
// placeId 或查詢失敗時退回 attractionToInfoContent」這段查詢邏輯本身,
// 抽成不依賴 React state 的獨立函式——供這支 hook 的 openPoiContent
// (桌面版/展示頁的並存地點卡)與 GeoOutlinePhoneView.tsx(手機版附近
// 景點清單,push 一層新 sheet 顯示,見該檔案的完整說明)共用同一段查詢
// /fallback 規則,不需要手機版也接整支 useThemeAttractionSelection
// (手機版沒有 hoveredAttraction/infoCardStack 這兩個概念,見下方檔頭
// 說明,硬接會多出死欄位)。
//
// 回傳 Promise(resolve 最終內容,含重試後的最新照片結果)供需要「最終
// 結果」的呼叫端使用;第三個選填參數 onUpdate 則是「第一次查詢完成
// (不論有沒有照片)立刻呼叫一次,之後每次重試查到新結果(不論有沒有
// 照片)也會再呼叫」——2026-09 新增,用意是讓卡片本身(名稱/地址/簡介
// 等文字)不被沒圖時的重試拖慢顯示時機:呼叫端應該用這個 callback 觸發
// 「顯示卡片」,而不是等整個 Promise resolve,重試只補新的照片結果,不
// 該延後卡片出現的時間點。呼叫端若同時需要在 onUpdate 第一次呼叫時做
// 「開卡」這類只該發生一次的動作(例如 GeoOutlinePhoneView.tsx 的
// sheetStack.push),自行用一個旗標判斷「這是不是第一次呼叫」,這支函式
// 不假設呼叫端的用途。
//
// fetchPhotoAssets:第一次查詢沒有照片時,後續重試改呼叫這支函式(對應
// GET .../geo/place-photo-assets,見上方 PHOTO_RETRY_* 的完整說明)而非
// 再次呼叫 fetchPlaceDetails——呼叫端已經 bind 好 cfg 的純讀查詢函式,
// 對稱 fetchPlaceDetails 參數:正式版傳
// (placeId) => fetchGeoPlacePhotoAssets(cfg, placeId),展示頁傳
// (placeId) => fetchPublicGeoPlacePhotoAssets(GUEST_CFG, placeId)。
export function fetchPoiContent(
  attraction: GeoAttraction,
  fetchPlaceDetails: (placeId: string) => Promise<GeoPlaceDetails>,
  onUpdate?: (content: PlaceInfoContent) => void,
  fetchPhotoAssets?: (placeId: string) => Promise<GeoPlacePhotoAssets>,
): Promise<PlaceInfoContent> {
  if (!attraction.placeId) {
    const content = attractionToInfoContent(attraction)
    onUpdate?.(content)
    return Promise.resolve(content)
  }
  const placeId = attraction.placeId

  const retryWithPhotoAssetsOnly = (
    remainingRetries: number,
    base: PlaceInfoContent,
  ): Promise<PlaceInfoContent> => {
    if (remainingRetries <= 0 || !fetchPhotoAssets) return Promise.resolve(base)
    return sleep(PHOTO_RETRY_DELAY_MS)
      .then(() => fetchPhotoAssets(placeId))
      .then((photoAssets) => {
        if (!hasAnyPhoto(photoAssets)) {
          return retryWithPhotoAssetsOnly(remainingRetries - 1, base)
        }
        const content: PlaceInfoContent = {
          ...base,
          photoUrl: photoAssets.photoUrl,
          googlePhotoUrls: photoAssets.googlePhotoUrls,
        }
        onUpdate?.(content)
        return content
      })
      // 純讀端點查詢失敗(網路問題等)時,視同這次沒查到圖,不中斷剩餘
      // 重試次數,也不 fallback 回 attractionToInfoContent——base 本身
      // (第一次查詢的文字內容)已經是有效內容,不該因為單次重試失敗就
      // 整張卡片退回精簡版。
      .catch(() => retryWithPhotoAssetsOnly(remainingRetries - 1, base))
  }

  return fetchPlaceDetails(placeId)
    .then((details) => {
      const content = poiInfoContent(details)
      content.attractionSummary = attraction.summary
      onUpdate?.(content)
      if (hasAnyPhoto(content)) return content
      return retryWithPhotoAssetsOnly(PHOTO_RETRY_MAX_ATTEMPTS, content)
    })
    .catch(() => {
      const content = attractionToInfoContent(attraction)
      onUpdate?.(content)
      return content
    })
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
  //   - 展示頁(InteractiveExploreMap.tsx)傳 openThemeName 字串——展示頁的
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
  // fetchPhotoAssets:同樣由呼叫端 bind 好 cfg,見 fetchPoiContent 該參數
  // 的完整說明——沒圖時的重試改打這支純讀端點,不會重複觸發
  // fetchPlaceDetails 背後的點擊計數/漸進補圖決策。
  fetchPhotoAssets?: (placeId: string) => Promise<GeoPlacePhotoAssets>,
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
  // 未帶時預設 false(等同沒有額外分支)——展示頁(InteractiveExploreMap.tsx)
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

  // onUpdate 直接傳 setPoiContent——第一次呼叫(卡片文字內容查完)就立刻
  // 顯示卡片,之後查到新照片(重試命中)再次呼叫時原地更新同一張卡片,不
  // 需要額外判斷「這是不是第一次」,setPoiContent 本身冪等,重複設定同一
  // 張卡片的內容沒有副作用(見 fetchPoiContent 的 onUpdate 完整說明)。
  const openPoiContent = useCallback((attraction: GeoAttraction) => {
    fetchPoiContent(attraction, fetchPlaceDetails, setPoiContent, fetchPhotoAssets)
  }, [fetchPlaceDetails, fetchPhotoAssets])

  // 主題卡切換(themeKey 變動,含關閉整張主題卡回到 null)時一併清掉
  // poiContent/hoveredAttraction/categoryFilter——三者都是依附在目前
  // 開著的主題點底下的暫時性狀態,換一個主題點/關掉主題卡後,原本疊在
  // 舊主題卡左側的地點卡、地圖上展開成照片的圓點、篩選條件都沒有繼續
  // 存在的意義,避免殘留舊主題底下留下的狀態污染新主題。
  //
  // 這正是抽出這支 hook 要解決的核心問題:原本展示頁(InteractiveExploreMap.tsx)
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
