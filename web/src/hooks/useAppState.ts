import { useCallback, useState } from 'react'
import type { ClientConfig } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import { BASE_URL } from '../AppCommon'

// 登入身分存 localStorage:跨分頁共用同一身分(一般網站慣例)。
const AUTH_TOKEN_KEY = 'tripace.auth.token'
const AUTH_USER_KEY = 'tripace.auth.user'
const AUTH_EMAIL_KEY = 'tripace.auth.email'

// 訪客身分(未登入),需與後端 guestUser 一致。
const GUEST_USER: User = { id: 'usr_me', name: '訪客', avatarColor: '#8C7B6A' }

export function useAppState() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(AUTH_TOKEN_KEY),
  )
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  })
  const [email, setEmail] = useState<string>(
    () => localStorage.getItem(AUTH_EMAIL_KEY) ?? '',
  )

  const onAuthed = useCallback((tok: string, u: User, mail: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, tok)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u))
    localStorage.setItem(AUTH_EMAIL_KEY, mail)
    setToken(tok)
    setUser(u)
    setEmail(mail)
  }, [])

  const onLogout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    localStorage.removeItem(AUTH_EMAIL_KEY)
    setToken(null)
    setUser(null)
    setEmail('')
  }, [])

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null)

  const cfg: ClientConfig = { baseURL: BASE_URL, token }
  const effectiveUser = user ?? GUEST_USER

  return {
    cfg, activeTrip, setActiveTrip,
    token, setToken,
    user: effectiveUser, email, isGuest: user == null,
    onAuthed, onLogout,
  }
}
