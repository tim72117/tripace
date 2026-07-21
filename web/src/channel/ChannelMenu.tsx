import { useState } from 'react'
import { LS_DEFAULT_CHANNEL } from '../App'

// ---- 行程菜單(右上角設定) ----

export function ChannelMenu({ channelID }: { channelID: string }) {
  const [open, setOpen] = useState(false)
  const defaultID = localStorage.getItem(LS_DEFAULT_CHANNEL)
  const isDefault = defaultID === channelID

  const setAsDefault = () => {
    localStorage.setItem(LS_DEFAULT_CHANNEL, channelID)
    setOpen(false)
  }

  const clearDefault = () => {
    localStorage.removeItem(LS_DEFAULT_CHANNEL)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn icon-btn"
        onClick={() => setOpen(!open)}
        title="行程設定"
        style={{ padding: 0 }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            background: 'var(--ios-white)',
            border: '1px solid var(--ios-separator)',
            borderRadius: 8,
            marginTop: 4,
            minWidth: 180,
            zIndex: 1000,
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          }}
        >
          {!isDefault ? (
            <button
              onClick={setAsDefault}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--ios-link)',
                borderBottom: '1px solid var(--ios-separator)',
              }}
            >
              ✓ 開啟時自動進入
            </button>
          ) : (
            <button
              onClick={clearDefault}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: '#FF3B30',
              }}
            >
              ✗ 取消自動進入
            </button>
          )}
        </div>
      )}
    </div>
  )
}
