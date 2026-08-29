// useKeyboardShrink:回傳目前使用者實際看得到的高度(px)——供 App.tsx
// 的 KeyboardShrinkGuard 拿來覆蓋 /app 路由根容器的高度(取代 CSS 的
// 100dvh),讓根容器的實際高度跟著 iOS 虛擬鍵盤彈出即時縮小。
//
// 排查結論(手機真機實測,見 ChatScreen.tsx 曾經加過的除錯標籤與
// useKeyboardInset/useKeyboardInsetDebug 的排查歷史):
//   - .composer(輸入框,position: absolute; bottom: 0)的位置數學上一直
//     是對的,不需要調整——實測 offsetTop + visualViewport.height 恆等於
//     掛載時的基準高度,代表 iOS 已經把可視視窗精確平移到頁面最底部,
//     composer 天生落在可視範圍內。
//   - 曾經試過 transform: translateY(-offsetTop) 反向抵銷平移(見 git
//     歷史的 useKeyboardPan),實測失敗且反而讓輸入框跑位——iOS 平移
//     可視視窗的目的就是要讓聚焦輸入框露出鍵盤上方,translateY 把內容
//     視覺上搬回原位,等於把原本剛好對齊鍵盤上緣的輸入框又搬回鍵盤
//     底下,治標不治本。
//   - 改成這個做法:讓根容器的實際高度直接縮小成
//     visualViewport.height,不再嘗試「抵銷」平移,而是讓平移的觸發
//     條件本身消失(可視範圍已經精確等於容器高度,沒有東西被鍵盤蓋住
//     需要平移去顯示)。
//
// 動畫過渡期的排查(手機真機實測):
//   - 剛彈出鍵盤時容器高度會「先往下又返回」,一開始懷疑是鍵盤動畫
//     過程中 resize/scroll 事件觸發多次、中間值不單調,加了固定
//     debounce 想只採用「穩定下來」的最終值,但代價是收鍵盤時輸入框
//     要延遲一小段才跟著往下移動,使用者能感知到延遲。
//   - 換個角度重新檢視,更可能的成因是自己造成的回饋迴圈:原本的做法
//     每次 commit 都呼叫 window.scrollTo(0, 0)重置殘留捲動——但這個
//     呼叫本身很可能觸發一次新的 visualViewport scroll 事件,讓 handler
//     又跑一次、抓到鍵盤動畫中途還沒穩定的值,形成「改高度 → scrollTo
//     → 觸發 scroll → 又 commit 一次(可能是中途值)」的迴圈,這才是
//     「來回跳動」的真正成因,不是鍵盤動畫本身的性質。
//   - 改成不對稱策略,不再需要固定 debounce:
//     1. resize 事件(鍵盤高度真的在變化)才更新高度、且改用
//        requestAnimationFrame 疊代偵測——連續兩幀讀到相同的
//        visualViewport.height 才視為鍵盤動畫已經穩定,套用這個值。
//        不用固定時間的 debounce,是因為「連續兩幀不變」本身就是
//        「已經穩定」的直接證據,不需要额外等待一段武斷的時間。
//     2. scroll 事件(單純捲動位置變化,不是鍵盤高度變化)只負責呼叫
//        scrollTo(0, 0)歸位,不重新讀取/套用高度——避免 scrollTo 觸發
//        的下一次 scroll 事件又被拿去更新高度,打斷回饋迴圈。
//     3. 直接操作 DOM(ref.current.style.height),不透過 React state
//        ——setState 的非同步批次會讓「量測時刻」與「實際套用時刻」
//        錯開一到多個 React render,這個時間差本身就可能造成「套用了
//        已經過期的值、下一輪 render 才修正」的視覺跳動,直接寫 DOM
//        沒有這層額外的非同步間隔。
//     4. blur/focusout(鍵盤開始收起的訊號,幾乎與收起動畫同時觸發)
//        時立即移除 inline height(交還給 CSS 的 100dvh),不用等
//        visualViewport 事件——收鍵盤時的目標高度是已知的滿版高度,
//        不需要量測,可以做到零延遲響應,這是使用者實測回報「收鍵盤時
//        輸入框會延遲一段時間才往下」這個問題的直接解法。
//
import { useEffect } from 'react'
import type { RefObject } from 'react'

