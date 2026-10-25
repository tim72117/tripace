// useAskPageBridge — 從 TripPlanPage.tsx/Content.tsx 抽出的
// 共用狀態機:「顯示詢問頁、等待使用者選完、把結果回傳給呼叫端」這組
// Promise 橋接邏輯在兩個檔案裡原本幾乎一模一樣(見各自 openAskPage/
// handleAskPageDone 宣告處的完整說明),分別各寫一份除了重複程式碼,
// 也因為邏輯被包在元件內部,完全無法單獨測試(見
// asktools.ts/AskPage.tsx 的測試覆蓋度討論)——抽成獨立 hook 後兩邊
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
// 輸入(真實 AI 工具呼叫,見 asktools.ts AskPageCtx 的完整說明),
// planning/preview/Content.tsx 的展示頁劇本(planSimFakeSource.ts)固定只給
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

// 2026-10(狀態模型合併):原本 showAskPage(布林)與 askPageInput 是兩個獨立的 useState,每次轉移要連續呼叫兩個
// setter——「旗標開著但 input 是舊值」「旗標關了 input 還在」這類中間態只是剛好被 React 批次更新蓋掉,型別上完全
// 允許。改成單一個帶標籤的聯集 AskPageState(closed | open 帶 input),四個轉移(open/replace/advance/done)各自
// 只做一次 setState,中間態在型別上就不存在。showAskPage/askPageInput 保留成由它衍生的唯讀值,呼叫端不用改;
// 關閉時 askPageInput 固定回到掛載時的預設值(同一個參照,不會因為呼叫端每次 render 傳新的字面值而變動)。
//
// 等待(resolve)仍然放 ref(理由見上方),但跟狀態綁在一起維護:有 pending ⇔ state 是 open。每個等待帶一個
// 遞增的 id(pendingId()),非同步流程(useAskPageFlow 查景點)用它判斷「我開始時的那個等待是否還在」——
// 期間被別的方式結束或換成新的等待,id 就不同了。

import { useCallback, useRef, useState } from 'react'
import type { AskPageSelection } from './asktools'

export type AskPageState<Input> = { status: 'closed' } | { status: 'open'; input: Input }

const CLOSED: { status: 'closed' } = { status: 'closed' }

export interface AskPageBridge<Input> {
  // askPage——詢問頁的唯一狀態來源。
  askPage: AskPageState<Input>
  // showAskPage/askPageInput——由 askPage 衍生的唯讀值(相容既有呼叫端)。關閉時 askPageInput 是預設值。
  showAskPage: boolean
  askPageInput: Input
  openAskPage: (input: Input) => Promise<AskPageSelection[]>
  handleAskPageDone: (selected: AskPageSelection[]) => void
  // replaceAskPage——原地換頁、不結束等待:只在有 pending 時換掉 input,resolve 原封不動(之後照常由
  // handleAskPageDone 結束)。給「返回上一層」用:城市頁還在等待時,openAskPage 會被上面的不搶佔保護吞掉,
  // 返回按了沒反應(2026-10 修正)。沒有 pending 時不做事、回傳 false——沒有人在等的畫面不該憑空開出來。
  replaceAskPage: (input: Input) => boolean
  // advanceAskPage——結束這一步、立刻換到下一步:以 selected resolve 目前的等待,同一次更新換成 input 並建立新的
  // 等待,詢問頁全程維持 open(不閃回時間軸)。任何時刻仍然最多一個 pending;沒有 pending 時等同 openAskPage。
  advanceAskPage: (selected: AskPageSelection[], input: Input) => Promise<AskPageSelection[]>
  // pendingId——目前等待的識別碼,沒有等待時為 null。replaceAskPage 不換 id;open/advance 開新的等待會換。
  pendingId: () => number | null
}

interface Pending {
  id: number
  resolve: (selected: AskPageSelection[]) => void
}

export function useAskPageBridge<Input>(defaultInput: Input): AskPageBridge<Input> {
  const [askPage, setAskPage] = useState<AskPageState<Input>>(CLOSED)
  // 只取掛載時的預設值:呼叫端常傳字面值({ candidates: [] }),每次 render 都是新參照。
  const [closedInput] = useState(defaultInput)
  const pendingRef = useRef<Pending | null>(null)
  const nextIdRef = useRef(0)

  const startPending = useCallback((): Promise<AskPageSelection[]> => {
    const id = ++nextIdRef.current
    return new Promise((resolve) => {
      pendingRef.current = { id, resolve }
    })
  }, [])

  const openAskPage = useCallback((input: Input): Promise<AskPageSelection[]> => {
    // 已有 pending 的呼叫——見上方「2026-10 訂正」的完整說明,不搶佔。
    if (pendingRef.current) {
      return Promise.resolve([])
    }
    setAskPage({ status: 'open', input })
    return startPending()
  }, [startPending])

  const handleAskPageDone = useCallback((selected: AskPageSelection[]) => {
    const prev = pendingRef.current
    pendingRef.current = null
    prev?.resolve(selected)
    setAskPage(CLOSED)
  }, [])

  const replaceAskPage = useCallback((input: Input): boolean => {
    if (!pendingRef.current) return false
    setAskPage({ status: 'open', input })
    return true
  }, [])

  const advanceAskPage = useCallback((selected: AskPageSelection[], input: Input): Promise<AskPageSelection[]> => {
    const prev = pendingRef.current
    pendingRef.current = null
    prev?.resolve(selected)
    setAskPage({ status: 'open', input })
    return startPending()
  }, [startPending])

  const pendingId = useCallback(() => pendingRef.current?.id ?? null, [])

  return {
    askPage,
    showAskPage: askPage.status === 'open',
    askPageInput: askPage.status === 'open' ? askPage.input : closedInput,
    openAskPage,
    handleAskPageDone,
    replaceAskPage,
    advanceAskPage,
    pendingId,
  }
}
