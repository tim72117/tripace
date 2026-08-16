import { useState } from 'react'
import styles from './TokenDisplay.module.css'

// TokenDisplay:API Token 顯示 + 複製按鈕,SettingsDialog(桌面版)/
// SettingsScreen(手機版)共用,理由同 LangSelect。
export function TokenDisplay({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false)

  const copyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  if (!token) return null

  const displayToken = token.substring(0, 20) + '...' + token.substring(token.length - 10)

  return (
    <>
      <div className={styles.tokenBox}>{displayToken}</div>
      <div style={{ padding: '0 16px 12px' }}>
        <button className={`btn-secondary${copied ? ' success' : ''}`} onClick={copyToken}>
          {copied ? '✅ 已複製' : '複製 Token'}
        </button>
      </div>
    </>
  )
}
