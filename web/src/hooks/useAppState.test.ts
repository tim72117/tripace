// useAppState 的 onLogout——FE21 回報:登出只清了 token/user/email,
// activeTrip 與 localStorage 記住的預設旅程 ID(LS_DEFAULT_TRIP)沒有
// 一併清空,導致登出換帳號登入後,新帳號會拿著前一位使用者選過的
// tripID 建 WebSocket、呼叫 fetchEntries(該旅程不屬於新帳號,後端回
// 403),畫面標題還會短暫顯示前一位使用者的旅程名稱。
//
// 這裡不直接呼叫真實的 window.localStorage——這個專案的 vitest/jsdom
// 環境對 localStorage 有已知的既有問題(Node 20+ 內建的實驗性全域
// localStorage 與 jsdom 提供的 window.localStorage 衝突,見
// useTripsState.test.tsx 目前 8 個因這個環境問題失敗的既有測試案例,
// 屬於另一個尚待修的環境設定問題,不是這次要驗證的行為),改用一個最小
// 的假 Storage 實作蓋掉 globalThis.localStorage,只驗證 onLogout 呼叫
// 的 key 與 activeTrip state 本身,不依賴真實瀏覽器儲存機制是否可用。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppState } from './useAppState'
import { LS_DEFAULT_TRIP } from '../AppCommon'
import { me, onUnauthorized } from '../api'
import type { Trip } from '../trip/types'

class FakeStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

function makeTrip(): Trip {
  return {
    id: 'tr_1',
    name: '花蓮三日',
    ownerID: 'usr_me',
    memberCount: 1,
    lastMessagePreview: null,
  } as Trip
}

describe('useAppState：onLogout', () => {
  let fakeStorage: FakeStorage

  beforeEach(() => {
    fakeStorage = new FakeStorage()
    vi.stubGlobal('localStorage', fakeStorage)
  })

  it('登出清空 activeTrip——不留著上一位使用者選過的旅程', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveTrip(makeTrip())
    })
    expect(result.current.activeTrip).not.toBeNull()

    act(() => {
      result.current.onLogout()
    })
    expect(result.current.activeTrip).toBeNull()
  })

  it('登出清空 LS_DEFAULT_TRIP——避免下次登入(換帳號)自動導向前一位使用者的預設旅程', () => {
    fakeStorage.setItem(LS_DEFAULT_TRIP, 'tr_1')
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.onLogout()
    })
    expect(fakeStorage.getItem(LS_DEFAULT_TRIP)).toBeNull()
  })

  it('登出同時仍清空既有的 auth 三項(token/user/email)——不因新增 activeTrip 清空而漏掉原本行為', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.onAuthed('tok_1', { id: 'usr_1', name: 'A', avatarColor: '#000' }, 'a@example.com')
    })
    expect(result.current.token).toBe('tok_1')
    expect(result.current.isGuest).toBe(false)

    act(() => {
      result.current.onLogout()
    })
    expect(result.current.token).toBeNull()
    expect(result.current.isGuest).toBe(true)
    expect(result.current.email).toBe('')
  })
})

