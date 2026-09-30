import { useCallback, useRef, useState } from 'react'

// useSyncedState — 需要「這次呼叫立刻同步拿到計算結果」時的固定寫法,
// 取代容易踩坑的「setState(updater) 內把結果賦值給外部變數、setState
// 呼叫完緊接著讀那個變數」模式。
//
// 背景(真實 bug,見 AIPlanTimelinePage.tsx 的 insertAttractionAfter 早期
// 版本):setState(updater) 呼叫本身雖然同步返回,但傳入的 updater 函式
// **不保證**在該次呼叫當下就被執行——React 18 對「非 React 事件系統
// 觸發的 setState」(例如原生 WebSocket onmessage、setTimeout、第三方
// SDK 回呼)這件事的排程時機是不可預測的。若寫法是「result 在 updater
// 內賦值、setState 呼叫完就讀 result」,result 讀取當下可能仍是
// undefined——這正是那次真實踩過的坑(add_attraction 每次呼叫都以
// 「Cannot read properties of undefined (reading 'ok')」失敗)。
//
// 根因分析(見那次除錯的完整討論):問題出在把兩個獨立的子需求誤認成
// 同一件事、硬塞進同一個 setState 呼叫解決——「保證讀到最新狀態」跟
// 「同步拿到這次呼叫的計算結果」是兩個不同的保證,前者才是
// setState(updater) 的 prev 參數真正提供的東西,後者必須靠別的機制
// (這裡用 ref)才能可靠取得。
//
// 這個 hook 把「latest-ref 讀寫」這個正確解法收斂成一個可重複使用的
// 固定模式:commit(compute) 直接讀 ref.current(保證是目前為止所有已
// 提交的更新疊加後的最新值,讀寫都收斂在這個 hook 內部、不依賴任何
// React 排程時機)、同步呼叫 compute 算出結果,是否要真的寫入(next
// 有給值)由 compute 自己決定(對應 insertAfter 那種「驗證失敗就不寫」
// 的情境),回傳的 result 保證在 commit() 呼叫當下就已經算好,呼叫端
// 不需要再處理「result 可能還沒算好」這種不確定狀態。
export function useSyncedState<S>(initial: S | (() => S)) {
  const [state, setState] = useState<S>(initial)
  const ref = useRef(state)
  // 在 render 期間直接讀寫 ref(而非用 useEffect 同步)——這是 React
  // 官方認可的「latest ref」模式,讀寫的是同一個 ref 物件本身,不觸發
  // 額外重渲染,也不像 useEffect 那樣要等 commit 完成才執行(理由同
  // AIPlanTimelinePage.tsx 那次踩坑分析:若改用 useEffect 同步 ref,
  // 短時間內連續兩次呼叫 commit 時,第二次呼叫可能發生在 effect 還沒
  // 跑之前,讀到的仍是舊值)。
  if (ref.current !== state) ref.current = state

  // commit 的回傳型別 R 在每次呼叫時由傳入的 compute 決定(而非綁死在
  // useSyncedState 呼叫當下的型別參數)——同一個 timeline state 常常
  // 需要支援兩種呼叫情境:一種只是單純寫入、不需要回傳值(對應原本
  // setState 的用法,R 推導為 void),另一種需要同步拿到結構化的操作
  // 結果(例如 insertAfter 的 InsertAfterResult)。把 R 留在 commit 呼叫
  // 層級泛型化,同一個 hook 實例可以同時承接這兩種情境,不需要為了取得
  // 結果額外建立第二個 state。
  const commit = useCallback(<R,>(compute: (current: S) => { next?: S; result: R }) => {
    const { next, result } = compute(ref.current)
    if (next !== undefined) {
      ref.current = next
      setState(next)
    }
    return result
  }, [])

  return [ref, state, commit] as const
}
