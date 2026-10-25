import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

// useHeightTransition——詢問頁換步驟時,把面板(.bubble)的高度從舊值平滑過渡到新值(FLIP)。
//
// 問題:手機版(非 stacked)的詢問頁依內容撐高,國家/城市卡、景點照片卡、交通小方塊高度都不同,換步驟時面板上下
// 瞬間跳一截(Fable UX review 建議 D)。做法:
//   - 隨時記住 .bubble 目前的高度(每次 commit 量一次,加上 ResizeObserver 追蹤兩次 commit 之間的變化,例如面板
//     內部內容自己變高變矮、動畫進行中的高度)。
//   - stepKey 變了(換步驟)時,在 layout effect(新內容已在 DOM、還沒畫出來)量新高度,用 WAAPI 從舊高度動到新高度,
//     期間 .bubble 暫時 overflow: hidden(長高時新內容由下往上露出,不會溢出氣泡外框),結束或取消時還原。
//   - 第一次掛載不動(沒有「舊高度」);prefers-reduced-motion 跳過;disabled(寬螢幕側欄,固定高度)整個跳過;
//     瀏覽器沒有 element.animate 時跳過。
//   - 動畫中途又換步驟:先取消前一個(讓新高度量得到自然值),再從目前的高度(ResizeObserver 記到的
//     動畫中高度)動到新的高度,不會先跳回去。
//   - overflow 還原不靠 cancel 事件:瀏覽器的 cancel/finish 事件是非同步派送,anim.cancel() 返回時 oncancel 還沒跑。
//     若等事件才還原,緊接著開始的新動畫會把「還是 hidden」當成進入前的值記下來,最後永久還原成 hidden。所以取消前一個
//     動畫(換步驟、卸載)時先同步呼叫它的 restore,再 cancel;之後才到的 cancel 事件因為已不是目前的動畫而不做事。
//
// 跟轉場外殼(AskPage 的 .transition,內容依方向滑入)同處、互不干擾:那邊動的是 .bubble 底下的內容
// (transform/opacity),這裡只動 .bubble 本身的 height。
// .bubble 帶 backdrop-filter,高度動畫期間每格都要重算模糊區域;時間短(220ms)且只有一個元素,實測沒有掉幀。

export const HEIGHT_TRANSITION_MS = 220
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

export function useHeightTransition(
  rootRef: RefObject<HTMLElement | null>,
  stepKey: unknown,
  { selector, disabled = false }: { selector: string; disabled?: boolean },
) {
  const lastHeightRef = useRef<number | null>(null)
  const prevKeyRef = useRef(stepKey)
  const animRef = useRef<{ anim: Animation; el: HTMLElement; restore: () => void } | null>(null)
  const observerRef = useRef<{ ro: ResizeObserver; el: HTMLElement } | null>(null)

  // observe——ResizeObserver 跟著目前的 .bubble。換面板元件時 .bubble 會是新的元素;面板內部自己換畫面(過去的例子是
  // 已移除的「我要直接說明」展開;現在任何不經過 stepKey 的內部換畫面都一樣)也會換掉 .bubble 而不經過這個 hook 所在元件的重繪,所以另外用 MutationObserver 盯著 DOM
  // 結構變化重新掛上(見下方)。已經從 DOM 移除的舊元素回報的 0 高度不採用。
  const observe = (el: HTMLElement | null) => {
    if (observerRef.current?.el === el) return
    observerRef.current?.ro.disconnect()
    observerRef.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) return
      lastHeightRef.current = el.getBoundingClientRect().height
    })
    ro.observe(el)
    observerRef.current = { ro, el }
  }

  // stopCurrent——同步還原 overflow(restore 會清掉 animRef)再取消動畫,確保最終一定還原成進入前的值。
  const stopCurrent = () => {
    const cur = animRef.current
    if (!cur) return
    cur.restore()
    cur.anim.cancel()
  }

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || typeof MutationObserver === 'undefined') return
    const mo = new MutationObserver(() => observe(root.querySelector<HTMLElement>(selector)))
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector])

  useLayoutEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(selector) ?? null
    const keyChanged = prevKeyRef.current !== stepKey
    prevKeyRef.current = stepKey
    observe(el)

    if (!el) {
      lastHeightRef.current = null
      return
    }

    const from = lastHeightRef.current
    const canAnimate =
      keyChanged &&
      !disabled &&
      from !== null &&
      typeof el.animate === 'function' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!canAnimate) {
      // 動畫進行中(同一步驟內重繪)量到的是動畫中的高度,交給 ResizeObserver,不覆寫。
      if (!animRef.current) lastHeightRef.current = el.getBoundingClientRect().height
      return
    }

    // 先取消前一個動畫:動畫中的 height 會蓋過自然高度,不取消量不到新內容真正的高度。
    stopCurrent()
    const to = el.getBoundingClientRect().height
    lastHeightRef.current = to
    if (Math.abs(to - from) < 1) return

    const prevOverflow = el.style.overflow
    el.style.overflow = 'hidden'
    const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: HEIGHT_TRANSITION_MS, easing: EASING })
    const restore = () => {
      if (animRef.current?.anim !== anim) return
      animRef.current = null
      el.style.overflow = prevOverflow
    }
    animRef.current = { anim, el, restore }
    anim.onfinish = restore
    anim.oncancel = restore
  })

  // 卸載:停掉進行中的動畫並還原 overflow(元素可能被保留或重用,不能把 hidden 留在上面)。
  useLayoutEffect(() => () => {
    stopCurrent()
    observerRef.current?.ro.disconnect()
    observerRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
