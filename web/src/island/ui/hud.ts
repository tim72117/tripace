// hud.ts——畫面上的 DOM:署名卡、時間滑桿(日夜自動滾動,拖動時暫停)、封面/探索/分享、點站資訊卡、CTA。
// 不持有時間狀態:所有數值由 IslandApp 回呼推進來(setTime/setSelected),按鈕只呼叫 IslandApp 的方法。
import type { IslandMeta, IslandStop } from '../logic/articleToIsland'
import { buildCtaUrl } from '../logic/cta'
import { formatTime } from '../logic/lighting'
import { phaseName } from '../logic/phase'
import type { IslandApp } from '../three/IslandApp'

export type Hud = {
  stage: HTMLElement
  setTime(minutes: number): void
  setSelected(index: number): void
  setExploring(on: boolean): void // 探索模式開關:切換按鈕狀態、顯示搖桿與操作提示
  bind(app: IslandApp): void
  showIssues(lines: string[]): void
  dispose(): void // 移除 window 上的鍵盤監聽(頁面卸載時呼叫)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function sceneSwitchHtml(scenes: ReadonlyArray<{ id: string; label: string }> | undefined, current: string | undefined): string {
  if (!scenes || scenes.length < 2) return ''
  const items = scenes
    .map((sc) => `<button class="btn scene-btn${sc.id === current ? ' is-on' : ''}" type="button" data-scene="${esc(sc.id)}"${sc.id === current ? ' aria-current="true"' : ''}>${esc(sc.label)}</button>`)
    .join('')
  return `<nav class="scene-switch" aria-label="切換場景">${items}</nav>`
}

