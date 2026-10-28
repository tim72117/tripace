import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import {
  SWIPE_BAR_HEIGHT,
  dampSwipeOffset,
  resolveSwipeIntent,
  shouldSettleOpen,
  swipeVelocity,
  type SwipeSample,
} from './swipeReveal'
import { snapToNearestChild } from '../../../hooks/snapScroll'

// useSwipeReveal——橫向時間軸圖卡「往上滑,卡片內下方露出操作列」(類似 iOS 清單項目左滑出現刪除,
// 方向改成往上)。判斷規則在 swipeReveal.ts(純函式);這裡負責手勢流程、同時只開一張、收合時機。
//
// 手勢衝突:卡片要設 CSS touch-action: pan-x——觸控的水平拖曳照常由瀏覽器捲動卡片列(這裡就放手),
// 垂直拖曳不被瀏覽器接手,由這裡處理。判斷出意圖後不再改判。
// 滑鼠沒有原生拖曳捲動,所以滑鼠的水平拖曳由這裡手動捲動卡片列(放手後吸附到最近的卡),
// 讓桌面瀏覽器不開手機模擬也能左右換卡。處理器掛在卡片列(scroller)上,所以空天/住宿/候選卡也能拖。
//
// 拖曳過程直接寫 CSS 變數(--swipe-r)在卡片的 [data-swipe-slide] 元素上,不 setState,避免每次
// pointermove 都重繪;只有放手後的「開/合」才更新 openId。

const SLIDE_SELECTOR = '[data-swipe-slide]'

interface Gesture {
  id: number
  // stopId——null 代表按下的地方不是可上滑的站點卡(只有水平拖曳有效)。
  stopId: string | null
  type: string
  scrollLeft0: number
  slide: HTMLElement | null
  x0: number
  y0: number
  base: number
  intent: 'pending' | 'vertical' | 'horizontal'
  offset: number
  samples: SwipeSample[]
}

