import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import type { ClientConfig } from '../api'
import * as api from '../api'
import type { Entry } from '../types'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import {
  listAllTripBatches,
  listMessageRecommendedPlaces,
  listMessages,
  listMessageTripListKeys,
  replaceTripBatch,
} from '../deviceDB'
import { ErrorBanner, errMsg, isSubmitEnter } from '../AppCommon'
import type { TaskPlaceholder } from '../timeline/Timeline'
import type { TripBatches, TripEntry } from '../clienttools/tripEntryTools'
import { ASSISTANT_ID, ENTRY_QUERY_BATCH_KEY, type ChatMessage } from './chatTypes'
import { AskUserSheet, AskChoiceSheet, type AskChoiceOption } from './AskSheets'
import { MessageBubble } from './MessageBubble'
import { useOnagentChatBridge } from './useOnagentChatBridge'
import styles from './ChatScreen.module.css'

// mergeTripEntriesById 把 incoming 依 id 合併進 base:id 已存在於 base 就用
// incoming 該筆覆寫(更新),id 不存在就附加到尾端(新增);base 裡這次
// incoming 沒有的其他項目原樣保留、不受影響。用於 entry_query 查詢結果
// (entries_loaded 事件)合併進 ENTRY_QUERY_BATCH_KEY 這個批次——查詢範圍外、
// 使用者可能已在前端編輯過但尚未存回後端的項目不能被這次查詢結果蓋掉。
function mergeTripEntriesById(base: TripEntry[], incoming: TripEntry[]): TripEntry[] {
  const next = base.map((e) => {
    const updated = incoming.find((i) => i.id === e.id)
    return updated ?? e
  })
  const baseIds = new Set(base.map((e) => e.id))
  const additions = incoming.filter((i) => !baseIds.has(i.id))
  return [...next, ...additions]
}

// DesktopTimelineMirror:桌面版時間軸所需的資料快照,由 ChatScreen 透過
// desktopChat.onTimelineData 鏡像給外層 DesktopContent(見下方 useEffect)。
// refetchEntries 讓 side panel 裡的 MultiTrackTimeline 在手動編輯(onEntryUpdated)
// 後能觸發 ChatScreen 內部重抓,不必讓 panel 自己另開一份資料來源。
export type DesktopTimelineMirror = {
  entries: Entry[]
  updatingEntryIDs: Set<string>
  taskPlaceholders: TaskPlaceholder[]
  refetchEntries: () => void
}

// desktopChat:非 undefined 時代表目前在桌面模式(由 DesktopContent 傳入)——
// 主區不渲染時間軸、改把時間軸資料透過 onTimelineData 鏡像給外層 side panel。
// 手機路徑完全不傳這個 prop,行為與改版前一致。
export interface DesktopChatOptions {
  onTimelineData: (data: DesktopTimelineMirror) => void
}

