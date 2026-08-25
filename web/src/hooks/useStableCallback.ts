import { useCallback, useRef } from 'react'

// useStableCallback:回傳一個「參照永遠不變、內部行為永遠是最新版本」的
// 函式包裝——解決「把 callback 放進某個 useEffect/hook 的依賴陣列,結果
// 每次呼叫端重渲染都產生新函式參照,導致該 effect 被誤判成『有新東西
// 要處理』而重新執行」這個反覆出現的問題(實際案例見
// geo-planning/useSearchResultMarkers.ts:使用者拖曳地圖觸發父層
// GeoOutlinePanel.tsx 重渲染,onSearchResultSelect 因此換了參照,連帶
// 讓 marker 建立 effect 誤判成新一批搜尋結果、重新呼叫 fitBounds,造成
// 「拖曳地圖會自動彈回原位」的 bug)。
//
// 做法:用 ref 存最新的 fn(每次渲染更新),對外回傳的是一個只建立一次
// 的穩定函式(useCallback 依賴陣列固定是空陣列),呼叫時才從 ref 讀出
// 當下最新的 fn 執行——呼叫端因此可以放心把回傳值放進任何依賴陣列,
// 不用擔心「這個 callback 有沒有 memo」這件事,也不需要每個消費端各自
// 重寫一份 xxxRef = useRef(xxx); xxxRef.current = xxx 的樣板(見
// GeoOutlineMap.tsx 的 onPoiSelectRef/onCenterChangeRef,這兩處是這個
// 模式抽出來前的既有寫法,保留不動,新的呼叫端建議改用這支 hook)。
//
// 這對應 React 官方提案中的 useEvent/useEffectEvent(尚未正式穩定發布,
// 見 https://react.dev/reference/react/experimental_useEffectEvent)——
// 這裡先用最小可用的手寫版本達到同樣效果,之後若升級到支援官方版本的
// React,可以直接替換成官方 hook,呼叫端寫法不需要改變。
//
// 注意:回傳的穩定函式本身不觸發任何 effect 重新執行(這正是它存在的
// 目的),故它不適合用在「呼叫端真的需要知道 fn 本身變了」的情境——
// 目前 geo-planning 底下的 marker 點擊/選取 callback 皆屬於「純粹要
// 執行最新邏輯,不需要因為邏輯變了就重建 marker」的情境,適用這個模式。
export function useStableCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const fnRef = useRef(fn)
  fnRef.current = fn
  return useCallback((...args: Args) => fnRef.current(...args), [])
}
