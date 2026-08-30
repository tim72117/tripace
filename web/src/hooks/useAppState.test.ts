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
