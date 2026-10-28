import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { AskPageCandidate, AskPageInput, AskPageSelection, UserSelectionRecord } from '../conversation/asktools'
import type { AskPageBridge } from '../conversation/useAskPageBridge'
import { findTravelCityById, findTravelCountry, type TravelCity } from '../conversation/travelRegionData'

// useAskPageFlow——詢問頁「使用者操作之後」的前端串接(選完國家 → 城市、選完城市 → 查景點 → 景點候選、
// 選完景點 → 請 AI 排行程、返回上一層、詢問頁開著時用下方輸入匡直接說明)。2026-10 從 TripPlanPage.tsx 的 handleAskPageDone/
// handleAskPageBack 抽出來:原本包在一個建立 onagent 連線、依賴 google.maps 的大元件裡完全無法測試,
// 返回上一層按了沒反應、選完城市閃回時間軸這兩個 bug 都藏在這段串接裡。抽出來之後外部依賴全部用參數注入
// (查景點、送出訊息),測試可以接真的 useAskPageBridge 與真的 AskPage 從元件介面操作整條流程
// (見 useAskPageFlow.test.tsx)。
//
// 等待(pending)的規則全部交給 useAskPageBridge:任何時刻最多一個 pending;換頁用 replaceAskPage(不結束等待)
// 或 advanceAskPage(結束這一步、同一次更新換到下一步),不會出現兩個 pending,也不會中間閃一次 showAskPage=false。

// CITY_ASK_LOADING_REASON/CITY_ASK_REASON——選完城市後前端自己開的景點選單沒有 LLM 提供的 reason,
// 固定文案(使用者明確要求「用 選擇感興趣的景點」,不要「台北有哪些景點?」這種問句)。
export const CITY_ASK_REASON = '選擇感興趣的景點'
// PICKED_INTERESTS_PROMPT——選完感興趣景點後送給 AI 的固定一句話(預設流程與「選擇景點」按鈕共用)。
export const PICKED_INTERESTS_PROMPT = '我已經選好感興趣的地點了,請幫我安排行程。'
export function cityAskLoadingReason(city: TravelCity): string {
  return `正在查詢${city.name}的景點…`
}

// 選完城市查景點的「查詢中」顯示時機(2026-10):查詢在 CITY_LOOKUP_LOADING_DELAY_MS 內回來就直接從城市頁換成景點
// 候選,不經過查詢中(快回應時查詢中只會一閃而過,反而像畫面跳了一下);超過才顯示查詢中,而且一旦顯示至少維持
// CITY_LOOKUP_LOADING_MIN_MS,避免剛出現就被換掉。
export const CITY_LOOKUP_LOADING_DELAY_MS = 150
export const CITY_LOOKUP_LOADING_MIN_MS = 300
// 景點查詢沒有逾時(使用者明確要求「不要逾時」):後端或網路一直不回時停在查詢中,使用者可按右上角「不用了」關閉
// (關閉會中止進行中的請求,晚到的結果一律丟棄)。

// ===== 統一啟動(startAsk)=====
// StartAskInput——啟動參數:既有的詢問頁輸入(candidates/explore/country/city/transport/text),再加一種 search:
// 由前端自己查候選(沿用「查詢中」外殼與中止),查完才換成候選頁。選完拿得到名稱(探查模式拿不到)。
export type StartAskInput =
  | AskPageInput
  | { search: (signal: AbortSignal) => Promise<AskPageCandidate[]>; reason?: string }

// AskSelectedCandidate——onDone 收到的選擇;name 只有候選頁(candidates/search)查得到。
export interface AskSelectedCandidate extends AskPageSelection {
  name?: string
}

// StartAskOptions——onDone/onCancel 跟著「這一次詢問」的生命週期:選了至少一個 → onDone;關閉、不用了、被其他方式結束
// (例如用輸入框送出文字)→ onCancel;兩者最多呼叫一個、一次。有給 onDone 時不再走預設的後續
// (記選擇後送「請幫我安排行程」),但仍會寫入 userSelectionRef,讓 AI 之後能用 get_user_selection 查。
export interface StartAskOptions {
  input: StartAskInput
  onDone?: (selected: AskSelectedCandidate[]) => void
  onCancel?: () => void
}