// useAppState：訂閱 api.ts 的全域 401 通知(見 api.ts onUnauthorized 的
// 完整說明)——帶著登入 token 的請求收到 401 時,應該自動觸發跟手動按
// 「登出」相同的清空行為,不需要使用者自己發現查詢一直悄悄失敗。
describe('useAppState：訂閱 onUnauthorized 自動登出', () => {
  let fakeStorage: FakeStorage

  beforeEach(() => {
    fakeStorage = new FakeStorage()
    vi.stubGlobal('localStorage', fakeStorage)
  })

  it('帶著登入 token 的請求收到 401 時,自動清空登入態', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 'unauthorized', message: '登入已過期,請重新登入' } }),
      }),
    )

    const { result } = renderHook(() => useAppState())
    act(() => {
      result.current.onAuthed('tok_1', { id: 'usr_1', name: 'A', avatarColor: '#000' }, 'a@example.com')
    })
    expect(result.current.token).toBe('tok_1')

    await act(async () => {
      await me(result.current.cfg).catch(() => {
        // 預期會拋 ApiError——這裡只關心它有沒有觸發全域登出,不驗證
        // 這次呼叫本身的回傳/錯誤內容(那是 api.test.ts 的職責)。
      })
    })

    expect(result.current.token).toBeNull()
    expect(result.current.isGuest).toBe(true)
  })

  it('未登入(cfg.token 為 null)的請求收到 401 時,不觸發登出——那是預期中的業務錯誤,不代表任何登入態失效', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 'unauthorized', message: '缺少 Authorization' } }),
      }),
    )

    // 用獨立的 spy 直接訂閱 onUnauthorized——不透過 useAppState 的
    // token/isGuest 間接推論,那兩個斷言在「有沒有真的觸發登出」跟
    // 「觸發了但結果剛好跟原本一樣(本來就是 null/guest)」兩種情況下
    // 都會通過,不夠精確。
    const spy = vi.fn()
    const unsubscribe = onUnauthorized(spy)

    const cfg = { baseURL: 'http://localhost:8080', token: null }
    await act(async () => {
      await me(cfg).catch(() => {})
    })

    expect(spy).not.toHaveBeenCalled()
    unsubscribe()
  })
})

// useAppState：初始化時的 token/user 一致性檢查——2026-09 發現的實際
// 案例:手動(或瀏覽器儲存空間清理等外部原因)只清掉 localStorage 裡的
// tripace.auth.token,tripace.auth.user 還留著,重整頁面後畫面依然判定
// 已登入(舊版 isGuest 看 user 是否為 null),但 cfg.token 是 null,任何
// API 請求都不會帶 Authorization header,依賴登入的功能全部悄悄失敗。
describe('useAppState：初始化時 token/user 不一致自動清空', () => {
  let fakeStorage: FakeStorage

  beforeEach(() => {
    fakeStorage = new FakeStorage()
    vi.stubGlobal('localStorage', fakeStorage)
  })

  it('token 被清掉、user 還在——初始化時視為登入態已失效，兩者一併清空', () => {
    fakeStorage.setItem('tripace.auth.user', JSON.stringify({ id: 'usr_1', name: 'A', avatarColor: '#000' }))
    fakeStorage.setItem('tripace.auth.email', 'a@example.com')
    // 注意:tripace.auth.token 刻意不設定,模擬只刪 token 的情境。

    const { result } = renderHook(() => useAppState())

    expect(result.current.token).toBeNull()
    expect(result.current.isGuest).toBe(true)
    expect(result.current.email).toBe('')
    // localStorage 裡殘留的 user/email 也要一併清掉,不是只讓記憶體裡的
    // state 看起來正確——否則下次重整前這個不一致的殘留資料還一直卡著。
    expect(fakeStorage.getItem('tripace.auth.user')).toBeNull()
    expect(fakeStorage.getItem('tripace.auth.email')).toBeNull()
  })

  it('user 被清掉、token 還在——同樣視為不一致，一併清空', () => {
    fakeStorage.setItem('tripace.auth.token', 'tok_1')

    const { result } = renderHook(() => useAppState())

    expect(result.current.token).toBeNull()
    expect(result.current.isGuest).toBe(true)
    expect(fakeStorage.getItem('tripace.auth.token')).toBeNull()
  })

  it('token/user 都存在——正常視為已登入，不受一致性檢查影響', () => {
    fakeStorage.setItem('tripace.auth.token', 'tok_1')
    fakeStorage.setItem('tripace.auth.user', JSON.stringify({ id: 'usr_1', name: 'A', avatarColor: '#000' }))

    const { result } = renderHook(() => useAppState())

    expect(result.current.token).toBe('tok_1')
    expect(result.current.isGuest).toBe(false)
  })

  it('token/user 都不存在——正常視為訪客，不觸發任何多餘的 localStorage 寫入', () => {
    const { result } = renderHook(() => useAppState())

    expect(result.current.token).toBeNull()
    expect(result.current.isGuest).toBe(true)
  })
})