// STABLE_FRAMES:連續幾幀讀到相同高度才視為鍵盤動畫已經穩定——2 幀是
// 最低限度的「不再變化」證據,不刻意拉高門檻(每多等一幀就多一點延遲)。
const STABLE_FRAMES = 2

// STABLE_MIN_MS:距離上一次真正觸發 resize 事件,至少要過這麼久才允許
// 套用——單靠「連續幀數值不變」不夠可靠:鍵盤動畫過程中 resize 事件本身
// 可能觸發不只一次、帶著不同的中間高度值,若剛好連續兩幀之間沒有新的
// resize 事件插進來,會被誤判成「已經穩定」而提前套用一個還沒到位的
// 中間值(使用者實測回報「還是有先往下再返回」,即使已經改用穩定幀
// 偵測)。疊加這個時間下限,只有「連續幀不變」且「距離上次 resize 事件
// 已經過了這麼久」兩者都成立才真正套用,避免中間空檔被誤判。
const STABLE_MIN_MS = 60

// useKeyboardShrink:直接把量測到的高度寫進 targetRef 指向元素的
// style.height(不透過 React state,理由見上方檔案說明)。呼叫端只需要
// 把要縮放的根容器的 ref 傳進來,不需要自己處理任何量測/事件邏輯。
export function useKeyboardShrink(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let rafId: number | undefined
    let stableCount = 0
    let lastHeight = -1
    let lastResizeAt = 0

    function applyHeight(height: number) {
      const el = targetRef.current
      if (!el) return
      if (height < window.innerHeight) {
        el.style.height = `${Math.round(height)}px`
      } else {
        el.style.height = ''
      }
    }

    // waitForStable:每一幀讀一次 visualViewport.height,連續
    // STABLE_FRAMES 幀數值相同、且距離上一次 resize 事件已經過了
    // STABLE_MIN_MS,才真正套用——兩個條件缺一不可,理由見 STABLE_MIN_MS
    // 的說明。
    function waitForStable() {
      if (!vv) return
      const current = vv.height
      if (current === lastHeight) {
        stableCount += 1
      } else {
        stableCount = 0
        lastHeight = current
      }
      if (stableCount >= STABLE_FRAMES && Date.now() - lastResizeAt >= STABLE_MIN_MS) {
        applyHeight(current)
        return
      }
      rafId = requestAnimationFrame(waitForStable)
    }

    function onResize() {
      stableCount = 0
      lastHeight = -1
      lastResizeAt = Date.now()
      if (rafId != null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(waitForStable)
    }

    // onScroll:只負責把 visualViewport 因鍵盤彈出被平移的位置歸零,不
    // 重新量測/套用高度——歸零這個動作本身很可能又觸發一次 scroll
    // 事件,若這裡也跟著重新量測高度,會形成自己觸發自己的回饋迴圈
    // (這是先前「容器高度先往下又返回」的懷疑根因)。
    function onScroll() {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0)
      }
    }

    // onFocusOut:鍵盤開始收起的訊號,幾乎跟收起動畫同時觸發——收鍵盤
    // 的目標高度是已知的(滿版,交還給 CSS 的 100dvh),不需要等
    // visualViewport 事件才能量測,直接清空 inline height 做到零延遲。
    // 用 focusout(會冒泡)監聽整個 document,不需要知道是哪個特定的
    // input 失焦。
    function onFocusOut() {
      stableCount = 0
      lastHeight = -1
      if (rafId != null) cancelAnimationFrame(rafId)
      const el = targetRef.current
      if (el) el.style.height = ''
    }

    onResize()
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onScroll)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [targetRef])
}
