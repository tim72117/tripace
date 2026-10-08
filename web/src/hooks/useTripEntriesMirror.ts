// useTripEntriesMirror — 訂閱一個旅程的行程條目(entries)與即時更新事件,
// 供「時間軸」側欄(DesktopLayout 的 panelMode='timeline' → MultiTrackTimeline、
// 手機版 PhoneNavDrawer 的同名分頁)直接使用。
//
// 2026-10 新增,從 chat/ChatScreen.tsx 搬出來——原本這份資料是 ChatScreen
// 自己撈(api.fetchEntries)、自己訂閱旅程 WebSocket,再透過
// desktopChat.onTimelineData 這個 callback「鏡像」給外層的側欄。那是因為
// 歷史上 ChatScreen 本來就需要這份資料(它自己要渲染時間軸),側欄只是順便
// 搭便車,不想重複撈一次。
//
// 使用者明確要求把對話視窗的內容換成 AI 規劃時間軸(見
// trip-plan/TripPlanPage.tsx)之後,ChatScreen 不再是這份資料的消費者,
// 「側欄的時間軸要有資料」就不該再依賴「對話視窗剛好有掛載且剛好撈過」
// 這件事——使用者確認「讓它自己撈資料,不再依賴對話」。抽成這個 hook 之後
// 兩者關係正確:側欄自己宣告它需要什麼資料,不經過任何中介鏡像。
//
// 這裡只涵蓋 entries 相關的事件,刻意不涵蓋 ChatScreen 原本在同一個
// WebSocket handler 裡處理的對話專屬事件(ask_user/ask_choice/
// entries_loaded 等)——那些是對話流程的一部分,跟「側欄要顯示哪些行程
// 條目」無關,不該被搬進這個 hook 增加它的職責。

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { ClientConfig } from '../api'
import type { Entry } from '../types'

// TaskPlaceholder — task_plan 建立任務時,在對應日期下插入的「新增中」
// 佔位卡;等 task_entry_ready 事件回來再移除、換成真正的條目。形狀對齊
// 原本 ChatScreen 內的同名型別(MultiTrackTimeline 的 taskPlaceholders
// prop 直接吃這個形狀)。
export interface TaskPlaceholder {
  taskID: number
  date: string
  text: string
  kind: string
}

// MIN_UPDATING_MS — 「更新中」動畫的最短顯示時間。後端可能在幾十毫秒內
// 就送回 entries_updated,若立刻解除,使用者只會看到一次幾乎無法察覺的
// 閃爍,不如完全不顯示——保證至少顯示這段時間,讓這個狀態真的能被看見。
// 數值沿用 ChatScreen 搬移前的既有值,不是這裡重新決定的。
const MIN_UPDATING_MS = 800

export function useTripEntriesMirror(cfg: ClientConfig, tripID: string | null, isOwner: boolean) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [updatingEntryIDs, setUpdatingEntryIDs] = useState<Set<string>>(new Set())
  const [taskPlaceholders, setTaskPlaceholders] = useState<TaskPlaceholder[]>([])
  // updatingSinceRef — 記錄每個條目進入「更新中」的時刻,供上面
  // MIN_UPDATING_MS 的最短顯示時間計算。用 ref 而非 state:它只在事件
  // 處理與計時器回呼裡被讀寫,本身不需要觸發重渲染。
  const updatingSinceRef = useRef<Map<string, number>>(new Map())

  // refetch — 供外層手動編輯條目後(MultiTrackTimeline 的 onEntryUpdated)
  // 觸發重抓。非擁有者(isOwner 為 false)不撈——對齊搬移前 ChatScreen
  // 的既有判斷(api.fetchEntries 對非成員會失敗,不如一開始就不打)。
  const refetch = useCallback(() => {
    if (!tripID || !isOwner) return
    api.fetchEntries(cfg, tripID).then(setEntries).catch(() => {})
    // cfg 是每次 render 可能都換新參照的物件(呼叫端常直接寫 { baseURL,
    // token } 字面量),放進依賴陣列會讓這個 callback 參照每次都變、連帶
    // 讓下方 effect 每次重連 WebSocket——改成只依賴真正會改變行為的
    // baseURL/token 兩個原始值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, tripID, isOwner])

  // 切換旅程時先清空——避免新旅程第一次撈回來之前,畫面還留著上一個
  // 旅程的條目(使用者會看到明顯錯誤的內容,而不只是短暫空白)。
  useEffect(() => {
    setEntries([])
    setUpdatingEntryIDs(new Set())
    setTaskPlaceholders([])
    updatingSinceRef.current.clear()
    if (!tripID || !isOwner) return
    let cancelled = false
    api.fetchEntries(cfg, tripID)
      .then((ents) => { if (!cancelled) setEntries(ents) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, tripID, isOwner])

  // 旅程即時事件:訂閱後依事件類型更新上面三份 state。連線建立/關閉的
  // 時機與 token 帶法沿用搬移前 ChatScreen 的既有寫法(瀏覽器原生
  // WebSocket 不支援自訂 header,token 改用 query string 帶,供後端驗證
  // 是否為此旅程成員,見 server/internal/api/ws.go 的 handleWS)。
  useEffect(() => {
    if (!tripID) return
    const base = cfg.baseURL.replace(/^http/, 'ws')
    const tokenQS = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : ''
    const ws = new WebSocket(`${base}/v1/trips/${tripID}/ws${tokenQS}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // 不論下方有沒有對應的處理分支,先記一筆供 debug panel 顯示
        // (見 api.ts emitWsEvent / DebugPanel 的「WS 事件」分頁)——
        // 這行沿用搬移前的既有行為,不因為這個 hook 只處理部分事件就
        // 漏掉其餘事件的 debug 記錄。
        api.emitWsEvent(msg)
        if (msg.event === 'entry_updating' && msg.entryID) {
          updatingSinceRef.current.set(msg.entryID, Date.now())
          setUpdatingEntryIDs((prev) => new Set(prev).add(msg.entryID))
        } else if (msg.event === 'entries_updated') {
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
        } else if (msg.event === 'task_created' && typeof msg.taskID === 'number') {
          setTaskPlaceholders((prev) => [...prev, {
            taskID: msg.taskID,
            date: msg.date ?? '',
            text: msg.text ?? '',
            kind: msg.kind ?? '',
          }])
        } else if (msg.event === 'task_entry_ready' && typeof msg.taskID === 'number') {
          setTaskPlaceholders((prev) => prev.filter((p) => p.taskID !== msg.taskID))
          api.fetchEntries(cfg, tripID).then(setEntries).catch(() => {})
        }
      } catch {
        // 非 JSON 或格式不符的訊息直接忽略——沿用搬移前的既有處理方式。
      }
    }
    return () => ws.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.baseURL, cfg.token, tripID])

  return { entries, updatingEntryIDs, taskPlaceholders, refetch }
}
