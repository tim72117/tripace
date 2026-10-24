// readAuthToken / useGuestClientConfig:公開頁(/ai-plan)用「有沒有 token」組出 ClientConfig。
// 原本 LivePlanLayer 與 planning/preview/Content 各寫一份相同的程式,現在共用。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { BASE_URL } from '../../AppCommon'
import { AUTH_TOKEN_KEY, readAuthToken, useGuestClientConfig } from './config'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readAuthToken', () => {
  it('讀得到:回傳 token;讀不到:回 null(訪客)', () => {
    expect(readAuthToken()).toBeNull()
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok_123')
    expect(readAuthToken()).toBe('tok_123')
  })

  it('localStorage 被停用(無痕模式等,存取就丟例外):當作訪客,不讓整頁壞掉', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readAuthToken()).toBeNull()
  })

  it('用的是登入後存 token 的同一個 key', () => {
    expect(AUTH_TOKEN_KEY).toBe('tripace.auth.token')
  })
})

describe('useGuestClientConfig', () => {
  it('組出 { baseURL, token }:有 token 就帶上', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok_abc')
    const { result } = renderHook(() => useGuestClientConfig())
    expect(result.current).toEqual({ baseURL: BASE_URL, token: 'tok_abc' })
  })

  it('沒有 token:token 為 null(request 不帶 Authorization,走免登入端點)', () => {
    const { result } = renderHook(() => useGuestClientConfig())
    expect(result.current.token).toBeNull()
    expect(result.current.baseURL).toBe(BASE_URL)
  })

  it('身分穩定:重新渲染不會換新物件,即使 localStorage 之後變了(只在掛載時讀一次)', () => {
    const { result, rerender } = renderHook(() => useGuestClientConfig())
    const first = result.current
    localStorage.setItem(AUTH_TOKEN_KEY, 'later')
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.token).toBeNull()
  })
})
