import { setOptions } from '@googlemaps/js-api-loader'
import type { Theme } from '../theme'

// googleMapsBootstrap.ts:ExploreMap.tsx 與 NativeMapBase.tsx 都各自需要
// 「把這個 App 的 Theme 轉成 Google Maps colorScheme」與「setOptions 只
// 呼叫一次」這兩件跟任何單一元件內部狀態都無關的純邏輯——原本兩個檔案
// 各自複製一份完全相同的實作,任何一邊修正(例如 colorScheme 的退化
// 規則、setOptions 的參數)都要記得同步改另一邊,容易漂移。抽成這個共用
// 模組,兩個元件都改成呼叫這裡,不再各自維護一份。
//
// 只抽這兩個純函式,不嘗試把整個建圖 effect(useEffect 內的 guard/
// cancelled/buildingRef 等狀態機邏輯)合併成一個共用 hook——ExploreMap.tsx
// 的建圖 effect 還耦合了 gestureHandling、restriction.strictBounds、
// zoom_changed/bounds_changed/idle 等一系列只有它需要的監聽器與旅程查詢
// 副作用,NativeMapBase.tsx 則是刻意的最小子集(見該檔案開頭說明),
// 兩者的行為範圍本來就不同,勉強合併成一個參數化的大 hook 反而會讓兩邊
// 都要理解對方的分支,不是這裡要解決的重複。

// themeToColorScheme:把這個 App 自己的三態主題偏好(theme.ts 的 Theme,
// 見該檔案說明)轉成 Google Maps JS API 的 colorScheme 建圖選項——官方
// 文件明確規定 colorScheme 只能在 new google.maps.Map(...) 當下設定,
// 建圖之後再改完全無效("setting this option after the map is created
// will have no effect"),故這個轉換結果只會被建圖 effect 讀取一次,不是
// 能動態套用的選項。
//
// null(這個 App 的「跟隨系統」)在 Google 這邊沒有「跟隨這個 App 自己的
// CSS media query 邏輯」這個選項可選,只有 LIGHT/DARK/FOLLOW_SYSTEM
// (跟隨瀏覽器/OS 層級偏好)三選一——這裡選 FOLLOW_SYSTEM 是合理的退化
// 方案:這個 App 的「跟隨系統」本身也是透過瀏覽器 prefers-color-scheme
// media query 實現(見 theme.ts 開頭說明,null 時不寫 data-theme 屬性,
// 交給 CSS 判斷),語意上跟 Google Maps 的 FOLLOW_SYSTEM(同樣讀瀏覽器/
// OS 層級偏好)一致,不會出現「App 本體跟著系統走,地圖卻沒有」的不
// 同步情況。
export function themeToColorScheme(theme: Theme): 'LIGHT' | 'DARK' | 'FOLLOW_SYSTEM' {
  if (theme === 'dark') return 'DARK'
  if (theme === 'light') return 'LIGHT'
  return 'FOLLOW_SYSTEM'
}

let optionsSet = false
export function ensureOptionsSet(apiKey: string) {
  if (optionsSet) return
  optionsSet = true
  // language 未指定時,Google Maps SDK 會依 IP 位置等隱含訊號自動判斷
  // 底圖語言(實測搜尋清邁時整個底圖變成泰文)——這裡明確鎖定繁中,
  // 理由同後端 Places API 呼叫固定 languageCode: zh-TW(見
  // server/internal/geo/places.go),專案介面語言只有繁中。
  setOptions({ key: apiKey, v: 'weekly', language: 'zh-TW' })
}