export function useSwipeReveal(
  cardRefs: RefObject<Map<string, HTMLDivElement>>,
  scrollerRef: RefObject<HTMLElement | null>,
) {
  const [openId, setOpenId] = useState<string | null>(null)
  const openIdRef = useRef<string | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  // 垂直手勢結束後,瀏覽器仍會對卡片補一個 click(指標已 capture 到卡片),要吞掉,
  // 否則會被當成「選取這張卡」。
  const suppressClickRef = useRef(false)

  const slideOf = useCallback(
    (stopId: string | null) =>
      (stopId && cardRefs.current?.get(stopId)?.querySelector<HTMLElement>(SLIDE_SELECTOR)) || null,
    [cardRefs],
  )

  const apply = useCallback((slide: HTMLElement | null, offset: number) => {
    slide?.style.setProperty('--swipe-r', `${offset}px`)
  }, [])

  const settle = useCallback(
    (stopId: string, open: boolean) => {
      const prev = openIdRef.current
      if (open) {
        if (prev && prev !== stopId) apply(slideOf(prev), 0)
        apply(slideOf(stopId), SWIPE_BAR_HEIGHT)
        openIdRef.current = stopId
        setOpenId(stopId)
      } else {
        apply(slideOf(stopId), 0)
        if (prev === stopId) {
          openIdRef.current = null
          setOpenId(null)
        }
      }
    },
    [apply, slideOf],
  )

  const closeAll = useCallback(() => {
    const prev = openIdRef.current
    if (!prev) return
    apply(slideOf(prev), 0)
    openIdRef.current = null
    setOpenId(null)
  }, [apply, slideOf])

  // 點卡片外面、卡片列捲動(換卡/換日)時收合。外層容器可能是 pointer-events: none,
  // 所以點外面用 document capture 階段監聽。
  useEffect(() => {
    if (!openId) return
    const onDocPointerDown = (e: globalThis.PointerEvent) => {
      const card = cardRefs.current?.get(openId)
      if (card && e.target instanceof Node && card.contains(e.target)) return
      closeAll()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    const scroller = scrollerRef.current
    scroller?.addEventListener('scroll', closeAll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      scroller?.removeEventListener('scroll', closeAll)
    }
  }, [openId, cardRefs, scrollerRef, closeAll])

  // 卸載時中斷進行中的手勢監聽。
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  // 滑鼠水平拖曳放手後:平滑吸附到最近的卡片,再恢復 scroll-snap(共用 hooks/snapScroll)。
  const snapToNearestCard = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    snapToNearestChild(scroller, cardRefs.current?.values() ?? [])
  }, [cardRefs, scrollerRef])

  // 掛在卡片列(scroller)上。stopId 從按下位置往上找 [data-swipe-id](有啟用上滑的站點卡才有)。
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || gestureRef.current) return
      suppressClickRef.current = false
      const target = e.target as HTMLElement
      // 操作列本身的按鈕自己處理點擊,不啟動手勢。
      if (target.closest('[data-swipe-bar]')) return
      const scroller = e.currentTarget
      const stopId = target.closest<HTMLElement>('[data-swipe-id]')?.dataset.swipeId ?? null
      const g: Gesture = {
        id: e.pointerId,
        stopId,
        type: e.pointerType,
        scrollLeft0: scroller.scrollLeft,
        slide: slideOf(stopId),
        x0: e.clientX,
        y0: e.clientY,
        base: stopId && openIdRef.current === stopId ? SWIPE_BAR_HEIGHT : 0,
        intent: 'pending',
        offset: 0,
        samples: [{ t: e.timeStamp, y: e.clientY }],
      }
      gestureRef.current = g

      const capture = () => {
        try {
          scroller.setPointerCapture(g.id)
        } catch {
          // 部分環境(測試/已釋放的指標)會丟錯,不影響手勢本身。
        }
      }

      const finish = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        cleanupRef.current = null
        gestureRef.current = null
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== g.id) return
        if (g.intent === 'pending') {
          const dx = ev.clientX - g.x0
          const dy = ev.clientY - g.y0
          const intent = resolveSwipeIntent(dx, dy)
          if (intent === 'pending') return
          if (intent === 'horizontal') {
            closeAll()
            if (g.type !== 'mouse') {
              // 觸控由瀏覽器原生 pan-x 接手捲動。
              finish()
              return
            }
            // 滑鼠沒有原生拖曳捲動:暫停 snap,手動跟著捲;放手後再吸附。
            g.intent = 'horizontal'
            scroller.style.scrollSnapType = 'none'
            capture()
            suppressClickRef.current = true
          } else {
            if (!g.stopId) {
              finish()
              return
            }
            g.intent = 'vertical'
            const prev = openIdRef.current
            if (prev && prev !== g.stopId) closeAll()
            g.slide?.setAttribute('data-swiping', 'true')
            capture()
            suppressClickRef.current = true
          }
        }
        if (g.intent === 'horizontal') {
          scroller.scrollLeft = g.scrollLeft0 - (ev.clientX - g.x0)
          return
        }
        const offset = dampSwipeOffset(g.base - (ev.clientY - g.y0))
        g.offset = offset
        apply(g.slide, offset)
        g.samples.push({ t: ev.timeStamp, y: ev.clientY })
        if (g.samples.length > 6) g.samples.shift()
      }

      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== g.id) return
        g.slide?.removeAttribute('data-swiping')
        if (g.intent === 'vertical' && g.stopId) {
          settle(g.stopId, shouldSettleOpen(g.offset, swipeVelocity(g.samples)))
        } else if (g.intent === 'horizontal') {
          snapToNearestCard()
        }
        // 補發的 click 緊接在 pointerup 之後;觸控拖曳後瀏覽器不會補發 click,flag 不能殘留去吞下一次點擊。
        if (g.intent !== 'pending') window.setTimeout(() => (suppressClickRef.current = false), 50)
        finish()
      }

      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== g.id) return
        g.slide?.removeAttribute('data-swiping')
        // 垂直手勢中途被中斷:回到手勢開始前的狀態。
        if (g.intent === 'vertical' && g.stopId) settle(g.stopId, g.base > 0)
        if (g.intent === 'horizontal') snapToNearestCard()
        finish()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      cleanupRef.current = finish
    },
    [apply, closeAll, settle, slideOf, snapToNearestCard],
  )

  // 垂直手勢後補發的 click 只吞一次;沒有手勢就放行。
  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    e.stopPropagation()
    e.preventDefault()
  }, [])

  // 鍵盤:卡片本身有焦點時,↑ 展開、↓/Esc 收合。
  const onKeyDown = useCallback(
    (stopId: string, e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        settle(stopId, true)
      } else if (e.key === 'ArrowDown' || e.key === 'Escape') {
        if (openIdRef.current === stopId) {
          e.preventDefault()
          settle(stopId, false)
        }
      }
    },
    [settle],
  )

  return { openId, close: closeAll, onPointerDown, onClickCapture, onKeyDown }
}
