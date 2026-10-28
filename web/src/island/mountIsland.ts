// mountIsland.ts——把完整版島(three 場景 + HUD)掛進一個空的 DOM 容器,回傳卸載函式。
// 由 IslandPage 在場景資料載入完成後的 useEffect 裡呼叫;React 只管外層容器,裡面的 DOM 由 HUD 與 three 自己管理。
// 場景資料(IslandData)由呼叫端先載入好傳進來,這裡不碰載入、也不知道有哪些場景(選單由 scenes 參數帶入)。
// 網址參數:?q=low|mid|high 強制品質、?t=19:30 起始時間、?debug 顯示 fps/繪製呼叫數與版面驗證警告。
import type { IslandData } from './islandData'
import { parseTime } from './logic/lighting'
import { detectQuality } from './logic/quality'
import { IslandApp } from './three/IslandApp'
import { createHud } from './ui/hud'

export type MountSceneOptions = {
  ctaLabel: string
  scenes: ReadonlyArray<{ id: string; label: string }>
  sceneId: string
  onSwitchScene: (id: string) => void
  onPreloadScene: (id: string) => void
}

export function mountIsland(root: HTMLElement, search: string, data: IslandData, scene: MountSceneOptions): () => void {
  const params = new URLSearchParams(search)
  const debug = params.has('debug')
  const { layout, models, island, stops, issues, controlY, slug } = data
  const errors = issues.filter((i) => i.level === 'error')

  const hud = createHud(root, { meta: island.meta, stops, slug, ctaBase: location.origin, ...scene })
  // 版面資料有問題時用紅框列出——只在開發環境或 ?debug 顯示;正式環境的資料由測試(integration.test.ts)保證零 error
  if ((import.meta.env.DEV && errors.length) || (debug && issues.length)) {
    hud.showIssues(issues.map((i) => `${i.level === 'error' ? '✗' : '!'} ${i.path}: ${i.msg}`))
  }

  let app: IslandApp | null = null
  try {
    const startParam = params.get('t')
    let start = parseTime(stops[0]?.time ?? '17:30')
    if (startParam) { try { start = parseTime(startParam) } catch { /* 時間參數格式錯誤時忽略,用預設 */ } }
    app = new IslandApp({
      container: hud.stage,
      layout,
      models,
      stops,
      meta: island.meta,
      quality: detectQuality(search, {
        width: window.innerWidth,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        cores: navigator.hardwareConcurrency ?? 4,
      }),
      startMinutes: start,
      debug,
      controlY,
      onSelect: (i) => hud.setSelected(i),
      onTime: (m) => hud.setTime(m),
      onExplore: (on) => hud.setExploring(on),
    })
    hud.bind(app)
    hud.setTime(app.time)
  } catch (e) {
    console.error('[island] 啟動失敗:', e)
    const div = document.createElement('div')
    div.className = 'island-fatal'
    div.textContent = '這個裝置無法啟動 3D 場景(需要 WebGL)。'
    hud.stage.appendChild(div)
  }

  return () => {
    app?.dispose()
    hud.dispose()
    root.innerHTML = ''
  }
}
