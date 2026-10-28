import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

// useElementHeight——2026-10 新增(使用者明確要求「有什麼方法可以確保
// bottom sheet 如果是在功能列後面,標頭不會被遮蔽,也不用功能列改動
// 高度,就要重新確認」「我要穩定根本的處理方式」):取代目前散落各處把
// phone/Nav.module.css 的 .tab 高度(64px)當作寫死數字複製貼上的做法
// (trip/phone/TripList.tsx/PhoneTimelineDrawer.tsx/
// PlanPhoneView.module.css 都各自寫一份 64px,靠人工記得同步,每個檔案
// 的註解都承認「調整這裡要一併同步那幾處」)——用 ResizeObserver 量測
// 參照元素的真實 clientHeight,回傳值永遠反映瀏覽器實際算出來的高度,
// 不是任何人手動維護的數字。phone/Nav 之後不管怎麼改版面(加一行
// 文案、換字級、調整 padding),所有依賴這個 hook 的呼叫端都會自動拿到
// 正確的新高度,不需要回頭檢查/修改任何依賴它的程式碼。
//
// 初始值 0——ResizeObserver 的 callback 要等瀏覽器完成第一次 layout 後
// 才會觸發,掛載當下這一瞬間還沒有真正的量測結果,回傳 0 讓呼叫端可以
// 自行決定這段極短暫的空窗期要不要有 fallback(例如先假設功能列不存在、
// 等第一次量測結果進來再修正定位,通常只有一個 frame 的落差,肉眼看
// 不太出來)。
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 初次掛載立刻量一次——ResizeObserver 本身在 observe() 呼叫後也會
    // 立刻觸發一次 callback(不需要真的等到尺寸變化才觸發第一次),這裡
    // 額外同步量一次只是為了在 ResizeObserver 不支援的極端環境下仍有
    // 基本的初始值(目前主流瀏覽器都支援,這裡純粹防禦性處理)。
    setHeight(el.getBoundingClientRect().height)

    // typeof ResizeObserver === 'undefined'——這個專案的測試環境
    // (vitest + jsdom)原生不實作 ResizeObserver,沒有這層防禦的話,
    // 任何掛載了使用這個 hook 的元件(例如 planning/member/phone/Content.tsx)的測試都會
    // 直接噴 ReferenceError。真實瀏覽器(含所有主流行動瀏覽器)都支援
    // 這個 API,這裡純粹是讓同一份程式碼能同時在兩種環境下運作,不是
    // 為了支援舊瀏覽器的 polyfill——沒有 ResizeObserver 時退化成只有
    // 掛載當下量一次、之後尺寸變化不會再更新,不中斷渲染。
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      // borderBoxSize 优先(含 padding/border 的完整外框高度,符合
      // getBoundingClientRect 的語意),部分瀏覽器(舊版 Safari)不支援
      // 這個欄位時 fallback 回 contentRect(不含 border,但差距通常只有
      // 1-2px,不影響實際避讓效果)。
      const borderBoxSize = entry.borderBoxSize?.[0]
      setHeight(borderBoxSize ? borderBoxSize.blockSize : entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return height
}
