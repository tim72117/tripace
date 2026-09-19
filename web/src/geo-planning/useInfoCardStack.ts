import { useCallback, useEffect, useState } from 'react'

// useInfoCardStack:管理「目前有哪些浮動資訊卡(DesktopInfoCard 外框,見
// 該檔案)實際顯示中」的獨立狀態——不改動既有 geoSelection.ts(主題卡/
// PlacePanel 那套互斥狀態機仍照舊運作,這裡刻意不合併進去,見「新建獨立
// reducer/hook」的決定),但補上 geoSelection 本身沒有涵蓋的部分:搜尋
// 結果側欄(GeoHotelSidebar)這類卡片跟主題卡/地點卡之間「誰出現時要
// 清空誰」的規則。
//
// 每張卡片登記時帶一個固定的 order(數字越小越靠右,供
// DesktopInfoCard.tsx 的 stackedInfoCardRightPx 計算位置)與一個 mode:
//   - 'exclusive':這張卡片出現時,清空佇列裡所有其他卡片(不論對方是
//     exclusive 還是 stacked)——例如搜尋結果側欄、主題卡本身,使用者
//     點開其中一個時,預期看到的是全新的內容,不是疊加在舊內容上面。
//   - 'stacked':這張卡片出現時,單純加入佇列,不影響任何已存在的卡片
//     ——例如並存的 POI 地點卡,附加在主題卡旁邊補充資訊,不該把使用者
//     原本在看的主題卡趕走。
// 但反過來,'stacked' 卡片仍然會被之後出現的 'exclusive' 卡片一併清空
// (exclusive 清空的是「佇列裡當下的全部」,不分對方的 mode)。
//
// 這個 hook 只管理「誰在佇列裡、佇列的先後關係」,不管理每張卡片的實際
// 內容(content/attraction 等)——呼叫端仍自己持有內容 state,這裡只是
// 額外疊加一層「這張卡片現在算不算顯示中」的登記簿,呼叫端可以拿
// isPresent(id) 判斷自己的內容 state 該不該被連帶清空。
export type InfoCardMode = 'exclusive' | 'stacked'

interface InfoCardEntry {
  id: string
  order: number
  mode: InfoCardMode
}

export interface InfoCardStack {
  // entries:目前顯示中的卡片,依 order 由小到大排序——呼叫端可以直接
  // 拿來算 presentOrders(見 stackedInfoCardRightPx)或渲染順序,不需要
  // 自己再排一次序。
  entries: InfoCardEntry[]
  presentOrders: ReadonlySet<number>
  isPresent: (id: string) => boolean
  // push:登記一張卡片顯示——mode 為 'exclusive' 時,先清空佇列裡所有
  // 其他卡片,再放入這張;'stacked' 時直接加入(若同 id 已存在則替換,
  // 不重複疊加同一張卡片)。呼叫端仍要自行處理「因為這次 push 導致別的
  // 卡片被清空」時,那些卡片自己的內容 state 是否也要跟著清空(見
  // isPresent 的說明)。
  push: (id: string, order: number, mode: InfoCardMode) => void
  remove: (id: string) => void
  // clear:清空整個佇列——供 exclusive 卡片自己被關閉、或需要整批重置
  // (例如切換旅程/登出)時使用。
  clear: () => void
}

export function useInfoCardStack(): InfoCardStack {
  const [entries, setEntries] = useState<InfoCardEntry[]>([])

  const push = useCallback((id: string, order: number, mode: InfoCardMode) => {
    setEntries((prev) => {
      const withoutSelf = prev.filter((e) => e.id !== id)
      const base = mode === 'exclusive' ? [] : withoutSelf
      return [...base, { id, order, mode }].sort((a, b) => a.order - b.order)
    })
  }, [])

  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const clear = useCallback(() => {
    setEntries([])
  }, [])

  const presentOrders = new Set(entries.map((e) => e.order))
  const isPresent = useCallback((id: string) => entries.some((e) => e.id === id), [entries])

  return { entries, presentOrders, isPresent, push, remove, clear }
}

// useInfoCardStackSync:把「某個外部值是否存在」跟 InfoCardStack 的登記
// 動作接起來的通用膠水——DesktopLayout.tsx 原本用三個各自獨立的
// useEffect 分別把 geoHotelSidebarVisible/geoAttractionContent/
// nearbyInfoContent 這三個既有 state 登記進 infoCardStack,這裡收斂成
// 一個可重用、可獨立測試的 hook,呼叫端只需要描述「這張卡片的 id/order/
// mode,以及它現在存不存在(present)」,不需要自己重複寫
// 「if (present) push else remove」這個樣板。
//
// 額外的 onExclusivePresent:僅在這張卡片是 exclusive、且這次從
// 不存在→存在(上升緣,不是每次重渲染都觸發)時呼叫一次——供
// DesktopLayout.tsx 的搜尋結果側欄使用:搜尋結果一出現時,除了登記進
// infoCardStack(讓其他卡片的登記被清空),還要額外呼叫
// geo.clearSelection() 把主題卡自己的實際內容 state 也真的清空(登記簿
// 被清空不會自動連動實際 state,見 InfoCardStack 的完整說明)。不是每張
// exclusive 卡片都需要這個回呼(例如主題卡自己被清空不需要對自己做
// 什麼事,它的清空是被搜尋結果的 onExclusivePresent 觸發的),故做成
// optional。
export function useInfoCardStackSync(
  stack: InfoCardStack,
  id: string,
  order: number,
  mode: InfoCardMode,
  present: boolean,
  onExclusivePresent?: () => void,
): void {
  useEffect(() => {
    if (present) {
      stack.push(id, order, mode)
      if (mode === 'exclusive') onExclusivePresent?.()
    } else {
      stack.remove(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])
}
