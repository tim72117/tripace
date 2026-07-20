import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  ChevronLeft,
  Users, Send, Share2, Copy, Check, Trash2, X, Sparkles,
} from 'lucide-react'
import type { ClientConfig, PresentedEntry } from './api'
import * as api from './api'
import type { Channel, ChannelRole, Entry, Member, Message, User } from './types'
import { listMessages, listTripEntries, replaceTripEntries, saveMessage } from './deviceDB'
import { Avatar, ErrorBanner, errMsg, isSubmitEnter, LS_DEFAULT_CHANNEL } from './App'
import { MultiTrackTimeline, type TaskPlaceholder } from './Timeline'
import { RecommendedPlacesList, type RecommendedPlace } from './RecommendedPlaces'
import { ClientToolsBridge } from './clienttools/ClientToolsBridge'
import { defaultClientTools } from './clienttools/tools'
import type { TripEntry } from './clienttools/tripEntryTools'

// 助手(assist 回答)的作者 ID,需與後端及 iOS ChatStore.assistantID 一致。
const ASSISTANT_ID = 'usr_assistant'

// 聊天訊息(後端 Message + 前端專用欄位)。
// presented:agent 用 present_entries 輸出、要在答案泡泡下用列表顯示的條目。
// pending:後端處理中的佔位泡泡,渲染海浪載入動畫(無文字),完成後就地替換。
type ChatMessage = Message & { presented?: PresentedEntry[]; pending?: boolean }

// mergeTripEntriesById 把 incoming 依 id 合併進 base:id 已存在於 base 就用
// incoming 該筆覆寫(更新),id 不存在就附加到尾端(新增);base 裡這次
// incoming 沒有的其他項目原樣保留、不受影響。用於 entry_query 查詢結果
// (entries_loaded 事件)合併進目前的 clientToolsEntries——查詢範圍外、
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

// TripEntryDiff:「儲存」按鈕比對 clientToolsEntries(目前狀態)與
// savedTripEntrySnapshot(上次載入/儲存快照)算出的差異——
//   - added:snapshot 沒有、目前清單有的項目(id 是前端自建的新 id,資料庫
//     沒有對應記錄),要呼叫 POST 新增。
//   - updated:兩邊都有、內容不同的項目(id 對應資料庫既有的 entryID,
//     可能被使用者編輯過),要呼叫 PUT 修改。
//   - removed:snapshot 有、目前清單沒有的項目(原本在清單裡、使用者把它
//     從表格移除了),要呼叫 DELETE 刪除。
type TripEntryDiff = {
  added: TripEntry[]
  updated: TripEntry[]
  removed: TripEntry[]
}

