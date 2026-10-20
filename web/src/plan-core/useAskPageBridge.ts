// useAskPageBridge — 從 TripPlanPage.tsx/AIPlanTimelinePage.tsx 抽出的
// 共用狀態機:「顯示詢問頁、等待使用者選完、把結果回傳給呼叫端」這組
// Promise 橋接邏輯在兩個檔案裡原本幾乎一模一樣(見各自 openAskPage/
// handleAskPageDone 宣告處的完整說明),分別各寫一份除了重複程式碼,
// 也因為邏輯被包在元件內部,完全無法單獨測試(見
// askPageTools.ts/AskPage.tsx 的測試覆蓋度討論)——抽成獨立 hook 後兩邊
// 改成呼叫它,同時這個檔案自己可以用 renderHook 直接測。
//
// 2026-10(第五輪,使用者明確要求「使用相同的 ask page 外殼,但是內部的
// 詢問元件可以搭配不同的工具顯示不同的項目」):新增 ask_travel_region/
// ask_transport_mode 兩支工具後,這個 hook 的 Result 型別刻意維持固定
// 是 AskPageSelection[](不跟著 Input 一起變成多型),理由:
//
//   - 這兩支新工具語意上是單選,「選中的 id/mode」借用
//     AskPageSelection.placeId 這個欄位表達(選中時回傳長度 1 的陣列,
//     「不用了」回傳空陣列),不是這個 hook 本身认识 region/transport
//     這些具體型別——把轉換(單選值 <-> AskPageSelection[])放在
//     TripPlanPage.tsx 組裝 AskPageCtx.askTravelRegion/
//     askTransportMode 的 wrapper 裡(見該處的完整說明),這個 hook 本身
//     完全不需要改、既有測試也不需要改,三支工具共用同一套「顯示、等待、
//     resolve」機制與同一種「pending 時新呼叫被忽略」保護(見下方
//     「2026-10 訂正」),不會因為新增工具又要重新驗證一次這套競態
//     保護邏輯。
//   - 代價是 placeId 這個命名對 region id/transport mode 而言語意不
//     精準,但換來完全不用碰這個檔案與其測試,評估下來利大於弊——欄位
//     語意的些微不精準,比起重構一個已經過競態測試驗證過的共用狀態機、
//     還要連帶改寫所有既有呼叫點與測試案例,風險小得多。
//
// Input 泛型:TripPlanPage.tsx 支援 { candidates } | { explore } 兩種
// 輸入(真實 AI 工具呼叫,見 askPageTools.ts AskPageCtx 的完整說明),
// AIPlanTimelinePage.tsx 的展示頁劇本(planSimFakeSource.ts)固定只給
// { candidates }(劇本內容是寫死的,見該檔案的完整說明,不適合依賴
// 即時地圖中心/使用者位置的探查模式)——用泛型讓兩邊各自代入自己需要
// 的輸入型別,不互相遷就。
//
// resolve 用 ref 而非 state 存——理由同兩個原檔案的既有說明:resolve
// 函式本身不是要渲染的資料,只是在「openAskPage 呼叫時建立」跟
// 「handleAskPageDone 回呼時使用」這兩個時間點之間傳遞的一個值,存進
// state 會觸發不必要的重渲染,且 React 對「state 存函式」有特殊處理
// (會被當成 updater 呼叫),ref 更直接。
//
// resolve 用完立刻清空 ref——避免同一個 resolve 函式被重複呼叫
// (Promise.resolve 本身雖然冪等,但重複呼叫代表程式邏輯有誤,清空 ref
// 讓「意外重複觸發」在開發階段更容易被察覺,不會被 Promise 的冪等性
// 靜默吞掉)。
//
// 2026-10 訂正:這裡原本假設「連續呼叫兩次 openAskPage 不會真的發生,
// 呼叫端都是 await 完成才呼叫下一次」,但實機測試推翻了這個假設——
// TripPlanPage.tsx 的 onAssistantMessage 在收到純文字回覆時會呼叫
// openAskPage({ text })(見該處的完整說明:讓純文字訊息也統一在
// AskPage 顯示),這個呼叫完全不 await、不知道當下是否已經有一個真正
// 的 open_ask_page 工具呼叫正在等待使用者操作。實機重現過的真實情境:
// LLM 呼叫 open_ask_page 開出候選卡片詢問頁後,緊接著又送出一則文字
// 回覆——第二次呼叫用新的 resolve 覆蓋掉 ref,候選卡片詢問頁瞬間被
// 文字氣泡取代,使用者永遠看不到候選、也永遠無法完成那個工具呼叫
// (Promise 永遠不會 resolve,整個對話卡住)。
//
// 修法:openAskPage 呼叫時先檢查是否已經有 pending 的 resolve——如果
// 有,代表目前正顯示著一個「真正需要使用者操作」的畫面(候選卡片或
// 探查中),新的呼叫不應該搶佔它,直接忽略(立即以空陣列 resolve 自己
// 這次的 Promise,不觸碰 showAskPage/askPageInput,不覆蓋既有的 ref)。
// 這個優先序是刻意的:已經在等待使用者操作的互動,比任何之後才到達
// 的顯示請求更重要,不能被後來者打斷。

import { useCallback, useRef, useState } from 'react'
import type { AskPageSelection } from './askPageTools'

export interface AskPageBridge<Input> {
  showAskPage: boolean
  askPageInput: Input
  openAskPage: (input: Input) => Promise<AskPageSelection[]>
  handleAskPageDone: (selected: AskPageSelection[]) => void
}

export function useAskPageBridge<Input>(defaultInput: Input): AskPageBridge<Input> {
  const [showAskPage, setShowAskPage] = useState(false)
  const [askPageInput, setAskPageInput] = useState<Input>(defaultInput)
  const askPageResolveRef = useRef<((selected: AskPageSelection[]) => void) | null>(null)

  const openAskPage = useCallback((input: Input): Promise<AskPageSelection[]> => {
    // 已有 pending 的呼叫——見上方「2026-10 訂正」的完整說明,不搶佔。
    if (askPageResolveRef.current) {
      return Promise.resolve([])
    }
    setAskPageInput(input)
    setShowAskPage(true)
    return new Promise((resolve) => {
      askPageResolveRef.current = resolve
    })
  }, [])

  const handleAskPageDone = useCallback((selected: AskPageSelection[]) => {
    askPageResolveRef.current?.(selected)
    askPageResolveRef.current = null
    setShowAskPage(false)
  }, [])

  return { showAskPage, askPageInput, openAskPage, handleAskPageDone }
}