export function ChatScreen({
  cfg,
  trip,
  user,
  // onBack/onOpenDrawer/mobileHeader:navbar 移除後(見下方 JSX 的說明)
  // 這三個 prop 在元件內部已經沒有消費點,但簽章保留不動——PhoneContent.tsx
  // 仍在傳值,屬於手機版既有 API 的一部分,不在這次「移除桌面對話小匡
  // navbar」的範圍內清理,解構時用底線前綴避免 noUnusedParameters 報錯。
  onBack: _onBack,
  onOpenDrawer: _onOpenDrawer,
  mobileHeader: _mobileHeader,
  onTimelineData,
  desktopChat,
}: {
  cfg: ClientConfig
  // trip:可不傳——對話小匡在使用者尚未選定/建立行程時仍要能用(見
  // DesktopLayout.tsx 的 chat-popover 說明,唯一入口不再強制先選行程)。
  // 無 trip 時,所有綁在 trip.id 上的資料流(歷史訊息/entries/WebSocket/
  // clientToolsBatches 持久化)與行程專屬功能(成員/分享)一律跳過,只保留
  // onagentBridge 對話本身可用——這是刻意的簡化邊界,不是把整個元件重新
  // 設計成無 trip 也能記事。
  trip?: Trip
  user: User
  onBack: () => void
  // onOpenDrawer:手機版專用,左上角按鈕改成開啟左側導覽抽屜(行程列表/配速表/
  // 設定入口,見 PhoneContent.tsx 的 PhoneNavDrawer),不再直接呼叫 onBack
  // 清空 activeTrip——抽屜裡本來就能選別的行程或關閉抽屜留在原地,不需要
  // 一顆單純「回列表」的按鈕。只在 !desktopChat(手機版)時使用;桌面版
  // ChatScreen 沒有這顆抽屜,維持原本點左上角呼叫 onBack 的行為不變。
  onOpenDrawer?: () => void
  // mobileHeader:手機版專用,非 undefined 時完全不渲染這裡的 navbar——
  // 手機版統一改用主顯示區的 MainNavBar(見 PhoneContent.tsx),分享/成員/
  // 使用者頭像則收攏到 PhoneNavDrawer 抽屜欄分頁列右上角(見該檔案的
  // 說明),ChatScreen 自己不再需要畫任何一種 navbar。'main'/'drawer' 兩個
  // 值目前只用來跟 undefined(桌面版,維持原行為在這裡渲染 navbar)區分,
  // 兩者本身在這裡的處理完全相同。
  mobileHeader?: 'main' | 'drawer'
  // onTimelineData:手機版專用的時間軸資料鏡像——跟 desktopChat.onTimelineData
  // 是同一份資料形狀(DesktopTimelineMirror),差別只在時間軸現在改成手機版
  // 左側導覽抽屜(PhoneNavDrawer.tsx)的一個分頁,不是 ChatScreen 內部自己的
  // 右側抽屜(那套機制已移除,對齊桌面版——時間軸只剩這一個入口)。獨立於
  // desktopChat 之外是因為 desktopChat 同時也控制訊息列表的呈現方式(桌面
  // 版走 .messages 文件流、手機版走 chatMessagesRef 獨立捲動容器),這裡
  // 只想鏡像資料,不想連帶把手機版的訊息呈現也切成桌面版那套。
  onTimelineData?: (data: DesktopTimelineMirror) => void
  desktopChat?: DesktopChatOptions
}) {
  // owner 輸入=發訊息;成員輸入=語意查詢(回答顯示在訊息流,對齊 iOS App)。
  // 無 trip 時視同 owner(輸入直接送出對話,不是語意查詢——沒有行程可查)。
  const isOwner = !trip || trip.ownerID === user.id
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // latestAnswerID:這次「即時產生」(send() 內)的最新一則答案訊息 id,供
  // MessageBubble 判斷附加資料區塊(推薦景點/旅程清單)要不要預設展開——
  // 只有剛產生的這一則自動展開,其餘一律收合成按鈕(含歷史訊息:load() 從
  // 後端/裝置端 DB 讀回歷史時不設定這個值,故重新整理頁面後永遠是 null,
  // 所有訊息都收合)。只認訊息 id,不用「是不是陣列最後一則」判斷,因為
  // record_entry 的記事泡泡會在同一輪之後被 drop() 移除,順序不足以可靠
  // 代表「最新」。
  const [latestAnswerID, setLatestAnswerID] = useState<string | null>(null)
  // Entry:LLM(record_entry 工具)從訊息解析出的條目,按 messageID 掛到對應訊息下方。
  const [entries, setEntries] = useState<Entry[]>([])
  // updatingEntryIDs:目前正在被 entry_update 工具更新的條目 ID,對應卡片顯示「更新中」光影動畫。
  // WS 收到 entry_updating 加入(並保證最短顯示 800ms),entries_updated(更新完成刷新)時清空。
  const [updatingEntryIDs, setUpdatingEntryIDs] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  // loaded:這個行程的 load() 是否已完成過一次(見 load() 的 finally)。
  const [loaded, setLoaded] = useState(false)
  // ask_user:agent 缺資訊(如住宿退房日)時,透過 WS 推來的請求;非 null 時前端開對應 UI。
  const [askUser, setAskUser] = useState<{ askType: string; prompt: string } | null>(null)
  // ask_choice:agent 需要使用者從多個選項擇一時(如多個房型),透過 WS 推來的請求;
  // 非 null 時前端開選單 UI(AskChoiceSheet)。與 ask_user 是獨立的請求/元件,互不相關。
  const [askChoice, setAskChoice] = useState<{ prompt: string; options: AskChoiceOption[] } | null>(null)
  // taskPlaceholders:task_plan 建立中的任務,依 date 在時間軸插入佔位卡;
  // 對應 entry_add(帶 taskID)完成後由 task_entry_ready 移除。
  const [taskPlaceholders, setTaskPlaceholders] = useState<TaskPlaceholder[]>([])
  const [err, setErr] = useState<string | null>(null)
  // onagentMode:固定為 true——ChatScreen 的唯一推論路徑是 onagent
  // WebSocket(useOnagentChatBridge)。tripace 自家 want 框架(send()/
  // api.assist()/assistant_agent.go/ClientToolsBridge 等)已隨這次改動整套
  // 移除,不再存在於專案裡(見 docs/chatscreen-onagent-migration-gap-
  // 2026-08-11.md 的範圍決定與後續遷移紀錄)。保留常數命名而非直接把下面
  // 所有分支寫死,是讓依賴 onagentMode 的條件判斷維持原樣、可讀性不變。
  const onagentMode = true
  // clientToolsBatches:onagent 平台透過 trip_entry_add/trip_entry_update 等
  // client tool(見 web/src/clienttools/tools/、useOnagentChatBridge.ts)寫入
  // 的旅程清單資料——完全不是上面的 entries state。這次刻意不要求把它渲染
  // 進時間軸(MultiTrackTimeline)——時間軸的渲染邏輯與資料來源(entries
  // state)完全不受這份資料影響。
  //
  // 多批次(key)支援:旅程清單不再是單一一份,而是可能同時存在多批獨立清單
  // (見 web/src/clienttools/tripEntryTools.ts 的 TripBatches 型別、
  // server/tools/onagent-tools.yaml「多批次(key)支援」)。clientToolsBatches
  // 用一般物件(Record<key, TripEntry[]>)而非 Map:React state 用 Map 時每次
  // 更新都要手動 new Map(prev) 再逐一搬值處理 immutability,一般物件配合展開
  // 運算子({ ...prev, [key]: next })寫法更直接,且這裡不需要 Map 的鍵排序
  // 保證或非字串鍵等特性。
  //
  // 持久化:比照推薦景點(recommendedPlaces)的模式,web/src/deviceDB.ts 的
  // trip_batches 表(schema 有 key 欄位,見該處宣告的說明)能忠實表示多批次
  // 資料——load() 用 listAllTripBatches(trip.id) 一次撈回整個行程所有
  // 批次當初始值(含 ENTRY_QUERY_BATCH_KEY)。重新整理頁面後,onagent 透過
  // trip_entry_add/update 建立的批次資料能正確還原。
  //
  const [clientToolsBatches, setClientToolsBatches] = useState<TripBatches>({})
  // clientToolsBatchesRef:clientToolsBatches 的唯一真相來源(單一資料,不是
  // state 的鏡射快取)。useOnagentChatBridge 直接收 getAllBatches/
  // setAllBatches 兩個函式(見下方 onagentBridge 建立處),讀寫都指向這個
  // ref——onagent bridge 不自己持有 allBatches 副本,避免 load() 讀裝置端
  // DB 還原、entries_loaded WS 事件、TripListTable 刪除按鈕這幾條路徑
  // 各自改 state 卻沒同步進獨立副本,曾造成查到過期資料的 bug。
  //
  // 用 setClientToolsBatchesBoth(見下方)這個唯一寫入口統一同步 ref 與
  // state,而非用 useEffect 鏡射 state 到 ref——useEffect 要等 render 完成
  // 才跑,若同一輪內連續呼叫兩次 trip_entry_add,第二次呼叫時 ref 可能還沒被
  // 前一次的 useEffect 同步到,讀到舊值。ref 由 setClientToolsBatchesBoth
  // 同步且立即更新,不依賴 React 渲染週期。
  const clientToolsBatchesRef = useRef<TripBatches>({})
  // setClientToolsBatchesBoth:更新 clientToolsBatches 唯一的寫入口,參數
  // 語意比照 React setState(可傳值或 updater 函式),內部同時同步 ref(立即)
  // 與觸發 setClientToolsBatches(讓畫面 re-render)。load()、entries_loaded
  // 事件處理、deleteTripBatchEntries、onagentBridge 的 setAllBatches 全部
  // 改用這個函式,不再直接呼叫 setClientToolsBatches——確保 ref 永遠跟
  // state 同步,不會有任何寫入點漏掉更新 ref。
  const setClientToolsBatchesBoth = useCallback(
    (updater: TripBatches | ((prev: TripBatches) => TripBatches)) => {
      const next = typeof updater === 'function' ? updater(clientToolsBatchesRef.current) : updater
      clientToolsBatchesRef.current = next
      setClientToolsBatches(next)
    },
    [],
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  // chatMessagesRef:手機版訊息列表(現在是固定顯示的主要內容,不再是浮層)
  // 的捲動容器,供進入行程時「捲到最底」使用(桌面版走 bodyRef,見下方
  // useEffect)。改版前這支 ref 叫 chatOverlayInnerRef、只在浮層條件渲染時
  // 才存在;現在訊息列表一律渲染,ref 永遠掛得到,行為不變只是命名對齊
  // 新的呈現方式。
  const chatMessagesRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    // 無 trip:沒有歷史訊息/entries/批次可讀,直接視為載入完成,維持全部
    // state 的初始空值即可(對話小匡此時只提供 onagentBridge 對話本身)。
    if (!trip) {
      setLoaded(true)
      return
    }
    setErr(null)
    try {
      // 原話從「裝置端 DB」讀(與 server 隔離);entry/trip 從後端讀(僅 owner)。
      // owner/非 owner 都讀回歷史訊息:owner 的記事原話本來就不會被 saveMessage
      // (記錄了就不留泡泡,見 send() 的 drop(true)),故這裡讀回的只會是曾經
      // 存過的「提問 + 回答」對話紀錄,不影響記事泡泡「記錄了就消失」的既有設計。
      // clientToolsBatches 比照推薦景點的模式持久化(見上方宣告處的說明):
      // 用 listAllTripBatches 一次撈回整個行程目前存的所有批次(含
      // ENTRY_QUERY_BATCH_KEY 這個 entry_query 專用的固定保留 key,統一走同一套
      // schema/API,見該常數宣告處的說明)當初始值。
      const [msgs, ents, allBatches] = await Promise.all([
        listMessages(trip.id),
        isOwner ? api.fetchEntries(cfg, trip.id) : Promise.resolve([]),
        listAllTripBatches(trip.id),
      ])
      // 推薦景點(recommend_nearby)與旅程清單觸發 key(tripListTriggered)都是
      // 掛在個別訊息底下的附加資料,不在 messages 表裡,故讀完訊息清單後再
      // 各自一次批次撈回這個行程裡所有訊息對應的資料(而非每則訊息各自查
      // 一次),合併進對應訊息物件。
      const [placesByMsgID, tripListKeysByMsgID] = await Promise.all([
        listMessageRecommendedPlaces(msgs.map((m) => m.id)),
        listMessageTripListKeys(msgs.map((m) => m.id)),
      ])
      const msgsWithExtras: ChatMessage[] = msgs.map((m) => {
        const places = placesByMsgID.get(m.id)
        const tripListTriggered = tripListKeysByMsgID.get(m.id)
        if (!places && !tripListTriggered) return m
        return {
          ...m,
          ...(places ? { recommendedPlaces: places } : {}),
          ...(tripListTriggered ? { tripListTriggered } : {}),
        }
      })
      setMessages(msgsWithExtras)
      setEntries(ents)
      setClientToolsBatchesBoth(allBatches)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      // loaded:標記這個行程的初次載入已完成(不論成功或失敗),供下方
      // 「進入行程時捲到最底」的 effect 判斷時機——特意用獨立旗標而非直接
      // 監聽 messages,因為 messages.length===0(行程沒有歷史訊息)時無法用
      // 「有沒有內容」區分「初次進入」與「之後使用者送出第一則新訊息」。
      setLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, trip?.id, isOwner])

  useEffect(() => {
    setLoaded(false)
    load()
  }, [load])

  // 進入行程(或切換行程)時捲到最底,讓使用者一進來就看到最新對話,不用
  // 自己往下滑。只監聽 loaded(而非 messages)是關鍵:loaded 從 false 變
  // true 每個行程週期只發生一次(trip.id 變化時於上方 effect 重置為
  // false、load() 完成時設回 true),天然具備「只觸發一次」的語意——若改
  // 監聽 messages,行程進來時若沒有歷史訊息(messages.length===0)會無法
  // 區分「初次進入」與「之後使用者送出第一則新訊息」,導致這個 effect 被
  // 誤觸發、跟 scrollMessageToTop(送出訊息時捲到頂端)搶控制權。用
  // requestAnimationFrame 等 loaded 變化觸發的渲染真正完成、DOM(手機版的
  // 訊息列表現在一律渲染,不像改版前的浮層是條件渲染,但仍等一次渲染循環
  // 確保內容已經填入)已存在,才捲動。
  //
  // 依賴陣列刻意用 !!desktopChat(布林值)而非 desktopChat 本身:desktopChat
  // 是 App.tsx 用內聯物件字面量 {{ onTimelineData }} 傳入的 prop,DesktopContent
  // 每次重新渲染都會建立一個新的物件參照,即使邏輯上未改變。若依賴陣列放
  // desktopChat 物件本身,只要父層重渲染(可能很頻繁),React 就會判定依賴
  // 變了、重跑這個 effect、把使用者剛手動往上拉的位置強制捲回底部——這正是
  // 「訊息沒辦法往上拉、會抖動」的成因。改成布林值後,只有「是否為桌面模式」
  // 這個語意真正改變時才會重新觸發,不受物件參照不穩定影響。
  useEffect(() => {
    if (!loaded) return
    requestAnimationFrame(() => {
      const container = desktopChat ? bodyRef.current : chatMessagesRef.current
      if (!container) return
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
    })
  }, [loaded, !!desktopChat])

  // 把時間軸所需的 state(entries/updatingEntryIDs/taskPlaceholders)鏡像給
  // 外層的時間軸 UI——桌面版是 DesktopContent 的 side panel(desktopChat.
  // onTimelineData),手機版是 PhoneNavDrawer 的時間軸分頁(onTimelineData,
  // 對齊桌面版,時間軸不再是 ChatScreen 自己的右側抽屜)。兩者資料形狀相同
  // (DesktopTimelineMirror),讓外層的 MultiTrackTimeline 與這裡的主區共用
  // 同一份資料,不必自己另開 WS 或另外 fetch。refetchEntries 供外層手動編輯
  // (onEntryUpdated)後觸發重抓——直接複用下面 fetchEntries 的邏輯。用
  // useEffect(而非在 render 期間呼叫)是因為 render 期間呼叫外層 setState
  // 會觸發 React 警告(cannot update a component while rendering a different component)。
  useEffect(() => {
    const mirror = desktopChat?.onTimelineData ?? onTimelineData
    if (!mirror) return
    mirror({
      entries,
      updatingEntryIDs,
      taskPlaceholders,
      refetchEntries: trip ? () => api.fetchEntries(cfg, trip.id).then(setEntries).catch(() => {}) : () => {},
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopChat, onTimelineData, entries, updatingEntryIDs, taskPlaceholders, cfg.baseURL, cfg.token, trip?.id])

  // updatingSince:記每個更新中 entryID 的起始時間,用來保證「更新中」動畫最短顯示 800ms
  // (entry_update 後端很快完成,不設下限會一閃而過看不見)。
  const updatingSinceRef = useRef<Map<string, number>>(new Map())
  const MIN_UPDATING_MS = 800

  useEffect(() => {
    // 無 trip:沒有行程可訂閱即時事件,不建立連線(entry_updating/
    // entries_updated 等事件全部綁在某個 trip 底下)。
    if (!trip) return
    const tripID = trip.id
    const base = cfg.baseURL.replace(/^http/, 'ws')
    // 瀏覽器原生 WebSocket API 不支援自訂 header,token 改用 query string 帶,
    // 供後端驗證是否為此行程成員(見 server/internal/api/ws.go handleWS)。
    const tokenQS = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : ''
    const ws = new WebSocket(`${base}/v1/trips/${tripID}/ws${tokenQS}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // 不論下方有沒有對應的處理分支,先記一筆供 debug panel 顯示
        // (見 api.ts emitWsEvent / DebugPanel 的「WS 事件」分頁)。
        api.emitWsEvent(msg)
        if (msg.event === 'entry_updating' && msg.entryID) {
          // 條目開始更新:對應卡片亮起「更新中」動畫,並記錄起始時間。
          updatingSinceRef.current.set(msg.entryID, Date.now())
          setUpdatingEntryIDs((prev) => new Set(prev).add(msg.entryID))
        } else if (msg.event === 'entries_updated') {
          // 更新完成:重抓條目,並依最短顯示時間逐一解除「更新中」狀態。
          api.fetchEntries(cfg, tripID).then(setEntries).catch(() => {})
          const now = Date.now()
          updatingSinceRef.current.forEach((since, id) => {
            const elapsed = now - since
            const clear = () => {
              updatingSinceRef.current.delete(id)
              setUpdatingEntryIDs((prev) => {
                const next = new Set(prev)
                next.delete(id)
                return next
              })
            }
            if (elapsed >= MIN_UPDATING_MS) clear()
            else setTimeout(clear, MIN_UPDATING_MS - elapsed)
          })
        } else if (msg.event === 'ask_user' && msg.askType) {
          // agent 缺資訊,請使用者透過 UI 補上;開對應輸入元件(目前支援 date)。
          setAskUser({ askType: msg.askType, prompt: msg.prompt ?? '' })
        } else if (msg.event === 'ask_choice' && Array.isArray(msg.options)) {
          // agent 需要使用者從多個選項擇一;開選單 UI(AskChoiceSheet)。
          setAskChoice({
            prompt: msg.prompt ?? '',
            options: msg.options.map((o: Record<string, unknown>) => ({
              title: String(o.title ?? ''),
              description: typeof o.description === 'string' ? o.description : undefined,
            })),
          })
        } else if (msg.event === 'task_created' && typeof msg.taskID === 'number') {
          // task_plan 建立任務:在該日期下插入一張「新增中」佔位卡。
          setTaskPlaceholders((prev) => [...prev, { taskID: msg.taskID, date: msg.date ?? '', text: msg.text ?? '', kind: msg.kind ?? '' }])
        } else if (msg.event === 'task_entry_ready' && typeof msg.taskID === 'number') {
          // entry_add 已完成對應步驟:移除佔位卡,並重抓條目讓正式卡片出現。
          setTaskPlaceholders((prev) => prev.filter((p) => p.taskID !== msg.taskID))
          api.fetchEntries(cfg, tripID).then(setEntries).catch(() => {})
        } else if (msg.event === 'entries_loaded' && Array.isArray(msg.entries)) {
          // entry_query 查詢完成(見 server/internal/wanttools/entry_query.go
          // 的 NotifyEntriesLoaded):查到的條目轉成 TripEntry,依 id 合併進
          // ENTRY_QUERY_BATCH_KEY 這個固定批次——不是整批覆蓋,id 已存在就用
          // 新資料覆寫(更新),id 不存在就加入(新增);這個批次裡這次沒查到
          // 的其他項目原樣保留(可能是使用者先前已經在前端編輯過、尚未存回
          // 後端的內容,不能被這次查詢結果蓋掉)。entry_query 本身沒有多批次
          // (key)概念(見 ENTRY_QUERY_BATCH_KEY 宣告處的說明),故固定只動
          // 這一個 key,不影響 LLM 透過 trip_entry_* 操作的其他批次。
          const loaded: TripEntry[] = msg.entries.map((e: Record<string, unknown>) => ({
            id: String(e.id ?? ''),
            title: String(e.title ?? ''),
            date: String(e.date ?? ''),
            time: String(e.time ?? ''),
            note: String(e.note ?? ''),
          }))
          const merged = mergeTripEntriesById(clientToolsBatchesRef.current[ENTRY_QUERY_BATCH_KEY] ?? [], loaded)
          setClientToolsBatchesBoth((prev) => ({ ...prev, [ENTRY_QUERY_BATCH_KEY]: merged }))
          void replaceTripBatch(tripID, ENTRY_QUERY_BATCH_KEY, merged).catch(() => {})
        }
      } catch {}
    }
    return () => ws.close()
  }, [cfg.baseURL, cfg.token, trip?.id])

  // 本地訊息(不寫入後端,純前端顯示用):查詢的提問/回答泡泡。
  const mkLocalMsg = (
    id: string,
    authorID: string,
    authorName: string,
    text: string,
  ): ChatMessage => ({
    // tripID:純前端顯示用(不寫回後端),無 trip 時填空字串佔位——
    // MessageBubble 渲染不讀這個欄位,只是型別要求給值。
    id, tripID: trip?.id ?? '', authorID, authorName, text,
    createdAt: new Date().toISOString(),
  })

  // 桌面版:把指定訊息(依 msgID)捲到可視區域頂端,讓 LLM 的回答有完整空間
  // 往下展開;內容若超出可視高度才繼續往上捲(瀏覽器原生行為接手,這裡只
  // 負責初始定位)。手機版訊息列表走自己獨立的捲動容器(chatMessagesRef),
  // 是完全不同的 DOM 結構,呼叫端要自行判斷 desktopChat 是否成立才呼叫這個
  // 函式。用
  // requestAnimationFrame 等這次觸發的渲染真正完成、DOM 節點已存在,才能
  // 量到正確位置。send()/ask() 共用同一份邏輯。
  const scrollMessageToTop = (msgID: string) => {
    requestAnimationFrame(() => {
      const container = bodyRef.current
      if (!container) return
      // 用 dataset 比對而非把 id 直接插進 querySelector 字串,避免 id 內容
      // 若含特殊字元導致 CSS selector 語法錯誤(目前 id 是純數字時間戳不會
      // 發生,但這樣寫不依賴這個前提)。
      const target = Array.from(container.querySelectorAll<HTMLElement>('[data-msg-id]'))
        .find((el) => el.dataset.msgId === msgID)
      if (target) {
        // 用 getBoundingClientRect 算 target 相對 container 的實際視覺距離,
        // 不用 target.offsetTop——offsetTop 是相對「最近的 offsetParent」
        // (第一個 position 非 static 的祖先),若兩者之間有任何一層元素設了
        // position: relative(不一定是 container 本身),算出來的值會偏小,
        // 導致捲動量不足、只推到中途而非真正的容器頂端。
        const containerRect = container.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const offset = targetRect.top - containerRect.top + container.scrollTop
        container.scrollTo({ top: offset, behavior: 'smooth' })
      }
    })
  }

  // onOnagentAssistantMessage:onagent WS 收到 assistant 文字回覆時的回呼——
  // 組成正式的 ChatMessage、直接塞進 messages state,沿用既有的
  // MessageBubble 渲染(泡泡樣式、Markdown 等),不是獨立的除錯用文字
  // 列表(明確需求:「接到原本的樣式跟元件」)。跟 send() 的「回答」分支
  // 不同的是:這裡不走「先插入 pending 佔位泡泡、完成後 setMessages 就地
  // 替換」的兩段式流程——onagent 的 onAssistantMessage 本身就是「這輪
  // 推論完成」的訊號(見 useOnagentChatBridge.ts 的協定說明,非逐字元
  // 串流),故直接 append 一則完整訊息即可,不需要佔位動畫。
  const onOnagentAssistantMessage = useCallback((text: string) => {
    const ans = mkLocalMsg(`onagent_ans_${Date.now()}`, ASSISTANT_ID, '', text)
    setMessages((prev) => [...prev, ans])
    setLatestAnswerID(ans.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mkLocalMsg 只讀 trip?.id,不需要列進依賴。
  }, [])
  // onagentBridge:接上既有的 clientToolsBatchesRef/setClientToolsBatchesBoth
  // (而非另開一份獨立記憶體)——onagent 路徑的 trip_entry_* 工具寫入結果
  // 直接沿用正式路徑既有的 MessageBubble/TripListTable 渲染管線顯示,
  // 使用者看到的是同一套樣式與元件,只是底層資料來源換成 onagent。
  const onagentBridge = useOnagentChatBridge(
    onagentMode,
    () => clientToolsBatchesRef.current,
    setClientToolsBatchesBoth,
    onOnagentAssistantMessage,
  )
  // sendOnagent:插入使用者泡泡(立即顯示、送出當下就捲動),再交給
  // onagentBridge 送出 prompt。onagent 的 trip_entry_add/update 直接透過
  // setClientToolsBatchesBoth 寫入,已經是「當下最新」,不需要事後跟舊快照
  // 比對才知道哪個 key 變了。這裡刻意不補 tripListTriggered 標記(不在
  // assistant 泡泡下方自動展開旅程清單表格)——本輪範圍不含這塊,可接受的
  // 已知簡化,使用者仍能透過 MessageBubble 既有的手動展開入口看到最新
  // clientToolsBatches 內容。
  // overrideText:比照 send() 的既有模式(見「推薦附近景點」快捷按鈕的
  // 呼叫處)——不能先 setDraft(固定語句) 再呼叫 sendOnagent() 讀 draft,
  // setDraft 是非同步排程,緊接著讀 draft 拿到的還是舊值。
  const sendOnagent = (overrideText?: string) => {
    const text = (overrideText ?? draft).trim()
    if (!text) return
    if (overrideText === undefined) setDraft('')
    const askID = `onagent_ask_${Date.now()}`
    const askMsg = mkLocalMsg(askID, user.id, user.name, text)
    setMessages((prev) => [...prev, askMsg])
    if (desktopChat) scrollMessageToTop(askID)
    onagentBridge.sendPrompt(text)
  }

  // deleteTripBatchEntries:TripListTable 勾選項目後按刪除,把選中的 id 從
  // 對應批次(key)移除。與批次來源無關(LLM 自訂 key 或 ENTRY_QUERY_BATCH_KEY
  // 查詢結果一視同仁,都只是移除 clientToolsBatches 裡這個 key 陣列中的幾筆)
  // ——這裡只動前端記憶體 + 裝置端 DB(比照 replaceTripBatch 的持久化模式),
  // 不呼叫後端 api.deleteTripEntry 刪 Postgres(那是另一個功能範疇,不在這次
  // 需求內)。用 setClientToolsBatchesBoth(而非直接 setClientToolsBatches):
  // 這是唯一真相來源的寫入口,自動同步 clientToolsBatchesRef,bridge 的
  // getAllBatches 讀的就是這個 ref,故刪除後 LLM 之後查詢會立刻讀到最新結果,
  // 不需要額外的同步步驟。
  const deleteTripBatchEntries = (key: string, ids: Set<string>) => {
    setClientToolsBatchesBoth((prev) => {
      const next = (prev[key] ?? []).filter((e) => !ids.has(e.id))
      const updated = { ...prev, [key]: next }
      // 無 trip 時 clientToolsBatches 不持久化(裝置端 DB 的批次表以 tripID
      // 為鍵,沒有行程就沒有對應的持久化目標),只更新記憶體內的 state。
      if (trip) void replaceTripBatch(trip.id, key, next).catch(() => {})
      return updated
    })
  }

  return (
    <>
      {/* mobileHeader === undefined 只會發生在桌面模式(desktopChat,見
          該 prop 的說明——PhoneContent.tsx 呼叫時一定帶 'main'/'drawer',
          唯一不傳的呼叫端是 DesktopLayout.tsx)。桌面模式不渲染 navbar——
          對話小匡(chatPopoverOpen)外層已經有跟其他浮動卡片一致的右上角
          關閉按鈕(見 FloatingPanel.tsx),不需要再疊一層「返回」按鈕/
          標題列。原本掛在這裡的 TripMenu(含
          「設為開啟時自動進入」)已搬進行程列表的 TripManageModal。 */}
      <div className={styles.area}>
        {desktopChat ? (
          // 桌面模式:主區不渲染時間軸(時間軸只活在左側 side panel 的時間軸模式裡)。
          // 不同於手機版的浮層疊層設計(時間軸在底層、對話泡泡浮在上方,兩者各自
          // 獨立捲動)——桌面版沒有時間軸需要被浮層蓋住看見,底層只會是引導文字,
          // 故引導文字與對話泡泡改成同一個 .screen-body 容器內的一般文件流內容,
          // 整個對話區當一個整體捲動,捲軸貼齊右欄邊緣,不再套用 .chat-overlay。
          <div className={`screen-body ${styles.messages}`} ref={bodyRef}>
            <ErrorBanner msg={err} />
            {messages.length === 0 ? (
              <div className="empty">
                {/* 無 trip(對話小匡未綁定行程)時,文字與有 trip 但尚無
                    對話時共用同一句簡短引導——不提時間軸,因為無 trip 時
                    根本沒有時間軸可排列。 */}
                {!trip ? '在下方輸入，開始對話。' : isOwner ? '在下方輸入記事，會依時間排列在左側時間軸。' : '在下方查詢這趟行程的內容。'}
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble key={m.id} msg={m} meID={user.id} tripBatches={clientToolsBatches} isLatest={m.id === latestAnswerID} onDeleteTripBatchEntries={deleteTripBatchEntries} />
              ))
            )}
          </div>
        ) : (
          // 手機版:訊息列表是固定顯示的主要內容。時間軸改成左側導覽抽屜
          // (PhoneNavDrawer.tsx)的一個分頁,對齊桌面版——不再是這裡自己的
          // 右側滑入抽屜(原本的 timelineOpen/backdrop/timelinePanel 整套
          // 已移除,資料改透過上方 onTimelineData 鏡像給外層)。
          <div className={`screen-body ${styles.messages}`} ref={chatMessagesRef}>
            <ErrorBanner msg={err} />
            {messages.length === 0 ? (
              <div className="empty">
                {!trip ? '在下方輸入，開始對話。' : isOwner ? '在下方輸入記事，會依時間排列在時間軸(左上角選單)。' : '在下方查詢這趟行程的內容。'}
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble key={m.id} msg={m} meID={user.id} tripBatches={clientToolsBatches} isLatest={m.id === latestAnswerID} onDeleteTripBatchEntries={deleteTripBatchEntries} />
              ))
            )}
          </div>
        )}

        <div className={styles.composer}>
          <div className={styles.row}>
            {/* 桌面版對話小匡(chat-popover)只有 340px 寬,「推薦附近景點」
                快捷鈕跟輸入框/送出鈕擠在一起會跑版,故只在手機版顯示。 */}
            {!desktopChat && (
              <button
                className={styles.fnBtn}
                onClick={() => sendOnagent('推薦附近的景點')}
                title="推薦附近景點"
              >
                <Sparkles size={20} strokeWidth={1.8} />
              </button>
            )}
            <input
              autoFocus
              value={draft}
              placeholder="輸入訊息…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (!isSubmitEnter(e)) return
                sendOnagent()
              }}
            />
            {/* onagent 連線燈號:直接放進輸入框這一列,不佔用額外的一整行
                (使用者明確要求「放在輸入匡上」)。顏色燈號取代文字狀態
                (ready 綠/connecting 黃/closed 或未設定 apiKey 灰),完整
                狀態字串放進 title,hover 才需要細看。 */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                flex: '0 0 auto',
                background: onagentBridge.apiKeyMissing
                  ? 'var(--ios-gray)'
                  : onagentBridge.status === 'ready'
                    ? '#34c759'
                    : onagentBridge.status === 'connecting'
                      ? '#ffcc00'
                      : 'var(--ios-red)',
              }}
              title={onagentBridge.apiKeyMissing ? '未設定 VITE_ONAGENT_APP_KEY' : `onagent: ${onagentBridge.status}`}
            />
            <button
              onClick={() => sendOnagent()}
              disabled={!draft.trim() || onagentBridge.status !== 'ready'}
            >
              <Send size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
      {askUser && (
        <AskUserSheet
          askType={askUser.askType}
          prompt={askUser.prompt}
          onCancel={() => setAskUser(null)}
          onSubmit={(value) => {
            setAskUser(null)
            // 把使用者選的值當成一則新訊息送回。
            sendOnagent(value)
          }}
        />
      )}
      {askChoice && (
        <AskChoiceSheet
          prompt={askChoice.prompt}
          options={askChoice.options}
          onCancel={() => setAskChoice(null)}
          onSubmit={(title) => {
            setAskChoice(null)
            // 把選中選項的主標題當成一則新訊息送回(比照 ask_user)。
            sendOnagent(title)
          }}
        />
      )}
    </>
  )
}
