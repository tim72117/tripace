// attractionPoolStore.ts — 這次對話中出現過的景點池。
//
// 2026-10 新增(使用者明確要求「中間都會觸發 attraction-search 這是一個
// 景點池,AI 也可以取用,應該要先讓 AI 存取景點池自行對照」)。
//
// 解決的問題:三個詢問頁工具改成不等待之後(見 asktools.ts 檔頭的
// 完整說明),LLM 拿不到使用者選了什麼,得靠 get_user_selection 查。但
// 那支工具只知道 placeId——候選的名稱、摘要、分類都在當初 search_attraction
// 的回傳值裡,那是好幾輪之前的事了,LLM 不一定還記得,也不該為了查一個
// 名稱就重新呼叫一次搜尋(那會多打一次 Google Places,而且回來的候選
// 順序/內容不保證跟當初一樣)。
//
// 做法:每次查到候選就寫進這個池子,LLM 透過 get_attraction_pool 隨時
// 查閱完整資料,自己對照 id 與名稱。
//
// 「這次對話」的範圍:池子跟著頁面實例存在,重新整理就空了。不持久化是
// 刻意的——它是對話的工作記憶,不是行程資料(那個才該存,見
// planning/timeline/storage.ts)。
//
// 不做去重以外的清理:同一個 placeId 重複查到就覆蓋(後查到的資料比較
// 新)。池子不設上限——一次對話裡的候選數量是幾十筆的量級,不是會長到
// 需要淘汰的規模。

export interface PooledPlace {
  placeId: string
  name: string
  summary?: string
  category?: string
  lat?: number
  lng?: number
  // source——這筆是怎麼進池子的。LLM 不需要它,但出問題時能分辨「這是
  // 真的查過的」還是「展示頁的固定假資料」。
  source: 'search' | 'preset'
  // addedAt——寫入時間(ISO 字串)。同一個地點重複查到時會更新。
  addedAt: string
}

export interface AttractionPoolStore {
  // put——把一批候選寫進池子(同 placeId 覆蓋)。
  put(places: Omit<PooledPlace, 'addedAt'>[]): void
  // list——池子裡目前所有的地點,依寫入時間由新到舊。
  list(): PooledPlace[]
  // get——依 placeId 取單筆,不存在時回傳 undefined。
  get(placeId: string): PooledPlace | undefined
  // clear——清空(交接、重新開始對話時用)。
  clear(): void
}

export function createAttractionPoolStore(): AttractionPoolStore {
  // Map 而非陣列:主要操作是依 placeId 覆蓋與查找,兩者在 Map 上都是
  // O(1)。list() 需要排序時再轉陣列——那是低頻操作(只有 LLM 查詢時
  // 才會呼叫),不值得為它維護一份額外的排序結構。
  const places = new Map<string, PooledPlace>()

  return {
    put(incoming) {
      const addedAt = new Date().toISOString()
      for (const place of incoming) {
        if (!place.placeId) continue
        places.set(place.placeId, { ...place, addedAt })
      }
    },
    list() {
      // 由新到舊:LLM 最可能關心的是剛查到的那批。
      return [...places.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    },
    get(placeId) {
      return places.get(placeId)
    },
    clear() {
      places.clear()
    },
  }
}