// diffTripEntries 比對「上次載入/儲存快照」與「目前清單」,算出三類差異
// (見 TripEntryDiff 的說明)。snapshot 為 null(這個頻道從未載入/儲存過)時,
// 視同快照是空清單——目前清單裡的每一筆都會被判定成 added。
// 內容比較用 title/date/time/note 四個欄位(id 本身不算內容差異)。
function diffTripEntries(snapshot: TripEntry[] | null, current: TripEntry[]): TripEntryDiff {
  const prev = snapshot ?? []
  const prevByID = new Map(prev.map((e) => [e.id, e]))
  const currentIds = new Set(current.map((e) => e.id))

  const added: TripEntry[] = []
  const updated: TripEntry[] = []
  for (const e of current) {
    const old = prevByID.get(e.id)
    if (!old) {
      added.push(e)
    } else if (
      old.title !== e.title || old.date !== e.date || old.time !== e.time || old.note !== e.note
    ) {
      updated.push(e)
    }
  }
  const removed = prev.filter((e) => !currentIds.has(e.id))
  return { added, updated, removed }
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
  channel,
  user,
  onBack,
  desktopChat,
}: {
  cfg: ClientConfig
  channel: Channel
  user: User
  onBack: () => void
  desktopChat?: DesktopChatOptions
}) {
  // owner 輸入=發訊息;成員輸入=語意查詢(回答顯示在訊息流,對齊 iOS App)。
  const isOwner = channel.ownerID === user.id
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Entry:LLM(record_entry 工具)從訊息解析出的條目,按 messageID 掛到對應訊息下方。
  const [entries, setEntries] = useState<Entry[]>([])
  // updatingEntryIDs:目前正在被 entry_update 工具更新的條目 ID,對應卡片顯示「更新中」光影動畫。
  // WS 收到 entry_updating 加入(並保證最短顯示 800ms),entries_updated(更新完成刷新)時清空。
  const [updatingEntryIDs, setUpdatingEntryIDs] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  // loaded:這個頻道的 load() 是否已完成過一次(見 load() 的 finally)。
  const [loaded, setLoaded] = useState(false)
  // ask_user:agent 缺資訊(如住宿退房日)時,透過 WS 推來的請求;非 null 時前端開對應 UI。
  const [askUser, setAskUser] = useState<{ askType: string; prompt: string } | null>(null)
  // ask_choice:agent 需要使用者從多個選項擇一時(如多個房型),透過 WS 推來的請求;
  // 非 null 時前端開選單 UI(AskChoiceSheet)。與 ask_user 是獨立的請求/元件,互不相關。
  const [askChoice, setAskChoice] = useState<{ prompt: string; options: AskChoiceOption[] } | null>(null)
  // taskPlaceholders:task_plan 建立中的任務,依 date 在時間軸插入佔位卡;
  // 對應 entry_add(帶 taskID)完成後由 task_entry_ready 移除。
  const [taskPlaceholders, setTaskPlaceholders] = useState<TaskPlaceholder[]>([])
  // recommendedPlaces:recommend_nearby 工具查到的景點候選清單,WS 收到
  // recommended_places 事件時整批換掉,並自動彈出 RecommendedPlacesModal 顯示
  // (見 recommend_nearby.go)。showRecommendedPlaces 控制彈窗開關,使用者可關閉;
  // 關閉後不會自動再彈出,除非收到下一次新的 recommended_places 事件。
  const [recommendedPlaces, setRecommendedPlaces] = useState<RecommendedPlace[]>([])
  const [showRecommendedPlaces, setShowRecommendedPlaces] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // clienttools 技術可行性驗證:第二條獨立連線(/internal/clienttools/ws),
  // 讓正式對話的 assistant LLM 改呼叫 trip_entry_add/trip_entry_update
  // (取代原本直接寫 Postgres 的 entry_add/entry_update,見
  // server/internal/llm/assistant_agent.go)時,有個瀏覽器分頁能實際執行、
  // 看到結果。這份清單(clientToolsEntries)是全新、獨立的一份前端記憶體
  // 清單——完全不是上面的 entries state,也不進任何裝置端/後端資料庫,重新
  // 整理頁面就會消失,依 ClientToolsBridge 既有的 ToolContext 設計(同
  // ClientToolsDemo.tsx 的既有試做頁面)。這次刻意不要求把它渲染進時間軸
  // (MultiTrackTimeline)——時間軸的渲染邏輯與資料來源(entries state)完全
  // 不受這條連線影響,見下方 clientToolsSessionId 傳給 api.assist 之外,
  // 沒有任何程式碼路徑讓這條連線碰到 entries/updatingEntryIDs/taskPlaceholders。
  // clientToolsSessionId:連線 ack 後拿到的 sessionId,send() 呼叫 api.assist
  // 時一併帶上,讓後端 trip_entry_* 工具能找到這條連線並轉發呼叫執行(見
  // server/internal/llm/want_analyzer.go Assist 的 SetSessionEnvs 說明)。
  const [clientToolsEntries, setClientToolsEntries] = useState<TripEntry[]>([])
  const [clientToolsStatus, setClientToolsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [clientToolsSessionId, setClientToolsSessionId] = useState<string | null>(null)
  const clientToolsSessionIdRef = useRef<string | null>(null)
  // clientToolsEntriesRef:鏡射目前的 clientToolsEntries,供下方 WS 的
  // entries_loaded 事件處理(useEffect 閉包只在建立當下捕捉到 state,不會
  // 看到之後的更新)讀取「呼叫當下最新的清單」來做依 id 合併——同
  // clientToolsSessionIdRef 用 ref 而非 state 讀值的理由(見該處註解)。
  // 用獨立 useEffect 同步(而非只在單一寫入點手動維護),因為 clientToolsEntries
  // 有多個寫入點(ClientToolsBridge 的 onEntriesChange、entries_loaded 事件),
  // 統一在這裡同步避免漏更新某一處。
  const clientToolsEntriesRef = useRef<TripEntry[]>([])
  useEffect(() => {
    clientToolsEntriesRef.current = clientToolsEntries
  }, [clientToolsEntries])
  // savedTripEntrySnapshot:「上次成功儲存回後端、或上次 entry_query 查詢載入
  // 時」的完整旅程清單快照,供「儲存」按鈕比對 clientToolsEntries 目前的狀態
  // 算出差異(新增/修改/刪除各是哪幾筆)——見下方「儲存」按鈕的 diff 邏輯與
  // entries_loaded 事件處理。初始為 null(尚未載入/儲存過任何一批),null 時
  // 「儲存」按鈕視同「目前清單全部都是新增」(見 diffTripEntries 的說明)。
  const [savedTripEntrySnapshot, setSavedTripEntrySnapshot] = useState<TripEntry[] | null>(null)
  const [savingTripEntries, setSavingTripEntries] = useState(false)
  const [saveTripEntriesErr, setSaveTripEntriesErr] = useState<string | null>(null)
  // 成員管理在頻道內開啟(對齊 iOS App 的聊天頁右上角入口)。
  const [showMembers, setShowMembers] = useState(false)
  // 分享彈窗
  const [showShare, setShowShare] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const navbarRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)
  const todayRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)
  // chatOverlayInnerRef:手機版訊息浮層(.chat-overlay-inner)的捲動容器,
  // 條件渲染(只在 messages.length > 0 || sending || inputFocused 時存在),
  // 供進入頻道時「捲到最底」使用(桌面版走 bodyRef,見下方 useEffect)。
  const chatOverlayInnerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    const nav = navbarRef.current
    if (!el || !nav) return
    const onScroll = () => {
      const y = el.scrollTop
      const diff = y - lastScrollY.current
      lastScrollY.current = y
      if (diff > 4) {
        nav.classList.add('navbar-hidden')
      } else if (diff < -4) {
        nav.classList.remove('navbar-hidden')
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    try {
      // 原話從「裝置端 DB」讀(與 server 隔離);entry/trip 從後端讀(僅 owner)。
      // owner/非 owner 都讀回歷史訊息:owner 的記事原話本來就不會被 saveMessage
      // (記錄了就不留泡泡,見 send() 的 drop(true)),故這裡讀回的只會是曾經
      // 存過的「提問 + 回答」對話紀錄,不影響記事泡泡「記錄了就消失」的既有設計。
      // clientToolsEntries 同樣從裝置端 DB 讀回上次留存的旅程清單當初始值,
      // 只是讓連線建立前的空窗期不要顯示空清單;一旦 ClientToolsBridge 的
      // onEntriesChange 觸發(見下方 useEffect),會用它回傳的最新整批清單
      // 覆蓋掉這裡讀回的值——那才是跟後端 trip_entry_* 工具實際執行狀態
      // 同步的真相,這裡讀回的只是暫時的離線快取。
      const [msgs, ents, tripEnts] = await Promise.all([
        listMessages(channel.id),
        isOwner ? api.fetchEntries(cfg, channel.id) : Promise.resolve([]),
        listTripEntries(channel.id),
      ])
      setMessages(msgs)
      setEntries(ents)
      setClientToolsEntries(tripEnts)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      // loaded:標記這個頻道的初次載入已完成(不論成功或失敗),供下方
      // 「進入頻道時捲到最底」的 effect 判斷時機——特意用獨立旗標而非直接
      // 監聽 messages,因為 messages.length===0(頻道沒有歷史訊息)時無法用
      // 「有沒有內容」區分「初次進入」與「之後使用者送出第一則新訊息」。
      setLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id, isOwner])

  useEffect(() => {
    setLoaded(false)
    load()
  }, [load])

  // 進入頻道(或切換頻道)時捲到最底,讓使用者一進來就看到最新對話,不用
  // 自己往下滑。只監聽 loaded(而非 messages)是關鍵:loaded 從 false 變
  // true 每個頻道週期只發生一次(channel.id 變化時於上方 effect 重置為
  // false、load() 完成時設回 true),天然具備「只觸發一次」的語意——若改
  // 監聽 messages,頻道進來時若沒有歷史訊息(messages.length===0)會無法
  // 區分「初次進入」與「之後使用者送出第一則新訊息」,導致這個 effect 被
  // 誤觸發、跟 scrollMessageToTop(送出訊息時捲到頂端)搶控制權。用
  // requestAnimationFrame 等 loaded 變化觸發的渲染真正完成、DOM(含手機版
  // 條件渲染的 .chat-overlay-inner)已存在,才捲動。
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
      const container = desktopChat ? bodyRef.current : chatOverlayInnerRef.current
      if (!container) return
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
    })
  }, [loaded, !!desktopChat])

  // 桌面模式:把時間軸所需的 state(entries/updatingEntryIDs/taskPlaceholders)
  // 鏡像給外層 DesktopContent 的 side panel,讓 panel 的 MultiTrackTimeline 與
  // 主區共用同一份資料,不必自己另開 WS 或另外 fetch。refetchEntries 供 panel
  // 手動編輯(onEntryUpdated)後觸發重抓——直接複用下面 fetchEntries 的邏輯。
  // 用 useEffect(而非在 render 期間呼叫)是因為 render 期間呼叫外層 setState
  // 會觸發 React 警告(cannot update a component while rendering a different component)。
  useEffect(() => {
    if (!desktopChat) return
    desktopChat.onTimelineData({
      entries,
      updatingEntryIDs,
      taskPlaceholders,
      refetchEntries: () => api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopChat, entries, updatingEntryIDs, taskPlaceholders, cfg.baseURL, cfg.token, channel.id])

  // updatingSince:記每個更新中 entryID 的起始時間,用來保證「更新中」動畫最短顯示 800ms
  // (entry_update 後端很快完成,不設下限會一閃而過看不見)。
  const updatingSinceRef = useRef<Map<string, number>>(new Map())
  const MIN_UPDATING_MS = 800

  useEffect(() => {
    // 切換頻道時清空上一個頻道查到的推薦景點並關閉彈窗,避免殘留跨頻道資料。
    setRecommendedPlaces([])
    setShowRecommendedPlaces(false)
    const base = cfg.baseURL.replace(/^http/, 'ws')
    // 瀏覽器原生 WebSocket API 不支援自訂 header,token 改用 query string 帶,
    // 供後端驗證是否為此頻道成員(見 server/internal/api/ws.go handleWS)。
    const tokenQS = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : ''
    const ws = new WebSocket(`${base}/v1/channels/${channel.id}/ws${tokenQS}`)
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
          api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {})
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
          api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {})
        } else if (msg.event === 'entries_loaded' && Array.isArray(msg.entries)) {
          // entry_query 查詢完成(見 server/internal/wanttools/entry_query.go
          // 的 NotifyEntriesLoaded):查到的條目轉成 TripEntry,依 id 合併進
          // 目前的 clientToolsEntries——不是整批覆蓋,id 已存在就用新資料覆寫
          // (更新),id 不存在就加入(新增);清單裡這次沒查到的其他項目原樣
          // 保留(可能是使用者先前已經在前端編輯過、尚未存回後端的內容,不能
          // 被這次查詢結果蓋掉)。
          const loaded: TripEntry[] = msg.entries.map((e: Record<string, unknown>) => ({
            id: String(e.id ?? ''),
            title: String(e.title ?? ''),
            date: String(e.date ?? ''),
            time: String(e.time ?? ''),
            note: String(e.note ?? ''),
          }))
          const merged = mergeTripEntriesById(clientToolsEntriesRef.current, loaded)
          setClientToolsEntries(merged)
          void replaceTripEntries(channel.id, merged).catch(() => {})
          // 這批查到的條目反映「目前 Postgres 的真實狀態」,故也同步合併進
          // 「上次載入/儲存快照」,讓「儲存」按鈕之後比對差異時,這些 id 的
          // 基準是這次查詢結果,而非更早之前的舊快照(避免明明沒改過卻被
          // 誤判成「已修改」)。快照裡沒被這次查詢碰到的 id 維持原樣不動,
          // 邏輯與上面合併 clientToolsEntries 的方式一致(同一個 merge 函式)。
          setSavedTripEntrySnapshot((prev) => mergeTripEntriesById(prev ?? [], loaded))
        } else if (msg.event === 'recommended_places' && Array.isArray(msg.places)) {
          // recommend_nearby 查詢完成:整批換成本次候選清單(目前後端只回傳
          // name/address/lat/lng/primaryType,rating/userRatingCount 補 0 對齊型別)。
          setRecommendedPlaces(
            msg.places.map((p: Record<string, unknown>) => ({
              name: String(p.name ?? ''),
              address: String(p.address ?? ''),
              lat: Number(p.lat ?? 0),
              lng: Number(p.lng ?? 0),
              rating: Number(p.rating ?? 0),
              userRatingCount: Number(p.userRatingCount ?? 0),
              primaryType: String(p.primaryType ?? ''),
              photoUrl: typeof p.photoUrl === 'string' ? p.photoUrl : undefined,
              summary: typeof p.summary === 'string' ? p.summary : undefined,
            })),
          )
          setShowRecommendedPlaces(true)
        }
      } catch {}
    }
    return () => ws.close()
  }, [cfg.baseURL, cfg.token, channel.id])

  // clienttools 技術可行性驗證專用的第二條連線(見上方 clientToolsEntries 的
  // 說明)。只有 owner 會呼叫 send()/api.assist(見下方),故只在 isOwner 時
  // 建立這條連線,對齊既有第一條 WS 也只在 owner 情境下才有實質作用的前提
  // ——member 走 ask()/semanticQuery,不會用到 sessionId。
  // 這條連線目前沿用 /internal/clienttools/ws(掛在 internalAuth 底下,未帶
  // 使用者身分驗證),是本次任務明確接受的已知安全缺口,留待後續處理。
  useEffect(() => {
    if (!isOwner) return
    const bridge = new ClientToolsBridge(
      defaultClientTools,
      {
        onStatusChange: setClientToolsStatus,
        onToolNamesChange: () => {},
        onEntriesChange: (next) => {
          setClientToolsEntries(next)
          // 持久化進裝置端 DB(整批覆寫,見 replaceTripEntries 說明),
          // 讓下次進入這個頻道(或重新整理頁面)時 load() 能讀回上次的清單。
          void replaceTripEntries(channel.id, next).catch(() => {})
        },
        // assistant_message 是 clienttoolsRole 專屬對話(ClientToolsDemo.tsx
        // 那條路徑)的回覆,這條連線在 ChatScreen 裡只用來讓 trip_entry_*
        // 工具找到執行對象,不會透過這條連線送 prompt,故不需要顯示文字回覆。
        onAssistantText: () => {},
        onLog: () => {},
        onBusyChange: () => {},
        onSessionId: (id) => {
          clientToolsSessionIdRef.current = id
          setClientToolsSessionId(id)
        },
      },
      [],
    )
    bridge.connect()
    return () => {
      bridge.disconnect()
      clientToolsSessionIdRef.current = null
      setClientToolsSessionId(null)
      setClientToolsStatus('closed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在頻道/owner 身分變動時重新連線,同第一條 WS 的依賴慣例。
  }, [cfg.baseURL, channel.id, isOwner])

  useEffect(() => {
    if (entries.length > 0 && todayRef.current && bodyRef.current) {
      const el = todayRef.current
      const body = bodyRef.current
      body.scrollTo({ top: el.offsetTop - 60, behavior: 'instant' })
    }
  }, [entries])

  // 本地訊息(不寫入後端,純前端顯示用):查詢的提問/回答泡泡。
  const mkLocalMsg = (
    id: string,
    authorID: string,
    authorName: string,
    text: string,
  ): ChatMessage => ({
    id, channelID: channel.id, authorID, authorName, text,
    createdAt: new Date().toISOString(),
  })

  // 桌面版:把指定訊息(依 msgID)捲到可視區域頂端,讓 LLM 的回答有完整空間
  // 往下展開;內容若超出可視高度才繼續往上捲(瀏覽器原生行為接手,這裡只
  // 負責初始定位)。手機版走 .chat-overlay 浮層獨立捲動,是完全不同的 DOM
  // 結構,呼叫端要自行判斷 desktopChat 是否成立才呼叫這個函式。用
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

  // owner 用:統一輸入送進 assist,LLM 自主判斷記錄事項或回答提問。
  // overrideText:由 ask_user 回填等場景直接指定送出內容(不從 draft 取)。
  const send = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim()
    if (!text) return
    setSending(true)
    setErr(null)
    if (overrideText === undefined) setDraft('') // 只清使用者手打的草稿;ask_user 回填不動 draft
    // 立刻插入使用者這則泡泡 + 處理中佔位泡泡(海浪動畫):兩者同時 append,
    // 避免使用者的話晚於佔位泡泡才出現、事後插隊到前面的順序問題。
    // record 情境下原話最終不保留(見下方 drop 的呼叫處),但送出當下仍先顯示,
    // 讓使用者能立刻看到自己剛打的內容。
    const askID = `ask_${Date.now()}`
    const askMsg = mkLocalMsg(askID, user.id, user.name, text)
    const pendingID = `pending_${Date.now()}`
    const pending = mkLocalMsg(pendingID, ASSISTANT_ID, '', '')
    pending.pending = true
    setMessages((prev) => [...prev, askMsg, pending])
    // 送出當下就捲(跟 ask() 一致,不等 api.assist 回應)。若最終走記事分支,
    // 泡泡稍後會被 drop(true) 整個移除,使用者會經歷「先捲上去、內容隨即
    // 消失」的短暫跳動——這是已知取捨,換取「送出當下立即有回饋」的一致性。
    if (desktopChat) scrollMessageToTop(askID)
    // drop:移除佔位泡泡。record 情境額外連同使用者原話泡泡一起移除
    // (原話已歸入 entry 卡,訊息流不重複保留);回答情境只移除佔位泡泡,
    // 使用者泡泡保留在原位。
    const drop = (alsoDropAsk = false) =>
      setMessages((prev) => prev.filter((m) => m.id !== pendingID && (!alsoDropAsk || m.id !== askID)))
    // record 時 agent 非同步寫 entry,記下送出前的數量當基準,輪詢到變多才算寫完。
    const baseCount = entries.length
    try {
      // clientToolsSessionIdRef(而非 state)：send 是個 async 函式，用 ref
      // 讀「呼叫當下最新的連線狀態」，避免閉包捕捉到建立當下（可能連線還沒
      // ack）的舊值——同 sending 等其餘欄位在此函式裡都直接讀 state 的既有
      // 寫法不同，是因為這裡要的是「送出當下的最新值」而非「render 當下」
      // 的值，两者在 WS 非同步 ack 到達的情境下可能不同。
      const res = await api.assist(cfg, channel.id, text, clientToolsSessionIdRef.current ?? undefined)
      if (res.kind === 'recorded') {
        // 記錄了 → 把原話存進「裝置端 DB」(原話的權威來源,與 server 隔離)。
        // res.text 為原話;後端不存原話,僅回它供前端落地裝置 DB。
        await saveMessage({
          id: `msg_${Date.now()}`,
          channelID: channel.id,
          authorID: user.id,
          authorName: user.name,
          text: res.text,
          createdAt: new Date().toISOString(),
        }).catch(() => {})
        // 波浪持續到 entry 真的寫入並顯示後才停。
        // 輪詢 fetchEntries 直到筆數比送出前多(agent 寫好);逾時則放棄等待先停。
        const deadline = Date.now() + 20000 // 上限 20s,避免 agent 卡住時無限轉
        let shown = false
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000))
          let next: Entry[]
          try {
            next = await api.fetchEntries(cfg, channel.id)
          } catch {
            continue // 暫時抓失敗就再試
          }
          if (next.length > baseCount) {
            setEntries(next) // entry 已顯示在最上方列表
            shown = true
            break
          }
        }
        if (!shown) {
          // 逾時沒等到新 entry:仍刷新一次列表(可能 agent 沒產生條目)。
          await api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {})
        }
        // 記錄了 → 原話已歸入上方 entry 卡,訊息流不保留這則原話泡泡
        // (連同送出當下先插入的使用者泡泡一起移除)。
        // 對齊 iOS:記事原話存而不顯,內容由 entry 承載。
        drop(true)
      } else {
        // 回答了 → 佔位泡泡就地換成答案(使用者泡泡已在送出當下插入,原位不動)。
        // 答案泡泡掛上 agent 用 present_entries 輸出的條目,前端用列表元件顯示。
        const ans = mkLocalMsg(`ans_${Date.now()}`, ASSISTANT_ID, '', res.answer)
        ans.presented = res.entries
        setMessages((prev) => prev.map((m) => (m.id === pendingID ? ans : m)))
        // 提問 + 答案存裝置 DB(比照 ask() 的做法),重新整理/切回頻道後仍看得到。
        void saveMessage(askMsg).catch(() => {})
        void saveMessage(ans).catch(() => {})
      }
    } catch (e) {
      // 失敗:只移除佔位泡泡,使用者泡泡保留(讓使用者仍看得到剛才送出的內容)。
      drop()
      setErr(errMsg(e))
      setDraft(text) // 失敗時還回草稿
    } finally {
      setSending(false)
    }
  }

  // 成員用:自然語言查詢頻道。問答持久化進裝置端 DB(重開頻道仍在,後端不存)。
  const ask = async (overrideText?: string) => {
    const q = (overrideText ?? draft).trim()
    if (!q) return
    setSending(true)
    setErr(null)
    if (overrideText === undefined) setDraft('')
    // 提問泡泡(持久化)+ 處理中佔位泡泡(海浪動畫,暫態)。
    const askMsg = mkLocalMsg(`ask_${Date.now()}`, user.id, user.name, q)
    const pendingID = `pending_${Date.now()}`
    const pending = mkLocalMsg(pendingID, ASSISTANT_ID, '', '')
    pending.pending = true
    setMessages((prev) => [...prev, askMsg, pending])
    // 提問存裝置 DB。
    void saveMessage(askMsg).catch(() => {})
    // 一定是查詢情境,送出當下就確定要捲(不像 send() 要等回應才知道是
    // 記事還是回答分支)。
    if (desktopChat) scrollMessageToTop(askMsg.id)
    try {
      const a = await api.semanticQuery(cfg, channel.id, q)
      // 佔位泡泡就地換成答案,並把答案也存進裝置 DB。
      const ansMsg = mkLocalMsg(`ans_${Date.now()}`, ASSISTANT_ID, '助手', a.answer)
      void saveMessage(ansMsg).catch(() => {})
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingID ? ansMsg : m)),
      )
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== pendingID))
      setErr(errMsg(e))
    } finally {
      setSending(false)
    }
  }

  // 旅程清單「儲存」按鈕:把 clientToolsEntries 目前的狀態存回後端 Postgres。
  // 依 diffTripEntries 比對出的差異,分別呼叫新增/修改/刪除三個 API
  // (逐筆 upsert,而非整批覆寫)——對齊 server/internal/api/api.go 新增的
  // handleCreateTripEntry/handleUpdateTripEntry/handleDeleteTripEntry。
  // 三類操作彼此獨立(不同 id),用 Promise.all 平行送出縮短總等待時間;
  // 新增成功後端會回傳正式的 entryID,要把清單裡對應那筆的暫時 id 換成它,
  // 否則下次儲存會誤判成「這個暫時 id 也要新增」而重複建立。
  // loading/錯誤處理比照 send()/ask() 的 sending/err 慣例,只是用獨立的
  // savingTripEntries/saveTripEntriesErr 狀態,不跟對話輸入的 sending/err 搶用。
  const saveTripEntries = async () => {
    const { added, updated, removed } = diffTripEntries(savedTripEntrySnapshot, clientToolsEntries)
    if (added.length === 0 && updated.length === 0 && removed.length === 0) return
    setSavingTripEntries(true)
    setSaveTripEntriesErr(null)
    try {
      const [createdResults] = await Promise.all([
        Promise.all(
          added.map((e) =>
            api.createTripEntry(cfg, channel.id, { title: e.title, date: e.date, time: e.time, note: e.note })
              .then((created) => ({ tempId: e.id, created })),
          ),
        ),
        Promise.all(
          updated.map((e) =>
            api.updateTripEntry(cfg, channel.id, e.id, { title: e.title, date: e.date, time: e.time, note: e.note }),
          ),
        ),
        Promise.all(removed.map((e) => api.deleteTripEntry(cfg, channel.id, e.id))),
      ])

      // 新增的那幾筆:清單裡原本的暫時 id 換成後端回傳的正式 entryID,
      // 否則同一筆下次儲存會被 diffTripEntries 誤判成「快照裡沒有、要重新新增」。
      const idRemap = new Map(createdResults.map((r) => [r.tempId, r.created.id]))
      const removedIds = new Set(removed.map((e) => e.id))
      const finalEntries = clientToolsEntries
        .filter((e) => !removedIds.has(e.id))
        .map((e) => (idRemap.has(e.id) ? { ...e, id: idRemap.get(e.id)! } : e))

      setClientToolsEntries(finalEntries)
      setSavedTripEntrySnapshot(finalEntries)
      void replaceTripEntries(channel.id, finalEntries).catch(() => {})
    } catch (e) {
      setSaveTripEntriesErr(errMsg(e))
    } finally {
      setSavingTripEntries(false)
    }
  }

  // 頻道內的成員管理(對齊 iOS App:聊天頁 → 成員)。
  if (showMembers) {
    return (
      <MembersScreen
        cfg={cfg}
        channel={channel}
        isOwner={isOwner}
        onBack={() => setShowMembers(false)}
      />
    )
  }

  if (showShare) {
    return (
      <ShareModal
        cfg={cfg}
        channel={channel}
        isOwner={isOwner}
        onClose={() => setShowShare(false)}
      />
    )
  }

  return (
    <>
      <div className="navbar" ref={navbarRef}>
        <button className="btn icon-btn" onClick={onBack}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="title">{channel.name}</span>
        <ChannelMenu channelID={channel.id} />
        <div style={{ display: 'flex', gap: 2 }}>
          {isOwner && (
            <button className="btn icon-btn" onClick={() => setShowShare(true)} title="分享">
              <Share2 size={18} strokeWidth={1.8} />
            </button>
          )}
          <button className="btn icon-btn" onClick={() => setShowMembers(true)} title="成員">
            <Users size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      {/* clienttools 技術可行性驗證用的除錯區塊:顯示 LLM 透過
          trip_entry_add/trip_entry_update/trip_entry_delete 操作、只存在
          這個分頁記憶體(clientToolsEntries state)的旅程清單——刻意不整合
          進下方的 MultiTrackTimeline,純粹讓人能實際看到 LLM 呼叫前端 tool
          的結果,比照 ClientToolsDemo.tsx 的簡易表格風格,不做精緻 UI 整合。
          只有 owner(會呼叫 send()/api.assist)才看得到,對齊下面建立第二條
          連線的條件。放在 navbar 與 .chat-area 之間(而非 .chat-area 內部)
          ——.chat-area 內的 .chat-overlay 是 position: absolute 蓋住整個
          .chat-area 的浮層,除錯區塊若放在 .chat-area 內會被它蓋住;放在
          外面則完全不受影響,固定顯示在頂端。 */}
      {isOwner && (
        <div style={{
          margin: '8px 16px', padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--border, #33333322)', background: 'var(--surface, #00000008)',
          fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong>旅程清單</strong>
            <span style={{ opacity: 0.6 }}>
              ({clientToolsStatus === 'open' ? `已連線${clientToolsSessionId ? ` · ${clientToolsSessionId}` : ''}` : clientToolsStatus === 'connecting' ? '連線中…' : '已斷線'})
            </span>
            {(() => {
              const { added, updated, removed } = diffTripEntries(savedTripEntrySnapshot, clientToolsEntries)
              const pendingCount = added.length + updated.length + removed.length
              return (
                <>
                  <button
                    className="btn"
                    style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 13 }}
                    onClick={saveTripEntries}
                    disabled={savingTripEntries || pendingCount === 0}
                    title="把目前清單的新增/修改/刪除存回後端"
                  >
                    {savingTripEntries ? '儲存中…' : pendingCount > 0 ? `儲存(${pendingCount})` : '儲存'}
                  </button>
                </>
              )
            })()}
          </div>
          {saveTripEntriesErr && (
            <div style={{ color: 'var(--danger, #c0392b)', marginBottom: 6 }}>{saveTripEntriesErr}</div>
          )}
          {clientToolsEntries.length === 0 ? (
            <div style={{ opacity: 0.6 }}>目前清單是空的(LLM 呼叫 trip_entry_add 後會顯示在這裡)。</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', opacity: 0.6 }}>
                  <th style={{ fontWeight: 400, paddingRight: 8 }}>標題</th>
                  <th style={{ fontWeight: 400, paddingRight: 8 }}>日期</th>
                  <th style={{ fontWeight: 400, paddingRight: 8 }}>時刻</th>
                  <th style={{ fontWeight: 400 }}>備註</th>
                </tr>
              </thead>
              <tbody>
                {clientToolsEntries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ paddingRight: 8 }}>{e.title}</td>
                    <td style={{ paddingRight: 8 }}>{e.date}</td>
                    <td style={{ paddingRight: 8 }}>{e.time}</td>
                    <td>{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="chat-area">
        {desktopChat ? (
          // 桌面模式:主區不渲染時間軸(時間軸只活在左側 side panel 的時間軸模式裡)。
          // 不同於手機版的浮層疊層設計(時間軸在底層、對話泡泡浮在上方,兩者各自
          // 獨立捲動)——桌面版沒有時間軸需要被浮層蓋住看見,底層只會是引導文字,
          // 故引導文字與對話泡泡改成同一個 .screen-body 容器內的一般文件流內容,
          // 整個對話區當一個整體捲動,捲軸貼齊右欄邊緣,不再套用 .chat-overlay。
          <div className="screen-body chat-messages" ref={bodyRef} onMouseDown={() => setInputFocused(false)}>
            <ErrorBanner msg={err} />
            {messages.length === 0 ? (
              <div className="empty">
                {isOwner ? '在下方輸入記事，會依時間排列在左側時間軸。' : '在下方查詢這趟行程的內容。'}
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble key={m.id} msg={m} meID={user.id} />
              ))
            )}
          </div>
        ) : (
          <>
            <div className="screen-body" ref={bodyRef} onMouseDown={() => { setInputFocused(false); setMessages([]) }}>
              <ErrorBanner msg={err} />
              {entries.length === 0 && messages.length === 0 && !sending ? (
                <div className="empty">
                  {isOwner ? '在下方輸入記事，會依時間排列在這裡。' : '在下方查詢這趟行程的內容。'}
                </div>
              ) : entries.length > 0 ? (
                <MultiTrackTimeline
                  entries={entries}
                  todayRef={todayRef}
                  updatingIDs={updatingEntryIDs}
                  taskPlaceholders={taskPlaceholders}
                  cfg={isOwner ? cfg : undefined}
                  onEntryUpdated={() => api.fetchEntries(cfg, channel.id).then(setEntries).catch(() => {})}
                />
              ) : null}
            </div>

            {/* 浮層：訊息對話區，覆蓋在時間軸上方，毛玻璃背景 */}
            {(messages.length > 0 || sending || inputFocused) && (
              <div className="chat-overlay" onMouseDown={(e) => e.stopPropagation()}>
                <div className="chat-overlay-inner" ref={chatOverlayInnerRef}>
                  {messages.map((m) => (
                    <MessageBubble key={m.id} msg={m} meID={user.id} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="composer">
          <div className="composer-row">
            <button
              className="composer-fn-btn"
              onClick={() => {
                // 直接送出固定語句,不動 draft:isOwner 記事流程會被情況 D
                // 判定為推薦意圖並呼叫 recommend_nearby;非 owner 走查詢流程,
                // 一樣是問一句話交給 AI 回答(見 assistant_agent.go recommendThought)。
                const q = '推薦附近的景點'
                isOwner ? send(q) : ask(q)
              }}
              disabled={sending}
              title="推薦附近景點"
            >
              <Sparkles size={20} strokeWidth={1.8} />
            </button>
            <input
              autoFocus
              value={draft}
              placeholder={isOwner ? '記事或提問…' : '用自然語言查詢這趟行程…'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => isSubmitEnter(e) && (isOwner ? send() : ask())}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
            <button
              onClick={() => (isOwner ? send() : ask())}
              disabled={sending || !draft.trim()}
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
            // 把使用者選的值當成一則新訊息送回,agent 靠對話歷史接上前文(缺哪筆住宿的退房日)。
            send(value)
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
            // 把選中選項的主標題當成一則新訊息送回,agent 靠對話歷史接上前文(比照 ask_user)。
            send(title)
          }}
        />
      )}
      {showRecommendedPlaces && recommendedPlaces.length > 0 && (
        <RecommendedPlacesModal
          places={recommendedPlaces}
          onClose={() => setShowRecommendedPlaces(false)}
        />
      )}
    </>
  )
}

// RecommendedPlacesModal:recommend_nearby 查詢完成後自動彈出,顯示本次候選景點卡片。
// 使用者可點右上角關閉鈕或背景遮罩關閉;關閉後不會自動再彈出,只有下一次收到新的
// recommended_places 事件才會再次開啟(見上方 ws.onmessage 的 setShowRecommendedPlaces(true))。
function RecommendedPlacesModal({
  places,
  onClose,
}: {
  places: RecommendedPlace[]
  onClose: () => void
}) {
  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-head">
          <span className="rp-modal-title">推薦景點 · {places.length} 個</span>
          <button className="btn icon-btn" onClick={onClose} title="關閉">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="rp-modal-body">
          <RecommendedPlacesList places={places} />
        </div>
      </div>
    </div>
  )
}

// AskUserSheet:agent 呼叫 ask_user 時,前端依 askType 開啟對應輸入 UI 的底部彈出面板。
// 目前支援 askType='date'(日期選擇器);使用者選定後把值透過 onSubmit 送回(當成新訊息)。
function AskUserSheet({
  askType,
  prompt,
  onSubmit,
  onCancel,
}: {
  askType: string
  prompt: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="ask-user-backdrop" onClick={onCancel}>
      <div className="ask-user-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ask-user-prompt">{prompt || '請補充資訊'}</div>
        {askType === 'date' ? (
          <input
            className="ask-user-date"
            type="date"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <div className="ask-user-unsupported">不支援的輸入類型：{askType}</div>
        )}
        <div className="ask-user-actions">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
          <button
            className="btn-primary"
            disabled={!value}
            onClick={() => value && onSubmit(value)}
          >
            確定
          </button>
        </div>
      </div>
    </div>
  )
}

// ask_choice 工具的一個選項:主標題(必填)+ 一行描述(可選),與後端
// server/internal/wanttools/ask_choice.go 的 AskChoiceOption 對齊。
export type AskChoiceOption = { title: string; description?: string }

// AskChoiceSheet:agent 呼叫 ask_choice 時,前端開啟的選單底部彈出面板
// (獨立於 AskUserSheet 的全新元件,職責不同:單選、選項數不限、每項有主標題+描述)。
// 視覺與互動模式比照 AskUserSheet(複用 .ask-user-backdrop/.ask-user-sheet):
// 點背景或「取消」鈕關閉且不送出任何值;點某個選項則把該選項的 title 透過
// onSubmit 送回(當成新訊息,不含 description)。
function AskChoiceSheet({
  prompt,
  options,
  onSubmit,
  onCancel,
}: {
  prompt: string
  options: AskChoiceOption[]
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  return (
    <div className="ask-user-backdrop" onClick={onCancel}>
      <div className="ask-user-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ask-user-prompt">{prompt || '請選擇一個選項'}</div>
        <div className="ask-choice-list">
          {options.map((opt, i) => (
            <button
              key={i}
              className="ask-choice-option"
              onClick={() => onSubmit(opt.title)}
            >
              <span className="ask-choice-option-title">{opt.title}</span>
              {opt.description && (
                <span className="ask-choice-option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ask-user-actions">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  msg,
  meID,
}: {
  msg: ChatMessage
  meID: string
}) {
  // 新模型:message 只剩原話,LLM 標注已移至 entry(在上方事件列表顯示)。
  const mine = msg.authorID === meID
  // 只有助理「回答」訊息用 Markdown 渲染;使用者輸入/記事訊息維持純文字。
  const isAnswer = msg.authorID === ASSISTANT_ID
  // LLM 回答輸出文字時(非 pending 狀態)不套用泡泡外觀,直接呈現純文字;
  // pending 狀態仍要維持泡泡(WaveLoader 海浪動畫依賴卡片背景/內距呈現,
  // 拿掉會讓動畫裸露在對話流裡)。使用者自己的訊息(mine)不受影響。
  const bare = isAnswer && !msg.pending
  return (
    <div className={`bubble-group ${mine ? 'mine' : ''}`} data-msg-id={msg.id}>
      <div className={`bubble ${mine ? 'mine' : ''} ${msg.pending ? 'pending' : ''} ${bare ? 'bare' : ''}`}>
        {/* 助手回答泡泡不顯示作者名(不出現「助手」);對齊 iOS MessageRow */}
        {!mine && !isAnswer && msg.authorName && (
          <div className="sub" style={{ marginBottom: 2 }}>
            {msg.authorName}
          </div>
        )}
        {msg.pending ? (
          // 後端處理中:海浪載入動畫(色塊群組依序起伏)。
          <WaveLoader />
        ) : isAnswer ? (
          <div className="text markdown">
            <ReactMarkdown>{msg.text}</ReactMarkdown>
          </div>
        ) : (
          <div className="text">{msg.text}</div>
        )}
      </div>
      {/* agent 用 present_entries 輸出的條目,在答案泡泡下用列表顯示 */}
      {msg.presented?.map((e, i) => (
        <PresentedCard key={`p${i}`} entry={e} />
      ))}
    </div>
  )
}

// WaveLoader:後端處理中的海浪載入動畫。
// 多個色塊依序上下起伏(animation-delay 漸進),整體像海浪由左而右流動。
function WaveLoader() {
  const bars = 5
  return (
    <div className="wave" aria-label="處理中" role="status">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  )
}

// PresentedCard 顯示 present_entries 輸出的條目(查詢結果列表用)。
function PresentedCard({ entry }: { entry: PresentedEntry }) {
  const allDay = !entry.startTime
  const when = entry.start
    ? allDay ? entry.start : `${entry.start} ${entry.startTime}`
    : '未指定時間'
  const endLabel = entry.end
    ? entry.endTime ? ` ~ ${entry.end} ${entry.endTime}` : ` ~ ${entry.end}`
    : ''
  return (
    <div className="entry-card">
      <span className="entry-ico">📅</span>
      <div className="entry-body">
        <div className="entry-item">{entry.title}</div>
        <div className="entry-when">{when}{endLabel}</div>
      </div>
    </div>
  )
}

// ---- 成員頁 ----

function MembersScreen({
  cfg,
  channel,
  isOwner,
  onBack,
}: {
  cfg: ClientConfig
  channel: Channel
  isOwner: boolean
  onBack: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setMembers(await api.fetchMembers(cfg, channel.id))
    } catch (e) {
      setErr(errMsg(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id])

  useEffect(() => {
    load()
  }, [load])

  // 以 email 邀請(對齊 iOS App);新成員預設 viewer(查詢權限)。
  const invite = async () => {
    const e = email.trim().toLowerCase()
    if (!e.includes('@')) return
    setAdding(true)
    setErr(null)
    try {
      setMembers(await api.addMember(cfg, channel.id, e, 'viewer'))
      setEmail('')
    } catch (err) {
      setErr(errMsg(err))
    } finally {
      setAdding(false)
    }
  }

  // owner 切換成員權限(editor ↔ viewer)。owner 自己不可改。
  const toggleRole = async (m: Member) => {
    if (m.id === channel.ownerID) return
    const next: ChannelRole = m.role === 'editor' ? 'viewer' : 'editor'
    setErr(null)
    try {
      setMembers(await api.setMemberRole(cfg, channel.id, m.id, next))
    } catch (err) {
      setErr(errMsg(err))
    }
  }

  return (
    <>
      <div className="navbar">
        <button className="btn icon-btn" onClick={onBack}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="title">成員</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        <ErrorBanner msg={err} />
        <div className="section-title">行程成員 · {channel.name}</div>
        <ul className="list">
          {members.map((m) => {
            const isChannelOwner = m.id === channel.ownerID
            const roleLabel = isChannelOwner ? '擁有者' : m.role === 'editor' ? '可修改' : '查詢'
            return (
              <li key={m.id} className="row">
                <Avatar user={m} />
                <div className="grow">
                  <div className="name">{m.name}</div>
                  <div className="sub">{m.id}</div>
                </div>
                {isOwner && !isChannelOwner ? (
                  <button className={`role-chip ${m.role}`} onClick={() => toggleRole(m)} title="點擊切換 修改/查詢 權限">
                    {roleLabel}
                  </button>
                ) : (
                  <span className={`role-chip ${isChannelOwner ? 'owner' : m.role} static`}>
                    {roleLabel}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <div className="section-title">以 Email 邀請</div>
        <div className="field">
          <input
            value={email}
            type="email"
            autoComplete="email"
            placeholder="輸入對方的 Email 後按 Enter"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => isSubmitEnter(e) && invite()}
          />
        </div>
        <div style={{ padding: '8px 16px 0' }}>
          <button className="btn-primary" onClick={invite} disabled={adding || !email.includes('@')}>
            {adding ? '邀請中…' : '邀請加入'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---- 分享彈窗 ----

function ShareModal({
  cfg,
  channel,
  isOwner,
  onClose,
}: {
  cfg: ClientConfig
  channel: Channel
  isOwner: boolean
  onClose: () => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const publicURL = token ? `${window.location.origin}/public/${token}` : null

  useEffect(() => {
    api.getPublicLink(cfg, channel.id)
      .then((r) => { setToken(r.linkToken); setEditable(r.editable) })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, channel.id])

  const generate = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.createPublicLink(cfg, channel.id, editable)
      setToken(r.linkToken)
      setEditable(r.editable)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleEditable = async (val: boolean) => {
    setEditable(val)
    try {
      const r = await api.createPublicLink(cfg, channel.id, val)
      setToken(r.linkToken)
      setEditable(r.editable)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  const revoke = async () => {
    setLoading(true)
    setErr(null)
    try {
      await api.deletePublicLink(cfg, channel.id)
      setToken(null)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!publicURL) return
    navigator.clipboard.writeText(publicURL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <>
      <div className="navbar">
        <button className="btn icon-btn" onClick={onClose}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <span className="title">分享行程</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="screen-body">
        <ErrorBanner msg={err} />
        <div className="section-title">公開連結</div>
        <div className="field" style={{ color: 'var(--ios-gray)', fontSize: 13 }}>
          任何人取得連結後即可查看此行程的內容（無需登入）。
        </div>
        {loading ? (
          <div className="empty">載入中…</div>
        ) : token ? (
          <>
            <div className="share-link-box">
              <div className="share-link-url">{publicURL}</div>
              <button className="share-link-copy" onClick={copy} title="複製連結">
                {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.8} />}
              </button>
            </div>
            <div style={{ padding: '8px 16px 0' }}>
              <button className="btn-primary" onClick={copy}>
                {copied ? '✅ 已複製' : '複製連結'}
              </button>
            </div>
            {isOwner && (
              <>
                <div className="share-toggle-row">
                  <span className="share-toggle-label">允許訪客新增行程</span>
                  <label className="ios-toggle">
                    <input type="checkbox" checked={editable} onChange={(e) => toggleEditable(e.target.checked)} />
                    <span className="ios-toggle-slider" />
                  </label>
                </div>
                <div style={{ padding: '12px 16px 0' }}>
                  <button className="btn-danger" onClick={revoke}>
                    <Trash2 size={14} strokeWidth={1.8} style={{ marginRight: 6 }} />
                    撤銷連結
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="empty" style={{ padding: '24px 16px', textAlign: 'left' }}>
              尚未建立公開連結。
            </div>
            {isOwner && (
              <>
                <div className="share-toggle-row">
                  <span className="share-toggle-label">允許訪客新增行程</span>
                  <label className="ios-toggle">
                    <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
                    <span className="ios-toggle-slider" />
                  </label>
                </div>
                <div style={{ padding: '8px 16px 0' }}>
                  <button className="btn-primary" onClick={generate}>
                    建立公開連結
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ---- 行程菜單(右上角設定) ----

function ChannelMenu({ channelID }: { channelID: string }) {
  const [open, setOpen] = useState(false)
  const defaultID = localStorage.getItem(LS_DEFAULT_CHANNEL)
  const isDefault = defaultID === channelID

  const setAsDefault = () => {
    localStorage.setItem(LS_DEFAULT_CHANNEL, channelID)
    setOpen(false)
  }

  const clearDefault = () => {
    localStorage.removeItem(LS_DEFAULT_CHANNEL)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn icon-btn"
        onClick={() => setOpen(!open)}
        title="行程設定"
        style={{ padding: 0 }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            background: 'var(--ios-white)',
            border: '1px solid var(--ios-separator)',
            borderRadius: 8,
            marginTop: 4,
            minWidth: 180,
            zIndex: 1000,
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          }}
        >
          {!isDefault ? (
            <button
              onClick={setAsDefault}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--ios-link)',
                borderBottom: '1px solid var(--ios-separator)',
              }}
            >
              ✓ 開啟時自動進入
            </button>
          ) : (
            <button
              onClick={clearDefault}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: '#FF3B30',
              }}
            >
              ✗ 取消自動進入
            </button>
          )}
        </div>
      )}
    </div>
  )
}
