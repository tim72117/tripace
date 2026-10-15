import { useCallback, useRef } from 'react'

// useDeferredPromptSender:把「對話的 sendPrompt 還沒準備好」這個空窗期
// 收斂成一個可獨立測試的單元,供「想去哪裡?」氣泡(DestinationPrompt)的
// 桌面版(DesktopLayout.tsx)與手機版(PhoneContent.tsx)共用。
//
// 背景:sendPrompt 住在 lazy 載入的 TripPlanPage 內部,要等它掛載後透過
// onSendPromptReady 交出參照。原本兩處都用一個回傳 false 的空實作當初始
// 值——使用者若在 chunk 載入完成前就選完城市,空實作靜默吃掉這句話,
// 氣泡卻已經關閉,選擇憑空消失。
//
// 做法:還沒就緒時把最新一句話暫存,register 收到 sendPrompt 的那一刻
// 補送。只保留最後一句(使用者只會選定一次;重複選擇時以最後一次為準,
// 不會把舊的也補送出去)。
//
// 已就緒後 sendPrompt 自己回傳 false(例如對話正在回應中被並發保護
// 擋下)不在這裡處理——那是 sendPrompt 的語意,呼叫端拿得到回傳值。
export type PromptSender = (text: string) => Promise<boolean>

export function useDeferredPromptSender() {
  const senderRef = useRef<PromptSender | null>(null)
  const pendingRef = useRef<string | null>(null)

  // register:給 TripPlanPage 的 onSendPromptReady。可重複呼叫(對話橋接
  // 重建時會交出新參照),每次都以最新的為準。
  const register = useCallback((send: PromptSender) => {
    senderRef.current = send
    const pending = pendingRef.current
    if (pending !== null) {
      pendingRef.current = null
      void send(pending)
    }
  }, [])

  // submit:送出一句話。就緒時直接送並回傳 sendPrompt 的結果;未就緒時
  // 暫存並回傳 false(「尚未送出」,會在 register 時補送)。
  const submit = useCallback((text: string): Promise<boolean> => {
    const send = senderRef.current
    if (send) return send(text)
    pendingRef.current = text
    return Promise.resolve(false)
  }, [])

  return { register, submit }
}
