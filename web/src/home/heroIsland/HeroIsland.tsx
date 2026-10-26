import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { trackEvent } from '../../analytics'
import { shouldRun, type RunState } from '../../island/logic/mini'
import { heroIslandMode, MIN_ISLAND_PX, probeWebgl, readSaveData } from './mode'
import { scheduleHeroIslandLoad } from './schedule'

// HeroIsland——首頁 hero 的縮小版 3D 島(設計見 docs/island/hero-integration-plan.md)。
//
// 載入:等頁面 load 完成後的閒置時間才動態 import three 與模型(見 schedule.ts),首屏不下載;
//       canvas 不是 LCP 候選,所以 LCP 仍是標題文字。島的大小完全由 CSS 決定(HomePage.css 的 .hero-island),
//       canvas 只是填進已有尺寸的容器,不造成版面位移。
// 省電:離開畫面(IntersectionObserver)、分頁隱藏、context lost 時停止繪製;
//       「減少動態」只畫靜止的一幀;島本身 30fps。
// 失敗:省流量、沒有 WebGL、版位太小、建立失敗,一律呼叫 onUnavailable,由首頁把整個島收起來,
//       文字組回到垂直置中的原樣(不留空白骨架)。
// 不可拖曳:canvas 是 pointer-events:none,整座島是一個連結,連到完整版的 /island 頁。

export const ISLAND_HREF = '/island'
const ARIA_LABEL =
  '夜遊九份遊記小島:依據遊記〈夜遊九份〉做成的低多邊形小島模型,紅燈籠沿著石階亮起。前往查看完整的島'

type IslandHandle = { setTheme(t: 'light' | 'dark'): void; setRunning(on: boolean): void; dispose(): void }

export function HeroIsland({ dark, onUnavailable }: { dark: boolean; onUnavailable: () => void }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const islandRef = useRef<IslandHandle | null>(null)
  const darkRef = useRef(dark)
  darkRef.current = dark
  const unavailableRef = useRef(onUnavailable)
  unavailableRef.current = onUnavailable
  const [ready, setReady] = useState(false)
  const notifiedRef = useRef(false)
  // 只通知一次:版位量測與載入時的判斷都可能發現「不可用」,父層只需要知道一次
  const notifyUnavailable = () => {
    if (notifiedRef.current) return
    notifiedRef.current = true
    unavailableRef.current()
  }

  // 在畫面繪製之前量版位:被 CSS 隱藏(剩下的高度不到 200px,見 HomePage.css 的 @container)時邊長是 0,
  // 這時立刻通知收起,父層會在繪製之前重新 render,使用者看不到「先靠上再跳回置中」的位移。
  useLayoutEffect(() => {
    const box = boxRef.current
    if (box && box.clientWidth < MIN_ISLAND_PX) notifyUnavailable()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載時量一次
  }, [])

  useEffect(() => {
    let disposed = false
    const state: RunState = { intersecting: true, docVisible: document.visibilityState === 'visible', webgl: true, contextLost: false }
    const sync = () => islandRef.current?.setRunning(shouldRun(state))

    const create = async () => {
      const box = boxRef.current
      if (!box || disposed) return
      const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      const mode = heroIslandMode({ saveData: readSaveData(), webgl: probeWebgl(), sizePx: box.clientWidth, reducedMotion })
      if (mode === 'off') { notifyUnavailable(); return }
      try {
        // 動態載入:three、模型與版面都在這個 chunk,載入排程之前不會下載
        const { createMini } = await import('../../island/mini/loadMini')
        if (disposed) return
        const island = createMini({
          container: box,
          theme: darkRef.current ? 'dark' : 'light',
          reducedMotion: mode === 'still',
          onContextLost: () => { state.contextLost = true; setReady(false); sync() },
          // context 還原後整個重建,不相信 three 會自動把所有幾何重新上傳(本專案未驗證)
          onContextRestored: () => {
            islandRef.current?.dispose()
            islandRef.current = null
            state.contextLost = false
            void create()
          },
        })
        islandRef.current = island
        requestAnimationFrame(() => { if (!disposed) setReady(true) }) // 第一幀畫完才淡入
        sync()
      } catch (e) {
        console.warn('[HeroIsland] 建立縮小島失敗,收起:', e)
        notifyUnavailable()
      }
    }

    const cancelSchedule = scheduleHeroIslandLoad(window, () => { void create() })

    let io: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined' && linkRef.current) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) state.intersecting = e.isIntersecting
        sync()
      })
      io.observe(linkRef.current)
    }
    const onVis = () => { state.docVisible = document.visibilityState === 'visible'; sync() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      disposed = true
      cancelSchedule()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      islandRef.current?.dispose()
      islandRef.current = null
    }
  }, [])

  useEffect(() => { islandRef.current?.setTheme(dark ? 'dark' : 'light') }, [dark])

  return (
    <div className="hero-stage">
      <a
        ref={linkRef}
        className={`hero-island${ready ? ' is-ready' : ''}`}
        href={ISLAND_HREF}
        aria-label={ARIA_LABEL}
        onClick={() => trackEvent('landing_island_click', { target: 'island' })}
      >
        <span className="hero-island-halo" aria-hidden="true" />
        <span className="hero-island-shadow" aria-hidden="true" />
        <span className="hero-island-canvas" ref={boxRef} aria-hidden="true" />
      </a>
    </div>
  )
}
