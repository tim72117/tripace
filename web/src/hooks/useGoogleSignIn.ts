import { useEffect, useRef, useState } from 'react'

// useGoogleSignIn——載入 Google Identity Services(GSI)官方 JS SDK,並在
// 指定的 DOM 節點上渲染官方按鈕(google.accounts.id.renderButton)。採用
// GSI 模式而非整頁 redirect:成功登入時的回呼直接拿到一個 credential
// 字串(Google 簽發的 ID Token/JWT),丟給後端 POST /v1/auth/google 驗證
// 即可,不需要 state cookie/CSRF redirect 防護那一整套(見
// LoginForm.tsx 的完整背景說明)。
//
// clientID 未設定(VITE_GOOGLE_OAUTH_CLIENT_ID 沒填)時,這個 hook 完全
// 不會載入 SDK、不會渲染按鈕——呼叫端(LoginForm)據此優雅降級:不顯示
// Google 登入按鈕,不顯示壞掉的按鈕、不報錯。這是 build time 就能決定的
// 事(clientID 是建置時注入的環境變數),不需要額外打一支 API 才能知道
// 要不要顯示按鈕。

// GSI SDK 的型別範圍很小,這個專案沒有安裝對應的 @types 套件(如
// @types/google.accounts),故在這裡自行宣告用得到的最小介面,不聲明成
// any——維持型別檢查的意義,但不需要為了一顆按鈕的型別去多裝一個套件。
interface GoogleIdCredentialResponse {
  credential: string
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string
    callback: (response: GoogleIdCredentialResponse) => void
  }): void
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'large' | 'medium' | 'small'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      logo_alignment?: 'left' | 'center'
      width?: number
    },
  ): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

// GSI SDK 是全域單例(google.accounts.id 掛在 window 上),多個元件實例
// (例如同時掛載的 LoginForm 與 CliAuthPage 各自的登入表單)不該各自注入
// 一份 <script>——用模組層級的 promise 快取「載入中/已完成」的狀態,
// 重複呼叫 loadGsiScript() 一律拿到同一個 promise。
let gsiLoadPromise: Promise<void> | null = null

function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gsiLoadPromise) return gsiLoadPromise

  gsiLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GSI_SCRIPT_SRC}"]`,
    )
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Identity Services 腳本載入失敗')))
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Identity Services 腳本載入失敗'))
    document.head.appendChild(script)
  })
  return gsiLoadPromise
}

// useGoogleSignIn:掛載時(clientID 有值才會動作)載入 GSI SDK、
// initialize、並把官方按鈕渲染進 buttonRef 指向的節點。onCredential 在
// 使用者完成 Google 登入時被呼叫,帶入 credential(ID Token 字串)。
//
// 回傳 { buttonRef, ready, error }:
// - buttonRef 要掛在一個空的 <div> 上,SDK 會把官方按鈕渲染進去
// - ready 代表 SDK 已載入、按鈕已渲染(可用來控制外層容器顯示與否,
//   避免版面在載入前後跳動)
// - error 是載入/初始化失敗時的訊息,呼叫端可選擇顯示或靜默忽略(整體
//   仍是「優雅降級」精神——Google 登入壞了不該擋住 email/password 登入)
export function useGoogleSignIn(
  clientID: string | undefined,
  onCredential: (credential: string) => void,
) {
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // onCredential 若直接進依賴陣列,呼叫端每次渲染傳新的箭頭函式會導致
  // 這個 effect 重複執行、重複渲染按鈕——用 ref 存最新的回呼,effect 本身
  // 只依賴 clientID(理由同 GeoOutlineMap.tsx 對 onPoiSelectRef 之類的
  // 既有慣例:回呼在 initialize 當下被閉包捕捉,之後只透過 ref 取得最新
  // 版本,不需要因為回呼本身變動就重新初始化整個 GSI 元件)。
  const onCredentialRef = useRef(onCredential)
  onCredentialRef.current = onCredential

  useEffect(() => {
    if (!clientID) return
    if (!buttonRef.current) return
    let cancelled = false

    loadGsiScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: clientID,
          callback: (response) => onCredentialRef.current(response.credential),
        })
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'left',
        })
        setReady(true)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Google 登入初始化失敗')
      })

    return () => {
      cancelled = true
    }
  }, [clientID])

  return { buttonRef, ready, error }
}