export interface AskPageFlowOptions {
  bridge: Pick<
    AskPageBridge<AskPageInput>,
    'askPageInput' | 'openAskPage' | 'handleAskPageDone' | 'replaceAskPage' | 'advanceAskPage' | 'pendingId'
  >
  // searchCityAttractions——選完城市後查該城市附近的觀光候選(TripPlanPage 接 fetchPlanAiAttractionSearch)。
  // signal——使用者在查詢中按關閉時會 abort;實作可以轉給 fetch 中止請求(不轉也沒關係,結果晚到會被丟棄)。
  searchCityAttractions: (city: TravelCity, signal: AbortSignal) => Promise<AskPageCandidate[]>
  // sendPrompt——「使用者送出一句話」的唯一入口(usePlanAiChatBridge.sendPrompt:conversationID 延續、
  // 推論中併發保護、錯誤訊息)。回傳 true 代表已送出。
  sendPrompt: (text: string) => Promise<boolean>
  // isThinking——AI 是否正在推論;推論中 sendPrompt 會拒絕送出(見 submitAskPageText)。
  isThinking: boolean
  userSelectionRef: MutableRefObject<UserSelectionRecord | null>
  // onAskPageTextNotSent——詢問頁開著時從輸入匡送出的文字(submitAskPageText)最後沒送出去(後端拒絕、網路錯誤、
  // 連線不在)時呼叫,TripPlanPage 把文字放回輸入框,使用者不用重打。
  onAskPageTextNotSent?: (text: string) => void
}

