// useSheetStack:管理多個 PhoneBottomSheet 之間的開啟順序與「原路返回」
// 行為的堆疊(navigation stack)——這次要解決的具體問題是地理輪廓底圖
// 手機版(geo-planning/GeoOutlinePhoneView.tsx)的一個真實 bug:地點清單
// 抽屜(GeoOutlinePhoneListDrawer)打開後,點清單項目會直接關閉清單、打開
// 資訊卡(GeoOutlinePhoneInfoSheet),但資訊卡的關閉鈕只是清空選取狀態
// (geo.clearSelection),完全沒有「回到清單」這個動作——使用者從清單點
// 進資訊卡,關掉資訊卡後清單不會自動重新打開,體感是「東西憑空消失」。
//
// 這是一個真正的導覽(navigation)行為,不是單純的「哪個 sheet 現在該顯示
// true/false」——需要記住「怎麼走到這一層的」,關閉時才知道該退回哪一層,
// 而不是退回某個寫死的固定畫面。故選擇堆疊(stack)模式,而非更輕量的
// 衍生狀態(單一 activePanel 列舉值)——衍生狀態沒有「上一步是什麼」的
// 記憶,無法表達「原路返回」,只能表達「該顯示哪個固定畫面」。
//
// 泛型 T 由呼叫端決定堆疊項目的形狀(例如
// GeoOutlinePhoneView.tsx 會定義一個 union type,區分清單/資訊卡/候選籃/
// 旅程清單/時間軸五種項目,各自帶各自需要的資料),這個 hook 本身不關心
// T 的內容,只負責陣列本身的 push/pop/replace/clear 操作與「目前最上層是
// 誰」的衍生值——保持這個 hook 對「sheet 的種類有哪些」完全無知,新增/
// 移除某種 sheet 只需要改呼叫端的 union type,不需要動這個檔案。
import { useCallback, useMemo, useState } from 'react'

export interface UseSheetStackResult<T> {
  // stack:目前的完整堆疊,索引 0 是最底層(最早 push 的),最後一項是
  // 目前顯示在最上層、真正接收手勢互動的那一個(見 top)。
  stack: T[]
  // top:堆疊最上層的項目,stack 為空時是 undefined——呼叫端據此判斷
  // 「目前該顯示哪個 sheet 為 topmost(接收手勢、正常不透明度)」。
  top: T | undefined
  // push:在堆疊頂端疊加一個新項目(例如清單 → 點項目 → push 資訊卡)。
  // 不會影響堆疊中既有的項目,底下的項目維持原樣、只是不再是 top。
  push: (entry: T) => void
  // pop:移除堆疊頂端的項目,自動露出下一層(若有)——對應「關閉目前這一
  // 層,回到上一層」的使用者動作(例如資訊卡的關閉鈕)。堆疊已空時是
  // no-op,不會拋錯——呼叫端不需要自行判斷堆疊是否為空才能安全呼叫。
  pop: () => void
  // replace:把堆疊頂端換成另一個項目,不增加堆疊深度——用於「同一層內
  // 切換內容」的情境(例如清單裡點另一個項目,資訊卡內容換掉,但『上一層
  // 是清單』這件事不因此多疊一層)。堆疊已空時等同 push。
  replace: (entry: T) => void
  // closeAll:清空整個堆疊,回到「什麼都沒開」的狀態——用於使用者主動
  // 觸發一個跟目前導覽路徑無關的新動作時(例如重新搜尋,見
  // GeoOutlinePhoneView.tsx 對應的說明),不該讓舊的堆疊殘留造成困惑。
  closeAll: () => void
  // depth:堆疊項目數——供呼叫端(PhoneBottomSheet 的 isTopmost prop)
  // 判斷某個特定項目是不是堆疊中的最後一個,不需要自己重新算 stack.length。
  depth: number
}

export function useSheetStack<T>(): UseSheetStackResult<T> {
  const [stack, setStack] = useState<T[]>([])

  const push = useCallback((entry: T) => {
    setStack((s) => [...s, entry])
  }, [])

  const pop = useCallback(() => {
    setStack((s) => (s.length === 0 ? s : s.slice(0, -1)))
  }, [])

  const replace = useCallback((entry: T) => {
    setStack((s) => (s.length === 0 ? [entry] : [...s.slice(0, -1), entry]))
  }, [])

  const closeAll = useCallback(() => {
    setStack([])
  }, [])

  const top = stack[stack.length - 1]
  const depth = stack.length

  return useMemo(
    () => ({ stack, top, push, pop, replace, closeAll, depth }),
    [stack, top, push, pop, replace, closeAll, depth],
  )
}
