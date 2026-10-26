// hud.ts——畫面上的 DOM:署名卡、時間滑桿與播放、封面/導覽/分享、點站資訊卡、CTA。
// 不持有時間狀態:所有數值由 IslandApp 回呼推進來(setTime/setSelected),按鈕只呼叫 IslandApp 的方法。
import type { IslandMeta, IslandStop } from '../logic/articleToIsland'
import { buildCtaUrl } from '../logic/cta'
import { formatTime } from '../logic/lighting'
import { phaseName } from '../logic/phase'
import type { IslandApp } from '../three/IslandApp'

export type Hud = {
  stage: HTMLElement
  setTime(minutes: number, playing: boolean): void
  setSelected(index: number): void
  setTouring(on: boolean): void
  bind(app: IslandApp): void
  showIssues(lines: string[]): void
  dispose(): void // 移除 window 上的鍵盤監聽(頁面卸載時呼叫)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function createHud(
  root: HTMLElement,
  data: { meta: IslandMeta; stops: IslandStop[]; slug: string; ctaBase: string },
): Hud {
  const { meta, stops } = data
  const ctaUrl = buildCtaUrl(data.ctaBase, { slug: data.slug, stopNames: stops.map((s) => s.name) })
  root.innerHTML = `
    <div class="island-stage" id="island-stage"></div>
    <aside class="info-card" id="info-card" hidden></aside>
    <a class="cta" href="${esc(ctaUrl)}" target="_blank" rel="noopener">用 Tripace 排我的九份 <span aria-hidden="true">→</span></a>
    <div class="controls" id="controls">
      <button class="btn btn-play" id="btn-play" type="button" aria-label="播放">▶</button>
      <div class="time">
        <div class="time-row"><strong id="time-text">17:30</strong><span id="phase-text">夕陽</span></div>
        <input id="time-range" type="range" step="1" aria-label="時間" />
      </div>
      <button class="btn" id="btn-cover" type="button">封面</button>
      <button class="btn" id="btn-tour" type="button">導覽</button>
      <button class="btn" id="btn-share" type="button">分享圖</button>
    </div>
    <div class="issues" id="issues" hidden></div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const stage = $('island-stage')
  const card = $('info-card')
  const range = $<HTMLInputElement>('time-range')
  const timeText = $('time-text')
  const phaseText = $('phase-text')
  const play = $('btn-play')
  const tourBtn = $('btn-tour')
  let app: IslandApp | null = null
  let scrubbing = false

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
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); app.stopTour(); app.setPlaying(!app.isPlaying) }
    if (e.code === 'Escape') app.select(-1)
  }

  return {
    stage,
    setTime(m, playing) {
      timeText.textContent = formatTime(m)
      phaseText.textContent = phaseName(m)
      if (!scrubbing) range.value = String(Math.round(m))
      play.textContent = playing ? '❚❚' : '▶'
      play.setAttribute('aria-label', playing ? '暫停' : '播放')
    },
    setSelected: renderCard,
    setTouring(on) {
      tourBtn.textContent = on ? '停止' : '導覽'
      tourBtn.classList.toggle('is-on', on)
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
      range.addEventListener('input', () => { scrubbing = true; a.stopTour(); a.setPlaying(false); a.setTime(Number(range.value)) })
      range.addEventListener('change', () => { scrubbing = false })
      play.addEventListener('click', () => { a.stopTour(); a.setPlaying(!a.isPlaying) })
      $('btn-cover').addEventListener('click', () => { a.stopTour(); a.cover() })
      tourBtn.addEventListener('click', () => { if (a.touring) a.stopTour(); else { a.startTour(); this_setTouring(true) } })
      const this_setTouring = (on: boolean) => { tourBtn.textContent = on ? '停止' : '導覽'; tourBtn.classList.toggle('is-on', on) }
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