export function createHud(
  root: HTMLElement,
  data: {
    meta: IslandMeta
    stops: IslandStop[]
    slug: string
    ctaBase: string
    ctaLabel: string // 「用 Tripace 排我的……」按鈕文字(不含箭頭),每個場景自己的
    // 場景切換:scenes 只有 1 個(或沒給)時不畫選單。切換只丟給外層(換路由),HUD 不自己換場景。
    scenes?: ReadonlyArray<{ id: string; label: string }>
    sceneId?: string
    onSwitchScene?: (id: string) => void
    onPreloadScene?: (id: string) => void // hover/focus 選項時先載入,真的切過去幾乎立刻可用
  },
): Hud {
  const { meta, stops } = data
  const ctaUrl = buildCtaUrl(data.ctaBase, { slug: data.slug, stopNames: stops.map((s) => s.name) })
  root.innerHTML = `
    <div class="island-stage" id="island-stage"></div>
    <aside class="info-card" id="info-card" hidden></aside>
    <a class="cta" href="${esc(ctaUrl)}" target="_blank" rel="noopener">${esc(data.ctaLabel)} <span aria-hidden="true">→</span></a>
    ${sceneSwitchHtml(data.scenes, data.sceneId)}
    <div class="controls" id="controls">
      <div class="time">
        <div class="time-row"><strong id="time-text">17:30</strong><span id="phase-text">夕陽</span></div>
        <input id="time-range" type="range" step="1" aria-label="時間" />
      </div>
      <button class="btn" id="btn-cover" type="button">封面</button>
      <button class="btn" id="btn-explore" type="button" aria-pressed="false" hidden>探索</button>
      <button class="btn" id="btn-share" type="button">分享圖</button>
    </div>
    <div class="explore-hint" id="explore-hint" hidden></div>
    <div class="stick" id="stick" hidden aria-label="移動搖桿"><div class="stick-knob" id="stick-knob"></div></div>
    <div class="issues" id="issues" hidden></div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const stage = $('island-stage')
  const card = $('info-card')
  const range = $<HTMLInputElement>('time-range')
  const timeText = $('time-text')
  const phaseText = $('phase-text')
  const exploreBtn = $('btn-explore')
  const stickEl = $('stick')
  const knob = $('stick-knob')
  const hint = $('explore-hint')
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  let app: IslandApp | null = null
  let scrubbing = false

  // 場景切換(事件委派):點選項 → 通知外層換路由;hover/focus → 預載
  const sceneBtn = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-scene]') ?? null
  const sceneNav = root.querySelector<HTMLElement>('.scene-switch')
  const onSceneClick = (e: Event) => { const id = sceneBtn(e)?.dataset.scene; if (id && id !== data.sceneId) data.onSwitchScene?.(id) }
  const onScenePreload = (e: Event) => { const id = sceneBtn(e)?.dataset.scene; if (id && id !== data.sceneId) data.onPreloadScene?.(id) }
  sceneNav?.addEventListener('click', onSceneClick)
  sceneNav?.addEventListener('pointerover', onScenePreload)
  sceneNav?.addEventListener('focusin', onScenePreload)

  function renderCard(i: number) {
    if (i < 0 || !stops[i]) { card.hidden = true; card.innerHTML = ''; return }
    const s = stops[i]
    card.hidden = false
    card.innerHTML = `
      <button class="card-close" type="button" aria-label="關閉">×</button>
      <div class="card-idx">${esc(s.index || String(i + 1))}　<span>${esc(s.time)}${s.timeSource === 'generated' ? '（示意）' : ''}</span></div>
      <h2>${esc(s.name)}</h2>
      ${s.blurb ? `<p class="card-blurb">${esc(s.blurb)}</p>` : ''}
      <p class="card-excerpt">${esc(s.excerpt)}</p>
      <div class="card-by">摘自《${esc(meta.title)}》· 文・${esc(meta.byline.name)}</div>
      <div class="card-nav">
        <button type="button" data-nav="-1" ${i === 0 ? 'disabled' : ''}>← 上一站</button>
        <button type="button" data-nav="1" ${i === stops.length - 1 ? 'disabled' : ''}>下一站 →</button>
      </div>`
    card.querySelector('.card-close')!.addEventListener('click', () => app?.select(-1))
    card.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => app?.select(i + Number(b.dataset.nav))))
  }

  const onKey = (e: KeyboardEvent) => {
    if (!app) return
    if (e.code === 'Escape') app.select(-1)
  }

  return {
    stage,
    setTime(m) {
      timeText.textContent = formatTime(m)
      phaseText.textContent = phaseName(m)
      if (!scrubbing) range.value = String(Math.round(m))
    },
    setSelected: renderCard,
    setExploring(on) {
      exploreBtn.textContent = on ? '離開探索' : '探索'
      exploreBtn.classList.toggle('is-on', on)
      exploreBtn.setAttribute('aria-pressed', String(on))
      stickEl.hidden = !(on && coarse) // 搖桿只給觸控裝置;桌面用 WASD / 方向鍵 / 點地面
      hint.hidden = !on
      hint.textContent = coarse ? '拖曳搖桿或點地面行走' : 'WASD / 方向鍵 或 點地面行走,拖曳旋轉、滾輪縮放,Esc 離開'
      if (!on) { knob.style.transform = ''; app?.setStick(0, 0) }
    },
    showIssues(lines) {
      const el = $('issues')
      el.hidden = lines.length === 0
      el.innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join('')
    },
    bind(a) {
      app = a
      const [lo, hi] = a.range
      range.min = String(lo)
      range.max = String(hi)
      // 日夜自動滾動;拖滑桿時暫停,放開後從拖到的時間繼續
      const endScrub = () => { scrubbing = false; a.setScrubbing(false) }
      range.addEventListener('input', () => { scrubbing = true; a.setScrubbing(true); a.setTime(Number(range.value)) })
      range.addEventListener('change', endScrub)
      range.addEventListener('pointerup', endScrub)
      range.addEventListener('pointercancel', endScrub)
      range.addEventListener('blur', endScrub)
      $('btn-cover').addEventListener('click', () => a.cover())
      // 探索模式:有人物模型才顯示按鈕;搖桿用 pointer capture,拖到圓外時方向照算、大小夾在 1
      exploreBtn.hidden = !a.canExplore
      exploreBtn.addEventListener('click', () => a.setExplore(!a.isExploring))
      const R = 44
      let stickId: number | null = null
      const setFrom = (e: PointerEvent) => {
        const r = stickEl.getBoundingClientRect()
        let dx = e.clientX - (r.left + r.width / 2)
        let dy = e.clientY - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy)
        if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
        knob.style.transform = `translate(${dx}px, ${dy}px)`
        a.setStick(dx / R, -dy / R) // 螢幕上方 = 前
      }
      stickEl.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); setFrom(e); e.preventDefault() })
      stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setFrom(e) })
      const endStick = (e: PointerEvent) => { if (e.pointerId !== stickId) return; stickId = null; knob.style.transform = ''; a.setStick(0, 0) }
      stickEl.addEventListener('pointerup', endStick)
      stickEl.addEventListener('pointercancel', endStick)
      $('btn-share').addEventListener('click', async () => {
        const blob = await a.capture()
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${data.slug}-island.png`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      window.addEventListener('keydown', onKey)
    },
    dispose() { window.removeEventListener('keydown', onKey) },
  }
}
