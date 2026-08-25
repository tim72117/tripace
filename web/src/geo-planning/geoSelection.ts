import type { GeoSelectedKey } from './GeoHotelSidebar'
import type { GeoInfoContent } from './GeoInfoPanel'
import type { GeoAttraction } from '../api'

// GeoSelection:桌面版/手機版共用的「目前選中哪個地點、該顯示哪張卡片」
// 狀態——合併原本三個各自獨立的 state(geoSelectedKey/geoInfoContent/
// geoAttractionContent),消除「三者必須手動保持一致」的隱性契約。
//
// 背景:原本每次選取都要連續呼叫三個 setter(例如
// setGeoSelectedKey(key)/setGeoAttractionContent(null)/
// setGeoInfoContent(content)),桌面版 7 處、手機版 6 處各自重複這三行,
// 曾經因為漏寫其中一行造成實際 bug(重新搜尋時只清空了 selectedKey,
// GeoInfoPanel 卻沒有跟著關閉,見這裡曾經修過的 commit)。改用判別聯合
// 型別後,一次選取只對應一個物件,不可能出現「key 指向 A、卡片卻顯示 B」
// 或「只清空一半」的中間態——這類錯誤在 reducer 寫錯的當下就會被
// TypeScript 的窮盡性檢查(exhaustive switch)擋下,而不是等到執行期才
// 表現成畫面異常。
//
// kind 'info' 底下 key 為 undefined 的情況(對應原本 onPoiSelect 那個
// 唯一不設 geoSelectedKey 的分支——點擊 Google 原生 POI 圖標查回的
// 地點,不是自建的 hotel/place/attraction 資料,沒有對應的側欄清單項目
// 需要同步標記選取樣式)是刻意保留的既有行為,不是遺漏。
export type GeoSelection =
  | { kind: 'none' }
  | { kind: 'attraction'; key: GeoSelectedKey; data: GeoAttraction }
  | { kind: 'info'; key: GeoSelectedKey | undefined; content: GeoInfoContent }

export type GeoSelectionAction =
  | { type: 'CLEAR' }
  | { type: 'SELECT_ATTRACTION'; key: GeoSelectedKey; data: GeoAttraction }
  | { type: 'SELECT_INFO'; key?: GeoSelectedKey; content: GeoInfoContent }
  // PATCH_INFO_CONTENT:只有目前選取狀態是 'info' 時才生效,用來局部更新
  // 已顯示卡片的部分欄位(見 onGeocodeCandidateText/onGeocodeCandidatePhoto
  // 的既有用法——文字/照片是兩支平行請求,誰先回來就只更新自己負責的
  // 欄位,不覆蓋對方,也不該在使用者已經切到別的選取項目後才回來時誤更新
  // 到不相關的卡片上)。若目前不是 'info' 狀態(例如使用者在請求還沒回來
  // 前就切到別的地點),這個 action 直接被忽略,不會意外把某個不相關的
  // 選取狀態誤轉成 info。
  | { type: 'PATCH_INFO_CONTENT'; patch: (content: GeoInfoContent) => GeoInfoContent }

export function geoSelectionReducer(state: GeoSelection, action: GeoSelectionAction): GeoSelection {
  switch (action.type) {
    case 'CLEAR':
      return { kind: 'none' }
    case 'SELECT_ATTRACTION':
      return { kind: 'attraction', key: action.key, data: action.data }
    case 'SELECT_INFO':
      // 重複選取同一個 key(例如地圖上連續點同一顆 geocode marker 兩次)
      // 時,保留目前已經顯示的內容,不整卡覆蓋回呼叫端傳入的輕量版
      // ——這是實際發生過的 bug:GeoOutlinePanel.tsx 的補查文字/照片
      // effect 依賴 placeId(字串)判斷要不要重查,同一個地點沒變就不會
      // 重查,但這裡若無條件覆蓋,已經補齊的評分/簡介/「加入行程」按鈕
      // 會被清空且永遠不會被補查 effect 復原(該 effect 只在 placeId
      // 真的變動時才觸發)。只有 key 未定義(見 GeoSelection 型別對
      // onPoiSelect 的說明)或跟目前不同時才視為新一次選取、整卡替換。
      if (state.kind === 'info' && action.key != null && action.key === state.key) {
        return state
      }
      return { kind: 'info', key: action.key, content: action.content }
    case 'PATCH_INFO_CONTENT':
      if (state.kind !== 'info') return state
      return { ...state, content: action.patch(state.content) }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

export const GEO_SELECTION_NONE: GeoSelection = { kind: 'none' }

// GeoPanTarget:桌面版(DesktopLayout.tsx 的 geoPanTarget)/手機版
// (GeoOutlinePhoneView.tsx 的 panTarget)共用的「移動地圖」目標型別——
// 兩邊各自持有獨立的 state(不同元件實例,不合併成同一份記憶體),但
// 型別定義完全相同,曾經因為各自宣告一次而在其中一邊漏加欄位(見
// onlyIfOutOfView 的完整說明,GeoOutlineMap.tsx 對這個欄位的說明),
// 抽出共用型別後之後新增欄位只需要改一處,不會再有兩邊定義漂移的風險。
//
// radiusMeters:只有桌面版「探索周邊」按鈕(見 DesktopLayout.tsx 的
// handleExploreAttraction)會帶,手機版目前沒有對應功能,但型別仍保留
// 這個欄位——手機版的 setPanTarget 呼叫端不帶這個欄位即可,不影響
// 型別共用。
//
// onlyIfOutOfView:見 GeoOutlineMap.tsx 對這個欄位的完整說明——true 時
// 先檢查該座標是否已經在可視範圍內,在範圍內就跳過這次移動。
export type GeoPanTarget = {
  lat: number
  lng: number
  radiusMeters?: number
  onlyIfOutOfView?: boolean
}
