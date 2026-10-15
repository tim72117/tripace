import { useEffect, useRef, useState } from 'react'

// useTypewriter——把一段文字逐字顯示出來的打字動畫效果,目前只有
// DestinationPrompt.tsx 使用(使用者明確要求「想去哪裡?」這句
// 文案要用打字效果顯示),放在 web/src/ 頂層而非 DestinationPrompt.tsx
// 內部的理由:這是一個跟「對話氣泡」語意無關的通用文字動畫邏輯(純粹是
// setInterval 逐字拼字串),未來如果有其他地方也需要同樣效果,不需要再
// 另外抽一次。
//
// 回傳值:
//   - displayedText:目前已經打出來的子字串(從空字串開始,每個
//     intervalMs 多打一個字,打完整句後停住)
//   - done:整句是否已經打完。呼叫端可以用這個時機點觸發「文字打完後,
//     膠囊才出現」的分階段顯示(使用者明確要求「先顯示你去哪裡,下面
//     再出現可選的膠囊」)。
//
// text 變動時會重新從頭開始打——目前唯一的呼叫情境(DestinationPrompt
// 的兩層選單切換,question 文字從「想去哪裡?」變成「○○——想去哪個
// 城市?」)也確實需要重新打字,不需要額外做「text 變了但不重播」的旗標。
export function useTypewriter(text: string, intervalMs = 32) {
  const [displayedText, setDisplayedText] = useState('')
  const [done, setDone] = useState(false)
  // prefersReducedMotionRef——只在 effect 第一次執行時讀一次即可,這個
  // 媒體查詢的值在單一次元件生命週期內變動的機率極低,不需要另外監聽
  // change 事件。
  const prefersReducedMotionRef = useRef<boolean | null>(null)
  if (prefersReducedMotionRef.current == null) {
    prefersReducedMotionRef.current =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
  }

  useEffect(() => {
    // 使用者明確要求過「使用打字效果」,但不希望因此違反
    // prefers-reduced-motion 的無障礙偏好——直接整句顯示,避免讓對動畫
    // 敏感的使用者看到逐字跳動的文字。
    //
    // 空字串仍代表「還沒有東西可以顯示」而非「已經顯示完」,done 維持
    // false——跟下方一般分支對 text.length === 0 的處理一致,否則呼叫端
    // 在氣泡進場前餵空字串時,選項膠囊會在題目空白時先出現。
    if (prefersReducedMotionRef.current) {
      setDisplayedText(text)
      setDone(text.length > 0)
      return
    }

    setDisplayedText('')
    setDone(false)

    // text 為空字串——2026-10 修正(code review 發現的實際 bug):這裡
    // 原本會把 done 設成 true,呼叫端(DestinationPrompt.tsx)在
    // 氣泡彈出動畫跑完(bubbleReady)之前會先餵空字串進來,這個分支讓
    // done 提早變 true,導致選項膠囊在氣泡都還沒彈出、文字都還沒開始打
    // 之前就先短暫閃現一下,違反「先顯示文字再出現膠囊」的設計意圖。
    // 空字串代表「還沒有東西可以打」,語意上是「尚未開始」而非「已經
    // 打完」,不該回報 done:true——維持 false,等呼叫端真正餵進非空
    // 文字時才會進入下方的 setInterval 分支,打完後才設成 true。
    if (text.length === 0) {
      return
    }

    let i = 0
    const timer = window.setInterval(() => {
      i += 1
      setDisplayedText(text.slice(0, i))
      if (i >= text.length) {
        window.clearInterval(timer)
        setDone(true)
      }
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [text, intervalMs])

  return { displayedText, done }
}
