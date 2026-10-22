import { useMemo } from 'react'
import { BASE_URL } from '../AppCommon'
import type { ClientConfig } from '../api'

// 公開頁(/ai-plan)用「有沒有 token」組出 ClientConfig。LivePlanLayer(推論態的 TripPlanPage)與
// plan-ai-sim/Content(地圖圖層查資料)原本各寫一份相同的程式,現在共用。
//
// 刻意不走 useAppState():那支 hook 還負責旅程清單、主題、登出等一整套登入後的狀態機,公開展示頁只需要
// 「有沒有 token」這一件事,引進整個 hook 會讓這一層依賴到跟它無關的東西。

// 登入後存 token 的 localStorage key(useAppState 寫入的就是這個)。
export const AUTH_TOKEN_KEY = 'tripace.auth.token'

// readAuthToken——讀 localStorage 裡的登入 token。讀不到、或 localStorage 被停用(無痕模式等,存取就丟
// 例外)都回 null,當作訪客,不讓整頁壞掉。
export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

// useGuestClientConfig——{ baseURL, token }。token 為 null(訪客)時 request() 不帶 Authorization
// header,圖層與資料來源會改走免登入端點。只在掛載時讀一次,身分穩定。
export function useGuestClientConfig(): ClientConfig {
  return useMemo<ClientConfig>(() => ({ baseURL: BASE_URL, token: readAuthToken() }), [])
}