export function useAskPageFlow({
  bridge,
  searchCityAttractions,
  sendPrompt,
  isThinking,
  userSelectionRef,
  onAskPageTextNotSent,
}: AskPageFlowOptions) {
  const { askPageInput, openAskPage, handleAskPageDone: resolveAskPage, replaceAskPage, advanceAskPage, pendingId } = bridge
  // 非同步流程(查景點、延後送出)要讀最新的函式,用 ref 避免閉包抓到舊值。
  const sendPromptRef = useRef(sendPrompt)
  const searchRef = useRef(searchCityAttractions)
  const onNotSentRef = useRef(onAskPageTextNotSent)
  useEffect(() => {
    sendPromptRef.current = sendPrompt
    searchRef.current = searchCityAttractions
    onNotSentRef.current = onAskPageTextNotSent
  })

  // cityLookupHoldRef——選完城市、查詢中還沒顯示的那段時間(最多 CITY_LOOKUP_LOADING_DELAY_MS),城市頁仍在畫面上、
  // 仍是同一個等待;記下那個等待的 id,期間同一個畫面送上來的 onDone/onBack(連點、改點別的城市、按不用了)一律
  // 忽略,不會觸發第二次查詢。等待的 id 一變(被別的方式結束、或已換成查詢中/候選),保護自動失效。
  // sessionRef——startAsk 開的那一次詢問(等待 id + 選完時的候選名稱);id 與目前等待不同代表已過期,一律忽略。
  const sessionRef = useRef<{ id: number; names: Map<string, string> } | null>(null)
  const cityLookupHoldRef = useRef<number | null>(null)
  const isHeldByCityLookup = useCallback(
    () => cityLookupHoldRef.current !== null && cityLookupHoldRef.current === pendingId(),
    [pendingId],
  )
  // 查詢流程排的計時器;卸載時清掉,不在卸載後改狀態。
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t)
      fn()
    }, ms)
    timersRef.current.add(t)
    return t
  }, [])
  const cancel = useCallback((t: ReturnType<typeof setTimeout> | null) => {
    if (t === null) return
    clearTimeout(t)
    timersRef.current.delete(t)
  }, [])
  // activeLookupRef——進行中的「選完城市 → 查景點」流程的中止函式(清掉該流程所有計時器 + abort signal);
  // 查詢中按關閉、查詢中/候選按返回、卸載時呼叫。流程走完(候選已顯示或已收尾)後清成 null。
  const activeLookupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
      activeLookupRef.current?.()
    }
  }, [])

  // handleAskPageDone——使用者在詢問頁按下選擇之後:結束目前這個詢問,並負責前端自己的串接
  // (選完國家 → 城市清單;選完城市 → 查景點 → 景點選單;選完景點 → 送出 prompt)。這些串接都不需要 LLM 參與:
  // LLM 那一輪推論在開啟第一個選單時就結束了(ask_travel_* 不等待)。
  const handleAskPageDone = useCallback(
    (selected: AskPageSelection[]) => {
      if (isHeldByCityLookup()) return
      const input = askPageInput

      // startAsk 開的詢問:自訂結束,不走下面依輸入形狀決定的預設後續。
      const session = sessionRef.current
      if (session && session.id === pendingId()) {
        if ('candidates' in input || 'explore' in input) {
          session.names = new Map(
            ('candidates' in input ? input.candidates : []).flatMap((c) => (c.name ? [[c.placeId, c.name] as const] : [])),
          )
          if (selected.length > 0) {
            userSelectionRef.current = {
              kind: 'attractions',
              items: selected.map((sel) => ({ placeId: sel.placeId, attractionId: sel.attractionId, name: session.names.get(sel.placeId) })),
              selectedAt: new Date().toISOString(),
            }
          }
        }
        resolveAskPage(selected)
        return
      }

      // 查詢中按右上角關閉(onDone([])):結束等待之外,也中止進行中的查詢(之後晚到的結果本來就會因等待 id 不同被丟棄,
      // 這裡是不讓請求白白跑完、計時器也一併清掉)。
      if ('candidates' in input && input.loading) activeLookupRef.current?.()

      // 選完城市要「不關閉詢問頁、立刻顯示查詢中」(見下方),所以不在這裡先 resolve。
      const continuesToCityLookup = 'city' in input && !!selected[0]?.placeId && !!findTravelCityById(selected[0].placeId)
      if (!continuesToCityLookup) resolveAskPage(selected)

      // 純文字氣泡不是一次「選擇」,不寫進 userSelectionRef(關閉鈕也走 onDone([]),不擋會把剛剛真實的選擇
      // 覆寫成「景點一個都沒選」)。
      if ('text' in input) return
      // 景點候選/探查/查詢中按關閉(onDone([]))同理:是「不用了」不是一次選擇,不覆寫剛記下的城市選擇
      // (同 submitAskPageText 的取捨)。之後也不會送 prompt(一個都沒選不送),直接結束。
      if (('candidates' in input || 'explore' in input) && selected.length === 0) return

      // 記下這次選擇,供 get_user_selection 查詢。kind 由當下詢問頁的形態決定;country/city 都歸為 'region'。
      // name 依形態回查:candidates 從畫面上的候選清單、country/city 從 travelRegionData、transport 本身就是值;
      // explore 的候選由 AskPage 內部自己查,這一層拿不到名稱(仍是 undefined)。
      const selectionKind: UserSelectionRecord['kind'] =
        'country' in input || 'city' in input
          ? 'region'
          : 'transport' in input ? 'transport' : 'attractions'
      const candidateNames = new Map(
        ('candidates' in input ? input.candidates : []).map((c) => [c.placeId, c.name]),
      )
      userSelectionRef.current = {
        kind: selectionKind,
        items: selected.map((sel) => {
          // transport——useAskPageBridge 借用 placeId 欄位表達選中的值,到這一層轉回 UserSelectionRecord 的 value,
          // 否則 LLM 會讀到一個叫 placeId 的 'car'。
          if (selectionKind === 'transport') {
            return { value: sel.placeId, name: sel.placeId }
          }
          if (selectionKind === 'region') {
            const name = 'country' in input
              ? findTravelCountry(sel.placeId)?.name
              : findTravelCityById(sel.placeId)?.name
            return { value: sel.placeId, name }
          }
          return {
            placeId: sel.placeId,
            attractionId: sel.attractionId,
            name: candidateNames.get(sel.placeId),
          }
        }),
        selectedAt: new Date().toISOString(),
      }

      // 選完感興趣景點 → 送出一句 prompt 請 AI 排行程。走 sendPrompt(使用者送出一句話的唯一入口)。
      // prompt 刻意不寫地點名稱,讓 LLM 用 get_user_selection 查(名稱不是穩定識別碼、選擇可能改、explore 拿不到名稱);
      // 其餘排程規則交給 thought.md(使用者明確要求「不要有其他指示」)。一個都沒選(「不用了」)不送。
      if ('candidates' in input || 'explore' in input) {
        if (selected.length === 0) return
        void sendPromptRef.current(PICKED_INTERESTS_PROMPT)
        return
      }

      // 選完國家 → 自動開啟該國城市清單,帶 back 讓使用者能返回這份國家清單(見 AskPageCityInput.back)。
      if ('country' in input) {
        const selectedCountryId = selected[0]?.placeId
        if (!selectedCountryId) return
        void openAskPage({
          city: { countryId: selectedCountryId, back: { countryIds: input.country.countryIds } },
        })
        return
      }

      // 選完城市 → 查景點 → 景點候選,整段詢問頁不關閉(2026-10 修正:原本先 resolve 關掉詢問頁再 await 查詢,
      // 等待期畫面閃回空的時間軸)。
      //
      // 時序(常數見檔案上方):
      //   - 查詢在 CITY_LOOKUP_LOADING_DELAY_MS 內回來:城市頁直接 advanceAskPage 成景點候選(以城市的選擇結束城市頁
      //     的等待、同一次更新開出候選頁的等待),不經過查詢中。這段期間城市頁仍在畫面上,由 cityLookupHoldRef 擋掉
      //     重複點擊。
      //   - 超過才 advanceAskPage 成「查詢中」;查詢中與之後的景點候選共用這一個等待(replaceAskPage 原地換),
      //     且查詢中至少顯示 CITY_LOOKUP_LOADING_MIN_MS,結果早到就等滿再換。
      //   - 任何時候等待的 id 跟預期不同(使用者打字送出新訊息會以空陣列結束它、查詢中按了關閉……),查完就不再把
      //     結果塞回一個已經不屬於這次流程的畫面。
      //
      // 查詢失敗或沒有任何候選:維持原本的行為——不開景點選單、收起詢問頁回到時間軸,不另外提示
      // (原本就是「選完城市之後沒有下文」,這次只修閃爍,不改語意)。
      if (!continuesToCityLookup) return
      const city = findTravelCityById(selected[0].placeId)!
      // back——查詢中與候選都帶上當時的城市頁 input,讓使用者能返回這個城市頁(見 asktools.ts AskPageCandidatesBack)。
      const back = { city: input.city }
      const cityPendingId = pendingId()
      cityLookupHoldRef.current = cityPendingId
      const releaseHold = () => {
        if (cityLookupHoldRef.current === cityPendingId) cityLookupHoldRef.current = null
      }

      type Outcome = { candidates: AskPageCandidate[] }
      let outcome: Outcome | null = null
      // cancelled——整段流程被中止(查詢中/候選按返回、查詢中按關閉、卸載):之後所有計時器與晚到的結果一律不動作。
      // 只靠「等待 id 不同」擋不住返回:返回用 replaceAskPage 換回城市頁,等待 id 不變,查詢中的最短顯示到期時
      // 仍會把候選塞回,所以返回一定要經過 cancelFlow。
      let cancelled = false
      const controller = new AbortController()
      let loadingTimer: ReturnType<typeof setTimeout> | null = null
      let minTimer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (activeLookupRef.current === cancelFlow) activeLookupRef.current = null
      }
      // cancelFlow——清掉這次流程的所有計時器(150ms 延遲顯示、300ms 最短顯示)並 abort 請求。
      const cancelFlow = () => {
        cancelled = true
        cancel(loadingTimer)
        cancel(minTimer)
        releaseHold()
        controller.abort()
        finish()
      }
      activeLookupRef.current = cancelFlow
      // loadingPendingId——查詢中這一頁的等待 id;null 代表查詢中還沒顯示。
      let loadingPendingId: number | null = null
      let minElapsed = false

      const applyAfterLoading = () => {
        if (cancelled || !outcome || !minElapsed || loadingPendingId === null) return
        finish()
        if (pendingId() !== loadingPendingId) return
        if (outcome.candidates.length === 0) {
          resolveAskPage([])
          return
        }
        replaceAskPage({ candidates: outcome.candidates, reason: CITY_ASK_REASON, back })
      }

      loadingTimer = schedule(() => {
        loadingTimer = null
        releaseHold()
        if (cancelled) return
        if (pendingId() !== cityPendingId) {
          cancelFlow()
          return
        }
        void advanceAskPage(selected, { candidates: [], reason: cityAskLoadingReason(city), loading: true, back })
        loadingPendingId = pendingId()
        minTimer = schedule(() => {
          minTimer = null
          minElapsed = true
          applyAfterLoading()
        }, CITY_LOOKUP_LOADING_MIN_MS)
      }, CITY_LOOKUP_LOADING_DELAY_MS)

      const settle = (candidates: AskPageCandidate[]) => {
        if (cancelled || outcome) return
        outcome = { candidates }
        if (loadingPendingId !== null) {
          applyAfterLoading()
          return
        }
        // 查詢中還沒顯示:快回應,直接從城市頁換過去。
        cancel(loadingTimer)
        loadingTimer = null
        releaseHold()
        finish()
        if (pendingId() !== cityPendingId) return
        if (candidates.length === 0) {
          resolveAskPage(selected)
          return
        }
        void advanceAskPage(selected, { candidates, reason: CITY_ASK_REASON, back })
      }

      void (async () => {
        let candidates: AskPageCandidate[] = []
        try {
          candidates = await searchRef.current(city, controller.signal)
        } catch {
          candidates = []
        }
        // 使用者已關閉或返回(abort):不再處理這次結果。
        if (controller.signal.aborted) return
        settle(candidates)
      })()
    },
    [askPageInput, resolveAskPage, openAskPage, advanceAskPage, replaceAskPage, userSelectionRef, pendingId, isHeldByCityLookup, schedule, cancel],
  )

  // handleAskPageBack——「返回上一層」:不是結束詢問,原地換回上一層(replaceAskPage 不動等待,之後在上一層照常選擇時
  // 由 handleAskPageDone 結束這個等待並往下開)。依目前的 input 決定回哪:
  //   - 景點候選/查詢中(input.back 有值,2026-10 新增):換回當時的城市頁(back.city 原樣重現,城市頁自己的返回仍在)。
  //     進行中的景點查詢一併中止(activeLookupRef:清掉 150ms 延遲顯示、300ms 最短顯示計時器並 abort),
  //     晚到的結果不會再把候選塞回。已記下的城市選擇(userSelectionRef)不清,使用者重選城市時會被覆蓋。
  //   - 城市頁:換回國家頁(countryIds 原樣重現選國家當時的篩選)。2026-10 修正:原本走 openAskPage,但城市頁本身
  //     還在等待中,openAskPage 的不搶佔保護直接忽略這次呼叫,按了沒反應。
  const handleAskPageBack = useCallback(
    (countryIds?: string[]) => {
      if (isHeldByCityLookup()) return
      const input = askPageInput
      if ('candidates' in input && input.back) {
        activeLookupRef.current?.()
        replaceAskPage({ city: input.back.city })
        return
      }
      if (replaceAskPage({ country: { countryIds } })) return
      // 理論上城市頁一定在等待中;保險起見,沒有 pending 時退回一般的開啟。
      void openAskPage({ country: { countryIds } })
    },
    [askPageInput, replaceAskPage, openAskPage, isHeldByCityLookup],
  )

  // submitAskPageText——詢問頁(國家/城市/交通/景點候選/探查)開著時,使用者不點卡片、改從下方輸入匡打字送出。
  // 2026-10 由景點候選頁的「我要直接說明」(按鈕 + 展開的說明面板,已移除)改名而來;呼叫端是 TripPlanPage 的輸入匡
  // 送出路徑,由 composerMode.ts 的 routeComposerSubmit 判斷「目前有等待使用者的詢問頁」時才走這裡,否則走一般 sendPrompt。
  // 1. 結束目前的詢問頁,等同「不用了」:以空陣列 resolve 等待中的工具呼叫(open_ask_page 回給 LLM「使用者沒選」)。
  //    不寫 userSelectionRef——使用者沒有做出卡片選擇,不該把上一次真實的選擇覆寫成「景點一個都沒選」。
  // 2. 把文字(去前後空白)當成使用者新的一則訊息,走跟輸入框一般送出完全同一條 sendPrompt。
  // 推論中(isThinking)sendPrompt 會拒絕送出(pendingChatRef 的 FIFO 配對依賴任何時刻最多一筆 pending):
  // 例如 LLM 用 open_ask_page 開出候選、工具還在等使用者,這一輪推論尚未結束。此時先記下文字,等這一輪結束
  // (isThinking 轉回 false,LLM 收到「使用者沒選」後回覆)再自動送出,不要求使用者自己重打。
  // 已知風險(目前維持、尚未處理):排隊期間 LLM 若又開了新的詢問頁,自動送出時 sendPrompt 會把它關掉;
  // 使用者按停止或連線重連後(isThinking 轉回 false)排隊的文字仍會自動送出。
  // 最後沒送出去(後端拒絕、網路錯誤、連線不在)時交給 onAskPageTextNotSent(放回輸入框)。
  const queuedTextRef = useRef<string | null>(null)
  const sendText = useCallback((text: string) => {
    void sendPromptRef.current(text).then((sent) => {
      if (!sent) onNotSentRef.current?.(text)
    })
  }, [])
  const submitAskPageText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      resolveAskPage([])
      if (isThinking) {
        queuedTextRef.current = trimmed
        return
      }
      sendText(trimmed)
    },
    [resolveAskPage, isThinking, sendText],
  )
  useEffect(() => {
    if (isThinking) return
    const queued = queuedTextRef.current
    if (queued === null) return
    queuedTextRef.current = null
    sendText(queued)
  }, [isThinking, sendText])

  // startAsk——統一的啟動入口:帶入啟動參數(input)與結束回呼(onDone/onCancel)。回傳 false 代表已有詢問頁在等待,這次沒開
  // (與 openAskPage「不搶佔」的規則一致),回呼不會被呼叫。
  const startAsk = useCallback(
    ({ input, onDone, onCancel }: StartAskOptions): boolean => {
      if (pendingId() !== null) return false
      const searchSource = 'search' in input ? input : null
      const openInput: AskPageInput = searchSource
        ? { candidates: [], reason: searchSource.reason, loading: true }
        : (input as AskPageInput)
      const ended = openAskPage(openInput)
      const id = pendingId()
      if (id === null) return false
      const session = { id, names: new Map<string, string>() }
      sessionRef.current = session
      const controller = new AbortController()

      // 詢問結束(不論用哪種方式)才會 resolve:中止進行中的查詢,再依結果呼叫回呼。
      void ended.then((selected) => {
        controller.abort()
        if (sessionRef.current === session) sessionRef.current = null
        if (selected.length > 0) {
          onDone?.(selected.map((sel) => ({ ...sel, name: session.names.get(sel.placeId) })))
        } else {
          onCancel?.()
        }
      })

      if (searchSource) {
        const alive = () => !controller.signal.aborted && pendingId() === id
        searchSource
          .search(controller.signal)
          .then((candidates) => {
            if (!alive()) return
            if (candidates.length === 0) resolveAskPage([])
            else replaceAskPage({ candidates, reason: searchSource.reason })
          })
          .catch(() => {
            if (alive()) resolveAskPage([])
          })
      }
      return true
    },
    [openAskPage, pendingId, replaceAskPage, resolveAskPage, schedule, cancel],
  )

  return { handleAskPageDone, handleAskPageBack, submitAskPageText, startAsk }
}
